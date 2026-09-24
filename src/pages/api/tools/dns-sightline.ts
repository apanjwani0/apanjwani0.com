/**
 * DNS Sightline — the inspection endpoint.
 *
 * GET /api/tools/dns-sightline?name=example.com&ca=letsencrypt.org
 *
 * The server does the asking because a browser cannot: there is no API in a
 * page that puts a question to a nameserver and reads the answer, and the
 * questions worth asking — do three independent resolvers agree, how many DNS
 * lookups does this SPF record really cost, will this CAA record stop the CA
 * you are renewing with — are ones a browser never asks at all.
 *
 * Every dimension is bounded (AGENTS.md), and this tool has one the others do
 * not: **how many outbound requests one inbound request can cause.** A resolver
 * diff is 24 DoH fetches before any analysis, and an SPF include tree is as
 * deep as the zone owner wants it to be. One shared `SgBudget` caps the whole
 * inspection; the rate limits are the tightest of any route here for the same
 * reason. Nothing is stored; the response is computed per request and
 * `no-store`.
 *
 * The outbound destinations are compile-time constants (`SG_RESOLVERS`), so
 * unlike Link Peek and Chainsaw there is no address-classification step here —
 * there is no code path from a request parameter to a destination host at all.
 */
import type { APIRoute } from 'astro'
import { createRateLimiter, rateLimitKey } from '../../../lib/security'
import { SG_MAX_INPUT_CHARS, SG_KNOWN_CAS, sgValidateName } from '../../../components/tools/dns-sightline/analyze'
import { sgInspect } from '../../../components/tools/dns-sightline/inspect'

export const prerender = false

// A single inspection can cost ~40 outbound DoH requests, so the per-client
// allowance is lower than Chainsaw's six and much lower than Link Peek's ten.
const allowClient = createRateLimiter(60_000, 4)
// One shared bucket across ALL clients, bounding the instance's total outbound
// DoH rate however many clients arrive.
const allowGlobal = createRateLimiter(60_000, 16)

function json(body: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  })
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url)
  const raw = url.searchParams.get('name') ?? ''

  if (!raw || raw.length > SG_MAX_INPUT_CHARS) {
    return json({ ok: false, error: 'missing or oversized name parameter' }, 400)
  }

  // Validate BEFORE spending a rate-limit token (AGENTS.md: the budget exists
  // to bound real outbound work, and a typo was never going to cause any).
  const checked = sgValidateName(raw)
  if (!checked.ok) return json({ ok: false, error: checked.reason }, 400)

  // The CA is an allowlist choice, not free text: it only ever selects a
  // comparison against an identifier already in the bundle, and an unknown
  // value is dropped rather than echoed back into a finding.
  const caParam = (url.searchParams.get('ca') ?? '').trim().toLowerCase()
  const wantedCa = SG_KNOWN_CAS.some(c => c.id === caParam) ? caParam : null

  if (!allowClient(rateLimitKey(request)) || !allowGlobal('global')) {
    return json(
      { ok: false, error: 'rate limited — one check asks three resolvers dozens of questions, so give it a minute' },
      429,
      { 'Retry-After': '60' },
    )
  }

  try {
    const report = await sgInspect(checked.name, { wantedCa, signal: request.signal })
    return json({ ok: true, report })
  } catch (err: any) {
    return json({ ok: false, error: typeof err?.message === 'string' ? err.message.slice(0, 160) : 'inspection failed' })
  }
}
