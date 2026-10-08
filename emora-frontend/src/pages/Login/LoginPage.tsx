import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Lock, Mic, Pencil } from 'lucide-react'
import EmoraCore from '@/components/EmoraCore/EmoraCore'
import SpeechHud from '@/components/HUD/SpeechHud'
import SilentScan from '@/components/FaceScanner/SilentScan'
import { useCamera } from '@/hooks/useCamera'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'
import { useTTS } from '@/hooks/useTTS'
import { useAuth } from '@/contexts/AuthContext'
import { identify } from '@/services/auth'
import { errorMessage } from '@/services/api'
import './login.css'

const ParticlesBg = lazy(() => import('@/components/Particles/ParticlesBg'))

/**
 * Conversational login: Emora asks for a name, hears it, then verifies the face
 * silently — the camera runs but is never shown, so the screen stays a single
 * calm HUD instead of cutting to a webcam feed.
 *
 * An unrecognised name falls through to inline enrollment in the same flow
 * rather than bouncing to a separate Register page.
 */
type Phase =
  | 'boot'
  | 'greeting'
  | 'listening'
  | 'confirm'
  | 'identifying'
  | 'enrollAsk'
  | 'scanning'
  | 'verifying'
  | 'welcome'
  | 'failed'

const AUTO_ADVANCE_MS = 2600
const SCAN_CAPTURE_DELAY_MS = 2200
const MAX_CAPTURE_ATTEMPTS = 3

function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 3)
}

