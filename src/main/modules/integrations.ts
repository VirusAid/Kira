/**
 * Integrations — подключение внешних сервисов:
 *  • Obsidian — локальное хранилище заметок (папка с .md), без авторизации
 *  • Notion   — internal integration token (пользователь создаёт сам)
 *  • Google   — Calendar/Gmail через OAuth (пользователь регистрирует приложение)
 */
import { shell } from 'electron'
import { promises as fsp, existsSync } from 'fs'
import { join, extname, basename } from 'path'
import http from 'http'
import { getSettings, saveSettings } from './settings'
import { logger } from './logger'
import type { ActionResult } from '../../shared/types'

// ─── Obsidian (локальные заметки) ────────────────────────────────────────────

function vault(): string | null {
  const v = getSettings().obsidianVault
  return v && existsSync(v) ? v : null
}

async function walkMd(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth > 5 || out.length > 500) return
  let entries
  try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) await walkMd(full, depth + 1, out)
    else if (extname(e.name).toLowerCase() === '.md') out.push(full)
  }
}

export async function notesSearch(query: string): Promise<ActionResult> {
  const root = vault()
  if (!root) return { ok: false, message: 'Obsidian не подключён (укажи папку хранилища в Интеграциях)' }
  const files: string[] = []
  await walkMd(root, 0, files)
  const q = query.toLowerCase()
  const hits: string[] = []
  for (const f of files) {
    if (hits.length >= 15) break
    const name = basename(f, '.md')
    let match = name.toLowerCase().includes(q)
    let snippet = ''
    if (!match) {
      try {
        const content = await fsp.readFile(f, 'utf-8')
        const idx = content.toLowerCase().indexOf(q)
        if (idx !== -1) { match = true; snippet = content.slice(Math.max(0, idx - 40), idx + 80).replace(/\s+/g, ' ') }
      } catch { /* skip */ }
    }
    if (match) hits.push(`• ${name}${snippet ? ` — «${snippet}»` : ''}`)
  }
  return { ok: true, message: `Заметок найдено: ${hits.length}`, data: hits.join('\n') || 'Ничего не найдено' }
}

export async function noteRead(name: string): Promise<ActionResult> {
  const root = vault()
  if (!root) return { ok: false, message: 'Obsidian не подключён' }
  const files: string[] = []
  await walkMd(root, 0, files)
  const q = name.toLowerCase().replace(/\.md$/, '')
  const file = files.find((f) => basename(f, '.md').toLowerCase() === q) ?? files.find((f) => basename(f, '.md').toLowerCase().includes(q))
  if (!file) return { ok: false, message: `Заметка «${name}» не найдена` }
  const content = await fsp.readFile(file, 'utf-8')
  return { ok: true, message: basename(file), data: content.slice(0, 8000) }
}

