import { formatDecimal } from '../core/format.ts'
import { findCuttingRow } from '../core/pricing/cutting.ts'
import { KG_PER_TONNE } from '../core/pricing/metal.ts'
import type { QuoteInput } from '../core/pricing/quote.ts'
import { type Tariffs, materialOptions } from '../core/pricing/tariffs.ts'

/** Значения полей формы как их ввёл пользователь: строки, чтобы не терять ввод при ошибке. */
export type FormValues = {
  materialId: string
  /** '' - толщина не выбрана. */
  thickness: string
  quantity: string
  /** Металл заказчика: не считать стоимость металла. */
  customerMetal: boolean
  /** Цена металла, ₽/т; '' - взять из тарифов (или «по запросу», если в тарифах null). */
  metalPrice: string
  sheetWidth: string
  sheetLength: string
  bendingEnabled: boolean
  bendsPerPart: string
  bendLength: string
}

export type FieldName = 'thickness' | 'quantity' | 'metalPrice' | 'sheetWidth' | 'sheetLength' | 'bendsPerPart' | 'bendLength'

export type FormCheck = {
  /** Параметры расчёта без данных чертежа; null - форма заполнена не до конца. */
  input: Omit<QuoteInput, 'cutLengthMm' | 'pierces' | 'bbox'> | null
  /** Ошибки введённых значений - показываются у полей. */
  errors: Partial<Record<FieldName, string>>
  /** Чего не хватает для расчёта - показывается в блоке «Расчёт». */
  missing: string[]
}

export const initialForm = (tariffs: Tariffs): FormValues => ({
  materialId: tariffs.materials[0]?.id ?? '',
  thickness: '',
  quantity: '1',
  customerMetal: false,
  metalPrice: '',
  sheetWidth: tariffs.order.sheetLayout ? formatDecimal(tariffs.order.sheetLayout.widthMm, 20) : '',
  sheetLength: tariffs.order.sheetLayout ? formatDecimal(tariffs.order.sheetLayout.heightMm, 20) : '',
  bendingEnabled: false,
  bendsPerPart: '1',
  bendLength: '',
})

const groupSpaces = /[ \u00a0\u202f]/g
const groupedInteger = String.raw`(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)`
const countPattern = new RegExp(`^${groupedInteger}$`)
const positivePattern = new RegExp(String.raw`^${groupedInteger}(\.\d+)?$`)
const pricePattern = new RegExp(String.raw`^${groupedInteger}(\.\d{1,2})?$`)

/** Добавляет пробелы в целую часть и сохраняет положение курсора относительно цифр. */
export function formatNumberInput(raw: string, caret: number): { value: string; caret: number } {
  const text = raw.trim()
  if (text === '') return { value: '', caret: 0 }
  const match = /^((?:от\s+)?)(\d(?:[ \u00a0\u202f]*\d)*)((?:[.,]\d*)?(?:\s*₽\s*\/\s*т)?)$/i.exec(text)
  if (!match) return { value: raw, caret }

  const [, prefix = '', integer = '', tail = ''] = match
  const trimmedCaret = Math.min(text.length, Math.max(0, caret - (raw.length - raw.trimStart().length)))
  const digits = integer.replace(groupSpaces, '')
  const firstGroupLength = digits.length % 3 || 3
  const groups = digits.slice(firstGroupLength).match(/\d{3}/g) ?? []
  const grouped = [digits.slice(0, firstGroupLength), ...groups].join(' ')
  const value = prefix + grouped + tail
  if (trimmedCaret <= prefix.length || grouped === integer) return { value, caret: trimmedCaret }
  if (trimmedCaret >= prefix.length + integer.length) {
    return { value, caret: trimmedCaret + grouped.length - integer.length }
  }

  const offset = trimmedCaret - prefix.length
  const digitsBefore = integer.slice(0, offset).replace(groupSpaces, '').length
  const spacesBefore = Math.max(0, Math.ceil((digitsBefore - firstGroupLength) / 3))
  const position = digitsBefore + spacesBefore
  const afterSpace = grouped[position] === ' ' && /\D/.test(integer.charAt(offset - 1))
  return { value, caret: prefix.length + position + Number(afterSpace) }
}

