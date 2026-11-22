import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import tariffsJson from '../../data/tariffs.json'
import { analyzeDxfText } from '../../src/core/dxf/analyze.ts'
import { formatDecimal, formatRub, formatRubWhole, plural } from '../../src/core/format.ts'
import { type QuoteInput, calculateQuote } from '../../src/core/pricing/quote.ts'
import { DISCLAIMER, INCOMPLETE_NOTE, minimumOrderMessage, quoteLines, quoteText } from '../../src/core/pricing/summary.ts'
import { parseTariffs } from '../../src/core/pricing/tariffs.ts'

const tariffs = parseTariffs(tariffsJson)
const tariffsNoMetal = structuredClone(tariffs)
tariffsNoMetal.order.includeMaterialCost = false
/** Intl ставит неразрывные пробелы; в тестах сравниваем с обычными. */
const plain = (s: string): string => s.replace(/[  ]/g, ' ')

const quote = (over: Partial<QuoteInput>, customTariffs = tariffsNoMetal) =>
  calculateQuote(customTariffs, {
    materialId: customTariffs.materials[0]!.id,
    thicknessMm: 3,
    quantity: 10,
    cutLengthMm: 362.832,
    pierces: 3,
    bbox: { width: 100, height: 50 },
    customerMetal: false,
    metalPriceRubPerKg: null,
    bending: null,
    ...over,
  })

describe('форматирование (ТЗ 6)', () => {
  it('рубли: пробел между тысячами, запятая, ₽', () => {
    expect(plain(formatRub(104000))).toBe('1 040,00 ₽')
    expect(plain(formatRub(44108))).toBe('441,08 ₽')
    expect(plain(formatRub(5))).toBe('0,05 ₽')
    expect(plain(formatRub(123456789))).toBe('1 234 567,89 ₽')
  })

  it('целые рубли — без копеек', () => {
    expect(plain(formatRubWhole(104000))).toBe('1 040 ₽')
    expect(plain(formatRubWhole(44200))).toBe('442 ₽')
    expect(plain(formatRubWhole(500000))).toBe('5 000 ₽')
  })

  it('числа', () => {
    expect(formatDecimal(0.5)).toBe('0,5')
    expect(formatDecimal(362.8318, 1)).toBe('362,8')
    expect(formatDecimal(3)).toBe('3')
  })

  it('склонение', () => {
    const forms = ['гиб', 'гиба', 'гибов'] as const
    expect([1, 2, 5, 11, 21, 22, 25, 101].map((n) => plural(n, forms))).toEqual([
      'гиб', 'гиба', 'гибов', 'гибов', 'гиб', 'гиба', 'гибов', 'гиб',
    ])
  })
})

describe('разбивка расчёта', () => {
  it('резка и прожиги — с ценами из тарифа', () => {
    const lines = quoteLines(quote({}), tariffs.bending).map((l) => ({ ...l, detail: plain(l.detail), amount: plain(l.amount) }))
    expect(lines).toEqual([
      { label: 'Резка', detail: '362,8 мм × 113,00 ₽/м', amount: '41,00 ₽', onRequest: false, note: null },
      { label: 'Прожиги', detail: '3 × 21,00 ₽', amount: '63,00 ₽', onRequest: false, note: null },
    ])
  })

  it('гибка — с выбранными диапазонами', () => {
    const [, , bend] = quoteLines(quote({ bending: { bendsPerPart: 2, bendLengthMm: 800 } }), tariffs.bending)
    expect(plain(bend!.detail)).toBe('2 × 55,00 ₽')
    expect(plain(bend!.amount)).toBe('110,00 ₽')
    expect(bend!.note).toBe('Толщина «3–4 мм», длина гиба 800 мм — «от 500 до 1500 мм», тираж 20 гибов на заказ — «до 50 гибов»')
  })

  it('гибка «по запросу» — с причиной', () => {
    const [, , bend] = quoteLines(quote({ thicknessMm: 10, bending: { bendsPerPart: 1, bendLengthMm: 800 } }), tariffs.bending)
    expect(bend).toEqual({
      label: 'Гибка',
      detail: '1 гиб',
      amount: 'по запросу',
      onRequest: true,
      note: 'Гибка листа толще 8 мм — по запросу',
    })
  })
})

