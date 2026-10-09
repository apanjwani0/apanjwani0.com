# Security

The reasoning behind the security rules in [AGENTS.md](../AGENTS.md). Most are
asserted by `npm run security:smoke`, whose comments carry the longer reasoning;
the stories behind them are in git history.

**These are load-bearing invariants. A change that can't hold them needs a
different design.** `security:smoke` asserts the code half and `origin:check`
the deployed half.

### The admin surface does not exist in production

`isAdminRequestAllowed()` returns `import.meta.env.DEV` and nothing else, so
`/admin` and every `/api/admin/*` route answer 404 in production. `ADMIN_SECRET`
is dev-only and never passed to the container. Never add an IP allowlist: it
authenticates a header the caller chooses.

### Never authorize on a client-controlled value

No header, cookie, query param or body field may gate access on its own.
`getClientIp()` is untrusted and only buckets rate limits. Authorization rests
on a secret the client can't forge, or on the surface not existing.

### Origin exposure

The origin has a public IP with port 80 open, so Cloudflare is bypassable and
`cf-connecting-ip` is authoritative only for traffic that came through it.

1. **The real fix, still open**: `scripts/lock-origin-to-cloudflare.sh`
   (restrict 80/443 to Cloudflare's ranges) or a Cloudflare Tunnel. UFW alone
   isn't enough; the OCI Security List is enforced upstream and must match.
2. **On**: `ORIGIN_SHARED_SECRET` plus a Cloudflare Transform Rule that injects
   `x-origin-auth`; the middleware 404s anything without it. An empty secret
   disables the check, and a set secret with no matching rule 404s every
   request. So create the rule first and set the secret second. If it breaks,
   fix the rule value (applies at once), not the secret (costs a redeploy).

A green deploy proves nothing here: its probe supplies the header from the
container's own env. Only `npm run origin:check` from outside proves the lock.

### Verifying what is not in git

The Transform Rule, the Cache Rule and Browser Cache TTL live in the Cloudflare
dashboard, where a stray click reverts them silently. `npm run origin:check`
(`scripts/origin-check.sh`) asserts what a stranger sees: a 200 through
Cloudflare, the origin IP not serving the app, `max-age=0`, `s-maxage` present,
the response proxied, matching header and body nonces on three 404 shapes, and
no Web Analytics beacon in a browser's copy of `/`. Cloudflare injects that
beacon only for a browser user agent and copies the page's nonce onto it, so a
plain `curl` never sees it. A page it could not read in full (a curl error, a
timeout, a non-200 such as a bot challenge) fails the check rather than passing
it. The beacon is matched in a captured page, never through `curl | grep -q`:
under `pipefail` an early match closes the pipe and reads as "no match".
Asserted. Run it after any Cloudflare change.

### Rate limits must be bounded

Use `createRateLimiter()` (`src/lib/security.ts`) for every public endpoint.
Never hand-roll a `Map` keyed by client IP: the keys come from a header, so it
is a memory-exhaustion vector. The host is a 1 GB VM and the container is
capped at `--memory=768m`.

**A route with a per-client and a shared bucket asks the shared one only after
the client's says yes**: `allowClient(key) && allowGlobal('global')`. A refused
hit still counts, so asking both up front lets one refused client drain the
shared budget for everyone.

### Public endpoints must be bounded in every dimension

Body size, per-key count, global bytes, retention, and how long a request may
hold a socket. Byte accounting is optimistic (`.length` counts UTF-16 units),
so budget for it.

- **A sequence of steps needs a deadline of its own**, because per-step
  timeouts multiply. DNS Sightline joins `SG_INSPECT_DEADLINE_MS` (15 s,
  `src/lib/dns-doh.ts`) to the request's signal with `AbortSignal.any`, and
  `sgQuery` checks `signal.aborted` before asking anything: an abort listener
  never fires on a signal that has already aborted.
- **Name lookups count.** `dns.lookup` runs on libuv's threadpool outside every
  other budget, so Link Peek and Chainsaw both use `lookupAllBounded`
  (`src/lib/dns-lookup.ts`, 3 s).
- **Validate before you spend the token.** A request that can't cause the harm
  (a target with no scheme) must not cost the visitor's or the instance's
  budget. The pre-check is syntactic only (no DNS, no socket), and the fetch
  path stays authoritative, re-checking every redirect hop.
- **Reference implementations**: the Webhook Inspector (`WEBHOOK_MAX_*`, the
  2 s `?delay=` ceiling); the Type Trial and Hue Hunt daily boards (`DAILY_*`,
  `HUE_*`: bounds, separate read and write limiters, a debounced flush to
  `data/*.json`, rows re-validated on load, one shared `sanitizeName`); and
  Chainsaw (`CS_ALLOWED_PORTS`, a fixed list of ports that speak TLS at once,
  no STARTTLS). Chainsaw resolves first and then pins the socket to the checked
  address with the name only as SNI, and its limits are half Link Peek's
  because each request makes two handshakes.

### Validate a client-submitted value against one the server derives

Re-derive what is being scored and check the payload against that, never
against numbers the payload also supplied. Type Trial derives the UTC day and
its passage from `src/lib/type-trial-daily.ts`, which the browser shares.
**One-sided bounds are the trap**: a wpm ceiling computed from the claimed
seconds grows without limit as the seconds shrink, so the gate must pin the pair
to each other. Ask of every validator what an attacker sets the *other* field
to. Hue Hunt removes the other field: it takes the raw guesses and no score, and
computes the total itself. Its honest ceiling (today's colours are readable
from the bundle) is stated in `src/lib/hue-hunt-daily.ts`.

### A verifier's algorithm must not come from the thing it is verifying

`src/lib/jwt.ts` takes the algorithm as a parameter and never reads it from the
token's header (algorithm confusion). The Webhook Inspector picks the hash from
the header *name* the sender used, never from a label inside the value. Also
asserted: `alg: none` is reported unsigned and never verified, and signature
validity and `exp`/`nbf` are separate answers. The thing being checked must not
supply the terms of its own check.

### An observation must not be taken through a lens that alters it

Chainsaw reports which certificates the server *sent*. When verification
succeeds, `getPeerCertificate(true)` reports the chain OpenSSL built, including
a root from the local store. So the inspection makes two handshakes to the
pinned address: one with the real store (is it trusted?) and one with `ca: []`
(what crossed the wire). The second must fail; if it comes back authorized, the
observation is discarded and the UI says so. `CsDialOptions.trustAnchors` exists
only for the smoke test. The walk follows `issuerCertificate` links, so the tool
claims nothing about wire order or unlinked extra certificates.
`socket.authorizationError` is an Error on some Node versions and a string on
others; `csAuthCode` handles both. Ask of any probe: is the instrument part of
what I'm measuring?

### A comparison must exclude what legitimately differs

DNS Sightline's `sgCanonicalRecord` drops the TTL (each resolver counts down its
own copy) and record order (round-robin rotates), and IPv6 goes through
`canonicalIp` (`src/lib/ip.ts`). TXT case and the MX preference are kept.
Otherwise every load-balanced domain reads as inconsistent. The smoke test
asserts both directions (a real difference still reads as one), and that one
silent resolver among answering ones is **filtering**, not propagation. A
resolver that couldn't answer, a SERVFAIL included, is excluded from the
verdict rather than compared as an empty answer.

