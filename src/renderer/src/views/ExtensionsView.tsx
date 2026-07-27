/**
 * Расширения — подключение внешних программ и обучение Киры их командам.
 *
 * Раздел намеренно говорит человеческим языком: «расширение», «команда»,
 * «фраза». Ни «MCP», ни «инструмент», ни «JSON-схема» тут не встречаются —
 * пользователю Kira не обязан знать, по какому протоколу это работает, ровно
 * так же, как ему не обязан быть виден Python под голосом.
 *
 * Готовые расширения даны списком в один клик: писать команду запуска руками —
 * занятие для тех, кто этого хочет, а не условие входа.
 */
import { useEffect, useState } from 'react'
import { Blocks, Plus, Trash2, RefreshCw, Loader2, Check, AlertTriangle, Puzzle } from 'lucide-react'
import { kira, type McpOverviewItem } from '@/api'
import type { McpBinding, McpTool } from '@shared/types'

/** Готовые расширения: человеку не нужно знать команду запуска. */
const CATALOG = [
  {
    title: 'Файлы и папки',
    hint: 'Кира сможет искать и читать файлы в выбранной папке',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', ''],
    argHint: 'Папка, к которой открыть доступ',
    env: {} as Record<string, string>
  },
  {
    title: 'GitHub',
    hint: 'Задачи, ветки и запросы на слияние в твоих репозиториях',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    argHint: '',
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' }
  },
  {
    title: 'Память о разговорах',
    hint: 'Дополнительное хранилище фактов, общее с другими программами',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    argHint: '',
    env: {} as Record<string, string>
  }
]

const STATE_LABEL: Record<string, { text: string; color: string }> = {
  ready: { text: 'работает', color: 'var(--ok, #22c55e)' },
  connecting: { text: 'подключаюсь…', color: 'var(--text-2)' },
  degraded: { text: 'сбоит', color: '#f59e0b' },
  offline: { text: 'не подключено', color: 'var(--text-2)' },
  unconfigured: { text: 'не настроено', color: 'var(--text-2)' }
}

