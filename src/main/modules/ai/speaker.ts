/**
 * Speaker verification — узнавание голоса хозяина. Kira реагирует только на
 * твой голос (d-vector через resemblyzer, локально). Опционально.
 */
import { app } from 'electron'
import { spawn, ChildProcessWithoutNullStreams, execFile } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
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

class SpeakerManager {
  private proc: ChildProcessWithoutNullStreams | null = null
  private ready = false
  private starting: Promise<void> | null = null
  private buffer = ''
  private reqId = 0
  private pending = new Map<number, { resolve: (v: number[]) => void; reject: (e: Error) => void }>()
  private available: boolean | null = null
  private reference: number[] | null = null
  private refLoaded = false

  private refFile(): string {
    return join(app.getPath('userData'), 'data', 'speaker-ref.json')
  }

  private loadRef(): void {
    if (this.refLoaded) return
    this.refLoaded = true
    try {
      if (existsSync(this.refFile())) this.reference = JSON.parse(readFileSync(this.refFile(), 'utf-8'))
    } catch { /* ignore */ }
  }

  isEnrolled(): boolean {
    this.loadRef()
    return !!this.reference
  }

  isAvailable(): Promise<boolean> {
    if (this.available !== null) return Promise.resolve(this.available)
    return new Promise((resolve) => {
      const env = { ...process.env, PYTHONPATH: pyenvDir() }
      execFile(pythonExe(), ['-c', 'import resemblyzer'], { env, timeout: 25_000 }, (err) => {
        this.available = !err
        resolve(this.available)
      })
    })
  }

  private start(): Promise<void> {
    if (this.ready) return Promise.resolve()
    if (this.starting) return this.starting
    this.starting = new Promise<void>((resolve, reject) => {
      const script = join(resourcesRoot(), 'speaker.py')
      if (!existsSync(script)) return reject(new Error('speaker.py не найден'))
      const env = { ...process.env, PYTHONPATH: pyenvDir(), PYTHONIOENCODING: 'utf-8' }
      const proc = spawn(pythonExe(), ['-u', script], { env })
      this.proc = proc
      const t = setTimeout(() => reject(new Error('Таймаут загрузки модели голоса')), 120_000)
      proc.stdout.setEncoding('utf-8')
      proc.stdout.on('data', (chunk: string) => {
        this.buffer += chunk
        let idx: number
        while ((idx = this.buffer.indexOf('\n')) !== -1) {
          const line = this.buffer.slice(0, idx).trim()
          this.buffer = this.buffer.slice(idx + 1)
          if (!line) continue
          let msg: { type?: string; id?: number; ok?: boolean; vector?: number[]; error?: string }
          try { msg = JSON.parse(line) } catch { continue }
          if (msg.type === 'ready') { clearTimeout(t); this.ready = true; logger.info('speaker', 'Узнавание голоса активно'); resolve() }
          else if (msg.type === 'error') { clearTimeout(t); reject(new Error(msg.error)) }
          else if (typeof msg.id === 'number') {
            const p = this.pending.get(msg.id)
            if (p) { this.pending.delete(msg.id); msg.ok && msg.vector ? p.resolve(msg.vector) : p.reject(new Error(msg.error)) }
          }
        }
      })
      proc.on('exit', () => { this.ready = false; this.starting = null; this.proc = null; for (const [, p] of this.pending) p.reject(new Error('speaker процесс завершён')); this.pending.clear() })
      proc.on('error', (e) => { clearTimeout(t); reject(e) })
    })
    return this.starting
  }

  private embed(pcmBase64: string): Promise<number[]> {
    return this.start().then(() => new Promise<number[]>((resolve, reject) => {
      const id = ++this.reqId
      this.pending.set(id, { resolve, reject })
      this.proc!.stdin.write(JSON.stringify({ id, pcm: pcmBase64 }) + '\n')
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('Таймаут эмбеддинга голоса')) } }, 30_000)
    }))
  }

  /** Обучение: несколько образцов голоса усредняем в эталон. */
  async enroll(samples: string[]): Promise<{ ok: boolean; message: string }> {
    try {
      const vecs: number[][] = []
      for (const s of samples) vecs.push(await this.embed(s))
      if (!vecs.length) return { ok: false, message: 'Нет образцов' }
      const dim = vecs[0].length
      const avg = new Array(dim).fill(0)
      for (const v of vecs) for (let i = 0; i < dim; i++) avg[i] += v[i] / vecs.length
      this.reference = avg
      this.refLoaded = true
      writeFileSync(this.refFile(), JSON.stringify(avg))
      logger.info('speaker', `Голос хозяина обучен (${vecs.length} образцов)`)
      return { ok: true, message: 'Готово! Kira запомнила твой голос.' }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }

  /** Похож ли голос на эталон хозяина? threshold ~0.72. */
  async verify(pcmBase64: string, threshold = 0.72): Promise<{ isOwner: boolean; score: number }> {
    this.loadRef()
    if (!this.reference) return { isOwner: true, score: 1 } // не обучено — пропускаем всех
    try {
      const v = await this.embed(pcmBase64)
      const score = cosine(v, this.reference)
      return { isOwner: score >= threshold, score }
    } catch {
      return { isOwner: true, score: 1 } // при сбое не блокируем
    }
  }

  clearEnrollment(): void {
    this.reference = null
    try { if (existsSync(this.refFile())) writeFileSync(this.refFile(), 'null') } catch { /* ignore */ }
  }

  install(onProgress: (line: string) => void): Promise<{ ok: boolean; message: string }> {
    return new Promise((resolve) => {
      const target = pyenvDir()
      const tmp = join(target, '..', 'pytmp')
      const env = { ...process.env, TMP: tmp, TEMP: tmp, PIP_NO_INPUT: '1' }
      onProgress('Устанавливаю узнавание голоса (resemblyzer + librosa)…')
      // webrtcvad не собирается на py3.14 → ставим resemblyzer без зависимостей и librosa отдельно
      const pip = spawn(pythonExe(), ['-m', 'pip', 'install', '--no-cache-dir', '--target', target, '--no-deps', 'resemblyzer'], { env })
      pip.stdout.on('data', (d: Buffer) => onProgress(d.toString().trim().slice(0, 140)))
      pip.stderr.on('data', (d: Buffer) => onProgress(d.toString().trim().slice(0, 140)))
      pip.on('error', (e) => resolve({ ok: false, message: `Нужен Python. ${e.message}` }))
      pip.on('close', (code) => {
        if (code !== 0) return resolve({ ok: false, message: 'Не удалось установить resemblyzer.' })
        const pip2 = spawn(pythonExe(), ['-m', 'pip', 'install', '--no-cache-dir', '--target', target, 'librosa'], { env })
        pip2.stdout.on('data', (d: Buffer) => onProgress(d.toString().trim().slice(0, 140)))
        pip2.stderr.on('data', (d: Buffer) => onProgress(d.toString().trim().slice(0, 140)))
        pip2.on('close', (c2) => {
          this.available = null
          resolve(c2 === 0
            ? { ok: true, message: 'Узнавание голоса установлено. Теперь обучи Kira своему голосу.' }
            : { ok: false, message: 'Не удалось установить librosa.' })
        })
      })
    })
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

export const speaker = new SpeakerManager()
