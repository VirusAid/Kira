/**
 * Обучение на промахах — Kira запоминает ТВОИ формулировки.
 *
 * Когда ядро не распознало фразу и запрос ушёл в облако, а нейросеть в итоге
 * выполнила конкретное действие — это готовая размеченная пара «фраза →
 * действие». Раньше она просто выбрасывалась. Теперь копится, и после
 * повторения фраза попадает в смысловой индекс: в следующий раз Kira ответит
 * сама — мгновенно, бесплатно и офлайн.
 *
 * Осторожность важнее скорости обучения, потому что выученная ерунда будет
 * срабатывать молча:
 *  • учимся только на УСПЕШНЫХ действиях после промаха ядра;
 *  • только если за запрос выполнено РОВНО ОДНО действие (иначе непонятно,
 *    какое из них было смыслом фразы);
 *  • опасные действия не учим никогда;
 *  • фраза активируется лишь со ВТОРОГО раза — случайность не закрепляется;
 *  • всё выученное видно пользователю, и это можно забыть.
 */
import { Collection } from '../modules/storage'
import { logger } from '../modules/logger'
import { newId } from '../modules/ids'
import { normalize } from './intent'
import { registry } from './registry'

export interface LearnedPhrase {
  id: string
  /** Свёрнутая фраза пользователя (как её увидит смысловой слой). */
  phrase: string
  actionId: string
  /** Сколько раз эта пара подтверждалась. */
  count: number
  /** Участвует ли в распознавании (включается со второго подтверждения). */
  active: boolean
  at: number
}

/** Со скольких подтверждений фраза начинает работать. */
const ACTIVATE_AT = 2

let _col: Collection<LearnedPhrase> | null = null
function col(): Collection<LearnedPhrase> {
  if (!_col) _col = new Collection<LearnedPhrase>('learned-phrases')
  return _col
}

/** Сбросить кэш смыслового индекса — он пересоберётся с новыми фразами. */
let onChange: (() => void) | null = null
export function setLearningChangeHook(fn: () => void): void {
  onChange = fn
}

/**
 * Зафиксировать пару «фраза → действие» после того, как ядро промахнулось,
 * а нейросеть выполнила действие успешно.
 */
export function noteMiss(rawPhrase: string, actionId: string): void {
  const phrase = normalize(rawPhrase)
  // те же рамки, что у смыслового слоя: учить длинные тексты бессмысленно
  if (phrase.length < 4 || phrase.length > 64) return
  if (phrase.split(/\s+/).length > 8) return

  const action = registry.resolve(actionId)
  if (!action) return
  if (action.dangerous || action.noSemantic) return // опасное не учим никогда

  const existing = col().all().find((p) => p.phrase === phrase && p.actionId === action.id)
  if (existing) {
    const count = existing.count + 1
    const active = count >= ACTIVATE_AT
    col().patch(existing.id, { count, active, at: Date.now() })
    if (active && !existing.active) {
      logger.info('core', `выучила: «${phrase}» → ${action.id}`)
      onChange?.()
    }
    return
  }
  col().put({ id: newId(), phrase, actionId: action.id, count: 1, active: false, at: Date.now() })
}

/** Выученные фразы для смыслового индекса (только активные). */
export function learnedDocs(): { id: string; text: string; label: string }[] {
  return col().all()
    .filter((p) => p.active && registry.get(p.actionId))
    .map((p) => ({ id: p.actionId, text: p.phrase, label: p.actionId }))
}

/** Всё выученное — для показа пользователю. */
export function listLearned(): LearnedPhrase[] {
  return col().all().sort((a, b) => b.at - a.at)
}

/** Забыть одну фразу или всё сразу. */
export function forgetLearned(phraseOrAll?: string): number {
  const all = col().all()
  const target = !phraseOrAll || phraseOrAll === 'всё' || phraseOrAll === 'все'
    ? all
    : all.filter((p) => p.phrase.includes(normalize(phraseOrAll)))
  for (const p of target) col().delete(p.id)
  if (target.length) onChange?.()
  return target.length
}
