/**
 * Emotion — грубая оценка эмоционального тона по голосу (librosa). Kira
 * подстраивает тон ответа под настроение пользователя. Опционально.
 */
import { app } from 'electron'
import { spawn, ChildProcessWithoutNullStreams, execFile } from 'child_process'
import { existsSync } from 'fs'
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

export interface EmotionResult {
  label: string
  arousal: number
  pitch: number
}

class EmotionManager {
  private proc: ChildProcessWithoutNullStreams | null = null
  private ready = false
  private starting: Promise<void> | null = null
  private buffer = ''
  private reqId = 0
  private pending = new Map<number, { resolve: (v: EmotionResult) => void; reject: (e: Error) => void }>()
  private available: boolean | null = null

  isAvailable(): Promise<boolean> {
    if (this.available !== null) return Promise.resolve(this.available)
    return new Promise((resolve) => {
      const env = { ...process.env, PYTHONPATH: pyenvDir() }
      execFile(pythonExe(), ['-c', 'import librosa'], { env, timeout: 25_000 }, (err) => {
        this.available = !err
        resolve(this.available)
      })
    })
  }

  private start(): Promise<void> {
    if (this.ready) return Promise.resolve()
    if (this.starting) return this.starting
    this.starting = new Promise<void>((resolve, reject) => {
      const script = join(resourcesRoot(), 'emotion.py')
      if (!existsSync(script)) return reject(new Error('emotion.py не найден'))
      const env = { ...process.env, PYTHONPATH: pyenvDir(), PYTHONIOENCODING: 'utf-8' }
      const proc = spawn(pythonExe(), ['-u', script], { env })
      this.proc = proc
      const t = setTimeout(() => reject(new Error('Таймаут загрузки анализа голоса')), 60_000)
      proc.stdout.setEncoding('utf-8')
      proc.stdout.on('data', (chunk: string) => {
        this.buffer += chunk
        let idx: number
        while ((idx = this.buffer.indexOf('\n')) !== -1) {
          const line = this.buffer.slice(0, idx).trim()
          this.buffer = this.buffer.slice(idx + 1)
          if (!line) continue
          let msg: { type?: string; id?: number; ok?: boolean; label?: string; arousal?: number; pitch?: number; error?: string }
          try { msg = JSON.parse(line) } catch { continue }
          if (msg.type === 'ready') { clearTimeout(t); this.ready = true; logger.info('emotion', 'Анализ тона голоса активен'); resolve() }
          else if (msg.type === 'error') { clearTimeout(t); reject(new Error(msg.error)) }
          else if (typeof msg.id === 'number') {
            const p = this.pending.get(msg.id)
            if (p) { this.pending.delete(msg.id); msg.ok ? p.resolve({ label: msg.label ?? 'нейтрально', arousal: msg.arousal ?? 0.5, pitch: msg.pitch ?? 0 }) : p.reject(new Error(msg.error)) }
          }
        }
      })
      proc.on('exit', () => { this.ready = false; this.starting = null; this.proc = null; for (const [, p] of this.pending) p.reject(new Error('emotion процесс завершён')); this.pending.clear() })
      proc.on('error', (e) => { clearTimeout(t); reject(e) })
    })
    return this.starting
  }

  async analyze(pcmBase64: string): Promise<EmotionResult | null> {
    try {
      await this.start()
      return await new Promise<EmotionResult>((resolve, reject) => {
        const id = ++this.reqId
        this.pending.set(id, { resolve, reject })
        this.proc!.stdin.write(JSON.stringify({ id, pcm: pcmBase64 }) + '\n')
        setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('Таймаут анализа')) } }, 15_000)
      })
    } catch {
      return null
    }
  }
}

export const emotion = new EmotionManager()
