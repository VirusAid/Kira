/** Кастомный тайтлбар (окно без рамки): логотип, поиск, управление окном. */
import { Minus, Square, X, Search, PanelRight } from 'lucide-react'
import { kira } from '@/api'
import { useAppStore } from '@/state/appStore'
import { KiraEmblem } from './KiraEmblem'

export function TitleBar() {
  const { setSearchOpen, toggleRightPanel } = useAppStore()

  return (
    <div style={styles.bar}>
      <div style={styles.brand}>
        <KiraEmblem size={26} state="idle" />
        <span style={styles.title}>KIRA</span>
        <span className="muted" style={{ fontSize: 11 }}>персональный ассистент</span>
      </div>

      <button style={styles.searchBox} onClick={() => setSearchOpen(true)}>
        <Search size={13} />
        <span>Глобальный поиск</span>
        <kbd style={styles.kbd}>Ctrl+K</kbd>
      </button>

      <div style={styles.controls}>
        <button className="icon-btn" onClick={toggleRightPanel} title="Правая панель">
          <PanelRight size={15} />
        </button>
        <button className="icon-btn" onClick={() => void kira.window.minimize()}>
          <Minus size={15} />
        </button>
        <button className="icon-btn" onClick={() => void kira.window.maximize()}>
          <Square size={12} />
        </button>
        <button
          className="icon-btn"
          style={{ marginRight: 4 }}
          onClick={() => void kira.window.close()}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(248,113,113,0.2)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '')}
        >
          <X size={15} />
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    height: 44,
    padding: '0 6px 0 16px',
    borderBottom: '1px solid var(--border)',
    background: 'rgba(10, 10, 20, 0.6)',
    backdropFilter: 'blur(20px)',
    WebkitAppRegion: 'drag',
    flexShrink: 0
  } as React.CSSProperties,
  brand: { display: 'flex', alignItems: 'center', gap: 10, flex: 1 },
  orb: {
    width: 14,
    height: 14,
    borderRadius: '50%',
    background: 'radial-gradient(circle at 35% 30%, #c4b5fd, var(--accent) 60%, #4c1d95)',
    animation: 'orbPulse 3.2s ease-in-out infinite'
  },
  title: { fontWeight: 800, letterSpacing: 4, fontSize: 13, color: 'var(--accent-text)' },
  searchBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 14px',
    borderRadius: 9,
    background: 'var(--bg-2)',
    border: '1px solid var(--border)',
    color: 'var(--text-2)',
    fontSize: 12.5,
    WebkitAppRegion: 'no-drag'
  } as React.CSSProperties,
  kbd: {
    fontSize: 10.5,
    padding: '1px 6px',
    borderRadius: 5,
    background: 'var(--accent-soft)',
    color: 'var(--accent-text)',
    border: '1px solid var(--border)'
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    flex: 1,
    justifyContent: 'flex-end',
    WebkitAppRegion: 'no-drag'
  } as React.CSSProperties
}
