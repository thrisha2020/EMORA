import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  CheckCircle2,
  Cpu,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  Key,
  Loader2,
  LogOut,
  MapPin,
  Shield,
  Trash2,
  User,
  XCircle,
} from 'lucide-react'
import { useProgress } from '@react-three/drei'
import { AVATARS, getAvatar, setAvatar } from '@/components/EmoraCore/avatars'
import EmoraCore from '@/components/EmoraCore/EmoraCore'
import { useAuth } from '@/contexts/AuthContext'
import { useLocation } from '@/hooks/useLocation'
import { useToast } from '@/contexts/ToastContext'
import {
  deleteProvider,
  listProviders,
  saveProvider,
  testProvider,
  type ProviderInfo,
} from '@/services/settings'
import { errorMessage } from '@/services/api'
import { useBackendReady } from '@/hooks/useBackendReady'
import { AlertsCard, PermissionsCard, PersonalityCard, PrivacyCard, VoiceCard } from './PreferenceCards'
import './settings.css'

type Draft = { key: string; model: string; reveal: boolean }
type Status = { ok: boolean; message: string } | null

/** [label, engine, /api/health model key] — no key means the backend doesn't report it. */
const ENGINES: [string, string, string?][] = [
  ['Face emotion', 'DeepFace'],
  ['Voice emotion', 'wav2vec2 SER', 'voice'],
  ['Text emotion', 'DistilRoBERTa', 'text'],
  ['STT', 'Parakeet · Whisper', 'stt'],
  ['TTS', 'edge-tts'],
]

type EngineState = 'ready' | 'fallback' | 'loading' | 'lazy' | 'offline'
const ENGINE_STATE_LABEL: Record<EngineState, string> = {
  ready: 'Loaded and ready',
  fallback: 'Failed to load — using the lighter fallback',
  loading: 'Still loading',
  lazy: 'Loads on first use (warm-up is off)',
  offline: 'Backend unreachable',
}

