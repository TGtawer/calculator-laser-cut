import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { analyzeDxfText } from '../../src/core/dxf/analyze.ts'
import expected from '../fixtures/expected.json'

const fixture = (name: string): string => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')

type Expected = {
  description: string
  cutLengthMm: number
  closedContours: number
  openContours: number
  pierces: number
  bbox: { width: number; height: number }
  warnings: string[]
}

const cases = Object.entries(expected).filter(([name]) => name.endsWith('.dxf')) as [string, Expected][]

describe('фикстуры tests/fixtures/expected.json', () => {
  it('все три фикстуры на месте', () => {
    expect(cases.map(([name]) => name)).toEqual([
      '01_plate_rect_2holes.dxf',
      '02_slot_lwpolyline_bulge.dxf',
      '03_open_contour.dxf',
    ])
  })

  describe.each(cases)('%s', (name, want) => {
    const result = analyzeDxfText(fixture(name))
    if (!result.ok) throw new Error(`${name}: ${result.error.message}`)
    const { analysis } = result

    it(`длина реза ${want.cutLengthMm} мм ±0.01`, () => {
      expect(Math.abs(analysis.cutLengthMm - want.cutLengthMm)).toBeLessThanOrEqual(0.01)
    })

    it('контуры и прожиги', () => {
      expect({
        closedContours: analysis.closedContours,
        openContours: analysis.openContours,
        pierces: analysis.pierces,
      }).toEqual({ closedContours: want.closedContours, openContours: want.openContours, pierces: want.pierces })
    })

    it(`габарит ${want.bbox.width}×${want.bbox.height} мм`, () => {
      expect(analysis.bbox.width).toBeCloseTo(want.bbox.width, 2)
      expect(analysis.bbox.height).toBeCloseTo(want.bbox.height, 2)
    })

    it('предупреждения', () => {
      expect(analysis.warnings).toEqual(want.warnings)
    })
  })
})
