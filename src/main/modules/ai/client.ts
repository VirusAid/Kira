/**
 * AI-клиент — единый стриминговый доступ ко всем провайдерам.
 *
 * Все поддерживаемые провайдеры имеют OpenAI-совместимый endpoint:
 *  • Ollama      — локально, полностью бесплатно (http://localhost:11434/v1)
 *  • Groq        — бесплатный tier, очень быстрый
 *  • OpenRouter  — модели с суффиксом ":free" бесплатны
 *  • Gemini      — бесплатный tier Google AI
 */
import Anthropic from '@anthropic-ai/sdk'
import { getSettings } from '../settings'
import type { AIProviderId, ChatRole } from '../../../shared/types'

export interface AIMessage {
  role: ChatRole
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
}

interface ProviderEndpoint {
  url: string
  headers: Record<string, string>
  model: string
}

export function resolveEndpoint(providerId?: AIProviderId): ProviderEndpoint {
  const s = getSettings()
  const id = providerId ?? s.provider
  const cfg = s.providers[id]

  switch (id) {
    case 'ollama':
      return {
        url: `${(cfg.baseUrl || 'http://localhost:11434').replace(/\/$/, '')}/v1/chat/completions`,
        headers: {},
        model: cfg.model || 'llama3.1'
      }
    case 'groq':
      return {
        url: 'https://api.groq.com/openai/v1/chat/completions',
        headers: { Authorization: `Bearer ${cfg.apiKey ?? ''}` },
        model: cfg.model || 'llama-3.3-70b-versatile'
      }
    case 'openrouter':
      return {
        url: 'https://openrouter.ai/api/v1/chat/completions',
        headers: {
          Authorization: `Bearer ${cfg.apiKey ?? ''}`,
          'HTTP-Referer': 'https://kira.local',
          'X-Title': 'Kira Assistant'
        },
        model: cfg.model || 'meta-llama/llama-3.3-70b-instruct:free'
      }
    case 'gemini':
      return {
        url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        headers: { Authorization: `Bearer ${cfg.apiKey ?? ''}` },
        model: cfg.model || 'gemini-3.5-flash'
      }
    case 'deepseek':
      return {
        url: 'https://api.deepseek.com/v1/chat/completions',
        headers: { Authorization: `Bearer ${cfg.apiKey ?? ''}` },
        model: cfg.model || 'deepseek-chat'
      }
    case 'glm':
      // Z.ai (Zhipu GLM) — OpenAI-совместимый международный endpoint
      return {
        url: 'https://api.z.ai/api/paas/v4/chat/completions',
        headers: { Authorization: `Bearer ${cfg.apiKey ?? ''}` },
        model: cfg.model || 'glm-5.2'
      }
    case 'claude':
      // Anthropic — свой формат API; запросы идут через официальный SDK
      // (ветки в streamChat/completeChat), url здесь только для отчётности
      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: {},
        model: cfg.model || 'claude-opus-4-8'
      }
  }
}

// ─── Claude (Anthropic) — нативный Messages API через официальный SDK ────────

function claudeClient(): Anthropic {
  const key = (getSettings().providers.claude.apiKey ?? '').trim()
  if (!key) throw new Error('Не задан API-ключ Claude. Добавь его в Настройки → Модели ИИ → Claude.')
  return new Anthropic({ apiKey: key })
}

/**
 * AIMessage[] (OpenAI-формат Kira) → параметры Anthropic Messages API:
 * system — отдельным полем, картинки data-URL → базовые image-блоки,
 * первый ход обязан быть от user.
 */
function toClaudeParams(messages: AIMessage[]): {
  system: string
  messages: Anthropic.MessageParam[]
} {
  const systemParts: string[] = []
  const out: Anthropic.MessageParam[] = []
  for (const m of messages) {
    if (m.role === 'system') {
      if (typeof m.content === 'string' && m.content.trim()) systemParts.push(m.content)
      continue
    }
    const role: 'user' | 'assistant' = m.role === 'assistant' ? 'assistant' : 'user'
    if (typeof m.content === 'string') {
      if (m.content.trim()) out.push({ role, content: m.content })
      continue
    }
    const blocks: Anthropic.ContentBlockParam[] = []
    for (const c of m.content) {
      if (c.type === 'text' && c.text?.trim()) {
        blocks.push({ type: 'text', text: c.text })
      } else if (c.type === 'image_url' && c.image_url?.url) {
        const dataUrl = c.image_url.url.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/s)
        if (dataUrl) {
          blocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: dataUrl[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: dataUrl[2]
            }
          })
        }
      }
    }
    if (blocks.length) out.push({ role, content: blocks })
  }
  if (out[0]?.role !== 'user') out.unshift({ role: 'user', content: 'Привет' })
  return { system: systemParts.join('\n\n'), messages: out }
}

