/**
 * A bounded name lookup — the one copy the server-side dialers use.
 *
 * Link Peek (`link-peek-fetch.ts`) and Chainsaw (`tls-inspect.ts`) each resolve
 * a name a visitor typed before they open anything, and neither module's own
 * time budget covers that call:
 *
 *  - `dns.lookup` (the old default) ran on libuv's threadpool, four slots by
 *    default, and took the OS resolver's own timeout, which can be tens of
 *    seconds. Link Peek's 6s and Chainsaw's 8s budgets are only consulted AFTER
 *    it returns.
 *  - That threadpool is shared with fs, crypto and zlib, so a handful of
 *    requests for names whose nameservers black-hole packets sat in every slot
 *    and stalled unrelated work across the whole container.
 *
 * Racing the lookup with a timer bounds the WAIT, and the Resolver's own
 * `cancel()` (called on the way out) stops the query itself. The rate limits in
 * front of the routes bound how many can be outstanding at once.
 *
 * It is one module because it used to be two habits. Link Peek raced its lookup
 * and Chainsaw awaited the same call bare, so one of the two tools that opens a
 * socket for a stranger could be held for as long as the OS resolver liked —
 * which is what a guard looks like one edit after it has been copied.
 *
 * The default resolver is c-ares, not `dns.lookup`: a name whose nameservers
 * black-hole packets then costs no libuv thread, and the query is cancelled when
 * the wait runs out. c-ares never reads /etc/hosts, so `localhost` and the box's
 * own names would not resolve anyway; they are also refused by name below
 * (`isLocalOnlyName`) so the guard does not lean on that. The callers still
 * classify every address and pin the connection to it.
 *
 * Node-only (`node:dns`). Imported by those two modules, which are imported only
 * by their API routes, never by the browser bundle.
 */
import { Resolver } from 'node:dns/promises'
import { isIP } from 'node:net'

/** How long one name lookup may take before the caller stops waiting for it. */
export const DNS_LOOKUP_TIMEOUT_MS = 3000

export interface DnsAddress {
  address: string
  family: number
}

/** Resolver timeout per try and number of tries: about 3 s worst case, the same as the race below. */
const RESOLVER_TIMEOUT_MS = 1000
const RESOLVER_TRIES = 3

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
  /** Test seam: nameservers for the default resolver (`host:port`). Production passes nothing. */
  servers?: string[]
}

/**
 * Names that never leave the machine or its network. A visitor may not aim the
 * server at them, and c-ares would not read /etc/hosts for them anyway. Mirrors
 * `lpIsForbiddenHostname`'s name rules (asserted equal over a corpus), kept here
 * so the resolver refuses them on its own.
 */
export function isLocalOnlyName(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, '')
  return (
    !name ||
    isIP(name) !== 0 ||
    !name.includes('.') ||
    name === 'localhost' ||
    name.endsWith('.localhost') ||
    name.endsWith('.local') ||
    name.endsWith('.internal') ||
    name.endsWith('.home.arpa')
  )
}

function notFound(host: string): Error {
  return Object.assign(new Error(`ENOTFOUND ${host}`), { code: 'ENOTFOUND' })
}

/** A and AAAA through c-ares. Rejects ENOTFOUND when neither family answers. */
async function resolveWithResolver(host: string, servers: string[] | undefined, resolver: Resolver): Promise<DnsAddress[]> {
  if (isLocalOnlyName(host)) throw notFound(host)
  if (servers) resolver.setServers(servers)
  const [v4, v6] = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)])
  const out: DnsAddress[] = []
  if (v4.status === 'fulfilled') for (const address of v4.value) out.push({ address, family: 4 })
  if (v6.status === 'fulfilled') for (const address of v6.value) out.push({ address, family: 6 })
  if (out.length) return out
  // Neither family answered: surface the first real failure (a timeout or SERVFAIL
  // is "no answer", and ENODATA/ENOTFOUND is "no such name").
  const failure = [v4, v6].find((r): r is PromiseRejectedResult => r.status === 'rejected')
  throw failure?.reason ?? notFound(host)
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
  const resolver = new Resolver({ timeout: RESOLVER_TIMEOUT_MS, tries: RESOLVER_TRIES })
  const resolve: DnsLookupAll = opts.resolve ?? ((name) => resolveWithResolver(name, opts.servers, resolver))
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
    // Stops any query still in flight, so a timed-out lookup holds nothing.
    resolver.cancel()
  }
}
