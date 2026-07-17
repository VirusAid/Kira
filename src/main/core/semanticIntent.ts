/**
 * Семантический слой Intent Parser — «понимание смысла», а не буквы.
 *
 * Точный regex-парсер ловит команды в предусмотренных формулировках. Этот слой
 * подключается ПОСЛЕ него как fallback: когда regex промахнулся, а запрос всё же
 * похож на локальную команду («сделай погромче», «что там с погодой»), мы
 * сравниваем его эмбеддинг с фразами безопасных безаргументных действий и, если
 * уверенность высока, выполняем локально — без обращения к LLM.
 *
 * Консервативен: только короткие фразы, только высокий порог косинуса, только
 * действия без обязательных аргументов. Малейшее сомнение → отдаём AI Router.
 */
import { normalize } from './intent'
import { registry } from './registry'

/**
 * Порог косинусной близости (модель paraphrase-multilingual-MiniLM-L12-v2).
 * Подобран эмпирически: на 47 «непохожих» фразах (вопросы, чужие команды,
 * бытовые просьбы) максимум ложного совпадения — 0.813 («спой песню»→media_prev).
 * Планка 0.84 даёт нулевой ложняк при хорошем покрытии перефразировок. Точность
 * важнее полноты: лучше отдать команду AI, чем выполнить НЕ ТО.
 */
const THRESHOLD = 0.84

export interface SemanticMatch {
  actionId: string
  score: number
}

let docsCache: { id: string; text: string; label: string }[] | null = null
function docs(): { id: string; text: string; label: string }[] {
  if (!docsCache) docsCache = registry.semanticDocs()
  return docsCache
}

/** Сбросить кэш документов (после регистрации новых действий). */
export function resetSemanticIndex(): void {
  docsCache = null
}

/**
 * Пытается семантически распознать локальную команду.
 * Возвращает совпадение только при высокой уверенности, иначе null.
 */
export async function semanticIntent(raw: string): Promise<SemanticMatch | null> {
  const text = normalize(raw)
  // семантику применяем лишь к коротким «командным» фразам: длинные тексты и
  // многословные вопросы — это работа LLM, а не локального сопоставления
  if (!text || text.length < 4 || text.length > 64) return null
  if (text.split(/\s+/).length > 8) return null
  // составные запросы отдаём AI целиком: в них команда может быть лишь частью
  // («выключи звук И свет»), а семантика поймала бы только один кусок
  if (/,| и | или | потом | затем | после | а также /.test(` ${text} `)) return null

  let semantic: typeof import('../modules/ai/semantic').semantic
  try {
    semantic = (await import('../modules/ai/semantic')).semantic
  } catch {
    return null
  }
  if (!(await semantic.isAvailable())) return null

  let results: { id: string; label: string; text: string; score: number }[]
  try {
    results = await semantic.search(text, docs(), 5)
  } catch {
    return null
  }

  const best = results[0]
  if (!best || best.score < THRESHOLD) return null
  return { actionId: best.id, score: best.score }
}
