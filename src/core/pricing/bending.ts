import { type Kopecks, formatNumber, requireInteger, requireNumber, rubToKopecks } from './common.ts'
import type { BendingTariffs, LengthRange, QuantityBracket, ThicknessBand } from './tariffs.ts'

export type BendingInput = {
  /** Толщина листа t, мм. */
  thicknessMm: number
  /** Длина гиба Lb, мм. В MVP одна на все гибы детали. */
  bendLengthMm: number
  /** Гибов на деталь B. */
  bendsPerPart: number
  /** Количество деталей N. */
  quantity: number
}

/** Почему цена гибки «по запросу». */
export type BendingOnRequestReason =
  /** Толщина больше, чем в таблице гибки (сейчас больше 8 мм). */
  | 'THICKNESS_OUT_OF_RANGE'
  /** Длина гиба больше, чем в таблице (сейчас больше 3200 мм). */
  | 'LENGTH_OUT_OF_RANGE'
  /** Тираж больше последнего диапазона (если у него задан max). */
  | 'QUANTITY_OUT_OF_RANGE'
  /** Ячейки нет в прайсе (null в tariffs.json). */
  | 'NO_PRICE'

export type BendingCost = {
  bendsPerPart: number
  bendLengthMm: number
  /** Тираж: все гибы заказа, B × N. */
  totalBends: number
  /** Найденные диапазоны; null — значение вне таблицы. */
  band: ThicknessBand | null
  range: LengthRange | null
  bracket: QuantityBracket | null
  /** Цена одного гиба, коп.; null — по запросу. */
  pricePerBendKopecks: Kopecks | null
  /** Гибка одной детали B × цена гиба, коп.; null — по запросу. */
  perPartKopecks: Kopecks | null
  /** Причина «по запросу»; null — цена есть. */
  onRequest: BendingOnRequestReason | null
}

/** Диапазон толщины: первый, где t <= maxThickness. Q-4: 2,5 мм округляется вверх, в «3–4». */
export const findThicknessBand = (tariffs: BendingTariffs, thicknessMm: number): ThicknessBand | null =>
  tariffs.thicknessBands.find((b) => thicknessMm <= b.maxThickness) ?? null

/** Диапазон длины гиба: первый, где Lb <= maxLength. Q-6: 500 мм — «до 500» включительно. */
export const findLengthRange = (tariffs: BendingTariffs, bendLengthMm: number): LengthRange | null =>
  tariffs.lengthRanges.find((r) => bendLengthMm <= r.maxLength) ?? null

/** Диапазон тиража, где min <= totalBends <= max; max = null — без верхней границы. */
export const findQuantityBracket = (tariffs: BendingTariffs, totalBends: number): QuantityBracket | null =>
  tariffs.quantityBrackets.find((q) => q.min <= totalBends && (q.max === null || totalBends <= q.max)) ?? null

/**
 * Стоимость гибки (ТЗ 5):
 *   totalBends  = B × N
 *   bendPrice   = range.prices[band.id][индекс bracket]   (null → «по запросу»)
 *   bendPerPart = B × bendPrice
 */
export function bendingCost(tariffs: BendingTariffs, input: BendingInput): BendingCost {
  const { thicknessMm, bendLengthMm, bendsPerPart, quantity } = input
  requireNumber(thicknessMm, 'Толщина', { positive: true })
  requireNumber(bendLengthMm, 'Длина гиба', { positive: true })
  requireInteger(bendsPerPart, 1, 'Число гибов на деталь')
  requireInteger(quantity, 1, 'Количество деталей')

  // Q-5: тираж считается по всем гибам заказа, B × N.
  const totalBends = bendsPerPart * quantity
  const band = findThicknessBand(tariffs, thicknessMm)
  const range = findLengthRange(tariffs, bendLengthMm)
  const bracket = findQuantityBracket(tariffs, totalBends)

  const base = { bendsPerPart, bendLengthMm, totalBends, band, range, bracket }
  const onRequest = (reason: BendingOnRequestReason): BendingCost => ({
    ...base,
    pricePerBendKopecks: null,
    perPartKopecks: null,
    onRequest: reason,
  })

  if (!band) return onRequest('THICKNESS_OUT_OF_RANGE')
  if (!range) return onRequest('LENGTH_OUT_OF_RANGE')
  if (!bracket) return onRequest('QUANTITY_OUT_OF_RANGE')
  const price = range.prices[band.id]?.[tariffs.quantityBrackets.indexOf(bracket)] ?? null
  if (price === null) return onRequest('NO_PRICE')

  const pricePerBendKopecks = rubToKopecks(price)
  return { ...base, pricePerBendKopecks, perPartKopecks: bendsPerPart * pricePerBendKopecks, onRequest: null }
}

/** Пояснение для пользователя, почему гибка «по запросу». Границы берутся из тарифов. */
export function bendingOnRequestMessage(reason: BendingOnRequestReason, tariffs: BendingTariffs): string {
  const last = <T>(items: readonly T[]): T | undefined => items[items.length - 1]
  switch (reason) {
    case 'THICKNESS_OUT_OF_RANGE':
      return `Гибка листа толще ${formatNumber(last(tariffs.thicknessBands)?.maxThickness ?? 0)} мм — по запросу`
    case 'LENGTH_OUT_OF_RANGE':
      return `Гиб длиннее ${formatNumber(last(tariffs.lengthRanges)?.maxLength ?? 0)} мм — по запросу`
    case 'QUANTITY_OUT_OF_RANGE':
      return `Тираж больше ${formatNumber(last(tariffs.quantityBrackets)?.max ?? 0)} гибов — по запросу`
    case 'NO_PRICE':
      return 'Для этой толщины и длины гиба цены в прайсе нет — по запросу'
  }
}
