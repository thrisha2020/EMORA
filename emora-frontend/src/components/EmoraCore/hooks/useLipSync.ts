import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { applyMorph, findBone, findMorphs, JAW_BONES, JAW_OPEN, MOUTH_OPEN } from './morphTargets'

/**
 * Mouth movement while the assistant speaks.
 *
 * Amplitude is re-targeted a few times a second rather than every frame — at
 * 60fps a per-frame random made the jaw jitter rather than articulate — and the
 * influence is eased toward it so the motion has weight.
 *
 * This is envelope animation, not real visemes: it is driven by "is she
 * speaking", not by phonemes. Driving it from TTS audio would need the
 * synthesised waveform analysed client-side, which the current /api/tts
 * response (a finished MP3) does not expose per-phoneme.
 */
export function useLipSync(
  nodes: Record<string, THREE.Object3D>,
  scene: THREE.Group,
  speaking: boolean,
) {
  const target = useRef(0)
  const holdFor = useRef(0)

  const bindings = useMemo(() => findMorphs(scene, MOUTH_OPEN), [scene])
  const fallbackMesh = useMemo(() => nodes['Sphere'] ?? null, [nodes])
  // Bone rigs with no mouth shapes open the jaw instead.
  const jaw = useMemo(() => {
    const bone = findBone(scene, JAW_BONES)
    return bone ? { bone, restZ: bone.rotation.z } : null
  }, [scene])
  const jawOpen = useRef(0)

  // useGLTF caches the scene, so close the mouth on unmount.
  useEffect(
    () => () => {
      if (jaw) jaw.bone.rotation.z = jaw.restZ
    },
    [jaw],
  )

  useFrame((_state, delta) => {
    if (speaking) {
      holdFor.current -= delta
      if (holdFor.current <= 0) {
        target.current = 0.25 + Math.random() * 0.65
        holdFor.current = 0.07 + Math.random() * 0.07 // ~7-14 shapes/second
      }
    } else {
      target.current = 0
    }

    if (bindings.length) {
      applyMorph(bindings, target.current, 0.35)
    } else if (jaw) {
      jawOpen.current += (target.current - jawOpen.current) * 0.35
      jaw.bone.rotation.z = jaw.restZ + jawOpen.current * JAW_OPEN
    } else if (fallbackMesh) {
      const scale = 1 + target.current * 0.05
      fallbackMesh.scale.y = THREE.MathUtils.lerp(fallbackMesh.scale.y, scale, 0.2)
    }
  })
}
