import { describe, expect, it } from 'vitest'
import { calculateSheetLayout } from '../../src/core/pricing/sheetLayout.ts'
import type { SheetLayoutSettings } from '../../src/core/pricing/tariffs.ts'

const sheet: SheetLayoutSettings = {
  widthMm: 1500,
  heightMm: 3000,
  edgeMarginMm: 5,
  partGapMm: 10,
  allowRotation: true,
}

describe('раскладка по габаритам', () => {
  it('показывает невозможность раскладки, когда краевые отступы занимают весь лист', () => {
    const settings = { ...sheet, widthMm: 8, heightMm: 8, partGapMm: 0 }
    const result = calculateSheetLayout({ width: 1, height: 1 }, 1, settings)
    expect(result.partsPerSheet).toBe(0)
    expect(result.sheetsRequired).toBeNull()
  })

  it('считает два листа для двух изделий, даже если по площади хватает одного', () => {
    const layout = calculateSheetLayout({ width: 1300, height: 1600 }, 2, sheet)
    expect(layout.partsPerSheet).toBe(1)
    expect(layout.sheetsRequired).toBe(2)
  })

  it('выбирает ориентацию с большей вместимостью и округляет число листов вверх', () => {
    const part = { width: 900, height: 700 }
    const layout = calculateSheetLayout(part, 13, sheet)
    expect(layout.partsPerSheet).toBe(6)
    expect(layout.sheetsRequired).toBe(3)
    expect(calculateSheetLayout(part, 12, sheet).sheetsRequired).toBe(2)
    expect(calculateSheetLayout(part, 13, { ...sheet, allowRotation: false }).partsPerSheet).toBe(4)
  })

  it('учитывает отступы с обеих сторон и зазоры только между деталями', () => {
    const part = { width: 740, height: 2990 }
    expect(calculateSheetLayout(part, 2, sheet).partsPerSheet).toBe(2)
    expect(calculateSheetLayout({ ...part, width: 741 }, 2, sheet).partsPerSheet).toBe(1)
    expect(calculateSheetLayout({ ...part, height: 2991 }, 2, sheet).sheetsRequired).toBeNull()
  })

  it('требует проверки, если деталь входит только с запрещённым поворотом или габарит вырожден', () => {
    const part = { width: 2000, height: 1000 }
    expect(calculateSheetLayout(part, 1, sheet).sheetsRequired).toBe(1)
    expect(calculateSheetLayout(part, 1, { ...sheet, allowRotation: false }).sheetsRequired).toBeNull()
    expect(calculateSheetLayout({ width: 0, height: 1000 }, 1, { ...sheet, partGapMm: 0 }).sheetsRequired).toBeNull()
  })
})
