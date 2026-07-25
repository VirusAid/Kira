/**
 * Русское склонение по числу.
 *
 * Без него интерфейс писал «1 сценариев» и «1 записей памяти» — мелочь, которая
 * сразу выдаёт машинный текст. Правило стандартное: 1 (но не 11) → первая форма,
 * 2–4 (но не 12–14) → вторая, остальное → третья.
 *
 *   plural(1, 'сценарий', 'сценария', 'сценариев') → 'сценарий'
 *   plural(3, …) → 'сценария'   plural(7, …) → 'сценариев'
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n)
  const mod10 = abs % 10
  const mod100 = abs % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

/** Число вместе со словом в правильной форме: «3 диалога». */
export function withCount(n: number, one: string, few: string, many: string): string {
  return `${n} ${plural(n, one, few, many)}`
}
