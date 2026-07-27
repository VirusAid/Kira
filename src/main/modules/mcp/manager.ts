/**
 * Менеджер расширений — владеет подключениями и привязками.
 *
 * Провайдер одноразовый: упал процесс — выбрасываем и создаём заново из той же
 * настройки. Поэтому менеджер хранит НАСТРОЙКИ, а подключения считает временным
 * состоянием. Благодаря этому переподключение, правка команды запуска и
 * выключение сервера не задевают ничего за пределами этого модуля.
 */
import { Collection } from '../storage'
import { logger } from '../logger'
import { newId } from '../ids'
import { StdioMcpProvider } from './stdio'
import type { CallContext, McpBinding, McpProvider, McpServerConfig, McpStatus, McpTool } from './types'
import type { ExecResult } from '../../core/types'

let servers: Collection<McpServerConfig> | null = null
let bindings: Collection<McpBinding> | null = null
function serverCol(): Collection<McpServerConfig> {
  if (!servers) servers = new Collection<McpServerConfig>('mcp-servers')
  return servers
}
function bindingCol(): Collection<McpBinding> {
  if (!bindings) bindings = new Collection<McpBinding>('mcp-bindings')
  return bindings
}

const providers = new Map<string, McpProvider>()
/** Кого позвать, когда набор доступных инструментов изменился. */
let onChange: (() => void) | null = null

export function setMcpChangeHook(fn: () => void): void {
  onChange = fn
}

export function listServers(): McpServerConfig[] {
  return serverCol().all().sort((a, b) => a.title.localeCompare(b.title))
}

export function listBindings(): McpBinding[] {
  return bindingCol().all().sort((a, b) => b.createdAt - a.createdAt)
}

/** Провайдер сервера — создаётся лениво, живёт до отключения. */
function providerFor(config: McpServerConfig): McpProvider {
  const existing = providers.get(config.id)
  if (existing) return existing
  const created = new StdioMcpProvider(config)
  created.onToolsChanged(() => onChange?.())
  providers.set(config.id, created)
  return created
}

/** Инструменты, уже полученные от серверов: показывать их можно и без связи. */
const toolCache = new Map<string, McpTool[]>()

export function statusOf(serverId: string): McpStatus {
  const config = serverCol().get(serverId)
  if (!config) return { state: 'unconfigured', message: 'сервер не найден', tools: 0 }
  if (!config.enabled) return { state: 'offline', message: 'выключен', tools: 0 }
  return providers.get(serverId)?.status() ?? { state: 'offline', message: 'не подключён', tools: 0 }
}

/** Все состояния разом — для интерфейса и самодиагностики. */
export function mcpOverview(): Array<{ config: McpServerConfig; status: McpStatus; tools: McpTool[] }> {
  return listServers().map((config) => ({
    config,
    status: statusOf(config.id),
    tools: toolCache.get(config.id) ?? []
  }))
}

/** Подключить сервер и запомнить его инструменты. */
export async function connectServer(serverId: string): Promise<McpStatus> {
  const config = serverCol().get(serverId)
  if (!config) return { state: 'unconfigured', message: 'сервер не найден', tools: 0 }
  if (!config.enabled) return { state: 'offline', message: 'выключен', tools: 0 }
  const p = providerFor(config)
  await p.connect()
  try {
    toolCache.set(serverId, await p.listTools())
  } catch { /* состояние уже отражено в status() */ }
  onChange?.()
  return p.status()
}

export async function disconnectServer(serverId: string): Promise<void> {
  const p = providers.get(serverId)
  providers.delete(serverId)
  toolCache.delete(serverId)
  if (p) await p.disconnect()
  onChange?.()
}

/** Сохранить сервер. Ключ неизменяем: он живёт в выученных фразах. */
export async function saveServer(config: Omit<McpServerConfig, 'id'> & { id?: string }): Promise<McpServerConfig> {
  const existing = config.id ? serverCol().get(config.id) : undefined
  const id = existing?.id ?? slugKey(config.title)
  const next: McpServerConfig = {
    id,
    title: config.title.trim() || id,
    transport: 'stdio',
    command: config.command.trim(),
    args: config.args ?? [],
    env: config.env ?? {},
    cwd: config.cwd,
    enabled: config.enabled !== false
  }
  serverCol().put(next)
  // настройки запуска поменялись — старое подключение больше не действительно
  await disconnectServer(id)
  if (next.enabled) await connectServer(id)
  return next
}

/** Ключ из названия: латиница и цифры, чтобы он читался в идентификаторах действий. */
function slugKey(title: string): string {
  const base = title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  const key = base || 'server'
  if (!serverCol().get(key)) return key
  let n = 2
  while (serverCol().get(`${key}-${n}`)) n++
  return `${key}-${n}`
}

export async function removeServer(serverId: string): Promise<void> {
  await disconnectServer(serverId)
  serverCol().delete(serverId)
  // привязки к исчезнувшему серверу больше не имеют смысла
  for (const b of bindingCol().all()) if (b.server === serverId) bindingCol().delete(b.id)
  onChange?.()
}

export function saveBinding(partial: Partial<McpBinding>): McpBinding {
  const id = partial.id ?? newId()
  const next: McpBinding = {
    id,
    server: partial.server ?? '',
    tool: partial.tool ?? '',
    title: (partial.title ?? '').trim(),
    phrases: (partial.phrases ?? []).map((p) => p.trim()).filter(Boolean),
    args: partial.args ?? {},
    // про чужой инструмент мы не знаем, разрушительный он или нет, поэтому
    // подтверждение по умолчанию включено — снять его может только человек
    dangerous: partial.dangerous !== false,
    enabled: partial.enabled !== false,
    createdAt: bindingCol().get(id)?.createdAt ?? Date.now()
  }
  bindingCol().put(next)
  onChange?.()
  return next
}

export function removeBinding(id: string): void {
  bindingCol().delete(id)
  onChange?.()
}

/** Вызов инструмента — единственный путь наружу для всего остального кода. */
export async function callTool(
  serverId: string, tool: string, args: Record<string, unknown>, ctx?: CallContext
): Promise<ExecResult> {
  const config = serverCol().get(serverId)
  if (!config) return { ok: false, message: `Расширение «${serverId}» не подключено` }
  if (!config.enabled) return { ok: false, message: `Расширение «${config.title}» выключено` }
  return providerFor(config).call(tool, args, ctx)
}

/** Инструменты сервера (из кэша; при необходимости подключаемся). */
export async function toolsOf(serverId: string): Promise<McpTool[]> {
  const cached = toolCache.get(serverId)
  if (cached) return cached
  const config = serverCol().get(serverId)
  if (!config || !config.enabled) return []
  const list = await providerFor(config).listTools().catch(() => [])
  toolCache.set(serverId, list)
  return list
}

/** Поднять включённые серверы при старте приложения. */
export async function initMcp(): Promise<void> {
  const enabled = listServers().filter((s) => s.enabled)
  if (!enabled.length) return
  logger.info('mcp', `Расширений включено: ${enabled.length}`)
  // последовательно: одновременный запуск нескольких процессов на слабой
  // машине заметно тормозит старт самой Kira
  for (const s of enabled) {
    await connectServer(s.id).catch(() => undefined)
  }
}

export async function shutdownMcp(): Promise<void> {
  for (const id of [...providers.keys()]) await disconnectServer(id).catch(() => undefined)
}
