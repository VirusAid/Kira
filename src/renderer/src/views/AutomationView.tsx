/** Автоматизация: триггеры (расписание, запуск, наблюдение за папкой) → протоколы. */
import { useState } from 'react'
import { Plus, Trash2, Pencil, Clock, Rocket, FolderSearch } from 'lucide-react'
import { useAutomationStore, useProtocolStore } from '@/state/dataStores'
import { kira } from '@/api'
import { timeAgo } from './HomeView'
import { overlayStyle } from './MemoryView'
import type { Automation, AutomationTriggerType } from '@shared/types'

const TRIGGER_META: Record<AutomationTriggerType, { label: string; icon: typeof Clock; hint: string }> = {
  schedule: { label: 'По расписанию', icon: Clock, hint: 'Cron: «0 9 * * *» = каждый день в 9:00' },
  app_start: { label: 'При запуске Kira', icon: Rocket, hint: 'Срабатывает после старта приложения' },
  file_watch: { label: 'Новый файл в папке', icon: FolderSearch, hint: 'Путь к папке для наблюдения' }
}

const CRON_PRESETS = [
  { label: 'Каждый день в 9:00', value: '0 9 * * *' },
  { label: 'Каждый час', value: '0 * * * *' },
  { label: 'Каждые 30 минут', value: '*/30 * * * *' },
  { label: 'По будням в 8:30', value: '30 8 * * 1-5' },
  { label: 'Каждое воскресенье в 20:00', value: '0 20 * * 0' }
]

