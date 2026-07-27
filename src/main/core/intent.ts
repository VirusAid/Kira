/**
 * Intent Parser — быстрая ЛОКАЛЬНАЯ классификация запроса без LLM.
 *
 * Чистый модуль (ни Electron, ни реестра): получает нормализованный текст и
 * список интент-паттернов, возвращает намерение. Консервативен по дизайну:
 * малейшее сомнение → 'ai' (лучше отдать LLM, чем выполнить не то).
 */
import type { Intent, IntentSpec } from './types'

/** Маркеры многошаговых запросов — такие всегда уходят в AI/агента. */
const MULTI_STEP = [' и ', ' потом ', ' затем ', ' после этого ', ' а также ', ' а затем ', ' и еще ']

/** Маркеры задач для агента (сложные цели, а не команды). */
const AGENT_HINTS = [
  'разберись', 'исправь', 'наведи порядок', 'организуй', 'проанализируй',
  'сделай проект', 'напиши код', 'отрефактори'
]

/** Чистка фразы с СОХРАНЕНИЕМ регистра: «Кира», вежливость, пунктуация, пробелы. */
function clean(raw: string): string {
  return raw
    .replace(/^\s*кира[,!.\s]+/i, '')
    .replace(/\s*пожалуйста\s*/gi, ' ')
    .replace(/[.!?]+\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Свёртка для сопоставления: нижний регистр + ё→е (длина сохраняется). */
export function normalize(raw: string): string {
  return clean(raw).toLowerCase().replace(/ё/g, 'е')
}

/** Паттерн с флагом d — чтобы доставать аргументы из оригинала по индексам. */
function withIndices(re: RegExp): RegExp {
  return re.flags.includes('d') ? re : new RegExp(re.source, re.flags + 'd')
}

/** Расстояние редактирования с ранним выходом (нам нужны только мелкие правки). */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
      if (cur[j] < rowMin) rowMin = cur[j]
    }
    if (rowMin > max) return max + 1 // дальше только хуже — выходим
    prev = cur
  }
  return prev[b.length]
}

/**
 * Мягкая правка опечатки в ПЕРВОМ слове команды: «открй браузер» → «открой».
 *
 * Намеренно осторожна, потому что ошибочная правка хуже нераспознавания:
 *  • правим только первое слово (глагол), аргументы не трогаем;
 *  • известные слова не трогаем вовсе — промах не в них;
 *  • допуск 1 опечатка для коротких слов и 2 для длинных;
 *  • если подходящих кандидатов несколько — не гадаем, оставляем как есть.
 */
function fixTypo(word: string, vocabulary: string[]): string | null {
  if (word.length < 4) return null
  if (vocabulary.includes(word)) return null
  const max = word.length >= 7 ? 2 : 1
  let bestDist = max + 1
  let bestWords: string[] = []
  for (const cand of vocabulary) {
    const d = editDistance(word, cand, max)
    if (d > max) continue
    if (d < bestDist) { bestDist = d; bestWords = [cand] }
    else if (d === bestDist && !bestWords.includes(cand)) bestWords.push(cand)
  }
  return bestWords.length === 1 ? bestWords[0] : null
}

/** Поиск действия по анкерным шаблонам. Аргументы берутся из оригинала. */
function matchSpecs(original: string, text: string, specs: IntentSpec[]): Intent | null {
  for (const spec of specs) {
    for (const pattern of spec.patterns) {
      const m = withIndices(pattern).exec(text)
      if (m) {
        const args: Record<string, string> = {}
        const idx = (m as RegExpExecArray & { indices?: { groups?: Record<string, [number, number] | undefined> } }).indices?.groups
        for (const [k, v] of Object.entries(m.groups ?? {})) {
          if (v == null || !String(v).trim()) continue
          const range = idx?.[k]
          args[k] = (range ? original.slice(range[0], range[1]) : String(v)).trim()
        }
        return { kind: 'local', actionId: spec.id, args }
      }
    }
  }
  return null
}

/**
 * Длина, после которой фраза перестаёт быть похожей на команду.
 *
 * Ограничение нужно ДОГАДКАМ — правке опечаток и разбору составных запросов:
 * там длинный текст даёт ложные срабатывания и лишнюю работу.
 *
 * А вот ТОЧНЫМ шаблонам оно только мешало. Они анкерные: либо совпадает вся
 * фраза целиком, либо ничего. Из-за общего лимита «перемести <путь> в <путь>»
 * уходило в облако — два обычных windows-пути дают под полторы сотни символов,
 * и команда с файлами почти всегда переваливала за порог.
 */
const MAX_FUZZY = 120
/** Совсем длинное — уже не команда, а вставленный текст. */
const MAX_EXACT = 600

export function parseIntent(raw: string, specs: IntentSpec[], vocabulary?: string[]): Intent {
  const original = clean(raw)
  const text = original.toLowerCase().replace(/ё/g, 'е')
  if (!text || text.length > MAX_EXACT) return { kind: 'ai' }

  // сперва пробуем точные паттерны — анкерные, они матчат ВСЮ фразу,
  // поэтому многошаговость их не обманет. Матчим по свёртке, аргументы
  // берём из оригинала (регистр имён папок/треков сохраняется)
  const exact = matchSpecs(original, text, specs)
  if (exact) return exact

  // дальше идут догадки — им длинный текст противопоказан
  if (text.length > MAX_FUZZY) return { kind: 'ai' }

  // Шаблон не подошёл — возможно, где-то опечатка («сделай скриншт»).
  // Пробуем поправить ОДНО слово и сопоставить заново.
  //
  // Ключевая защита от ошибочных правок: результат принимается ТОЛЬКО если
  // после замены шаблон реально совпал. Случайно «исправленное» слово почти
  // никогда не даст совпадения с анкерным шаблоном, поэтому мусор отсеивается
  // сам собой. Правку применяем к обеим строкам одинаково, чтобы индексы для
  // извлечения аргументов остались согласованными.
  if (vocabulary?.length && text.length <= 60) {
    const words = text.split(' ')
    let offset = 0
    for (const word of words) {
      const fixed = fixTypo(word, vocabulary)
      if (fixed) {
        const text2 = text.slice(0, offset) + fixed + text.slice(offset + word.length)
        const original2 = original.slice(0, offset) + fixed + original.slice(offset + word.length)
        const retry = matchSpecs(original2, text2, specs)
        if (retry) return retry
      }
      offset += word.length + 1 // +1 на пробел
    }
  }

  // многошаговые и «агентные» запросы
  const padded = ` ${text} `
  if (MULTI_STEP.some((w) => padded.includes(w)) || text.includes(', ')) return { kind: 'ai' }
  if (AGENT_HINTS.some((w) => text.includes(w))) return { kind: 'agent' }

  return { kind: 'ai' }
}
