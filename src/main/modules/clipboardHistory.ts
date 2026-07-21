/**
 * Clipboard History — Kira помнит, что ты копировал.
 *
 * Раз в ~1.5с проверяет буфер обмена; новый непустой текст кладёт в историю
 * (кольцо на MAX записей, персист на диск). Позволяет вставить любую прошлую
 * запись: «вставь что копировал до этого», «покажи историю буфера».
 * Всё локально — ничего не уходит в сеть.
 */
import { clipboard } from 'electron'
import { Collection } from './storage'
import { newId } from './ids'
import { logger } from './logger'
import * as system from './system'
import type { ActionResult } from '../../shared/types'

interface ClipEntry {
  id: string
  text: string
  at: number
}

const MAX = 60
const MAX_LEN = 8000
const POLL_MS = 1500

let _col: Collection<ClipEntry> | null = null
function col(): Collection<ClipEntry> {
  if (!_col) _col = new Collection<ClipEntry>('clipboard-history')
  return _col
}

let timer: NodeJS.Timeout | null = null
let lastSeen = ''
/** Наши собственные записи в буфер (paste) не должны попадать в историю как «новое». */
let selfWrite = ''

function poll(): void {
  let text: string
  try {
    text = clipboard.readText()
  } catch {
    return
  }
  if (!text || text === lastSeen) return
  lastSeen = text
  if (text === selfWrite) return
  const trimmed = text.slice(0, MAX_LEN)
  // не дублируем, если ровно та же запись только что была самой свежей
  const recent = list(1)[0]
  if (recent && recent.text === trimmed) return
  col().put({ id: newId(), text: trimmed, at: Date.now() })
  trim()
}

function trim(): void {
  const all = col().all().sort((a, b) => b.at - a.at)
  for (const old of all.slice(MAX)) col().delete(old.id)
}

/** История, новейшие сверху. */
export function list(limit = 15): ClipEntry[] {
  return col().all().sort((a, b) => b.at - a.at).slice(0, limit)
}

/** Показать историю (для команды/инструмента). */
export function historyReport(limit = 12): ActionResult {
  const items = list(limit)
  if (!items.length) return { ok: true, message: 'История буфера пуста' }
  const lines = items.map((e, i) => {
    const oneLine = e.text.replace(/\s+/g, ' ').trim()
    return `${i + 1}. ${oneLine.slice(0, 90)}${oneLine.length > 90 ? '…' : ''}`
  })
  return { ok: true, message: `В истории буфера: ${items.length}`, data: lines.join('\n') }
}

/**
 * Вернуть N-ю запись (1 — самая свежая ПОСЛЕ текущей) в буфер и вставить её
 * в активное окно. Индекс 1 = предыдущая копия, 2 = позапрошлая и т.д.
 */
export async function pasteRecent(index: number): Promise<ActionResult> {
  const items = list(MAX)
  const n = Math.max(1, Math.floor(index || 1))
  const entry = items[n - 1]
  if (!entry) return { ok: false, message: `В истории нет записи №${n}` }
  selfWrite = entry.text
  clipboard.writeText(entry.text)
  lastSeen = entry.text
  const r = await system.pressKeys('^v')
  return r.ok
    ? { ok: true, message: `Вставила запись №${n}: ${entry.text.slice(0, 40)}…` }
    : { ok: true, message: `Положила в буфер запись №${n} — вставь вручную (Ctrl+V)` }
}

/** Скопировать N-ю запись в буфер БЕЗ вставки. */
export function copyRecent(index: number): ActionResult {
  const items = list(MAX)
  const n = Math.max(1, Math.floor(index || 1))
  const entry = items[n - 1]
  if (!entry) return { ok: false, message: `В истории нет записи №${n}` }
  selfWrite = entry.text
  clipboard.writeText(entry.text)
  lastSeen = entry.text
  return { ok: true, message: `Запись №${n} снова в буфере` }
}

export function clearHistory(): ActionResult {
  const n = col().size
  for (const e of col().all()) col().delete(e.id)
  return { ok: true, message: n ? `Очистила историю буфера (${n})` : 'История уже пуста' }
}

export function initClipboardHistory(): void {
  if (timer) return
  try { lastSeen = clipboard.readText() } catch { /* нет доступа */ }
  timer = setInterval(poll, POLL_MS)
  logger.info('clipboard', `История буфера активна (записей: ${col().size})`)
}

export function shutdownClipboardHistory(): void {
  if (timer) clearInterval(timer)
  timer = null
  try { col().flushSync() } catch { /* ignore */ }
}
