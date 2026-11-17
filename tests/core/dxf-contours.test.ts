import { describe, expect, it } from 'vitest'
import { type AnalyzeOptions, analyzeDxf } from '../../src/core/dxf/analyze.ts'
import { warningMessage } from '../../src/core/dxf/messages.ts'
import { parseDxf } from '../../src/core/dxf/parse.ts'
import type { DxfAnalysis } from '../../src/core/types.ts'
import { type Groups, arc, circle, dxf, line, lwpolyline, rectLines } from './helpers/dxf.ts'

function analyze(entities: Groups[], options?: AnalyzeOptions & { insunits?: number }): DxfAnalysis {
  const parsed = parseDxf(dxf({ entities, insunits: options?.insunits }))
  if (!parsed.ok) throw new Error(parsed.error.message)
  return analyzeDxf(parsed.drawing, options)
}

const counts = (a: DxfAnalysis) => ({
  closed: a.closedContours,
  open: a.openContours,
  pierces: a.pierces,
  outer: a.outerContours,
})

describe('склейка в контуры (ТЗ 3.4)', () => {
  it('отрезки в произвольном порядке и направлении — один замкнутый контур', () => {
    const a = analyze([line(10, 0, 10, 5), line(0, 5, 0, 0), line(0, 0, 10, 0), line(0, 5, 10, 5)])
    expect(counts(a)).toEqual({ closed: 1, open: 0, pierces: 1, outer: 1 })
    expect(a.cutLengthMm).toBeCloseTo(30, 9)
  })

  it('зазор меньше допуска 0,01 мм — контур замкнут', () => {
    const a = analyze([line(0, 0, 10, 0), line(10.005, 0, 10, 5), line(10, 5, 0, 5), line(0, 5, 0, 0.004)])
    expect(counts(a)).toEqual({ closed: 1, open: 0, pierces: 1, outer: 1 })
    expect(a.warnings).toEqual([])
  })

  it('зазор больше допуска — незамкнутый контур, 1 прожиг и OPEN_CONTOUR', () => {
    const a = analyze([line(0, 0, 10, 0), line(10.02, 0, 10, 5), line(10, 5, 0, 5), line(0, 5, 0, 0)])
    expect(counts(a)).toEqual({ closed: 0, open: 1, pierces: 1, outer: 1 })
    expect(a.warnings).toEqual(['OPEN_CONTOUR'])
  })

  it('полилиния без флага замкнутости, но с последней вершиной в первой — замкнута', () => {
    const a = analyze([lwpolyline([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], false)])
    expect(counts(a)).toEqual({ closed: 1, open: 0, pierces: 1, outer: 1 })
  })

  it('паз из отрезков и дуг — один замкнутый контур', () => {
    const a = analyze([line(0, 0, 100, 0), arc(100, 20, 20, -90, 90), line(100, 40, 0, 40), arc(0, 20, 20, 90, 270)])
    expect(counts(a)).toEqual({ closed: 1, open: 0, pierces: 1, outer: 1 })
    expect(a.cutLengthMm).toBeCloseTo(200 + 40 * Math.PI, 9)
  })

  it('дуга на полный оборот замыкается сама на себя', () => {
    expect(counts(analyze([arc(0, 0, 10, 45, 45)]))).toEqual({ closed: 1, open: 0, pierces: 1, outer: 1 })
  })

  it('разветвление («звезда» из трёх отрезков) не теряет длину; прожиги = замкнутые + незамкнутые', () => {
    const a = analyze([line(0, 0, 10, 0), line(0, 0, -10, 0), line(0, 0, 0, 10)])
    expect(a.cutLengthMm).toBeCloseTo(30, 9)
    expect(a.closedContours).toBe(0)
    expect(a.pierces).toBe(a.openContours)
    expect(a.openContours).toBeGreaterThanOrEqual(2)
  })

  it('точки превью: у замкнутого контура последняя точка не повторяет первую, длина — точная', () => {
    const a = analyze([circle(0, 0, 10)])
    const [c] = a.contours
    const first = c!.points[0]!
    const last = c!.points[c!.points.length - 1]!
    expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeGreaterThan(0.01)
    for (const p of c!.points) expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 9)
    expect(c!.lengthMm).toBeCloseTo(20 * Math.PI, 12)
  })
})

