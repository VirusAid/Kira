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
import type { ActionContext, ExecResult, Intent, KiraAction } from './types'

export interface HandleOutcome {
  handled: boolean
  /** Классификация (для телеметрии/маршрутизации при handled:false). */
  intent: Intent['kind']
  actionId?: string
  result?: ExecResult
  /** Короткая фраза для ответа/озвучки. */
  reply?: string
}

class CommandEngine {
  /** Локальная обработка свободного текста (chat/voice). */
  async tryHandle(text: string, ctx: ActionContext): Promise<HandleOutcome> {
    const intent = parseIntent(text, registry.intentSpecs())
    if (intent.kind !== 'local') return { handled: false, intent: intent.kind }

    const action = registry.get(intent.actionId)
    if (!action) return { handled: false, intent: 'ai' }

    const outcome = await this.run(action, intent.args, ctx)
    // мягкий отказ: эвристика не подтвердилась — пусть решает AI
    if (!outcome.result?.ok && action.softFail && outcome.result?.message !== 'Отменено') {
      logger.info('core', `«${action.id}» не сработал локально — передаю AI`)
      return { handled: false, intent: 'ai' }
    }
    return outcome
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
    const invalid = action.validate?.(args)
    if (invalid) return { handled: false, intent: 'ai' }

    // подтверждение опасного
    if (action.dangerous) {
      const description = action.describe?.(args) ?? action.title
      const approved = ctx.confirm ? await ctx.confirm(description) : false
      if (!approved) {
        bus.emit('action:denied', { action, args, source: ctx.source })
        actionHistory.record({ actionId: action.id, title: action.title, args, ok: false, message: 'Отклонено пользователем', source: ctx.source })
        return {
          handled: true, intent: 'local', actionId: action.id,
          result: { ok: false, message: 'Отменено' }, reply: 'Хорошо, отменила.'
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

    actionHistory.record({ actionId: action.id, title: action.title, args, ok: result.ok, message: result.message, source: ctx.source })
    bus.emit('action:executed', { action, args, result, source: ctx.source })
    logger.action('core', `${action.title}${result.ok ? '' : ' — ошибка: ' + result.message}`)

    return {
      handled: true, intent: 'local', actionId: action.id, result,
      reply: result.ok ? (action.confirmText?.(args) ?? result.message) : result.message
    }
  }
}

export const commandEngine = new CommandEngine()
