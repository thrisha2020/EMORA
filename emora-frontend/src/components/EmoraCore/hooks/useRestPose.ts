import { useLayoutEffect } from 'react'
import * as THREE from 'three'
import { findBone } from './morphTargets'

/**
 * Relaxes a bind-pose rig from a T-pose into a natural rest pose.
 *
 * VRM and Mixamo rigs ship with arms straight out to the sides. Nothing in the
 * app plays a body animation, so that pose is what actually renders — a figure
 * standing with its arms out, which reads as a mannequin and pushes the arms
 * into shot even when the camera is framed on the face.
 *
 * Rotating the upper arms down (and bending the elbows slightly) costs nothing
 * at runtime and gives a believable idle silhouette.
 */

// Last entries: Blender's `upper_arm.L`, which GLTFLoader sanitizes to `upper_armL`.
const UPPER_ARM_L = ['J_Bip_L_UpperArm', 'LeftUpperArm', 'mixamorigLeftArm', 'LeftArm', 'upper_armL']
const UPPER_ARM_R = ['J_Bip_R_UpperArm', 'RightUpperArm', 'mixamorigRightArm', 'RightArm', 'upper_armR']
const LOWER_ARM_L = ['J_Bip_L_LowerArm', 'LeftLowerArm', 'mixamorigLeftForeArm', 'LeftForeArm', 'lower_armL']
const LOWER_ARM_R = ['J_Bip_R_LowerArm', 'RightLowerArm', 'mixamorigRightForeArm', 'RightForeArm', 'lower_armR']

// Arms down and slightly forward; elbows softly bent. Radians.
const UPPER_ARM_DROP = 1.22
const UPPER_ARM_FORWARD = 0.12
const ELBOW_BEND = 0.22

/**
 * `mirror` is -1 for a VRM 0.x rig, which faces -Z and is turned 180° to face
 * the camera: its X and Z bone axes point the other way, so Z rotations flip
 * (Y is the turn axis and stays put). Without it the arms go up, not down.
 */
export function useRestPose(scene: THREE.Group, enabled = true, mirror = 1) {
  useLayoutEffect(() => {
    if (!enabled) return

    const upperL = findBone(scene, UPPER_ARM_L)
    const upperR = findBone(scene, UPPER_ARM_R)
    const lowerL = findBone(scene, LOWER_ARM_L)
    const lowerR = findBone(scene, LOWER_ARM_R)
    if (!upperL && !upperR) return // not a humanoid rig we recognise

    // Mirrored on Z: the two arms point opposite ways along X in the bind pose.
    const previous: Array<[THREE.Object3D, THREE.Euler]> = []
    const rotate = (bone: THREE.Object3D | null, z: number, y = 0) => {
      if (!bone) return
      previous.push([bone, bone.rotation.clone()])
      bone.rotation.z += z * mirror
      bone.rotation.y += y
    }

    rotate(upperL, -UPPER_ARM_DROP, -UPPER_ARM_FORWARD)
    rotate(upperR, UPPER_ARM_DROP, UPPER_ARM_FORWARD)
    rotate(lowerL, -ELBOW_BEND)
    rotate(lowerR, ELBOW_BEND)

    return () => {
      // Restore on unmount — useGLTF caches the scene graph across mounts, so
      // leaving it rotated would compound the offset on every remount.
      for (const [bone, rotation] of previous) bone.rotation.copy(rotation)
    }
  }, [scene, enabled, mirror])
}
