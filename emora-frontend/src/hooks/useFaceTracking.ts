import { useCallback, useEffect, useRef } from 'react'
import { api, formData } from '@/services/api'

/**
 * Tracks where the user's head is in the webcam frame, so the avatar can look
 * at *them* rather than at the mouse cursor.
 *
 * Position is polled a few times a second and smoothed; the avatar reads the
 * smoothed value every frame. Polling faster would not help — a head does not
 * move meaningfully between frames at 60fps — and it keeps the cost off both
 * the network and the (already memory-tight) backend.
 *
 * Frames are downscaled to 320px before upload: the Haar cascade behind
 * /api/face/track downsizes anyway, so sending more is pure waste.
 */

export interface FaceTrack {
  /** -1 (user at their left) .. +1 (their right), already mirrored. */
  x: number
  /** -1 (top of frame) .. +1 (bottom). */
  y: number
  /** Face height as a fraction of frame height — a proxy for closeness. */
  scale: number
  /** True while a face has been seen recently. */
  tracking: boolean
}

const POLL_MS = 140
const CAPTURE_WIDTH = 320
/** Keep the last known position briefly so a single missed detection doesn't snap the head away. */
const LOST_GRACE_MS = 1200
const SMOOTHING = 0.25

export function useFaceTracking(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  active: boolean,
): React.RefObject<FaceTrack> {
  // A ref, not state: this updates several times a second and is read inside a
  // render loop. Putting it in state would re-render the whole page each poll,
  // which is the mistake that previously starved other intervals.
  const track = useRef<FaceTrack>({ x: 0, y: 0, scale: 0, tracking: false })
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const lastSeenRef = useRef(0)
  const inFlightRef = useRef(false)

  const capture = useCallback(async (): Promise<Blob | null> => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return null

    if (!canvasRef.current) canvasRef.current = document.createElement('canvas')
    const canvas = canvasRef.current
    const scale = CAPTURE_WIDTH / video.videoWidth
    canvas.width = CAPTURE_WIDTH
    canvas.height = Math.round(video.videoHeight * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    return new Promise((resolve) => {
      // Low quality is fine — the detector works on a greyscale downscale.
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.6)
    })
  }, [videoRef])

  useEffect(() => {
    if (!active) {
      track.current = { x: 0, y: 0, scale: 0, tracking: false }
      return
    }

    let cancelled = false
    const timer = window.setInterval(async () => {
      if (cancelled || inFlightRef.current) return
      inFlightRef.current = true
      try {
        const blob = await capture()
        if (!blob || cancelled) return
        const { data } = await api.post<{
          found: boolean
          x?: number
          y?: number
          scale?: number
        }>('/face/track', formData({ file: blob }), {
          headers: { 'Content-Type': 'multipart/form-data' },
        })

        if (cancelled) return
        const now = Date.now()
        if (data.found && data.x !== undefined && data.y !== undefined) {
          lastSeenRef.current = now
          const prev = track.current
          // Mirror x: the raw frame is what the camera sees, so the user moving
          // to their right appears on the image's left. Without the flip the
          // avatar looks away from you instead of at you.
          const targetX = -data.x
          track.current = {
            x: prev.x + (targetX - prev.x) * SMOOTHING,
            y: prev.y + (data.y - prev.y) * SMOOTHING,
            scale: data.scale ?? 0,
            tracking: true,
          }
        } else if (now - lastSeenRef.current > LOST_GRACE_MS) {
          // Drift back to centre rather than freezing mid-turn.
          const prev = track.current
          track.current = {
            x: prev.x * 0.9,
            y: prev.y * 0.9,
            scale: 0,
            tracking: false,
          }
        }
      } catch {
        /* a dropped poll is not worth surfacing; the next one will land */
      } finally {
        inFlightRef.current = false
      }
    }, POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [active, capture])

  return track
}
