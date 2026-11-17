import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import tariffsJson from '../../data/tariffs.json'
import { analyzeDxfText } from '../../src/core/dxf/analyze.ts'
import { formatDecimal, formatRub, plural } from '../../src/core/format.ts'
import { type QuoteInput, calculateQuote } from '../../src/core/pricing/quote.ts'
import { DISCLAIMER, INCOMPLETE_NOTE, quoteLines, quoteText } from '../../src/core/pricing/summary.ts'
import { parseTariffs } from '../../src/core/pricing/tariffs.ts'

const tariffs = parseTariffs(tariffsJson)
/** Intl ставит неразрывные пробелы; в тестах сравниваем с обычными. */
const plain = (s: string): string => s.replace(/[  ]/g, ' ')

const quote = (over: Partial<QuoteInput>) =>
  calculateQuote(tariffs, {
    materialId: tariffs.materials[0]!.id,
    thicknessMm: 3,
    quantity: 10,
    cutLengthMm: 362.832,
    pierces: 3,
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
        'Итого за 10 шт.: 1 040,00 ₽',
        '',
        DISCLAIMER,
      ].join('\n'),
    )
  })

  it('неполный итог и замечания к чертежу', () => {
    const q = quote({ bending: { bendsPerPart: 2, bendLengthMm: 300 } })
    const text = plain(
      quoteText({
        quote: q,
        bendingTariffs: tariffs.bending,
        fileName: 'part.dxf',
        analysis: { bbox: { minX: 0, minY: 0, width: 50, height: 30 }, warnings: ['OPEN_CONTOUR', 'DUPLICATES_REMOVED'], duplicatesRemoved: 2 },
      }),
    )
    expect(text).toContain('Гибка: 2 гиба — по запросу\n  Для этой толщины и длины гиба цены в прайсе нет — по запросу')
    expect(text).toContain(`Итого за 10 шт.: 1 040,00 ₽\n${INCOMPLETE_NOTE}`)
    expect(text).toContain(
      'Замечания к чертежу:\n— В чертеже есть незамкнутые контуры — проверьте файл\n— Удалены совпадающие дубли элементов: 2',
    )
    expect(text.endsWith(DISCLAIMER)).toBe(true)
  })
})
