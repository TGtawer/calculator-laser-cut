import { warningMessage } from '../dxf/messages.ts'
import { formatDecimal, formatRub, formatRubWhole, plural } from '../format.ts'
import type { DxfAnalysis } from '../types.ts'
import { bendingOnRequestMessage } from './bending.ts'
import type { Kopecks } from './common.ts'
import type { Quote } from './quote.ts'
import type { BendingTariffs } from './tariffs.ts'

/*
 * Разбивка расчёта для показа: одни и те же строки выводятся на странице
 * и в тексте «Скопировать расчёт», чтобы они не расходились.
 */

/** Подпись под расчётом (ТЗ 2, п. 7). */
export const DISCLAIMER = 'Расчёт ориентировочный. Окончательную стоимость подтвердит менеджер после проверки чертежа.'

export const ON_REQUEST = 'по запросу'

export const INCOMPLETE_NOTE = 'Итог неполный: часть позиций - по запросу. Их стоимость сообщит менеджер.'

/** Предупреждение, если полный итог ниже минимальной суммы заказа (Q-8). */
export const minimumOrderMessage = (minimumKopecks: Kopecks): string =>
  `Сумма заказа ниже минимальной - ${formatRubWhole(minimumKopecks)}. Менеджер уточнит условия.`

const BENDS = ['гиб', 'гиба', 'гибов'] as const

export type QuoteLine = {
  label: string
  /** Как получена сумма: «362,8 мм × 113,00 ₽/м». */
  detail: string
  /** «41,00 ₽» или «по запросу». */
  amount: string
  onRequest: boolean
  /** Пояснение: выбранные диапазоны гибки или причина «по запросу». */
  note: string | null
}

const mm = (n: number): string => `${formatDecimal(n, 1)} мм`
const kg = (n: number): string => `${formatDecimal(n, 2)} кг`

/** Толщина листа: «3 мм», «0,5 мм». */
export const thicknessText = (t: number): string => `${formatDecimal(t, 2)} мм`

const blankAreaFormat = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
export const blankAreaText = (areaM2: number): string => `${blankAreaFormat.format(areaM2)} м²`

/** Площадь одного изделия и всего тиража для экрана и копируемого расчёта. */
export function blankAreaLines({ blankAreaM2, quantity }: Pick<Quote, 'blankAreaM2' | 'quantity'>) {
  const lines = [
    {
      label: 'Площадь заготовки на изделие',
      detail: 'По габариту с учётом технологического отступа',
      value: blankAreaText(blankAreaM2),
    },
  ]
  if (quantity > 1) {
    lines.push({
      label: 'Площадь заготовок на весь заказ',
      detail: 'Площадь на изделие × количество',
      value: blankAreaText(blankAreaM2 * quantity),
    })
  }
  return lines
}

function line(
  label: string,
  base: string,
  rate: string | null,
  kopecks: Kopecks | null,
  onRequestNote: string,
  rateSeparator = '×',
): QuoteLine {
  return kopecks === null || rate === null
    ? { label, detail: base, amount: ON_REQUEST, onRequest: true, note: onRequestNote }
    : { label, detail: `${base} ${rateSeparator} ${rate}`, amount: formatRub(kopecks), onRequest: false, note: null }
}

