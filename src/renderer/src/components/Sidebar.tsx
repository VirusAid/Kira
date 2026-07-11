/** Левая навигационная панель. */
import {
  Home, MessageSquare, FolderKanban, Zap, Brain,
  HardDrive, Clock, Settings, ScrollText, Mic, MicOff, Activity, Plug
} from 'lucide-react'
import { useAppStore, type ViewId } from '@/state/appStore'
import type { VoiceState } from '@/voice/useVoice'

const NAV: { id: ViewId; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Главная', icon: Home },
  { id: 'chat', label: 'Чат', icon: MessageSquare },
  { id: 'projects', label: 'Проекты', icon: FolderKanban },
  { id: 'protocols', label: 'Протоколы', icon: Zap },
  { id: 'memory', label: 'Память', icon: Brain },
  { id: 'files', label: 'Файлы', icon: HardDrive },
  { id: 'automation', label: 'Автоматизация', icon: Clock },
  { id: 'integrations', label: 'Интеграции', icon: Plug },
  { id: 'systems', label: 'Центр систем', icon: Activity },
  { id: 'settings', label: 'Настройки', icon: Settings },
  { id: 'logs', label: 'Логи', icon: ScrollText }
]

interface Props {
  voiceState: VoiceState
  voiceLevel: number
  onToggleVoice: () => void
}

export function Sidebar({ voiceState, voiceLevel, onToggleVoice }: Props) {
  const { view, setView } = useAppStore()
  const voiceOn = voiceState !== 'off'

  return (
    <nav style={styles.nav}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {NAV.map(({ id, label, icon: Icon }) => {
          const active = view === id
          return (
            <button
              key={id}
              onClick={() => setView(id)}
              style={{
                ...styles.item,
                background: active ? 'var(--accent-soft)' : 'transparent',
                color: active ? 'var(--accent-text)' : 'var(--text-1)',
                borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent'
              }}
            >
              <Icon size={17} strokeWidth={active ? 2.4 : 1.9} />
              <span style={{ fontWeight: active ? 650 : 450 }}>{label}</span>
            </button>
          )
        })}
      </div>

      <button
        onClick={onToggleVoice}
        style={{
          ...styles.voiceBtn,
          background: voiceOn
            ? `linear-gradient(135deg, var(--accent), #6d28d9)`
            : 'var(--bg-2)',
          borderColor: voiceOn ? 'transparent' : 'var(--border)',
          boxShadow: voiceOn ? `0 0 ${14 + voiceLevel * 30}px var(--accent-glow)` : 'none'
        }}
        title={voiceOn ? 'Выключить голосовой режим' : 'Включить голосовой режим'}
      >
        {voiceOn ? <Mic size={17} /> : <MicOff size={17} />}
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>
          {voiceOn ? voiceLabel(voiceState) : 'Голос'}
        </span>
      </button>
    </nav>
  )
}

function voiceLabel(s: VoiceState): string {
  switch (s) {
    case 'listening': return 'Слушаю…'
    case 'recording': return 'Говори!'
    case 'transcribing': return 'Распознаю…'
    case 'thinking': return 'Думаю…'
    case 'speaking': return 'Говорю'
    default: return 'Голос'
  }
}

const styles: Record<string, React.CSSProperties> = {
  nav: {
    width: 208,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    padding: '14px 10px',
    borderRight: '1px solid var(--border)',
    background: 'rgba(12, 12, 22, 0.5)',
    backdropFilter: 'blur(20px)'
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    padding: '10px 12px',
    borderRadius: 10,
    fontSize: 13.5,
    transition: 'all 0.15s ease',
    textAlign: 'left'
  },
  voiceBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    padding: '11px',
    borderRadius: 12,
    border: '1px solid',
    color: '#fff',
    transition: 'all 0.2s ease'
  }
}
