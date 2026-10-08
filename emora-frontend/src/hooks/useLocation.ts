import { useCallback, useEffect, useState } from 'react'

/**
 * Opt-in coarse location, so Emora can answer local questions.
 *
 * Nothing is requested until the user explicitly grants it, and the choice is
 * remembered so the browser prompt isn't re-triggered on every visit. The place
 * name is resolved once and cached — reverse geocoding is the only part of the
 * app that talks to a third party, so it happens as rarely as possible.
 */

const STORAGE_KEY = 'emora_location'

export interface StoredLocation {
  label: string
  lat: number
  lon: number
  at: number
}

function read(): StoredLocation | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredLocation) : null
  } catch {
    return null
  }
}

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&lat=${lat}&lon=${lon}`,
      { headers: { Accept: 'application/json' } },
    )
    if (!res.ok) throw new Error(String(res.status))
    const data = await res.json()
    const a = data.address ?? {}
    const parts = [a.city ?? a.town ?? a.village ?? a.county, a.state, a.country].filter(Boolean)
    if (parts.length) return parts.join(', ')
  } catch {
    /* fall through to coordinates */
  }
  return `${lat.toFixed(2)}, ${lon.toFixed(2)}`
}

export function useLocation() {
  const [location, setLocation] = useState<StoredLocation | null>(() => read())
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const request = useCallback(async () => {
    if (!navigator.geolocation) {
      setError('This browser has no geolocation support')
      return
    }
    setRequesting(true)
    setError(null)
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false, // city-level is all Emora needs
          timeout: 15000,
          maximumAge: 10 * 60 * 1000,
        })
      })
      const { latitude, longitude } = pos.coords
      const label = await reverseGeocode(latitude, longitude)
      const stored: StoredLocation = { label, lat: latitude, lon: longitude, at: Date.now() }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
      setLocation(stored)
    } catch (e) {
      const err = e as GeolocationPositionError
      setError(
        err?.code === 1
          ? 'Location permission denied — allow it in your browser site settings'
          : 'Could not determine your location',
      )
    } finally {
      setRequesting(false)
    }
  }, [])

  const clear = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setLocation(null)
    setError(null)
  }, [])

  useEffect(() => {
    setLocation(read())
  }, [])

  return { location, requesting, error, request, clear }
}
