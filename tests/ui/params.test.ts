import { describe, expect, it } from 'vitest'
import tariffsJson from '../../data/tariffs.json'
import { calculateQuote } from '../../src/core/pricing/quote.ts'
import { parseTariffs } from '../../src/core/pricing/tariffs.ts'
import { type FormValues, checkForm, initialForm, parseCount, parsePositive, parsePrice } from '../../src/ui/params.ts'

const tariffs = parseTariffs(tariffsJson)
const form = (over: Partial<FormValues>): FormValues => ({ ...initialForm(tariffs), thickness: '3', ...over })

describe('поля ввода', () => {
  it('количество и число гибов — целое ≥ 1', () => {
    expect(parseCount('10')).toBe(10)
    expect(parseCount(' 7 ')).toBe(7)
    for (const raw of ['', '0', '-1', '1.5', '1,5', '1e3', 'abc']) expect(parseCount(raw)).toBeNull()
  })

  it('длина гиба — число > 0, запятая как десятичный разделитель', () => {
    expect(parsePositive('500')).toBe(500)
    expect(parsePositive('500,5')).toBe(500.5)
    expect(parsePositive('0.5')).toBe(0.5)
    for (const raw of ['', '0', '-5', 'abc', '1e3', '5,']) expect(parsePositive(raw)).toBeNull()
  })

  it('цена металла — число > 0 с точностью до копеек', () => {
    expect(parsePrice('120000')).toBe(120000)
    expect(parsePrice('120 000,5')).toBe(120000.5)
    expect(parsePrice('120\u00a0000.55')).toBe(120000.55)
    expect(parsePrice(' 95\u202f000,00 ')).toBe(95000)
    for (const raw of ['', '0', '-10', '120000,123', '120 00', 'abc', '1e2', '10,']) expect(parsePrice(raw)).toBeNull()
  })
})

describe('проверка формы', () => {
  it('по умолчанию толщина не выбрана — расчёта нет, подсказка в блоке «Расчёт»', () => {
    const check = checkForm(initialForm(tariffs), tariffs)
    expect(check.input).toBeNull()
    expect(check.missing).toEqual(['Выберите толщину листа'])
    expect(check.errors).toEqual({})
  })

  it('заполненная форма без гибки и с пустой ценой металла (по запросу)', () => {
    expect(checkForm(form({ quantity: '10' }), tariffs).input).toEqual({
      materialId: 'steel_carbon',
      thicknessMm: 3,
      quantity: 10,
      customerMetal: false,
      metalPriceRubPerKg: null,
      bending: null,
    })
  })

  it('цена металла за тонну переводится в цену за килограмм для расчёта', () => {
    const ok = checkForm(form({ metalPrice: '120 000,50' }), tariffs)
    expect(ok.errors).toEqual({})
    expect(ok.input?.metalPriceRubPerKg).toBe(120.0005)
  })

  it('невалидная цена металла за тонну даёт ошибку', () => {
    const bad = checkForm(form({ metalPrice: '-5' }), tariffs)
    expect(bad.input).toBeNull()
    expect(bad.errors.metalPrice).toBe('Введите цену за тонну больше нуля (до копеек)')

    const tooPrecise = checkForm(form({ metalPrice: '120000,125' }), tariffs)
    expect(tooPrecise.input).toBeNull()
    expect(tooPrecise.errors.metalPrice).toBeDefined()
  })

  it('в расчёте сохраняются копейки за тонну', () => {
    const t = structuredClone(tariffs)
    t.order.marginMm = 0
    const { input } = checkForm(form({ metalPrice: '120 000,99' }), t)
    expect(input).not.toBeNull()
    const quote = calculateQuote(t, { ...input!, cutLengthMm: 4000, pierces: 1, bbox: { width: 1000, height: 1000 } })
    expect(quote.metal?.rateKopecksPerTonne).toBe(12000099)
    expect(quote.metal?.perPartKopecks).toBe(282602) // 23,55 кг × 120 000,99 ₽/т ÷ 1000
  })

  it('металл заказчика: поле цены металла не проверяется', () => {
    const check = checkForm(form({ customerMetal: true, metalPrice: 'abc' }), tariffs)
    expect(check.errors).toEqual({})
    expect(check.input?.customerMetal).toBe(true)
    expect(check.input?.metalPriceRubPerKg).toBeNull()
  })

  it('если учёт металла выключен в тарифах, поля металла игнорируются', () => {
    const t = structuredClone(tariffs)
    t.order.includeMaterialCost = false
    const check = checkForm(form({ customerMetal: true, metalPrice: 'abc' }), t)
    expect(check.errors).toEqual({})
    expect(check.input?.customerMetal).toBe(false)
    expect(check.input?.metalPriceRubPerKg).toBeNull()
  })

  it('толщины нет в тарифах — ошибка поля', () => {
    const check = checkForm(form({ thickness: '7' }), tariffs)
    expect(check.input).toBeNull()
    expect(check.errors.thickness).toBeDefined()
  })

  it('неверное количество — ошибка у поля, пустое — подсказка', () => {
    expect(checkForm(form({ quantity: '0' }), tariffs).errors.quantity).toBe('Введите целое число от 1')
    const empty = checkForm(form({ quantity: '' }), tariffs)
    expect(empty.errors).toEqual({})
    expect(empty.missing).toEqual(['Укажите количество деталей'])
  })

  it('гибка: нужна длина гиба; с ней — параметры гибки в расчёте', () => {
    const noLength = checkForm(form({ bendingEnabled: true }), tariffs)
    expect(noLength.input).toBeNull()
    expect(noLength.missing).toEqual(['Укажите длину гиба'])

    const ok = checkForm(form({ bendingEnabled: true, bendsPerPart: '2', bendLength: '800' }), tariffs)
    expect(ok.input?.bending).toEqual({ bendsPerPart: 2, bendLengthMm: 800 })

    const bad = checkForm(form({ bendingEnabled: true, bendsPerPart: '0', bendLength: '-1' }), tariffs)
    expect(bad.input).toBeNull()
    expect(Object.keys(bad.errors).sort()).toEqual(['bendLength', 'bendsPerPart'])
  })

  it('гибка выключена — её поля не проверяются', () => {
    const check = checkForm(form({ bendingEnabled: false, bendsPerPart: 'x', bendLength: '' }), tariffs)
    expect(check.input?.bending).toBeNull()
    expect(check.errors).toEqual({})
  })
})
