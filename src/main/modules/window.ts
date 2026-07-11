/** Управление окном и глобальной горячей клавишей вызова Kira. */
import { BrowserWindow, globalShortcut } from 'electron'
import { getSettings } from './settings'
import { logger } from './logger'

function mainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

/** Показать/сфокусировать окно Kira (горячая клавиша, голосовой вызов). */
export function summonWindow(): void {
  const win = mainWindow()
  if (!win) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
  win.webContents.send('app:summon')
}

/** Регистрация глобальной горячей клавиши вызова Kira из любого окна. */
export function registerHotkey(): void {
  globalShortcut.unregisterAll()
  const accel = getSettings().summonHotkey
  if (!accel) return
  try {
    const ok = globalShortcut.register(accel, () => summonWindow())
    if (ok) logger.info('kira', `Горячая клавиша вызова: ${accel}`)
    else logger.warn('kira', `Горячая клавиша занята: ${accel}`)
  } catch {
    logger.warn('kira', `Не удалось зарегистрировать горячую клавишу: ${accel}`)
  }
}
