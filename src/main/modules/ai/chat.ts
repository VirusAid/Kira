/**
 * Chat orchestrator — управляет полным циклом ответа Kira:
 * стриминг текста → разбор команд действий → выполнение →
 * возврат результатов модели → продолжение ответа (до 4 раундов).
 *
 * Опасные действия не выполняются автоматически: renderer получает
 * событие ai:confirm и запрашивает подтверждение пользователя.
 */
import { BrowserWindow } from 'electron'
import { streamChat, candidateProviders, visionCandidateProviders, type AIMessage, resolveEndpoint } from './client'
import { buildSystemPrompt, parseActions, stripActions, executeAction, isDangerous, describeAction, type ParsedAction } from './kira'
import { logger } from '../logger'
import { getSettings } from '../settings'
import type { AIProviderId, AIRequest, ChatRole } from '../../../shared/types'

// Kira работает как полноценный агент прямо в чате/голосе: многошаговые задачи
// выполняются до конца в рамках одного запроса. Лимит раундов инструментов
// поднят, чтобы длинные автономные задачи доходили до результата.
const MAX_TOOL_ROUNDS = 16

/**
 * Действия РЕАЛЬНОГО управления интерфейсом (мышь/клавиатура) — после них Kira
 * «смотрит» на результат для самоисправления. Открытие программ/сайтов сюда НЕ
 * входит: им зрение не нужно, а лишний скриншот зря гонит запрос на vision-модель.
 */
const CONTROL_ACTIONS = new Set([
  'click', 'click_text', 'right_click', 'double_click', 'scroll', 'press_keys', 'type_text'
])

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface StreamAttemptError extends Error {
  retryable: boolean
  emittedAny: boolean
}

/** Один сетевой запрос стриминга к конкретному провайдеру. */
function streamAttempt(
  win: BrowserWindow,
  req: AIRequest,
  history: AIMessage[],
  providerId: AIProviderId,
  state: ActiveRequest
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let pending = ''
    let emittedAny = false

    const flushSafe = (force: boolean): void => {
      let safeLen = pending.length
      if (!force) {
        const lastOpen = pending.lastIndexOf('[[')
        const partial = Math.max(lastOpen, pending.lastIndexOf('['))
        if (partial !== -1 && pending.indexOf(']]', partial) === -1) safeLen = partial
      }
      if (safeLen <= 0) return
      const chunk = pending.slice(0, safeLen)
      pending = pending.slice(safeLen)
      if (chunk) {
        emittedAny = true
        send(win, 'ai:chunk', { requestId: req.requestId, delta: chunk })
      }
    }

    const handle = streamChat(
      history,
      {
        onDelta: (delta) => {
          pending += delta
          pending = pending.replace(/\[\[kira:[^\]]*\]\]/g, '')
          flushSafe(false)
        },
        onDone: (full) => { flushSafe(true); resolve(full) },
        onError: (err, retryable) => {
          const e = new Error(err) as StreamAttemptError
          e.retryable = retryable
          e.emittedAny = emittedAny
          reject(e)
        }
      },
      { providerId }
    )
    state.abort = handle.abort
  })
}

/**
 * Раунд генерации с отказоустойчивостью: при rate limit / сбое пробуем
 * следующего провайдера с ключом, а на последнем — одну паузу и повтор.
 */
function historyHasImage(history: AIMessage[]): boolean {
  return history.some((m) => Array.isArray(m.content) && m.content.some((c) => c.type === 'image_url'))
}

async function streamRound(
  win: BrowserWindow,
  req: AIRequest,
  history: AIMessage[],
  state: ActiveRequest
): Promise<string> {
  // если в запросе есть изображение — сначала пробуем vision-модель (Gemini)
  const candidates = historyHasImage(history) ? visionCandidateProviders() : candidateProviders()
  let lastError = 'Нет доступного провайдера ИИ'

  for (let i = 0; i < candidates.length; i++) {
    const provider = candidates[i]
    const isLast = i === candidates.length - 1
    const attempts = isLast ? 2 : 1

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (state.aborted) return ''
      try {
        return await streamAttempt(win, req, history, provider, state)
      } catch (err) {
        const e = err as StreamAttemptError
        lastError = e.message
        // пользователь уже увидел часть ответа — переключаться поздно
        if (e.emittedAny) throw new Error(lastError)
        // есть следующий провайдер — пробуем его при ЛЮБОЙ ошибке текущего
        // (занят, лимит, неверный ключ 400/401/403, не та модель 404 …),
        // чтобы одна кривая настройка не роняла весь ответ
        if (!isLast) {
          logger.warn('chat', `«${provider}» недоступен (${e.message.slice(0, 70)}), переключаюсь на «${candidates[i + 1]}»`)
          send(win, 'ai:action', {
            requestId: req.requestId, name: 'fallback', ok: true,
            message: `«${provider}» недоступен — пробую «${candidates[i + 1]}»`
          })
          break // к следующему провайдеру
        }
        // последний провайдер: повтор только если ошибка временная
        if (e.retryable && attempt < attempts - 1) {
          send(win, 'ai:action', {
            requestId: req.requestId, name: 'retry', ok: true,
            message: 'Лимит запросов — жду 4 сек и пробую снова…'
          })
          await sleep(4000)
        }
      }
    }
  }
  throw new Error(lastError)
}

