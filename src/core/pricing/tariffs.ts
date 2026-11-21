import { z } from 'zod'

/*
 * Схема data/tariffs.json.
 *
 * Цены хранятся в рублях, как в прайсе цеха. В копейки их переводит модуль расчёта.
 * null вместо цены означает «по запросу»: это не ноль и не ошибка, итог в этом
 * случае помечается как неполный.
 */

/** Сообщить о проблеме: путь внутри проверяемого объекта и текст на русском. */
type Report = (path: PropertyKey[], message: string) => void

/** Цена в рублях: неотрицательная, с точностью до копейки. */
const rubSchema = z
  .number()
  .nonnegative()
  .refine((rub) => Math.abs(rub * 100 - Math.round(rub * 100)) < 1e-6, {
    message: 'Цена в рублях должна быть с точностью до копейки (не больше двух знаков после запятой)',
  })

/** Цена в рублях или null, что означает «по запросу». */
const priceSchema = rubSchema.nullable()

const idSchema = z.string().min(1)
const labelSchema = z.string().min(1)

/** Идентификаторы в списке не повторяются. */
function checkUniqueIds(items: readonly { id: string }[], report: Report): void {
  const seen = new Set<string>()
  items.forEach((item, i) => {
    if (seen.has(item.id)) report([i, 'id'], `Повторяется id «${item.id}»`)
    seen.add(item.id)
  })
}

/** Числовое поле строго возрастает от элемента к элементу: порядок важен для поиска диапазона. */
function checkAscending<T extends object>(
  items: readonly T[],
  field: keyof T & string,
  unit: string,
  report: Report,
): void {
  items.forEach((item, i) => {
    const prev = items[i - 1]
    if (prev === undefined) return
    const value = item[field] as number
    const prevValue = prev[field] as number
    if (value <= prevValue) {
      report(
        [i, field],
        `Значения ${field} должны идти по возрастанию без повторов: ${value} ${unit} после ${prevValue} ${unit}`,
      )
    }
  })
}

const reporter =
  (ctx: { addIssue: (issue: { code: 'custom'; path: PropertyKey[]; message: string }) => void }): Report =>
  (path, message) =>
    ctx.addIssue({ code: 'custom', path, message })

// ---------- Резка ----------

const cuttingRowSchema = z.strictObject({
  /** Толщина листа, мм. */
  thickness: z.number().positive(),
  /** Резка, ₽ за 1 м. */
  cut: priceSchema,
  /** Прожиг, ₽ за 1 шт. */
  pierce: priceSchema,
})

const materialSchema = z.strictObject({
  id: idSchema,
  name: labelSchema,
  grades: z.array(z.string().min(1)),
  cutting: z.strictObject({
    cutUnit: z.literal('RUB_per_m'),
    pierceUnit: z.literal('RUB_per_piece'),
    rows: z
      .array(cuttingRowSchema)
      .min(1)
      .superRefine((rows, ctx) => checkAscending(rows, 'thickness', 'мм', reporter(ctx))),
  }),
})

// ---------- Гибка ----------

const quantityBracketSchema = z.strictObject({
  id: idSchema,
  label: labelSchema,
  /** Нижняя граница тиража, гибов (включительно). */
  min: z.int().min(1),
  /** Верхняя граница тиража, гибов (включительно); null — без верхней границы. */
  max: z.int().min(1).nullable(),
})

const thicknessBandSchema = z.strictObject({
  id: idSchema,
  label: labelSchema,
  /** Толщина попадает в первый диапазон, где thickness <= maxThickness. */
  maxThickness: z.number().positive(),
})

const lengthRangeSchema = z.strictObject({
  id: idSchema,
  label: labelSchema,
  /** Длина гиба попадает в первый диапазон, где length <= maxLength. */
  maxLength: z.number().positive(),
  /** Диапазон восстановлен по обрезанному скриншоту и требует подтверждения. */
  assumed: z.boolean().optional(),
  assumedNote: z.string().optional(),
  /**
   * Ключ — id диапазона толщины. Значение — цены за гиб по колонкам тиража
   * (в порядке quantityBrackets) или null, если строки нет в прайсе.
   */
  prices: z.record(z.string(), z.array(priceSchema).nullable()),
})

