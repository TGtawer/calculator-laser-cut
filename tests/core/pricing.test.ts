import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import tariffsJson from '../../data/tariffs.json'
import { analyzeDxfText } from '../../src/core/dxf/analyze.ts'
import {
  type BendingInput,
  bendingCost,
  bendingOnRequestMessage,
  findLengthRange,
  findQuantityBracket,
  findThicknessBand,
} from '../../src/core/pricing/bending.ts'
import { PricingInputError, roundUpToRuble, rubToKopecks } from '../../src/core/pricing/common.ts'
import { cuttingCost, cuttingThicknesses } from '../../src/core/pricing/cutting.ts'
import { metalCost } from '../../src/core/pricing/metal.ts'
import { type QuoteInput, calculateQuote } from '../../src/core/pricing/quote.ts'
import { type Tariffs, parseTariffs } from '../../src/core/pricing/tariffs.ts'

const tariffs = parseTariffs(tariffsJson)
const material = tariffs.materials[0]!
const copy = (): Tariffs => structuredClone(tariffs)

const fixture = (name: string): string => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')

function analyzeFixture(name: string) {
  const result = analyzeDxfText(fixture(name))
  if (!result.ok) throw new Error(result.error.message)
  return result.analysis
}

const quoteInput = (over: Partial<QuoteInput>): QuoteInput => ({
  materialId: material.id,
  thicknessMm: 3,
  quantity: 1,
  cutLengthMm: 0,
  pierces: 0,
  bbox: { width: 100, height: 50 },
  // По умолчанию — металл заказчика, чтобы примеры 1–5 и тесты резки/гибки проверяли услуги изолированно.
  customerMetal: true,
  metalPriceRubPerKg: null,
  bending: null,
  ...over,
})

const bend = (over: Partial<BendingInput>) =>
  bendingCost(tariffs.bending, { thicknessMm: 3, bendLengthMm: 800, bendsPerPart: 1, quantity: 1, ...over })

