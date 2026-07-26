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
    const intent = parseIntent(text, registry.intentSpecs())
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
          const outcome = await this.run(action, {}, ctx)
          if (outcome.result?.ok || !action.softFail) {
            trace({ at: Date.now(), text, route: 'смысл', actionId: action.id, semantic: sem, why: 'понято по смыслу' })
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
