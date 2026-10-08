import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { findBone, HEAD_BONES } from './morphTargets'
import type { FaceTrack } from '@/hooks/useFaceTracking'

/**
 * Turns the avatar's head toward the user.
 *
 * Gaze follows the user's real head position from the webcam when face tracking
 * is live, and falls back to the mouse only when the camera is off or no face is
 * visible. For an assistant that already has your camera open to read your
 * expression, following the pointer instead of you was the wrong instinct.
 *
 * Rotations are applied as an **offset from the bone's rest pose**, never as an
 * absolute value. A rigged head bone rarely sits at zero rotation, so writing an
 * absolute rotation snaps it out of its bind pose — which showed up as the
 * avatar staring at the ceiling regardless of where the user actually was.
 *
 * Small random saccades sit on top so the gaze never freezes, which is what
 * makes a stare read as lifeless.
 */

const YAW_RANGE = 0.5 // radians of head turn at full deflection
const PITCH_RANGE = 0.28
const FOLLOW = 0.08 // per-frame easing toward the target

export function useEyeTracking(
  scene: THREE.Group,
  groupRef: React.RefObject<THREE.Group | null>,
  faceTrack?: React.RefObject<FaceTrack>,
  /** -1 for a VRM 0.x rig turned to face the camera; its pitch axis is flipped. */
  mirror = 1,
) {
  const { mouse } = useThree()
  const saccade = useRef({ timer: 0, next: 0.5, x: 0, y: 0 })
  const head = useMemo(() => findBone(scene, HEAD_BONES), [scene])

  // Captured once, before anything has been written to the bone.
  const rest = useMemo(() => {
    const node = head ?? groupRef.current
    return node ? node.rotation.clone() : new THREE.Euler()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [head])

  const offset = useRef({ yaw: 0, pitch: 0 })

  // useGLTF caches the scene graph, so a bone left rotated would be treated as
  // the rest pose on the next mount and the offset would compound.
  useEffect(() => {
    const node = head ?? groupRef.current
    return () => {
      node?.rotation.copy(rest)
    }
  }, [head, groupRef, rest])

  useFrame((_state, delta) => {
    const node = head ?? groupRef.current
    if (!node) return

    const s = saccade.current
    s.timer += delta
    if (s.timer > s.next) {
      s.timer = 0
      s.next = 0.4 + Math.random() * 1.2
      s.x = (Math.random() - 0.5) * 0.05
      s.y = (Math.random() - 0.5) * 0.04
    }

    // Prefer the real user; fall back to the cursor only when unseen.
    const track = faceTrack?.current
    const targetX = track?.tracking ? track.x : mouse.x
    // Face-track y is +1 at the bottom of the frame. Looking *down* at a user
    // low in frame means a positive pitch, so no inversion here; the mouse
    // fallback does need one, since its y is +1 at the top of the viewport.
    const targetY = track?.tracking ? track.y : -mouse.y

    const wantYaw = targetX * YAW_RANGE + s.x
    const wantPitch = targetY * PITCH_RANGE + s.y

    offset.current.yaw += (wantYaw - offset.current.yaw) * FOLLOW
    offset.current.pitch += (wantPitch - offset.current.pitch) * FOLLOW

    node.rotation.set(
      // The group fallback sits outside the turned scene, so only a bone mirrors.
      rest.x + offset.current.pitch * (head ? mirror : 1),
      rest.y + offset.current.yaw,
      rest.z,
      rest.order,
    )
  })
}
