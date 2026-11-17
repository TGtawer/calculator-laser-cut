import { describe, expect, it } from 'vitest'
import { analyzeDxfText } from '../../src/core/dxf/analyze.ts'
import { type ArcSegment, type SplineSegment, TAU, bulgeArc, circleArc } from '../../src/core/dxf/geometry.ts'
import { arcLength, segmentLength } from '../../src/core/dxf/length.ts'
import { evaluateSpline, sampleSpline } from '../../src/core/dxf/spline.ts'
import { arc, dxf, ellipse, line, lwpolyline, spline } from './helpers/dxf.ts'

/** Длина реза чертежа из одного объекта. */
function cutLength(...entities: Parameters<typeof dxf>[0]['entities']): number {
  const result = analyzeDxfText(dxf({ entities }))
  if (!result.ok) throw new Error(result.error.message)
  return result.analysis.cutLengthMm
}

/** Длина эллипса по второй формуле Рамануджана — независимая проверка (погрешность ~1e-10). */
function ramanujan(a: number, b: number): number {
  const h = ((a - b) / (a + b)) ** 2
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)))
}

const ellipseArc = (a: number, b: number, t0 = 0, t1 = TAU): ArcSegment => ({
  kind: 'arc', c: { x: 0, y: 0 }, u: { x: a, y: 0 }, v: { x: 0, y: b }, t0, t1,
})

describe('LINE: расстояние между точками', () => {
  it('3-4-5', () => {
    expect(segmentLength({ kind: 'line', a: { x: 1, y: 2 }, b: { x: 4, y: 6 } })).toBe(5)
    expect(cutLength(line(1, 2, 4, 6))).toBeCloseTo(5, 9)
  })
})

describe('CIRCLE и ARC: r·Δθ, Δθ против часовой в (0, 2π]', () => {
  it('окружность 2πr', () => {
    expect(arcLength(circleArc({ x: 0, y: 0 }, 5))).toBeCloseTo(10 * Math.PI, 12)
  })

  it('дуга 0°→90°', () => {
    expect(cutLength(arc(0, 0, 10, 0, 90))).toBeCloseTo(5 * Math.PI, 9)
  })

  it('дуга через 0°: 350°→10° — это 20°, а не 340°', () => {
    expect(cutLength(arc(0, 0, 10, 350, 10))).toBeCloseTo((10 * 20 * Math.PI) / 180, 9)
  })

  it('дуга 90°→0° — это 270° против часовой', () => {
    expect(cutLength(arc(0, 0, 10, 90, 0))).toBeCloseTo(15 * Math.PI, 9)
  })

  it('совпадающие углы — полный оборот', () => {
    expect(cutLength(arc(0, 0, 10, 30, 30))).toBeCloseTo(20 * Math.PI, 9)
  })
})

describe('LWPOLYLINE с bulge: θ = 4·atan|b|, r = c / (2·sin(θ/2)), длина r·θ', () => {
  it('b = 1 — полуокружность', () => {
    expect(segmentLength(bulgeArc({ x: 0, y: 0 }, { x: 40, y: 0 }, 1))).toBeCloseTo(20 * Math.PI, 12)
  })

  it('b = −1 — та же длина, другое направление', () => {
    expect(segmentLength(bulgeArc({ x: 0, y: 0 }, { x: 40, y: 0 }, -1))).toBeCloseTo(20 * Math.PI, 12)
  })

  it('b = tan(22.5°) — четверть окружности', () => {
    const b = Math.tan(Math.PI / 8)
    expect(segmentLength(bulgeArc({ x: 10, y: 0 }, { x: 0, y: 10 }, b))).toBeCloseTo(5 * Math.PI, 12)
  })

  it('|b| > 1 — дуга больше полуокружности (270°)', () => {
    const b = Math.tan((3 * Math.PI) / 8)
    // Хорда дуги 270° радиуса 10 равна 10·√2.
    expect(segmentLength(bulgeArc({ x: 10, y: 0 }, { x: 0, y: -10 }, b))).toBeCloseTo(15 * Math.PI, 9)
  })

  it('незамкнутая полилиния: отрезок + полуокружность', () => {
    expect(cutLength(lwpolyline([[0, 0], [100, 0, 1], [100, 40]], false))).toBeCloseTo(100 + 20 * Math.PI, 9)
  })

  it('замкнутая: учитывается сегмент «последняя → первая вершина»', () => {
    expect(cutLength(lwpolyline([[0, 0], [30, 0], [30, 40]], true))).toBeCloseTo(30 + 40 + 50, 9)
  })
})

