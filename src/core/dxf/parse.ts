import DxfParser from 'dxf-parser'
import type { DxfError, Point } from '../types.ts'
import { DXF_CONFIG } from './config.ts'
import {
  type Affine,
  EPS,
  type Segment,
  type Shape,
  TAU,
  type Vec3,
  bulgeArc,
  circleArc,
  compose,
  crossXY,
  distance,
  normalize3,
  normalizeSweep,
  ocsToWcs,
  rotation,
  scaling,
  transformSegment,
  translation,
} from './geometry.ts'
import { CircleHandler, EllipseHandler, SplineHandler } from './handlers.ts'
import { dxfError } from './messages.ts'
import { isValidSpline } from './spline.ts'

/** Перевод единиц чертежа в мм по $INSUNITS (ТЗ 3.2). 0 или отсутствие - мм с предупреждением. */
const INSUNITS_TO_MM: Readonly<Record<number, number>> = { 1: 25.4, 4: 1, 5: 10, 6: 1000 }

export type ParsedDrawing = {
  /** Геометрия в мм: блоки развёрнуты, текст, размеры, штриховки и т.п. отброшены. */
  shapes: Shape[]
  /** Слои с геометрией в порядке появления в файле. */
  layers: string[]
  /** $INSUNITS не задан - размеры считаются в мм (UNITS_ASSUMED_MM). */
  unitsAssumed: boolean
}

export type ParseResult = { ok: true; drawing: ParsedDrawing } | { ok: false; error: DxfError }

/** Проверка файла до чтения: расширение и размер (ТЗ 3.1). */
export function checkDxfFile(file: { name: string; size: number }): DxfError | null {
  if (!/\.dxf$/i.test(file.name)) return dxfError('UNSUPPORTED_FORMAT')
  if (file.size > DXF_CONFIG.maxFileSizeBytes) return dxfError('FILE_TOO_LARGE')
  return null
}

/** Разбор текста DXF в геометрию в мм. */
export function parseDxf(text: string): ParseResult {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  // Бинарный DXF начинается с сигнатуры, DWG - с версии формата (AC1015 и т.п.).
  const head = source.slice(0, 32)
  if (head.startsWith('AutoCAD Binary DXF') || /^AC1\d{3}/.test(head)) {
    return { ok: false, error: dxfError('UNSUPPORTED_FORMAT') }
  }

  let raw
  try {
    const parser = new DxfParser()
    parser.registerEntityHandler(CircleHandler)
    parser.registerEntityHandler(EllipseHandler)
    parser.registerEntityHandler(SplineHandler)
    raw = parser.parseSync(source)
  } catch {
    return { ok: false, error: dxfError('PARSE_FAILED') }
  }
  if (!raw || !Array.isArray(raw.entities)) return { ok: false, error: dxfError('PARSE_FAILED') }

  const insunits = raw.header?.['$INSUNITS']
  const unitsAssumed = insunits === undefined || insunits === 0
  const unitScale = unitsAssumed ? 1 : typeof insunits === 'number' ? INSUNITS_TO_MM[insunits] : undefined
  if (unitScale === undefined) return { ok: false, error: dxfError('UNSUPPORTED_UNITS') }

  const collector = new ShapeCollector(asRecord(raw.blocks) ?? {})
  for (const entity of raw.entities) {
    const e = asRecord(entity)
    // Объекты пространства листа (layout) не относятся к детали.
    if (e && e['inPaperSpace'] !== true) collector.collect(e, scaling(unitScale), undefined, 0, [])
  }
  const shapes = collector.shapes
  if (shapes.length === 0) return { ok: false, error: dxfError('NO_GEOMETRY') }

  return { ok: true, drawing: { shapes, layers: [...new Set(shapes.map((s) => s.layer))], unitsAssumed } }
}

// ---------- Чтение полей: данные из файла не доверенные ----------

type Rec = Record<string, unknown>

const asRecord = (v: unknown): Rec | null => (v !== null && typeof v === 'object' ? (v as Rec) : null)

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

function point3(v: unknown): Vec3 | null {
  const r = asRecord(v)
  if (!r || typeof r['x'] !== 'number' || typeof r['y'] !== 'number') return null
  if (!Number.isFinite(r['x']) || !Number.isFinite(r['y'])) return null
  return { x: r['x'], y: r['y'], z: num(r['z']) }
}

