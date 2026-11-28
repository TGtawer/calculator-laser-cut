/*
 * Форматирование для показа пользователю (ТЗ 6): ru-RU, разделитель тысяч - пробел,
 * десятичный - запятая. Разделители - неразрывные пробелы, как их выдаёт Intl.
 * Только Intl из стандарта языка: работает и в браузере, и на сервере.
 */

const rubFormat = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const rubWholeFormat = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
})

const decimalFormats = new Map<number, Intl.NumberFormat>()

/** Сумма в копейках → «1 040,00 ₽». */
export const formatRub = (kopecks: number): string => rubFormat.format(kopecks / 100)

/** Сумма в копейках → «442 ₽» без копеек. Для уже округлённых до рубля значений. */
export const formatRubWhole = (kopecks: number): string => rubWholeFormat.format(kopecks / 100)

/** Число с запятой и не больше maxFractionDigits знаков после неё: 362,8318 → «362,83». */
export function formatDecimal(n: number, maxFractionDigits = 2): string {
  let format = decimalFormats.get(maxFractionDigits)
  if (!format) {
    format = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: maxFractionDigits })
    decimalFormats.set(maxFractionDigits, format)
  }
  return format.format(n)
}

const pluralRules = new Intl.PluralRules('ru-RU')

/** Форма слова для числа: plural(2, ['гиб', 'гиба', 'гибов']) → «гиба». */
export function plural(n: number, [one, few, many]: readonly [string, string, string]): string {
  switch (pluralRules.select(n)) {
    case 'one':
      return one
    case 'few':
      return few
    default:
      return many
  }
}
