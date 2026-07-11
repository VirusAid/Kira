/**
 * Overlay — постоянная плавающая эмблема Kira поверх всех окон. Показывает
 * состояние голоса, клик — начать/остановить разговор из любого приложения.
 * Правый клик — открыть приложение Kira.
 */
import { useEffect, useState } from 'react'
import { KiraEmblem } from './components/KiraEmblem'
import { kira } from './api'
import type { AvatarState } from './components/KiraAvatar'

type VoiceState = 'off' | 'listening' | 'recording' | 'transcribing' | 'thinking' | 'speaking'

function toAvatar(s: VoiceState): AvatarState {
  if (s === 'listening' || s === 'recording') return 'listening'
  if (s === 'transcribing' || s === 'thinking') return 'thinking'
  if (s === 'speaking') return 'speaking'
  return 'idle'
}

const LABEL: Record<VoiceState, string> = {
  off: '', listening: 'Слушаю', recording: 'Говори…',
  transcribing: 'Распознаю', thinking: 'Думаю', speaking: 'Отвечаю'
}

export default function Overlay() {
  const [state, setState] = useState<VoiceState>('off')
  const [level, setLevel] = useState(0)
  const [active, setActive] = useState(false)

  useEffect(() => {
    return kira.on('overlay:state', (payload) => {
      const p = payload as { state: VoiceState; level: number; active: boolean }
      setState(p.state)
      setLevel(p.level)
      setActive(p.active)
    })
  }, [])

  return (
    <div
      style={styles.wrap}
      title="Клик — говорить с Kira · Правый клик — открыть"
      onClick={() => void kira.overlay.toggleVoice()}
      onContextMenu={(e) => { e.preventDefault(); void kira.overlay.openMain() }}
    >
      <KiraEmblem size={112} state={active ? toAvatar(state) : 'idle'} level={level} />
      {active && LABEL[state] && (
        <div style={styles.label}>{LABEL[state]}</div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    width: '100%', height: '100%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', position: 'relative'
  },
  label: {
    position: 'absolute', bottom: -2, left: '50%', transform: 'translateX(-50%)',
    fontSize: 10.5, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase',
    color: 'var(--accent-text)', textShadow: '0 2px 10px rgba(0,0,0,0.8)', whiteSpace: 'nowrap'
  }
}
