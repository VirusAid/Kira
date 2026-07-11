/**
 * Discord DM monitor — Kira предупреждает о новых личных сообщениях.
 *
 * ВНИМАНИЕ: Discord не даёт официального способа читать личные сообщения
 * пользователя. Единственный путь — пользовательский токен (self-bot), что
 * ФОРМАЛЬНО НАРУШАЕТ правила Discord (небольшой риск блокировки аккаунта).
 * Функция полностью опциональна и включается пользователем осознанно.
 *
 * Реализация — деликатный REST-поллинг: раз в ~40 сек проверяем список личных
 * каналов и их last_message_id; при новом сообщении не от себя — уведомляем.
 */
import { BrowserWindow, Notification } from 'electron'
import { getSettings } from './settings'
import { logger } from './logger'

const API = 'https://discord.com/api/v10'
const POLL_MS = 40_000

let timer: NodeJS.Timeout | null = null
let getWin: (() => BrowserWindow | null) | null = null
let selfId = ''
let seeded = false
const lastSeen = new Map<string, string>() // channelId → last_message_id

function headers(): Record<string, string> {
  return {
    Authorization: getSettings().discordUserToken,
    'Content-Type': 'application/json'
  }
}

async function api<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${API}${path}`, { headers: headers() })
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

interface DMChannel {
  id: string
  last_message_id?: string
  recipients?: { id: string; username?: string; global_name?: string }[]
}

interface DMessage {
  author?: { id: string; username?: string; global_name?: string }
  content?: string
}

function alert(from: string, text: string): void {
  const body = text ? `${from}: ${text.slice(0, 120)}` : `${from} написал(а) тебе`
  new Notification({ title: 'Kira · Личное сообщение в Discord', body }).show()
  const win = getWin?.()
  if (win && !win.isDestroyed()) win.webContents.send('pulse:say', `Тебе написал ${from} в Дискорде.`)
  logger.action('discord', `Новое ЛС от ${from}`)
}

async function poll(): Promise<void> {
  const s = getSettings()
  if (!s.discordDmAlerts || !s.discordUserToken) return

  if (!selfId) {
    const me = await api<{ id: string }>('/users/@me')
    if (!me?.id) { logger.warn('discord', 'Неверный токен — слежение за ЛС отключено'); return }
    selfId = me.id
  }

  const channels = await api<DMChannel[]>('/users/@me/channels')
  if (!channels) return

  for (const ch of channels) {
    if (!ch.last_message_id) continue
    const prev = lastSeen.get(ch.id)
    lastSeen.set(ch.id, ch.last_message_id)
    // при первом проходе только запоминаем, не спамим старым
    if (!seeded || prev === undefined || prev === ch.last_message_id) continue

    const msgs = await api<DMessage[]>(`/channels/${ch.id}/messages?limit=1`)
    const m = msgs?.[0]
    if (!m?.author || m.author.id === selfId) continue
    const name = m.author.global_name || m.author.username ||
      ch.recipients?.[0]?.global_name || ch.recipients?.[0]?.username || 'кто-то'
    alert(name, m.content ?? '')
  }
  seeded = true
}

export function initDiscordMonitor(getWindow: () => BrowserWindow | null): void {
  getWin = getWindow
  restartDiscordMonitor()
}

/** Перезапуск при смене настроек (токен/переключатель). */
export function restartDiscordMonitor(): void {
  if (timer) { clearInterval(timer); timer = null }
  selfId = ''
  seeded = false
  lastSeen.clear()
  const s = getSettings()
  if (s.discordDmAlerts && s.discordUserToken) {
    timer = setInterval(() => void poll(), POLL_MS)
    setTimeout(() => void poll(), 4000)
    logger.info('discord', 'Слежение за личными сообщениями включено')
  }
}

/** Проверка токена: возвращает имя аккаунта, если валиден. */
export async function verifyDiscordToken(): Promise<{ ok: boolean; name?: string }> {
  const me = await api<{ id: string; username?: string; global_name?: string }>('/users/@me')
  return me?.id ? { ok: true, name: me.global_name || me.username } : { ok: false }
}

export function shutdownDiscordMonitor(): void {
  if (timer) clearInterval(timer)
  timer = null
}
