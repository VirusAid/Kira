/** Плавающий индикатор голосового режима с живым анимированным ядром Kira. */
import { Maximize2 } from 'lucide-react'
import { KiraEmblem } from './KiraEmblem'
import type { AvatarState } from './KiraEmblem'
import type { VoiceState } from '@/voice/useVoice'

interface Props {
  state: VoiceState
  level: number
  error: string
  onExpand: () => void
  onStop: () => void
}

function toAvatar(s: VoiceState): AvatarState {
  if (s === 'listening' || s === 'recording') return 'listening'
  if (s === 'transcribing' || s === 'thinking') return 'thinking'
  if (s === 'speaking') return 'speaking'
  return 'idle'
}

export function VoiceOverlay({ state, level, error, onExpand, onStop }: Props) {
  if (state === 'off') return null

  const label =
    state === 'listening' ? 'Слушаю тебя…'
    : state === 'recording' ? 'Записываю'
    : state === 'transcribing' ? 'Распознаю речь…'
    : state === 'thinking' ? 'Обдумываю ответ…'
    : 'Говорю — перебей, если что'

  return (
    <div style={styles.wrap} className="pop-in">
      <div style={styles.inner}>
        <div style={{ width: 48, height: 48, marginLeft: -4 }}>
          <KiraEmblem size={48} state={toAvatar(state)} level={level} />
        </div>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 650 }}>{label}</div>
          {error && <div style={{ fontSize: 11.5, color: 'var(--err)', maxWidth: 300 }}>{error}</div>}
        </div>
        <button className="icon-btn press" title="На весь экран" onClick={onExpand}>
          <Maximize2 size={16} />
        </button>
        <button className="btn btn-ghost press" style={{ padding: '6px 13px' }} onClick={onStop}>
          Выключить
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)',
    zIndex: 90
  },
  inner: {
    display: 'flex', alignItems: 'center', gap: 16,
    padding: '10px 20px 10px 12px',
    background: 'rgba(18, 18, 34, 0.85)', backdropFilter: 'blur(22px)',
    border: '1px solid var(--border-strong)', borderRadius: 20,
    boxShadow: 'var(--shadow), 0 0 30px rgba(139, 92, 246, 0.18)'
  }
}
