import { useEffect, useRef } from 'react'
import { api } from '@/services/api'

export interface DueReminder {
  id: number
  title: string
  description: string | null
  repeat: string | null
  is_mood_triggered: number
}

/**
 * Polls for reminders that have come due and hands them to the caller.
 *
 * Pull-based rather than a server-side scheduler: a reminder is only worth
 * announcing while the user is actually here to hear it, and this avoids a
 * background thread on an already memory-tight backend. The endpoint marks each
 * occurrence delivered as it returns it, so a reminder fires exactly once even
 * if two tabs are polling.
 */
const POLL_MS = 30_000

export function useDueReminders(
  onDue: (reminders: DueReminder[]) => void,
  active = true,
) {
  const onDueRef = useRef(onDue)
  onDueRef.current = onDue

  useEffect(() => {
    if (!active) return
    let cancelled = false

    const check = async () => {
      try {
        const { data } = await api.get<DueReminder[]>('/reminders/due')
        if (!cancelled && data.length) onDueRef.current(data)
      } catch {
        /* offline or unauthenticated — the next poll will retry */
      }
    }

    void check() // don't make the user wait a full interval on load
    const timer = window.setInterval(check, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [active])
}
