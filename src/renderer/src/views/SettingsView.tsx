/** Настройки: модели ИИ, личность, голос, интерфейс, поведение, экспорт. */
import { useEffect, useState, useRef } from 'react'
import {
  Cpu, User, Mic, Palette, Sliders, Download, Upload, Check, Loader2,
  ExternalLink, KeyRound, Zap, RefreshCw, ChevronDown
} from 'lucide-react'
import { useAppStore } from '@/state/appStore'
import { kira } from '@/api'
import type { AIProviderId, KiraSettings } from '@shared/types'
import { PERSONALITY_PRESETS, detectPreset, type PersonalityPreset } from '@shared/personalityPresets'

type Section = 'models' | 'personality' | 'voice' | 'interface' | 'behavior' | 'data'

const SECTIONS: { id: Section; label: string; icon: typeof Cpu }[] = [
  { id: 'models', label: 'Модели ИИ', icon: Cpu },
  { id: 'personality', label: 'Личность', icon: User },
  { id: 'voice', label: 'Голос', icon: Mic },
  { id: 'interface', label: 'Интерфейс', icon: Palette },
  { id: 'behavior', label: 'Поведение', icon: Sliders },
  { id: 'data', label: 'Данные', icon: Download }
]

const PROVIDERS: {
  id: AIProviderId; name: string; free: string; url: string; needsKey: boolean
  models: string[]; note: string
}[] = [
  {
    id: 'groq', name: 'Groq', free: 'Бесплатно · очень быстро', url: 'https://console.groq.com/keys',
    needsKey: true,
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b', 'qwen/qwen3-32b', 'deepseek-r1-distill-llama-70b'],
    note: 'Рекомендуется. Бесплатный ключ за минуту. Также включает распознавание речи Whisper для голосового режима.'
  },
  {
    id: 'openrouter', name: 'OpenRouter', free: 'Есть бесплатные модели (:free)', url: 'https://openrouter.ai/keys',
    needsKey: true,
    models: ['meta-llama/llama-3.3-70b-instruct:free', 'deepseek/deepseek-r1:free', 'google/gemini-2.0-flash-exp:free', 'qwen/qwen-2.5-72b-instruct:free'],
    note: 'Десятки моделей. Модели с суффиксом :free — бесплатные.'
  },
  {
    id: 'gemini', name: 'Google Gemini', free: 'Бесплатный tier', url: 'https://aistudio.google.com/apikey',
    needsKey: true,
    models: ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'],
    note: 'Щедрый бесплатный лимит. Хорошо работает с изображениями (зрение Kira).'
  },
  {
    id: 'deepseek', name: 'DeepSeek', free: 'Платно · нужен баланс', url: 'https://platform.deepseek.com/api_keys',
    needsKey: true,
    models: ['deepseek-chat', 'deepseek-reasoner'],
    note: 'Официальный DeepSeek — ПЛАТНЫЙ API (пополни баланс на platform.deepseek.com, ошибка 402 = нулевой баланс). deepseek-chat (V3) и deepseek-reasoner (R1). Бесплатно те же модели: OpenRouter → deepseek/deepseek-r1:free, либо Groq → deepseek-r1-distill-llama-70b.'
  },
  {
    id: 'claude', name: 'Claude (Anthropic)', free: 'Платно · топ-качество', url: 'https://platform.claude.com/settings/keys',
    needsKey: true,
    models: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
    note: 'Модели Anthropic — лучшее качество рассуждений, кода и зрения. ПЛАТНЫЙ API: ключ и баланс на platform.claude.com. claude-opus-4-8 — самый умный, claude-haiku-4-5 — быстрый и дешёвый.'
  },
  {
    id: 'glm', name: 'GLM (Z.ai)', free: 'Недорого · сильные модели', url: 'https://z.ai/manage-apikey/apikey-list',
    needsKey: true,
    models: ['glm-5.2', 'glm-5', 'glm-5-turbo', 'glm-4.7-flash', 'glm-4.6'],
    note: 'GLM от Zhipu (Z.ai) — сильные и недорогие модели, отличны в коде и агентных задачах. glm-5.2 — флагман (контекст 1M), glm-5-turbo — быстрый, glm-4.7-flash — лёгкий (есть бесплатный доступ). Ключ на z.ai.'
  },
  {
    id: 'ollama', name: 'Ollama', free: 'Локально · полностью бесплатно', url: 'https://ollama.com/download',
    needsKey: false,
    models: ['llama3.1', 'llama3.2', 'qwen2.5', 'gemma2', 'mistral', 'phi4'],
    note: 'Работает офлайн на твоём ПК. Установи Ollama и выполни: ollama pull llama3.1'
  }
]

