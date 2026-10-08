// Vite emits every file matched by the avatars glob even when the code path is
// disabled, so the mobile bundle drops them here. dist/avatar.glb (the default,
// copied from public/) stays — it is the only one the phone can choose.
import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const dir = 'dist/assets'
let freed = 0
for (const name of readdirSync(dir)) {
  if (!/\.(glb|vrm)$/i.test(name)) continue
  const path = join(dir, name)
  freed += statSync(path).size
  rmSync(path)
}
console.log(`pruned ${(freed / 1e6).toFixed(0)} MB of avatars from the mobile bundle`)