describe('ELLIPSE: численное интегрирование, точность лучше 0,5 %', () => {
  // Допуск ТЗ — 0,5 %. Обычные эллипсы считаются почти точно, очень вытянутые — чуть грубее.
  it.each([
    [10, 5, 1e-6],
    [50, 49, 1e-6],
    [100, 1, 1e-3],
  ])('полный эллипс %i × %i', (a, b, tolerance) => {
    const exact = ramanujan(a, b)
    const got = arcLength(ellipseArc(a, b))
    expect(Math.abs(got - exact) / exact).toBeLessThan(tolerance)
  })

  it('половина эллипса — половина длины', () => {
    expect(arcLength(ellipseArc(10, 5, 0, Math.PI))).toBeCloseTo(ramanujan(10, 5) / 2, 6)
  })

  it('отношение осей 1 — окружность', () => {
    expect(cutLength(ellipse(0, 0, 0, 7, 1))).toBeCloseTo(14 * Math.PI, 9)
  })

  it('повёрнутый эллипс из файла', () => {
    // Большая полуось 10 под углом 30°, малая 5.
    const mx = 10 * Math.cos(Math.PI / 6)
    const my = 10 * Math.sin(Math.PI / 6)
    expect(cutLength(ellipse(3, 4, mx, my, 0.5))).toBeCloseTo(ramanujan(10, 5), 4)
  })

  it('дуга эллипса по параметрам из файла', () => {
    expect(cutLength(ellipse(0, 0, 10, 0, 0.5, Math.PI / 2, (3 * Math.PI) / 2))).toBeCloseTo(ramanujan(10, 5) / 2, 4)
  })
})

describe('SPLINE: де Бур, ≥ 200 точек; только fit points — ломаная', () => {
  const quarterCircle: SplineSegment = {
    kind: 'spline',
    degree: 2,
    controlPoints: [{ x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
    knots: [0, 0, 0, 1, 1, 1],
    weights: [1, Math.SQRT1_2, 1],
  }

  it('рациональный сплайн — точная четверть окружности', () => {
    for (const t of [0, 0.1, 0.37, 0.5, 0.9, 1]) {
      const p = evaluateSpline(quarterCircle, t)
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 12)
    }
    expect(Math.abs(segmentLength(quarterCircle) - 5 * Math.PI)).toBeLessThan(0.01)
  })

  it('сплайн 1-й степени — ломаная по контрольным точкам', () => {
    const seg: SplineSegment = {
      kind: 'spline', degree: 1,
      controlPoints: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 40 }],
      knots: [0, 0, 1, 2, 2], weights: null,
    }
    expect(segmentLength(seg)).toBeCloseTo(70, 9)
  })

  it('кубическая кривая Безье совпадает с формулой Бернштейна', () => {
    const c = [{ x: 0, y: 0 }, { x: 0, y: 30 }, { x: 40, y: 30 }, { x: 40, y: 0 }] as const
    const bezier = (t: number) => {
      const s = 1 - t
      const k = [s ** 3, 3 * s * s * t, 3 * s * t * t, t ** 3]
      return { x: k.reduce((sum, w, i) => sum + w * c[i]!.x, 0), y: k.reduce((sum, w, i) => sum + w * c[i]!.y, 0) }
    }
    const seg: SplineSegment = { kind: 'spline', degree: 3, controlPoints: [...c], knots: [0, 0, 0, 0, 1, 1, 1, 1], weights: null }
    for (const t of [0, 0.25, 0.5, 0.8, 1]) {
      expect(evaluateSpline(seg, t).x).toBeCloseTo(bezier(t).x, 12)
      expect(evaluateSpline(seg, t).y).toBeCloseTo(bezier(t).y, 12)
    }
    // Эталон — ломаная из 100 000 точек по формуле Бернштейна.
    let exact = 0
    for (let i = 1; i <= 100_000; i++) {
      const p = bezier((i - 1) / 100_000)
      const q = bezier(i / 100_000)
      exact += Math.hypot(q.x - p.x, q.y - p.y)
    }
    const got = segmentLength(seg)
    expect(Math.abs(got - exact) / exact).toBeLessThan(0.005)
    expect(sampleSpline(seg).length).toBeGreaterThanOrEqual(200)
  })

  it('веса рационального сплайна читаются из файла (иначе вышла бы парабола длиннее)', () => {
    const fromFile = cutLength(
      spline({ degree: 2, control: [[10, 0], [10, 10], [0, 10]], knots: [0, 0, 0, 1, 1, 1], weights: [1, Math.SQRT1_2, 1] }),
    )
    expect(Math.abs(fromFile - 5 * Math.PI)).toBeLessThan(0.01)
  })

  it('только fit points — ломаная по ним', () => {
    expect(cutLength(spline({ degree: 3, fit: [[0, 0], [30, 0], [30, 40]] }))).toBeCloseTo(70, 9)
  })

  it('замкнутый по флагу сплайн из fit points — ломаная замыкается', () => {
    expect(cutLength(spline({ degree: 3, fit: [[0, 0], [30, 0], [30, 40]], closed: true }))).toBeCloseTo(120, 9)
  })
})
