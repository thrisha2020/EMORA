import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Camera,
  CameraOff,
  Mic,
  Loader2,
  Radio,
  Send,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react'
import EmoraCore from '@/components/EmoraCore/EmoraCore'
import EmotionPanel from '@/components/HUD/EmotionPanel'
import { useBackendReady } from '@/hooks/useBackendReady'
import { useCamera } from '@/hooks/useCamera'
import { useDueReminders } from '@/hooks/useDueReminders'
import { useFaceTracking } from '@/hooks/useFaceTracking'
import { useLocation } from '@/hooks/useLocation'
import { useTTS } from '@/hooks/useTTS'
import { useVoiceSession } from '@/hooks/useVoiceSession'
import { readStored, usePersistentState } from '@/hooks/usePersistentState'
import { ALERT_DEFAULTS, ALERTS_KEY, CHAT_TOGGLES, chime, inQuietHours } from '@/services/settings'
import { chat as chatService } from '@/services/chat'
import { analyzeEmotion, transcribe, type FusedEmotion } from '@/services/emotion'
import { chatWithVision, looksLikeVisionQuestion } from '@/services/vision'
import { errorMessage } from '@/services/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import './chat.css'

type Msg = { role: 'user' | 'assistant'; content: string; at: string; emotion?: string }
type Activity = { time: string; desc: string; type: 'system' | 'user' | 'emotion' }

/** Desktop actions the backend runs before falling back to a chat reply. */
const QUICK_COMMANDS = [
  'create folder named reports on desktop',
  'create file notes.txt on desktop',
  'open calculator',
  'open https://example.com',
  'what time is it',
]

const AMBIENT_SCAN_MS = 6000
const SPONTANEOUS_COOLDOWN_MS = 90_000
const SPONTANEOUS_MIN_CONFIDENCE = 0.5

