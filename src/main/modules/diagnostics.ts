/**
 * Diagnostics — самодиагностика Kira. «Кира, почему не работает голос?» →
 * проверяет подсистемы (Python, Silero, Vosk, семантика, офлайн-мозг, провайдер
 * ИИ, диск, интеграции) и честно говорит, что не так и как починить.
 */
import { app } from 'electron'
import { promises as fsp } from 'fs'
import { execFile } from 'child_process'
import { getSettings } from './settings'
import type { ActionResult } from '../../shared/types'

export interface DiagCheck {
  name: string
  ok: boolean
  detail: string
  fix?: string
}

function pythonOk(): Promise<boolean> {
  return new Promise((resolve) => {
    const local = require('path').join(app.getPath('userData'), '..', 'python', 'python.exe')
    execFile(require('fs').existsSync(local) ? local : (process.platform === 'win32' ? 'python' : 'python3'),
      ['--version'], { timeout: 6000 }, (err) => resolve(!err))
  })
}

/** Тема запроса → какие проверки показывать (или все). */
type Topic = 'voice' | 'local' | 'memory' | 'ai' | 'disk' | 'integrations' | 'all'
function topicFromText(text?: string): Topic {
  const s = (text ?? '').toLowerCase()
  if (/голос|озвуч|говор|микрофон|распозна|слыш|слово|актив/.test(s)) return 'voice'
  if (/офлайн|локальн|ollama|оллама|мозг/.test(s)) return 'local'
  if (/памят|семант|эмбед|документ|rag|база знан/.test(s)) return 'memory'
  if (/интернет|провайдер|модел|ключ|облак|ии|ai/.test(s)) return 'ai'
  if (/диск|мест|память на диске/.test(s)) return 'disk'
  if (/интеграц|google|gmail|obsidian|notion|discord|telegram/.test(s)) return 'integrations'
  return 'all'
}

