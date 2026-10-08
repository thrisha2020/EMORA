import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Activity, Smile, BarChart3, Clock } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar } from 'recharts'
import { moodHistory, analytics, type MoodHistory, type AnalyticsStats } from '@/services/analytics'
import { errorMessage } from '@/services/api'
import './mood.css'

const EMOTION_COLOR: Record<string, string> = {
  happy: '#FFD740',
  sad: '#5096FF',
  angry: '#FF5252',
  fear: '#B26EFF',
  surprise: '#46FFB4',
  disgust: '#FFBE6E',
  neutral: '#00D9FF',
}

const EMOTION_ORDER = ['happy', 'sad', 'angry', 'fear', 'surprise', 'disgust', 'neutral'] as const

export default function MoodPage() {
  const [mood, setMood] = useState<MoodHistory | null>(null)
  const [stats, setStats] = useState<AnalyticsStats | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([moodHistory(7), analytics()])
      .then(([m, s]) => {
        if (!alive) return
        setMood(m)
        setStats(s)
      })
      .catch((e) => alive && setErr(errorMessage(e)))
    return () => { alive = false }
  }, [])

  if (err) return <div className="mood-err">{err}</div>
  if (!mood || !stats) return <div className="mood-loading">Loading mood…</div>

  // Label each point with its own date; the old fixed Mon..Sun list drifted out
  // of step with the real days as soon as today wasn't a Sunday.
  const label = (iso: string | undefined, i: number) =>
    iso ? new Date(iso + 'T00:00:00').toLocaleDateString([], { weekday: 'short', day: 'numeric' }) : `Day ${i + 1}`
  const trendData = mood.emotions.map((emo, i) => ({
    day: label(mood.dates?.[i], i),
    emotion: emo ?? '—',
    value: emo ? EMOTION_ORDER.indexOf(emo as typeof EMOTION_ORDER[number]) : -1,
  }))

  const distData = Object.entries(mood.counts).map(([name, value]) => ({ name, value }))
  const distData2 = Object.entries(stats.emotion_counts).map(([name, value]) => ({ name, value }))

  const current = mood.emotions[mood.emotions.length - 1] ?? stats.recent_emotion ?? 'neutral'

  return (
    <div className="mood-root">
      <div className="mood-header">
        <h2 className="font-orbitron"><Activity size={18} style={{ verticalAlign: -3 }} /> MOOD</h2>
        <span className="mood-chip" style={{ background: EMOTION_COLOR[current] ?? '#00D9FF' }}>{current.toUpperCase()}</span>
      </div>

      <div className="mood-grid">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mood-card">
          <h3><Clock size={14} /> 7-DAY TREND</h3>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <CartesianGrid stroke="rgba(14,37,53,0.6)" strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fill: '#4A6272', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis
                  domain={[-1, 6]}
                  ticks={[0, 1, 2, 3, 4, 5, 6]}
                  tickFormatter={(v: number) => EMOTION_ORDER[v] ?? '—'}
                  tick={{ fill: '#4A6272', fontSize: 10 }}
                  width={70}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{ background: 'rgba(6,17,27,0.95)', border: '1px solid #0E2535', borderRadius: 10 }}
                  labelStyle={{ color: '#C8D6E0' }}
                  formatter={(value: unknown) => [EMOTION_ORDER[value as number] ?? '—', 'Emotion']}
                />
                <Line type="monotone" dataKey="value" stroke="#00D9FF" strokeWidth={2} dot={{ r: 4, stroke: '#00D9FF', fill: '#020609' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="mood-card">
          <h3><Smile size={14} /> DISTRIBUTION (7D)</h3>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={distData.length ? distData : [{ name: 'neutral', value: 1 }]} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                  {(distData.length ? distData : [{ name: 'neutral', value: 1 }]).map((e) => (
                    <Cell key={e.name} fill={EMOTION_COLOR[e.name] ?? '#00D9FF'} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: 'rgba(6,17,27,0.95)', border: '1px solid #0E2535', borderRadius: 10 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }} className="mood-card">
          <h3><BarChart3 size={14} /> EMOTION COUNTS (ALL TIME)</h3>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={distData2.length ? distData2 : [{ name: 'neutral', value: 0 }]}>
                <CartesianGrid stroke="rgba(14,37,53,0.6)" strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fill: '#4A6272', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#4A6272', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: 'rgba(6,17,27,0.95)', border: '1px solid #0E2535', borderRadius: 10 }} />
                <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                  {(distData2.length ? distData2 : [{ name: 'neutral', value: 0 }]).map((e) => (
                    <Cell key={e.name} fill={EMOTION_COLOR[e.name] ?? '#00D9FF'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }} className="mood-card stat">
          <h3>CURRENT</h3>
          <div className="mood-big" style={{ color: EMOTION_COLOR[current] ?? '#00D9FF' }}>{current}</div>
          <p>Dominant emotion today. Updates after each chat/analysis.</p>
        </motion.div>
      </div>
    </div>
  )
}