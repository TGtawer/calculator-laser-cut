import { describe, expect, it } from 'vitest'
import { analyzeDxf } from '../../src/core/dxf/analyze.ts'
import { DXF_CONFIG } from '../../src/core/dxf/config.ts'
import { checkDxfFile, parseDxf } from '../../src/core/dxf/parse.ts'
import type { DxfAnalysis } from '../../src/core/types.ts'
import {
  type Block,
  type Groups,
  MIRRORED,
  arc,
  circle,
  dxf,
  ellipse,
  insert,
  line,
  lwpolyline,
  point,
  polyline,
  rectLines,
  text,
} from './helpers/dxf.ts'

type Doc = { insunits?: number | null; entities: Groups[]; blocks?: Block[] }

function analyze(doc: Doc): DxfAnalysis {
  const parsed = parseDxf(dxf(doc))
  if (!parsed.ok) throw new Error(parsed.error.message)
  return analyzeDxf(parsed.drawing)
}

function errorCode(source: string): string {
  const parsed = parseDxf(source)
  if (parsed.ok) throw new Error('ожидалась ошибка')
  return parsed.error.code
}

/** Габарит с точностью до 1e-6 мм — удобно сравнивать целиком. */
function box(a: DxfAnalysis) {
  const r = (v: number) => Math.round(v * 1e6) / 1e6 + 0
  return { minX: r(a.bbox.minX), minY: r(a.bbox.minY), width: r(a.bbox.width), height: r(a.bbox.height) }
}

describe('единицы чертежа $INSUNITS (ТЗ 3.2)', () => {
  it.each([
    [4, 'мм', 1],
    [5, 'см', 10],
    [6, 'м', 1000],
    [1, 'дюйм', 25.4],
  ])('%i (%s) — множитель %f', (insunits, _name, k) => {
    const a = analyze({ insunits, entities: [line(0, 0, 3, 0)] })
    expect(a.cutLengthMm).toBeCloseTo(3 * k, 9)
    expect(a.warnings).not.toContain('UNITS_ASSUMED_MM')
  })

  it('0 — мм с предупреждением UNITS_ASSUMED_MM', () => {
    const a = analyze({ insunits: 0, entities: [line(0, 0, 30, 0)] })
    expect(a.cutLengthMm).toBe(30)
    expect(a.warnings).toContain('UNITS_ASSUMED_MM')
  })

  it('нет $INSUNITS — мм с предупреждением UNITS_ASSUMED_MM', () => {
    const a = analyze({ insunits: null, entities: [line(0, 0, 30, 0)] })
    expect(a.cutLengthMm).toBe(30)
    expect(a.warnings).toContain('UNITS_ASSUMED_MM')
  })

  it('другие единицы (футы) — ошибка «Неподдерживаемые единицы чертежа»', () => {
    const parsed = parseDxf(dxf({ insunits: 2, entities: [line(0, 0, 30, 0)] }))
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toEqual({ code: 'UNSUPPORTED_UNITS', message: 'Неподдерживаемые единицы чертежа' })
  })
})

describe('формат файла (ТЗ 3.1)', () => {
  it('бинарный DXF — «Сохраните чертёж в формате DXF (ASCII)»', () => {
    const parsed = parseDxf('AutoCAD Binary DXF\r\n\u001a\u0000\u0000\u0000')
    expect(parsed).toEqual({
      ok: false,
      error: { code: 'UNSUPPORTED_FORMAT', message: 'Сохраните чертёж в формате DXF (ASCII)' },
    })
  })

  it('DWG, прочитанный как текст, — тоже UNSUPPORTED_FORMAT', () => {
    expect(errorCode('AC1032\u0000\u0000\u0000\u0000\u0000\u0003')).toBe('UNSUPPORTED_FORMAT')
  })

  it('пустой файл и не-DXF — PARSE_FAILED', () => {
    expect(errorCode('')).toBe('PARSE_FAILED')
    expect(errorCode('просто текст\nне чертёж')).toBe('PARSE_FAILED')
  })

  it('только текст, без геометрии — NO_GEOMETRY', () => {
    expect(errorCode(dxf({ entities: [text(0, 0, 'ДЕТАЛЬ')] }))).toBe('NO_GEOMETRY')
  })

  it('BOM в начале и переводы строк CRLF не мешают', () => {
    const source = '﻿' + dxf({ entities: [line(0, 0, 10, 0)] }).replace(/\n/g, '\r\n')
    expect(parseDxf(source).ok).toBe(true)
  })

  it('проверка файла до чтения: расширение и размер', () => {
    const max = DXF_CONFIG.maxFileSizeBytes
    expect(checkDxfFile({ name: 'деталь.DXF', size: max })).toBeNull()
    expect(checkDxfFile({ name: 'деталь.dwg', size: 1000 })?.code).toBe('UNSUPPORTED_FORMAT')
    expect(checkDxfFile({ name: 'деталь', size: 1000 })?.code).toBe('UNSUPPORTED_FORMAT')
    expect(checkDxfFile({ name: 'деталь.dxf', size: max + 1 })).toEqual({
      code: 'FILE_TOO_LARGE',
      message: 'Файл больше 10 МБ. Загрузите чертёж меньшего размера',
    })
  })
})

