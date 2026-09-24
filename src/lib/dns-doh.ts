/**
 * DNS Sightline — the transport.
 *
 * A browser cannot resolve DNS. There is no API in a page that asks a
 * nameserver a question; `fetch` resolves a name as a side effect and hands
 * back a socket, never the answer. So the origin asks, over DNS-over-HTTPS, and
 * it asks **several independent resolvers at once** — because the product here
 * is not "what is the A record", which any `dig` gives you, but "do three
 * resolvers in three different anycast networks agree about it", which is where
 * propagation lag, split horizon, a stale cache and resolver-level filtering
 * become visible.
 *
 * Unlike `src/lib/tls-inspect.ts`, nothing here is Node-only: this module uses
 * `fetch` and `AbortSignal` and nothing else, so DNS Sightline is the one
 * server-backed tool that would survive a Workers deploy unchanged.
 *
 * ── Bounds (AGENTS.md: bounded in EVERY dimension) ────────────────────────
 * The dimension this tool has that the others do not is **how many outbound
 * requests one inbound request can cause**. A resolver diff over eight record
 * types is already 24 fetches before any analysis; an SPF include tree and a
 * CAA walk add more, and a hostile zone can make that tree as deep as it likes.
 * So an inspection carries a single mutable budget (`SgBudget`) that every
 * query decrements, and the walk stops when it runs out rather than when the
 * zone stops being interesting. Per-request timeout, per-response byte cap,
 * per-client and global rate limits sit on top.
 *
 * ── The outbound allowlist ────────────────────────────────────────────────
 * Every URL this module fetches is built from a frozen compile-time constant.
 * The name being queried is `encodeURIComponent`-ed into one query parameter,
 * which is the whole SSRF and parameter-injection story for this tool: there is
 * no code path from a request parameter to a destination host. `security:smoke`
 * asserts that, and asserts the one escape hatch below cannot be used for it.
 */

import type { SgAnswer, SgLookup, SgRecord, SgType } from './dns-types'

export type { SgAnswer, SgLookup, SgRecord, SgType } from './dns-types'

export interface SgResolverInfo {
  key: string
  label: string
  operator: string
  /** Always a literal, never built from anything a caller supplied. */
  endpoint: string
  /** What this resolver does beyond resolving — filtering is a real diff cause. */
  note: string
}

/**
 * Three operators, three anycast footprints, three different policies. Quad9 is
 * in the list *because* it filters: a name it refuses while the other two answer
 * is a finding of its own, and a checker that only ever asks one resolver can
 * never see it.
 *
 * All three speak the JSON DoH dialect (`application/dns-json`). The RFC 8484
 * wire format would need a DNS message encoder for no gain here.
 */
export const SG_RESOLVERS: readonly SgResolverInfo[] = Object.freeze([
  Object.freeze({
    key: 'cloudflare',
    label: 'Cloudflare',
    operator: '1.1.1.1',
    endpoint: 'https://cloudflare-dns.com/dns-query',
    note: 'No filtering on this endpoint.',
  }),
  Object.freeze({
    key: 'google',
    label: 'Google',
    operator: '8.8.8.8',
    endpoint: 'https://dns.google/resolve',
    note: 'No filtering.',
  }),
  Object.freeze({
    key: 'quad9',
    label: 'Quad9',
    operator: '9.9.9.9',
    endpoint: 'https://dns.quad9.net:5053/dns-query',
    note: 'Blocks names on its threat list — a refusal here is a signal, not an outage.',
  }),
]) as readonly SgResolverInfo[]

export const SG_RESOLVER_KEYS: readonly string[] = SG_RESOLVERS.map(r => r.key)

/** The resolver the deep analysis (SPF walk, CAA walk, MX targets) runs against. */
export const SG_PRIMARY_RESOLVER = 'cloudflare'

export const SG_TIMEOUT_MS = 4_000
/** A DoH JSON answer is a few hundred bytes; 64 KiB is a generous ceiling. */
export const SG_MAX_RESPONSE_BYTES = 64 * 1024
/** Total outbound DoH requests one inspection may make, whatever the zone says. */
export const SG_MAX_QUERIES = 120
/** How many of the 24 hub queries run at once. */
export const SG_CONCURRENCY = 8

