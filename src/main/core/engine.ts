/**
 * Command Engine — сердце Kira Core.
 *
 * Путь запроса: текст → Intent Parser → Action (validate → confirm → execute)
 * → история + шина + журнал. LLM не участвует. Если ядро не смогло обработать
 * запрос — вернёт handled:false, и вызывающий слой отдаёт его AI Router'у
 * (существующий LLM-конвейер).
 */
import { logger } from '../modules/logger'
import { bus } from './bus'
import { actionHistory } from './history'
import { parseIntent } from './intent'
import { registry } from './registry'
import { contentOf } from './types'
import { semanticIntent } from './semanticIntent'
import type { ActionContext, ExecResult, Intent, KiraAction } from './types'

export interface HandleOutcome {
  handled: boolean
  /** Классификация (для телеметрии/маршрутизации при handled:false). */
  intent: Intent['kind']
  actionId?: string
  result?: ExecResult
  /** Короткая фраза для ответа/озвучки. */
  reply?: string
  /** Пользователь отклонил опасное действие (не путать с ошибкой исполнения). */
  denied?: boolean
}

/**
 * След принятия решения по одному запросу.
 *
 * Раньше было невозможно ответить, ПОЧЕМУ запрос ушёл в облако: шаблон не
 * подошёл? смысл не понял? понял, но чуть ниже порога? Из-за этого подбор
 * порога был гаданием, а на жалобу «не сработало» нечего было ответить.
 */
export interface Decision {
  at: number
  text: string
  /** Куда в итоге ушёл запрос. */
  route: 'шаблон' | 'смысл' | 'облако' | 'агент'
  actionId?: string
  /** Лучший смысловой кандидат и его балл — даже если не сработал. */
  semantic?: { actionId: string; score: number; threshold: number }
  /** Человеческое объяснение. */
  why: string
}

/** Кольцо последних решений — для диагностики и подбора порога. */
const decisions: Decision[] = []
const MAX_DECISIONS = 50

function trace(d: Decision): void {
  decisions.push(d)
  if (decisions.length > MAX_DECISIONS) decisions.shift()
  const sem = d.semantic ? ` · смысл ${d.semantic.actionId} ${d.semantic.score.toFixed(2)}/${d.semantic.threshold}` : ''
  logger.info('core', `решение: «${d.text.slice(0, 40)}» → ${d.route}${d.actionId ? ` (${d.actionId})` : ''}${sem} — ${d.why}`)
}

/** Последние решения ядра (новые сверху) — для диагностики «почему не сработало». */
export function recentDecisions(limit = 20): Decision[] {
  return [...decisions].reverse().slice(0, limit)
}

/** Слова-связки, которые никогда не являются аргументом сами по себе. */
const FILLER = new Set([
  'мне', 'мне-ка', 'ка', 'пожалуйста', 'плиз', 'давай', 'быстро', 'сейчас', 'потом',
  'что', 'чтото', 'нибудь', 'какой', 'какую', 'какие', 'там', 'тут', 'вот', 'бы',
  'же', 'ну', 'а', 'и', 'в', 'на', 'по', 'для', 'про', 'о', 'об', 'с', 'у', 'к'
])

/**
 * Достать аргумент из фразы, вычтя «командную» часть.
 *
 * Смысловой слой сказал, ЧТО делать, но не сказал, с чем. Берём исходную фразу
 * и убираем слова команды и связки. Остаток — то, ради чего команда:
 * «поищи-ка в сети рецепт борща» → «рецепт борща».
 *
 * ВАЖНО: вычитаем не только совпавшую фразу, но ВЕСЬ словарь действия (его
 * примеры, псевдонимы, фразы). Иначе синоним, которого не было в совпавшей
 * фразе, оставался бы в аргументе: совпало «найди в интернете», а человек
 * сказал «поищи» — и поиск уходил бы по «поищи рецепт борща».
 *
 * Регистр сохраняем (названия треков, папок): режем оригинал, сравниваем по
 * свёрнутой форме.
 */
