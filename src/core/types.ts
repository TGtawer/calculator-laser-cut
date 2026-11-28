/** Точка на плоскости, мм. */
export type Point = { x: number; y: number }

/** Предупреждения разбора чертежа (ТЗ, раздел 3). */
export type WarningCode =
  | 'UNITS_ASSUMED_MM'
  | 'SUSPICIOUS_SIZE'
  | 'OPEN_CONTOUR'
  | 'DUPLICATES_REMOVED'

/** Ошибки, при которых чертёж нельзя посчитать. */
export type DxfErrorCode =
  /** Не ASCII DXF: DWG, бинарный DXF или другой файл. */
  | 'UNSUPPORTED_FORMAT'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_UNITS'
  /** Файл повреждён или это не DXF. */
  | 'PARSE_FAILED'
  /** В чертеже нет ни одного объекта для резки. */
  | 'NO_GEOMETRY'

export type DxfError = { code: DxfErrorCode; message: string }

/** Контур для превью и подсчёта прожигов. */
export type Contour = {
  /** Ломаная в мм: дуги и сплайны аппроксимированы. У замкнутого контура последняя точка не повторяет первую. */
  points: Point[]
  closed: boolean
  /** Внешний контур - не вложен ни в один замкнутый. Вложенные - отверстия. */
  isOuter: boolean
  /** Точная длина контура (не длина ломаной), мм. */
  lengthMm: number
}

/** Результат разбора чертежа (ТЗ 3.5). */
export type DxfAnalysis = {
  cutLengthMm: number
  closedContours: number
  openContours: number
  pierces: number
  outerContours: number
  /** Габарит, мм. */
  bbox: { minX: number; minY: number; width: number; height: number }
  /** Все слои чертежа с геометрией, включая отключённые пользователем. */
  layers: string[]
  contours: Contour[]
  warnings: WarningCode[]
  /** Сколько полностью совпадающих дублей удалено (для текста DUPLICATES_REMOVED). */
  duplicatesRemoved: number
}
