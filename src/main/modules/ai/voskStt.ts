/**
 * VoskStt — офлайн-распознавание готовой записи (WAV) через Vosk.
 *
 * Резерв для голосового ввода: когда Groq Whisper недоступен (нет интернета
 * или ключа), команда распознаётся локально — той же моделью vosk-model-small-ru,
 * что уже стоит для wake-word. Точность ниже Whisper, но голос работает офлайн.
 *
 * Сайдкар resources/vosk_stt.py держится запущенным (модель грузится один раз),
 * протокол — line-JSON с id запроса.
 */
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { join } from 'path'
import { logger } from '../logger'
import { resourcesRoot, pyenvDir, pythonExe, resolveModelDir } from './wakeword'

interface SttResponse {
  ok: boolean
  text: string
  error?: string
}

class VoskSttManager {
  private proc: ChildProcessWithoutNullStreams | null = null
  private ready = false
  private startPromise: Promise<boolean> | null = null
  private buffer = ''
  private seq = 0
  private pending = new Map<number, (r: SttResponse) => void>()

  /** Быстрая проверка: модель на месте (сам vosk проверяет wakeword.isAvailable). */
  hasModel(): boolean {
    return resolveModelDir() !== null
  }

  private ensureStarted(): Promise<boolean> {
    if (this.ready && this.proc) return Promise.resolve(true)
    if (this.startPromise) return this.startPromise
    this.startPromise = new Promise<boolean>((resolve) => {
      const modelDir = resolveModelDir()
      if (!modelDir) { this.startPromise = null; return resolve(false) }

      const script = join(resourcesRoot(), 'vosk_stt.py')
      const env = { ...process.env, PYTHONPATH: pyenvDir(), PYTHONIOENCODING: 'utf-8' }
      const proc = spawn(pythonExe(), ['-u', script, modelDir], { env, windowsHide: true })
      this.proc = proc

      const timeout = setTimeout(() => { if (!this.ready) { resolve(false) } }, 30_000)

      proc.stdout.setEncoding('utf-8')
      proc.stdout.on('data', (chunk: string) => {
        this.buffer += chunk
        let idx: number
        while ((idx = this.buffer.indexOf('\n')) !== -1) {
          const line = this.buffer.slice(0, idx).trim()
          this.buffer = this.buffer.slice(idx + 1)
          if (!line) continue
          try {
            const msg = JSON.parse(line) as { type?: string; error?: string; id?: number; ok?: boolean; text?: string }
            if (msg.type === 'ready') {
              this.ready = true
              clearTimeout(timeout)
              logger.info('vosk-stt', 'Офлайн-распознавание готово')
              resolve(true)
            } else if (msg.type === 'error') {
              logger.warn('vosk-stt', msg.error ?? 'ошибка')
              clearTimeout(timeout)
              resolve(false)
            } else if (typeof msg.id === 'number') {
              const cb = this.pending.get(msg.id)
              if (cb) {
                this.pending.delete(msg.id)
                cb({ ok: !!msg.ok, text: msg.text ?? '', error: msg.error })
              }
            }
          } catch { /* не-JSON строка — пропускаем */ }
        }
      })
      proc.on('exit', () => {
        this.ready = false
        this.proc = null
        this.startPromise = null
        for (const cb of this.pending.values()) cb({ ok: false, text: '', error: 'Vosk завершился' })
        this.pending.clear()
      })
      proc.on('error', () => {
        this.ready = false
        this.startPromise = null
        resolve(false)
      })
    })
    return this.startPromise
  }

  /** Есть ли готовая/поднимаемая офлайн-модель. */
  available(): boolean {
    return this.hasModel()
  }

  /**
   * Прогреть сайдкар заранее (загрузка модели ~пара секунд), чтобы ПЕРВАЯ
   * голосовая команда распозналась мгновенно, а не ждала старта Python+модели.
   * Вызывается при запуске, если офлайн-распознавание — основной путь.
   */
  async warmup(): Promise<boolean> {
    if (!this.hasModel()) return false
    return this.ensureStarted()
  }

  /** Распознать WAV (base64). Возвращает текст или ошибку. */
  async transcribe(wavBase64: string): Promise<SttResponse> {
    const started = await this.ensureStarted()
    if (!started || !this.proc) return { ok: false, text: '', error: 'Офлайн-распознавание недоступно' }
    const id = ++this.seq
    return new Promise<SttResponse>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          resolve({ ok: false, text: '', error: 'Таймаут распознавания' })
        }
      }, 25_000)
      this.pending.set(id, (r) => { clearTimeout(timer); resolve(r) })
      this.proc!.stdin.write(JSON.stringify({ id, wav: wavBase64 }) + '\n')
    })
  }

  shutdown(): void {
    try { this.proc?.kill() } catch { /* ignore */ }
    this.proc = null
    this.ready = false
  }
}

export const voskStt = new VoskSttManager()
