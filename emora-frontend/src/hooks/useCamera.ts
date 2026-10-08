import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** Minimal browser-camera hook. Cleans up tracks on stop/unmount. */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera API not available in this browser')
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setActive(true)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Camera unavailable')
    }
  }, [])

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setActive(false)
  }, [])

  const capture = useCallback(async (): Promise<Blob | null> => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return null
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0)
    return new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92)
    })
  }, [])

  useEffect(() => {
    return () => stop()
  }, [stop])

  // Memoized: a fresh object every render would change the identity of any
  // caller's useCallback/useEffect that depends on it. Consumers put this in
  // effect deps, and with VAD re-rendering every 50ms an unstable identity
  // meant intervals were torn down and rebuilt before they could ever fire.
  return useMemo(
    () => ({ videoRef, active, error, start, stop, capture }),
    [active, error, start, stop, capture],
  )
}