describe('контрольные примеры ТЗ 5.1', () => {
  it('пример 1: 01_plate_rect_2holes.dxf, 3 мм, 10 шт — итого 1 040,00 ₽', () => {
    const a = analyzeFixture('01_plate_rect_2holes.dxf')
    expect(a.cutLengthMm / 1000).toBeCloseTo(0.362832, 6)
    expect(a.pierces).toBe(3)

    const q = calculateQuote(tariffs, quoteInput({ thicknessMm: 3, quantity: 10, cutLengthMm: a.cutLengthMm, pierces: a.pierces }))
    expect(q.cutting.cutPerPartKopecks).toBe(4100) // 0.362832 × 113 = 41,00 ₽
    expect(q.cutting.piercePerPartKopecks).toBe(6300) // 3 × 21 = 63,00 ₽
    expect(q.bending).toBeNull()
    expect(q.pricePerPartKopecks).toBe(10400)
    expect(q.totalKopecks).toBe(104000)
    expect(q.totalRoundedKopecks).toBe(104000)
    expect(q.belowMinimum).toBe(true) // 1 040 ₽ < 5 000 ₽
    expect(q.complete).toBe(true)
  })

  it('пример 2: 02_slot_lwpolyline_bulge.dxf, 5 мм, 4 шт — 441,08 ₽, итого 442 ₽', () => {
    const a = analyzeFixture('02_slot_lwpolyline_bulge.dxf')
    expect(a.cutLengthMm / 1000).toBeCloseTo(0.388496, 6)
    expect(a.pierces).toBe(2)

    const q = calculateQuote(tariffs, quoteInput({ thicknessMm: 5, quantity: 4, cutLengthMm: a.cutLengthMm, pierces: a.pierces }))
    expect(q.cutting.cutPerPartKopecks).toBe(5827) // 0.388496 × 150 = 58,27 ₽
    expect(q.cutting.piercePerPartKopecks).toBe(5200) // 2 × 26 = 52,00 ₽
    expect(q.pricePerPartKopecks).toBe(11027)
    expect(q.totalKopecks).toBe(44108)
    expect(q.totalRoundedKopecks).toBe(44200)
    expect(q.belowMinimum).toBe(true) // 442 ₽ < 5 000 ₽
    expect(q.complete).toBe(true)
  })

  it('пример 3: только гибка t = 3, Lb = 800, B = 2, N = 10 — 55 ₽/гиб, итого 1 100 ₽', () => {
    const b = bend({ thicknessMm: 3, bendLengthMm: 800, bendsPerPart: 2, quantity: 10 })
    expect(b.totalBends).toBe(20)
    expect(b.bracket?.id).toBe('q1')
    expect(b.band?.id).toBe('t3')
    expect(b.range?.id).toBe('L2')
    expect(b.pricePerBendKopecks).toBe(5500)
    expect(b.perPartKopecks).toBe(11000)
    expect(b.onRequest).toBeNull()
    expect(b.perPartKopecks! * 10).toBe(110000)

    // То же через итоговый расчёт, без резки.
    const q = calculateQuote(tariffs, quoteInput({ quantity: 10, bending: { bendsPerPart: 2, bendLengthMm: 800 } }))
    expect(q.pricePerPartKopecks).toBe(11000)
    expect(q.totalKopecks).toBe(110000)
    expect(q.totalRoundedKopecks).toBe(110000)
    expect(q.belowMinimum).toBe(true) // 1 100 ₽ < 5 000 ₽
    expect(q.complete).toBe(true)
  })

  it('пример 4: t = 8, Lb = 2000 — L3 × t5 = null, «по запросу», итог неполный', () => {
    const b = bend({ thicknessMm: 8, bendLengthMm: 2000, bendsPerPart: 2, quantity: 10 })
    expect(b.range?.id).toBe('L3')
    expect(b.band?.id).toBe('t5')
    expect(b.pricePerBendKopecks).toBeNull()
    expect(b.perPartKopecks).toBeNull()
    expect(b.onRequest).toBe('NO_PRICE')

    // Резка посчитана по тарифу 8 мм (233 ₽/м, 30 ₽/прожиг), гибка — нет: в итог вошла только резка.
    const q = calculateQuote(
      tariffs,
      quoteInput({ thicknessMm: 8, quantity: 10, cutLengthMm: 1000, pierces: 1, bending: { bendsPerPart: 2, bendLengthMm: 2000 } }),
    )
    expect(q.complete).toBe(false)
    expect(q.pricePerPartKopecks).toBe(23300 + 3000)
    expect(q.totalKopecks).toBe((23300 + 3000) * 10)
    expect(q.totalRoundedKopecks).toBe((23300 + 3000) * 10)
    expect(q.belowMinimum).toBe(false) // неполный итог с минимумом не сравнивается
  })

  it('пример 5: границы диапазонов', () => {
    // Q-4: толщина округляется вверх, 2,5 мм — в «3–4».
    expect(findThicknessBand(tariffs.bending, 2.5)?.id).toBe('t3')
    // Q-6: 500 — «до 500» включительно.
    expect(findLengthRange(tariffs.bending, 500)?.id).toBe('L1')
    expect(findLengthRange(tariffs.bending, 501)?.id).toBe('L2')
    expect(findQuantityBracket(tariffs.bending, 50)?.id).toBe('q1')
    expect(findQuantityBracket(tariffs.bending, 51)?.id).toBe('q2')
    expect(findQuantityBracket(tariffs.bending, 1001)?.id).toBe('q5')

    // Те же границы — через bendingCost.
    expect(bend({ thicknessMm: 2.5 }).band?.id).toBe('t3')
    expect(bend({ bendLengthMm: 500 }).range?.id).toBe('L1')
    expect(bend({ bendLengthMm: 501 }).range?.id).toBe('L2')
    expect(bend({ bendsPerPart: 5, quantity: 10 }).bracket?.id).toBe('q1')
    expect(bend({ bendsPerPart: 3, quantity: 17 }).bracket?.id).toBe('q2')
    expect(bend({ bendsPerPart: 1, quantity: 1001 }).bracket?.id).toBe('q5')
  })

  it('пример 6 (Q-11): фикстура 01 (100×50), 3 мм, 10 шт, marginMm = 0, металл 120 ₽/кг — итого 1 182 ₽', () => {
    const a = analyzeFixture('01_plate_rect_2holes.dxf')
    const t = copy()
    t.order.marginMm = 0
    t.materials[0]!.cutting.rows.find((r) => r.thickness === 3)!.metal = 120

    const q = calculateQuote(
      t,
      quoteInput({
        thicknessMm: 3,
        quantity: 10,
        cutLengthMm: a.cutLengthMm,
        pierces: a.pierces,
        bbox: a.bbox,
        customerMetal: false,
      }),
    )
    expect(q.metal).not.toBeNull()
    expect(q.metal!.areaM2).toBeCloseTo(0.005, 8)
    expect(q.metal!.massKg).toBeCloseTo(0.11775, 8)
    expect(q.metal!.rateKopecks).toBe(12000)
    expect(q.metal!.perPartKopecks).toBe(1413) // 0.11775 × 120 = 14,13 ₽
    expect(q.pricePerPartKopecks).toBe(10400 + 1413) // 118,13 ₽
    expect(q.totalKopecks).toBe(118130) // 1 181,30 ₽
    expect(q.totalRoundedKopecks).toBe(118200) // 1 182 ₽ (округление вверх)
    expect(q.belowMinimum).toBe(true) // 1 182 ₽ < 5 000 ₽
    expect(q.complete).toBe(true)
  })

  it('пример 7 (Q-11): то же, marginMm = 5 — площадь 110×60 мм, металл 18,65 ₽ за деталь', () => {
    const a = analyzeFixture('01_plate_rect_2holes.dxf')
    const t = copy()
    t.order.marginMm = 5
    t.materials[0]!.cutting.rows.find((r) => r.thickness === 3)!.metal = 120

    const q = calculateQuote(
      t,
      quoteInput({
        thicknessMm: 3,
        quantity: 10,
        cutLengthMm: a.cutLengthMm,
        pierces: a.pierces,
        bbox: a.bbox,
        customerMetal: false,
      }),
    )
    expect(q.metal!.sheetWidthMm).toBeCloseTo(110, 6)
    expect(q.metal!.sheetHeightMm).toBeCloseTo(60, 6)
    expect(q.metal!.areaM2).toBeCloseTo(0.0066, 8)
    expect(q.metal!.massKg).toBeCloseTo(0.15543, 8)
    expect(q.metal!.perPartKopecks).toBe(1865) // 0.15543 × 120 = 18,6516 → 18,65 ₽
    expect(q.pricePerPartKopecks).toBe(10400 + 1865)
    expect(q.totalKopecks).toBe(122650)
    expect(q.totalRoundedKopecks).toBe(122700)
    expect(q.belowMinimum).toBe(true)
    expect(q.complete).toBe(true)
  })

  it('пример 8 (Q-11): metal = null и цена не введена — «по запросу», итог неполный, минимум не проверяется', () => {
    const a = analyzeFixture('01_plate_rect_2holes.dxf')
    const q = calculateQuote(
      tariffs,
      quoteInput({
        thicknessMm: 3,
        quantity: 10,
        cutLengthMm: a.cutLengthMm,
        pierces: a.pierces,
        bbox: a.bbox,
        customerMetal: false,
        metalPriceRubPerKg: null,
      }),
    )
    expect(q.metal).not.toBeNull()
    expect(q.metal!.rateKopecks).toBeNull()
    expect(q.metal!.perPartKopecks).toBeNull()
    expect(q.pricePerPartKopecks).toBe(10400)
    expect(q.totalRoundedKopecks).toBe(104000)
    expect(q.complete).toBe(false)
    expect(q.belowMinimum).toBe(false)
  })

  it('пример 9 (Q-11): «Металл заказчика» — итог совпадает с примером 1 (1 040 ₽)', () => {
    const a = analyzeFixture('01_plate_rect_2holes.dxf')
    const t = copy()
    t.materials[0]!.cutting.rows.find((r) => r.thickness === 3)!.metal = 120

    const q = calculateQuote(
      t,
      quoteInput({
        thicknessMm: 3,
        quantity: 10,
        cutLengthMm: a.cutLengthMm,
        pierces: a.pierces,
        bbox: a.bbox,
        customerMetal: true,
        metalPriceRubPerKg: 120,
      }),
    )
    expect(q.metal).toBeNull()
    expect(q.customerMetal).toBe(true)
    expect(q.pricePerPartKopecks).toBe(10400)
    expect(q.totalRoundedKopecks).toBe(104000)
    expect(q.belowMinimum).toBe(true)
    expect(q.complete).toBe(true)
  })
})

