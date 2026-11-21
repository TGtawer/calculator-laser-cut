import { formatDecimal } from '../format.ts'

/** Деньги внутри расчёта — целые копейки (ТЗ 5). В рубли переводятся только при отображении. */
export type Kopecks = number

/** Цена из тарифов (рубли с точностью до копейки) → копейки. */
export const rubToKopecks = (rub: number): Kopecks => Math.round(rub * 100)

/** Округление вверх до целого рубля: 44 108 коп. → 44 200 коп. (442 ₽). */
export const roundUpToRuble = (kopecks: Kopecks): Kopecks => Math.ceil(kopecks / 100) * 100

/**
 * Неверные входные данные расчёта: толщины нет в тарифах, количество не целое и т.п.
 * Интерфейс проверяет ввод сам, поэтому в браузере эта ошибка означает ошибку в коде.
 * На сервере она защищает от подделанной заявки.
 */
export class PricingInputError extends Error {
  override name = 'PricingInputError'
}

/** Число для сообщения: как в интерфейсе, но без потери знаков после запятой. */
export const formatNumber = (n: number): string => formatDecimal(n, 6)

/** Целое число не меньше min, иначе PricingInputError. */
export function requireInteger(value: number, min: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new PricingInputError(`${what}: ожидается целое число не меньше ${min}, получено ${formatNumber(value)}`)
  }
}

/** Конечное неотрицательное (или положительное) число, иначе PricingInputError. */
export function requireNumber(value: number, what: string, options: { positive: boolean }): void {
  const ok = Number.isFinite(value) && (options.positive ? value > 0 : value >= 0)
  if (!ok) {
    const expected = options.positive ? 'больше нуля' : 'не меньше нуля'
    throw new PricingInputError(`${what}: ожидается число ${expected}, получено ${formatNumber(value)}`)
  }
}
