/**
 * Knowledge — локальная база знаний Kira («поговори со своими документами»).
 *
 * Индексирует папку с документами (PDF, Word, Excel, заметки, txt/md):
 * читает текст → режет на смысловые фрагменты → считает эмбеддинги (fastembed,
 * тот же движок, что у семантики) → хранит на диске. Потом отвечает на вопросы
 * ПО СМЫСЛУ, находя нужные фрагменты. Всё офлайн — документы не уходят в сеть;
 * LLM получает только найденные куски, чтобы сформулировать ответ.
 */
import { promises as fsp } from 'fs'
import { join, basename } from 'path'
import { Collection } from './storage'
import { newId } from './ids'
import { logger } from './logger'
import { isReadableDocument, readDocument } from './files'
import { semantic } from './ai/semantic'
import type { ActionResult } from '../../shared/types'

interface Chunk {
  id: string
  file: string
  name: string
  idx: number
  text: string
}

interface IndexedFile {
  id: string // = путь к файлу
  path: string
  mtime: number
  chunks: number
  at: number
}

const CHUNK_SIZE = 900
const CHUNK_OVERLAP = 150
const MAX_FILES = 400
const MAX_CHUNKS = 6000
const SCAN_DEPTH = 4
const SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian', '$recycle.bin', 'appdata'])

let _chunks: Collection<Chunk> | null = null
let _files: Collection<IndexedFile> | null = null
function chunks(): Collection<Chunk> {
  if (!_chunks) _chunks = new Collection<Chunk>('knowledge')
  return _chunks
}
function files(): Collection<IndexedFile> {
  if (!_files) _files = new Collection<IndexedFile>('knowledge-files')
  return _files
}

/** Разбить текст на перекрывающиеся фрагменты по границам предложений. */
export function splitChunks(text: string): string[] {
  const clean = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
  if (clean.length <= CHUNK_SIZE) return clean ? [clean] : []
  const out: string[] = []
  let pos = 0
  while (pos < clean.length) {
    let end = Math.min(pos + CHUNK_SIZE, clean.length)
    if (end < clean.length) {
      // сдвигаемся к ближайшей границе предложения/абзаца назад
      const slice = clean.slice(pos, end)
      const brk = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('\n'), slice.lastIndexOf('! '), slice.lastIndexOf('? '))
      if (brk > CHUNK_SIZE * 0.5) end = pos + brk + 1
    }
    const piece = clean.slice(pos, end).trim()
    if (piece) out.push(piece)
    if (end >= clean.length) break
    pos = end - CHUNK_OVERLAP
  }
  return out
}

async function walk(dir: string, depth: number, acc: string[]): Promise<void> {
  if (depth > SCAN_DEPTH || acc.length >= MAX_FILES) return
  let entries: import('fs').Dirent[]
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (acc.length >= MAX_FILES) return
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name.toLowerCase())) continue
      await walk(full, depth + 1, acc)
    } else if (e.isFile() && isReadableDocument(full)) {
      acc.push(full)
    }
  }
}

/**
 * Проиндексировать папку. Меняет только изменённые/новые файлы (по mtime).
 * onProgress — необязательный колбэк для UI.
 */