export function SettingsView() {
  const { settings, saveSettings } = useAppStore()
  const [section, setSection] = useState<Section>('models')

  if (!settings) return null

  const update = (partial: Partial<KiraSettings>): void => {
    void saveSettings({ ...settings, ...partial })
  }

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <div style={{
        width: 210, flexShrink: 0, borderRight: '1px solid var(--border)',
        padding: 14, display: 'flex', flexDirection: 'column', gap: 3,
        background: 'rgba(12,12,22,0.35)'
      }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, padding: '4px 10px 12px' }}>Настройки</h2>
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button key={id} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
            borderRadius: 9, fontSize: 13.5, textAlign: 'left',
            background: section === id ? 'var(--accent-soft)' : 'transparent',
            color: section === id ? 'var(--accent-text)' : 'var(--text-1)'
          }} onClick={() => setSection(id)}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      <div className="view-container" style={{ flex: 1 }}>
        {section === 'models' && <ModelsSection settings={settings} update={update} />}
        {section === 'personality' && <PersonalitySection settings={settings} update={update} />}
        {section === 'voice' && <VoiceSection settings={settings} update={update} />}
        {section === 'interface' && <InterfaceSection settings={settings} update={update} />}
        {section === 'behavior' && <BehaviorSection settings={settings} update={update} />}
        {section === 'data' && <DataSection />}
      </div>
    </div>
  )
}

interface SectionProps {
  settings: KiraSettings
  update: (partial: Partial<KiraSettings>) => void
}