/** RCODEs by number, so the UI never prints a bare integer at a visitor. */
const SG_RCODES: Record<number, string> = {
  0: 'NOERROR',
  1: 'FORMERR',
  2: 'SERVFAIL',
  3: 'NXDOMAIN',
  4: 'NOTIMP',
  5: 'REFUSED',
  8: 'NXRRSET',
  9: 'NOTAUTH',
  10: 'NOTZONE',
}

const SG_TYPE_NUMBERS: Record<SgType, number> = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  CAA: 257,
}

export interface SgBudget {
  /** Decremented by every outbound query. At zero, `sgSpend` returns false. */
  left: number
  spent: number
}

export function sgNewBudget(max = SG_MAX_QUERIES): SgBudget {
  return { left: max, spent: 0 }
}

export function sgSpend(budget: SgBudget): boolean {
  if (budget.left <= 0) return false
  budget.left -= 1
  budget.spent += 1
  return true
}

export interface SgQueryOptions {
  timeoutMs?: number
  budget?: SgBudget
  signal?: AbortSignal
  /**
   * Point a resolver key at a local fixture server. This exists **solely** so
   * `security:smoke` can exercise the transport — the timeout, the byte cap, a
   * malformed body, a resolver that hangs — without the network, the same way
   * `CsDialOptions.trustAnchors` exists solely to reproduce Chainsaw's
   * store-completion effect offline.
   *
   * It is refused unless it addresses loopback over plain HTTP, so even if a
   * future caller wired it to a request parameter by mistake it could not
   * become an SSRF. `sgInspect` never sets it, and that is asserted.
   */
  endpointOverride?: string
}

/** Loopback-only, http-only. Anything else is not an override, it is a target. */
export function sgOverrideAllowed(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:') return false
    const host = u.hostname.replace(/^\[|\]$/g, '')
    return host === '127.0.0.1' || host === 'localhost' || host === '::1'
  } catch {
    return false
  }
}

export function sgResolverInfo(key: string): SgResolverInfo | null {
  return SG_RESOLVERS.find(r => r.key === key) ?? null
}

/**
 * Ask one resolver one question.
 *
 * Never throws: a resolver that times out, refuses, or answers with something
 * that is not DoH JSON comes back as an answer carrying `error`, because the
 * diff has to be able to say "two agreed and the third was unreachable" rather
 * than losing the whole inspection to one slow endpoint.
 */
