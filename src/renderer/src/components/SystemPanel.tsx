/**
 * SystemPanel — центр управления системой: медиа, окна, процессы, запись экрана.
 * Открывается из правой панели. Новый функционал вынесен сюда, чтобы не
 * перегружать основную навигацию.
 */
import { useEffect, useRef, useState } from 'react'
import {
  X, Play, SkipBack, SkipForward, Pause, Volume2, VolumeX, Monitor,
  Cpu, AppWindow, Circle, StopCircle, RefreshCw, Trash2, Focus, Minimize2
} from 'lucide-react'
import { kira } from '@/api'
import type { ProcessInfo } from '@shared/types'

type Tab = 'media' | 'windows' | 'processes' | 'record'

export function SystemPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('media')

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div className="panel pop-in" style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <Monitor size={17} style={{ color: 'var(--accent-text)' }} />
          <span style={{ fontWeight: 700, fontSize: 15 }}>Центр управления системой</span>
          <button className="icon-btn press" style={{ marginLeft: 'auto' }} onClick={onClose}><X size={16} /></button>
        </div>

        <div style={styles.tabs}>
          {([['media', 'Медиа', Volume2], ['windows', 'Окна', AppWindow], ['processes', 'Процессы', Cpu], ['record', 'Запись экрана', Monitor]] as const).map(([id, label, Icon]) => (
            <button key={id} className="press" style={{
              ...styles.tab,
              color: tab === id ? 'var(--accent-text)' : 'var(--text-1)',
              borderBottom: `2px solid ${tab === id ? 'var(--accent)' : 'transparent'}`
            }} onClick={() => setTab(id)}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        <div style={styles.body}>
          {tab === 'media' && <MediaTab />}
          {tab === 'windows' && <WindowsTab />}
          {tab === 'processes' && <ProcessesTab />}
          {tab === 'record' && <RecordTab />}
        </div>
      </div>
    </div>
  )
}

function MediaTab() {
  const [muted, setMuted] = useState(false)
  const media = (action: string): void => void kira.system.media(action)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center', padding: '20px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button className="icon-btn press" style={{ width: 46, height: 46 }} onClick={() => media('prev')}><SkipBack size={20} /></button>
        <button className="btn btn-primary press" style={{ width: 60, height: 60, borderRadius: '50%', justifyContent: 'center', padding: 0 }}
          onClick={() => media('playpause')}>
          <Play size={24} />
        </button>
        <button className="icon-btn press" style={{ width: 46, height: 46 }} onClick={() => media('next')}><SkipForward size={20} /></button>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-ghost press" onClick={() => media('voldown')}><Volume2 size={14} /> Тише</button>
        <button className="btn btn-ghost press" onClick={() => media('volup')}><Volume2 size={14} /> Громче</button>
        <button className="btn btn-ghost press" onClick={() => { media('volmute'); setMuted((m) => !m) }}>
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />} Без звука
        </button>
        <button className="btn btn-ghost press" onClick={() => media('pause')}><Pause size={14} /> Стоп</button>
      </div>
      <p className="muted" style={{ fontSize: 12, textAlign: 'center', maxWidth: 340 }}>
        Управляет любым плеером через мультимедийные клавиши: Spotify, YouTube, музыка, видео.
      </p>
    </div>
  )
}

function WindowsTab() {
  const [windows, setWindows] = useState<{ handle: number; title: string; processName: string }[]>([])
  const [loading, setLoading] = useState(true)

  const load = (): void => {
    setLoading(true)
    void kira.system.windows().then((w) => { setWindows(w); setLoading(false) })
  }
  useEffect(load, [])

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className="btn btn-ghost press" onClick={load}><RefreshCw size={13} /> Обновить</button>
        <button className="btn btn-ghost press" onClick={() => void kira.system.minimizeAll()}>
          <Minimize2 size={13} /> Свернуть всё
        </button>
      </div>
      {loading && <div className="muted" style={{ padding: 12 }}>Загрузка окон…</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 320, overflowY: 'auto' }}>
        {windows.map((w) => (
          <div key={w.handle} className="hover-lift" style={styles.row}>
            <AppWindow size={15} style={{ color: 'var(--accent-text)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.title}</div>
              <div className="muted" style={{ fontSize: 11 }}>{w.processName}</div>
            </div>
            <button className="icon-btn press" title="Переключиться"
              onClick={() => void kira.system.windowAction(w.processName, 'focus')}><Focus size={14} /></button>
            <button className="icon-btn press" title="Свернуть"
              onClick={() => void kira.system.windowAction(w.processName, 'minimize')}><Minimize2 size={14} /></button>
            <button className="icon-btn press" title="Закрыть"
              onClick={() => { void kira.system.windowAction(w.processName, 'close').then(() => setTimeout(load, 400)) }}>
              <X size={14} />
            </button>
          </div>
        ))}
        {!loading && windows.length === 0 && <div className="muted" style={{ padding: 12 }}>Открытых окон не найдено</div>}
      </div>
    </div>
  )
}

