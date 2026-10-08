import { useCallback, useRef, useState } from 'react'

interface UseMediaRecorder {
  recording: boolean
  supported: boolean
  start: () => Promise<void>
  stop: () => Promise<Blob | null>
  error: string | null
}

/** MediaRecorder wrapper that yields a single audio blob per session. */
export function useMediaRecorder(): UseMediaRecorder {
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const supported = typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && Boolean(window.MediaRecorder)

  const start = useCallback(async () => {
    setError(null)
    if (!supported) {
      setError('MediaRecorder not supported in this browser')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true, 
          autoGainControl: true 
        } 
      })
      streamRef.current = stream
      chunksRef.current = []
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : undefined
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.start(100)
      recorderRef.current = rec
      setRecording(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Microphone access denied')
    }
  }, [supported])

  const stop = useCallback(async (): Promise<Blob | null> => {
    const rec = recorderRef.current
    if (!rec) return null
    return new Promise<Blob | null>((resolve) => {
      rec.onstop = () => {
        const blob = chunksRef.current.length ? new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' }) : null
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        recorderRef.current = null
        setRecording(false)
        resolve(blob)
      }
      try {
        rec.stop()
      } catch {
        resolve(null)
      }
    })
  }, [])

  return { recording, supported, start, stop, error }
}