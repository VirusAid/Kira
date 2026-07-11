/**
 * KiraCore — живое «ядро» Kira на canvas. Плавная реактивная анимация:
 *  • пульсирующее свечение и «дыхание»
 *  • орбитальные частицы, скорость зависит от состояния
 *  • звуковая волна-кольцо, реагирующая на уровень микрофона/речи
 *  • всплески-волны при говорении/слушании
 *
 * Реагирует на props level (0..1) и state (idle/listening/thinking/speaking).
 */
import { useEffect, useRef } from 'react'
import type { AvatarState } from './KiraAvatar'

interface Props {
  size?: number
  state?: AvatarState
  level?: number
}

interface Particle {
  angle: number
  radius: number
  speed: number
  size: number
  phase: number
}

interface Ripple {
  radius: number
  alpha: number
}

function accentRGB(): [number, number, number] {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(v)
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
  return [139, 92, 246]
}

export function KiraCore({ size = 220, state = 'idle', level = 0 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef(state)
  const levelRef = useRef(level)
  const rafRef = useRef(0)

  stateRef.current = state
  levelRef.current = level

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.scale(dpr, dpr)

    const cx = size / 2
    const cy = size / 2
    const baseR = size * 0.17

    const particles: Particle[] = Array.from({ length: 46 }, () => ({
      angle: Math.random() * Math.PI * 2,
      radius: baseR * (1.7 + Math.random() * 1.8),
      speed: (0.002 + Math.random() * 0.004) * (Math.random() > 0.5 ? 1 : -1),
      size: 0.6 + Math.random() * 1.8,
      phase: Math.random() * Math.PI * 2
    }))
    const ripples: Ripple[] = []

    let t = 0
    let smoothLevel = 0
    let rippleTimer = 0
    let [r, g, b] = accentRGB()
    let colorTick = 0

    const draw = (): void => {
      t += 1
      const st = stateRef.current
      const active = st !== 'idle'
      smoothLevel += (levelRef.current - smoothLevel) * 0.2

      // цвет акцента подхватываем изредка (если пользователь сменил тему)
      if (++colorTick > 120) { colorTick = 0; ;[r, g, b] = accentRGB() }

      ctx.clearRect(0, 0, size, size)
      ctx.globalCompositeOperation = 'lighter'

      const breath = 1 + Math.sin(t * (active ? 0.06 : 0.03)) * 0.06
      const pulse = st === 'speaking' ? smoothLevel * 0.5 : st === 'listening' ? smoothLevel * 0.35 : 0
      const coreR = baseR * (breath + pulse)

      // внешнее свечение
      const glow = ctx.createRadialGradient(cx, cy, coreR * 0.5, cx, cy, size * 0.5)
      glow.addColorStop(0, `rgba(${r},${g},${b},${0.30 + pulse * 0.4})`)
      glow.addColorStop(0.5, `rgba(${r},${g},${b},0.06)`)
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, size, size)

      // орбитальные частицы
      const speedMul = st === 'thinking' ? 3.2 : st === 'speaking' ? 1.8 : active ? 1.3 : 1
      for (const p of particles) {
        p.angle += p.speed * speedMul
        const wob = Math.sin(t * 0.02 + p.phase) * baseR * 0.25
        const rad = p.radius + wob + smoothLevel * baseR * 0.8
        const px = cx + Math.cos(p.angle) * rad
        const py = cy + Math.sin(p.angle) * rad * 0.62 // лёгкая эллиптичность
        const a = 0.25 + (Math.sin(t * 0.05 + p.phase) + 1) * 0.25
        ctx.beginPath()
        ctx.fillStyle = `rgba(${r},${g},${b},${a})`
        ctx.arc(px, py, p.size, 0, Math.PI * 2)
        ctx.fill()
      }

      // звуковая волна-кольцо (реагирует на уровень)
      const ringPts = 72
      const ringBase = baseR * 2.1 + smoothLevel * baseR * 1.4
      ctx.beginPath()
      for (let i = 0; i <= ringPts; i++) {
        const ang = (i / ringPts) * Math.PI * 2
        const noise =
          Math.sin(ang * 3 + t * 0.08) * (2 + smoothLevel * 14) +
          Math.sin(ang * 5 - t * 0.05) * (1.5 + smoothLevel * 8)
        const rr = ringBase + noise
        const px = cx + Math.cos(ang) * rr
        const py = cy + Math.sin(ang) * rr
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.strokeStyle = `rgba(${r},${g},${b},${0.35 + smoothLevel * 0.5})`
      ctx.lineWidth = 1.5
      ctx.stroke()

      // всплески-волны при активности
      rippleTimer++
      const emitEvery = st === 'speaking' ? 26 : st === 'listening' ? 40 : 0
      if (emitEvery && rippleTimer > emitEvery) {
        rippleTimer = 0
        ripples.push({ radius: coreR, alpha: 0.5 })
      }
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i]
        rp.radius += 1.6 + smoothLevel * 2
        rp.alpha -= 0.008
        if (rp.alpha <= 0) { ripples.splice(i, 1); continue }
        ctx.beginPath()
        ctx.strokeStyle = `rgba(${r},${g},${b},${rp.alpha})`
        ctx.lineWidth = 1.2
        ctx.arc(cx, cy, rp.radius, 0, Math.PI * 2)
        ctx.stroke()
      }

      // ядро
      ctx.globalCompositeOperation = 'source-over'
      const core = ctx.createRadialGradient(cx - coreR * 0.3, cy - coreR * 0.3, coreR * 0.1, cx, cy, coreR)
      core.addColorStop(0, '#ffffff')
      core.addColorStop(0.35, `rgb(${Math.min(255, r + 80)},${Math.min(255, g + 70)},${Math.min(255, b + 40)})`)
      core.addColorStop(1, `rgb(${Math.round(r * 0.5)},${Math.round(g * 0.35)},${Math.round(b * 0.7)})`)
      ctx.beginPath()
      ctx.fillStyle = core
      ctx.shadowColor = `rgba(${r},${g},${b},0.9)`
      ctx.shadowBlur = 24 + pulse * 40
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0

      // блик
      ctx.beginPath()
      ctx.fillStyle = 'rgba(255,255,255,0.4)'
      ctx.ellipse(cx - coreR * 0.32, cy - coreR * 0.36, coreR * 0.28, coreR * 0.18, -0.5, 0, Math.PI * 2)
      ctx.fill()

      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)

    return () => cancelAnimationFrame(rafRef.current)
  }, [size])

  return <canvas ref={canvasRef} style={{ width: size, height: size, display: 'block' }} />
}