export async function sgQuery(
  resolverKey: string,
  name: string,
  type: SgType,
  opts: SgQueryOptions = {},
): Promise<SgAnswer> {
  const started = Date.now()
  const info = sgResolverInfo(resolverKey)
  const fail = (error: string): SgAnswer => ({
    resolver: resolverKey,
    type,
    name,
    rcode: 'ERROR',
    records: [],
    elapsedMs: Date.now() - started,
    error,
  })

  if (!info) return fail('unknown resolver')
  if (!(type in SG_TYPE_NUMBERS)) return fail('unsupported record type')
  if (opts.budget && !sgSpend(opts.budget)) return fail('query budget exhausted')

  let base = info.endpoint
  if (opts.endpointOverride) {
    if (!sgOverrideAllowed(opts.endpointOverride)) return fail('endpoint override refused')
    base = opts.endpointOverride
  }

  // The name is the ONLY caller-supplied value that reaches the wire, and it
  // goes through encodeURIComponent into a single parameter. Without that, a
  // name containing `&type=ANY&name=` would rewrite the question being asked.
  const url = `${base}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? SG_TIMEOUT_MS)
  const onOuterAbort = () => controller.abort()
  opts.signal?.addEventListener('abort', onOuterAbort)

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/dns-json' },
      redirect: 'error',
      signal: controller.signal,
    })
    if (!res.ok) return fail(`resolver returned HTTP ${res.status}`)

    const text = await sgReadBounded(res)
    if (text === null) return fail('resolver answer exceeded the size cap')

    let body: any
    try {
      body = JSON.parse(text)
    } catch {
      return fail('resolver answer was not JSON')
    }
    if (!body || typeof body !== 'object') return fail('resolver answer was not a DNS reply')

    const status = typeof body.Status === 'number' ? body.Status : -1
    const wanted = SG_TYPE_NUMBERS[type]
    const answers: SgRecord[] = Array.isArray(body.Answer)
      ? body.Answer
          .filter((a: any) => a && typeof a.data === 'string' && Number(a.type) === wanted)
          .map((a: any) => ({
            type: Number(a.type),
            name: String(a.name ?? name).toLowerCase().replace(/\.+$/, ''),
            data: String(a.data),
            ttl: Number.isFinite(Number(a.TTL)) ? Number(a.TTL) : 0,
          }))
      : []

    return {
      resolver: resolverKey,
      type,
      name,
      rcode: SG_RCODES[status] ?? (status < 0 ? 'ERROR' : `RCODE${status}`),
      records: answers,
      elapsedMs: Date.now() - started,
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') return fail(`no answer within ${opts.timeoutMs ?? SG_TIMEOUT_MS}ms`)
    return fail(typeof err?.message === 'string' ? err.message.slice(0, 120) : 'resolver unreachable')
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onOuterAbort)
  }
}

/**
 * Read a response body with a hard byte ceiling.
 *
 * `res.text()` on a body with no `content-length` reads until the peer stops,
 * and a resolver endpoint is a third party. Streaming with a running total is
 * the only version of this that is actually bounded; the `content-length`
 * check below is a cheap early-out, not the guarantee.
 */
async function sgReadBounded(res: Response): Promise<string | null> {
  const declared = Number(res.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > SG_MAX_RESPONSE_BYTES) return null

  const body = res.body
  if (!body) return await res.text()

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value?.byteLength ?? 0
    if (total > SG_MAX_RESPONSE_BYTES) {
      try { await reader.cancel() } catch { /* already gone */ }
      return null
    }
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()
  return text
}

/** Run `jobs` with at most `limit` in flight. Order of results is preserved. */
export async function sgPool<T>(jobs: Array<() => Promise<T>>, limit = SG_CONCURRENCY): Promise<T[]> {
  const out: T[] = new Array(jobs.length)
  let next = 0
  const workers = new Array(Math.min(limit, jobs.length)).fill(0).map(async () => {
    for (;;) {
      const i = next
      next += 1
      if (i >= jobs.length) return
      out[i] = await jobs[i]()
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * Bind a resolver, a budget and a per-inspection memo into one `SgLookup`.
 *
 * The memo is not an optimisation bolted on afterwards — it is what makes the
 * budget meaningful. The CAA walk asks about the apex, the MX check asks about
 * each target, and the SPF walk asks about every include; across one inspection
 * the same (name, type) pair comes up repeatedly, and without the memo a
 * fan-shaped include tree spends the budget on questions already answered and
 * the analysis is truncated for no reason.
 *
 * Two properties it has to keep, both of them rules rather than facts about
 * this file (AGENTS.md, from the poker equity memo):
 *
 *  - **The key is derived from the arguments, never supplied alongside them.**
 *    It is `type` and the normalised `name`, nothing else. A caller cannot hand
 *    in a key that disagrees with the question it is filed under.
 *  - **The only permitted behaviour is to agree with the uncached function.** A
 *    wrong memo here does not crash; it reports one name's records under
 *    another name's heading, which reads perfectly plausibly.
 *
 * An answer carrying `error` is deliberately NOT retained: a timeout is a fact
 * about one moment, not about the name, and caching it would turn a single slow
 * response into a whole inspection's worth of the same failure.
 */
export function sgMakeLookup(
  resolverKey: string,
  budget: SgBudget,
  opts: Omit<SgQueryOptions, 'budget'> = {},
): SgLookup {
  const memo = new Map<string, Promise<SgAnswer>>()
  return (name: string, type: SgType): Promise<SgAnswer> => {
    const key = `${type} ${name.trim().toLowerCase().replace(/\.+$/, '')}`
    const hit = memo.get(key)
    if (hit) return hit
    const pending = sgQuery(resolverKey, name, type, { ...opts, budget }).then(answer => {
      if (answer.error) memo.delete(key)
      return answer
    })
    memo.set(key, pending)
    return pending
  }
}
