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
import { PricingInputError, rubToKopecks } from '../../src/core/pricing/common.ts'
import { cuttingCost, cuttingThicknesses } from '../../src/core/pricing/cutting.ts'
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
    expect(q.complete).toBe(true)
  })

  it('пример 2: 02_slot_lwpolyline_bulge.dxf, 5 мм, 4 шт — итого 441,08 ₽', () => {
    const a = analyzeFixture('02_slot_lwpolyline_bulge.dxf')
    expect(a.cutLengthMm / 1000).toBeCloseTo(0.388496, 6)
    expect(a.pierces).toBe(2)

    const q = calculateQuote(tariffs, quoteInput({ thicknessMm: 5, quantity: 4, cutLengthMm: a.cutLengthMm, pierces: a.pierces }))
    expect(q.cutting.cutPerPartKopecks).toBe(5827) // 0.388496 × 150 = 58,27 ₽
    expect(q.cutting.piercePerPartKopecks).toBe(5200) // 2 × 26 = 52,00 ₽
    expect(q.pricePerPartKopecks).toBe(11027)
    expect(q.totalKopecks).toBe(44108)
    expect(q.complete).toBe(true)
  })

  it('пример 3: только гибка t = 3, Lb = 800, B = 2, N = 10 — 55 ₽/гиб, итого 1 100,00 ₽', () => {
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
  })

  it('пример 5: границы диапазонов', () => {
    // TODO(Q-4): 2,5 мм — в «3–4».
    expect(findThicknessBand(tariffs.bending, 2.5)?.id).toBe('t3')
    // TODO(Q-6): 500 — «до 500».
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
    const c = cuttingCost(material, { thicknessMm: 16, cutLengthMm: 1000, pierces: 2 })
    expect(c.cutRateKopecks).toBe(57800)
    expect(c.pierceRateKopecks).toBe(6000)
    expect(c.cutPerPartKopecks).toBe(57800)
    expect(c.piercePerPartKopecks).toBe(12000)
  })

  it('TODO(Q-1): значения со звёздочкой не участвуют в расчёте', () => {
    const c = cuttingCost(material, { thicknessMm: 10, cutLengthMm: 1000, pierces: 1 })
    expect(c.cutRateKopecks).toBe(30000)
    expect(c.pierceRateKopecks).toBe(3300)
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
  })
})

describe('гибка', () => {
  it('TODO(Q-5): тираж — по всем гибам заказа: 3 гиба × 20 шт = 60 → q2', () => {
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
})
