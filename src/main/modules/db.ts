/** Единая точка доступа к коллекциям данных Kira. */
import { Collection, MessageStore } from './storage'
import type {
  Chat,
  ChatMessage,
  MemoryEntry,
  Project,
  Protocol,
  Automation,
  Ability,
  LogEntry
} from '../../shared/types'

let _db: {
  chats: Collection<Chat>
  messages: MessageStore<ChatMessage>
  memory: Collection<MemoryEntry>
  projects: Collection<Project>
  protocols: Collection<Protocol>
  automations: Collection<Automation>
  abilities: Collection<Ability>
  logs: Collection<LogEntry>
} | null = null

export function db() {
  if (!_db) {
    _db = {
      chats: new Collection<Chat>('chats'),
      messages: new MessageStore<ChatMessage>(),
      memory: new Collection<MemoryEntry>('memory'),
      projects: new Collection<Project>('projects'),
      protocols: new Collection<Protocol>('protocols'),
      automations: new Collection<Automation>('automations'),
      abilities: new Collection<Ability>('abilities'),
      logs: new Collection<LogEntry>('logs')
    }
  }
  return _db
}

/** Синхронный сброс всех несохранённых данных — вызывается при выходе. */
export function flushAllSync(): void {
  if (!_db) return
  _db.chats.flushSync()
  _db.messages.flushSync()
  _db.memory.flushSync()
  _db.projects.flushSync()
  _db.protocols.flushSync()
  _db.automations.flushSync()
  _db.abilities.flushSync()
  _db.logs.flushSync()
}
