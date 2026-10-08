import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell, Plus, Check, Clock, Repeat, Trash2 } from 'lucide-react'
import {
  listReminders,
  createReminder,
  completeReminder,
  deleteReminder,
  type Reminder,
  type ReminderInput,
} from '@/services/reminders'
import { errorMessage } from '@/services/api'
import './reminders.css'

/** `datetime-local` gives "2026-09-17T10:30" — local time, which is what the backend compares against. */
function defaultWhen(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  d.setSeconds(0, 0)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'no time set'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function RemindersPage() {
  const [items, setItems] = useState<Reminder[]>([])
  const [title, setTitle] = useState('')
  const [when, setWhen] = useState(defaultWhen)
  const [repeat, setRepeat] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    try {
      const data = await listReminders()
      setItems(data)
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  const add = async () => {
    if (!title.trim() || !when) return
    setErr(null)
    try {
      const r = await createReminder({
        title: title.trim(),
        scheduled_at: new Date(when).toISOString(),
        repeat: (repeat || null) as ReminderInput['repeat'],
      })
      setItems((prev) => [...prev, r])
      setTitle('')
      setWhen(defaultWhen())
      setRepeat('')
    } catch (e) {
      setErr(errorMessage(e))
    }
  }

  const remove = async (id: number) => {
    if (!window.confirm('Delete this reminder?')) return
    try {
      await deleteReminder(id)
      setItems((prev) => prev.filter((x) => x.id !== id))
    } catch (e) {
      setErr(errorMessage(e))
    }
  }

  const done = async (id: number) => {
    try {
      const r = await completeReminder(id)
      setItems((prev) => prev.map((x) => (x.id === id ? r : x)))
    } catch (e) {
      setErr(errorMessage(e))
    }
  }

  return (
    <div className="rem-root">
      <div className="rem-header">
        <h2 className="font-orbitron"><Bell size={18} style={{ verticalAlign: -3 }} /> REMINDERS</h2>
        <span className="rem-count">{items.filter((x) => !x.is_completed).length} ACTIVE</span>
      </div>

      <div className="rem-form">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What to remember…" className="rem-input" />
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="rem-input"
          aria-label="When"
        />
        <select value={repeat} onChange={(e) => setRepeat(e.target.value)} className="rem-input" aria-label="Repeat">
          <option value="">Once</option>
          <option value="hourly">Hourly</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
        <button className="rem-add" onClick={add} disabled={!title.trim() || !when}>
          <Plus size={16} /> Add
        </button>
      </div>

      {err && <div className="rem-err">{err}</div>}
      {loading && <div className="rem-loading">Loading…</div>}

      <div className="rem-list">
        <AnimatePresence initial={false}>
          {items.map((r) => (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className={`rem-item ${r.is_completed ? 'done' : ''}`}
            >
              <div className="rem-item-main">
                <span className="rem-item-title">{r.title}</span>
                <span className="rem-item-time">
                  <Clock size={12} /> {formatWhen(r.scheduled_at)}
                  {r.repeat && <> · <Repeat size={11} /> {r.repeat}</>}
                </span>
              </div>
              <div className="rem-actions">
                {!r.is_completed ? (
                  <button className="rem-done" onClick={() => done(r.id)} title="Mark complete"><Check size={16} /></button>
                ) : (
                  <span className="rem-badge">DONE</span>
                )}
                <button className="rem-delete" onClick={() => remove(r.id)} title="Delete"><Trash2 size={14} /></button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {!loading && items.length === 0 && <p className="rem-empty">No reminders yet. Add one above.</p>}
      </div>
    </div>
  )
}