interface ActiveRequest {
  abort: () => void
  aborted: boolean
}

const active = new Map<string, ActiveRequest>()

/** Ожидающие подтверждения опасные действия: requestId → resolve. */
const pendingConfirms = new Map<string, (approved: boolean) => void>()

export function confirmAction(confirmId: string, approved: boolean): void {
  pendingConfirms.get(confirmId)?.(approved)
  pendingConfirms.delete(confirmId)
}

export function abortRequest(requestId: string): void {
  const req = active.get(requestId)
  if (req) {
    req.aborted = true
    req.abort()
  }
}

function send(win: BrowserWindow, channel: string, payload: unknown): void {
  if (!win.isDestroyed()) win.webContents.send(channel, payload)
}

async function askConfirmation(win: BrowserWindow, requestId: string, description: string): Promise<boolean> {
  if (!getSettings().confirmDangerous) return true
  const confirmId = `${requestId}:${Math.random().toString(36).slice(2)}`
  send(win, 'ai:confirm', { confirmId, requestId, description })
  return new Promise<boolean>((resolve) => {
    pendingConfirms.set(confirmId, resolve)
    // авто-отказ через 2 минуты
    setTimeout(() => {
      if (pendingConfirms.has(confirmId)) {
        pendingConfirms.delete(confirmId)
        resolve(false)
      }
    }, 120_000)
  })
}

/**
 * Полный цикл генерации ответа. События renderer:
 *  ai:chunk  {requestId, delta}          — фрагмент текста (уже без команд)
 *  ai:action {requestId, name, ok, message} — выполненное действие
 *  ai:done   {requestId, content, model} — финальный текст
 *  ai:error  {requestId, error}
 */