function ModelsSection({ settings, update }: SectionProps) {
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [liveModels, setLiveModels] = useState<Record<string, string[]>>({})
  const [loadingModels, setLoadingModels] = useState('')

  const fetchModels = async (id: AIProviderId): Promise<void> => {
    setLoadingModels(id)
    const list = await kira.ai.listModels(id)
    if (list.length) setLiveModels((m) => ({ ...m, [id]: list }))
    setLoadingModels('')
  }
  // при выборе провайдера подгружаем его полный список моделей
  useEffect(() => { if (settings.provider) void fetchModels(settings.provider) }, [settings.provider])

  const setProvider = (id: AIProviderId): void => update({ provider: id })
  const setProviderCfg = (id: AIProviderId, cfg: Partial<KiraSettings['providers'][AIProviderId]>): void => {
    update({ providers: { ...settings.providers, [id]: { ...settings.providers[id], ...cfg } } })
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    setTestResult(await kira.ai.testProvider())
    setTesting(false)
  }

  return (
    <div>
      <SectionTitle icon={<Cpu size={19} />} title="Модели ИИ" subtitle="Выбери провайдера. Все варианты имеют бесплатный доступ." />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {PROVIDERS.map((p) => {
          const active = settings.provider === p.id
          const cfg = settings.providers[p.id]
          return (
            <div key={p.id} className="card" style={{
              borderColor: active ? 'var(--border-strong)' : 'var(--border)',
              boxShadow: active ? '0 0 20px rgba(139,92,246,0.12)' : 'none'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  onClick={() => setProvider(p.id)}
                  style={{
                    width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                    border: `2px solid ${active ? 'var(--accent)' : 'var(--text-2)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                  {active && <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)' }} />}
                </button>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</span>
                    <span className="badge" style={{ fontSize: 10, background: 'rgba(52,211,153,0.13)', color: 'var(--ok)', borderColor: 'rgba(52,211,153,0.25)' }}>
                      <Zap size={9} /> {p.free}
                    </span>
                  </div>
                  <p className="muted" style={{ marginTop: 3, fontSize: 12 }}>{p.note}</p>
                </div>
                <a className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }} href={p.url} target="_blank" rel="noreferrer">
                  {p.needsKey ? <KeyRound size={13} /> : <ExternalLink size={13} />}
                  {p.needsKey ? 'Получить ключ' : 'Скачать'}
                </a>
              </div>

              {active && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }} className="anim-in">
                  {p.needsKey && (
                    <div>
                      <label className="muted" style={{ display: 'block', marginBottom: 5 }}>API-ключ</label>
                      <input type="password" style={{ width: '100%' }} placeholder="Вставь ключ сюда"
                        value={cfg.apiKey ?? ''} onChange={(e) => setProviderCfg(p.id, { apiKey: e.target.value })} />
                    </div>
                  )}
                  {p.id === 'ollama' && (
                    <div>
                      <label className="muted" style={{ display: 'block', marginBottom: 5 }}>Адрес сервера</label>
                      <input style={{ width: '100%' }} placeholder="http://localhost:11434"
                        value={cfg.baseUrl ?? ''} onChange={(e) => setProviderCfg(p.id, { baseUrl: e.target.value })} />
                    </div>
                  )}
                  <div>
                    <label className="muted" style={{ display: 'block', marginBottom: 5 }}>Модель</label>
                    <ModelPicker
                      value={cfg.model}
                      models={liveModels[p.id]?.length ? liveModels[p.id] : p.models}
                      loading={loadingModels === p.id}
                      onChange={(v) => setProviderCfg(p.id, { model: v })}
                      onRefresh={() => void fetchModels(p.id)}
                    />
                    <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                      {liveModels[p.id]?.length
                        ? `Доступно моделей: ${liveModels[p.id].length} — открой список или печатай для поиска`
                        : loadingModels === p.id ? 'Загружаю список моделей…' : 'Нажми ↻ чтобы подгрузить все модели провайдера'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button className="btn btn-primary" style={{ padding: '8px 16px' }} onClick={() => void test()} disabled={testing}>
                      {testing ? <Loader2 size={14} className="spin" style={{ animation: 'spin 0.8s linear infinite' }} /> : <Check size={14} />}
                      Проверить соединение
                    </button>
                    {testResult && (
                      <span style={{ fontSize: 12.5, color: testResult.ok ? 'var(--ok)' : 'var(--err)' }}>
                        {testResult.message}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ModelPicker({ value, models, loading, onChange, onRefresh }: {
  value: string
  models: string[]
  loading: boolean
  onChange: (v: string) => void
  onRefresh: () => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent): void => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const filtered = q.trim()
    ? models.filter((m) => m.toLowerCase().includes(q.toLowerCase()))
    : models
  const pick = (m: string): void => { onChange(m); setOpen(false); setQ('') }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            style={{ width: '100%', paddingRight: 30 }}
            placeholder="Выбери или впиши модель…"
            value={open ? q : value}
            onFocus={() => { setOpen(true); setQ('') }}
            onChange={(e) => { setQ(e.target.value); setOpen(true) }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && q.trim()) { pick(q.trim()) }
              if (e.key === 'Escape') setOpen(false)
            }}
          />
          <button onClick={() => setOpen((o) => !o)} title="Открыть список"
            style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-2)' }}>
            <ChevronDown size={16} />
          </button>
        </div>
        <button className="btn btn-ghost press" title="Обновить список моделей" onClick={onRefresh} disabled={loading}>
          {loading ? <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> : <RefreshCw size={14} />}
        </button>
      </div>

      {open && (
        <div style={{
          position: 'absolute', zIndex: 30, top: 'calc(100% + 4px)', left: 0, right: 52,
          maxHeight: 280, overflowY: 'auto', background: 'var(--panel)', border: '1px solid var(--border-strong)',
          borderRadius: 10, boxShadow: '0 12px 34px rgba(0,0,0,0.45)'
        }}>
          {filtered.length === 0 && (
            <div className="muted" style={{ padding: 12, fontSize: 12 }}>
              Ничего не найдено{q.trim() && ' — нажми Enter, чтобы вписать вручную'}
            </div>
          )}
          {filtered.slice(0, 200).map((m) => (
            <button key={m} onClick={() => pick(m)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12.5,
                background: m === value ? 'var(--accent-soft)' : 'transparent',
                color: m === value ? 'var(--accent-text)' : 'var(--text-0)'
              }}>
              {m}
            </button>
          ))}
          {filtered.length > 200 && (
            <div className="muted" style={{ padding: 8, fontSize: 11 }}>…и ещё {filtered.length - 200}. Уточни запрос.</div>
          )}
        </div>
      )}
    </div>
  )
}

function PersonalitySection({ settings, update }: SectionProps) {
  const activePreset = detectPreset(settings.personality)
  const applyPreset = (p: PersonalityPreset): void => {
    update({
      personality: p.apply.personality,
      addressStyle: p.apply.addressStyle,
      ...(p.apply.sileroSpeaker ? { sileroSpeaker: p.apply.sileroSpeaker } : {}),
      ...(p.apply.voiceRate ? { voiceRate: p.apply.voiceRate } : {})
    })
  }
  return (
    <div>
      <SectionTitle icon={<User size={19} />} title="Личность Kira" subtitle="Как Kira общается и обращается к тебе." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 640 }}>
        <Field label="Пресет характера">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
            {PERSONALITY_PRESETS.map((p) => {
              const active = activePreset === p.id
              return (
                <button key={p.id} className="press" onClick={() => applyPreset(p)}
                  style={{
                    textAlign: 'left', padding: '10px 12px', borderRadius: 10,
                    background: active ? 'var(--accent-soft)' : 'var(--bg-2)',
                    border: `1px solid ${active ? 'var(--border-strong)' : 'var(--border)'}`,
                    boxShadow: active ? '0 0 14px rgba(139,92,246,0.15)' : 'none'
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ fontSize: 16 }}>{p.emoji}</span>
                    <span style={{ fontWeight: 700, fontSize: 13.5, color: active ? 'var(--accent-text)' : 'var(--text-0)' }}>{p.name}</span>
                    {active && <Check size={13} style={{ marginLeft: 'auto', color: 'var(--accent-text)' }} />}
                  </div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.45 }}>{p.tagline}</div>
                </button>
              )
            })}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            {activePreset ? 'Выбери пресет или доредактируй промпт ниже.' : 'Сейчас: свой характер (промпт изменён вручную).'}
          </div>
        </Field>
        <Field label="Твоё имя">
          <input style={{ width: '100%' }} value={settings.userName}
            onChange={(e) => update({ userName: e.target.value })} />
        </Field>
        <Field label="Как Kira обращается к тебе">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {([
              ['name', `По имени (${settings.userName || 'имя'})`], ['sir', 'Сэр'], ['madam', 'Мадам'],
              ['boss', 'Босс'], ['friend', 'Друг (на «ты»)'], ['commander', 'Командир'],
              ['chief', 'Шеф'], ['master', 'Господин'], ['darling', 'Ласково'],
              ['hero', 'Герой'], ['custom', 'Своё…']
            ] as const).map(([id, label]) => (
              <button key={id} className="btn press"
                style={{
                  justifyContent: 'center', padding: '8px 14px',
                  background: settings.addressStyle === id ? 'var(--accent-soft)' : 'var(--bg-2)',
                  border: `1px solid ${settings.addressStyle === id ? 'var(--border-strong)' : 'var(--border)'}`,
                  color: settings.addressStyle === id ? 'var(--accent-text)' : 'var(--text-1)',
                  fontSize: 12.5
                }}
                onClick={() => update({ addressStyle: id })}>
                {label}
              </button>
            ))}
          </div>
          {settings.addressStyle === 'custom' && (
            <input style={{ width: '100%', marginTop: 10 }} placeholder="Например: «капитан», «повелитель», «Тони»…"
              value={settings.customAddress} onChange={(e) => update({ customAddress: e.target.value })} />
          )}
        </Field>
        <Field label="Что Kira знает о тебе (профиль)">
          <textarea rows={4} style={{ width: '100%' }} placeholder="Работа, вкусы, привычки — Kira учитывает это в каждом разговоре"
            value={settings.userProfile} onChange={(e) => update({ userProfile: e.target.value })} />
          <button className="btn btn-ghost press" style={{ marginTop: 8, fontSize: 12 }}
            onClick={() => update({ onboarded: false })}>
            Пройти знакомство заново
          </button>
        </Field>
        <Field label="Характер и стиль общения (системный промпт)">
          <textarea rows={6} style={{ width: '100%' }} value={settings.personality}
            onChange={(e) => update({ personality: e.target.value })} />
        </Field>
      </div>
    </div>
  )
}

function VoiceSection({ settings, update }: SectionProps) {
  const [voices, setVoices] = useState<{ silero: { id: string; label: string; gender: string }[]; edge: { id: string; label: string; gender: string }[] }>({ silero: [], edge: [] })
  const [sileroReady, setSileroReady] = useState<boolean | null>(null)
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState('')
  const [installing, setInstalling] = useState(false)
  const [installLog, setInstallLog] = useState('')

  const installSilero = async (): Promise<void> => {
    const py = await kira.tts.pythonCheck()
    if (!py.ok) {
      setInstallLog('Не найден Python. Установи Python 3 с python.org (галочка «Add to PATH») и повтори.')
      return
    }
    setInstalling(true)
    setInstallLog(`Найден ${py.version}. Устанавливаю…`)
    const off = kira.on('silero:install-progress', (line) => setInstallLog(String(line)))
    try {
      const res = await kira.tts.sileroInstall()
      setInstallLog(res.message)
      if (res.ok) setSileroReady(true)
    } finally {
      off()
      setInstalling(false)
    }
  }
  const sysVoices = typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : []
  const ruVoices = sysVoices.filter((v) => v.lang.startsWith('ru'))
  const otherVoices = sysVoices.filter((v) => !v.lang.startsWith('ru'))

  useEffect(() => {
    void kira.tts.voices().then(setVoices)
    void kira.tts.sileroAvailable().then(setSileroReady)
  }, [])

  const test = async (): Promise<void> => {
    setTesting(true)
    setStatus(settings.ttsEngine === 'silero' && sileroReady ? 'Первый запуск загружает модель — подожди пару секунд…' : '')
    try {
      if (settings.ttsEngine === 'system') {
        const u = new SpeechSynthesisUtterance('Привет! Меня зовут Кира. Я всегда на связи и готова помочь.')
        const v = sysVoices.find((x) => x.name === settings.voiceName) ?? ruVoices[0]
        if (v) u.voice = v
        u.rate = settings.voiceRate
        u.pitch = 1.08
        speechSynthesis.speak(u)
        setStatus('')
        return
      }
      const r = await kira.tts.synthesize('Привет! Меня зовут Кира. Приятно снова тебя слышать — я всегда рядом и готова помочь.')
      if (r.ok && r.audio) {
        const mime = r.format === 'wav' ? 'audio/wav' : 'audio/mpeg'
        const bytes = atob(r.audio)
        const arr = new Uint8Array(bytes.length)
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
        const url = URL.createObjectURL(new Blob([arr], { type: mime }))
        const audio = new Audio(url)
        audio.playbackRate = settings.voiceRate
        audio.onended = () => URL.revokeObjectURL(url)
        await audio.play()
        setStatus(`Голос: ${r.engine === 'silero' ? 'Silero (локально)' : r.engine === 'edge' ? 'Edge (облако)' : 'системный'}`)
      } else {
        setStatus(r.error || 'Не удалось синтезировать. Проверь установку.')
      }
    } finally {
      setTesting(false)
    }
  }

  const engineCard = (id: 'silero' | 'edge' | 'system', title: string, hint: string) => (
    <button className="btn press" style={{
      flex: 1, justifyContent: 'flex-start', flexDirection: 'column', alignItems: 'flex-start', gap: 3, padding: '12px 14px',
      background: settings.ttsEngine === id ? 'var(--accent-soft)' : 'var(--bg-2)',
      border: `1px solid ${settings.ttsEngine === id ? 'var(--border-strong)' : 'var(--border)'}`,
      color: settings.ttsEngine === id ? 'var(--accent-text)' : 'var(--text-1)'
    }} onClick={() => update({ ttsEngine: id })}>
      <span style={{ fontWeight: 700, fontSize: 12.5 }}>{title}</span>
      <span className="muted" style={{ fontSize: 10.5 }}>{hint}</span>
    </button>
  )

  return (
    <div>
      <SectionTitle icon={<Mic size={19} />} title="Голос" subtitle="Живой голос Kira, распознавание речи и озвучивание." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 680 }}>
        <Toggle label="Голосовой режим включён" hint="Kira озвучивает ответы своим голосом"
          checked={settings.voiceEnabled} onChange={(v) => update({ voiceEnabled: v })} />
        <Toggle label="Автоматически слушать" hint="После ответа Kira снова слушает тебя"
          checked={settings.voiceAutoListen} onChange={(v) => update({ voiceAutoListen: v })} />

        <Field label="Движок синтеза речи">
          <div style={{ display: 'flex', gap: 8 }}>
            {engineCard('silero', '🧠 Silero (локально)', 'Лучшее качество RU. Офлайн, на CPU.')}
            {engineCard('edge', '✨ Edge (облако)', 'Нейросеть Microsoft. Нужен интернет.')}
            {engineCard('system', '💻 Системный', 'Голоса Windows. Проще звучит.')}
          </div>
        </Field>

        {settings.ttsEngine === 'silero' && (
          <>
            {sileroReady === false && (
              <div className="card" style={{ borderColor: 'rgba(251,191,36,0.35)', background: 'rgba(251,191,36,0.06)' }}>
                <div style={{ fontSize: 12.5, color: 'var(--text-1)', lineHeight: 1.5, marginBottom: 10 }}>
                  Локальный голос Silero требует PyTorch (ставится один раз). Нажми — Kira установит сама.
                  Пока не установлен, используется облачный Edge-голос.
                </div>
                <button className="btn btn-primary press" onClick={() => void installSilero()} disabled={installing}>
                  {installing ? <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Cpu size={14} />}
                  {installing ? 'Устанавливаю…' : 'Установить локальный голос'}
                </button>
                {installLog && (
                  <div style={{ fontFamily: 'Cascadia Code, monospace', fontSize: 11, marginTop: 10, color: 'var(--text-2)', wordBreak: 'break-word', maxHeight: 80, overflow: 'hidden' }}>
                    {installLog}
                  </div>
                )}
              </div>
            )}
            <Field label="Голос Kira (Silero)">
              <select style={{ width: '100%' }} value={settings.sileroSpeaker}
                onChange={(e) => update({ sileroSpeaker: e.target.value })}>
                <optgroup label="Женские">
                  {voices.silero.filter((v) => v.gender === 'female').map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </optgroup>
                <optgroup label="Мужские">
                  {voices.silero.filter((v) => v.gender === 'male').map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </optgroup>
              </select>
              <p className="muted" style={{ marginTop: 6, fontSize: 11.5 }}>
                По умолчанию — Ксения (xenia), мягкий женский голос. Модель загружается локально при первом запуске.
              </p>
            </Field>
          </>
        )}

        {settings.ttsEngine === 'edge' && (
          <>
            <Field label="Голос Kira (Edge)">
              <select style={{ width: '100%' }} value={settings.edgeVoice}
                onChange={(e) => update({ edgeVoice: e.target.value })}>
                <optgroup label="Женские">
                  {voices.edge.filter((v) => v.gender === 'female').map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </optgroup>
                <optgroup label="Мужские">
                  {voices.edge.filter((v) => v.gender === 'male').map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </optgroup>
              </select>
            </Field>
            <Field label={`Высота тона: ${settings.voicePitch > 0 ? '+' : ''}${settings.voicePitch} Гц`}>
              <input type="range" min={-30} max={30} step={1} value={settings.voicePitch}
                style={{ width: '100%', accentColor: 'var(--accent)' }}
                onChange={(e) => update({ voicePitch: Number(e.target.value) })} />
            </Field>
          </>
        )}

        {settings.ttsEngine === 'system' && (
          <Field label="Системный голос">
            <select style={{ width: '100%' }} value={settings.voiceName}
              onChange={(e) => update({ voiceName: e.target.value })}>
              <option value="">Автовыбор (женский русский)</option>
              {ruVoices.length > 0 && <optgroup label="Русские">
                {ruVoices.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
              </optgroup>}
              {otherVoices.length > 0 && <optgroup label="Другие">
                {otherVoices.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
              </optgroup>}
            </select>
          </Field>
        )}

        <Field label={`Скорость речи: ${settings.voiceRate.toFixed(1)}x`}>
          <input type="range" min={0.5} max={1.8} step={0.1} value={settings.voiceRate}
            style={{ width: '100%', accentColor: 'var(--accent)' }}
            onChange={(e) => update({ voiceRate: Number(e.target.value) })} />
        </Field>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button className="btn btn-primary press" onClick={() => void test()} disabled={testing}>
            {testing ? <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Mic size={14} />}
            Послушать голос Kira
          </button>
          {status && <span className="muted" style={{ fontSize: 12 }}>{status}</span>}
        </div>
      </div>
    </div>
  )
}

function InterfaceSection({ settings, update }: SectionProps) {
  const accents = ['#8b5cf6', '#6366f1', '#ec4899', '#06b6d4', '#10b981', '#f59e0b', '#ef4444']
  return (
    <div>
      <SectionTitle icon={<Palette size={19} />} title="Интерфейс" subtitle="Внешний вид приложения." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 640 }}>
        <Field label="Акцентный цвет">
          <div style={{ display: 'flex', gap: 10 }}>
            {accents.map((c) => (
              <button key={c} onClick={() => update({ accent: c })}
                style={{
                  width: 38, height: 38, borderRadius: 11, background: c,
                  border: settings.accent === c ? '3px solid #fff' : '3px solid transparent',
                  boxShadow: settings.accent === c ? `0 0 14px ${c}` : 'none',
                  transition: 'all 0.15s'
                }} />
            ))}
            <input type="color" value={settings.accent} onChange={(e) => update({ accent: e.target.value })}
              style={{ width: 38, height: 38, padding: 2, borderRadius: 11, cursor: 'pointer' }} />
          </div>
        </Field>
        <Field label={`Размер шрифта: ${settings.fontSize}px`}>
          <input type="range" min={12} max={18} step={1} value={settings.fontSize}
            style={{ width: '100%', accentColor: 'var(--accent)' }}
            onChange={(e) => update({ fontSize: Number(e.target.value) })} />
        </Field>
        <Toggle label="Плавающая эмблема поверх всех окон"
          hint="Эмблема Kira всегда в правом верхнем углу экрана. Клик — говорить, правый клик — открыть."
          checked={settings.floatingOrb} onChange={(v) => update({ floatingOrb: v })} />
        <Field label="Анимации интерфейса">
          <div style={{ display: 'flex', gap: 8 }}>
            {([['full', 'Полные', 'Живой фон, кольца, переходы'], ['reduced', 'Умеренные', 'Только плавные переходы'], ['off', 'Выключены', 'Максимальная производительность']] as const).map(([id, label, hint]) => (
              <button key={id} className="btn press" style={{
                flex: 1, justifyContent: 'flex-start', flexDirection: 'column', alignItems: 'flex-start', gap: 3, padding: '11px 13px',
                background: settings.animationLevel === id ? 'var(--accent-soft)' : 'var(--bg-2)',
                border: `1px solid ${settings.animationLevel === id ? 'var(--border-strong)' : 'var(--border)'}`,
                color: settings.animationLevel === id ? 'var(--accent-text)' : 'var(--text-1)'
              }} onClick={() => update({ animationLevel: id })}>
                <span style={{ fontWeight: 650, fontSize: 12.5 }}>{label}</span>
                <span className="muted" style={{ fontSize: 10.5 }}>{hint}</span>
              </button>
            ))}
          </div>
        </Field>
        <div className="card" style={{ background: 'var(--bg-2)' }}>
          <div className="muted" style={{ marginBottom: 8 }}>Горячие клавиши</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
            <KeyRow keys="Ctrl + K" action="Глобальный поиск" />
            <KeyRow keys="Enter" action="Отправить сообщение" />
            <KeyRow keys="Shift + Enter" action="Новая строка" />
          </div>
        </div>
      </div>
    </div>
  )
}

function BehaviorSection({ settings, update }: SectionProps) {
  const [wakeReady, setWakeReady] = useState<boolean | null>(null)
  const [wakeInstalling, setWakeInstalling] = useState(false)
  const [wakeLog, setWakeLog] = useState('')
  const [spkReady, setSpkReady] = useState<boolean | null>(null)
  const [spkEnrolled, setSpkEnrolled] = useState(false)
  const [spkBusy, setSpkBusy] = useState(false)
  const [spkLog, setSpkLog] = useState('')

  useEffect(() => {
    void kira.wake.available().then(setWakeReady)
    void kira.speaker.available().then(setSpkReady)
    void kira.speaker.enrolled().then(setSpkEnrolled)
  }, [])

  const installSpeaker = async (): Promise<void> => {
    setSpkBusy(true); setSpkLog('Устанавливаю…')
    const off = kira.on('speaker:install-progress', (l) => setSpkLog(String(l)))
    try {
      const res = await kira.speaker.install()
      setSpkLog(res.message)
      if (res.ok) setSpkReady(true)
    } finally { off(); setSpkBusy(false) }
  }

  const enrollVoice = async (): Promise<void> => {
    setSpkBusy(true)
    try {
      const { recordSampleBase64 } = await import('@/voice/audioUtils')
      const samples: string[] = []
      for (let i = 0; i < 2; i++) {
        setSpkLog(`Говори что-нибудь… запись ${i + 1}/2`)
        samples.push(await recordSampleBase64(4000))
      }
      setSpkLog('Обрабатываю…')
      const res = await kira.speaker.enroll(samples)
      setSpkLog(res.message)
      if (res.ok) setSpkEnrolled(true)
    } catch (e) {
      setSpkLog('Ошибка записи: ' + (e as Error).message)
    } finally { setSpkBusy(false) }
  }

  const installWake = async (): Promise<void> => {
    setWakeInstalling(true)
    setWakeLog('Готовлю офлайн-активатор…')
    const off = kira.on('wake:install-progress', (l) => setWakeLog(String(l)))
    try {
      const res = await kira.wake.install()
      setWakeLog(res.message)
      if (res.ok) setWakeReady(true)
    } finally {
      off()
      setWakeInstalling(false)
    }
  }

  return (
    <div>
      <SectionTitle icon={<Sliders size={19} />} title="Поведение" subtitle="Как Kira действует и запоминает." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 640 }}>
        <Toggle label="Подтверждать опасные действия"
          hint="Спрашивать перед выключением, удалением, завершением процессов и командами"
          checked={settings.confirmDangerous} onChange={(v) => update({ confirmDangerous: v })} />
        <Toggle label="Автосохранение памяти"
          hint="Kira сама запоминает важные факты о тебе во время диалогов"
          checked={settings.memoryAutoSave} onChange={(v) => update({ memoryAutoSave: v })} />
        <Toggle label="Запуск вместе с Windows"
          hint="Kira будет запускаться автоматически при входе в систему"
          checked={settings.launchOnStartup} onChange={(v) => update({ launchOnStartup: v })} />

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 18 }}>
          <Toggle label="Управление мышью и клавиатурой"
            hint="Разрешить Kira кликать и печатать за тебя (computer use). Работает вместе со «зрением»"
            checked={settings.allowControl} onChange={(v) => update({ allowControl: v })} />
        </div>

        <Toggle label="Чувствовать эмоции по голосу"
          hint="Kira улавливает твой тон (устал, воодушевлён, спокоен) и подстраивает ответ"
          checked={settings.emotionSense} onChange={(v) => update({ emotionSense: v })} />

        <Toggle label="Узнавать мой голос"
          hint="Kira реагирует только на твой голос и игнорирует других людей, ТВ и видео"
          checked={settings.speakerVerify} onChange={(v) => update({ speakerVerify: v })} />
        {settings.speakerVerify && (
          <div className="card" style={{ background: 'var(--bg-2)' }}>
            {spkReady === false ? (
              <>
                <div style={{ fontSize: 12.5, color: 'var(--text-1)', marginBottom: 10, lineHeight: 1.5 }}>
                  Нужен движок узнавания голоса (resemblyzer, локально). Установи один раз:
                </div>
                <button className="btn btn-primary press" onClick={() => void installSpeaker()} disabled={spkBusy}>
                  {spkBusy ? <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Mic size={14} />}
                  Установить
                </button>
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, color: spkEnrolled ? 'var(--ok)' : 'var(--text-1)' }}>
                  {spkEnrolled ? '✓ Твой голос обучен. Kira узнаёт тебя.' : 'Обучи Kira своему голосу (2 записи по 4 сек).'}
                </span>
                <button className="btn btn-ghost press" onClick={() => void enrollVoice()} disabled={spkBusy}>
                  {spkBusy ? <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Mic size={14} />}
                  {spkEnrolled ? 'Переобучить' : 'Обучить мой голос'}
                </button>
                {spkEnrolled && (
                  <button className="btn btn-ghost press" onClick={() => { void kira.speaker.clear(); setSpkEnrolled(false) }}>
                    Сбросить
                  </button>
                )}
              </div>
            )}
            {spkLog && <div style={{ fontSize: 11.5, marginTop: 10, color: 'var(--accent-text)' }}>{spkLog}</div>}
          </div>
        )}
        <Toggle label="Проактивность"
          hint="Kira следит за системой (диск, память) и предупреждает сама"
          checked={settings.proactiveEnabled} onChange={(v) => update({ proactiveEnabled: v })} />
        <Toggle label="Утренний брифинг"
          hint="Раз в день Kira приветствует и рассказывает про напоминания и проекты"
          checked={settings.briefingEnabled} onChange={(v) => update({ briefingEnabled: v })} />
        {settings.briefingEnabled && (
          <Field label={`Час брифинга: ${settings.briefingHour}:00`}>
            <input type="range" min={5} max={14} step={1} value={settings.briefingHour}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
              onChange={(e) => update({ briefingHour: Number(e.target.value) })} />
          </Field>
        )}

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 18 }}>
          <Toggle label="Слово-активатор «Кира»"
            hint="В голосовом режиме Kira реагирует только на фразы, где ты назвал её по имени"
            checked={settings.wakeWordEnabled} onChange={(v) => update({ wakeWordEnabled: v })} />
        </div>
        {settings.wakeWordEnabled && (
          <>
            <Field label="Слово активации">
              <input style={{ width: 220 }} value={settings.wakeWord}
                onChange={(e) => update({ wakeWord: e.target.value.toLowerCase() })} placeholder="кира" />
            </Field>
            <div className="card" style={{ background: 'var(--bg-2)' }}>
              {wakeReady ? (
                <div style={{ fontSize: 12.5, color: 'var(--ok)' }}>
                  ✓ Офлайн-активатор установлен (Vosk). Kira слышит «{settings.wakeWord}» локально, мгновенно, без интернета.
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 12.5, color: 'var(--text-1)', marginBottom: 10, lineHeight: 1.5 }}>
                    Мгновенный офлайн-детектор (Vosk, ~45 МБ) — реагирует локально без облака.
                    Без него слово-активатор работает через Whisper (медленнее, нужен интернет).
                  </div>
                  <button className="btn btn-primary press" onClick={() => void installWake()} disabled={wakeInstalling}>
                    {wakeInstalling ? <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Mic size={14} />}
                    {wakeInstalling ? 'Устанавливаю…' : 'Установить офлайн-активатор'}
                  </button>
                  {wakeLog && <div style={{ fontFamily: 'Cascadia Code, monospace', fontSize: 11, marginTop: 10, color: 'var(--text-2)', maxHeight: 60, overflow: 'hidden' }}>{wakeLog}</div>}
                </>
              )}
            </div>
          </>
        )}

        <Field label="Глобальная горячая клавиша вызова">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input style={{ width: 220 }} value={settings.summonHotkey}
              onChange={(e) => update({ summonHotkey: e.target.value })}
              placeholder="Control+Shift+K" />
            <span className="muted" style={{ fontSize: 11.5 }}>
              Вызов окна Kira из любого приложения. Пусто — выключить.
            </span>
          </div>
        </Field>

        <Field label="AI Actions по выделенному тексту">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input style={{ width: 220 }} value={settings.aiActionsHotkey}
              onChange={(e) => update({ aiActionsHotkey: e.target.value })}
              placeholder="Control+Shift+A" />
            <span className="muted" style={{ fontSize: 11.5 }}>
              Выдели текст в любом окне и нажми — меню Kira (перевести/объяснить/переписать…). Пусто — выключить.
            </span>
          </div>
        </Field>

        <Field label="AI Actions в Проводнике">
          <ShellMenuControl />
        </Field>
      </div>
    </div>
  )
}

function ShellMenuControl() {
  const [installed, setInstalled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { void kira.ai.menuStatus().then(setInstalled) }, [])

  const toggle = async (): Promise<void> => {
    setBusy(true)
    const r = installed ? await kira.ai.menuRemove() : await kira.ai.menuInstall()
    setBusy(false)
    setMsg(r.message)
    setInstalled(await kira.ai.menuStatus())
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <button className={installed ? 'btn btn-ghost' : 'btn btn-primary'} onClick={() => void toggle()} disabled={busy}>
        {busy ? <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> : null}
        {installed ? 'Убрать из меню Проводника' : 'Добавить в меню Проводника'}
      </button>
      <span className="muted" style={{ fontSize: 11.5, maxWidth: 420 }}>
        Пункт «Kira: действия» в контекстном меню файлов (ПКМ по файлу) — открывает меню
        AI Actions по содержимому. {msg && `· ${msg}`}
      </span>
    </div>
  )
}

function DataSection() {
  const [status, setStatus] = useState('')

  const exportAll = async (): Promise<void> => {
    const data = {
      exportedAt: new Date().toISOString(),
      settings: await kira.settings.get(),
      chats: await kira.chats.list(),
      memory: await kira.memory.list(),
      projects: await kira.projects.list(),
      protocols: await kira.protocols.list(),
      automations: await kira.automations.list(),
      abilities: await kira.abilities.list()
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `kira-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setStatus('Резервная копия сохранена')
  }

  const importAll = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const data = JSON.parse(await file.text())
        if (data.settings) await kira.settings.save(data.settings)
        for (const m of data.memory ?? []) await kira.memory.save(m)
        for (const p of data.projects ?? []) await kira.projects.save(p)
        for (const p of data.protocols ?? []) await kira.protocols.save(p)
        for (const a of data.automations ?? []) await kira.automations.save(a)
        for (const ab of data.abilities ?? []) await kira.abilities.save(ab)
        setStatus('Импорт завершён. Перезапусти Kira для применения.')
      } catch {
        setStatus('Ошибка импорта: неверный формат файла')
      }
    }
    input.click()
  }

  return (
    <div>
      <SectionTitle icon={<Download size={19} />} title="Данные" subtitle="Резервное копирование и восстановление." />
      <div style={{ display: 'flex', gap: 12, maxWidth: 640 }}>
        <button className="btn btn-primary" onClick={() => void exportAll()}>
          <Download size={15} /> Экспорт всех данных
        </button>
        <button className="btn btn-ghost" onClick={importAll}>
          <Upload size={15} /> Импорт данных
        </button>
      </div>
      {status && <p style={{ marginTop: 14, fontSize: 13, color: 'var(--accent-text)' }}>{status}</p>}
      <p className="muted" style={{ marginTop: 20, maxWidth: 560, lineHeight: 1.6 }}>
        Все данные Kira хранятся локально на твоём компьютере в папке пользователя (AppData).
        Ничего не отправляется в облако, кроме запросов к выбранному провайдеру ИИ.
      </p>
    </div>
  )
}

// ─── Вспомогательные компоненты ──────────────────────────────────────────────

function SectionTitle({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <span style={{ color: 'var(--accent-text)' }}>{icon}</span>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>{title}</h2>
      </div>
      <p className="muted" style={{ marginTop: 5, marginLeft: 30 }}>{subtitle}</p>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{label}</label>
      {children}
    </div>
  )
}

function Toggle({ label, hint, checked, onChange }: {
  label: string; hint: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{hint}</div>
      </div>
      <button onClick={() => onChange(!checked)}
        style={{
          width: 46, height: 25, borderRadius: 999, position: 'relative', flexShrink: 0,
          background: checked ? 'var(--accent)' : 'var(--bg-3)', transition: 'background 0.2s'
        }}>
        <span style={{
          position: 'absolute', top: 3, left: checked ? 24 : 3,
          width: 19, height: 19, borderRadius: '50%', background: '#fff', transition: 'left 0.2s'
        }} />
      </button>
    </div>
  )
}

function KeyRow({ keys, action }: { keys: string; action: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: 'var(--text-1)' }}>{action}</span>
      <kbd style={{
        fontSize: 11.5, padding: '2px 9px', borderRadius: 6,
        background: 'var(--accent-soft)', color: 'var(--accent-text)', border: '1px solid var(--border)'
      }}>{keys}</kbd>
    </div>
  )
}
