import { motion } from 'framer-motion'
import { Terminal } from 'lucide-react'

interface PlaceholderPageProps {
  title: string
  subtitle?: string
}

/** Simple "module coming online" panel for routes that ship in later milestones. */
export default function PlaceholderPage({ title, subtitle = 'MODULE ONLINE · COMING SOON' }: PlaceholderPageProps) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        background: 'radial-gradient(ellipse at center, rgba(0,217,255,0.06), transparent 60%)',
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="glass-neon"
        style={{
          textAlign: 'center',
          padding: '36px 56px',
          borderRadius: 18,
        }}
      >
        <Terminal size={30} style={{ color: 'var(--c-primary)', margin: '0 auto 14px', display: 'block' }} />
        <h2 className="font-orbitron" style={{ letterSpacing: '0.25em', margin: 0, color: '#eafcff' }}>
          {title.toUpperCase()}
        </h2>
        <p className="font-mono" style={{ color: 'var(--c-muted)', letterSpacing: '0.15em', fontSize: 11, marginTop: 12 }}>
          {subtitle}
        </p>
      </motion.div>
    </div>
  )
}