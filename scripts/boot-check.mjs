/**
 * Boot the BUILT server and prove it serves a page.
 *
 *   npm run build && npm run boot:check
 *
 * `build` and `check` were both green on a tree whose production server could
 * not start. package-lock resolved astro 7.3.3 against @astrojs/node 11.1.0,
 * whose standalone() calls `app.pipeline.getLogger()` — gone in that astro — so
 * `node dist/server/entry.mjs`, the Dockerfile CMD, threw a TypeError before it
 * answered a single request. Neither tool ever runs the entry point, so neither
 * could see it. The deploy's health probe could, but only after the old
 * container had been stopped: it finds this class of failure with the site
 * already down.
 *
 * This builds nothing. It starts dist/server/entry.mjs the way the image does
 * (from the directory holding dist/, which is what og.ts resolves cards
 * against), on a free loopback port, requests `/`, and requires a complete 200
 * HTML page AND a process still alive a moment later — a server that answers
 * once and then dies on an unhandled rejection is as dead as one that never
 * started. Then it stops the server.
 *
 * Exit 0 = it boots and serves. Non-zero = it does not, and its output is printed.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const entry = fileURLToPath(new URL('../dist/server/entry.mjs', import.meta.url))

/** How long the server gets to start answering. A cold start is ~1s here. */
const BOOT_TIMEOUT_MS = 30_000
/** How long it must stay up after its first 200 before it counts as alive. */
const SETTLE_MS = 1_000
/** The child's output kept for the failure report (the tail is where the stack is). */
const OUTPUT_TAIL_CHARS = 16_000

const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`)
const bad = (msg) => console.log(`  \x1b[31m✗\x1b[0m ${msg}`)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (!existsSync(entry)) {
  bad('no build at dist/server/entry.mjs — run `npm run build` first (this check builds nothing)')
  process.exit(1)
}

/** A port nothing is listening on right now. The window before the child binds
 *  it is racy in principle; on a loopback address nothing else is racing. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.unref()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

const port = await freePort()
const env = { ...process.env, HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'production' }
// The crash this script was written for lives in the adapter's startup-logging
// branch, and this variable switches that branch off. Inheriting it from the
// caller's shell would pass the check on exactly the regression it exists for.
delete env.ASTRO_NODE_LOGGING

let output = ''
const child = spawn(process.execPath, [entry], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
const collect = (chunk) => {
  output = (output + chunk).slice(-OUTPUT_TAIL_CHARS)
}
child.stdout.on('data', collect)
child.stderr.on('data', collect)

/** @type {{ code: number | null, signal: NodeJS.Signals | null } | null} */
let exited = null
const exit = new Promise((resolve) => {
  child.on('exit', (code, signal) => {
    exited = { code, signal }
    resolve(exited)
  })
})

async function stop() {
  if (exited) return
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 5_000)
  await exit
  clearTimeout(timer)
}

async function fail(msg) {
  bad(msg)
  await stop()
  if (output.trim()) console.log(`\n--- server output (tail) ---\n${output.trimEnd()}\n---`)
  process.exit(1)
}

const url = `http://127.0.0.1:${port}/`
// The origin lock 404s anything without the shared secret once one is set, so
// present it the way deploy.yml's own probe does. Empty sends an empty header,
// which the middleware ignores.
const headers = { 'x-origin-auth': process.env.ORIGIN_SHARED_SECRET ?? '' }

console.log(`\n\x1b[1mBoot the built server\x1b[0m  (node dist/server/entry.mjs on ${url})`)

const deadline = Date.now() + BOOT_TIMEOUT_MS
/** @type {Response | undefined} */
let response
while (!response) {
  if (exited) await fail(`the server exited before answering (code ${exited.code}, signal ${exited.signal})`)
  if (Date.now() > deadline) await fail(`no answer on ${url} within ${BOOT_TIMEOUT_MS / 1000}s`)
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) })
  } catch {
    // Not listening yet (ECONNREFUSED) — poll again.
    await sleep(200)
  }
}

// Read the whole body: a render that throws mid-stream still sent its 200.
const body = await response.text().catch(() => '')
if (response.status !== 200) await fail(`GET / answered ${response.status}, expected 200`)
ok('GET / answered 200')
if (!(response.headers.get('content-type') ?? '').includes('text/html')) {
  await fail(`GET / is not HTML (content-type '${response.headers.get('content-type') ?? 'none'}')`)
}
if (!/<\/html>\s*$/i.test(body)) await fail('GET / returned a truncated document (no closing </html>)')
ok(`a complete HTML document (${body.length} chars)`)

await sleep(SETTLE_MS)
if (exited) await fail(`the server exited ${SETTLE_MS}ms after its first 200 (code ${exited.code}, signal ${exited.signal})`)
ok(`still running ${SETTLE_MS}ms later`)

await stop()
console.log('boot check ok')