describe('металл (Q-11)', () => {
  it('ручной ввод цены за кг работает при metal = null в тарифах', () => {
    const a = analyzeFixture('01_plate_rect_2holes.dxf')
    const q = calculateQuote(
      tariffs,
      quoteInput({
        thicknessMm: 3,
        quantity: 10,
        cutLengthMm: a.cutLengthMm,
        pierces: a.pierces,
        bbox: a.bbox,
        customerMetal: false,
        metalPriceRubPerKg: 120,
      }),
    )
    expect(q.metal!.rateKopecks).toBe(12000)
    expect(q.metal!.perPartKopecks).toBe(1865)
    expect(q.complete).toBe(true)
  })

  it('ручной ввод цены переопределяет цену из тарифов', () => {
    const t = copy()
    t.order.marginMm = 0
    t.materials[0]!.cutting.rows.find((r) => r.thickness === 3)!.metal = 100

    const m = metalCost(t.materials[0]!, t.order, {
      thicknessMm: 3,
      bbox: { width: 100, height: 50 },
      rateRubPerKg: 120,
    })
    expect(m.rateKopecks).toBe(12000)
    expect(m.perPartKopecks).toBe(1413)
  })

  it('includeMaterialCost = false отключает расчёт металла и флаг customerMetal', () => {
    const t = copy()
    t.order.includeMaterialCost = false
    const q = calculateQuote(
      t,
      quoteInput({
        thicknessMm: 3,
        quantity: 10,
        cutLengthMm: 1000,
        pierces: 1,
        customerMetal: false,
        metalPriceRubPerKg: 120,
      }),
    )
    expect(q.metal).toBeNull()
    expect(q.customerMetal).toBe(false)
    expect(q.complete).toBe(true)
  })

  it('проверка минимума заказа (Q-8) учитывает стоимость металла', () => {
    // Без металла: 40 × 104 ₽ = 4 160 ₽ < 5 000 ₽; с металлом (18,65 ₽ × 40 = 746 ₽) → 4 906 ₽ < 5 000 ₽;
    // а при цене металла 200 ₽/кг (31,09 ₽ × 40 = 1 243,60 ₽) → 5 404 ₽ ≥ 5 000 ₽.
    const a = analyzeFixture('01_plate_rect_2holes.dxf')
    const q = calculateQuote(
      tariffs,
      quoteInput({
        thicknessMm: 3,
        quantity: 40,
        cutLengthMm: a.cutLengthMm,
        pierces: a.pierces,
        bbox: a.bbox,
        customerMetal: false,
        metalPriceRubPerKg: 200,
      }),
    )
    expect(q.metal!.perPartKopecks).toBe(3109) // 0.15543 × 200 = 31,086 → 31,09 ₽
    expect(q.totalRoundedKopecks).toBe(540400) // (104,00 + 31,09) × 40 = 5 403,60 → 5 404 ₽
    expect(q.belowMinimum).toBe(false)
  })
})

