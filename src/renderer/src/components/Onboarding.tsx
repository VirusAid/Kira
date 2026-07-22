/**
 * Onboarding — мастер знакомства при первом запуске. Kira узнаёт про
 * пользователя (имя, работа, вкусы, интересы) и раскладывает это в свою
 * долговременную память + профиль, чтобы использовать в каждом разговоре.
 */
import { useState, useEffect } from 'react'
import { ArrowRight, ArrowLeft, Sparkles, Check, Download, Loader2, WifiOff } from 'lucide-react'
import { KiraEmblem } from './KiraEmblem'
import { useAppStore } from '@/state/appStore'
import { kira } from '@/api'
import type { KiraSettings, MemoryCategory } from '@shared/types'

interface Field {
  key: string
  label: string
  placeholder: string
  memory?: { title: string; category: MemoryCategory }
  multiline?: boolean
}

const STEPS: { title: string; subtitle: string; fields: Field[]; ai?: boolean }[] = [
  {
    title: 'Давай познакомимся',
    subtitle: 'Как тебя зовут и как мне к тебе обращаться?',
    fields: [
      { key: 'name', label: 'Твоё имя', placeholder: 'Например, Вадим' }
    ]
  },
  {
    title: 'Как мне думать',
    subtitle: 'Я могу думать локально (приватно, офлайн) или через бесплатное облако. Выбери, что ближе — можно и то, и другое, и поменять позже.',
    ai: true,
    fields: [
      { key: 'groqKey', label: 'API-ключ Groq (для облака, необязательно)', placeholder: 'gsk_… — или пропусти' }
    ]
  },
  {
    title: 'Чем ты занимаешься',
    subtitle: 'Расскажи о работе — я буду это учитывать.',
    fields: [
      { key: 'work', label: 'Работа / профессия / компания', placeholder: 'Например: разработчик, фриланс, своя студия…', memory: { title: 'Работа', category: 'fact' }, multiline: true }
    ]
  },
  {
    title: 'Твои вкусы',
    subtitle: 'Что ты любишь слушать и смотреть?',
    fields: [
      { key: 'music', label: 'Музыка (жанры, исполнители)', placeholder: 'Например: рок, lo-fi, Radiohead…', memory: { title: 'Музыкальные вкусы', category: 'preference' } },
      { key: 'films', label: 'Фильмы и сериалы', placeholder: 'Например: сай-фай, Нолан, «Во все тяжкие»…', memory: { title: 'Фильмы и сериалы', category: 'preference' } }
    ]
  },
  {
    title: 'Немного о тебе',
    subtitle: 'Интересы, привычки, стиль общения — что мне стоит знать?',
    fields: [
      { key: 'interests', label: 'Интересы и хобби', placeholder: 'Например: спорт, игры, кофе, путешествия…', memory: { title: 'Интересы', category: 'preference' } },
      { key: 'about', label: 'Что-то ещё важное', placeholder: 'Например: как со мной общаться, привычки, цели…', memory: { title: 'О себе', category: 'note' }, multiline: true }
    ]
  }
]

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { settings, saveSettings } = useAppStore()
  const [step, setStep] = useState(-1) // -1 = приветствие
  const [data, setData] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  // офлайн-мозг: докачивается при первом запуске (движок + модель под железо)
  const [brain, setBrain] = useState<{ running: boolean; percent: number; status: string; done: boolean }>(
    { running: false, percent: 0, status: '', done: false }
  )

  useEffect(() => kira.local.onPullProgress((p) => setBrain((b) => ({ ...b, percent: p.percent, status: p.status }))), [])

  const setupBrain = async (): Promise<void> => {
    setBrain({ running: true, percent: 0, status: 'подготовка…', done: false })
    const r = await kira.local.setup()
    setBrain({ running: false, percent: 100, status: r.message, done: r.ok })
  }

  const isWelcome = step === -1
  const cur = STEPS[step]

  const finish = async (): Promise<void> => {
    if (!settings) return
    setSaving(true)
    // сохраняем факты в память Kira
    for (const s of STEPS) {
      for (const f of s.fields) {
        const val = (data[f.key] ?? '').trim()
        if (val && f.memory) {
          await kira.memory.save({ title: f.memory.title, content: val, category: f.memory.category, source: 'kira' })
        }
      }
    }
    // собираем профиль
    const profileParts = [
      data.name && `Имя: ${data.name}`,
      data.work && `Работа: ${data.work}`,
      data.music && `Музыка: ${data.music}`,
      data.films && `Фильмы/сериалы: ${data.films}`,
      data.interests && `Интересы: ${data.interests}`,
      data.about && `Ещё: ${data.about}`
    ].filter(Boolean).join('. ')

    const groqKey = (data.groqKey ?? '').trim()
    const next: KiraSettings = {
      ...settings,
      userName: (data.name || settings.userName).trim(),
      userProfile: profileParts,
      onboarded: true,
      // офлайн-мозг настроен → он основной; иначе если дали ключ Groq — облако
      // как основное (мгновенно работает), офлайн можно докачать позже в Настройках
      preferLocal: brain.done ? true : groqKey ? false : settings.preferLocal,
      // если пользователь вставил ключ Groq — сразу включаем его как провайдера
      ...(groqKey ? {
        provider: 'groq' as const,
        providers: { ...settings.providers, groq: { ...settings.providers.groq, apiKey: groqKey } }
      } : {})
    }
    await saveSettings(next)
    setSaving(false)
    onDone()
  }

  const skip = async (): Promise<void> => {
    if (!settings) return
    await saveSettings({ ...settings, onboarded: true })
    onDone()
  }

  return (
    <div style={styles.overlay}>
      <div className="panel pop-in" style={styles.modal}>
        {isWelcome ? (
          <div style={{ textAlign: 'center', padding: '10px 0 4px' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
              <KiraEmblem size={150} state="idle" />
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 750 }}>Привет, я Kira</h1>
            <p style={{ color: 'var(--text-1)', marginTop: 10, lineHeight: 1.6, maxWidth: 440, marginInline: 'auto' }}>
              Я твой личный ИИ-ассистент. Чтобы стать по-настоящему твоей, я хочу немного тебя узнать.
              Это займёт минуту, и я всё запомню.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 26 }}>
              <button className="btn btn-ghost press" onClick={() => void skip()}>Пропустить</button>
              <button className="btn btn-primary press" onClick={() => setStep(0)}>
                Познакомиться <ArrowRight size={15} />
              </button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
              <KiraEmblem size={56} state="idle" />
              <div>
                <div className="muted" style={{ fontSize: 11.5, letterSpacing: 1 }}>ШАГ {step + 1} ИЗ {STEPS.length}</div>
                <h2 style={{ fontSize: 20, fontWeight: 700 }}>{cur.title}</h2>
                <p className="muted" style={{ fontSize: 12.5 }}>{cur.subtitle}</p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {cur.ai && (
                <div style={{ background: 'var(--bg-3)', borderRadius: 10, padding: '14px', fontSize: 12.5, lineHeight: 1.55, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* Вариант 1 — локальный офлайн-мозг */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700, marginBottom: 4 }}>
                      <WifiOff size={15} style={{ color: 'var(--accent-text)' }} /> Локальный мозг (Qwen3) — приватно и офлайн
                    </div>
                    <span className="muted">Ничего не уходит в облако. Скачаю движок и модель под твоё железо (несколько ГБ, один раз) — дальше работаю без интернета.</span>
                    {brain.done ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#22c55e', marginTop: 8, fontWeight: 600 }}>
                        <Check size={15} /> Офлайн-мозг готов
                      </div>
                    ) : (
                      <div style={{ marginTop: 8 }}>
                        <button className="btn btn-primary press" disabled={brain.running} onClick={() => void setupBrain()}>
                          {brain.running ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Настроить офлайн-мозг
                        </button>
                        {brain.running && (
                          <div style={{ marginTop: 8 }}>
                            <div style={{ height: 5, borderRadius: 4, background: 'var(--bg-2)', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${brain.percent}%`, background: 'var(--accent)', transition: 'width 0.3s' }} />
                            </div>
                            <span className="muted" style={{ fontSize: 10.5 }}>{brain.status} {brain.percent}%</span>
                          </div>
                        )}
                        {!brain.running && brain.status && !brain.done && (
                          <span className="muted" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>{brain.status}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={{ height: 1, background: 'var(--border)' }} />
                  {/* Вариант 2 — облако (по желанию) */}
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>☁️ Облако (по желанию) — мгновенно, ключ за минуту</div>
                    <span className="muted">Не хочешь ждать загрузку? Добавь бесплатный ключ Groq: открой <button className="btn-link" style={{ color: 'var(--accent)', textDecoration: 'underline' }}
                      onClick={() => window.open('https://console.groq.com/keys')}>console.groq.com/keys</button> → Create API Key → вставь ниже. Можно и позже в Настройках.</span>
                  </div>
                </div>
              )}
              {cur.fields.map((f) => (
                <div key={f.key}>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>{f.label}</label>
                  {f.multiline ? (
                    <textarea rows={3} style={{ width: '100%' }} placeholder={f.placeholder}
                      value={data[f.key] ?? ''} onChange={(e) => setData((d) => ({ ...d, [f.key]: e.target.value }))} />
                  ) : (
                    <input style={{ width: '100%' }} placeholder={f.placeholder}
                      value={data[f.key] ?? ''} onChange={(e) => setData((d) => ({ ...d, [f.key]: e.target.value }))} />
                  )}
                </div>
              ))}
            </div>

            {/* прогресс */}
            <div style={{ display: 'flex', gap: 5, margin: '22px 0 18px' }}>
              {STEPS.map((_, i) => (
                <div key={i} style={{ flex: 1, height: 4, borderRadius: 4, background: i <= step ? 'var(--accent)' : 'var(--bg-3)', transition: 'background 0.3s' }} />
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button className="btn btn-ghost press" onClick={() => setStep((s) => s - 1)}>
                <ArrowLeft size={14} /> {step === 0 ? 'Назад' : 'Назад'}
              </button>
              {step < STEPS.length - 1 ? (
                <button className="btn btn-primary press" onClick={() => setStep((s) => s + 1)}>
                  Дальше <ArrowRight size={15} />
                </button>
              ) : (
                <button className="btn btn-primary press" onClick={() => void finish()} disabled={saving}>
                  {saving ? <Sparkles size={15} /> : <Check size={15} />} Готово, запомни меня
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 300,
    background: 'radial-gradient(1000px 700px at 50% 30%, rgba(24,18,48,0.9), rgba(6,6,14,0.97))',
    backdropFilter: 'blur(20px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    animation: 'fadeIn 0.2s ease'
  },
  modal: { width: 540, maxWidth: '92vw', padding: 28 }
}
