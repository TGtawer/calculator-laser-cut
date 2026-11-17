import { warningMessage } from '../dxf/messages.ts'
import { formatDecimal, formatRub, plural } from '../format.ts'
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

export const INCOMPLETE_NOTE = 'Итог неполный: часть позиций — по запросу. Их стоимость сообщит менеджер.'

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

/** Толщина листа: «3 мм», «0,5 мм». */
export const thicknessText = (t: number): string => `${formatDecimal(t, 2)} мм`

function line(label: string, base: string, rate: string | null, kopecks: Kopecks | null, onRequestNote: string): QuoteLine {
  return kopecks === null || rate === null
    ? { label, detail: base, amount: ON_REQUEST, onRequest: true, note: onRequestNote }
    : { label, detail: `${base} × ${rate}`, amount: formatRub(kopecks), onRequest: false, note: null }
}

/** Статьи расчёта на одну деталь. */
export function quoteLines(quote: Quote, bendingTariffs: BendingTariffs): QuoteLine[] {
  const { cutting, bending } = quote
  const thickness = thicknessText(cutting.thicknessMm)
  const lines = [
    line(
      'Резка',
      mm(cutting.cutLengthMm),
      cutting.cutRateKopecks === null ? null : `${formatRub(cutting.cutRateKopecks)}/м`,
      cutting.cutPerPartKopecks,
      `Цена резки листа ${thickness} — по запросу`,
    ),
    line(
      'Прожиги',
      String(cutting.pierces),
      cutting.pierceRateKopecks === null ? null : formatRub(cutting.pierceRateKopecks),
      cutting.piercePerPartKopecks,
      `Цена прожига для листа ${thickness} — по запросу`,
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
        `Толщина «${bending.band.label}», длина гиба ${mm(bending.bendLengthMm)} — «${bending.range.label}», ` +
        `тираж ${total} на заказ — «${bending.bracket.label}»`
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
    `Длина реза детали: ${mm(cutting.cutLengthMm)}, прожигов: ${cutting.pierces}`,
    '',
  ]
  for (const item of quoteLines(quote, bendingTariffs)) {
    out.push(item.onRequest ? `${item.label}: ${item.detail} — ${ON_REQUEST}` : `${item.label}: ${item.detail} = ${item.amount}`)
    if (item.note) out.push(`  ${item.note}`)
  }
  out.push(`За деталь: ${formatRub(quote.pricePerPartKopecks)}`)
  out.push(`Итого за ${quantity} шт.: ${formatRub(quote.totalKopecks)}`)
  if (!quote.complete) out.push(INCOMPLETE_NOTE)
  if (analysis.warnings.length > 0) {
    out.push('', 'Замечания к чертежу:')
    for (const code of analysis.warnings) out.push(`— ${warningMessage(code, analysis.duplicatesRemoved)}`)
  }
  out.push('', DISCLAIMER)
  return out.join('\n')
}
