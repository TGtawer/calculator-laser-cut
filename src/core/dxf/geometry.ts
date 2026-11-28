import type { Point } from '../types.ts'

export const TAU = 2 * Math.PI

/** Длины короче этой считаются нулевыми, мм. */
export const EPS = 1e-9

/** Отрезок прямой от a до b. */
export type LineSegment = { kind: 'line'; a: Point; b: Point }

/**
 * Дуга окружности или эллипса: P(t) = c + u·cos t + v·sin t, t от t0 до t1 (t0 < t1, t1 − t0 ≤ 2π).
 * У окружности радиуса r векторы u и v перпендикулярны и |u| = |v| = r.
 * Форма сохраняется при повороте, масштабе и зеркале, поэтому так же хранятся
 * эллипсы и дуги из блоков, растянутых по одной оси (они становятся эллиптическими).
 */
export type ArcSegment = { kind: 'arc'; c: Point; u: Point; v: Point; t0: number; t1: number }

/** NURBS-кривая (SPLINE). weights = null - все веса равны 1. */
export type SplineSegment = {
  kind: 'spline'
  degree: number
  controlPoints: Point[]
  knots: number[]
  weights: number[] | null
}

/** Ломаная по точкам: SPLINE, заданный только точками на кривой (fit points). */
export type PolylineSegment = { kind: 'polyline'; points: Point[] }

export type Segment = LineSegment | ArcSegment | SplineSegment | PolylineSegment

/** Геометрия одного объекта чертежа в мм, после разворота блоков. */
export type Shape = { layer: string; closed: boolean; segments: Segment[] }

export type Bbox = { minX: number; minY: number; maxX: number; maxY: number }

export type Vec3 = { x: number; y: number; z: number }

// ---------- Векторы ----------

export const add = (p: Point, q: Point): Point => ({ x: p.x + q.x, y: p.y + q.y })
export const sub = (p: Point, q: Point): Point => ({ x: p.x - q.x, y: p.y - q.y })
export const mul = (p: Point, k: number): Point => ({ x: p.x * k, y: p.y * k })
export const dot = (p: Point, q: Point): number => p.x * q.x + p.y * q.y
export const norm = (p: Point): number => Math.hypot(p.x, p.y)
export const distance = (p: Point, q: Point): number => Math.hypot(p.x - q.x, p.y - q.y)

const cross3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})

export function normalize3(v: Vec3): Vec3 | null {
  const len = Math.hypot(v.x, v.y, v.z)
  return len < EPS ? null : { x: v.x / len, y: v.y / len, z: v.z / len }
}

/** Векторное произведение n × v в 3D, результат - проекция на XY. */
export function crossXY(n: Vec3, v: Vec3): Point {
  const r = cross3(n, v)
  return { x: r.x, y: r.y }
}

// ---------- Аффинные преобразования ----------

/** x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Affine = { a: number; b: number; c: number; d: number; e: number; f: number }

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/** Композиция: compose(m1, m2)(p) = m1(m2(p)) - сначала применяется последнее. */
export function compose(...ms: Affine[]): Affine {
  return ms.reduce(
    (p, q) => ({
      a: p.a * q.a + p.c * q.b,
      b: p.b * q.a + p.d * q.b,
      c: p.a * q.c + p.c * q.d,
      d: p.b * q.c + p.d * q.d,
      e: p.a * q.e + p.c * q.f + p.e,
      f: p.b * q.e + p.d * q.f + p.f,
    }),
    IDENTITY,
  )
}

export const translation = (dx: number, dy: number): Affine => ({ a: 1, b: 0, c: 0, d: 1, e: dx, f: dy })

export function rotation(angle: number): Affine {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }
}

export const scaling = (sx: number, sy: number = sx): Affine => ({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 })

export const applyPoint = (m: Affine, p: Point): Point => ({
  x: m.a * p.x + m.c * p.y + m.e,
  y: m.b * p.x + m.d * p.y + m.f,
})

export const applyVector = (m: Affine, v: Point): Point => ({ x: m.a * v.x + m.c * v.y, y: m.b * v.x + m.d * v.y })

/**
 * Перевод из системы координат объекта (OCS) в мировую (WCS), проекция на XY.
 * Алгоритм произвольной оси из спецификации DXF. Нормаль (0, 0, 1) - тождественное
 * преобразование; (0, 0, −1) - зеркало по X (так часто выгружают зеркальные детали).
 * elevation - координата Z объекта в OCS.
 */
export function ocsToWcs(normal: Vec3, elevation = 0): Affine {
  const n = normalize3(normal)
  if (!n || (Math.abs(n.x) < EPS && Math.abs(n.y) < EPS && n.z > 0)) return IDENTITY
  const helper: Vec3 = Math.abs(n.x) < 1 / 64 && Math.abs(n.y) < 1 / 64 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 }
  const ax = normalize3(cross3(helper, n))
  const ay = ax && normalize3(cross3(n, ax))
  if (!ax || !ay) return IDENTITY
  return { a: ax.x, b: ax.y, c: ay.x, d: ay.y, e: n.x * elevation, f: n.y * elevation }
}

