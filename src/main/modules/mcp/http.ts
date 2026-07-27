/**
 * Провайдер MCP поверх HTTP (Streamable HTTP, спецификация 2025-06-18).
 *
 * Второй транспорт нужен для серверов, которые не запускаются на этом
 * компьютере: чужой сервис в сети, рабочий контур, что-то поднятое отдельно.
 * Благодаря общему контракту всё остальное — привязки, отмена, обучение,
 * подтверждение опасного — не заметило появления второго способа связи.
 *
 * Как устроен обмен по спецификации:
 *  • каждое сообщение клиента — отдельный POST на один и тот же адрес;
 *  • заголовок Accept обязан перечислять и application/json, и
 *    text/event-stream: сервер вправе ответить как одиночным объектом, так и
 *    потоком событий, и клиент обязан понимать оба;
 *  • уведомление принимается ответом 202 без тела — это не ошибка и не пустота;
 *  • сервер может выдать идентификатор сессии в Mcp-Session-Id, и тогда его
 *    нужно повторять во всех последующих запросах;
 *  • после согласования версии её тоже отправляют заголовком.
 */
import { logger } from '../logger'
import { toExecResult, type McpCallResult } from './normalize'
import { PROTOCOL_VERSION } from './types'
import type { CallContext, Disposable, McpProvider, McpServerConfig, McpStatus, McpTool } from './types'
import type { ExecResult } from '../../core/types'

const DEFAULT_TIMEOUT_MS = 30_000
const INIT_TIMEOUT_MS = 30_000

export class HttpMcpProvider implements McpProvider {
  private nextId = 1
  private tools: McpTool[] = []
  private listeners = new Set<() => void>()
  private state: McpStatus['state'] = 'unconfigured'
  private detail = 'не подключён'
  private session = ''
  private version = PROTOCOL_VERSION
  private connecting: Promise<void> | null = null

  constructor(readonly config: McpServerConfig) {}

  status(): McpStatus {
    return { state: this.state, message: this.detail, tools: this.tools.length }
  }

  private get endpoint(): string {
    return (this.config.url ?? '').trim()
  }

  async connect(): Promise<void> {
    if (this.state === 'ready') return
    if (this.connecting) return this.connecting
    this.connecting = this.doConnect().finally(() => { this.connecting = null })
    return this.connecting
  }

