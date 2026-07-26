/**
 * Подсказка распознавателю речи — из того, что Kira реально умеет и слышит.
 *
 * Whisper принимает короткий текст-контекст и смещает распознавание в его
 * сторону. Раньше там висела одна и та же фраза на все случаи, и распознавание
 * не знало ни имени пользователя, ни слова активации, ни названий его команд —
 * поэтому «Кира, открой Стим» превращалось в «Кир, открой стиль».
 *
 * Подсказка собирается из живых источников: имя, слово активации, недавно
 * выполненные команды и выученные формулировки. Чем дольше человек пользуется
 * Kira, тем точнее она его слышит.
 */
import { actionHistory } from './history'
import { registry } from './registry'
import { listLearned } from './learning'
import { getSettings } from '../modules/settings'

/**
 * Whisper обрезает контекст примерно на 224 токенах, а лишнее ещё и вредит:
 * длинная подсказка начинает «протекать» в результат. Держим её короткой.
 */
const MAX_CHARS = 380

/** Слова из недавних команд — то, что человек говорит чаще всего. */
function recentCommandWords(): string[] {
  const words: string[] = []
  const seen = new Set<string>()
  for (const r of actionHistory.list(60)) {
    const action = registry.get(r.actionId)
    const phrase = action?.examples[0] ?? action?.title ?? ''
    for (const w of phrase.toLowerCase().split(/\s+/)) {
      const clean = w.replace(/[^a-zа-яё0-9-]/gi, '')
      if (clean.length < 4 || seen.has(clean)) continue
      seen.add(clean)
      words.push(clean)
    }
  }
  return words
}

/**
 * Контекст для распознавания речи. Порядок важен: сначала то, что почти
 * наверняка прозвучит (имя, обращение), потом привычные команды — если хвост
 * подсказки обрежется, потеряется наименее ценное.
 */
export function transcribeHint(): string {
  const s = getSettings()
  const parts: string[] = ['Разговор с ассистентом по имени Кира на русском.']

  const wake = (s.wakeWord || '').trim()
  if (wake && wake.toLowerCase() !== 'кира') parts.push(`Обращение: ${wake}.`)
  if (s.userName.trim()) parts.push(`Пользователя зовут ${s.userName.trim()}.`)

  // выученные формулировки этого человека — он говорит именно так
  const learned = listLearned().filter((p) => p.active).slice(0, 8).map((p) => p.phrase)
  const recent = recentCommandWords()
  const vocabulary = [...learned, ...recent]
  if (vocabulary.length) parts.push('Частые команды: ' + vocabulary.join(', ') + '.')

  const hint = parts.join(' ')
  return hint.length > MAX_CHARS ? hint.slice(0, MAX_CHARS).replace(/[\s,]+\S*$/, '') + '.' : hint
}
