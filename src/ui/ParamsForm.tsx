import { type ChangeEvent, type KeyboardEvent, type ReactNode, useId } from 'react'
import { formatDecimal } from '../core/format.ts'
import { cuttingThicknesses, findCuttingRow } from '../core/pricing/cutting.ts'
import { KG_PER_TONNE } from '../core/pricing/metal.ts'
import { thicknessText } from '../core/pricing/summary.ts'
import { type Tariffs, materialOptions } from '../core/pricing/tariffs.ts'
import { type FieldName, type FormValues, formatNumberInput } from './params.ts'

type Props = {
  tariffs: Tariffs
  value: FormValues
  errors: Partial<Record<FieldName, string>>
  onChange: (value: FormValues) => void
}

type FieldProps = {
  label: string
  hint?: string
  error?: string | undefined
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby': string | undefined }) => ReactNode
}

/** При удалении рядом с разделителем удаляем соседнюю цифру. */
function skipGroupSpace(event: KeyboardEvent<HTMLInputElement>): void {
  const { key, currentTarget: input } = event
  if ((key !== 'Backspace' && key !== 'Delete') || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  const caret = input.selectionStart
  if (caret === null || caret !== input.selectionEnd) return
  const separator = key === 'Backspace' ? caret - 1 : caret
  if (!/^\d \d$/.test(input.value.slice(separator - 1, separator + 2))) return
  const next = key === 'Backspace' ? caret - 1 : caret + 1
  input.setSelectionRange(next, next)
}

/** Поле формы: подпись, элемент ввода, подсказка или ошибка. */
function Field({ label, hint, error, children }: FieldProps) {
  const id = useId()
  const noteId = `${id}-note`
  const note = error ?? hint
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': note ? noteId : undefined })}
      {note && (
        <p id={noteId} className={error ? 'field__error' : 'field__hint'}>
          {note}
        </p>
      )}
    </div>
  )
}

/** Параметры заказа (ТЗ 2, п. 4). Толщина - только из тарифов, свободного ввода нет. */
export function ParamsForm({ tariffs, value, errors, onChange }: Props) {
  const metalGroupId = useId()
  const set = <K extends keyof FormValues>(key: K, v: FormValues[K]) => onChange({ ...value, [key]: v })
  const numberInputProps = (key: Exclude<FieldName, 'thickness'>) => ({
    autoComplete: 'off',
    value: value[key],
    onChange: ({ currentTarget: input }: ChangeEvent<HTMLInputElement>) => {
      const formatted = formatNumberInput(input.value, input.selectionStart ?? input.value.length)
      if (formatted.value !== input.value) {
        input.value = formatted.value
        input.setSelectionRange(formatted.caret, formatted.caret)
      }
      set(key, formatted.value)
    },
    onKeyDown: skipGroupSpace,
  })
  const options = materialOptions(tariffs)
  const material = options.find((option) => option.id === value.materialId)
  const thicknesses = material ? cuttingThicknesses(material) : []
  const selectedThickness = value.thickness === '' ? null : Number(value.thickness)
  const selectedRow = material && selectedThickness !== null ? findCuttingRow(material, selectedThickness) : undefined
  const tariffMetalPrice = selectedRow?.metal == null ? null : formatDecimal(selectedRow.metal * KG_PER_TONNE, 2)
  const selectMaterial = (materialId: string) => {
    const next = options.find((option) => option.id === materialId)
    const thickness = next && selectedThickness !== null && findCuttingRow(next, selectedThickness) ? value.thickness : ''
    onChange({ ...value, materialId, thickness })
  }

  return (
    <form className="params" onSubmit={(e) => e.preventDefault()} noValidate>
      <Field label="Материал">
        {(props) => (
          <select
            {...props}
            className="input"
            value={value.materialId}
            onChange={(e) => selectMaterial(e.currentTarget.value)}
          >
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </Field>

      <div className="params__row">
        <Field label="Толщина листа" error={errors.thickness}>
          {(props) => (
            <select
              {...props}
              className="input"
              value={value.thickness}
              onChange={(e) => set('thickness', e.currentTarget.value)}
            >
              <option value="" disabled>
                Выберите
              </option>
              {thicknesses.map((t) => (
                <option key={t} value={String(t)}>
                  {thicknessText(t)}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label="Количество, шт." error={errors.quantity}>
          {(props) => (
            <input
              {...props}
              className="input"
              inputMode="numeric"
              {...numberInputProps('quantity')}
            />
          )}
        </Field>
      </div>

      {tariffs.order.includeMaterialCost && (
        <div className="metal-section">
          <div className="field" role="group" aria-labelledby={metalGroupId}>
            <span id={metalGroupId} className="field__label">
              Металл
            </span>
            <div className="segmented">
              <button
                type="button"
                className={`segmented__btn${!value.customerMetal ? ' segmented__btn--active' : ''}`}
                aria-pressed={!value.customerMetal}
                onClick={() => set('customerMetal', false)}
              >
                Наш металл
              </button>
              <button
                type="button"
                className={`segmented__btn${value.customerMetal ? ' segmented__btn--active' : ''}`}
                aria-pressed={value.customerMetal}
                onClick={() => set('customerMetal', true)}
              >
                Металл заказчика
              </button>
            </div>
          </div>

          {!value.customerMetal && (
            <Field
              label="Цена металла, ₽/т"
              hint={
                tariffMetalPrice !== null
                  ? `По умолчанию из прайса (${tariffMetalPrice} ₽/т), можно указать свою`
                  : 'Если оставить пустым – «по запросу»'
              }
              error={errors.metalPrice}
            >
              {(props) => (
                <input
                  {...props}
                  className="input"
                  inputMode="decimal"
                  placeholder={tariffMetalPrice ?? 'Например, от 120 000 ₽/т'}
                  {...numberInputProps('metalPrice')}
                />
              )}
            </Field>
          )}
        </div>
      )}

      <label className="check check--block">
        <input
          type="checkbox"
          checked={value.bendingEnabled}
          onChange={(e) => set('bendingEnabled', e.currentTarget.checked)}
        />
        <span>Нужна гибка</span>
      </label>

      {value.bendingEnabled && (
        <div className="params__row">
          <Field label="Гибов на деталь" error={errors.bendsPerPart}>
            {(props) => (
              <input
                {...props}
                className="input"
                inputMode="numeric"
                {...numberInputProps('bendsPerPart')}
              />
            )}
          </Field>

          <Field label="Длина гиба, мм" hint="Одна для всех гибов детали" error={errors.bendLength}>
            {(props) => (
              <input
                {...props}
                className="input"
                inputMode="decimal"
                placeholder="например, 500"
                {...numberInputProps('bendLength')}
              />
            )}
          </Field>
        </div>
      )}
    </form>
  )
}