export function extractArg(rawText: string, actionWords: Iterable<string>): string {
  // Сравниваем по ОСНОВЕ: русская морфология («папка/папку», «музыка/музыку»)
  // рушит точное совпадение, а полноценная лемматизация здесь избыточна.
  // Частицы через дефис («поищи-ка») тоже отбрасываем.
  const fold = (w: string): string => w.toLowerCase().replace(/ё/g, 'е').replace(/[^\wа-я]/gi, '')
  const stem = (w: string): string => {
    const f = fold(w.split('-')[0])
    // 4 символа — минимум, при котором «папка»/«папку» и «музыка»/«музыку»
    // сходятся, а разные слова ещё не начинают склеиваться
    return f.length > 4 ? f.slice(0, 4) : f
  }

  /*
   * Командное слово — то, что НАЧИНАЕТ какую-то фразу действия (глагол) либо
   * встречается в НЕСКОЛЬКИХ фразах (служебный каркас вроде «в интернете»).
   *
   * Простое «все слова из примеров» не годится: в примерах сидят образцы
   * аргументов («открой загрузки», «загугли рецепт борща») — по ним мы бы
   * срезали сам аргумент. Одноразовое слово из одного примера почти всегда
   * образец аргумента, а не команда.
   */
  const seen = new Map<string, number>()
  const starters = new Set<string>()
  for (const phrase of actionWords) {
    const words = phrase.split(/\s+/).map(stem).filter(Boolean)
    if (words[0]) starters.add(words[0])
    for (const w of new Set(words)) seen.set(w, (seen.get(w) ?? 0) + 1)
  }
  const commandWords = new Set<string>(starters)
  for (const [w, n] of seen) if (n >= 2) commandWords.add(w)

  // Срезаем командный ПРЕФИКС и останавливаемся на первом «своём» слове.
  // Вычитать слова по всей фразе нельзя: в примерах действий сидят образцы
  // аргументов («загугли рецепт борща»), и такой поиск съел бы сам аргумент.
  // В русских командах аргумент всегда идёт после глагола, поэтому префикс —
  // надёжный и предсказуемый признак.
  const words = rawText.trim().split(/\s+/)
  let start = 0
  while (start < words.length) {
    const f = fold(words[start])
    const st = stem(words[start])
    if (!f) { start++; continue }
    if (commandWords.has(st) || FILLER.has(f)) { start++; continue }
    break
  }
  return words.slice(start).join(' ').replace(/^[\s,.!?—-]+|[\s,.!?]+$/g, '').trim()
}

/** Последнее отменяемое действие — для «отмени»/undo_last. */
interface UndoableRun {
  action: KiraAction
  args: Record<string, string>
  at: number
}

class CommandEngine {
  private lastUndoable: UndoableRun | null = null

  /** Локальная обработка свободного текста (chat/voice). */
  async tryHandle(text: string, ctx: ActionContext): Promise<HandleOutcome> {
    const intent = parseIntent(text, registry.intentSpecs(), registry.commandVocabulary())
    if (intent.kind === 'local') {
      const action = registry.get(intent.actionId)
      if (!action) {
        trace({ at: Date.now(), text, route: 'облако', why: 'шаблон указал на неизвестное действие' })
        return { handled: false, intent: 'ai' }
      }

      const outcome = await this.run(action, intent.args, ctx)
      // мягкий отказ: эвристика не подтвердилась — пусть решает AI
      // (но отказ ПОЛЬЗОВАТЕЛЯ от опасного — окончателен, в AI не уходит)
      if (!outcome.result?.ok && action.softFail && !outcome.denied) {
        trace({ at: Date.now(), text, route: 'облако', actionId: action.id, why: 'действие мягко отказалось — передаю дальше' })
        return { handled: false, intent: 'ai' }
      }
      trace({ at: Date.now(), text, route: 'шаблон', actionId: action.id, why: 'точное совпадение шаблона' })
      return outcome
    }

    // regex промахнулся, но фраза может быть командой в непредусмотренной форме
    // — пробуем понять её СМЫСЛ через эмбеддинги (только для 'ai', не 'agent')
    if (intent.kind === 'ai') {
      const probe = await semanticIntent(text)
      const sem = probe.best
        ? { actionId: probe.best.actionId, score: probe.best.score, threshold: probe.threshold }
        : undefined
      if (probe.match) {
        const action = registry.get(probe.match.actionId)
        if (action) {
          // Действию нужен аргумент — достаём его из фразы. Не достали (человек
          // сказал только «поищи») — выполнять нечего, пусть спросит облако.
          const args: Record<string, string> = {}
          const argName = probe.match.needsArg
          if (argName) {
            // весь словарь действия: примеры, псевдонимы, фразы и совпавшая фраза
            const vocabulary = [
              ...action.examples, ...action.aliases, ...(action.phrases ?? []),
              probe.match.docText ?? ''
            ]
            const value = extractArg(text, vocabulary)
            if (!value) {
              trace({ at: Date.now(), text, route: 'облако', actionId: action.id, semantic: sem, why: `по смыслу это «${action.id}», но не видно, с чем работать` })
              return { handled: false, intent: 'ai' }
            }
            args[argName] = value
          }

          const outcome = await this.run(action, args, ctx)
          if (outcome.result?.ok || !action.softFail) {
            const withArg = argName ? ` · ${argName}=«${args[argName]}»` : ''
            trace({ at: Date.now(), text, route: 'смысл', actionId: action.id, semantic: sem, why: `понято по смыслу${withArg}` })
            return outcome
          }
          trace({ at: Date.now(), text, route: 'облако', actionId: action.id, semantic: sem, why: 'по смыслу нашлось, но действие отказалось' })
          return { handled: false, intent: 'ai' }
        }
      }
      trace({ at: Date.now(), text, route: 'облако', semantic: sem, why: probe.skipped ?? 'ядро не распознало' })
      return { handled: false, intent: intent.kind }
    }

    trace({ at: Date.now(), text, route: 'агент', why: 'похоже на составную задачу для агента' })
    return { handled: false, intent: intent.kind }
  }