/** Статьи расчёта на одну деталь. */
export function quoteLines(quote: Quote, bendingTariffs: BendingTariffs): QuoteLine[] {
  const { cutting, bending, metal } = quote
  const thickness = thicknessText(cutting.thicknessMm)
  const lines = [
    line(
      'Резка',
      mm(cutting.cutLengthMm),
      cutting.cutRateKopecks === null ? null : `${formatRub(cutting.cutRateKopecks)}/м`,
      cutting.cutPerPartKopecks,
      `Цена резки листа ${thickness} - по запросу`,
    ),
    line(
      'Прожиги',
      String(cutting.pierces),
      cutting.pierceRateKopecks === null ? null : formatRub(cutting.pierceRateKopecks),
      cutting.piercePerPartKopecks,
      `Цена прожига для листа ${thickness} - по запросу`,
    ),
  ]
  if (bending) {
    const bends = `${bending.bendsPerPart} ${plural(bending.bendsPerPart, BENDS)}`
    const item = line(
      'Гибка',
      bending.pricePerBendKopecks === null ? bends : String(bending.bendsPerPart),
      bending.pricePerBendKopecks === null ? null : formatRub(bending.pricePerBendKopecks),
      bending.perPartKopecks,
      bending.onRequest ? bendingOnRequestMessage(bending.onRequest, bendingTariffs) : '',
    )
    if (!item.onRequest && bending.band && bending.range && bending.bracket) {
      const total = `${bending.totalBends} ${plural(bending.totalBends, BENDS)}`
      item.note =
        `Толщина «${bending.band.label}», длина гиба ${mm(bending.bendLengthMm)} - «${bending.range.label}», ` +
        `тираж ${total} на заказ - «${bending.bracket.label}»`
    }
    lines.push(item)
  }
  if (quote.material.workSurchargePercent > 0) {
    lines.push({
      label: 'Надбавка за работы',
      detail: `${quote.material.workSurchargePercent} % от рассчитанных работ`,
      amount: formatRub(quote.workSurchargeKopecks),
      onRequest: false,
      note: null,
    })
  }
  if (metal) {
    const dims = `${formatDecimal(metal.sheetWidthMm, 1)} × ${mm(metal.sheetHeightMm)}`
    const sheet = metal.marginMm > 0 ? `Габарит с отступом ${dims}` : `Габарит ${dims}`
    const item = line(
      'Металл',
      kg(metal.massKg),
      metal.rateKopecksPerTonne === null ? null : `${formatRub(metal.rateKopecksPerTonne)}/т`,
      metal.perPartKopecks,
      `Цена металла для листа ${thickness} - по запросу (${sheet.toLowerCase()})`,
      'по',
    )
    if (!item.onRequest) {
      item.note = `${sheet}, лист ${thickness}`
    }
    lines.push(item)
  }
  return lines
}

export type QuoteTextInput = {
  quote: Quote
  bendingTariffs: BendingTariffs
  fileName: string
  analysis: Pick<DxfAnalysis, 'bbox' | 'warnings' | 'duplicatesRemoved'>
}

/** Текст для кнопки «Скопировать расчёт»: для мессенджера или почты. */
export function quoteText({ quote, bendingTariffs, fileName, analysis }: QuoteTextInput): string {
  const { cutting, quantity } = quote
  const out = [
    'Расчёт лазерной резки и гибки',
    `Чертёж: ${fileName}`,
    `Материал: ${quote.material.name}, ${thicknessText(cutting.thicknessMm)}`,
    `Количество: ${quantity} шт.`,
    `Габарит детали: ${formatDecimal(analysis.bbox.width, 1)} × ${mm(analysis.bbox.height)}`,
    ...blankAreaLines(quote).map(({ label, value }) => `${label}: ${value}`),
    `Длина реза детали: ${mm(cutting.cutLengthMm)}, прожигов: ${cutting.pierces}`,
    '',
  ]
  for (const item of quoteLines(quote, bendingTariffs)) {
    out.push(item.onRequest ? `${item.label}: ${item.detail} - ${ON_REQUEST}` : `${item.label}: ${item.detail} = ${item.amount}`)
    if (item.note) out.push(`  ${item.note}`)
  }
  if (quote.customerMetal) out.push('Металл: заказчика')
  out.push(`За деталь: ${formatRub(quote.pricePerPartKopecks)}`)
  out.push(`Итого за ${quantity} шт.: ${formatRubWhole(quote.totalRoundedKopecks)}`)
  if (quote.belowMinimum && quote.minimumOrderKopecks !== null) {
    out.push(minimumOrderMessage(quote.minimumOrderKopecks))
  }
  if (!quote.complete) out.push(INCOMPLETE_NOTE)
  if (analysis.warnings.length > 0) {
    out.push('', 'Замечания к чертежу:')
    for (const code of analysis.warnings) out.push(`- ${warningMessage(code, analysis.duplicatesRemoved)}`)
  }
  out.push('', DISCLAIMER)
  return out.join('\n')
}
