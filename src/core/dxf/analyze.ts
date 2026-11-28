import type { Contour, DxfAnalysis, DxfError, WarningCode } from '../types.ts'
import { DXF_CONFIG } from './config.ts'
import { buildContours, nestingDepths, removeDuplicateShapes } from './contours.ts'
import { emptyBbox, mergeBbox } from './geometry.ts'
import { type ParsedDrawing, parseDxf } from './parse.ts'

export type AnalyzeOptions = {
  /** Слои, отключённые пользователем: их объекты не режутся (ТЗ 3.3). */
  disabledLayers?: Iterable<string>
}

/**
 * Анализ разобранного чертежа: контуры, длина реза, прожиги, габарит, предупреждения (ТЗ 3.5).
 * Разбор файла (parseDxf) - отдельно, чтобы при переключении слоёв не читать файл заново.
 */
export function analyzeDxf(drawing: ParsedDrawing, options: AnalyzeOptions = {}): DxfAnalysis {
  const disabled = new Set(options.disabledLayers ?? [])
  const { shapes, removed } = removeDuplicateShapes(drawing.shapes.filter((s) => !disabled.has(s.layer)))
  const drafts = buildContours(shapes, DXF_CONFIG.joinToleranceMm)
  const depths = nestingDepths(drafts)

  const contours: Contour[] = drafts.map((d, i) => ({
    points: d.points,
    closed: d.closed,
    isOuter: depths[i] === 0,
    lengthMm: d.lengthMm,
  }))
  const closedContours = contours.filter((c) => c.closed).length
  const openContours = contours.length - closedContours
  const outerContours = contours.filter((c) => c.isOuter).length
  const cutLengthMm = contours.reduce((sum, c) => sum + c.lengthMm, 0)

  const box = emptyBbox()
  for (const d of drafts) mergeBbox(box, d.bbox)
  const bbox =
    drafts.length > 0
      ? { minX: box.minX, minY: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY }
      : { minX: 0, minY: 0, width: 0, height: 0 }

  const warnings: WarningCode[] = []
  if (drawing.unitsAssumed) warnings.push('UNITS_ASSUMED_MM')
  const size = Math.max(bbox.width, bbox.height)
  if (drafts.length > 0 && (size < DXF_CONFIG.minPlausibleSizeMm || size > DXF_CONFIG.maxPlausibleSizeMm)) {
    warnings.push('SUSPICIOUS_SIZE')
  }
  if (openContours > 0) warnings.push('OPEN_CONTOUR')
  if (removed > 0) warnings.push('DUPLICATES_REMOVED')

  return {
    cutLengthMm,
    closedContours,
    openContours,
    // ТЗ 3.4: число прожигов = замкнутые контуры + незамкнутые.
    pierces: closedContours + openContours,
    outerContours,
    bbox,
    layers: drawing.layers,
    contours,
    warnings,
    duplicatesRemoved: removed,
  }
}

/** Разбор и анализ текста DXF за один вызов. */
export function analyzeDxfText(
  text: string,
  options: AnalyzeOptions = {},
): { ok: true; drawing: ParsedDrawing; analysis: DxfAnalysis } | { ok: false; error: DxfError } {
  const parsed = parseDxf(text)
  if (!parsed.ok) return parsed
  return { ok: true, drawing: parsed.drawing, analysis: analyzeDxf(parsed.drawing, options) }
}
