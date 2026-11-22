import { describe, expect, it } from 'vitest'
import tariffsJson from '../../data/tariffs.json'
import { parseTariffs, TariffsValidationError, type Tariffs } from '../../src/core/pricing/tariffs.ts'

/** Копия настоящего файла тарифов, которую тест портит под свой случай. */
function tariffsCopy(): Tariffs {
  return structuredClone(tariffsJson) as Tariffs
}

/** Ожидает ошибку проверки, в тексте которой есть все указанные фрагменты. */
function expectInvalid(input: unknown, ...fragments: string[]): void {
  let error: unknown
  try {
    parseTariffs(input)
  } catch (err) {
    error = err
  }
  expect(error).toBeInstanceOf(TariffsValidationError)
  for (const fragment of fragments) {
    expect((error as Error).message).toContain(fragment)
  }
}

function lengthRange(t: Tariffs, id: string) {
  const range = t.bending.lengthRanges.find((r) => r.id === id)
  if (!range) throw new Error(`нет диапазона ${id}`)
  return range
}

describe('data/tariffs.json', () => {
  it('проходит проверку схемой', () => {
    expect(() => parseTariffs(tariffsJson)).not.toThrow()
  })

  it('читается без потерь: строки резки, металл, диапазоны гибки и null «по запросу»', () => {
    const t = parseTariffs(tariffsJson)
    const material = t.materials[0]!
    const rows = material.cutting.rows

    expect(material.densityKgM3).toBe(7850)
    expect(material.cutting.metalUnit).toBe('RUB_per_kg')
    expect(rows).toHaveLength(13)
    expect(rows[0]).toEqual({ thickness: 0.5, cut: 83, pierce: 18, metal: null })
    expect(rows.at(-1)).toEqual({ thickness: 10, cut: 300, pierce: 33, metal: null })
    expect(t.order.includeMaterialCost).toBe(true)
    expect(t.order.marginMm).toBe(5)
    expect(t.order.minOrderRub).toBe(5000)

    expect(t.bending.quantityBrackets.map((b) => b.id)).toEqual(['q1', 'q2', 'q3', 'q4', 'q5'])
    expect(t.bending.quantityBrackets.at(-1)!.max).toBeNull()
    expect(t.bending.thicknessBands.map((b) => b.id)).toEqual(['t1', 't2', 't3', 't4', 't5'])
    expect(t.bending.lengthRanges.map((r) => r.id)).toEqual(['L1', 'L2', 'L3', 'L4'])

    expect(lengthRange(t, 'L1').prices['t3']).toEqual([52, 45, 40, 36, 35])
    expect(lengthRange(t, 'L4').prices['t3']).toBeNull()
    expect(lengthRange(t, 'L2').prices['t3']).toEqual([55, 50, 46, 40, 37])
  })
})

