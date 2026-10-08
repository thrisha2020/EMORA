import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * One-shot browser SpeechRecognition, for short prompted answers (a name, a
 * yes/no). Continuous conversation belongs in useVoiceSession instead.
 *
 * `start()` previously read `listening` from a stale closure, so a rejected
 * start could retry forever against an already-running recognizer; the guard is
 * a ref now, and a fresh recognizer is built per utterance so a previous
 * session's results can never land in this one.
 */

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

function getCtor(): (new () => SRLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SRLike
    webkitSpeechRecognition?: new () => SRLike
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function useSpeechRecognition(onFinal?: (text: string) => void) {
  const [supported] = useState(() => Boolean(getCtor()))
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')

  const recRef = useRef<SRLike | null>(null)
  const listeningRef = useRef(false)
  const onFinalRef = useRef(onFinal)
  onFinalRef.current = onFinal

  const teardown = useCallback(() => {
    const rec = recRef.current
    if (rec) {
      rec.onresult = null
      rec.onend = null
      rec.onerror = null
      try {
        rec.abort()
      } catch {
        /* already stopped */
      }
      recRef.current = null
    }
    listeningRef.current = false
    setListening(false)
  }, [])

  const start = useCallback(() => {
    const Ctor = getCtor()
    if (!Ctor || listeningRef.current) return
    teardown()

    const rec = new Ctor()
    rec.continuous = false
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.onresult = (e) => {
      if (recRef.current !== rec) return
      let interimText = ''
      let finalText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        if (res.isFinal) finalText += res[0].transcript
        else interimText += res[0].transcript
      }
      setInterim(interimText)
      if (finalText.trim()) onFinalRef.current?.(finalText.trim())
    }
    rec.onend = () => {
      if (recRef.current === rec) {
        listeningRef.current = false
        setListening(false)
      }
    }
    rec.onerror = () => {
      if (recRef.current === rec) {
        listeningRef.current = false
        setListening(false)
      }
    }

    recRef.current = rec
    setInterim('')
    try {
      rec.start()
      listeningRef.current = true
      setListening(true)
    } catch {
      teardown()
    }
  }, [teardown])

  const stop = useCallback(() => {
    try {
      recRef.current?.stop()
    } catch {
      /* noop */
    }
  }, [])

  useEffect(() => teardown, [teardown])

  return { supported, listening, interim, start, stop, abort: teardown }
}
