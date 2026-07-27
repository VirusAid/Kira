/**
 * Kira как MCP-сервер — её возможности наружу, для любого клиента.
 *
 * Обратная сторона расширений: не Kira ходит в чужие инструменты, а чужой
 * клиент пользуется Kira. Стоило это почти ничего — у реестра уже есть единый
 * контракт (id, описание, аргументы, признак опасности), и он практически
 * совпадает с тем, как MCP описывает инструменты. Оставалось перевести одно в
 * другое и научиться говорить по stdio.
 *
 * Запуск: `Kira.exe --mcp-server`. В этом режиме не создаются окна, трей и
 * эмблема, не запускается зрение и проактивность — только ядро и обмен по
 * стандартному вводу-выводу.
 *
 * ВАЖНОЕ ОГРАНИЧЕНИЕ: опасные действия наружу НЕ отдаются. Подтверждать их
 * некому — окна нет, а полагаться на то, что чужой клиент спросит человека,
 * нельзя. Выключить чей-то компьютер по сети из-за доверчивости протокола —
 * ровно тот случай, когда лучше отдать меньше.
 */
import { createReadStream } from 'fs'
import { registry } from '../../core/registry'
import { commandEngine } from '../../core/engine'
import { initKiraCore } from '../../core'
import { contentOf } from '../../core/types'
import { PROTOCOL_VERSION } from './types'

/** Есть ли в аргументах запуска просьба поработать MCP-сервером. */
export function isMcpServerMode(argv: string[]): boolean {
  return argv.includes('--mcp-server')
}

interface Rpc {
  jsonrpc: '2.0'
  id?: number | string
  method?: string
  params?: Record<string, unknown>
}

/** Аргументы действия → JSON Schema, как её ждёт клиент. */
function schemaOf(args: Array<{ name: string; description: string; required?: boolean }>): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const a of args) {
    properties[a.name] = { type: 'string', description: a.description }
    if (a.required) required.push(a.name)
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) }
}

/**
 * Что отдаём наружу: собственные безопасные действия.
 *
 * Команды ЧУЖИХ расширений не пересдаём: во-первых, их сервер в этом режиме не
 * поднят и вызов всё равно провалился бы; во-вторых, пересдача чужих
 * инструментов под своим именем — это цепочка, за которую мы не отвечаем.
 * Клиенту, которому нужен GitHub, следует подключить GitHub напрямую.
 */
function exposedTools(): Array<Record<string, unknown>> {
  return registry.list()
    .filter((a) => !a.dangerous && !a.id.startsWith('mcp:'))
    .map((a) => ({
      name: a.id,
      title: a.title,
      description: a.examples.length ? `${a.description}. Например: «${a.examples[0]}»` : a.description,
      inputSchema: schemaOf(a.args)
    }))
}

function write(msg: Record<string, unknown>): void {
  // stdout — только протокол: сюда нельзя писать ничего постороннего
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function reply(id: number | string, result: unknown): void {
  write({ jsonrpc: '2.0', id, result })
}

function replyError(id: number | string, code: number, message: string): void {
  write({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handle(msg: Rpc): Promise<void> {
  const { id, method, params } = msg
  if (id === undefined) return // уведомление — отвечать не нужно

  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'kira', title: 'Kira', version: '1.1.0' },
        instructions:
          'Kira управляет компьютером Windows: приложения, файлы, звук, окна, буфер обмена, ' +
          'система. Опасные и необратимые действия наружу не отдаются — их выполняет только ' +
          'сам пользователь в приложении Kira.'
      })
      return

    case 'ping':
      reply(id, {})
      return

    case 'tools/list':
      reply(id, { tools: exposedTools() })
      return

    case 'tools/call': {
      const name = String(params?.name ?? '')
      const args = (params?.arguments ?? {}) as Record<string, string>
      const action = name.startsWith('mcp:') ? undefined : registry.get(name)
      if (!action) {
        replyError(id, -32602, `Неизвестный инструмент: ${name}`)
        return
      }
      if (action.dangerous) {
        // не ошибка протокола, а осознанный отказ — пусть клиент увидит причину
        reply(id, {
          content: [{ type: 'text', text: 'Это действие Kira выполняет только по прямому подтверждению пользователя в самом приложении.' }],
          isError: true
        })
        return
      }
      try {
        const result = await commandEngine.executeById(name, args, { source: 'agent' })
        if (!result) {
          replyError(id, -32602, `Неизвестный инструмент: ${name}`)
          return
        }
        const body = contentOf(result)
        reply(id, {
          content: [{ type: 'text', text: body || result.message }],
          isError: !result.ok
        })
      } catch (err) {
        reply(id, { content: [{ type: 'text', text: (err as Error).message }], isError: true })
      }
      return
    }

    default:
      replyError(id, -32601, `Метод не поддерживается: ${method}`)
  }
}

/**
 * Запустить обмен по stdio. Возвращается сразу — дальше работает поток ввода.
 */
export function startMcpServer(): void {
  initKiraCore()
  let buffer = ''
  // Читаем ДЕСКРИПТОР 0 напрямую, а не process.stdin. Это не украшение: в
  // главном процессе Electron на Windows process.stdin молчит — не приходит ни
  // байта, хотя process.stdout при этом работает. Проверено опытом.
  const input = createReadStream('', { fd: 0, encoding: 'utf-8', autoClose: false })
  input.on('data', (chunk: string | Buffer) => {
    buffer += String(chunk)
    let nl = buffer.indexOf('\n')
    while (nl !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) {
        try {
          void handle(JSON.parse(line) as Rpc)
        } catch { /* не JSON — по спецификации такого быть не должно */ }
      }
      nl = buffer.indexOf('\n')
    }
  })
  input.on('error', () => process.exit(1))
  // клиент закрыл ввод — по спецификации это и есть сигнал завершения
  input.on('end', () => process.exit(0))
}