describe('дубли (ТЗ 3.4)', () => {
  it('совпадающие объекты удаляются до расчёта, в том числе нарисованные в обратную сторону', () => {
    const a = analyze([
      ...rectLines(0, 0, 10, 10),
      line(0, 0, 10, 0), // копия
      line(10, 10, 10, 0), // копия в обратную сторону
      circle(5, 5, 2),
      circle(5, 5, 2), // копия
      lwpolyline([[20, 0], [30, 0, 0.5], [30, 10]], false),
      // Та же полилиния в обратную сторону: bulge относится к сегменту, начинающемуся в вершине.
      lwpolyline([[30, 10, -0.5], [30, 0], [20, 0]], false),
    ])
    expect(a.duplicatesRemoved).toBe(4)
    expect(a.warnings).toContain('DUPLICATES_REMOVED')
    expect(a.closedContours).toBe(2)
    // Каждый замкнутый контур посчитан один раз: окружность 4π и прямоугольник 40.
    const closedLengths = a.contours.filter((c) => c.closed).map((c) => c.lengthMm).sort((x, y) => x - y)
    expect(closedLengths[0]).toBeCloseTo(4 * Math.PI, 9)
    expect(closedLengths[1]).toBeCloseTo(40, 9)
    expect(a.openContours).toBe(1)
  })

  it('частично перекрывающиеся объекты — не дубли', () => {
    const a = analyze([line(0, 0, 10, 0), line(0, 0, 5, 0), circle(0, 0, 5), circle(0, 0, 5.001)])
    expect(a.duplicatesRemoved).toBe(0)
    expect(a.warnings).not.toContain('DUPLICATES_REMOVED')
  })

  it('общие концы при разной форме — не дубли (быстрый хеш совпал, полный ключ — нет)', () => {
    // Отрезок и две дуги между одними и теми же точками: выпуклые в разные стороны.
    const a = analyze([line(-10, 0, 10, 0), arc(0, 0, 10, 0, 180), arc(0, 0, 10, 180, 0)])
    expect(a.duplicatesRemoved).toBe(0)
    expect(a.cutLengthMm).toBeCloseTo(20 + 20 * Math.PI, 9)
  })

  it('дубль на отключённом слое не считается', () => {
    const entities = [circle(0, 0, 5), circle(0, 0, 5, { layer: 'COPY' })]
    expect(analyze(entities).duplicatesRemoved).toBe(1)
    expect(analyze(entities, { disabledLayers: ['COPY'] }).duplicatesRemoved).toBe(0)
  })
})

describe('вложенность и MULTIPLE_PARTS (ТЗ 3.4)', () => {
  it('пластина с отверстиями: один внешний контур, отверстия внутренние', () => {
    const a = analyze([...rectLines(0, 0, 100, 50), circle(25, 25, 5), lwpolyline([[60, 20], [80, 20], [80, 30], [60, 30]], true)])
    expect(counts(a)).toEqual({ closed: 3, open: 0, pierces: 3, outer: 1 })
    expect(a.contours.map((c) => c.isOuter)).toEqual([false, false, true])
    expect(a.warnings).toEqual([])
  })

  it('две отдельные детали — MULTIPLE_PARTS', () => {
    const a = analyze([...rectLines(0, 0, 10, 10), ...rectLines(20, 0, 10, 10)])
    expect(a.outerContours).toBe(2)
    expect(a.warnings).toEqual(['MULTIPLE_PARTS'])
  })

  it('деталь внутри отверстия другой детали — вложенный контур, не внешний', () => {
    const a = analyze([...rectLines(0, 0, 100, 100), ...rectLines(20, 20, 60, 60), circle(50, 50, 10)])
    expect(a.outerContours).toBe(1)
    expect(a.warnings).not.toContain('MULTIPLE_PARTS')
  })

  it('незамкнутый контур внутри детали — внутренний', () => {
    const a = analyze([circle(0, 0, 50), line(-10, 0, 10, 0)])
    expect(counts(a)).toEqual({ closed: 1, open: 1, pierces: 2, outer: 1 })
    expect(a.warnings).toEqual(['OPEN_CONTOUR'])
  })

  it('два одинаковых контура разного типа не считаются вложенными друг в друга', () => {
    const a = analyze([...rectLines(0, 0, 10, 10), lwpolyline([[0, 0], [10, 0], [10, 10], [0, 10]], true)])
    expect(a.outerContours).toBe(2)
  })
})

