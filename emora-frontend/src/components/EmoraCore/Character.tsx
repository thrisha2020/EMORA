import { useEffect, useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import { useAnimations, useGLTF } from '@react-three/drei'
import { useThree } from '@react-three/fiber'

import { useBlink } from './hooks/useBlink'
import { useLipSync } from './hooks/useLipSync'
import { useIdleMotion } from './hooks/useIdleMotion'
import { useEyeTracking } from './hooks/useEyeTracking'
import { findBone, HEAD_BONES } from './hooks/morphTargets'
import { useRestPose } from './hooks/useRestPose'
import type { FaceTrack } from '@/hooks/useFaceTracking'
import { useExpression } from './hooks/useExpression'
import { extendAvatarLoader } from './avatars'

interface CharacterProps {
  url: string
  speaking: boolean
  /** Detected emotion label; drives the facial expression. */
  emotion?: string
  /** 0-1. Low confidence deliberately produces a subtler expression. */
  confidence?: number
  /**
   * 'head' frames the face; 'full' shows the whole body.
   *
   * Head framing is the default because the rig has no idle animation, so a
   * full-body view shows the VRM bind pose — arms straight out in a T — and
   * shrinks the face to a few pixels. Framing on the head puts the expression
   * and lip-sync front and centre and leaves the T-pose arms out of shot.
   */
  framing?: 'head' | 'full'
  /** Live webcam head position; when present the avatar looks at the user. */
  faceTrack?: React.RefObject<FaceTrack>
}

export default function Character({
  url,
  speaking,
  emotion,
  confidence,
  framing = 'head',
  faceTrack,
}: CharacterProps) {
  const { scene, nodes, parser, animations } = useGLTF(url, undefined, undefined, extendAvatarLoader) as any
  const group = useRef<THREE.Group>(null)
  // VRM 0.x faces -Z (VRM 1.0 and plain glTF face +Z), so it would show its back.
  const facesAway = Boolean(parser?.json?.extensionsUsed?.includes('VRM'))

  // A model that ships its own idle (e.g. the RenderPeople avatars) plays it on
  // loop. Its head/face tracks are stripped at conversion, so gaze, blink and
  // lip-sync below still own those bones.
  const animated = animations.length > 0
  const { actions, names } = useAnimations(animations, group as React.RefObject<THREE.Group>)
  useEffect(() => {
    const action = names[0] ? actions[names[0]] : null
    action?.reset().fadeIn(0.4).play()
    return () => {
      action?.fadeOut(0.3)
    }
  }, [actions, names])

  // Apply hooks
  useBlink(nodes, scene)
  useLipSync(nodes, scene, speaking)
  useIdleMotion(scene, group)
  // Frame the face from the model's own proportions rather than fixed numbers,
  // so any avatar lands correctly.
  //
  // The head *bone* sits at the base of the skull, not at the face, so aiming at
  // it directly points the camera at the chin. The eye line is roughly a third
  // of the way from that joint to the top of the head, and that ratio holds
  // across humanoid rigs even when heights differ.
  useRestPose(scene, !animated, facesAway ? -1 : 1) // an idle clip already poses the arms

  const { camera } = useThree()
  useLayoutEffect(() => {
    scene.position.set(0, 0, 0)
    scene.rotation.y = facesAway ? Math.PI : 0
    if (framing !== 'head') return

    scene.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(scene)
    const head = findBone(scene, HEAD_BONES)
    const headPos = new THREE.Vector3()
    if (head) head.getWorldPosition(headPos)
    else headPos.set(0, box.max.y - 0.2, 0)

    const headSpan = Math.max(box.max.y - headPos.y, 0.05) // skull base -> crown
    const faceY = headPos.y + headSpan * 0.34
    scene.position.set(-headPos.x, -faceY, -headPos.z)

    // Pull back far enough to hold head plus a little shoulder at fov 30.
    camera.position.set(0, 0, headSpan * 4.6)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }, [scene, framing, camera, facesAway])

  useEyeTracking(scene, group, faceTrack, facesAway ? -1 : 1)
  useExpression(scene, emotion, confidence)

  return (
    <group ref={group}>
      <primitive object={scene} />
    </group>
  )
}
