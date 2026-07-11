/**
 * Storage — файловая JSON-БД без нативных зависимостей.
 *
 * Каждая коллекция — отдельный файл в userData/data. Записи кэшируются
 * в памяти, запись на диск — отложенная (debounce) и атомарная
 * (через временный файл), чтобы данные не побились при сбое.
 *
 * Сообщения чатов хранятся по одному файлу на чат (messages/<chatId>.json),
 * поэтому тысячи сообщений не замедляют работу остальных коллекций.
 */
import { app } from 'electron'
import { promises as fsp, existsSync, readFileSync, mkdirSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'

const FLUSH_DELAY = 400

function dataDir(): string {
  const dir = join(app.getPath('userData'), 'data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function atomicWriteSync(file: string, content: string): void {
  const tmp = file + '.tmp'
  writeFileSync(tmp, content, 'utf-8')
  renameSync(tmp, file)
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const tmp = file + '.tmp'
  await fsp.writeFile(tmp, content, 'utf-8')
  await fsp.rename(tmp, file)
}

/** Типизированная коллекция записей с id. */
export class Collection<T extends { id: string }> {
  private items = new Map<string, T>()
  private file: string
  private flushTimer: NodeJS.Timeout | null = null
  private dirty = false

  constructor(public readonly name: string) {
    this.file = join(dataDir(), `${name}.json`)
    this.load()
  }

  private load(): void {
    if (!existsSync(this.file)) return
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf-8')) as T[]
      for (const item of raw) this.items.set(item.id, item)
    } catch {
      // повреждённый файл переименовываем, не теряя данные безвозвратно
      try { renameSync(this.file, this.file + '.corrupt.' + Date.now()) } catch { /* ignore */ }
    }
  }

  private scheduleFlush(): void {
    this.dirty = true
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush()
    }, FLUSH_DELAY)
  }

  async flush(): Promise<void> {
    if (!this.dirty) return
    this.dirty = false
    await atomicWrite(this.file, JSON.stringify([...this.items.values()]))
  }

  flushSync(): void {
    if (!this.dirty) return
    this.dirty = false
    atomicWriteSync(this.file, JSON.stringify([...this.items.values()]))
  }

  all(): T[] {
    return [...this.items.values()]
  }

  get(id: string): T | undefined {
    return this.items.get(id)
  }

  put(item: T): T {
    this.items.set(item.id, item)
    this.scheduleFlush()
    return item
  }

  patch(id: string, partial: Partial<T>): T | undefined {
    const existing = this.items.get(id)
    if (!existing) return undefined
    const updated = { ...existing, ...partial, id }
    this.items.set(id, updated)
    this.scheduleFlush()
    return updated
  }

  delete(id: string): boolean {
    const ok = this.items.delete(id)
    if (ok) this.scheduleFlush()
    return ok
  }

  get size(): number {
    return this.items.size
  }
}

/** Хранилище сообщений: по файлу на чат, ленивая загрузка. */
export class MessageStore<M extends { id: string; chatId: string }> {
  private cache = new Map<string, M[]>()
  private dirtyChats = new Set<string>()
  private flushTimer: NodeJS.Timeout | null = null
  private dir: string

  constructor() {
    this.dir = join(dataDir(), 'messages')
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
  }

  private fileFor(chatId: string): string {
    return join(this.dir, `${chatId.replace(/[^a-z0-9-]/gi, '_')}.json`)
  }

  listChat(chatId: string): M[] {
    let msgs = this.cache.get(chatId)
    if (!msgs) {
      const file = this.fileFor(chatId)
      msgs = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf-8')) as M[]) : []
      this.cache.set(chatId, msgs)
    }
    return msgs
  }

  append(msg: M): void {
    this.listChat(msg.chatId).push(msg)
    this.markDirty(msg.chatId)
  }

  update(chatId: string, msgId: string, partial: Partial<M>): M | undefined {
    const msgs = this.listChat(chatId)
    const idx = msgs.findIndex((m) => m.id === msgId)
    if (idx === -1) return undefined
    msgs[idx] = { ...msgs[idx], ...partial, id: msgId, chatId }
    this.markDirty(chatId)
    return msgs[idx]
  }

  remove(chatId: string, msgId: string): boolean {
    const msgs = this.listChat(chatId)
    const idx = msgs.findIndex((m) => m.id === msgId)
    if (idx === -1) return false
    msgs.splice(idx, 1)
    this.markDirty(chatId)
    return true
  }

  async deleteChat(chatId: string): Promise<void> {
    this.cache.delete(chatId)
    this.dirtyChats.delete(chatId)
    const file = this.fileFor(chatId)
    if (existsSync(file)) await fsp.unlink(file)
  }

  /** Все chatId, имеющие файлы на диске. */
  async allChatIds(): Promise<string[]> {
    const files = await fsp.readdir(this.dir)
    return files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
  }

  private markDirty(chatId: string): void {
    this.dirtyChats.add(chatId)
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flush()
    }, FLUSH_DELAY)
  }

  async flush(): Promise<void> {
    const chats = [...this.dirtyChats]
    this.dirtyChats.clear()
    for (const chatId of chats) {
      const msgs = this.cache.get(chatId)
      if (msgs) await atomicWrite(this.fileFor(chatId), JSON.stringify(msgs))
    }
  }

  flushSync(): void {
    for (const chatId of this.dirtyChats) {
      const msgs = this.cache.get(chatId)
      if (msgs) atomicWriteSync(this.fileFor(chatId), JSON.stringify(msgs))
    }
    this.dirtyChats.clear()
  }
}
