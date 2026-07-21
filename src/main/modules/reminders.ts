/**
 * Reminders — проактивные напоминания Kira.
 * Пользователь: «напомни через час выпить воды» / «напомни завтра в 9 позвонить маме».
 * Хранятся на диске, проверяются раз в 20 секунд; при срабатывании — системное
 * уведомление + событие в renderer (там Kira может озвучить напоминание).
 */
import { BrowserWindow, Notification } from 'electron'
import { Collection } from './storage'
import { newId } from './ids'
import { logger } from './logger'
import type { ActionResult } from '../../shared/types'

export type Recurrence = 'daily' | 'weekdays' | 'weekly'

export interface Reminder {
  id: string
  text: string
  fireAt: number
  createdAt: number
  fired: boolean
  /** Повтор: daily — каждый день, weekdays — по будням, weekly — раз в неделю. */
  recurrence?: Recurrence
}

let _col: Collection<Reminder> | null = null
function col(): Collection<Reminder> {
  if (!_col) _col = new Collection<Reminder>('reminders')
  return _col
}

let timer: NodeJS.Timeout | null = null

/** Разбор относительного времени из текста: «через 10 минут», «через 2 часа». */
export function parseWhen(spec: string): number | null {
  const s = spec.toLowerCase().trim()
  const now = Date.now()

  // «через N секунд/минут/часов/дней»
  const rel = s.match(/через\s+(\d+)\s*(секунд|минут|час|день|дн|дня|дней)/)
  if (rel) {
    const n = Number(rel[1])
    const unit = rel[2]
    const ms =
      unit.startsWith('секунд') ? n * 1000
      : unit.startsWith('минут') ? n * 60_000
      : unit.startsWith('час') ? n * 3_600_000
      : n * 86_400_000
    return now + ms
  }

  // словесные формы без числа: «через час», «через полчаса», «через минуту»…
  const word = s.match(/через\s+(полчаса|полтора часа|час|минуту|пару минут|пару часов)/)
  if (word) {
    const map: Record<string, number> = {
      'полчаса': 30 * 60_000,
      'полтора часа': 90 * 60_000,
      'час': 3_600_000,
      'минуту': 60_000,
      'пару минут': 2 * 60_000,
      'пару часов': 2 * 3_600_000
    }
    return now + map[word[1]]
  }

  // «в HH:MM» (сегодня или завтра, если время уже прошло)
  const at = s.match(/(?:в|к)\s+(\d{1,2})[:.\s](\d{2})/)
  if (at) {
    const h = Number(at[1])
    const m = Number(at[2])
    const d = new Date()
    d.setHours(h, m, 0, 0)
    if (s.includes('завтра') || d.getTime() <= now) d.setDate(d.getDate() + 1)
    return d.getTime()
  }

  // «в 9» / «завтра в 9 вечера» — час без минут
  const atHour = s.match(/(?:в|к)\s+(\d{1,2})(?![:.\d])/)
  if (atHour) {
    let h = Number(atHour[1])
    if (h >= 0 && h <= 23) {
      if (s.includes('вечера') && h < 12) h += 12
      const d = new Date()
      d.setHours(h, 0, 0, 0)
      if (s.includes('завтра') || d.getTime() <= now) d.setDate(d.getDate() + 1)
      return d.getTime()
    }
  }

  // «завтра» без времени → завтра 9:00
  if (s.includes('завтра')) {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    return d.getTime()
  }

  // прямое число минут: «на 15 минут»
  const mins = s.match(/(\d+)\s*мин/)
  if (mins) return now + Number(mins[1]) * 60_000

  return null
}

/** Распознать повторяемость из фразы: «каждый день», «по будням», «каждую неделю». */
export function parseRecurrence(spec: string): Recurrence | null {
  const s = spec.toLowerCase()
  if (/кажд(ый|ое) буд|по будн|в будни/.test(s)) return 'weekdays'
  if (/кажд(ую|ый) недел|еженедельно|раз в недел/.test(s)) return 'weekly'
  if (/кажд(ый|ое) (день|утро|вечер|дн)|ежедневно|каждый раз в/.test(s)) return 'daily'
  return null
}

/** Следующее срабатывание для повторяющегося напоминания (то же время суток). */
function nextOccurrence(from: number, recurrence: Recurrence): number {
  const d = new Date(from)
  do {
    d.setDate(d.getDate() + (recurrence === 'weekly' ? 7 : 1))
  } while (recurrence === 'weekdays' && (d.getDay() === 0 || d.getDay() === 6))
  return d.getTime()
}

const RECUR_LABEL: Record<Recurrence, string> = {
  daily: 'каждый день', weekdays: 'по будням', weekly: 'каждую неделю'
}

export function addReminder(text: string, whenSpec: string): ActionResult {
  let fireAt = parseWhen(whenSpec) ?? parseWhen(text)
  const recurrence = parseRecurrence(whenSpec) ?? parseRecurrence(text) ?? undefined
  // «каждый день в 9» без явной даты → parseWhen поймал время; если нет —
  // но есть повтор, отталкиваемся от завтрашних 9:00 по умолчанию
  if (!fireAt && recurrence) {
    const d = new Date(); d.setHours(9, 0, 0, 0)
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1)
    fireAt = d.getTime()
  }
  if (!fireAt) {
    return { ok: false, message: 'Не поняла, когда напомнить. Скажи «через 30 минут», «завтра в 9» или «каждый день в 9».' }
  }
  const reminder: Reminder = {
    id: newId(),
    text: text.trim(),
    fireAt,
    createdAt: Date.now(),
    fired: false,
    recurrence
  }
  col().put(reminder)
  const when = new Date(fireAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
  const suffix = recurrence ? ` (${RECUR_LABEL[recurrence]})` : ''
  logger.action('reminders', `Напоминание на ${when}${suffix}: ${text}`)
  return { ok: true, message: `Напомню ${when}${suffix}: ${text}`, data: reminder }
}

export function listReminders(): Reminder[] {
  return col().all().filter((r) => !r.fired).sort((a, b) => a.fireAt - b.fireAt)
}

export function deleteReminder(id: string): boolean {
  return col().delete(id)
}

function checkDue(): void {
  const now = Date.now()
  for (const r of col().all()) {
    if (r.fired || r.fireAt > now) continue
    // повторяющееся — не гасим, а переносим на следующий раз
    if (r.recurrence) {
      col().patch(r.id, { fireAt: nextOccurrence(r.fireAt, r.recurrence) })
    } else {
      col().patch(r.id, { fired: true })
    }
    logger.action('reminders', `Сработало напоминание: ${r.text}`)
    new Notification({ title: 'Kira · Напоминание', body: r.text }).show()
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('reminder:fired', r)
    }
  }
  // чистим старые сработавшие (старше суток)
  for (const r of col().all()) {
    if (r.fired && now - r.fireAt > 86_400_000) col().delete(r.id)
  }
}

export function initReminders(): void {
  if (timer) return
  timer = setInterval(checkDue, 20_000)
  setTimeout(checkDue, 3000)
  logger.info('reminders', `Напоминаний активно: ${listReminders().length}`)
}

export function shutdownReminders(): void {
  if (timer) clearInterval(timer)
  timer = null
}
