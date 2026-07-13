/**
 * Onboarding — мастер знакомства при первом запуске. Kira узнаёт про
 * пользователя (имя, работа, вкусы, интересы) и раскладывает это в свою
 * долговременную память + профиль, чтобы использовать в каждом разговоре.
 */
import { useState } from 'react'
import { ArrowRight, ArrowLeft, Sparkles, Check } from 'lucide-react'
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

const STEPS: { title: string; subtitle: string; fields: Field[] }[] = [
  {
    title: 'Давай познакомимся',
    subtitle: 'Как тебя зовут и как мне к тебе обращаться?',
    fields: [
      { key: 'name', label: 'Твоё имя', placeholder: 'Например, Вадим' }
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

    const next: KiraSettings = {
      ...settings,
      userName: (data.name || settings.userName).trim(),
      userProfile: profileParts,
      onboarded: true
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