function cleanName(raw: string): string {
  // Speech recognition returns "my name is Akash" / "I'm Akash" — keep the name.
  const stripped = raw
    .replace(/^(hi|hey|hello)[\s,]+/i, '')
    .replace(/^(my name is|my name's|i am|i'm|it's|its|this is|call me)\s+/i, '')
    .replace(/[.,!?]+$/, '')
    .trim()
  const words = stripped.split(/\s+/).slice(0, 3).join(' ')
  return words.replace(/\b\w/g, (c) => c.toUpperCase())
}

function isAffirmative(text: string): boolean {
  return /\b(yes|yeah|yep|yup|sure|ok|okay|please|go ahead|do it|correct)\b/i.test(text)
}

function isNegative(text: string): boolean {
  return /\b(no|nope|nah|cancel|stop|wait|not)\b/i.test(text)
}

export default function LoginPage() {
  const navigate = useNavigate()
  const { login, register } = useAuth()
  const camera = useCamera()
  const tts = useTTS()

  const [phase, setPhase] = useState<Phase>('boot')
  const [bootT, setBootT] = useState(0)
  const [name, setName] = useState('')
  const [speech, setSpeech] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [enrolling, setEnrolling] = useState(false)
  const [scanSeq, setScanSeq] = useState(0) // bumped per scan attempt; keys the capture effect
  const [edited, setEdited] = useState(false)

  const phaseRef = useRef<Phase>('boot')
  phaseRef.current = phase
  const editedRef = useRef(false)
  editedRef.current = edited

  const say = useCallback(
    (line: string) => {
      setSpeech(line)
      void tts.speak(line)
    },
    [tts],
  )

  // Voice answers are routed by phase: a name while listening, yes/no while asking.
  const mic = useSpeechRecognition((text) => {
    const current = phaseRef.current
    if (current === 'listening') {
      const parsed = cleanName(text)
      if (parsed.length >= 2) {
        setName(parsed)
        setPhase('confirm')
      }
    } else if (current === 'enrollAsk') {
      if (isAffirmative(text)) void beginScan(true)
      else if (isNegative(text)) {
        setPhase('listening')
        say('No problem. What name should I use?')
      }
    }
  })

  // --- boot -----------------------------------------------------------------
  useEffect(() => {
    const t0 = performance.now()
    let raf = 0
    const step = (now: number) => {
      const p = Math.min((now - t0) / 1900, 1)
      setBootT(p)
      if (p < 1) raf = requestAnimationFrame(step)
      else {
        setSpeech("Hello. I'm Emora.\nWhat should I call you?")
        setPhase('greeting')
      }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Speak the greeting once it has finished typing, then open the mic.
  const onGreetingTyped = useCallback(() => {
    void tts.speak("Hello. I'm Emora. What should I call you?")
    setPhase('listening')
    if (mic.supported) mic.start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- name confirmation ----------------------------------------------------
  // Show the heard name briefly so a misheard one can be corrected, then move on.
  useEffect(() => {
    if (phase !== 'confirm') return
    setSpeech(`${name}. Give me a moment.`)
    const timer = window.setTimeout(() => {
      if (phaseRef.current === 'confirm' && !editedRef.current) void runIdentify(name)
    }, AUTO_ADVANCE_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, name])

  const runIdentify = useCallback(
    async (candidate: string) => {
      const trimmed = candidate.trim()
      if (trimmed.length < 2) {
        setPhase('listening')
        return
      }
      setPhase('identifying')
      setErr(null)
      try {
        const result = await identify(trimmed)
        if (result.known) {
          await beginScan(false)
        } else {
          setEnrolling(true)
          setPhase('enrollAsk')
          say(`I don't think we've met, ${trimmed}.\nShall I learn your face?`)
          if (mic.supported) mic.start()
        }
      } catch (e) {
        setErr(errorMessage(e, 'Could not reach Emora’s backend.'))
        setPhase('failed')
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [say, mic.supported],
  )

  // --- silent face scan -----------------------------------------------------
  const beginScan = useCallback(
    async (isEnrollment: boolean) => {
      setEnrolling(isEnrollment)
      setErr(null)
      setScanSeq((n) => n + 1) // drives the capture effect; `phase` must not, see below
      setPhase('scanning')
      say(isEnrollment ? 'Hold still — learning your face.' : 'Verifying. Look at the screen.')
      await camera.start()
    },
    [camera, say],
  )

  // Capture happens on a timer once the camera is warm, invisible to the user.
  //
  // Keyed to `scanSeq`, not `phase`: the run itself sets phase to 'verifying',
  // and with `phase` in the deps that re-ran the effect mid-capture. The cleanup
  // then cancelled the live attempt, so a failed scan never reached 'failed' and
  // the UI sat on "VERIFYING" with the camera still on.
  useEffect(() => {
    if (!scanSeq || !camera.active) return
    let cancelled = false

    const run = async () => {
      await new Promise((r) => window.setTimeout(r, SCAN_CAPTURE_DELAY_MS))
      if (cancelled) return
      setPhase('verifying')

      let lastError = 'Could not read your face.'
      for (let attempt = 0; attempt < MAX_CAPTURE_ATTEMPTS; attempt++) {
        if (cancelled) return
        const shot = await camera.capture()
        if (shot) {
          try {
            if (enrolling) await register(name.trim(), shot)
            else await login(shot, name.trim())
            if (cancelled) return
            camera.stop()
            setPhase('welcome')
            say(enrolling ? `Good to meet you, ${name}.` : `Welcome back, ${name}.`)
            window.setTimeout(() => navigate('/chat', { replace: true }), 1800)
            return
          } catch (e) {
            lastError = errorMessage(e, lastError)
          }
        }
        await new Promise((r) => window.setTimeout(r, 700))
      }

      if (cancelled) return
      camera.stop()
      setErr(lastError)
      setPhase('failed')
      say("I couldn't verify that. Want to try again?")
    }

    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanSeq, camera.active])

  useEffect(() => () => camera.stop(), [])

  const retry = useCallback(() => {
    setErr(null)
    setEdited(false)
    setEnrolling(false)
    setName('')
    setPhase('listening')
    say('What should I call you?')
    if (mic.supported) mic.start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [say, mic.supported])

  const materialize = easeOut(Math.min(bootT / 0.7, 1))
  const scanning = phase === 'scanning' || phase === 'verifying'
  const showNameRow = phase === 'listening' || phase === 'confirm'

  return (
    <div className="login-grid scanlines" onClick={tts.unlock}>
      <Suspense fallback={null}>
        <ParticlesBg variant="minimal" />
      </Suspense>

      {/* The camera never appears on screen — it only feeds capture(). */}
      <video
        ref={camera.videoRef}
        autoPlay
        playsInline
        muted
        aria-hidden
        className="login-hidden-cam"
      />

      <div className="login-row-top">
        <AnimatePresence>
          {bootT > 0.35 && (
            <motion.div
              key="brand"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              className="login-brand"
            >
              <h1 className="font-orbitron">
                EMORA <span className="ai">AI</span>
              </h1>
              <p>EMOTION-AWARE ASSISTANT</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="login-row-mid">
        <motion.div
          animate={{ scale: scanning ? 0.88 : 1, opacity: phase === 'boot' ? materialize : 1 }}
          transition={{ type: 'spring', stiffness: 120, damping: 18 }}
          style={{ width: '100%', height: '100%' }}
        >
          <EmoraCore
            state={phase.toUpperCase()}
            emotion="neutral"
            listening={mic.listening}
            speaking={tts.speaking}
            materialize={phase === 'boot' ? materialize : 1}
            rings={phase === 'boot' ? easeOut(bootT) : 1}
          />
        </motion.div>
        <div className="login-speech">
          <SpeechHud
            message={speech}
            visible={speech !== ''}
            onTyped={phase === 'greeting' ? onGreetingTyped : undefined}
          />
        </div>
      </div>

      <div className="login-row-bot">
        <AnimatePresence mode="wait">
          {scanning && (
            <motion.div
              key="scan"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.45 }}
            >
              <SilentScan
                label={enrolling ? 'LEARNING FACE' : 'VERIFYING IDENTITY'}
                active={camera.active}
                settled={phase === 'verifying'}
              />
            </motion.div>
          )}

          {showNameRow && (
            <motion.div
              key="name"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.45 }}
              className="login-namecol"
            >
              <div className="login-input-row">
                <input
                  className="login-input"
                  placeholder={mic.listening ? 'Listening…' : 'Or type your name'}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    setEdited(true)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && name.trim().length > 1) void runIdentify(name)
                  }}
                  autoFocus
                />
                <button
                  className={`login-mic ${mic.listening ? 'live' : ''}`}
                  onClick={() => (mic.listening ? mic.stop() : mic.start())}
                  disabled={!mic.supported}
                  title={mic.supported ? 'Speak your name' : 'Speech input unavailable'}
                >
                  <Mic size={18} />
                  <span className="font-orbitron">{mic.listening ? 'LISTENING' : 'SPEAK'}</span>
                </button>
                <button
                  className="login-go"
                  disabled={name.trim().length <= 1}
                  onClick={() => void runIdentify(name)}
                >
                  <span className="font-orbitron">CONTINUE</span>
                  <ArrowRight size={18} />
                </button>
              </div>
              {mic.interim && <p className="login-mic-text">“{mic.interim}”</p>}
              {phase === 'confirm' && !edited && (
                <p className="login-note">
                  <Pencil size={11} /> NOT RIGHT? EDIT THE NAME TO STAY HERE
                </p>
              )}
            </motion.div>
          )}

          {phase === 'enrollAsk' && (
            <motion.div
              key="enroll"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="login-namecol"
            >
              <div className="login-input-row">
                <button className="login-go" onClick={() => void beginScan(true)}>
                  <span className="font-orbitron">YES, LEARN MY FACE</span>
                  <ArrowRight size={18} />
                </button>
                <button className="login-mic" onClick={retry}>
                  <span className="font-orbitron">USE ANOTHER NAME</span>
                </button>
              </div>
              {mic.interim && <p className="login-mic-text">“{mic.interim}”</p>}
            </motion.div>
          )}

          {phase === 'failed' && (
            <motion.div
              key="failed"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="login-namecol"
            >
              {err && <p className="login-err">{err}</p>}
              <div className="login-input-row">
                <button className="login-go" onClick={retry}>
                  <span className="font-orbitron">TRY AGAIN</span>
                  <ArrowRight size={18} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="login-corner login-corner-tl">
        <Lock size={11} /> SECURE · ON-DEVICE CAPTURE
      </div>
      <div className="login-corner login-corner-tr">
        <span className="pulse-dot" /> SYSTEM ONLINE
      </div>
    </div>
  )
}