const bendingSchema = z
  .strictObject({
    unit: z.literal('RUB_per_bend'),
    notes: z.array(z.string()).optional(),
    quantityBrackets: z.array(quantityBracketSchema).min(1),
    thicknessBands: z.array(thicknessBandSchema).min(1),
    lengthRanges: z.array(lengthRangeSchema).min(1),
  })
  .superRefine((bending, ctx) => {
    const report = reporter(ctx)
    const { quantityBrackets: brackets, thicknessBands: bands, lengthRanges: ranges } = bending
    const at =
      (...prefix: PropertyKey[]): Report =>
      (path, message) =>
        report([...prefix, ...path], message)

    // Тираж: диапазоны идут подряд без пропусков и пересечений, начиная с 1 гиба.
    brackets.forEach((bracket, i) => {
      if (i === 0 && bracket.min !== 1) {
        report(['quantityBrackets', i, 'min'], 'Первый диапазон тиража должен начинаться с 1 гиба')
      }
      if (bracket.max !== null && bracket.max < bracket.min) {
        report(['quantityBrackets', i, 'max'], `max (${bracket.max}) меньше min (${bracket.min})`)
      }
      const prev = brackets[i - 1]
      if (prev === undefined) return
      if (prev.max === null) {
        report(['quantityBrackets', i - 1, 'max'], 'Диапазон без верхней границы (max = null) может быть только последним')
      } else if (bracket.min !== prev.max + 1) {
        report(
          ['quantityBrackets', i, 'min'],
          `Диапазоны тиража должны идти подряд: после max = ${prev.max} ожидалось min = ${prev.max + 1}, получено ${bracket.min}`,
        )
      }
    })
    checkUniqueIds(brackets, at('quantityBrackets'))

    checkAscending(bands, 'maxThickness', 'мм', at('thicknessBands'))
    checkUniqueIds(bands, at('thicknessBands'))

    checkAscending(ranges, 'maxLength', 'мм', at('lengthRanges'))
    checkUniqueIds(ranges, at('lengthRanges'))

    // Таблица цен: в каждом диапазоне длины есть строка для каждого диапазона толщины,
    // а в строке по одной цене на каждый диапазон тиража.
    const bandIds = new Set(bands.map((band) => band.id))
    ranges.forEach((range, i) => {
      const prices = at('lengthRanges', i, 'prices')
      for (const band of bands) {
        if (!Object.hasOwn(range.prices, band.id)) {
          prices([], `Нет строки цен для толщины «${band.id}». Если цены нет в прайсе, укажите null`)
        }
      }
      for (const [bandId, row] of Object.entries(range.prices)) {
        if (!bandIds.has(bandId)) {
          prices([bandId], `Неизвестный диапазон толщины «${bandId}»: его нет в thicknessBands`)
        } else if (row !== null && row.length !== brackets.length) {
          prices(
            [bandId],
            `Ожидалось ${brackets.length} цен (по числу диапазонов тиража), получено ${row.length}`,
          )
        }
      }
    })
  })

// ---------- Заказ ----------

const orderSchema = z.strictObject({
  /** Учитывать ли стоимость металла (Q-7: не учитывается). */
  includeMaterialCost: z.boolean(),
  /** Минимальная сумма заказа в рублях; null — не задана (Q-8: сейчас 5 000 ₽). */
  minOrderRub: rubSchema.nullable(),
  notes: z.string().optional(),
})

// ---------- Файл целиком ----------

export const tariffsSchema = z.strictObject({
  version: z.literal(1),
  currency: z.literal('RUB'),
  /** Дата обновления прайса, ГГГГ-ММ-ДД. */
  updatedAt: z.iso.date(),
  source: z.string().optional(),
  materials: z
    .array(materialSchema)
    .min(1)
    .superRefine((materials, ctx) => checkUniqueIds(materials, reporter(ctx))),
  bending: bendingSchema,
  order: orderSchema,
})

export type Tariffs = z.infer<typeof tariffsSchema>
export type Material = Tariffs['materials'][number]
export type CuttingRow = Material['cutting']['rows'][number]
export type BendingTariffs = Tariffs['bending']
export type QuantityBracket = BendingTariffs['quantityBrackets'][number]
export type ThicknessBand = BendingTariffs['thicknessBands'][number]
export type LengthRange = BendingTariffs['lengthRanges'][number]

/** Тарифы не прошли проверку. В message — список проблем с путями к полям. */
export class TariffsValidationError extends Error {
  override name = 'TariffsValidationError'
}

/**
 * Проверяет объект тарифов (например, содержимое tariffs.json) и возвращает его
 * с точными типами. Если что-то не так, бросает TariffsValidationError.
 */
export function parseTariffs(input: unknown): Tariffs {
  const result = tariffsSchema.safeParse(input, { error: z.locales.ru().localeError })
  if (!result.success) {
    throw new TariffsValidationError(z.prettifyError(result.error))
  }
  return result.data
}