describe('текст «Скопировать расчёт»', () => {
  it('пример 1 целиком', () => {
    const result = analyzeDxfText(readFileSync(new URL('../fixtures/01_plate_rect_2holes.dxf', import.meta.url), 'utf8'))
    if (!result.ok) throw new Error(result.error.message)
    const { analysis } = result
    const q = quote({ cutLengthMm: analysis.cutLengthMm, pierces: analysis.pierces })
    const text = plain(quoteText({ quote: q, bendingTariffs: tariffs.bending, fileName: 'plate.dxf', analysis }))
    expect(text).toBe(
      [
        'Расчёт лазерной резки и гибки',
        'Чертёж: plate.dxf',
        'Материал: Сталь горячекатаная и холоднокатаная, 3 мм',
        'Количество: 10 шт.',
        'Габарит детали: 100 × 50 мм',
        'Длина реза детали: 362,8 мм, прожигов: 3',
        '',
        'Резка: 362,8 мм × 113,00 ₽/м = 41,00 ₽',
        'Прожиги: 3 × 21,00 ₽ = 63,00 ₽',
        'За деталь: 104,00 ₽',
        'Итого за 10 шт.: 1 040 ₽',
        plain(minimumOrderMessage(500000)),
        '',
        DISCLAIMER,
      ].join('\n'),
    )
  })

  it('неполный итог и замечания к чертежу', () => {
    const q = quote({ thicknessMm: 8, bending: { bendsPerPart: 2, bendLengthMm: 2000 } })
    const text = plain(
      quoteText({
        quote: q,
        bendingTariffs: tariffs.bending,
        fileName: 'part.dxf',
        analysis: { bbox: { minX: 0, minY: 0, width: 50, height: 30 }, warnings: ['OPEN_CONTOUR', 'DUPLICATES_REMOVED'], duplicatesRemoved: 2 },
      }),
    )
    expect(text).toContain('Гибка: 2 гиба — по запросу\n  Для этой толщины и длины гиба цены в прайсе нет — по запросу')
    expect(text).toContain(`Итого за 10 шт.: 1 746 ₽\n${INCOMPLETE_NOTE}`)
    expect(text).toContain(
      'Замечания к чертежу:\n— В чертеже есть незамкнутые контуры — проверьте файл\n— Удалены совпадающие дубли элементов: 2',
    )
    expect(text.endsWith(DISCLAIMER)).toBe(true)
  })

  it('итог ниже минимума — предупреждение в тексте', () => {
    const q = quote({ quantity: 1, cutLengthMm: 100, pierces: 0 })
    const text = plain(
      quoteText({
        quote: q,
        bendingTariffs: tariffs.bending,
        fileName: 'part.dxf',
        analysis: { bbox: { minX: 0, minY: 0, width: 50, height: 30 }, warnings: [], duplicatesRemoved: 0 },
      }),
    )
    expect(text).toContain(`Итого за 1 шт.: 12 ₽\n${plain(minimumOrderMessage(500000))}`)
  })

  it('итог выше минимума — предупреждения нет', () => {
    const q = quote({ quantity: 50, cutLengthMm: 1000, pierces: 2 })
    const text = plain(
      quoteText({
        quote: q,
        bendingTariffs: tariffs.bending,
        fileName: 'part.dxf',
        analysis: { bbox: { minX: 0, minY: 0, width: 50, height: 30 }, warnings: [], duplicatesRemoved: 0 },
      }),
    )
    expect(text).toContain('Итого за 50 шт.: 7 750 ₽')
    expect(text).not.toContain('ниже минимальной')
  })
})

describe('металл в разбивке и тексте (Q-11)', () => {
  it('строка «Металл» с отступом и введённой ценой', () => {
    const q = quote({ metalPriceRubPerKg: 120 }, tariffs)
    const lines = quoteLines(q, tariffs.bending).map((l) => ({ ...l, detail: plain(l.detail), amount: plain(l.amount) }))
    expect(lines.at(-1)).toEqual({
      label: 'Металл',
      detail: '0,16 кг × 120,00 ₽/кг',
      amount: '18,65 ₽',
      onRequest: false,
      note: 'Габарит с отступом 110 × 60 мм, лист 3 мм',
    })

    const text = plain(
      quoteText({
        quote: q,
        bendingTariffs: tariffs.bending,
        fileName: 'plate.dxf',
        analysis: { bbox: { minX: 0, minY: 0, width: 100, height: 50 }, warnings: [], duplicatesRemoved: 0 },
      }),
    )
    expect(text).toContain('Металл: 0,16 кг × 120,00 ₽/кг = 18,65 ₽\n  Габарит с отступом 110 × 60 мм, лист 3 мм')
    expect(text).toContain('За деталь: 122,65 ₽\nИтого за 10 шт.: 1 227 ₽')
  })

  it('строка «Металл» без отступа (marginMm = 0)', () => {
    const t = structuredClone(tariffs)
    t.order.marginMm = 0
    const q = quote({ metalPriceRubPerKg: 120 }, t)
    const lines = quoteLines(q, t.bending).map((l) => ({ ...l, detail: plain(l.detail), amount: plain(l.amount) }))
    expect(lines.at(-1)).toEqual({
      label: 'Металл',
      detail: '0,12 кг × 120,00 ₽/кг',
      amount: '14,13 ₽',
      onRequest: false,
      note: 'Габарит 100 × 50 мм, лист 3 мм',
    })
  })

  it('цена металла не задана — «по запросу» и неполный итог', () => {
    const q = quote({ metalPriceRubPerKg: null }, tariffs)
    const lines = quoteLines(q, tariffs.bending).map((l) => ({ ...l, detail: plain(l.detail), amount: plain(l.amount) }))
    expect(lines.at(-1)).toEqual({
      label: 'Металл',
      detail: '0,16 кг',
      amount: 'по запросу',
      onRequest: true,
      note: 'Цена металла для листа 3 мм — по запросу (габарит с отступом 110 × 60 мм)',
    })

    const text = plain(
      quoteText({
        quote: q,
        bendingTariffs: tariffs.bending,
        fileName: 'plate.dxf',
        analysis: { bbox: { minX: 0, minY: 0, width: 100, height: 50 }, warnings: [], duplicatesRemoved: 0 },
      }),
    )
    expect(text).toContain('Металл: 0,16 кг — по запросу')
    expect(text).toContain(INCOMPLETE_NOTE)
    expect(text).not.toContain('ниже минимальной')
  })

  it('металл заказчика: строки «Металл» нет в таблице, в тексте «Металл: заказчика»', () => {
    const q = quote({ customerMetal: true, metalPriceRubPerKg: 120 }, tariffs)
    const lines = quoteLines(q, tariffs.bending)
    expect(lines.map((l) => l.label)).toEqual(['Резка', 'Прожиги'])

    const text = plain(
      quoteText({
        quote: q,
        bendingTariffs: tariffs.bending,
        fileName: 'plate.dxf',
        analysis: { bbox: { minX: 0, minY: 0, width: 100, height: 50 }, warnings: [], duplicatesRemoved: 0 },
      }),
    )
    expect(text).toContain('Прожиги: 3 × 21,00 ₽ = 63,00 ₽\nМеталл: заказчика\nЗа деталь: 104,00 ₽')
  })
})
