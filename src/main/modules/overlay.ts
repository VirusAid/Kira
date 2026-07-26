/**
 * Overlay — постоянная плавающая эмблема Kira в углу экрана, поверх ВСЕХ окон.
 * Показывает состояние (слушает/думает/говорит), реагирует на голос. Клик —
 * включить/выключить голосовой режим (говорить с Kira из любого приложения).
 *
 * Эмблему можно перетащить куда угодно, и место запоминается. Окно квадратное,
 * а эмблема круглая, поэтому раньше оно перехватывало клики по всему квадрату
 * 132×132, хотя видно только круг: угол окна воровал клик у программы под ним.
 * Теперь мышь проходит насквозь везде, кроме самого круга.
 *
 * Попадание считаем здесь, по реальной позиции курсора, а не в рендерере по
 * пересылаемым событиям мыши: пересылка работает, только пока Chromium получает
 * события окна, а эмблема живёт поверх чужих полноэкранных приложений. Опрос
 * курсора от них не зависит и стоит доли миллисекунды.
 */
import { BrowserWindow, app, screen } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getSettings } from './settings'

const W = 132
const H = 132
/** Радиус видимой эмблемы: размер 112 в окне 132 → круг радиусом 56 по центру. */
const EMBLEM_R = 56
/**
 * Как часто проверяем, на эмблеме ли курсор. 40 мс — чтобы перехват успевал
 * включиться раньше, чем человек донесёт курсор до эмблемы и нажмёт: при более
 * редкой проверке быстрый клик успевал провалиться в окно под эмблемой.
 * Проверка — одно обращение к позиции курсора, это доли микросекунды.
 */
const HOVER_TICK_MS = 40
/** Дольше этого эмблему не тащат — значит, отпускание потерялось. */
const MAX_DRAG_MS = 30_000

let overlay: BrowserWindow | null = null
let voiceActive = false
let toggleVoiceCb: (() => void) | null = null
let openMainCb: (() => void) | null = null
/** Таймер перетаскивания: следим за курсором, пока держат кнопку мыши. */
let dragTimer: NodeJS.Timeout | null = null
/** Таймер проверки наведения — работает, только пока эмблема видна. */
let hoverTimer: NodeJS.Timeout | null = null
let interactive = false

/** Угол по умолчанию — правый верхний, на экране под курсором. */
function defaultPosition(): { x: number; y: number } {
  const pt = screen.getCursorScreenPoint()
  const wa = screen.getDisplayNearestPoint(pt).workArea
  return { x: wa.x + wa.width - W - 16, y: wa.y + 14 }
}

/**
 * Место эмблемы храним отдельным файлом, а не в настройках.
 *
 * Настройки живут копией в интерфейсе и сохраняются оттуда целиком: перетащил
 * эмблему, потом поменял любую галочку — и окно вернулось бы в угол, затёртое
 * устаревшей копией. Положение окна и не является настройкой пользователя.
 */
function positionFile(): string {
  return join(app.getPath('userData'), 'data', 'orb.json')
}

function readSaved(): { x: number; y: number } | null {
  try {
    const raw = JSON.parse(readFileSync(positionFile(), 'utf-8'))
    return typeof raw?.x === 'number' && typeof raw?.y === 'number' ? { x: raw.x, y: raw.y } : null
  } catch {
    return null // файла ещё нет или он повреждён — встанем в угол по умолчанию
  }
}

function writeSaved(x: number, y: number): void {
  try {
    const file = positionFile()
    if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ x, y }), 'utf-8')
  } catch { /* не смогли запомнить место — это не повод падать */ }
}

/**
 * Место эмблемы: сохранённое, если оно попадает на существующий экран.
 * Проверка нужна: пользователь мог отключить второй монитор, и эмблема
 * оказалась бы за границей видимого — «пропала».
 */
function savedPosition(): { x: number; y: number } | null {
  const saved = readSaved()
  if (!saved) return null
  const center = { x: Math.round(saved.x + W / 2), y: Math.round(saved.y + H / 2) }
  const wa = screen.getDisplayNearestPoint(center).workArea
  const onScreen =
    center.x >= wa.x && center.x <= wa.x + wa.width &&
    center.y >= wa.y && center.y <= wa.y + wa.height
  return onScreen ? { x: Math.round(saved.x), y: Math.round(saved.y) } : null
}

function position(win: BrowserWindow): void {
  const p = savedPosition() ?? defaultPosition()
  win.setBounds({ x: p.x, y: p.y, width: W, height: H })
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
  // по умолчанию окно прозрачно для мыши — перехват включается, только когда
  // курсор доходит до круга эмблемы (см. startHoverWatch)
  overlay.setIgnoreMouseEvents(true, { forward: true })
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

/** Перехватывать ли клики окном (включаем, только когда курсор на эмблеме). */
function setInteractive(on: boolean): void {
  if (!overlay || overlay.isDestroyed() || on === interactive) return
  interactive = on
  overlay.setIgnoreMouseEvents(!on, { forward: true })
}

function startHoverWatch(): void {
  if (hoverTimer) return
  hoverTimer = setInterval(() => {
    if (!overlay || overlay.isDestroyed() || !overlay.isVisible()) return
    if (dragTimer) return // тащим — перехват держим включённым
    const pt = screen.getCursorScreenPoint()
    const b = overlay.getBounds()
    const dx = pt.x - (b.x + b.width / 2)
    const dy = pt.y - (b.y + b.height / 2)
    setInteractive(dx * dx + dy * dy <= EMBLEM_R * EMBLEM_R)
  }, HOVER_TICK_MS)
}

function stopHoverWatch(): void {
  if (hoverTimer) { clearInterval(hoverTimer); hoverTimer = null }
  setInteractive(false)
}

/**
 * Перетаскивание. Двигаем окно по позиции КУРСОРА, а не по событиям мыши в
 * рендерере: окно уезжает вслед за курсором, поэтому его собственные координаты
 * во время движения скачут, и перетаскивание получается рваным.
 */
export function startOverlayDrag(): void {
  if (!overlay || overlay.isDestroyed() || dragTimer) return
  const start = screen.getCursorScreenPoint()
  const b = overlay.getBounds()
  const dx = start.x - b.x
  const dy = start.y - b.y
  const startedAt = Date.now()
  dragTimer = setInterval(() => {
    if (!overlay || overlay.isDestroyed()) return endOverlayDrag()
    // страховка: конец перетаскивания приходит из окна эмблемы, и если это
    // событие потеряется, окно вечно бегало бы за курсором
    if (Date.now() - startedAt > MAX_DRAG_MS) return endOverlayDrag()
    const pt = screen.getCursorScreenPoint()
    overlay.setBounds({ x: pt.x - dx, y: pt.y - dy, width: W, height: H })
  }, 16)
}

/** Отпустили — запоминаем место, чтобы эмблема осталась там и после перезапуска. */
export function endOverlayDrag(): void {
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null }
  if (!overlay || overlay.isDestroyed()) return
  const b = overlay.getBounds()
  writeSaved(b.x, b.y)
}

/** Показ эмблемы: всегда, если включена «плавающая эмблема» в настройках. */
export function refreshVisibility(): void {
  if (!overlay) return
  const enabled = getSettings().floatingOrb
  if (enabled && !overlay.isVisible()) {
    position(overlay)
    overlay.showInactive()
    startHoverWatch()
  } else if (!enabled && overlay.isVisible()) {
    overlay.hide()
    stopHoverWatch()
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
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null }
  if (hoverTimer) { clearInterval(hoverTimer); hoverTimer = null }
  overlay?.destroy()
  overlay = null
}
