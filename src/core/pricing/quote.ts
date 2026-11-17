import { type BendingCost, bendingCost } from './bending.ts'
import { type Kopecks, PricingInputError, requireInteger } from './common.ts'
import { type CuttingCost, cuttingCost } from './cutting.ts'
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
  /** Гибка; null — не нужна. */
  bending: { bendsPerPart: number; bendLengthMm: number } | null
}

export type Quote = {
  material: Material
  quantity: number
  cutting: CuttingCost
  /** null — гибка не нужна. */
  bending: BendingCost | null
  /** Сумма известных статей на одну деталь, коп. */
  pricePerPartKopecks: Kopecks
  /** Итог: pricePerPart × N, коп. */
  totalKopecks: Kopecks
  /**
   * false — часть статей «по запросу» (null в тарифах): итог неполный,
   * в него вошли только статьи с ценой.
   */
  complete: boolean
}

/**
 * Итоговый расчёт (ТЗ 5):
 *   pricePerPart = cutPerPart + piercePerPart + bendPerPart
 *   total        = pricePerPart × N
 * Статьи за штуку уже округлены до копеек, поэтому итог — точное целое.
 */
export function calculateQuote(tariffs: Tariffs, input: QuoteInput): Quote {
  // Вопросы ТЗ 8, вариант «по умолчанию»:
  // TODO(Q-7): стоимость металла не учитывается (order.includeMaterialCost не применяется).
  // TODO(Q-8): минимальной суммы заказа нет (order.minOrderRub не применяется).
  // TODO(Q-9): итог округляется до копеек; до рубля или до 10 ₽ — после ответа.
  // TODO(Q-10): разовой стоимости наладки и подготовки УП нет.
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

  const items = [cutting.cutPerPartKopecks, cutting.piercePerPartKopecks]
  if (bending) items.push(bending.perPartKopecks)
  const pricePerPartKopecks = items.reduce<number>((sum, item) => sum + (item ?? 0), 0)

  return {
    material,
    quantity,
    cutting,
    bending,
    pricePerPartKopecks,
    totalKopecks: pricePerPartKopecks * quantity,
    complete: items.every((item) => item !== null),
  }
}
