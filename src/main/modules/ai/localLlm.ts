/**
 * Local LLM — офлайн-мозг Kira через Ollama.
 *
 * Завершает философию Local First: Kira думает и разговаривает БЕЗ облака и
 * без ключей, полностью офлайн и приватно. Модель подбирается под железо
 * (VRAM/RAM). Этот модуль управляет жизненным циклом Ollama (проверка,
 * автозапуск сервера, список и загрузка моделей) — сам инференс идёт через
 * существующий OpenAI-совместимый провайдер «ollama».
 */
import { app } from 'electron'
import { spawn, execFile } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { logger } from '../logger'

const OLLAMA_URL = 'http://localhost:11434'

// ─── Встроенная (переносная) Ollama из ресурсов установщика ──────────────────

function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources')
}
/** Путь к вшитой ollama.exe (если поставляется в установщике). */
function bundledExe(): string {
  return join(resourcesDir(), 'ollama', 'ollama.exe')
}
/** Папка с вшитыми моделями (blobs). */
function bundledModelsDir(): string {
  return join(resourcesDir(), 'ollama-models')
}
export function hasBundled(): boolean {
  return existsSync(bundledExe())
}
/** Окружение для запуска вшитой Ollama — модели берём из ресурсов. */
function bundledEnv(): NodeJS.ProcessEnv {
  return { ...process.env, OLLAMA_MODELS: bundledModelsDir(), OLLAMA_HOST: '127.0.0.1:11434' }
}

export interface LocalModel {
  tag: string
  label: string
  sizeGb: number
  note: string
  minVramGb: number
}

/** Курируемый список — Qwen3 отлично знает русский, силён в коде и рассуждениях. */
export const RECOMMENDED_MODELS: LocalModel[] = [
  { tag: 'qwen3:14b', label: 'Максимум (Qwen3 14B)', sizeGb: 9.3, note: 'Самый умный. Нужно ≥10 ГБ VRAM или выгрузка в ОЗУ (медленнее).', minVramGb: 10 },
  { tag: 'qwen3:8b', label: 'Сбалансированный (Qwen3 8B)', sizeGb: 5.2, note: 'Лучший баланс качества и скорости. Рекомендуется для 6+ ГБ VRAM.', minVramGb: 6 },
  { tag: 'qwen3:4b', label: 'Быстрый (Qwen3 4B)', sizeGb: 2.5, note: 'Шустрый, контекст 256K. Хорош для 4 ГБ VRAM и слабых ПК.', minVramGb: 4 },
  { tag: 'qwen3:1.7b', label: 'Лёгкий (Qwen3 1.7B)', sizeGb: 1.4, note: 'Для очень слабого железа / только CPU.', minVramGb: 0 }
]

export interface HardwareInfo {
  ramGb: number
  vramGb: number
  gpu: string
}

/** Реальный объём видеопамяти: nvidia-smi → реестр → 0. */
async function detectVram(): Promise<{ vramGb: number; gpu: string }> {
  // nvidia-smi точнее всего
  const smi = await new Promise<string>((resolve) => {
    execFile('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
      { timeout: 6000 }, (err, stdout) => resolve(err ? '' : stdout))
  })
  const line = smi.trim().split('\n')[0]
  if (line) {
    const [name, mb] = line.split(',').map((s) => s.trim())
    const gb = Math.round((Number(mb) / 1024) * 10) / 10
    if (gb > 0) return { vramGb: gb, gpu: name }
  }
  // без NVIDIA — считаем, что дискретного GPU нет (CPU/интегрированная)
  return { vramGb: 0, gpu: 'CPU / интегрированная графика' }
}

export async function hardwareInfo(): Promise<HardwareInfo> {
  const ramGb = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10
  const { vramGb, gpu } = await detectVram()
  return { ramGb, vramGb, gpu }
}

/**
 * Подобрать модель под железо ЛЮБОГО пользователя — универсально, а не под
 * конкретный GPU. Дискретный GPU → по VRAM. Без него (CPU/встройка) —
 * консервативно, т.к. инференс на CPU медленный: даже с 32 ГБ ОЗУ не тянем 8B+.
 */
export async function recommendModel(): Promise<LocalModel> {
  const { vramGb, ramGb } = await hardwareInfo()
  const byTag = (tag: string): LocalModel => RECOMMENDED_MODELS.find((m) => m.tag === tag)!

  if (vramGb >= 10) return byTag('qwen3:14b')
  if (vramGb >= 6) return byTag('qwen3:8b')
  if (vramGb >= 4) return byTag('qwen3:4b')
  if (vramGb > 0) return ramGb >= 8 ? byTag('qwen3:4b') : byTag('qwen3:1.7b') // слабый GPU + выгрузка в ОЗУ
  // CPU-only / встроенная графика: 4B — потолок разумной скорости, ниже 8 ГБ ОЗУ — 1.7B
  return ramGb >= 8 ? byTag('qwen3:4b') : byTag('qwen3:1.7b')
}

