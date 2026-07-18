/**
 * Worker — фоновые автономные задачи Kira.
 *
 * Долгую цель («наведи порядок в загрузках», «собери информацию и сделай
 * заметку») Kira уносит в фон через worker: диалог остаётся живым и
 * перебиваемым, а задача выполняется параллельно на agentRunner. По завершении
 * пользователь получает системное уведомление и событие в интерфейс, а сама
 * Kira может проверить статус инструментом worker_status.
 */
import { BrowserWindow } from 'electron'
import { runAgentLoop } from './agentRunner'
import { logger } from '../logger'
import { newId } from '../ids'
import * as system from '../system'

export type WorkerStatus = 'running' | 'done' | 'failed' | 'cancelled'

export interface WorkerTask {
  id: string
  goal: string
  status: WorkerStatus
  steps: number
  lastStep?: string
  result?: string
  skipped: string[]
  startedAt: number
  finishedAt?: number
}

interface InternalTask extends WorkerTask { cancel?: boolean }

const MAX_HISTORY = 30

class WorkerManager {
  private tasks = new Map<string, InternalTask>()
  private getWindow: (() => BrowserWindow | null) | null = null

  setWindowGetter(fn: () => BrowserWindow | null): void {
    this.getWindow = fn
  }

  /** Запустить цель в фоне. Возвращает задачу сразу — не дожидаясь выполнения. */
  spawn(goal: string): WorkerTask {
    const clean = goal.trim()
    const task: InternalTask = {
      id: newId(), goal: clean, status: 'running', steps: 0, skipped: [], startedAt: Date.now()
    }
    this.tasks.set(task.id, task)
    this.trim()
    logger.info('worker', `Фоновая задача запущена: ${clean.slice(0, 60)}`)
    void this.execute(task)
    return this.snapshot(task)
  }

  private async execute(task: InternalTask): Promise<void> {
    try {
      const res = await runAgentLoop({
        goal: task.goal,
        maxRounds: 24,
        timeoutMs: 10 * 60_000,
        onStep: (s) => {
          task.steps = s.round
          if (s.text) task.lastStep = s.text.slice(0, 200)
          this.emit(task)
        },
        isCancelled: () => !!task.cancel
      })
      task.status = task.cancel ? 'cancelled' : res.ok ? 'done' : 'failed'
      task.result = res.summary
      task.skipped = res.skippedDangerous
    } catch (err) {
      task.status = 'failed'
      task.result = `Сбой: ${(err as Error).message}`
    }
    task.finishedAt = Date.now()
    this.notifyDone(task)
    this.emit(task)
  }

  list(): WorkerTask[] {
    return [...this.tasks.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((t) => this.snapshot(t))
  }

  get(id: string): WorkerTask | null {
    const t = this.tasks.get(id)
    return t ? this.snapshot(t) : null
  }

  cancel(id?: string): boolean {
    if (id) {
      const t = this.tasks.get(id)
      if (t && t.status === 'running') { t.cancel = true; return true }
      return false
    }
    // без id — отменяем все активные
    let any = false
    for (const t of this.tasks.values()) {
      if (t.status === 'running') { t.cancel = true; any = true }
    }
    return any
  }

  activeCount(): number {
    let n = 0
    for (const t of this.tasks.values()) if (t.status === 'running') n++
    return n
  }

  /** Человекочитаемая сводка для инструмента worker_status. */
  statusText(): string {
    const all = this.list()
    if (!all.length) return 'Фоновых задач нет.'
    const running = all.filter((t) => t.status === 'running')
    const finished = all.filter((t) => t.status !== 'running').slice(0, 5)
    const lines: string[] = []
    for (const t of running) {
      lines.push(`⏳ выполняется (${t.steps} шаг.): «${t.goal.slice(0, 60)}»${t.lastStep ? ` — ${t.lastStep}` : ''}`)
    }
    for (const t of finished) {
      const mark = t.status === 'done' ? '✅' : t.status === 'cancelled' ? '⏹️' : '⚠️'
      lines.push(`${mark} ${t.goal.slice(0, 60)}: ${t.result?.slice(0, 160) ?? ''}`)
    }
    return lines.join('\n')
  }

  private notifyDone(task: InternalTask): void {
    const title =
      task.status === 'done' ? 'Kira — задача выполнена'
      : task.status === 'cancelled' ? 'Kira — задача отменена'
      : 'Kira — задача не завершена'
    const body = `${task.goal.slice(0, 50)}${task.result ? ' — ' + task.result.slice(0, 140) : ''}`
    try { system.notify(title, body) } catch { /* уведомления недоступны */ }
    logger.info('worker', `Фоновая задача ${task.status}: ${task.goal.slice(0, 50)}`)
  }

  private emit(task: InternalTask): void {
    const win = this.getWindow?.()
    if (win && !win.isDestroyed()) {
      win.webContents.send('worker:update', this.snapshot(task))
    }
  }

  private snapshot(t: InternalTask): WorkerTask {
    return {
      id: t.id, goal: t.goal, status: t.status, steps: t.steps,
      lastStep: t.lastStep, result: t.result, skipped: [...t.skipped],
      startedAt: t.startedAt, finishedAt: t.finishedAt
    }
  }

  /** Держим историю компактной: удаляем самые старые ЗАВЕРШЁННЫЕ задачи. */
  private trim(): void {
    if (this.tasks.size <= MAX_HISTORY) return
    const finished = [...this.tasks.values()]
      .filter((t) => t.status !== 'running')
      .sort((a, b) => (a.finishedAt ?? a.startedAt) - (b.finishedAt ?? b.startedAt))
    while (this.tasks.size > MAX_HISTORY && finished.length) {
      const old = finished.shift()!
      this.tasks.delete(old.id)
    }
  }
}

export const workers = new WorkerManager()
