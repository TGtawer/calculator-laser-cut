import { useMemo, useRef, useState } from 'react'
import { tariffs } from './appTariffs.ts'
import { analyzeDxf } from './core/dxf/analyze.ts'
import { dxfError } from './core/dxf/messages.ts'
import { type ParsedDrawing, checkDxfFile, parseDxf } from './core/dxf/parse.ts'
import { calculateQuote } from './core/pricing/quote.ts'
import { DISCLAIMER, quoteLines, quoteText } from './core/pricing/summary.ts'
import { DxfUpload } from './ui/DxfUpload.tsx'
import { ParamsForm } from './ui/ParamsForm.tsx'
import { PartPreview } from './ui/PartPreview.tsx'
import { QuoteResult } from './ui/QuoteResult.tsx'
import { checkForm, initialForm } from './ui/params.ts'
import { readDxfText } from './ui/readDxfFile.ts'

type Loaded = { fileName: string; drawing: ParsedDrawing }

/** Дать браузеру отрисовать «Читаем чертёж…» перед синхронным разбором. */
const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))

export default function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [busy, setBusy] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [disabledLayers, setDisabledLayers] = useState<ReadonlySet<string>>(new Set())
  const [form, setForm] = useState(() => initialForm(tariffs))
  // Номер последней загрузки: результат более раннего файла, дочитанного позже, отбрасывается.
  const loadId = useRef(0)

  const handleFile = async (file: File) => {
    const id = ++loadId.current
    const precheck = checkDxfFile(file)
    if (precheck) {
      setFileError(precheck.message)
      return
    }
    setBusy(true)
    setFileError(null)
    try {
      const text = await readDxfText(file)
      await nextFrame()
      const parsed = parseDxf(text)
      if (id !== loadId.current) return
      if (parsed.ok) {
        setLoaded({ fileName: file.name, drawing: parsed.drawing })
        setDisabledLayers(new Set())
      } else {
        setLoaded(null)
        setFileError(parsed.error.message)
      }
    } catch {
      if (id === loadId.current) {
        setLoaded(null)
        setFileError(dxfError('PARSE_FAILED').message)
      }
    } finally {
      if (id === loadId.current) setBusy(false)
    }
  }

  const toggleLayer = (layer: string) =>
    setDisabledLayers((prev) => {
      const next = new Set(prev)
      if (!next.delete(layer)) next.add(layer)
      return next
    })

  const analysis = useMemo(() => loaded && analyzeDxf(loaded.drawing, { disabledLayers }), [loaded, disabledLayers])
  const formCheck = useMemo(() => checkForm(form, tariffs), [form])

  const result = useMemo(() => {
    const todo: string[] = []
    if (!analysis) todo.push('Загрузите чертёж детали в формате DXF')
    else if (analysis.contours.length === 0) todo.push('Включите хотя бы один слой с контурами детали')
    todo.push(...formCheck.missing)
    if (Object.keys(formCheck.errors).length > 0) todo.push('Исправьте отмеченные поля')
    if (!analysis || !loaded || analysis.contours.length === 0 || !formCheck.input) return { quote: null, todo } as const

    const quote = calculateQuote(tariffs, {
      ...formCheck.input,
      cutLengthMm: analysis.cutLengthMm,
      pierces: analysis.pierces,
    })
    return {
      quote,
      lines: quoteLines(quote, tariffs.bending),
      copyText: quoteText({ quote, bendingTariffs: tariffs.bending, fileName: loaded.fileName, analysis }),
    }
  }, [analysis, formCheck, loaded])

  return (
    <>
      <header className="header">
        <div className="header__inner">
          <h1>Калькулятор лазерной резки и гибки</h1>
          <p>Загрузите чертёж, выберите толщину и количество — стоимость посчитается сразу</p>
        </div>
      </header>

      <main className="layout">
        <section className="card card--drawing" aria-labelledby="drawing-title">
          <h2 id="drawing-title" className="card__title">
            <span className="step">1</span>Чертёж
          </h2>
          <DxfUpload onFile={handleFile} busy={busy} fileName={loaded?.fileName ?? null} error={fileError} />
          {analysis && !busy && (
            <PartPreview analysis={analysis} disabledLayers={disabledLayers} onToggleLayer={toggleLayer} />
          )}
        </section>

        <div className="side">
          <section className="card" aria-labelledby="params-title">
            <h2 id="params-title" className="card__title">
              <span className="step">2</span>Параметры
            </h2>
            <ParamsForm tariffs={tariffs} value={form} errors={formCheck.errors} onChange={setForm} />
          </section>

          <section className="card card--quote" aria-labelledby="quote-title">
            <h2 id="quote-title" className="card__title">
              <span className="step">3</span>Расчёт
            </h2>
            <QuoteResult {...result} />
          </section>
        </div>
      </main>

      <footer className="footer">
        <p className="disclaimer">{DISCLAIMER}</p>
        <p className="footer__meta">Тарифы от {tariffs.updatedAt.split('-').reverse().join('.')}</p>
      </footer>
    </>
  )
}
