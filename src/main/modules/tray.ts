/**
 * Tray — постоянное присутствие Kira в системном трее.
 * Окно можно закрыть — Kira свернётся в трей и продолжит работать (напоминания,
 * автоматизация, проактивный пульс). Полный выход — только через меню трея.
 */
import { app, Tray, Menu, BrowserWindow, nativeImage } from 'electron'
import { join } from 'path'
import { logger } from './logger'

/** Фирменная эмблема Kira для трея (та же, что у окна и exe). */
function trayIcon(): Electron.NativeImage {
  const p = app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(__dirname, '../../resources/icon.ico')
  const img = nativeImage.createFromPath(p)
  return img.isEmpty() ? img : img.resize({ width: 16, height: 16 })
}

let tray: Tray | null = null
let quitting = false

export function isQuitting(): boolean {
  return quitting
}

export function setQuitting(v: boolean): void {
  quitting = v
}

export function createTray(getWindow: () => BrowserWindow | null): void {
  if (tray) return
  tray = new Tray(trayIcon())
  tray.setToolTip('Kira — персональный ассистент')

  const show = (): void => {
    const win = getWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  const rebuildMenu = (): void => {
    const menu = Menu.buildFromTemplate([
      { label: 'Открыть Kira', click: show },
      { type: 'separator' },
      {
        label: 'Голосовой режим',
        click: () => { show(); getWindow()?.webContents.send('tray:toggle-voice') }
      },
      { type: 'separator' },
      {
        label: 'Выход',
        click: () => { quitting = true; app.quit() }
      }
    ])
    tray?.setContextMenu(menu)
  }
  rebuildMenu()

  tray.on('click', show)
  tray.on('double-click', show)
  logger.info('kira', 'Kira в трее — работает в фоне')
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
