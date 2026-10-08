import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Turn-taking voice session for hands-free conversation.
 *
 * Emora hearing herself, and then not answering at all, were both caused by a
 * pile of separate defects. Each guard below exists for one of them:
 *
 *  1. One owned MediaStream with AEC/NS/AGC. Its track is hard-disabled while
 *     the assistant speaks, and the recognizer is aborted rather than paused —
 *     the browser recognizer runs on its own stream, so the recorder's echo
 *     cancellation never applied to it.
 *  2. A cooldown after playback, so the audio tail and room reverb aren't
 *     captured as the user's next utterance.
 *  3. A turn counter: recognizer or recorder results from an earlier turn are
 *     discarded instead of submitted.
 *  4. An echo guard that drops transcripts which mostly repeat what Emora just
 *     said, for when AEC leaks on loud speakers.
 *  5. Energy-based endpointing against a noise floor that tracks the *quietest*
 *     recent frame. Averaging the first N frames meant speaking the moment the
 *     mic opened — the normal case here — set the threshold above the user's own
 *     voice, so speech was never detected and the turn hung forever.
 *  6. A give-up timeout for a window where no speech is ever detected, so a
 *     turn can't hang indefinitely.
 *  7. An empty transcript does not cancel a turn. VAD routinely endpoints before
 *     Chrome finalises, and Chrome yields nothing at all offline, but the
 *     recording is still good — it goes to the caller for server-side STT.
 *  8. Re-entrancy guards (openingRef / finishingRef). Opening and finishing are
 *     both async, and the watchdog ticks during their awaits: a second entrant
 *     used to mute the microphone the first was using, or reset the refs the
 *     finishing turn was about to read, silently dropping the utterance.
 *  9. finishTurn snapshots everything it owns before awaiting the recorder
 *     flush, for the same reason.
 * 10. A self-healing watchdog rather than a one-shot timer — a single timeout
 *     could be cancelled by an unrelated re-render, or consumed by an attempt
 *     that aborted on the gate, leaving the mic closed forever.
 */

export type VoiceState = 'off' | 'idle' | 'listening' | 'capturing' | 'blocked' | 'cooldown'

interface Options {
  /** Fires once per completed utterance. */
  onUtterance: (text: string, audio: Blob | null) => void | Promise<void>
  /** Hands-free master switch. */
  active: boolean
  /** True while the assistant is speaking or thinking — mic stays shut. */
  blocked: boolean
  /** What the assistant last said, used to reject echoed transcripts. */
  lastSpoken?: string
  /** Silence (ms) that ends an utterance. */
  silenceMs?: number
  /** Delay (ms) after the assistant stops before reopening the mic. */
  cooldownMs?: number
}

const VAD_INTERVAL_MS = 50
const SPEECH_FRAMES = 3 // ~150ms above threshold to count as speech onset
const MIN_SPEECH_MS = 300
const MAX_UTTERANCE_MS = 15000
/** Give up on a window where no speech is ever detected, so a turn can't hang. */
const MAX_LISTEN_MS = 12000

// Noise-floor tracking. The floor follows the quietest recent frame and drifts
// back up slowly, so it can never be pinned high by speech that is already in
// progress when the mic opens — the failure that made hands-free never endpoint.
const FLOOR_DECAY = 1.015 // per frame drift upward when nothing is quieter
const FLOOR_SEED = 0.01
const THRESHOLD_MULTIPLIER = 2.5
const THRESHOLD_OFFSET = 0.004
// Absolute floor on the threshold. Kept low deliberately: a quiet speaker in a
// quiet room can sit near 0.012, and an absolute minimum above that means their
// speech is never detected at all. SPEECH_FRAMES + MIN_SPEECH_MS reject the
// short blips that this sensitivity would otherwise let through.
const THRESHOLD_MIN = 0.006
// Hard ceiling: normal speech must always be able to cross the threshold.
const THRESHOLD_MAX = 0.06

interface SRLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: unknown) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

function getSRCtor(): (new () => SRLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SRLike
    webkitSpeechRecognition?: new () => SRLike
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
}

