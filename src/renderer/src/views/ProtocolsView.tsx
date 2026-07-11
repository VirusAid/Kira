/** Протоколы — последовательности действий с визуальным редактором. */
import { useState } from 'react'
import {
  Plus, Play, Square, Trash2, Pencil, Copy, Download, Upload, Zap,
  GripVertical, ArrowUp, ArrowDown, X
} from 'lucide-react'
import { useProtocolStore } from '@/state/dataStores'
import { kira } from '@/api'
import { timeAgo } from './HomeView'
import { overlayStyle } from './MemoryView'
import type { Protocol, ProtocolStep, ProtocolStepType } from '@shared/types'

const STEP_TYPES: { id: ProtocolStepType; label: string; targetHint: string; paramHint?: string }[] = [
  { id: 'open_app', label: 'Открыть программу', targetHint: 'Название или путь (chrome, discord…)', paramHint: 'Аргументы (необязательно)' },
  { id: 'open_url', label: 'Открыть сайт', targetHint: 'https://…' },
  { id: 'open_file', label: 'Открыть файл/папку', targetHint: 'C:\\путь\\к\\файлу' },
  { id: 'run_command', label: 'Команда PowerShell', targetHint: 'Get-Date' },
  { id: 'create_folder', label: 'Создать папку', targetHint: 'C:\\путь\\новая_папка' },
  { id: 'move_file', label: 'Переместить файл', targetHint: 'Откуда', paramHint: 'Куда' },
  { id: 'copy_file', label: 'Скопировать файл', targetHint: 'Откуда', paramHint: 'Куда' },
  { id: 'delete_file', label: 'Удалить в корзину', targetHint: 'C:\\путь\\к\\файлу' },
  { id: 'wait', label: 'Пауза (сек)', targetHint: '5' },
  { id: 'notify', label: 'Уведомление', targetHint: 'Текст уведомления' },
  { id: 'ai_prompt', label: 'Запрос к Kira', targetHint: 'Что сделать/ответить' },
  { id: 'set_volume', label: 'Громкость (%)', targetHint: '50' },
  { id: 'screenshot', label: 'Скриншот', targetHint: '' },
  { id: 'type_text', label: 'Ввести текст', targetHint: 'Текст для ввода' }
]

export function ProtocolsView() {
  const { protocols, runStates, save, remove, run, stop, duplicate, load } = useProtocolStore()
  const [editing, setEditing] = useState<Protocol | 'new' | null>(null)

  return (
    <div className="view-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        <h2 className="section-title">Протоколы</h2>
        <span className="badge">{protocols.length}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => void kira.protocols.import().then(() => load())}>
            <Upload size={14} /> Импорт
          </button>
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Plus size={15} /> Создать протокол
          </button>
        </div>
      </div>

      {protocols.length === 0 && (
        <div className="empty-state">
          <Zap size={40} strokeWidth={1.2} />
          <p>Протокол — последовательность действий одним кликом.<br />
            Например: «Рабочее утро» — открыть браузер, Discord и проект.</p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 14 }}>
        {protocols.map((p) => {
          const runState = runStates[p.id]
          const isRunning = runState?.running
          return (
            <div key={p.id} className="card anim-in" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                  background: 'var(--accent-soft)', color: 'var(--accent-text)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <Zap size={17} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{p.name}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>
                    {p.steps.length} шагов · запусков: {p.runCount}
                    {p.lastRunAt && ` · ${timeAgo(p.lastRunAt)}`}
                  </div>
                </div>
              </div>

              {p.description && (
                <p style={{ fontSize: 12.5, color: 'var(--text-1)', lineHeight: 1.5 }}>{p.description}</p>
              )}

              {/* Прогресс выполнения */}
              {isRunning && (
                <div className="anim-in">
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--accent-text)', marginBottom: 4 }}>
                    <span>{runState.stepLabel}</span>
                    <span>{runState.currentStep}/{runState.totalSteps}</span>
                  </div>
                  <div style={{ height: 4, borderRadius: 4, background: 'var(--bg-2)' }}>
                    <div style={{
                      height: '100%', borderRadius: 4,
                      width: `${(runState.currentStep / runState.totalSteps) * 100}%`,
                      background: 'linear-gradient(90deg, var(--accent), #a78bfa)',
                      transition: 'width 0.3s'
                    }} />
                  </div>
                </div>
              )}
              {runState && !runState.running && runState.error && (
                <div style={{ fontSize: 11.5, color: 'var(--warn)' }}>{runState.error}</div>
              )}

              <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
                {isRunning ? (
                  <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => void stop(p.id)}>
                    <Square size={13} /> Стоп
                  </button>
                ) : (
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => void run(p.id)}>
                    <Play size={13} /> Запустить
                  </button>
                )}
                <button className="icon-btn" title="Редактировать" onClick={() => setEditing(p)}><Pencil size={14} /></button>
                <button className="icon-btn" title="Дублировать" onClick={() => void duplicate(p.id)}><Copy size={14} /></button>
                <button className="icon-btn" title="Экспорт" onClick={() => void kira.protocols.export(p.id)}><Download size={14} /></button>
                <button className="icon-btn" title="Удалить" onClick={() => void remove(p.id)}><Trash2 size={14} /></button>
              </div>
            </div>
          )
        })}
      </div>

      {editing && (
        <ProtocolEditor
          protocol={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={(p) => { void save(p); setEditing(null) }}
        />
      )}
    </div>
  )
}