export function ExtensionsView() {
  const [servers, setServers] = useState<McpOverviewItem[]>([])
  const [bindings, setBindings] = useState<McpBinding[]>([])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [adding, setAdding] = useState<typeof CATALOG[number] | null>(null)
  const [form, setForm] = useState({ title: '', param: '', secret: '' })
  const [teaching, setTeaching] = useState<{ server: string; tools: McpTool[] } | null>(null)
  const [lesson, setLesson] = useState({ tool: '', phrase: '', title: '' })

  const refresh = (): void => {
    void kira.mcp.overview().then((o) => { setServers(o.servers); setBindings(o.bindings) })
  }
  useEffect(refresh, [])

  const add = async (): Promise<void> => {
    if (!adding) return
    setBusy('add'); setMsg('Подключаю…')
    const args = adding.args.map((a) => (a === '' ? form.param : a)).filter(Boolean)
    const env: Record<string, string> = {}
    for (const key of Object.keys(adding.env)) env[key] = form.secret
    const r = await kira.mcp.saveServer({
      title: form.title || adding.title, command: adding.command, args, env, enabled: true
    })
    const st = await kira.mcp.connect(r.id)
    setMsg(st.state === 'ready' ? `Готово: ${r.title} на связи` : `Не вышло: ${st.message}`)
    setBusy(''); setAdding(null); setForm({ title: '', param: '', secret: '' }); refresh()
  }

  const teach = async (serverId: string): Promise<void> => {
    setBusy('tools:' + serverId)
    const tools = await kira.mcp.tools(serverId)
    setTeaching({ server: serverId, tools })
    setLesson({ tool: tools[0]?.name ?? '', phrase: '', title: '' })
    setBusy('')
  }

  const saveLesson = async (): Promise<void> => {
    if (!teaching || !lesson.tool || !lesson.phrase.trim()) return
    await kira.mcp.saveBinding({
      server: teaching.server, tool: lesson.tool,
      title: lesson.title || lesson.phrase,
      phrases: [lesson.phrase.trim()],
      // «$1» — то, что человек скажет после фразы; имя поля берём первое
      // обязательное из описания инструмента
      args: firstArgName(teaching.tools, lesson.tool)
        ? { [firstArgName(teaching.tools, lesson.tool)!]: '$1' }
        : {},
      dangerous: true, enabled: true
    })
    setTeaching(null); setMsg('Запомнила команду'); refresh()
  }

  return (
    <div style={{ padding: 26, maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 6 }}>
        <Blocks size={19} style={{ color: 'var(--accent-text)' }} />
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Расширения</h2>
      </div>
      <p className="muted" style={{ marginBottom: 22, marginLeft: 30, maxWidth: 620 }}>
        Подключи внешнюю программу — и научи Киру её командам своими словами.
        Дальше она выполняет их сама, как любую встроенную команду.
      </p>

      {msg && <div className="card" style={{ marginBottom: 16, fontSize: 13 }}>{msg}</div>}

      {/* Уже подключённые */}
      {servers.map(({ config, status, tools }) => {
        const label = STATE_LABEL[status.state] ?? STATE_LABEL.offline
        const mine = bindings.filter((b) => b.server === config.id)
        return (
          <div key={config.id} className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Puzzle size={17} style={{ color: 'var(--accent-text)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 650, fontSize: 14 }}>{config.title}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  <span style={{ color: label.color }}>{label.text}</span>
                  {status.state === 'ready' && ` · команд доступно: ${tools.length}`}
                  {status.state !== 'ready' && status.message ? ` · ${status.message}` : ''}
                </div>
              </div>
              <button className="btn press" onClick={() => void kira.mcp.connect(config.id).then(refresh)}>
                <RefreshCw size={13} />Переподключить
              </button>
              <button className="btn press" disabled={busy === 'tools:' + config.id}
                onClick={() => void teach(config.id)}>
                {busy === 'tools:' + config.id ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}
                Научить команде
              </button>
              <button className="btn press" onClick={() => void kira.mcp.removeServer(config.id).then(refresh)}>
                <Trash2 size={13} />
              </button>
            </div>

            {mine.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                {mine.map((b) => (
                  <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                    <Check size={13} style={{ color: 'var(--accent-text)' }} />
                    <span style={{ fontSize: 13 }}>«{b.phrases[0]}»</span>
                    <span className="muted" style={{ fontSize: 11.5, flex: 1 }}>{b.title}</span>
                    <button className="btn press" style={{ padding: '3px 8px' }}
                      onClick={() => void kira.mcp.removeBinding(b.id).then(refresh)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* Каталог */}
      <h3 style={{ fontSize: 14, fontWeight: 650, margin: '22px 0 10px' }}>Что можно подключить</h3>
      <div style={{ display: 'grid', gap: 10 }}>
        {CATALOG.map((c) => (
          <div key={c.title} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 650, fontSize: 13.5 }}>{c.title}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{c.hint}</div>
            </div>
            <button className="btn btn-primary press" onClick={() => { setAdding(c); setForm({ title: c.title, param: '', secret: '' }) }}>
              <Plus size={13} />Подключить
            </button>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 18, background: 'var(--bg-2)', fontSize: 12.5, lineHeight: 1.55 }}>
        <AlertTriangle size={14} style={{ color: '#f59e0b', verticalAlign: -2, marginRight: 6 }} />
        Для расширений нужен <b>Node.js</b> — если его нет, установи с nodejs.org и перезапусти Киру.
        Ключи доступа хранятся на твоём компьютере в открытом виде, как и ключи ИИ-провайдеров.
        Новые команды Кира спрашивает перед выполнением, пока ты не разрешишь иначе.
      </div>

      {/* Диалог подключения */}
      {adding && (
        <Modal title={`Подключить: ${adding.title}`} onClose={() => setAdding(null)}>
          <Field label="Название">
            <input style={{ width: '100%' }} value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          {adding.argHint && (
            <Field label={adding.argHint}>
              <input style={{ width: '100%' }} value={form.param} placeholder="C:\\Users\\...\\Documents"
                onChange={(e) => setForm({ ...form, param: e.target.value })} />
            </Field>
          )}
          {Object.keys(adding.env).length > 0 && (
            <Field label="Ключ доступа">
              <input style={{ width: '100%' }} type="password" value={form.secret}
                onChange={(e) => setForm({ ...form, secret: e.target.value })} />
            </Field>
          )}
          <button className="btn btn-primary press" disabled={busy === 'add'} onClick={() => void add()}>
            {busy === 'add' ? <Loader2 size={14} className="spin" /> : <Check size={14} />}Подключить
          </button>
        </Modal>
      )}

      {/* Диалог обучения команде */}
      {teaching && (
        <Modal title="Научить команде" onClose={() => setTeaching(null)}>
          <Field label="Что делать">
            <select style={{ width: '100%' }} value={lesson.tool}
              onChange={(e) => setLesson({ ...lesson, tool: e.target.value })}>
              {teaching.tools.map((t) => (
                <option key={t.name} value={t.name}>{t.title || t.name} — {t.description.slice(0, 60)}</option>
              ))}
            </select>
          </Field>
          <Field label="Как ты это скажешь">
            <input style={{ width: '100%' }} placeholder="заведи задачу" value={lesson.phrase}
              onChange={(e) => setLesson({ ...lesson, phrase: e.target.value })} />
            <p className="muted" style={{ marginTop: 6, fontSize: 11.5 }}>
              Всё, что скажешь после этих слов, Кира передаст как содержимое.
              Например: «заведи задачу <i>кнопка не работает</i>».
            </p>
          </Field>
          <button className="btn btn-primary press" onClick={() => void saveLesson()}>
            <Check size={14} />Запомнить
          </button>
        </Modal>
      )}
    </div>
  )
}

/** Первое обязательное поле инструмента — туда и уйдёт сказанное. */
function firstArgName(tools: McpTool[], toolName: string): string | undefined {
  const schema = tools.find((t) => t.name === toolName)?.inputSchema as
    { properties?: Record<string, unknown>; required?: string[] } | undefined
  return schema?.required?.[0] ?? Object.keys(schema?.properties ?? {})[0]
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 7 }}>{label}</label>
      {children}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 60
    }} onClick={onClose}>
      <div className="card" style={{ width: 460, maxWidth: '90vw' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>{title}</h3>
        {children}
      </div>
    </div>
  )
}