/** True when `heard` is mostly a repeat of `spoken` — i.e. Emora hearing herself. */
export function isEcho(heard: string, spoken: string | undefined): boolean {
  if (!spoken) return false
  const heardWords = normalize(heard)
  if (heardWords.length === 0) return true
  const spokenWords = new Set(normalize(spoken))
  if (spokenWords.size === 0) return false
  const overlap = heardWords.filter((w) => spokenWords.has(w)).length
  return overlap / heardWords.length >= 0.6
}

export function useVoiceSession({
  onUtterance,
  active,
  blocked,
  lastSpoken,
  silenceMs = 900,
  cooldownMs = 650,
}: Options) {
  const [state, setState] = useState<VoiceState>('off')
  const [level, setLevel] = useState(0)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const vadTimerRef = useRef<number | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recRef = useRef<SRLike | null>(null)

  // Incremented on every turn boundary; results tagged with a stale turn are dropped.
  const turnRef = useRef(0)
  const transcriptRef = useRef('')
  const interimRef = useRef('')
  const listeningRef = useRef(false)
  // Set synchronously while an open is in flight. beginListening awaits, so the
  // watchdog can re-enter it before listeningRef flips; a second entrant used to
  // reach the abort path and mute the microphone the first one was using.
  const openingRef = useRef(false)
  /** Set while a turn is being finalised, so no new session opens mid-flush. */
  const finishingRef = useRef(false)
  const speechFramesRef = useRef(0)
  const floorRef = useRef(FLOOR_SEED)
  const thresholdRef = useRef(THRESHOLD_MIN)
  const windowStartedAtRef = useRef(0)
  const speechStartedAtRef = useRef(0)
  const lastVoiceAtRef = useRef(0)
  const lastLevelRef = useRef(0)
  const blockedRef = useRef(blocked)
  const activeRef = useRef(active)
  const onUtteranceRef = useRef(onUtterance)
  const lastSpokenRef = useRef(lastSpoken)
  onUtteranceRef.current = onUtterance
  lastSpokenRef.current = lastSpoken
  blockedRef.current = blocked
  activeRef.current = active

  // --- microphone ownership -------------------------------------------------

  const ensureStream = useCallback(async (): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.current = stream
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      ctx.createMediaStreamSource(stream).connect(analyser)
      ctxRef.current = ctx
      analyserRef.current = analyser
      setError(null)
      return stream
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Microphone unavailable')
      return null
    }
  }, [])

  /** Hard gate: disabling the track stops samples at the source, not just downstream. */
  const setMicEnabled = useCallback((enabled: boolean) => {
    streamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = enabled
    })
  }, [])

  const stopRecognizer = useCallback(() => {
    const rec = recRef.current
    if (!rec) return
    rec.onresult = null
    rec.onend = null
    rec.onerror = null
    try {
      rec.abort()
    } catch {
      /* already stopped */
    }
    recRef.current = null
  }, [])

  const startRecognizer = useCallback((turn: number) => {
    const Ctor = getSRCtor()
    if (!Ctor) return
    stopRecognizer()
    const rec = new Ctor()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.onresult = (e) => {
      if (turnRef.current !== turn) return // stale turn — ignore
      let interimText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        if (res.isFinal) transcriptRef.current += res[0].transcript + ' '
        else interimText += res[0].transcript
      }
      interimRef.current = interimText
      setInterim(interimText)
    }
    rec.onend = () => {
      // Chrome ends the session periodically; restart while the turn is still ours.
      if (turnRef.current === turn && listeningRef.current) {
        try {
          rec.start()
        } catch {
          /* will retry on next listen cycle */
        }
      }
    }
    rec.onerror = () => {
      /* transient; VAD still drives endpointing */
    }
    recRef.current = rec
    try {
      rec.start()
    } catch {
      /* already started */
    }
  }, [stopRecognizer])

  // --- capture lifecycle ----------------------------------------------------

  const stopVad = useCallback(() => {
    if (vadTimerRef.current !== null) {
      clearInterval(vadTimerRef.current)
      vadTimerRef.current = null
    }
    setLevel(0)
  }, [])

  const finishTurn = useCallback(
    async (submit: boolean) => {
      if (finishingRef.current) return
      finishingRef.current = true
      const turn = turnRef.current
      listeningRef.current = false
      stopVad()
      stopRecognizer()

      // Snapshot everything this turn owns *before* awaiting the recorder flush.
      // The watchdog sees the mic as free the moment listeningRef clears, and a
      // new session resets these refs — which used to leave the finishing turn
      // reading the next one's empty state and silently dropping the utterance.
      const recorder = recorderRef.current
      const chunks = chunksRef.current
      const text = (transcriptRef.current.trim() || interimRef.current.trim()).trim()
      const heardSpeech = speechStartedAtRef.current > 0
      recorderRef.current = null
      chunksRef.current = []
      transcriptRef.current = ''
      interimRef.current = ''
      speechStartedAtRef.current = 0
      setInterim('')
      turnRef.current += 1

      let blob: Blob | null = null
      if (recorder && recorder.state !== 'inactive') {
        blob = await new Promise<Blob | null>((resolve) => {
          recorder.onstop = () =>
            resolve(
              chunks.length
                ? new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
                : null,
            )
          try {
            recorder.stop()
          } catch {
            resolve(null)
          }
        })
      }

      finishingRef.current = false

      // No transcript is not the same as no utterance: VAD routinely endpoints
      // before Chrome finalises, and Chrome yields nothing at all offline, yet
      // the recording is good. Hand the audio over for server-side STT.
      if (!submit || (!text && !(heardSpeech && blob))) {
        setState(activeRef.current ? 'idle' : 'off')
        return
      }
      if (text && isEcho(text, lastSpokenRef.current)) {
        // Emora heard herself through the speakers — drop it silently.
        setState(activeRef.current ? 'idle' : 'off')
        return
      }
      if (turn !== turnRef.current - 1) {
        setState(activeRef.current ? 'idle' : 'off')
        return
      }
      setState('idle')
      await onUtteranceRef.current(text, blob)
    },
    [stopRecognizer, stopVad],
  )

  const openSession = useCallback(async () => {
    const stream = await ensureStream()
    if (!stream) return

    await ctxRef.current?.resume().catch(() => undefined)

    // Re-check the gate: both awaits above yield, and the assistant can start
    // speaking in that gap. Muting is left to the blocked effect — doing it here
    // would cut off a session that another entrant legitimately owns.
    setMicEnabled(true)

    const turn = turnRef.current
    listeningRef.current = true
    transcriptRef.current = ''
    chunksRef.current = []
    speechFramesRef.current = 0
    floorRef.current = FLOOR_SEED
    thresholdRef.current = THRESHOLD_MIN
    windowStartedAtRef.current = Date.now()
    speechStartedAtRef.current = 0
    lastVoiceAtRef.current = 0
    setState('listening')
    startRecognizer(turn)

    // Recorder runs from the start of the window so the onset of speech isn't clipped.
    try {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : undefined
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.start(100)
      recorderRef.current = recorder
    } catch {
      recorderRef.current = null
    }

    const analyser = analyserRef.current
    if (!analyser) return
    const buf = new Float32Array(analyser.fftSize)

    vadTimerRef.current = window.setInterval(() => {
      if (!listeningRef.current || turnRef.current !== turn) return
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const rms = Math.sqrt(sum / buf.length)

      // Only push a level change the meter can actually show. Setting state on
      // every 50ms frame re-rendered the whole page 20×/second, which churned
      // callback identities in consumers and starved their intervals.
      const next = Math.min(rms * 8, 1)
      if (Math.abs(next - lastLevelRef.current) > 0.06) {
        lastLevelRef.current = next
        setLevel(next)
      }

      // Track the quietest recent frame as the noise floor. Taking the minimum
      // (rather than an average of the first 500ms) means speech already in
      // progress raises nothing, and the slow upward drift lets the floor
      // recover if the room genuinely gets louder.
      const floor = floorRef.current
      floorRef.current = rms < floor ? rms : Math.min(floor * FLOOR_DECAY, THRESHOLD_MAX)
      thresholdRef.current = Math.min(
        Math.max(floorRef.current * THRESHOLD_MULTIPLIER + THRESHOLD_OFFSET, THRESHOLD_MIN),
        THRESHOLD_MAX,
      )

      const now = Date.now()
      const speaking = rms > thresholdRef.current

      // Nothing recognisable as speech in the whole window — release the turn
      // rather than listening forever.
      if (!speechStartedAtRef.current && now - windowStartedAtRef.current > MAX_LISTEN_MS) {
        void finishTurn(false)
        return
      }

      if (speaking) {
        speechFramesRef.current += 1
        lastVoiceAtRef.current = now
        if (speechFramesRef.current >= SPEECH_FRAMES && !speechStartedAtRef.current) {
          speechStartedAtRef.current = now
          setState('capturing')
        }
      } else {
        speechFramesRef.current = 0
      }

      if (!speechStartedAtRef.current) return

      const spokenFor = now - speechStartedAtRef.current
      const silentFor = now - lastVoiceAtRef.current
      if (spokenFor > MAX_UTTERANCE_MS || (silentFor > silenceMs && spokenFor > MIN_SPEECH_MS)) {
        void finishTurn(true)
      }
    }, VAD_INTERVAL_MS)
  }, [ensureStream, finishTurn, setMicEnabled, silenceMs, startRecognizer])

  /** Serialised entry point: only one open may be in flight at a time. */
  const beginListening = useCallback(async () => {
    if (listeningRef.current || openingRef.current || finishingRef.current) return
    openingRef.current = true
    try {
      await openSession()
    } finally {
      openingRef.current = false
    }
  }, [openSession])

  const abortListening = useCallback(() => {
    if (!listeningRef.current) return
    void finishTurn(false)
  }, [finishTurn])

  // --- orchestration --------------------------------------------------------

  // The assistant speaking or thinking closes the mic immediately.
  useEffect(() => {
    if (!blocked) return
    turnRef.current += 1 // invalidate anything in flight
    listeningRef.current = false
    stopVad()
    stopRecognizer()
    setMicEnabled(false)
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop()
      } catch {
        /* noop */
      }
      recorderRef.current = null
    }
    chunksRef.current = []
    transcriptRef.current = ''
    setInterim('')
    setState('blocked')
  }, [blocked, setMicEnabled, stopRecognizer, stopVad])

  // Keep the mic open whenever it should be, re-checking on a tick rather than
  // with a one-shot timer. A single timeout could be cancelled by an unrelated
  // re-render, or consumed by an attempt that aborted on the gate above, and
  // then nothing ever reopened the microphone. A watchdog is self-healing.
  useEffect(() => {
    if (!active) return
    if (blocked) return

    let cancelled = false
    setState((prev) => (prev === 'listening' || prev === 'capturing' ? prev : 'cooldown'))

    const tick = () => {
      if (cancelled) return
      if (
        !blockedRef.current &&
        activeRef.current &&
        !listeningRef.current &&
        !finishingRef.current
      ) {
        void beginListening()
      }
    }
    // First attempt after the cooldown, then retry on the same cadence.
    const timer = window.setInterval(tick, cooldownMs)
    const first = window.setTimeout(tick, cooldownMs)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.clearTimeout(first)
    }
  }, [blocked, active, cooldownMs, beginListening])

  // Master switch off — release everything.
  useEffect(() => {
    if (active) return
    turnRef.current += 1
    listeningRef.current = false
    stopVad()
    stopRecognizer()
    setMicEnabled(false)
    setState('off')
  }, [active, setMicEnabled, stopRecognizer, stopVad])

  useEffect(() => {
    return () => {
      turnRef.current += 1
      listeningRef.current = false
      if (vadTimerRef.current !== null) clearInterval(vadTimerRef.current)
      stopRecognizer()
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      void ctxRef.current?.close().catch(() => undefined)
      ctxRef.current = null
    }
  }, [stopRecognizer])

  /** One-shot capture for the push-to-talk button (works with hands-free off). */
  const pushToTalk = useCallback(async () => {
    if (listeningRef.current) {
      await finishTurn(true)
    } else {
      await beginListening()
    }
  }, [beginListening, finishTurn])

  return {
    state,
    level,
    interim,
    error,
    listening: state === 'listening' || state === 'capturing',
    supported: Boolean(getSRCtor()) || typeof MediaRecorder !== 'undefined',
    pushToTalk,
    abort: abortListening,
  }
}
