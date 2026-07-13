/**
 * Навыки (Abilities / Skills) — способности Kira, описанные обычным языком.
 * Пользователь либо пишет описание, и Kira превращает его в навык, либо
 * заполняет поля вручную. Навыки можно экспортировать/импортировать файлом.
 */
import { useState } from 'react'
import { Sparkles, Plus, Play, Trash2, Pencil, Download, Upload, X, Wand2, Power } from 'lucide-react'
import { useAbilityStore } from '@/state/dataStores'
import { kira } from '@/api'
import { timeAgo } from './HomeView'
import { overlayStyle } from './MemoryView'
import type { Ability } from '@shared/types'

export function AbilitiesView() {
  const { abilities, save, remove, load } = useAbilityStore()
  const [editing, setEditing] = useState<Ability | 'new' | null>(null)
  const [runMsg, setRunMsg] = useState('')

  const toggle = (a: Ability): void => { void save({ id: a.id, enabled: !a.enabled }) }
  const runNow = async (a: Ability): Promise<void> => {
    const r = await kira.abilities.run(a.name)
    setRunMsg(r.message)
    setTimeout(() => setRunMsg(''), 4000)
    void load()
  }

  return (
    <div className="view-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
        <h2 className="section-title">Навыки</h2>
        <span className="badge">{abilities.length}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => void kira.abilities.import().then(() => load())}>
            <Upload size={14} /> Установить навык
          </button>
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Plus size={15} /> Новый навык
          </button>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 18, maxWidth: 720 }}>
        Опиши умение обычным языком — Kira запомнит его и будет выполнять сама, когда попросишь
        (по названию или фразе-триггеру), используя все свои инструменты. Готовые навыки можно
        передавать файлом.
      </p>

      {runMsg && (
        <div className="card anim-in" style={{ marginBottom: 14, borderColor: 'var(--accent)', fontSize: 13 }}>
          {runMsg}
        </div>
      )}

      {abilities.length === 0 && (
        <div className="empty-state">
          <Sparkles size={40} strokeWidth={1.2} />
          <p>Навыков пока нет.<br />
            Например: «Наведи порядок на рабочем столе» — Kira рассортирует файлы по папкам.</p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 14 }}>
        {abilities.map((a) => (
          <div key={a.id} className="card anim-in" style={{ display: 'flex', flexDirection: 'column', gap: 10, opacity: a.enabled ? 1 : 0.55 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                background: 'var(--accent-soft)', color: 'var(--accent-text)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <Sparkles size={17} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{a.name}</div>
                <div className="muted" style={{ fontSize: 11.5 }}>
                  {a.source === 'imported' ? 'установлен' : 'свой'} · вызовов: {a.runCount}
                  {a.lastRunAt && ` · ${timeAgo(a.lastRunAt)}`}
                </div>
              </div>
              <button className="icon-btn" title={a.enabled ? 'Выключить' : 'Включить'} onClick={() => toggle(a)}>
                <Power size={14} color={a.enabled ? 'var(--accent-text)' : undefined} />
              </button>
            </div>

            {a.description && (
              <p style={{ fontSize: 12.5, color: 'var(--text-1)', lineHeight: 1.5 }}>{a.description}</p>
            )}
            {a.triggers.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {a.triggers.map((t) => (
                  <span key={t} className="badge" style={{ fontSize: 10.5 }}>{t}</span>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => void runNow(a)} disabled={!a.enabled}>
                <Play size={13} /> Выполнить
              </button>
              <button className="icon-btn" title="Редактировать" onClick={() => setEditing(a)}><Pencil size={14} /></button>
              <button className="icon-btn" title="Экспорт" onClick={() => void kira.abilities.export(a.id)}><Download size={14} /></button>
              <button className="icon-btn" title="Удалить" onClick={() => void remove(a.id)}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <AbilityEditor
          ability={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={(a) => { void save(a); setEditing(null) }}
        />
      )}
    </div>
  )
}

function AbilityEditor({ ability, onClose, onSave }: {
  ability?: Ability
  onClose: () => void
  onSave: (a: Partial<Ability>) => void
}) {
  const [name, setName] = useState(ability?.name ?? '')
  const [description, setDescription] = useState(ability?.description ?? '')
  const [instructions, setInstructions] = useState(ability?.instructions ?? '')
  const [triggers, setTriggers] = useState((ability?.triggers ?? []).join(', '))
  const [teach, setTeach] = useState('')

  const draft = async (): Promise<void> => {
    if (!teach.trim()) return
    const d = await kira.abilities.draft(teach)
    if (d.name && !name) setName(d.name)
    if (d.description) setDescription(d.description)
    if (d.instructions) setInstructions(d.instructions)
  }

  const submit = (): void => {
    if (!name.trim() || !instructions.trim()) return
    onSave({
      id: ability?.id,
      name: name.trim(),
      description: description.trim(),
      instructions: instructions.trim(),
      triggers: triggers.split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean),
      source: ability?.source ?? 'user'
    })
  }

  const field: React.CSSProperties = { width: '100%', marginTop: 4 }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div className="card" style={{ width: 560, maxHeight: '86vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700 }}>{ability ? 'Навык' : 'Новый навык'}</h3>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose}><X size={16} /></button>
        </div>

        {!ability && (
          <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, background: 'var(--bg-2)' }}>
            <label style={{ fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Wand2 size={14} /> Обучить обычным языком
            </label>
            <textarea
              style={{ ...field, minHeight: 60 }} value={teach} onChange={(e) => setTeach(e.target.value)}
              placeholder="Опиши, что должна уметь Kira. Напр.: «Каждый раз собирай мои скриншоты с рабочего стола в папку Screenshots»"
            />
            <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => void draft()}>
              <Wand2 size={13} /> Сделать черновик
            </button>
          </div>
        )}

        <label style={{ fontSize: 12.5, fontWeight: 600 }}>Название
          <input style={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Порядок на рабочем столе" />
        </label>
        <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginTop: 14 }}>Короткое описание
          <input style={field} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Что делает навык" />
        </label>
        <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginTop: 14 }}>Инструкция для Kira
          <textarea
            style={{ ...field, minHeight: 110 }} value={instructions} onChange={(e) => setInstructions(e.target.value)}
            placeholder="Пошагово, обычным языком: что именно сделать. Kira выполнит это своими инструментами."
          />
        </label>
        <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginTop: 14 }}>Фразы-триггеры (через запятую)
          <input style={field} value={triggers} onChange={(e) => setTriggers(e.target.value)} placeholder="наведи порядок, разложи файлы" />
        </label>

        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={submit} disabled={!name.trim() || !instructions.trim()}>
            Сохранить
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  )
}
