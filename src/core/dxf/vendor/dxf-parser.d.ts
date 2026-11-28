/*
 * Типы для той части пакета dxf-parser, которой пользуется ядро.
 * Подключаются через "paths" в tsconfig.base.json вместо типов самого пакета:
 * те подтягивают @types/node в ядро и объявляют обязательными поля, которых
 * в реальных файлах может не быть. Здесь всё, что пришло из файла, - unknown
 * и проверяется в parse.ts.
 */

/** Пара «код группы - значение» из DXF. */
export interface DxfGroup {
  code: number
  value: unknown
}

export interface DxfScanner {
  next(): DxfGroup
  rewind(count?: number): void
  isEOF(): boolean
}

/** Обработчик сущности: читает группы до следующего кода 0. */
export interface DxfEntityHandler {
  ForEntityName: string
  parseEntity(scanner: DxfScanner, curr: DxfGroup): object
}

export interface RawDxf {
  header?: Record<string, unknown>
  entities?: unknown
  blocks?: unknown
}

export default class DxfParser {
  parseSync(source: string): RawDxf | null
  registerEntityHandler(handlerType: new () => DxfEntityHandler): void
}
