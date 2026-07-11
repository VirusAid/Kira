/**
 * Logger — все события приложения пишутся в коллекцию логов
 * и транслируются в renderer в реальном времени.
 */
import { BrowserWindow } from 'electron'
import { db } from './db'
import { newId } from './ids'
import type { LogEntry, LogLevel } from '../../shared/types'

const MAX_LOGS = 5000

export function log(level: LogLevel, source: string, message: string): LogEntry {
  const entry: LogEntry = { id: newId(), level, source, message, createdAt: Date.now() }
  const logs = db().logs
  logs.put(entry)

  // ограничиваем размер журнала — удаляем самые старые
  if (logs.size > MAX_LOGS) {
    const sorted = logs.all().sort((a, b) => a.createdAt - b.createdAt)
    for (const old of sorted.slice(0, logs.size - MAX_LOGS)) logs.delete(old.id)
  }

  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('log:new', entry)
  }
  if (level === 'error') console.error(`[${source}] ${message}`)
  return entry
}

export const logger = {
  info: (source: string, msg: string) => log('info', source, msg),
  warn: (source: string, msg: string) => log('warn', source, msg),
  error: (source: string, msg: string) => log('error', source, msg),
  action: (source: string, msg: string) => log('action', source, msg),
  ai: (source: string, msg: string) => log('ai', source, msg)
}
