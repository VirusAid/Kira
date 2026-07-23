/**
 * Silero TTS manager — управляет Python-сайдкаром локального синтеза речи.
 *
 * Запускает python resources/silero_tts.py, общается по строковому JSON-протоколу
 * через stdin/stdout. Ленивая инициализация: процесс поднимается при первом
 * запросе озвучки. Работает на CPU и не конкурирует с LLM за GPU.
 */
import { app } from 'electron'
import { spawn, ChildProcessWithoutNullStreams, execFile } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { logger } from '../logger'

export const SILERO_SPEAKERS = [
  { id: 'xenia', label: 'Ксения — мягкий женский', gender: 'female' },
  { id: 'kseniya', label: 'Ксения (альт.) — женский', gender: 'female' },
  { id: 'baya', label: 'Байя — женский', gender: 'female' },
  { id: 'aidar', label: 'Айдар — мужской', gender: 'male' },
  { id: 'eugene', label: 'Евгений — мужской', gender: 'male' }
]

type Pending = { resolve: (audio: string) => void; reject: (err: Error) => void }

class SileroManager {
  private proc: ChildProcessWithoutNullStreams | null = null
  private ready = false
  private starting: Promise<void> | null = null
  private pending = new Map<number, Pending>()
  private buffer = ''
  private reqId = 0
  private lastError = ''
  private available: boolean | null = null

  private resourcesRoot(): string {
    return app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources')
  }

  private pyenvDir(): string {
    return app.isPackaged ? join(process.resourcesPath, 'pyenv') : join(__dirname, '../../pyenv')
  }

  private pythonExe(): string {
    // приоритет: локальный venv рядом с приложением, иначе системный python
    const local = join(this.pyenvDir(), '..', 'python', 'python.exe')
    if (existsSync(local)) return local
    return process.platform === 'win32' ? 'python' : 'python3'
  }

  /** Быстрая проверка: установлен ли torch (без запуска модели). Не блокирует UI. */
  isAvailable(): Promise<boolean> {
    if (this.available !== null) return Promise.resolve(this.available)
    return new Promise<boolean>((resolve) => {
      const env = { ...process.env, PYTHONPATH: this.pyenvDir() }
      execFile(this.pythonExe(), ['-c', 'import torch'], { env, timeout: 25_000, windowsHide: true }, (err) => {
        this.available = !err
        resolve(this.available)
      })
    })
  }

  /** Проверка наличия Python в системе (нужен для локального голоса). */
  checkPython(): Promise<{ ok: boolean; version: string }> {
    return new Promise((resolve) => {
      execFile(this.pythonExe(), ['--version'], { timeout: 15_000, windowsHide: true }, (err, stdout, stderr) => {
        const out = (stdout || stderr || '').trim()
        resolve({ ok: !err && /python/i.test(out), version: out })
      })
    })
  }

  /**
   * Установка torch+numpy в локальную папку pyenv (один раз). Прогресс
   * транслируется в renderer. Требует установленного в системе Python.
   */
  install(onProgress: (line: string) => void): Promise<{ ok: boolean; message: string }> {
    return new Promise((resolve) => {
      const target = this.pyenvDir()
      const tmp = join(target, '..', 'pytmp')
      const env = { ...process.env, TMP: tmp, TEMP: tmp, PIP_NO_INPUT: '1' }
      onProgress('Запускаю установку PyTorch (CPU). Это ~200–300 МБ, наберись терпения…')
      const args = [
        '-m', 'pip', 'install', '--no-cache-dir', '--target', target,
        'numpy', 'torch',
        '--index-url', 'https://download.pytorch.org/whl/cpu',
        '--extra-index-url', 'https://pypi.org/simple'
      ]
      const proc = spawn(this.pythonExe(), args, { env, windowsHide: true })
      const onData = (d: Buffer): void => {
        const line = d.toString().trim()
        if (line) onProgress(line.slice(0, 200))
      }
      proc.stdout.on('data', onData)
      proc.stderr.on('data', onData)
      proc.on('error', (err) => resolve({ ok: false, message: `Не удалось запустить Python: ${err.message}. Установи Python 3 с python.org.` }))
      proc.on('close', (code) => {
        this.available = null // пересчитать при следующей проверке
        if (code === 0) resolve({ ok: true, message: 'PyTorch установлен. Локальный голос Silero готов!' })
        else resolve({ ok: false, message: `Установка завершилась с ошибкой (код ${code}). Проверь, установлен ли Python.` })
      })
    })
  }

