import type { DxfError, DxfErrorCode, WarningCode } from '../types.ts'
import { DXF_CONFIG } from './config.ts'

/** Тексты ошибок для пользователя. Где текст задан в ТЗ, он взят дословно. */
const ERROR_MESSAGES: Record<DxfErrorCode, string> = {
  UNSUPPORTED_FORMAT: 'Сохраните чертёж в формате DXF (ASCII)',
  FILE_TOO_LARGE: `Файл больше ${DXF_CONFIG.maxFileSizeBytes / 1024 / 1024} МБ. Загрузите чертёж меньшего размера`,
  UNSUPPORTED_UNITS: 'Неподдерживаемые единицы чертежа',
  PARSE_FAILED:
    'Не удалось прочитать файл. Возможно, он повреждён - сохраните чертёж заново в формате DXF (ASCII)',
  NO_GEOMETRY: 'В чертеже не найдено контуров для резки',
}

export const dxfError = (code: DxfErrorCode): DxfError => ({ code, message: ERROR_MESSAGES[code] })

/** Текст предупреждения для пользователя. */
export function warningMessage(code: WarningCode, duplicatesRemoved = 0): string {
  switch (code) {
    case 'UNITS_ASSUMED_MM':
      return 'В чертеже не указаны единицы - размеры считаются в миллиметрах'
    case 'SUSPICIOUS_SIZE':
      return 'Проверьте единицы чертежа'
    case 'OPEN_CONTOUR':
      return 'В чертеже есть незамкнутые контуры - проверьте файл'
    case 'DUPLICATES_REMOVED':
      return `Удалены совпадающие дубли элементов: ${duplicatesRemoved}`
  }
}
