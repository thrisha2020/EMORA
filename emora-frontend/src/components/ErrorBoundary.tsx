import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshCw, AlertTriangle } from 'lucide-react'

interface Props { children: ReactNode; fallback?: ReactNode }
interface State { hasError: boolean; error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[EMORA ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div style={{
          position: 'fixed', inset: 0, display: 'grid', placeItems: 'center',
          background: 'var(--c-bg)', zIndex: 9999,
        }}>
          <div style={{
            textAlign: 'center', padding: 40, maxWidth: 480,
            background: 'rgba(6,17,27,0.9)', borderRadius: 16,
            border: '1px solid rgba(255,82,82,0.3)',
            boxShadow: '0 0 40px rgba(255,82,82,0.1)',
          }}>
            <AlertTriangle size={40} style={{ color: 'var(--c-error)', marginBottom: 16 }} />
            <h2 className="font-orbitron" style={{ color: '#eafcff', letterSpacing: '0.2em', fontSize: 18, marginBottom: 8 }}>
              SYSTEM FAULT
            </h2>
            <p style={{ color: 'var(--c-muted)', fontSize: 13, marginBottom: 4, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.06em' }}>
              {this.state.error?.message ?? 'An unexpected error occurred'}
            </p>
            <p style={{ color: '#2f4a5a', fontSize: 11, fontFamily: "'JetBrains Mono', monospace", marginBottom: 24 }}>
              EMORA CORE · DIAGNOSTIC MODE
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '10px 24px', borderRadius: 8, cursor: 'pointer',
                background: 'rgba(255,82,82,0.15)', border: '1px solid rgba(255,82,82,0.4)',
                color: 'var(--c-error)', fontFamily: "'Orbitron', sans-serif",
                fontSize: 12, letterSpacing: '0.2em', fontWeight: 700,
              }}
            >
              <RefreshCw size={15} /> RETRY
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
