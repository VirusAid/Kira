/** Правая панель: контекст, быстрые действия, история, состояние системы. */
import { useEffect, useState } from 'react'
import {
  Camera, Lock, Moon, MessageSquarePlus, Activity, Cpu, MemoryStick,
  Monitor, SkipBack, SkipForward, Play, Minimize2, Music, Undo2
} from 'lucide-react'
import { kira } from '@/api'
import { useAppStore } from '@/state/appStore'
import { useChatStore } from '@/state/chatStore'
import { useLogStore } from '@/state/dataStores'
import { SystemPanel } from './SystemPanel'

export function RightPanel() {
  const { stats, refreshStats, setView } = useAppStore()
  const { chats, openChat, newChat, streaming, actionEvents } = useChatStore()
  const logs = useLogStore((s) => s.logs)
  const [systemOpen, setSystemOpen] = useState(false)
  const [music, setMusic] = useState('')
  const [musicBusy, setMusicBusy] = useState(false)
  const [undoList, setUndoList] = useState<{ id: string; label: string; at: number }[]>([])

  useEffect(() => {
    void kira.undo.list().then(setUndoList)
    return kira.on('undo:changed', (payload) => setUndoList(payload as { id: string; label: string; at: number }[]))
  }, [])

  useEffect(() => {
    void refreshStats()
    const timer = setInterval(() => void refreshStats(), 5000)
    return () => clearInterval(timer)
  }, [refreshStats])

  const recentChats = chats.slice(0, 5)
  const recentActions = logs.filter((l) => l.level === 'action').slice(0, 6)

  return (
    <aside style={styles.panel}>
      {/* Состояние Kira */}
      <div style={styles.block}>
        <div style={styles.blockTitle}><Activity size={13} /> Состояние</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{
            width: 9, height: 9, borderRadius: '50%',
            background: streaming ? 'var(--warn)' : 'var(--ok)',
            boxShadow: `0 0 8px ${streaming ? 'var(--warn)' : 'var(--ok)'}`,
            animation: streaming ? 'pulse 1s infinite' : 'none'
          }} />
          <span style={{ fontSize: 13 }}>{streaming ? 'Kira думает…' : 'Kira в сети'}</span>
        </div>
        {stats && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 12 }}>
            <Meter icon={<Cpu size={12} />} label="CPU" percent={stats.cpuPercent} />
            <Meter
              icon={<MemoryStick size={12} />}
              label={`RAM ${stats.memUsedGB}/${stats.memTotalGB} ГБ`}
              percent={Math.round((stats.memUsedGB / stats.memTotalGB) * 100)}
            />
          </div>
        )}
      </div>

      {/* Медиа */}
      <div style={styles.block}>
        <div style={styles.blockTitle}>Музыка и медиа</div>
        <form style={{ display: 'flex', gap: 6, marginBottom: 10 }}
          onSubmit={(e) => {
            e.preventDefault()
            if (!music.trim()) return
            setMusicBusy(true)
            void kira.system.playMusic(music).then(() => { setMusicBusy(false); setMusic('') })
          }}>
          <input style={{ flex: 1, fontSize: 12, padding: '7px 10px' }} placeholder="Включить трек…"
            value={music} onChange={(e) => setMusic(e.target.value)} />
          <button className="btn btn-primary press" style={{ padding: '0 11px' }} type="submit" disabled={musicBusy}>
            {musicBusy ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <Music size={14} />}
          </button>
        </form>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <button className="icon-btn press" style={{ width: 34, height: 34 }} onClick={() => void kira.system.media('prev')}>
            <SkipBack size={16} />
          </button>
          <button className="btn btn-primary press" style={{ width: 42, height: 42, borderRadius: '50%', justifyContent: 'center', padding: 0 }}
            onClick={() => void kira.system.media('playpause')}>
            <Play size={18} />
          </button>
          <button className="icon-btn press" style={{ width: 34, height: 34 }} onClick={() => void kira.system.media('next')}>
            <SkipForward size={16} />
          </button>
        </div>
      </div>

      {/* Быстрые действия */}
      <div style={styles.block}>
        <div style={styles.blockTitle}>Быстрые действия</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 7 }}>
          <QuickBtn icon={<MessageSquarePlus size={14} />} label="Новый чат"
            onClick={() => { void newChat(); setView('chat') }} />
          <QuickBtn icon={<Camera size={14} />} label="Скриншот"
            onClick={() => void kira.system.screenshot()} />
          <QuickBtn icon={<Monitor size={14} />} label="Система"
            onClick={() => setSystemOpen(true)} />
          <QuickBtn icon={<Minimize2 size={14} />} label="Свернуть"
            onClick={() => void kira.system.minimizeAll()} />
          <QuickBtn icon={<Lock size={14} />} label="Блокировка"
            onClick={() => void kira.system.power('lock')} />
          <QuickBtn icon={<Moon size={14} />} label="Сон"
            onClick={() => void kira.system.power('sleep')} />
        </div>
      </div>

      {/* Отмена последнего действия */}
      {undoList.length > 0 && (
        <div style={styles.block}>
          <div style={styles.blockTitle}>Можно отменить</div>
          <button className="btn btn-ghost press" style={{ width: '100%', justifyContent: 'flex-start', fontSize: 12 }}
            onClick={() => void kira.undo.last()}>
            <Undo2 size={14} /> Отменить: {undoList[0].label}
          </button>
        </div>
      )}

      {systemOpen && <SystemPanel onClose={() => setSystemOpen(false)} />}

      {/* Действия текущей задачи */}
      {actionEvents.length > 0 && (
        <div style={styles.block}>
          <div style={styles.blockTitle}>Текущая задача</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {actionEvents.slice(-5).map((a, i) => (
              <div key={i} style={{ fontSize: 12, display: 'flex', gap: 7, alignItems: 'baseline' }}>
                <span style={{ color: a.ok ? 'var(--ok)' : 'var(--err)' }}>{a.ok ? '✓' : '✗'}</span>
                <span style={{ color: 'var(--text-1)' }}>{a.message.slice(0, 60)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* История */}
      <div style={styles.block}>
        <div style={styles.blockTitle}>Недавние диалоги</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {recentChats.length === 0 && <span className="muted">Пока пусто</span>}
          {recentChats.map((c) => (
            <button key={c.id} style={styles.historyItem}
              onClick={() => { void openChat(c.id); setView('chat') }}>
              {c.title}
            </button>
          ))}
        </div>
      </div>

      {/* Последние действия */}
      <div style={{ ...styles.block, flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div style={styles.blockTitle}>Последние действия</div>
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {recentActions.map((l) => (
            <div key={l.id} style={{ fontSize: 11.5, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ color: 'var(--accent-text)' }}>
                {new Date(l.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </span>{' '}
              {l.message.slice(0, 70)}
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}

function Meter({ icon, label, percent }: { icon: React.ReactNode; label: string; percent: number }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text-2)', marginBottom: 3 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>{icon} {label}</span>
        <span>{percent}%</span>
      </div>
      <div style={{ height: 4, borderRadius: 4, background: 'var(--bg-2)' }}>
        <div style={{
          height: '100%', borderRadius: 4, width: `${percent}%`,
          background: percent > 85 ? 'var(--err)' : 'linear-gradient(90deg, var(--accent), #a78bfa)',
          transition: 'width 0.6s ease'
        }} />
      </div>
    </div>
  )
}

function QuickBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className="btn-ghost btn press"
      style={{ padding: '8px 8px', fontSize: 11.5, justifyContent: 'flex-start', minWidth: 0, gap: 6 }}
      onClick={onClick}
      title={label}
    >
      <span style={{ display: 'flex', flexShrink: 0 }}>{icon}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 274,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: 14,
    borderLeft: '1px solid var(--border)',
    background: 'rgba(12, 12, 22, 0.45)',
    backdropFilter: 'blur(20px)',
    overflowY: 'auto'
  },
  block: {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 13
  },
  blockTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: 'var(--text-2)',
    marginBottom: 10
  },
  historyItem: {
    textAlign: 'left',
    padding: '6px 8px',
    borderRadius: 7,
    fontSize: 12.5,
    color: 'var(--text-1)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  }
}
