/** Файловый менеджер: навигация, поиск, быстрый просмотр и редактирование. */
import { useCallback, useEffect, useState } from 'react'
import {
  Folder, FileText, FileCode, FileImage, FileArchive, FileVideo, FileAudio, File as FileIcon,
  ArrowUp, RefreshCw, Search, Trash2, PenLine, FolderPlus, ExternalLink, Save, X, HardDrive, Globe
} from 'lucide-react'
import { kira } from '@/api'
import { overlayStyle } from './MemoryView'
import type { FileItem } from '@shared/types'

function fileIcon(item: FileItem) {
  if (item.isDirectory) return <Folder size={16} style={{ color: 'var(--accent-text)' }} />
  const codeExts = ['.js', '.ts', '.tsx', '.jsx', '.py', '.html', '.css', '.json', '.cs', '.cpp', '.go', '.rs', '.java']
  if (codeExts.includes(item.ext)) return <FileCode size={16} style={{ color: '#7dd3fc' }} />
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'].includes(item.ext)) return <FileImage size={16} style={{ color: '#86efac' }} />
  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(item.ext)) return <FileArchive size={16} style={{ color: '#fcd34d' }} />
  if (['.mp4', '.mkv', '.avi', '.mov', '.webm'].includes(item.ext)) return <FileVideo size={16} style={{ color: '#f0abfc' }} />
  if (['.mp3', '.wav', '.flac', '.ogg'].includes(item.ext)) return <FileAudio size={16} style={{ color: '#fda4af' }} />
  if (['.txt', '.md', '.doc', '.docx', '.pdf'].includes(item.ext)) return <FileText size={16} style={{ color: 'var(--text-1)' }} />
  return <FileIcon size={16} style={{ color: 'var(--text-2)' }} />
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} КБ`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} МБ`
  return `${(bytes / 1024 ** 3).toFixed(2)} ГБ`
}

