/** Центр систем — единая панель состояния подсистем Kira и установки в один клик. */
import { useCallback, useEffect, useState } from 'react'
import {
  Activity, Cpu, Mic, Brain, Sparkles, UserCheck, Zap, RefreshCw, Download, CheckCircle2, XCircle, Loader2
} from 'lucide-react'
import { kira } from '@/api'
import { useAppStore } from '@/state/appStore'

type Status = 'ok' | 'off' | 'checking'

interface Sub {
  id: string
  icon: typeof Cpu
  title: string
  desc: string
  status: Status
  detail?: string
  install?: () => Promise<{ ok: boolean; message: string }>
  progressChannel?: string
  action?: { label: string; onClick: () => void }
}

export function SystemsView() {
  const { settings, setView } = useAppStore()
  const [subs, setSubs] = useState<Sub[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [log, setLog] = useState('')
  const [python, setPython] = useState<string>('')

  const refresh = useCallback(async () => {
    const py = await kira.tts.pythonCheck()
    setPython(py.ok ? py.version : '')
    const [silero, wake, sem, spk, spkEnrolled] = await Promise.all([
      kira.tts.sileroAvailable(),
      kira.wake.available(),
      kira.semantic.available(),
      kira.speaker.available(),
      kira.speaker.enrolled()
    ])
    const brainKey = settings ? settings.providers[settings.provider]?.apiKey || settings.provider === 'ollama' : false

    setSubs([
      {
        id: 'brain', icon: Zap, title: 'Мозг (ИИ-модель)',
        desc: 'Модель, которая думает и отвечает',
        status: brainKey ? 'ok' : 'off',
        detail: settings ? `${settings.provider} · ${settings.providers[settings.provider]?.model ?? ''}` : '',
        action: { label: 'Настроить', onClick: () => setView('settings') }
      },
      {
        id: 'python', icon: Cpu, title: 'Python (для локальных ИИ)',
        desc: 'Нужен для локального голоса, wake-word, памяти, узнавания голоса',
        status: py.ok ? 'ok' : 'off',
        detail: py.ok ? py.version : 'Не найден — установи с python.org (Add to PATH)'
      },
      {
        id: 'silero', icon: Mic, title: 'Локальный голос (Silero)',
        desc: 'Живой русский голос, офлайн, на CPU',
        status: silero ? 'ok' : 'off',
        install: kira.tts.sileroInstall, progressChannel: 'silero:install-progress'
      },
      {
        id: 'wake', icon: Activity, title: 'Офлайн-активатор «Кира»',
        desc: 'Мгновенная реакция на имя, без облака (Vosk)',
        status: wake ? 'ok' : 'off',
        install: kira.wake.install, progressChannel: 'wake:install-progress'
      },
      {
        id: 'semantic', icon: Sparkles, title: 'Семантическая память',
        desc: 'Поиск по смыслу в прошлых разговорах',
        status: sem ? 'ok' : 'off',
        install: kira.semantic.install, progressChannel: 'semantic:install-progress'
      },
      {
        id: 'speaker', icon: UserCheck, title: 'Узнавание голоса',
        desc: spk && spkEnrolled ? 'Реагирует только на твой голос' : 'Реагировать только на твой голос',
        status: spk ? (spkEnrolled ? 'ok' : 'off') : 'off',
        detail: spk && !spkEnrolled ? 'Установлено — осталось обучить (Настройки → Поведение)' : undefined,
        install: spk ? undefined : kira.speaker.install, progressChannel: 'speaker:install-progress',
        action: spk && !spkEnrolled ? { label: 'Обучить', onClick: () => setView('settings') } : undefined
      }
    ])
  }, [settings, setView])

  useEffect(() => { void refresh() }, [refresh])

  const runInstall = async (sub: Sub): Promise<void> => {
    if (!sub.install) return
    setBusy(sub.id)
    setLog(`${sub.title}: установка…`)
    const off = sub.progressChannel ? kira.on(sub.progressChannel, (l) => setLog(`${sub.title}: ${String(l)}`)) : () => {}
    try {
      const res = await sub.install()
      setLog(`${sub.title}: ${res.message}`)
      await refresh()
    } finally { off(); setBusy(null) }
  }

  const enableAll = async (): Promise<void> => {
    for (const sub of subs) {
      if (sub.status === 'off' && sub.install) await runInstall(sub)
    }
  }

  const okCount = subs.filter((s) => s.status === 'ok').length

  return (
    <div className="view-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
        <h2 className="section-title">Центр систем</h2>
        <span className="badge">{okCount}/{subs.length} активно</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost press" onClick={() => void refresh()}><RefreshCw size={14} /> Обновить</button>
          <button className="btn btn-primary press" onClick={() => void enableAll()} disabled={!!busy || !python}>
            <Download size={14} /> Включить всё
          </button>
        </div>
      </div>
      <p className="muted" style={{ marginBottom: 20 }}>
        Все локальные ИИ-функции Kira в одном месте. Зелёный — работает, серый — можно включить.
      </p>

      {log && (
        <div className="card" style={{ marginBottom: 16, background: 'var(--bg-2)', fontFamily: 'Cascadia Code, monospace', fontSize: 12, color: 'var(--accent-text)' }}>
          {log}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
        {subs.map((sub) => {
          const Icon = sub.icon
          return (
            <div key={sub.id} className="card anim-in" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 11, flexShrink: 0,
                  background: sub.status === 'ok' ? 'rgba(52,211,153,0.13)' : 'var(--bg-2)',
                  color: sub.status === 'ok' ? 'var(--ok)' : 'var(--text-2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}><Icon size={19} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{sub.title}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>{sub.desc}</div>
                </div>
                {sub.status === 'ok'
                  ? <CheckCircle2 size={18} style={{ color: 'var(--ok)', flexShrink: 0 }} />
                  : <XCircle size={18} style={{ color: 'var(--text-2)', flexShrink: 0 }} />}
              </div>
              {sub.detail && <div style={{ fontSize: 11.5, color: 'var(--text-1)' }}>{sub.detail}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                {sub.status !== 'ok' && sub.install && (
                  <button className="btn btn-primary press" style={{ fontSize: 12, padding: '7px 13px' }}
                    onClick={() => void runInstall(sub)} disabled={!!busy || !python}>
                    {busy === sub.id ? <Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Download size={13} />}
                    Установить
                  </button>
                )}
                {sub.action && (
                  <button className="btn btn-ghost press" style={{ fontSize: 12, padding: '7px 13px' }} onClick={sub.action.onClick}>
                    {sub.action.label}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {!python && (
        <div className="card" style={{ marginTop: 18, borderColor: 'rgba(251,191,36,0.35)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--warn)', fontSize: 13 }}>
            <Brain size={16} /> Для локальных функций нужен <b>Python 3</b>. Установи с python.org (галочка «Add to PATH») и нажми «Обновить».
          </div>
        </div>
      )}
    </div>
  )
}
