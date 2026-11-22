import { describe, expect, it } from 'vitest'
import tariffsJson from '../../data/tariffs.json'
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
    expect(parsePrice('120')).toBe(120)
    expect(parsePrice('120,5')).toBe(120.5)
    expect(parsePrice('120.55')).toBe(120.55)
    expect(parsePrice(' 95,00 ')).toBe(95)
    for (const raw of ['', '0', '-10', '120,123', 'abc', '1e2', '10,']) expect(parsePrice(raw)).toBeNull()
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

  it('цена металла: валидная попадает в расчёт, невалидная даёт ошибку', () => {
    const ok = checkForm(form({ metalPrice: '120,5' }), tariffs)
    expect(ok.errors).toEqual({})
    expect(ok.input?.metalPriceRubPerKg).toBe(120.5)

    const bad = checkForm(form({ metalPrice: '-5' }), tariffs)
    expect(bad.input).toBeNull()
    expect(bad.errors.metalPrice).toBeDefined()

    const tooPrecise = checkForm(form({ metalPrice: '120,125' }), tariffs)
    expect(tooPrecise.input).toBeNull()
    expect(tooPrecise.errors.metalPrice).toBeDefined()
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
