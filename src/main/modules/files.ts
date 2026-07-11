/**
 * Files — файловый менеджер: просмотр, поиск, чтение, запись,
 * перемещение, копирование, удаление в корзину.
 */
import { app, shell } from 'electron'
import { promises as fsp, existsSync } from 'fs'
import { join, extname, basename, dirname } from 'path'
import { logger } from './logger'
import { pushUndo } from './undo'
import type { ActionResult, FileItem } from '../../shared/types'

const TEXT_EXTS = new Set([
  '.txt', '.md', '.json', '.js', '.ts', '.tsx', '.jsx', '.py', '.html', '.css', '.scss',
  '.xml', '.yml', '.yaml', '.ini', '.cfg', '.log', '.csv', '.bat', '.ps1', '.sh', '.sql',
  '.c', '.cpp', '.h', '.cs', '.java', '.go', '.rs', '.toml', '.env', '.gitignore'
])

export function homeDirs(): { name: string; path: string }[] {
  const home = app.getPath('home')
  return [
    { name: 'Домашняя папка', path: home },
    { name: 'Рабочий стол', path: app.getPath('desktop') },
    { name: 'Документы', path: app.getPath('documents') },
    { name: 'Загрузки', path: app.getPath('downloads') },
    { name: 'Изображения', path: app.getPath('pictures') },
    { name: 'Музыка', path: app.getPath('music') },
    { name: 'Видео', path: app.getPath('videos') }
  ]
}

export async function listDir(dirPath: string): Promise<FileItem[]> {
  const entries = await fsp.readdir(dirPath, { withFileTypes: true })
  const items: FileItem[] = []
  for (const e of entries) {
    const full = join(dirPath, e.name)
    try {
      const stat = await fsp.stat(full)
      items.push({
        name: e.name,
        path: full,
        isDirectory: e.isDirectory(),
        size: stat.size,
        modifiedAt: stat.mtimeMs,
        ext: e.isDirectory() ? '' : extname(e.name).toLowerCase()
      })
    } catch {
      /* нет доступа */
    }
  }
  return items.sort((a, b) =>
    a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1
  )
}

export async function searchFiles(root: string, query: string, limit = 100): Promise<FileItem[]> {
  const results: FileItem[] = []
  const q = query.toLowerCase()

  async function walk(dir: string, depth: number): Promise<void> {
    if (results.length >= limit || depth > 6) return
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (results.length >= limit) return
      if (e.name === 'node_modules' || e.name.startsWith('.git') || e.name === '$RECYCLE.BIN') continue
      const full = join(dir, e.name)
      if (e.name.toLowerCase().includes(q)) {
        try {
          const stat = await fsp.stat(full)
          results.push({
            name: e.name,
            path: full,
            isDirectory: e.isDirectory(),
            size: stat.size,
            modifiedAt: stat.mtimeMs,
            ext: e.isDirectory() ? '' : extname(e.name).toLowerCase()
          })
        } catch { /* пропускаем */ }
      }
      if (e.isDirectory()) await walk(full, depth + 1)
    }
  }

  await walk(root, 0)
  return results
}

/** Глобальный поиск файлов по типичным местам пользователя (Рабочий стол,
 *  Документы, Загрузки, Изображения, Музыка, Видео, домашняя папка). */
export async function searchUserFiles(query: string, limit = 60): Promise<FileItem[]> {
  const roots = [
    app.getPath('desktop'),
    app.getPath('documents'),
    app.getPath('downloads'),
    app.getPath('pictures'),
    app.getPath('music'),
    app.getPath('videos'),
    app.getPath('home')
  ]
  const seen = new Set<string>()
  const results: FileItem[] = []
  for (const root of roots) {
    if (results.length >= limit) break
    const found = await searchFiles(root, query, limit - results.length)
    for (const f of found) {
      if (seen.has(f.path)) continue
      seen.add(f.path)
      results.push(f)
      if (results.length >= limit) break
    }
  }
  return results
}

export function isTextFile(path: string): boolean {
  return TEXT_EXTS.has(extname(path).toLowerCase())
}

const DOC_EXTS = new Set(['.pdf', '.docx', '.xlsx', '.xls', '.csv', '.ods'])

export function isReadableDocument(path: string): boolean {
  const ext = extname(path).toLowerCase()
  return TEXT_EXTS.has(ext) || DOC_EXTS.has(ext)
}

/**
 * Универсальное извлечение текста из документа: PDF, Word (docx), Excel (xlsx/csv)
 * и обычные текстовые файлы. Возвращает читаемый текст для анализа Kira.
 */
export async function readDocument(path: string): Promise<string> {
  const ext = extname(path).toLowerCase()

  if (TEXT_EXTS.has(ext)) return readTextFile(path)

  if (ext === '.pdf') {
    const { PDFParse } = await import('pdf-parse')
    const buffer = await fsp.readFile(path)
    const parser = new PDFParse({ data: new Uint8Array(buffer) })
    try {
      const result = await parser.getText()
      const text = (result?.text ?? '').trim()
      return text || '(PDF не содержит извлекаемого текста — возможно, это скан. Нужен OCR.)'
    } finally {
      await parser.destroy?.()
    }
  }

  if (ext === '.docx') {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ path })
    return (result.value ?? '').trim() || '(документ пуст)'
  }

  if (ext === '.xlsx' || ext === '.xls' || ext === '.csv' || ext === '.ods') {
    const XLSX = await import('xlsx')
    const wb = XLSX.readFile(path)
    const parts: string[] = []
    for (const name of wb.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name])
      if (csv.trim()) parts.push(`# Лист: ${name}\n${csv}`)
    }
    return parts.join('\n\n').slice(0, 200_000) || '(таблица пуста)'
  }

  throw new Error(`Формат ${ext} не поддерживается для чтения`)
}

