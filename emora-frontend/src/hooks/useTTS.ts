import { useCallback, useEffect, useRef, useState } from 'react'
import { tts as ttsService } from '@/services/assistant'
import { rateParam, VOICE_DEFAULTS, VOICE_KEY } from '@/services/settings'
import { readStored } from './usePersistentState'

/**
 * TTS playback: POST /api/tts -> blob -> <audio>.
 *
 * `speaking` goes true *before* the network call so the microphone is gated for
 * the whole request, not just for playback — otherwise the mic stays open during
 * synthesis and catches the first syllable of the reply. `lastSpoken` feeds the
 * echo guard in useVoiceSession.
 */
export function useTTS() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)
  const seqRef = useRef(0)
  const [speaking, setSpeaking] = useState(false)
  const [lastSpoken, setLastSpoken] = useState<string>('')
  const [blocked, setBlocked] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (audioRef.current === null && typeof Audio !== 'undefined') {
    audioRef.current = new Audio()
  }

  const releaseUrl = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    seqRef.current += 1
    const a = audioRef.current
    if (a) {
      a.pause()
      a.removeAttribute('src')
      a.load()
    }
    releaseUrl()
    setSpeaking(false)
  }, [releaseUrl])

  const speak = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      stop()
      const seq = ++seqRef.current
      setError(null)
      setSpeaking(true) // gate the mic across synthesis, not just playback
      setLastSpoken(trimmed)
      try {
        // Read at speak time so a change in Settings applies to the next reply.
        const { voice, rate } = readStored(VOICE_KEY, VOICE_DEFAULTS)
        const blob = await ttsService(trimmed, voice, rateParam(rate))
        if (seqRef.current !== seq) return // superseded by a newer utterance
        const url = URL.createObjectURL(blob)
        urlRef.current = url
        const a = audioRef.current
        if (!a) {
          setSpeaking(false)
          return
        }
        a.src = url
        a.onended = () => {
          if (seqRef.current === seq) setSpeaking(false)
          releaseUrl()
        }
        a.onerror = () => {
          if (seqRef.current === seq) setSpeaking(false)
          setError('Playback failed')
        }
        await a.play()
        setBlocked(false)
      } catch (e) {
        if (seqRef.current === seq) setSpeaking(false)
        // Autoplay policy rejects playback until the user interacts with the page.
        if (e instanceof DOMException && e.name === 'NotAllowedError') {
          setBlocked(true)
          setError('Tap anywhere to enable Emora’s voice')
        } else {
          setError(e instanceof Error ? e.message : 'TTS failed')
        }
      }
    },
    [releaseUrl, stop],
  )

  /** Satisfy the autoplay gesture requirement from a click handler. */
  const unlock = useCallback(() => {
    const a = audioRef.current
    if (!a) return
    a.muted = true
    a.play()
      .then(() => {
        a.pause()
        a.muted = false
        setBlocked(false)
      })
      .catch(() => {
        a.muted = false
      })
  }, [])

  useEffect(() => {
    return () => {
      seqRef.current += 1
      audioRef.current?.pause()
      releaseUrl()
    }
  }, [releaseUrl])

  return { speaking, lastSpoken, blocked, error, speak, stop, unlock }
}