// ─── Жизненный цикл Ollama ───────────────────────────────────────────────────

/** Ollama доступна (вшита в установщик ИЛИ установлена в системе)? */
export function isInstalled(): Promise<boolean> {
  if (hasBundled()) return Promise.resolve(true)
  return new Promise((resolve) => {
    execFile(process.platform === 'win32' ? 'where' : 'which', ['ollama'],
      { timeout: 5000 }, (err) => resolve(!err))
  })
}

/** Сервер Ollama отвечает? */
export async function isRunning(): Promise<boolean> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/version`, { signal: AbortSignal.timeout(2500) })
    return r.ok
  } catch {
    return false
  }
}

/** Запустить сервер Ollama (вшитый — приоритетно, иначе системный). */
export async function ensureRunning(): Promise<boolean> {
  if (await isRunning()) return true
  const bundled = hasBundled()
  if (!bundled && !(await isInstalled())) return false
  try {
    const exe = bundled ? bundledExe() : 'ollama'
    const proc = spawn(exe, ['serve'], {
      detached: true, stdio: 'ignore', windowsHide: true,
      env: bundled ? bundledEnv() : process.env
    })
    proc.unref()
  } catch {
    return false
  }
  // ждём поднятия сервера до 10 сек
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (await isRunning()) { logger.info('local-llm', `Ollama сервер запущен${bundled ? ' (встроенная)' : ''}`); return true }
  }
  return false
}

/** Установленные локально модели. */
export async function installedModels(): Promise<string[]> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) })
    const j = (await r.json()) as { models?: { name: string }[] }
    return (j.models ?? []).map((m) => m.name)
  } catch {
    return []
  }
}

/**
 * Скачать модель с прогрессом (стриминг NDJSON от /api/pull).
 * onProgress получает 0..100 и человекочитаемый статус.
 */
export async function pullModel(
  tag: string,
  onProgress: (percent: number, status: string) => void
): Promise<{ ok: boolean; message: string }> {
  if (!(await ensureRunning())) {
    return { ok: false, message: 'Ollama не запущена. Установи её и попробуй снова.' }
  }
  try {
    const res = await fetch(`${OLLAMA_URL}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: tag, stream: true })
    })
    if (!res.ok || !res.body) return { ok: false, message: `Не удалось начать загрузку (${res.status})` }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const m = JSON.parse(line) as { status?: string; total?: number; completed?: number; error?: string }
          if (m.error) return { ok: false, message: m.error }
          const pct = m.total && m.completed ? Math.round((m.completed / m.total) * 100) : 0
          onProgress(pct, m.status ?? 'загрузка…')
        } catch { /* неполная строка */ }
      }
    }
    logger.info('local-llm', `Модель загружена: ${tag}`)
    return { ok: true, message: `Модель ${tag} загружена и готова` }
  } catch (e) {
    return { ok: false, message: `Ошибка загрузки: ${(e as Error).message}` }
  }
}

/** Удалить модель. */
export async function deleteModel(tag: string): Promise<boolean> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: tag })
    })
    return r.ok
  } catch {
    return false
  }
}

/** Полный статус для UI и маршрутизации. */
export interface LocalStatus {
  installed: boolean
  running: boolean
  bundled: boolean
  models: string[]
  hardware: HardwareInfo
  recommended: string
}

export async function localStatus(): Promise<LocalStatus> {
  const bundled = hasBundled()
  const installed = await isInstalled()
  // при вшитой Ollama — сами поднимаем сервер, чтобы показать реальный статус
  if (bundled) await ensureRunning()
  const running = installed ? await isRunning() : false
  const models = running ? await installedModels() : []
  const hardware = await hardwareInfo()
  const recommended = (await recommendModel()).tag
  return { installed, running, bundled, models, hardware, recommended }
}

/** Готов ли офлайн-мозг к работе (запущен и есть хотя бы одна модель). */
export async function isReady(): Promise<boolean> {
  if (!(await ensureRunning())) return false
  return (await installedModels()).length > 0
}

const OLLAMA_DOWNLOAD = 'https://ollama.com/download'
export function downloadPageUrl(): string {
  return OLLAMA_DOWNLOAD
}