/**
 * Поиск по СОДЕРЖИМОМУ текстовых файлов в типичных папках пользователя.
 * Возвращает совпадения с фрагментами контекста.
 */
export async function searchFileContents(
  query: string,
  limit = 30
): Promise<{ path: string; name: string; snippet: string }[]> {
  const q = query.toLowerCase()
  const roots = [
    app.getPath('desktop'),
    app.getPath('documents'),
    app.getPath('downloads')
  ]
  const results: { path: string; name: string; snippet: string }[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    if (results.length >= limit || depth > 4) return
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (results.length >= limit) return
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '$RECYCLE.BIN') continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        await walk(full, depth + 1)
      } else if (isTextFile(full)) {
        try {
          const stat = await fsp.stat(full)
          if (stat.size > 2_000_000) continue
          const content = await fsp.readFile(full, 'utf-8')
          const idx = content.toLowerCase().indexOf(q)
          if (idx !== -1) {
            const start = Math.max(0, idx - 50)
            const snippet = content.slice(start, idx + query.length + 80).replace(/\s+/g, ' ').trim()
            results.push({ path: full, name: e.name, snippet: (start > 0 ? '…' : '') + snippet + '…' })
          }
        } catch {
          /* пропускаем нечитаемые */
        }
      }
    }
  }

  for (const root of roots) {
    if (results.length >= limit) break
    await walk(root, 0)
  }
  return results
}

export async function readTextFile(path: string, maxBytes = 512 * 1024): Promise<string> {
  const stat = await fsp.stat(path)
  if (stat.size > maxBytes) {
    const handle = await fsp.open(path, 'r')
    const buf = Buffer.alloc(maxBytes)
    await handle.read(buf, 0, maxBytes, 0)
    await handle.close()
    return buf.toString('utf-8') + '\n\n… (файл обрезан, показано первые 512 КБ)'
  }
  return fsp.readFile(path, 'utf-8')
}

export async function writeTextFile(path: string, content: string): Promise<ActionResult> {
  const existed = existsSync(path)
  let prev = ''
  if (existed) { try { prev = await fsp.readFile(path, 'utf-8') } catch { /* бинарный/недоступный */ } }
  await fsp.mkdir(dirname(path), { recursive: true })
  await fsp.writeFile(path, content, 'utf-8')
  logger.action('files', `Файл сохранён: ${path}`)
  pushUndo(`запись ${basename(path)}`, async () => {
    if (existed) await fsp.writeFile(path, prev, 'utf-8')
    else await shell.trashItem(path)
  })
  return { ok: true, message: `Сохранено: ${basename(path)}` }
}

export async function createFolder(path: string): Promise<ActionResult> {
  const existed = existsSync(path)
  await fsp.mkdir(path, { recursive: true })
  logger.action('files', `Папка создана: ${path}`)
  if (!existed) {
    pushUndo(`создание папки ${basename(path)}`, async () => { await shell.trashItem(path) })
  }
  return { ok: true, message: `Папка создана: ${path}` }
}

export async function deleteToTrash(path: string): Promise<ActionResult> {
  if (!existsSync(path)) return { ok: false, message: 'Файл не найден' }
  await shell.trashItem(path)
  logger.action('files', `Удалено в корзину: ${path}`)
  pushUndo(`удаление ${basename(path)}`, async () => {
    const { restoreFromRecycleBin } = await import('./system')
    const ok = await restoreFromRecycleBin(path)
    if (!ok) throw new Error('не нашла файл в корзине')
  })
  return { ok: true, message: `Удалено в корзину: ${basename(path)}` }
}

export async function moveFile(from: string, to: string): Promise<ActionResult> {
  const dest = await resolveDestination(from, to)
  await fsp.mkdir(dirname(dest), { recursive: true })
  await fsp.rename(from, dest)
  logger.action('files', `Перемещено: ${from} → ${dest}`)
  pushUndo(`перемещение ${basename(from)}`, async () => { await fsp.rename(dest, from) })
  return { ok: true, message: `Перемещено в ${dest}` }
}

export async function copyFile(from: string, to: string): Promise<ActionResult> {
  const dest = await resolveDestination(from, to)
  await fsp.mkdir(dirname(dest), { recursive: true })
  await fsp.cp(from, dest, { recursive: true })
  logger.action('files', `Скопировано: ${from} → ${dest}`)
  pushUndo(`копирование ${basename(from)}`, async () => { await shell.trashItem(dest) })
  return { ok: true, message: `Скопировано в ${dest}` }
}

export async function renameFile(path: string, newName: string): Promise<ActionResult> {
  const dest = join(dirname(path), newName)
  await fsp.rename(path, dest)
  logger.action('files', `Переименовано: ${basename(path)} → ${newName}`)
  pushUndo(`переименование в ${newName}`, async () => { await fsp.rename(dest, path) })
  return { ok: true, message: `Переименовано в ${newName}` }
}

/** Если to — существующая папка, кладём файл внутрь с исходным именем. */
async function resolveDestination(from: string, to: string): Promise<string> {
  try {
    const stat = await fsp.stat(to)
    if (stat.isDirectory()) return join(to, basename(from))
  } catch {
    /* to не существует — используем как есть */
  }
  return to
}

export function showInExplorer(path: string): void {
  shell.showItemInFolder(path)
}
