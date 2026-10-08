import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { applyMorph, BLINK_L, BLINK_R, EYELID_BONES, EYELID_CLOSE, findBone, findMorphs } from './morphTargets'

/**
 * Periodic eye blink driven by blendshapes.
 *
 * Bindings are resolved once per scene rather than re-traversed every frame,
 * and the morph names cover the ARKit/Blender/VRM spellings — the previous
 * version only matched `eyeBlink_L`, so a Ready Player Me avatar (which exports
 * `eyeBlinkLeft`) silently fell through to the fallback below.
 *
 * The fallback squashes a named mesh on Y. It is a poor imitation and only
 * applies to models with no blink shapes at all; check a model with
 * `python scripts/check_avatar.py <file.glb>` before relying on it.
 */
export function useBlink(nodes: Record<string, THREE.Object3D>, scene: THREE.Group) {
  const state = useRef({ timer: 0, nextBlink: 2, isBlinking: false })

  const bindings = useMemo(
    () => ({
      left: findMorphs(scene, BLINK_L),
      right: findMorphs(scene, BLINK_R),
      // Bone rigs (no blink shapes): [eyelid bone, its rest Z rotation].
      lids: EYELID_BONES.map((name) => findBone(scene, [name]))
        .filter((b): b is THREE.Object3D => b !== null)
        .map((b) => [b, b.rotation.z] as const),
      fallbackEye: nodes['Sphere.002'] ?? null,
    }),
    [scene, nodes],
  )

  // useGLTF caches the scene, so hand the eyelids back open on unmount.
  useEffect(
    () => () => {
      for (const [bone, restZ] of bindings.lids) bone.rotation.z = restZ
    },
    [bindings],
  )

  useFrame((_state, delta) => {
    const b = state.current
    b.timer += delta

    if (!b.isBlinking && b.timer > b.nextBlink) {
      b.isBlinking = true
      b.timer = 0
      // 20% chance of a quick double blink, which reads as more alive.
      b.nextBlink = Math.random() > 0.8 ? 0.3 : 2 + Math.random() * 4
    }

    let amount = 0
    if (b.isBlinking) {
      if (b.timer > 0.15) {
        b.isBlinking = false
        b.timer = 0
      } else {
        amount = Math.sin((b.timer / 0.15) * Math.PI) // ease in and out
      }
    }

    if (bindings.left.length || bindings.right.length) {
      applyMorph(bindings.left, amount)
      applyMorph(bindings.right, amount)
    } else if (bindings.lids.length) {
      for (const [bone, restZ] of bindings.lids) bone.rotation.z = restZ + amount * EYELID_CLOSE
    } else if (bindings.fallbackEye) {
      bindings.fallbackEye.scale.y = THREE.MathUtils.lerp(1, 0.1, amount)
    }
  })
}
