import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle, AlertTriangle, XCircle, Info, X } from 'lucide-react'

type ToastType = 'info' | 'success' | 'warning' | 'error'
interface Toast { id: number; message: string; type: ToastType }

interface ToastContextValue {
  toast: (message: string, type?: ToastType, duration?: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const ICONS = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: XCircle,
}

const COLORS = {
  info: { border: 'rgba(0,217,255,0.4)', glow: 'rgba(0,217,255,0.12)', icon: '#00D9FF' },
  success: { border: 'rgba(0,230,118,0.4)', glow: 'rgba(0,230,118,0.12)', icon: '#00E676' },
  warning: { border: 'rgba(255,193,7,0.4)', glow: 'rgba(255,193,7,0.12)', icon: '#FFC107' },
  error: { border: 'rgba(255,82,82,0.4)', glow: 'rgba(255,82,82,0.12)', icon: '#FF5252' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((message: string, type: ToastType = 'info', duration = 4000) => {
    const id = Date.now()
    setToasts((t) => [...t, { id, message, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), duration)
  }, [])

  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id))

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div style={{
        position: 'fixed',
        bottom: 80, // above the shell console
        right: 20,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 360,
        pointerEvents: 'none',
      }}>
        <AnimatePresence>
          {toasts.map((t) => {
            const Icon = ICONS[t.type]
            const color = COLORS[t.type]
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, x: 60, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 60, scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                style={{
                  pointerEvents: 'all',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: 'rgba(6,17,27,0.95)',
                  backdropFilter: 'blur(12px)',
                  border: `1px solid ${color.border}`,
                  boxShadow: `0 0 24px ${color.glow}`,
                  cursor: 'pointer',
                }}
                onClick={() => dismiss(t.id)}
              >
                <Icon size={16} style={{ color: color.icon, flexShrink: 0 }} />
                <span style={{
                  fontFamily: "'Rajdhani', sans-serif",
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#C8D6E0',
                  letterSpacing: '0.04em',
                  flex: 1,
                }}>{t.message}</span>
                <X size={13} style={{ color: '#4A6272', flexShrink: 0 }} />
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
