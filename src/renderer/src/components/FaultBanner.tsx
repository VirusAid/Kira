/**
 * FaultBanner — полоса о том, что сейчас сломано.
 *
 * Смысл её существования: Kira, работающая наполовину, со стороны неотличима
 * от Kira поглупевшей. Отвалился синтез — «она перестала отвечать голосом».
 * Не поднялся офлайн-разум — «стала хуже соображать». Человек винит
 * ассистента, чинить не идёт, потому что не знает, что чинить.
 *
 * Поэтому полоса называет ПОДСИСТЕМУ и говорит, что делать. Показываем только
 * то, что сломано прямо сейчас: починилось — исчезло само, без перезапуска.
 */
import { useEffect, useState } from 'react'
import { kira } from '../api'
import type { Fault } from '../../../shared/types'

export function FaultBanner(): React.JSX.Element | null {
  const [faults, setFaults] = useState<Fault[]>([])
  const [hidden, setHidden] = useState<string[]>([])

  useEffect(() => {
    void kira.faults.list().then(setFaults)
    return kira.faults.onChanged(setFaults)
  }, [])

  // скрытые вручную — по подсистеме: если сломается что-то другое, полоса
  // вернётся, а про уже отвергнутое молчим
  const visible = faults.filter((f) => !hidden.includes(f.subsystem))
  if (!visible.length) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 14px 0' }}>
      {visible.map((f) => (
        <div key={f.subsystem} style={{
          display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 12px',
          borderRadius: 10, fontSize: 12.5, lineHeight: 1.5,
          background: 'color-mix(in srgb, var(--err) 12%, transparent)',
          border: '1px solid color-mix(in srgb, var(--err) 35%, transparent)'
        }}>
          <span style={{ flexShrink: 0 }}>⚠️</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>Не работает: {f.subsystem}</strong>
            {f.count > 1 && <span className="muted"> · повторов: {f.count}</span>}
            <div className="muted" style={{
              marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            }}>{f.message}</div>
            {f.fix && <div style={{ marginTop: 4 }}>{f.fix}</div>}
          </div>
          <button className="btn btn-ghost press" style={{ fontSize: 11, flexShrink: 0 }}
            onClick={() => setHidden((h) => [...h, f.subsystem])}>
            Скрыть
          </button>
        </div>
      ))}
    </div>
  )
}
