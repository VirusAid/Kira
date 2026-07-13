/** Глобальный поиск по всем данным Kira. */
import { db } from './db'
import type { SearchResult } from '../../shared/types'

function snippet(text: string, query: string, radius = 60): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text.slice(0, radius * 2)
  const start = Math.max(0, idx - radius)
  const end = Math.min(text.length, idx + query.length + radius)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

export async function globalSearch(query: string, limit = 40): Promise<SearchResult[]> {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const results: SearchResult[] = []
  const store = db()

  for (const chat of store.chats.all()) {
    if (results.length >= limit) break
    if (chat.title.toLowerCase().includes(q)) {
      results.push({ type: 'chat', id: chat.id, title: chat.title, snippet: 'Диалог' })
    }
  }

  // сообщения — ищем по всем чатам (файлы подгружаются лениво)
  const chatIds = await store.messages.allChatIds()
  outer: for (const chatId of chatIds) {
    for (const msg of store.messages.listChat(chatId)) {
      if (results.length >= limit) break outer
      if (msg.content.toLowerCase().includes(q)) {
        const chat = store.chats.get(chatId)
        results.push({
          type: 'message',
          id: msg.id,
          parentId: chatId,
          title: chat?.title ?? 'Диалог',
          snippet: snippet(msg.content, q)
        })
      }
    }
  }

  for (const p of store.projects.all()) {
    if (results.length >= limit) break
    const haystack = `${p.name} ${p.description} ${p.tags.join(' ')}`
    if (haystack.toLowerCase().includes(q)) {
      results.push({ type: 'project', id: p.id, title: p.name, snippet: snippet(p.description || haystack, q) })
    }
  }

  for (const m of store.memory.all()) {
    if (results.length >= limit) break
    if (`${m.title} ${m.content}`.toLowerCase().includes(q)) {
      results.push({ type: 'memory', id: m.id, title: m.title, snippet: snippet(m.content, q) })
    }
  }

  for (const p of store.protocols.all()) {
    if (results.length >= limit) break
    if (`${p.name} ${p.description}`.toLowerCase().includes(q)) {
      results.push({ type: 'protocol', id: p.id, title: p.name, snippet: snippet(p.description || p.name, q) })
    }
  }

  for (const ab of store.abilities.all()) {
    if (results.length >= limit) break
    if (`${ab.name} ${ab.description} ${ab.triggers.join(' ')}`.toLowerCase().includes(q)) {
      results.push({ type: 'ability', id: ab.id, title: ab.name, snippet: snippet(ab.description || ab.name, q) })
    }
  }

  for (const l of store.logs.all().slice(-500)) {
    if (results.length >= limit) break
    if (l.message.toLowerCase().includes(q)) {
      results.push({ type: 'log', id: l.id, title: `[${l.source}]`, snippet: snippet(l.message, q) })
    }
  }

  return results
}
