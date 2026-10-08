/**
 * Avatar collection. Drop any .glb / .vrm into `src/assets/avatars/` and it shows
 * up in Settings — no list to maintain. `public/avatar.glb` stays the default.
 */

// `?url` only resolves each file to a URL; the models themselves load on demand.
// The Android build (VITE_MOBILE=1) ships the default avatar only: the collection
// is ~170 MB, which would dwarf a 4 MB app and every byte travels over Wi-Fi.
const files = (
  import.meta.env.VITE_MOBILE === '1'
    ? {}
    : import.meta.glob('/src/assets/avatars/*.{glb,vrm,GLB,VRM}', {
        eager: true,
        query: '?url',
        import: 'default',
      })
) as Record<string, string>

export interface AvatarOption {
  id: string
  label: string
  url: string
}

export const AVATARS: AvatarOption[] = [
  { id: 'default', label: 'Emora (default)', url: '/avatar.glb' },
  ...Object.entries(files).map(([path, url]) => {
    const id = path.split('/').pop()!
    return { id, label: id.replace(/\.(glb|vrm)$/i, '').replace(/[-_]+/g, ' '), url }
  }),
]

/**
 * Older VRM exporters (UniGLTF 1.x) put blendshape names on each primitive's
 * `extras.targetNames`; GLTFLoader only reads them from the mesh. Without the
 * names blink, lip-sync and expressions silently find nothing. Hoist them before
 * the meshes are built. Pass to both `useGLTF` and `useGLTF.preload`.
 */
export function extendAvatarLoader(loader: any): void {
  if (loader.__emoraTargetNames) return // the loader instance is shared; register once
  loader.__emoraTargetNames = true
  loader.register((parser: any) => ({
    name: 'EMORA_primitive_target_names',
    beforeRoot() {
      for (const mesh of parser.json.meshes ?? []) {
        const names = mesh.primitives?.[0]?.extras?.targetNames
        if (!Array.isArray(mesh.extras?.targetNames) && Array.isArray(names)) {
          mesh.extras = { ...mesh.extras, targetNames: names }
        }
      }
      return null
    },
  }))
}

const STORAGE_KEY = 'emora_avatar'

export function getAvatar(): AvatarOption {
  let id: string | null = null
  try {
    id = localStorage.getItem(STORAGE_KEY)
  } catch {
    /* storage blocked — use the default */
  }
  return AVATARS.find((a) => a.id === id) ?? AVATARS[0]
}

export function setAvatar(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    /* storage blocked — choice lasts this page only */
  }
}