export async function diagnose(topicText?: string): Promise<{ checks: DiagCheck[]; summary: string }> {
  const topic = topicFromText(topicText)
  const want = (t: Topic): boolean => topic === 'all' || topic === t
  const checks: DiagCheck[] = []
  const s = getSettings()

  // ─── ИИ-провайдер / мозг ───
  if (want('ai') || want('local')) {
    const hasKey = Object.values(s.providers).some((p) => (p.apiKey ?? '').trim())
    let localReady = false
    try {
      const { localStatus } = await import('./ai/localLlm')
      const st = await localStatus()
      localReady = st.running && st.models.length > 0
      if (want('local')) {
        checks.push({
          name: 'Офлайн-мозг (Ollama)',
          ok: localReady,
          detail: st.installed ? (st.running ? `запущена, моделей: ${st.models.length}` : 'установлена, но не запущена') : 'не установлена',
          fix: localReady ? undefined : (!st.installed ? 'Установи Ollama и скачай модель в Настройки → Модели ИИ → Офлайн-мозг' : 'Скачай модель (кнопка «Скачать» в карточке офлайн-мозга)')
        })
      }
    } catch { /* модуль недоступен */ }
    checks.push({
      name: 'Мозг Kira (ИИ)',
      ok: hasKey || localReady || s.provider === 'ollama',
      detail: hasKey ? `провайдер: ${s.provider}` : (localReady ? 'локальный (офлайн)' : 'не настроен'),
      fix: (hasKey || localReady) ? undefined : 'Добавь бесплатный ключ (Настройки → Модели ИИ → Groq) или включи офлайн-мозг'
    })
  }

  // ─── Python (нужен для голоса/памяти) ───
  let py = true
  if (want('voice') || want('memory')) {
    py = await pythonOk()
    checks.push({
      name: 'Python (для локальных подсистем)',
      ok: py,
      detail: py ? 'найден' : 'не найден в системе',
      fix: py ? undefined : 'Установи Python 3 с python.org (галочка «Add to PATH»). В сборке-инсталляторе Python встроен.'
    })
  }

  // ─── Голос ───
  if (want('voice')) {
    try {
      const { silero } = await import('./ai/silero')
      const ok = await silero.isAvailable()
      checks.push({ name: 'Голос Silero (озвучка)', ok, detail: ok ? 'готов' : 'не установлен', fix: ok ? undefined : 'Настройки → Голос → «Установить локальный голос» (или используется Edge/системный)' })
    } catch { /* ignore */ }
    try {
      const { wakeWord } = await import('./ai/wakeword')
      const ok = await wakeWord.isAvailable()
      checks.push({ name: 'Слово-активатор «Кира» (Vosk)', ok, detail: ok ? 'готов' : 'не установлен', fix: ok ? undefined : 'Настройки → Поведение → установить слово-активатор' })
    } catch { /* ignore */ }
    checks.push({
      name: 'Голосовой ввод (распознавание речи)',
      ok: !!s.providers.groq.apiKey?.trim(),
      detail: s.providers.groq.apiKey?.trim() ? 'Whisper через Groq' : 'нужен ключ Groq (бесплатный Whisper)',
      fix: s.providers.groq.apiKey?.trim() ? undefined : 'Добавь ключ Groq (Настройки → Модели ИИ) — он даёт бесплатное распознавание речи'
    })
  }

  // ─── Семантика / память / документы ───
  if (want('memory')) {
    try {
      const { semantic } = await import('./ai/semantic')
      const ok = await semantic.isAvailable()
      checks.push({ name: 'Семантическая память и поиск по документам', ok, detail: ok ? 'готова (fastembed)' : 'не установлена', fix: ok ? undefined : 'Настройки → установить движок эмбеддингов (fastembed)' })
    } catch { /* ignore */ }
  }

  // ─── Диск ───
  if (want('disk')) {
    try {
      const st = await fsp.statfs(app.getPath('home'))
      const freeGB = (st.bavail * st.bsize) / 1024 ** 3
      const ok = freeGB > 3
      checks.push({ name: 'Свободное место на диске', ok, detail: `${freeGB.toFixed(1)} ГБ свободно`, fix: ok ? undefined : 'Мало места — почисти загрузки/корзину или скажи «почисти временные файлы»' })
    } catch { /* ignore */ }
  }

  // ─── Интеграции ───
  if (want('integrations')) {
    checks.push({ name: 'Google (Календарь/Gmail)', ok: !!s.googleRefreshToken, detail: s.googleRefreshToken ? 'подключён' : 'не подключён', fix: s.googleRefreshToken ? undefined : 'Интеграции → Google → подключить' })
    checks.push({ name: 'Obsidian (заметки)', ok: !!s.obsidianVault, detail: s.obsidianVault ? 'папка выбрана' : 'не подключён', fix: s.obsidianVault ? undefined : 'Интеграции → Obsidian → выбрать папку' })
    checks.push({ name: 'База знаний по документам', ok: !!s.knowledgeFolder, detail: s.knowledgeFolder ? 'папка выбрана' : 'не настроена', fix: s.knowledgeFolder ? undefined : 'Интеграции → База знаний → выбрать папку и проиндексировать' })
  }

  const problems = checks.filter((c) => !c.ok)
  const n = problems.length
  const mod10 = n % 10, mod100 = n % 100
  const word = mod10 === 1 && mod100 !== 11 ? 'проблему'
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20) ? 'проблемы' : 'проблем'
  const summary = n === 0
    ? 'Всё в порядке — все проверенные системы работают.'
    : `Нашла ${n} ${word}: ${problems.map((p) => p.name).join(', ')}.`
  return { checks, summary }
}

/** Отчёт для команды/озвучки. */
export async function diagnoseReport(topicText?: string): Promise<ActionResult> {
  const { checks, summary } = await diagnose(topicText)
  const lines = checks.map((c) => `${c.ok ? '✅' : '⚠️'} ${c.name}: ${c.detail}${!c.ok && c.fix ? `\n   → ${c.fix}` : ''}`)
  return { ok: true, message: summary, data: lines.join('\n') }
}