function ProcessesTab() {
  const [procs, setProcs] = useState<ProcessInfo[]>([])
  const [loading, setLoading] = useState(true)

  const load = (): void => {
    setLoading(true)
    void kira.system.processes().then((p) => { setProcs(p); setLoading(false) })
  }
  useEffect(load, [])

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <button className="btn btn-ghost press" onClick={load}><RefreshCw size={13} /> Обновить</button>
        <span className="muted" style={{ fontSize: 12 }}>Топ процессов по памяти</span>
      </div>
      {loading && <div className="muted" style={{ padding: 12 }}>Загрузка процессов…</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 320, overflowY: 'auto' }}>
        {procs.map((p) => (
          <div key={p.pid} style={styles.row}>
            <Cpu size={14} style={{ color: 'var(--text-2)', flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
            <span className="muted" style={{ fontSize: 11.5, width: 70, textAlign: 'right' }}>{p.memoryMB} МБ</span>
            <span className="muted" style={{ fontSize: 11, width: 54, textAlign: 'right' }}>#{p.pid}</span>
            <button className="icon-btn press" title="Завершить процесс"
              onClick={() => { void kira.system.kill(String(p.pid)).then(() => setTimeout(load, 300)) }}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function RecordTab() {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [saved, setSaved] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval>>()

  const start = async (): Promise<void> => {
    setSaved('')
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = await (navigator.mediaDevices as any).getUserMedia({
        audio: false,
        video: { mandatory: { chromeMediaSource: 'desktop' } }
      })
      chunksRef.current = []
      const recorder = new MediaRecorder(stream as MediaStream, { mimeType: 'video/webm' })
      recorderRef.current = recorder
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        ;(stream as MediaStream).getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'video/webm' })
        const base64 = await blobToBase64(blob)
        const result = await kira.system.saveRecording(base64)
        setSaved(result.message)
      }
      recorder.start()
      setRecording(true)
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)
    } catch {
      setSaved('Не удалось начать запись экрана')
    }
  }

  const stop = (): void => {
    recorderRef.current?.stop()
    setRecording(false)
    clearInterval(timerRef.current)
  }

  useEffect(() => () => clearInterval(timerRef.current), [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'center', padding: '24px 0' }}>
      {recording ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--err)', animation: 'recPulse 1.4s infinite' }} />
            <span style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}
            </span>
          </div>
          <button className="btn btn-danger press" onClick={stop}><StopCircle size={16} /> Остановить и сохранить</button>
        </>
      ) : (
        <>
          <Monitor size={40} strokeWidth={1.2} style={{ color: 'var(--accent-text)' }} />
          <button className="btn btn-primary press" onClick={() => void start()}>
            <Circle size={14} fill="currentColor" /> Начать запись экрана
          </button>
          <p className="muted" style={{ fontSize: 12, textAlign: 'center', maxWidth: 320 }}>
            Запись сохранится в «Видео → Kira Recordings» в формате WebM.
          </p>
        </>
      )}
      {saved && <div style={{ fontSize: 12.5, color: 'var(--accent-text)', textAlign: 'center', maxWidth: 360 }}>{saved}</div>}
    </div>
  )
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 130,
    background: 'rgba(5,5,12,0.65)', backdropFilter: 'blur(5px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    animation: 'fadeIn 0.15s ease'
  },
  modal: { width: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { display: 'flex', alignItems: 'center', gap: 10, padding: '15px 18px', borderBottom: '1px solid var(--border)' },
  tabs: { display: 'flex', gap: 4, padding: '0 12px', borderBottom: '1px solid var(--border)' },
  tab: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '11px 14px',
    fontSize: 12.5, fontWeight: 600, transition: 'all 0.15s'
  },
  body: { padding: 18, overflowY: 'auto' },
  row: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '8px 11px', borderRadius: 9, background: 'var(--bg-2)',
    border: '1px solid var(--border)'
  }
}
