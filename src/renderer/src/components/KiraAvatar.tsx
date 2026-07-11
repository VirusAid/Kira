/**
 * KiraAvatar — живое анимированное «лицо» Kira.
 *
 * Реактивный SVG-орб с ядром, орбитальными кольцами, частицами и свечением.
 * Меняет поведение в зависимости от состояния разговора:
 *   idle       — спокойное «дыхание»
 *   listening  — кольца расширяются, реагируют на голос (уровень микрофона)
 *   thinking   — ускоренное вращение
 *   speaking   — пульсация синхронно с речью
 */
import { useId } from 'react'

export type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking'

interface Props {
  size?: number
  state?: AvatarState
  /** Уровень громкости 0..1 (для listening/speaking) */
  level?: number
}

export function KiraAvatar({ size = 120, state = 'idle', level = 0 }: Props) {
  const id = useId().replace(/:/g, '')
  const active = state !== 'idle'
  const spin = state === 'thinking' ? 3 : state === 'speaking' ? 8 : 16
  const coreScale = 1 + (state === 'speaking' ? level * 0.35 : 0)
  const ringPush = state === 'listening' ? level * 10 : 0

  return (
    <div style={{ width: size, height: size, position: 'relative', display: 'inline-block' }}>
      <svg viewBox="0 0 200 200" width={size} height={size} style={{ overflow: 'visible' }}>
        <defs>
          <radialGradient id={`core-${id}`} cx="38%" cy="32%" r="75%">
            <stop offset="0%" stopColor="#f3edff" />
            <stop offset="42%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="#2b0f66" />
          </radialGradient>
          <radialGradient id={`glow-${id}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.55" />
            <stop offset="70%" stopColor="var(--accent)" stopOpacity="0.08" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
          <filter id={`blur-${id}`}>
            <feGaussianBlur stdDeviation="2.4" />
          </filter>
        </defs>

        {/* Внешнее свечение */}
        <circle cx="100" cy="100" r="92" fill={`url(#glow-${id})`}
          style={{ animation: `kiraGlow ${active ? 2 : 3.6}s ease-in-out infinite`, transformOrigin: 'center' }} />

        {/* Орбитальные кольца */}
        <g style={{ transformOrigin: 'center', animation: `kiraSpin ${spin}s linear infinite` }}>
          <ellipse cx="100" cy="100" rx={78 + ringPush} ry={30 + ringPush * 0.5}
            fill="none" stroke="var(--accent)" strokeOpacity="0.35" strokeWidth="1.5" />
          <ellipse cx="100" cy="100" rx={30 + ringPush * 0.5} ry={78 + ringPush}
            fill="none" stroke="var(--accent)" strokeOpacity="0.28" strokeWidth="1.5" />
          {/* точки-спутники на кольцах */}
          <circle cx="178" cy="100" r="3.4" fill="#d8ccff">
            <animate attributeName="r" values="3;4.5;3" dur="2s" repeatCount="indefinite" />
          </circle>
          <circle cx="100" cy="178" r="3" fill="#c4b5fd" />
        </g>

        <g style={{ transformOrigin: 'center', animation: `kiraSpinRev ${spin * 1.6}s linear infinite` }}>
          <ellipse cx="100" cy="100" rx="60" ry="60" fill="none"
            stroke="var(--accent)" strokeOpacity="0.16" strokeWidth="1"
            strokeDasharray="4 8" />
        </g>

        {/* Пульсирующие волны при говорении/слушании */}
        {active && (
          <>
            <circle cx="100" cy="100" r="52" fill="none" stroke="var(--accent)" strokeOpacity="0.5"
              style={{ animation: 'kiraWave 1.8s ease-out infinite' }} />
            <circle cx="100" cy="100" r="52" fill="none" stroke="var(--accent)" strokeOpacity="0.4"
              style={{ animation: 'kiraWave 1.8s ease-out 0.9s infinite' }} />
          </>
        )}

        {/* Ядро */}
        <g style={{ transformOrigin: 'center', transform: `scale(${coreScale})`, transition: 'transform 0.08s ease' }}>
          <circle cx="100" cy="100" r="44" fill={`url(#core-${id})`}
            style={{ animation: `kiraBreath ${active ? 2.2 : 3.8}s ease-in-out infinite`, transformOrigin: 'center' }} />
          {/* блик */}
          <ellipse cx="84" cy="82" rx="16" ry="11" fill="#ffffff" opacity="0.5" filter={`url(#blur-${id})`} />
          {/* внутреннее свечение-сердце */}
          <circle cx="100" cy="100" r="20" fill="var(--accent)" opacity="0.5"
            style={{ animation: 'kiraPulseCore 1.6s ease-in-out infinite', transformOrigin: 'center' }} />
        </g>
      </svg>
    </div>
  )
}
