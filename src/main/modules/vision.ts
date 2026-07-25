/**
 * Vision — постоянная осведомлённость Kira об экране.
 *
 * Kira «смотрит» каждые несколько секунд, но работает умно: сначала берёт
 * крошечный отпечаток экрана (доли миллисекунды) и, если картинка не менялась,
 * НИЧЕГО больше не делает. Дорогое распознавание текста запускается только
 * когда экран реально изменился — и не чаще, чем раз в несколько секунд, чтобы
 * просмотр видео не грузил компьютер.
 *
 * Благодаря этому «всегда в курсе» стоит почти ничего: на статичном экране —
 * один крошечный снимок раз в тик.
 *
 * Приватность: всё распознавание локальное, контекст живёт только в памяти
 * процесса. Наружу ничего не уходит: ИИ получает текст экрана лишь тогда, когда
 * пользователь сам спрашивает про экран. Включается пользователем (screenAssist).
 */
import { BrowserWindow, Notification } from 'electron'
import { logger } from './logger'
import { getSettings } from './settings'
import * as system from './system'

/** Как часто заглядывать на экран (дешёвая проверка). */
const TICK_MS = 3_000
/** Насколько должна измениться картинка, чтобы считать это сменой контекста. */
const CHANGE_THRESHOLD = 0.06
/** Не запускать распознавание чаще — иначе видео/анимация грузили бы CPU. */
const MIN_OCR_GAP_MS = 7_000
/** Не предлагать помощь чаще одного раза в несколько минут. */
const MIN_OFFER_GAP_MS = 4 * 60_000

// сигналы «тут что-то не так» в тексте экрана
const TROUBLE = /\b(error|exception|traceback|failed|cannot|unable to|denied|not found|undefined|null reference|stack ?trace)\b|ошибк|исключени|не удалось|не найден|отказано в доступе|сбой|аварийн|0x[0-9a-fA-F]{8}/i
// окна, где смотреть неуместно (игры, кино, сама Kira)
const SKIP_APPS = /kira|steam|game|игра|vlc|kinopoisk|netflix|obs/i

/** Что Kira видит прямо сейчас. Живёт только в памяти. */
export interface ScreenContext {
  /** когда обновлён */
  at: number
  /** заголовок активного окна */
  title: string
  /** имя программы */
  app: string
  /** распознанный текст экрана (обрезанный) */
  text: string
}

let timer: NodeJS.Timeout | null = null
let getWin: (() => BrowserWindow | null) | null = null
let current: ScreenContext | null = null
let lastOcrAt = 0
let lastOfferKey = ''
let lastOfferAt = 0
let busy = false

function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return String(h)
}

/** Текущий контекст экрана (для ИИ и интерфейса). null — Kira не смотрит. */
export function screenContext(): ScreenContext | null {
  return current
}

/** Краткая сводка для системного промпта — что Kira видит сейчас. */
export function screenContextForPrompt(): string {
  if (!current) return ''
  const age = Math.round((Date.now() - current.at) / 1000)
  if (age > 120) return '' // слишком старое — не выдаём за актуальное
  const text = current.text.slice(0, 1200).trim()
  return `[ЭКРАН ПОЛЬЗОВАТЕЛЯ СЕЙЧАС] Окно: «${current.title}» (${current.app}).` +
    (text ? `\nТекст на экране:\n${text}` : '') +
    '\n(Это то, что видно прямо сейчас. Используй, если вопрос про экран; не пересказывай без надобности.)'
}

async function tick(): Promise<void> {
  const s = getSettings()
  if (!s.screenAssist) return
  if (busy) return // предыдущий проход ещё идёт — не наслаиваем
  busy = true
  try {
    // 1. дешёвая проверка: изменилась ли картинка вообще
    let diff = 0
    try {
      diff = (await system.screenFingerprint()).diff
    } catch {
      return
    }
    if (diff < CHANGE_THRESHOLD) return // экран прежний — больше ничего не делаем
    if (Date.now() - lastOcrAt < MIN_OCR_GAP_MS) return // бережём CPU при видео

    // 2. экран изменился — узнаём окно и читаем текст
    let win: { title: string; process: string }
    try {
      win = await system.foregroundWindow()
    } catch {
      return
    }
    if (!win.title) return
    if (SKIP_APPS.test(win.title) || SKIP_APPS.test(win.process)) return

    lastOcrAt = Date.now()
    let text = ''
    try {
      const r = await system.ocrScreen()
      if (r.ok) text = String(r.data ?? '')
    } catch {
      return
    }

    current = { at: Date.now(), title: win.title, app: win.process, text }
    const w = getWin?.()
    if (w && !w.isDestroyed()) {
      // интерфейс показывает «что вижу» — короткая выжимка, без простыни текста
      w.webContents.send('vision:context', {
        at: current.at,
        title: current.title,
        app: current.app,
        preview: text.replace(/\s+/g, ' ').slice(0, 160)
      })
    }

    // 3. заметили проблему — мягко предлагаем помощь (не чаще раза в 4 минуты)
    if (!s.proactiveEnabled) return
    const m = text.match(TROUBLE)
    if (!m) return
    if (Date.now() - lastOfferAt < MIN_OFFER_GAP_MS) return
    const key = hash(win.title + '|' + m[0].toLowerCase())
    if (key === lastOfferKey) return
    lastOfferKey = key
    lastOfferAt = Date.now()

    const offer = `Вижу, в «${win.title.slice(0, 40)}» что-то пошло не так. Помочь разобраться?`
    logger.info('vision', `Предложила помощь: ${win.title.slice(0, 50)}`)
    if (w && !w.isDestroyed()) w.webContents.send('pulse:say', offer)
    try {
      if (Notification.isSupported()) new Notification({ title: 'Kira', body: offer.slice(0, 180) }).show()
    } catch { /* уведомления недоступны */ }
  } finally {
    busy = false
  }
}

export function initVision(getWindow: () => BrowserWindow | null): void {
  if (timer) return
  getWin = getWindow
  timer = setInterval(() => void tick(), TICK_MS)
  logger.info('vision', 'Зрение готово (включается в настройках)')
}

export function shutdownVision(): void {
  if (timer) clearInterval(timer)
  timer = null
  current = null
}
