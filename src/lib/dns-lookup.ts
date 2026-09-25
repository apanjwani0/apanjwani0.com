/**
 * `dns.lookup`, bounded in time — the one copy both server-side dialers use.
 *
 * Link Peek (`link-peek-fetch.ts`) and Chainsaw (`tls-inspect.ts`) each resolve
 * a name a visitor typed before they open anything, and neither module's own
 * time budget covers that call:
 *
 *  - `dns.lookup` runs on libuv's threadpool (four slots by default) and takes
 *    the OS resolver's own timeout, which can be tens of seconds. Link Peek's 6s
 *    and Chainsaw's 8s budgets are only consulted AFTER it returns.
 *  - That threadpool is shared with fs, crypto and zlib, so a handful of
 *    requests for names whose nameservers black-hole packets would sit in every
 *    slot and stall unrelated work across the whole container.
 *
 * Racing the lookup with a timer bounds the WAIT. The lookup itself cannot be
 * cancelled — its slot frees when the OS gives up — but nothing downstream waits
 * on it, and the rate limits in front of both routes bound how many can be
 * outstanding at once.
 *
 * It is one module because it used to be two habits. Link Peek raced its lookup
 * and Chainsaw awaited the same call bare, so one of the two tools that opens a
 * socket for a stranger could be held for as long as the OS resolver liked —
 * which is what a guard looks like one edit after it has been copied.
 *
 * Node-only (`node:dns`). Imported by those two modules, which are imported only
 * by their API routes, never by the browser bundle.
 */
import { lookup } from 'node:dns/promises'

/** How long one name lookup may take before the caller stops waiting for it. */
export const DNS_LOOKUP_TIMEOUT_MS = 3000

export interface DnsAddress {
  address: string
  family: number
}

/** The shape of `lookup(host, { all: true })`. */
export type DnsLookupAll = (host: string, options: { all: true }) => Promise<DnsAddress[]>

export interface DnsLookupOptions {
  /**
   * Test seam, and nothing else: `security:smoke` hands in a lookup that never
   * settles to prove the bound holds. Production callers pass nothing, and that
   * is asserted for both of them.
   */
  resolve?: DnsLookupAll
  timeoutMs?: number
}

/** The rejection a lookup that ran out of time settles with. */
export class DnsLookupTimeout extends Error {
  constructor(readonly timeoutMs: number) {
    super(`no DNS answer within ${timeoutMs}ms`)
    this.name = 'DnsLookupTimeout'
  }
}

/**
 * Every address `host` resolves to. Rejects with the resolver's own error
 * (ENOTFOUND and friends), or with `DnsLookupTimeout` once the wait runs out —
 * which callers should report as "no answer", not as "does not exist".
 */
export async function lookupAllBounded(host: string, opts: DnsLookupOptions = {}): Promise<DnsAddress[]> {
  const resolve: DnsLookupAll = opts.resolve ?? ((name, options) => lookup(name, options))
  const timeoutMs = opts.timeoutMs ?? DNS_LOOKUP_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DnsLookupTimeout(timeoutMs)), timeoutMs)
    // A pending lookup must never be the reason the process stays up.
    timer.unref?.()
  })
  try {
    return await Promise.race([resolve(host, { all: true }), expired])
  } finally {
    clearTimeout(timer)
  }
}
