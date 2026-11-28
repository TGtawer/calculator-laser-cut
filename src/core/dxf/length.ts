import type { Point } from '../types.ts'
import { DXF_CONFIG } from './config.ts'
import { type ArcSegment, type Segment, type Shape, distance, isCircular, norm } from './geometry.ts'
import { sampleSpline } from './spline.ts'

/*
 * Длины объектов (ТЗ 3.3). Отрезки и дуги окружностей - точно,
 * эллипсы и сплайны - численно с погрешностью заметно меньше 0,5 %.
 */

/** Сумма длин звеньев ломаной. */
export function polylineLength(points: readonly Point[]): number {
  let length = 0
  for (let i = 1; i < points.length; i++) length += distance(points[i - 1]!, points[i]!)
  return length
}

/**
 * Длина дуги. Окружность (в том числе дуга из bulge): r·Δθ.
 * Эллипс: интеграл |P′(t)| по параметру методом Симпсона, ellipseSteps шагов.
 */
export function arcLength(seg: ArcSegment): number {
  const sweep = seg.t1 - seg.t0
  if (isCircular(seg)) return norm(seg.u) * sweep

  const { u, v } = seg
  const speed = (t: number): number => {
    const sin = Math.sin(t)
    const cos = Math.cos(t)
    return Math.hypot(-u.x * sin + v.x * cos, -u.y * sin + v.y * cos)
  }
  const steps = DXF_CONFIG.ellipseSteps
  const h = sweep / steps
  let sum = speed(seg.t0) + speed(seg.t1)
  for (let i = 1; i < steps; i++) sum += (i % 2 === 1 ? 4 : 2) * speed(seg.t0 + i * h)
  return (sum * h) / 3
}

export function segmentLength(seg: Segment): number {
  switch (seg.kind) {
    case 'line':
      return distance(seg.a, seg.b)
    case 'arc':
      return arcLength(seg)
    case 'spline':
      return polylineLength(sampleSpline(seg))
    case 'polyline':
      return polylineLength(seg.points)
  }
}

export function shapeLength(shape: Shape): number {
  return shape.segments.reduce((sum, seg) => sum + segmentLength(seg), 0)
}
