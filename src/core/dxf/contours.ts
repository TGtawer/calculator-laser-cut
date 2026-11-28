import type { Point } from '../types.ts'
import { DXF_CONFIG } from './config.ts'
import { type Bbox, type Segment, type Shape, arcPoint, distance, emptyBbox, mergeBbox } from './geometry.ts'
import { shapeLength } from './length.ts'
import { sampleShape, shapeBbox, shapeEnd, shapeStart } from './sample.ts'

/** Контур до определения вложенности. */
export type ContourDraft = {
  points: Point[]
  closed: boolean
  lengthMm: number
  bbox: Bbox
}

// ---------- Дубли ----------

/** Координата с точностью 1e-6 мм: «полное совпадение» с поправкой на шум float. */
const q = (v: number): number => Math.round(v * 1e6)
const pointKey = (p: Point): string => `${q(p.x)},${q(p.y)}`

function segmentKey(seg: Segment, reversed: boolean): string {
  const ordered = (points: Point[]): string => (reversed ? [...points].reverse() : points).map(pointKey).join(';')
  switch (seg.kind) {
    case 'line':
      return `L${ordered([seg.a, seg.b])}`
    case 'arc': {
      // Дуга однозначно задаётся центром и точками на ней; направление обхода не важно.
      const sweep = seg.t1 - seg.t0
      const points = [0, 0.25, 0.5, 0.75, 1].map((k) => arcPoint(seg, seg.t0 + sweep * k))
      return `A${pointKey(seg.c)}|${ordered(points)}`
    }
    case 'spline':
      return `S${seg.degree}|${seg.knots.join(',')}|${seg.weights?.join(',') ?? ''}|${seg.controlPoints.map(pointKey).join(';')}`
    case 'polyline':
      return `P${ordered(seg.points)}`
  }
}

/** Ключ объекта, одинаковый для копии и для копии, нарисованной в обратную сторону. */
function shapeKey(shape: Shape): string {
  const forward = shape.segments.map((s) => segmentKey(s, false)).join('/')
  const backward = [...shape.segments]
    .reverse()
    .map((s) => segmentKey(s, true))
    .join('/')
  return `${shape.closed ? 'C' : 'O'}:${forward < backward ? forward : backward}`
}

/** Числовой хеш двух целых (координат ячейки или квантованной точки). Коллизии допустимы. */
const hash2 = (x: number, y: number): number => Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663)

/**
 * Быстрый хеш объекта: у дублей (в том числе нарисованных в обратную сторону) он совпадает.
 * Сумма хешей концов не зависит от направления обхода.
 */
function quickShapeHash(shape: Shape): number {
  const a = shapeStart(shape)
  const b = shapeEnd(shape)
  const ends = (hash2(q(a.x), q(a.y)) + hash2(q(b.x), q(b.y))) | 0
  return ends ^ Math.imul(shape.segments.length, 0x9e3779b1) ^ (shape.closed ? 1 : 0)
}

/**
 * Удаляет полностью совпадающие дубли объектов (ТЗ 3.4).
 * Полный ключ строится только для объектов с совпавшим быстрым хешем: дубли редки,
 * а строка на каждый объект в больших файлах заметно тормозит разбор.
 */
export function removeDuplicateShapes(shapes: readonly Shape[]): { shapes: Shape[]; removed: number } {
  const hashes = shapes.map(quickShapeHash)
  const hashCount = new Map<number, number>()
  for (const h of hashes) hashCount.set(h, (hashCount.get(h) ?? 0) + 1)

  const seen = new Set<string>()
  const unique: Shape[] = []
  shapes.forEach((shape, i) => {
    if (hashCount.get(hashes[i]!)! > 1) {
      const key = shapeKey(shape)
      if (seen.has(key)) return
      seen.add(key)
    }
    unique.push(shape)
  })
  return { shapes: unique, removed: shapes.length - unique.length }
}

// ---------- Склейка в контуры ----------

type Piece = { shape: Shape; reversed: boolean }

function makeContour(pieces: readonly Piece[], closed: boolean, tolerance: number): ContourDraft {
  const points: Point[] = []
  const bbox = emptyBbox()
  let lengthMm = 0
  for (const { shape, reversed } of pieces) {
    const part = sampleShape(shape)
    if (reversed) part.reverse()
    // Стык соседних объектов совпадает с точностью до допуска - точку не дублируем.
    points.push(...(points.length > 0 ? part.slice(1) : part))
    mergeBbox(bbox, shapeBbox(shape))
    lengthMm += shapeLength(shape)
  }
  if (closed && points.length > 1 && distance(points[0]!, points[points.length - 1]!) <= tolerance) points.pop()
  return { points, closed, lengthMm, bbox }
}

/**
 * Собирает контуры (ТЗ 3.4). Окружность, замкнутая полилиния, полный эллипс и замкнутый
 * сплайн - каждый отдельный замкнутый контур. Остальные объекты склеиваются в цепочки
 * по совпадению концов с допуском tolerance; цепочка, вернувшаяся в начало, замкнута.
 */
