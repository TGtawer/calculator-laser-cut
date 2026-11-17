import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { parseTariffs } from './src/core/pricing/tariffs.ts'

/**
 * Проверяет data/tariffs.json zod-схемой в момент импорта файла: при сборке,
 * в dev-режиме и в тестах. Ошибка в тарифах останавливает сборку и не доходит
 * до клиента, поэтому в браузере повторной проверки нет.
 */
function validateTariffs(): Plugin {
  return {
    name: 'validate-tariffs',
    // До встроенного JSON-плагина Vite, чтобы получить исходный текст файла.
    enforce: 'pre',
    transform(code, id) {
      if (!/\/data\/tariffs\.json(\?|$)/.test(id)) return null
      try {
        parseTariffs(JSON.parse(code))
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        this.error(`data/tariffs.json не прошёл проверку:\n${reason}`)
      }
      return null
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [validateTariffs(), react()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
