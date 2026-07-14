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

export function parseIntent(raw: string, specs: IntentSpec[]): Intent {
  const original = clean(raw)
  const text = original.toLowerCase().replace(/ё/g, 'е')
  if (!text || text.length > 120) return { kind: 'ai' }

  // сперва пробуем точные паттерны — анкерные, они матчат ВСЮ фразу,
  // поэтому многошаговость их не обманет. Матчим по свёртке, аргументы
  // берём из оригинала (регистр имён папок/треков сохраняется)
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

  // многошаговые и «агентные» запросы
  const padded = ` ${text} `
  if (MULTI_STEP.some((w) => padded.includes(w)) || text.includes(', ')) return { kind: 'ai' }
  if (AGENT_HINTS.some((w) => text.includes(w))) return { kind: 'agent' }

  return { kind: 'ai' }
}
