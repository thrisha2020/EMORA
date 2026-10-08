import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { applyMorph, EXPRESSIONS, findMorphs, type MorphBinding } from './morphTargets'

/**
 * Drives the avatar's face from the detected emotion.
 *
 * This is the point of the whole emotion pipeline: until now the reading only
 * surfaced as a colour on the HUD rings, while the face stayed blank. VRoid
 * models ship whole-face presets (`Fcl_ALL_Joy`, `Fcl_ALL_Sorrow`, …) that map
 * onto Emora's labels almost 1:1; ARKit models compose the same thing from
 * individual muscle shapes, and EXPRESSIONS lists both.
 *
 * Influence is scaled by confidence and eased over time, so a low-confidence or
 * flickering reading produces a subtle drift rather than the face snapping
 * between expressions — which reads as broken, not expressive.
 */

const MAX_INFLUENCE = 0.85 // full 1.0 looks like a caricature on most rigs
const EASE = 0.06 // per-frame approach; ~1s to settle at 60fps

export function useExpression(
  scene: THREE.Group,
  emotion: string | undefined,
  confidence = 0,
) {
  // Resolve one binding per emotion once, rather than searching every frame.
  const bindings = useMemo(() => {
    const map = new Map<string, MorphBinding[]>()
    for (const [label, candidates] of Object.entries(EXPRESSIONS)) {
      const found = findMorphs(scene, candidates)
      if (found.length) map.set(label, found)
    }
    return map
  }, [scene])

  const current = useRef<Record<string, number>>({})

  useFrame(() => {
    if (bindings.size === 0) return

    // Below this the reading is closer to a guess than a signal — hold neutral
    // rather than letting noise drive the face.
    const active = emotion && confidence >= 0.35 ? emotion : 'neutral'
    const strength = active === 'neutral' ? 0 : Math.min(confidence, 1) * MAX_INFLUENCE

    for (const [label, binding] of bindings) {
      const target = label === active ? strength : 0
      const now = current.current[label] ?? 0
      const next = now + (target - now) * EASE
      current.current[label] = next
      // Skip writes that are visually indistinguishable from the current value.
      if (Math.abs(next - now) > 0.0005 || next > 0.0005) {
        applyMorph(binding, next)
      }
    }
  })

  return bindings.size > 0
}
