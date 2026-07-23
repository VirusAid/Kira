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
import { spawn, execFile, execFileSync } from 'child_process'
import { existsSync, mkdirSync, createWriteStream, rmSync } from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { Readable, Transform } from 'stream'
import os from 'os'
import { logger } from '../logger'

const OLLAMA_URL = 'http://localhost:11434'

// Переносная сборка Ollama для Windows (движок + GPU-библиотеки). Скачивается
// один раз при первом запуске в записываемую папку данных пользователя —
// установщик остаётся лёгким (~450 МБ), а «мозг» докачивается по требованию.
const OLLAMA_ZIP_URL =
  'https://github.com/ollama/ollama/releases/latest/download/ollama-windows-amd64.zip'

// ─── Расположение движка и моделей ───────────────────────────────────────────
// Переносная Ollama и модели живут в userData (запись разрешена, в отличие от
// Program Files). Если установщик когда-то и вшил движок в resources — поддержим
// и это как «bundled»-fallback, но модели всегда пишем в userData.

function userDataDir(): string {
  return app.getPath('userData')
}
/** Записываемая папка с переносной Ollama (докачивается при первом запуске). */
function portableDir(): string {
  return join(userDataDir(), 'ollama')
}
function portableExe(): string {
  return join(portableDir(), 'ollama.exe')
}
function hasPortable(): boolean {
  return existsSync(portableExe())
}
/** Записываемая папка с моделями (blobs) — сюда Ollama качает qwen3. */
function modelsDir(): string {
  return join(userDataDir(), 'ollama-models')
}

function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources')
}
/** Legacy: путь к вшитой в установщик ollama.exe (если вдруг поставлялась). */
function bundledExe(): string {
  return join(resourcesDir(), 'ollama', 'ollama.exe')
}
export function hasBundled(): boolean {
  return existsSync(bundledExe())
}

/** Наш управляемый движок (переносной в userData → legacy-вшитый), либо null. */
function managedExe(): string | null {
  if (hasPortable()) return portableExe()
  if (hasBundled()) return bundledExe()
  return null
}
/** Движок под нашим контролем — сами задаём папку моделей (userData). */
function managedEnv(): NodeJS.ProcessEnv {
  return { ...process.env, OLLAMA_MODELS: modelsDir(), OLLAMA_HOST: '127.0.0.1:11434' }
}

export interface LocalModel {
  tag: string
  label: string
  sizeGb: number
  note: string
  minVramGb: number
  /** умеет «видеть» картинки/экран (vision-модель) */
  vision?: boolean
}