  private start(): Promise<void> {
    if (this.ready) return Promise.resolve()
    if (this.starting) return this.starting

    this.starting = new Promise<void>((resolve, reject) => {
      const script = join(this.resourcesRoot(), 'silero_tts.py')
      if (!existsSync(script)) {
        reject(new Error('silero_tts.py не найден'))
        return
      }
      const cacheDir = join(app.getPath('userData'), 'silero')
      const env = { ...process.env, PYTHONPATH: this.pyenvDir(), PYTHONIOENCODING: 'utf-8' }

      logger.info('silero', 'Запускаю локальный синтез речи Silero…')
      const proc = spawn(this.pythonExe(), ['-u', script, cacheDir], { env, windowsHide: true })
      this.proc = proc

      const startTimeout = setTimeout(() => {
        reject(new Error('Silero: превышено время загрузки модели'))
        this.kill()
      }, 120_000)

      proc.stdout.setEncoding('utf-8')
      proc.stdout.on('data', (chunk: string) => {
        this.buffer += chunk
        let idx: number
        while ((idx = this.buffer.indexOf('\n')) !== -1) {
          const line = this.buffer.slice(0, idx).trim()
          this.buffer = this.buffer.slice(idx + 1)
          if (!line) continue
          this.handleMessage(line, resolve, reject, startTimeout)
        }
      })

      proc.stderr.setEncoding('utf-8')
      proc.stderr.on('data', (d: string) => {
        const msg = d.trim()
        if (msg) this.lastError = msg.slice(0, 300)
      })

      proc.on('exit', (code) => {
        this.ready = false
        this.proc = null
        this.starting = null
        for (const [, p] of this.pending) p.reject(new Error('Silero: процесс завершился'))
        this.pending.clear()
        if (code !== 0 && code !== null) logger.warn('silero', `Silero завершился с кодом ${code}. ${this.lastError}`)
      })

      proc.on('error', (err) => {
        clearTimeout(startTimeout)
        reject(new Error(`Не удалось запустить Python: ${err.message}`))
      })
    })

    return this.starting
  }

  private handleMessage(
    line: string,
    resolveStart: () => void,
    rejectStart: (e: Error) => void,
    startTimeout: NodeJS.Timeout
  ): void {
    let msg: { type?: string; id?: number; ok?: boolean; audio?: string; error?: string; message?: string }
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.type === 'ready') {
      clearTimeout(startTimeout)
      this.ready = true
      logger.info('silero', 'Silero готов — локальный голос активен')
      resolveStart()
    } else if (msg.type === 'error') {
      clearTimeout(startTimeout)
      this.lastError = msg.error ?? 'неизвестная ошибка'
      rejectStart(new Error(this.lastError))
    } else if (msg.type === 'log') {
      logger.info('silero', msg.message ?? '')
    } else if (typeof msg.id === 'number') {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.ok && msg.audio) p.resolve(msg.audio)
      else p.reject(new Error(msg.error ?? 'Silero: ошибка синтеза'))
    }
  }

  /** Синтез речи. Возвращает WAV в base64 (24 kHz mono). */
  async synthesize(text: string, speaker: string): Promise<string> {
    await this.start()
    if (!this.proc || !this.ready) throw new Error(this.lastError || 'Silero недоступен')
    const id = ++this.reqId
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.proc!.stdin.write(JSON.stringify({ id, text, speaker }) + '\n')
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error('Silero: таймаут синтеза'))
        }
      }, 30_000)
    })
  }

  kill(): void {
    this.ready = false
    this.starting = null
    if (this.proc) {
      try { this.proc.kill() } catch { /* ignore */ }
      this.proc = null
    }
  }
}

export const silero = new SileroManager()