describe('резка', () => {
  it('статья округляется до копеек, половина — вверх', () => {
    // 125 мм × 83 ₽/м = 10,375 ₽ → 10,38 ₽; 124,4 мм × 83 ₽/м = 10,3252 ₽ → 10,33 ₽.
    expect(cuttingCost(material, { thicknessMm: 1, cutLengthMm: 125, pierces: 0 }).cutPerPartKopecks).toBe(1038)
    expect(cuttingCost(material, { thicknessMm: 1, cutLengthMm: 124.4, pierces: 0 }).cutPerPartKopecks).toBe(1033)
  })

  it('округление за штуку — до умножения на количество', () => {
    const q = calculateQuote(tariffs, quoteInput({ thicknessMm: 1, quantity: 3, cutLengthMm: 125 }))
    expect(q.totalKopecks).toBe(1038 * 3) // а не round(1037,5 × 3) = 3113
  })

  it('цены берутся из строки своей толщины', () => {
    const c = cuttingCost(material, { thicknessMm: 10, cutLengthMm: 1000, pierces: 2 })
    expect(c.cutRateKopecks).toBe(30000)
    expect(c.pierceRateKopecks).toBe(3300)
    expect(c.cutPerPartKopecks).toBe(30000)
    expect(c.piercePerPartKopecks).toBe(6600)
  })

  it('Q-1/Q-2: значения со звёздочкой и строки 12–16 мм не используются', () => {
    expect(cuttingThicknesses(material)).not.toContain(12)
    expect(cuttingThicknesses(material)).not.toContain(14)
    expect(cuttingThicknesses(material)).not.toContain(16)
  })

  it('null в тарифе резки — «по запросу», итог неполный и без этой статьи', () => {
    const t = copy()
    const row = t.materials[0]!.cutting.rows.find((r) => r.thickness === 3)!
    row.cut = null
    const q = calculateQuote(t, quoteInput({ quantity: 2, cutLengthMm: 1000, pierces: 3 }))
    expect(q.cutting.cutPerPartKopecks).toBeNull()
    expect(q.cutting.piercePerPartKopecks).toBe(6300)
    expect(q.pricePerPartKopecks).toBe(6300)
    expect(q.totalKopecks).toBe(12600)
    expect(q.complete).toBe(false)
  })

  it('список толщин — строго из тарифов', () => {
    expect(cuttingThicknesses(material)).toEqual(material.cutting.rows.map((r) => r.thickness))
    expect(cuttingThicknesses(material)[0]).toBe(0.5)
    expect(cuttingThicknesses(material).at(-1)).toBe(10)
  })
})