export async function noteWrite(name: string, content: string, append = false): Promise<ActionResult> {
  const root = vault()
  if (!root) return { ok: false, message: 'Obsidian не подключён' }
  const safe = name.replace(/[<>:"/\\|?*]/g, '').replace(/\.md$/i, '')
  const file = join(root, `${safe}.md`)
  if (append && existsSync(file)) {
    await fsp.appendFile(file, `\n\n${content}`, 'utf-8')
  } else {
    await fsp.writeFile(file, content, 'utf-8')
  }
  logger.action('obsidian', `${append ? 'Дополнена' : 'Создана'} заметка: ${safe}`)
  return { ok: true, message: `Заметка «${safe}» сохранена в Obsidian` }
}

// ─── Notion ──────────────────────────────────────────────────────────────────

async function notionApi(endpoint: string, method: string, body?: unknown): Promise<unknown> {
  const token = getSettings().notionToken
  if (!token) throw new Error('Notion не подключён (вставь токен интеграции в Интеграциях)')
  const res = await fetch(`https://api.notion.com/v1/${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) throw new Error(`Notion: ошибка ${res.status}`)
  return res.json()
}

function pageTitle(p: { properties?: Record<string, { title?: { plain_text?: string }[] }> }): string {
  const props = p.properties ?? {}
  for (const key of Object.keys(props)) {
    const t = props[key]?.title
    if (t?.length) return t.map((x) => x.plain_text).join('')
  }
  return 'Без названия'
}

export async function notionSearch(query: string): Promise<ActionResult> {
  try {
    const r = (await notionApi('search', 'POST', { query, page_size: 10 })) as { results?: { id: string; url?: string; properties?: never }[] }
    const items = (r.results ?? []).map((p) => `• ${pageTitle(p as never)}${p.url ? ` (${p.url})` : ''}`)
    return { ok: true, message: `Notion: найдено ${items.length}`, data: items.join('\n') || 'Ничего не найдено' }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export async function notionCreate(title: string, content: string): Promise<ActionResult> {
  try {
    // родитель — первая доступная интеграции страница
    const search = (await notionApi('search', 'POST', { page_size: 1, filter: { property: 'object', value: 'page' } })) as { results?: { id: string }[] }
    const parent = search.results?.[0]?.id
    if (!parent) return { ok: false, message: 'Дай интеграции Kira доступ хотя бы к одной странице в Notion (кнопка «…» → Connections).' }
    await notionApi('pages', 'POST', {
      parent: { page_id: parent },
      properties: { title: { title: [{ text: { content: title.slice(0, 100) } }] } },
      children: content ? [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: content.slice(0, 1900) } }] } }] : []
    })
    logger.action('notion', `Создана страница: ${title}`)
    return { ok: true, message: `Создала страницу «${title}» в Notion` }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

// ─── Google (OAuth: Calendar) ────────────────────────────────────────────────

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email'
].join(' ')

/** OAuth-подключение через loopback: открывает браузер, ловит код, меняет на refresh token. */
export function connectGoogle(): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const s = getSettings()
    if (!s.googleClientId || !s.googleClientSecret) {
      resolve({ ok: false, message: 'Сначала укажи Client ID и Client Secret (см. инструкцию).' })
      return
    }
    const server = http.createServer(async (reqHttp, resHttp) => {
      const url = new URL(reqHttp.url ?? '/', `http://127.0.0.1`)
      const code = url.searchParams.get('code')
      resHttp.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      resHttp.end('<html><body style="background:#0a0a12;color:#c4b5fd;font-family:sans-serif;text-align:center;padding-top:80px"><h2>Kira подключена ✓</h2><p>Можно вернуться в приложение и закрыть это окно.</p></body></html>')
      server.close()
      if (!code) { resolve({ ok: false, message: 'Не получен код авторизации' }); return }
      try {
        const port = (server.address() as { port: number }).port
        const tok = await (await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code, client_id: s.googleClientId, client_secret: s.googleClientSecret,
            redirect_uri: `http://127.0.0.1:${port}`, grant_type: 'authorization_code'
          })
        })).json() as { refresh_token?: string; error?: string }
        if (tok.refresh_token) {
          saveSettings({ ...getSettings(), googleRefreshToken: tok.refresh_token })
          logger.info('google', 'Google подключён')
          resolve({ ok: true, message: 'Google подключён! Теперь Kira видит твой календарь.' })
        } else {
          resolve({ ok: false, message: `Не удалось подключить: ${tok.error ?? 'нет refresh token'}` })
        }
      } catch (e) {
        resolve({ ok: false, message: (e as Error).message })
      }
    })
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      const auth = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: s.googleClientId,
        redirect_uri: `http://127.0.0.1:${port}`,
        response_type: 'code',
        scope: GOOGLE_SCOPES,
        access_type: 'offline',
        prompt: 'consent'
      })
      void shell.openExternal(auth)
    })
    setTimeout(() => { try { server.close() } catch { /* */ } resolve({ ok: false, message: 'Время ожидания истекло' }) }, 180_000)
  })
}

async function googleAccessToken(): Promise<string | null> {
  const s = getSettings()
  if (!s.googleRefreshToken || !s.googleClientId) return null
  try {
    const r = await (await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: s.googleClientId, client_secret: s.googleClientSecret,
        refresh_token: s.googleRefreshToken, grant_type: 'refresh_token'
      })
    })).json() as { access_token?: string }
    return r.access_token ?? null
  } catch { return null }
}

