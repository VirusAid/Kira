/** Глобальный поиск (Ctrl+K) — по чатам, проектам, памяти, протоколам, логам. */
import { useEffect, useRef, useState } from 'react'
import { Search, MessageSquare, FolderKanban, Brain, Zap, ScrollText, FileText, Sparkles } from 'lucide-react'
import { kira } from '@/api'
import { useAppStore } from '@/state/appStore'
import { useChatStore } from '@/state/chatStore'
import type { SearchResult } from '@shared/types'

const TYPE_ICON: Record<SearchResult['type'], typeof Search> = {
  chat: MessageSquare,
  message: MessageSquare,
  project: FolderKanban,
  memory: Brain,
  protocol: Zap,
  ability: Sparkles,
  log: ScrollText,
  file: FileText
}

const TYPE_LABEL: Record<SearchResult['type'], string> = {
  chat: 'Диалог',
  message: 'Сообщение',
  project: 'Проект',
  memory: 'Память',
  protocol: 'Протокол',
  ability: 'Навык',
  log: 'Лог',
  file: 'Файл'
}

export function GlobalSearch() {
  const { searchOpen, setSearchOpen, setView, setOpenProject } = useAppStore()
  const openChat = useChatStore((s) => s.openChat)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (searchOpen) {
      setQuery('')
      setResults([])
      setSelected(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [searchOpen])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (query.trim().length < 2) {
      setResults([])
      return
    }
    debounceRef.current = setTimeout(() => {
      void kira.search.global(query).then((r) => {
        setResults(r)
        setSelected(0)
      })
    }, 220)
  }, [query])

  if (!searchOpen) return null

  const open = (r: SearchResult): void => {
    setSearchOpen(false)
    switch (r.type) {
      case 'chat':
        void openChat(r.id); setView('chat'); break
      case 'message':
        if (r.parentId) void openChat(r.parentId)
        setView('chat'); break
      case 'project':
        setOpenProject(r.id); break
      case 'memory':
        setView('memory'); break
      case 'protocol':
        setView('protocols'); break
      case 'ability':
        setView('abilities'); break
      case 'log':
        setView('logs'); break
      case 'file':
        setView('files'); break
    }
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') setSearchOpen(false)
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, results.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)) }
    if (e.key === 'Enter' && results[selected]) open(results[selected])
  }

  return (
    <div style={styles.overlay} onClick={() => setSearchOpen(false)}>
      <div className="panel anim-in" style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.inputRow}>
          <Search size={17} color="var(--text-2)" />
          <input
            ref={inputRef}
            style={styles.input}
            placeholder="Искать по чатам, проектам, памяти, протоколам, логам…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
          />
        </div>
        <div style={styles.results}>
          {query.length >= 2 && results.length === 0 && (
            <div className="muted" style={{ padding: 18, textAlign: 'center' }}>Ничего не найдено</div>
          )}
          {results.map((r, i) => {
            const Icon = TYPE_ICON[r.type]
            return (
              <button
                key={`${r.type}-${r.id}`}
                style={{ ...styles.result, background: i === selected ? 'var(--accent-soft)' : 'transparent' }}
                onMouseEnter={() => setSelected(i)}
                onClick={() => open(r)}
              >
                <Icon size={15} style={{ flexShrink: 0, color: 'var(--accent-text)' }} />
                <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.title}
                  </div>
                  <div className="muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.snippet}
                  </div>
                </div>
                <span className="badge" style={{ fontSize: 10 }}>{TYPE_LABEL[r.type]}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 100,
    background: 'rgba(5, 5, 12, 0.65)', backdropFilter: 'blur(4px)',
    display: 'flex', justifyContent: 'center', paddingTop: '12vh',
    animation: 'fadeIn 0.15s ease'
  },
  modal: { width: 620, maxHeight: '60vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  inputRow: {
    display: 'flex', alignItems: 'center', gap: 11,
    padding: '15px 18px', borderBottom: '1px solid var(--border)'
  },
  input: { flex: 1, background: 'none', border: 'none', boxShadow: 'none', padding: 0, fontSize: 15 },
  results: { overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 2 },
  result: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '9px 12px', borderRadius: 9, transition: 'background 0.1s'
  }
}
