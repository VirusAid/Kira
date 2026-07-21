/**
 * Pulse — проактивное «сердцебиение» Kira. Работает в фоне (даже в трее):
 *  • утренний брифинг раз в день (приветствие + напоминания на сегодня + проекты)
 *  • мониторинг системы: мало места на диске, процесс съедает много памяти
 *
 * События уходят в renderer (Kira озвучивает) и в системные уведомления.
 */
import { app, BrowserWindow, Notification } from 'electron'
import { promises as fsp, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { db } from './db'
import { logger } from './logger'
import { getSettings } from './settings'
import { listReminders } from './reminders'

let timer: NodeJS.Timeout | null = null
let getWin: (() => BrowserWindow | null) | null = null
const notifiedToday = new Set<string>()
let lastDiskWarn = 0
let lastMeetingKey = ''
let lastUnread = -1
let lastBreak = Date.now()
const startedAt = Date.now()

function stateFile(): string {
  return join(app.getPath('userData'), 'data', 'pulse.json')
}

function loadState(): { lastBriefing?: string } {
  try {
    if (existsSync(stateFile())) return JSON.parse(readFileSync(stateFile(), 'utf-8'))
  } catch { /* ignore */ }
  return {}
}

function saveState(s: { lastBriefing?: string }): void {
  try { writeFileSync(stateFile(), JSON.stringify(s)) } catch { /* ignore */ }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Kira произносит фразу (renderer озвучит, если голос включён) + уведомление. */
function say(text: string, notify = true): void {
  const win = getWin?.()
  if (win && !win.isDestroyed()) win.webContents.send('pulse:say', text)
  if (notify) new Notification({ title: 'Kira', body: text.slice(0, 220) }).show()
}

async function buildBriefing(): Promise<string> {
  const s = getSettings()
  const name = s.userName || 'друг'
  const h = new Date().getHours()
  const hello = h < 12 ? `Доброе утро, ${name}` : h < 18 ? `Добрый день, ${name}` : `Добрый вечер, ${name}`

  const parts: string[] = [hello + '.']

  // погода
  try {
    const { getWeather } = await import('./system')
    const w = await getWeather()
    if (w.ok) parts.push(`За окном${w.city ? ' в ' + w.city : ''} ${w.temp}°, ${w.desc}.`)
  } catch { /* без погоды */ }

  const reminders = listReminders().filter((r) => {
    const d = new Date(r.fireAt)
    return d.toDateString() === new Date().toDateString()
  })
  if (reminders.length) {
    parts.push(`На сегодня ${reminders.length} ${reminders.length === 1 ? 'напоминание' : 'напоминаний'}: ` +
      reminders.slice(0, 3).map((r) => r.text).join('; ') + '.')
  }

  const active = db().projects.all().filter((p) => p.status === 'active')
  if (active.length) parts.push(`Активных проектов: ${active.length}.`)

  parts.push(reminders.length || active.length ? 'Хорошего дня!' : 'Пока всё спокойно. Я рядом, если что.')
  return parts.join(' ')
}

async function checkDisk(): Promise<void> {
  if (Date.now() - lastDiskWarn < 6 * 3600_000) return // не чаще раза в 6 ч
  try {
    const stat = await fsp.statfs(app.getPath('home'))
    const freeGB = (stat.bavail * stat.bsize) / 1024 ** 3
    const totalGB = (stat.blocks * stat.bsize) / 1024 ** 3
    if (freeGB < 5 || freeGB / totalGB < 0.06) {
      lastDiskWarn = Date.now()
      say(`Заканчивается место на диске — свободно всего ${freeGB.toFixed(1)} ГБ. Может, почистить загрузки или корзину?`)
      logger.warn('pulse', `Мало места на диске: ${freeGB.toFixed(1)} ГБ`)
    }
  } catch { /* statfs недоступен — пропускаем */ }
}

function checkMemory(): void {
  const usedPct = (1 - os.freemem() / os.totalmem()) * 100
  const key = 'mem-' + today()
  if (usedPct > 90 && !notifiedToday.has(key)) {
    notifiedToday.add(key)
    say(`Память почти заполнена — занято ${Math.round(usedPct)}%. Могу показать, какие процессы её съедают.`)
  }
}

/** Долгий аптайм — мягко предлагаем перезагрузку (раз в день). */
function checkUptime(): void {
  const days = os.uptime() / 86400
  const key = 'uptime-' + today()
  if (days >= 3 && !notifiedToday.has(key)) {
    notifiedToday.add(key)
    say(`Компьютер работает без перезагрузки уже ${Math.floor(days)} дня. Перезагрузка может ускорить систему — сделать, когда будет удобно?`)
  }
}

/** Скоро встреча из календаря (если Google подключён). */
async function checkMeeting(): Promise<void> {
  try {
    const { calendarUpcoming } = await import('./integrations')
    const ev = await calendarUpcoming(20)
    if (!ev) return
    const key = `meet-${ev.title}-${Math.round(ev.minutes / 5)}`
    if (key === lastMeetingKey) return
    lastMeetingKey = key
    const when = ev.minutes <= 1 ? 'прямо сейчас' : `через ${ev.minutes} минут`
    say(`Встреча ${when}: «${ev.title}». Подготовиться?`)
  } catch { /* календарь недоступен */ }
}

/** Новые письма (если Gmail подключён) — тихо, когда их стало больше. */
async function checkMail(): Promise<void> {
  try {
    const { gmailUnreadCount } = await import('./integrations')
    const n = await gmailUnreadCount()
    if (n == null) return
    if (lastUnread >= 0 && n > lastUnread) {
      const diff = n - lastUnread
      say(`${diff === 1 ? 'Пришло новое письмо' : `Пришло ${diff} новых писем`}. Показать выжимку?`, false)
    }
    lastUnread = n
  } catch { /* почта недоступна */ }
}

/** Низкий заряд батареи (ноутбук) — напоминание поставить на зарядку. */
async function checkBattery(): Promise<void> {
  try {
    const { batteryInfo } = await import('./system')
    const b = await batteryInfo()
    const data = b.data as { pct?: number; status?: number } | null
    if (!data || typeof data.pct !== 'number') return
    const charging = data.status === 2
    const key = `batt-${today()}-${Math.round(data.pct / 5)}`
    if (data.pct <= 20 && !charging && !notifiedToday.has(key)) {
      notifiedToday.add(key)
      say(`Батарея ${data.pct}% и не заряжается — поставь на зарядку, чтобы не выключился.`)
    }
  } catch { /* нет батареи */ }
}

/** Долгая непрерывная работа — мягко предложить перерыв (не чаще раза в ~90 мин). */
function checkBreak(): void {
  const h = new Date().getHours()
  if (h < 8 || h >= 23) return // не трогаем ночью
  if (Date.now() - lastBreak < 90 * 60_000) return
  if (Date.now() - startedAt < 90 * 60_000) return // не сразу после старта
  lastBreak = Date.now()
  say('Ты за компьютером уже полтора часа без перерыва. Разомнись пару минут — я подожду.', false)
}

/** Поздняя ночь — заботливое напоминание отдохнуть (раз в сутки). */
function checkLateNight(): void {
  const h = new Date().getHours()
  const key = 'night-' + today()
  if (h >= 1 && h < 5 && !notifiedToday.has(key)) {
    notifiedToday.add(key)
    say('Уже глубокая ночь. Может, пора отдохнуть? Я никуда не денусь и буду ждать.', false)
  }
}

let notifiedDay = today()

async function tick(): Promise<void> {
  const s = getSettings()
  if (!s.proactiveEnabled) return

  // новый день — сбрасываем «уже уведомляли сегодня»
  if (today() !== notifiedDay) { notifiedDay = today(); notifiedToday.clear() }

  // утренний брифинг раз в день после briefingHour
  if (s.briefingEnabled) {
    const st = loadState()
    const hour = new Date().getHours()
    if (hour >= (s.briefingHour ?? 9) && st.lastBriefing !== today()) {
      saveState({ ...st, lastBriefing: today() })
      say(await buildBriefing())
      logger.info('pulse', 'Утренний брифинг отправлен')
    }
  }

  const level = s.proactiveLevel ?? 'balanced'

  // важное — на любом уровне (кроме calm, где только по-настоящему срочное)
  await checkMeeting()   // скоро встреча
  await checkBattery()   // сядет батарея
  await checkDisk()      // кончается место

  // сбалансированный и активный — плюс почта, память, перерывы
  if (level !== 'calm') {
    await checkMail()
    checkMemory()
    checkBreak()
  }

  // активный — плюс аптайм и ночные заботы
  if (level === 'active') {
    checkUptime()
    checkLateNight()
  }
}

export function initPulse(getWindow: () => BrowserWindow | null): void {
  if (timer) return
  getWin = getWindow
  timer = setInterval(() => void tick(), 4 * 60_000) // каждые 4 минуты
  setTimeout(() => void tick(), 20_000) // первый прогон через 20 сек после старта
  logger.info('pulse', 'Проактивный пульс активен')
}

export function shutdownPulse(): void {
  if (timer) clearInterval(timer)
  timer = null
}
