import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useTypewriter } from '@/hooks/useTypewriter'

interface SpeechHudProps {
  message: string
  visible: boolean
  onTyped?: () => void
  className?: string
}

/** Floating EMORA speech line with a typewriter effect and blinking caret. */
export default function SpeechHud({ message, visible, onTyped, className }: SpeechHudProps) {
  const { value, done } = useTypewriter(message, 28, visible)
  const fired = useRef(false)

  useEffect(() => {
    if (!done) {
      fired.current = false
      return
    }
    if (!fired.current) {
      fired.current = true
      onTyped?.()
    }
  }, [done, onTyped])

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 10 }}
      animate={visible ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
      transition={{ duration: 0.5 }}
      style={{
        whiteSpace: 'pre-line',
        color: 'var(--c-primary)',
        textShadow: '0 0 18px rgba(0,217,255,0.55)',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 'clamp(15px, 1.6vw, 20px)',
        letterSpacing: '0.08em',
      }}
    >
      {value}
      {visible && !done && <span style={{ color: 'var(--c-primary)' }}>▍</span>}
    </motion.div>
  )
}