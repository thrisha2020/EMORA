import { motion } from 'framer-motion'
import { ScanFace } from 'lucide-react'
import './silent-scan.css'

interface SilentScanProps {
  label: string
  /** Camera is streaming — the sweep runs. */
  active: boolean
  /** Capture is done and the request is in flight — the sweep locks. */
  settled?: boolean
}

/**
 * Face-scan feedback without a camera preview.
 *
 * The webcam is deliberately never rendered during login, so this stands in for
 * it: a sweeping radar arc over concentric rings, which reads as "working"
 * without putting the user's own face on screen.
 */
export default function SilentScan({ label, active, settled = false }: SilentScanProps) {
  return (
    <div className="scan-wrap">
      <div className="scan-ring-stack">
        <svg viewBox="0 0 200 200" className="scan-svg" aria-hidden>
          <defs>
            <linearGradient id="scanSweep" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--c-primary)" stopOpacity="0" />
              <stop offset="100%" stopColor="var(--c-primary)" stopOpacity="0.85" />
            </linearGradient>
          </defs>

          <circle className="scan-ring" cx="100" cy="100" r="86" />
          <circle className="scan-ring faint" cx="100" cy="100" r="68" />
          <circle className="scan-ring faint" cx="100" cy="100" r="50" />

          {/* Corner brackets — the "targeting" frame */}
          {[
            'M 34 58 L 34 34 L 58 34',
            'M 142 34 L 166 34 L 166 58',
            'M 166 142 L 166 166 L 142 166',
            'M 58 166 L 34 166 L 34 142',
          ].map((d, i) => (
            <motion.path
              key={i}
              d={d}
              className="scan-bracket"
              initial={{ opacity: 0 }}
              animate={{ opacity: settled ? 1 : [0.35, 1, 0.35] }}
              transition={{ duration: 1.8, repeat: settled ? 0 : Infinity, delay: i * 0.12 }}
            />
          ))}

          {active && !settled && (
            <motion.g
              animate={{ rotate: 360 }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
              style={{ originX: '100px', originY: '100px' }}
            >
              <path d="M 100 100 L 186 100 A 86 86 0 0 1 160 160 Z" fill="url(#scanSweep)" />
            </motion.g>
          )}

          <motion.circle
            cx="100"
            cy="100"
            r="86"
            className="scan-progress"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: settled ? 1 : 0.72 }}
            transition={{ duration: settled ? 0.6 : 2.4, ease: 'easeInOut' }}
          />
        </svg>

        <motion.div
          className="scan-core"
          animate={{
            scale: settled ? 1 : [1, 1.08, 1],
            opacity: active ? 1 : 0.4,
          }}
          transition={{ duration: 1.6, repeat: settled ? 0 : Infinity }}
        >
          <ScanFace size={30} />
        </motion.div>
      </div>

      <div className="scan-readout">
        <span className="font-orbitron scan-label">{label}</span>
        <span className="font-mono scan-sub">
          {settled ? 'MATCHING BIOMETRIC TEMPLATE' : active ? 'CAPTURING · CAMERA NOT DISPLAYED' : 'STARTING CAMERA'}
        </span>
      </div>
    </div>
  )
}
