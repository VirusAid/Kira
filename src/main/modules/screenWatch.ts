/**
 * Screen Watch — непрерывная помощь по контексту экрана (опционально).
 *
 * Когда включено, Kira РАЗ В ~МИНУТУ ненавязчиво смотрит на активное окно и
 * локально (офлайн OCR) читает, что на экране. Если видит явный сигнал — ошибку,
 * исключение, «застрял» — ОДИН раз на контекст мягко предлагает помочь. Сама
 * ничего не делает и никуда не отправляет: скриншот уходит в ИИ только если
 * пользователь согласится. По умолчанию ВЫКЛЮЧЕНО (приватность).
 */
import { BrowserWindow, Notification } from 'electron'
import { logger } from './logger'
import { getSettings } from './settings'
import * as system from './system'

const POLL_MS = 55_000
const MIN_GAP_MS = 4 * 60_000 // не предлагать чаще раза в 4 минуты

// сигналы «тут что-то не так» в тексте экрана
const TROUBLE = /\b(error|exception|traceback|failed|cannot|unable to|denied|not found|undefined|null reference|stack ?trace)\b|ошибк|исключени|не удалось|не найден|отказано в доступе|сбой|аварийн|0x[0-9a-fA-F]{8}/i
// окна, где помощь неуместна (игры/видео/сама Kira)
const SKIP_APPS = /kira|steam|game|игра|vlc|kinopoisk|netflix|youtube.*full|obs/i

let timer: NodeJS.Timeout | null = null
let getWin: (() => BrowserWindow | null) | null = null
let lastOfferKey = ''
let lastOfferAt = 0
let lastTitle = ''

function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0 }
  return String(h)
}

async function tick(): Promise<void> {
  const s = getSettings()
  if (!s.screenAssist || !s.proactiveEnabled) return

  let win: { title: string; process: string }
  try {
    win = await system.foregroundWindow()
  } catch {
    return
  }
  if (!win.title || SKIP_APPS.test(win.title) || SKIP_APPS.test(win.process)) return
  // реагируем только на смену окна — не дёргаем на одном и том же экране
  if (win.title === lastTitle) return
  lastTitle = win.title
  if (Date.now() - lastOfferAt < MIN_GAP_MS) return

  // читаем экран локально (OCR)
  let text = ''
  try {
    const r = await system.ocrScreen()
    if (r.ok) text = String(r.data ?? '')
  } catch {
    return
  }
  if (!text) return

  const m = text.match(TROUBLE)
  if (!m) return

  const key = hash(win.title + '|' + m[0].toLowerCase())
  if (key === lastOfferKey) return // уже предлагали для этого контекста
  lastOfferKey = key
  lastOfferAt = Date.now()

  const offer = `Вижу на экране похоже на проблему («${m[0]}») в «${win.title.slice(0, 40)}». Помочь разобраться?`
  logger.info('screen-watch', `Предложила помощь: ${win.title.slice(0, 50)}`)
  const w = getWin?.()
  // говорим тем же каналом, что и проактивный пульс (renderer озвучит)
  if (w && !w.isDestroyed()) w.webContents.send('pulse:say', offer)
  try { if (Notification.isSupported()) new Notification({ title: 'Kira', body: offer.slice(0, 180) }).show() } catch { /* ignore */ }
}

export function initScreenWatch(getWindow: () => BrowserWindow | null): void {
  if (timer) return
  getWin = getWindow
  timer = setInterval(() => void tick(), POLL_MS)
  logger.info('screen-watch', 'Помощь по контексту экрана готова (включается в настройках)')
}

export function shutdownScreenWatch(): void {
  if (timer) clearInterval(timer)
  timer = null
}
