import { useEffect, useState } from 'react'
import { formatRub, formatRubWhole } from '../core/format.ts'
import type { Quote } from '../core/pricing/quote.ts'
import { INCOMPLETE_NOTE, type QuoteLine, blankAreaLines, minimumOrderMessage } from '../core/pricing/summary.ts'

type Props =
  /** Расчёта пока нет: что нужно сделать. */
  | { quote: null; todo: string[] }
  | { quote: Quote; lines: QuoteLine[]; copyText: string }

/**
 * Копирование в буфер. Clipboard API работает только по https и с разрешения браузера;
 * иначе (файл с диска, локальная сеть, запрет) - через выделение текста.
 */
async function copyToClipboard(text: string): Promise<void> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Пробуем старый способ ниже.
    }
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  const ok = document.execCommand('copy')
  area.remove()
  if (!ok) throw new Error('copy failed')
}

type CopyState = 'idle' | 'done' | 'failed'

function CopyButton({ text }: { text: string }) {
  // Статус относится к тексту, который копировали: расчёт изменился - статус сбрасывается сам.
  const [result, setResult] = useState<{ text: string; state: CopyState }>({ text, state: 'idle' })
  const state = result.text === text ? result.state : 'idle'

  useEffect(() => {
    if (state !== 'done') return
    const timer = setTimeout(() => setResult({ text, state: 'idle' }), 2500)
    return () => clearTimeout(timer)
  }, [state, text])

  const copy = () => {
    copyToClipboard(text).then(
      () => setResult({ text, state: 'done' }),
      () => setResult({ text, state: 'failed' }),
    )
  }

  return (
    <div className="copy">
      <button type="button" className="button button--wide" onClick={copy}>
        {state === 'done' ? 'Скопировано ✓' : 'Скопировать расчёт'}
      </button>
      {state === 'failed' && (
        <>
          <p className="field__hint">Не удалось скопировать автоматически - выделите текст и скопируйте вручную:</p>
          <textarea className="input copy__text" readOnly value={text} rows={12} onFocus={(e) => e.currentTarget.select()} />
        </>
      )}
    </div>
  )
}

/** Расчёт с разбивкой по статьям (ТЗ 2, п. 5–6). */
export function QuoteResult(props: Props) {
  if (props.quote === null) {
    return (
      <ul className="todo">
        {props.todo.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    )
  }

  const { quote, lines, copyText } = props
  return (
    <div className="quote">
      <table className="quote__table">
        <tbody>
          {blankAreaLines(quote).map(({ label, detail, value }) => (
            <tr key={label}>
              <th scope="row">
                {label}
                <span className="quote__detail">{detail}</span>
              </th>
              <td className="quote__amount">{value}</td>
            </tr>
          ))}
          {lines.map((line) => (
            <tr key={line.label}>
              <th scope="row">
                {line.label}
                <span className="quote__detail">{line.detail}</span>
                {line.note && <span className="quote__note">{line.note}</span>}
              </th>
              <td className={line.onRequest ? 'quote__amount quote__amount--request' : 'quote__amount'}>{line.amount}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">За деталь</th>
            <td className="quote__amount">{formatRub(quote.pricePerPartKopecks)}</td>
          </tr>
        </tfoot>
      </table>

      <div className="quote__total" aria-live="polite">
        <span>
          Итого за {quote.quantity} шт.
          {!quote.complete && <span className="badge">неполный</span>}
        </span>
        <strong>{formatRubWhole(quote.totalRoundedKopecks)}</strong>
      </div>
      {quote.belowMinimum && quote.minimumOrderKopecks !== null && (
        <p className="alert alert--warn">{minimumOrderMessage(quote.minimumOrderKopecks)}</p>
      )}
      {!quote.complete && <p className="alert alert--warn">{INCOMPLETE_NOTE}</p>}

      <CopyButton text={copyText} />
    </div>
  )
}