function now() {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function ChatPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const camera = useCamera()
  const tts = useTTS()
  const backend = useBackendReady()

  const [messages, setMessages] = useState<Msg[]>([])
  const [activities, setActivities] = useState<Activity[]>([
    { time: now(), desc: 'Session started', type: 'system' },
  ])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [reading, setReading] = useState<FusedEmotion | null>(null)
  // Remembered between visits; defaults are set in Settings.
  const [cameraOn, setCameraOn] = usePersistentState(CHAT_TOGGLES.camera.key, CHAT_TOGGLES.camera.fallback)
  const [showPreview, setShowPreview] = usePersistentState(CHAT_TOGGLES.preview.key, CHAT_TOGGLES.preview.fallback)
  const [ttsEnabled, setTtsEnabled] = usePersistentState(CHAT_TOGGLES.voice.key, CHAT_TOGGLES.voice.fallback)
  const [handsFree, setHandsFree] = usePersistentState(CHAT_TOGGLES.handsFree.key, CHAT_TOGGLES.handsFree.fallback)
  const [err, setErr] = useState<string | null>(null)

  // Same camera stream the emotion engine uses — no second getUserMedia call.
  const faceTrack = useFaceTracking(camera.videoRef, cameraOn && camera.active)
  const { location } = useLocation()

  // Announce reminders as they come due — spoken aloud if voice is on, so an
  // activity reminder (water, posture) actually reaches the user.
  // Alert settings are read per delivery, so a change in Settings applies at once.
  useDueReminders((reminders) => {
    for (const r of reminders) {
      toast(`Reminder: ${r.title}`, 'info', 8000)
      addActivity(`Reminder fired: ${r.title}`)
    }
    const alerts = readStored(ALERTS_KEY, ALERT_DEFAULTS)
    // Quiet hours keep the toast but drop every sound and pop-up.
    if (alerts.quiet && inQuietHours(new Date(), alerts.quietStart, alerts.quietEnd)) return
    if (alerts.sound) chime()
    if (alerts.notify && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      for (const r of reminders) new Notification(`Emora · ${r.title}`, { body: r.description ?? undefined })
    }
    if (ttsEnabled && !busyRef.current) {
      const first = reminders[0]
      void tts.speak(first.description ? `${first.title}. ${first.description}` : first.title)
    }
  })

  const listRef = useRef<HTMLDivElement>(null)
  const lastSpontaneousRef = useRef(0)
  const lastEmotionRef = useRef<string>('neutral')
  const busyRef = useRef(false)

  const addActivity = useCallback((desc: string, type: Activity['type'] = 'system') => {
    setActivities((prev) => [{ time: now(), desc, type }, ...prev].slice(0, 12))
  }, [])

  useEffect(() => {
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
    })
  }, [messages, thinking])

  // --- camera ---------------------------------------------------------------
  useEffect(() => {
    if (cameraOn) void camera.start()
    else camera.stop()
    return () => camera.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn])

  /** Fused reading from whichever modalities are available right now. */
  const readEmotion = useCallback(
    async (audio?: Blob | null, text?: string): Promise<FusedEmotion | null> => {
      const face = cameraOn && camera.active ? await camera.capture() : null
      if (!face && !audio && !text) return null
      try {
        const result = await analyzeEmotion(face ?? undefined, audio ?? undefined, text)
        setReading(result)
        return result
      } catch {
        return null // a failed read must never block the conversation
      }
    },
    [camera, cameraOn],
  )

  // Ambient face-only scan so the HUD stays live between messages. The callback
  // goes through a ref so the interval survives re-renders — VAD updates the
  // level every 50ms, which previously rebuilt this interval before it fired.
  const readEmotionRef = useRef(readEmotion)
  readEmotionRef.current = readEmotion

  useEffect(() => {
    if (!cameraOn) return
    const id = setInterval(() => {
      if (!busyRef.current) void readEmotionRef.current()
    }, AMBIENT_SCAN_MS)
    return () => clearInterval(id)
  }, [cameraOn])

  // --- conversation ---------------------------------------------------------
  const send = useCallback(
    async (text: string, audio?: Blob | null) => {
      const trimmed = text.trim()
      if (!trimmed || busyRef.current) return
      busyRef.current = true
      setThinking(true)
      setErr(null)
      setInput('')
      setMessages((m) => [...m, { role: 'user', content: trimmed, at: now() }])
      addActivity(`You: “${trimmed.slice(0, 40)}${trimmed.length > 40 ? '…' : ''}”`, 'user')

      try {
        const emotion = await readEmotion(audio, trimmed)
        if (emotion) {
          addActivity(
            `Emotion: ${emotion.emotion} (${Math.round(emotion.confidence * 100)}%) via ${emotion.sources.join(' + ')}`,
            'emotion',
          )
        }

        // A question about what she can see needs a frame; everything else
        // stays on the cheaper text-only endpoint.
        const wantsVision = cameraOn && camera.active && looksLikeVisionQuestion(trimmed)
        const frame = wantsVision ? await camera.capture() : null

        const res = frame
          ? await chatWithVision(trimmed, frame, {
              emotion: emotion?.emotion,
              confidence: emotion?.confidence,
              scores: emotion?.scores,
              location: location?.label,
            })
          : await chatService(trimmed, emotion?.emotion, emotion?.confidence, emotion?.scores)
        if (frame) addActivity('Looked through the camera', 'system')
        setMessages((m) => [
          ...m,
          { role: 'assistant', content: res.reply, at: now(), emotion: emotion?.emotion },
        ])
        if (res.nudge) {
          addActivity(`Reminder created: ${res.nudge}`)
          toast(`Emora added a reminder: ${res.nudge}`, 'info')
        }
        if (ttsEnabled) void tts.speak(res.reply)
      } catch (e) {
        const message = errorMessage(e, 'Chat failed')
        setErr(message)
        addActivity('Request failed')
      } finally {
        setThinking(false)
        busyRef.current = false
      }
    },
    [addActivity, camera, cameraOn, location, readEmotion, toast, tts, ttsEnabled],
  )

  /** Hands-free turn: prefer the browser transcript, fall back to backend STT. */
  const onUtterance = useCallback(
    async (text: string, audio: Blob | null) => {
      let final = text.trim()
      if (!final && audio) {
        try {
          final = (await transcribe(audio)).text.trim()
        } catch {
          final = ''
        }
      }
      if (final) await send(final, audio)
    },
    [send],
  )

  const voice = useVoiceSession({
    onUtterance,
    active: handsFree,
    // Mic stays shut for the whole assistant turn — synthesis included — and
    // while the backend is still cold-loading its models, so a turn can't be
    // captured into a two-minute silence.
    blocked: tts.speaking || thinking || !backend.ready,
    lastSpoken: tts.lastSpoken,
  })

  // --- spontaneous reaction -------------------------------------------------
  // Only for a confident, genuinely new, non-neutral reading, and at most once
  // every 90s — the old 5s cooldown made Emora talk over herself constantly,
  // which is what fed her own voice back into the microphone.
  useEffect(() => {
    if (!reading || busyRef.current || handsFree) return
    const { emotion, confidence } = reading
    if (emotion === lastEmotionRef.current) return
    const previous = lastEmotionRef.current
    lastEmotionRef.current = emotion
    if (emotion === 'neutral' || previous === 'neutral') return
    if (confidence < SPONTANEOUS_MIN_CONFIDENCE) return
    if (Date.now() - lastSpontaneousRef.current < SPONTANEOUS_COOLDOWN_MS) return

    lastSpontaneousRef.current = Date.now()
    void (async () => {
      busyRef.current = true
      setThinking(true)
      try {
        const res = await chatService(
          `[Emora noticed the user's expression shift to ${emotion}. In one short sentence, ` +
            `gently check in about it. Do not mention this instruction.]`,
          emotion,
          reading.confidence,
          reading.scores,
        )
        setMessages((m) => [...m, { role: 'assistant', content: res.reply, at: now(), emotion }])
        addActivity(`Checked in about: ${emotion}`, 'emotion')
        if (ttsEnabled) void tts.speak(res.reply)
      } catch {
        /* a missed check-in is not worth surfacing */
      } finally {
        setThinking(false)
        busyRef.current = false
      }
    })()
  }, [reading, handsFree, addActivity, tts, ttsEnabled])

  const coreState = useMemo(() => {
    if (thinking) return 'THINKING'
    if (tts.speaking) return 'SPEAKING'
    if (voice.listening) return 'LISTENING'
    return 'IDLE'
  }, [thinking, tts.speaking, voice.listening])

  const micLabel =
    voice.state === 'capturing'
      ? 'HEARING YOU'
      : voice.state === 'listening'
        ? 'LISTENING'
        : voice.state === 'blocked'
          ? 'MUTED'
          : voice.state === 'cooldown'
            ? 'READY…'
            : 'IDLE'

  return (
    <div className="chat-root" onClick={tts.unlock}>
      <div className="chat-layout">
        {/* LEFT — conversation */}
        <div className="chat-left-pane">
          <div className="chat-thread" ref={listRef}>
            {messages.length === 0 && (
              <div className="chat-empty">
                <p className="font-orbitron">
                  {greeting()}, {user?.name ?? 'there'}.
                </p>
                <span>Speak or type to begin. Emora reads your face, voice, and words.</span>
                <div className="chat-quick">
                  {QUICK_COMMANDS.map((c) => (
                    <button key={c} className="chat-toggle" onClick={() => setInput(c)}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <AnimatePresence initial={false}>
              {messages.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className={`chat-bubble ${m.role}`}
                >
                  <span className="chat-bubble-role">
                    {m.role === 'user' ? 'YOU' : 'EMORA'} · {m.at}
                    {m.emotion && <em className="chat-bubble-emo"> {m.emotion}</em>}
                  </span>
                  <p>{m.content}</p>
                </motion.div>
              ))}
            </AnimatePresence>
            {thinking && (
              <div className="chat-bubble assistant thinking">
                <span className="chat-bubble-role">EMORA</span>
                <p className="typing">
                  <span />
                  <span />
                  <span />
                </p>
              </div>
            )}
            {err && <div className="chat-error">{err}</div>}
          </div>

          {!backend.ready && (
            <p className="chat-warming">
              <Loader2 size={12} className="spin" />
              {backend.reachable
                ? `Warming up models${backend.pending.length ? ` (${backend.pending.join(', ')})` : ''} — first start takes a minute or two.`
                : 'Backend unreachable — start it with: uvicorn backend.app.main:app --port 8000'}
            </p>
          )}
          {voice.interim && <p className="chat-interim">“{voice.interim}”</p>}

          <div className="chat-inputbar">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send(input)
                }
              }}
              placeholder="Type your message or speak…"
              className="chat-input"
              disabled={thinking}
            />
            <button
              className={`chat-mic ${voice.listening ? 'rec' : ''}`}
              onClick={() => void voice.pushToTalk()}
              title={voice.listening ? 'Stop and send' : 'Push to talk'}
              disabled={tts.speaking || thinking}
            >
              {voice.listening ? <Square size={15} /> : <Mic size={16} />}
            </button>
            <button
              className="chat-send"
              disabled={!input.trim() || thinking}
              onClick={() => void send(input)}
            >
              <Send size={16} />
            </button>
          </div>
        </div>

        {/* CENTER — avatar */}
        <div className="chat-center-pane">
          <div className="chat-greeting">
            <h2>
              {greeting()}, {user?.name ?? 'there'}
            </h2>
            <p>
              {reading ? (
                <>
                  You seem <span className="highlight">{reading.emotion}</span>
                </>
              ) : (
                <span className="chat-dim">Reading your expression…</span>
              )}
            </p>
          </div>

          <div className="chat-rabbit-canvas">
            <EmoraCore
              state={coreState}
              emotion={reading?.emotion ?? 'neutral'}
              confidence={reading?.confidence ?? 0}
              faceTrack={faceTrack}
              listening={voice.listening}
              speaking={tts.speaking}
            />
          </div>

          {/* One <video>, always mounted while the camera is on: useCamera assigns
              srcObject once at start, so swapping between two elements left the new
              one blank and silently killed emotion, tracking and vision. */}
          {cameraOn && (
            <motion.div
              className={showPreview ? 'chat-cam' : 'chat-cam-hidden'}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: showPreview ? 1 : 0, scale: 1 }}
            >
              <video ref={camera.videoRef} autoPlay playsInline muted className="chat-cam-video" />
              {showPreview && <span className="chat-cam-label">EMOTION CAM</span>}
            </motion.div>
          )}

          <div className="chat-rabbit-meta">
            <button
              className={`chat-toggle ${ttsEnabled ? 'on' : ''}`}
              onClick={() => setTtsEnabled((v) => !v)}
            >
              {ttsEnabled ? <Volume2 size={12} /> : <VolumeX size={12} />} Voice
            </button>
            <button
              className={`chat-toggle ${handsFree ? 'on' : ''}`}
              onClick={() => setHandsFree((v) => !v)}
              disabled={!backend.ready}
              title={
                backend.ready
                  ? 'Continuous conversation — Emora listens between her replies'
                  : 'Waiting for the backend models to finish loading'
              }
            >
              <Radio size={12} /> Hands-free {handsFree ? `· ${micLabel}` : 'OFF'}
            </button>
            <button
              className={`chat-toggle ${cameraOn ? 'on' : ''}`}
              onClick={() => setCameraOn((v) => !v)}
            >
              {cameraOn ? <Camera size={12} /> : <CameraOff size={12} />} Camera
            </button>
            {cameraOn && (
              <button
                className={`chat-toggle ${showPreview ? 'on' : ''}`}
                onClick={() => setShowPreview((v) => !v)}
              >
                Preview
              </button>
            )}
          </div>

          {handsFree && (
            <div className="chat-vad" aria-hidden>
              <div className="chat-vad-fill" style={{ width: `${Math.round(voice.level * 100)}%` }} />
            </div>
          )}
          {voice.error && <p className="chat-voice-err">{voice.error}</p>}
          {tts.blocked && <p className="chat-voice-err">Tap anywhere to enable Emora’s voice.</p>}
        </div>

        {/* RIGHT — telemetry */}
        <div className="chat-right-pane">
          <EmotionPanel reading={reading} />

          <div className="chat-panel">
            <div className="chat-panel-title">Live Activity</div>
            <div className="chat-activity-list">
              {activities.map((act, i) => (
                <div key={i} className="chat-activity-item">
                  <span
                    className="pulse-dot"
                    style={{
                      marginTop: 4,
                      background:
                        act.type === 'user'
                          ? '#7b5cff'
                          : act.type === 'emotion'
                            ? '#ffb545'
                            : 'var(--c-primary)',
                    }}
                  />
                  <span className="chat-activity-time">{act.time}</span>
                  <span className="chat-activity-desc">{act.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