const xy = (p: Vec3): Point => ({ x: p.x, y: p.y })

/** Нормаль из группы point или из полей extrusionDirectionX/Y/Z (так её отдают ARC и LWPOLYLINE). */
function normalOf(e: Rec, key: string): Vec3 {
  const p = point3(e[key])
  if (p) return p
  return {
    x: num(e['extrusionDirectionX']),
    y: num(e['extrusionDirectionY']),
    z: num(e['extrusionDirectionZ'], 1),
  }
}

/** Сегменты полилинии по вершинам с bulge; нулевые звенья пропускаются. */
function polylineSegments(vertices: readonly { p: Point; bulge: number }[], closed: boolean): Segment[] {
  const segments: Segment[] = []
  const count = closed ? vertices.length : vertices.length - 1
  for (let i = 0; i < count; i++) {
    const from = vertices[i]!
    const to = vertices[(i + 1) % vertices.length]!
    if (distance(from.p, to.p) < EPS) continue
    segments.push(
      Math.abs(from.bulge) > 1e-12 ? bulgeArc(from.p, to.p, from.bulge) : { kind: 'line', a: from.p, b: to.p },
    )
  }
  return segments
}

function polylineVertices(raw: unknown[]): { p: Point; bulge: number }[] {
  const vertices: { p: Point; bulge: number }[] = []
  for (const v of raw) {
    const p = point3(v)
    if (p) vertices.push({ p: xy(p), bulge: num(asRecord(v)?.['bulge']) })
  }
  return vertices
}

// ---------- Обход объектов с разворотом блоков ----------

class ShapeCollector {
  readonly shapes: Shape[] = []
  private readonly blocks: Rec

  constructor(blocks: Rec) {
    this.blocks = blocks
  }