/**
 * Стриминг через Anthropic SDK. thinking не задаём: без параметра запрос
 * валиден на ЛЮБОЙ модели Claude, которую пользователь выберет в настройках
 * (adaptive не принимается старыми, budget_tokens отвергается новыми).
 * temperature тоже не шлём — на Opus 4.7+ параметр удалён (400).
 */
function streamClaude(
  messages: AIMessage[],
  callbacks: {
    onDelta: (text: string) => void
    onDone: (full: string) => void
    onError: (err: string, retryable: boolean) => void
  },
  model: string
): StreamHandle {
  const controller = new AbortController()
  void (async () => {
    let full = ''
    try {
      const { system, messages: msgs } = toClaudeParams(messages)
      const stream = claudeClient().messages.stream(
        {
          model,
          max_tokens: 4096,
          ...(system ? { system } : {}),
          messages: msgs
        },
        { signal: controller.signal, timeout: 120_000 }
      )
      stream.on('text', (delta) => {
        full += delta
        callbacks.onDelta(delta)
      })
      const final = await stream.finalMessage()
      if (final.stop_reason === 'refusal' && !full) {
        callbacks.onError('Claude отклонил запрос (политика безопасности). Попробуй переформулировать.', false)
        return
      }
      callbacks.onDone(full)
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError || (err as Error).name === 'AbortError') {
        callbacks.onDone(full)
      } else if (err instanceof Anthropic.APIError && typeof err.status === 'number') {
        callbacks.onError(humanizeApiError(err.status, err.message, 'claude'), isRetryableStatus(err.status))
      } else {
        callbacks.onError(connectionError(err as Error, 'claude'), true)
      }
    }
  })()
  return { abort: () => controller.abort() }
}

/** Нестриминговый запрос к Claude (для completeChat). */
async function completeClaude(messages: AIMessage[], model: string): Promise<string> {
  const { system, messages: msgs } = toClaudeParams(messages)
  try {
    const resp = await claudeClient().messages.create(
      { model, max_tokens: 1600, ...(system ? { system } : {}), messages: msgs },
      { timeout: 90_000 }
    )
    if (resp.stop_reason === 'refusal') {
      throw new Error('Claude отклонил запрос (политика безопасности)')
    }
    return resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
  } catch (err) {
    if (err instanceof Anthropic.APIError && typeof err.status === 'number') {
      throw new Error(humanizeApiError(err.status, err.message, 'claude'))
    }
    throw err
  }
}

export interface StreamHandle {
  abort: () => void
}

/**
 * Стриминг ответа модели. onDelta вызывается для каждого фрагмента текста,
 * onDone — по завершении, onError — при ошибке.
 */
/** Провайдеры с поддержкой зрения (изображений). Gemini надёжнее всего. */
export function visionCandidateProviders(): AIProviderId[] {
  const s = getSettings()
  const order: AIProviderId[] = []
  if (s.providers.gemini.apiKey?.trim()) order.push('gemini')
  if (s.providers.claude.apiKey?.trim()) order.push('claude')
  if (s.providers.openrouter.apiKey?.trim()) order.push('openrouter')
  // добавляем текущий и остальных как запас
  for (const p of candidateProviders()) if (!order.includes(p)) order.push(p)
  return order
}

/** Провайдеры-кандидаты для отказоустойчивости: текущий + другие с ключом. */
export function candidateProviders(): AIProviderId[] {
  const s = getSettings()
  const order: AIProviderId[] = [s.provider]
  // добавляем облачных провайдеров, у которых задан ключ (ollama — только если выбран явно)
  const rest: AIProviderId[] = ['groq', 'gemini', 'openrouter', 'deepseek', 'claude', 'glm']
  for (const p of rest) {
    if (p === s.provider) continue
    const cfg = s.providers[p]
    if (cfg.apiKey && cfg.apiKey.trim()) order.push(p)
  }
  return order
}

