/**
 * ImmersiveVoice — полноэкранный «разговор с Kira»: большое живое ядро в центре,
 * реактивная анимация, живые подписи (что сказал ты / что отвечает Kira).
 * Это основная анимация общения.
 */
import { useEffect, useRef, useState } from 'react'
import { Minimize2, X } from 'lucide-react'
import { KiraEmblem } from './KiraEmblem'
import { useChatStore } from '@/state/chatStore'
import type { VoiceState } from '@/voice/useVoice'
import type { AvatarState } from './KiraEmblem'

interface Props {
  state: VoiceState
  level: number
  onMinimize: () => void
  onStop: () => void
}

function toAvatar(s: VoiceState): AvatarState {
  if (s === 'listening' || s === 'recording') return 'listening'
  if (s === 'transcribing' || s === 'thinking') return 'thinking'
  if (s === 'speaking') return 'speaking'
  return 'idle'
}

const LABEL: Record<VoiceState, string> = {
  off: '',
  listening: 'Слушаю тебя',
  recording: 'Говори…',
  transcribing: 'Распознаю',
  thinking: 'Думаю',
  speaking: 'Отвечаю'
}

export function ImmersiveVoice({ state, level, onMinimize, onStop }: Props) {
  const { messages, streamText, streaming } = useChatStore()
  const [dots, setDots] = useState('')

  useEffect(() => {
    const id = setInterval(() => setDots((d) => (d.length >= 3 ? '' : d + '·')), 400)
    return () => clearInterval(id)
  }, [])

  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && !m.error)

  // что показываем крупной подписью
  const caption =
    state === 'speaking' || (streaming && streamText)
      ? streamText || lastAssistant?.content || ''
      : state === 'recording' || state === 'listening'
        ? lastUser?.content || 'Скажи что-нибудь…'
        : streaming
          ? 'Обдумываю ответ' + dots
          : lastAssistant?.content || lastUser?.content || 'Я слушаю тебя'

  return (
    <div style={styles.overlay} className="anim-in">
      <div style={styles.controls}>
        <button className="icon-btn press" title="Свернуть" onClick={onMinimize}><Minimize2 size={18} /></button>
        <button className="icon-btn press" title="Выключить голос" onClick={onStop}><X size={18} /></button>
      </div>

      <div style={styles.center}>
        <KiraEmblem size={300} state={toAvatar(state)} level={level} />
        <div style={styles.stateLabel}>
          {LABEL[state]}{(state === 'listening' || state === 'thinking' || state === 'transcribing') ? dots : ''}
        </div>
      </div>

      <div style={styles.captionWrap}>
        <div style={{
          ...styles.caption,
          color: state === 'speaking' || streaming ? 'var(--text-0)' : 'var(--text-1)'
        }}>
          {caption.slice(0, 420)}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 14 }}>
          Просто говори — я слышу тебя. Можешь перебить в любой момент.
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 95,
    background: 'radial-gradient(1200px 800px at 50% 40%, rgba(20,16,40,0.86), rgba(6,6,14,0.96))',
    backdropFilter: 'blur(30px)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 20
  },
  controls: { position: 'absolute', top: 18, right: 20, display: 'flex', gap: 6 },
  center: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 },
  stateLabel: {
    fontSize: 15, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase',
    color: 'var(--accent-text)', marginTop: -6
  },
  captionWrap: { maxWidth: 640, textAlign: 'center', padding: '0 30px', minHeight: 90 },
  caption: { fontSize: 20, lineHeight: 1.5, fontWeight: 500, transition: 'color 0.3s' }
}