describe('игнорируемые объекты (ТЗ 3.3)', () => {
  it('TEXT и POINT не режутся и не влияют на габарит', () => {
    const a = analyze({ entities: [...rectLines(0, 0, 10, 10), text(500, 500, 'Т'), point(-300, 0)] })
    expect(a.cutLengthMm).toBeCloseTo(40, 9)
    expect(box(a)).toEqual({ minX: 0, minY: 0, width: 10, height: 10 })
  })

  it('объекты пространства листа (67 = 1) не относятся к детали', () => {
    const a = analyze({ entities: [...rectLines(0, 0, 10, 10), line(0, 0, 999, 0, { extra: [[67, 1]] })] })
    expect(a.cutLengthMm).toBeCloseTo(40, 9)
  })

  it('3D-полилиния не учитывается (только 2D)', () => {
    expect(errorCode(dxf({ entities: [polyline([[0, 0], [10, 0], [10, 10]], 8)] }))).toBe('NO_GEOMETRY')
  })
})

describe('полилинии', () => {
  it('bulge > 0 — дуга против часовой: при движении вправо выгибается вниз', () => {
    expect(box(analyze({ entities: [lwpolyline([[0, 0, 1], [40, 0]], false)] }))).toEqual({
      minX: 0, minY: -20, width: 40, height: 20,
    })
  })

  it('bulge < 0 — дуга по часовой: выгибается вверх', () => {
    expect(box(analyze({ entities: [lwpolyline([[0, 0, -1], [40, 0]], false)] }))).toEqual({
      minX: 0, minY: 0, width: 40, height: 20,
    })
  })

  it('POLYLINE с bulge считается так же, как LWPOLYLINE', () => {
    const vertices = [[0, 0], [100, 0, 1], [100, 40], [0, 40, 1]]
    const lw = analyze({ entities: [lwpolyline(vertices, true)] })
    const old = analyze({ entities: [polyline(vertices, 1)] })
    expect(old.cutLengthMm).toBeCloseTo(lw.cutLengthMm, 9)
    expect(old.cutLengthMm).toBeCloseTo(200 + 40 * Math.PI, 9)
    expect(old.closedContours).toBe(1)
  })

  it('повторяющиеся вершины не дают лишних звеньев', () => {
    const a = analyze({ entities: [lwpolyline([[0, 0], [10, 0], [10, 0], [10, 10], [0, 10], [0, 0]], true)] })
    expect(a.cutLengthMm).toBeCloseTo(40, 9)
    expect(a.closedContours).toBe(1)
  })
})

describe('зеркальные объекты: нормаль (0, 0, −1)', () => {
  it('CIRCLE: X центра меняет знак', () => {
    expect(box(analyze({ entities: [circle(10, 0, 5, { extra: MIRRORED })] }))).toEqual({
      minX: -15, minY: -5, width: 10, height: 10,
    })
  })

  it('ARC: дуга 0°→90° отражается по X', () => {
    const a = analyze({ entities: [arc(10, 0, 5, 0, 90, { extra: MIRRORED })] })
    expect(box(a)).toEqual({ minX: -15, minY: 0, width: 5, height: 5 })
    expect(a.cutLengthMm).toBeCloseTo(2.5 * Math.PI, 9)
  })

  it('LWPOLYLINE', () => {
    expect(box(analyze({ entities: [lwpolyline([[10, 0], [20, 5]], false, { extra: MIRRORED })] }))).toEqual({
      minX: -20, minY: 0, width: 10, height: 5,
    })
  })

  it('ELLIPSE: половина эллипса уходит на другую сторону', () => {
    const upper = analyze({ entities: [ellipse(0, 0, 10, 0, 0.5, 0, Math.PI)] })
    const lower = analyze({ entities: [ellipse(0, 0, 10, 0, 0.5, 0, Math.PI, { extra: MIRRORED })] })
    expect(box(upper)).toEqual({ minX: -10, minY: 0, width: 20, height: 5 })
    expect(box(lower)).toEqual({ minX: -10, minY: -5, width: 20, height: 5 })
  })
})