/**
 * Живой список всех доступных моделей провайдера (через его /models endpoint).
 * Возвращает id моделей; при ошибке/без ключа — пустой массив (UI откатится на
 * зашитый список).
 */
export async function listProviderModels(providerId: AIProviderId): Promise<string[]> {
  const cfg = getSettings().providers[providerId]
  const key = (cfg.apiKey ?? '').trim()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ids = (arr: any[], f: (m: any) => string): string[] =>
    [...new Set((arr ?? []).map(f).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b))
  try {
    if (providerId === 'openrouter') {
      const r = await fetch('https://openrouter.ai/api/v1/models')
      const j = (await r.json()) as { data?: unknown[] }
      return ids(j.data ?? [], (m) => m.id)
    }
    if (providerId === 'groq') {
      if (!key) return []
      const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` } })
      const j = (await r.json()) as { data?: unknown[] }
      return ids(j.data ?? [], (m) => m.id)
    }
    if (providerId === 'gemini') {
      if (!key) return []
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`)
      const j = (await r.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] }
      return ids(
        (j.models ?? []).filter((m) =>
          (m.supportedGenerationMethods ?? []).includes('generateContent')),
        (m) => String(m.name).replace(/^models\//, '')
      )
    }
    if (providerId === 'deepseek') {
      if (!key) return []
      const r = await fetch('https://api.deepseek.com/models', { headers: { Authorization: `Bearer ${key}` } })
      const j = (await r.json()) as { data?: unknown[] }
      return ids(j.data ?? [], (m) => m.id)
    }
    if (providerId === 'claude') {
      if (!key) return []
      const found: string[] = []
      for await (const m of claudeClient().models.list()) found.push(m.id)
      return [...new Set(found)].sort((a, b) => a.localeCompare(b))
    }
    if (providerId === 'glm') {
      if (!key) return []
      const r = await fetch('https://api.z.ai/api/paas/v4/models', { headers: { Authorization: `Bearer ${key}` } })
      const j = (await r.json()) as { data?: unknown[] }
      return ids(j.data ?? [], (m) => m.id)
    }
    if (providerId === 'ollama') {
      const base = (cfg.baseUrl || 'http://localhost:11434').replace(/\/$/, '')
      const r = await fetch(`${base}/api/tags`)
      const j = (await r.json()) as { models?: unknown[] }
      return ids(j.models ?? [], (m) => m.name)
    }
  } catch { /* сеть/ключ недоступны */ }
  return []
}

export function streamChat(
  messages: AIMessage[],
  callbacks: {
    onDelta: (text: string) => void
    onDone: (full: string) => void
    onError: (err: string, retryable: boolean) => void
  },
  options?: { temperature?: number; providerId?: AIProviderId }
): StreamHandle {
  const controller = new AbortController()
  const endpoint = resolveEndpoint(options?.providerId)
  const providerId = options?.providerId ?? getSettings().provider

  // Claude — не OpenAI-формат: уходит через официальный SDK Anthropic
  if (providerId === 'claude') return streamClaude(messages, callbacks, endpoint.model)

  // провайдеры без «зрения» не понимают контент-массивы с картинками:
  // при откате на них сплющиваем такие сообщения в чистый текст,
  // иначе groq отвечает 400 «content must be a string»
  const VISION_PROVIDERS = new Set<AIProviderId>(['gemini', 'openrouter'])
  const outMessages = VISION_PROVIDERS.has(providerId)
    ? messages
    : messages.map((m) =>
        Array.isArray(m.content)
          ? { ...m, content: m.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n') || '[изображение]' }
          : m)

  void (async () => {
    let full = ''
    try {
      const res = await fetch(endpoint.url, {
        method: 'POST',
        // отмена пользователем ИЛИ общий таймаут — зависший провайдер не
        // должен вешать ответ навсегда
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]),
        headers: { 'Content-Type': 'application/json', ...endpoint.headers },
        body: JSON.stringify({
          model: endpoint.model,
          messages: outMessages,
          stream: true,
          temperature: options?.temperature ?? 0.7,
          // ограничиваем ответ: без max_tokens OpenRouter резервирует максимум
          // модели (4096/16000) и на бесплатном балансе падает с 402
          max_tokens: 1600
        })
      })

      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => '')
        callbacks.onError(humanizeApiError(res.status, body, options?.providerId), isRetryableStatus(res.status))
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const payload = trimmed.slice(5).trim()
          if (payload === '[DONE]') continue
          try {
            const json = JSON.parse(payload)
            const delta: string = json.choices?.[0]?.delta?.content ?? ''
            if (delta) {
              full += delta
              callbacks.onDelta(delta)
            }
          } catch {
            /* неполный JSON-фрагмент — пропускаем */
          }
        }
      }
      callbacks.onDone(full)
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        callbacks.onDone(full)
      } else {
        // ошибка соединения — можно попробовать другого провайдера
        callbacks.onError(connectionError(err as Error, options?.providerId), true)
      }
    }
  })()

  return { abort: () => controller.abort() }
}

