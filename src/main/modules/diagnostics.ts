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

/**
 * Проверка, которую не удалось выполнить.
 *
 * Раньше здесь стоял молчаливый catch, и упавшая проверка просто исчезала из
 * отчёта. Человек спрашивал «почему не работает голос?» — и не видел про голос
 * вообще НИЧЕГО, будто такой подсистемы нет. Молчание хуже плохой новости:
 * плохую новость хотя бы видно.
 */
function checkFailed(name: string, e: unknown): DiagCheck {
  return {
    name,
    ok: false,
    detail: `проверить не удалось: ${(e as Error)?.message ?? String(e)}`.slice(0, 200),
    fix: 'Загляни в журнал — модуль не отвечает'
  }
}

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
      ['--version'], { timeout: 6000, windowsHide: true }, (err) => resolve(!err))
  })
}

/** Тема запроса → какие проверки показывать (или все). */
type Topic = 'voice' | 'local' | 'memory' | 'ai' | 'disk' | 'integrations' | 'all'
function topicFromText(text?: string): Topic {
  const s = (text ?? '').toLowerCase()
  if (/голос|озвуч|говор|микрофон|распозна|слыш|слово|актив/.test(s)) return 'voice'
  if (/офлайн|локальн|ollama|оллама|мозг/.test(s)) return 'local'
  if (/памят|семант|эмбед|документ|rag|база знан|выучи|обучен|научил|формулировк/.test(s)) return 'memory'
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
    } catch (e) { checks.push(checkFailed('Офлайн-мозг (Ollama)', e)) }
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
    } catch (e) { checks.push(checkFailed('Голос Silero (озвучка)', e)) }
    try {
      const { wakeWord } = await import('./ai/wakeword')
      const ok = await wakeWord.isAvailable()
      checks.push({ name: 'Слово-активатор «Кира» (Vosk)', ok, detail: ok ? 'готов' : 'не установлен', fix: ok ? undefined : 'Настройки → Поведение → установить слово-активатор' })
    } catch (e) { checks.push(checkFailed('Слово-активатор «Кира» (Vosk)', e)) }
    {
      const hasGroq = !!s.providers.groq.apiKey?.trim()
      let hasOfflineStt = false
      try {
        const { voskStt } = await import('./ai/voskStt')
        hasOfflineStt = voskStt.available()
      } catch { /* офлайн-распознавание не установлено — ниже честно скажем, что его нет */ }
      checks.push({
        name: 'Голосовой ввод (распознавание речи)',
        ok: hasOfflineStt || hasGroq,
        detail: hasOfflineStt
          ? (hasGroq ? 'офлайн (Vosk) + Whisper через Groq' : 'офлайн (Vosk), без интернета')
          : hasGroq ? 'Whisper через Groq' : 'недоступно',
        fix: hasOfflineStt || hasGroq ? undefined : 'Переустанови Kira (офлайн-модель Vosk) или добавь ключ Groq (Настройки → Модели ИИ)'
      })
    }
    // Зрение: видит ли Kira картинки, или читает экран только текстом (OCR)
    try {
      const { visionAvailable } = await import('./ai/client')
      const canSee = visionAvailable()
      checks.push({
        name: 'Зрение (описание экрана/картинок)',
        ok: true,
        detail: canSee
          ? 'полноценное зрение (облачная или локальная vision-модель)'
          : 'офлайн: читаю ТЕКСТ экрана (OCR). Картинки не описываю — нужен облачный ИИ или локальная vision-модель',
        fix: canSee ? undefined : 'Для описания изображений: ключ Gemini (Настройки → Модели) или скачай vision-модель в Ollama (напр. qwen2.5-vl)'
      })
    } catch (e) { checks.push(checkFailed('Зрение (снимок экрана)', e)) }
  }

  // ─── Семантика / память / документы ───
  if (want('memory')) {
    try {
      const { semantic } = await import('./ai/semantic')
      const ok = await semantic.isAvailable()
      checks.push({ name: 'Семантическая память и поиск по документам', ok, detail: ok ? 'готова (fastembed)' : 'не установлена', fix: ok ? undefined : 'Настройки → установить движок эмбеддингов (fastembed)' })
    } catch (e) { checks.push(checkFailed('Семантическая память и поиск по документам', e)) }

    // Личное обучение: всё выученное лежит в профиле ЭТОГО пользователя
    // Windows и ни с кем не делится. Показываем это прямо, чтобы вопрос «а моё
    // ли это» не оставался на веру.
    try {
      const { listLearned } = await import('../core/learning')
      const all = listLearned()
      const active = all.filter((p) => p.active && !p.rejected).length
      const waiting = all.filter((p) => !p.active && !p.rejected).length
      checks.push({
        name: 'Личное обучение (твои формулировки)',
        ok: true,
        detail: all.length
          ? `в работе ${active}, ждут повтора ${waiting}. Хранится только в твоём профиле: ${app.getPath('userData')}`
          : `пока ничего не выучила — учусь по ходу дела. Хранится только в твоём профиле: ${app.getPath('userData')}`
      })
    } catch (e) { checks.push(checkFailed('Личное обучение (твои формулировки)', e)) }
  }

  // ─── Диск ───
  if (want('disk')) {
    try {
      const st = await fsp.statfs(app.getPath('home'))
      const freeGB = (st.bavail * st.bsize) / 1024 ** 3
      const ok = freeGB > 3
      checks.push({ name: 'Свободное место на диске', ok, detail: `${freeGB.toFixed(1)} ГБ свободно`, fix: ok ? undefined : 'Мало места — почисти загрузки/корзину или скажи «почисти временные файлы»' })
    } catch (e) { checks.push(checkFailed('Свободное место на диске', e)) }
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

  // Если спрашивают именно «почему не сработало/не поняла» — показываем, как
  // ядро приняло последние решения. Раньше на такой вопрос ответить было нечем.
  const t = (topicText ?? '').toLowerCase()
  if (/не\s*(сработал|поняла|понял|распозна|выполнил)|почему.*(не|плохо)|мимо/.test(t)) {
    try {
      const { recentDecisions } = await import('../core/engine')
      const recent = recentDecisions(6)
      if (recent.length) {
        lines.push('', 'Как я разбирала последние запросы:')
        for (const d of recent) {
          const sem = d.semantic
            ? ` (по смыслу ближе всего «${d.semantic.actionId}», уверенность ${d.semantic.score.toFixed(2)} при нужных ${d.semantic.threshold})`
            : ''
          lines.push(`• «${d.text.slice(0, 45)}» → ${d.route}${sem} — ${d.why}`)
        }
      }
    } catch { /* трассировка не критична для отчёта */ }
  }

  return { ok: true, message: summary, content: lines.join('\n') }
}
