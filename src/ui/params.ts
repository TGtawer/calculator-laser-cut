import { findCuttingRow } from '../core/pricing/cutting.ts'
import { KG_PER_TONNE } from '../core/pricing/metal.ts'
import type { QuoteInput } from '../core/pricing/quote.ts'
import type { Tariffs } from '../core/pricing/tariffs.ts'

/** Значения полей формы как их ввёл пользователь: строки, чтобы не терять ввод при ошибке. */
export type FormValues = {
  materialId: string
  /** '' — толщина не выбрана. */
  thickness: string
  quantity: string
  /** Металл заказчика: не считать стоимость металла. */
  customerMetal: boolean
  /** Цена металла, ₽/т; '' — взять из тарифов (или «по запросу», если в тарифах null). */
  metalPrice: string
  bendingEnabled: boolean
  bendsPerPart: string
  bendLength: string
}

export type FieldName = 'thickness' | 'quantity' | 'metalPrice' | 'bendsPerPart' | 'bendLength'

export type FormCheck = {
  /** Параметры расчёта без данных чертежа; null — форма заполнена не до конца. */
  input: Omit<QuoteInput, 'cutLengthMm' | 'pierces' | 'bbox'> | null
  /** Ошибки введённых значений — показываются у полей. */
  errors: Partial<Record<FieldName, string>>
  /** Чего не хватает для расчёта — показывается в блоке «Расчёт». */
  missing: string[]
}

export const initialForm = (tariffs: Tariffs): FormValues => ({
  materialId: tariffs.materials[0]?.id ?? '',
  thickness: '',
  quantity: '1',
  customerMetal: false,
  metalPrice: '',
  bendingEnabled: false,
  bendsPerPart: '1',
  bendLength: '',
})

/** Целое число ≥ 1 из поля ввода; null — не целое или меньше 1. */
export function parseCount(raw: string): number | null {
  const s = raw.trim()
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) && n >= 1 ? n : null
}

/** Положительное число из поля ввода, допускается десятичная запятая; null — не число или ≤ 0. */
export function parsePositive(raw: string): number | null {
  const s = raw.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Цена в рублях > 0 с точностью до копейки. Допускаются пробелы между разрядами и десятичная запятая. */
export function parsePrice(raw: string): number | null {
  const s = raw.trim().replace(',', '.')
  if (!/^(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(\.\d{1,2})?$/.test(s)) return null
  const n = Number(s.replace(/[ \u00a0\u202f]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

const COUNT_ERROR = 'Введите целое число от 1'

/** Проверяет форму и собирает параметры расчёта. */
export function checkForm(form: FormValues, tariffs: Tariffs): FormCheck {
  const errors: FormCheck['errors'] = {}
  const missing: string[] = []

  const material = tariffs.materials.find((m) => m.id === form.materialId)
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

  if (!material || thickness === null || errors.thickness || quantity === null || !metalPriceOk || !bendingOk) {
    return { input: null, errors, missing }
  }
  return {
    input: { materialId: material.id, thicknessMm: thickness, quantity, customerMetal, metalPriceRubPerKg, bending },
    errors,
    missing,
  }
}