export function AutomationView() {
  const { automations, save, remove } = useAutomationStore()
  const protocols = useProtocolStore((s) => s.protocols)
  const [editing, setEditing] = useState<Automation | 'new' | null>(null)

  return (
    <div className="view-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <h2 className="section-title">Автоматизация</h2>
        <span className="badge">{automations.filter((a) => a.enabled).length} активных</span>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setEditing('new')}>
          <Plus size={15} /> Новый сценарий
        </button>
      </div>

      {protocols.length === 0 && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'rgba(251,191,36,0.3)' }}>
          <span style={{ fontSize: 13, color: 'var(--warn)' }}>
            Сначала создай хотя бы один протокол — автоматизация запускает именно протоколы.
          </span>
        </div>
      )}

      {automations.length === 0 && (
        <div className="empty-state">
          <Clock size={40} strokeWidth={1.2} />
          <p>Сценариев нет. Например: «Каждый день в 9 утра — протокол „Рабочее утро"»<br />
            или «Новый файл в Downloads — протокол сортировки».</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        {automations.map((a) => {
          const meta = TRIGGER_META[a.trigger]
          const Icon = meta.icon
          const protocol = protocols.find((p) => p.id === a.protocolId)
          return (
            <div key={a.id} className="card anim-in" style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 11, flexShrink: 0,
                background: a.enabled ? 'var(--accent-soft)' : 'var(--bg-2)',
                color: a.enabled ? 'var(--accent-text)' : 'var(--text-2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <Icon size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 650, fontSize: 14 }}>{a.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {meta.label}
                  {a.trigger !== 'app_start' && ` · ${a.triggerParam}`}
                  {' → '}
                  <span style={{ color: 'var(--accent-text)' }}>{protocol?.name ?? '⚠ протокол удалён'}</span>
                </div>
                <div className="muted" style={{ fontSize: 11 }}>
                  Срабатываний: {a.fireCount}{a.lastFiredAt && ` · последний раз ${timeAgo(a.lastFiredAt)}`}
                </div>
              </div>
              <button
                title={a.enabled ? 'Выключить' : 'Включить'}
                onClick={() => void save({ id: a.id, enabled: !a.enabled })}
                style={{
                  width: 44, height: 24, borderRadius: 999, position: 'relative', flexShrink: 0,
                  background: a.enabled ? 'var(--accent)' : 'var(--bg-3)',
                  transition: 'background 0.2s'
                }}
              >
                <span style={{
                  position: 'absolute', top: 3, left: a.enabled ? 23 : 3,
                  width: 18, height: 18, borderRadius: '50%', background: '#fff',
                  transition: 'left 0.2s'
                }} />
              </button>
              <button className="icon-btn" onClick={() => setEditing(a)}><Pencil size={14} /></button>
              <button className="icon-btn" onClick={() => void remove(a.id)}><Trash2 size={14} /></button>
            </div>
          )
        })}
      </div>

      {editing && (
        <AutomationEditor
          automation={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={(a) => { void save(a); setEditing(null) }}
        />
      )}
    </div>
  )
}

function AutomationEditor({ automation, onClose, onSave }: {
  automation?: Automation
  onClose: () => void
  onSave: (a: Partial<Automation>) => void
}) {
  const protocols = useProtocolStore((s) => s.protocols)
  const [name, setName] = useState(automation?.name ?? '')
  const [trigger, setTrigger] = useState<AutomationTriggerType>(automation?.trigger ?? 'schedule')
  const [triggerParam, setTriggerParam] = useState(automation?.triggerParam ?? '0 9 * * *')
  const [protocolId, setProtocolId] = useState(automation?.protocolId ?? protocols[0]?.id ?? '')

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div className="panel anim-in" style={{ width: 500, padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 16 }}>{automation ? 'Изменить сценарий' : 'Новый сценарий'}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <input placeholder="Название сценария" value={name} onChange={(e) => setName(e.target.value)} autoFocus />

          <div>
            <div className="muted" style={{ marginBottom: 7 }}>Триггер</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(Object.keys(TRIGGER_META) as AutomationTriggerType[]).map((t) => {
                const Icon = TRIGGER_META[t].icon
                return (
                  <button key={t} className="btn"
                    style={{
                      flex: 1, justifyContent: 'center', flexDirection: 'column', gap: 5, padding: '12px 8px',
                      background: trigger === t ? 'var(--accent-soft)' : 'var(--bg-2)',
                      border: `1px solid ${trigger === t ? 'var(--border-strong)' : 'var(--border)'}`,
                      color: trigger === t ? 'var(--accent-text)' : 'var(--text-1)'
                    }}
                    onClick={() => {
                      setTrigger(t)
                      if (t === 'schedule') setTriggerParam('0 9 * * *')
                      if (t === 'app_start') setTriggerParam('')
                      if (t === 'file_watch') setTriggerParam('')
                    }}>
                    <Icon size={17} />
                    <span style={{ fontSize: 11.5 }}>{TRIGGER_META[t].label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {trigger === 'schedule' && (
            <div>
              <input style={{ width: '100%' }} placeholder={TRIGGER_META.schedule.hint}
                value={triggerParam} onChange={(e) => setTriggerParam(e.target.value)} />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {CRON_PRESETS.map((p) => (
                  <button key={p.value} className="badge" style={{ cursor: 'pointer' }}
                    onClick={() => setTriggerParam(p.value)}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {trigger === 'file_watch' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ flex: 1 }} placeholder="C:\Users\...\Downloads"
                value={triggerParam} onChange={(e) => setTriggerParam(e.target.value)} />
              <button className="btn btn-ghost"
                onClick={() => void kira.files.pickFolder().then((p) => p && setTriggerParam(p))}>
                Выбрать
              </button>
            </div>
          )}

          <div>
            <div className="muted" style={{ marginBottom: 7 }}>Запускать протокол</div>
            <select style={{ width: '100%' }} value={protocolId} onChange={(e) => setProtocolId(e.target.value)}>
              {protocols.length === 0 && <option value="">— нет протоколов —</option>}
              {protocols.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
            <button className="btn btn-primary"
              disabled={!name.trim() || !protocolId || (trigger !== 'app_start' && !triggerParam.trim())}
              onClick={() => onSave({ ...(automation ?? {}), id: automation?.id, name: name.trim(), trigger, triggerParam, protocolId })}>
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
