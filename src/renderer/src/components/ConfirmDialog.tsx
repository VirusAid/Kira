/** Подтверждение опасных действий, запрошенных Kira. */
import { ShieldAlert } from 'lucide-react'
import { useAppStore } from '@/state/appStore'

export function ConfirmDialog() {
  const { pendingConfirms, resolveConfirm } = useAppStore()
  const confirm = pendingConfirms[0]
  if (!confirm) return null

  return (
    <div style={styles.overlay}>
      <div className="panel anim-in" style={styles.modal}>
        <div style={styles.iconWrap}>
          <ShieldAlert size={26} color="var(--warn)" />
        </div>
        <h3 style={{ fontSize: 16, marginBottom: 6 }}>Kira запрашивает подтверждение</h3>
        <p style={{ color: 'var(--text-1)', fontSize: 13.5, marginBottom: 20, lineHeight: 1.5 }}>
          {confirm.description}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button className="btn btn-danger" onClick={() => resolveConfirm(confirm.confirmId, false)}>
            Отменить
          </button>
          <button className="btn btn-primary" onClick={() => resolveConfirm(confirm.confirmId, true)}>
            Разрешить
          </button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 200,
    background: 'rgba(5, 5, 12, 0.7)', backdropFilter: 'blur(5px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    animation: 'fadeIn 0.15s ease'
  },
  modal: { width: 400, padding: 26, textAlign: 'center' },
  iconWrap: {
    width: 54, height: 54, borderRadius: '50%', margin: '0 auto 14px',
    background: 'rgba(251, 191, 36, 0.12)', border: '1px solid rgba(251, 191, 36, 0.3)',
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  }
}
