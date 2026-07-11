/**
 * Protocols — движок последовательностей действий.
 * Протокол = упорядоченный список шагов; движок выполняет их по очереди,
 * транслируя прогресс в UI и записывая всё в логи.
 */
import { BrowserWindow } from 'electron'
import { db } from './db'
import { newId } from './ids'
import { logger } from './logger'
import * as system from './system'
import * as files from './files'
import type { ActionResult, Protocol, ProtocolRunState, ProtocolStep } from '../../shared/types'

const running = new Map<string, { cancelled: boolean }>()

function broadcast(state: ProtocolRunState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('protocol:state', state)
  }
}

export function stepLabel(step: ProtocolStep): string {
  const labels: Record<ProtocolStep['type'], string> = {
    open_app: `Открыть ${step.target}`,
    open_url: `Открыть сайт ${step.target}`,
    open_file: `Открыть ${step.target}`,
    run_command: `Команда: ${step.target}`,
    create_folder: `Создать папку ${step.target}`,
    move_file: `Переместить ${step.target}`,
    copy_file: `Скопировать ${step.target}`,
    delete_file: `Удалить ${step.target}`,
    wait: `Пауза ${step.target} сек`,
    notify: `Уведомление: ${step.target}`,
    ai_prompt: `Запрос к ИИ`,
    set_volume: `Громкость ${step.target}%`,
    screenshot: 'Скриншот',
    type_text: 'Ввод текста'
  }
  return labels[step.type] ?? step.type
}

async function executeStep(step: ProtocolStep): Promise<ActionResult> {
  switch (step.type) {
    case 'open_app': return system.openApp(step.target, step.param)
    case 'open_url': return system.openUrl(step.target)
    case 'open_file': {
      const { shell } = await import('electron')
      const err = await shell.openPath(step.target)
      return err ? { ok: false, message: err } : { ok: true, message: 'Открыто' }
    }
    case 'run_command': return system.runCommand(step.target)
    case 'create_folder': return files.createFolder(step.target)
    case 'move_file': return files.moveFile(step.target, step.param ?? '')
    case 'copy_file': return files.copyFile(step.target, step.param ?? '')
    case 'delete_file': return files.deleteToTrash(step.target)
    case 'wait': {
      const sec = Math.min(600, Math.max(0, Number(step.target) || 1))
      await new Promise((r) => setTimeout(r, sec * 1000))
      return { ok: true, message: `Пауза ${sec} сек` }
    }
    case 'notify': return system.notify('Kira · Протокол', step.target)
    case 'ai_prompt': {
      const { completeChat } = await import('./ai/client')
      const { buildSystemPrompt } = await import('./ai/kira')
      const answer = await completeChat([
        { role: 'system', content: buildSystemPrompt({ withTools: false }) },
        { role: 'user', content: step.target }
      ])
      system.notify('Kira', answer.slice(0, 200))
      return { ok: true, message: answer }
    }
    case 'set_volume': return system.setVolume(Number(step.target))
    case 'screenshot': return system.takeScreenshot()
    case 'type_text': return system.typeText(step.target)
  }
}

export async function runProtocol(protocolId: string): Promise<ActionResult> {
  const protocol = db().protocols.get(protocolId)
  if (!protocol) return { ok: false, message: 'Протокол не найден' }
  if (running.has(protocolId)) return { ok: false, message: 'Протокол уже выполняется' }

  const ctl = { cancelled: false }
  running.set(protocolId, ctl)
  logger.action('protocols', `Запуск протокола «${protocol.name}»`)

  const steps = protocol.steps.filter((s) => s.enabled)
  let failed = ''

  for (let i = 0; i < steps.length; i++) {
    if (ctl.cancelled) {
      broadcast({ protocolId, running: false, currentStep: i, totalSteps: steps.length, error: 'Остановлен' })
      running.delete(protocolId)
      return { ok: false, message: 'Протокол остановлен' }
    }
    const step = steps[i]
    broadcast({ protocolId, running: true, currentStep: i + 1, totalSteps: steps.length, stepLabel: stepLabel(step) })
    try {
      const result = await executeStep(step)
      if (!result.ok) {
        failed = `Шаг ${i + 1} (${stepLabel(step)}): ${result.message}`
        logger.warn('protocols', failed)
      }
    } catch (err) {
      failed = `Шаг ${i + 1}: ${(err as Error).message}`
      logger.error('protocols', failed)
    }
  }

  running.delete(protocolId)
  db().protocols.patch(protocolId, {
    lastRunAt: Date.now(),
    runCount: protocol.runCount + 1
  })
  broadcast({ protocolId, running: false, currentStep: steps.length, totalSteps: steps.length, error: failed || undefined })
  logger.action('protocols', `Протокол «${protocol.name}» завершён${failed ? ' с ошибками' : ''}`)
  return failed
    ? { ok: false, message: `Протокол выполнен с ошибками. ${failed}` }
    : { ok: true, message: `Протокол «${protocol.name}» выполнен (${steps.length} шагов)` }
}

export function stopProtocol(protocolId: string): ActionResult {
  const ctl = running.get(protocolId)
  if (!ctl) return { ok: false, message: 'Протокол не выполняется' }
  ctl.cancelled = true
  return { ok: true, message: 'Останавливаю протокол' }
}

export async function runProtocolByName(name: string): Promise<ActionResult> {
  const q = name.trim().toLowerCase()
  const protocol = db().protocols.all().find(
    (p) => p.name.toLowerCase() === q || p.name.toLowerCase().includes(q)
  )
  if (!protocol) return { ok: false, message: `Протокол «${name}» не найден` }
  return runProtocol(protocol.id)
}

export function duplicateProtocol(protocolId: string): Protocol | null {
  const src = db().protocols.get(protocolId)
  if (!src) return null
  const copy: Protocol = {
    ...src,
    id: newId(),
    name: `${src.name} (копия)`,
    steps: src.steps.map((s) => ({ ...s, id: newId() })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastRunAt: undefined,
    runCount: 0
  }
  db().protocols.put(copy)
  return copy
}