export async function handleChatRequest(win: BrowserWindow, req: AIRequest): Promise<void> {
  const settings = getSettings()
  const endpoint = resolveEndpoint()

  // ── KIRA CORE: Local First ──
  // Запрос сперва идёт в Command Engine: локальные команды («открой браузер»,
  // «громче», «скриншот»…) выполняются мгновенно и БЕЗ LLM. LLM — только
  // AI Router для того, что ядро не смогло обработать само.
  const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')
  if (!req.imageBase64 && req.withTools !== false && typeof lastUser?.content === 'string') {
    try {
      const { commandEngine, initKiraCore } = await import('../../core')
      initKiraCore()
      const local = await commandEngine.tryHandle(lastUser.content, {
        source: 'chat',
        confirm: (description) => askConfirmation(win, req.requestId, description)
      })
      if (local.handled && local.result) {
        send(win, 'ai:action', {
          requestId: req.requestId, name: local.actionId ?? 'core',
          ok: local.result.ok, message: local.result.message
        })
        send(win, 'ai:done', { requestId: req.requestId, content: local.reply || 'Готово.', model: 'kira-core' })
        logger.ai('core', `Локально (без LLM): ${local.actionId}`)
        return
      }
    } catch (err) {
      logger.warn('core', `Ядро пропустило запрос: ${(err as Error).message}`)
    }
  }

  const history: AIMessage[] = [
    { role: 'system', content: buildSystemPrompt({ withTools: req.withTools !== false }) },
    ...req.messages.map((m) => ({ role: m.role as ChatRole, content: m.content }))
  ]

  // vision: прикрепляем скриншот к последнему сообщению пользователя
  if (req.imageBase64) {
    const last = history[history.length - 1]
    if (last && last.role === 'user' && typeof last.content === 'string') {
      history[history.length - 1] = {
        role: 'user',
        content: [
          { type: 'text', text: last.content },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${req.imageBase64}` } }
        ]
      }
    }
  }

  let fullVisible = ''
  const state: ActiveRequest = { abort: () => {}, aborted: false }
  active.set(req.requestId, state)

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const rawText = await streamRound(win, req, history, state)

      if (state.aborted) break

      const visible = stripActions(rawText)
      if (visible) fullVisible += (fullVisible ? '\n\n' : '') + visible

      const actions = parseActions(rawText)
      if (!actions.length) break

      history.push({ role: 'assistant', content: rawText })

      // выполняем действия последовательно, собираем результаты
      const results: string[] = []
      let screenToAttach: string | null = null
      let controlActed = false
      for (const action of actions) {
        if (state.aborted) break

        // «зрение»: захватываем экран и приложим его к следующему запросу (для vision-модели)
        if (action.name === 'see_screen') {
          try {
            const { captureScreenBase64 } = await import('../system')
            screenToAttach = await captureScreenBase64()
            send(win, 'ai:action', { requestId: req.requestId, name: 'see_screen', ok: true, message: 'Смотрю на экран' })
            results.push('see_screen: экран захвачен, изображение приложено ниже — опиши/проанализируй то, что видишь')
          } catch (err) {
            results.push(`see_screen: не удалось захватить экран — ${(err as Error).message}`)
          }
          continue
        }

        let approved = true
        if (isDangerous(action)) {
          approved = await askConfirmation(win, req.requestId, describeAction(action))
        }
        if (!approved) {
          results.push(`${action.name}: пользователь ОТКЛОНИЛ действие`)
          send(win, 'ai:action', { requestId: req.requestId, name: action.name, ok: false, message: 'Отклонено пользователем' })
          logger.warn('kira', `Действие отклонено: ${describeAction(action)}`)
          continue
        }
        const result = await executeAction(action)
        send(win, 'ai:action', {
          requestId: req.requestId,
          name: action.name,
          ok: result.ok,
          message: result.message
        })
        const dataStr = result.data != null ? `\n${String(result.data).slice(0, 4000)}` : ''
        results.push(`${action.name}: ${result.ok ? 'OK' : 'ОШИБКА'} — ${result.message}${dataStr}`)
        // самоисправление: после клика/ввода прикладываем свежий скриншот, чтобы
        // Kira увидела результат и при ошибке поправилась
        if (CONTROL_ACTIONS.has(action.name)) controlActed = true
      }

      if (state.aborted) break

      // после действий управления — даём Kira «увидеть» результат
      if (controlActed && !screenToAttach) {
        try {
          const { captureScreenBase64 } = await import('../system')
          await new Promise((r) => setTimeout(r, 500)) // ждём отрисовку интерфейса
          screenToAttach = await captureScreenBase64()
        } catch { /* экран недоступен */ }
      }

      const followupText =
        `[СИСТЕМА: результаты выполнения действий]\n${results.join('\n')}\n\n` +
        (controlActed
          ? 'Ниже — свежий скриншот экрана после твоих действий. Проверь, получилось ли задуманное. '
            + 'Если элемент не нажался или результат не тот — исправься (попробуй click_text с другим названием или другие координаты). '
          : '') +
        'Продолжи ответ пользователю с учётом результатов. Если всё сделано — коротко подтверди. ' +
        'Не повторяй уже выполненные команды.'

      if (screenToAttach) {
        history.push({
          role: 'user',
          content: [
            { type: 'text', text: followupText },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenToAttach}` } }
          ]
        })
      } else {
        history.push({ role: 'user', content: followupText })
      }
    }

    send(win, 'ai:done', {
      requestId: req.requestId,
      content: fullVisible || '…',
      model: endpoint.model
    })
    logger.ai('chat', `Ответ сгенерирован (${endpoint.model}, ${fullVisible.length} симв.)`)
  } catch (err) {
    const message = (err as Error).message
    logger.error('chat', message)
    send(win, 'ai:error', { requestId: req.requestId, error: message })
  } finally {
    active.delete(req.requestId)
  }
}

/** Генерация короткого названия чата по первому сообщению. */
/**
 * Название диалога выводим локально из первого сообщения — без отдельного
 * запроса к ИИ, чтобы не тратить лимиты бесплатных провайдеров.
 */
export async function generateChatTitle(firstMessage: string): Promise<string> {
  const clean = firstMessage.replace(/\s+/g, ' ').trim()
  if (!clean) return 'Новый диалог'
  const words = clean.split(' ').slice(0, 6).join(' ')
  const title = words.length > 48 ? words.slice(0, 48) + '…' : words
  // с заглавной буквы
  return title.charAt(0).toUpperCase() + title.slice(1)
}
