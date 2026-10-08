import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { WifiOff } from 'lucide-react'
import { api } from '@/services/api'

/** Polls /api/health (or any quick endpoint) and shows a top banner when backend is unreachable. */
export default function OfflineBanner() {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    let mounted = true
    const check = async () => {
      try {
        await api.get('/health', { timeout: 3000 })
        if (mounted) setOffline(false)
      } catch {
        if (mounted) setOffline(true)
      }
    }
    check()
    const id = setInterval(check, 15000) // check every 15s
    return () => { mounted = false; clearInterval(id) }
  }, [])

  return (
    <AnimatePresence>
      {offline && (
        <motion.div
          initial={{ y: -48, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -48, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0,
            zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 10,
            padding: '8px 20px',
            background: 'rgba(255,82,82,0.15)',
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid rgba(255,82,82,0.4)',
            boxShadow: '0 0 20px rgba(255,82,82,0.2)',
          }}
        >
          <WifiOff size={14} style={{ color: 'var(--c-error)' }} />
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: '0.2em',
            color: 'var(--c-error)',
          }}>
            BACKEND OFFLINE — EMORA API UNREACHABLE · CHECK :8000
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