export function FilesView() {
  const [homeDirs, setHomeDirs] = useState<{ name: string; path: string }[]>([])
  const [cwd, setCwd] = useState('')
  const [items, setItems] = useState<FileItem[]>([])
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [viewer, setViewer] = useState<{ path: string; name: string; content: string; editable: boolean } | null>(null)
  const [renaming, setRenaming] = useState<FileItem | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const navigate = useCallback(async (path: string) => {
    try {
      const list = await kira.files.list(path)
      setCwd(path)
      setItems(list)
      setError('')
      setQuery('')
    } catch (err) {
      setError(`Нет доступа: ${(err as Error).message}`)
    }
  }, [])

  useEffect(() => {
    void kira.files.homeDirs().then((dirs) => {
      setHomeDirs(dirs)
      if (dirs[0]) void navigate(dirs[0].path)
    })
  }, [navigate])

  const goUp = (): void => {
    const parent = cwd.replace(/[\\/][^\\/]+[\\/]?$/, '')
    if (parent && parent !== cwd) void navigate(parent.length <= 2 ? parent + '\\' : parent)
  }

  const runSearch = async (everywhere = false): Promise<void> => {
    if (!query.trim()) return void navigate(cwd)
    setSearching(true)
    try {
      setItems(everywhere ? await kira.files.searchUser(query) : await kira.files.search(cwd, query))
      if (everywhere) setCwd(`Поиск по ПК: «${query}»`)
    } finally {
      setSearching(false)
    }
  }

  const openItem = async (item: FileItem): Promise<void> => {
    if (item.isDirectory) return void navigate(item.path)
    const isText = await kira.files.isText(item.path)
    if (isText) {
      const content = await kira.files.read(item.path)
      setViewer({ path: item.path, name: item.name, content, editable: true })
      return
    }
    // PDF / Word / Excel — извлекаем текст для просмотра (только чтение)
    const isDoc = await kira.files.isDocument(item.path)
    if (isDoc) {
      try {
        const content = await kira.files.readDocument(item.path)
        setViewer({ path: item.path, name: item.name, content, editable: false })
        return
      } catch {
        /* если не удалось — откроем системным приложением */
      }
    }
    await kira.invoke('system:open-app', item.path)
  }

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* Быстрый доступ */}
      <div style={{
        width: 190, flexShrink: 0, borderRight: '1px solid var(--border)',
        padding: 12, display: 'flex', flexDirection: 'column', gap: 3,
        background: 'rgba(12,12,22,0.35)'
      }}>
        <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, padding: '4px 8px' }}>
          <HardDrive size={11} style={{ marginRight: 5 }} />Быстрый доступ
        </div>
        {homeDirs.map((d) => (
          <button key={d.path} style={{
            display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
            borderRadius: 9, fontSize: 13, textAlign: 'left',
            background: cwd === d.path ? 'var(--accent-soft)' : 'transparent',
            color: cwd === d.path ? 'var(--accent-text)' : 'var(--text-1)'
          }} onClick={() => void navigate(d.path)}>
            <Folder size={14} /> {d.name}
          </button>
        ))}
        {['C:\\', 'D:\\', 'E:\\'].map((drive) => (
          <button key={drive} style={{
            display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
            borderRadius: 9, fontSize: 13, textAlign: 'left', color: 'var(--text-1)'
          }} onClick={() => void navigate(drive)}>
            <HardDrive size={14} /> Диск {drive[0]}:
          </button>
        ))}
      </div>

      {/* Содержимое */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, padding: '13px 16px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
          <button className="icon-btn" title="Вверх" onClick={goUp}><ArrowUp size={15} /></button>
          <button className="icon-btn" title="Обновить" onClick={() => void navigate(cwd)}><RefreshCw size={14} /></button>
          <input style={{ flex: 1, fontSize: 12.5 }} value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void navigate(cwd)} />
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-2)' }} />
            <input style={{ paddingLeft: 30, width: 170, fontSize: 12.5 }} placeholder="Найти здесь…"
              value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void runSearch(false)} />
          </div>
          <button className="btn btn-ghost press" style={{ padding: '7px 11px', fontSize: 12 }}
            title="Искать по всему ПК (Рабочий стол, Документы, Загрузки, Изображения, Музыка, Видео)"
            onClick={() => void runSearch(true)}>
            <Globe size={13} /> Везде
          </button>
          <button className="icon-btn" title="Новая папка" onClick={() => {
            const name = prompt('Имя новой папки:')
            if (name) void kira.files.mkdir(`${cwd}\\${name}`).then(() => navigate(cwd))
          }}>
            <FolderPlus size={15} />
          </button>
        </div>

        {error && <div style={{ padding: '10px 16px', color: 'var(--err)', fontSize: 13 }}>{error}</div>}
        {searching && <div style={{ padding: '10px 16px' }} className="muted">Ищу…</div>}

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
          {items.map((item) => (
            <div key={item.path}
              style={{
                display: 'flex', alignItems: 'center', gap: 11, padding: '7px 12px',
                borderRadius: 9, cursor: 'pointer', transition: 'background 0.1s'
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-soft)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '')}
              onDoubleClick={() => void openItem(item)}
            >
              {fileIcon(item)}
              <span style={{ flex: 1, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {item.name}
              </span>
              <span className="muted" style={{ fontSize: 11.5, width: 76, textAlign: 'right' }}>
                {item.isDirectory ? '—' : formatSize(item.size)}
              </span>
              <span className="muted" style={{ fontSize: 11.5, width: 120, textAlign: 'right' }}>
                {new Date(item.modifiedAt).toLocaleDateString('ru-RU')}
              </span>
              <span style={{ display: 'flex', gap: 1 }}>
                <button className="icon-btn" style={{ width: 25, height: 25 }} title="Переименовать"
                  onClick={(e) => { e.stopPropagation(); setRenaming(item); setRenameValue(item.name) }}>
                  <PenLine size={12} />
                </button>
                <button className="icon-btn" style={{ width: 25, height: 25 }} title="Показать в проводнике"
                  onClick={(e) => { e.stopPropagation(); void kira.files.showInExplorer(item.path) }}>
                  <ExternalLink size={12} />
                </button>
                <button className="icon-btn" style={{ width: 25, height: 25 }} title="Удалить в корзину"
                  onClick={(e) => { e.stopPropagation(); void kira.files.trash(item.path).then(() => navigate(cwd)) }}>
                  <Trash2 size={12} />
                </button>
              </span>
            </div>
          ))}
          {items.length === 0 && !error && (
            <div className="muted" style={{ textAlign: 'center', padding: 30 }}>Папка пуста</div>
          )}
        </div>
      </div>

      {/* Просмотр/редактирование файла */}
      {viewer && (
        <FileEditor viewer={viewer} onClose={() => setViewer(null)}
          onSave={(content) => {
            void kira.files.write(viewer.path, content)
            setViewer(null)
          }} />
      )}

      {/* Переименование */}
      {renaming && (
        <div style={overlayStyle} onClick={() => setRenaming(null)}>
          <div className="panel anim-in" style={{ width: 380, padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: 14, fontSize: 15 }}>Переименовать</h3>
            <input autoFocus style={{ width: '100%' }} value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void kira.files.rename(renaming.path, renameValue).then(() => navigate(cwd))
                  setRenaming(null)
                }
              }} />
            <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="btn btn-ghost" onClick={() => setRenaming(null)}>Отмена</button>
              <button className="btn btn-primary" onClick={() => {
                void kira.files.rename(renaming.path, renameValue).then(() => navigate(cwd))
                setRenaming(null)
              }}>Переименовать</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FileEditor({ viewer, onClose, onSave }: {
  viewer: { path: string; name: string; content: string; editable: boolean }
  onClose: () => void
  onSave: (content: string) => void
}) {
  const [content, setContent] = useState(viewer.content)
  const changed = content !== viewer.content

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div className="panel anim-in" style={{ width: '76vw', height: '80vh', padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 18px', borderBottom: '1px solid var(--border)' }}>
          <FileCode size={16} style={{ color: 'var(--accent-text)' }} />
          <span style={{ fontWeight: 650, fontSize: 13.5 }}>{viewer.name}</span>
          <span className="muted" style={{ fontSize: 11.5 }}>{viewer.path}</span>
          {!viewer.editable && <span className="badge" style={{ fontSize: 10 }}>только чтение</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 7 }}>
            {viewer.editable && changed && (
              <button className="btn btn-primary" style={{ padding: '6px 13px', fontSize: 12.5 }} onClick={() => onSave(content)}>
                <Save size={13} /> Сохранить
              </button>
            )}
            <button className="icon-btn" onClick={onClose}><X size={16} /></button>
          </div>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          readOnly={!viewer.editable}
          spellCheck={false}
          style={{
            flex: 1, resize: 'none', border: 'none', borderRadius: 0, boxShadow: 'none',
            background: '#0c0c18', fontFamily: 'Cascadia Code, Consolas, monospace',
            fontSize: 12.8, lineHeight: 1.6, padding: 18
          }}
        />
      </div>
    </div>
  )
}
