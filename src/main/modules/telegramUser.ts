/**
 * Telegram — личный аккаунт (MTProto через GramJS).
 *
 * В отличие от бота, это ТВОЙ аккаунт: Kira видит личные чаты, предупреждает о
 * новых сообщениях и может писать от твоего имени. Telegram официально
 * разрешает пользовательские клиенты (в отличие от Discord).
 *
 * Вход многошаговый: телефон → код из Telegram → (если включена 2FA) пароль.
 * Пароль/код вводит сам пользователь в интерфейсе; сессия сохраняется строкой
 * в settings.telegramSession, чтобы не входить каждый раз.
 */
import { BrowserWindow, Notification } from 'electron'
import { getSettings, saveSettings } from './settings'
import { logger } from './logger'
import type { ActionResult } from '../../shared/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any = null
let getWin: (() => BrowserWindow | null) | null = null
let codeResolver: ((code: string) => void) | null = null
let passwordResolver: ((pw: string) => void) | null = null

function emit(type: string, message?: string): void {
  const win = getWin?.()
  if (win && !win.isDestroyed()) win.webContents.send('telegram-user:event', { type, message })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function makeClient(session: string): Promise<any> {
  const { TelegramClient } = await import('telegram')
  const { StringSession } = await import('telegram/sessions')
  const s = getSettings()
  const apiId = Number(s.telegramApiId)
  const apiHash = s.telegramApiHash.trim()
  return new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 3 })
}

function notify(from: string, text: string): void {
  const body = text ? `${from}: ${text.slice(0, 120)}` : `${from} написал(а) тебе`
  new Notification({ title: 'Kira · Личное сообщение в Telegram', body }).show()
  const win = getWin?.()
  if (win && !win.isDestroyed()) win.webContents.send('pulse:say', `Тебе написал ${from} в Телеграме.`)
  logger.action('telegram-user', `Новое ЛС от ${from}`)
}

async function startMonitor(): Promise<void> {
  if (!client || !getSettings().telegramUserMonitor) return
  try {
    const { NewMessage } = await import('telegram/events')
    client.addEventHandler(async (event: { message?: unknown }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = event.message as any
      if (!msg || msg.out || !msg.isPrivate) return
      let name = 'кто-то'
      try {
        const sender = await msg.getSender()
        name = sender?.firstName || sender?.username || name
      } catch { /* аноним */ }
      notify(name, msg.text || msg.message || '')
    }, new NewMessage({}))
    logger.info('telegram-user', 'Слежение за личными сообщениями включено')
  } catch (err) {
    logger.warn('telegram-user', 'Монитор не запустился: ' + (err as Error).message)
  }
}

