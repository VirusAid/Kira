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
import { kira, type BundledServer, type McpOverviewItem } from '@/api'
import type { McpBinding, McpTool } from '@shared/types'

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
  const [catalog, setCatalog] = useState<BundledServer[]>([])
  const [adding, setAdding] = useState<BundledServer | null>(null)
  const [form, setForm] = useState({ param: '' })
  const [teaching, setTeaching] = useState<{ server: string; tools: McpTool[] } | null>(null)
  const [lesson, setLesson] = useState<{ tool: string; phrase: string; title: string; fields: string[] }>(
    { tool: '', phrase: '', title: '', fields: [] })

  const refresh = (): void => {
    void kira.mcp.overview().then((o) => { setServers(o.servers); setBindings(o.bindings) })
  }
  useEffect(() => {
    refresh()
    void kira.mcp.bundled().then(setCatalog)
  }, [])

  const add = async (): Promise<void> => {
    if (!adding) return
    setBusy('add'); setMsg('Подключаю…')
    // всё остальное — забота main: команда запуска, путь к серверу, рантайм
    const r = await kira.mcp.addBundled(adding.pkg, form.param)
    setMsg(r.message)
    setBusy(''); setAdding(null); setForm({ param: '' }); refresh()
  }

  const teach = async (serverId: string): Promise<void> => {
    setBusy('tools:' + serverId)
    const tools = await kira.mcp.tools(serverId)
    setTeaching({ server: serverId, tools })
    setLesson({ tool: tools[0]?.name ?? '', phrase: '', title: '', fields: [] })
    setBusy('')
  }

  /**
   * Разметка мест во фразе. Человек пишет «перемести ... в ...» обычными
   * словами, а метки $1/$2 расставляются за него: про доллары и номера он
   * знать не должен, а вот сказать «перемести отчёт в архив» хочет.
   */
  const slotCount = (lesson.phrase.match(/\.\.\.|…/g) ?? []).length

  const saveLesson = async (): Promise<void> => {
    if (!teaching || !lesson.tool || !lesson.phrase.trim()) return
    const fields = argFields(teaching.tools, lesson.tool)
    // многоточия по порядку превращаются в места $1, $2, …
    let n = 0
    const phrase = lesson.phrase.trim().replace(/\.\.\.|…/g, () => `$${++n}`)
    const args: Record<string, string> = {}
    if (n === 0) {
      // разметки нет — старое поведение: всё сказанное после фразы в первое поле
      if (fields[0]) args[fields[0]] = '$1'
    } else {
      for (let i = 0; i < n; i++) {
        const field = lesson.fields[i] || fields[i] || fields[0]
        if (field) args[field] = `$${i + 1}`
      }
    }
    await kira.mcp.saveBinding({
      server: teaching.server, tool: lesson.tool,
      title: lesson.title || lesson.phrase.trim(),
      phrases: [phrase], args, dangerous: true, enabled: true
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
        {catalog.map((c) => (
          <div key={c.pkg} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 650, fontSize: 13.5 }}>{c.title}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                {c.available ? c.hint : 'Не найдено в установке — переустанови Kira'}
              </div>
            </div>
            <button className="btn btn-primary press" disabled={!c.available}
              onClick={() => { setAdding(c); setForm({ param: '' }) }}>
              <Plus size={13} />Подключить
            </button>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 18, background: 'var(--bg-2)', fontSize: 12.5, lineHeight: 1.55 }}>
        <AlertTriangle size={14} style={{ color: '#f59e0b', verticalAlign: -2, marginRight: 6 }} />
        Расширения уже установлены вместе с Кирой — ничего скачивать и настраивать не нужно.
        Новые команды Кира спрашивает перед выполнением, пока ты не разрешишь иначе.
      </div>

      {/* Диалог подключения */}
      {adding && (
        <Modal title={`Подключить: ${adding.title}`} onClose={() => setAdding(null)}>
          {adding.argHint ? (
            <Field label={adding.argHint}>
              <input style={{ width: '100%' }} value={form.param} placeholder="C:\Users\Имя\Documents"
                onChange={(e) => setForm({ param: e.target.value })} />
              <p className="muted" style={{ marginTop: 6, fontSize: 11.5 }}>
                Указывай конкретную папку, а не весь диск: Кира получит доступ ко всему, что внутри.
              </p>
            </Field>
          ) : (
            <p className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>{adding.hint}</p>
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
            <input style={{ width: '100%' }} placeholder="перемести ... в ..." value={lesson.phrase}
              onChange={(e) => setLesson({ ...lesson, phrase: e.target.value })} />
            <p className="muted" style={{ marginTop: 6, fontSize: 11.5 }}>
              Поставь <b>...</b> там, где будешь называть что-то своё. Например:
              «перемести <b>...</b> в <b>...</b>» → «перемести отчёт в архив».
              Без многоточий всё сказанное после фразы уйдёт одним куском.
            </p>
          </Field>

          {slotCount > 1 && (
            <Field label="Что куда подставить">
              {Array.from({ length: slotCount }, (_, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span className="muted" style={{ fontSize: 12, width: 74 }}>{i + 1}-е место</span>
                  <select style={{ flex: 1 }} value={lesson.fields[i] ?? argFields(teaching.tools, lesson.tool)[i] ?? ''}
                    onChange={(e) => {
                      const next = [...lesson.fields]
                      next[i] = e.target.value
                      setLesson({ ...lesson, fields: next })
                    }}>
                    {argFields(teaching.tools, lesson.tool).map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              ))}
            </Field>
          )}

          <button className="btn btn-primary press" onClick={() => void saveLesson()}>
            <Check size={14} />Запомнить
          </button>
        </Modal>
      )}
    </div>
  )
}

/** Поля инструмента: сначала обязательные — в них чаще всего и подставляют. */
function argFields(tools: McpTool[], toolName: string): string[] {
  const schema = tools.find((t) => t.name === toolName)?.inputSchema as
    { properties?: Record<string, unknown>; required?: string[] } | undefined
  const all = Object.keys(schema?.properties ?? {})
  const required = schema?.required ?? []
  return [...required, ...all.filter((f) => !required.includes(f))]
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
