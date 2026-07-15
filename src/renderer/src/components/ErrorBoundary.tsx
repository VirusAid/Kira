/**
 * ErrorBoundary — страховка интерфейса: ошибка в любом компоненте React не
 * даёт белый экран, а показывает аккуратную заглушку с кнопкой перезапуска.
 * Main-процесс (голос, ядро, автоматизации) при этом продолжает работать.
 */
import React from 'react'

interface State {
  error: Error | null
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error('Kira UI error:', error)
  }

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32
      }}>
        <div style={{ fontSize: 40 }}>⚠️</div>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Интерфейс столкнулся с ошибкой</h2>
        <p className="muted" style={{ fontSize: 13, maxWidth: 420, textAlign: 'center', lineHeight: 1.6 }}>
          Kira продолжает работать в фоне. Перезагрузи интерфейс — данные не потеряются.
        </p>
        <code style={{
          fontSize: 11.5, color: 'var(--err)', maxWidth: 480, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap'
        }}>{this.state.error.message}</code>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          Перезагрузить интерфейс
        </button>
      </div>
    )
  }
}