function isRetryableStatus(status: number): boolean {
  // 429 — rate limit, 5xx — временные ошибки сервера, 408 — таймаут,
  // 404 — не та модель у провайдера: пробуем следующего (напр. Gemini для зрения
  // с неверным именем модели не должен ронять весь ответ)
  return status === 429 || status === 408 || status === 404 || status >= 500
}

/** Нестриминговый запрос — для протоколов и внутренних задач. */
export async function completeChat(messages: AIMessage[], providerId?: AIProviderId): Promise<string> {
  const endpoint = resolveEndpoint(providerId)
  const id = providerId ?? getSettings().provider
  if (id === 'claude') return completeClaude(messages, endpoint.model)
  const res = await fetch(endpoint.url, {
    method: 'POST',
    signal: AbortSignal.timeout(90_000),
    headers: { 'Content-Type': 'application/json', ...endpoint.headers },
    body: JSON.stringify({ model: endpoint.model, messages, stream: false, max_tokens: 1600 })
  })
  if (!res.ok) {
    throw new Error(humanizeApiError(res.status, await res.text().catch(() => ''), providerId))
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return json.choices?.[0]?.message?.content ?? ''
}

/** Завершение с отказоустойчивостью: перебирает провайдеров с ключом. */
export async function completeChatResilient(messages: AIMessage[]): Promise<string> {
  const candidates = candidateProviders()
  let lastError = 'Нет доступного провайдера ИИ'
  for (const provider of candidates) {
    try {
      return await completeChat(messages, provider)
    } catch (err) {
      lastError = (err as Error).message
    }
  }
  throw new Error(lastError)
}

function humanizeApiError(status: number, body: string, providerId?: AIProviderId): string {
  const provider = providerId ?? getSettings().provider
  if (status === 401 || status === 403) {
    return `Неверный или отсутствующий API-ключ для провайдера «${provider}». Проверь настройки → Модели.`
  }
  if (status === 429) {
    return `Провайдер «${provider}» ограничил частоту запросов (rate limit). Подожди немного или смени модель.`
  }
  if (status === 404) {
    return `Модель не найдена у провайдера «${provider}». Проверь название модели в настройках.`
  }
  const detail = body.slice(0, 300)
  return `Ошибка API (${status}, ${provider}): ${detail}`
}

function connectionError(err: Error, providerId?: AIProviderId): string {
  const provider = providerId ?? getSettings().provider
  if (provider === 'ollama') {
    return 'Не удалось подключиться к Ollama. Убедись, что Ollama запущена (ollama serve) и модель скачана (ollama pull llama3.1).'
  }
  return `Ошибка соединения с провайдером «${provider}»: ${err.message}`
}

/** Проверка доступности провайдера (для настроек). */
export async function testProvider(): Promise<{ ok: boolean; message: string }> {
  try {
    const answer = await completeChat([
      { role: 'user', content: 'Ответь одним словом: работаю' }
    ])
    return { ok: true, message: `Соединение установлено. Ответ модели: ${answer.slice(0, 60)}` }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}