describe('округление итога и минимальный заказ', () => {
  it('округление вверх до рубля', () => {
    expect(roundUpToRuble(0)).toBe(0)
    expect(roundUpToRuble(1)).toBe(100)
    expect(roundUpToRuble(100)).toBe(100)
    expect(roundUpToRuble(101)).toBe(200)
    expect(roundUpToRuble(44108)).toBe(44200)
  })

  it('итог округляется вверх, точная сумма сохраняется', () => {
    const q = calculateQuote(tariffs, quoteInput({ thicknessMm: 1, quantity: 3, cutLengthMm: 125 }))
    expect(q.totalKopecks).toBe(3114) // 1 038 коп. × 3
    expect(q.totalRoundedKopecks).toBe(3200)
    expect(q.pricePerPartKopecks).toBe(1038)
  })

  it('минимум 5 000 ₽: ниже — предупреждение', () => {
    const q = calculateQuote(tariffs, quoteInput({ thicknessMm: 3, quantity: 1, cutLengthMm: 100 }))
    expect(q.minimumOrderKopecks).toBe(500000)
    expect(q.totalRoundedKopecks).toBe(1200) // 11,30 ₽ → 12 ₽
    expect(q.belowMinimum).toBe(true)
  })

  it('минимум достигнут — предупреждения нет', () => {
    const q = calculateQuote(tariffs, quoteInput({ thicknessMm: 3, quantity: 50, cutLengthMm: 1000, pierces: 2 }))
    expect(q.totalRoundedKopecks).toBe(775000) // 155 ₽ × 50 = 7 750 ₽
    expect(q.belowMinimum).toBe(false)
  })

  it('минимум не задан в тарифах — проверки нет', () => {
    const t = copy()
    t.order.minOrderRub = null
    const q = calculateQuote(t, quoteInput({ thicknessMm: 3, quantity: 1, cutLengthMm: 100 }))
    expect(q.minimumOrderKopecks).toBeNull()
    expect(q.belowMinimum).toBe(false)
  })
})