export function buildContours(shapes: readonly Shape[], tolerance: number = DXF_CONFIG.joinToleranceMm): ContourDraft[] {
  const contours: ContourDraft[] = []
  const open: Shape[] = []
  for (const shape of shapes) {
    if (shape.closed) contours.push(makeContour([{ shape, reversed: false }], true, tolerance))
    else open.push(shape)
  }

  // Узлы - концы объектов, совпадающие с точностью до допуска. Поиск соседей через сетку
  // с ячейкой в допуск. Ячейки адресуются числовым хешем: при коллизии в корзину попадут
  // узлы чужой ячейки, но расстояние всё равно проверяется.
  const nodes: { p: Point; edges: number[] }[] = []
  const grid = new Map<number, number[]>()
  const cell = (v: number): number => Math.floor(v / tolerance)
  const nodeAt = (p: Point): number => {
    const cx = cell(p.x)
    const cy = cell(p.y)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get(hash2(cx + dx, cy + dy))
        if (!bucket) continue
        for (const id of bucket) {
          if (distance(nodes[id]!.p, p) <= tolerance) return id
        }
      }
    }
    const id = nodes.length
    nodes.push({ p, edges: [] })
    const key = hash2(cx, cy)
    const bucket = grid.get(key)
    if (bucket) bucket.push(id)
    else grid.set(key, [id])
    return id
  }

  const startNode: number[] = []
  const endNode: number[] = []
  open.forEach((shape, i) => {
    startNode.push(nodeAt(shapeStart(shape)))
    endNode.push(nodeAt(shapeEnd(shape)))
    nodes[startNode[i]!]!.edges.push(i)
    nodes[endNode[i]!]!.edges.push(i)
  })

  const used = new Array<boolean>(open.length).fill(false)
  const walk = (from: number): void => {
    const pieces: Piece[] = []
    let node = from
    for (;;) {
      const edge = nodes[node]!.edges.find((i) => !used[i])
      if (edge === undefined) break
      used[edge] = true
      // Вошли в объект с конца - проходим его в обратную сторону.
      const reversed = startNode[edge] !== node
      pieces.push({ shape: open[edge]!, reversed })
      node = reversed ? startNode[edge]! : endNode[edge]!
    }
    if (pieces.length > 0) contours.push(makeContour(pieces, node === from, tolerance))
  }

  // Сначала цепочки от свободных концов (нечётная степень узла), затем оставшиеся циклы.
  nodes.forEach((node, id) => {
    if (node.edges.length % 2 === 1) while (node.edges.some((i) => !used[i])) walk(id)
  })
  open.forEach((_, i) => {
    if (!used[i]) walk(startNode[i]!)
  })

  return contours
}

// ---------- Вложенность ----------

function polygonArea(points: readonly Point[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

/** Точка внутри многоугольника - метод луча. */
function pointInPolygon(p: Point, polygon: readonly Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

const bboxInside = (inner: Bbox, outer: Bbox): boolean =>
  inner.minX >= outer.minX - 1e-9 &&
  inner.minY >= outer.minY - 1e-9 &&
  inner.maxX <= outer.maxX + 1e-9 &&
  inner.maxY <= outer.maxY + 1e-9

/**
 * Глубина вложенности каждого контура: сколько замкнутых контуров его содержат (ТЗ 3.4).
 * A внутри B, если bbox A лежит внутри bbox B и точка A внутри многоугольника B.
 * Проверяются три точки A и берётся большинство - на случай, если одна легла на границу B.
 * B должен быть больше A по площади, иначе два совпадающих контура «содержали» бы друг друга.
 *
 * Чтобы не сравнивать каждый контур со всеми (на тысячах отверстий это секунды),
 * замкнутые контуры раскладываются по сетке: B, содержащий A, обязательно содержит
 * центр габарита A, поэтому кандидаты - только контуры из ячейки этого центра.
 */
export function nestingDepths(contours: readonly ContourDraft[]): number[] {
  const areas = contours.map((c) => (c.closed ? polygonArea(c.points) : 0))
  const containers = contours.flatMap((c, index) => (c.closed && areas[index]! > 0 ? [index] : []))
  if (containers.length === 0) return contours.map(() => 0)

  const world = emptyBbox()
  for (const i of containers) mergeBbox(world, contours[i]!.bbox)
  const side = Math.min(128, Math.ceil(Math.sqrt(containers.length)))
  const cellWidth = (world.maxX - world.minX) / side || 1
  const cellHeight = (world.maxY - world.minY) / side || 1
  const column = (x: number): number => Math.min(side - 1, Math.max(0, Math.floor((x - world.minX) / cellWidth)))
  const row = (y: number): number => Math.min(side - 1, Math.max(0, Math.floor((y - world.minY) / cellHeight)))
  const cells: number[][] = Array.from({ length: side * side }, () => [])
  for (const i of containers) {
    const { bbox } = contours[i]!
    for (let cy = row(bbox.minY); cy <= row(bbox.maxY); cy++) {
      for (let cx = column(bbox.minX); cx <= column(bbox.maxX); cx++) cells[cy * side + cx]!.push(i)
    }
  }

  return contours.map((a, index) => {
    const centerX = (a.bbox.minX + a.bbox.maxX) / 2
    const centerY = (a.bbox.minY + a.bbox.maxY) / 2
    const n = a.points.length
    const probes = [a.points[0]!, a.points[Math.floor(n / 3)]!, a.points[Math.floor((2 * n) / 3)]!]
    let depth = 0
    for (const i of cells[row(centerY) * side + column(centerX)]!) {
      const b = contours[i]!
      if (i === index || areas[i]! <= areas[index]! || !bboxInside(a.bbox, b.bbox)) continue
      const hits = probes.filter((p) => pointInPolygon(p, b.points)).length
      if (hits >= 2) depth++
    }
    return depth
  })
}