export async function calendarToday(): Promise<ActionResult> {
  const at = await googleAccessToken()
  if (!at) return { ok: false, message: 'Google-календарь не подключён (Интеграции)' }
  const now = new Date()
  const start = new Date(now); start.setHours(0, 0, 0, 0)
  const end = new Date(now); end.setHours(23, 59, 59, 0)
  try {
    const r = await (await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${start.toISOString()}&timeMax=${end.toISOString()}&singleEvents=true&orderBy=startTime`,
      { headers: { Authorization: `Bearer ${at}` } }
    )).json() as { items?: { summary?: string; start?: { dateTime?: string; date?: string } }[] }
    const items = (r.items ?? []).map((e) => {
      const t = e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'весь день'
      return `${t} — ${e.summary ?? 'без названия'}`
    })
    return { ok: true, message: `Событий сегодня: ${items.length}`, data: items.join('\n') || 'На сегодня событий нет' }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

// ─── Gmail (на той же Google-авторизации) ────────────────────────────────────

/** Заголовок письма из metadata. */
function header(m: { payload?: { headers?: { name: string; value: string }[] } }, name: string): string {
  return m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

/** Список писем по запросу Gmail (по умолчанию непрочитанные во «Входящих»). */
export async function gmailList(query = 'is:unread in:inbox', max = 8): Promise<ActionResult> {
  const at = await googleAccessToken()
  if (!at) return { ok: false, message: 'Gmail не подключён (Интеграции → Google)' }
  try {
    const list = await (await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${max}`,
      { headers: { Authorization: `Bearer ${at}` } }
    )).json() as { messages?: { id: string }[] }
    const ids = (list.messages ?? []).map((m) => m.id)
    if (!ids.length) return { ok: true, message: 'Писем нет', data: 'Новых писем нет' }
    const rows: string[] = []
    for (const id of ids) {
      const m = await (await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
        { headers: { Authorization: `Bearer ${at}` } }
      )).json() as { payload?: { headers?: { name: string; value: string }[] } }
      const from = header(m, 'From').replace(/<[^>]*>/, '').replace(/"/g, '').trim()
      rows.push(`• ${from || 'без отправителя'}: ${header(m, 'Subject') || '(без темы)'}`)
    }
    return { ok: true, message: `Писем: ${rows.length}`, data: rows.join('\n') }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

/**
 * Подробная выжимка входящих: отправитель, тема и короткий сниппет письма —
 * чтобы LLM мог сделать осмысленное саммари «что нового в почте».
 */
export async function gmailDigest(max = 10): Promise<ActionResult> {
  const at = await googleAccessToken()
  if (!at) return { ok: false, message: 'Gmail не подключён (Интеграции → Google)' }
  try {
    const list = await (await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent('is:unread in:inbox')}&maxResults=${max}`,
      { headers: { Authorization: `Bearer ${at}` } }
    )).json() as { messages?: { id: string }[] }
    const ids = (list.messages ?? []).map((m) => m.id)
    if (!ids.length) return { ok: true, message: 'Новых писем нет', data: 'Непрочитанных писем нет' }
    const rows: string[] = []
    for (const id of ids) {
      const m = await (await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
        { headers: { Authorization: `Bearer ${at}` } }
      )).json() as { snippet?: string; payload?: { headers?: { name: string; value: string }[] } }
      const from = header(m, 'From').replace(/<[^>]*>/, '').replace(/"/g, '').trim()
      const snippet = (m.snippet ?? '').replace(/\s+/g, ' ').slice(0, 160)
      rows.push(`• От: ${from || '?'}\n  Тема: ${header(m, 'Subject') || '(без темы)'}\n  Кратко: ${snippet}`)
    }
    return {
      ok: true,
      message: `Непрочитанных: ${rows.length}`,
      data: rows.join('\n\n') + '\n\n(Сделай короткое человеческое саммари: что важное пришло, на что стоит ответить.)'
    }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

/** Отправить письмо через Gmail. */
export async function gmailSend(to: string, subject: string, body: string): Promise<ActionResult> {
  const at = await googleAccessToken()
  if (!at) return { ok: false, message: 'Gmail не подключён' }
  try {
    const subjEnc = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`
    const raw = [
      `To: ${to}`,
      `Subject: ${subjEnc}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      body
    ].join('\r\n')
    const encoded = Buffer.from(raw).toString('base64url')
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: encoded })
    })
    if (!r.ok) return { ok: false, message: `Gmail: ошибка ${r.status}` }
    logger.action('gmail', `Письмо отправлено: ${to}`)
    return { ok: true, message: `Письмо отправлено на ${to}` }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

// ─── Discord (вебхук) ────────────────────────────────────────────────────────

export async function discordSend(message: string): Promise<ActionResult> {
  const url = getSettings().discordWebhook
  if (!url) return { ok: false, message: 'Discord не подключён (вставь URL вебхука в Интеграциях)' }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message.slice(0, 1900), username: 'Kira' })
    })
    if (!r.ok && r.status !== 204) return { ok: false, message: `Discord: ошибка ${r.status}` }
    logger.action('discord', 'Сообщение отправлено в Discord')
    return { ok: true, message: 'Отправила в Discord' }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

/** Сводка статуса интеграций для UI. */
export function integrationStatus(): { obsidian: boolean; notion: boolean; google: boolean; discord: boolean } {
  const s = getSettings()
  return {
    obsidian: !!(s.obsidianVault && existsSync(s.obsidianVault)),
    notion: !!s.notionToken,
    google: !!s.googleRefreshToken,
    discord: !!s.discordWebhook
  }
}