describe('parseTariffs: ошибки в тарифах', () => {
  it('отклоняет не-объект', () => {
    expectInvalid(null)
    expectInvalid('tariffs')
  })

  it('отклоняет опечатку в имени поля', () => {
    const t = tariffsCopy()
    const row = t.materials[0]!.cutting.rows[0]! as Record<string, unknown>
    row['pirce'] = row['pierce']
    delete row['pierce']
    expectInvalid(t, 'pirce', 'pierce')
  })

  it('отклоняет неизвестное поле в строке резки (например, старое cutAlt)', () => {
    const t = tariffsCopy()
    ;(t.materials[0]!.cutting.rows[0] as Record<string, unknown>)['cutAlt'] = 100
    expectInvalid(t, 'cutAlt')
  })

  it('отклоняет отрицательную цену', () => {
    const t = tariffsCopy()
    t.materials[0]!.cutting.rows[0]!.cut = -83
    expectInvalid(t, 'materials[0].cutting.rows[0].cut')
  })

  it('отклоняет цену точнее копейки', () => {
    const t = tariffsCopy()
    t.materials[0]!.cutting.rows[0]!.cut = 83.125
    expectInvalid(t, 'с точностью до копейки')
  })

  it('принимает цену с копейками', () => {
    const t = tariffsCopy()
    t.materials[0]!.cutting.rows[0]!.cut = 58.27
    expect(() => parseTariffs(t)).not.toThrow()
  })

  it('принимает null в цене резки: «по запросу»', () => {
    const t = tariffsCopy()
    t.materials[0]!.cutting.rows.at(-1)!.cut = null
    expect(() => parseTariffs(t)).not.toThrow()
  })

  it('отклоняет повтор или нарушение порядка толщин', () => {
    const t = tariffsCopy()
    t.materials[0]!.cutting.rows[1]!.thickness = 0.5
    expectInvalid(t, 'по возрастанию', 'rows[1].thickness')
  })

  it('отклоняет неизвестную единицу цены', () => {
    const t = tariffsCopy()
    ;(t.materials[0]!.cutting as Record<string, unknown>)['cutUnit'] = 'RUB_per_mm'
    expectInvalid(t, 'cutUnit')
  })

  it('отклоняет неверную дату обновления', () => {
    const t = tariffsCopy()
    t.updatedAt = '17.11.2026'
    expectInvalid(t, 'updatedAt')
  })

  it('отклоняет пропуск в диапазонах тиража', () => {
    const t = tariffsCopy()
    t.bending.quantityBrackets[1]!.min = 52
    expectInvalid(t, 'ожидалось min = 51')
  })

  it('отклоняет диапазон тиража без верхней границы не в конце', () => {
    const t = tariffsCopy()
    t.bending.quantityBrackets[3]!.max = null
    expectInvalid(t, 'только последним')
  })

  it('отклоняет тираж, который начинается не с 1 гиба', () => {
    const t = tariffsCopy()
    t.bending.quantityBrackets[0]!.min = 2
    expectInvalid(t, 'с 1 гиба')
  })

  it('отклоняет диапазоны толщины гибки не по возрастанию', () => {
    const t = tariffsCopy()
    t.bending.thicknessBands[2]!.maxThickness = 2
    expectInvalid(t, 'thicknessBands[2].maxThickness')
  })

  it('отклоняет повторяющийся id', () => {
    const t = tariffsCopy()
    t.bending.lengthRanges[2]!.id = 'L2'
    expectInvalid(t, 'Повторяется id «L2»')
  })

  it('отклоняет строку цен гибки не той длины', () => {
    const t = tariffsCopy()
    lengthRange(t, 'L2').prices['t1'] = [42, 38, 34, 30]
    expectInvalid(t, 'Ожидалось 5 цен', 'lengthRanges[1].prices.t1')
  })

  it('отклоняет пропущенную строку толщины в ценах гибки', () => {
    const t = tariffsCopy()
    delete lengthRange(t, 'L2').prices['t5']
    expectInvalid(t, 'Нет строки цен для толщины «t5»')
  })

  it('отклоняет неизвестную толщину в ценах гибки', () => {
    const t = tariffsCopy()
    lengthRange(t, 'L2').prices['t9'] = [1, 2, 3, 4, 5]
    expectInvalid(t, 'Неизвестный диапазон толщины «t9»')
  })

  it('принимает null в отдельной ячейке гибки', () => {
    const t = tariffsCopy()
    lengthRange(t, 'L3').prices['t4'] = [65, null, null, null, null]
    expect(() => parseTariffs(t)).not.toThrow()
  })

  it('отклоняет отрицательную цену металла и цену точнее копейки', () => {
    const negative = tariffsCopy()
    negative.materials[0]!.cutting.rows[0]!.metal = -10
    expectInvalid(negative, 'materials[0].cutting.rows[0].metal')

    const tooPrecise = tariffsCopy()
    tooPrecise.materials[0]!.cutting.rows[0]!.metal = 120.125
    expectInvalid(tooPrecise, 'с точностью до копейки')
  })

  it('принимает цену металла в рублях с копейками', () => {
    const t = tariffsCopy()
    t.materials[0]!.cutting.rows[0]!.metal = 120.55
    expect(() => parseTariffs(t)).not.toThrow()
  })

  it('отклоняет отсутствие или неположительную плотность материала', () => {
    const missing = tariffsCopy()
    delete (missing.materials[0] as Record<string, unknown>)['densityKgM3']
    expectInvalid(missing, 'densityKgM3')

    const zero = tariffsCopy()
    zero.materials[0]!.densityKgM3 = 0
    expectInvalid(zero, 'densityKgM3')
  })

  it('отклоняет отрицательный технологический отступ marginMm', () => {
    const t = tariffsCopy()
    t.order.marginMm = -1
    expectInvalid(t, 'order.marginMm')
  })

  it('отклоняет удалённое поле wasteFactor в order', () => {
    const t = tariffsCopy()
    ;(t.order as Record<string, unknown>)['wasteFactor'] = 1.1
    expectInvalid(t, 'wasteFactor')
  })
})
