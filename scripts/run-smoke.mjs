/**
 * Runs every smoke script in order and stops at the first failure.
 *
 * `security-smoke.mjs` and `tools-hub-smoke.mjs` come first, then every file in
 * `scripts/smoke/`, sorted by name. A new area puts its assertions in its own
 * file there rather than growing the two originals, so unrelated changes do not
 * fight over one file and a failure names the area in its path.
 */
import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const extra = (await readdir(path.join(here, 'smoke')).catch(() => []))
  .filter(f => f.endsWith('.mjs'))
  .sort()
  .map(f => path.join('scripts', 'smoke', f))

for (const script of ['scripts/security-smoke.mjs', 'scripts/tools-hub-smoke.mjs', ...extra]) {
  const result = spawnSync('npx', ['tsx', script], { stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`\n${script} failed`)
    process.exit(result.status ?? 1)
  }
}