/** Целое число ≥ 1 из поля ввода; null - не целое или меньше 1. */
export function parseCount(raw: string): number | null {
  const s = raw.trim()
  if (!countPattern.test(s)) return null
  const n = Number(s.replace(groupSpaces, ''))
  return Number.isSafeInteger(n) && n >= 1 ? n : null
}

/** Положительное число из поля ввода, допускается десятичная запятая; null - не число или ≤ 0. */
export function parsePositive(raw: string): number | null {
  const s = raw.trim().replace(',', '.')
  if (!positivePattern.test(s)) return null
  const n = Number(s.replace(groupSpaces, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Цена в рублях за тонну с точностью до копейки, в том числе «от 77 100 ₽/т» из карточки товара. */
export function parsePrice(raw: string): number | null {
  const s = raw.trim().replace(/^от\s+/i, '').replace(/\s*₽\s*\/\s*т$/i, '').replace(',', '.')
  if (!pricePattern.test(s)) return null
  const n = Number(s.replace(groupSpaces, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

const COUNT_ERROR = 'Введите целое число от 1'

/** Проверяет форму и собирает параметры расчёта. */
export function checkForm(form: FormValues, tariffs: Tariffs): FormCheck {
  const errors: FormCheck['errors'] = {}
  const missing: string[] = []

  const material = materialOptions(tariffs).find((option) => option.id === form.materialId)
  const thickness = form.thickness === '' ? null : Number(form.thickness)
  if (thickness === null) missing.push('Выберите толщину листа')
  else if (!material || !findCuttingRow(material, thickness)) errors.thickness = 'Выберите толщину из списка'

  const quantity = parseCount(form.quantity)
  if (form.quantity.trim() === '') missing.push('Укажите количество деталей')
  else if (quantity === null) errors.quantity = COUNT_ERROR

  const customerMetal = tariffs.order.includeMaterialCost ? form.customerMetal : false
  let metalPriceRubPerKg: number | null = null
  let metalPriceOk = true
  if (tariffs.order.includeMaterialCost && !customerMetal && form.metalPrice.trim() !== '') {
    const metalPriceRubPerTonne = parsePrice(form.metalPrice)
    if (metalPriceRubPerTonne === null) {
      errors.metalPrice = 'Введите цену за тонну больше нуля (до копеек)'
      metalPriceOk = false
    } else {
      metalPriceRubPerKg = metalPriceRubPerTonne / KG_PER_TONNE
    }
  }

  let bending: QuoteInput['bending'] = null
  let bendingOk = true
  if (form.bendingEnabled) {
    const bendsPerPart = parseCount(form.bendsPerPart)
    const bendLengthMm = parsePositive(form.bendLength)
    if (form.bendsPerPart.trim() === '') missing.push('Укажите число гибов на деталь')
    else if (bendsPerPart === null) errors.bendsPerPart = COUNT_ERROR
    if (form.bendLength.trim() === '') missing.push('Укажите длину гиба')
    else if (bendLengthMm === null) errors.bendLength = 'Введите длину в мм больше нуля'
    if (bendsPerPart !== null && bendLengthMm !== null) bending = { bendsPerPart, bendLengthMm }
    else bendingOk = false
  }

  let sheetSize: QuoteInput['sheetSize']
  if (tariffs.order.sheetLayout) {
    const widthMm = parsePositive(form.sheetWidth)
    const heightMm = parsePositive(form.sheetLength)
    if (widthMm === null) errors.sheetWidth = 'Введите ширину больше нуля'
    if (heightMm === null) errors.sheetLength = 'Введите длину больше нуля'
    sheetSize = widthMm !== null && heightMm !== null ? { widthMm, heightMm } : null
  }

  if (!material || thickness === null || errors.thickness || quantity === null || !metalPriceOk || !bendingOk) {
    return { input: null, errors, missing }
  }
  return {
    input: { materialId: material.id, thicknessMm: thickness, quantity, customerMetal, metalPriceRubPerKg, bending, sheetSize },
    errors,
    missing,
  }
}
