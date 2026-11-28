import type { PartBbox } from './metal.ts'
import type { SheetLayoutSettings } from './tariffs.ts'

export type SheetLayout = {
  widthMm: number
  heightMm: number
  partsPerSheet: number
  /** null, если раскладку по габаритам нужно проверять вручную. */
  sheetsRequired: number | null
}

/** Оценивает тираж по сетке одинаковых прямоугольных габаритов. */
export function calculateSheetLayout(part: PartBbox, quantity: number, settings: SheetLayoutSettings): SheetLayout {
  const { widthMm, heightMm, edgeMarginMm, partGapMm, allowRotation } = settings
  const usableWidth = widthMm - 2 * edgeMarginMm
  const usableHeight = heightMm - 2 * edgeMarginMm

  const capacity = (partWidth: number, partHeight: number): number => {
    // Для n деталей нужны n − 1 зазоров.
    const columns = Math.floor((usableWidth + partGapMm) / (partWidth + partGapMm))
    const rows = Math.floor((usableHeight + partGapMm) / (partHeight + partGapMm))
    return columns * rows
  }

  let partsPerSheet = 0
  if (usableWidth > 0 && usableHeight > 0 && part.width > 0 && part.height > 0) {
    partsPerSheet = capacity(part.width, part.height)
    if (allowRotation) partsPerSheet = Math.max(partsPerSheet, capacity(part.height, part.width))
  }

  return {
    widthMm,
    heightMm,
    partsPerSheet,
    sheetsRequired: partsPerSheet > 0 ? Math.ceil(quantity / partsPerSheet) : null,
  }
}
