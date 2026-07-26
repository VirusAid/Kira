/**
 * Overlay — постоянная плавающая эмблема Kira поверх всех окон. Показывает
 * состояние голоса, клик — начать/остановить разговор из любого приложения.
 * Правый клик — открыть приложение Kira. Эмблему можно перетащить куда угодно.
 *
 * Круглая зона клика (мышь проходит насквозь мимо эмблемы) считается в главном
 * процессе — см. modules/overlay.ts.
 */
import { useEffect, useRef, useState } from 'react'
import { KiraEmblem } from './components/KiraEmblem'
import { kira } from './api'
import type { AvatarState } from './components/KiraEmblem'

type VoiceState = 'off' | 'listening' | 'recording' | 'transcribing' | 'thinking' | 'speaking'

/** Сдвиг, после которого это уже перетаскивание, а не клик (дрожь руки). */
const DRAG_SLOP = 4

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

  const draggingRef = useRef(false)
  const movedRef = useRef(false)
  const startRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    return kira.on('overlay:state', (payload) => {
      const p = payload as { state: VoiceState; level: number; active: boolean }
      setState(p.state)
      setLevel(p.level)
      setActive(p.active)
    })
  }, [])

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    draggingRef.current = true
    movedRef.current = false
    startRef.current = { x: e.screenX, y: e.screenY }
    e.currentTarget.setPointerCapture(e.pointerId)
    kira.overlay.dragStart()
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    if (!draggingRef.current || movedRef.current) return
    const dx = e.screenX - startRef.current.x
    const dy = e.screenY - startRef.current.y
    if (Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP) movedRef.current = true
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    if (!draggingRef.current) return
    draggingRef.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* уже отпущен */ }
    kira.overlay.dragEnd()
    // не сдвинули — значит это был клик, а не перетаскивание
    if (!movedRef.current) void kira.overlay.toggleVoice()
  }

  return (
    <div
      style={styles.wrap}
      title="Клик — говорить с Kira · Перетащи — переставить · Правый клик — открыть"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
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
    cursor: 'grab', position: 'relative',
    // перетаскивание эмблемы не должно выделять текст подписи
    userSelect: 'none', WebkitUserSelect: 'none'
  },
  label: {
    position: 'absolute', bottom: -2, left: '50%', transform: 'translateX(-50%)',
    fontSize: 10.5, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase',
    color: 'var(--accent-text)', textShadow: '0 2px 10px rgba(0,0,0,0.8)', whiteSpace: 'nowrap',
    pointerEvents: 'none'
  }
}