export default function SettingsPage() {
  const { user, logout } = useAuth()
  const { toast } = useToast()
  const geo = useLocation()
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [status, setStatus] = useState<Record<string, Status>>({})
  const [busy, setBusy] = useState<Record<string, 'save' | 'test' | 'delete' | null>>({})
  const [loading, setLoading] = useState(true)
  const [avatarId, setAvatarId] = useState(() => getAvatar().id)
  const [providerId, setProviderId] = useState<string | null>(null)
  const { active: avatarLoading, progress: avatarProgress } = useProgress()
  const backend = useBackendReady()

  const engineState = (key?: string): EngineState | null => {
    if (!key) return null
    if (!backend.reachable) return 'offline'
    if (backend.models[key]) return 'ready'
    if (backend.models[`${key}_fallback`]) return 'fallback'
    return backend.warmup ? 'loading' : 'lazy'
  }

  const refresh = useCallback(async () => {
    try {
      const list = await listProviders()
      setProviders(list)
      setDrafts((prev) => {
        const next = { ...prev }
        for (const p of list) {
          if (!next[p.id]) next[p.id] = { key: '', model: p.model, reveal: false }
        }
        return next
      })
    } catch (e) {
      toast(errorMessage(e, 'Could not load providers'), 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const patchDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }))

  const onSave = async (p: ProviderInfo, activate: boolean) => {
    const draft = drafts[p.id]
    if (!p.configured && !draft?.key.trim()) {
      toast(`Enter an API key for ${p.label} first`, 'error')
      return
    }
    setBusy((b) => ({ ...b, [p.id]: 'save' }))
    try {
      await saveProvider({
        provider: p.id,
        api_key: draft?.key.trim() || undefined,
        model: draft?.model || undefined,
        activate,
      })
      patchDraft(p.id, { key: '' })
      toast(activate ? `${p.label} is now active` : `${p.label} saved`, 'success')
      await refresh()
    } catch (e) {
      toast(errorMessage(e, 'Save failed'), 'error')
    } finally {
      setBusy((b) => ({ ...b, [p.id]: null }))
    }
  }

  const onTest = async (p: ProviderInfo) => {
    const draft = drafts[p.id]
    setBusy((b) => ({ ...b, [p.id]: 'test' }))
    setStatus((s) => ({ ...s, [p.id]: null }))
    try {
      const result = await testProvider({
        provider: p.id,
        api_key: draft?.key.trim() || undefined,
        model: draft?.model || undefined,
      })
      setStatus((s) => ({ ...s, [p.id]: { ok: result.ok, message: result.message } }))
    } catch (e) {
      setStatus((s) => ({ ...s, [p.id]: { ok: false, message: errorMessage(e, 'Test failed') } }))
    } finally {
      setBusy((b) => ({ ...b, [p.id]: null }))
    }
  }

  const onDelete = async (p: ProviderInfo) => {
    setBusy((b) => ({ ...b, [p.id]: 'delete' }))
    try {
      await deleteProvider(p.id)
      setStatus((s) => ({ ...s, [p.id]: null }))
      toast(`${p.label} key removed`, 'success')
      await refresh()
    } catch (e) {
      toast(errorMessage(e, 'Delete failed'), 'error')
    } finally {
      setBusy((b) => ({ ...b, [p.id]: null }))
    }
  }

  const active = providers.find((p) => p.is_active)
  // Show one provider at a time: the one picked, else the active one, else the first.
  const shownId = providerId ?? active?.id ?? providers[0]?.id

  return (
    <div className="set-root">
      <h2 className="font-orbitron">
        <Shield size={18} style={{ verticalAlign: -3 }} /> SETTINGS
      </h2>

      <div className="set-top">
      <section className="set-card">
        <h3>
          <Key size={14} /> AI Providers
        </h3>
        <p className="set-hint">
          Keys are encrypted before they are stored and are never sent back to this page —
          you only ever see a mask.
          {active ? (
            <>
              {' '}
              Currently answering with <b>{active.label}</b> · <code>{active.model}</code>.
            </>
          ) : (
            ' No provider is active yet — add a key to enable chat.'
          )}
        </p>

        {loading ? (
          <p className="set-hint">
            <Loader2 size={14} className="spin" /> Loading providers…
          </p>
        ) : (
          <div className="set-provider-grid">
            <label className="set-field">
              <span>Provider</span>
              <select value={shownId ?? ''} onChange={(e) => setProviderId(e.target.value)}>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.is_active ? ' · active' : p.configured ? ' · key saved' : ''}
                  </option>
                ))}
              </select>
            </label>
            {providers.filter((p) => p.id === shownId).map((p) => {
              const draft = drafts[p.id] ?? { key: '', model: p.model, reveal: false }
              const state = status[p.id]
              const working = busy[p.id]
              return (
                <motion.div
                  key={p.id}
                  layout
                  className={`set-provider ${p.is_active ? 'active' : ''}`}
                >
                  <div className="set-provider-head">
                    <div>
                      <span className="set-provider-name font-orbitron">{p.label}</span>
                      {p.is_active && <span className="set-badge">ACTIVE</span>}
                    </div>
                    {p.configured && (
                      <code className="set-masked" title="Stored key (masked)">
                        {p.masked_key}
                      </code>
                    )}
                  </div>

                  <label className="set-field">
                    <span>API key</span>
                    <div className="set-key-row">
                      <input
                        type={draft.reveal ? 'text' : 'password'}
                        value={draft.key}
                        placeholder={p.configured ? 'Replace stored key…' : `${p.key_prefix}…`}
                        onChange={(e) => patchDraft(p.id, { key: e.target.value })}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <button
                        className="set-icon-btn"
                        onClick={() => patchDraft(p.id, { reveal: !draft.reveal })}
                        title={draft.reveal ? 'Hide' : 'Show'}
                        type="button"
                      >
                        {draft.reveal ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </label>

                  <label className="set-field">
                    <span>Model</span>
                    <input
                      list={`models-${p.id}`}
                      value={draft.model}
                      onChange={(e) => patchDraft(p.id, { model: e.target.value })}
                      placeholder={p.default_model}
                      spellCheck={false}
                    />
                    <datalist id={`models-${p.id}`}>
                      {p.models.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </label>

                  {state && (
                    <p className={`set-status ${state.ok ? 'ok' : 'bad'}`}>
                      {state.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                      <span>{state.message}</span>
                    </p>
                  )}

                  <div className="set-provider-actions">
                    <button
                      className="set-btn primary"
                      onClick={() => void onSave(p, true)}
                      disabled={Boolean(working)}
                    >
                      {working === 'save' ? <Loader2 size={13} className="spin" /> : null}
                      {p.is_active ? 'Save' : 'Save & activate'}
                    </button>
                    <button
                      className="set-btn"
                      onClick={() => void onTest(p)}
                      disabled={Boolean(working) || (!p.configured && !draft.key.trim())}
                    >
                      {working === 'test' ? <Loader2 size={13} className="spin" /> : null}
                      Test
                    </button>
                    <a
                      className="set-btn ghost"
                      href={p.console_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Get key <ExternalLink size={11} />
                    </a>
                    {p.configured && (
                      <button
                        className="set-icon-btn danger"
                        onClick={() => void onDelete(p)}
                        disabled={Boolean(working)}
                        title="Remove stored key"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </section>

        <div className="set-card set-avatar-card">
          <h3>
            <User size={14} /> Avatar
          </h3>
          <div className="set-avatar-preview">
            <EmoraCore avatarUrl={AVATARS.find((a) => a.id === avatarId)?.url} />
            {avatarLoading && (
              <span className="set-avatar-loading">
                <Loader2 size={13} className="spin" /> Loading {Math.round(avatarProgress)}%
              </span>
            )}
          </div>
          <label className="set-field">
            <span>Character</span>
            <select
              value={avatarId}
              onChange={(e) => {
                setAvatar(e.target.value)
                setAvatarId(e.target.value)
                toast('Avatar updated', 'success')
              }}
            >
              {AVATARS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <p className="set-hint" style={{ margin: '10px 0 0', opacity: 0.7 }}>
            Add more by dropping .glb or .vrm files into <code>src/assets/avatars/</code>.
          </p>
        </div>
      </div>

      <div className="set-grid">
        <PersonalityCard />
        <VoiceCard />
        <AlertsCard />
        <PermissionsCard />

        <div className="set-card">
          <h3>
            <Database size={14} /> Engines
          </h3>
          <p className="set-row">
            <span>Chat</span>
            <b>
              <i className={`set-dot ${active ? 'ready' : 'offline'}`} />
              {active ? `${active.label} · ${active.model}` : 'Not configured'}
            </b>
          </p>
          {ENGINES.map(([label, name, key]) => {
            const state = engineState(key)
            return (
              <p className="set-row" key={label}>
                <span>{label}</span>
                <b title={state ? ENGINE_STATE_LABEL[state] : undefined}>
                  {state && <i className={`set-dot ${state}`} />}
                  {name}
                </b>
              </p>
            )
          })}
          <p className="set-hint" style={{ margin: '10px 0 0', opacity: 0.7 }}>
            {!backend.reachable
              ? 'Backend unreachable.'
              : backend.warmup && backend.pending.length
                ? `Warming up: ${backend.pending.join(', ')}…`
                : 'Hover a dot for its status.'}
          </p>
        </div>

        <div className="set-card">
          <h3>
            <MapPin size={14} /> Location
          </h3>
          <p className="set-hint">
            Optional. Lets Emora answer local questions — weather, time, nearby places.
            Only a city-level fix is requested, stored in this browser, and sent with a
            message only when you have granted it.
          </p>
          {geo.location ? (
            <>
              <p className="set-row">
                <span>Location</span>
                <b>{geo.location.label}</b>
              </p>
              <button className="set-btn" onClick={geo.clear}>
                Forget location
              </button>
            </>
          ) : (
            <>
              <button className="set-btn primary" onClick={() => void geo.request()} disabled={geo.requesting}>
                {geo.requesting ? <Loader2 size={13} className="spin" /> : <MapPin size={13} />}
                Share my location
              </button>
              {geo.error && <p className="set-status bad" style={{ marginTop: 8 }}>{geo.error}</p>}
            </>
          )}
          <p className="set-hint" style={{ marginTop: 10, opacity: 0.7 }}>
            The place name is resolved once via OpenStreetMap — the only third-party
            request this app makes.
          </p>
        </div>

        <PrivacyCard />

        <div className="set-card">
          <h3>
            <Cpu size={14} /> Identity
          </h3>
          <p className="set-row">
            <span>Operator</span>
            <b>{user?.name ?? '—'}</b>
          </p>
          <p className="set-row">
            <span>User ID</span>
            <b>{user?.user_id ?? '—'}</b>
          </p>
          <button className="set-danger" onClick={() => logout()}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </div>

      <p className="set-foot">EMORA AI · React 19 + Vite · FastAPI · Framer Motion · R3F</p>
    </div>
  )
}
