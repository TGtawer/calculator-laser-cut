/**
 * Читает файл как текст. DXF с версии 2007 — в UTF-8, более старые — в кодировке
 * системы, у нас обычно windows-1251. От кодировки зависят только имена слоёв,
 * но кракозябры в списке слоёв пугают клиента, поэтому при ошибке UTF-8 — 1251.
 */
export async function readDxfText(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1251').decode(bytes)
  }
}