### A traversal's loop guard is per-PATH, not global

SPF's ten-lookup budget counts lookups across the whole recursive evaluation. A
domain reached by two routes is a diamond and is charged twice; only a name in
its own ancestry is a cycle (`sgSpfDescend`). The walker is checked against an
independent oracle in `security-smoke.mjs` (valid only on acyclic zones), and
depth and breadth each have their own bound and fixture. So does what it keeps:
past the overshoot a term is counted, never kept or followed, because one TXT
answer can hold thousands.

### A finding cites the record it rests on

`SgFinding.evidence` carries the literal record text. Only `basis: 'absence'`
(about a record confirmed not to exist) and `basis: 'unanswered'` (the lookup
got no answer: SERVFAIL, a timeout, the budget or the deadline) may cite
nothing, and the footer in `panels.ts` switches on `basis`. The smoke test
derives the producer list from function signatures and the finding ids from
source, so a new finding needs a fixture or fails the gate. "Dangling" means
NXDOMAIN at the CNAME target, never just "no address record".

### A failed lookup is not an absent record

A timeout must never become a confident sentence about someone's zone.

- **`sgUnanswered`** (`analyze.ts`) is the one test of whether a question got
  an answer. NXDOMAIN is an answer; SERVFAIL, REFUSED, a timeout, the budget and
  the deadline are not. Every finding that reads an empty record set asks it
  first and yields `spf-inconclusive`, `dmarc-inconclusive`, `mx-inconclusive`,
  `mx-unchecked` or `caa-inconclusive` in place of the absence finding. An
  unanswered include makes the SPF count a floor ("At least N").
- **`sgPickAnswer`** is the one rule for which resolver's answer is read: the
  primary's when it answered, else any that did, else the primary's own
  failure. The Records table and the walks read the diff's pick, and the panels
  (`dns-sightline/panels.ts`, pure functions of the report) switch on
  `mxStatus` instead of deciding absence themselves.
