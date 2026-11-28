import {
  type Kopecks,
  PricingInputError,
  formatNumber,
  requireInteger,
  requireNumber,
  rubToKopecks,
} from './common.ts'
import type { CuttingRow, Material } from './tariffs.ts'

export type CuttingInput = {
  /** Толщина листа, мм. Только из строк тарифа: свободный ввод запрещён (ТЗ 2). */
  thicknessMm: number
  /** Длина реза одной детали, мм. */
  cutLengthMm: number
  /** Прожигов на одну деталь. */
  pierces: number
}

export type CuttingCost = {
  thicknessMm: number
  cutLengthMm: number
  pierces: number
  /** Цена резки, коп. за 1 м; null - по запросу. */
  cutRateKopecks: Kopecks | null
  /** Цена прожига, коп. за 1 шт.; null - по запросу. */
  pierceRateKopecks: Kopecks | null
  /** Резка одной детали, коп.; null - по запросу. */
  cutPerPartKopecks: Kopecks | null
  /** Прожиги одной детали, коп.; null - по запросу. */
  piercePerPartKopecks: Kopecks | null
}

/**
 * Толщины, доступные для резки, по возрастанию - для выпадающего списка.
 * Максимум задан тарифами: сейчас 10 мм (Q-2), строки 12–16 мм не используются.
 */
export const cuttingThicknesses = (material: Material): number[] => material.cutting.rows.map((r) => r.thickness)

export const findCuttingRow = (material: Material, thicknessMm: number): CuttingRow | undefined =>
  material.cutting.rows.find((r) => r.thickness === thicknessMm)

/**
 * Стоимость резки одной детали (ТЗ 5):
 *   cutPerPart    = L × rowCut.cut     (L - длина реза в метрах)
 *   piercePerPart = P × rowCut.pierce
 * Каждая статья округляется до копеек, половина - вверх.
 */
export function cuttingCost(material: Material, input: CuttingInput): CuttingCost {
  const { thicknessMm, cutLengthMm, pierces } = input
  requireNumber(cutLengthMm, 'Длина реза', { positive: false })
  requireInteger(pierces, 0, 'Число прожигов')
  const row = findCuttingRow(material, thicknessMm)
  if (!row) {
    throw new PricingInputError(`Толщины ${formatNumber(thicknessMm)} мм нет в тарифах резки «${material.name}»`)
  }

  const cutRateKopecks = row.cut === null ? null : rubToKopecks(row.cut)
  const pierceRateKopecks = row.pierce === null ? null : rubToKopecks(row.pierce)
  return {
    thicknessMm,
    cutLengthMm,
    pierces,
    cutRateKopecks,
    pierceRateKopecks,
    // мм × коп/м ÷ 1000: сначала умножение - для целых миллиметров результат точный.
    cutPerPartKopecks: cutRateKopecks === null ? null : Math.round((cutLengthMm * cutRateKopecks) / 1000),
    piercePerPartKopecks: pierceRateKopecks === null ? null : pierces * pierceRateKopecks,
  }
}
