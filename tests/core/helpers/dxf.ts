/*
 * Генератор минимальных ASCII DXF для тестов: пары «код группы - значение».
 * Опция extra добавляет произвольные группы (нормаль 210/220/230, пространство листа 67 и т.п.).
 */

export type Groups = [number, string | number][]
type Opts = { layer?: string; extra?: Groups }

const head = (type: string, o: Opts = {}): Groups => [[0, type], [8, o.layer ?? '0'], ...(o.extra ?? [])]

export const line = (x1: number, y1: number, x2: number, y2: number, o?: Opts): Groups => [
  ...head('LINE', o),
  [10, x1], [20, y1], [30, 0],
  [11, x2], [21, y2], [31, 0],
]

export const circle = (cx: number, cy: number, r: number, o?: Opts): Groups => [
  ...head('CIRCLE', o),
  [10, cx], [20, cy], [30, 0],
  [40, r],
]

/** Углы в градусах, как в DXF. */
export const arc = (cx: number, cy: number, r: number, startDeg: number, endDeg: number, o?: Opts): Groups => [
  ...head('ARC', o),
  [10, cx], [20, cy], [30, 0],
  [40, r],
  [50, startDeg], [51, endDeg],
]

/** Вершины: [x, y] или [x, y, bulge]. */
export const lwpolyline = (vertices: number[][], closed: boolean, o?: Opts): Groups => [
  ...head('LWPOLYLINE', o),
  [90, vertices.length],
  [70, closed ? 1 : 0],
  ...vertices.flatMap(([x = 0, y = 0, bulge = 0]): Groups => [[10, x], [20, y], ...(bulge ? ([[42, bulge]] as Groups) : [])]),
]

/** Старая полилиния POLYLINE + VERTEX + SEQEND. flags: 1 - замкнута, 8 - 3D. */
export const polyline = (vertices: number[][], flags: number, o?: Opts): Groups => [
  ...head('POLYLINE', o),
  [66, 1],
  [10, 0], [20, 0], [30, 0],
  [70, flags],
  ...vertices.flatMap(([x = 0, y = 0, bulge = 0]): Groups => [
    [0, 'VERTEX'], [8, o?.layer ?? '0'],
    [10, x], [20, y], [30, 0],
    ...(bulge ? ([[42, bulge]] as Groups) : []),
    [70, flags & 8 ? 32 : 0],
  ]),
  [0, 'SEQEND'], [8, o?.layer ?? '0'],
]

/** Эллипс: центр, конец большой полуоси (относительно центра), отношение осей, параметры в радианах. */
export const ellipse = (
  cx: number, cy: number, mx: number, my: number, ratio: number,
  start = 0, end = 2 * Math.PI, o?: Opts,
): Groups => [
  ...head('ELLIPSE', o),
  [10, cx], [20, cy], [30, 0],
  [11, mx], [21, my], [31, 0],
  [40, ratio], [41, start], [42, end],
]

export const spline = (
  s: { degree: number; control?: number[][]; knots?: number[]; weights?: number[]; fit?: number[][]; closed?: boolean },
  o?: Opts,
): Groups => [
  ...head('SPLINE', o),
  [70, (s.closed ? 1 : 0) | (s.weights ? 4 : 0) | 8],
  [71, s.degree],
  [72, s.knots?.length ?? 0],
  [73, s.control?.length ?? 0],
  [74, s.fit?.length ?? 0],
  ...(s.knots ?? []).map((k): [number, number] => [40, k]),
  ...(s.control ?? []).flatMap(([x = 0, y = 0], i): Groups => [
    [10, x], [20, y], [30, 0],
    ...(s.weights ? ([[41, s.weights[i] ?? 1]] as Groups) : []),
  ]),
  ...(s.fit ?? []).flatMap(([x = 0, y = 0]): Groups => [[11, x], [21, y], [31, 0]]),
]

export const insert = (
  name: string, x: number, y: number,
  t: { sx?: number; sy?: number; rotation?: number; columns?: number; rows?: number; columnSpacing?: number; rowSpacing?: number } = {},
  o?: Opts,
): Groups => [
  ...head('INSERT', o),
  [2, name],
  [10, x], [20, y], [30, 0],
  ...(t.sx !== undefined ? ([[41, t.sx]] as Groups) : []),
  ...(t.sy !== undefined ? ([[42, t.sy]] as Groups) : []),
  ...(t.rotation !== undefined ? ([[50, t.rotation]] as Groups) : []),
  ...(t.columns !== undefined ? ([[70, t.columns]] as Groups) : []),
  ...(t.rows !== undefined ? ([[71, t.rows]] as Groups) : []),
  ...(t.columnSpacing !== undefined ? ([[44, t.columnSpacing]] as Groups) : []),
  ...(t.rowSpacing !== undefined ? ([[45, t.rowSpacing]] as Groups) : []),
]

export const text = (x: number, y: number, value: string, o?: Opts): Groups => [
  ...head('TEXT', o),
  [10, x], [20, y], [30, 0],
  [40, 5],
  [1, value],
]

export const point = (x: number, y: number, o?: Opts): Groups => [...head('POINT', o), [10, x], [20, y], [30, 0]]

/** Нормаль (0, 0, −1): объект в зеркальной системе координат. */
export const MIRRORED: Groups = [[210, 0], [220, 0], [230, -1]]

/** Прямоугольник из четырёх LINE. */
export const rectLines = (x: number, y: number, w: number, h: number, o?: Opts): Groups[] => [
  line(x, y, x + w, y, o),
  line(x + w, y, x + w, y + h, o),
  line(x + w, y + h, x, y + h, o),
  line(x, y + h, x, y, o),
]

export type Block = { name: string; base?: [number, number]; entities: Groups[] }

/** Документ DXF. insunits: null - без $INSUNITS. */
export function dxf(doc: { insunits?: number | null; entities: Groups[]; blocks?: Block[] }): string {
  const g: Groups = [[0, 'SECTION'], [2, 'HEADER'], [9, '$ACADVER'], [1, 'AC1015']]
  if (doc.insunits !== null) g.push([9, '$INSUNITS'], [70, doc.insunits ?? 4])
  g.push([0, 'ENDSEC'])
  if (doc.blocks?.length) {
    g.push([0, 'SECTION'], [2, 'BLOCKS'])
    for (const b of doc.blocks) {
      const [bx, by] = b.base ?? [0, 0]
      g.push([0, 'BLOCK'], [8, '0'], [2, b.name], [70, 0], [10, bx], [20, by], [30, 0], [3, b.name])
      for (const e of b.entities) g.push(...e)
      g.push([0, 'ENDBLK'], [8, '0'])
    }
    g.push([0, 'ENDSEC'])
  }
  g.push([0, 'SECTION'], [2, 'ENTITIES'])
  for (const e of doc.entities) g.push(...e)
  g.push([0, 'ENDSEC'], [0, 'EOF'])
  return g.map(([code, value]) => `${code}\n${value}`).join('\n') + '\n'
}