describe('габарит и SUSPICIOUS_SIZE (ТЗ 3.2)', () => {
  it('габарит учитывает выпуклость дуг, а не только концы', () => {
    const a = analyze([arc(0, 0, 10, 45, 135)])
    expect(a.bbox.height).toBeCloseTo(10 - 10 * Math.SQRT1_2, 9)
    expect(a.bbox.minY).toBeCloseTo(10 * Math.SQRT1_2, 9)
  })

  it.each([
    ['0,5 мм', 0.5, true],
    ['1 мм', 1, false],
    ['6000 мм', 6000, false],
    ['7000 мм', 7000, true],
  ])('деталь %s', (_name, size, suspicious) => {
    const a = analyze(rectLines(0, 0, size, size / 2))
    expect(a.warnings.includes('SUSPICIOUS_SIZE')).toBe(suspicious)
  })

  it('чертёж в метрах переводится в мм и не выглядит подозрительно', () => {
    const a = analyze(rectLines(0, 0, 0.2, 0.1), { insunits: 6 })
    expect(a.bbox.width).toBeCloseTo(200, 9)
    expect(a.warnings).toEqual([])
  })
})

describe('слои (ТЗ 3.3)', () => {
  const entities = [...rectLines(0, 0, 100, 50, { layer: 'CUT' }), circle(25, 25, 5, { layer: 'CUT' }), line(10, 10, 90, 10, { layer: 'MARK' })]

  it('объекты отключённых слоёв не режутся; список слоёв остаётся полным', () => {
    const all = analyze(entities)
    const cutOnly = analyze(entities, { disabledLayers: ['MARK'] })
    expect(all.cutLengthMm).toBeCloseTo(300 + 10 * Math.PI + 80, 9)
    expect(cutOnly.cutLengthMm).toBeCloseTo(300 + 10 * Math.PI, 9)
    expect(cutOnly.layers).toEqual(['CUT', 'MARK'])
    expect(cutOnly.warnings).toEqual([])
  })

  it('все слои отключены — пустой результат без ложных предупреждений', () => {
    const a = analyze(entities, { disabledLayers: ['CUT', 'MARK'] })
    expect(counts(a)).toEqual({ closed: 0, open: 0, pierces: 0, outer: 0 })
    expect(a.cutLengthMm).toBe(0)
    expect(a.bbox).toEqual({ minX: 0, minY: 0, width: 0, height: 0 })
    expect(a.warnings).toEqual([])
  })
})

describe('тексты предупреждений', () => {
  it('тексты из ТЗ', () => {
    expect(warningMessage('OPEN_CONTOUR')).toBe('В чертеже есть незамкнутые контуры — проверьте файл')
    expect(warningMessage('MULTIPLE_PARTS')).toBe('В файле, похоже, несколько деталей — расчёт идёт как за одну')
    expect(warningMessage('SUSPICIOUS_SIZE')).toBe('Проверьте единицы чертежа')
  })

  it('DUPLICATES_REMOVED — с количеством', () => {
    expect(warningMessage('DUPLICATES_REMOVED', 3)).toContain('3')
  })
})
