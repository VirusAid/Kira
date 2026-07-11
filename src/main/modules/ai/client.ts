/**
 * AI-клиент — единый стриминговый доступ ко всем провайдерам.
 *
 * Все поддерживаемые провайдеры имеют OpenAI-совместимый endpoint:
 *  • Ollama      — локально, полностью бесплатно (http://localhost:11434/v1)
 *  • Groq        — бесплатный tier, очень быстрый
 *  • OpenRouter  — модели с суффиксом ":free" бесплатны
 *  • Gemini      — бесплатный tier Google AI
 */
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
  const rest: AIProviderId[] = ['groq', 'gemini', 'openrouter']
  for (const p of rest) {
    if (p === s.provider) continue
    const cfg = s.providers[p]
    if (cfg.apiKey && cfg.apiKey.trim()) order.push(p)
  }
  return order
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

  void (async () => {
    let full = ''
    try {
      const res = await fetch(endpoint.url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...endpoint.headers },
        body: JSON.stringify({
          model: endpoint.model,
          messages,
          stream: true,
          temperature: options?.temperature ?? 0.7
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
export async function completeChat(messages: AIMessage[]): Promise<string> {
  const endpoint = resolveEndpoint()
  const res = await fetch(endpoint.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...endpoint.headers },
    body: JSON.stringify({ model: endpoint.model, messages, stream: false })
  })
  if (!res.ok) {
    throw new Error(humanizeApiError(res.status, await res.text().catch(() => '')))
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return json.choices?.[0]?.message?.content ?? ''
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
