/**
 * WakeWord manager — офлайн-детектор слова «Кира» через Vosk.
 *
 * Аудио (PCM 16 kHz mono) приходит из renderer, пересылается в Python-сайдкар,
 * который локально распознаёт речь. Когда в тексте появляется слово-активатор —
 * шлём в renderer событие 'wake:detected'. Всё офлайн, ноль трафика.
 */
import { app, BrowserWindow } from 'electron'
import { spawn, ChildProcessWithoutNullStreams, execFile, execFileSync } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { logger } from '../logger'
import { getSettings } from '../settings'

export function resourcesRoot(): string {
  return app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources')
}
export function pyenvDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'pyenv') : join(__dirname, '../../pyenv')
}
export function pythonExe(): string {
  const local = join(pyenvDir(), '..', 'python', 'python.exe')
  if (existsSync(local)) return local
  return process.platform === 'win32' ? 'python' : 'python3'
}
function voskDir(): string {
  return join(app.getPath('userData'), 'vosk')
}

/** Путь к распакованной модели (папка vosk-model-*). Распаковывает zip при необходимости. */
export function resolveModelDir(): string | null {
  const dir = voskDir()
  if (existsSync(dir)) {
    const sub = readdirSync(dir, { withFileTypes: true }).find(
      (e) => e.isDirectory() && e.name.toLowerCase().startsWith('vosk-model')
    )
    if (sub) return join(dir, sub.name)
    // есть zip — распакуем
    const zip = join(dir, 'model.zip')
    if (existsSync(zip)) {
      try {
        execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force '${zip}' '${dir}'`], { timeout: 60_000 })
        const sub2 = readdirSync(dir, { withFileTypes: true }).find(
          (e) => e.isDirectory() && e.name.toLowerCase().startsWith('vosk-model')
        )
        if (sub2) return join(dir, sub2.name)
      } catch { /* ignore */ }
    }
  }
  return null
}

class WakeWordManager {
  private proc: ChildProcessWithoutNullStreams | null = null
  private ready = false
  private starting = false
  private buffer = ''
  private lastDetect = 0
  private getWin: (() => BrowserWindow | null) | null = null
  private available: boolean | null = null
  private restartAttempts = 0
  private stopped = false

  setWindowGetter(fn: () => BrowserWindow | null): void {
    this.getWin = fn
  }

  isAvailable(): Promise<boolean> {
    if (this.available !== null) return Promise.resolve(this.available)
    return new Promise((resolve) => {
      if (!resolveModelDir()) { this.available = false; return resolve(false) }
      const env = { ...process.env, PYTHONPATH: pyenvDir() }
      execFile(pythonExe(), ['-c', 'import vosk'], { env, timeout: 20_000 }, (err) => {
        this.available = !err
        resolve(this.available)
      })
    })
  }

  start(): void {
    this.stopped = false
    if (this.ready || this.starting) return
    const modelDir = resolveModelDir()
    if (!modelDir) { logger.warn('wake', 'Модель Vosk не найдена — офлайн-активатор недоступен'); return }
    this.starting = true
    const script = join(resourcesRoot(), 'vosk_wake.py')
    const env = { ...process.env, PYTHONPATH: pyenvDir(), PYTHONIOENCODING: 'utf-8' }
    const proc = spawn(pythonExe(), ['-u', script, modelDir], { env })
    this.proc = proc

    proc.stdout.setEncoding('utf-8')
    proc.stdout.on('data', (chunk: string) => {
      this.buffer += chunk
      let idx: number
      while ((idx = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, idx).trim()
        this.buffer = this.buffer.slice(idx + 1)
        if (line) this.handle(line)
      }
    })
    proc.on('exit', () => {
      const wasReady = this.ready
      this.ready = false
      this.starting = false
      this.proc = null
      // сайдкар упал во время работы — тихо воскрешаем (не чаще раза в 5 сек,
      // максимум 5 попыток подряд), иначе офлайн-активация молча умирала
      if (wasReady && !this.stopped && this.restartAttempts < 5) {
        this.restartAttempts++
        logger.warn('wake', `Vosk упал — перезапускаю (попытка ${this.restartAttempts})`)
        setTimeout(() => { if (!this.stopped) this.start() }, 5000)
      }
    })
    proc.on('error', (e) => { this.starting = false; logger.warn('wake', `Vosk: ${e.message}`) })
  }

  private handle(line: string): void {
    let msg: { type?: string; text?: string; error?: string }
    try { msg = JSON.parse(line) } catch { return }
    if (msg.type === 'ready') {
      this.ready = true
      this.starting = false
      this.stopped = false
      this.restartAttempts = 0
      logger.info('wake', 'Офлайн-активатор «Кира» активен (Vosk)')
    } else if (msg.type === 'error') {
      this.starting = false
      logger.warn('wake', msg.error ?? 'ошибка Vosk')
    } else if (msg.type === 'partial' || msg.type === 'final') {
      const text = (msg.text ?? '').toLowerCase()
      const wake = (getSettings().wakeWord || 'кира').toLowerCase()
      if (text.includes(wake) && Date.now() - this.lastDetect > 2500) {
        this.lastDetect = Date.now()
        const win = this.getWin?.()
        if (win && !win.isDestroyed()) win.webContents.send('wake:detected')
        logger.action('wake', 'Услышала «Кира»')
      }
    }
  }

  /** Кадр аудио из renderer: PCM Int16 16kHz mono. */
  feed(pcm: Buffer): void {
    if (!this.proc || !this.ready) return
    const header = Buffer.alloc(4)
    header.writeUInt32LE(pcm.length, 0)
    try { this.proc.stdin.write(header); this.proc.stdin.write(pcm) } catch { /* ignore */ }
  }

  stop(): void {
    this.stopped = true // штатная остановка — авто-перезапуск не нужен
    this.ready = false
    this.starting = false
    if (this.proc) { try { this.proc.kill() } catch { /* ignore */ } this.proc = null }
  }

  get running(): boolean {
    return this.ready
  }

  /** Установка офлайн-активатора: pip install vosk + скачивание русской модели. */
  install(onProgress: (line: string) => void): Promise<{ ok: boolean; message: string }> {
    return new Promise((resolve) => {
      const target = pyenvDir()
      const tmp = join(target, '..', 'pytmp')
      const env = { ...process.env, TMP: tmp, TEMP: tmp, PIP_NO_INPUT: '1' }
      onProgress('Устанавливаю Vosk (офлайн-распознавание)…')
      const pip = spawn(pythonExe(), ['-m', 'pip', 'install', '--no-cache-dir', '--target', target, 'vosk'], { env })
      pip.stdout.on('data', (d: Buffer) => onProgress(d.toString().trim().slice(0, 160)))
      pip.stderr.on('data', (d: Buffer) => onProgress(d.toString().trim().slice(0, 160)))
      pip.on('error', (e) => resolve({ ok: false, message: `Нужен Python. ${e.message}` }))
      pip.on('close', async (code) => {
        if (code !== 0) return resolve({ ok: false, message: 'Не удалось установить Vosk (проверь Python).' })
        // скачиваем модель
        onProgress('Скачиваю русскую модель Vosk (~45 МБ)…')
        const dir = voskDir()
        const { mkdirSync, createWriteStream } = await import('fs')
        mkdirSync(dir, { recursive: true })
        try {
          const res = await fetch('https://alphacephei.com/vosk/models/vosk-model-small-ru-0.22.zip')
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
          const { Readable } = await import('stream')
          const { pipeline } = await import('stream/promises')
          await pipeline(Readable.fromWeb(res.body as never), createWriteStream(join(dir, 'model.zip')))
          onProgress('Распаковываю модель…')
          resolveModelDir() // распакует zip
          this.available = null
          resolve({ ok: true, message: 'Офлайн-активатор «Кира» установлен!' })
        } catch (e) {
          resolve({ ok: false, message: `Модель не скачалась: ${(e as Error).message}` })
        }
      })
    })
  }
}

export const wakeWord = new WakeWordManager()
