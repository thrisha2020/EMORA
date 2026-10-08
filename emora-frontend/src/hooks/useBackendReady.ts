import { useEffect, useState } from 'react'
import { health, type HealthStatus } from '@/services/api'

/**
 * Polls /api/health until the backend reports its models are loaded.
 *
 * The STT and emotion models take 1–2 minutes to cold-load. Before this existed
 * the first voice turn simply hung with no feedback, which was indistinguishable
 * from the assistant ignoring you.
 */
export function useBackendReady(pollMs = 4000) {
  const [status, setStatus] = useState<HealthStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: number

    const poll = async () => {
      try {
        const s = await health()
        if (cancelled) return
        setStatus(s)
        if (s.ready) return // settled — stop polling
      } catch {
        if (cancelled) return
        setStatus(null)
      }
      timer = window.setTimeout(poll, pollMs)
    }

    void poll()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [pollMs])

  const pending = status
    ? Object.entries(status.models)
        .filter(([k, v]) => !v && !k.endsWith('_fallback'))
        .map(([k]) => k)
    : []

  return {
    ready: status?.ready ?? false,
    reachable: status !== null,
    pending,
    models: status?.models ?? {},
    warmup: status?.warmup ?? true,
  }
}
