import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { BarChart3, MessageSquare, Timer, Users, Brain } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { analytics, type AnalyticsStats } from '@/services/analytics'
import { errorMessage } from '@/services/api'
import './analytics.css'

const EMOTION_COLOR: Record<string, string> = {
  happy: '#FFD740',
  sad: '#5096FF',
  angry: '#FF5252',
  fear: '#B26EFF',
  surprise: '#46FFB4',
  disgust: '#FFBE6E',
  neutral: '#00D9FF',
}

export default function AnalyticsPage() {
  const [stats, setStats] = useState<AnalyticsStats | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    analytics()
      .then((s) => alive && setStats(s))
      .catch((e) => alive && setErr(errorMessage(e)))
    return () => { alive = false }
  }, [])

  if (err) return <div className="an-err">{err}</div>
  if (!stats) return <div className="an-loading">Loading analytics…</div>

  const barData = Object.entries(stats.emotion_counts).map(([name, value]) => ({ name, value }))

  return (
    <div className="an-root">
      <div className="an-header">
        <h2 className="font-orbitron"><BarChart3 size={18} style={{ verticalAlign: -3 }} /> ANALYTICS</h2>
      </div>

      <div className="an-stats">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="an-card">
          <MessageSquare size={16} style={{ color: 'var(--c-primary)' }} />
          <span className="an-k">TOTAL CHATS</span>
          <span className="an-v">{stats.total_chats}</span>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }} className="an-card">
          <Users size={16} style={{ color: 'var(--c-accent)' }} />
          <span className="an-k">SESSIONS</span>
          <span className="an-v">{stats.total_sessions}</span>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="an-card">
          <Timer size={16} style={{ color: 'var(--c-success)' }} />
          <span className="an-k">REMINDERS</span>
          <span className="an-v">{stats.total_reminders}</span>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }} className="an-card">
          <Brain size={16} style={{ color: '#FFD740' }} />
          <span className="an-k">COMMON EMOTION</span>
          <span className="an-v" style={{ color: EMOTION_COLOR[stats.common_emotion] ?? '#00D9FF' }}>{stats.common_emotion}</span>
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }} className="an-chart">
        <h3 className="font-orbitron">EMOTION DISTRIBUTION</h3>
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData.length ? barData : [{ name: 'neutral', value: 0 }]}>
              <CartesianGrid stroke="rgba(14,37,53,0.6)" strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fill: '#4A6272', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#4A6272', fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ background: 'rgba(6,17,27,0.95)', border: '1px solid #0E2535', borderRadius: 10 }} />
              <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                {(barData.length ? barData : [{ name: 'neutral', value: 0 }]).map((e) => (
                  <Cell key={e.name} fill={EMOTION_COLOR[e.name] ?? '#00D9FF'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      <div className="an-foot">
        <span className="font-mono" style={{ color: 'var(--c-muted)', fontSize: 11, letterSpacing: '0.12em' }}>
          LAST 24H: <b style={{ color: EMOTION_COLOR[stats.recent_emotion ?? ''] ?? '#00D9FF' }}>{stats.recent_emotion ?? 'no readings'}</b> · All-time counts from SQLite
        </span>
      </div>
    </div>
  )
}