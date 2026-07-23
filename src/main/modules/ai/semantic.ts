/**
 * Semantic — семантическая память Kira. Ищет по СМЫСЛУ через локальные
 * эмбеддинги (fastembed, multilingual-e5-small, CPU). Векторы кэшируются на
 * диске по хэшу текста, чтобы не пересчитывать. Всё офлайн.
 */
import { app } from 'electron'
import { spawn, ChildProcessWithoutNullStreams, execFile } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { logger } from '../logger'

function resourcesRoot(): string {
  return app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources')
}
function pyenvDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'pyenv') : join(__dirname, '../../pyenv')
}
function pythonExe(): string {
  const local = join(pyenvDir(), '..', 'python', 'python.exe')
  if (existsSync(local)) return local
  return process.platform === 'win32' ? 'python' : 'python3'
}

const hash = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 16)

class SemanticManager {
  private proc: ChildProcessWithoutNullStreams | null = null
  private ready = false
  private starting: Promise<void> | null = null
  private buffer = ''
  private reqId = 0
  private pending = new Map<number, { resolve: (v: number[][]) => void; reject: (e: Error) => void }>()
  private cache = new Map<string, number[]>()
  private cacheLoaded = false
  private available: boolean | null = null

  private cacheFile(): string {
    return join(app.getPath('userData'), 'data', 'embed-cache.json')
  }

  private loadCache(): void {
    if (this.cacheLoaded) return
    this.cacheLoaded = true
    try {
      if (existsSync(this.cacheFile())) {
        const obj = JSON.parse(readFileSync(this.cacheFile(), 'utf-8')) as Record<string, number[]>
        for (const [k, v] of Object.entries(obj)) this.cache.set(k, v)
      }
    } catch { /* ignore */ }
  }

  private saveCache(): void {
    try {
      // ограничиваем размер кэша
      const entries = [...this.cache.entries()].slice(-4000)
      writeFileSync(this.cacheFile(), JSON.stringify(Object.fromEntries(entries)))
    } catch { /* ignore */ }
  }

  isAvailable(): Promise<boolean> {
    if (this.available !== null) return Promise.resolve(this.available)
    return new Promise((resolve) => {
      const env = { ...process.env, PYTHONPATH: pyenvDir() }
      execFile(pythonExe(), ['-c', 'import fastembed'], { env, timeout: 20_000, windowsHide: true }, (err) => {
        this.available = !err
        resolve(this.available)
      })
    })
  }

  private start(): Promise<void> {
    if (this.ready) return Promise.resolve()
    if (this.starting) return this.starting
    this.starting = new Promise<void>((resolve, reject) => {
      const script = join(resourcesRoot(), 'embed.py')
      if (!existsSync(script)) return reject(new Error('embed.py не найден'))
      const cacheDir = join(app.getPath('userData'), 'embed-model')
      const env = { ...process.env, PYTHONPATH: pyenvDir(), PYTHONIOENCODING: 'utf-8' }
      logger.info('semantic', 'Загружаю модель эмбеддингов…')
      const proc = spawn(pythonExe(), ['-u', script, cacheDir], { env, windowsHide: true })
      this.proc = proc
      const timeout = setTimeout(() => reject(new Error('Таймаут загрузки модели эмбеддингов')), 180_000)

      proc.stdout.setEncoding('utf-8')
      proc.stdout.on('data', (chunk: string) => {
        this.buffer += chunk
        let idx: number
        while ((idx = this.buffer.indexOf('\n')) !== -1) {
          const line = this.buffer.slice(0, idx).trim()
          this.buffer = this.buffer.slice(idx + 1)
          if (!line) continue
          let msg: { type?: string; id?: number; ok?: boolean; vectors?: number[][]; error?: string }
          try { msg = JSON.parse(line) } catch { continue }
          if (msg.type === 'ready') { clearTimeout(timeout); this.ready = true; logger.info('semantic', 'Семантическая память активна'); resolve() }
          else if (msg.type === 'error') { clearTimeout(timeout); reject(new Error(msg.error)) }
          else if (typeof msg.id === 'number') {
            const p = this.pending.get(msg.id)
            if (p) { this.pending.delete(msg.id); msg.ok ? p.resolve(msg.vectors ?? []) : p.reject(new Error(msg.error)) }
          }
        }
      })
      proc.on('exit', () => { this.ready = false; this.starting = null; this.proc = null; for (const [, p] of this.pending) p.reject(new Error('embed процесс завершён')); this.pending.clear() })
      proc.on('error', (e) => { clearTimeout(timeout); reject(e) })
    })
    return this.starting
  }

