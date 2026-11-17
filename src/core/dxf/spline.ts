import type { Point } from '../types.ts'
import { DXF_CONFIG } from './config.ts'
import type { SplineSegment } from './geometry.ts'

/** Корректен ли набор степень / контрольные точки / узлы для NURBS. */
export function isValidSpline(degree: number, controlPointCount: number, knots: readonly number[]): boolean {
  if (!Number.isInteger(degree) || degree < 1 || controlPointCount < degree + 1) return false
  if (knots.length !== controlPointCount + degree + 1) return false
  for (let i = 1; i < knots.length; i++) {
    if (!(knots[i]! >= knots[i - 1]!)) return false
  }
  return knots[controlPointCount]! > knots[degree]!
}

/** Область параметра кривой: [knots[p], knots[n]]. */
export function splineDomain(seg: SplineSegment): [number, number] {
  return [seg.knots[seg.degree]!, seg.knots[seg.controlPoints.length]!]
}

/** Точка NURBS-кривой при параметре t — алгоритм де Бура в однородных координатах (ТЗ 3.3). */
export function evaluateSpline(seg: SplineSegment, t: number): Point {
  const { degree: p, controlPoints: points, knots: u, weights } = seg
  const n = points.length
  // Интервал узлов, содержащий t: u[k] <= t < u[k + 1], p <= k <= n − 1.
  let k = p
  while (k < n - 1 && t >= u[k + 1]!) k++

  const dx: number[] = []
  const dy: number[] = []
  const dw: number[] = []
  for (let j = 0; j <= p; j++) {
    const point = points[j + k - p]!
    const w = weights ? weights[j + k - p]! : 1
    dx.push(point.x * w)
    dy.push(point.y * w)
    dw.push(w)
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = j + k - p
      const denom = u[i + p - r + 1]! - u[i]!
      const alpha = denom === 0 ? 0 : (t - u[i]!) / denom
      dx[j] = (1 - alpha) * dx[j - 1]! + alpha * dx[j]!
      dy[j] = (1 - alpha) * dy[j - 1]! + alpha * dy[j]!
      dw[j] = (1 - alpha) * dw[j - 1]! + alpha * dw[j]!
    }
  }
  return { x: dx[p]! / dw[p]!, y: dy[p]! / dw[p]! }
}

/**
 * Точки вдоль кривой: каждый ненулевой интервал узлов делится поровну,
 * всего не меньше minSamples точек (ТЗ 3.3: не меньше 200).
 */
export function sampleSpline(seg: SplineSegment, minSamples: number = DXF_CONFIG.splineMinSamples): Point[] {
  const spans: [number, number][] = []
  for (let i = seg.degree; i < seg.controlPoints.length; i++) {
    const a = seg.knots[i]!
    const b = seg.knots[i + 1]!
    if (b > a) spans.push([a, b])
  }
  const first = spans[0]
  if (!first) return [...seg.controlPoints]
  const perSpan = Math.max(8, Math.ceil(minSamples / spans.length))
  const points = [evaluateSpline(seg, first[0])]
  for (const [a, b] of spans) {
    for (let j = 1; j <= perSpan; j++) points.push(evaluateSpline(seg, a + ((b - a) * j) / perSpan))
  }
  return points
}