export async function indexFolder(
  folder: string,
  onProgress?: (msg: string) => void
): Promise<ActionResult> {
  if (!(await semantic.isAvailable())) {
    return { ok: false, message: 'Не установлен движок эмбеддингов (fastembed). Настройки → Голос/Семантика → установить.' }
  }
  const found: string[] = []
  try {
    await walk(folder, 0, found)
  } catch (e) {
    return { ok: false, message: `Не удалось прочитать папку: ${(e as Error).message}` }
  }
  if (!found.length) return { ok: false, message: `В «${folder}» не нашлось документов (PDF/Word/Excel/txt/md)` }

  let newFiles = 0
  let newChunks = 0
  let skipped = 0
  for (const file of found) {
    if (chunks().size >= MAX_CHUNKS) break
    let mtime = 0
    try { mtime = (await fsp.stat(file)).mtimeMs } catch { continue }
    const prev = files().get(file)
    if (prev && prev.mtime === mtime) { skipped++; continue }

    onProgress?.(`Читаю: ${basename(file)}`)
    let text: string
    try {
      text = await readDocument(file)
    } catch {
      continue
    }
    if (!text || text.length < 20 || text.startsWith('(')) continue

    // удаляем старые фрагменты этого файла (переиндексация)
    if (prev) for (const c of chunks().all()) if (c.file === file) chunks().delete(c.id)

    const pieces = splitChunks(text)
    const name = basename(file)
    let idx = 0
    for (const piece of pieces) {
      if (chunks().size >= MAX_CHUNKS) break
      chunks().put({ id: newId(), file, name, idx: idx++, text: piece })
      newChunks++
    }
    files().put({ id: file, path: file, mtime, chunks: pieces.length, at: Date.now() })
    newFiles++
  }

  // прогреваем эмбеддинги, чтобы первый вопрос был быстрым
  if (newChunks > 0) {
    onProgress?.('Считаю эмбеддинги…')
    try {
      const docs = chunks().all().map((c) => ({ id: c.id, text: c.text, label: c.name }))
      await semantic.search('индекс', docs, 1)
    } catch { /* прогрев не критичен */ }
  }

  await chunks().flush()
  await files().flush()
  logger.action('knowledge', `Индекс: +${newFiles} файлов, +${newChunks} фрагментов (пропущено без изменений: ${skipped})`)
  return {
    ok: true,
    message: `Проиндексировала: ${newFiles} новых/обновлённых файлов, всего фрагментов ${chunks().size}${skipped ? `, без изменений ${skipped}` : ''}`,
    data: { files: files().size, chunks: chunks().size }
  }
}

/**
 * Ответить на вопрос по документам: находит релевантные фрагменты по смыслу.
 * Возвращает найденное — LLM формулирует ответ и ссылается на источники.
 */
export async function askDocs(query: string, limit = 6): Promise<ActionResult> {
  if (!chunks().size) {
    return { ok: false, message: 'База документов пуста. Скажи «проиндексируй документы в <папка>» или укажи папку в Настройках.' }
  }
  if (!(await semantic.isAvailable())) {
    return { ok: false, message: 'Движок эмбеддингов недоступен.' }
  }
  const docs = chunks().all().map((c) => ({ id: c.id, text: c.text, label: c.name }))
  const hits = await semantic.search(query, docs, limit)
  const strong = hits.filter((h) => h.score > 0.3)
  if (!strong.length) {
    return { ok: true, message: 'В документах не нашлось ничего по этому вопросу', data: '' }
  }
  const blocks = strong.map((h) => `【${h.label}】\n${h.text.slice(0, 700)}`)
  return {
    ok: true,
    message: `Нашла в документах (${strong.length})`,
    data: blocks.join('\n\n---\n\n') +
      '\n\n(Ответь пользователю по этим фрагментам своими словами и укажи, из какого документа. Если данных не хватает — честно скажи.)'
  }
}

export function knowledgeStatus(): ActionResult {
  const f = files().size
  const c = chunks().size
  if (!f) return { ok: true, message: 'База документов пуста — ничего не проиндексировано' }
  const names = files().all().slice(0, 12).map((x) => `• ${basename(x.path)}`)
  return { ok: true, message: `В базе знаний: ${f} файлов, ${c} фрагментов`, data: names.join('\n') }
}

export function clearKnowledge(): ActionResult {
  const f = files().size
  for (const c of chunks().all()) chunks().delete(c.id)
  for (const x of files().all()) files().delete(x.id)
  return { ok: true, message: f ? `Очистила базу знаний (${f} файлов)` : 'База знаний уже пуста' }
}

/** Поддерживаемые расширения — для подсказок в UI. */
export function supportedDocs(): string {
  return ['.pdf', '.docx', '.txt', '.md', '.xlsx', '.csv'].join(', ')
}
