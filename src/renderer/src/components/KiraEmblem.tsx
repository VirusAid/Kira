/**
 * KiraEmblem — фирменная анимированная эмблема Kira: звёздная мандала
 * (наложенные восьмиконечные звёзды) со свечением, вращением и реакцией на голос.
 * Заменяет прежний орб как основной символ ассистента.
 */
import { useId } from 'react'
import type { AvatarState } from './KiraAvatar'

interface Props {
  size?: number
  state?: AvatarState
  level?: number
}

/** Точки октаграммы {8/step} на окружности радиуса r. */
function octagram(cx: number, cy: number, r: number, step: number, rot = 0): string {
  const pts: string[] = []
  let idx = 0
  for (let n = 0; n < 8; n++) {
    const ang = (idx / 8) * Math.PI * 2 - Math.PI / 2 + rot
    pts.push(`${(cx + Math.cos(ang) * r).toFixed(2)},${(cy + Math.sin(ang) * r).toFixed(2)}`)
    idx = (idx + step) % 8
  }
  return 'M' + pts.join(' L') + ' Z'
}

export function KiraEmblem({ size = 200, state = 'idle', level = 0 }: Props) {
  const id = useId().replace(/:/g, '')
  const active = state !== 'idle'
  const cx = 100
  const cy = 100
  const spin = state === 'thinking' ? 8 : state === 'speaking' ? 16 : state === 'listening' ? 22 : 34
  const glow = 0.4 + (active ? level * 0.5 : 0)

  return (
    <div style={{ width: size, height: size, display: 'inline-block' }}>
      <svg viewBox="0 0 200 200" width={size} height={size} style={{ overflow: 'visible' }}>
        <defs>
          <radialGradient id={`g-${id}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.55 + glow * 0.3} />
            <stop offset="55%" stopColor="var(--accent)" stopOpacity="0.08" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`s-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#e9ddff" />
            <stop offset="55%" stopColor="var(--accent-text)" />
            <stop offset="100%" stopColor="var(--accent)" />
          </linearGradient>
          <filter id={`f-${id}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={active ? 2.4 : 1.6} result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* внешнее свечение */}
        <circle cx={cx} cy={cy} r="96" fill={`url(#g-${id})`}
          style={{ transformOrigin: 'center', animation: `kiraGlow ${active ? 2 : 3.6}s ease-in-out infinite` }} />

        {/* вращающееся пунктирное кольцо */}
        <g style={{ transformOrigin: 'center', animation: `kiraSpin ${spin * 1.4}s linear infinite` }}>
          <circle cx={cx} cy={cy} r="88" fill="none" stroke="var(--accent)" strokeOpacity="0.28"
            strokeWidth="1" strokeDasharray="2 9" />
        </g>
        {/* основное кольцо */}
        <circle cx={cx} cy={cy} r="82" fill="none" stroke="var(--accent)" strokeOpacity="0.4" strokeWidth="1.4"
          style={{ transformOrigin: 'center', animation: `kiraBreath ${active ? 2.4 : 4}s ease-in-out infinite` }} />

        {/* мандала: наложенные звёзды, медленно вращаются в разные стороны */}
        <g filter={`url(#f-${id})`} style={{ transformOrigin: 'center' }}>
          <g style={{ transformOrigin: 'center', animation: `kiraSpin ${spin}s linear infinite` }}>
            <path d={octagram(cx, cy, 70, 3)} fill="none" stroke={`url(#s-${id})`} strokeWidth="1.8" strokeLinejoin="round" strokeOpacity="0.95" />
            <path d={octagram(cx, cy, 70, 3, Math.PI / 8)} fill="none" stroke="var(--accent-text)" strokeWidth="1.2" strokeLinejoin="round" strokeOpacity="0.6" />
          </g>
          <g style={{ transformOrigin: 'center', animation: `kiraSpinRev ${spin * 0.8}s linear infinite` }}>
            <path d={octagram(cx, cy, 48, 3)} fill="none" stroke={`url(#s-${id})`} strokeWidth="1.6" strokeLinejoin="round" strokeOpacity="0.9" />
            <path d={octagram(cx, cy, 34, 3, Math.PI / 8)} fill="none" stroke="var(--accent-text)" strokeWidth="1.2" strokeLinejoin="round" strokeOpacity="0.7" />
          </g>
        </g>

        {/* центральная пульсирующая звезда */}
        <g style={{ transformOrigin: 'center', transform: `scale(${1 + (state === 'speaking' ? level * 0.35 : 0)})`, transition: 'transform 0.08s ease' }}>
          <path d={octagram(cx, cy, 15, 3)} fill="var(--accent)" fillOpacity="0.9"
            style={{ transformOrigin: 'center', animation: 'kiraPulseCore 1.6s ease-in-out infinite' }} />
          <circle cx={cx} cy={cy} r="4" fill="#fff" />
        </g>
      </svg>
    </div>
  )
}
