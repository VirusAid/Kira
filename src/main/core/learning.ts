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
 *
 * Учимся и на исправлениях. Когда после сработавшей команды человек говорит
 * «нет, я не это просил», связка «фраза → действие» отмечается отвергнутой и
 * больше не восстанавливается сама: молча повторять уже опровергнутую ошибку —
 * худшее, что может делать обучение.
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
  /** Пользователь явно сказал, что это не то — связку больше не оживляем. */
  rejected?: boolean
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
  if (existing?.rejected) return // это уже опровергали — не навязываемся снова
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

/**
 * Похоже ли, что человек поправляет только что выполненное действие.
 *
 * Список намеренно узкий: принять за исправление обычную реплику хуже, чем не
 * заметить его — тогда Kira забудет правильную связку. Проверяем только начало
 * фразы, чтобы «нет, спасибо» отличалось от «нет ли у меня встреч завтра».
 */
export function looksLikeCorrection(text: string): boolean {
  const t = normalize(text)
  if (!t || t.length > 120) return false
  // «нет» — возражение, только если оно самостоятельное или отделено знаком:
  // «нет ли у меня встреч завтра» начинается так же, но это вопрос
  if (/^нет\s*$/.test(t) || /^нет\s*[,.!—-]/.test(t)) return true
  return /^(не то|не это|не так|неправильно|я не (это|того|так)|я (просил|говорил|имел в виду)|стоп,? не)/.test(t)
}

/**
 * Человек поправил: на эту фразу нужно было НЕ это действие.
 *
 * Связка гасится и помечается отвергнутой, чтобы обучение не восстановило её
 * при следующем случайном совпадении. Возвращает true, если было что гасить.
 */
export function noteCorrection(rawPhrase: string, wrongActionId: string): boolean {
  const phrase = normalize(rawPhrase)
  if (!phrase) return false
  const existing = col().all().find((p) => p.phrase === phrase && p.actionId === wrongActionId)
  if (existing) {
    col().patch(existing.id, { count: 0, active: false, rejected: true, at: Date.now() })
    logger.info('core', `поправили: «${phrase}» — это не ${wrongActionId}`)
    if (existing.active) onChange?.()
    return true
  }
  // связка была не выучена, а встроена (шаблон/смысл) — всё равно запоминаем
  // отказ, иначе ядро выучит ту же ошибку с первого же совпадения
  const action = registry.resolve(wrongActionId)
  if (!action) return false
  col().put({ id: newId(), phrase, actionId: action.id, count: 0, active: false, rejected: true, at: Date.now() })
  logger.info('core', `поправили: «${phrase}» — это не ${action.id}`)
  return true
}

/** Выученные фразы для смыслового индекса (только активные). */
export function learnedDocs(): { id: string; text: string; label: string }[] {
  return col().all()
    .filter((p) => p.active && !p.rejected && registry.get(p.actionId))
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