  /**
   * Добавляет геометрию объекта. m - преобразование в мм мировых координат,
   * parentLayer - слой вставки блока: объекты блока на слое «0» наследуют его.
   */
  collect(e: Rec, m: Affine, parentLayer: string | undefined, depth: number, stack: string[]): void {
    const ownLayer = typeof e['layer'] === 'string' && e['layer'] !== '' ? e['layer'] : '0'
    const layer = ownLayer === '0' && parentLayer !== undefined ? parentLayer : ownLayer
    const add = (segments: Segment[], closed: boolean, local?: Affine): void => {
      if (segments.length === 0) return
      const t = local ? compose(m, local) : m
      this.shapes.push({ layer, closed, segments: segments.map((s) => transformSegment(s, t)) })
    }

    switch (e['type']) {
      case 'LINE': {
        const [a, b] = list(e['vertices']).map(point3)
        if (a && b && distance(a, b) >= EPS) add([{ kind: 'line', a: xy(a), b: xy(b) }], false)
        return
      }

      case 'CIRCLE': {
        const c = point3(e['center'])
        const r = num(e['radius'])
        if (c && r > EPS) add([circleArc(xy(c), r)], true, ocsToWcs(normalOf(e, 'extrusion'), c.z))
        return
      }

      case 'ARC': {
        const c = point3(e['center'])
        const r = num(e['radius'])
        if (!c || !(r > EPS)) return
        // dxf-parser уже перевёл углы в радианы. Дуга идёт против часовой стрелки.
        const start = num(e['startAngle'])
        const sweep = normalizeSweep(start, num(e['endAngle']))
        add([circleArc(xy(c), r, start, start + sweep)], false, ocsToWcs(normalOf(e, 'extrusionDirection'), c.z))
        return
      }

      case 'LWPOLYLINE': {
        const closed = e['shape'] === true
        const segments = polylineSegments(polylineVertices(list(e['vertices'])), closed)
        add(segments, closed, ocsToWcs(normalOf(e, 'extrusionDirection'), num(e['elevation'])))
        return
      }

      case 'POLYLINE': {
        // Только 2D-полилинии (ТЗ 3.3): 3D-полилинии и сети пропускаются.
        if (e['is3dPolyline'] === true || e['is3dPolygonMesh'] === true || e['isPolyfaceMesh'] === true) return
        // У сглаженной сплайном полилинии вершины-контрольные точки не лежат на кривой.
        const vertices = list(e['vertices']).filter((v) => asRecord(v)?.['splineControlPoint'] !== true)
        const closed = e['shape'] === true
        add(polylineSegments(polylineVertices(vertices), closed), closed, ocsToWcs(normalOf(e, 'extrusionDirection')))
        return
      }

      case 'ELLIPSE': {
        const c = point3(e['center'])
        const major = point3(e['majorAxis'])
        const ratio = num(e['axisRatio'], 1)
        const normal = normalize3(normalOf(e, 'extrusion'))
        if (!c || !major || Math.hypot(major.x, major.y) < EPS || !(ratio > 0) || !normal) return
        // Центр и большая полуось - в мировых координатах; малая полуось = (N × большая) · ratio.
        const start = num(e['startParam'])
        const sweep = normalizeSweep(start, num(e['endParam'], TAU))
        const minor = crossXY(normal, major)
        add(
          [{ kind: 'arc', c: xy(c), u: xy(major), v: { x: minor.x * ratio, y: minor.y * ratio }, t0: start, t1: start + sweep }],
          sweep >= TAU - 1e-9,
        )
        return
      }

      case 'SPLINE': {
        const closed = e['closed'] === true
        const control = list(e['controlPoints']).map(point3).filter((p) => p !== null).map(xy)
        const fit = list(e['fitPoints']).map(point3).filter((p) => p !== null).map(xy)
        const knots = list(e['knots']).map((k) => num(k, NaN))
        const weights = list(e['weights']).map((w) => num(w, NaN))
        const degree = num(e['degree'])
        if (control.length >= 2 && isValidSpline(degree, control.length, knots)) {
          const rational = weights.length === control.length && weights.every((w) => w > 0) && weights.some((w) => w !== 1)
          add([{ kind: 'spline', degree, controlPoints: control, knots, weights: rational ? weights : null }], closed)
          return
        }
        // Нет корректных узлов: ломаная по точкам на кривой (ТЗ 3.3), а если их нет - по контрольным.
        const points = fit.length >= 2 ? fit : control
        if (points.length < 2) return
        if (closed && distance(points[0]!, points[points.length - 1]!) >= EPS) points.push(points[0]!)
        add([{ kind: 'polyline', points }], closed)
        return
      }

      case 'INSERT':
        this.collectInsert(e, m, layer, depth, stack)
        return

      // Остальное (TEXT, MTEXT, DIMENSION, HATCH, POINT, LEADER, VIEWPORT, …) не режется.
    }
  }

  /** Разворот блока: смещение, масштаб, поворот, массив MINSERT; вложенные блоки - рекурсивно. */
  private collectInsert(e: Rec, m: Affine, layer: string, depth: number, stack: string[]): void {
    const name = typeof e['name'] === 'string' ? e['name'] : ''
    const block = asRecord(this.blocks[name])
    if (!block || depth >= DXF_CONFIG.maxBlockDepth || stack.includes(name)) return

    const position = point3(e['position']) ?? { x: 0, y: 0, z: 0 }
    const base = point3(block['position']) ?? { x: 0, y: 0, z: 0 }
    const sx = num(e['xScale'], 1)
    const sy = num(e['yScale'], 1)
    const angle = (num(e['rotation']) * Math.PI) / 180
    const columns = Math.max(1, Math.trunc(num(e['columnCount'], 1)))
    const rows = Math.max(1, Math.trunc(num(e['rowCount'], 1)))
    if (columns * rows > DXF_CONFIG.maxInsertCopies) return
    const columnSpacing = num(e['columnSpacing'])
    const rowSpacing = num(e['rowSpacing'])
    const ocs = ocsToWcs(normalOf(e, 'extrusionDirection'), position.z)

    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        // Точка блока: − базовая точка → масштаб → шаг массива → поворот → позиция вставки → OCS.
        const local = compose(
          ocs,
          translation(position.x, position.y),
          rotation(angle),
          translation(column * columnSpacing, row * rowSpacing),
          scaling(sx, sy),
          translation(-base.x, -base.y),
        )
        const transform = compose(m, local)
        for (const child of list(block['entities'])) {
          const c = asRecord(child)
          if (c) this.collect(c, transform, layer, depth + 1, [...stack, name])
        }
      }
    }
  }
}
