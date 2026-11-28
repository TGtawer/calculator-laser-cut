import type { DxfEntityHandler, DxfGroup, DxfScanner } from 'dxf-parser'
import type { Vec3 } from './geometry.ts'

/*
 * Собственные обработчики сущностей для dxf-parser. Встроенные теряют данные,
 * от которых зависит геометрия:
 *   CIRCLE  - нормаль (210/220/230): зеркальная окружность встаёт не на своё место;
 *   ELLIPSE - нормаль: дуга зеркального эллипса уходит на другую сторону;
 *   SPLINE  - веса (41): рациональный сплайн (часто так выгружают дуги) искажается.
 */

type Common = { layer?: string; inPaperSpace?: boolean }

/** Читает группы сущности до следующего кода 0; общие поля разбирает сам. */
function readEntity(scanner: DxfScanner, onGroup: (code: number, value: number) => void): Common {
  const common: Common = {}
  let curr: DxfGroup = scanner.next()
  while (!scanner.isEOF()) {
    if (curr.code === 0) break
    switch (curr.code) {
      case 8:
        common.layer = String(curr.value)
        break
      case 67:
        common.inPaperSpace = curr.value !== 0
        break
      case 101:
        // Встроенный объект (ACAD 2018+): пропускаем до следующей сущности.
        while (curr.code !== 0 && !scanner.isEOF()) curr = scanner.next()
        continue
      default:
        if (typeof curr.value === 'number') onGroup(curr.code, curr.value)
    }
    curr = scanner.next()
  }
  return common
}

const point = (): Vec3 => ({ x: 0, y: 0, z: 0 })

/** Записывает координату в точку по коду группы: base - X, base + 10 - Y, base + 20 - Z. */
function setCoord(p: Vec3, code: number, base: number, value: number): void {
  if (code === base) p.x = value
  else if (code === base + 10) p.y = value
  else if (code === base + 20) p.z = value
}

export class CircleHandler implements DxfEntityHandler {
  ForEntityName = 'CIRCLE'

  parseEntity(scanner: DxfScanner): object {
    const center = point()
    const extrusion: Vec3 = { x: 0, y: 0, z: 1 }
    let radius = 0
    const common = readEntity(scanner, (code, value) => {
      if (code === 40) radius = value
      setCoord(center, code, 10, value)
      setCoord(extrusion, code, 210, value)
    })
    return { type: 'CIRCLE', ...common, center, radius, extrusion }
  }
}

export class EllipseHandler implements DxfEntityHandler {
  ForEntityName = 'ELLIPSE'

  parseEntity(scanner: DxfScanner): object {
    const center = point()
    const majorAxis = point()
    const extrusion: Vec3 = { x: 0, y: 0, z: 1 }
    let axisRatio = 1
    let startParam = 0
    let endParam = 2 * Math.PI
    const common = readEntity(scanner, (code, value) => {
      if (code === 40) axisRatio = value
      else if (code === 41) startParam = value
      else if (code === 42) endParam = value
      setCoord(center, code, 10, value)
      setCoord(majorAxis, code, 11, value)
      setCoord(extrusion, code, 210, value)
    })
    return { type: 'ELLIPSE', ...common, center, majorAxis, axisRatio, startParam, endParam, extrusion }
  }
}

export class SplineHandler implements DxfEntityHandler {
  ForEntityName = 'SPLINE'

  parseEntity(scanner: DxfScanner): object {
    const controlPoints: Vec3[] = []
    const fitPoints: Vec3[] = []
    const knots: number[] = []
    const weights: number[] = []
    let flags = 0
    let degree = 0
    const common = readEntity(scanner, (code, value) => {
      if (code === 10) controlPoints.push(point())
      if (code === 11) fitPoints.push(point())
      const control = controlPoints[controlPoints.length - 1]
      const fit = fitPoints[fitPoints.length - 1]
      if (control) setCoord(control, code, 10, value)
      if (fit) setCoord(fit, code, 11, value)
      if (code === 40) knots.push(value)
      else if (code === 41) weights.push(value)
      else if (code === 70) flags = value
      else if (code === 71) degree = value
    })
    return {
      type: 'SPLINE',
      ...common,
      controlPoints,
      fitPoints,
      knots,
      weights,
      degree,
      closed: (flags & 1) !== 0,
    }
  }
}
