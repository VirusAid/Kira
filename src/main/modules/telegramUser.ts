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

/** Написать сообщение от твоего имени (получатель: @username, номер или id). */
export async function sendUserMessage(peer: string, text: string): Promise<ActionResult> {
  if (!client) return { ok: false, message: 'Личный Telegram не подключён' }
  try {
    await client.sendMessage(peer.trim(), { message: text })
    return { ok: true, message: 'Сообщение отправлено в Telegram' }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
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
