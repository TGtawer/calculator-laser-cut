import { type ReactNode, useId } from 'react'
import { formatDecimal } from '../core/format.ts'
import { cuttingThicknesses, findCuttingRow } from '../core/pricing/cutting.ts'
import { KG_PER_TONNE } from '../core/pricing/metal.ts'
import { thicknessText } from '../core/pricing/summary.ts'
import type { Tariffs } from '../core/pricing/tariffs.ts'
import type { FieldName, FormValues } from './params.ts'

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

/** Параметры заказа (ТЗ 2, п. 4). Толщина — только из тарифов, свободного ввода нет. */
export function ParamsForm({ tariffs, value, errors, onChange }: Props) {
  const metalGroupId = useId()
  const set = <K extends keyof FormValues>(key: K, v: FormValues[K]) => onChange({ ...value, [key]: v })
  const material = tariffs.materials.find((m) => m.id === value.materialId)
  const thicknesses = material ? cuttingThicknesses(material) : []
  const selectedThickness = value.thickness === '' ? null : Number(value.thickness)
  const selectedRow = material && selectedThickness !== null ? findCuttingRow(material, selectedThickness) : undefined
  const tariffMetalPrice = selectedRow?.metal == null ? null : formatDecimal(selectedRow.metal * KG_PER_TONNE, 2)

  return (
    <form className="params" onSubmit={(e) => e.preventDefault()} noValidate>
      <Field label="Материал">
        {(props) => (
          <select
            {...props}
            className="input"
            value={value.materialId}
            onChange={(e) => onChange({ ...value, materialId: e.currentTarget.value, thickness: '' })}
          >
            {tariffs.materials.map((m) => (
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
              autoComplete="off"
              value={value.quantity}
              onChange={(e) => set('quantity', e.currentTarget.value)}
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
                  : 'Если оставить пустым — «по запросу»'
              }
              error={errors.metalPrice}
            >
              {(props) => (
                <input
                  {...props}
                  className="input"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={tariffMetalPrice ?? 'например, 120 000'}
                  value={value.metalPrice}
                  onChange={(e) => set('metalPrice', e.currentTarget.value)}
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
                autoComplete="off"
                value={value.bendsPerPart}
                onChange={(e) => set('bendsPerPart', e.currentTarget.value)}
              />
            )}
          </Field>

          <Field label="Длина гиба, мм" hint="Одна для всех гибов детали" error={errors.bendLength}>
            {(props) => (
              <input
                {...props}
                className="input"
                inputMode="decimal"
                autoComplete="off"
                placeholder="например, 500"
                value={value.bendLength}
                onChange={(e) => set('bendLength', e.currentTarget.value)}
              />
            )}
          </Field>
        </div>
      )}
    </form>
  )
}
