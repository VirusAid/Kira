/**
 * Kira Core — самостоятельная платформа управления компьютером.
 *
 * User → Intent Parser → Command Engine → Action API → Controllers → результат.
 * LLM (AI Router) подключается ТОЛЬКО когда ядро не смогло обработать запрос
 * локально. Принцип Local First: что можно сделать без LLM — делается без LLM.
 */
import { logger } from '../modules/logger'
import { actions } from './actions'
import { actionHistory } from './history'
import { registry } from './registry'

export { commandEngine } from './engine'
export { registry } from './registry'
export { bus } from './bus'
export { actionHistory } from './history'
export { parseIntent, normalize } from './intent'
export type { KiraAction, ActionContext, ExecResult, Intent } from './types'

let initialized = false

export function initKiraCore(): void {
  if (initialized) return
  initialized = true
  registry.registerAll(actions)
  logger.info('core', `Kira Core активно: действий в реестре — ${registry.size}`)
}

export function coreFlushSync(): void {
  // история пишется отложенно — сбросить на диск при выходе
  actionHistory.flushSync()
}