describe('блоки INSERT (ТЗ 3.3)', () => {
  // Пластина 10×5 с отверстием R1; базовая точка блока — (0, 0).
  const plate: Block = { name: 'PLATE', entities: [...rectLines(0, 0, 10, 5), circle(5, 2.5, 1)] }
  const plateLength = 30 + 2 * Math.PI

  it('смещение', () => {
    const a = analyze({ blocks: [plate], entities: [insert('PLATE', 100, 50)] })
    expect(box(a)).toEqual({ minX: 100, minY: 50, width: 10, height: 5 })
    expect(a.cutLengthMm).toBeCloseTo(plateLength, 9)
    expect(a.closedContours).toBe(2)
  })

  it('масштаб', () => {
    const a = analyze({ blocks: [plate], entities: [insert('PLATE', 0, 0, { sx: 2, sy: 2 })] })
    expect(box(a)).toEqual({ minX: 0, minY: 0, width: 20, height: 10 })
    expect(a.cutLengthMm).toBeCloseTo(2 * plateLength, 9)
  })

  it('поворот на 90°', () => {
    const a = analyze({ blocks: [plate], entities: [insert('PLATE', 100, 0, { rotation: 90 })] })
    expect(box(a)).toEqual({ minX: 95, minY: 0, width: 5, height: 10 })
    expect(a.cutLengthMm).toBeCloseTo(plateLength, 9)
  })

  it('базовая точка блока', () => {
    const a = analyze({ blocks: [{ ...plate, base: [10, 5] }], entities: [insert('PLATE', 0, 0)] })
    expect(box(a)).toEqual({ minX: -10, minY: -5, width: 10, height: 5 })
  })

  it('зеркало (масштаб −1 по X)', () => {
    const a = analyze({ blocks: [{ name: 'ARC', entities: [arc(10, 0, 5, 0, 90)] }], entities: [insert('ARC', 0, 0, { sx: -1 })] })
    expect(box(a)).toEqual({ minX: -15, minY: 0, width: 5, height: 5 })
    expect(a.cutLengthMm).toBeCloseTo(2.5 * Math.PI, 9)
  })

  it('неравномерный масштаб превращает окружность в эллипс', () => {
    const a = analyze({ blocks: [{ name: 'C', entities: [circle(0, 0, 10)] }], entities: [insert('C', 0, 0, { sx: 2, sy: 1 })] })
    const h = (10 / 30) ** 2
    const ellipse20x10 = Math.PI * 30 * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)))
    expect(box(a)).toEqual({ minX: -20, minY: -10, width: 40, height: 20 })
    expect(Math.abs(a.cutLengthMm - ellipse20x10) / ellipse20x10).toBeLessThan(1e-6)
  })

  it('массив MINSERT 3 × 2', () => {
    const a = analyze({
      blocks: [plate],
      entities: [insert('PLATE', 0, 0, { columns: 3, rows: 2, columnSpacing: 20, rowSpacing: 10 })],
    })
    expect(a.closedContours).toBe(12)
    expect(a.outerContours).toBe(6)
    expect(box(a)).toEqual({ minX: 0, minY: 0, width: 50, height: 15 })
    expect(a.warnings).toContain('MULTIPLE_PARTS')
  })

  it('вложенные блоки', () => {
    const a = analyze({
      blocks: [
        { name: 'HOLE', entities: [circle(0, 0, 1)] },
        { name: 'PART', entities: [...rectLines(0, 0, 10, 10), insert('HOLE', 5, 5, { sx: 2, sy: 2 })] },
      ],
      entities: [insert('PART', 100, 0)],
    })
    expect(a.cutLengthMm).toBeCloseTo(40 + 4 * Math.PI, 9)
    expect(a.outerContours).toBe(1)
    const hole = a.contours.find((c) => !c.isOuter)
    expect(Math.min(...hole!.points.map((p) => p.x))).toBeCloseTo(103, 6)
  })

  it('объекты блока на слое «0» получают слой вставки, остальные сохраняют свой', () => {
    const parsed = parseDxf(
      dxf({
        blocks: [{ name: 'P', entities: [...rectLines(0, 0, 10, 10), circle(5, 5, 1, { layer: 'HOLES' })] }],
        entities: [insert('P', 0, 0, {}, { layer: 'PARTS' })],
      }),
    )
    if (!parsed.ok) throw new Error(parsed.error.message)
    expect(parsed.drawing.layers).toEqual(['PARTS', 'HOLES'])
  })

  it('блок, вставляющий сам себя, не зацикливает разбор', () => {
    const a = analyze({
      blocks: [{ name: 'LOOP', entities: [circle(0, 0, 1), insert('LOOP', 5, 0)] }],
      entities: [insert('LOOP', 0, 0)],
    })
    expect(a.closedContours).toBe(1)
  })

  it('вставка несуществующего блока игнорируется', () => {
    expect(errorCode(dxf({ entities: [insert('NOPE', 0, 0)] }))).toBe('NO_GEOMETRY')
  })
})
