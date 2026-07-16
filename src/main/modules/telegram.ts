/**
 * Telegram Bot API — официальная интеграция (без риска для аккаунта).
 *
 * Даёт две вещи:
 *  • Kira может ПИСАТЬ тебе в Telegram (уведомления, ответы) — инструмент
 *    telegram_send и sendTelegram().
 *  • Ты можешь ПИСАТЬ Kira из Telegram: бот long-poll'ит getUpdates, и на
 *    сообщение от владельца Kira отвечает (разговорно, через ИИ).
 *
 * Владелец определяется по chatId: если он пуст — первый написавший боту
 * становится владельцем (сохраняется в settings.telegramChatId).
 *
 * Токен бота берётся у @BotFather. Личные чаты пользователя это НЕ читает —
 * для них нужен отдельный режим личного аккаунта (MTProto).
 */
import { BrowserWindow, Notification } from 'electron'
import { getSettings, saveSettings } from './settings'
import { logger } from './logger'

let running = false
let offset = 0
let generation = 0 // защита от наложения циклов при рестарте настроек
let getWin: (() => BrowserWindow | null) | null = null

function token(): string {
  return getSettings().telegramBotToken.trim()
}

async function tg<T>(method: string, body?: unknown): Promise<T | null> {
  const t = token()
  if (!t) return null
  try {
    const r = await fetch(`https://api.telegram.org/bot${t}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {})
    })
    const j = (await r.json()) as { ok: boolean; result?: T }
    return j.ok ? (j.result ?? null) : null
  } catch {
    return null
  }
}

/** Отправить сообщение в Telegram (по умолчанию — владельцу). */
export async function sendTelegram(text: string, chatId?: string): Promise<{ ok: boolean; message: string }> {
  const to = (chatId || getSettings().telegramChatId).trim()
  if (!token()) return { ok: false, message: 'Не задан токен Telegram-бота' }
  if (!to) return { ok: false, message: 'Неизвестен чат: сначала напиши боту в Telegram' }
  const res = await tg('sendMessage', { chat_id: to, text: text.slice(0, 4000) })
  return res ? { ok: true, message: 'Отправлено в Telegram' } : { ok: false, message: 'Не удалось отправить в Telegram' }
}

/** Проверка токена: возвращает @username бота, если валиден. */
export async function verifyTelegramBot(): Promise<{ ok: boolean; username?: string }> {
  const me = await tg<{ username?: string }>('getMe')
  return me?.username ? { ok: true, username: me.username } : { ok: false }
}

interface TgUpdate {
  update_id: number
  message?: { chat?: { id: number }; from?: { is_bot?: boolean; first_name?: string }; text?: string }
}

async function handleUpdate(u: TgUpdate): Promise<void> {
  const msg = u.message
  if (!msg?.text || !msg.chat?.id || msg.from?.is_bot) return
  const chatId = String(msg.chat.id)
  const s = getSettings()

  // первый написавший становится владельцем
  if (!s.telegramChatId.trim()) {
    saveSettings({ ...s, telegramChatId: chatId })
    await sendTelegram('Привет! Я Kira. Теперь можешь писать мне сюда — я на связи.', chatId)
    logger.info('telegram', `Владелец привязан: chat ${chatId}`)
    return
  }
  // отвечаем только владельцу
  if (chatId !== s.telegramChatId.trim()) return

  logger.action('telegram', `Сообщение из Telegram: ${msg.text.slice(0, 60)}`)
  try {
    const { completeChat } = await import('./ai/client')
    const { buildSystemPrompt } = await import('./ai/kira')
    const answer = await completeChat([
      { role: 'system', content: buildSystemPrompt({ withTools: false, extraContext: 'Ты отвечаешь пользователю в переписке Telegram. Пиши обычным текстом, дружелюбно и по делу.' }) },
      { role: 'user', content: msg.text }
    ])
    await sendTelegram(answer || '…', chatId)
    const win = getWin?.()
    if (win && !win.isDestroyed()) win.webContents.send('pulse:say', 'Ответила тебе в Телеграме.')
  } catch (err) {
    await sendTelegram('Не смогла ответить: ' + (err as Error).message, chatId)
  }
}

async function loop(myGeneration: number): Promise<void> {
  while (running && myGeneration === generation) {
    const updates = await tg<TgUpdate[]>('getUpdates', { offset, timeout: 25 })
    if (!running || myGeneration !== generation) break
    if (!updates) { await new Promise((r) => setTimeout(r, 3000)); continue }
    for (const u of updates) {
      offset = u.update_id + 1
      await handleUpdate(u)
    }
  }
}

export function initTelegram(getWindow: () => BrowserWindow | null): void {
  getWin = getWindow
  restartTelegram()
}

/** Перезапуск при смене настроек. */
export function restartTelegram(): void {
  running = false
  generation++ // старый цикл (даже в ожидании long-poll) больше не наш
  const s = getSettings()
  if (s.telegramBotEnabled && s.telegramBotToken.trim()) {
    // небольшая пауза, чтобы предыдущий long-poll завершился
    setTimeout(() => {
      running = true
      offset = 0
      void loop(generation)
      logger.info('telegram', 'Telegram-бот активен')
    }, 500)
  }
}

export function shutdownTelegram(): void {
  running = false
}
