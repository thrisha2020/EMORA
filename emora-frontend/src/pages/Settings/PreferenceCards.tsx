import { useEffect, useState } from 'react'
import { AlertTriangle, Bell, Download, Mic, Play, Sparkles, Trash2, Volume2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useTTS } from '@/hooks/useTTS'
import { errorMessage } from '@/services/api'
import {
  ALERT_DEFAULTS,
  ALERTS_KEY,
  CHAT_TOGGLES,
  chime,
  clearData,
  deleteAccount,
  exportData,
  getPreferences,
  savePreferences,
  VOICE_DEFAULTS,
  VOICE_KEY,
  VOICE_GROUPS,
  type Preferences,
} from '@/services/settings'

/** One label + native checkbox row. */
function Check({ label, hint, checked, onChange, disabled }: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className="set-check">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

/** A chat toggle bound to the same storage key ChatPage reads. */
function ChatToggle({ toggle }: { toggle: (typeof CHAT_TOGGLES)[keyof typeof CHAT_TOGGLES] }) {
  const [on, setOn] = usePersistentState(toggle.key, toggle.fallback)
  return <Check label={toggle.label} checked={on} onChange={setOn} />
}

/** Backend-stored preferences: loaded once, each change saved as it happens. */
function usePreferences() {
  const { toast } = useToast()
  const [prefs, setPrefs] = useState<Preferences | null>(null)

  useEffect(() => {
    getPreferences()
      .then(setPrefs)
      .catch((e) => toast(errorMessage(e, 'Could not load preferences'), 'error'))
  }, [toast])

  const update = async (patch: Partial<Preferences>) => {
    const previous = prefs
    setPrefs((p) => (p ? { ...p, ...patch } : p)) // optimistic
    try {
      setPrefs(await savePreferences(patch))
    } catch (e) {
      setPrefs(previous)
      toast(errorMessage(e, 'Could not save'), 'error')
    }
  }
  return { prefs, update }
}

export function PersonalityCard() {
  const { prefs, update } = usePreferences()
  const select = <K extends 'tone' | 'reply_length' | 'language'>(
    key: K,
    label: string,
    options: [Preferences[K], string][],
  ) => (
    <label className="set-field">
      <span>{label}</span>
      <select
        value={prefs?.[key] ?? ''}
        disabled={!prefs}
        onChange={(e) => void update({ [key]: e.target.value } as Partial<Preferences>)}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <div className="set-card set-stack">
      <h3>
        <Sparkles size={14} /> Personality
      </h3>
      {select('tone', 'Tone', [
        ['warm', 'Warm (default)'],
        ['calm', 'Calm & gentle'],
        ['playful', 'Playful'],
        ['professional', 'Professional'],
      ])}
      {select('reply_length', 'Reply length', [
        ['brief', 'Brief'],
        ['normal', 'Normal (default)'],
        ['detailed', 'Detailed'],
      ])}
      {select('language', 'Language', [
        ['auto', 'Match what I speak (default)'],
        ['en', 'Always English'],
        ['hinglish', 'Hinglish (Hindi + English)'],
        ['hi', 'Always Hindi'],
      ])}
    </div>
  )
}

export function VoiceCard() {
  const [voice, setVoice] = usePersistentState(VOICE_KEY, VOICE_DEFAULTS)
  const tts = useTTS()

  return (
    <div className="set-card set-stack">
      <h3>
        <Volume2 size={14} /> Voice &amp; chat
      </h3>
      <label className="set-field">
        <span>Emora's voice</span>
        <select value={voice.voice} onChange={(e) => setVoice({ ...voice, voice: e.target.value })}>
          {VOICE_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="set-field">
        <span>Speed · {voice.rate >= 0 ? '+' : ''}{voice.rate}%</span>
        <input
          type="range"
          min={-50}
          max={50}
          step={5}
          value={voice.rate}
          onChange={(e) => setVoice({ ...voice, rate: Number(e.target.value) })}
        />
      </label>
      <button
        className="set-btn"
        onClick={() => void tts.speak("Hi! I'm Emora. So, how's your day going? This is how I'll sound when we talk.")}
        disabled={tts.speaking}
      >
        <Play size={12} /> {tts.speaking ? 'Speaking…' : 'Preview voice'}
      </button>
      {tts.error && <p className="set-status bad">{tts.error}</p>}
      <div className="set-divider" />
      {Object.values(CHAT_TOGGLES).map((t) => (
        <ChatToggle key={t.key} toggle={t} />
      ))}
    </div>
  )
}

export function AlertsCard() {
  const [alerts, setAlerts] = usePersistentState(ALERTS_KEY, ALERT_DEFAULTS)
  const { toast } = useToast()
  const supported = typeof window !== 'undefined' && 'Notification' in window

  const setNotify = async (on: boolean) => {
    if (on && supported && Notification.permission !== 'granted') {
      const result = await Notification.requestPermission()
      if (result !== 'granted') {
        toast('Notifications are blocked — allow them in your browser site settings', 'error')
        return
      }
    }
    setAlerts({ ...alerts, notify: on })
  }

  return (
    <div className="set-card set-stack">
      <h3>
        <Bell size={14} /> Reminder alerts
      </h3>
      <Check
        label="Desktop notifications"
        hint={supported ? 'When the Emora tab is in the background' : 'Not supported in this browser'}
        checked={alerts.notify}
        disabled={!supported}
        onChange={(v) => void setNotify(v)}
      />
      <Check label="Play a chime" checked={alerts.sound} onChange={(v) => setAlerts({ ...alerts, sound: v })} />
      <button className="set-btn" onClick={chime}>
        <Play size={12} /> Test chime
      </button>
      <div className="set-divider" />
      <Check
        label="Quiet hours"
        hint="No sound, voice, or pop-ups — reminders still appear in chat"
        checked={alerts.quiet}
        onChange={(v) => setAlerts({ ...alerts, quiet: v })}
      />
      <div className="set-time-row">
        <label className="set-field">
          <span>From</span>
          <input
            type="time"
            value={alerts.quietStart}
            disabled={!alerts.quiet}
            onChange={(e) => setAlerts({ ...alerts, quietStart: e.target.value })}
          />
        </label>
        <label className="set-field">
          <span>To</span>
          <input
            type="time"
            value={alerts.quietEnd}
            disabled={!alerts.quiet}
            onChange={(e) => setAlerts({ ...alerts, quietEnd: e.target.value })}
          />
        </label>
      </div>
      <p className="set-hint" style={{ margin: 0, opacity: 0.7 }}>
        Reminders are checked while the E.M.O.R.A. tab is open.
      </p>
    </div>
  )
}

export function PermissionsCard() {
  const { prefs, update } = usePreferences()
  return (
    <div className="set-card set-stack">
      <h3>
        <Mic size={14} /> Permissions
      </h3>
      <Check
        label="Desktop commands"
        hint="Create files & folders, open apps and links"
        checked={prefs?.allow_actions ?? true}
        disabled={!prefs}
        onChange={(v) => void update({ allow_actions: v })}
      />
      <Check
        label="Run code for live answers"
        hint="Weather, web lookups, maths — runs Python on this computer"
        checked={prefs?.allow_code ?? true}
        disabled={!prefs}
        onChange={(v) => void update({ allow_code: v })}
      />
      <div className="set-divider" />
      <ul className="set-list">
        <li>Camera — face verification, emotion, gaze &amp; visual questions</li>
        <li>Microphone — voice chat &amp; hands-free</li>
        <li>Both are requested on demand; audio and frames go only to your local backend.</li>
      </ul>
    </div>
  )
}

export function PrivacyCard() {
  const { user, logout } = useAuth()
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id)
    try {
      await fn()
    } catch (e) {
      toast(errorMessage(e, 'Something went wrong'), 'error')
    } finally {
      setBusy(null)
    }
  }

  const download = () =>
    run('export', async () => {
      const url = URL.createObjectURL(await exportData())
      const a = document.createElement('a')
      a.href = url
      a.download = `emora-data-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    })

  const clear = (kind: 'chats' | 'mood' | 'memories', what: string) => {
    if (!window.confirm(`Permanently delete ${what}? This can't be undone.`)) return
    void run(kind, async () => {
      const n = await clearData(kind)
      toast(`Deleted ${n} ${n === 1 ? 'item' : 'items'}`, 'success')
    })
  }

  const removeAccount = () => {
    const typed = window.prompt(
      `This deletes your face enrollment, conversations, mood history, reminders and memories.\n\nType your name (${user?.name}) to confirm:`,
    )
    if (!typed) return
    void run('account', async () => {
      await deleteAccount(typed)
      logout()
    })
  }

  return (
    <div className="set-card set-stack">
      <h3>
        <Download size={14} /> Privacy &amp; data
      </h3>
      <button className="set-btn" onClick={() => void download()} disabled={busy !== null}>
        <Download size={12} /> Export my data (JSON)
      </button>
      <button className="set-btn" onClick={() => clear('chats', 'your conversation history')} disabled={busy !== null}>
        <Trash2 size={12} /> Clear chat history
      </button>
      <button className="set-btn" onClick={() => clear('mood', 'your mood history')} disabled={busy !== null}>
        <Trash2 size={12} /> Clear mood history
      </button>
      <button className="set-btn" onClick={() => clear('memories', 'everything Emora remembers about you')} disabled={busy !== null}>
        <Trash2 size={12} /> Forget memories
      </button>
      <div className="set-divider" />
      <button className="set-danger" style={{ marginTop: 0 }} onClick={removeAccount} disabled={busy !== null}>
        <AlertTriangle size={14} /> Delete account
      </button>
    </div>
  )
}
