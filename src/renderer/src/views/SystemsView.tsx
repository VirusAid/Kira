/**
 * Способности — что Kira умеет и что можно включить.
 *
 * Экран намеренно НЕ показывает внутренности: пользователю не нужно знать про
 * Python, движки распознавания и названия моделей. Он видит человеческие
 * способности («Живой голос», «Понимает речь», «Видит экран») и одну кнопку
 * «Включить». Технические детали остаются в журнале и диагностике.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Eye, Mic, Ear, Brain, Sparkles, UserCheck, Zap, RefreshCw, Download, Check, Loader2
} from 'lucide-react'
import { kira } from '@/api'
import { useAppStore } from '@/state/appStore'

interface Ability {
  id: string
  icon: typeof Mic
  title: string
  /** что это даёт ПОЛЬЗОВАТЕЛЮ, без единого технического слова */
  desc: string
  on: boolean
  hint?: string
  enable?: () => Promise<{ ok: boolean; message: string }>
  progressChannel?: string
  action?: { label: string; onClick: () => void }
}

export function SystemsView() {
  const { settings, setView } = useAppStore()
  const [items, setItems] = useState<Ability[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const refresh = useCallback(async () => {
    const [voice, hearing, memory, owner, ownerReady] = await Promise.all([
      kira.tts.sileroAvailable(),
      kira.wake.available(),
      kira.semantic.available(),
      kira.speaker.available(),
      kira.speaker.enrolled()
    ])
    const brainReady = settings
      ? !!settings.providers[settings.provider]?.apiKey || settings.preferLocal
      : false

    setItems([
      {
        id: 'brain', icon: Zap, title: 'Разум',
        desc: 'Думает, отвечает и решает задачи',
        on: brainReady,
        hint: settings?.preferLocal ? 'Работает на твоём компьютере' : 'Работает через облако',
        action: { label: 'Настроить', onClick: () => setView('settings') }
      },
      {
        id: 'voice', icon: Mic, title: 'Живой голос',
        desc: 'Говорит вслух настоящим голосом, даже без интернета',
        on: voice,
        enable: kira.tts.sileroInstall, progressChannel: 'silero:install-progress'
      },
      {
        id: 'hearing', icon: Ear, title: 'Понимает речь',
        desc: 'Слышит и распознаёт слова без интернета, отзывается на имя',
        on: hearing,
        enable: kira.wake.install, progressChannel: 'wake:install-progress'
      },
      {
        id: 'sight', icon: Eye, title: 'Видит экран',
        desc: 'Всегда в курсе, что у тебя на экране — спроси «что тут?»',
        on: !!settings?.screenAssist,
        hint: settings?.screenAssist ? undefined : 'Включается в настройках',
        action: { label: settings?.screenAssist ? 'Настроить' : 'Включить', onClick: () => setView('settings') }
      },
      {
        id: 'memory', icon: Sparkles, title: 'Память по смыслу',
        desc: 'Вспоминает нужное из прошлых разговоров, даже другими словами',
        on: memory,
        enable: kira.semantic.install, progressChannel: 'semantic:install-progress'
      },
      {
        id: 'owner', icon: UserCheck, title: 'Узнаёт меня',
        desc: 'Реагирует только на твой голос, а не на любой рядом',
        on: owner && ownerReady,
        hint: owner && !ownerReady ? 'Осталось познакомиться с твоим голосом' : undefined,
        enable: owner ? undefined : kira.speaker.install, progressChannel: 'speaker:install-progress',
        action: owner && !ownerReady ? { label: 'Познакомить', onClick: () => setView('settings') } : undefined
      }
    ])
  }, [settings, setView])

  useEffect(() => { void refresh() }, [refresh])

  const enable = async (item: Ability): Promise<void> => {
    if (!item.enable) return
    setBusy(item.id)
    setNote(`${item.title}: включаю…`)
    // прогресс приходит техническими строками — пользователю показываем только
    // сам факт работы, детали уходят в журнал
    const off = item.progressChannel ? kira.on(item.progressChannel, () => setNote(`${item.title}: включаю…`)) : () => {}
    try {
      const res = await item.enable()
      setNote(res.ok ? `${item.title} — готово` : `${item.title}: не получилось. ${res.message}`)
      await refresh()
    } catch (e) {
      setNote(`${item.title}: не получилось. ${(e as Error).message}`)
    } finally { off(); setBusy(null) }
  }

  const enableAll = async (): Promise<void> => {
    for (const item of items) if (!item.on && item.enable) await enable(item)
  }

  const onCount = items.filter((i) => i.on).length
  const canEnableAny = items.some((i) => !i.on && i.enable)

  return (
    <div className="view-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
        <h2 className="section-title">Способности</h2>
        <span className="badge">{onCount} из {items.length} включено</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost press" onClick={() => void refresh()}><RefreshCw size={14} /> Обновить</button>
          {canEnableAny && (
            <button className="btn btn-primary press" onClick={() => void enableAll()} disabled={!!busy}>
              <Download size={14} /> Включить всё
            </button>
          )}
        </div>
      </div>
      <p className="muted" style={{ marginBottom: 20 }}>
        Что Kira умеет прямо сейчас. Всё, что включено, работает на твоём компьютере — без интернета и без передачи данных.
      </p>

      {note && (
        <div className="card" style={{ marginBottom: 16, fontSize: 13, color: 'var(--accent-text)' }}>
          {busy && <Loader2 size={14} className="spin" style={{ verticalAlign: -2, marginRight: 7 }} />}
          {note}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 14 }}>
        {items.map((item) => {
          const Icon = item.icon
          return (
            <div key={item.id} className="card anim-in hud-frame" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <div className="stat-icon" style={{
                  width: 42, height: 42, borderRadius: 12, flexShrink: 0,
                  background: item.on ? 'rgba(52,211,153,0.14)' : 'var(--bg-2)',
                  color: item.on ? 'var(--ok)' : 'var(--text-2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}><Icon size={20} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{item.title}</div>
                  <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.4 }}>{item.desc}</div>
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
                  color: item.on ? 'var(--ok)' : 'var(--text-2)',
                  display: 'flex', alignItems: 'center', gap: 4
                }}>
                  {item.on ? <><Check size={13} /> работает</> : 'выключено'}
                </span>
              </div>
              {item.hint && <div style={{ fontSize: 11.5, color: 'var(--text-1)' }}>{item.hint}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                {!item.on && item.enable && (
                  <button className="btn btn-primary press" style={{ fontSize: 12, padding: '7px 13px' }}
                    onClick={() => void enable(item)} disabled={!!busy}>
                    {busy === item.id ? <Loader2 size={13} className="spin" /> : <Download size={13} />} Включить
                  </button>
                )}
                {item.action && (
                  <button className="btn btn-ghost press" style={{ fontSize: 12, padding: '7px 13px' }} onClick={item.action.onClick}>
                    {item.action.label}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="card" style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Brain size={16} style={{ color: 'var(--accent-text)', flexShrink: 0 }} />
        <span className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          Включение занимает пару минут и делается один раз. Если что-то не включается —
          скажи Кире «почему не работает голос», и она сама разберётся.
        </span>
      </div>
    </div>
  )
}
