import { lazy, Suspense, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'

const ParticlesBg = lazy(() => import('@/components/Particles/ParticlesBg'))

/** Cinematic boot: black → EMORA logo flare → fade to login. */
export default function BootPage() {
  const navigate = useNavigate()
  const [p, setP] = useState(0)
  const [bootLines, setBootLines] = useState<string[]>([])

  const BOOT_MSGS = [
    'NEURAL NET: INITIALIZING...',
    'FACE RECOGNITION: ONLINE',
    'EMOTION ENGINE: CALIBRATING...',
    'SPEECH PIPELINE: READY',
    'MEMORY CORE: LOADED',
    'EMORA CORE: ACTIVE',
  ]

  useEffect(() => {
    const t0 = performance.now()
    const dur = 2800
    let raf = 0
    const step = (now: number) => {
      const v = Math.min((now - t0) / dur, 1)
      setP(v)
      // Add boot messages progressively
      const msgIdx = Math.floor(v * BOOT_MSGS.length)
      setBootLines(BOOT_MSGS.slice(0, msgIdx))
      if (v < 1) raf = requestAnimationFrame(step)
      else navigate('/login', { replace: true })
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
      }}
    >
      {/* Particle field */}
      <Suspense fallback={null}>
        <ParticlesBg variant="minimal" />
      </Suspense>

      {/* Radial glow */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{
          opacity: 0.12 + p * 0.7,
          scale: 0.9 + p * 0.15,
          filter: `blur(${p < 0.3 ? 6 - p * 20 : 0}px)`,
        }}
        transition={{ ease: 'easeOut' }}
        style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at center, rgba(0,217,255,0.45), transparent 55%)' }}
      />

      {/* Grid lines */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'linear-gradient(rgba(0,217,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,217,255,0.03) 1px, transparent 1px)',
        backgroundSize: '60px 60px',
        opacity: p,
      }} />

      {/* Center content */}
      <div style={{ position: 'relative', textAlign: 'center', zIndex: 2 }}>
        <motion.h1
          className="font-orbitron"
          initial={{ opacity: 0, letterSpacing: '0.8em' }}
          animate={{ opacity: 1, letterSpacing: '0.25em' }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
          style={{ color: '#eafcff', textShadow: '0 0 30px rgba(0,217,255,0.9), 0 0 60px rgba(0,217,255,0.4)', fontWeight: 800, fontSize: 'clamp(32px,6vw,64px)' }}
        >
          EMORA
        </motion.h1>
        <motion.p
          className="font-mono"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.8 }}
          transition={{ delay: 0.6, duration: 0.8 }}
          style={{ color: 'var(--c-primary)', letterSpacing: '0.5em', fontSize: 11, marginTop: 10 }}
        >
          EMOTION-AWARE AI SYSTEM
        </motion.p>
      </div>

      {/* Boot log panel */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: p > 0.2 ? 1 : 0 }}
        style={{
          position: 'absolute',
          bottom: 80,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 340,
          zIndex: 2,
        }}
      >
        {/* Boot messages */}
        <div style={{ marginBottom: 12 }}>
          {bootLines.map((line, i) => (
            <div key={i} className="font-mono" style={{
              fontSize: 10,
              letterSpacing: '0.14em',
              color: i === bootLines.length - 1 ? 'var(--c-primary)' : '#2f4a5a',
              marginBottom: 3,
              textAlign: 'left',
            }}>
              &gt; {line}
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div style={{
          width: '100%',
          height: 2,
          background: 'rgba(0,217,255,0.1)',
          borderRadius: 2,
          overflow: 'hidden',
        }}>
          <motion.div
            style={{ height: '100%', background: 'linear-gradient(90deg, #00D9FF, #7B5CFF)', borderRadius: 2,
              boxShadow: '0 0 8px rgba(0,217,255,0.8)' }}
            animate={{ width: `${p * 100}%` }}
            transition={{ ease: 'linear', duration: 0.1 }}
          />
        </div>
        <div className="font-mono" style={{ fontSize: 10, color: 'var(--c-muted)', letterSpacing: '0.2em', marginTop: 6, textAlign: 'right' }}>
          {Math.round(p * 100)}%
        </div>
      </motion.div>
    </div>
  )
}