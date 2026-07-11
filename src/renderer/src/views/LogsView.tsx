/** Логи: журнал всех событий приложения с фильтрами по уровню. */
import { useMemo, useState } from 'react'
import { Trash2, Search, ScrollText, Info, AlertTriangle, XCircle, Zap, Sparkles } from 'lucide-react'
import { useLogStore } from '@/state/dataStores'
import type { LogLevel } from '@shared/types'

const LEVELS: { id: LogLevel | 'all'; label: string; color: string; icon: typeof Info }[] = [
  { id: 'all', label: 'Все', color: 'var(--text-1)', icon: ScrollText },
  { id: 'info', label: 'Инфо', color: 'var(--info)', icon: Info },
  { id: 'action', label: 'Действия', color: 'var(--accent-text)', icon: Zap },
  { id: 'ai', label: 'Kira', color: '#c4b5fd', icon: Sparkles },
  { id: 'warn', label: 'Предупреждения', color: 'var(--warn)', icon: AlertTriangle },
  { id: 'error', label: 'Ошибки', color: 'var(--err)', icon: XCircle }
]

const LEVEL_COLOR: Record<LogLevel, string> = {
  info: 'var(--info)',
  action: 'var(--accent-text)',
  ai: '#c4b5fd',
  warn: 'var(--warn)',
  error: 'var(--err)'
}

export function LogsView() {
  const { logs, clear } = useLogStore()
  const [filter, setFilter] = useState<LogLevel | 'all'>('all')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    let list = logs
    if (filter !== 'all') list = list.filter((l) => l.level === filter)
    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter((l) => `${l.message} ${l.source}`.toLowerCase().includes(q))
    }
    return list
  }, [logs, filter, query])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const l of logs) c[l.level] = (c[l.level] ?? 0) + 1
    return c
  }, [logs])

  return (
    <div className="view-container" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <h2 className="section-title">Логи</h2>
        <span className="badge">{logs.length}</span>
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <Search size={14} style={{ position: 'absolute', left: 11, top: 10, color: 'var(--text-2)' }} />
          <input style={{ paddingLeft: 32, width: 240 }} placeholder="Поиск по логам"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button className="btn btn-danger" onClick={() => void clear()}>
          <Trash2 size={14} /> Очистить
        </button>
      </div>

      <div style={{ display: 'flex', gap: 7, marginBottom: 14, flexWrap: 'wrap' }}>
        {LEVELS.map((l) => {
          const Icon = l.icon
          const count = l.id === 'all' ? logs.length : counts[l.id] ?? 0
          return (
            <button key={l.id} className="badge"
              style={{
                cursor: 'pointer', padding: '6px 13px',
                background: filter === l.id ? 'var(--accent)' : 'var(--accent-soft)',
                color: filter === l.id ? '#fff' : 'var(--accent-text)'
              }}
              onClick={() => setFilter(l.id)}>
              <Icon size={12} /> {l.label} {count > 0 && <span style={{ opacity: 0.7 }}>({count})</span>}
            </button>
          )
        })}
      </div>

      <div className="panel" style={{ flex: 1, overflowY: 'auto', padding: 4, fontFamily: 'Cascadia Code, Consolas, monospace' }}>
        {filtered.length === 0 && (
          <div className="empty-state"><ScrollText size={36} strokeWidth={1.2} /><p>Записей нет</p></div>
        )}
        {filtered.map((l) => (
          <div key={l.id} style={{
            display: 'flex', gap: 12, padding: '6px 12px', borderRadius: 7, fontSize: 12.3,
            borderLeft: `2px solid ${LEVEL_COLOR[l.level]}`, marginBottom: 1,
            background: l.level === 'error' ? 'rgba(248,113,113,0.05)' : 'transparent'
          }}>
            <span className="muted" style={{ flexShrink: 0, fontSize: 11.5 }}>
              {new Date(l.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <span style={{ color: LEVEL_COLOR[l.level], flexShrink: 0, width: 62, fontWeight: 600 }}>
              {l.level.toUpperCase()}
            </span>
            <span style={{ color: 'var(--text-2)', flexShrink: 0, width: 78 }}>{l.source}</span>
            <span style={{ color: 'var(--text-1)', wordBreak: 'break-word' }} className="selectable">{l.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
