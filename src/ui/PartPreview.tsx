import { useMemo } from 'react'
import { warningMessage } from '../core/dxf/messages.ts'
import { formatDecimal } from '../core/format.ts'
import type { Contour, DxfAnalysis } from '../core/types.ts'

type Props = {
  analysis: DxfAnalysis
  disabledLayers: ReadonlySet<string>
  onToggleLayer: (layer: string) => void
}

/**
 * SVG-путь контуров. Ось Y в DXF направлена вверх, в SVG - вниз, поэтому y меняет знак.
 * Координаты округляются до ~1/4000 габарита: на экране не видно, а путь короче в разы.
 */
function pathData(contours: readonly Contour[], scale: number): string {
  const r = (v: number): number => Math.round(v * scale) / scale
  const parts: string[] = []
  for (const c of contours) {
    if (c.points.length === 0) continue
    const [first, ...rest] = c.points
    parts.push(`M${r(first!.x)} ${r(-first!.y)}`)
    for (const p of rest) parts.push(`L${r(p.x)} ${r(-p.y)}`)
    if (c.closed) parts.push('Z')
  }
  return parts.join('')
}

const mm = (n: number): string => `${formatDecimal(n, 1)} мм`

/** Превью детали, слои с чекбоксами, сводка и предупреждения (ТЗ 2, п. 3). */
export function PartPreview({ analysis, disabledLayers, onToggleLayer }: Props) {
  const { bbox, contours } = analysis

  const svg = useMemo(() => {
    const size = Math.max(bbox.width, bbox.height)
    const pad = size * 0.04 || 1
    const scale = size > 0 ? 10 ** Math.ceil(Math.log10(4000 / size)) : 1
    const path = (list: readonly Contour[]): string => pathData(list, scale)
    const closed = contours.filter((c) => c.closed)
    return {
      viewBox: [bbox.minX - pad, -(bbox.minY + bbox.height) - pad, bbox.width + 2 * pad, bbox.height + 2 * pad].join(' '),
      // Заливка всех замкнутых контуров по правилу evenodd: отверстия остаются пустыми.
      fill: path(closed),
      outer: path(closed.filter((c) => c.isOuter)),
      holes: path(closed.filter((c) => !c.isOuter)),
      open: path(contours.filter((c) => !c.closed)),
    }
  }, [bbox, contours])

  const empty = contours.length === 0
  const hasOuter = svg.outer !== ''
  const hasHoles = svg.holes !== ''
  const hasOpen = svg.open !== ''

  return (
    <div className="preview">
      <div className="preview__canvas">
        {empty ? (
          <p className="preview__empty">Все слои с контурами отключены – включите нужные слои ниже</p>
        ) : (
          <svg viewBox={svg.viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Превью детали">
            <path className="shape shape--fill" d={svg.fill} fillRule="evenodd" />
            {hasOuter && <path className="shape shape--outer" d={svg.outer} />}
            {hasHoles && <path className="shape shape--hole" d={svg.holes} />}
            {hasOpen && <path className="shape shape--open" d={svg.open} />}
          </svg>
        )}
      </div>

      {!empty && (
        <ul className="legend" aria-label="Обозначения">
          {hasOuter && (
            <li>
              <span className="legend__swatch legend__swatch--outer" /> внешний контур
            </li>
          )}
          {hasHoles && (
            <li>
              <span className="legend__swatch legend__swatch--hole" /> отверстия
            </li>
          )}
          {hasOpen && (
            <li>
              <span className="legend__swatch legend__swatch--open" /> незамкнутые
            </li>
          )}
        </ul>
      )}

      <dl className="stats">
        <div>
          <dt>Габарит</dt>
          <dd>
            {formatDecimal(bbox.width, 1)} × {mm(bbox.height)}
          </dd>
        </div>
        <div>
          <dt>Длина реза</dt>
          <dd>{mm(analysis.cutLengthMm)}</dd>
        </div>
        <div>
          <dt>Прожигов</dt>
          <dd>{analysis.pierces}</dd>
        </div>
      </dl>

      {analysis.warnings.length > 0 && (
        <ul className="alert alert--warn warnings">
          {analysis.warnings.map((code) => (
            <li key={code}>{warningMessage(code, analysis.duplicatesRemoved)}</li>
          ))}
        </ul>
      )}

      <fieldset className="layers">
        <legend>Слои чертежа</legend>
        <p className="layers__hint">Снимите галочку, если слой не нужно резать (размеры, разметка)</p>
        <div className="layers__list">
          {analysis.layers.map((layer) => (
            <label key={layer} className="check">
              <input type="checkbox" checked={!disabledLayers.has(layer)} onChange={() => onToggleLayer(layer)} />
              <span>{layer}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  )
}
