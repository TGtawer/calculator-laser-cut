import { type Kopecks, PricingInputError, formatNumber, requireNumber, rubToKopecks } from './common.ts'
import { findCuttingRow } from './cutting.ts'
import type { Material, OrderTariffs } from './tariffs.ts'

export const KG_PER_TONNE = 1000

/** Габарит детали, мм (подмножество DxfAnalysis['bbox']). */
export type PartBbox = { width: number; height: number }

export type MetalInput = {
  /** Толщина листа t, мм - одна из строк тарифа резки. */
  thicknessMm: number
  /** Габарит детали, мм. */
  bbox: PartBbox
  /**
   * Цена металла, указанная пользователем вручную, ₽/кг.
   * Если задана - переопределяет цену из тарифов; null/undefined - берётся из тарифов.
   */
  rateRubPerKg?: number | null
}

type BlankSize = {
  /** Габарит заготовки с учётом технологического отступа (bbox + 2·marginMm), мм. */
  sheetWidthMm: number
  sheetHeightMm: number
  /** Технологический отступ с каждой стороны, мм. */
  marginMm: number
  /** Площадь заготовки с отступом, м². */
  areaM2: number
}

export type MetalCost = BlankSize & {
  thicknessMm: number
  /** Масса металла на одну деталь (без округления), кг. */
  massKg: number
  /** Цена металла, коп. за 1 т; null - по запросу. */
  rateKopecksPerTonne: Kopecks | null
  /** Стоимость металла на одну деталь, коп.; null - по запросу. */
  perPartKopecks: Kopecks | null
}

/** Габарит и площадь заготовки на одну деталь. */
export function blankSize(bbox: PartBbox, marginMm: number): BlankSize {
  requireNumber(bbox.width, 'Ширина габарита', { positive: false })
  requireNumber(bbox.height, 'Высота габарита', { positive: false })
  requireNumber(marginMm, 'Технологический отступ', { positive: false })
  const sheetWidthMm = bbox.width + 2 * marginMm
  const sheetHeightMm = bbox.height + 2 * marginMm
  const areaM2 = (sheetWidthMm * sheetHeightMm) / 1e6
  return { sheetWidthMm, sheetHeightMm, marginMm, areaM2 }
}

/**
 * Стоимость металла на одну деталь по габариту с технологическим отступом (ТЗ 5, Q-11):
 *   areaM2       = (bbox.width + 2·marginMm) × (bbox.height + 2·marginMm) / 1e6
 *   massKg       = areaM2 × (t / 1000) × densityKgM3
 *   metalPerPart = massKg × (metalRatePerTonne / 1000)   (округляется до копеек, половина - вверх)
 */
export function metalCost(material: Material, order: OrderTariffs, input: MetalInput): MetalCost {
  const { thicknessMm, bbox, rateRubPerKg } = input
  const blank = blankSize(bbox, order.marginMm)
  requireNumber(material.densityKgM3, 'Плотность материала', { positive: true })
  if (rateRubPerKg !== undefined && rateRubPerKg !== null) {
    requireNumber(rateRubPerKg, 'Цена металла', { positive: false })
  }

  const row = findCuttingRow(material, thicknessMm)
  if (!row) {
    throw new PricingInputError(`Толщины ${formatNumber(thicknessMm)} мм нет в тарифах резки «${material.name}»`)
  }

  // Сначала умножение, потом деление на 1e9 - меньше погрешность плавающей точки.
  const massKg = (blank.sheetWidthMm * blank.sheetHeightMm * thicknessMm * material.densityKgM3) / 1e9
  const rateRub = rateRubPerKg ?? row.metal
  const rateKopecksPerTonne = rateRub === null ? null : rubToKopecks(rateRub * KG_PER_TONNE)
  const perPartKopecks =
    rateKopecksPerTonne === null ? null : Math.round(massKg * (rateKopecksPerTonne / KG_PER_TONNE))

  return {
    ...blank,
    thicknessMm,
    massKg,
    rateKopecksPerTonne,
    perPartKopecks,
  }
}
