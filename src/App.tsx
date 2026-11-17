import { tariffs } from './appTariffs.ts'

// Временная страница-заглушка: загрузка DXF, параметры и расчёт появятся на следующих шагах.
export default function App() {
  const material = tariffs.materials[0]
  const thicknesses = material?.cutting.rows.map((row) => row.thickness) ?? []

  return (
    <main className="page">
      <h1>Калькулятор лазерной резки и гибки</h1>
      <p>Калькулятор в разработке.</p>
      {material && thicknesses.length > 0 && (
        <p className="muted">
          Тарифы от {tariffs.updatedAt}: {material.name.toLowerCase()}, толщина от{' '}
          {thicknesses[0]} до {thicknesses[thicknesses.length - 1]} мм.
        </p>
      )}
      <p className="disclaimer">
        Расчёт ориентировочный. Окончательную стоимость подтвердит менеджер после проверки чертежа.
      </p>
    </main>
  )
}