  private async doConnect(): Promise<void> {
    if (!this.endpoint) {
      this.state = 'unconfigured'
      this.detail = 'не указан адрес'
      return
    }
    this.state = 'connecting'
    this.detail = 'соединяюсь…'
    try {
      const init = (await this.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'Kira', title: 'Kira', version: '1.1.0' }
      }, { timeoutMs: INIT_TIMEOUT_MS })) as { protocolVersion?: string } | undefined
      if (init?.protocolVersion) this.version = init.protocolVersion
      await this.notify('notifications/initialized')
      this.tools = await this.fetchTools()
      this.state = 'ready'
      this.detail = `подключён, инструментов: ${this.tools.length}`
      logger.info('mcp', `«${this.config.title}» (сеть) подключён, инструментов: ${this.tools.length}`)
    } catch (err) {
      this.state = this.tools.length ? 'degraded' : 'offline'
      this.detail = (err as Error).message
      logger.warn('mcp', `«${this.config.title}»: ${this.detail}`)
    }
  }

  /** Заголовки: сессия и версия обязательны во всех запросах после рукопожатия. */
  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      // оба типа обязательны: сервер сам решает, чем ответить
      Accept: 'application/json, text/event-stream'
    }
    if (this.session) h['Mcp-Session-Id'] = this.session
    if (this.version) h['MCP-Protocol-Version'] = this.version
    return h
  }

  /**
   * Ответ приходит либо одним объектом, либо потоком событий. Во втором случае
   * нас интересует сообщение с нашим идентификатором: до него сервер вправе
   * прислать свои уведомления, и принимать их за ответ нельзя.
   */
  private async readResponse(res: Response, id: number): Promise<unknown> {
    const type = res.headers.get('content-type') ?? ''
    if (!type.includes('text/event-stream')) {
      const body = (await res.json()) as Record<string, unknown>
      return this.unwrap(body)
    }
    const text = await res.text()
    for (const chunk of text.split(/\n\n/)) {
      const data = chunk.split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('')
      if (!data) continue
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(data)
      } catch { continue }
      if (msg.method === 'notifications/tools/list_changed') {
        void this.refreshTools()
        continue
      }
      if (msg.id === id) return this.unwrap(msg)
    }
    throw new Error('сервер не прислал ответ')
  }

  private unwrap(msg: Record<string, unknown>): unknown {
    if (msg.error) {
      const e = msg.error as { message?: string; code?: number }
      throw new Error(e.message ?? `ошибка ${e.code ?? ''}`.trim())
    }
    return msg.result
  }

  private async request(method: string, params: unknown, ctx?: CallContext): Promise<unknown> {
    const id = this.nextId++
    const timeoutMs = ctx?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    // свой таймер плюс сигнал вызывающего: зависший сервер не должен держать
    // человека, а отмена должна доходить и до сети
    const timer = AbortSignal.timeout(timeoutMs)
    const signal = ctx?.signal ? AbortSignal.any([timer, ctx.signal]) : timer
    let res: Response
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal
      })
    } catch (err) {
      // Причину различаем сами: fetch на таймаут и на отмену бросает одинаковое
      // AbortError с английским текстом, а человеку нужно знать, что именно
      // случилось — сервер молчит или он сам передумал
      if (ctx?.signal?.aborted) throw new Error('отменено')
      if (timer.aborted) throw new Error('сервер не ответил вовремя')
      throw new Error(`нет связи: ${(err as Error).message}`)
    }
    // сессию сервер выдаёт на рукопожатии — дальше её нужно повторять
    const given = res.headers.get('mcp-session-id')
    if (given) this.session = given
    if (!res.ok) throw new Error(`сервер ответил ${res.status}`)
    return this.readResponse(res, id)
  }

  /** Уведомление: тела в ответе нет, 202 — это успех. */
  private async notify(method: string, params?: unknown): Promise<void> {
    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ jsonrpc: '2.0', method, params }),
        signal: AbortSignal.timeout(10_000)
      })
    } catch { /* уведомление некритично */ }
  }

  private async fetchTools(): Promise<McpTool[]> {
    const out: McpTool[] = []
    let cursor: string | undefined
    do {
      const page = (await this.request('tools/list', cursor ? { cursor } : {})) as {
        tools?: McpTool[]; nextCursor?: string
      }
      for (const t of page?.tools ?? []) {
        if (t && typeof t.name === 'string') {
          out.push({
            name: t.name,
            title: t.title,
            description: String(t.description ?? ''),
            inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>
          })
        }
      }
      cursor = page?.nextCursor
      if (out.length > 500) break
    } while (cursor)
    return out
  }

  private async refreshTools(): Promise<void> {
    try {
      this.tools = await this.fetchTools()
      this.detail = `подключён, инструментов: ${this.tools.length}`
      for (const cb of this.listeners) cb()
    } catch { /* состояние отражено в status() */ }
  }

  async listTools(): Promise<McpTool[]> {
    if (this.state !== 'ready') await this.connect()
    return this.tools
  }

  async call(tool: string, args: Record<string, unknown>, ctx?: CallContext): Promise<ExecResult> {
    if (this.state !== 'ready') await this.connect()
    if (this.state !== 'ready' && this.state !== 'degraded') {
      return { ok: false, message: `«${this.config.title}» недоступен: ${this.detail}` }
    }
    const known = this.tools.find((t) => t.name === tool)
    try {
      const raw = (await this.request('tools/call', { name: tool, arguments: args }, ctx)) as McpCallResult
      return toExecResult(raw ?? {}, known?.title || tool)
    } catch (err) {
      return { ok: false, message: `${this.config.title}: ${(err as Error).message}` }
    }
  }

  onToolsChanged(cb: () => void): Disposable {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  async disconnect(): Promise<void> {
    this.listeners.clear()
    // вежливо закрываем сессию; сервер вправе не поддерживать это и ответить 405
    if (this.session && this.endpoint) {
      try {
        await fetch(this.endpoint, {
          method: 'DELETE',
          headers: this.headers(),
          signal: AbortSignal.timeout(5000)
        })
      } catch { /* не страшно */ }
    }
    this.session = ''
    this.state = 'offline'
    this.detail = 'отключён'
  }
}
