/**
 * Провайдер MCP поверх stdio — сервер запускается как дочерний процесс, обмен
 * идёт построчным JSON-RPC через его stdin/stdout.
 *
 * Спецификация (2025-06-18): сообщения UTF-8, разделены переводом строки и НЕ
 * содержат переводов строки внутри; stderr сервер использует для журнала, и его
 * можно читать или игнорировать; закрытие — сначала закрыть stdin, потом, если
 * не завершился, убить процесс.
 *
 * Windows требует отдельной осторожности в двух местах, и оба уже стоили нам
 * ошибок или стоили бы:
 *
 *  • НИКАКОГО detached. `CREATE_NO_WINDOW` (windowsHide) ИГНОРИРУЕТСЯ, если
 *    процесс запущен отсоединённым, — именно так у пользователей и всплывали
 *    чёрные консольные окна.
 *
 *  • Большинство серверов запускаются через `npx`, а это `npx.cmd`. Node с
 *    версии 18 отказывается запускать .cmd без оболочки, поэтому такие команды
 *    приходится звать через cmd.exe — и тогда аргументы обязан цитировать я
 *    сам, иначе путь с пробелом развалится на два аргумента.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { logger } from '../logger'
import { toExecResult, type McpCallResult } from './normalize'
import { kiraVersion, PROTOCOL_VERSION } from './types'
import type { CallContext, Disposable, McpProvider, McpServerConfig, McpStatus, McpTool } from './types'
import type { ExecResult } from '../../core/types'

/** Сколько ждём ответа сервера по умолчанию. */
const DEFAULT_TIMEOUT_MS = 30_000
/**
 * Сколько ждём первого ответа сервера.
 *
 * Щедро, и намеренно: почти все серверы запускаются через `npx -y`, а он при
 * первом обращении СКАЧИВАЕТ пакет. На проверке это заняло 10 секунд при
 * хорошей сети — на медленной уйдёт заметно больше, и жёсткий короткий таймаут
 * превратил бы обычную установку в «сервер не отвечает».
 */
const INIT_TIMEOUT_MS = 120_000
/** Сколько ждём добровольного завершения, прежде чем убить процесс. */
const SHUTDOWN_GRACE_MS = 3000
/** Пауза между попытками поднять упавший сервер. */
const RETRY_COOLDOWN_MS = 5000

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

/**
 * Где на самом деле лежит программа и нужна ли для неё оболочка.
 *
 * Возвращает `viaShell`, только когда без оболочки действительно не обойтись:
 * лишний cmd.exe — это лишний процесс и риск неверного цитирования.
 */
export function resolveCommand(command: string): { command: string; viaShell: boolean } {
  if (process.platform !== 'win32') return { command, viaShell: false }
  const hasExt = /\.(exe|cmd|bat|com)$/i.test(command)
  if (hasExt) return { command, viaShell: /\.(cmd|bat)$/i.test(command) }
  // без расширения — ищем в PATH так же, как это делает сама Windows
  const dirs = (process.env.PATH ?? '').split(';').filter(Boolean)
  for (const ext of ['.exe', '.cmd', '.bat']) {
    for (const dir of dirs) {
      const full = join(dir, command + ext)
      if (existsSync(full)) return { command: full, viaShell: ext !== '.exe' }
    }
  }
  return { command, viaShell: false } // не нашли — пусть система сама решит
}

/**
 * Чем запускать сервер.
 *
 * `node` мы НЕ ищем в системе: внутри Electron уже есть Node (у нас — 20.x), и
 * запустить им обычный скрипт можно переменной ELECTRON_RUN_AS_NODE. Это
 * избавляет пользователя от установки Node.js и не стоит установщику ни одного
 * лишнего байта — рантайм и так внутри.
 *
 * Всё остальное (npx, python, свои программы) ищем в системе как раньше: это
 * путь для тех, кто подключает что-то своё.
 */
function launcher(command: string): { exec: string; viaShell: boolean; env: Record<string, string> } {
  if (command === 'node') {
    return { exec: process.execPath, viaShell: false, env: { ELECTRON_RUN_AS_NODE: '1' } }
  }
  const r = resolveCommand(command)
  return { exec: r.command, viaShell: r.viaShell, env: {} }
}

/**
 * Расшифровать журнал сервера.
 *
 * Сам сервер пишет в UTF-8, но если запуск не удался, сообщение приходит уже от
 * cmd.exe — а он на русской Windows говорит в CP866. Прочитанное как UTF-8, оно
 * превращается в кашу, и человек вместо «не является внутренней командой» видит
 * «��������». Отличаем по признаку сбоя декодирования.
 */
