/**
 * The one owner of process shutdown. A deploy stops the old container with
 * SIGTERM; PID 1 in a container has no default action for it, so without a
 * handler Node ignores the signal and Docker kills it after its 10 s grace.
 * `astro.config.mjs` puts `shutdown-boot.ts` at the head of the Node server
 * entry, so the handler exists from the moment the server starts, not only once
 * a store has been touched. A store with something unsaved registers a synchronous flush with `onShutdown`; the
 * handler runs them all once, then exits.
 */
const flushers: Array<() => void> = []
let installed = false

/** Run `flush` (synchronous, must not throw) when the process is told to stop. */
export function onShutdown(flush: () => void): void {
  flushers.push(flush)
  installShutdownHandler() // dev and the smoke runner have no boot entry
}

/** Install the SIGTERM/SIGINT handler once. A no-op where there is no `process` (the Workers build). */
export function installShutdownHandler(): void {
  if (installed || typeof process === 'undefined' || typeof process.once !== 'function') return
  installed = true
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      for (const flush of flushers) {
        try { flush() } catch { /* shutting down: nothing left to retry with */ }
      }
      process.exit(signal === 'SIGINT' ? 130 : 0)
    })
  }
}
