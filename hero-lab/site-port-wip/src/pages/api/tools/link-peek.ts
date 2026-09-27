/**
 * Link Peek — preview endpoint.
 *
 * GET /api/tools/link-peek?url=…&ua=…            → extracted unfurl meta
 * GET /api/tools/link-peek?url=…&ua=…&kind=image → the og:image as a data URI
 *
 * The server does the fetching (a browser can't — CORS, and the page must be
 * fetched as a bot UA to see what scrapers see) and the extraction (so half a
 * megabyte of somebody's HTML never travels to the visitor — only the meta
 * does). Preview resolution and lint happen in the CLIENT via the same shared
 * module that produced the extraction, so the two sides cannot disagree.
 *
 * The image round-trip exists because the site's CSP is img-src 'self' data:
 * — an external og:image cannot render in the preview cards directly, so the
 * server proxies it once, bounded, as a data URI. That also hands the client
 * the real pixel size, which is the "wrong dimensions" lint no static check
 * can do.
 *
 * Every dimension is bounded (AGENTS.md): URL length, redirect count, total
 * time, response bytes, and — because each request here costs the origin an
 * OUTBOUND fetch — both a per-client and a global rate limit. The UA is picked
 * by allowlist key, never from free text.
 */
import type { APIRoute } from 'astro'
import { createRateLimiter, rateLimitKey } from '../../../lib/security'
import {
  LP_MAX_IMAGE_BYTES,
  LP_MAX_URL_CHARS,
  LP_USER_AGENTS,
  lpDecodeHtml,
  lpFetchImage,
  lpFetchPage,
  lpImageMediaType,
  lpValidateUrl,
} from '../../../lib/link-peek-fetch'
import { lpExtractMeta } from '../../../components/tools/link-peek/unfurl'

export const prerender = false

// Tighter than the webhook capture limiter on purpose: every hit here makes
// the origin fetch a third-party URL, so the cost is outbound bandwidth and a
// held socket, not just a store write.
const allowClient = createRateLimiter(60_000, 10)
// One shared bucket across ALL clients — the per-key limiter bounds a single
// abuser, this bounds the instance's total outbound fetch rate.
const allowGlobal = createRateLimiter(60_000, 40)

function json(body: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  })
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url)
  const target = url.searchParams.get('url') ?? ''
  const kind = url.searchParams.get('kind') === 'image' ? 'image' : 'page'
  const uaParam = url.searchParams.get('ua') ?? 'peek'
  // Allowlist key, never a header value from the request.
  const uaKey = Object.prototype.hasOwnProperty.call(LP_USER_AGENTS, uaParam) ? uaParam : 'peek'

  if (!target || target.length > LP_MAX_URL_CHARS) {
    return json({ ok: false, error: 'missing or oversized url parameter' }, 400)
  }
  // Validate BEFORE spending a rate-limit token — the ordering Chainsaw uses
  // and AGENTS.md documents. This gate is purely syntactic (scheme, credentials,
  // port, host presence; no DNS, no socket), so it costs nothing, and without it
  // a mistyped scheme burned one of the visitor's ten chances a minute AND one
  // of the instance's forty outbound fetches — a budget that exists to bound
  // real fetching, spent on a request that was never going to fetch anything.
  // `lpFetchBounded` re-runs this and the address checks on every redirect hop,
  // so the fetch path stays the authoritative gate; this is only an early out.
  const checked = lpValidateUrl(target)
  if (!checked.ok) return json({ ok: false, error: checked.reason }, 400)

  if (!allowClient(rateLimitKey(request)) || !allowGlobal('global')) {
    return json({ ok: false, error: 'rate limited — try again in a minute' }, 429, { 'Retry-After': '60' })
  }

  if (kind === 'image') {
    const declaredTooBig = (n: number) => `image is ${Math.round(n / 1024)} KB — over this preview's ${Math.round(LP_MAX_IMAGE_BYTES / 1024)} KB cap`
    const fetched = await lpFetchImage(target, uaKey)
    if (!fetched.ok) return json({ ok: false, error: fetched.reason })
    // Allowlisted, not prefix-matched: this string becomes part of a `data:`
    // URI inside CSS `url("…")` on the page (see lpImageMediaType).
    const type = lpImageMediaType(fetched.contentType)
    if (!type) {
      const said = (fetched.contentType ?? '').split(';')[0].trim().toLowerCase()
      const shown = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(said) ? said : said ? 'a content-type that is not an image' : 'no content-type'
      return json({ ok: false, error: `the URL answered with ${shown}, not an image` })
    }
    if (fetched.truncated) {
      return json({ ok: false, error: declaredTooBig(fetched.declaredBytes ?? fetched.bytes) })
    }
    if (fetched.status !== 200) {
      return json({ ok: false, error: `the image URL answered HTTP ${fetched.status}` })
    }
    return json({
      ok: true,
      dataUri: `data:${type};base64,${Buffer.from(fetched.body).toString('base64')}`,
      bytes: fetched.bytes,
      contentType: type,
    })
  }

  const fetched = await lpFetchPage(target, uaKey)
  if (!fetched.ok) return json({ ok: false, error: fetched.reason })

  const type = (fetched.contentType ?? '').split(';')[0].trim().toLowerCase()
  const isHtml = type === '' || type === 'text/html' || type === 'application/xhtml+xml'
  if (!isHtml) {
    // Not an error: "this URL is a PDF/image/JSON, so nothing unfurls" is the
    // answer, and the UI renders it as one.
    return json({
      ok: true,
      kind: 'non-html',
      finalUrl: fetched.finalUrl,
      status: fetched.status,
      contentType: type,
      bytes: fetched.bytes,
      declaredBytes: fetched.declaredBytes,
      hops: fetched.hops,
    })
  }

  const { text, charset } = lpDecodeHtml(fetched.body, fetched.contentType)
  const meta = lpExtractMeta(text, fetched.finalUrl)

  return json({
    ok: true,
    kind: 'html',
    finalUrl: fetched.finalUrl,
    status: fetched.status,
    contentType: type,
    charset,
    bytes: fetched.bytes,
    declaredBytes: fetched.declaredBytes,
    truncated: fetched.truncated,
    hops: fetched.hops,
    ua: uaKey,
    meta,
  })
}
