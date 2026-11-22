import { type BendingCost, bendingCost } from './bending.ts'
import { type Kopecks, PricingInputError, requireInteger, roundUpToRuble, rubToKopecks } from './common.ts'
import { type CuttingCost, cuttingCost } from './cutting.ts'
import { type MetalCost, type PartBbox, metalCost } from './metal.ts'
import type { Material, Tariffs } from './tariffs.ts'

export type QuoteInput = {
  materialId: string
  /** Толщина t, мм — одна из строк тарифа резки. */
  thicknessMm: number
  /** Количество деталей N. */
  quantity: number
  /** Длина реза одной детали, мм (из разбора DXF). */
  cutLengthMm: number
  /** Прожигов на деталь P (из разбора DXF). */
  pierces: number
  /** Габарит детали, мм (из разбора DXF). Используется для расчёта стоимости металла. */
  bbox: PartBbox
  /** Металл заказчика: стоимость металла не рассчитывается и в итог не входит. */
  customerMetal: boolean
  /**
   * Цена металла, указанная пользователем вручную, ₽/кг.
   * null / undefined — берётся из тарифов (если там null — «по запросу»).
   */
  metalPriceRubPerKg?: number | null
  /** Гибка; null — не нужна. */
  bending: { bendsPerPart: number; bendLengthMm: number } | null
}

export type Quote = {
  material: Material
  quantity: number
  cutting: CuttingCost
  /** null — гибка не нужна. */
  bending: BendingCost | null
  /** null — металл не учитывается (отключено в тарифах или металл заказчика). */
  metal: MetalCost | null
  /** true — расчёт выполнен с металлом заказчика (при включённом учёте металла в тарифах). */
  customerMetal: boolean
  /** Сумма известных статей на одну деталь, коп. */
  pricePerPartKopecks: Kopecks
  /** Точная сумма заказа до округления, коп. */
  totalKopecks: Kopecks
  /** Итог, округлённый вверх до целого рубля, коп. */
  totalRoundedKopecks: Kopecks
  /** Минимальная сумма заказа из тарифов, коп.; null — не задана. */
  minimumOrderKopecks: Kopecks | null
  /**
   * true — полный итог ниже минимальной суммы заказа (Q-8).
   * Для неполного расчёта не проверяется: неизвестные статьи могут поднять итог.
   */
  belowMinimum: boolean
  /**
   * false — часть статей «по запросу» (null в тарифах): итог неполный,
   * в него вошли только статьи с ценой.
   */
  complete: boolean
}

/**
 * Итоговый расчёт (ТЗ 5):
 *   pricePerPart = cutPerPart + piercePerPart + bendPerPart + metalPerPart
 *   total        = pricePerPart × N
 *   totalRounded = округление total вверх до рубля
 * Статьи за штуку уже округлены до копеек, поэтому total — точное целое.
 */
export function calculateQuote(tariffs: Tariffs, input: QuoteInput): Quote {
  // Решения по вопросам ТЗ 8:
  // Q-8: минимальная сумма заказа берётся из тарифов (сейчас 5 000 ₽), ниже — предупреждение.
  // Q-9: итог округляется вверх до рубля, сумма за деталь остаётся с копейками.
  // Q-10: разовой наладки и подготовки УП нет.
  // Q-11 (отменяет Q-7): стоимость металла считается по габариту с отступом marginMm и плотностью материала,
  // если в тарифах включён includeMaterialCost и не выбран «Металл заказчика».
  const material = tariffs.materials.find((m) => m.id === input.materialId)
  if (!material) throw new PricingInputError(`Материала «${input.materialId}» нет в тарифах`)
  requireInteger(input.quantity, 1, 'Количество деталей')

  const { thicknessMm, quantity } = input
  const cutting = cuttingCost(material, input)
  const bending =
    input.bending &&
    bendingCost(tariffs.bending, {
      thicknessMm,
      quantity,
      bendsPerPart: input.bending.bendsPerPart,
      bendLengthMm: input.bending.bendLengthMm,
    })
  const customerMetal = tariffs.order.includeMaterialCost && input.customerMetal
  const metal =
    tariffs.order.includeMaterialCost && !input.customerMetal
      ? metalCost(material, tariffs.order, {
          thicknessMm,
          bbox: input.bbox,
          rateRubPerKg: input.metalPriceRubPerKg,
        })
      : null

  const items = [cutting.cutPerPartKopecks, cutting.piercePerPartKopecks]
  if (bending) items.push(bending.perPartKopecks)
  if (metal) items.push(metal.perPartKopecks)
  const pricePerPartKopecks = items.reduce<number>((sum, item) => sum + (item ?? 0), 0)
  const totalKopecks = pricePerPartKopecks * quantity
  const totalRoundedKopecks = roundUpToRuble(totalKopecks)
  const minimumOrderKopecks = tariffs.order.minOrderRub === null ? null : rubToKopecks(tariffs.order.minOrderRub)
  const complete = items.every((item) => item !== null)
  const belowMinimum = complete && minimumOrderKopecks !== null && totalRoundedKopecks < minimumOrderKopecks

  return {
    material,
    quantity,
    cutting,
    bending,
    metal,
    customerMetal,
    pricePerPartKopecks,
    totalKopecks,
    totalRoundedKopecks,
    minimumOrderKopecks,
    belowMinimum,
    complete,
  }
}
