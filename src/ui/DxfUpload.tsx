import { type DragEvent, useId, useRef, useState } from 'react'

type Props = {
  onFile: (file: File) => void
  busy: boolean
  /** Имя загруженного файла; null - файла нет. */
  fileName: string | null
  error: string | null
}

/** Загрузка одного .dxf: перетаскиванием или кнопкой (ТЗ 2, п. 2). */
export function DxfUpload({ onFile, busy, fileName, error }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const errorId = useId()

  const pick = (files: FileList | null) => {
    const file = files?.[0]
    if (file) onFile(file)
  }

  const onDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    pick(e.dataTransfer.files)
  }

  const compact = fileName !== null && !busy

  return (
    <div>
      <div
        className={`dropzone${dragging ? ' dropzone--active' : ''}${compact ? ' dropzone--compact' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {busy ? (
          <p className="dropzone__text" role="status">
            Читаем чертёж…
          </p>
        ) : compact ? (
          <p className="dropzone__text">
            <span className="dropzone__file" title={fileName}>
              {fileName}
            </span>
          </p>
        ) : (
          <p className="dropzone__text">
            Перетащите сюда файл <b>.dxf</b>
            <span className="dropzone__hint">ASCII DXF, до 10 МБ, одна деталь в файле</span>
          </p>
        )}
        <button
          type="button"
          className={compact ? 'button button--secondary' : 'button'}
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          aria-describedby={error ? errorId : undefined}
        >
          {compact ? 'Заменить файл' : 'Выбрать файл'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".dxf"
          hidden
          onChange={(e) => {
            pick(e.currentTarget.files)
            // Чтобы повторный выбор того же файла снова вызвал onChange.
            e.currentTarget.value = ''
          }}
        />
      </div>
      {error && (
        <p id={errorId} className="alert alert--error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