export function transformSegment(seg: Segment, m: Affine): Segment {
  switch (seg.kind) {
    case 'line':
      return { kind: 'line', a: applyPoint(m, seg.a), b: applyPoint(m, seg.b) }
    case 'arc':
      return { ...seg, c: applyPoint(m, seg.c), u: applyVector(m, seg.u), v: applyVector(m, seg.v) }
    case 'spline':
      // NURBS аффинно-инвариантны: достаточно преобразовать контрольные точки.
      return { ...seg, controlPoints: seg.controlPoints.map((p) => applyPoint(m, p)) }
    case 'polyline':
      return { kind: 'polyline', points: seg.points.map((p) => applyPoint(m, p)) }
  }
}

// ---------- Дуги ----------

/** Дуга окружности против часовой стрелки от угла t0 до t1 (радианы); по умолчанию полная окружность. */
export function circleArc(center: Point, r: number, t0 = 0, t1 = t0 + TAU): ArcSegment {
  return { kind: 'arc', c: center, u: { x: r, y: 0 }, v: { x: 0, y: r }, t0, t1 }
}

/**
 * Дуга сегмента полилинии с bulge ≠ 0 (ТЗ 3.3): θ = 4·atan(|b|), r = c / (2·sin(θ/2)),
 * где c - хорда. b > 0 - против часовой стрелки, b < 0 - по часовой.
 */
export function bulgeArc(p1: Point, p2: Point, bulge: number): ArcSegment {
  const chord = distance(p1, p2)
  const theta = 4 * Math.atan(Math.abs(bulge))
  const r = chord / (2 * Math.sin(theta / 2))
  // Центр лежит на перпендикуляре к середине хорды.
  const mid = mul(add(p1, p2), 0.5)
  const dir = mul(sub(p2, p1), 1 / chord)
  const left = { x: -dir.y, y: dir.x }
  const offset = (chord / 2 / Math.tan(theta / 2)) * Math.sign(bulge)
  const c = add(mid, mul(left, offset))
  const start = Math.atan2(p1.y - c.y, p1.x - c.x)
  return bulge > 0
    ? { kind: 'arc', c, u: { x: r, y: 0 }, v: { x: 0, y: r }, t0: start, t1: start + theta }
    : // По часовой: P(t) = c + (r·cos t, −r·sin t), то есть угол точки равен −t.
      { kind: 'arc', c, u: { x: r, y: 0 }, v: { x: 0, y: -r }, t0: -start, t1: -start + theta }
}

export const arcPoint = (seg: ArcSegment, t: number): Point => ({
  x: seg.c.x + seg.u.x * Math.cos(t) + seg.v.x * Math.sin(t),
  y: seg.c.y + seg.u.y * Math.cos(t) + seg.v.y * Math.sin(t),
})

/** Дуга окружности (а не эллипса): u ⟂ v и |u| = |v|. */
export function isCircular(seg: ArcSegment): boolean {
  const ru = norm(seg.u)
  const rv = norm(seg.v)
  const scale = Math.max(ru, rv)
  return Math.abs(ru - rv) <= 1e-9 * scale && Math.abs(dot(seg.u, seg.v)) <= 1e-9 * scale * scale
}

/** Угол дуги, приведённый в (0, 2π]. Совпадающие углы - полный оборот (ТЗ 3.3). */
export function normalizeSweep(start: number, end: number): number {
  const sweep = (end - start) % TAU
  return sweep <= EPS ? sweep + TAU : sweep
}

// ---------- Габарит ----------

export const emptyBbox = (): Bbox => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })

export function extendBbox(box: Bbox, p: Point): void {
  if (p.x < box.minX) box.minX = p.x
  if (p.y < box.minY) box.minY = p.y
  if (p.x > box.maxX) box.maxX = p.x
  if (p.y > box.maxY) box.maxY = p.y
}

export function mergeBbox(box: Bbox, other: Bbox): void {
  box.minX = Math.min(box.minX, other.minX)
  box.minY = Math.min(box.minY, other.minY)
  box.maxX = Math.max(box.maxX, other.maxX)
  box.maxY = Math.max(box.maxY, other.maxY)
}

/** Точный габарит дуги: концы плюс точки экстремума по X и Y, попавшие в дугу. */
export function arcBbox(seg: ArcSegment): Bbox {
  const box = emptyBbox()
  extendBbox(box, arcPoint(seg, seg.t0))
  extendBbox(box, arcPoint(seg, seg.t1))
  // x(t) = cx + ux·cos t + vx·sin t экстремальна при t = atan2(vx, ux) + kπ; аналогично y.
  for (const base of [Math.atan2(seg.v.x, seg.u.x), Math.atan2(seg.v.y, seg.u.y)]) {
    for (const t of [base, base + Math.PI]) {
      const inArc = seg.t0 + ((((t - seg.t0) % TAU) + TAU) % TAU)
      if (inArc <= seg.t1 + EPS) extendBbox(box, arcPoint(seg, inArc))
    }
  }
  return box
}
