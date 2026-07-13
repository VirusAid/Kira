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

/**
 * AI Actions: по горячей клавише читаем ВЫДЕЛЕННЫЙ в активном окне текст и
 * открываем меню действий Kira (перевести/объяснить/переписать/…).
 */
async function triggerAiActions(): Promise<void> {
  const { readSelection } = await import('./system')
  const win = mainWindow()
  const r = await readSelection()
  if (!r.ok || !r.data) {
    const { Notification } = await import('electron')
    new Notification({ title: 'Kira · AI Actions', body: 'Сначала выдели текст, затем нажми сочетание.' }).show()
    return
  }
  if (!win) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
  win.webContents.send('ai-actions:open', String(r.data))
}

/** Регистрация глобальных горячих клавиш (вызов Kira + AI Actions). */
export function registerHotkey(): void {
  globalShortcut.unregisterAll()
  const s = getSettings()

  if (s.summonHotkey) {
    try {
      const ok = globalShortcut.register(s.summonHotkey, () => summonWindow())
      if (ok) logger.info('kira', `Горячая клавиша вызова: ${s.summonHotkey}`)
      else logger.warn('kira', `Горячая клавиша занята: ${s.summonHotkey}`)
    } catch {
      logger.warn('kira', `Не удалось зарегистрировать горячую клавишу: ${s.summonHotkey}`)
    }
  }

  if (s.aiActionsHotkey) {
    try {
      const ok = globalShortcut.register(s.aiActionsHotkey, () => void triggerAiActions())
      if (ok) logger.info('kira', `AI Actions: ${s.aiActionsHotkey}`)
      else logger.warn('kira', `Клавиша AI Actions занята: ${s.aiActionsHotkey}`)
    } catch {
      logger.warn('kira', `Не удалось зарегистрировать AI Actions: ${s.aiActionsHotkey}`)
    }
  }
}