function decodeStderr(chunk: Buffer): string {
  const asUtf8 = chunk.toString('utf-8')
  if (process.platform !== 'win32' || !asUtf8.includes('�')) return asUtf8
  try {
    return new TextDecoder('cp866').decode(chunk)
  } catch {
    return asUtf8
  }
}

/** Кавычки для аргумента, уходящего через cmd.exe: путь с пробелом иначе распадётся. */
function quoteForShell(arg: string): string {
  return /[\s"^&|<>()]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg
}

export class StdioMcpProvider implements McpProvider {
  private child: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private nextId = 1
  private pending = new Map<number, Pending>()
  private tools: McpTool[] = []
  private listeners = new Set<() => void>()
  private state: McpStatus['state'] = 'unconfigured'
  /** Идущее подключение — чтобы параллельные вызовы ждали его, а не плодили процессы. */
  private connecting: Promise<void> | null = null
  /** Когда последний раз пытались подняться (защита от частых перезапусков). */
  private lastAttempt = 0
  private detail = 'не подключён'
  /** Последние строки stderr — единственная подсказка, почему сервер не встал. */
  private stderrTail: string[] = []

  constructor(readonly config: McpServerConfig) {}

  status(): McpStatus {
    return { state: this.state, message: this.detail, tools: this.tools.length }
  }

  /**
   * Подключиться. Параллельные вызовы ждут ОДНО подключение: без этого
   * первый же вызов инструмента во время старта запускал второй процесс
   * сервера — а тот, что уже поднимался, оставался сиротой.
   */
  async connect(): Promise<void> {
    if (this.child) return
    if (this.connecting) return this.connecting
    // упавший сервер не перезапускаем чаще, чем раз в несколько секунд:
    // иначе на каждый вызов будет плодиться новый процесс
    if (this.state === 'offline' && Date.now() - this.lastAttempt < RETRY_COOLDOWN_MS) return
    this.lastAttempt = Date.now()
    this.connecting = this.doConnect().finally(() => { this.connecting = null })
    return this.connecting
  }

  private async doConnect(): Promise<void> {
    if (!this.config.command.trim()) {
      this.state = 'unconfigured'
      this.detail = 'не указана команда запуска'
      return
    }
    this.state = 'connecting'
    this.detail = 'запускаю…'

    const { exec: command, viaShell, env: runtimeEnv } = launcher(this.config.command)
    // Через оболочку цитировать нужно и САМУ команду, а не только аргументы:
    // npx на Windows живёт в «C:\Program Files\nodejs\npx.cmd», и без кавычек
    // cmd.exe принимает за команду «C:\Program». Без этого ни один сервер из
    // npm не запускался бы на обычной установке Windows.
    const exe = viaShell ? quoteForShell(command) : command
    const args = viaShell ? this.config.args.map(quoteForShell) : this.config.args
    try {
      this.child = spawn(exe, args, {
        cwd: this.config.cwd || undefined,
        env: { ...process.env, ...runtimeEnv, ...this.config.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        // detached НЕ ставим: с ним windowsHide перестаёт действовать и
        // пользователь видит чёрное консольное окно
        windowsHide: true,
        shell: viaShell
      }) as ChildProcessWithoutNullStreams
    } catch (err) {
      this.fail(`не удалось запустить: ${(err as Error).message}`)
      return
    }

    this.child.stdout.setEncoding('utf-8')
    this.child.stdout.on('data', (chunk: string) => this.onData(chunk))
    this.child.stderr.on('data', (chunk: Buffer) => {
      // журнал сервера: держим только хвост — он пригодится в диагностике
      for (const line of decodeStderr(chunk).split('\n')) {
        const t = line.trim()
        if (!t) continue
        this.stderrTail.push(t)
        if (this.stderrTail.length > 10) this.stderrTail.shift()
      }
    })
    this.child.on('error', (err) => this.fail(err.message))
    this.child.on('exit', (code) => {
      const why = this.stderrTail.length ? this.stderrTail[this.stderrTail.length - 1] : `код ${code}`
      this.fail(code === 0 ? 'сервер завершился' : `сервер упал: ${why}`)
    })

    try {
      await this.handshake()
      this.tools = await this.fetchTools()
      this.state = 'ready'
      this.detail = `подключён, инструментов: ${this.tools.length}`
      logger.info('mcp', `«${this.config.title}» подключён, инструментов: ${this.tools.length}`)
    } catch (err) {
      this.fail((err as Error).message)
    }
  }

  private fail(message: string): void {
    // если инструменты уже знаем, сервер не «мёртв», а «испортился»: показать
    // его в интерфейсе всё равно можно, а вот вызывать — уже нет
    this.state = this.tools.length ? 'degraded' : 'offline'
    this.detail = message
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error(message))
    }
    this.pending.clear()
    if (this.child) {
      this.child.removeAllListeners()
      try { this.child.kill() } catch { /* уже мёртв */ }
      this.child = null
    }
    logger.warn('mcp', `«${this.config.title}»: ${message}`)
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    // сообщения разделены переводом строки и не содержат его внутри
    let nl = this.buffer.indexOf('\n')
    while (nl !== -1) {
      const line = this.buffer.slice(0, nl).trim()
      this.buffer = this.buffer.slice(nl + 1)
      if (line) this.onMessage(line)
      nl = this.buffer.indexOf('\n')
    }
    // защита от сервера, который шлёт мусор без переводов строки
    if (this.buffer.length > 4_000_000) this.buffer = ''
  }

  private onMessage(line: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line)
    } catch {
      return // не наше дело: сервер обязан слать в stdout только JSON-RPC
    }
    if (msg.method === 'notifications/tools/list_changed') {
      void this.refreshTools()
      return
    }
    const id = typeof msg.id === 'number' ? msg.id : null
    if (id === null) return
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    clearTimeout(p.timer)
    if (msg.error) {
      const e = msg.error as { message?: string; code?: number }
      p.reject(new Error(e.message ?? `ошибка ${e.code ?? ''}`.trim()))
    } else {
      p.resolve(msg.result)
    }
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.child?.stdin.writable) throw new Error('сервер не запущен')
    this.child.stdin.write(JSON.stringify(payload) + '\n')
  }

  private request(method: string, params: unknown, ctx?: CallContext): Promise<unknown> {
    const id = this.nextId++
    const timeoutMs = ctx?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    return new Promise<unknown>((resolve, reject) => {
      let cleanup: () => void = () => {}
      const finish = (err: Error): void => {
        const p = this.pending.get(id)
        if (!p) return
        this.pending.delete(id)
        clearTimeout(p.timer)
        cleanup()
        // сообщаем серверу, что ответ больше не нужен — иначе он будет
        // работать впустую и, возможно, писать в закрытый диалог
        try { this.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: err.message } }) } catch { /* уже нет связи */ }
        reject(err)
      }
      const timer = setTimeout(() => finish(new Error('сервер не ответил вовремя')), timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      // слушателя снимаем: один и тот же сигнал живёт на весь запрос
      // пользователя, и за десяток вызовов на нём накопились бы десятки
      // подписок, каждая со ссылкой на этот промис
      const onAbort = (): void => finish(new Error('отменено'))
      ctx?.signal?.addEventListener('abort', onAbort, { once: true })
      cleanup = (): void => ctx?.signal?.removeEventListener('abort', onAbort)
      try {
        this.send({ jsonrpc: '2.0', id, method, params })
      } catch (err) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(err as Error)
      }
    })
  }

  private async handshake(): Promise<void> {
    const result = (await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      // ни roots, ни sampling, ни elicitation Kira пока не предоставляет —
      // заявлять неподдерживаемое хуже, чем честно промолчать
      capabilities: {},
      clientInfo: { name: 'Kira', title: 'Kira', version: kiraVersion() }
    }, { timeoutMs: INIT_TIMEOUT_MS })) as { protocolVersion?: string } | undefined
    // сервер вправе ответить другой версией; продолжаем, но помечаем это
    if (result?.protocolVersion && result.protocolVersion !== PROTOCOL_VERSION) {
      logger.info('mcp', `«${this.config.title}» говорит на версии ${result.protocolVersion}`)
    }
    this.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
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
      // страховка от сервера с бесконечной пагинацией
      if (out.length > 500) break
    } while (cursor)
    return out
  }

  private async refreshTools(): Promise<void> {
    try {
      this.tools = await this.fetchTools()
      this.detail = `подключён, инструментов: ${this.tools.length}`
      for (const cb of this.listeners) cb()
    } catch (err) {
      logger.warn('mcp', `«${this.config.title}»: не удалось обновить список — ${(err as Error).message}`)
    }
  }

  async listTools(): Promise<McpTool[]> {
    if (!this.child) await this.connect()
    return this.tools
  }

  async call(tool: string, args: Record<string, unknown>, ctx?: CallContext): Promise<ExecResult> {
    if (!this.child) await this.connect()
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
    const child = this.child
    this.child = null
    this.listeners.clear()
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(new Error('отключено'))
    }
    this.pending.clear()
    this.state = 'offline'
    this.detail = 'отключён'
    if (!child) return
    child.removeAllListeners()
    // по спецификации: сначала закрываем stdin и даём завершиться самому
    try { child.stdin.end() } catch { /* уже закрыт */ }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try { child.kill() } catch { /* уже мёртв */ }
        resolve()
      }, SHUTDOWN_GRACE_MS)
      child.once('exit', () => { clearTimeout(timer); resolve() })
    })
  }
}