describe('гибка', () => {
  it('Q-5: тираж — по всем гибам заказа: 3 гиба × 20 шт = 60 → q2', () => {
    const b = bend({ thicknessMm: 3, bendLengthMm: 800, bendsPerPart: 3, quantity: 20 })
    expect(b.totalBends).toBe(60)
    expect(b.bracket?.id).toBe('q2')
    expect(b.pricePerBendKopecks).toBe(5000)
    expect(b.perPartKopecks).toBe(15000)
  })

  it('толщина больше 8 мм — «по запросу»', () => {
    const b = bend({ thicknessMm: 10 })
    expect(b.band).toBeNull()
    expect(b.onRequest).toBe('THICKNESS_OUT_OF_RANGE')
    expect(b.perPartKopecks).toBeNull()
    expect(bend({ thicknessMm: 8 }).band?.id).toBe('t5')
  })

  it('диапазон «до 500 мм»: t = 3, Lb = 300, B = 2, N = 10 — 52 ₽/гиб, 104,00 ₽ за деталь', () => {
    const b = bend({ thicknessMm: 3, bendLengthMm: 300, bendsPerPart: 2, quantity: 10 })
    expect(b.range?.id).toBe('L1')
    expect(b.band?.id).toBe('t3')
    expect(b.totalBends).toBe(20)
    expect(b.bracket?.id).toBe('q1')
    expect(b.pricePerBendKopecks).toBe(5200)
    expect(b.perPartKopecks).toBe(10400)
    expect(b.onRequest).toBeNull()
  })

  it('длина гиба больше 3200 мм — «по запросу»', () => {
    expect(bend({ bendLengthMm: 2500 }).range?.id).toBe('L3')
    expect(bend({ bendLengthMm: 2501 }).range?.id).toBe('L4')
    expect(bend({ bendLengthMm: 3200 }).range?.id).toBe('L4')
    const b = bend({ bendLengthMm: 3201 })
    expect(b.range).toBeNull()
    expect(b.onRequest).toBe('LENGTH_OUT_OF_RANGE')
  })

  it('диапазон «от 2500 до 3200 мм»: t = 1 — 65 ₽, t = 3 — «по запросу»', () => {
    const thin = bend({ thicknessMm: 1, bendLengthMm: 3000, bendsPerPart: 1, quantity: 1 })
    expect(thin.range?.id).toBe('L4')
    expect(thin.band?.id).toBe('t1')
    expect(thin.pricePerBendKopecks).toBe(6500)
    expect(thin.perPartKopecks).toBe(6500)
    expect(thin.onRequest).toBeNull()

    const thick = bend({ thicknessMm: 3, bendLengthMm: 3000, bendsPerPart: 1, quantity: 1 })
    expect(thick.range?.id).toBe('L4')
    expect(thick.band?.id).toBe('t3')
    expect(thick.pricePerBendKopecks).toBeNull()
    expect(thick.onRequest).toBe('NO_PRICE')
  })

  it('строки нет в прайсе (null вместо строки) — «по запросу»', () => {
    const b = bend({ thicknessMm: 6, bendLengthMm: 3000 })
    expect(b.range?.id).toBe('L4')
    expect(b.band?.id).toBe('t4')
    expect(b.onRequest).toBe('NO_PRICE')
  })

  it('тираж больше последнего диапазона с верхней границей — «по запросу»', () => {
    const t = copy()
    t.bending.quantityBrackets[t.bending.quantityBrackets.length - 1]!.max = 5000
    const b = bendingCost(t.bending, { thicknessMm: 3, bendLengthMm: 800, bendsPerPart: 1, quantity: 5001 })
    expect(b.bracket).toBeNull()
    expect(b.onRequest).toBe('QUANTITY_OUT_OF_RANGE')
  })

  it('цена гиба берётся из колонки своего тиража', () => {
    const columns = tariffs.bending.lengthRanges.find((r) => r.id === 'L2')!.prices['t3']!
    const quantities = [1, 51, 101, 501, 1001]
    quantities.forEach((quantity, i) => {
      expect(bend({ thicknessMm: 3, bendLengthMm: 800, quantity }).pricePerBendKopecks).toBe(rubToKopecks(columns[i]!))
    })
  })

  it('гибка и резка вместе: статьи складываются за штуку, итог × N', () => {
    const q = calculateQuote(
      tariffs,
      quoteInput({ thicknessMm: 3, quantity: 10, cutLengthMm: 1000, pierces: 2, bending: { bendsPerPart: 2, bendLengthMm: 800 } }),
    )
    expect(q.pricePerPartKopecks).toBe(11300 + 2 * 2100 + 2 * 5500)
    expect(q.totalKopecks).toBe(q.pricePerPartKopecks * 10)
    expect(q.complete).toBe(true)
  })

  it('пояснения «по запросу» — с границами из тарифов', () => {
    expect(bendingOnRequestMessage('THICKNESS_OUT_OF_RANGE', tariffs.bending)).toBe('Гибка листа толще 8 мм — по запросу')
    expect(bendingOnRequestMessage('LENGTH_OUT_OF_RANGE', tariffs.bending)).toBe('Гиб длиннее 3 200 мм — по запросу')
    expect(bendingOnRequestMessage('NO_PRICE', tariffs.bending)).toContain('по запросу')
  })
})

