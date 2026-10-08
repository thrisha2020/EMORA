import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { findBone } from './morphTargets'

/**
 * Breathing and small idle sway, so the avatar is never perfectly still.
 *
 * Like the gaze, every value is applied as an offset from the bone's rest pose.
 * Writing absolute rotations and scales overwrites the bind pose — on a rigged
 * model that means the neck snaps out of alignment and the chest resets to unit
 * scale, both of which distort the silhouette.
 */

const CHEST_BONES = ['J_Bip_C_Chest', 'J_Bip_C_UpperChest', 'Chest', 'Spine2', 'Spine1', 'Spine']
const NECK_BONES = ['J_Bip_C_Neck', 'Neck', 'mixamorigNeck']

const BREATH_HZ = 0.24 // ~4s per breath
const BREATH_DEPTH = 0.014
const SWAY = 0.02

export function useIdleMotion(
  scene: THREE.Group,
  groupRef: React.RefObject<THREE.Group | null>,
) {
  const chest = useMemo(() => findBone(scene, CHEST_BONES), [scene])
  const neck = useMemo(() => findBone(scene, NECK_BONES), [scene])

  // Snapshot the bind pose before anything writes to these bones.
  const rest = useMemo(
    () => ({
      chestScale: chest ? chest.scale.clone() : null,
      neckRotation: neck ? neck.rotation.clone() : null,
      groupY: groupRef.current ? groupRef.current.position.y : 0,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chest, neck],
  )

  const t = useRef(0)

  // Same caching caveat as the gaze hook: hand the bind pose back on unmount.
  useEffect(
    () => () => {
      if (chest && rest.chestScale) chest.scale.copy(rest.chestScale)
      if (neck && rest.neckRotation) neck.rotation.copy(rest.neckRotation)
    },
    [chest, neck, rest],
  )

  useFrame((_state, delta) => {
    t.current += delta
    const phase = t.current * BREATH_HZ * Math.PI * 2
    const breath = Math.sin(phase) * BREATH_DEPTH

    if (chest && rest.chestScale) {
      chest.scale.set(
        rest.chestScale.x * (1 + breath),
        rest.chestScale.y * (1 + breath),
        rest.chestScale.z * (1 + breath),
      )
    } else if (groupRef.current) {
      groupRef.current.position.y = rest.groupY + breath * 0.5
    }

    if (neck && rest.neckRotation) {
      // Counter-rotate slightly against the breath so the head stays level, plus
      // a slow sway that is deliberately out of phase with it.
      neck.rotation.set(
        rest.neckRotation.x - breath * 0.35,
        rest.neckRotation.y + Math.sin(t.current * 0.31) * SWAY,
        rest.neckRotation.z + Math.sin(t.current * 0.53) * SWAY * 0.6,
        rest.neckRotation.order,
      )
    }
  })
}