/** Шаг 1: отправить код на телефон. Дальнейшие шаги — через submitCode/submitPassword. */
export async function startUserLogin(phone: string): Promise<{ ok: boolean; message: string }> {
  const s = getSettings()
  if (!s.telegramApiId.trim() || !s.telegramApiHash.trim()) {
    return { ok: false, message: 'Сначала укажи api_id и api_hash с my.telegram.org' }
  }
  if (!phone.trim()) return { ok: false, message: 'Укажи номер телефона' }
  try {
    client = await makeClient('')
    // start() последовательно запрашивает телефон → код → пароль (если 2FA)
    void client
      .start({
        phoneNumber: async () => phone.trim(),
        phoneCode: async () => new Promise<string>((res) => { codeResolver = res; emit('needs-code') }),
        password: async () => new Promise<string>((res) => { passwordResolver = res; emit('needs-password') }),
        onError: (e: unknown) => logger.error('telegram-user', String((e as Error)?.message ?? e))
      })
      .then(async () => {
        const session = String(client.session.save())
        saveSettings({ ...getSettings(), telegramSession: session })
        emit('logged-in')
        logger.info('telegram-user', 'Вход в личный аккаунт выполнен')
        void startMonitor()
      })
      .catch((e: unknown) => emit('error', String((e as Error)?.message ?? e)))
    return { ok: true, message: 'Код отправлен в Telegram — введи его' }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}

export function submitCode(code: string): { ok: boolean } {
  if (!codeResolver) return { ok: false }
  codeResolver(code.trim()); codeResolver = null
  return { ok: true }
}

export function submitPassword(pw: string): { ok: boolean } {
  if (!passwordResolver) return { ok: false }
  passwordResolver(pw); passwordResolver = null
  return { ok: true }
}

export async function telegramUserStatus(): Promise<{ connected: boolean; name?: string }> {
  if (!client) return { connected: false }
  try {
    const me = await client.getMe()
    return { connected: true, name: me?.firstName || me?.username }
  } catch {
    return { connected: false }
  }
}

// ─── Поиск собеседника по имени ─────────────────────────────────────────────
//
// Человек говорит «напиши Васе», а не «напиши @vasya_1990». Раньше имя уходило
// в Telegram как есть и отправка падала. Теперь имя ищется среди личных
// переписок — и, что важнее, при сомнении Kira не отправляет наугад: чужому
// человеку сообщение уже не вернуть.

export interface TelegramPeer {
  /** Идентификатор для отправки (стабильнее имени). */
  id: string
  name: string
  username: string
}

/** Список переписок стоит сетевого запроса — держим его недолго в памяти. */
const DIALOGS_TTL_MS = 60_000
let dialogCache: { at: number; peers: TelegramPeer[] } | null = null

function fold(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Одно ли это слово с точностью до склонения: «Вася» и «Васе» — да, «Ян» и
 * «Яна» — нет. Совпадать должна почти вся основа, а длина — отличаться на
 * окончание, не больше: иначе «Вася» подойдёт к «Василисе».
 */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  const short = Math.min(a.length, b.length)
  // до четырёх букв окончания не отбрасываем — там от имени ничего не останется
  if (short < 4 || Math.abs(a.length - b.length) > 3) return false
  const need = Math.max(3, short - 2)
  return a.slice(0, need) === b.slice(0, need)
}

/**
 * Совпадает ли имя: каждое слово запроса должно найтись в имени собеседника.
 *
 * Сравнение идёт ПО СЛОВАМ, а не по вхождению подстроки: «Ян» иначе попадал бы
 * в «Яну», «Яника» и «Яровую», а сообщение уходит живому человеку и отозвать
 * его нельзя. Ошибиться в сторону «не нашла» безопасно — Kira переспросит.
 *
 * Экспортируется ради тестов: от этой функции зависит, кто получит сообщение.
 */
export function nameMatches(candidate: string, query: string): boolean {
  const c = fold(candidate)
  const q = fold(query)
  if (!c || !q) return false
  if (c === q) return true
  const cWords = c.split(' ')
  return q.split(' ').every((qw) => cWords.some((cw) => sameWord(cw, qw)))
}

/** Личные переписки пользователя (только люди, не группы и каналы). */
async function personalPeers(): Promise<TelegramPeer[]> {
  if (dialogCache && Date.now() - dialogCache.at < DIALOGS_TTL_MS) return dialogCache.peers
  const dialogs = await client.getDialogs({ limit: 200 })
  const peers: TelegramPeer[] = []
  for (const d of dialogs) {
    if (!d.isUser || !d.id) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = d.entity as any
    if (e?.bot || e?.self) continue // боты и «Избранное» — не собеседники
    const name = [e?.firstName, e?.lastName].filter(Boolean).join(' ') || d.name || e?.username || ''
    if (!name) continue
    peers.push({ id: String(d.id), name, username: e?.username ?? '' })
  }
  dialogCache = { at: Date.now(), peers }
  return peers
}

/** Найти собеседников по имени — для уточнения «кому именно написать». */
export async function findPeers(query: string): Promise<TelegramPeer[]> {
  if (!client) return []
  try {
    const peers = await personalPeers()
    return peers.filter((p) => nameMatches(p.name, query) || (p.username && nameMatches(p.username, query)))
  } catch {
    return []
  }
}

/** Похоже ли на точный адрес (@username, телефон, числовой id) — искать не нужно. */
function isExactPeer(peer: string): boolean {
  return /^@[\w\d_]+$/.test(peer) || /^\+?\d{5,}$/.test(peer)
}

/**
 * Написать сообщение от твоего имени. Получатель — @username, телефон, id или
 * просто имя из переписок. При неоднозначности НЕ отправляем: спрашиваем.
 */
export async function sendUserMessage(peer: string, text: string): Promise<ActionResult> {
  if (!client) {
    return { ok: false, message: 'Личный Telegram не подключён — подключи его в разделе «Интеграции», и я смогу писать от твоего имени' }
  }
  const target = peer.trim()
  if (!target) return { ok: false, message: 'Не поняла, кому писать' }
  if (!text.trim()) return { ok: false, message: 'Пустое сообщение отправлять не буду' }

  let recipient = target
  let shown = target
  if (!isExactPeer(target)) {
    const found = await findPeers(target)
    if (found.length === 0) {
      return { ok: false, message: `Не нашла в переписках Telegram никого по имени «${target}». Скажи точнее — имя как в Telegram или @username.` }
    }
    if (found.length > 1) {
      const list = found.slice(0, 5).map((p) => p.username ? `${p.name} (@${p.username})` : p.name).join(', ')
      return { ok: false, message: `По имени «${target}» подходит несколько человек: ${list}. Кому именно написать?` }
    }
    recipient = found[0].id
    shown = found[0].username ? `${found[0].name} (@${found[0].username})` : found[0].name
  }

  try {
    await client.sendMessage(recipient, { message: text })
    return { ok: true, message: `Отправила в Telegram — ${shown}` }
  } catch (err) {
    return { ok: false, message: `Не отправилось: ${(err as Error).message}` }
  }
}

/** Кого Kira видит в переписках — для ответа «кому я могу написать». */
export async function listPeers(query: string): Promise<ActionResult> {
  if (!client) return { ok: false, message: 'Личный Telegram не подключён' }
  const found = query.trim() ? await findPeers(query) : await personalPeers().catch(() => [])
  if (!found.length) return { ok: true, message: 'Никого не нашла', content: '' }
  const lines = found.slice(0, 20).map((p) => (p.username ? `${p.name} (@${p.username})` : p.name))
  return { ok: true, message: `Нашла: ${found.length}`, content: lines.join('\n') }
}

export async function logoutTelegramUser(): Promise<{ ok: boolean }> {
  try {
    if (client) { await client.disconnect() }
  } catch { /* ignore */ }
  client = null
  saveSettings({ ...getSettings(), telegramSession: '', telegramUserMonitor: false })
  logger.info('telegram-user', 'Выход из личного аккаунта')
  return { ok: true }
}

/** Подключить сохранённую сессию при старте приложения. */
export async function initTelegramUser(getWindow: () => BrowserWindow | null): Promise<void> {
  getWin = getWindow
  const s = getSettings()
  if (!s.telegramSession.trim() || !s.telegramApiId.trim() || !s.telegramApiHash.trim()) return
  try {
    client = await makeClient(s.telegramSession)
    await client.connect()
    void startMonitor()
    logger.info('telegram-user', 'Личный аккаунт Telegram подключён')
  } catch (err) {
    logger.warn('telegram-user', 'Не удалось подключить сессию: ' + (err as Error).message)
  }
}

export async function shutdownTelegramUser(): Promise<void> {
  try { await client?.disconnect() } catch { /* ignore */ }
  client = null
}
