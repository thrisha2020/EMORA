import type * as THREE from 'three'

/**
 * Blendshape lookup across exporter conventions.
 *
 * An avatar can come from Ready Player Me (ARKit names: `eyeBlinkLeft`), a
 * Blender export (`eyeBlink_L`), or a VRM conversion (`Fcl_EYE_Close`).
 * Hard-coding one convention meant a perfectly good rigged avatar still fell
 * through to the "scale a random mesh" fallback, which reads as the avatar
 * being broken rather than as a naming mismatch.
 */

export interface MorphBinding {
  mesh: THREE.Mesh & {
    morphTargetDictionary?: Record<string, number>
    morphTargetInfluences?: number[]
  }
  index: number
}

/** Every spelling of a left/right eye blink we might be handed. */
export const BLINK_L = [
  'eyeBlinkLeft', 'eyeBlink_L', 'Blink_L', 'blinkLeft',
  'Fcl_EYE_Close_L', 'Fcl_EYE_Close', // VRoid: per-eye, then the both-eyes shape
]
export const BLINK_R = [
  'eyeBlinkRight', 'eyeBlink_R', 'Blink_R', 'blinkRight',
  'Fcl_EYE_Close_R', 'Fcl_EYE_Close',
]

/** Mouth opening, best first — a real viseme beats a raw jaw rotation. */
export const MOUTH_OPEN = [
  'jawOpen',
  'mouthOpen',
  'viseme_aa',
  'Fcl_MTH_A', // VRoid vowel 'a' — the widest mouth shape
  'mouthFunnel',
]

/**
 * Whole-face emotion shapes, keyed by Emora's emotion labels.
 * VRoid ships these as single presets; ARKit needs them composed from parts.
 */
export const EXPRESSIONS: Record<string, string[]> = {
  happy: ['Fcl_ALL_Joy', 'Fcl_ALL_Fun', 'mouthSmile', 'mouthSmileLeft'],
  sad: ['Fcl_ALL_Sorrow', 'mouthFrown', 'browInnerUp'],
  angry: ['Fcl_ALL_Angry', 'browDown', 'browDownLeft'],
  surprise: ['Fcl_ALL_Surprised', 'browOuterUpLeft', 'eyeWideLeft'],
  fear: ['Fcl_ALL_Sorrow', 'browInnerUp', 'eyeWideLeft'],
  disgust: ['Fcl_MTH_Angry', 'noseSneerLeft', 'mouthFrown'],
  neutral: ['Fcl_ALL_Neutral'],
}

export const HEAD_BONES = ['Head', 'mixamorigHead', 'J_Bip_C_Head', 'Neck']

/**
 * Face bones for rigs with no blendshapes (RenderPeople: `…_jaw`, `…_eyelid_l`).
 * Only used when no morph target matched. Angles are radians about local Z,
 * measured on the RenderPeople rig — a calibration knob, not a law.
 */
export const JAW_BONES = ['jaw']
export const EYELID_BONES = ['eyelid_l', 'eyelid_r']
export const JAW_OPEN = 0.12 // wider looks dislocated on a realistic face
export const EYELID_CLOSE = -0.9 // -1.6 overshoots and the eyeball reappears

type MorphMesh = MorphBinding['mesh']

/**
 * Strip exporter prefixes before comparing. VRoid emits
 * `Face_Blendshape.Fcl_EYE_Close_L` and Blender can emit `Mesh.001_eyeBlinkLeft`
 * — matching on the raw string rejected perfectly good avatars.
 */
function normalizeName(name: string): string {
  return name.split('.').pop()!.split('|').pop()!.trim().toLowerCase()
}

/**
 * Every mesh carrying the first matching shape — not just the first mesh.
 *
 * A VRoid face is split by material into several SkinnedMeshes
 * (`Face_(merged)(Clone)`, `_1`, `_2`, …), each holding the *same* 57 morph
 * targets. Driving only the first one animates a fraction of the face and looks
 * like nothing happens at all: the eyelid and mouth geometry usually sit in
 * different submeshes than the one you happened to find first. Every mesh that
 * has the shape has to be driven together.
 */
export function findMorphs(scene: THREE.Object3D, candidates: string[]): MorphBinding[] {
  // Candidate order is priority order, so settle on a name before collecting.
  for (const candidate of candidates) {
    const want = normalizeName(candidate)
    const hits: MorphBinding[] = []

    scene.traverse((child) => {
      const mesh = child as MorphMesh
      const dict = mesh.morphTargetDictionary
      if (!mesh.isMesh || !dict || !mesh.morphTargetInfluences) return

      for (const key of Object.keys(dict)) {
        if (normalizeName(key) === want) {
          hits.push({ mesh, index: dict[key] })
          return
        }
      }
    })

    if (hits.length) return hits
  }
  return []
}

/** Find a named bone/node, tolerant of prefixes such as `mixamorig`. */
export function findBone(scene: THREE.Object3D, candidates: string[]): THREE.Object3D | null {
  const wanted = candidates.map((c) => c.toLowerCase())
  let found: THREE.Object3D | null = null

  scene.traverse((child) => {
    if (found) return
    const name = (child.name || '').toLowerCase()
    if (wanted.some((w) => name === w || name.endsWith(w))) found = child
  })

  return found
}

/** Write an influence across every bound mesh, optionally eased for smoothness. */
export function applyMorph(bindings: MorphBinding[], value: number, lerp = 1): void {
  for (const binding of bindings) {
    const influences = binding.mesh.morphTargetInfluences
    if (!influences) continue
    const current = influences[binding.index] ?? 0
    influences[binding.index] = lerp >= 1 ? value : current + (value - current) * lerp
  }
}
