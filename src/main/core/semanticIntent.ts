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

/**
 * Планка для действий С АРГУМЕНТОМ. Выше обычной: если ошибиться в
 * безаргументной команде — максимум лишний скриншот, а тут Kira поищет не то
 * или откроет не ту папку. Лучше отдать такой запрос облаку.
 */
const ARG_THRESHOLD = 0.88

export interface SemanticMatch {
  actionId: string
  score: number
  /**
   * Фраза действия, с которой совпал запрос. По ней движок вычитает «командную»
   * часть и получает аргумент: «поищи в сети рецепт борща» минус «поищи в сети»
   * = «рецепт борща».
   */
  docText?: string
  /** Действию нужен аргумент — движок обязан его извлечь, иначе не выполнять. */
  needsArg?: string
}

/**
 * Результат попытки понять смысл — с диагностикой.
 *
 * Раньше слой возвращал либо совпадение, либо null, и было невозможно узнать,
 * ПОЧЕМУ запрос ушёл в облако: слой вообще не запускался, не нашёл кандидата
 * или нашёл, но чуть ниже порога. Теперь лучший кандидат возвращается всегда —
 * это позволяет и трассировать решения, и подбирать порог по фактам.
 */
export interface SemanticProbe {
  /** Совпадение выше порога (можно выполнять). */
  match: SemanticMatch | null
  /** Лучший кандидат, даже если ниже порога — для объяснения решения. */
  best?: SemanticMatch
  /** Почему слой не дал ответа: 'короткая фраза', 'составной запрос', 'движок недоступен'… */
  skipped?: string
  threshold: number
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
 * Возвращает совпадение только при высокой уверенности; лучший кандидат и
 * причина отказа возвращаются всегда — для трассировки решения.
 */
export async function semanticIntent(raw: string): Promise<SemanticProbe> {
  const nope = (skipped: string): SemanticProbe => ({ match: null, skipped, threshold: THRESHOLD })
  const text = normalize(raw)
  // семантику применяем лишь к коротким «командным» фразам: длинные тексты и
  // многословные вопросы — это работа LLM, а не локального сопоставления
  if (!text || text.length < 4 || text.length > 64) return nope('фраза не командной длины')
  if (text.split(/\s+/).length > 8) return nope('слишком много слов')
  // составные запросы отдаём AI целиком: в них команда может быть лишь частью
  // («выключи звук И свет»), а семантика поймала бы только один кусок
  if (/,| и | или | потом | затем | после | а также /.test(` ${text} `)) return nope('составной запрос')

  let semantic: typeof import('../modules/ai/semantic').semantic
  try {
    semantic = (await import('../modules/ai/semantic')).semantic
  } catch {
    return nope('движок смысла недоступен')
  }
  if (!(await semantic.isAvailable())) return nope('движок смысла не установлен')

  let results: { id: string; label: string; text: string; score: number }[]
  try {
    results = await semantic.search(text, docs(), 5)
  } catch {
    return nope('ошибка поиска по смыслу')
  }

  const top = results[0]
  if (!top) return nope('нет кандидатов')

  // Действию нужен аргумент → планка выше: ошибиться с «что именно сделать»
  // дороже, чем с безаргументной командой (там максимум лишний скриншот, тут —
  // поиск не того или открытие не той папки).
  const action = registry.get(top.id)
  const requiredArg = action?.args.find((a) => a.required)?.name
  const need = requiredArg ? ARG_THRESHOLD : THRESHOLD

  const best: SemanticMatch = {
    actionId: top.id, score: top.score, docText: top.text, needsArg: requiredArg
  }
  return {
    match: top.score >= need ? best : null,
    best,
    threshold: need,
    skipped: top.score >= need ? undefined : 'ниже порога уверенности'
  }
}
