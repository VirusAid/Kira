/**
 * Automation — триггеры автоматического запуска протоколов:
 *  • schedule   — по расписанию (cron-выражение)
 *  • app_start  — при запуске Kira
 *  • file_watch — при появлении нового файла в папке
 */
import cron, { ScheduledTask } from 'node-cron'
import chokidar, { FSWatcher } from 'chokidar'
import { db } from './db'
import { logger } from './logger'
import { runProtocol } from './protocols'
import type { Automation } from '../../shared/types'

const cronTasks = new Map<string, ScheduledTask>()
const watchers = new Map<string, FSWatcher>()

function fire(automation: Automation, reason: string): void {
  logger.action('automation', `Сработала автоматизация «${automation.name}» (${reason})`)
  db().automations.patch(automation.id, {
    lastFiredAt: Date.now(),
    fireCount: automation.fireCount + 1
  })
  void runProtocol(automation.protocolId)
}

function arm(automation: Automation): void {
  if (!automation.enabled) return

  if (automation.trigger === 'schedule') {
    if (!cron.validate(automation.triggerParam)) {
      logger.warn('automation', `Неверное cron-выражение в «${automation.name}»: ${automation.triggerParam}`)
      return
    }
    const task = cron.schedule(automation.triggerParam, () => {
      const fresh = db().automations.get(automation.id)
      if (fresh?.enabled) fire(fresh, 'расписание')
    })
    cronTasks.set(automation.id, task)
  }

  if (automation.trigger === 'file_watch') {
    const watcher = chokidar.watch(automation.triggerParam, {
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 300 }
    })
    watcher.on('add', () => {
      const fresh = db().automations.get(automation.id)
      if (fresh?.enabled) fire(fresh, 'новый файл')
    })
    watcher.on('error', (err) =>
      logger.warn('automation', `Наблюдение за папкой «${automation.triggerParam}»: ${(err as Error).message}`)
    )
    watchers.set(automation.id, watcher)
  }
}

function disarm(automationId: string): void {
  cronTasks.get(automationId)?.stop()
  cronTasks.delete(automationId)
  void watchers.get(automationId)?.close()
  watchers.delete(automationId)
}

/** Перезарядить один триггер после изменения. */
export function rearmAutomation(automationId: string): void {
  disarm(automationId)
  const automation = db().automations.get(automationId)
  if (automation) arm(automation)
}

export function removeAutomationTrigger(automationId: string): void {
  disarm(automationId)
}

/** Инициализация при старте приложения. */
export function initAutomations(): void {
  const automations = db().automations.all()
  for (const a of automations) arm(a)

  // триггеры «при запуске»
  for (const a of automations) {
    if (a.enabled && a.trigger === 'app_start') {
      setTimeout(() => fire(a, 'запуск Kira'), 4000)
    }
  }
  logger.info('automation', `Автоматизация активна: ${automations.filter((a) => a.enabled).length} сценариев`)
}

export function shutdownAutomations(): void {
  for (const id of [...cronTasks.keys()]) disarm(id)
  for (const id of [...watchers.keys()]) disarm(id)
}
