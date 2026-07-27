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
  // Команды расширений подключаются тем же путём, что и встроенные, и живут в
  // том же реестре. Пересборка — на любое изменение: подключили сервер,
  // поправили привязку, сервер обновил список инструментов.
  void wireMcp()
}

/**
 * Связать расширения с ядром. Ошибки здесь не должны мешать Kira работать:
 * расширения — дополнение, а не условие запуска.
 */
async function wireMcp(): Promise<void> {
  try {
    const mcp = await import('../modules/mcp/manager')
    const { syncMcpActions } = await import('./mcpActions')
    const { resetSemanticIndex } = await import('./semanticIntent')
    const resync = (): void => {
      syncMcpActions(mcp.listBindings())
      resetSemanticIndex() // новые фразы должны попасть и в поиск по смыслу
    }
    mcp.setMcpChangeHook(resync)
    resync()
  } catch (err) {
    logger.warn('mcp', `Расширения не подключились: ${(err as Error).message}`)
  }
}

export function coreFlushSync(): void {
  // история пишется отложенно — сбросить на диск при выходе
  actionHistory.flushSync()
}