  private embed(texts: string[]): Promise<number[][]> {
    return this.start().then(() => new Promise<number[][]>((resolve, reject) => {
      const id = ++this.reqId
      this.pending.set(id, { resolve, reject })
      this.proc!.stdin.write(JSON.stringify({ id, texts }) + '\n')
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('Таймаут эмбеддинга')) } }, 60_000)
    }))
  }

  /** Получить вектор с кэшированием. */
  private async vectorsFor(items: { key: string; text: string }[], isQuery = false): Promise<Map<string, number[]>> {
    this.loadCache()
    const result = new Map<string, number[]>()
    const need: { key: string; text: string }[] = []
    for (const it of items) {
      const ck = hash(it.text)
      const cached = this.cache.get(ck)
      if (cached) result.set(it.key, cached)
      else need.push({ ...it, key: it.key })
    }
    if (need.length) {
      const vecs = await this.embed(need.map((n) => n.text.slice(0, 500)))
      need.forEach((n, i) => {
        const v = vecs[i]
        if (v) {
          result.set(n.key, v)
          this.cache.set(hash(n.text), v)
        }
      })
      if (!isQuery) this.saveCache()
    }
    return result
  }

  /** Семантический поиск: query против набора документов. Возвращает топ по смыслу. */
  async search(
    query: string,
    docs: { id: string; text: string; label: string }[],
    limit = 8
  ): Promise<{ id: string; label: string; text: string; score: number }[]> {
    if (!docs.length) return []
    const qMap = await this.vectorsFor([{ key: 'q', text: query }], true)
    const qv = qMap.get('q')
    if (!qv) return []
    const dMap = await this.vectorsFor(docs.map((d) => ({ key: d.id, text: d.text })))

    const scored = docs.map((d) => {
      const dv = dMap.get(d.id)
      return { ...d, score: dv ? cosine(qv, dv) : 0 }
    })
    return scored.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  install(onProgress: (line: string) => void): Promise<{ ok: boolean; message: string }> {
    return new Promise((resolve) => {
      const target = pyenvDir()
      const tmp = join(target, '..', 'pytmp')
      const env = { ...process.env, TMP: tmp, TEMP: tmp, PIP_NO_INPUT: '1' }
      onProgress('Устанавливаю движок эмбеддингов (fastembed)…')
      const pip = spawn(pythonExe(), ['-m', 'pip', 'install', '--no-cache-dir', '--target', target, 'fastembed'], { env, windowsHide: true })
      pip.stdout.on('data', (d: Buffer) => onProgress(d.toString().trim().slice(0, 160)))
      pip.stderr.on('data', (d: Buffer) => onProgress(d.toString().trim().slice(0, 160)))
      pip.on('error', (e) => resolve({ ok: false, message: `Нужен Python. ${e.message}` }))
      pip.on('close', (code) => {
        this.available = null
        resolve(code === 0
          ? { ok: true, message: 'Семантическая память установлена. Модель (~220 МБ) скачается при первом поиске.' }
          : { ok: false, message: 'Не удалось установить (проверь Python).' })
      })
    })
  }

  kill(): void {
    this.ready = false
    this.starting = null
    if (this.proc) { try { this.proc.kill() } catch { /* ignore */ } this.proc = null }
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

export const semantic = new SemanticManager()