- **CAA**: `SgCaaReport.incomplete` is set when any lookup in the walk failed,
  including names *below* a found policy, since one of them might hold its own
  set. Then `caa-inconclusive` cites the parent's records without claiming they
  govern, and `caaRenewalOutlook` answers `unavailable`.
- **Whose failure it was decides the advice.** After a timeout, the deadline or
  the budget, the advice is to re-run. When every resolver returned SERVFAIL
  (`sgOutageOf`), the zone is broken (`zone-servfail`).
  `resolvers-unreachable` uses `SgAnswer.stopped` to tell the deadline from a
  resolver this server couldn't reach.
- **A finding may lean on an absence without being about one.** `dmarc-at-apex`
  needs `_dmarc` to have answered. "Not dangling" needs an answer saying the
  target exists, else `cname-unchecked`. NXDOMAIN on an MX target's A lookup
  settles both address families.
- The smoke test asserts this without a list of findings. For every question
  the inspection asks, it runs the zone with that record present, absent and
  unanswered. A finding that depends on the question must not appear when it
  went unanswered, and it must carry `basis: 'unanswered'` there and never in an
  answered run. A conclusion wrongly *withheld* can't be checked that way, so
  NXDOMAIN and the cases above have direct assertions.

### A conclusion that does not depend on X must not be gated on X

`caaRenewalOutlook` (`src/lib/caa.ts`) joins the CAs DNS Sightline's policy
permits with the issuer Chainsaw saw. Blocks that hold for every CA (a critical
tag no CA understands, `issue ";"`) are reported before the issuer is
identified. Only then does an unknown issuer return `null`, rather than
fuzzy-matching the identifier table. Every message is about a *renewal that will
fail*, never mis-issuance: a CA checks CAA only before it signs.

`spf-no-all` follows only what decides an unlisted sender's result: the first
`all`, else the `redirect=` chain (`SgSpfReport.fallthrough`). It is suppressed
only when that chain went unread.

The narrow `scope=caa` query on `/api/tools/dns-sightline` has its own
rate-limit buckets. That is allowed only because `cap × budget` stays under the
full scope's in both the per-client and the global dimension, which is asserted.

### Escaping

- Anything interpolated into HTML is escaped, including `'`.
- Anything in a `<script>` body (JSON-LD) goes through `serialize()` in
  `src/lib/jsonld.ts`, which escapes `<`.
- Markdown goes through `src/lib/markdown.ts` only (raw HTML escaped, URLs
  through `safeMarkdownUrl()`). Never hand `marked` output to `set:html`.
- A remote-chosen value that lands in CSS or an `href` is held to that grammar
  first. Link Peek's image type must match `image/[a-z0-9.+-]+`
  (`lpImageMediaType`). Chainsaw's CA Issuers URL is a link only when it parses
  as plain http(s) with no credentials **and** the certificate text already
  equals the parser's output (`csLinkableUrl`), so the link text is its own
  href.
- An exception's message never reaches a response. Routes answer expected
  failures with fixed sentences and wrap calls that could throw (`csInspect`)
  in fixed `no-store` JSON.

### A rerouted error page carries the nonce its CSP names

The CSP is `script-src 'self' 'nonce-…'` with a fresh nonce per response, and
exactly one inline script ships: the head bootstrap (`ROOT_BOOT_JS`,
`src/lib/theme.ts`).

- Astro re-renders a bodyless 404 or 500 through its error page (`404.astro`
  or `500.astro`, which also renders for a route that throws) with a second
  nonce and keeps the first pass's headers. Without `500.astro`, `/500` falls
  through to `[slug].astro` and a crash reads as a cached, blank 404. So the middleware leaves CSP to the
  re-render for the statuses Astro reroutes (`isReroutedByAstro`, held to
  Astro's `REROUTABLE_STATUS_CODES`), and `origin:check` compares header and
  body nonces in production.
- ClientRouter re-inserts a changed inline script under a nonce the live page
  refuses, so the bootstrap is a constant with nothing interpolated. **Don't add
  a second inline script**: data goes in a JSON-LD block or a fetched file (the
  palette's index is planned as `/search.json`), behaviour in a bundled module.

### Unguessable ids are a security control

Where knowing an id is the only protection (webhook bins), ids are at least 24
characters, enforced server-side.

### Before merging anything that touches a trust boundary

```sh
npm run security:smoke && npm run build && npm run check && npm run boot:check
```

Add an assertion for each new invariant: a code invariant in
`scripts/security-smoke.mjs`, a deployed-posture one in `scripts/origin-check.sh`.
Then **break what the assertion guards and watch it fail.** A mutation that
survives means the assertion is wrong, not the mutation. The poker split-pot
fixture is the worked example.
