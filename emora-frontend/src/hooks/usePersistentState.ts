import { useCallback, useState } from 'react'

/** Read a JSON value from localStorage; objects are merged over the fallback so fields added later still get defaults. */
export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const value = JSON.parse(raw)
    return typeof fallback === 'object' && fallback !== null ? { ...fallback, ...value } : value
  } catch {
    return fallback // blocked storage or a corrupt value
  }
}

/**
 * useState that survives reloads, for per-browser choices.
 *
 * Saved from the setter, never on mount: persisting an untouched default would
 * pin it, and a later change to the default would never reach this browser.
 */
export function usePersistentState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readStored(key, fallback))
  const set = useCallback(
    (next: T | ((prev: T) => T)) =>
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        try {
          localStorage.setItem(key, JSON.stringify(v))
        } catch {
          /* storage blocked — the choice lasts this page only */
        }
        return v
      }),
    [key],
  )
  return [value, set] as const
}
