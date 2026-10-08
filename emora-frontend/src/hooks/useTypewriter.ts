import { useEffect, useRef, useState } from 'react'

/**
 * Time-based typewriter.
 *
 * The previous version advanced one character per setInterval tick, so the real
 * speed was whatever the render loop could sustain — with the 3D canvas mounted
 * a 28ms tick actually landed around 105ms, stretching a 2s line into 6s. This
 * derives the character count from elapsed time instead, so a slow frame skips
 * ahead rather than falling behind, and it only sets state when the visible
 * slice actually changes.
 */
export function useTypewriter(text: string, msPerChar = 30, active = true) {
  const [value, setValue] = useState('')
  const [done, setDone] = useState(false)
  const shownRef = useRef(0)

  useEffect(() => {
    shownRef.current = 0
    setValue('')
    setDone(false)

    if (!active || !text) {
      if (!text) setDone(true)
      return
    }

    // Respect users who don't want motion — show the line immediately.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setValue(text)
      setDone(true)
      return
    }

    const start = performance.now()
    let raf = 0

    const step = (now: number) => {
      const chars = Math.min(Math.floor((now - start) / msPerChar), text.length)
      if (chars !== shownRef.current) {
        shownRef.current = chars
        setValue(text.slice(0, chars))
      }
      if (chars >= text.length) {
        setDone(true)
        return
      }
      raf = requestAnimationFrame(step)
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [text, msPerChar, active])

  return { value, done }
}
