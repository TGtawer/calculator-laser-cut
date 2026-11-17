import type { Point } from '../types.ts'
import { DXF_CONFIG } from './config.ts'
import {
  type ArcSegment,
  type Bbox,
  type Segment,
  type Shape,
  TAU,
  arcBbox,
  arcPoint,
  emptyBbox,
  extendBbox,
  mergeBbox,
  norm,
} from './geometry.ts'
import { evaluateSpline, sampleSpline, splineDomain } from './spline.ts'

/** Сколько звеньев ломаной нужно, чтобы отклонение от дуги не превышало previewChordToleranceMm. */
function arcPieces(seg: ArcSegment): number {
  const sweep = seg.t1 - seg.t0
  const r = Math.max(norm(seg.u), norm(seg.v))
  const tol = DXF_CONFIG.previewChordToleranceMm
  const step = r > tol ? 2 * Math.acos(1 - tol / r) : Math.PI / 4
  const perTurn = Math.min(1024, Math.max(16, Math.ceil(TAU / step)))
  return Math.max(1, Math.ceil((perTurn * sweep) / TAU))
}

/** Ломаная вдоль элемента — для превью и проверки вложенности. */
export function sampleSegment(seg: Segment): Point[] {
  switch (seg.kind) {
    case 'line':
      return [seg.a, seg.b]
    case 'arc': {
      const pieces = arcPieces(seg)
      const sweep = seg.t1 - seg.t0
      return Array.from({ length: pieces + 1 }, (_, i) => arcPoint(seg, seg.t0 + (sweep * i) / pieces))
    }
    case 'spline':
      return sampleSpline(seg)
    case 'polyline':
      return seg.points
  }
}

export function segmentStart(seg: Segment): Point {
  switch (seg.kind) {
    case 'line':
      return seg.a
    case 'arc':
      return arcPoint(seg, seg.t0)
    case 'spline':
      return evaluateSpline(seg, splineDomain(seg)[0])
    case 'polyline':
      return seg.points[0]!
  }
}

export function segmentEnd(seg: Segment): Point {
  switch (seg.kind) {
    case 'line':
      return seg.b
    case 'arc':
      return arcPoint(seg, seg.t1)
    case 'spline':
      return evaluateSpline(seg, splineDomain(seg)[1])
    case 'polyline':
      return seg.points[seg.points.length - 1]!
  }
}

export const shapeStart = (shape: Shape): Point => segmentStart(shape.segments[0]!)
export const shapeEnd = (shape: Shape): Point => segmentEnd(shape.segments[shape.segments.length - 1]!)

/** Габарит элемента: дуги — точно, сплайны — по точкам кривой. */
export function segmentBbox(seg: Segment): Bbox {
  if (seg.kind === 'arc') return arcBbox(seg)
  const box = emptyBbox()
  for (const p of sampleSegment(seg)) extendBbox(box, p)
  return box
}

export function shapeBbox(shape: Shape): Bbox {
  const box = emptyBbox()
  for (const seg of shape.segments) mergeBbox(box, segmentBbox(seg))
  return box
}

/** Ломаная вдоль всего объекта, без повторов точек на стыках элементов. */
export function sampleShape(shape: Shape): Point[] {
  const points: Point[] = []
  for (const seg of shape.segments) {
    const part = sampleSegment(seg)
    points.push(...(points.length > 0 ? part.slice(1) : part))
  }
  return points
}
