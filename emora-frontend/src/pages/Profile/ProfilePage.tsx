import { useEffect, useState } from 'react'
import { User, Calendar, Activity } from 'lucide-react'
import { profile, type Profile } from '@/services/analytics'
import { errorMessage } from '@/services/api'
import './profile.css'

export default function ProfilePage() {
  const [data, setData] = useState<Profile | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    profile()
      .then((p) => alive && setData(p))
      .catch((e) => alive && setErr(errorMessage(e)))
    return () => { alive = false }
  }, [])

  if (err) return <div className="pf-err">{err}</div>
  if (!data) return <div className="pf-loading">Loading profile…</div>

  const total = Object.values(data.emotion_stats).reduce((a, b) => a + b, 0)

  return (
    <div className="pf-root">
      <div className="pf-card">
        <div className="pf-avatar">{data.name.slice(0, 1).toUpperCase()}</div>
        <h2 className="font-orbitron">{data.name}</h2>
        <p className="pf-sub">
          <Calendar size={12} /> Joined {data.joined ?? '—'} · <Activity size={12} /> {total} emotion logs
        </p>
        <div className="pf-lang">Language: {data.preferred_language}</div>
      </div>

      <div className="pf-stats">
        <h3 className="font-orbitron"><Activity size={14} /> EMOTION BREAKDOWN</h3>
        {Object.entries(data.emotion_stats).length === 0 && <p className="pf-empty">No emotion data yet. Chat with EMORA to generate insights.</p>}
        <div className="pf-bars">
          {Object.entries(data.emotion_stats).map(([emo, count]) => {
            const pct = total ? (count / total) * 100 : 0
            return (
              <div key={emo} className="pf-bar-row">
                <span className="pf-bar-label">{emo}</span>
                <div className="pf-bar-track">
                  <div className="pf-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="pf-bar-count">{count}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="pf-foot">
        <User size={14} /> EMORA AI · Emotion-Aware Operating System · SQLite-backed profile
      </div>
    </div>
  )
}