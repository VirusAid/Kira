/**
 * Навигация Kira.
 *
 * Раньше это был плоский список из двенадцати вкладок — глаз не за что
 * зацепить. Теперь пункты собраны в четыре смысловые группы: сама Kira, её
 * знания, её действия и настройка. Так интерфейс читается за секунду, а не
 * перебирается по одному пункту.
 */
import {
  Blocks,
  Home, MessageSquare, FolderKanban, Zap, Brain,
  HardDrive, Clock, Settings, ScrollText, Mic, MicOff, Activity, Plug, Sparkles
} from 'lucide-react'
import { useAppStore, type ViewId } from '@/state/appStore'
import type { VoiceState } from '@/voice/useVoice'

interface NavItem { id: ViewId; label: string; icon: typeof Home }
interface NavGroup { title: string; items: NavItem[] }

const GROUPS: NavGroup[] = [
  {
    title: 'Кира',
    items: [
      { id: 'home', label: 'Командный центр', icon: Home },
      { id: 'chat', label: 'Диалог', icon: MessageSquare }
    ]
  },
  {
    title: 'Знания',
    items: [
      { id: 'memory', label: 'Память', icon: Brain },
      { id: 'files', label: 'Файлы', icon: HardDrive },
      { id: 'projects', label: 'Проекты', icon: FolderKanban }
    ]
  },
  {
    title: 'Действия',
    items: [
      { id: 'abilities', label: 'Навыки', icon: Sparkles },
      { id: 'protocols', label: 'Сценарии', icon: Zap },
      { id: 'automation', label: 'Расписание', icon: Clock }
    ]
  },
  {
    title: 'Настройка',
    items: [
      { id: 'systems', label: 'Способности', icon: Activity },
      { id: 'integrations', label: 'Связи', icon: Plug },
      { id: 'extensions', label: 'Расширения', icon: Blocks },
      { id: 'settings', label: 'Настройки', icon: Settings },
      { id: 'logs', label: 'Журнал', icon: ScrollText }
    ]
  }
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
      <div style={styles.scroll}>
        {GROUPS.map((group) => (
          <div key={group.title} style={{ marginBottom: 14 }}>
            <div className="hud-label" style={styles.groupTitle}>{group.title}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {group.items.map(({ id, label, icon: Icon }) => {
                const active = view === id
                return (
                  <button
                    key={id}
                    onClick={() => setView(id)}
                    className={active ? 'nav-active' : undefined}
                    style={{
                      ...styles.item,
                      background: active ? 'var(--accent-soft)' : 'transparent',
                      color: active ? 'var(--accent-text)' : 'var(--text-1)'
                    }}
                  >
                    <Icon size={16} strokeWidth={active ? 2.4 : 1.9} />
                    <span style={{ fontWeight: active ? 650 : 450 }}>{label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={onToggleVoice}
        style={{
          ...styles.voiceBtn,
          background: voiceOn
            ? 'linear-gradient(135deg, var(--accent), #6d28d9)'
            : 'var(--bg-2)',
          borderColor: voiceOn ? 'transparent' : 'var(--border)',
          // свечение дышит в такт голосу — кнопка живая, а не просто подсвеченная
          boxShadow: voiceOn ? `0 0 ${14 + voiceLevel * 34}px var(--accent-glow)` : 'none'
        }}
        title={voiceOn ? 'Выключить голос' : 'Говорить с Kira'}
      >
        {voiceOn ? <Mic size={17} /> : <MicOff size={17} />}
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>
          {voiceOn ? voiceLabel(voiceState) : 'Говорить'}
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
    default: return 'Говорить'
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
  scroll: { flex: 1, minHeight: 0, overflowY: 'auto' },
  groupTitle: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: 'var(--text-2)',
    padding: '0 0 6px 11px'
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 12px',
    borderRadius: 10,
    fontSize: 13,
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
    marginTop: 10,
    transition: 'all 0.2s ease'
  }
}
