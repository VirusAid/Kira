/**
 * Overlay — постоянная плавающая эмблема Kira в углу экрана, поверх ВСЕХ окон.
 * Показывает состояние (слушает/думает/говорит), реагирует на голос. Клик —
 * включить/выключить голосовой режим (говорить с Kira из любого приложения).
 */
import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { getSettings } from './settings'

const W = 132
const H = 132

let overlay: BrowserWindow | null = null
let voiceActive = false
let toggleVoiceCb: (() => void) | null = null
let openMainCb: (() => void) | null = null

function position(win: BrowserWindow): void {
  const pt = screen.getCursorScreenPoint()
  const wa = screen.getDisplayNearestPoint(pt).workArea
  win.setBounds({ x: wa.x + wa.width - W - 16, y: wa.y + 14, width: W, height: H })
}

export function createOverlay(onToggleVoice: () => void, onOpenMain: () => void): void {
  if (overlay) return
  toggleVoiceCb = onToggleVoice
  openMainCb = onOpenMain
  overlay = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true })
  position(overlay)

  if (process.env['ELECTRON_RENDERER_URL']) {
    void overlay.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#overlay')
  } else {
    void overlay.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'overlay' })
  }

  overlay.on('closed', () => { overlay = null })
  overlay.webContents.once('did-finish-load', () => refreshVisibility())
}

export function requestToggleVoice(): void {
  toggleVoiceCb?.()
}

export function requestOpenMain(): void {
  openMainCb?.()
}

/** Показ эмблемы: всегда, если включена «плавающая эмблема» в настройках. */
export function refreshVisibility(): void {
  if (!overlay) return
  const enabled = getSettings().floatingOrb
  if (enabled && !overlay.isVisible()) {
    position(overlay)
    overlay.showInactive()
  } else if (!enabled && overlay.isVisible()) {
    overlay.hide()
  }
}

/** Обновить состояние голоса (из главного renderer) — только анимация. */
export function updateVoice(active: boolean, state: string, level: number): void {
  voiceActive = active
  if (overlay && overlay.isVisible() && !overlay.isDestroyed()) {
    overlay.webContents.send('overlay:state', { state, level, active })
  }
}

export function isOverlayActive(): boolean {
  return voiceActive
}

export function destroyOverlay(): void {
  overlay?.destroy()
  overlay = null
}