  /**
   * Отмена последнего отменяемого действия ядра; если такого нет —
   * пробуем файловую отмену (modules/undo, операции LLM-инструментов).
   */
  async undoLast(ctx: ActionContext): Promise<ExecResult> {
    const u = this.lastUndoable
    if (u?.action.undo) {
      this.lastUndoable = null
      let result: ExecResult
      try {
        result = await u.action.undo(u.args)
      } catch (err) {
        result = { ok: false, message: (err as Error).message }
      }
      actionHistory.record({
        actionId: `${u.action.id}:undo`, title: `Отмена: ${u.action.title}`,
        args: u.args, ok: result.ok, message: result.message, source: ctx.source
      })
      logger.action('core', `Отмена «${u.action.title}»${result.ok ? '' : ' — ошибка: ' + result.message}`)
      return result.ok ? { ...result, message: `Отменила: ${u.action.title.toLowerCase()}` } : result
    }
    // файловые операции LLM-инструментов (move/rename/write/delete…)
    const { undoLast, canUndo } = await import('../modules/undo')
    if (canUndo()) return undoLast()
    return { ok: false, message: 'Нечего отменять — недавних отменяемых действий нет' }
  }

  /** Прямой вызов по id (агенты, автоматизация, hotkeys, UI, LLM-протокол). */
  async executeById(idOrAlias: string, args: Record<string, string>, ctx: ActionContext): Promise<ExecResult | null> {
    const action = registry.resolve(idOrAlias)
    if (!action) return null
    const outcome = await this.run(action, args, ctx)
    return outcome.result ?? { ok: false, message: 'Не выполнено' }
  }

  private async run(action: KiraAction, args: Record<string, string>, ctx: ActionContext): Promise<HandleOutcome> {
    // доступность
    if (action.canExecute && !(await action.canExecute())) {
      return { handled: false, intent: 'ai' }
    }
    // обязательные аргументы + валидация
    for (const spec of action.args) {
      if (spec.required && !args[spec.name]?.trim()) {
        return {
          handled: true, intent: 'local', actionId: action.id,
          result: { ok: false, message: `Не хватает аргумента «${spec.name}» (${spec.description})` },
          reply: `Уточни, ${spec.description.toLowerCase()}.`
        }
      }
    }
    let invalid: string | null = null
    try { invalid = action.validate?.(args) ?? null } catch { invalid = 'ошибка валидации' }
    if (invalid) return { handled: false, intent: 'ai' }

    // подтверждение опасного
    if (action.dangerous) {
      const description = action.describe?.(args) ?? action.title
      const approved = ctx.confirm ? await ctx.confirm(description) : false
      if (!approved) {
        bus.emit('action:denied', { action, args, source: ctx.source })
        actionHistory.record({ actionId: action.id, title: action.title, args, ok: false, message: 'Отклонено пользователем', source: ctx.source })
        return {
          handled: true, intent: 'local', actionId: action.id, denied: true,
          result: { ok: false, message: 'Отклонено пользователем' }, reply: 'Хорошо, отменила.'
        }
      }
    }

    // исполнение
    let result: ExecResult
    try {
      result = await action.execute(args, ctx)
    } catch (err) {
      result = { ok: false, message: (err as Error).message }
    }

    // запоминаем для «отмени» — только успешные и отменяемые
    if (result.ok && action.undo) this.lastUndoable = { action, args, at: Date.now() }

    actionHistory.record({ actionId: action.id, title: action.title, args, ok: result.ok, message: result.message, source: ctx.source })
    bus.emit('action:executed', { action, args, result, source: ctx.source })
    logger.action('core', `${action.title}${result.ok ? '' : ' — ошибка: ' + result.message}`)

    // Локальный ответ пользователю: статус + содержимое действия. Без второго
    // контент-действия (текст с экрана, история буфера, сниппеты, поиск по
    // документам) показывали бы лишь статус вроде «Распознала текст».
    // confirmText (свой готовый ответ действия) имеет приоритет.
    const body = contentOf(result)
    const dataStr = body ? `\n${body}` : ''
    return {
      handled: true, intent: 'local', actionId: action.id, result,
      reply: result.ok ? (action.confirmText?.(args) ?? result.message + dataStr) : result.message
    }
  }
}

export const commandEngine = new CommandEngine()
