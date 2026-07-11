/** Проекты: сетка карточек + детальный вид с целями, заметками, чатом. */
import { useMemo, useState } from 'react'
import {
  Plus, Trash2, FolderKanban, ArrowLeft, MessageSquare, FolderOpen,
  CheckCircle2, Circle, Search, Tag
} from 'lucide-react'
import { useProjectStore } from '@/state/dataStores'
import { useAppStore } from '@/state/appStore'
import { useChatStore } from '@/state/chatStore'
import { kira } from '@/api'
import { timeAgo } from './HomeView'
import { overlayStyle } from './MemoryView'
import type { Project, ProjectStatus } from '@shared/types'

const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: 'Активен',
  paused: 'Пауза',
  done: 'Завершён',
  archived: 'Архив'
}

const STATUS_COLOR: Record<ProjectStatus, string> = {
  active: 'var(--ok)',
  paused: 'var(--warn)',
  done: 'var(--info)',
  archived: 'var(--text-2)'
}

export function ProjectsView() {
  const { projects, save } = useProjectStore()
  const { openProjectId, setOpenProject } = useAppStore()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  const openProject = projects.find((p) => p.id === openProjectId)
  if (openProject) {
    return <ProjectDetail project={openProject} onBack={() => setOpenProject(null)} />
  }

  const filtered = projects.filter((p) => {
    const q = query.toLowerCase()
    return !q || `${p.name} ${p.description} ${p.tags.join(' ')}`.toLowerCase().includes(q)
  })

  return (
    <div className="view-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <h2 className="section-title">Проекты</h2>
        <span className="badge">{projects.length}</span>
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <Search size={14} style={{ position: 'absolute', left: 11, top: 10, color: 'var(--text-2)' }} />
          <input style={{ paddingLeft: 32, width: 220 }} placeholder="Поиск по проектам и тегам"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Plus size={15} /> Новый проект
        </button>
      </div>

      {filtered.length === 0 && (
        <div className="empty-state">
          <FolderKanban size={40} strokeWidth={1.2} />
          <p>Проектов пока нет. Создай первый — Kira поможет вести его.</p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 14 }}>
        {filtered.map((p) => (
          <button key={p.id} className="card clickable anim-in" style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 9 }}
            onClick={() => setOpenProject(p.id)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[p.status], boxShadow: `0 0 7px ${STATUS_COLOR[p.status]}` }} />
              <span style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</span>
              <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>{STATUS_LABEL[p.status]}</span>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--text-1)', lineHeight: 1.5, minHeight: 36 }}>
              {p.description || 'Без описания'}
            </p>
            {p.tags.length > 0 && (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {p.tags.map((t) => <span key={t} className="badge" style={{ fontSize: 10 }}>#{t}</span>)}
              </div>
            )}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-2)', marginBottom: 4 }}>
                <span>Прогресс</span><span>{p.progress}%</span>
              </div>
              <div style={{ height: 5, borderRadius: 5, background: 'var(--bg-2)' }}>
                <div style={{ height: '100%', width: `${p.progress}%`, borderRadius: 5, background: 'linear-gradient(90deg, var(--accent), #a78bfa)', transition: 'width 0.4s' }} />
              </div>
            </div>
            <div className="muted" style={{ fontSize: 11 }}>
              {p.goals.filter((g) => g.done).length}/{p.goals.length} целей · обновлён {timeAgo(p.updatedAt)}
            </div>
          </button>
        ))}
      </div>

      {creating && (
        <ProjectEditor
          onClose={() => setCreating(false)}
          onSave={(p) => { void save(p).then((saved) => setOpenProject(saved.id)); setCreating(false) }}
        />
      )}
    </div>
  )
}