describe('проверка входных данных', () => {
  const expectInputError = (fn: () => unknown, fragment: string) => {
    expect(fn).toThrow(PricingInputError)
    expect(fn).toThrow(fragment)
  }

  it('толщины нет в тарифах — ошибка, свободный ввод запрещён', () => {
    expectInputError(() => calculateQuote(tariffs, quoteInput({ thicknessMm: 7 })), 'Толщины 7 мм нет в тарифах')
    expectInputError(() => calculateQuote(tariffs, quoteInput({ thicknessMm: 3.5 })), 'Толщины 3,5 мм нет')
  })

  it('количество — целое ≥ 1', () => {
    for (const quantity of [0, -1, 1.5, Number.NaN]) {
      expectInputError(() => calculateQuote(tariffs, quoteInput({ quantity })), 'Количество деталей')
    }
  })

  it('гибов на деталь — целое ≥ 1, длина гиба > 0', () => {
    expectInputError(() => bend({ bendsPerPart: 0 }), 'Число гибов на деталь')
    expectInputError(() => bend({ bendsPerPart: 2.5 }), 'Число гибов на деталь')
    expectInputError(() => bend({ bendLengthMm: 0 }), 'Длина гиба')
    expectInputError(() => bend({ bendLengthMm: Number.POSITIVE_INFINITY }), 'Длина гиба')
  })

  it('длина реза ≥ 0, прожиги — целое ≥ 0', () => {
    expectInputError(() => calculateQuote(tariffs, quoteInput({ cutLengthMm: -1 })), 'Длина реза')
    expectInputError(() => calculateQuote(tariffs, quoteInput({ pierces: -1 })), 'Число прожигов')
    expectInputError(() => calculateQuote(tariffs, quoteInput({ pierces: 1.5 })), 'Число прожигов')
  })

  it('неизвестный материал', () => {
    expectInputError(() => calculateQuote(tariffs, quoteInput({ materialId: 'alu' })), 'Материала «alu» нет')
  })

  it('габарит детали ≥ 0, ручная цена металла ≥ 0', () => {
    expectInputError(
      () => calculateQuote(tariffs, quoteInput({ customerMetal: false, bbox: { width: -10, height: 50 } })),
      'Ширина габарита',
    )
    expectInputError(
      () => calculateQuote(tariffs, quoteInput({ customerMetal: false, bbox: { width: 100, height: -5 } })),
      'Высота габарита',
    )
    expectInputError(
      () => calculateQuote(tariffs, quoteInput({ customerMetal: false, metalPriceRubPerKg: -1 })),
      'Цена металла',
    )
  })
})
