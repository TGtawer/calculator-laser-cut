import tariffsJson from '../data/tariffs.json'
import type { Tariffs } from './core/pricing/tariffs.ts'

/**
 * Тарифы цеха для MVP.
 *
 * Файл проверяется zod-схемой при сборке (плагин validate-tariffs в vite.config.ts)
 * и в тестах, поэтому здесь только приведение типа. Так zod не попадает в бандл,
 * а ошибка в тарифах ломает сборку, но не интерфейс у клиента (ТЗ, раздел 4).
 */
export const tariffs = tariffsJson as Tariffs
