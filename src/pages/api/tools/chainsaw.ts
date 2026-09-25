/**
 * Chainsaw — the inspection endpoint.
 *
 * GET /api/tools/chainsaw?target=example.com:8443
 *
 * The server does the dialling because a browser cannot: there is no API in a
 * page that opens a raw TLS connection and reads the certificates off the
 * handshake, and the questions worth asking — did the server send its
 * intermediates, when does the *chain* expire, what did it negotiate — are
 * exactly the ones a browser has already answered silently and thrown away.
 *
 * Every dimension is bounded (AGENTS.md): target length, port allowlist,
 * handshake timeout, chain length, and — because each request costs the origin
 * two OUTBOUND TLS handshakes — both a per-client and a global rate limit,
 * tighter than Link Peek's for that reason. Nothing is stored; the response is
 * computed per request and `no-store`.
 */
import type { APIRoute } from 'astro'
import { createRateLimiter, rateLimitKey } from '../../../lib/security'
import { CS_MAX_HOST_CHARS, csInspect, csNameTrustAnchor, csValidateTarget } from '../../../lib/tls-inspect'

export const prerender = false

// Half of Link Peek's per-client allowance: a hit here opens two sockets and
// holds them through a full handshake, which is dearer than one HTTP fetch.
const allowClient = createRateLimiter(60_000, 6)
// One shared bucket across ALL clients, bounding the instance's total outbound
// handshake rate however many clients arrive.
const allowGlobal = createRateLimiter(60_000, 24)

function json(body: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  })
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url)
  const target = url.searchParams.get('target') ?? ''

  if (!target || target.length > CS_MAX_HOST_CHARS + 16) {
    return json({ ok: false, error: 'missing or oversized target parameter' }, 400)
  }
  // Validate BEFORE spending a rate-limit token: a typo should not cost the
  // visitor one of six chances a minute.
  const checked = csValidateTarget(target)
  if (!checked.ok) return json({ ok: false, error: checked.reason }, 400)

  if (!allowClient(rateLimitKey(request)) || !allowGlobal('global')) {
    return json({ ok: false, error: 'rate limited — every check opens real TLS connections, so give it a minute' }, 429, { 'Retry-After': '60' })
  }

  // csInspect reports every failure it expects as `{ error }`. Anything it
  // throws is a failure it did not expect, and the text of that exception is
  // not something to hand a stranger — so it gets a fixed sentence, `no-store`
  // like every other answer here, instead of Astro's error page.
  let result: Awaited<ReturnType<typeof csInspect>>
  try {
    result = await csInspect(checked.host, checked.port, checked.isIpLiteral)
  } catch {
    return json({ ok: false, error: 'the inspection failed unexpectedly — try again in a moment' }, 500)
  }
  if ('error' in result) return json({ ok: false, error: result.error })

  const top = result.presented[result.presented.length - 1]
  return json({
    ok: true,
    report: {
      host: result.host,
      port: result.port,
      address: result.address,
      family: result.family,
      handshake: {
        protocol: result.handshake.protocol,
        cipher: result.handshake.cipher,
        cipherStandard: result.handshake.cipherStandard,
        alpn: result.handshake.alpn,
        ephemeralKey: result.handshake.ephemeralKey,
        ocspStapled: result.handshake.ocspStapled,
        authorized: result.handshake.authorized,
        authorizationError: result.handshake.authorizationError,
        verifiedLength: result.handshake.chain.length,
      },
      presented: result.presented,
      anchorIncluded: result.anchorIncluded,
      presentedObserved: result.presentedObserved,
      storeRoot: result.storeRoot,
      // Naming the anchor is a claim, so it is proved rather than inferred from
      // `authorized`: the root is found in the bundled store by issuer name and
      // its key is then used to verify the top certificate's signature.
      namedRoot: top ? csNameTrustAnchor(top.pem) : null,
      elapsedMs: result.elapsedMs,
    },
  })
}