function ProjectDetail({ project, onBack }: { project: Project; onBack: () => void }) {
  const { save, remove } = useProjectStore()
  const { setView } = useAppStore()
  const { chats, openChat, newChat } = useChatStore()
  const [goalText, setGoalText] = useState('')
  const [noteText, setNoteText] = useState('')
  const [editing, setEditing] = useState(false)

  const projectChats = useMemo(() => chats.filter((c) => c.projectId === project.id), [chats, project.id])

  const toggleGoal = (goalId: string): void => {
    const goals = project.goals.map((g) => (g.id === goalId ? { ...g, done: !g.done } : g))
    const progress = goals.length ? Math.round((goals.filter((g) => g.done).length / goals.length) * 100) : 0
    void save({ id: project.id, goals, progress })
  }

  const addGoal = (): void => {
    if (!goalText.trim()) return
    const goals = [...project.goals, { id: crypto.randomUUID(), text: goalText.trim(), done: false }]
    const progress = Math.round((goals.filter((g) => g.done).length / goals.length) * 100)
    void save({ id: project.id, goals, progress })
    setGoalText('')
  }

  const addNote = (): void => {
    if (!noteText.trim()) return
    void save({
      id: project.id,
      notes: [{ id: crypto.randomUUID(), text: noteText.trim(), createdAt: Date.now() }, ...project.notes]
    })
    setNoteText('')
  }

  const openProjectChat = async (): Promise<void> => {
    const existing = projectChats[0]
    if (existing) await openChat(existing.id)
    else await newChat(project.id)
    setView('chat')
  }

  return (
    <div className="view-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button className="icon-btn" onClick={onBack}><ArrowLeft size={17} /></button>
        <h2 className="section-title">{project.name}</h2>
        <span className="badge" style={{ color: STATUS_COLOR[project.status] }}>{STATUS_LABEL[project.status]}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {project.path && (
            <button className="btn btn-ghost" onClick={() => void kira.files.showInExplorer(project.path!)}>
              <FolderOpen size={14} /> Папка
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => void openProjectChat()}>
            <MessageSquare size={14} /> Чат проекта
          </button>
          <button className="btn btn-ghost" onClick={() => setEditing(true)}>Изменить</button>
          <button className="btn btn-danger" onClick={() => { void remove(project.id); onBack() }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="card">
            <h3 style={{ fontSize: 14, marginBottom: 8 }}>Описание</h3>
            <p style={{ fontSize: 13.5, color: 'var(--text-1)', lineHeight: 1.6 }} className="selectable">
              {project.description || 'Описание не задано'}
            </p>
            {project.tags.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
                {project.tags.map((t) => (
                  <span key={t} className="badge"><Tag size={10} /> {t}</span>
                ))}
              </div>
            )}
          </section>

          <section className="card">
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Цели · {project.progress}%</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {project.goals.map((g) => (
                <button key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '4px 2px' }}
                  onClick={() => toggleGoal(g.id)}>
                  {g.done
                    ? <CheckCircle2 size={17} style={{ color: 'var(--ok)', flexShrink: 0 }} />
                    : <Circle size={17} style={{ color: 'var(--text-2)', flexShrink: 0 }} />}
                  <span style={{
                    fontSize: 13.5,
                    textDecoration: g.done ? 'line-through' : 'none',
                    color: g.done ? 'var(--text-2)' : 'var(--text-0)'
                  }}>{g.text}</span>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <input style={{ flex: 1 }} placeholder="Новая цель…" value={goalText}
                onChange={(e) => setGoalText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addGoal()} />
              <button className="btn btn-ghost" onClick={addGoal}><Plus size={14} /></button>
            </div>
          </section>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="card">
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Заметки</h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input style={{ flex: 1 }} placeholder="Быстрая заметка…" value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addNote()} />
              <button className="btn btn-ghost" onClick={addNote}><Plus size={14} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
              {project.notes.map((n) => (
                <div key={n.id} style={{ padding: '9px 12px', background: 'var(--bg-2)', borderRadius: 9, fontSize: 12.5 }}>
                  <div className="selectable">{n.text}</div>
                  <div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>{timeAgo(n.createdAt)}</div>
                </div>
              ))}
              {project.notes.length === 0 && <span className="muted">Заметок нет</span>}
            </div>
          </section>

          <section className="card">
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Диалоги проекта</h3>
            {projectChats.length === 0 && <span className="muted">Диалогов нет — открой чат проекта</span>}
            {projectChats.map((c) => (
              <button key={c.id} style={{ display: 'flex', gap: 9, alignItems: 'center', width: '100%', padding: '7px 4px', textAlign: 'left' }}
                onClick={() => { void openChat(c.id); setView('chat') }}>
                <MessageSquare size={13} style={{ color: 'var(--accent-text)' }} />
                <span style={{ fontSize: 13, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</span>
                <span className="muted" style={{ fontSize: 10.5 }}>{timeAgo(c.updatedAt)}</span>
              </button>
            ))}
          </section>

          <section className="card">
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>История</h3>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.8 }}>
              Создан: {new Date(project.createdAt).toLocaleString('ru-RU')}<br />
              Обновлён: {new Date(project.updatedAt).toLocaleString('ru-RU')}
            </div>
          </section>
        </div>
      </div>

      {editing && (
        <ProjectEditor project={project} onClose={() => setEditing(false)}
          onSave={(p) => { void save({ ...p, id: project.id }); setEditing(false) }} />
      )}
    </div>
  )
}

function ProjectEditor({ project, onClose, onSave }: {
  project?: Project
  onClose: () => void
  onSave: (p: Partial<Project>) => void
}) {
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [tags, setTags] = useState(project?.tags.join(', ') ?? '')
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? 'active')
  const [path, setPath] = useState(project?.path ?? '')

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div className="panel anim-in" style={{ width: 500, padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 16 }}>{project ? 'Изменить проект' : 'Новый проект'}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <textarea placeholder="Описание и цели проекта" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
          <input placeholder="Теги через запятую" value={tags} onChange={(e) => setTags(e.target.value)} />
          <div style={{ display: 'flex', gap: 9 }}>
            <select style={{ flex: 1 }} value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
              {Object.entries(STATUS_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <button className="btn btn-ghost" style={{ flex: 1.4 }}
              onClick={() => void kira.files.pickFolder().then((p) => p && setPath(p))}>
              <FolderOpen size={14} /> {path ? '…' + path.slice(-24) : 'Папка проекта'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
            <button className="btn btn-primary" disabled={!name.trim()}
              onClick={() => onSave({
                name: name.trim(),
                description,
                status,
                path: path || undefined,
                tags: tags.split(',').map((t) => t.trim()).filter(Boolean)
              })}>
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
