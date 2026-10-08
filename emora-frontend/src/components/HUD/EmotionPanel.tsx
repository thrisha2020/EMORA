import { motion } from 'framer-motion'
import type { EmotionResult, FusedEmotion } from '@/services/emotion'
import './emotion-panel.css'

const FACES: Record<string, string> = {
  happy: '😊',
  sad: '😢',
  angry: '😠',
  fear: '😨',
  surprise: '😲',
  disgust: '😒',
  neutral: '😐',
}

const COLORS: Record<string, string> = {
  happy: '#ffc857',
  sad: '#5b8dff',
  angry: '#ff5c5c',
  fear: '#b088ff',
  surprise: '#4fd6c8',
  disgust: '#8fbf6a',
  neutral: '#00d9ff',
}

function Row({ label, result }: { label: string; result: EmotionResult | null }) {
  if (!result) {
    return (
      <div className="emo-row">
        <span className="emo-row-label">{label}</span>
        <span className="emo-row-none">no signal</span>
      </div>
    )
  }
  return (
    <div className="emo-row">
      <span className="emo-row-label">{label}</span>
      <span className="emo-row-value" style={{ color: COLORS[result.emotion] ?? '#eafcff' }}>
        {result.emotion}
      </span>
      <span className="emo-row-pct">{Math.round(result.confidence * 100)}%</span>
    </div>
  )
}

/** Live multimodal reading. Everything shown here comes from /api/emotion/analyze. */
export default function EmotionPanel({ reading }: { reading: FusedEmotion | null }) {
  const top = reading
    ? Object.entries(reading.scores)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
    : []

  return (
    <div className="chat-panel">
      <div className="chat-panel-title">Current Emotion</div>

      {!reading ? (
        <p className="emo-waiting">Waiting for a reading…</p>
      ) : (
        <>
          <div className="chat-emotion-display">
            <motion.div
              key={reading.emotion}
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="chat-emotion-icon"
            >
              {FACES[reading.emotion] ?? '🙂'}
            </motion.div>
            <div className="chat-emotion-details">
              <h3 style={{ color: COLORS[reading.emotion] ?? '#eafcff' }}>
                {reading.emotion.charAt(0).toUpperCase() + reading.emotion.slice(1)}
              </h3>
              <p>Confidence {Math.round(reading.confidence * 100)}%</p>
            </div>
          </div>

          <div className="emo-bars">
            {top.map(([label, value]) => (
              <div key={label} className="emo-bar">
                <span className="emo-bar-label">{label}</span>
                <div className="emo-bar-track">
                  <motion.div
                    className="emo-bar-fill"
                    style={{ background: COLORS[label] ?? 'var(--c-primary)' }}
                    animate={{ width: `${Math.round(value * 100)}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
                <span className="emo-bar-pct">{Math.round(value * 100)}%</span>
              </div>
            ))}
          </div>

          <div className="emo-breakdown">
            <Row label="Face" result={reading.breakdown?.face ?? null} />
            <Row label="Voice" result={reading.breakdown?.voice ?? null} />
            <Row label="Text" result={reading.breakdown?.text ?? null} />
          </div>

          <p className="emo-agreement">
            {reading.sources.length > 1
              ? `${Math.round(reading.agreement * 100)}% agreement across ${reading.sources.length} signals`
              : 'Single signal — low certainty'}
          </p>
        </>
      )}
    </div>
  )
}