function ProtocolEditor({ protocol, onClose, onSave }: {
  protocol?: Protocol
  onClose: () => void
  onSave: (p: Partial<Protocol>) => void
}) {
  const [name, setName] = useState(protocol?.name ?? '')
  const [description, setDescription] = useState(protocol?.description ?? '')
  const [steps, setSteps] = useState<ProtocolStep[]>(protocol?.steps ?? [])

  const addStep = (): void => {
    setSteps([...steps, {
      id: crypto.randomUUID(),
      type: 'open_app',
      target: '',
      enabled: true
    }])
  }

  const updateStep = (id: string, partial: Partial<ProtocolStep>): void => {
    setSteps(steps.map((s) => (s.id === id ? { ...s, ...partial } : s)))
  }

  const moveStep = (index: number, dir: -1 | 1): void => {
    const next = [...steps]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setSteps(next)
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div className="panel anim-in" style={{ width: 640, maxHeight: '84vh', padding: 24, display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h3>{protocol ? 'Редактор протокола' : 'Новый протокол'}</h3>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <input style={{ flex: 1 }} placeholder="Название (например: Рабочее утро)"
            value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <input style={{ marginBottom: 14 }} placeholder="Описание"
          value={description} onChange={(e) => setDescription(e.target.value)} />

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 9, paddingRight: 4 }}>
          {steps.map((step, i) => {
            const meta = STEP_TYPES.find((t) => t.id === step.type)!
            return (
              <div key={step.id} style={{
                display: 'flex', gap: 8, alignItems: 'center',
                background: 'var(--bg-2)', borderRadius: 11, padding: '9px 11px',
                border: '1px solid var(--border)',
                opacity: step.enabled ? 1 : 0.45
              }}>
                <GripVertical size={14} style={{ color: 'var(--text-2)', flexShrink: 0 }} />
                <span className="badge" style={{ fontSize: 10, minWidth: 22, justifyContent: 'center' }}>{i + 1}</span>
                <select
                  style={{ width: 168, padding: '6px 8px', fontSize: 12 }}
                  value={step.type}
                  onChange={(e) => updateStep(step.id, { type: e.target.value as ProtocolStepType })}
                >
                  {STEP_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
                {meta.targetHint !== '' && (
                  <input
                    style={{ flex: 1, padding: '6px 9px', fontSize: 12 }}
                    placeholder={meta.targetHint}
                    value={step.target}
                    onChange={(e) => updateStep(step.id, { target: e.target.value })}
                  />
                )}
                {meta.paramHint && (
                  <input
                    style={{ flex: 0.8, padding: '6px 9px', fontSize: 12 }}
                    placeholder={meta.paramHint}
                    value={step.param ?? ''}
                    onChange={(e) => updateStep(step.id, { param: e.target.value })}
                  />
                )}
                <div style={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                  <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => moveStep(i, -1)}><ArrowUp size={12} /></button>
                  <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => moveStep(i, 1)}><ArrowDown size={12} /></button>
                  <button className="icon-btn" style={{ width: 24, height: 24 }} title={step.enabled ? 'Отключить шаг' : 'Включить шаг'}
                    onClick={() => updateStep(step.id, { enabled: !step.enabled })}>
                    {step.enabled ? '◉' : '◎'}
                  </button>
                  <button className="icon-btn" style={{ width: 24, height: 24 }}
                    onClick={() => setSteps(steps.filter((s) => s.id !== step.id))}>
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            )
          })}
          <button className="btn btn-ghost" style={{ justifyContent: 'center' }} onClick={addStep}>
            <Plus size={14} /> Добавить шаг
          </button>
        </div>

        <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn btn-primary" disabled={!name.trim() || steps.length === 0}
            onClick={() => onSave({ ...(protocol ?? {}), id: protocol?.id, name: name.trim(), description, steps })}>
            Сохранить протокол
          </button>
        </div>
      </div>
    </div>
  )
}
