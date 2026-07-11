/** Память — долговременная память Kira с редактированием через интерфейс. */
import { useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, Pin, PinOff, Brain, Search, Sparkles, Loader2 } from 'lucide-react'
import { useMemoryStore } from '@/state/dataStores'
import { kira } from '@/api'
import { timeAgo } from './HomeView'
import type { MemoryCategory, MemoryEntry } from '@shared/types'

const CATEGORIES: { id: MemoryCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'preference', label: 'Предпочтения' },
  { id: 'project', label: 'Проекты' },
  { id: 'note', label: 'Заметки' },
  { id: 'contact', label: 'Контакты' },
  { id: 'fact', label: 'Факты' },
  { id: 'setting', label: 'Настройки' }
]

const CAT_LABEL: Record<MemoryCategory, string> = {
  preference: 'Предпочтение',
  project: 'Проект',
  note: 'Заметка',
  contact: 'Контакт',
  fact: 'Факт',
  setting: 'Настройка'
}

export function MemoryView() {
  const { entries, save, remove } = useMemoryStore()
  const [filter, setFilter] = useState<MemoryCategory | 'all'>('all')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Partial<MemoryEntry> | null>(null)
  const [semReady, setSemReady] = useState<boolean | null>(null)
  const [semInstalling, setSemInstalling] = useState(false)
  const [semLog, setSemLog] = useState('')

  useEffect(() => { void kira.semantic.available().then(setSemReady) }, [])

  const installSemantic = async (): Promise<void> => {
    setSemInstalling(true)
    setSemLog('Устанавливаю…')
    const off = kira.on('semantic:install-progress', (l) => setSemLog(String(l)))
    try {
      const res = await kira.semantic.install()
      setSemLog(res.message)
      if (res.ok) setSemReady(true)
    } finally { off(); setSemInstalling(false) }
  }

  const filtered = useMemo(() => {
    let list = entries
    if (filter !== 'all') list = list.filter((e) => e.category === filter)
    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter((e) => `${e.title} ${e.content}`.toLowerCase().includes(q))
    }
    return [...list].sort(
      (a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || b.updatedAt - a.updatedAt
    )
  }, [entries, filter, query])

  return (
    <div className="view-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <h2 className="section-title">Память Kira</h2>
        <span className="badge">{entries.length} записей</span>
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <Search size={14} style={{ position: 'absolute', left: 11, top: 10, color: 'var(--text-2)' }} />
          <input style={{ paddingLeft: 32, width: 220 }} placeholder="Поиск в памяти"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={() => setEditing({ category: 'note' })}>
          <Plus size={15} /> Добавить
        </button>
      </div>

      {semReady === true && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 12.5, color: 'var(--ok)' }}>
          <Sparkles size={14} /> Семантическая память активна — Kira ищет по смыслу, а не только по словам.
        </div>
      )}
      {semReady === false && (
        <div className="card" style={{ marginBottom: 16, background: 'var(--bg-2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Sparkles size={15} style={{ color: 'var(--accent-text)' }} />
            <span style={{ fontWeight: 650, fontSize: 13 }}>Семантическая память</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-1)', marginBottom: 10, lineHeight: 1.5 }}>
            Поиск по <b>смыслу</b>, а не по словам: спросишь «что я говорил про работу?» — Kira найдёт нужный
            разговор, даже если слова «работа» там не было. Локально, офлайн (~220 МБ модель).
          </div>
          <button className="btn btn-primary press" onClick={() => void installSemantic()} disabled={semInstalling}>
            {semInstalling ? <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Sparkles size={14} />}
            {semInstalling ? 'Устанавливаю…' : 'Включить умную память'}
          </button>
          {semLog && <div style={{ fontFamily: 'Cascadia Code, monospace', fontSize: 11, marginTop: 10, color: 'var(--text-2)', maxHeight: 60, overflow: 'hidden' }}>{semLog}</div>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 7, marginBottom: 18, flexWrap: 'wrap' }}>
        {CATEGORIES.map((c) => (
          <button key={c.id}
            className="badge"
            style={{
              cursor: 'pointer', padding: '6px 14px',
              background: filter === c.id ? 'var(--accent)' : 'var(--accent-soft)',
              color: filter === c.id ? '#fff' : 'var(--accent-text)'
            }}
            onClick={() => setFilter(c.id)}>
            {c.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="empty-state">
          <Brain size={40} strokeWidth={1.2} />
          <p>Память пуста. Kira будет запоминать важное сама,<br />или добавь запись вручную.</p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 13 }}>
        {filtered.map((e) => (
          <div key={e.id} className="card anim-in" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="badge" style={{ fontSize: 10 }}>{CAT_LABEL[e.category]}</span>
              {e.source === 'kira' && <span className="muted" style={{ fontSize: 10.5 }}>сохранила Kira</span>}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                <button className="icon-btn" style={{ width: 26, height: 26 }}
                  onClick={() => void save({ id: e.id, pinned: !e.pinned })}>
                  {e.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                </button>
                <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => setEditing(e)}>
                  <Pencil size={13} />
                </button>
                <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => void remove(e.id)}>
                  <Trash2 size={13} />
                </button>
              </span>
            </div>
            <div style={{ fontWeight: 650, fontSize: 14 }}>{e.pinned && '📌 '}{e.title}</div>
            <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.55 }} className="selectable">{e.content}</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 'auto' }}>{timeAgo(e.updatedAt)}</div>
          </div>
        ))}
      </div>

      {editing && (
        <MemoryEditor
          entry={editing}
          onClose={() => setEditing(null)}
          onSave={(e) => { void save(e); setEditing(null) }}
        />
      )}
    </div>
  )
}

function MemoryEditor({ entry, onClose, onSave }: {
  entry: Partial<MemoryEntry>
  onClose: () => void
  onSave: (e: Partial<MemoryEntry>) => void
}) {
  const [title, setTitle] = useState(entry.title ?? '')
  const [content, setContent] = useState(entry.content ?? '')
  const [category, setCategory] = useState<MemoryCategory>(entry.category ?? 'note')

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div className="panel anim-in" style={{ width: 480, padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 16 }}>{entry.id ? 'Изменить запись' : 'Новая запись памяти'}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <select value={category} onChange={(e) => setCategory(e.target.value as MemoryCategory)}>
            {Object.entries(CAT_LABEL).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
          <input placeholder="Заголовок" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <textarea placeholder="Содержание" rows={5} value={content} onChange={(e) => setContent(e.target.value)} />
          <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
            <button className="btn btn-primary" disabled={!title.trim()}
              onClick={() => onSave({ ...entry, title, content, category })}>
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 120,
  background: 'rgba(5,5,12,0.65)', backdropFilter: 'blur(4px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  animation: 'fadeIn 0.15s ease'
}