/** Курируемый список — Qwen3 отлично знает русский, силён в коде и рассуждениях. */
export const RECOMMENDED_MODELS: LocalModel[] = [
  { tag: 'qwen3:14b', label: 'Максимум (Qwen3 14B)', sizeGb: 9.3, note: 'Самый умный. Нужно ≥10 ГБ VRAM или выгрузка в ОЗУ (медленнее).', minVramGb: 10 },
  { tag: 'qwen3:8b', label: 'Сбалансированный (Qwen3 8B)', sizeGb: 5.2, note: 'Лучший баланс качества и скорости. Рекомендуется для 6+ ГБ VRAM.', minVramGb: 6 },
  { tag: 'qwen3:4b', label: 'Быстрый (Qwen3 4B)', sizeGb: 2.5, note: 'Шустрый, контекст 256K. Хорош для 4 ГБ VRAM и слабых ПК.', minVramGb: 4 },
  { tag: 'qwen3:1.7b', label: 'Лёгкий (Qwen3 1.7B)', sizeGb: 1.4, note: 'Для очень слабого железа / только CPU.', minVramGb: 0 },
  // Vision-модели: «видят» экран и картинки офлайн. Умеют и текст, и зрение —
  // можно сделать основным «мозгом». Не выбираются автоподбором (recommendModel):
  // это осознанный выбор ради офлайн-зрения.
  { tag: 'qwen2.5-vl:7b', label: 'Зрение (Qwen2.5-VL 7B)', sizeGb: 6.0, note: '👁 Видит экран и картинки офлайн + хороший текст. Нужно 6+ ГБ VRAM.', minVramGb: 6, vision: true },
  { tag: 'qwen2.5-vl:3b', label: 'Зрение лёгкое (Qwen2.5-VL 3B)', sizeGb: 3.2, note: '👁 Видит экран офлайн, для 4 ГБ VRAM и слабых ПК.', minVramGb: 4, vision: true }
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

/** Ollama доступна (переносная в userData, вшитая ИЛИ установлена в системе)? */
export function isInstalled(): Promise<boolean> {
  if (managedExe()) return Promise.resolve(true)
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

/** Запустить сервер Ollama (наш переносной — приоритетно, иначе системный). */
export async function ensureRunning(): Promise<boolean> {
  if (await isRunning()) return true
  const managed = managedExe()
  if (!managed && !(await isInstalled())) return false
  try {
    if (managed) mkdirSync(modelsDir(), { recursive: true })
    const exe = managed ?? 'ollama'
    const proc = spawn(exe, ['serve'], {
      detached: true, stdio: 'ignore', windowsHide: true,
      env: managed ? managedEnv() : process.env
    })
    proc.unref()
  } catch {
    return false
  }
  // ждём поднятия сервера до 10 сек
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (await isRunning()) { logger.info('local-llm', `Ollama сервер запущен${managed ? ' (переносная)' : ''}`); return true }
  }
  return false
}

/**
 * Скачать переносную Ollama в userData (движок + GPU-библиотеки, ~несколько
 * сот МБ). Прогресс 0..100 по объёму загрузки. Вызывается при первом запуске,
 * если движок ещё не установлен и не вшит.
 */
export async function downloadOllama(
  onProgress: (percent: number, status: string) => void
): Promise<{ ok: boolean; message: string }> {
  if (managedExe()) return { ok: true, message: 'Движок уже на месте' }
  // системная Ollama на PATH — качать не нужно
  if (await isInstalled()) return { ok: true, message: 'Ollama уже установлена в системе' }

  const dir = portableDir()
  const zip = join(userDataDir(), 'ollama-win.zip')
  try {
    mkdirSync(dir, { recursive: true })
    onProgress(0, 'Скачиваю движок Ollama…')
    const r = await fetch(OLLAMA_ZIP_URL)
    if (!r.ok || !r.body) return { ok: false, message: `Не удалось скачать движок (${r.status})` }
    const total = Number(r.headers.get('content-length') ?? 0)
    let got = 0
    // считаем байты в проходном потоке — backpressure соблюдается через pipeline
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        got += chunk.length
        if (total) onProgress(Math.round((got / total) * 100), 'Скачиваю движок Ollama…')
        cb(null, chunk)
      }
    })
    await pipeline(Readable.fromWeb(r.body as Parameters<typeof Readable.fromWeb>[0]), counter, createWriteStream(zip))

    onProgress(100, 'Распаковываю движок…')
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -Force '${zip}' '${dir}'`], { stdio: 'ignore' })
    try { rmSync(zip, { force: true }) } catch { /* временный файл */ }
    if (!hasPortable()) return { ok: false, message: 'ollama.exe не найден после распаковки' }
    logger.info('local-llm', 'Переносная Ollama установлена в userData')
    return { ok: true, message: 'Движок Ollama установлен' }
  } catch (e) {
    try { rmSync(zip, { force: true }) } catch { /* недокачанный архив */ }
    return { ok: false, message: `Ошибка установки движка: ${(e as Error).message}` }
  }
}

/**
 * Настроить офлайн-мозг «за один клик»: докачать движок (если нужно) и модель
 * под железо (или заданную), с общим прогрессом 0..100. Первые ~15% — движок,
 * остальное — модель (она в разы больше). Idempotent: если всё уже есть — ок.
 */
export async function setupBrain(
  onProgress: (percent: number, status: string) => void,
  tag?: string
): Promise<{ ok: boolean; message: string; tag: string }> {
  const model = tag ?? (await recommendModel()).tag
  // 1. движок (0..15%)
  if (!managedExe() && !(await isInstalled())) {
    const dl = await downloadOllama((p, s) => onProgress(Math.round(p * 0.15), s))
    if (!dl.ok) return { ok: false, message: dl.message, tag: model }
  }
  if (!(await ensureRunning())) {
    return { ok: false, message: 'Не удалось запустить движок Ollama', tag: model }
  }
  // 2. модель (15..100%) — если уже есть, не качаем повторно
  const have = await installedModels()
  // ТОЧНОЕ совпадение тега: иначе наличие любой qwen3:* (напр. 4b) ошибочно
  // считало бы скачанной рекомендованную qwen3:8b → делали её активной, а её нет
  // → инференс падал 404. Ollama хранит теги как есть ('qwen3:8b'), плюс ':latest'.
  if (have.includes(model) || have.includes(model.includes(':') ? model : `${model}:latest`)) {
    onProgress(100, 'Модель уже загружена')
    return { ok: true, message: `Офлайн-мозг готов: ${model}`, tag: model }
  }
  const pull = await pullModel(model, (p, s) => onProgress(15 + Math.round(p * 0.85), s))
  if (!pull.ok) return { ok: false, message: pull.message, tag: model }
  return { ok: true, message: `Офлайн-мозг готов: ${model}`, tag: model }
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
  /** движок под нашим контролем (переносной в userData) — поднимаем сами */
  managed: boolean
  models: string[]
  hardware: HardwareInfo
  recommended: string
}

export async function localStatus(): Promise<LocalStatus> {
  const managed = managedExe() !== null
  const installed = await isInstalled()
  // при нашем движке — сами поднимаем сервер, чтобы показать реальный статус
  if (managed) await ensureRunning()
  const running = installed ? await isRunning() : false
  const models = running ? await installedModels() : []
  const hardware = await hardwareInfo()
  const recommended = (await recommendModel()).tag
  return { installed, running, managed, models, hardware, recommended }
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
