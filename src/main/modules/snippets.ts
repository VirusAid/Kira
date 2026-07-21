/**
 * Snippets — быстрые текстовые заготовки Kira.
 *
 * Сохрани часто нужный текст под именем («мой адрес», «реквизиты», «шаблон
 * письма»), потом вставляй одной командой: «вставь сниппет адрес». Всё локально.
 * Без глобального перехвата клавиатуры — вставка по команде (надёжно и безопасно).
 */
import { clipboard } from 'electron'
import { Collection } from './storage'
import { newId } from './ids'
import { logger } from './logger'
import * as system from './system'
import type { ActionResult } from '../../shared/types'

interface Snippet {
  id: string
  name: string
  text: string
  createdAt: number
  updatedAt: number
}

let _col: Collection<Snippet> | null = null
function col(): Collection<Snippet> {
  if (!_col) _col = new Collection<Snippet>('snippets')
  return _col
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/ё/g, 'е')

/** Найти сниппет по имени: точное → по вхождению. */
function find(name: string): Snippet | undefined {
  const q = norm(name)
  const all = col().all()
  return all.find((s) => norm(s.name) === q) ?? all.find((s) => norm(s.name).includes(q) || q.includes(norm(s.name)))
}

export function saveSnippet(name: string, text: string): ActionResult {
  const n = name.trim()
  const t = text.trim()
  if (!n || !t) return { ok: false, message: 'Нужны имя сниппета и текст' }
  const existing = find(n)
  if (existing) {
    col().patch(existing.id, { text: t, name: n, updatedAt: Date.now() })
    return { ok: true, message: `Обновила сниппет «${n}»` }
  }
  col().put({ id: newId(), name: n, text: t, createdAt: Date.now(), updatedAt: Date.now() })
  logger.action('snippets', `Сохранён сниппет: ${n}`)
  return { ok: true, message: `Сохранила сниппет «${n}». Вставлю по команде «вставь сниппет ${n}».` }
}

export function listSnippets(): ActionResult {
  const all = col().all().sort((a, b) => a.name.localeCompare(b.name))
  if (!all.length) return { ok: true, message: 'Сниппетов пока нет. Скажи «сохрани сниппет <имя>: <текст>».' }
  const lines = all.map((s) => `• ${s.name}: ${s.text.replace(/\s+/g, ' ').slice(0, 60)}${s.text.length > 60 ? '…' : ''}`)
  return { ok: true, message: `Сниппетов: ${all.length}`, data: lines.join('\n') }
}

/** Положить сниппет в буфер и вставить в активное окно. */
export async function pasteSnippet(name: string): Promise<ActionResult> {
  const s = find(name)
  if (!s) return { ok: false, message: `Не нашла сниппет «${name}». Покажу список — «мои сниппеты».` }
  clipboard.writeText(s.text)
  const r = await system.pressKeys('^v')
  return r.ok
    ? { ok: true, message: `Вставила «${s.name}»` }
    : { ok: true, message: `Сниппет «${s.name}» в буфере — вставь вручную (Ctrl+V)` }
}

/** Просто вернуть текст сниппета (для копирования/озвучки). */
export function getSnippet(name: string): ActionResult {
  const s = find(name)
  return s ? { ok: true, message: `Сниппет «${s.name}»`, data: s.text } : { ok: false, message: `Нет сниппета «${name}»` }
}

export function deleteSnippet(name: string): ActionResult {
  const s = find(name)
  if (!s) return { ok: false, message: `Нет сниппета «${name}»` }
  col().delete(s.id)
  return { ok: true, message: `Удалила сниппет «${s.name}»` }
}
