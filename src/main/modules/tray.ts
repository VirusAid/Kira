/**
 * Tray — постоянное присутствие Kira в системном трее.
 * Окно можно закрыть — Kira свернётся в трей и продолжит работать (напоминания,
 * автоматизация, проактивный пульс). Полный выход — только через меню трея.
 */
import { app, Tray, Menu, BrowserWindow, nativeImage } from 'electron'
import { logger } from './logger'

// фиолетовый орб-иконка (сгенерирован программно, без внешних ассетов)
const ICON_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAC6UlEQVR42tWXb2sTQRDG+6JfIV+h36XfJSBq/1DJCSW0FM6KEFtRqIIEj4gUKeIboTY2tk1sq9USi6Ii+KJgckna2NRTHPnNXsIZz7TFlFwXBpbd2ZlnnpmdvevrO2vDsb2YY3uDju3FHduzfIn7a7HTctrvO8k5tidHSM7X7e+Wc4ztHsNxu3Am/r9ULwSNLp77KksXSrI0VJLscEmyI2Ujw2aNPXTagCycODWO7Q04tlf8w/HFkmRHy7I8VpblhCs5y5XcZV8sV9fYQwfdNiDYGjhJ5C3nT8+bSJcvldXZynhFVpMVWZ2oytqkEeassYcOupzhbBuI2HEAtGiH0mejZcklfMcTVclPVaVg16QwXZMXV40wZ409dBRIwtWz2Aim4zgF14pcnVuuhI3NmX3ZnPVlZl82Unuyfm1PCldqsjZVlZVkRc9io42JeKerttvMORRq5MlKKICtubps3f5mZK4ur27VZfOGAQIr+SaIhKu2AjWxG3pFg9FTROQRKokmbGynD2T7ni/pA3lz14B5ebMuG9f3FYQyMV5RW9jsyEKzyWj0o6bgyCeUho23DxqyM3+owryYaSiQ13d8ECmTDmxgC5sBFnJhld8qPK4TyKGRvIaNd4++y/vHRpjvPDyU4n0DAiZIB2fzTRbG/irIWBDAYAvAUEnvNNeKyiYS8gvFRIkjnH544snHxR8qzFlTEJmG6nJGWbBragub2A4AGAzNP12N6lX6p2ta4RQZkUE10eLwU/anfH5uhDlr7KGjLMzV9Sw2NA2Wq7ZD68B/0QyAEZN/GgyFxDWDUoqNfBMpUeP4y/ovFeasKQvzh6qraZj1i3HSr4ORchCAFSkAPU9Bz4uw4zXkSmka0gd61XDU1Wt4VCMiEpoLTUZBZBrdbURHtWIKifaKYaKD4tNoxf98jPJNECmTDvLb9ceo03OMIaKBUvKqQLr9HEfigyQSn2Q9/yiNxGd5JH5MIvNrFomf09McvwEW9vOvCQHO/QAAAABJRU5ErkJggg=='

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
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${ICON_B64}`)
  tray = new Tray(icon)
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
