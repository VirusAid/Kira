/**
 * Undo — история обратимых действий Kira и их отмена. Файловые операции
 * (перемещение, переименование, создание, копирование, запись, удаление в
 * корзину) записывают, как их откатить. «Отмени» возвращает всё назад.
 */
import { BrowserWindow } from 'electron'
import { logger } from './logger'
import type { ActionResult } from '../../shared/types'

export interface UndoEntry {
  id: string
  label: string
  at: number
  undo: () => Promise<void>
}

const stack: UndoEntry[] = []
const MAX = 40

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('undo:changed', historyLabels())
  }
}

export function pushUndo(label: string, undo: () => Promise<void>): void {
  stack.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), label, at: Date.now(), undo })
  if (stack.length > MAX) stack.shift()
  broadcast()
}

export function historyLabels(): { id: string; label: string; at: number }[] {
  return stack.slice(-15).reverse().map((e) => ({ id: e.id, label: e.label, at: e.at }))
}

export function canUndo(): boolean {
  return stack.length > 0
}

export async function undoLast(): Promise<ActionResult> {
  const entry = stack.pop()
  if (!entry) return { ok: false, message: 'Нечего отменять' }
  broadcast()
  try {
    await entry.undo()
    logger.action('undo', `Отменено: ${entry.label}`)
    return { ok: true, message: `Отменила: ${entry.label}` }
  } catch (err) {
    return { ok: false, message: `Не удалось отменить «${entry.label}»: ${(err as Error).message}` }
  }
}

export function clearUndo(): void {
  stack.length = 0
  broadcast()
}
