import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'
import { readFile, readdir } from 'node:fs/promises'
import { INTEREST_MAX_COUNT, sanitizeStore } from '../src/lib/interest.ts'
import { render, renderInline, splitOnEmbeds } from '../src/lib/markdown.ts'
import {
  createRateLimiter,
  getClientIp,
  isFromCloudflare,
  isSameOrigin,
  rateLimitKey,
  safeExternalUrl,
  safeMarkdownUrl,
  timingSafeEqualText,
} from '../src/lib/security.ts'
import { getRequest, isValidBinId, isValidRequestId, recordRequest } from '../src/lib/webhook-store.ts'
import {
  wiDecodeSecret,
  wiDetectScheme,
  wiDiscoverSignature,
  wiHmac,
  wiVerifyScheme,
} from '../src/components/tools/webhook-inspector/signature.ts'
import { GAME_TAGS, gameTag, isPlayableGame } from '../src/lib/games.ts'
import { games } from '../src/config/games.ts'
import { tools } from '../src/config/tools.ts'
import { SERVER_TOOLS, isServerTool } from '../src/lib/tools.ts'
import { site } from '../src/config/site.ts'
import { isBlogsPublic, navLinks } from '../src/lib/config.ts'
import { looksAutomated, pruneVisits, recordVisit, referrerHost, serializeBounded } from '../src/lib/visits.ts'
import {
  DAILY_MAX_ENTRIES_PER_DAY,
  DAILY_NAME_MAX,
  DAILY_WPM_CAP,
  isPlausibleScore,
  pruneBoard,
  sanitizeName,
} from '../src/lib/type-trial-leaderboard.ts'
import { dailyPassage, todayUtcDay } from '../src/lib/type-trial-daily.ts'
import { isPublishedLearning, learningEmbedTag, learningsAboutEmbed } from '../src/lib/learnings.ts'
import { learningHasOgCard } from '../src/lib/og.ts'
import { learnings } from '../src/config/learnings.ts'
import { EMBED_TAGS } from '../src/lib/embeds.ts'
import {
  HUE_DAILY_MAX,
  HUE_DAILY_ROUNDS,
  HUE_GUESS_MAX_CHARS,
  dailyColors as hueDailyColors,
  hueDayNumber,
  isValidHueDay,
  scoreDailyGuesses,
  toHex as hueToHex,
} from '../src/lib/hue-hunt-daily.ts'
import {
  HUE_MAX_ENTRIES_PER_DAY,
  HUE_NAME_MAX,
  HUE_RETAINED_DAYS,
  pruneHueBoard,
  sanitizeName as hueSanitizeName,
  sanitizeStoredEntry as hueSanitizeStoredEntry,
} from '../src/lib/hue-hunt-leaderboard.ts'
import {
  CwZoneClock,
  cwCollectRuns,
  cwFiringCount,
  cwIsFixedTime,
  cwOffsetLabel,
  cwParse,
  cwZoneValid,
} from '../src/components/tools/cron-whisperer/schedule.ts'
import { DRIFTFIELD_MODES, MOVED_GAMES } from '../src/lib/driftfield.ts'
import { validateConfigData } from '../src/lib/config-schema.ts'
import {
  algParams,
  checkTimeClaims,
  isJwtAlg,
  isUnsigned,
  parseJwt,
  verifyJwt,
} from '../src/lib/jwt.ts'
import {
  GRAPH_SHAPES,
  decodeGraph,
  detectDialect,
  encodeGraph,
  parseMermaid,
  parseOutline,
  parseHeadings,
  parseMarkdownOutline,
  toMermaid,
} from '../src/lib/graph-text.ts'
import {
  CS_ALLOWED_PORTS,
  CS_ANCHOR_CODES,
  csAuthCode,
  csDescribeCert,
  csDial,
  csNameTrustAnchor,
  csResolvePinned,
  csSignatureAlgorithm,
  csValidateTarget,
} from '../src/lib/tls-inspect.ts'
import {
  csCanonicalIp,
  csChainPem,
  csChainState,
  csEffectiveExpiry,
  csFindings,
  csMatchHost,
  csNameMatches,
  csServeChainPem,
} from '../src/components/tools/chainsaw/analyze.ts'

const unsafeMarkdown = render('[x](javascript:alert(1)) <img src=x onerror=alert(1)>')
assert.equal(unsafeMarkdown.includes('javascript:'), false)
assert.equal(unsafeMarkdown.includes('<img src=x'), false)
assert.equal(unsafeMarkdown.includes('&lt;img src=x'), true)

const safeInline = renderInline('hello **world**')
assert.equal(safeInline, 'hello <strong>world</strong>')

// Editorial extensions (==mark==, :::callout, >> pull quote). Each one emits
// markup from author-supplied text, so each is a place raw HTML could escape if
// the body were interpolated instead of parsed. The bodies go back through
// marked, which is what keeps renderer.html's escaping in force inside them.
assert.equal(render('a ==b== c').trim(), '<p>a <mark>b</mark> c</p>')
assert.ok(render(':::key T\nbody\n:::').startsWith('<aside data-type="callout" data-kind="key">'))
assert.ok(render('>> line').includes('data-type="pull-quote"'))
// `>` is still a real blockquote — the pull quote is a SEPARATE mark on purpose,
// so that quoting a person and emphasising a line stay distinguishable.
assert.ok(render('> quoted').includes('<blockquote>'))
// The kind is matched against a fixed list, never interpolated: otherwise a
// content author could close the attribute and add their own.
assert.equal(render(':::evil x\nbody\n:::').includes('<aside'), false, 'unknown callout kinds are not markup')
assert.equal(
  render(':::note "><script>alert(1)</script>\nbody\n:::').includes('<script>'),
  false,
  'a callout label cannot break out of its element',
)
assert.equal(
  render(':::note L\n<img src=x onerror=alert(1)>\n:::').includes('<img src=x'),
  false,
  'raw HTML inside a callout body is escaped like anywhere else',
)
assert.equal(render('==<b>x</b>==').includes('<b>'), false, 'raw HTML inside a highlight is escaped')

// {{embed}} placement. No marker means the whole article is one segment with no
// figure — the caller then falls back to putting the figure after the prose,
// never dropping it, because a typo in /admin should cost the position and not
// the simulation.
assert.deepEqual(splitOnEmbeds('a\n{{embed}}\nb'), [{ markdown: 'a\n', view: '' }, { markdown: '\nb' }])
assert.deepEqual(splitOnEmbeds('a only'), [{ markdown: 'a only' }])
assert.equal(splitOnEmbeds('inline {{embed}} text').length, 1, 'the marker must be on its own line')
// Several figures per article is the house format, and a pinned name rides on
// the marker. An unknown name is NOT rejected here: the component falls back to
// its default view, so a typo costs the pinning and never the figure.
assert.deepEqual(
  splitOnEmbeds('a\n{{embed:flow}}\nb\n{{embed:er}}\nc'),
  [{ markdown: 'a\n', view: 'flow' }, { markdown: '\nb\n', view: 'er' }, { markdown: '\nc' }],
)
assert.equal(splitOnEmbeds('x\n{{embed:Flow Chart}}\ny').length, 1, 'a view name is one lowercase token')

assert.equal(safeExternalUrl('https://github.com/apanjwani0/repo'), 'https://github.com/apanjwani0/repo')
assert.equal(safeExternalUrl('http://example.com'), null)
assert.equal(safeExternalUrl('javascript:alert(1)'), null)
assert.equal(safeMarkdownUrl('mailto:hello@example.com'), 'mailto:hello@example.com')
assert.equal(safeMarkdownUrl('/blogs/test'), '/blogs/test')
assert.equal(safeMarkdownUrl('javascript:alert(1)'), null)

assert.equal(await timingSafeEqualText('secret', 'secret'), true)
assert.equal(await timingSafeEqualText('secret', 'wrong'), false)

// getClientIp must never surface x-forwarded-for: it is client-authored
// end-to-end. cf-connecting-ip is only authoritative for traffic that actually
// came through Cloudflare, which is why nothing authorizes on it — see the
// admin checks below.
const req = (headers) => new Request('https://example.com/admin', { headers })
assert.equal(getClientIp(req({ 'cf-connecting-ip': '1.2.3.4' })), '1.2.3.4')
assert.equal(getClientIp(req({ 'x-forwarded-for': '1.2.3.4' })), '')
assert.equal(getClientIp(req({ 'cf-connecting-ip': '9.9.9.9', 'x-forwarded-for': '1.2.3.4' })), '9.9.9.9')
assert.equal(getClientIp(req({})), '')

// Origin lock. Must fail CLOSED when configured, and be a no-op when not — an
// empty secret has to allow traffic, or setting it before the Cloudflare
// Transform Rule exists would take the whole site offline.
assert.equal(await isFromCloudflare(req({}), ''), true, 'unset secret must not block')
assert.equal(await isFromCloudflare(req({}), undefined), true)
assert.equal(await isFromCloudflare(req({}), 'sekrit'), false, 'missing header must be rejected')
assert.equal(await isFromCloudflare(req({ 'x-origin-auth': 'wrong!' }), 'sekrit'), false)
assert.equal(await isFromCloudflare(req({ 'x-origin-auth': 'short' }), 'sekrit'), false)
assert.equal(await isFromCloudflare(req({ 'x-origin-auth': 'sekrit' }), 'sekrit'), true)

// Unattributable traffic shares one bucket rather than getting a fresh bucket per
// request — otherwise a per-IP limiter is bypassed by simply sending no IP.
assert.equal(rateLimitKey(req({})), 'unattributed')
assert.equal(rateLimitKey(req({ 'cf-connecting-ip': '1.2.3.4' })), '1.2.3.4')

// Rate limiter: allows up to the cap, denies past it, and recovers after the window.
const allow = createRateLimiter(1_000, 3)
const t0 = 1_000_000
assert.deepEqual([1, 2, 3, 4].map(() => allow('k', t0)), [true, true, true, false])
assert.equal(allow('other', t0), true, 'limits are per key')
assert.equal(allow('k', t0 + 1_001), true, 'window resets')

// The limiter must stay bounded: its keys come from a request header, so an
// unbounded map would be a memory-exhaustion vector rather than a defence.
// Flooding it with fresh keys inside one window must still leave it enforcing
// limits — if eviction were broken this would either grow forever or stop
// limiting the key we care about.
const flood = createRateLimiter(60_000, 1)
for (let i = 0; i < 50_000; i += 1) flood(`key-${i}`, t0)
assert.equal(flood('victim', t0), true)
assert.equal(flood('victim', t0), false, 'limiter still enforces after a key flood')

// Astro's global checkOrigin is disabled (the webhook capture endpoint must
// accept cross-origin POSTs), so this shared check IS the CSRF control for every
// other state-changing endpoint. Missing Origin allows — curl and webhook
// senders don't send one, and CSRF needs a browser, which always does.
const oreq = (origin) =>
  new Request('https://apanjwani0.com/api/analytics/event', origin === undefined ? {} : { headers: { origin } })
assert.equal(isSameOrigin(oreq(undefined)), true, 'no Origin header (curl) is allowed')
assert.equal(isSameOrigin(oreq('https://apanjwani0.com')), true)
assert.equal(isSameOrigin(oreq('https://evil.example')), false, 'cross-origin must be rejected')
assert.equal(isSameOrigin(oreq('null')), false, 'an opaque origin must be rejected')

// …and it must stay SHARED: a private copy drifting in one route would silently
// weaken the CSRF story with nothing to notice.
//
// The route list is DISCOVERED, not written down. It used to be a hardcoded pair,
// which silently covered 2 of the 6 state-changing routes: the guards in
// games/interest.ts, games/type-trial/daily.ts and games/hue-hunt/daily.ts could
// each be deleted with the smoke staying green. A hardcoded list only ever covers
// the routes that existed when someone last remembered to edit it, and the whole
// point of this assertion is the route somebody adds next.
//
// Exemptions are named with the reason, so adding one is a decision rather than an
// omission:
//   api/hook/[bin].ts    — the capture endpoint. Accepting cross-origin requests is
//                          its entire function; a CSRF guard there breaks the tool.
//   api/admin/*          — do not exist in production (isAdminRequestAllowed is
//                          import.meta.env.DEV and nothing else), so there is no
//                          production surface to forge a request against.
const CSRF_EXEMPT = new Set([
  'src/pages/api/hook/[bin].ts',
  'src/pages/api/admin/login.ts',
  'src/pages/api/admin/logout.ts',
  'src/pages/api/admin/save.ts',
])

async function apiRouteFiles(dir = 'src/pages/api') {
  const out = []
  for (const entry of await readdir(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...(await apiRouteFiles(path)))
    else if (entry.name.endsWith('.ts')) out.push(path)
  }
  return out
}

const stateChanging = []
for (const route of await apiRouteFiles()) {
  const src = await readFile(new URL(`../${route}`, import.meta.url), 'utf-8')
  if (/export const (POST|PUT|PATCH|DELETE|ALL)\b/.test(src) && !CSRF_EXEMPT.has(route)) {
    stateChanging.push(route)
  }
}
assert.ok(
  stateChanging.length >= 4,
  `expected to discover the state-changing API routes, found ${stateChanging.length} — has the tree moved?`,
)
for (const route of stateChanging) {
  const src = await readFile(new URL(`../${route}`, import.meta.url), 'utf-8')
  // Match the guard, not the identifier: an `import { isSameOrigin }` line — or
  // this very comment — satisfies a substring test, so a refactor that deletes
  // the call and leaves the import would keep the smoke green with the CSRF
  // control gone. That is exactly the failure an assertion is supposed to catch.
  assert.match(
    src,
    /if \(!isSameOrigin\(request\)\)\s*return[^\n]*403/,
    `${route} must reject cross-origin requests with the shared isSameOrigin check`,
  )
}

// One predicate decides whether a game is real: the sitemap, the detail page's
// robots meta, the share card and the hub's ItemList all read isPlayableGame, so
// they cannot contradict each other. It must also survive a slug that names an
// Object.prototype member — a bare GAME_TAGS[slug] lookup returns an inherited
// function there, which is truthy, so the page would render <GameTag> with a
// function as its tag name and 500 instead of showing "coming soon".
assert.equal(isPlayableGame({ slug: 'constructor', enabled: true, interactive: true }), false)
assert.equal(isPlayableGame({ slug: 'toString', enabled: true, interactive: true }), false)
assert.equal(isPlayableGame({ slug: '2048', enabled: true, interactive: true }), true)
assert.equal(isPlayableGame({ slug: '2048', enabled: true, interactive: false }), false)
assert.equal(isPlayableGame({ slug: 'not-a-game', enabled: true, interactive: true }), false)
for (const g of games.filter(isPlayableGame)) {
  assert.ok(gameTag(g), `${g.slug} is listed in the sitemap, so it must render a real component`)
}

// Bin ids are the only thing protecting captured webhook payloads, so short,
// guessable ids must be rejected outright.
assert.equal(isValidBinId('test12'), false, 'short ids are enumerable')
assert.equal(isValidBinId('webhook'), false)
assert.equal(isValidBinId('a'.repeat(23)), false)
assert.equal(isValidBinId('a'.repeat(24)), true)
assert.equal(isValidBinId('0123456789abcdef0123456789abcdef'), true) // what the UI mints
assert.equal(isValidBinId('a'.repeat(65)), false)
assert.equal(isValidBinId('../../etc/passwd'), false)

// Every public hook route is rate-limited — DERIVED from the directory, not a list,
// so a route added later cannot skip it by not being named here. `requests.ts`
// shipped with neither verb limited while both its siblings were; its ETag made an
// unchanged poll cheap but did nothing for a caller that never sends if-none-match.
{
  const hookDir = new URL('../src/pages/api/hook/', import.meta.url)
  const routes = []
  const walk = async dir => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const at = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir)
      if (entry.isDirectory()) await walk(at)
      else if (entry.name.endsWith('.ts')) routes.push(at)
    }
  }
  await walk(hookDir)
  assert.ok(routes.length >= 3, `expected the hook routes to be found, got ${routes.length}`)
  for (const route of routes) {
    const src = await readFile(route, 'utf-8')
    const name = route.pathname.split('/api/hook/')[1]
    const verbs = [...src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE|ALL):/g)].map(m => m[1])
    assert.ok(verbs.length > 0, `${name} exports no handler`)
    assert.ok(
      /createRateLimiter\(/.test(src) && /rateLimitKey\(/.test(src),
      `${name} is a public endpoint with no rate limiter — AGENTS.md requires createRateLimiter on every one`,
    )
    assert.ok(
      /isValidBinId\(/.test(src),
      `${name} must validate the bin id server-side — the 24-char floor is the whole access control`,
    )
  }
}

// Request ids (the share-permalink half of a lookup) are server-minted UUIDs,
// not a secrecy control — the bin id in the same URL already grants the bin —
// but the route must still reject arbitrary shapes before touching the store.
assert.equal(isValidRequestId('..'), false)
assert.equal(isValidRequestId('abc'), false, 'under the 8-char floor')
assert.equal(isValidRequestId('a'.repeat(65)), false)
assert.equal(isValidRequestId('../../etc/passwd'), false)
assert.equal(isValidRequestId(123), false)
assert.equal(isValidRequestId(crypto.randomUUID()), true, 'what the capture route mints')

// A share link followed in a tab already showing the tool is a same-document
// fragment navigation — connectedCallback does not re-run, so loadShared() must
// also be reachable from a hashchange listener, and that listener must be torn
// down with the others.
{
  const wi = await readFile(
    new URL('../src/components/tools/webhook-inspector/WebhookInspector.ts', import.meta.url), 'utf-8',
  )
  assert.ok(
    /addEventListener\('hashchange'/.test(wi),
    'the inspector must listen for hashchange, or a share link is inert in an already-open tab',
  )
  assert.ok(
    /removeEventListener\('hashchange'/.test(wi),
    'and must remove that listener on disconnect, like every other listener here',
  )
  const onHash = wi.slice(wi.indexOf('private onHashChange'))
  assert.ok(
    /loadShared\(\)/.test(onHash.slice(0, 200)),
    'the hashchange handler must actually re-run loadShared()',
  )
}

// getRequest resolves exactly the recorded request and nothing else: an unknown
// request id and an unknown bin are both null, indistinguishably, so the share
// endpoint can 404 them identically without confirming which half was wrong.
// One captured-request shape, shared by the store assertions below and by the
// route assertions after them — so the two cannot drift into testing different
// objects and disagreeing about what a captured request looks like.
const smokeShape = {
  method: 'POST',
  query: '',
  headers: [{ name: 'content-type', value: 'application/json' }],
  contentType: 'application/json',
  source: null,
  bodyText: '{"hello":"smoke"}',
  bodyTruncated: false,
  size: 17,
  receivedAt: Date.now(),
}

{
  const smokeBin = 'smoke-share-bin-0123456789abcdef'
  const smokeReq = { ...smokeShape, id: crypto.randomUUID() }
  assert.equal(isValidBinId(smokeBin), true, 'fixture bin must pass the real validator')
  recordRequest(smokeBin, smokeReq)
  assert.deepEqual(getRequest(smokeBin, smokeReq.id), smokeReq)
  assert.equal(getRequest(smokeBin, crypto.randomUUID()), null, 'unknown request id')
  assert.equal(getRequest('smoke-share-bin-none-0123456789', smokeReq.id), null, 'unknown bin')
}

// The share route must validate BOTH path params before the store lookup, must
// never let a captured payload into any cache, and must be rate-limited.
//
// RUN the route rather than grep it. The first version of this block asserted
// that the strings `'Cache-Control': 'no-store'` and `createRateLimiter(`
// appeared somewhere in the file, which is satisfied by the surviving `const`
// declaration alone: deleting the whole `if (!allowShareRead(...))` enforcement
// block, or replacing every `headers: NO_STORE` with `headers: {}`, both left
// this green. A guard that a mutation survives is not a guard.
{
  const { GET: shareGet } = await import('../src/pages/api/hook/[bin]/requests/[id].ts')
  const shareReq = () => new Request('http://localhost/api/hook/x/y', {
    headers: { 'cf-connecting-ip': '203.0.113.77' },
  })
  const call = (bin, id) => shareGet({ params: { bin, id }, request: shareReq() })

  const shareBin = 'smoke-share-route-0123456789abcd'
  const shareId = crypto.randomUUID()
  assert.equal(isValidBinId(shareBin), true, 'route fixture bin must pass the real validator')
  recordRequest(shareBin, { ...smokeShape, id: shareId })

  const hit = await call(shareBin, shareId)
  assert.equal(hit.status, 200, 'a real bin+request resolves')
  assert.equal(hit.headers.get('cache-control'), 'no-store', 'share responses must never be cacheable')
  assert.equal((await hit.json()).request.id, shareId, 'and it is the request that was asked for')

  // Both halves 404 identically, so the response never says which one was wrong.
  for (const [bin, id, what] of [
    [shareBin, crypto.randomUUID(), 'unknown request id'],
    ['smoke-share-route-absent-01234567', shareId, 'unknown bin'],
    ['too-short', shareId, 'bin id below the unguessability floor'],
    [shareBin, '../../../etc/passwd', 'a traversal-shaped request id'],
  ]) {
    const miss = await call(bin, id)
    assert.equal(miss.status, 404, `${what} must 404`)
    assert.equal(miss.headers.get('cache-control'), 'no-store', `${what} response must be no-store`)
  }

  // …and the limiter really enforces. 60/min, so the 61st from one address trips.
  let tripped = 0
  for (let i = 0; i < 70; i++) {
    const r = await call(shareBin, shareId)
    if (r.status === 429) {
      tripped++
      assert.equal(r.headers.get('retry-after'), '60', 'a 429 must say when to come back')
      assert.equal(r.headers.get('cache-control'), 'no-store', 'a 429 must not be cached either')
    }
  }
  assert.ok(tripped > 0, 'the share route must rate-limit — 70 reads from one address drew no 429')
}



// Visit counting stores no personal data: referrers are reduced to a host, and
// same-host referrals (internal navigation) are dropped entirely.
assert.equal(referrerHost('https://news.ycombinator.com/item?id=1', 'apanjwani0.com'), 'news.ycombinator.com')
assert.equal(referrerHost('https://apanjwani0.com/tools', 'apanjwani0.com'), null)
assert.equal(referrerHost(null, 'apanjwani0.com'), null)

// The visits file is bounded in bytes, not just per-day rows — it is written
// from public traffic on a 1 GB host, so "global bytes" is one of the dimensions
// AGENTS.md requires every public-input store to bound. The trimming must keep
// the NEWEST days (today's counters are the ones being written), must not mutate
// the store it is handed, and must stay linear: the obvious drop-oldest-and-
// re-stringify loop is quadratic in exactly the case the ceiling exists for.
{
  const day = () => ({ '/x': { views: 1, bots: 0, countries: { XX: 1 }, referrers: {} } })
  const store = Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => [`2026-01-${String(i + 1).padStart(2, '0')}`, day()]),
  )
  const before = JSON.stringify(store)
  const out = serializeBounded(store, 400)

  assert.ok(out.length <= 400, `bounded output must fit the budget, got ${out.length}`)
  assert.equal(JSON.stringify(store), before, 'serializeBounded must not mutate its argument')
  const kept = Object.keys(JSON.parse(out))
  assert.ok(kept.length > 0 && kept.length < 40, 'it must drop some days but not all')
  assert.equal(kept.at(-1), '2026-01-40', 'the newest day must survive the trim')
  assert.deepEqual(kept, [...kept].sort(), 'surviving days stay in chronological order')

  // A single day larger than the whole budget is written anyway rather than
  // losing the day entirely — the per-day caps are what bound that case.
  const oneBigDay = { '2026-01-01': day() }
  assert.equal(JSON.parse(serializeBounded(oneBigDay, 1))['2026-01-01']['/x'].views, 1)
}

// …and it never records an /api/ path. Content-Type alone cannot decide this:
// the webhook capture endpoint echoes the caller's own Content-Type back on
// ?echo=1, so `GET /api/hook/<id>?echo=1` declaring text/html would write that
// secret bin id into data/visits.json for 90 days, and ~400 of them would fill
// MAX_PATHS_PER_DAY and silently drop every real page path for the rest of the day.
const middlewareSrc = await readFile(new URL('../src/middleware.ts', import.meta.url), 'utf-8')
assert.match(
  middlewareSrc,
  /isHtml && !isAdminSurface && !isApi/,
  'visit counting must exclude /api/ paths, not just non-HTML responses',
)

// Cache-Control branch order. The /api/ no-store must rank ABOVE the 404 rule:
// an API 404 is usually a resource that can exist a moment later (a bin not yet
// created), and edge-caching that for 5 minutes serves the miss back to the
// whole colo. Swapping them looks like a harmless scanner-absorption win.
const apiNoStore = middlewareSrc.indexOf("if (pathname.startsWith('/api/')) {")
const cache404 = middlewareSrc.indexOf('isGet && response.status === 404')
assert.ok(apiNoStore !== -1, 'middleware must have an /api/ no-store branch')
assert.ok(cache404 !== -1, 'middleware must have a 404 edge-cache branch')
assert.ok(apiNoStore < cache404, 'the /api/ no-store branch must rank above the 404 edge-cache branch')
assert.equal(referrerHost('not a url', 'apanjwani0.com'), null)

assert.equal(looksAutomated('Mozilla/5.0 (Macintosh) Chrome/120'), false)
assert.equal(looksAutomated('Googlebot/2.1'), true)
assert.equal(looksAutomated('curl/8.4.0'), true)
assert.equal(looksAutomated(null), true, 'no user agent is not a browser')

// Retention actually drops old days rather than growing the file forever.
const now = new Date('2026-08-15T00:00:00Z')
const old = new Date(now.getTime() - 200 * 86_400_000).toISOString().slice(0, 10)
assert.deepEqual(Object.keys(pruneVisits({ [old]: {}, '2026-08-15': {} }, now)), ['2026-08-15'])

// recordVisit must not throw on the request hot path — including on inherited
// object names, which are reachable as referrer hosts ('constructor' is a valid
// hostname) and via a hand-crafted cf-ipcountry on the direct-origin path.
recordVisit({ path: '/tools/json-tidy', country: 'IN', referrer: null, bot: false }, now)
recordVisit({ path: '/tools/json-tidy', country: 'IN', referrer: 'news.ycombinator.com', bot: true }, now)
recordVisit({ path: '/tools/json-tidy', country: 'XX', referrer: 'constructor', bot: false }, now)
recordVisit({ path: '/tools/json-tidy', country: 'XX', referrer: '__proto__', bot: false }, now)

// ── Type Trial daily leaderboard — a public, unauthenticated write endpoint ──
// Display names render on every visitor's screen, so control/zero-width/bidi
// characters (spoofing neighbours, hiding payload) must be stripped, whitespace
// collapsed, and length capped server-side — the client's maxlength is UX only.
assert.equal(sanitizeName('  swift   fox  '), 'swift fox')
assert.equal(sanitizeName('a\u0000b\u200Bc\u202Ed'), 'abcd', 'control/zero-width/bidi chars are stripped')
assert.equal(sanitizeName('x'), null, 'too-short names are rejected')
assert.equal(sanitizeName(42), null)
assert.equal((sanitizeName('n'.repeat(500)) ?? '').length <= DAILY_NAME_MAX, true, 'names are length-capped')

// Scores must be arithmetically possible for the day's passage: the claimed wpm
// cannot exceed a perfect run of that text in the claimed seconds, and every
// number must sit in range — otherwise the board is a forgery free-for-all.
const passageLen = dailyPassage(todayUtcDay()).length
assert.equal(isPlausibleScore({ wpm: 60, acc: 97, sec: (passageLen / 5 / 60) * 60 }, passageLen), true)
assert.equal(isPlausibleScore({ wpm: DAILY_WPM_CAP + 1, acc: 100, sec: 2 }, passageLen), false, 'wpm above the human cap is rejected')
assert.equal(isPlausibleScore({ wpm: 200, acc: 100, sec: 60 }, passageLen), false, 'wpm impossible for the passage length/time is rejected')
assert.equal(isPlausibleScore({ wpm: 60, acc: 100, sec: 0.2 }, passageLen), false, 'sub-second runs are rejected')
assert.equal(isPlausibleScore({ wpm: 60.5, acc: 97, sec: 20 }, passageLen), false, 'non-integer wpm is rejected')
assert.equal(isPlausibleScore({ wpm: 60, acc: 101, sec: 20 }, passageLen), false)
// A finish means the whole passage was typed, so wpm is a FUNCTION of sec — a
// one-sided "not faster than perfect" test is vacuous, because shrinking the
// claimed sec raises its ceiling without limit. This pair got through that test.
assert.equal(
  isPlausibleScore({ wpm: DAILY_WPM_CAP - 1, acc: 100, sec: 2 }, passageLen),
  false,
  'wpm/sec pairs that disagree are rejected, not just wpm above the perfect-run ceiling',
)
// The honest floor that leaves: a forger must claim a time a cap-speed typist
// would need, and no less.
const capSec = (passageLen / 5) / (DAILY_WPM_CAP / 60)
assert.equal(isPlausibleScore({ wpm: DAILY_WPM_CAP, acc: 100, sec: capSec }, passageLen), true)
assert.equal(isPlausibleScore({ wpm: DAILY_WPM_CAP, acc: 100, sec: capSec / 2 }, passageLen), false)

// Retention drops old boards rather than growing the file forever, and the
// per-day cap is a real constant the store trims to.
const lbNow = new Date('2026-08-15T00:00:00Z')
const lbOld = new Date(lbNow.getTime() - 30 * 86_400_000).toISOString().slice(0, 10)
assert.deepEqual(Object.keys(pruneBoard({ [lbOld]: [], '2026-08-15': [] }, lbNow)), ['2026-08-15'])
assert.ok(DAILY_MAX_ENTRIES_PER_DAY <= 200, 'per-day entry cap stays bounded')

// ---------------------------------------------------------------------------
// Learnings: one predicate, and every consumer reads it.
//
// The section embeds live game components inside articles and renders
// author-controlled markdown, so it crosses two trust boundaries the rest of the
// site already guards. These assert both, plus the indexing agreement that
// AGENTS.md requires of every kind of page.

const draft = { published: false, content: 'written but not shipped' }
const hollow = { published: true, content: '   ' }
const real = { published: true, content: 'body' }

assert.equal(isPublishedLearning(real), true)
assert.equal(isPublishedLearning(draft), false, 'an unpublished learning is not a page')
assert.equal(
  isPublishedLearning(hollow),
  false,
  'published-with-empty-body is the case the flag alone cannot express: it would be sitemapped and carry a card while rendering nothing',
)

// Share-card eligibility IS the indexable predicate. Three signals that disagree
// are worse than any one missing — a crawler resolves the conflict by trusting
// none of them.
for (const l of [draft, hollow, real]) {
  assert.equal(learningHasOgCard(l), isPublishedLearning(l), 'card eligibility tracks the predicate')
}

// An unrecognised embed degrades to a prose article rather than throwing, and a
// prototype key must not resolve to an inherited function (the Object.hasOwn
// guard, same trap isPlayableGame closes).
assert.equal(learningEmbedTag({ embed: 'game-of-life' }), EMBED_TAGS['game-of-life'])
assert.equal(learningEmbedTag({ embed: 'not-a-real-game' }), undefined)
assert.equal(learningEmbedTag({ embed: 'constructor' }), undefined, 'prototype keys are not embeds')
assert.equal(learningEmbedTag({ embed: 'toString' }), undefined)
assert.equal(learningEmbedTag({}), undefined)

// Every shipped article's embed really is wired. A typo here costs the
// simulation silently — the article still renders, so nothing else catches it.
for (const l of learnings) {
  if (l.embed === undefined) continue
  assert.ok(
    Object.hasOwn(EMBED_TAGS, l.embed),
    `learning "${l.slug}" embeds "${l.embed}", which is not in EMBED_TAGS`,
  )
}

// ---------------------------------------------------------------------------
// The embeds/games split.
//
// "Is wired to a component" and "is a game" were one question until the six
// generative engines moved out of /games into Driftfield and the articles.
// Collapsing them back would either empty every article embed or resurrect six
// pages that no longer exist, and both failures are silent.

// GAME_TAGS is a strict subset of EMBED_TAGS, and agrees with it on every tag.
for (const [slug, tag] of Object.entries(GAME_TAGS)) {
  assert.ok(Object.hasOwn(EMBED_TAGS, slug), `game "${slug}" is missing from EMBED_TAGS`)
  assert.equal(tag, EMBED_TAGS[slug], `game "${slug}" resolves to two different tags`)
}
assert.ok(
  Object.keys(EMBED_TAGS).length > Object.keys(GAME_TAGS).length,
  'EMBED_TAGS is the wider list — if these are equal the split has been collapsed',
)

// Every Driftfield mode mounts a real component, and none of them is still a
// game: a slug in both lists would be served by /games AND redirected away
// from it, and only one of those can win.
for (const mode of DRIFTFIELD_MODES) {
  assert.ok(Object.hasOwn(EMBED_TAGS, mode.slug), `driftfield mode "${mode.slug}" has no component`)
  assert.equal(Object.hasOwn(GAME_TAGS, mode.slug), false, `driftfield mode "${mode.slug}" is still a game`)
}

// Nothing that moved is still served under /games, and nothing redirects to a
// page that is not there. A redirect to a 404 is worse than the old page.
for (const [from, to] of Object.entries(MOVED_GAMES)) {
  assert.equal(Object.hasOwn(GAME_TAGS, from), false, `"${from}" redirects away but is still a game`)
  assert.equal(games.some(g => g.slug === from), false, `"${from}" redirects away but is still in the games config`)
  const isMode = DRIFTFIELD_MODES.some(m => to === `/tools/driftfield/${m.slug}`)
  const isLearning = learnings.some(l => to === `/learnings/${l.slug}` && isPublishedLearning(l))
  // A game is a valid target too: `poker` was replaced by `poker-trainer` rather
  // than moved out of /games, which is a case this list did not have until then.
  // Still checked against isPlayableGame — a redirect to a "coming soon" page is
  // the same broken promise as a redirect to a 404.
  const isGame = games.some(g => to === `/games/${g.slug}` && isPlayableGame(g))
  // …and a live tool. Game of Life lost its article and now lands on the
  // generative-art hub; `status === 'live'` keeps the "must actually exist and be
  // indexable" guarantee that makes this assertion worth having.
  const isTool = tools.some(t => to === `/tools/${t.slug}` && t.status === 'live')
  assert.ok(isMode || isLearning || isGame || isTool, `"${from}" redirects to ${to}, which is not a published page`)
}

// The same rule one link out. A game, tool or Driftfield mode links the article
// that tells its story, and that link is DERIVED from the article's own `embed`
// rather than stored beside the component — six modes once carried a `learning`
// slug of their own and every one of them 404'd the day those articles were
// deleted. So the property to hold is that the reverse lookup only ever yields
// published articles, which is what each caller renders a link to.
for (const embed of [...Object.keys(EMBED_TAGS), 'not-an-embed']) {
  for (const article of learningsAboutEmbed(embed, learnings)) {
    assert.equal(article.embed, embed, `learningsAboutEmbed("${embed}") returned an article about something else`)
    assert.ok(isPublishedLearning(article), `learningsAboutEmbed("${embed}") returned unpublished "${article.slug}"`)
  }
}
// An unpublished article is never linked, however it is unpublished.
for (const drop of [{ published: false }, { content: '' }, { content: '   ' }]) {
  const hidden = learnings.map(l => ({ ...l, ...drop }))
  for (const embed of Object.keys(EMBED_TAGS)) {
    assert.equal(
      learningsAboutEmbed(embed, hidden).length, 0,
      `an article with ${JSON.stringify(drop)} is still linked from "${embed}"`,
    )
  }
}

// A hidden section is hidden in every signal at once. `sections.blogs` is the
// one predicate; nav, footer, sitemap, ItemList and the routes' noindex all read
// it, and the failure this prevents is the section being delisted in one place
// and still advertised in another.
{
  const hidden = { ...site, sections: { ...site.sections, blogs: false } }
  const shown = { ...site, sections: { ...site.sections, blogs: true } }
  assert.equal(isBlogsPublic(hidden), false, 'sections.blogs false means hidden')
  assert.equal(isBlogsPublic(shown), true, 'sections.blogs true means public')
  assert.equal(
    navLinks(hidden).some(i => /^\/blogs(\/|$)/.test(i.href)), false,
    'a hidden blogs section is still in the nav',
  )
  assert.ok(
    navLinks(shown).some(i => /^\/blogs(\/|$)/.test(i.href)),
    'a public blogs section is missing from the nav — the filter is unconditional',
  )
}

// Config validation rejects what the admin form could otherwise save.
assert.equal(validateConfigData('learnings', learnings), true, 'shipped learnings pass their own validator')
assert.equal(validateConfigData('learnings', [{ ...real, slug: '../etc', title: 't', summary: 's', date: 'd' }]), false)
assert.equal(validateConfigData('learnings', [{ slug: 'ok', title: 't', summary: 's', date: 'd', content: 'c' }]), false, 'published is required')
assert.equal(
  validateConfigData('learnings', [{ slug: 'ok', title: 't', summary: 's', date: 'd', content: 'c', published: true, embed: 'a b' }]),
  false,
  'embed is constrained to slug shape, not arbitrary text',
)

// The article body is author-controlled markdown and must go through
// src/lib/markdown.ts, which escapes raw HTML and passes URLs through
// safeMarkdownUrl. Handing it to set:html directly would be an XSS hole that no
// unit test would notice, because the page would still look correct.
const learningRouteSrc = await readFile(new URL('../src/pages/learnings/[slug].astro', import.meta.url), 'utf-8')
// The content is split on {{embed}} and each half rendered, so this asserts the
// PROPERTY (nothing reaches set:html without passing through render) rather than
// one call spelling — an earlier version pinned the exact string `render(
// learning.content)` and broke the moment the placement marker was added, which
// is a test failing for a reason that has nothing to do with the invariant.
assert.ok(
  learningRouteSrc.includes('splitOnEmbeds(learning.content)'),
  'learning content is split for embed placement',
)
assert.ok(
  /render\(seg\.markdown\)/.test(learningRouteSrc),
  'every segment between two figures is rendered through markdown.ts — with N figures there is no '
  + 'fixed number of halves, so the guard is that the segment content is what render() is given',
)
// Whatever gets handed to set:html must be a *Html variable, i.e. the output of
// render() — never a config field.
for (const [, expr] of learningRouteSrc.matchAll(/set:html=\{([^}]+)\}/g)) {
  assert.ok(
    /Html$|Json$|^ldJson$|^breadcrumbLd$/.test(expr.trim()),
    `set:html={${expr.trim()}} — only rendered/serialized values may reach set:html`,
  )
}

// ---------------------------------------------------------------------------
// Token Bench: the tool's entire claim is that it tells you whether a signature
// holds, so "verified" has to be load-bearing. These run real Web Crypto.

// RFC 7515 A.1 — the canonical HS256 example and its key.
const RFC_JWT = 'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9'
  + '.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ'
  + '.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const RFC_KEY = JSON.stringify({
  kty: 'oct',
  k: 'AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow',
})

const rfc = parseJwt(RFC_JWT)
assert.equal(await verifyJwt(rfc, 'HS256', RFC_KEY), true, 'the RFC 7515 A.1 vector verifies')

// Tampering with the payload must break it — this is the property the whole
// tool sells, and it is the one a subtly wrong signing-input would silently lose.
const b64url = obj => Buffer.from(JSON.stringify(obj)).toString('base64url')
const tampered = parseJwt(`${RFC_JWT.split('.')[0]}.${b64url({ iss: 'attacker' })}.${RFC_JWT.split('.')[2]}`)
assert.equal(await verifyJwt(tampered, 'HS256', RFC_KEY), false, 'a tampered payload does not verify')

// Wrong key, same token.
const wrongKey = JSON.stringify({ kty: 'oct', k: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })
assert.equal(await verifyJwt(rfc, 'HS256', wrongKey), false, 'a wrong key does not verify')

// `alg: none` is never "verified". Accepting it was a real, widespread library
// vulnerability, and the whole point of the tool is to not repeat it.
const noneToken = parseJwt(`${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: 'admin' })}.`)
assert.equal(isUnsigned(noneToken), true, 'alg:none is reported unsigned')
assert.equal(await verifyJwt(noneToken, 'HS256', RFC_KEY), false, 'alg:none never verifies')

// A signed token whose header merely SAYS none is still unsigned to us — the
// header is attacker-controlled, so it can only ever remove trust, never add it.
const lyingHeader = parseJwt(`${b64url({ alg: 'none' })}.${b64url({ sub: 'x' })}.${RFC_JWT.split('.')[2]}`)
assert.equal(await verifyJwt(lyingHeader, 'HS256', RFC_KEY), false)

// Malformed input throws with a message rather than resolving to anything.
assert.throws(() => parseJwt('not-a-jwt'), /three dot-separated parts/)
assert.throws(() => parseJwt('a.b.c'), /not valid base64url/)

// Signature validity and expiry stay separate answers. Merging them is how an
// expired token gets accepted, and the RFC vector is itself long expired — so
// it verifies AND is expired at the same time, which is the point.
const rfcTime = checkTimeClaims(rfc.payload)
assert.equal(rfcTime.expired, true, 'the RFC vector is expired, and says so independently of the signature')
assert.equal(checkTimeClaims({ exp: 4102444800 }).expired, false)
assert.equal(checkTimeClaims({ nbf: 4102444800 }).notYetValid, true)
assert.equal(checkTimeClaims({}).notes.length, 0)

// ES512 is P-521, not P-512 — an easy and silent mis-mapping.
assert.equal(algParams('ES512').importAlgo.namedCurve, 'P-521')
assert.equal(algParams('ES256').importAlgo.namedCurve, 'P-256')
// RFC 7518 §3.5: PSS salt length equals the hash length in bytes.
assert.equal(algParams('PS256').verifyAlgo.saltLength, 32)
assert.equal(algParams('PS512').verifyAlgo.saltLength, 64)
assert.equal(isJwtAlg('none'), false, 'none is not a verifiable algorithm')
assert.equal(isJwtAlg('HS256'), true)

// ---------------------------------------------------------------------------
// Webhook Inspector: signature verification.
//
// The same two failure modes as the JWT block above, because this is the same
// kind of thing — a verifier. It lies by taking its algorithm from the message
// it is checking, or by collapsing "correctly signed" and "still fresh" into one
// boolean. Expected digests below come from node:crypto, deliberately NOT from
// the module under test, so no assertion can pass by the code agreeing with
// itself.

const wiSecret = 'whsec_top_secret'
const wiBody = '{"id":"evt_1","amount":1200}'
const wiKey = wiDecodeSecret(wiSecret, 'utf-8')
const wiHex = (payload, algo = 'sha256', secret = wiSecret) =>
  createHmac(algo, secret).update(payload).digest('hex')
const wiB64 = (payload, secret = wiSecret) =>
  createHmac('sha256', secret).update(payload).digest('base64')

// Stripe signs `timestamp.rawBody`. Hashing the body on its own is the usual
// implementation bug, so the payload the scheme builds is itself an assertion.
const wiNow = Math.floor(Date.now() / 1000)
const wiStripe = wiDetectScheme(
  [{ name: 'Stripe-Signature', value: `t=${wiNow},v1=${wiHex(`${wiNow}.${wiBody}`)}` }],
  wiBody,
)
assert.equal(wiStripe.id, 'stripe')
assert.equal(wiStripe.payload, `${wiNow}.${wiBody}`, 'Stripe signs timestamp.body, not body')
const wiStripeResult = await wiVerifyScheme(wiStripe, wiKey)
assert.equal(wiStripeResult.signature, 'match')
assert.equal(wiStripeResult.freshness, 'fresh')

// Freshness is a separate answer. An hour-old delivery is stale, not forged —
// merging the two is how someone widens a replay window to clear a red badge.
const wiOld = wiNow - 3600
const wiStale = await wiVerifyScheme(
  wiDetectScheme([{ name: 'stripe-signature', value: `t=${wiOld},v1=${wiHex(`${wiOld}.${wiBody}`)}` }], wiBody),
  wiKey,
)
assert.equal(wiStale.signature, 'match', 'an hour-old delivery is still correctly signed')
assert.equal(wiStale.freshness, 'stale', 'and independently, outside the replay window')

// Stripe's retired v0 scheme is not a signature this checks, so a sender cannot
// offer one instead of a v1 and have it counted.
assert.deepEqual(
  wiDetectScheme([{ name: 'stripe-signature', value: `t=${wiNow},v0=${wiHex(`${wiNow}.${wiBody}`)}` }], wiBody).provided,
  [],
  'Stripe v0 digests are retired and are never checked',
)

// The algorithm comes from the header NAME, never from the label inside the
// value. This is webhook-shaped algorithm confusion: a value labelled `sha1=`
// under `x-hub-signature-256` must not get checked as SHA-1.
const wiLying = wiDetectScheme([{ name: 'x-hub-signature-256', value: `sha1=${wiHex(wiBody, 'sha1')}` }], wiBody)
assert.equal(wiLying.hash, 'SHA-256', 'the header name fixes the hash')
assert.ok(wiLying.warning, 'the disagreement is reported, not obeyed')
assert.equal((await wiVerifyScheme(wiLying, wiKey)).signature, 'mismatch')

const wiGithub = wiDetectScheme([{ name: 'x-hub-signature-256', value: `sha256=${wiHex(wiBody)}` }], wiBody)
assert.equal((await wiVerifyScheme(wiGithub, wiKey)).signature, 'match')
assert.equal(wiGithub.toleranceSec, 0, 'GitHub signs no timestamp, so there is nothing to age against')
assert.equal(
  (await wiVerifyScheme(wiGithub, wiDecodeSecret('not-the-secret', 'utf-8'))).signature,
  'mismatch',
)

// Both GitHub headers present: the modern one wins, so a sender cannot get the
// check downgraded to SHA-1 by also sending the deprecated header.
assert.equal(
  wiDetectScheme([
    { name: 'x-hub-signature', value: `sha1=${wiHex(wiBody, 'sha1')}` },
    { name: 'x-hub-signature-256', value: `sha256=${wiHex(wiBody)}` },
  ], wiBody).hash,
  'SHA-256',
)

const wiSlack = wiDetectScheme([
  { name: 'x-slack-signature', value: `v0=${wiHex(`v0:${wiNow}:${wiBody}`)}` },
  { name: 'x-slack-request-timestamp', value: String(wiNow) },
], wiBody)
assert.equal(wiSlack.payload, `v0:${wiNow}:${wiBody}`, 'Slack signs v0:timestamp:body')
assert.equal((await wiVerifyScheme(wiSlack, wiKey)).signature, 'match')

// Shopify sends base64. Comparing a hex digest against it fails for every
// correct secret, which is the single most common Shopify support question.
const wiShopify = wiDetectScheme([{ name: 'x-shopify-hmac-sha256', value: wiB64(wiBody) }], wiBody)
assert.equal(wiShopify.encoding, 'base64')
assert.equal((await wiVerifyScheme(wiShopify, wiKey)).signature, 'match')

// A hex- or base64-published key must be DECODED before use. Signing with the
// printable form is a silent, permanent mismatch that looks like a wrong secret.
assert.deepEqual([...wiDecodeSecret('00ff', 'hex')], [0, 255])
assert.notDeepEqual([...wiDecodeSecret('00ff', 'hex')], [...wiDecodeSecret('00ff', 'utf-8')])
assert.throws(() => wiDecodeSecret('0f0', 'hex'), /valid hex/)
assert.throws(() => wiDecodeSecret('@@@@', 'base64'), /valid base64/)
// Engines disagree about whether a zero-length HMAC key is legal; a verdict must
// not depend on which one the reader is using.
await assert.rejects(wiHmac(new Uint8Array(0), 'SHA-256', 'x'), /empty/)

// Unknown sender: discovery enumerates OUR fixed hash list and reports what
// matched. It can confirm which header holds the signature; it never takes the
// message's word for how it was produced.
const wiFound = await wiDiscoverSignature(
  [{ name: 'X-Vendor-Signature', value: `hmac ${wiHex(wiBody, 'sha512')}` }],
  wiBody,
  wiKey,
)
assert.equal(wiFound.header, 'x-vendor-signature')
assert.equal(wiFound.hash, 'SHA-512')
assert.equal(wiFound.encoding, 'hex')
assert.equal(await wiDiscoverSignature([{ name: 'x-nope', value: 'nothing' }], wiBody, wiKey), null)

// The signing secret is a live production credential, and the only reason it is
// safe to ask for one is that it stays in the reader's tab. The bin id IS
// persisted (it is a URL meant to be reused) — the secret must never be, and the
// two sitting next to each other in the same component is exactly how a later
// edit would give the secret the same treatment by symmetry.
const wiToolSrc = await readFile(
  new URL('../src/components/tools/webhook-inspector/WebhookInspector.ts', import.meta.url),
  'utf-8',
)
const wiLsWrites = [...wiToolSrc.matchAll(/writeLS\(([^)]*)\)/g)].map(m => m[1])
assert.ok(wiLsWrites.length > 0, 'the check below is only meaningful if it found the writeLS calls')
for (const args of wiLsWrites) {
  assert.ok(!/this\.secret\b/.test(args), `a signing secret must never be persisted: writeLS(${args})`)
}
const wiSigSrc = await readFile(
  new URL('../src/components/tools/webhook-inspector/signature.ts', import.meta.url),
  'utf-8',
)
assert.ok(!wiSigSrc.includes('fetch('), 'signature verification stays local — no request may carry the secret')

// ---------------------------------------------------------------------------
// Flowmap: the text→graph parsers, and the share link.
//
// Parsers are where the bugs are, and these fail silently — a dropped edge just
// looks like a diagram you drew slightly wrong.

assert.equal(detectDialect('A --> B'), 'mermaid')
assert.equal(detectDialect('flowchart TD\n  A'), 'mermaid')
assert.equal(detectDialect('- one\n  - two'), 'outline')
assert.equal(detectDialect(''), 'outline', 'an outline has no required syntax, so it is the default')

const mm = parseMermaid('flowchart TD\n  A[Start] --> B(Middle)\n  B -->|yes| C{End}\n  D[Loner]')
assert.deepEqual(mm.nodes.map(n => n.id).sort(), ['A', 'B', 'C', 'D'])
assert.equal(mm.nodes.find(n => n.id === 'B').label, 'Middle')
assert.equal(mm.edges.length, 2)
assert.equal(mm.edges[1].label, 'yes', 'edge labels survive')
// A bare reference must not blank a label declared earlier, which depends
// entirely on line order and so is easy to get backwards.
assert.equal(parseMermaid('A[Named] --> B\nA --> C').nodes.find(n => n.id === 'A').label, 'Named')
// Chained arrows on one line are two edges, not one.
assert.equal(parseMermaid('A --> B --> C').edges.length, 2)
// An unsupported line is skipped, not thrown on — one bad line must not cost
// the other twenty.
assert.equal(parseMermaid('subgraph S\nA --> B\nend\nstyle A fill:#fff').edges.length, 1)

const ol = parseOutline('- root\n  - child\n    - grandchild\n  - sibling\n- second root')
assert.equal(ol.nodes.length, 5)
assert.equal(ol.edges.length, 3, 'two roots means three parent links, not four')
assert.equal(ol.nodes[0].label, 'root', 'list markers are stripped')
assert.equal(ol.nodes[2].label, 'grandchild')
// Tabs and spaces must nest identically, or a tab-indented paste comes out flat.
assert.equal(parseOutline('a\n\tb').edges.length, parseOutline('a\n  b').edges.length)
// Duplicate labels are distinct nodes; collapsing them would silently merge
// two different ideas that happen to be worded the same.
assert.equal(parseOutline('- a\n- a').nodes.length, 2)

// Round-trip: a graph built by hand can leave as Mermaid and come back.
const round = parseMermaid(toMermaid(ol))
assert.equal(round.nodes.length, ol.nodes.length, 'mermaid round-trip keeps every node')
assert.equal(round.edges.length, ol.edges.length, 'mermaid round-trip keeps every edge')
// Including a node with no edges, which a pure edge list would drop.
assert.equal(parseMermaid(toMermaid({ nodes: [{ id: 'x', label: 'alone' }], edges: [] })).nodes.length, 1)

// The share link carries the board, and what comes back out of a URL a stranger
// wrote is re-validated rather than trusted.
const board = { nodes: [{ id: 'a', label: 'héllo · 日本' }], edges: [] }
assert.deepEqual(decodeGraph(encodeGraph(board)), board, 'non-ASCII labels survive the link')
assert.equal(decodeGraph('not-base64!!'), null)
assert.equal(decodeGraph(btoa('{"n":"nope","e":[]}')), null, 'a malformed payload decodes to null, not a crash')
// An edge naming a node that is not in the payload would render as a dangling
// reference, so it is dropped on the way in.
const dangling = encodeGraph({ nodes: [{ id: 'a', label: 'a' }], edges: [{ id: 'e', source: 'a', target: 'ghost' }] })
assert.equal(decodeGraph(dangling).edges.length, 0, 'edges to missing nodes are dropped')

// Node shape reaches a Cytoscape style, and a graph arrives from a `#g=` fragment
// a stranger wrote — so shape is matched against a fixed list on decode, never
// passed through. Same rule as the callout `kind` in markdown.ts: a value that
// picks how it is rendered must come from a vocabulary the code owns.
{
  const shaped = { nodes: [{ id: 'a', label: 'A', shape: 'diamond' }], edges: [] }
  assert.equal(
    decodeGraph(encodeGraph(shaped)).nodes[0].shape, 'diamond',
    'a valid shape survives the share link',
  )
  for (const bad of ['polygon', 'round-rectangle', '"; fill: red; x: "', 42, null, {}, ['diamond']]) {
    const graph = decodeGraph(encodeGraph({ nodes: [{ id: 'a', label: 'A', shape: bad }], edges: [] }))
    assert.ok(graph, `a bad shape must degrade, not reject the whole graph (${JSON.stringify(bad)})`)
    assert.equal(
      graph.nodes[0].shape, undefined,
      `shape ${JSON.stringify(bad)} is not in GRAPH_SHAPES and must be dropped, not rendered`,
    )
  }
  // The renderer maps every shape the model allows; a new name without a mapping
  // would silently draw as the Cytoscape default.
  const flowmapSrc = await readFile(new URL('../src/components/tools/flowmap/Flowmap.ts', import.meta.url), 'utf-8')
  // Scoped to the FM_SHAPE_CY body, not the whole file: a bare `name:` search
  // also matches TR_SHAPE_LABEL, so deleting a renderer mapping still passed.
  const cyMap = flowmapSrc.match(/const FM_SHAPE_CY[^{]*\{([\s\S]*?)\n\}/)
  assert.ok(cyMap, 'FM_SHAPE_CY must still exist — it is what turns a model shape into a drawn one')
  for (const name of GRAPH_SHAPES) {
    assert.ok(
      new RegExp(`\\b${name}:`).test(cyMap[1]),
      `FM_SHAPE_CY must map "${name}" — an unmapped shape falls back to the default silhouette`,
    )
  }
}

// Draftboard's map reads the same parsers. Fenced code is the case that breaks
// it in practice: a shell snippet is full of `#` comments and `-` flags, and
// without blanking the fences every code block becomes a branch of the map.
const doc = [
  '# Title',
  '## Section A',
  'text',
  '```sh',
  '# not a heading',
  '- not a list item',
  '```',
  '### Deep',
  '## Section B',
].join('\n')

const heads = parseHeadings(doc)
assert.deepEqual(heads.nodes.map(n => n.label), ['Title', 'Section A', 'Deep', 'Section B'])
assert.equal(heads.edges.length, 3, 'Deep nests under Section A, both sections under Title')
assert.equal(heads.nodes[0].line, 0, 'nodes carry their source line so the map can navigate')
assert.equal(heads.nodes[3].line, 8, 'line numbers survive the blanked fence')
assert.equal(parseMarkdownOutline(doc).nodes.length, 0, 'the fenced list item is not an outline node')

// A skipped level attaches to the nearest shallower heading rather than being
// dropped — real documents skip levels, and losing those sections silently is
// worse than a slightly flatter tree.
const skipped = parseHeadings('# One\n### Three')
assert.equal(skipped.nodes.length, 2)
assert.equal(skipped.edges.length, 1)
// Setext-style trailing hashes are decoration, not part of the title.
assert.equal(parseHeadings('## Closed ##').nodes[0].label, 'Closed')
// `#hashtag` with no space is not a heading.
assert.equal(parseHeadings('#nospace').nodes.length, 0)

/* ─────────────  interest counter: a corrupt file must not reach a page  ───────────── */

// data/interest.json outlives deploys and can be hand-edited, and its value is
// rendered straight onto a public page. Every row is re-validated on load so a
// bad file degrades to "no votes yet" rather than printing NaN or Infinity.
assert.deepEqual(sanitizeStore(null), {}, 'a missing file is an empty store')
assert.deepEqual(sanitizeStore([1, 2]), {}, 'an array is not a store')
assert.deepEqual(sanitizeStore({ 'flash-cricket': 12 }), { 'flash-cricket': 12 })
assert.deepEqual(sanitizeStore({ 'flash-cricket': -1 }), {}, 'negative counts are dropped')
assert.deepEqual(sanitizeStore({ 'flash-cricket': 1.5 }), {}, 'non-integer counts are dropped')
assert.deepEqual(sanitizeStore({ 'flash-cricket': 'many' }), {}, 'non-numeric counts are dropped')
assert.deepEqual(sanitizeStore({ '../../etc': 3 }), {}, 'a slug that is not a slug is dropped')
assert.deepEqual(
  sanitizeStore({ 'flash-cricket': INTEREST_MAX_COUNT * 10 }),
  { 'flash-cricket': INTEREST_MAX_COUNT },
  'a count above the cap is clamped, not trusted',
)

/* ─────────────  every tool renders the SHARED workbench root  ───────────── */

// Width, side gutter, focus ring and <kbd> styling all hang off
// `div[data-type="tool-page"]` in shared.css. A tool that invents its own root
// silently opts out of all four and visibly does not match the hub — which is
// exactly what token-bench and flowmap did until Aug 2026. Nothing about that
// failure is loud: the tool works, it is just narrower and unfocusable, so it
// survives review and is only caught by looking at two tabs side by side.
const toolDirs = await readdir(new URL('../src/components/tools/', import.meta.url), {
  withFileTypes: true,
})
for (const dir of toolDirs.filter(d => d.isDirectory())) {
  const files = await readdir(new URL(`../src/components/tools/${dir.name}/`, import.meta.url))
  const entries = files.filter(f => f.endsWith('.ts'))
  if (entries.length === 0) continue
  // Every .ts in the folder, concatenated, rather than "the first one readdir
  // handed back": a tool may split a helper module out (draftboard's
  // help-content, webhook-inspector's signature), and readdir order is not
  // sorted on every filesystem — so picking the first would assert against the
  // helper on Linux and the component on macOS.
  const source = (await Promise.all(entries.map(file =>
    readFile(new URL(`../src/components/tools/${dir.name}/${file}`, import.meta.url), 'utf-8'),
  ))).join('\n')
  assert.ok(
    source.includes('data-type="tool-page"'),
    `${dir.name} must render div[data-type="tool-page"] — that is where the shared tool width and focus ring come from`,
  )
  assert.ok(
    source.includes(`data-tool="${dir.name}"`),
    `${dir.name} must tag its root data-tool="${dir.name}" so per-tool rules can target it`,
  )
}

// And no tool may set its own container width — that is the shared rule's job,
// and an override here is invisible until someone compares two tool pages.
for (const dir of toolDirs.filter(d => d.isDirectory())) {
  const files = await readdir(new URL(`../src/components/tools/${dir.name}/`, import.meta.url))
  for (const file of files.filter(f => f.endsWith('.css'))) {
    const css = await readFile(
      new URL(`../src/components/tools/${dir.name}/${file}`, import.meta.url),
      'utf-8',
    )
    const rootWidthRule = new RegExp(
      `\\[data-tool=["']${dir.name}["']\\][^{]*\\{[^}]*max-width`,
    )
    assert.ok(
      !rootWidthRule.test(css),
      `${dir.name}/${file} sets a max-width on its own root — remove it; shared.css owns tool width`,
    )
  }
}

{
  const poker = await import('../src/components/games/poker-trainer/engine/equity.ts')

  /* These assertions began life pinned to the pot-odds article, which quoted
     the four break-even prices in its prose. That article was retired on
     2026-09-25 and the prose half of the block went with it — but the ENGINE
     half is what actually earned its place, so it stays and is now asserted
     against the drill alone.

     The lesson the article recorded is kept here rather than in the prose,
     because it is the reason the bisection below exists: the drill, the
     article and the first version of this test all computed `B / (P + B)` and
     agreed with each other, and all three were wrong. The equity a call needs
     is `B / (P + 2B)` — your own call joins the pot you are winning a share
     of. Recomputing a remembered fraction "independently" reproduces the
     mistake, so the break-even is derived from `EV(call) = 0` instead. */
  const ptSrc = await readFile(
    new URL('../src/components/games/poker-trainer/PokerTrainer.ts', import.meta.url),
    'utf-8',
  )

  // An independent C(n,k) — multiplicative, integer-exact at these sizes, and
  // deliberately not the engine's `combinations()`, which it is about to check.
  const choose = (n, k) => {
    if (k < 0 || k > n) return 0
    let out = 1
    for (let i = 1; i <= k; i++) out = (out * (n - k + i)) / i
    return Math.round(out)
  }

  // Runouts. Two known hold'em hands leave 48 unseen cards and 5 board cards to
  // come; a flop leaves 45 and 2; a turn leaves 44 and 1.
  const preflop = choose(48, 5)
  const flop = choose(45, 2)
  const turn = choose(44, 1)
  assert.equal(preflop, 1712304, 'C(48,5) is 1,712,304 — if this fails, the binomial above is wrong')
  assert.equal(flop, 990)
  assert.equal(turn, 44)

  const card = (r, s) => ({ r, s })
  const hero = [card(14, 's'), card(13, 'd')]
  const villain = [card(12, 'c'), card(12, 'h')]
  const board3 = [card(9, 's'), card(4, 'd'), card(2, 'c')]
  assert.equal(poker.countRunouts([hero, villain], []), preflop, 'engine agrees on the pre-flop count')
  assert.equal(poker.countRunouts([hero, villain], board3), flop, 'engine agrees on the flop count')
  assert.equal(poker.countRunouts([hero, villain], [...board3, card(7, 'h')]), turn, 'engine agrees on the turn count')

  // The board counts above are the ARTICLE's and stay here. The trainer's own
  // ceiling used to be read at this point as `PT_MAX_RUNOUTS < preflop` ("the
  // trainer refuses pre-flop"); it is no longer a count of boards at all, because
  // counting boards reads Omaha as cheaper than Hold'em when it is twenty times
  // dearer. What that assertion became — the ceiling in five-card reads, and the
  // memo that makes paying it once per spot instead of once per keystroke
  // possible — is the appended `Poker Trainer: the solve memo` block at the end
  // of this file.

  // The four prices. `pot` and `sizes` are the drill's, pinned from source —
  // every price below is a function of these two literals and nothing else.
  const potMatch = ptSrc.match(/const pot = (\d+)\n/)
  const sizesMatch = ptSrc.match(/const sizes = \[([\d, ]+)\]/)
  assert.ok(potMatch, 'the drill no longer declares `const pot = …`')
  assert.ok(sizesMatch, 'the drill no longer declares `const sizes = [...]`')
  const drillPot = Number(potMatch[1])
  const drillSizes = sizesMatch[1].split(',').map(n => Number(n.trim()))
  assert.deepEqual(drillSizes, [33, 50, 66, 100], 'the drill offers one price per bet size')
  assert.equal(drillPot, 100, 'the drill builds a pot of 100')

  // Derived from EV = 0 by bisection — NOT from a written-down fraction.
  //
  // The previous version of this block recomputed `bet / (pot + bet)` "independently"
  // and asserted the article against it. Independent of the source, yes; independent
  // of the error, no — the author had the wrong identity in mind, so the prose, the
  // drill and this assertion all agreed and all three were wrong. `pot` here is the
  // pot BEFORE the bet, so a caller risks `bet` to win `pot + bet` and the pot being
  // shared is `pot + 2 * bet`. Bisecting the EV of calling cannot inherit a
  // misremembered formula, which is the only reason this is trustworthy.
  const breakeven = (pot, bet) => {
    const ev = p => p * (pot + bet) - (1 - p) * bet
    let lo = 0
    let hi = 1
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2
      if (ev(mid) < 0) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  }
  const prices = drillSizes.map(bet => `${(breakeven(drillPot, bet) * 100).toFixed(1)}%`)
  assert.deepEqual(prices, ['19.9%', '25.0%', '28.4%', '33.3%'], 'the break-even call price at the four sizes')

  // requiredEquity()'s own contract: its first argument is the pot before the CALL.
  for (const bet of drillSizes) {
    assert.ok(
      Math.abs(poker.requiredEquity(drillPot + bet, bet) - breakeven(drillPot, bet)) < 1e-12,
      'requiredEquity(potBeforeCall, bet) must equal the EV-derived break-even',
    )
  }

  // And the drill must hand it the pot before the call, not the pot before the bet.
  // This is the line that was wrong; assert the line, not just the helper.
  assert.ok(
    ptSrc.includes('requiredEquity(d.pot + d.bet, d.bet)') &&
      ptSrc.includes('callEv(d.pot + d.bet, d.bet, result.equity)'),
    'the drill must add the villain bet before pricing the call — d.pot alone prices a bluff, not a call',
  )

  // The two fractions must stay separate numbers. Collapsing them back into one
  // is the original bug, so the relation between them is pinned directly.
  for (const bet of drillSizes) {
    const foldShare = bet / (drillPot + bet)
    assert.ok(
      foldShare > breakeven(drillPot, bet),
      'the share you may fold must stay strictly above the equity a call needs',
    )
  }
  // One decimal place, because that is how the drill prints them; a formatter
  // change would silently restate every price.
  assert.match(ptSrc, /const pct = \(n: number\) => `\$\{\(n \* 100\)\.toFixed\(1\)\}%`/, 'the drill still prints one decimal')

  // Combination counts, enumerated here from four suits rather than trusted.
  const suits = ['c', 'd', 'h', 's']
  let pairCombos = 0
  for (let i = 0; i < suits.length; i++) for (let j = i + 1; j < suits.length; j++) pairCombos++
  let suitedCombos = 0
  let offsuitCombos = 0
  for (const a of suits) for (const b of suits) (a === b ? suitedCombos++ : offsuitCombos++)
  assert.deepEqual([pairCombos, suitedCombos, offsuitCombos], [6, 4, 12])
  assert.equal(poker.classCombos('AA').length, pairCombos, 'engine agrees a pair is 6 combos')
  assert.equal(poker.classCombos('AKs').length, suitedCombos, 'engine agrees a suited hand is 4 combos')
  assert.equal(poker.classCombos('AKo').length, offsuitCombos, 'engine agrees an offsuit hand is 12 combos')
  assert.equal(suitedCombos + offsuitCombos, 16, 'ace-king arrives sixteen ways')

  // The blocker line: hold one ace and their aces drop from 6 combos to C(3,2).
  const blockedAces = poker.classCombos('AA')
    .filter(combo => !combo.some(c => c.r === 14 && c.s === 's'))
  assert.equal(blockedAces.length, choose(3, 2), 'one ace in your hand leaves C(3,2) = 3 of theirs')
  assert.equal(blockedAces.length, 3)
  // The drill's own controls and readouts. Kept after the article that pointed
  // at them was retired: the pricing assertions above are only meaningful while
  // a reader can still reach the row that displays the number.
  for (const label of [
    'Play a spot',
    'Equity you needed to call',
  ]) {
    assert.ok(ptSrc.includes(label), `PokerTrainer.ts must still render "${label}"`)
  }
}

/* ─────────────  the sitemap is well-formed and lists only our pages  ───────────── */

// Two guarantees, both asserted by driving the REAL route with synthetic config
// rather than by reading its source. `getKV()` reads `locals.runtime.env.SITE_CONFIG`,
// so a stub store feeds the route whatever a future /admin save could feed it.
//
// Escaping fails closed on the whole site, not on one URL: a bare `&` anywhere in a
// slug makes the entire document unparseable, so every page loses its sitemap entry,
// not just the bad one. And the external-post filter has no natural test data —
// src/config/blogs.ts contains no cross-posted entry today, so without a synthetic
// one the guard added in e558de6 could be reverted with nothing going red.
{
  const { GET } = await import('../src/pages/sitemap.xml.ts')
  // These pass validateConfigData: safeInternalPath rejects only control characters
  // and whitespace, so `&` and `<` in a slug are accepted config and reach <loc>.
  const posts = [
    { title: 'Local', href: '/blogs/a-local-post', date: '2026-01-01', summary: 's' },
    { title: 'Ampersand', href: '/blogs/tabs-&-spaces', date: '2026-01-02', summary: 's' },
    { title: 'Angle', href: '/blogs/a<b', date: '2026-01-03', summary: 's' },
    { title: 'Cross-posted', href: 'https://example.com/elsewhere', date: '2026-01-04', summary: 's' },
  ]
  // Blogs ship hidden (`sections.blogs`), and a hidden section emits no <loc> at
  // all — so this fixture must turn the section back ON or the escaping guard
  // below would pass by having nothing to escape. Hiding a section must not
  // quietly retire the test that keeps the sitemap parseable.
  const withBlogs = { ...site, sections: { ...site.sections, blogs: true } }
  const envFor = s => ({
    runtime: {
      env: {
        SITE_CONFIG: {
          get: async key => (key === 'blogs' ? posts : key === 'site' ? s : null),
        },
      },
    },
  })
  const body = await (await GET({ locals: envFor(withBlogs) })).text()

  // …and with the flag as shipped, none of those URLs are in the document.
  const hiddenBody = await (
    await GET({ locals: envFor({ ...site, sections: { ...site.sections, blogs: false } }) })
  ).text()
  assert.ok(!hiddenBody.includes('/blogs'), 'a hidden blogs section still appears in the sitemap')
  assert.ok(hiddenBody.includes('/tools/'), 'the hidden-blogs sitemap lost everything, not just blogs')

  assert.ok(
    body.includes('/blogs/tabs-&amp;-spaces'),
    'a slug containing & must be escaped in <loc>, not emitted raw',
  )
  assert.ok(
    !/&(?!(amp|lt|gt|quot|#\d+);)/.test(body),
    'the sitemap must contain no unescaped ampersand — one makes the whole document unparseable',
  )
  assert.ok(
    body.includes('/blogs/a&lt;b'),
    'a slug containing < must be escaped in <loc> — raw, it opens a bogus element',
  )
  for (const external of ['example.com/elsewhere']) {
    assert.ok(
      !body.includes(external),
      `an external post must not be sitemapped (${external}) — that page is not ours to claim`,
    )
  }
  assert.ok(
    !body.includes('/blogs/https'),
    'an external href must be skipped, never normalised into a bogus /blogs/https:… entry',
  )
  assert.ok(body.includes('/blogs/a-local-post'), 'a local post must still be sitemapped')
}

/* ─────────────  Cron Whisperer is right about daylight saving  ───────────── */

// Cron Whisperer now claims, on screen and in its SEO copy, that it knows what
// a scheduler does when a wall-clock reading either does not exist or happens
// twice. That claim is only worth making if it is checked against the real tz
// database, so these run the engine, not the prose.
//
// The rule being asserted is Vixie cron's, from `man 8 cron`: a job counts as
// running "at a particular time" only when NEITHER the hour nor the minute
// field contains a `*`. Those jobs are made up once after a forward jump and
// are not repeated after a backward one; every other schedule just follows the
// new wall clock. Getting that backwards is silent — the tool still renders, the
// build stays green, and only the numbers are wrong.
//
// Expected instants are written as UTC, which is the one frame that cannot
// itself be wrong, and the transitions are the real US ones: 2027-03-14T07:00Z
// (02:00 EST → 03:00 EDT) and 2026-11-01T06:00Z (02:00 EDT → 01:00 EST).

const cwNY = 'America/New_York'
const cwAt = iso => Date.parse(iso)
const cwRunsFor = (expr, zone, fromIso, count, untilIso) => {
  const clock = new CwZoneClock(zone, cwAt(fromIso))
  return cwCollectRuns(
    cwParse(expr),
    cwAt(fromIso),
    untilIso ? { count, untilMs: cwAt(untilIso) } : { count },
    clock,
  )
}

// A zone the engine cannot resolve must be refused rather than silently treated
// as UTC — the zone id can arrive from a shared #tz= fragment.
assert.ok(cwZoneValid('local') && cwZoneValid('UTC') && cwZoneValid(cwNY))
assert.ok(!cwZoneValid('Mars/Olympus_Mons'), 'an unknown zone is not a zone')
assert.ok(!cwZoneValid('../../etc/passwd'), 'a path is not a zone')

// The Vixie predicate itself: a `*` anywhere in hour or minute makes the job a
// wildcard job, however specific the rest of the line looks.
assert.equal(cwIsFixedTime(cwParse('30 2 * * *')), true)
assert.equal(cwIsFixedTime(cwParse('0,30 2-4 * * 1-5')), true, 'lists and ranges are still a particular time')
assert.equal(cwIsFixedTime(cwParse('*/30 2 * * *')), false, 'a step minute is a wildcard minute')
assert.equal(cwIsFixedTime(cwParse('30 */2 * * *')), false, 'a step hour is a wildcard hour')

// ── Spring forward: 02:30 does not exist on 2027-03-14 in New York. ──────────
const cwSpringFixed = cwRunsFor('30 2 * * *', cwNY, '2027-03-12T12:00:00Z', 4)
const cwSpringGap = cwSpringFixed.find(r => r.dst === 'gap')
assert.ok(cwSpringGap, '30 2 * * * must hit the New York spring-forward gap')
assert.equal(cwSpringGap.wall.h * 60 + cwSpringGap.wall.mi, 150, 'the reading it asked for is 02:30')
assert.equal(cwSpringGap.fires, true, 'a particular-time job IS made up after the jump')
assert.equal(
  new Date(cwSpringGap.ms).toISOString(),
  '2027-03-14T07:00:00.000Z',
  'and it is made up at the transition instant itself, not at the naive 02:30',
)
// The days either side are ordinary, and their offsets differ — which is the
// whole reason the wall clock and the instant cannot be the same number.
assert.equal(new Date(cwSpringFixed[0].ms).toISOString(), '2027-03-13T07:30:00.000Z')
assert.equal(new Date(cwSpringFixed[2].ms).toISOString(), '2027-03-15T06:30:00.000Z')

// Same gap, wildcard schedule: the runs are lost, not made up.
const cwSpringWild = cwRunsFor('*/30 1-4 * * *', cwNY, '2027-03-14T04:00:00Z', 6)
const cwSpringLost = cwSpringWild.filter(r => r.dst === 'gap')
assert.equal(cwSpringLost.length, 2, '02:00 and 02:30 both fall in the missing hour')
assert.deepEqual(
  cwSpringLost.map(r => r.fires),
  [false, false],
  'a wildcard schedule does not get its skipped runs made up',
)

// ── Fall back: 01:30 happens twice on 2026-11-01 in New York. ───────────────
const cwFallFixed = cwRunsFor('30 1 * * *', cwNY, '2026-10-30T12:00:00Z', 4)
const cwFallDouble = cwFallFixed.filter(r => r.dst === 'first' || r.dst === 'second')
assert.equal(cwFallDouble.length, 1, 'a particular-time job runs ONCE across the repeated hour')
assert.equal(
  new Date(cwFallDouble[0].ms).toISOString(),
  '2026-11-01T05:30:00.000Z',
  'and it runs on the first pass (still EDT), not the second',
)
assert.ok(
  !cwFallFixed.some(r => new Date(r.ms).toISOString() === '2026-11-01T06:30:00.000Z'),
  'the EST repeat of 01:30 must NOT appear for a particular-time job',
)

// Same repeat, wildcard schedule: both passes fire.
const cwFallWild = cwRunsFor('*/30 0-3 * * *', cwNY, '2026-11-01T03:00:00Z', 10)
assert.deepEqual(
  cwFallWild.filter(r => r.dst === 'first' || r.dst === 'second').map(r => new Date(r.ms).toISOString()),
  [
    '2026-11-01T05:00:00.000Z',
    '2026-11-01T05:30:00.000Z',
    '2026-11-01T06:00:00.000Z',
    '2026-11-01T06:30:00.000Z',
  ],
  'a wildcard schedule follows the wall clock through both passes of the repeated hour',
)

// ── The frequency read-out inherits all of this. ────────────────────────────
// A 23-hour day really does have 23 hourly runs and a 25-hour day 25. That is
// the number the "Runs N times in the next 24 hours" line prints. The windows
// below are *local* midnight to local midnight, written in UTC — which is why
// they are not 24 hours apart, and is exactly the arithmetic being asserted.
assert.equal(
  cwFiringCount(cwRunsFor('0 * * * *', cwNY, '2027-03-14T05:00:00Z', 100, '2027-03-15T04:00:00Z')),
  23,
  'the spring-forward day in New York is 23 hours long, so an hourly job runs 23 times',
)
assert.equal(
  cwFiringCount(cwRunsFor('0 * * * *', cwNY, '2026-11-01T04:00:00Z', 100, '2026-11-02T05:00:00Z')),
  25,
  'the fall-back day in New York is 25 hours long, so an hourly job runs 25 times',
)
assert.equal(
  cwFiringCount(cwRunsFor('0 * * * *', 'UTC', '2027-03-14T00:00:00Z', 100, '2027-03-15T00:00:00Z')),
  24,
  'UTC has no such days, which is the advice the tool gives',
)

// ── Zones that are not the browser's, and not on the hour. ──────────────────
assert.equal(
  new Date(cwRunsFor('0 9 * * *', 'Asia/Kolkata', '2026-08-18T00:00:00Z', 1)[0].ms).toISOString(),
  '2026-08-18T03:30:00.000Z',
  'a +05:30 zone with no DST resolves on the half hour',
)
const cwLordHowe = new CwZoneClock('Australia/Lord_Howe', cwAt('2026-08-18T00:00:00Z'))
  .transitionsFrom(cwAt('2026-08-18T00:00:00Z'), 1, cwAt('2027-06-01T00:00:00Z'))
assert.equal(cwLordHowe.length, 1)
assert.equal(
  cwLordHowe[0].after - cwLordHowe[0].before,
  30 * 60_000,
  'Lord Howe shifts by half an hour — the engine must not assume every jump is 60 minutes',
)
assert.equal(cwOffsetLabel(cwLordHowe[0].before), 'UTC+10:30')
assert.equal(cwOffsetLabel(cwLordHowe[0].after), 'UTC+11:00')

// A zone that does not observe DST must report nothing rather than guessing.
assert.deepEqual(
  new CwZoneClock('America/Phoenix', cwAt('2026-08-18T00:00:00Z'))
    .transitionsFrom(cwAt('2026-08-18T00:00:00Z'), 4, cwAt('2028-08-18T00:00:00Z')),
  [],
  'Arizona has no offset changes to warn about',
)

const hueComponent = await readFile(
  new URL('../src/components/games/hue-hunt/HueHunt.ts', import.meta.url),
  'utf-8',
)
assert.ok(
  /from ['"]\.\.\/\.\.\/\.\.\/lib\/hue-hunt-daily['"]/.test(hueComponent),
  'HueHunt.ts must import the daily colours from src/lib/hue-hunt-daily — the server scores against that same module',
)
for (const dupe of ['function dailyColors', 'function accuracyPct', 'function hslToRgb', 'function colorDistance']) {
  assert.ok(
    !hueComponent.includes(dupe),
    `HueHunt.ts must not redefine ${dupe} — one copy, shared with the server, or the board disagrees with the game`,
  )
}

// The route never reads a score off the body. This is the whole trust boundary
// in one assertion.
const hueRoute = await readFile(
  new URL('../src/pages/api/games/hue-hunt/daily.ts', import.meta.url),
  'utf-8',
)
assert.ok(
  hueRoute.includes('scoreDailyGuesses(day, p.guesses)'),
  'the hue-hunt route must re-score the submitted guesses against the day IT derived',
)
assert.ok(
  !/\bp\.(score|scores|total|points|pct)\b/.test(hueRoute),
  'the hue-hunt route must never read a score out of the request body — it computes its own',
)
assert.ok(
  hueRoute.includes('const day = hueDayNumber()') && hueRoute.includes('p.day !== day'),
  'the claimed day must be pinned to the current UTC day, so yesterday (whose colours are known) is unplayable',
)
// …and the client must not be sending one either, or the next reader will assume
// the field is load-bearing and wire it up.
const hueBody = hueComponent.match(/body: JSON\.stringify\(\{[^}]*\}\)/)
assert.ok(hueBody, 'HueHunt.ts must POST a JSON body to the board')
assert.ok(
  !/score|total|pct/.test(hueBody[0]),
  'the submitted body carries the day, a name and the raw guesses — never a score',
)

// Behaviour, not just shape: the score really is a function of (day, guesses).
const hueDay = 231
const hueColours = hueDailyColors(hueDay)
assert.equal(hueColours.length, HUE_DAILY_ROUNDS)
const huePerfect = hueColours.map(hueToHex)
assert.equal(scoreDailyGuesses(hueDay, huePerfect).total, HUE_DAILY_MAX, 'exact guesses score the maximum')
// The same guesses against a different day are worth less — which is what makes
// pinning the day to today (rather than trusting the payload's) meaningful: a
// replay of a day whose answers are already known scores as if it were today.
assert.ok(
  scoreDailyGuesses(hueDay + 1, huePerfect).total < HUE_DAILY_MAX,
  "yesterday's answers are not today's answers",
)
// The total needs no bound of its own: it is a sum of HUE_DAILY_ROUNDS values
// each capped at 100 by construction. Unlike Type Trial's wpm/sec pair there is
// no second free field an attacker can move against the first — there is no
// free field at all.
for (const probe of [['#000000'], ['#FFFFFF'], ['#808080'], ['#123'], ['#ABCDEF']]) {
  const filled = Array.from({ length: HUE_DAILY_ROUNDS }, () => probe[0])
  const scored = scoreDailyGuesses(hueDay, filled)
  assert.ok(scored.scores.every(n => Number.isInteger(n) && n >= 0 && n <= 100))
  assert.ok(scored.total >= 0 && scored.total <= HUE_DAILY_MAX)
}

// A partial or malformed run is not a result — it never becomes a row.
assert.equal(scoreDailyGuesses(hueDay, huePerfect.slice(0, 4)), null, 'a short run is rejected')
assert.equal(scoreDailyGuesses(hueDay, [...huePerfect, '#000000']), null, 'a long run is rejected')
assert.equal(scoreDailyGuesses(hueDay, 'not-an-array'), null)
assert.equal(scoreDailyGuesses(hueDay, null), null)
assert.equal(scoreDailyGuesses(hueDay, [1, 2, 3, 4, 5]), null, 'non-strings are rejected')
assert.equal(scoreDailyGuesses(hueDay, Array(HUE_DAILY_ROUNDS).fill('#GGGGGG')), null, 'non-hex is rejected')
assert.equal(
  scoreDailyGuesses(hueDay, Array(HUE_DAILY_ROUNDS).fill(`#${'A'.repeat(4096)}`)),
  null,
  'an oversized guess is rejected by length before anything walks it',
)
assert.ok(HUE_GUESS_MAX_CHARS === 7, 'a guess is at most `#RRGGBB`')

// Day keys are bounded before they ever index the store.
assert.equal(isValidHueDay(hueDay), true)
assert.equal(isValidHueDay(-1), false)
assert.equal(isValidHueDay(1.5), false)
assert.equal(isValidHueDay('231'), false)
assert.equal(isValidHueDay(Number.MAX_SAFE_INTEGER), false)
assert.equal(isValidHueDay(hueDayNumber()), true, 'the day this process derives is itself a valid key')

// One display-name hygiene rule for both boards, not two that can drift apart —
// an abuser would simply pick whichever copy stripped less.
assert.equal(hueSanitizeName, sanitizeName, 'both leaderboards share one name sanitizer')

// Rows read back off disk get the same treatment submitted ones do, so a
// hand-edited file degrades to an empty board rather than parking an impossible
// score at the top of the list forever.
assert.deepEqual(
  hueSanitizeStoredEntry({ name: ' swift  fox ', score: 431, at: 1 }),
  { name: 'swift fox', score: 431, at: 1 },
)
assert.equal(hueSanitizeStoredEntry({ name: 'cheat', score: HUE_DAILY_MAX + 1, at: 1 }), null, 'an out-of-range score is dropped')
assert.equal(hueSanitizeStoredEntry({ name: 'cheat', score: -5, at: 1 }), null)
assert.equal(hueSanitizeStoredEntry({ name: 'x', score: 100, at: 1 }), null, 'a too-short name is dropped')
assert.equal(hueSanitizeStoredEntry({ score: 100, at: 1 }), null)
assert.equal(hueSanitizeStoredEntry(null), null)
assert.ok(
  (hueSanitizeStoredEntry({ name: 'n'.repeat(500), score: 1, at: 1 }).name).length <= HUE_NAME_MAX,
  'names are length-capped on the way in from disk too',
)

// Retention drops old boards rather than growing the file forever. The compare
// must be NUMERIC: these keys are day numbers, and a lexicographic cutoff keeps
// "9" while dropping "10" — which is to say it deletes today's board.
assert.deepEqual(
  Object.keys(pruneHueBoard({ 2: [], 9: [], 10: [] }, 10)).sort(),
  ['10', '9'],
  'retention compares day numbers numerically, not as strings',
)
assert.deepEqual(Object.keys(pruneHueBoard({ 10: [] }, 10, 0)), [], 'zero retention keeps nothing')
assert.ok(HUE_MAX_ENTRIES_PER_DAY <= 200, 'per-day entry cap stays bounded')
assert.ok(HUE_RETAINED_DAYS <= 31, 'retention stays bounded')

// A posted grid has to lead somewhere — without the URL it is a screenshot of a
// game the reader cannot find.
assert.ok(
  /dailyShareText\(\)[\s\S]{0,600}location\.origin/.test(hueComponent),
  'the shared daily grid must carry the site URL',
)

// ── Wall order is not instant order: the fall-back holes ────────────────────
//
// The engine walks WALL readings and returns INSTANTS. Across a fall-back those
// two orders disagree, and every termination decision taken in wall order
// therefore drops runs that the final sort then hides. Four bugs shared that one
// root: the walk started at now's own reading, aborted the whole scan on an
// over-horizon instant, stopped counting in wall order, and the DST panel capped
// a "whole window" query at 400.
//
// Checked against a brute-force scan that steps real UTC minutes and reads the
// wall clock through Intl. It shares nothing with the engine, so the two cannot
// pass by agreeing with each other. That oracle is valid only for NON-fixed-time
// schedules: a fixed-time job follows Vixie's rule instead (once across a repeat,
// made up in a gap), which a literal wall-clock scan cannot express — those cases
// are pinned above.
{
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: cwNY, hour12: false,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', weekday: 'short',
  })
  const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const wallAt = ms => {
    const parts = {}
    for (const { type, value } of fmt.formatToParts(ms)) parts[type] = value
    return { mo: +parts.month, d: +parts.day, h: +parts.hour % 24, mi: +parts.minute, dow: DOW[parts.weekday] }
  }
  const hits = (P, w) => {
    if (!P.month.values.includes(w.mo)) return false
    const domOk = P.dom.values.includes(w.d)
    const dowOk = P.dow.values.includes(w.dow)
    const dayOk = (P.dom.restricted && P.dow.restricted) ? (domOk || dowOk)
      : P.dom.restricted ? domOk : P.dow.restricted ? dowOk : true
    return dayOk && P.hour.values.includes(w.h) && P.minute.values.includes(w.mi)
  }
  const truthNext = (expr, fromMs, n) => {
    const P = cwParse(expr)
    const out = []
    for (let t = Math.floor(fromMs / 60000) * 60000 + 60000; out.length < n; t += 60000) {
      if (hits(P, wallAt(t))) out.push(t)
    }
    return out
  }
  const truthCount = (expr, fromMs, untilMs) => {
    const P = cwParse(expr)
    let n = 0
    for (let t = Math.floor(fromMs / 60000) * 60000 + 60000; t <= untilMs; t += 60000) {
      if (hits(P, wallAt(t))) n++
    }
    return n
  }

  const FALL = cwAt('2026-11-01T06:00:00Z') // 02:00 EDT -> 01:00 EST
  for (const expr of ['*/15 * * * *', '0 * * * *', '*/30 * * * *']) {
    // Start instants either side of, and INSIDE, the repeated hour. The existing
    // fall-back case starts at 04:00Z — an hour before the repeat begins — and so
    // passed on every one of these bugs.
    for (const offMin of [-70, -30, -1, 0, 20, 40, 59, 61, 90]) {
      const from = FALL + offMin * 60000
      for (const count of [1, 3, 5, 8]) {
        const got = cwCollectRuns(cwParse(expr), from, { count }, new CwZoneClock(cwNY, from))
          .filter(r => r.fires).map(r => r.ms)
        assert.deepEqual(
          got, truthNext(expr, from, count),
          `next ${count} runs of "${expr}" from ${new Date(from).toISOString()} must match a wall-clock scan`,
        )
      }
      const until = from + 86400000
      assert.equal(
        cwFiringCount(cwCollectRuns(cwParse(expr), from, { untilMs: until }, new CwZoneClock(cwNY, from))),
        truthCount(expr, from, until),
        `24h run count for "${expr}" from ${new Date(from).toISOString()}`,
      )
    }
  }

  // A 24-hour window whose FAR END lands inside the repeated hour. This is the
  // case the loop above cannot reach — its windows all close a day later, well
  // clear of the transition — and it is the one that broke the "Runs N times in
  // the next 24 hours" line: the second instant of wall 01:00 crossed the horizon
  // and aborted the entire walk, discarding 01:01..01:59's first-pass instants
  // which were still inside it. `* * * * *` reported 1381 where the truth is 1440.
  for (const expr of ['* * * * *', '*/15 * * * *', '*/30 * * * *']) {
    for (const offMin of [-59, -30, -1, 0, 30, 59]) {
      const until = FALL + offMin * 60000
      const from = until - 86400000
      assert.equal(
        cwFiringCount(cwCollectRuns(cwParse(expr), from, { untilMs: until }, new CwZoneClock(cwNY, from))),
        truthCount(expr, from, until),
        `24h count for "${expr}" ending at ${new Date(until).toISOString()}, inside the repeated hour`,
      )
    }
  }

  // The DST panel asks for a whole 12-hour window, so `count` must not quietly
  // bound it. At 400 this reported 51 doubled runs against a real 60, and told the
  // reader a per-second schedule was unaffected by a transition that doubles 3600.
  const W = 6 * 3600000
  const panel = (expr, at) =>
    cwCollectRuns(cwParse(expr), at - W, { untilMs: at + W }, new CwZoneClock(cwNY, at - W))
  assert.equal(panel('* * * * *', FALL).filter(r => r.dst === 'first').length, 60,
    'every minute of the repeated hour is doubled, and the panel must count all 60')
  assert.equal(panel('* * * * * *', FALL).filter(r => r.dst === 'first').length, 3600,
    'the advertised 6-field form must not be silently truncated in the DST window')
  const SPRING = cwAt('2026-03-08T07:00:00Z')
  assert.equal(panel('* * * * * *', SPRING).filter(r => r.dst === 'gap').length, 3600,
    'nor in the spring-forward window')

  // …and the panel's own call site must ask for the window and nothing else. The
  // engine above is correct either way; it was the caller that passed `count: 400`,
  // so asserting only the engine leaves the actual defect free to come back.
  const cwUi = await readFile(new URL('../src/components/tools/cron-whisperer/CronWhisperer.ts', import.meta.url), 'utf-8')
  const dstCall = cwUi.match(/\{\s*(?:count:[^}]*)?untilMs: t\.ms \+ CW_DST_WINDOW_MS\s*\}/)
  assert.ok(dstCall, 'the DST panel must still collect a t.ms ± CW_DST_WINDOW_MS window')
  assert.ok(
    !dstCall[0].includes('count'),
    'the DST panel must not pass a `count` — the 12-hour window is the only bound that belongs there',
  )
}


// ── role: projects ───────────────────────────────────────────────────────────
// The projects page advertises its entries twice: as cards and as an ItemList in
// JSON-LD. When an entry points at this site's own /tools/<slug> or /games/<slug>
// it is making the same promise a hub listing makes, so it has to obey the same
// one predicate the Indexing section defines — `status === 'live'` for a tool,
// isPlayableGame() for a game. Nothing else notices the disagreement: flip a tool
// to `wip` (noindex) or `disabled` (404) and the projects page keeps linking to it
// with a confident description, which is precisely the "signals that contradict
// each other" failure the Indexing rule exists to prevent.
import { projects as smokeProjects } from '../src/config/projects.ts'

const smokeToolBySlug = new Map(tools.map(t => [t.slug, t]))
const smokeGameBySlug = new Map(games.map(g => [g.slug, g]))

for (const p of smokeProjects) {
  const m = /^https:\/\/apanjwani0\.com\/(tools|games)\/([a-z0-9-]+)\/?$/.exec(p.url)
  if (!m) continue
  const [, kind, slug] = m
  if (kind === 'tools') {
    const tool = smokeToolBySlug.get(slug)
    assert.ok(tool, `project "${p.title}" links to /tools/${slug}, which is not a configured tool`)
    assert.equal(
      tool.status,
      'live',
      `project "${p.title}" links to /tools/${slug}, which is "${tool.status}" — a project entry must not advertise a non-indexable page`,
    )
  } else {
    const game = smokeGameBySlug.get(slug)
    assert.ok(game, `project "${p.title}" links to /games/${slug}, which is not a configured game`)
    assert.ok(
      isPlayableGame(game),
      `project "${p.title}" links to /games/${slug}, which is not playable — a project entry must not advertise a non-indexable page`,
    )
  }
}


/* ══════════════  design-ux: ONE disabled treatment, site-wide  ══════════════

   "This control is dead" used to be told seven different ways — opacity 0.4 in
   draftboard, 0.45 in 2048 / json-tidy's panes / the games floor, 0.5 in
   json-tidy's repair button and tree search, 0.6 in both daily-leaderboard
   forms, 0.65 in wallpaper-forge, a bare colour swap in the shared canvas export
   bar, and in the tools lane's shared button chrome nothing at all. That last
   one was the real defect: flowmap's Undo/Redo ship `disabled` and toggle on
   every edit, so they rendered byte-identically to live buttons and lit up on
   hover.

   `--opacity-disabled` in theme.css is now the single value. These assertions
   exist because a token nobody references is decoration, and the next tool to
   hand-roll `opacity: 0.5` would be invisible in review — the page still renders
   and the build stays green. */
{
  const styleUrl = n => new URL(`../src/styles/${n}`, import.meta.url)
  const themeCss = await readFile(styleUrl('theme.css'), 'utf-8')

  assert.ok(
    /--opacity-disabled:\s*[\d.]+\s*;/.test(themeCss),
    'theme.css must define --opacity-disabled — it is the one "this control is dead" value',
  )

  // Collect every stylesheet the site ships: src/styles plus each component sheet.
  const sheets = []
  for (const f of (await readdir(new URL('../src/styles/', import.meta.url))).filter(f => f.endsWith('.css'))) {
    sheets.push([`src/styles/${f}`, await readFile(styleUrl(f), 'utf-8')])
  }
  for (const lane of ['tools', 'games']) {
    const laneUrl = new URL(`../src/components/${lane}/`, import.meta.url)
    for (const e of await readdir(laneUrl, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.css')) {
        sheets.push([`${lane}/${e.name}`, await readFile(new URL(e.name, laneUrl), 'utf-8')])
      }
      if (!e.isDirectory()) continue
      const dirUrl = new URL(`${e.name}/`, laneUrl)
      for (const f of (await readdir(dirUrl)).filter(f => f.endsWith('.css'))) {
        sheets.push([`${lane}/${e.name}/${f}`, await readFile(new URL(f, dirUrl), 'utf-8')])
      }
    }
  }
  assert.ok(sheets.length > 25, `expected the whole stylesheet set, found ${sheets.length}`)

  // No sheet may hand-roll a numeric opacity inside a :disabled rule. Matches the
  // declaration block of any rule whose selector list mentions :disabled, then
  // looks for a literal `opacity:` value that is not a var().
  for (const [name, css] of sheets) {
    for (const m of css.matchAll(/([^{}]*:disabled[^{}]*)\{([^}]*)\}/g)) {
      // Note the lookbehind: without it this matches the tail of a custom
      // property named `--opacity-*`. And the var() test is on the CAPTURE, not
      // a lookahead — `\s*` backtracks to zero width, so `(?!var\()` after it
      // "passes" on the leading space of ` var(...)` and flags correct code.
      const hit = m[2].match(/(?<![\w-])opacity:\s*([^;]+)/)
      const bad = hit && !hit[1].trim().startsWith('var(') ? hit : null
      assert.ok(
        !bad,
        `${name} sets a literal opacity (${bad?.[1]?.trim()}) on "${m[1].trim().split('\n').pop()}" — use var(--opacity-disabled)`,
      )
    }
  }

  // The two lane floors must actually carry a disabled state. games-common had
  // one and tools-common did not, which is how flowmap's Undo/Redo shipped
  // indistinguishable from live buttons for as long as they existed.
  for (const rel of ['tools/tools-common.css', 'games/games-common.css']) {
    const css = sheets.find(([n]) => n === rel)?.[1]
    assert.ok(css, `${rel} must exist — it is the lane's shared button floor`)
    const rule = css.match(/([^{}]*button:disabled[^{}]*)\{([^}]*)\}/)
    assert.ok(rule, `${rel} must give disabled buttons a dead state`)
    assert.ok(
      rule[2].includes('var(--opacity-disabled)'),
      `${rel}'s disabled rule must dim with var(--opacity-disabled)`,
    )
    // …and must neutralise its own hover, so a dead control never lights up.
    // The guard is source-order, not `:hover:not(:disabled)`: adding that
    // pseudo-class raises the hover rule's specificity past the per-tool tab
    // opt-outs (hash-smith / codec-forge / regex-lab) and past every per-game
    // copy, which would repaint borders those controls deliberately lack.
    const hoverProps = [...css.matchAll(/([^{}]*button:hover[^{}]*)\{([^}]*)\}/g)]
      .flatMap(m => [...m[2].matchAll(/^\s*([a-z-]+)\s*:/gm)].map(p => p[1]))
    // Compare PARSED property names, never a substring. `border-color:` contains
    // `color:`, so the substring form accepted a disabled rule that reset only the
    // border and dropped `color` — the one property whose loss is actually visible,
    // since a dead button would keep the hover's brightened text.
    const disabledProps = new Set(
      [...rule[2].matchAll(/^\s*([a-z-]+)\s*:/gm)].map(p => p[1]),
    )
    for (const prop of new Set(hoverProps)) {
      assert.ok(
        disabledProps.has(prop),
        `${rel}: the shared hover sets "${prop}" but the disabled rule does not reset it — a dead button lights up on hover`,
      )
    }
    assert.ok(
      css.indexOf('button:disabled') > css.lastIndexOf('button:hover'),
      `${rel}: the disabled rule must come AFTER the hover rule — they tie on specificity, so source order is the whole mechanism`,
    )
  }

  // The one tool in the shared chrome that actually disables buttons. If flowmap
  // ever stops shipping them the assertion above still holds the language, but
  // this pins the case that motivated it.
  const flowmap = await readFile(
    new URL('../src/components/tools/flowmap/Flowmap.ts', import.meta.url), 'utf-8',
  )
  assert.ok(
    /data-action="undo"[^>]*\sdisabled/.test(flowmap) && /\.disabled = this\.(history|future)\.length === 0/.test(flowmap),
    'flowmap Undo/Redo still ship disabled and toggle at runtime — the case tools-common.css now covers',
  )
  const toolsCommon = sheets.find(([n]) => n === 'tools/tools-common.css')[1]
  assert.ok(
    /div\[data-tool="flowmap"\] button:disabled/.test(toolsCommon),
    'flowmap must be in the shared disabled selector list, not just the live one',
  )
}


console.log('security smoke ok')


/* ─────────────  the poker fast path ranks hands identically to the slow one  ───────────── */

// Poker Trainer's Solve tab used to block the main thread for 5.8s on its
// default range preset, and it ran that query twice per render. The enumerator
// now ranks hands through `scoreBest` — bitmasks in, one comparable integer out,
// 27M hands/second against `evaluateBest`'s 44k — which is a ~166x end-to-end
// win and, crucially, is supposed to be a SPEED change and not a numbers change.
//
// An article on this site quotes these equities, so "supposed to" is not good
// enough. This block is the proof, and it is exhaustive where exhaustive is
// affordable: every one of the 2,598,960 five-card hands, not a sample. Set
// POKER_FAST_STRIDE=n to thin that sweep when iterating locally; the gate runs
// it whole.
{
  const { compareRank, evaluateBest, evaluateOmaha, packRank, packScore, score5, scoreBest, scoreOmaha } =
    await import('../src/components/games/poker-trainer/engine/evaluator.ts')
  const { exactEquity } = await import('../src/components/games/poker-trainer/engine/equity.ts')
  const { SUITS } = await import('../src/components/games/poker-trainer/engine/types.ts')

  const deck = []
  for (const s of SUITS) for (let r = 2; r <= 14; r++) deck.push({ r, s })
  assert.equal(deck.length, 52)
  const show = cards => cards.map(c => `${c.r}${c.s}`).join(' ')

  // The packing is order-isomorphic to compareRank BY CONSTRUCTION — it is a
  // fixed six-digit base-16 numeral [cat, tb0..tb4] and compareRank is
  // lexicographic on that same padded tuple — but only while every digit stays
  // inside its nibble. That precondition is the whole argument, so it is checked
  // on every hand below rather than asserted once in a comment.
  const stride = Number(process.env.POKER_FAST_STRIDE ?? 1)
  const distinct = new Map()
  let seen = 0
  let skip = 0
  const five = new Array(5)
  for (let a = 0; a < 48; a++) {
    five[0] = deck[a]
    for (let b = a + 1; b < 49; b++) {
      five[1] = deck[b]
      for (let c = b + 1; c < 50; c++) {
        five[2] = deck[c]
        for (let d = c + 1; d < 51; d++) {
          five[3] = deck[d]
          for (let e = d + 1; e < 52; e++) {
            if (skip++ % stride !== 0) continue
            five[4] = deck[e]
            const rank = evaluateBest(five)
            assert.ok(rank.cat >= 0 && rank.cat < 16, `hand category ${rank.cat} does not fit a nibble`)
            assert.ok(rank.tb.length <= 5, `tiebreakers ${rank.tb} are longer than the five packed digits`)
            for (const t of rank.tb) assert.ok(t >= 0 && t < 16, `tiebreaker ${t} does not fit a nibble`)
            const packed = packRank(rank)
            assert.equal(
              scoreBest(five), packed,
              `scoreBest disagrees with evaluateBest on ${show(five)} (${rank.name})`,
            )
            if (!distinct.has(packed)) distinct.set(packed, { cat: rank.cat, tb: rank.tb.slice(), name: rank.name })
            seen++
          }
        }
      }
    }
  }
  if (stride === 1) {
    assert.equal(seen, 2_598_960, 'the five-card sweep must be exhaustive')
    // Every distinct five-card hand value, a number that is not ours to choose.
    assert.equal(distinct.size, 7462, 'there are exactly 7462 distinct five-card hand ranks')
  }

  // …and the two orderings agree on every rank the sweep found, which is the
  // property `exactEquity` actually leans on when it compares integers.
  const ranks = [...distinct.entries()].map(([packed, r]) => ({ packed, ...r }))
  const byCompare = [...ranks].sort(compareRank)
  const byPacked = [...ranks].sort((x, y) => x.packed - y.packed)
  for (let i = 0; i < ranks.length; i++) {
    assert.equal(
      byPacked[i].packed, byCompare[i].packed,
      `packed order and compareRank order diverge at ${i}: "${byCompare[i].name}" vs "${byPacked[i].name}"`,
    )
  }
  // A tie must stay a tie: equal scores and compareRank === 0 have to mean the
  // same thing, or a split pot silently becomes a win.
  for (let i = 1; i < byPacked.length; i++) {
    assert.ok(byPacked[i - 1].packed < byPacked[i].packed, 'distinct ranks must pack to distinct scores')
    assert.ok(compareRank(byCompare[i - 1], byCompare[i]) < 0, 'distinct ranks must be strictly ordered')
  }
  assert.equal(packScore(8, 14, 0, 0, 0, 0) > packScore(7, 14, 13, 0, 0), true, 'category leads the packing')

  // Seven cards, where the fast path stops enumerating subsets altogether and
  // reads the flush and the rank multiset separately. Deterministic draws so a
  // failure is reproducible.
  let state = 0x9e3779b9
  const rnd = () => {
    state ^= state << 13; state >>>= 0
    state ^= state >>> 17
    state ^= state << 5; state >>>= 0
    return state / 4294967296
  }
  const draw = k => {
    const d = deck.slice()
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(rnd() * (52 - i))
      const t = d[i]; d[i] = d[j]; d[j] = t
    }
    return d.slice(0, k)
  }

  for (let i = 0; i < 25_000; i++) {
    const h = draw(7)
    assert.equal(scoreBest(h), packRank(evaluateBest(h)), `scoreBest disagrees on seven cards: ${show(h)}`)
  }

  // The same claim against the cheap oracle — the max over the 21 five-card
  // subsets, which is what "best five of seven" means by definition and is only
  // a valid reference because the sweep above pinned score5 to evaluate5 on
  // every five-card hand. This is the form that let the full C(52,7) =
  // 133,784,560 run offline; 150k of them stay here.
  const subsets = []
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 4; b++) for (let c = b + 1; c < 5; c++)
    for (let d = c + 1; d < 6; d++) for (let e = d + 1; e < 7; e++) subsets.push([a, b, c, d, e])
  assert.equal(subsets.length, 21)
  for (let i = 0; i < 150_000; i++) {
    const h = draw(7)
    let best = 0
    for (const [a, b, c, d, e] of subsets) {
      const s = score5(h[a], h[b], h[c], h[d], h[e])
      if (s > best) best = s
    }
    assert.equal(scoreBest(h), best, `scoreBest is not the best of the 21 subsets on ${show(h)}`)
  }

  // Omaha keeps its own rule — exactly two hole cards, exactly three board —
  // and `scoreOmaha` walks those 60 combinations rather than the 21.
  for (let i = 0; i < 3_000; i++) {
    const d = draw(9)
    const hole = d.slice(0, 4)
    const board = d.slice(4, 9)
    assert.equal(
      scoreOmaha(hole, board), packRank(evaluateOmaha(hole, board)),
      `scoreOmaha disagrees on ${show(hole)} | ${show(board)}`,
    )
  }

  // Finally the integration, because agreeing on hands is not the same as
  // agreeing on equities: re-run one flop from scratch through the OLD path —
  // evaluateBest and compareRank, counting wins, ties and shares the way
  // exactEquity does — and demand the floats match bit for bit, not to some
  // tolerance. Rewiring the enumerator's inner loop was allowed to change the
  // clock and nothing else.
  //
  // Two spots, and the second one is the point: the first has no split pots at
  // all, so on its own it never exercises the tie branch — deleting tie handling
  // from the rewired loop left this assertion green until a mirrored hand was
  // added beside it. A reference run that cannot chop does not test an
  // enumerator that has to divide pots.
  const card = t => ({ r: '23456789TJQKA'.indexOf(t[0]) + 2, s: t[1] })
  const spots = [
    { hero: [card('As'), card('Kh')], villain: [card('Qd'), card('Qc')], board: [card('2s'), card('7s'), card('9h')], chops: false },
    // Mirrored ace-king: neither can out-rank the other except by making a
    // flush, so most runouts are dead chops.
    { hero: [card('As'), card('Kh')], villain: [card('Ad'), card('Kc')], board: [card('2s'), card('7d'), card('9h')], chops: true },
  ]

  for (const spot of spots) {
    const fast = exactEquity([spot.hero, spot.villain], spot.board)
    const known = new Set([...spot.hero, ...spot.villain, ...spot.board].map(c => `${c.r}${c.s}`))
    const rest = deck.filter(c => !known.has(`${c.r}${c.s}`))
    const wins = [0, 0]
    const ties = [0, 0]
    const share = [0, 0]
    let boards = 0
    for (let i = 0; i < rest.length; i++) {
      for (let j = i + 1; j < rest.length; j++) {
        boards++
        const full = [...spot.board, rest[i], rest[j]]
        const cmp = compareRank(
          evaluateBest([...spot.hero, ...full]),
          evaluateBest([...spot.villain, ...full]),
        )
        if (cmp === 0) { ties[0]++; ties[1]++; share[0] += 1 / 2; share[1] += 1 / 2 }
        else wins[cmp > 0 ? 0 : 1]++
      }
    }
    const where = `${show(spot.hero)} vs ${show(spot.villain)} on ${show(spot.board)}`
    assert.equal(spot.chops, ties[0] > 0, `${where}: this spot's role here depends on whether it chops`)
    assert.equal(boards, fast.runouts, `${where}: both paths must enumerate the same number of boards`)
    assert.deepEqual(fast.win, wins.map(w => w / boards), `${where}: win counts must be identical, not close`)
    assert.deepEqual(fast.tie, ties.map(t => t / boards), `${where}: tie counts must be identical, not close`)
    assert.deepEqual(
      fast.equity, share.map((s, i) => (wins[i] + s) / boards),
      `${where}: the fast enumerator must return the same equity floats as the reference one`,
    )
  }
}

console.log('poker fast path ok')


/* ────────  role: tools — Cron Whisperer reads a whole crontab  ────────────── */
// The tool now claims it can read a pasted crontab, not just an expression: that
// `CRON_TZ=` applies to the entries BELOW it, that `%` is not an ordinary
// character, that a trailing `#` is part of the command, and that a system
// crontab has a user column. Every one of those is a claim about a file format
// that is easy to get subtly wrong and impossible to notice — the panel renders
// happily either way, and only the schedules are misattributed.
//
// So the file grammar lives in a module (src/components/tools/cron-whisperer/
// crontab.ts) and these run it. The engine assertions further up already pin
// what a schedule means; these pin which schedule the reader thinks it is
// looking at, and in which zone.
{
  const {
    CW_CRONTAB_MAX_ENTRIES,
    cwCollisions,
    cwLooksLikeSystemCrontab,
    cwMergeRuns,
    cwParseCrontab,
    cwParseEnvLine,
    cwSplitPercent,
  } = await import('../src/components/tools/cron-whisperer/crontab.ts')

  // ── An assignment line is not an entry, and cron's own rule decides which ──
  // Vixie's `load_env()`: NAME, optional space, `=`, optional space, VALUE, with
  // VALUE optionally wrapped in matching quotes. A "looks like KEY=VALUE" regex
  // gets both of the last two cases wrong in opposite directions.
  assert.deepEqual(cwParseEnvLine('PATH=/usr/local/bin:/usr/bin'), { name: 'PATH', value: '/usr/local/bin:/usr/bin' })
  assert.deepEqual(cwParseEnvLine('MAILTO=""'), { name: 'MAILTO', value: '' }, 'an empty quoted value is still an assignment')
  assert.deepEqual(cwParseEnvLine('CRON_TZ = "Europe/Berlin"'), { name: 'CRON_TZ', value: 'Europe/Berlin' })
  assert.deepEqual(cwParseEnvLine("TZ='Asia/Kolkata'"), { name: 'TZ', value: 'Asia/Kolkata' })
  assert.deepEqual(cwParseEnvLine('SHELL=/bin/sh   '), { name: 'SHELL', value: '/bin/sh' }, 'an unquoted value is right-trimmed')
  assert.equal(cwParseEnvLine('0 0 * * * cmd'), null, 'a schedule is not an assignment')
  assert.equal(cwParseEnvLine('*/5 * * * * echo a=b'), null, 'an = inside a command does not make the line configuration')
  assert.equal(cwParseEnvLine('@reboot X=1'), null, 'nor does one after a nickname')
  assert.equal(cwParseEnvLine('=nope'), null, 'an empty name is not an assignment')

  // ── The whole point: an assignment applies DOWNWARD ───────────────────────
  // The entry above a CRON_TZ= is not in that zone. Reading a crontab as if the
  // assignment applied to the file is the single most common misreading of one,
  // and it is exactly what a one-expression tool cannot show you.
  const cwTab = [
    '# deploy box',                                   // 1
    'MAILTO=""',                                      // 2
    '',                                               // 3
    '*/5 * * * * /usr/local/bin/health-check.sh',     // 4  — no zone
    'CRON_TZ=America/New_York',                       // 5
    '30 2 * * * /opt/nightly.sh   # not a comment',   // 6  — NY
    'TZ=Asia/Kolkata',                                // 7
    '0 9 * * 1-5 /opt/standup.sh',                    // 8  — Kolkata, flagged
    'CRON_TZ=Mars/Olympus_Mons',                      // 9
    '0 1 * * * /opt/bad-zone.sh',                     // 10 — named zone is unknown
    'CRON_TZ=',                                       // 11
    '0 4 * * * /opt/back-to-default.sh',              // 12 — override cleared
  ].join('\n')
  const cwDoc = cwParseCrontab(cwTab)

  assert.deepEqual(
    cwDoc.entries.map(e => [e.n, e.zone, e.zoneSource, e.zoneOk]),
    [
      [4, null, null, true],
      [6, 'America/New_York', 'CRON_TZ', true],
      [8, 'Asia/Kolkata', 'TZ', true],
      [10, 'Mars/Olympus_Mons', 'CRON_TZ', false],
      [12, null, null, true],
    ],
    'a CRON_TZ=/TZ= line applies to the entries BELOW it and stays in force until reassigned; an empty value clears it',
  )
  assert.equal(cwDoc.usesTz, true, 'a bare TZ= must be reported — implementations disagree about whether it moves the schedule at all')
  assert.equal(
    cwDoc.entries.find(e => e.n === 10).zoneOk, false,
    'a zone this runtime cannot resolve must be marked, not silently treated as UTC',
  )
  assert.equal(cwDoc.lines.find(l => l.n === 1).kind, 'comment')
  assert.equal(cwDoc.lines.find(l => l.n === 3).kind, 'blank')
  assert.equal(cwDoc.lines.find(l => l.n === 2).kind, 'env')

  // A `#` only opens a comment at the start of a line. Cron hands a trailing one
  // straight to the shell, which is a real way to break a job by "just adding a
  // comment" — so the command shown must keep it.
  assert.equal(
    cwDoc.entries.find(e => e.n === 6).command,
    '/opt/nightly.sh   # not a comment',
    'a trailing # is part of the command, not a comment',
  )

  // ── The percent rule (man 5 crontab) ──────────────────────────────────────
  // Unescaped, `%` ends the command and the rest becomes stdin, with each
  // further `%` a newline. `date +%Y%m%d` is the classic casualty.
  assert.deepEqual(
    cwSplitPercent('tar czf /backup/$(date +%Y%m%d).tgz /srv'),
    { command: 'tar czf /backup/$(date +', stdin: 'Y\nm\nd).tgz /srv' },
    'cron truncates the command at the first % and feeds the rest in on stdin',
  )
  assert.deepEqual(cwSplitPercent('echo hi'), { command: 'echo hi', stdin: null })
  assert.deepEqual(
    cwSplitPercent('echo 100\\% done'),
    { command: 'echo 100% done', stdin: null },
    '\\% is an escaped literal percent and does not split the command',
  )
  assert.equal(
    cwParseCrontab('15 3 1 * * tar czf /b/$(date +%Y).tgz /srv').entries[0].stdin,
    'Y).tgz /srv',
    'the reader must surface the split, not print the line back as if cron ran all of it',
  )

  // ── A 6-field expression pasted into a crontab is not a 5-field one ───────
  // Left alone it reads as a schedule whose command is a lone cron field, which
  // is a confident answer to a question nobody asked.
  const cwSix = cwParseCrontab('0 0 12 * * *')
  assert.equal(cwSix.entries.length, 0)
  assert.match(cwSix.errors[0].message, /6-field/, 'a seconds-first expression in a crontab must be named, not previewed')
  // …and one with no command at all is not an entry either.
  assert.match(cwParseCrontab('0 0 * * *\n0 1 * * *').errors[0].message, /no command/)

  // ── The system crontab user column ────────────────────────────────────────
  const cwSys = '0 5 * * * root /usr/bin/certbot renew\n17 * * * * www-data /usr/bin/php /srv/app/cron.php'
  assert.deepEqual(
    cwParseCrontab(cwSys, { systemUser: true }).entries.map(e => [e.user, e.command]),
    [['root', '/usr/bin/certbot renew'], ['www-data', '/usr/bin/php /srv/app/cron.php']],
  )
  assert.deepEqual(
    cwParseCrontab(cwSys).entries.map(e => e.user), [null, null],
    'a user crontab has no user column — reading one where there is none would relabel the command',
  )
  // The hint that offers the switch has to be strict in the direction that
  // matters: guessing "system" at a user crontab silently renames the command.
  assert.equal(cwLooksLikeSystemCrontab(cwSys), true)
  assert.equal(
    cwLooksLikeSystemCrontab('0 5 * * * php /srv/app/cron.php\n0 6 * * * echo hi'), false,
    'a command in the first position must not be mistaken for a user',
  )
  assert.equal(cwLooksLikeSystemCrontab('0 5 * * * root /a\n0 6 * * * /b'), false, 'the whole file has to agree')
  assert.equal(cwLooksLikeSystemCrontab(''), false)

  // ── The payoff: the zone on an entry really reaches the run computation ───
  // Everything above is grammar. This is the part that would let a wrong answer
  // through: the same line, above and below one CRON_TZ=, must resolve to
  // different instants — and the one below must hit the New York spring-forward
  // gap the engine assertions further up already pinned to 2027-03-14T07:00Z.
  const cwPair = cwParseCrontab('30 2 * * * /a\nCRON_TZ=America/New_York\n30 2 * * * /b').entries
  const cwFrom = cwAt('2027-03-12T12:00:00Z')
  const cwBelow = cwCollectRuns(cwPair[1].parsed, cwFrom, { count: 4 }, new CwZoneClock(cwPair[1].zone, cwFrom))
  const cwGap = cwBelow.find(r => r.dst === 'gap')
  assert.ok(cwGap, 'the entry below CRON_TZ=America/New_York must hit that zone’s spring-forward gap')
  assert.equal(
    new Date(cwGap.ms).toISOString(), '2027-03-14T07:00:00.000Z',
    'and land on the same instant the engine assertions pin for that expression in that zone',
  )
  const cwAbove = cwCollectRuns(cwPair[0].parsed, cwFrom, { count: 4 }, new CwZoneClock('UTC', cwFrom))
  assert.ok(
    !cwAbove.some(r => r.dst),
    'the identical entry ABOVE the assignment is not in that zone — resolved in UTC it meets no transition at all',
  )

  // ── The merged timeline ───────────────────────────────────────────────────
  const cwAtNow = cwAt('2026-08-20T10:00:00Z')
  const cwClk = new CwZoneClock('UTC', cwAtNow)
  const cwMDoc = cwParseCrontab('0 0 * * * /a\n0 0 * * * /b\n*/30 * * * * /c\n0 12 * * * /d')
  const cwLists = k => cwMDoc.entries.map((e, entry) => ({
    entry, runs: cwCollectRuns(e.parsed, cwAtNow, { count: k }, cwClk),
  }))
  // Property 1: the global first K is a subset of each entry's own first K, so
  // collecting count+1 apiece is enough and the caller never guesses a horizon.
  // Compared against collecting 40x as many — if the claim were false, the
  // generous collection would surface a run the tight one missed.
  assert.deepEqual(
    cwMergeRuns(cwLists(6), 5).map(r => [r.ms, r.entry]),
    cwMergeRuns(cwLists(200), 5).map(r => [r.ms, r.entry]),
    'collecting count+1 runs per entry must give the same timeline as collecting far more',
  )
  // Property 2: `collides` means another ENTRY fires at this exact instant.
  const cwRows = cwMergeRuns(cwLists(6), 6)
  const cwSeen = new Map()
  for (const r of cwRows) cwSeen.set(r.ms, (cwSeen.get(r.ms) ?? 0) + 1)
  for (const r of cwRows) {
    assert.equal(r.collides, cwSeen.get(r.ms) > 1, 'collides must be exactly "more than one entry at this instant"')
  }
  assert.ok(cwRows.some(r => r.collides), 'two jobs at 0 0 * * * start together — the usual reason a box stalls on the hour')
  assert.ok(cwRows.some(r => !r.collides), '…and a job on its own does not')
  // Property 3: the cap never cuts a tie in half. Showing one of two simultaneous
  // jobs is worse than showing neither, because it answers the question wrongly.
  const cwPairRows = cwMergeRuns(
    cwParseCrontab('0 0 * * * /a\n0 0 * * * /b').entries.map((e, entry) => ({
      entry, runs: cwCollectRuns(e.parsed, cwAtNow, { count: 2 }, cwClk),
    })),
    1,
  )
  assert.equal(cwPairRows.length, 2, 'a collision group must survive the count cap whole')
  assert.equal(cwPairRows[0].ms, cwPairRows[1].ms)
  // A run the scheduler never makes up is not "what fires next" and must not be
  // in this list — the per-entry panel is where a lost run gets explained.
  assert.ok(
    cwMergeRuns([{ entry: 0, runs: [{ ms: 1, wall: null, dst: 'gap', fires: false }] }], 5).length === 0,
    'a skipped run is not a run',
  )

  // ── Which jobs start together, over a window the answer is exact for ─────
  // The other file-level question. It must not be answered from the displayed
  // rows: on a crontab holding one five-minute job, every visible row IS that
  // job and the midnight pile-up is off-screen. So the scan takes its own
  // window, and the cap on it fails in the honest direction.
  // A function declaration and not `const cwRun = (…) => ({…})`: an arrow whose
  // body is a parenthesised object literal, immediately followed by a bare
  // block, is ambiguous to TypeScript's parser — it reads the object literal as
  // the NEXT arrow's parameter list. esbuild parses it correctly, so `npm run
  // build` stays green while `npm run check` reports five phantom errors. Same
  // trap AGENTS.md records for the JSX comment in a component tag.
  function cwRun(ms, fires = true) {
    return { ms, wall: null, dst: '', fires }
  }
  {
    const scan = [
      { entry: 0, runs: [cwRun(100), cwRun(200), cwRun(300)] },
      { entry: 1, runs: [cwRun(200), cwRun(400)] },
      { entry: 2, runs: [cwRun(200), cwRun(300)] },
    ]
    const { hits, busy } = cwCollisions(scan, 350, 99)
    assert.deepEqual(busy, [])
    assert.deepEqual(
      hits, [{ ms: 200, entries: [0, 1, 2] }, { ms: 300, entries: [0, 2] }],
      'a collision is an instant shared by more than one ENTRY, listed soonest first',
    )
    assert.ok(!hits.some(h => h.ms > 350), 'nothing past the stated horizon may be claimed')
  }
  // A non-firing run is not a start, so a spring-forward reading a wildcard
  // schedule never makes up cannot manufacture a collision.
  assert.deepEqual(
    cwCollisions([
      { entry: 0, runs: [cwRun(500, false)] },
      { entry: 1, runs: [cwRun(500)] },
    ], 999, 99).hits,
    [],
    'a run the scheduler skips does not collide with anything',
  )
  // An entry over the cap is NAMED, not half-compared: a partial enumeration of
  // a job that runs constantly would report fewer collisions than really happen,
  // and under-reporting is the wrong direction to be wrong in here.
  {
    const busyRuns = Array.from({ length: 5 }, (_, i) => cwRun(i + 1))
    const { hits, busy } = cwCollisions(
      [{ entry: 0, runs: busyRuns }, { entry: 1, runs: [cwRun(1)] }], 999, 5,
    )
    assert.deepEqual(busy, [0], 'an entry at the cap is reported as too busy to compare')
    assert.deepEqual(hits, [], 'and contributes nothing, rather than a truncated answer')
  }

  // End to end, and the case only a whole-file view can answer at all: two
  // entries in DIFFERENT zones that land on the same instant. 09:00 in New York
  // on a January day is 14:00Z is 19:30 in Kolkata — nothing about either line
  // read on its own says they start together.
  {
    const cwCross = cwParseCrontab([
      'CRON_TZ=America/New_York',
      '0 9 * * * /opt/reports/standup.sh',
      'CRON_TZ=Asia/Kolkata',
      '30 19 * * * /opt/india/standup.sh',
    ].join('\n'))
    const cwStart = cwAt('2027-01-14T00:00:00Z')
    const cwScan = cwCross.entries.map((e, entry) => ({
      entry,
      runs: cwCollectRuns(e.parsed, cwStart, { count: 400, untilMs: cwStart + 86400_000 }, new CwZoneClock(e.zone, cwStart)),
    }))
    const cwHits = cwCollisions(cwScan, cwStart + 86400_000, 400).hits
    assert.equal(cwHits.length, 1, 'the two entries meet exactly once in the day')
    assert.deepEqual(cwHits[0].entries, [0, 1])
    assert.equal(
      new Date(cwHits[0].ms).toISOString(), '2027-01-14T14:00:00.000Z',
      '09:00 New York and 19:30 Kolkata are the same instant in January — the collision only exists across the file',
    )
  }

  // ── Bounded, like every other input this repo accepts ─────────────────────
  const cwBig = Array.from({ length: CW_CRONTAB_MAX_ENTRIES + 40 }, (_, i) => `0 ${i % 24} * * * /job-${i}`).join('\n')
  const cwBigDoc = cwParseCrontab(cwBig)
  assert.equal(cwBigDoc.entries.length, CW_CRONTAB_MAX_ENTRIES, 'the entry count is bounded')
  assert.equal(cwBigDoc.truncated, true, 'and a clipped paste says so rather than quietly dropping the tail')
  assert.equal(cwParseCrontab('0 0 * * * /a'.padEnd(30_000, ' ')).truncated, true, 'so is a single absurd line')

  // ── The component stays a DOM shell ───────────────────────────────────────
  // Same rule as webhook-inspector/signature.ts and ./schedule.ts: a claim that
  // lives in a DOM handler cannot be tested and will quietly stop being true.
  const cwShell = await readFile(
    new URL('../src/components/tools/cron-whisperer/CronWhisperer.ts', import.meta.url), 'utf-8',
  )
  assert.ok(/from '\.\/crontab'/.test(cwShell), 'CronWhisperer.ts must read the file grammar from ./crontab.ts')
  assert.ok(
    !/function cwParseCrontab|function cwParseEnvLine|function cwSplitPercent/.test(cwShell),
    'the crontab grammar must have exactly one home — a second copy in the component drifts the first time either changes',
  )
  assert.ok(
    cwShell.includes('data-type="tool-page"') && cwShell.includes('data-tool="cron-whisperer"'),
    'the shared workbench root must survive the rewrite of the input',
  )

  // ── A single line is an EXPRESSION until cwParse declines ─────────────────
  // Routing by field count first silently re-read every 6-field (seconds-first)
  // expression as a 5-field schedule plus a command: `0 15 10 * * SUN` previewed
  // "At 15:00 on day-of-month 10" — a different schedule, no error shown. The
  // routing is reproduced here from the component's own two predicates, so this
  // fails if either is deleted or has the field-count test put back into it.
  assert.ok(
    /looksLikeCrontabFile\(/.test(cwShell) && /looksLikeLoneEntry\(/.test(cwShell),
    'evaluate() must route on the file/lone-entry predicates, not on a raw field count',
  )
  {
    // Read the predicate's own body: a field count anywhere inside it is the bug.
    const body = cwShell.slice(cwShell.indexOf('private looksLikeCrontabFile'))
    const end = body.indexOf('\n  }')
    assert.ok(end > 0, 'looksLikeCrontabFile must exist and be readable')
    assert.ok(
      !/length\s*>=\s*6/.test(body.slice(0, end)),
      'looksLikeCrontabFile must not decide by field count — that is the seconds-first bug',
    )
  }
  {
    const isFile = t => /\n/.test(t) || t.startsWith('#') || Boolean(cwParseEnvLine(t))
    const lone = t => (t.startsWith('@') ? /^@\S+[ \t]+\S/.test(t) : t.split(/\s+/).length >= 6)
    const route = t => {
      if (!isFile(t)) {
        try { cwParse(t); return 'expression' } catch { return lone(t) ? 'file' : 'error' }
      }
      return 'file'
    }
    for (const [text, want] of [
      ['0 15 10 * * SUN', 'expression'],
      ['*/30 * * * * *', 'expression'],
      ['0 30 9 * * MON-FRI', 'expression'],
      ['0 5 * * *', 'expression'],
      ['@daily', 'expression'],
      ['0 5 * * * /usr/bin/backup.sh', 'file'],
      ['@daily /usr/bin/backup.sh', 'file'],
      ['# comment', 'file'],
      ['CRON_TZ=Asia/Kolkata', 'file'],
      ['99 * * * *', 'error'],
    ]) {
      assert.equal(route(text), want, `"${text}" must be read as a ${want}`)
    }
    // …and the seconds-first reading is the RIGHT one, not merely a different one.
    assert.equal(cwParse('0 15 10 * * SUN').hasSeconds, true, '6 fields means a leading seconds field')
  }

  // ── A malformed nickname is an error, never a crash ───────────────────────
  // `@` with nothing usable after it matched startsWith('@') but not the nickname
  // pattern, and the result was cast `as RegExpExecArray` — so it threw a TypeError
  // out of the input handler, freezing every panel, and rendered the tool blank when
  // the line arrived from localStorage or a shared `#e=` link on mount.
  for (const bad of ['@', '@   ', '@\t']) {
    const doc = cwParseCrontab(`${bad}\n0 5 * * * /bin/true`)
    assert.equal(doc.lines[0].kind, 'error', `"${bad}" must be reported as an error line`)
    assert.equal(doc.lines.length, 2, 'and the rest of the file must still be read')
  }
}


console.log('cron whisperer crontab ok')


/* ─────  role: projects — a same-origin project URL must be a page we serve  ─────

   The projects block earlier in this file checks /tools/<slug> and /games/<slug>
   against their one indexing predicate and `continue`s on everything else — so
   every OTHER apanjwani0.com path in that config is asserted by nothing at all.

   That gap is not theoretical. Sections here move: blogs is hidden behind
   site.sections.blogs and both its routes are noindex, and learnings is mid-
   rename. A project entry is also the one place a URL to this site is written by
   hand rather than derived from a slug, so it is the one place a stale path can
   survive. A card plus an ItemList entry pointing at a hidden or renamed section
   is exactly the contradicting-signals failure the Indexing rule exists to
   prevent, and it renders perfectly while being wrong.

   So the shapes /projects may advertise are enumerated. Widening the list is
   then a deliberate act rather than a fall-through nobody notices. */
{
  const PROJECTS_SELF_ORIGIN = 'https://apanjwani0.com'
  const projectPathShapes = [
    /^\/$/,                      // the site itself
    /^\/tools\/[a-z0-9-]+\/?$/,  // status must be 'live' — checked above
    /^\/games\/[a-z0-9-]+\/?$/,  // isPlayableGame() — checked above
  ]

  let projectsOnSite = 0
  for (const p of smokeProjects) {
    let projectUrl
    try {
      projectUrl = new URL(p.url)
    } catch {
      assert.fail(`project "${p.title}" has a url that does not parse: ${p.url}`)
    }
    // safeExternalUrl() drops anything that is not https, and the ItemList is
    // built through it while the card's own link is not — so a non-https entry
    // would render on the page and silently vanish from the structured data.
    assert.equal(
      projectUrl.protocol,
      'https:',
      `project "${p.title}" must link over https, or it renders as a card but drops out of the ItemList`,
    )
    if (projectUrl.origin !== PROJECTS_SELF_ORIGIN) continue
    projectsOnSite++
    assert.ok(
      projectPathShapes.some(re => re.test(projectUrl.pathname)),
      `project "${p.title}" links to ${projectUrl.pathname} on this site, which is not a shape /projects is allowed to advertise — add it to projectPathShapes deliberately, once something asserts that page is indexable`,
    )
  }
  /* The floor was 4, then 1, and is now 0 — on 2026-09-25 /projects stopped
     re-listing this site's own tools and games (the owner already has two hubs
     of their own), and then dropped the entry for the site itself too, leaving
     a shelf of GitHub work only.

     A floor of 0 cannot prove the loop ran, so it is NOT the assertion: the
     corpus itself is. Every project is still walked and held to https above,
     which is the check that needs real data, and `projectPathShapes` is held to
     synthetic paths below — so the on-site branch keeps its teeth with no
     on-site entry shipped. What is gone is only the expectation that one
     EXISTS. Re-add an apanjwani0.com project and it is checked exactly as
     before; nothing here needs touching for that. */
  assert.ok(
    smokeProjects.length > 0,
    'expected projects to check — an empty config would pass every assertion in this block vacuously',
  )

  /* With only the root link left in the config, `projectPathShapes` itself is
     barely exercised by real data — the tools and games branches would now be
     dead regexes that could be broken without anything going red. So the list
     is held to synthetic paths as well: the shapes it must accept, and the
     near-misses it must refuse. This is the half that survives the corpus
     shrinking, and it is why the floor above can safely be 1. */
  const shapeAccepts = path => projectPathShapes.some(re => re.test(path))
  for (const ok of ['/', '/tools/chainsaw', '/tools/chainsaw/', '/games/deep-shore', '/games/2048']) {
    assert.ok(shapeAccepts(ok), `projectPathShapes must still accept ${ok}`)
  }
  for (const bad of [
    '/blogs/anything',          // a gated section — the failure this guard exists for
    '/learnings/some-article',  // indexable, but nothing asserts a project may advertise it
    '/tools',                   // the hub, not a product page
    '/games',
    '/tools/driftfield/sand-loom', // a mode page; deliberately not in the list
    '/admin',
    '/tools/Chainsaw',          // slug casing that would 404
    '//evil.example.com',
  ]) {
    assert.equal(shapeAccepts(bad), false, `projectPathShapes must refuse ${bad} until someone adds it deliberately`)
  }
}

console.log('projects link only at pages this site serves')


/* ══════════  role: seo-reach — ONE predicate decides a Driftfield page  ══════════

   AGENTS.md, "Indexing: one predicate decides whether a page is real": a page
   search engines are told to noindex must not be in the sitemap, must not be in
   a hub's ItemList, and must not carry a share card. Games, tools, learnings and
   the hidden blogs section each have exactly one predicate. Driftfield did not.

   Its three consumers gave two different answers. `/tools/driftfield` 404'd
   unless the tools config said `live`, and the sitemap listed the six modes only
   when it said `live` — but `/tools/driftfield/<mode>` never read the tools
   config at all. Withdraw Driftfield and those six routes still answered 200
   with `index, follow`, a summary_large_image card and WebApplication JSON-LD,
   above a breadcrumb pointing at a hub that was serving 404: indexable, carded,
   unlisted and unsitemapped, all at once. `npm run og` was the fourth consumer
   and the only entry in its list with no eligibility check whatsoever.

   `isDriftfieldPublic()` (src/lib/driftfield.ts) is now that one predicate and
   all four read it. The unit cases below are cheap; the ones that matter drive
   the REAL sitemap route with a synthetic config and pin the two files that
   cannot be imported to the CALL, not to the import — deleting the guard and
   leaving the import is exactly the regression this is here to catch. */
{
  const { isDriftfieldPublic: dfPublic, DRIFTFIELD_MODES: dfModes, DRIFTFIELD_SLUG: dfSlug } =
    await import('../src/lib/driftfield.ts')

  const asStatus = status => tools.map(t => (t.slug === dfSlug ? { ...t, status } : t))

  assert.equal(dfPublic(tools), true, 'driftfield ships live, so the modes really are sitemapped today')
  for (const status of ['wip', 'external', 'disabled']) {
    assert.equal(dfPublic(asStatus(status)), false, `a "${status}" driftfield must not be a public page`)
  }
  assert.equal(
    dfPublic(tools.filter(t => t.slug !== dfSlug)), false,
    'no driftfield entry at all means no driftfield pages — not "assume live"',
  )
  assert.equal(
    dfPublic([{ slug: 'json-tidy', status: 'live' }]), false,
    'the predicate must read the driftfield entry, not "some tool is live"',
  )

  // The signal that a crawler actually consumes. Driving the route (same
  // technique as the sitemap block above) rather than reading its source,
  // because what matters is the emitted document, not how it decides.
  const localsWith = toolsConfig => ({
    runtime: { env: { SITE_CONFIG: { get: async key => (key === 'tools' ? toolsConfig : null) } } },
  })
  const { GET: sitemapGET } = await import('../src/pages/sitemap.xml.ts')
  const dfLiveXml = await (await sitemapGET({ locals: localsWith(asStatus('live')) })).text()
  const dfWipXml = await (await sitemapGET({ locals: localsWith(asStatus('wip')) })).text()

  for (const m of dfModes) {
    assert.ok(
      dfLiveXml.includes(`/tools/${dfSlug}/${m.slug}<`),
      `mode "${m.slug}" is missing from the sitemap while driftfield is live`,
    )
  }
  assert.ok(
    !dfWipXml.includes(`/tools/${dfSlug}`),
    'a withdrawn driftfield still has its hub or a mode in the sitemap',
  )
  assert.ok(
    dfWipXml.includes('/tools/json-tidy'), 'the withdrawn-driftfield sitemap lost everything, not just driftfield',
  )

  // The two consumers that cannot be driven from here: an .astro route and a
  // Chrome-shelling script. Matched on the guard, not the identifier.
  const modeRoute = await readFile(new URL('../src/pages/tools/driftfield/[mode].astro', import.meta.url), 'utf-8')
  assert.match(
    modeRoute,
    /if \(!isDriftfieldPublic\(tools\)\)\s*\{\s*\n\s*return new Response\(null, \{ status: 404/,
    'the mode route must 404 when driftfield is not public — this is the route that read no config at all',
  )
  assert.match(
    modeRoute, /getTools\(Astro\.locals\)/,
    'the mode route must actually load the tools config it gates on',
  )

  const hubRoute = await readFile(new URL('../src/pages/tools/driftfield/index.astro', import.meta.url), 'utf-8')
  assert.match(
    hubRoute, /if \(!tool \|\| !isDriftfieldPublic\(tools\)\)/,
    'the hub must gate on the shared predicate, not on its own copy of the status check',
  )

  const ogScript = await readFile(new URL('../scripts/generate-og.mjs', import.meta.url), 'utf-8')
  assert.match(
    ogScript,
    /\.\.\.\(isDriftfieldPublic\(tools\) \? DRIFTFIELD_MODES : \[\]\)\.map\(/,
    'the card generator must gate the mode cards on the same predicate — a card must not outlive its page',
  )
}

/* ─────  Share cards: a NOTICE, deliberately not a gate  ─────

   Every indexable product page is supposed to ship a committed 1200×630 card,
   and `npm run og` mints them — but nothing tells anyone it is owed. Three
   tools and a game shipped without one before this was noticed by reading a
   directory listing; each of those pages unfurls on Slack/X/LinkedIn as the
   portrait avatar, which is precisely the degradation the cards exist to end.

   This block does NOT fail. A missing card is degraded, not broken —
   `existingOgCardPath()` falls back to the avatar (asserted elsewhere), and the
   generator shells out to a macOS Chrome path, so a hard assertion would turn a
   cosmetic debt into a red gate on every Linux/CI run, which is the one place
   it can never be paid. So: derive the catalogue from the SAME predicates the
   generator uses (never a second hand-written list), diff it against what is on
   disk, and print what is owed. The single assertion guards the derivation
   itself — a notice that silently computes an empty list is worse than none. */
{
  const { toolHasOgCard, gameHasOgCard, ogCardFile } = await import('../src/lib/og.ts')
  const { isDriftfieldPublic: ogDfPublic, DRIFTFIELD_MODES: ogDfModes, DRIFTFIELD_SLUG: ogDfSlug } =
    await import('../src/lib/driftfield.ts')

  const expected = [
    ...tools.filter(toolHasOgCard).map(t => ['tools', t.slug]),
    ...games.filter(gameHasOgCard).map(g => ['games', g.slug]),
    ...learnings.filter(learningHasOgCard).map(l => ['learnings', l.slug]),
    ...(ogDfPublic(tools) ? ogDfModes : []).map(m => ['tools', `${ogDfSlug}-${m.slug}`]),
  ].map(([kind, slug]) => ogCardFile(kind, slug))
  assert.ok(expected.length > 0,
    'the share-card catalogue derived nothing — the og predicates or the config moved under this check')

  let present
  try {
    present = new Set(await readdir(new URL('../public/og/', import.meta.url)))
  } catch {
    present = null
  }
  const missing = present === null ? [] : expected.filter(f => !present.has(f))
  if (present === null) {
    console.log('note: public/og is unreadable — every product page will share as the portrait avatar')
  } else if (missing.length > 0) {
    console.log(
      `note: ${missing.length} of ${expected.length} share cards are not committed yet — run \`npm run og\` ` +
      `(needs macOS Chrome) and commit: ${missing.join(', ')}`,
    )
  }
}

/* ══════  design-ux: a shared idiom must live where BOTH layouts can see it  ══════

   The site has two shells. `Base.astro` loads `src/styles/global.css`;
   `ToolBase.astro` loads only `src/styles/shared.css`. So a `data-type` idiom
   defined in global.css is invisible to every ToolBase page — and that is not
   hypothetical, it shipped: `/tools/driftfield` is a hub rendered through
   ToolBase, writing the same `<ul data-type="card-grid">` / `<h3
   data-type="card-title">` markup as /tools, /games, /projects and /blogs, and
   with the rules unreachable its six live simulations rendered as a default
   bulleted list — disc markers, list indent, no grid, no border, no radius, no
   hover — next to four hubs showing bordered cards. `p[data-type="page-intro"]`
   was the same miss on every /tools/driftfield/<mode> page: full --color-text,
   no rhythm, where the identical element elsewhere is muted and spaced.

   Nothing catches this. The build is green, `astro check` is silent, the page
   renders, and the two hubs are never on screen together — which is exactly why
   it survived. So the check is derived from the pages themselves rather than
   from a list of idioms someone has to remember to extend: find the ToolBase
   pages, read the idioms they actually render, and fail on any that only
   global.css styles.

   Base-only REFINEMENTS stay legal — `div[data-type="project-header"] >
   [data-type="card-title"]` is a higher-specificity extra that global.css
   rightly owns. What must be reachable is the base idiom. */
{
  const pagesUrl = new URL('../src/pages/', import.meta.url)
  const styleUrl = n => new URL(`../src/styles/${n}`, import.meta.url)

  // A selector match, not a mention: both global.css and shared.css discuss
  // these idioms in prose, and a comment must never count as a definition.
  const stylesIdiom = (css, idiom) => {
    const needle = `[data-type="${idiom}"]`
    for (let i = css.indexOf(needle); i !== -1; i = css.indexOf(needle, i + 1)) {
      const openedComment = css.lastIndexOf('/*', i)
      if (openedComment !== -1 && openedComment > css.lastIndexOf('*/', i)) continue
      const rest = css.slice(i + needle.length)
      const open = rest.indexOf('{')
      const close = rest.indexOf('}')
      if (open === -1 || (close !== -1 && close < open)) continue
      // The BASE rule, not a refinement. `[data-type="card-grid"] > *` styles the
      // cards and leaves the grid container itself unstyled, so a sheet holding
      // only that has NOT given the idiom a home: move just the base block back
      // to global.css and /tools/driftfield returns to a bulleted list while the
      // hover and focus-within rules stay put. That partial split is the likelier
      // future shape of the shipped bug, and counting any selector that merely
      // contains the idiom let it through. Only trailing pseudo-classes are still
      // the same element.
      const comma = rest.indexOf(',')
      const tail = rest.slice(0, comma === -1 ? open : Math.min(open, comma)).trim()
      if (tail && !/^(?::[a-z-]+(?:\([^)]*\))?)+$/i.test(tail)) continue
      return true
    }
    return false
  }

  // Vite inlines @import at build time, so an imported sheet is as reachable as
  // the sheet that pulls it in — shared.css reaches theme.css this way.
  const readCss = async (url, seen = new Set()) => {
    if (seen.has(url.href)) return ''
    seen.add(url.href)
    let css
    try { css = await readFile(url, 'utf-8') } catch { return '' }
    let out = css
    for (const m of css.matchAll(/@import\s+['"]([^'"]+)['"]/g)) {
      out += '\n' + await readCss(new URL(m[1], url), seen)
    }
    return out
  }
  const astroStyles = src => [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')

  const globalCss = await readFile(styleUrl('global.css'), 'utf-8')
  const baseSharedCss = await readCss(styleUrl('shared.css'))
  const layoutUrl = new URL('../src/layouts/ToolBase.astro', import.meta.url)
  const layoutSrc = await readFile(layoutUrl, 'utf-8')
  const layoutCss = astroStyles(layoutSrc)
    + '\n' + (await Promise.all(
      [...layoutSrc.matchAll(/^import\s+['"]([^'"]+\.css)['"]/gm)].map(m => readCss(new URL(m[1], layoutUrl))),
    )).join('\n')

  assert.ok(
    stylesIdiom(globalCss, 'writing-date'),
    'global.css lost its Base-only idioms — this check would then pass vacuously',
  )

  const pageFiles = (await readdir(pagesUrl, { recursive: true })).filter(f => f.endsWith('.astro'))
  const toolBasePages = []
  for (const rel of pageFiles) {
    const url = new URL(rel, pagesUrl)
    const src = await readFile(url, 'utf-8')
    if (src.includes('layouts/ToolBase.astro')) toolBasePages.push([rel, url, src])
  }
  assert.ok(
    toolBasePages.length >= 3,
    `expected the ToolBase routes (tools/[slug] + both driftfield pages), found ${toolBasePages.length}`,
  )

  let checkedIdioms = 0
  for (const [rel, url, src] of toolBasePages) {
    // The page's own markup only. A data-type owned by a rendered .astro
    // component (Breadcrumbs, RelatedLinks, Footer) travels with that
    // component's scoped <style> and is not this page's problem.
    const template = src.split(/^---$/m).slice(2).join('---')
    const reachable = layoutCss + '\n' + astroStyles(src) + '\n' + (await Promise.all(
      [...src.matchAll(/^import\s+['"]([^'"]+\.css)['"]/gm)].map(m => readCss(new URL(m[1], url))),
    )).join('\n')

    for (const idiom of new Set([...template.matchAll(/data-type="([a-z0-9-]+)"/g)].map(m => m[1]))) {
      // Site-level idioms only — one of the two shells' base sheets styles it.
      // A page-scoped name (driftfield-stage, driftfield-story) is styled by the
      // page's own <style> and is nobody else's business.
      if (!stylesIdiom(globalCss, idiom) && !stylesIdiom(baseSharedCss, idiom)) continue
      checkedIdioms++
      assert.ok(
        stylesIdiom(reachable, idiom),
        `src/pages/${rel} renders [data-type="${idiom}"], which only global.css styles — `
        + 'ToolBase does not load global.css, so it renders unstyled there. '
        + 'Move the base rule to src/styles/shared.css (both layouts load it); '
        + 'a higher-specificity Base-only refinement may stay in global.css.',
      )
    }
  }
  assert.ok(
    checkedIdioms >= 3,
    `expected the shared card/lede idioms to be exercised, checked ${checkedIdioms} — `
    + 'if the ToolBase pages stopped rendering site-level idioms this guard asserts nothing',
  )

  // The move is only a fix while shared.css is the base idiom's one home; a
  // re-added copy in global.css would be a second source of truth that drifts.
  for (const idiom of ['card-grid', 'card-title', 'page-intro']) {
    assert.ok(
      stylesIdiom(await readCss(styleUrl('shared.css')), idiom),
      `shared.css must define [data-type="${idiom}"] — both layouts render it`,
    )
  }

  // Source order, not specificity, decides this one: shared.css's :focus-visible
  // and `[data-type="card-grid"] > *` both set border-radius at (0,1,0), so the
  // card's --radius-lg only wins while it is declared later. That relation is
  // what the block had in global.css (imported after shared.css) and moving it
  // must not have flipped it.
  const sharedCss = await readFile(styleUrl('shared.css'), 'utf-8')
  assert.ok(
    sharedCss.indexOf(':focus-visible {') < sharedCss.indexOf('[data-type="card-grid"] > * {'),
    'shared.css declares the card grid before :focus-visible — the focus ring\'s --radius-sm '
    + 'now wins the (0,1,0) tie and squares off every listing card',
  )
}

/* ══════  role: audit (PASS 3) — hiding a section must be a two-way door  ══════

   AGENTS.md, "Indexing: one predicate decides whether a page is real": a
   consumer must READ the predicate, not delete its own signal. `isBlogsPublic`
   is that predicate for the blogs section, and its own docblock promises "flip
   the flag back to `true` to restore the section".

   The sitemap broke that promise in the one direction nothing was watching.
   Hiding the section deleted `{ loc: '/blogs', lastmod }` from staticPages
   outright instead of gating it, so restoring the flag brought back every other
   signal — the nav and footer entry, `index, follow` on both routes, the hub's
   ItemList, and a <loc> for every post — while the hub's own URL stayed gone
   for good. `/blogs` was the only one of the five section hubs the sitemap
   could never list again. `latestPostDate` was left computed-and-unused by that
   same edit, which is the tell that a gate was intended.

   The existing sitemap block above cannot catch this: it only asserts the
   HIDDEN case emits no `/blogs`, which a permanent deletion satisfies
   perfectly. A gate is only a gate if BOTH sides are pinned, so this asserts
   the shown case too — and derives the set from `navLinks()` rather than from a
   list of paths, so the next section hidden this way cannot repeat it. */
{
  const { GET: sitemapGET } = await import('../src/pages/sitemap.xml.ts')

  const sectionSite = on => ({ ...site, sections: { ...site.sections, blogs: on } })
  const localsFor = s => ({
    runtime: {
      env: {
        SITE_CONFIG: {
          get: async key => (key === 'site' ? s : key === 'blogs' ? posts : null),
        },
      },
    },
  })
  // A local post, so "the hub is listed" cannot pass by accident on a slug.
  const posts = [{ title: 'Local', href: '/blogs/a-local-post', date: '2026-02-03', summary: 's' }]

  const shownXml = await (await sitemapGET({ locals: localsFor(sectionSite(true)) })).text()
  const hiddenXml = await (await sitemapGET({ locals: localsFor(sectionSite(false)) })).text()
  const base = site.url.replace(/\/$/, '')
  const locsOf = xml => new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]))
  const shown = locsOf(shownXml)
  const hidden = locsOf(hiddenXml)

  // The derived invariant. Whatever the nav advertises for a given flag state is
  // a page this site claims is real, so the sitemap has to claim it too — the
  // two signals are read by the same crawler and disagreeing is worse than
  // either being absent. Reading navLinks() means a future section gated the
  // same way is covered without editing this block.
  let checkedHubs = 0
  for (const on of [true, false]) {
    const advertised = navLinks(sectionSite(on))
      .map(l => l.href)
      .filter(h => h.startsWith('/'))
    const locs = on ? shown : hidden
    for (const href of advertised) {
      checkedHubs++
      assert.ok(
        locs.has(`${base}${href}`),
        `the nav advertises ${href} with sections.blogs=${on}, but the sitemap does not list it — `
        + 'a section hub delisted in one signal and advertised in another is worse than either alone',
      )
    }
  }
  assert.ok(
    checkedHubs >= 9,
    `expected both flag states to contribute nav hubs, checked ${checkedHubs} — `
    + 'if navLinks stopped returning internal hrefs this guard asserts nothing',
  )

  // …and the flag really is a gate, not a constant, in both directions. Either
  // half alone passes for a wrong reason: a hard-coded hub passes the first, a
  // deleted hub passes the second.
  assert.ok(
    shown.has(`${base}/blogs`),
    'sections.blogs=true must put the /blogs hub back in the sitemap — restoring a hidden '
    + 'section has to restore every signal, or hiding it was a one-way door',
  )
  assert.ok(
    !hidden.has(`${base}/blogs`),
    'sections.blogs=false must drop the /blogs hub from the sitemap',
  )
  // The hub carries the newest post date, the same freshness signal /learnings
  // gets — the orphaned `latestPostDate` is what that line was computed for.
  assert.match(
    shownXml,
    new RegExp(`<loc>${base}/blogs</loc><lastmod>${posts[0].date}</lastmod>`),
    'the restored /blogs hub must carry <lastmod> from the newest post, like /learnings does',
  )
  // Gating the hub must not have disturbed anything else in the document.
  assert.ok(shown.has(`${base}/blogs/a-local-post`), 'gating the hub dropped the posts too')
  for (const hub of ['/', '/projects', '/learnings', '/games', '/tools']) {
    assert.ok(
      hidden.has(hub === '/' ? `${base}/` : `${base}${hub}`),
      `hiding blogs must not remove ${hub} from the sitemap`,
    )
  }
}

console.log('hiding a section is a two-way door: every nav hub is sitemapped in both flag states')

/* ══════  role: consistency — PASS 3  ══════════════════════════════════════════
   The page title has one size, and a tools-lane idiom has one home.

   Two failures of the same shape, one level below the guard above. That guard
   walks `data-type` idioms; a bare ELEMENT rule is invisible to it, and the
   element that mattered was `h1`. `h1 { font-size: var(--text-title) }` lived in
   global.css, which only Base.astro loads — so the tools lane, which every route
   under ToolBase serves, had NO page-title size and grew three dialects instead:

     · eleven tools took 1.75rem — a size that is not a rung of the type scale —
       from `div[data-type="tool-header"] h1`, declared UNSCOPED as two
       byte-identical copies in audio-transcriber.css and draftboard.css. Per-tool
       sheets share one page bundle, so either copy styled all eleven: nine tools
       were sized by files they have nothing to do with, and deleting either copy
       (a change that reads as tidying one tool) would have restyled the nine.
     · Flowmap, Token Bench, the Driftfield hub and its six mode pages matched no
       rule at all and fell to the UA default 2em.
     · every page outside the lane was --text-title.

   Nothing is loud about either. The build is green, `astro check` is silent,
   every page renders, and no two of the three are ever on screen together.

   So both halves are derived, never listed. The shared idioms come from what the
   tool components actually render; the tool-private ones fall out of the same
   count, which is what lets draftboard's `[data-type="md-preview"] h1` — a
   heading inside a rendered markdown document, not the page's title — stay
   sized while the lane-wide one cannot be. */
{
  const toolsUrl = new URL('../src/components/tools/', import.meta.url)
  const pagesUrl = new URL('../src/pages/', import.meta.url)

  // Vite inlines @import at build time, so an imported sheet is as reachable as
  // the sheet that pulls it in — ToolBase reaches theme.css through shared.css.
  // Returns [url, css] pairs so a failure can name the file that broke it.
  const readSheets = async (url, seen = new Set(), out = []) => {
    if (seen.has(url.href)) return out
    seen.add(url.href)
    let css
    try { css = await readFile(url, 'utf-8') } catch { return out }
    out.push([url.href.split('/src/')[1] ?? url.href, css])
    for (const m of css.matchAll(/@import\s+['"]([^'"]+)['"]/g)) {
      await readSheets(new URL(m[1], url), seen, out)
    }
    return out
  }
  const astroStyles = src => [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')
  const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '')
  // Rule blocks as [selector, declarations]. `[^{}]` cannot cross a brace, so an
  // `@media` prelude simply fails to match and the rules nested inside it are
  // picked up on their own — which is what we want to inspect either way.
  const rules = css => [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .flatMap(m => m[1].split(',').map(sel => [sel.trim(), m[2]]))
    .filter(([sel]) => sel && !sel.startsWith('@'))

  // ── What the tools lane renders, counted from the components ───────────────
  const toolDirNames = (await readdir(toolsUrl, { withFileTypes: true }))
    .filter(d => d.isDirectory()).map(d => d.name)
  const renderedBy = new Map()   // data-type -> Set(tool dir)
  const toolSheets = new Map()   // tool dir -> [[file, css]]
  let toolsWithATitle = 0
  for (const dir of toolDirNames) {
    const files = await readdir(new URL(`${dir}/`, toolsUrl))
    let titles = 0
    for (const f of files.filter(x => x.endsWith('.ts'))) {
      const src = await readFile(new URL(`${dir}/${f}`, toolsUrl), 'utf-8')
      for (const m of src.matchAll(/data-type="([a-z0-9-]+)"/g)) {
        if (!renderedBy.has(m[1])) renderedBy.set(m[1], new Set())
        renderedBy.get(m[1]).add(dir)
      }
      titles += [...src.matchAll(/<h1[\s>]/g)].length
    }
    // The h1 rule is only load-bearing while the tools actually render one.
    assert.equal(titles, 1, `${dir} must render exactly one <h1> — its page title`)
    toolsWithATitle++
    toolSheets.set(dir, await Promise.all(
      files.filter(x => x.endsWith('.css'))
        .map(async f => [`${dir}/${f}`, await readFile(new URL(`${dir}/${f}`, toolsUrl), 'utf-8')]),
    ))
  }
  const sharedIdioms = [...renderedBy].filter(([, dirs]) => dirs.size >= 2).map(([id]) => id)
  const privateIdioms = [...renderedBy].filter(([, dirs]) => dirs.size === 1).map(([id]) => id)
  assert.ok(
    toolsWithATitle >= 10 && sharedIdioms.length >= 2 && privateIdioms.length >= 10,
    `derived ${toolsWithATitle} tools, ${sharedIdioms.length} shared and ${privateIdioms.length} private idioms — `
    + 'too few to be checking anything; the markup scan above has stopped finding the tools',
  )

  // ── A shared idiom may not be declared inside one tool's sheet ─────────────
  // This is the leak, stated generally: if two or more tools render it, it is
  // the lane's, and a rule for it that is not scoped to the sheet's own tool
  // reaches every neighbour in the bundle.
  for (const [dir, sheets] of toolSheets) {
    for (const [file, css] of sheets) {
      for (const [sel] of rules(css)) {
        for (const idiom of sharedIdioms) {
          if (!sel.includes(`[data-type="${idiom}"]`)) continue
          assert.ok(
            sel.includes(`[data-tool="${dir}"]`),
            `${file} declares \`${sel}\`, but [data-type="${idiom}"] is rendered by `
            + `${renderedBy.get(idiom).size} tools. Per-tool sheets share one page bundle, so this `
            + `rule silently styles all of them. Move it to tools-common.css, or scope it with `
            + `div[data-tool="${dir}"].`,
          )
        }
      }
    }
  }

  // ── Every ToolBase route, and what CSS it can actually reach ───────────────
  const layoutUrl = new URL('../src/layouts/ToolBase.astro', import.meta.url)
  const layoutSrc = await readFile(layoutUrl, 'utf-8')
  const layoutSheets = [
    ['layouts/ToolBase.astro <style>', astroStyles(layoutSrc)],
    ...(await Promise.all(
      [...layoutSrc.matchAll(/^import\s+['"]([^'"]+\.css)['"]/gm)].map(m => readSheets(new URL(m[1], layoutUrl))),
    )).flat(),
  ]
  const pageFiles = (await readdir(pagesUrl, { recursive: true })).filter(f => f.endsWith('.astro'))
  const toolBaseRoutes = []
  for (const rel of pageFiles) {
    const url = new URL(rel, pagesUrl)
    const src = await readFile(url, 'utf-8')
    if (!src.includes('layouts/ToolBase.astro')) continue
    toolBaseRoutes.push([rel, [
      ...layoutSheets,
      [`pages/${rel} <style>`, astroStyles(src)],
      ...(await Promise.all(
        [...src.matchAll(/^import\s+['"]([^'"]+\.css)['"]/gm)].map(m => readSheets(new URL(m[1], url))),
      )).flat(),
    ]])
  }
  assert.ok(
    toolBaseRoutes.length >= 3,
    `expected the ToolBase routes (tools/[slug] + both driftfield pages), found ${toolBaseRoutes.length}`,
  )

  // A shared idiom needs a home every ToolBase route reaches — shared.css or
  // tools-common.css. Leaving it in one tool's sheet means the driftfield routes,
  // which import neither, never see it.
  const declares = (sheets, needle) => sheets.some(([, css]) =>
    rules(css).some(([sel]) => sel === needle || sel.startsWith(`${needle} `) || sel.startsWith(`${needle}:`)))
  for (const [rel, sheets] of toolBaseRoutes) {
    for (const idiom of sharedIdioms) {
      assert.ok(
        declares(sheets, `div[data-type="${idiom}"]`) || declares(sheets, `[data-type="${idiom}"]`),
        `src/pages/${rel} reaches no rule for [data-type="${idiom}"], which ${renderedBy.get(idiom).size} `
        + 'tools render. A lane-wide idiom belongs in tools-common.css (every ToolBase route imports it) '
        + 'or shared.css (the layout imports it) — not in one tool\'s sheet.',
      )
    }
  }

  // ── The page title: one declaration, reachable from BOTH shells ────────────
  // A rule is allowed to size an h1 only if it IS the page title (bare `h1`), or
  // if it is scoped somewhere that is definitively not the page title: one tool's
  // own subtree. Both exemptions are derived, so neither can be widened by hand.
  const titleH1 = ([sel]) => /^h1(?::[a-z-]+(?:\([^)]*\))?)*$/i.test(sel)
  const toolPrivate = sel => privateIdioms.some(id => sel.includes(`[data-type="${id}"]`))
    || toolDirNames.some(d => sel.includes(`[data-tool="${d}"]`))
  const titleSizes = sheets => {
    const found = []
    for (const [file, css] of sheets) {
      for (const rule of rules(css)) {
        const [sel, decls] = rule
        if (!/(^|[\s>+~])h1$/.test(sel.replace(/:[a-z-]+(\([^)]*\))?$/i, ''))) continue
        const size = decls.match(/(?:^|;)\s*font-size\s*:([^;]+)/)
        if (!size) continue
        if (titleH1(rule)) { found.push([file, size[1].trim()]); continue }
        assert.ok(
          toolPrivate(sel),
          `${file} sizes an h1 through \`${sel}\`, which is not scoped to a single tool. `
          + 'That is the page title, and its size belongs to the bare `h1` rule in shared.css '
          + 'so both shells agree. This is exactly how the tools lane grew a 1.75rem dialect.',
        )
      }
    }
    return found
  }

  const baseSheets = await readSheets(new URL('../src/styles/global.css', import.meta.url))
  const baseTitle = titleSizes(baseSheets)
  assert.equal(
    baseTitle.length, 1,
    `Base.astro reaches ${baseTitle.length} page-title sizes (${JSON.stringify(baseTitle)}); it must reach exactly one`,
  )
  assert.match(
    baseTitle[0][1], /^var\(--text-[a-z-]+\)$/,
    `the page title is sized "${baseTitle[0][1]}" — a literal, not a rung of the type scale in theme.css`,
  )
  assert.ok(
    baseTitle[0][0].endsWith('styles/shared.css'),
    `the page title is declared in ${baseTitle[0][0]}; it must be shared.css, the only sheet BOTH `
    + 'shells load — global.css is invisible to every ToolBase route',
  )
  for (const [rel, sheets] of toolBaseRoutes) {
    const routeTitle = titleSizes(sheets)
    assert.equal(
      routeTitle.length, 1,
      `src/pages/${rel} reaches ${routeTitle.length} page-title sizes (${JSON.stringify(routeTitle)}), not one. `
      + 'None means its <h1> falls to the UA default while every Base page is --text-title; '
      + 'more than one means the lane has started disagreeing with itself again.',
    )
    assert.deepEqual(
      routeTitle[0], baseTitle[0],
      `src/pages/${rel} sizes the page title differently from Base.astro — one <h1>, one size, one declaration`,
    )
  }

  /* ── …and one level further out again: the <body> shell itself ───────────
     Same trap as the page title, one selector up. The whole `body` rule —
     font, colour, page background, and the flex column that pins the footer to
     the bottom — lived in global.css, which only Base loads, so ToolBase
     carried its OWN copy in an `is:global` block. Two copies of a bare element
     rule is the two-dialect setup by construction, and they had already
     drifted: ToolBase's copy set the font, colour and background but NOT
     `display: flex` / `flex-direction: column` / `min-height`, so on every
     tool, game and Driftfield route a page shorter than the viewport left the
     footer floating in the middle with a slab of bare background beneath it.
     Measured, not inferred: /tools/chainsaw in an 1800px viewport ended its
     body at 980px.

     The background made it invisible to a colour check — body's background
     propagates to the canvas, so the PAGE is the right colour either way and
     only the footer's position gives it away.

     So this is derived rather than listed: whatever <body> declarations one
     shell reaches, the other must reach the same ones. A re-added copy in
     either place fails the moment the two disagree, which is the only moment
     it matters. */
  const cssOf = async url => (await readSheets(url)).map(([, css]) => css).join('\n')
  const sharedSheetUrl = new URL('../src/styles/shared.css', import.meta.url)
  const bodyDecls = css => {
    const out = new Map()
    for (const m of stripComments(css).matchAll(/(?:^|\})\s*body\s*\{([^}]*)\}/g)) {
      for (const decl of m[1].split(';')) {
        const i = decl.indexOf(':')
        if (i < 0) continue
        out.set(decl.slice(0, i).trim(), decl.slice(i + 1).trim())
      }
    }
    return Object.fromEntries([...out].sort(([a], [b]) => a < b ? -1 : 1))
  }
  const layoutCssOf = async name => {
    const url = new URL(`../src/layouts/${name}`, import.meta.url)
    const src = await readFile(url, 'utf-8')
    const imported = await Promise.all(
      [...src.matchAll(/^import\s+['"]([^'"]+\.css)['"]/gm)].map(m => cssOf(new URL(m[1], url))),
    )
    return { own: astroStyles(src), all: imported.join('\n') + '\n' + astroStyles(src) }
  }

  const baseShell = await layoutCssOf('Base.astro')
  const toolShell = await layoutCssOf('ToolBase.astro')
  const baseBody = bodyDecls(baseShell.all)
  const toolBody = bodyDecls(toolShell.all)

  // The column, and the two halves of it. Without min-height the body is only
  // as tall as its content; without flex-grow on main the footer sits directly
  // under it. Either one missing strands the footer.
  for (const prop of ['display', 'flex-direction', 'min-height', 'background-color', 'color', 'margin']) {
    assert.ok(
      prop in baseBody,
      `no shell declares body { ${prop} } — this comparison would then pass vacuously`,
    )
  }
  assert.deepEqual(
    toolBody, baseBody,
    'ToolBase and Base reach different <body> rules. body is a bare element rule BOTH shells render, '
    + 'so it belongs in src/styles/shared.css (both load it) and must not be declared in global.css '
    + '(Base-only) or in a layout\'s own <style is:global> block.',
  )

  // …and the rule must live in the shared sheet rather than being duplicated
  // into both shells, which would satisfy the equality above while keeping two
  // copies to drift.
  assert.ok(
    Object.keys(bodyDecls(await cssOf(sharedSheetUrl))).length > 0,
    'shared.css must own the body rule — both layouts load it, and it is the only home that cannot drift',
  )
  for (const [name, css] of [['Base.astro', baseShell.own], ['ToolBase.astro', toolShell.own]]) {
    assert.deepEqual(
      bodyDecls(css), {},
      `${name} declares its own body rule — that is the second copy this guard exists to prevent`,
    )
  }
  assert.ok(
    /(?:^|\})\s*main\s*\{[^}]*flex:\s*1 0 auto/.test(stripComments(await cssOf(sharedSheetUrl))),
    'shared.css must give main `flex: 1 0 auto` — the other half of the column that pins the footer down',
  )
}

console.log('one page-title size site-wide, no tools-lane idiom declared inside a single tool, and both shells reach the same <body> column')

/* ══════  role: audit — one card title, and the card IS the link  ══════

   The design audit of 2026-09-24 measured the card title on all five hubs
   that render [data-type="card-grid"] and found FOUR different treatments:
   /tools at 20.8px/600 from its own tools.css override, /games and /projects
   at 16px/700 from a global.css refinement, and /learnings and
   /tools/driftfield at 16px/400 — matching no weight rule at all, which left
   their card titles identical in size AND weight to the description beneath
   them. Two of five hubs had no hierarchy inside the card whatsoever.

   That is the `h1` three-dialects bug from AGENTS.md recurring one level
   down, and for the same reason: the shared base declared LESS than every
   consumer needed (font-weight: inherit), so each consumer patched it
   locally and the patches disagreed. The base now sets the weight, and the
   rule is that nothing else may.

   Derived from the stylesheets rather than from a list of hubs, so a sheet
   added later cannot reintroduce a dialect without failing here. */
{
  const cssFiles = []
  const walkCss = async (dir) => {
    for (const e of await readdir(new URL(dir, import.meta.url), { withFileTypes: true })) {
      if (e.isDirectory()) await walkCss(`${dir}${e.name}/`)
      else if (e.name.endsWith('.css')) cssFiles.push(`${dir}${e.name}`)
    }
  }
  await walkCss('../src/')
  assert.ok(cssFiles.length > 5, `expected to find the stylesheets, found ${cssFiles.length}`)

  // Rule blocks as [selector, declarations]; `[^{}]` cannot cross a brace, so
  // an at-rule's own braces end a match rather than swallowing the file.
  // Comments are stripped FIRST: they contain no braces, so the selector
  // capture would otherwise absorb every comment block above a rule and no
  // selector would ever compare equal to its own text.
  const rules = (css) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(m => [m[1].trim(), m[2]])

  const sharedPath = '../src/styles/shared.css'
  const sharedCss = await readFile(new URL(sharedPath, import.meta.url), 'utf-8')

  // ── the base declares the weight, in exactly one place ──
  const baseTitle = rules(sharedCss).filter(([sel]) => sel === '[data-type="card-title"]')
  assert.equal(baseTitle.length, 1, 'shared.css declares the base [data-type="card-title"] rule exactly once')
  assert.ok(/font-weight\s*:/.test(baseTitle[0][1]),
    'the base card-title rule must set font-weight — leaving it `inherit` is what let five hubs disagree')

  // ── and nothing else sizes or weights a card title ──
  const dialects = []
  for (const file of cssFiles) {
    if (file === sharedPath) continue
    const css = await readFile(new URL(file, import.meta.url), 'utf-8')
    for (const [sel, decl] of rules(css)) {
      if (!/card-title|tool-name/.test(sel)) continue
      for (const prop of ['font-size', 'font-weight']) {
        if (new RegExp(`(^|[;\\s])${prop}\\s*:`).test(decl)) dialects.push(`${file}: ${sel} sets ${prop}`)
      }
    }
  }
  assert.deepEqual(dialects, [],
    'only shared.css may size or weight a card title — these sheets declare their own dialect:\n  '
    + dialects.join('\n  '))

  /* ── The whole card is the click target, and that rests on two rules ──
     The card frame lights up on :hover and :focus-within, which promised an
     affordance only the ~29px title link actually had — 11% of a 326x156
     card. A stretched ::after on the title fixes it, but it is load-bearing
     in a way that fails SILENTLY and catastrophically: without
     `position: relative` on the card, the absolutely-positioned ::after
     escapes to the nearest positioned ancestor and covers the PAGE, making
     one tool's link swallow every click on the document. */
  const cardBlocks = rules(sharedCss).filter(([sel]) => sel === '[data-type="card-grid"] > *')
  assert.equal(cardBlocks.length, 1, 'shared.css declares the card block exactly once')
  assert.ok(/position\s*:\s*relative/.test(cardBlocks[0][1]),
    'the card must stay `position: relative` — it is the containing block for the stretched title link, '
    + 'and without it that ::after covers the whole page')

  const stretch = rules(sharedCss).find(([sel]) => /card-title"\]\s+a::after/.test(sel))
  assert.ok(stretch, 'shared.css must stretch the card title link across the card with an ::after')
  assert.ok(/position\s*:\s*absolute/.test(stretch[1]) && /inset\s*:\s*0/.test(stretch[1]),
    'the stretched link is `position: absolute; inset: 0` — anything else does not cover the card')

  /* A card may carry links AFTER its title — 5 of the 11 /projects cards do
     (repo, stars, forks). They come later in the DOM than the title, so
     `position: relative` is enough to lift them above the stretched ::after.
     Drop this rule and those links stop being clickable while still looking
     like links, which is invisible in a screenshot. */
  const raise = rules(sharedCss).find(([sel]) => /card-grid"\]\s*>\s*\*\s+a:not\(/.test(sel))
  assert.ok(raise && /position\s*:\s*relative/.test(raise[1]),
    "a card's secondary links must be raised above the stretched title link, or they stop being clickable")
}

/* ══════  role: audit — the "server" badge cannot outlive its server  ══════

   /tools is a grid of sixteen cards in which Chainsaw and a Base64 encoder
   carried identical visual weight, while the page intro claimed "four need a
   real server" and marked none of them. SERVER_TOOLS (src/lib/tools.ts) is
   that claim made checkable.

   Two ways it goes stale, both asserted: a tool keeps the badge after losing
   the route that justified it, and — the sneakier one — a fifth server tool
   ships while the intro still says "four". The number in the prose is read
   out of the prose, so the copy and the code cannot drift apart silently.
   Same rule as the learnings articles that quote numbers from a component. */
{
  const bySlug = new Map(tools.map(t => [t.slug, t]))
  assert.ok(SERVER_TOOLS.size > 0, 'SERVER_TOOLS is not empty — an empty set would assert nothing below')

  for (const slug of SERVER_TOOLS) {
    const tool = bySlug.get(slug)
    assert.ok(tool, `SERVER_TOOLS names "${slug}", which is not a tool in the config`)
    assert.equal(tool.status, 'live',
      `SERVER_TOOLS names "${slug}", whose status is "${tool.status}" — only a live tool can carry the badge`)

    // The badge claims a server round-trip, so the component has to make one.
    const dir = `../src/components/tools/${slug}/`
    const files = await readdir(new URL(dir, import.meta.url))
    let callsApi = false
    for (const f of files.filter(f => f.endsWith('.ts'))) {
      if (/['"`]\/api\//.test(await readFile(new URL(dir + f, import.meta.url), 'utf-8'))) callsApi = true
    }
    assert.ok(callsApi,
      `SERVER_TOOLS names "${slug}" but nothing in its component calls an /api/ route — `
      + 'the badge would be claiming a server this tool does not use')
  }

  assert.equal(isServerTool('json-tidy'), false, 'a browser-only tool is not a server tool')

  // ── the intro's number is the set's size, read from the prose ──
  const hubSrc = await readFile(new URL('../src/pages/tools/index.astro', import.meta.url), 'utf-8')
  const intro = hubSrc.slice(hubSrc.indexOf('data-type="page-intro"'), hubSrc.indexOf('</p>'))
  const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }
  // Pinned to the CLAIM, not to "the first number word in the intro" — that
  // version matched "three DNS resolvers" further down the same sentence and
  // compared it against the set size, which is the exact shape of bug these
  // assertions exist to catch.
  const claim = intro.match(/\b([a-z]+)\s+need\s+a\s+real\s+server\b/i)
  assert.ok(claim, 'the /tools intro still states, in words, how many tools "need a real server"')
  const claimed = WORDS[claim[1].toLowerCase()]
  assert.ok(claimed, `the intro says "${claim[1]} need a real server" — expected a number word`)
  assert.equal(claimed, SERVER_TOOLS.size,
    `the /tools intro says "${claim[1]}" need a real server but SERVER_TOOLS has ${SERVER_TOOLS.size} — `
    + 'update the copy and the set together')

  // …and the hub only badges a live server tool, never a wip or external one.
  assert.ok(/tool\.status === 'live' && isServerTool\(tool\.slug\)/.test(hubSrc),
    'the hub gates the server badge on BOTH live status and SERVER_TOOLS membership')
}
console.log('one card title site-wide, the whole card is its link (secondary links survive), and the server badge matches both its routes and the intro\'s number')

// ═══════════════════════════════════════════════════════════════════════════
// ROLE `tools` — Token Bench: why a signature did not verify.
//
// `src/lib/jwt.ts` is asserted above and answers one question with a boolean.
// This block asserts the module that answers the NEXT one, and the property it
// has to hold is the same shape as the rules the rest of this file protects:
//
//   **a diagnosis must not supply the terms of its own proof.**
//
// A diagnostician that guesses is worse than none, because it is read as an
// answer. So `proof: 'verified'` is a claim that `diagnoseVerification` changed
// exactly one input and watched real Web Crypto return true — and the assertion
// that matters most here is the negative one: given a key that is simply wrong,
// it must report NO proved cause at all rather than reaching for the nearest
// plausible story. Every token below is signed here with node's Web Crypto, so
// no assertion can pass by the module agreeing with itself.
// ═══════════════════════════════════════════════════════════════════════════
{
  const {
    diagnoseVerification,
    inspectTokenText,
    tbDerToRawEcdsa,
    tbEcdsaCoordLen,
  } = await import('../src/components/tools/token-bench/diagnose.ts')
  const { verifyJwt: tbVerify, parseJwt: tbParse } = await import('../src/lib/jwt.ts')

  const tbB64u = bytes => Buffer.from(bytes).toString('base64url')
  const tbSeg = value => tbB64u(JSON.stringify(value))
  const tbIds = findings => findings.map(f => f.id)
  const tbProved = findings => findings.filter(f => f.proof === 'verified')

  const tbHmacToken = async (alg, hash, keyBytes, header = {}, payload = { sub: 'x' }) => {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash }, false, ['sign'])
    const signingInput = `${tbSeg({ alg, ...header })}.${tbSeg(payload)}`
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'HMAC' }, key, new TextEncoder().encode(signingInput)))
    return { token: `${signingInput}.${tbB64u(sig)}`, signingInput, sig }
  }
  const tbEcToken = async (pair, header = {}, payload = { sub: 'z' }) => {
    const signingInput = `${tbSeg({ alg: 'ES256', ...header })}.${tbSeg(payload)}`
    const raw = new Uint8Array(await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(signingInput),
    ))
    return { signingInput, raw, token: `${signingInput}.${tbB64u(raw)}` }
  }
  const tbPublicJwk = async pair => {
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
    delete jwk.key_ops
    delete jwk.ext
    return jwk
  }
  const tbNewEc = () => crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])

  // ── THE NEGATIVE. A wrong key has no explanation, and inventing one would
  // make every other line the tool prints worth less. This is the assertion the
  // whole module is written around; if it ever goes green while a hypothesis
  // has started guessing, the module has stopped being trustworthy.
  const tbWrongKey = JSON.stringify({ kty: 'oct', k: tbB64u(crypto.getRandomValues(new Uint8Array(32))) })
  const tbRfc = 'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9'
    + '.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ'
    + '.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
  assert.deepEqual(
    tbProved(await diagnoseVerification({ rawToken: tbRfc, alg: 'HS256', keyText: tbWrongKey })),
    [],
    'a simply-wrong key must yield NO proved cause — the diagnosis may not guess',
  )

  // …and every hypothesis it DOES prove must survive being applied. Re-verify
  // each proved finding independently rather than believing the flag.
  const tbAssertProof = async (findings, id, token, alg, keyText) => {
    const hit = findings.find(f => f.id === id)
    assert.ok(hit, `expected the diagnosis to include ${id}, got ${JSON.stringify(tbIds(findings))}`)
    assert.equal(hit.proof, 'verified', `${id} claims to be proved`)
    if (hit.fixedToken) {
      assert.equal(
        await tbVerify(tbParse(hit.fixedToken), alg, keyText), true,
        `${id} hands back a "corrected" token that does not actually verify`,
      )
    }
    return hit
  }

  // ── 1. Re-encoded in transit. `+`/`/` decode to the same BYTES, which is why
  // this one fools people: the JSON reads back perfectly and the signature
  // still fails, because it covers the exact CHARACTERS of `header.payload`.
  const tbRfcKey = JSON.stringify({
    kty: 'oct',
    k: 'AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow',
  })
  const tbMangled = `Bearer ${tbRfc.replace(/-/g, '+').replace(/_/g, '/').replace(/(.{40})/g, '$1\n')}`
  const tbShape = inspectTokenText(tbMangled)
  assert.deepEqual(
    tbIds(tbShape.findings), ['bearer-prefix', 'embedded-whitespace', 'standard-base64-alphabet'],
    'the paste lint names all three manglings, and does it with no key at all',
  )
  assert.equal(tbShape.normalized, tbRfc, 'and reconstructs the original token exactly')
  await tbAssertProof(
    await diagnoseVerification({ rawToken: tbMangled, alg: 'HS256', keyText: tbRfcKey }),
    'proved-mangled-token', tbMangled, 'HS256', tbRfcKey,
  )
  // The lint is not the diagnosis: it must fire before anyone presses verify,
  // because "Bearer eyJ…" splits into three parts and then reports the HEADER
  // as invalid base64url, which explains nothing.
  assert.deepEqual(tbIds(inspectTokenText('a.b.c.d.e').findings), ['jwe-not-jws'])
  assert.deepEqual(tbIds(inspectTokenText('a.b').findings), ['missing-signature-segment'])
  assert.deepEqual(inspectTokenText(tbRfc).findings, [], 'a clean token lints clean')

  // …and the lint can never claim a PROOF. `inspectTokenText` takes one string,
  // holds no key and makes no crypto call, so there is nothing it could have
  // re-verified: every finding it can emit is a fact about the bytes. The ids
  // above are pinned but the `proof` field was not, which let a lint finding be
  // dressed as `verified` — the exact confusion the whole module exists to
  // refuse, wearing the one hat that cannot possibly earn it. Derived by
  // sweeping every lint branch rather than by listing them, so a lint added
  // later is covered without editing this.
  const tbLintSamples = [
    tbMangled, 'a.b.c.d.e', 'a.b', tbRfc, '', '   ', 'not-a-token',
    `Bearer   ${tbRfc}  `, `${tbRfc}.extra`, tbRfc.replace(/-/g, '+'),
  ]
  const tbLintFindings = tbLintSamples.flatMap(s => inspectTokenText(s).findings)
  assert.ok(tbLintFindings.length >= 6, 'the lint sweep must actually reach some findings')
  for (const f of tbLintFindings) {
    assert.equal(
      f.proof, 'structural',
      `the paste lint reported "${f.id}" as proof:"${f.proof}". inspectTokenText never sees a key `
      + 'and never runs a crypto check, so it cannot have PROVED anything — every lint finding is '
      + 'structural. A `verified` here is the tool guessing under the one label it promises never to guess with.',
    )
  }

  // ── 2. The secret is stored encoded. Two different keys, and which one your
  // library uses is its decision — not something the token can tell you.
  const tbSecretBytes = crypto.getRandomValues(new Uint8Array(32))
  const tbEncoded = await tbHmacToken('HS256', 'SHA-256', tbSecretBytes)
  for (const [id, keyText] of [
    ['proved-secret-base64', Buffer.from(tbSecretBytes).toString('base64')],
    ['proved-secret-hex', Buffer.from(tbSecretBytes).toString('hex')],
  ]) {
    assert.equal(
      await tbVerify(tbParse(tbEncoded.token), 'HS256', keyText), false,
      'the literal characters are genuinely not the key — otherwise the hypothesis is vacuous',
    )
    await tbAssertProof(
      await diagnoseVerification({ rawToken: tbEncoded.token, alg: 'HS256', keyText }),
      id, tbEncoded.token, 'HS256', keyText,
    )
  }

  // ── 3. Right key, wrong algorithm.
  const tbWrongAlg = await tbHmacToken('HS512', 'SHA-512', new TextEncoder().encode('shhh'))
  await tbAssertProof(
    await diagnoseVerification({ rawToken: tbWrongAlg.token, alg: 'HS256', keyText: 'shhh' }),
    'proved-algorithm-mismatch', tbWrongAlg.token, 'HS256', 'shhh',
  )

  // ── 4. ECDSA signature encoding. RFC 7518 §3.4 wants r‖S left-padded to the
  // coordinate width; OpenSSL, Go's crypto/ecdsa and most Java signers emit
  // ASN.1 DER, and every JWT library then says "invalid signature" and stops.
  assert.equal(tbEcdsaCoordLen('ES512'), 66, 'ES512 is P-521 — 66 bytes a side, not 64')
  assert.equal(tbEcdsaCoordLen('ES256'), 32)
  assert.equal(tbEcdsaCoordLen('HS256'), null)

  const tbRawToDer = raw => {
    const trim = value => {
      let start = 0
      while (start < value.length - 1 && value[start] === 0) start++
      const out = value.subarray(start)
      return out[0] & 0x80 ? Uint8Array.from([0, ...out]) : out
    }
    const r = trim(raw.subarray(0, raw.length / 2))
    const s = trim(raw.subarray(raw.length / 2))
    const body = [0x02, r.length, ...r, 0x02, s.length, ...s]
    return Uint8Array.from(body.length > 127 ? [0x30, 0x81, body.length, ...body] : [0x30, body.length, ...body])
  }

  const tbEc = await tbNewEc()
  const tbEcJwk = await tbPublicJwk(tbEc)
  const tbEcSigned = await tbEcToken(tbEc)
  const tbDer = tbRawToDer(tbEcSigned.raw)
  assert.deepEqual(
    Array.from(tbDerToRawEcdsa(tbDer, 32)), Array.from(tbEcSigned.raw),
    'DER → r‖s round-trips to the exact signature Web Crypto produced',
  )
  // The DER reader must be strict, or a plain wrong-key failure gets narrated
  // as an encoding bug. A trailing byte, a truncation, and 64 random bytes that
  // merely start 0x30 are all rejected.
  assert.equal(tbDerToRawEcdsa(Uint8Array.from([...tbDer, 0]), 32), null, 'trailing byte is not DER')
  assert.equal(tbDerToRawEcdsa(tbDer.subarray(0, tbDer.length - 1), 32), null, 'truncated DER is not DER')
  let tbFooled = 0
  for (let i = 0; i < 2000; i++) {
    const noise = crypto.getRandomValues(new Uint8Array(64))
    noise[0] = 0x30
    if (tbDerToRawEcdsa(noise, 32)) tbFooled++
  }
  assert.equal(tbFooled, 0, `${tbFooled}/2000 random 0x30-prefixed signatures were misread as DER`)

  const tbDerToken = `${tbEcSigned.signingInput}.${tbB64u(tbDer)}`
  const tbDerKey = JSON.stringify(tbEcJwk)
  assert.equal(await tbVerify(tbParse(tbDerToken), 'ES256', tbDerKey), false, 'a DER-signed JWS does not verify, per spec')
  await tbAssertProof(
    await diagnoseVerification({ rawToken: tbDerToken, alg: 'ES256', keyText: tbDerKey }),
    'proved-der-ecdsa-signature', tbDerToken, 'ES256', tbDerKey,
  )
  // DER *and* the wrong key: the encoding fact still holds — it needs no key —
  // but it must drop to `structural`, because nothing was proved.
  const tbOtherJwk = JSON.stringify(await tbPublicJwk(await tbNewEc()))
  const tbDerWrong = await diagnoseVerification({ rawToken: tbDerToken, alg: 'ES256', keyText: tbOtherJwk })
  assert.deepEqual(tbIds(tbDerWrong), ['der-ecdsa-signature'])
  assert.equal(tbDerWrong[0].proof, 'structural', 'an unproved cause is never dressed as a proved one')

  // The same token against a JWKS whose matching key is NOT first. The hypothesis
  // used to take keys[0], so it tested a key the token never named: after an
  // ordinary rotation it reported the encoding "is not the only problem" about a
  // key that was never wrong, and varied two inputs at once. Every assertion above
  // uses a bare JWK, where keys[0] and the kid-resolved key are the same object,
  // so none of them could see it. Resolution matches src/lib/jwt.ts.
  {
    // Its own token, because the fixture above names no kid — and a kid is the
    // whole point here: it is what tells the diagnosis WHICH key to test.
    const tbKidSigned = await tbEcToken(tbEc, { kid: 'signing-key' })
    const tbKidDerToken = `${tbKidSigned.signingInput}.${tbB64u(tbRawToDer(tbKidSigned.raw))}`
    const tbDecoyJwk = await tbPublicJwk(await tbNewEc())
    const tbRotated = JSON.stringify({
      keys: [{ ...tbDecoyJwk, kid: 'retired-key' }, { ...tbEcJwk, kid: 'signing-key' }],
    })
    const tbFromJwks = await diagnoseVerification({
      rawToken: tbKidDerToken, alg: 'ES256', keyText: tbRotated,
    })
    await tbAssertProof(tbFromJwks, 'proved-der-ecdsa-signature', tbKidDerToken, 'ES256', tbRotated)
  }

  // …and when NO key can be imported at all, the branch must not state a negative.
  // `if (!jwk) return false` and `catch { return false }` collapsed "could not
  // test" into "tested and failed", and the detail then claimed "the converted
  // form still does not verify against this key" for a PEM paste — no key
  // imported, crypto.subtle.verify never called. That is the one thing this
  // module promises never to do.
  for (const [what, keyText] of [
    ['a PEM public key', '-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE\n-----END PUBLIC KEY-----'],
    ['a JWKS naming no matching kid', JSON.stringify({ keys: [
      { ...(await tbPublicJwk(await tbNewEc())), kid: 'nope-1' },
      { ...(await tbPublicJwk(await tbNewEc())), kid: 'nope-2' },
    ] })],
  ]) {
    const untestable = await diagnoseVerification({ rawToken: tbDerToken, alg: 'ES256', keyText })
    const der = untestable.find(f => f.id.includes('der-ecdsa-signature'))
    assert.ok(der, `the encoding fact still holds with ${what} — it needs no key`)
    assert.equal(der.proof, 'structural', `${what} proves nothing`)
    assert.ok(
      !/still does not verify/.test(der.detail),
      `with ${what} nothing was verified, so the detail must not claim the converted form failed`,
    )
  }

  // ── 5. Algorithm confusion, the attack this tool exists to talk about: a
  // token that claims HMAC while you hold a PUBLIC key is a forgery anyone who
  // can read the JWKS could have written.
  const tbRsa = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  )
  const tbRsaText = JSON.stringify(await tbPublicJwk(tbRsa))
  const tbForged = await tbHmacToken('HS256', 'SHA-256', new TextEncoder().encode(tbRsaText), {}, { sub: 'admin' })
  const tbConfusion = await diagnoseVerification({ rawToken: tbForged.token, alg: 'RS256', keyText: tbRsaText })
  assert.ok(tbConfusion.some(f => f.id === 'proved-algorithm-confusion'), 'a forgery is named as one')
  assert.match(
    tbConfusion.find(f => f.id === 'proved-algorithm-confusion').title, /ALGORITHM CONFUSION/,
    'and named in the verdict text, not only in a data attribute',
  )
  // The shape alone is reportable without proof: an HS token beside a public
  // key is illegitimate whether or not THIS key was the secret used.
  const tbShapeOnly = await diagnoseVerification({
    rawToken: (await tbHmacToken('HS256', 'SHA-256', new TextEncoder().encode('unrelated'))).token,
    alg: 'RS256',
    keyText: tbRsaText,
  })
  const tbShapeHit = tbShapeOnly.find(f => f.id === 'algorithm-confusion-shape')
  assert.ok(tbShapeHit, 'the confusion SHAPE is reported even when no forgery is proved')
  assert.equal(tbShapeHit.proof, 'structural')

  // ── 6. A JWKS that holds the key but not under the kid the header names.
  // Resolving the key out of a set is this tool's stated speciality, and the
  // reverse lookup — which kid DOES verify — is what a rotation looks like.
  const tbRotated = await tbNewEc()
  const tbRotatedJwk = await tbPublicJwk(tbRotated)
  const tbKidToken = await tbEcToken(tbRotated, { kid: 'old-2023' }, { sub: 'k' })
  const tbJwks = JSON.stringify({ keys: [{ ...tbEcJwk, kid: 'current' }, { ...tbRotatedJwk, kid: 'rotated-in' }] })
  const tbKidFindings = await diagnoseVerification({ rawToken: tbKidToken.token, alg: 'ES256', keyText: tbJwks })
  const tbKidHit = await tbAssertProof(tbKidFindings, 'proved-wrong-kid', tbKidToken.token, 'ES256', tbJwks)
  assert.match(tbKidHit.title, /rotated-in/, 'it names the kid that actually verifies, not just the one that failed')

  // A stale set that holds no working key reports the absence and stops. Note
  // what it must NOT do: pick a key anyway. `importVerificationKey` refuses the
  // same way, and this is the diagnosis half of that same refusal.
  const tbStale = JSON.stringify({ keys: [{ ...tbEcJwk, kid: 'a' }, { ...(await tbPublicJwk(await tbNewEc())), kid: 'b' }] })
  const tbStaleFindings = await diagnoseVerification({ rawToken: tbKidToken.token, alg: 'ES256', keyText: tbStale })
  assert.deepEqual(tbIds(tbStaleFindings), ['kid-not-in-jwks'])
  assert.deepEqual(tbProved(tbStaleFindings), [], 'a set with no working key proves nothing')

  // ── 7. Every finding is plain text and stays plain text. The component
  // renders these with textContent, and the strings interpolate `kid` and `alg`
  // straight out of an attacker-controlled header — a JWT payload is hostile by
  // definition, that is the whole reason someone is inspecting it.
  const tbHostileKid = '</script><img src=x onerror=alert(1)>'
  const tbHostile = await tbEcToken(tbRotated, { kid: tbHostileKid }, { sub: '"><b>' })
  const tbHostileFindings = await diagnoseVerification({
    rawToken: tbHostile.token, alg: 'ES256', keyText: JSON.stringify({ keys: [{ ...tbEcJwk, kid: 'x' }] }),
  })
  for (const finding of tbHostileFindings) {
    assert.equal(typeof finding.title, 'string')
    assert.equal(typeof finding.detail, 'string')
    assert.equal(typeof finding.id, 'string')
    assert.ok(['verified', 'structural'].includes(finding.proof), 'proof is one of exactly two values')
  }
  const tbBench = await readFile(new URL('../src/components/tools/token-bench/TokenBench.ts', import.meta.url), 'utf8')
  assert.ok(
    !/innerHTML\s*=\s*[^`]*finding/i.test(tbBench),
    'findings must never reach innerHTML — they carry values copied out of a hostile token header',
  )
  assert.match(
    tbBench, /textContent = finding\.title/,
    'the finding title is rendered as text',
  )
  assert.match(
    tbBench, /textContent = finding\.detail/,
    'the finding detail is rendered as text',
  )
}

console.log('token bench proves every cause it reports, and reports none it cannot prove')

/* ────────  Poker Trainer: the solve memo, and a ceiling that counts work  ──────── */
//
// Appended by the `games` role. Two claims, and both are the same shape as the
// one `scoreBest` already carries against `evaluateBest`: a fast path is only
// ever allowed to agree with the slow one that defines the answer.
//
//   1. `engine/equity-cache.ts` returns exactly what `engine/equity.ts` returns.
//      A wrong memo does not crash — it hands back a confident percentage
//      belonging to a different spot — so nothing but an equality check finds it.
//   2. `handsRanked()` is the ceiling's unit, because the old one counted boards
//      and boards are not what takes the time. Pre-flop Omaha is FEWER boards
//      than pre-flop Hold'em (1,086,008 against 1,712,304) and roughly twenty
//      times the work, so a boards ceiling that admits one must refuse the other
//      for a reason that is not true.
{
  const {
    countRunouts: ecCountRunouts,
    equityVsRange: ecEquityVsRange,
    exactEquity: ecExactEquity,
    handsRanked,
  } = await import('../src/components/games/poker-trainer/engine/equity.ts')
  const {
    EQUITY_CACHE_LIMIT,
    cachedEquityVsRange,
    cachedExactEquity,
    cachedRangeCombos,
    clearEquityCache,
    equityCacheSizes,
    spotKey,
  } = await import('../src/components/games/poker-trainer/engine/equity-cache.ts')
  const { PRESET_RANGES: EC_PRESETS, parseRange: ecParseRange, rangeCombos: ecRangeCombos } =
    await import('../src/components/games/poker-trainer/engine/ranges.ts')
  const ecSrc = await readFile(
    new URL('../src/components/games/poker-trainer/PokerTrainer.ts', import.meta.url),
    'utf-8',
  )

  const EC_RANKS = '23456789TJQKA'
  const ec = text => ({ r: EC_RANKS.indexOf(text[0].toUpperCase()) + 2, s: text[1].toLowerCase() })
  const ecHand = text => text.split(' ').map(ec)
  const plain = value => JSON.parse(JSON.stringify(value))

  /* ── 1. the memo equals the reference, on every spot shape the UI reaches ── */

  clearEquityCache()
  const ecSpots = [
    [[ecHand('As Ks'), ecHand('Qh Qd')], ecHand('2c 7d Jh'), 'holdem'],
    [[ecHand('As Ks'), ecHand('Qh Qd')], ecHand('2c 7d Jh 9s'), 'holdem'],
    [[ecHand('As Ks'), ecHand('Qh Qd')], ecHand('2c 7d Jh 9s 4d'), 'holdem'],
    [[ecHand('As Ks Qh Jd'), ecHand('2c 3d 4h 5s')], ecHand('9c 8d Th'), 'plo'],
    [[ecHand('As Ks Qh Jd'), ecHand('2c 3d 4h 5s')], ecHand('9c 8d Th 2h'), 'plo'],
  ]
  for (const [holes, board, variant] of ecSpots) {
    const reference = ecExactEquity(holes, board, variant)
    const memoised = cachedExactEquity(holes, board, variant)
    assert.deepEqual(
      plain(memoised), plain(reference),
      `the memo disagrees with exactEquity on a ${variant} spot with ${board.length} board cards`,
    )
    assert.equal(
      cachedExactEquity(holes, board, variant), memoised,
      'asking for the same spot twice recomputed it — the memo is not memoising',
    )

    // Clicking A♠ then K♥ and clicking K♥ then A♠ are the same spot. The memo
    // canonicalises to make the second one a hit, which is only sound because
    // the engine is genuinely order-blind — `scoreBest` reads bitmasks,
    // `scoreOmaha` walks every 2-of-4 and 3-of-5 whatever order they arrive in,
    // and `remainingDeck` filters a fixed deck. Assert BOTH halves: that the
    // reference really is invariant, and that the memo exploits it. Asserting
    // only the second would let a canonicalisation bug pass by being wrong
    // consistently.
    const permuted = holes.map(hand => [...hand].reverse())
    const permutedBoard = [...board].reverse()
    assert.deepEqual(
      plain(ecExactEquity(permuted, permutedBoard, variant)), plain(reference),
      'exactEquity is not invariant to card order within a hand — the memo key must not sort',
    )
    assert.equal(
      cachedExactEquity(permuted, permutedBoard, variant), memoised,
      'the same spot picked in a different order missed the memo',
    )
  }

  // Hands are canonicalised individually and NEVER against each other: the
  // result is index-aligned, so a key that sorted the two hands together would
  // hand hero villain's equity and look entirely plausible doing it.
  assert.notEqual(
    spotKey([ecHand('As Ks'), ecHand('Qh Qd')], [], 'holdem'),
    spotKey([ecHand('Qh Qd'), ecHand('As Ks')], [], 'holdem'),
    'the memo key treats hero-vs-villain and villain-vs-hero as one spot — the equities would swap',
  )
  assert.notEqual(
    spotKey([ecHand('As Ks Qh Jd'), ecHand('2c 3d 4h 5s')], ecHand('9c 8d Th'), 'plo'),
    spotKey([ecHand('As Ks Qh Jd'), ecHand('2c 3d 4h 5s')], ecHand('9c 8d Th'), 'holdem'),
    'the memo key ignores the variant — the same four cards score differently under Omaha rules',
  )

  /* ── the range half, which is where the seconds actually were ── */

  clearEquityCache()
  const ecBoard = ecHand('2c 7d Jh')
  const ecHero = ecHand('As Ks')
  for (const preset of EC_PRESETS.filter(p => ['premium', 'three-bet'].includes(p.id))) {
    const dead = [...ecHero, ...ecBoard]
    const parsed = cachedRangeCombos(preset.text, dead)
    assert.deepEqual(
      plain(parsed.combos), plain(ecRangeCombos(ecParseRange(preset.text).classes, dead)),
      `the range memo disagrees with parseRange + rangeCombos on "${preset.id}"`,
    )
    assert.equal(
      cachedRangeCombos(preset.text, [...ecBoard, ...ecHero]), parsed,
      'the same range with the dead cards listed in another order missed the memo',
    )

    const reference = ecEquityVsRange(ecHero, parsed.combos, ecBoard)
    const memoised = cachedEquityVsRange(ecHero, parsed.combos, ecBoard)
    assert.deepEqual(
      plain(memoised), plain(reference),
      `the memo disagrees with equityVsRange on "${preset.id}"`,
    )
    assert.equal(
      cachedEquityVsRange(ecHero, parsed.combos, ecBoard), memoised,
      'the same range query recomputed — the range memo is not memoising',
    )
  }

  // Everything above varies ONLY the range text — one hero, one board, one dead
  // set. That is not enough: the combos are parsed with `dead = [...hero,
  // ...board]`, so varying the hero or the board ALSO varies the combo list, and
  // a key derived from the combos alone still tells those spots apart. The first
  // version of this block did exactly that and was vacuous — the mutation that
  // drops `spotKey` from the key survived it.
  //
  // The discriminating case is one FIXED combo list handed to different spots,
  // which is also the call the rule in AGENTS.md describes: the key is derived
  // from the combos it was handed, and must still carry the hero and board.
  // A wrong memo does not crash — it returns a confident percentage belonging to
  // a different spot.
  {
    clearEquityCache()
    const villain = [ecHand('Qh Qd')]                        // blocks none of the below
    const spots = [
      { hero: ecHand('As Ks'), board: ecHand('2c 7d Jh') },
      { hero: ecHand('9h 9d'), board: ecHand('2c 7d Jh') },  // same board, other hero
      { hero: ecHand('As Ks'), board: ecHand('3c 4d 5h') },  // same hero, other board
    ]
    const answers = spots.map(({ hero, board }) => {
      const memoised = cachedEquityVsRange(hero, villain, board)
      assert.deepEqual(
        plain(memoised), plain(ecEquityVsRange(hero, villain, board)),
        'the memo disagrees with equityVsRange once hero or board varies',
      )
      return memoised.equity
    })
    assert.notDeepEqual(
      answers[0], answers[1],
      'AKs and 99 against the same range on the same board returned the SAME equity — the memo key ignores the hero',
    )
    assert.notDeepEqual(
      answers[0], answers[2],
      'the same hand on two different boards returned the SAME equity — the memo key ignores the board',
    )
  }

  /* ── bounded, and still correct after eviction ── */

  clearEquityCache()
  const river = ecHand('2c 7d Jh 9s 4d')
  const ecVillain = [ec('Qc'), ec('Qs')]
  const ecDead = new Set([...river, ...ecVillain].map(c => `${c.r}${c.s}`))
  const ecFree = []
  for (const suit of ['c', 'd', 'h', 's']) {
    for (let rank = 2; rank <= 14; rank++) {
      if (!ecDead.has(`${rank}${suit}`)) ecFree.push({ r: rank, s: suit })
    }
  }
  const evictable = []
  // Overlapping pairs, so 45 free cards give 44 distinct hero hands rather than 22 —
  // the fixture has to outnumber the limit or it proves nothing about eviction.
  for (let i = 0; i + 1 < ecFree.length && evictable.length < EQUITY_CACHE_LIMIT + 8; i++) {
    evictable.push([[ecFree[i], ecFree[i + 1]], ecVillain])
  }
  assert.ok(
    evictable.length > EQUITY_CACHE_LIMIT,
    `need more than ${EQUITY_CACHE_LIMIT} distinct spots to prove eviction, built ${evictable.length}`,
  )
  const firstIn = cachedExactEquity(evictable[0], river, 'holdem')
  for (const holes of evictable) cachedExactEquity(holes, river, 'holdem')
  assert.ok(
    equityCacheSizes().hands <= EQUITY_CACHE_LIMIT,
    `the memo grew to ${equityCacheSizes().hands} entries against a limit of ${EQUITY_CACHE_LIMIT} — `
    + 'an unbounded map keyed on whatever the user typed is a leak, not a cache',
  )
  assert.deepEqual(
    plain(cachedExactEquity(evictable[0], river, 'holdem')), plain(firstIn),
    'an evicted spot came back different — eviction must cost time, never correctness',
  )

  // Callers get the same object on every hit, so an in-place mutation would
  // corrupt every later reader of that spot. Strict mode makes it throw instead.
  // Both halves: the arrays a caller might sort or push to, and the object whose
  // fields it might replace. Asserting only the first left removing the outer
  // freeze survivable, which makes the assertion wrong rather than the mutation
  // uninteresting.
  assert.throws(
    () => { firstIn.win[0] = 0 },
    'an array handed out by the memo is writable — one caller sorting it in place poisons the rest',
  )
  assert.throws(
    () => { firstIn.runouts = 0 },
    'a result handed out by the memo is writable — one caller reassigning a field poisons the rest',
  )

  /* ── 2. the ceiling counts work, not boards ── */

  const ecPreflopHoldem = [ecHand('As Ks'), ecHand('Qh Qd')]
  const ecPreflopPlo = [ecHand('As Ks Qh Jd'), ecHand('2c 3d 4h 5s')]
  assert.ok(
    ecCountRunouts(ecPreflopPlo, []) < ecCountRunouts(ecPreflopHoldem, []),
    'pre-flop Omaha must be FEWER boards than pre-flop Hold\'em — eight known cards, not four',
  )
  assert.ok(
    handsRanked(ecPreflopPlo, [], 'plo') > handsRanked(ecPreflopHoldem, [], 'holdem'),
    'handsRanked() ranks pre-flop Omaha as cheaper than pre-flop Hold\'em, which is exactly the '
    + 'inversion a boards ceiling made: every Omaha board is the best of sixty five-card hands',
  )
  for (const variant of ['holdem', 'plo']) {
    const holes = variant === 'plo' ? ecPreflopPlo : ecPreflopHoldem
    const streets = [[], ecBoard, [...ecBoard, ec('9s')], [...ecBoard, ec('9s'), ec('4d')]]
    for (let i = 1; i < streets.length; i++) {
      assert.ok(
        handsRanked(holes, streets[i], variant) < handsRanked(holes, streets[i - 1], variant),
        `handsRanked() must fall as the ${variant} board fills — it is a cost, and each card removes runouts`,
      )
    }
  }

  // Read the shipped ceiling out of the component rather than restating it, so
  // this asserts what the tool actually does. It has exactly one interesting
  // value: the spot it admits and the spot it refuses.
  const rankCeilingMatch = ecSrc.match(/const PT_MAX_RANK_WORK = ([\d_]+)/)
  assert.ok(
    rankCeilingMatch,
    'PokerTrainer.ts no longer declares PT_MAX_RANK_WORK — the checks below assert nothing without it',
  )
  const rankCeiling = Number(rankCeilingMatch[1].replace(/_/g, ''))
  assert.ok(
    handsRanked(ecPreflopHoldem, [], 'holdem') <= rankCeiling,
    `PT_MAX_RANK_WORK (${rankCeiling}) refuses pre-flop Hold'em hand-vs-hand at `
    + `${handsRanked(ecPreflopHoldem, [], 'holdem')} reads. That is "what is AA against KK", the most `
    + 'asked question in poker, and the tool can answer it in about a quarter of a second',
  )
  assert.ok(
    handsRanked(ecPreflopPlo, [], 'plo') > rankCeiling,
    `PT_MAX_RANK_WORK (${rankCeiling}) admits pre-flop Omaha at ${handsRanked(ecPreflopPlo, [], 'plo')} `
    + 'reads — about seven seconds of a frozen tab. Refusing is the honest answer; sampling is not',
  )
  for (const [holes, board, variant] of ecSpots) {
    assert.ok(
      handsRanked(holes, board, variant) <= rankCeiling,
      `PT_MAX_RANK_WORK refuses a ${variant} spot on ${board.length} board cards — every spot from the `
      + 'flop on must stay computable in both games',
    )
  }

  /* ── and the component actually goes through all of it ── */

  const equityImport = ecSrc.match(/import \{([\s\S]*?)\} from '\.\/engine\/equity'/)
  assert.ok(equityImport, "PokerTrainer.ts no longer imports from './engine/equity'")
  for (const name of ['exactEquity', 'equityVsRange']) {
    assert.ok(
      !new RegExp(`\\b${name}\\b`).test(equityImport[1]),
      `PokerTrainer.ts imports ${name} directly. Every equity call in the component must go through `
      + 'engine/equity-cache.ts, or the panel goes back to computing hero equity twice per render and '
      + 'again on every keystroke in the pot and bet boxes',
    )
  }
  assert.ok(
    !/countRunouts\([^)]*\)\s*>/.test(ecSrc),
    'a gate in PokerTrainer.ts is still written in boards. Boards are not the cost — use handsRanked()',
  )
  assert.ok(
    (ecSrc.match(/handsRanked\(/g) ?? []).length >= 2,
    'the result panel and the pot-odds panel must gate on the same predicate, or the odds panel '
    + 'computes a spot the result panel just refused',
  )
}

console.log("the poker memo returns exactly what it memoises, and the trainer's ceiling counts work")

/* ─────  Type Trial ghost replays: a permalink bounded in every dimension  ─────
   The token is client-minted and client-consumed, but it is still untrusted
   input crossing a boundary (anyone can hand-build a fragment), so the decoder
   is held to the same standard as an API route: size, count, per-delta and
   total-duration bounds, and never a throw. The fingerprint is what stops an
   index into an edited passage pool from racing the WRONG text. */

{
  const {
    GHOST_MAX_DELTA_MS,
    GHOST_MAX_MARKS,
    GHOST_MAX_TOKEN_CHARS,
    GHOST_MAX_TOTAL_MS,
    decodeGhostToken,
    encodeGhostToken,
    ghostDurationMs,
    ghostProgressAt,
    ghostWpm,
    passageFingerprint,
    verifyGhostPassage,
  } = await import('../src/components/games/type-trial/ghost.ts')
  const { DAILY_TEXTS } = await import('../src/lib/type-trial-daily.ts')

  // Every passage either pool could serve must fit under the mark cap, or a
  // legitimate finished run cannot mint its own link.
  const longestDaily = Math.max(...DAILY_TEXTS.map(t => t.length))
  assert.ok(longestDaily <= GHOST_MAX_MARKS, 'GHOST_MAX_MARKS is smaller than a daily passage — legit runs cannot mint')

  // Round trip: a plausible run comes back quantised but otherwise intact.
  const passage = dailyPassage('2026-08-22')
  const marks = Array.from({ length: passage.length }, (_, i) => (i + 1) * 217)
  const token = encodeGhostToken({ kind: 'daily', day: '2026-08-22', index: 0, passage, acc: 97, marks })
  assert.ok(token, 'a normal finished run must mint a token')
  assert.ok(token.length < 600, `the token must stay a compact fragment (${token.length} chars for ${passage.length} marks)`)
  const g = decodeGhostToken(token)
  assert.ok(g, 'the minted token must decode')
  assert.equal(g.kind, 'daily')
  assert.equal(g.day, '2026-08-22')
  assert.equal(g.acc, 97)
  assert.equal(g.marks.length, passage.length, 'one mark per character — the replay covers the whole passage')
  for (let i = 1; i < g.marks.length; i++) {
    assert.ok(g.marks[i] >= g.marks[i - 1], 'the decoded timeline must be monotonic')
  }
  assert.ok(
    Math.abs(ghostDurationMs(g.marks) - marks[marks.length - 1]) <= 5 * marks.length,
    'decode must reproduce the duration within quantisation drift',
  )
  assert.ok(verifyGhostPassage(g, passage), 'the fingerprint must verify against the passage it was minted from')
  assert.ok(!verifyGhostPassage(g, passage + '!'), 'any change to the passage must fail verification')

  // Practice kinds resolve by index but are still pinned by fingerprint —
  // an edited pool fails closed instead of racing whatever now sits at #3.
  const pMarks = [50, 100, 150, 200, 250, 300, 350]
  const pTok = encodeGhostToken({ kind: 'quotes', day: null, index: 3, passage: 'abc def', acc: 100, marks: pMarks })
  const pg = decodeGhostToken(pTok)
  assert.equal(pg.kind, 'quotes')
  assert.equal(pg.index, 3)
  assert.ok(verifyGhostPassage(pg, 'abc def'))
  assert.ok(!verifyGhostPassage(pg, 'abc deX'), 'a same-length different text must fail the fingerprint')

  // Bounds at mint.
  assert.equal(encodeGhostToken({ kind: 'daily', day: '2026-08-22', index: 0, passage: '', acc: 50, marks: [] }), null)
  assert.equal(encodeGhostToken({ kind: 'daily', day: 'nope', index: 0, passage: 'ab', acc: 50, marks: [1, 2] }), null)
  assert.equal(encodeGhostToken({ kind: 'quotes', day: null, index: -1, passage: 'ab', acc: 50, marks: [1, 2] }), null)
  assert.equal(encodeGhostToken({ kind: 'quotes', day: null, index: 0, passage: 'ab', acc: 101, marks: [1, 2] }), null)
  assert.equal(
    encodeGhostToken({ kind: 'quotes', day: null, index: 0, passage: 'ab', acc: 50, marks: [2, 1] }),
    null,
    'non-monotonic marks are not a timeline',
  )
  assert.equal(
    encodeGhostToken({ kind: 'quotes', day: null, index: 0, passage: 'ab', acc: 50, marks: [1, Number.NaN] }),
    null,
    'a non-finite mark is rejected, not serialised',
  )
  const overLong = Array.from({ length: 61 }, (_, i) => i * (GHOST_MAX_TOTAL_MS / 59))
  assert.equal(
    encodeGhostToken({ kind: 'quotes', day: null, index: 0, passage: 'x'.repeat(61), acc: 50, marks: overLong }),
    null,
    'a run past the total-duration cap must not mint',
  )
  const stared = decodeGhostToken(
    encodeGhostToken({ kind: 'quotes', day: null, index: 0, passage: 'ab', acc: 50, marks: [100, 100 + GHOST_MAX_DELTA_MS * 2] }),
  )
  assert.equal(
    stared.marks[1] - stared.marks[0],
    GHOST_MAX_DELTA_MS,
    'a mid-run stare is clamped at mint — it costs the stare, not the link',
  )

  // Bounds at decode: since minting clamps, an over-cap delta can only be a
  // hand-built token, and the decoder rejects rather than repairs it.
  const fp = passageFingerprint('ab')
  const craft = (deltasQ) => {
    const bytes = []
    for (let q of deltasQ) {
      while (q >= 0x80) { bytes.push((q & 0x7f) | 0x80); q >>>= 7 }
      bytes.push(q)
    }
    return `1.q0.${fp}.50.${Buffer.from(bytes).toString('base64url')}`
  }
  assert.ok(decodeGhostToken(craft([10, 20])), 'the craft helper builds valid tokens — the rejections below are real')
  assert.equal(decodeGhostToken(craft([10, GHOST_MAX_DELTA_MS / 10 + 1])), null, 'an over-cap delta is rejected')
  assert.equal(decodeGhostToken(craft(Array(31).fill(GHOST_MAX_DELTA_MS / 10))), null, 'a crafted total past the cap is rejected')
  assert.equal(decodeGhostToken('x'.repeat(GHOST_MAX_TOKEN_CHARS + 1)), null, 'token size is checked before any parsing')
  assert.equal(decodeGhostToken(`2.q0.${fp}.50.AA`), null, 'an unknown version is rejected, never guessed at')
  assert.equal(decodeGhostToken(`1.q0.${fp}.101.AA`), null, 'accuracy past 100 is rejected')
  assert.equal(decodeGhostToken(`1.z0.${fp}.50.AA`), null, 'an unknown kind letter is rejected')
  assert.equal(decodeGhostToken(`1.q0.zzzzzzzz.50.AA`), null, 'a malformed fingerprint is rejected')
  assert.equal(decodeGhostToken(`1.q0.${fp}.50.`), null, 'an empty timeline is rejected')
  assert.equal(decodeGhostToken(`1.q0.${fp}.50.!!`), null, 'non-base64url data is rejected without throwing')
  assert.equal(decodeGhostToken(null), null)
  assert.equal(decodeGhostToken('.....'), null)

  // Playback math.
  const pm = [100, 200, 300]
  assert.equal(ghostProgressAt(pm, 0), 0)
  assert.equal(ghostProgressAt(pm, 150), 1)
  assert.equal(ghostProgressAt(pm, 300), 3)
  assert.equal(ghostProgressAt(pm, 1e9), 3)
  assert.equal(ghostWpm(80, 60_000), 16, 'net wpm: 80 chars in a minute is 16 wpm')
  assert.equal(ghostWpm(80, 0), 0, 'a zero-duration replay must not divide by zero')

  // The component's side of the contract, asserted at source level: the link
  // rides the fragment, the hashchange listener exists AND is removed (the
  // element is created/destroyed across in-site navigations, so an unremoved
  // window listener is a leak per visit), and marks are reset per run.
  const ttSrc = await readFile(new URL('../src/components/games/type-trial/TypeTrial.ts', import.meta.url), 'utf8')
  assert.ok(ttSrc.includes('#ghost='), 'the ghost link must ride the URL fragment, never a query string')
  assert.ok(/window\.addEventListener\('hashchange'/.test(ttSrc), 'a ghost link opened in a mounted tab must load without a reload')
  assert.ok(/window\.removeEventListener\('hashchange'/.test(ttSrc), 'the hashchange listener must be removed on disconnect — one leak per in-site visit otherwise')
  assert.ok(/this\.marks = \[\]/.test(ttSrc), 'restart must reset the recorded timeline')
}

console.log('type trial ghost tokens are bounded, fingerprint-pinned, and decode never throws')

/* ─────  Deep Shore: the picture IS the product  ─────
   A fractal explorer fails silently by construction — a wrong interior test, a
   swapped c/z pair or a drifting zoom anchor all render a perfectly pleasant
   image that is simply not the thing it claims to be. So three properties are
   asserted rather than eyeballed:

     • the fast renderer agrees with an untouched reference implementation over a
       dense grid (the poker `evaluateBest` / `scoreBest` structure, same reason);
     • zooming about a pixel is a FIXED POINT — the complex number under the
       cursor is the same number afterwards, to within a few ulps;
     • the `#view=` permalink is bounded at mint and at decode, never throws, and
       carries ENOUGH DIGITS — a centre rounded to six places is a different
       place entirely past a zoom of 10^6, so the naive version of this feature
       sends the recipient somewhere else while both parties believe otherwise. */

{
  const {
    DS_BASE_SPAN,
    DS_DEFAULT_VIEW,
    DS_ITER_MAX,
    DS_ITER_MIN,
    DS_MAX_TOKEN_CHARS,
    DS_MAX_ZOOM,
    DS_MIN_ZOOM,
    DS_PALETTE_IDS,
    dsAutoIter,
    dsClampView,
    dsCoordDigits,
    dsDecodeView,
    dsEffectiveIter,
    dsEncodeView,
    dsEscape,
    dsEscapeReference,
    dsInInterior,
    dsPixelScale,
    dsRampPosition,
    dsScreenToComplex,
    dsTokenFromHash,
    dsZoomAt,
  } = await import('../src/components/games/deep-shore/escape.ts')

  /* ── 1. The fast path is the reference, reached sooner. ──
     `dsEscape` skips the iteration entirely for points the closed-form cardioid
     and period-2 bulb tests place inside. If either test is wrong — a sign, a
     radius, the q formula — outside points get painted solid and NOTHING about
     the output looks broken. So the two are compared over a grid covering the
     whole set and its surroundings, including both components' boundaries. */
  const ITER = 150
  let compared = 0
  let earlyOuts = 0
  for (let re = -2.2; re <= 0.75; re += 0.01) {
    for (let im = 0; im <= 1.2; im += 0.01) {
      const fast = dsEscape('mandelbrot', re, im, 0, 0, ITER)
      const slow = dsEscapeReference(re, im, 0, 0, ITER)
      assert.equal(fast.n, slow.n, `fast path disagrees with the reference at ${re},${im}`)
      assert.ok(
        (Number.isNaN(fast.smooth) && Number.isNaN(slow.smooth)) || fast.smooth === slow.smooth,
        `smooth value disagrees at ${re},${im}`,
      )
      if (dsInInterior(re, im)) earlyOuts += 1
      compared += 1
    }
  }
  assert.ok(compared > 30000, 'the equivalence grid must actually be dense')
  assert.ok(earlyOuts > 1000, 'the interior early-out must actually fire, or the comparison proves nothing')

  // The early-out is a claim about two specific components, not about the set.
  assert.ok(dsInInterior(0, 0), 'the origin is in the main cardioid')
  assert.ok(dsInInterior(-1, 0), 'c = -1 is the centre of the period-2 bulb')
  assert.ok(dsInInterior(0.24, 0), 'just inside the cusp')
  assert.ok(!dsInInterior(0.3, 0), 'just outside the cusp is not claimed')
  assert.ok(!dsInInterior(-0.125, 0.744), 'the period-3 bulb is NOT claimed — the test is an early-out, not a membership oracle')
  assert.ok(!dsInInterior(1, 1), 'a point far outside is never claimed')

  /* ── 2. Facts about the set that do not depend on this implementation. ── */
  assert.equal(dsEscapeReference(0, 0, 0, 0, ITER).n, ITER, 'c = 0 never escapes')
  assert.equal(dsEscapeReference(-1, 0, 0, 0, ITER).n, ITER, 'c = -1 never escapes')
  assert.ok(dsEscapeReference(1, 0, 0, 0, ITER).n < ITER, 'c = 1 escapes')
  assert.ok(dsEscapeReference(-2.1, 0, 0, 0, ITER).n < ITER, 'c = -2.1 escapes (the set ends at -2)')
  assert.ok(dsEscapeReference(0.3, 0.6, 0, 0, ITER).n < ITER, 'c = 0.3 + 0.6i escapes')

  // Symmetry about the real axis. Negating the imaginary part negates y at every
  // step exactly, so this is a STRICT equality — any asymmetry is an index bug.
  for (const [re, im] of [[-0.5, 0.3], [0.28, 0.6], [-1.3, 0.12], [-0.743, 0.132]]) {
    const up = dsEscape('mandelbrot', re, im, 0, 0, ITER)
    const down = dsEscape('mandelbrot', re, -im, 0, 0, ITER)
    assert.equal(up.n, down.n, 'the Mandelbrot set is symmetric about the real axis')
    assert.ok((Number.isNaN(up.smooth) && Number.isNaN(down.smooth)) || up.smooth === down.smooth)
  }

  /* ── 3. Julia mode must not be Mandelbrot mode wearing a hat. ──
     `mandelbrot` decides which of c and z0 is the pixel. Swap them and Julia
     mode renders a Mandelbrot set, which looks like a rendering bug and is not
     one. The Julia set for c = 0 has a closed form — the unit disk — so it pins
     the wiring to a fact rather than to a screenshot. */
  for (const r of [0.2, 0.7, 0.95, 0.999]) {
    assert.equal(dsEscape('julia', r, 0, 0, 0, ITER).n, ITER, `|z| = ${r} < 1 stays bounded under z -> z^2`)
    assert.equal(dsEscape('julia', 0, r, 0, 0, ITER).n, ITER, 'and on the imaginary axis too')
  }
  for (const r of [1.01, 1.5, 3]) {
    assert.ok(dsEscape('julia', r, 0, 0, 0, ITER).n < ITER, `|z| = ${r} > 1 escapes under z -> z^2`)
  }
  // The discriminator, chosen so both answers are certain rather than measured:
  // the Mandelbrot set meets the real axis in exactly [-2, 0.25], so c = 0.5
  // escapes — while 0.5 sits well inside the unit disk, which IS the filled
  // Julia set for c = 0. Swap the roles of c and z0 and this pair collapses.
  assert.ok(dsEscape('mandelbrot', 0.5, 0, 0, 0, ITER).n < ITER, 'c = 0.5 is outside the Mandelbrot set')
  assert.equal(dsEscape('julia', 0.5, 0, 0, 0, ITER).n, ITER, 'z0 = 0.5 is inside the filled Julia set for c = 0')

  /* ── 4. The smooth value's defining invariant. ──
     n <= nu < n + 1 for an escape at iteration n. A flipped sign or the wrong
     log base still produces a picture — this is what refuses it. */
  let smoothChecked = 0
  for (let re = -2.2; re <= 0.75; re += 0.02) {
    for (let im = 0; im <= 1.2; im += 0.02) {
      const e = dsEscapeReference(re, im, 0, 0, ITER)
      if (e.n >= ITER) continue
      assert.ok(Number.isFinite(e.smooth), `smooth must be finite for an escape at ${re},${im}`)
      assert.ok(e.smooth >= e.n - 1e-9 && e.smooth < e.n + 1 + 1e-9,
        `smooth ${e.smooth} outside [${e.n}, ${e.n + 1}) at ${re},${im}`)
      smoothChecked += 1
    }
  }
  assert.ok(smoothChecked > 4000, 'the smooth-value sweep must cover real escapes')
  // The ramp position is a fraction, always, including for a degenerate input.
  for (const s of [0, 0.5, 3.25, 91.7, 4000]) {
    const t = dsRampPosition(s, 55)
    assert.ok(t >= 0 && t < 1, `ramp position ${t} must stay in [0, 1)`)
  }

  /* ── 5. Zoom-at-the-cursor is a fixed point. ──
     Nothing throws when this is wrong; the view merely drifts away from what you
     aimed at, a little more per notch. The error budget is a few ulps of the
     anchor, because the arithmetic is (a - b) + b and not a promise of exactness. */
  const W = 1280
  const H = 794
  let anchored = 0
  for (const zoom of [DS_MIN_ZOOM, 1, 97, 5e4, 1e8, 1e12, DS_MAX_ZOOM]) {
    for (const [px, py] of [[0, 0], [W, H], [17, 613], [W / 2, H / 2], [W - 3, 8]]) {
      for (const factor of [2, 0.5, 1.35, 1 / 1.35, 64, 1 / 64]) {
        const view = { ...DS_DEFAULT_VIEW, re: -0.7436438870371587, im: 0.1318259042053119, zoom }
        const before = dsScreenToComplex(view, px, py, W, H)
        const zoomed = dsZoomAt(view, px, py, factor, W, H)
        const after = dsScreenToComplex(zoomed, px, py, W, H)
        // The arithmetic is (a − b) + b, so the budget is ulps of the largest
        // intermediate — the anchor itself or the half-span subtracted from it,
        // whichever is bigger. Zooming a long way OUT is the case that matters:
        // there the offset dwarfs the anchor and the cancellation is real.
        const magnitude = Math.max(1, Math.abs(before.re), Math.abs(before.im), DS_BASE_SPAN / zoomed.zoom)
        const tol = 16 * Number.EPSILON * magnitude
        assert.ok(Math.abs(after.re - before.re) <= tol,
          `zoom moved the anchor's real part at zoom ${zoom} factor ${factor}`)
        assert.ok(Math.abs(after.im - before.im) <= tol,
          `zoom moved the anchor's imaginary part at zoom ${zoom} factor ${factor}`)
        anchored += 1
      }
    }
  }
  assert.ok(anchored >= 200, 'the anchoring sweep must cover both zoom ceilings and both directions')
  // Including when the zoom clamps: a wheel notch at the ceiling changes nothing,
  // and "nothing" must not include a quiet lateral slide.
  const atCeiling = { ...DS_DEFAULT_VIEW, zoom: DS_MAX_ZOOM }
  const clamped = dsZoomAt(atCeiling, 40, 40, 8, W, H)
  assert.equal(clamped.zoom, DS_MAX_ZOOM, 'zoom is clamped at the double-precision ceiling')
  assert.equal(clamped.re, atCeiling.re, 'a refused zoom must not move the centre')
  assert.equal(clamped.im, atCeiling.im)

  // Pixels are square: one scale, derived from the width, used for both axes.
  const wide = dsScreenToComplex({ re: 0, im: 0, zoom: 1 }, W, H / 2, W, H)
  const tall = dsScreenToComplex({ re: 0, im: 0, zoom: 1 }, W / 2, H, W, H)
  assert.ok(Math.abs(wide.re - DS_BASE_SPAN / 2) < 1e-12, 'the viewport is DS_BASE_SPAN wide at zoom 1')
  assert.ok(Math.abs(tall.im + (DS_BASE_SPAN / 2) * (H / W)) < 1e-12, 'the vertical span follows the aspect, not a second scale')

  /* ── 6. Clamping is separate from anchoring, and is the identity in range. ──
     If dsClampView touched an in-range view, the fixed-point property above
     would hold in the module and fail in the component that calls both. */
  for (const view of [
    DS_DEFAULT_VIEW,
    { ...DS_DEFAULT_VIEW, re: 1.9, im: -1.4, zoom: 4e6, iter: 900, density: 120 },
    { ...DS_DEFAULT_VIEW, zoom: DS_MAX_ZOOM, iter: DS_ITER_MAX },
  ]) {
    assert.deepEqual(dsClampView(view), view, 'clamping must be the identity on a valid view')
  }
  assert.equal(dsClampView({ ...DS_DEFAULT_VIEW, zoom: 1e99 }).zoom, DS_MAX_ZOOM)
  assert.equal(dsClampView({ ...DS_DEFAULT_VIEW, re: -99 }).re, -8)
  assert.equal(dsClampView({ ...DS_DEFAULT_VIEW, iter: 0 }).iter, 0, '0 is "auto" and must survive the clamp')
  assert.equal(dsClampView({ ...DS_DEFAULT_VIEW, iter: 7 }).iter, DS_ITER_MIN, 'a pinned budget below the floor is raised, not zeroed')

  /* ── 7. The iteration budget is bounded, and grows with depth. ── */
  let prevIter = 0
  for (let z = DS_MIN_ZOOM; z < DS_MAX_ZOOM; z *= 4) {
    const it = dsAutoIter(z)
    assert.ok(it >= DS_ITER_MIN && it <= DS_ITER_MAX, `auto iterations ${it} out of bounds at zoom ${z}`)
    assert.ok(it >= prevIter, 'detail must not fall away as you zoom in')
    prevIter = it
  }
  assert.ok(dsAutoIter(DS_MAX_ZOOM) <= DS_ITER_MAX, 'the deepest zoom still cannot ask for unbounded work')
  assert.ok(dsAutoIter(1e9) > dsAutoIter(10), 'a deep zoom gets a bigger budget than a shallow one')
  assert.equal(dsEffectiveIter({ iter: 0, zoom: 1e6 }), dsAutoIter(1e6), '0 means auto')
  assert.equal(dsEffectiveIter({ iter: 900, zoom: 1e6 }), 900, 'a pinned budget wins over auto')
  assert.equal(dsEffectiveIter({ iter: 99999, zoom: 1 }), DS_ITER_MAX, 'and is still bounded')

  /* ── 8. The permalink carries enough digits to mean anything. ──
     THE load-bearing assertion of this tool. A fixed six decimal places is
     coarser than the entire viewport past a zoom of ~10^5, so the "share this
     spot" feature would land the recipient somewhere else while both of them
     believed they were looking at the same thing. The digit count follows the
     zoom, and the round-trip error must stay inside HALF A PIXEL of a 4K
     canvas — a tolerance derived from the geometry, not a number chosen to
     pass. */
  const RETINA_W = 3840
  const deepRe = -0.7436438870371587
  const deepIm = 0.1318259042053119
  for (let zoom = 1; zoom <= 1e12; zoom *= 10) {
    const digits = dsCoordDigits(zoom)
    const halfPixel = dsPixelScale(zoom, RETINA_W) / 2
    for (const value of [deepRe, deepIm, -1.9999999999999, 0]) {
      const roundTripped = Number(Number(value).toFixed(digits))
      assert.ok(Math.abs(roundTripped - value) < halfPixel,
        `at zoom ${zoom}, ${digits} digits loses ${Math.abs(roundTripped - value)} — more than half a pixel (${halfPixel})`)
    }
  }
  // And at the ceiling the TOKEN is not the limit — the double is. Stated here
  // because it is the honest version of "how deep does this go": the encoding is
  // lossless by then, and DS_MAX_ZOOM is a fact about 64-bit floats.
  for (const value of [deepRe, deepIm, 1.4142135623730951, -0.12345678901234567]) {
    assert.equal(Number(value.toFixed(dsCoordDigits(DS_MAX_ZOOM))), value,
      'at the deepest zoom the token round-trips the exact double — the format is not what runs out')
  }

  /* ── 9. The token is bounded at mint AND at decode, and never throws. ── */
  const roundTrip = (view) => dsDecodeView(dsEncodeView(view))
  const mandel = { ...DS_DEFAULT_VIEW, re: deepRe, im: deepIm, zoom: 5e7, iter: 0, palette: 'ice', density: 90 }
  const backM = roundTrip(mandel)
  assert.ok(backM, 'a normal view must mint a decodable token')
  assert.equal(backM.mode, 'mandelbrot')
  assert.equal(backM.palette, 'ice')
  assert.equal(backM.density, 90)
  assert.equal(backM.iter, 0)
  assert.ok(Math.abs(backM.re - mandel.re) < dsPixelScale(mandel.zoom, RETINA_W) / 2, 'the centre survives the round trip')
  assert.ok(Math.abs(backM.im - mandel.im) < dsPixelScale(mandel.zoom, RETINA_W) / 2)
  assert.ok(Math.abs(backM.zoom / mandel.zoom - 1) < 1e-3, 'the zoom survives to well under a visible step')

  const julia = { ...DS_DEFAULT_VIEW, mode: 'julia', seedRe: -0.123, seedIm: 0.745, zoom: 12, iter: 700 }
  const backJ = roundTrip(julia)
  assert.ok(backJ, 'a julia view must mint a decodable token')
  assert.equal(backJ.mode, 'julia')
  assert.equal(backJ.iter, 700)
  assert.ok(Math.abs(backJ.seedRe - julia.seedRe) < 1e-7 && Math.abs(backJ.seedIm - julia.seedIm) < 1e-7)

  // A mandelbrot token carries no seed and a julia token must — so a truncated
  // link cannot be read as the other shape with a default seed quietly supplied.
  assert.equal(dsEncodeView(mandel).split(',').length, 8)
  assert.equal(dsEncodeView(julia).split(',').length, 10)
  assert.equal(dsDecodeView(dsEncodeView(julia).split(',').slice(0, 8).join(',')), null,
    'a julia token stripped of its seed is refused, not defaulted')

  // Minting clamps, so an out-of-range field on decode is proof of a hand-built
  // token rather than something this code could have produced.
  const minted = dsEncodeView({ ...DS_DEFAULT_VIEW, re: 1e6, im: -1e6, zoom: 1e99, iter: 1e9, density: -50, palette: 'nope' })
  const mintedBack = dsDecodeView(minted)
  assert.ok(mintedBack, 'minting clamps rather than producing something it will then refuse')
  assert.ok(Math.abs(mintedBack.re) <= 8 && Math.abs(mintedBack.im) <= 8)
  // Zoom rides as 1000·log2(zoom), so one code step is 0.07% — far under a
  // visible change, and the reason the ceiling comes back a hair below itself
  // rather than exactly on it. What matters is that it can never come back ABOVE
  // the ceiling, because that is the bound protecting the arithmetic.
  assert.ok(mintedBack.zoom <= DS_MAX_ZOOM, 'a decoded zoom can never exceed the double-precision ceiling')
  assert.ok(Math.abs(mintedBack.zoom / DS_MAX_ZOOM - 1) < 1e-3, 'and lands within one code step of it')
  assert.equal(mintedBack.iter, DS_ITER_MAX)
  assert.ok(DS_PALETTE_IDS.includes(mintedBack.palette), 'an unknown palette falls back to a known one at mint')

  const rejected = [
    '',
    'x',
    'nope,nope',
    '2,m,-0.6,0,0,0,ember,55',                       // version is checked, never guessed at
    '1,q,-0.6,0,0,0,ember,55',                       // unknown mode
    '1,m,-0.6,0,0,0,ember',                          // short
    '1,m,-0.6,0,0,0,ember,55,1,1',                   // a seed on a mandelbrot token
    '1,j,-0.6,0,0,0,ember,55',                       // a julia token with no seed
    '1,m,9,0,0,0,ember,55',                          // coordinate out of range
    '1,m,-0.6,-99,0,0,ember,55',
    '1,m,abc,0,0,0,ember,55',                        // not a number
    '1,m,1e5,0,0,0,ember,55',                        // exponent notation is not the format
    '1,m,Infinity,0,0,0,ember,55',
    '1,m,-0.6,0,999999,0,ember,55',                  // zoom code past the ceiling
    '1,m,-0.6,0,-999999,0,ember,55',
    '1,m,-0.6,0,0,7,ember,55',                       // a pinned budget below the floor
    '1,m,-0.6,0,0,99999,ember,55',
    '1,m,-0.6,0,0,0,__proto__,55',                   // palette is an allowlist, not a lookup
    '1,m,-0.6,0,0,0,constructor,55',
    '1,m,-0.6,0,0,0,rainbow,55',
    '1,m,-0.6,0,0,0,ember,9',                        // density out of range
    '1,m,-0.6,0,0,0,ember,9999',
    `1,m,-0.${'1'.repeat(40)},0,0,0,ember,55`,       // a coordinate longer than any mint produces
    `1,m,-0.6,0,0,0,ember,55,${'x'.repeat(DS_MAX_TOKEN_CHARS)}`,
    null,
    undefined,
    42,
  ]
  for (const bad of rejected) {
    let out
    assert.doesNotThrow(() => { out = dsDecodeView(bad) }, `decoding must never throw (${String(bad).slice(0, 40)})`)
    assert.equal(out, null, `token must be refused: ${String(bad).slice(0, 60)}`)
  }
  assert.ok(dsEncodeView({ ...DS_DEFAULT_VIEW, zoom: DS_MAX_ZOOM, re: deepRe, im: deepIm }).length <= DS_MAX_TOKEN_CHARS,
    'the deepest mintable view still fits inside the token ceiling')

  // Re-encoding a decoded token must reproduce it byte for byte. Without this
  // the address bar would drift on its own as replaceState re-minted a view it
  // had just read back, and no two copies of "the same" link would match.
  for (const view of [mandel, julia, DS_DEFAULT_VIEW, { ...DS_DEFAULT_VIEW, zoom: DS_MAX_ZOOM }]) {
    const once = dsEncodeView(view)
    assert.equal(dsEncodeView(dsDecodeView(once)), once, 'encode ∘ decode ∘ encode must be encode')
  }

  assert.equal(dsTokenFromHash('#view=1,m,-0.6,0,0,0,ember,55'), '1,m,-0.6,0,0,0,ember,55')
  assert.equal(dsTokenFromHash('#other=1&view=abc'), 'abc', 'the fragment may carry other keys later')
  assert.equal(dsTokenFromHash('#nothing'), null)
  assert.equal(dsTokenFromHash(''), null)

  /* ── 10. The component is wired the way the module assumes. ── */
  const dsSrc = await readFile(new URL('../src/components/games/deep-shore/DeepShore.ts', import.meta.url), 'utf-8')
  assert.ok(/customElements\.define\('deep-shore-game'/.test(dsSrc), 'the element registers under the tag EMBED_TAGS names')
  assert.ok(dsSrc.includes('#view='), 'the share link rides the URL FRAGMENT — a query string reaches server logs and Referer headers')
  assert.ok(!/\?view=/.test(dsSrc), 'and never a query string')
  assert.ok(/history\.replaceState/.test(dsSrc), 'the address bar is kept current with replaceState')
  assert.ok(!/location\.hash\s*=/.test(dsSrc),
    'assigning location.hash pushes a history entry per view — a minute of exploring would bury the back button')
  assert.ok(/dsWriteStored\(DS_LS_VIEW, token\)/.test(dsSrc) && /const token = dsEncodeView/.test(dsSrc),
    'storage holds the same serialisation as the link, so the two formats cannot drift')
  assert.ok((dsSrc.match(/dsDecodeView\(/g) ?? []).length >= 3,
    'the stored value is validated by the same decoder as the fragment — a hand-edited localStorage entry is no more trusted')
  assert.ok(!dsSrc.includes('DS_BAILOUT'),
    'the iteration lives in escape.ts where it can be tested, not in a DOM handler')
  assert.ok(/window\.addEventListener\('hashchange'/.test(dsSrc),
    'a shared link opened in an already-mounted tab must load without a reload')

  // The refinement ladder must END at one sample per pixel. A ladder that stops
  // at 2 would look finished — the progress chip would clear, the export would
  // write — while every pixel was a 2×2 block of its neighbour's colour, which is
  // the one rendering failure this tool could ship without anyone noticing.
  const ladder = /const DS_PASSES = \[([0-9, ]+)\]/.exec(dsSrc)
  assert.ok(ladder, 'the refinement ladder is a readable literal')
  const steps = ladder[1].split(',').map(n => Number(n.trim()))
  assert.ok(steps.length >= 2, 'a ladder of one step is not a progressive renderer')
  assert.equal(steps[steps.length - 1], 1, 'the final pass must sample every pixel')
  for (let i = 1; i < steps.length; i += 1) {
    assert.ok(steps[i] < steps[i - 1], 'each pass must be finer than the one before it')
  }

  /* ── 11. Every wired game reaches its module AND its stylesheet. ──
     Derived from mountGame's own dispatch rather than from a list, so a game
     added later is covered without anybody remembering this exists. Both halves
     fail silently: no dispatch branch renders a blank element, and a missing
     stylesheet import renders an unstyled one — on the /games route AND on any
     learnings article that embeds it. */
  const mountSrc = await readFile(new URL('../src/lib/game-mount.ts', import.meta.url), 'utf-8')
  const embedCss = await readFile(new URL('../src/styles/games-embed.css', import.meta.url), 'utf-8')
  // EMBED_TAGS and not GAME_TAGS, which is what this loop read until 2026-09-25.
  // The comment above always claimed "on any learnings article that embeds it",
  // but GAME_TAGS is the narrow list: it excludes the six Driftfield engines and
  // every article-only figure, so seven of the wired components were reaching
  // this guard and being skipped by it. The blank-element failure it exists to
  // catch is exactly the one an embed-only component has, because an article is
  // the ONLY route that mounts it.
  for (const slug of Object.keys(EMBED_TAGS)) {
    const marker = `slug === '${slug}') return import('`
    const at = mountSrc.indexOf(marker)
    assert.notEqual(at, -1, `${slug} has no mountGame dispatch branch — its page would render an empty element`)
    const rest = mountSrc.slice(at + marker.length)
    const importPath = rest.slice(0, rest.indexOf("'"))
    // Derived from the import, not from the slug: '2048' lives in twenty48/.
    const dir = importPath.replace(/\/[^/]+$/, '').replace('../components/games/', '')
    assert.ok(dir && dir !== importPath, `${slug}'s dispatch must import from src/components/games/`)
    assert.ok(embedCss.includes(`games/${dir}/`), `${slug}'s stylesheet is not imported by games-embed.css`)
  }
}
console.log('deep shore: the fast renderer equals its reference, zoom keeps its anchor, and the permalink carries enough digits to mean something')

/* ─────  Deep Shore's dive recorder: the path, its pace, and its permalink  ─────

   Shipped 2026-09-24. The explorer's export used to write a still frame; a dive
   is now a list of stops plus one question — what does the view look like a
   fraction `u` of the way along? Every one of this feature's failure modes still
   renders a perfectly pretty animation, which is why the module is pure and
   these are properties rather than screenshots:

   • **The pace.** Zoom is multiplicative, so log(zoom) is what moves linearly.
     The PAN is the part that is easy to get wrong and impossible to see one
     frame at a time: move the centre linearly in `u` and its speed ACROSS THE
     SCREEN grows with the zoom, so the whole pan lands in the last few frames
     and the destination whips past the viewport at the moment it was supposed
     to arrive. `dsPanWeight` asks instead for constant apparent speed. That is
     asserted as equal screen-space steps — and the naive linear version is held
     up beside it and REQUIRED TO FAIL the same check, because a property test
     that every implementation passes is not a test.
   • **Arrival.** The first and last frames must be the first and last stops
     EXACTLY (`a + (b − a) · 1` is not `b` in floating point), and `u` outside
     [0,1] must clamp rather than extrapolate past the destination.
   • **The `#tour=` permalink**, bounded at mint and at decode, never throwing,
     inheriting `#view=`'s digit rule by reusing its encoder for the first stop
     and its field parsers for the rest. It shares the fragment with `#view=`,
     which is what `dsTokenFromHash`'s tolerance of `&`-joined keys was for.
   • **The cost ceiling in the unit that actually costs.** Frames are not the
     cost; pixels × iterations are, and the rate is a fact about the visitor's
     machine. `dsTourFrameCount` therefore spends a TIME budget against a
     MEASURED per-frame cost — a count fixed at thirty is eight seconds on a
     laptop and four minutes on a phone at the deepest stop. */

{
  const {
    DS_DEFAULT_VIEW,
    DS_MAX_COORD,
    DS_MAX_ZOOM,
    DS_MIN_ZOOM,
    dsClampView,
    dsDecodeView,
    dsEncodeView,
    dsPixelScale,
    dsTokenFromHash,
  } = await import('../src/components/games/deep-shore/escape.ts')
  const {
    DS_TOUR_DELAY_MAX,
    DS_TOUR_DELAY_MIN,
    DS_TOUR_MAX_FRAMES,
    DS_TOUR_MAX_STOPS,
    DS_TOUR_MAX_TOKEN_CHARS,
    DS_TOUR_MIN_FRAMES,
    DS_TOUR_MIN_STOPS,
    dsDecodeTour,
    dsEncodeTour,
    dsNormalizeStops,
    dsPanWeight,
    dsSegmentScreenSpan,
    dsSegmentViewAt,
    dsSegmentWeight,
    dsTourDecades,
    dsTourDelay,
    dsTourFrameCount,
    dsTourTokenFromHash,
    dsTourViewAt,
  } = await import('../src/components/games/deep-shore/tour.ts')

  const base = { ...DS_DEFAULT_VIEW }
  /* The deepest tour stop, dived to from the whole set: 7.7 decades of zoom and
     a real pan, which is the case every naive interpolation gets wrong. */
  const dive = [
    { re: -0.6, im: 0, zoom: 1 },
    { re: -0.7436438870371587, im: 0.1318259042053119, zoom: 5e7 },
  ]
  const threeLeg = [...dive, { re: 0.2925, im: 0.0195, zoom: 70 }]

  /* ── 1. A dive arrives, exactly, and never overshoots. ──
     The endpoints are branches in the source precisely because the arithmetic
     does not land on them: with a = 0.1 and b = 0.3, `a + (b − a) * 1` is
     0.29999999999999993. A last frame that disagrees with the stop it was minted
     from is a dive whose GIF and whose permalink show different places. */
  for (const stops of [dive, threeLeg]) {
    const first = dsTourViewAt(base, stops, 0)
    const last = dsTourViewAt(base, stops, 1)
    assert.equal(first.re, stops[0].re, 'frame one must be stop one, exactly')
    assert.equal(first.im, stops[0].im, 'frame one must be stop one, exactly')
    assert.equal(first.zoom, stops[0].zoom, 'frame one must be stop one, exactly')
    const end = stops[stops.length - 1]
    assert.equal(last.re, end.re, 'the last frame must be the destination, exactly')
    assert.equal(last.im, end.im, 'the last frame must be the destination, exactly')
    assert.equal(last.zoom, end.zoom, 'the last frame must be the destination, exactly')
    // A frame index that runs past the end (an off-by-one in a render loop) must
    // clamp. Extrapolation would fly THROUGH the destination and out the far
    // side, which reads as a rendering glitch rather than as the bug it is.
    for (const u of [1.0001, 2, 50, Number.POSITIVE_INFINITY]) {
      assert.deepEqual(dsTourViewAt(base, stops, u), last, `u = ${u} must clamp to the destination`)
    }
    for (const u of [-0.0001, -3, Number.NEGATIVE_INFINITY, Number.NaN]) {
      assert.deepEqual(dsTourViewAt(base, stops, u), first, `u = ${u} must clamp to the start`)
    }
  }

  /* A leg whose end-point the arithmetic CANNOT reach on its own: with a = −0.1
     and b = 0.45, `a + (b − a) * 1` is 0.45000000000000007. The dive-level checks
     above are blind to this — `dsTourViewAt` short-circuits u = 1 before the
     segment helper is ever asked — and a mutation that deleted the segment's own
     end-point branch SURVIVED the first version of this section because of it.
     So the helper is exported and asked directly, at both ends. */
  const legs = [
    { re: -0.1, im: 0.1, zoom: 3 },
    { re: 0.45, im: -0.2, zoom: 300 },
    { re: 0.1, im: 0.7, zoom: 9000 },
  ]
  for (let i = 1; i < legs.length; i += 1) {
    const misses = (a, b) => a + (b - a) * 1 !== b
    assert.ok(
      misses(legs[i - 1].re, legs[i].re) || misses(legs[i - 1].im, legs[i].im),
      `leg ${i} must be one the arithmetic misses, or it proves nothing`,
    )
  }
  for (let i = 1; i < legs.length; i += 1) {
    const ended = dsSegmentViewAt(base, legs[i - 1], legs[i], 1)
    const began = dsSegmentViewAt(base, legs[i - 1], legs[i], 0)
    assert.equal(ended.re, legs[i].re, 'a leg must END on its stop, exactly')
    assert.equal(ended.im, legs[i].im, 'a leg must END on its stop, exactly')
    assert.equal(ended.zoom, legs[i].zoom, 'a leg must END on its stop, exactly')
    assert.equal(began.re, legs[i - 1].re, 'and BEGIN on the one before it, exactly')
    assert.equal(began.im, legs[i - 1].im, 'and BEGIN on the one before it, exactly')
    assert.equal(began.zoom, legs[i - 1].zoom, 'and BEGIN on the one before it, exactly')
  }
  // The two ends are not symmetric, and the asymmetry is a fact about floating
  // point: `a + (b − a)·0` is exactly `a`, so the start branch is a guard, while
  // `a + (b − a)·1` is routinely a hair off `b`, so the end branch is the one
  // carrying the arrival. Disabling the start branch is therefore a mutation
  // that SHOULD survive — it is provably inert — and that is recorded here so
  // the next reader does not mistake it for a hole.
  // The join between two legs is a place, not a seam: crossing it must not jump.
  const w0 = dsSegmentWeight(legs[0], legs[1])
  const w1 = dsSegmentWeight(legs[1], legs[2])
  const uJoin = w0 / (w0 + w1)
  const before = dsTourViewAt(base, legs, uJoin - 1e-9)
  const after = dsTourViewAt(base, legs, uJoin + 1e-9)
  assert.ok(Math.hypot(after.re - before.re, after.im - before.im) < dsPixelScale(legs[1].zoom, 800),
    'the view must not jump by a pixel as the dive crosses a stop')

  /* ── 2. Constant apparent speed — with the naive version required to fail. ──
     Screen-space distance per equal step of `u`, measured at each step's
     geometric-mean zoom (the exact scale for a geometric ramp). The correct
     weighting makes these equal; lerping the centre makes them span the whole
     zoom range, which is the same bug in every hand-rolled fractal zoom video. */
  const screenSteps = (viewAt, stops, samples = 48, width = 800) => {
    const out = []
    let prev = viewAt(stops, 0)
    for (let i = 1; i <= samples; i += 1) {
      const cur = viewAt(stops, i / samples)
      const scale = dsPixelScale(Math.sqrt(prev.zoom * cur.zoom), width)
      out.push(Math.hypot(cur.re - prev.re, cur.im - prev.im) / scale)
      prev = cur
    }
    return out
  }
  const spread = (xs) => Math.max(...xs) / Math.max(1e-12, Math.min(...xs))

  const realSteps = screenSteps((stops, u) => dsTourViewAt(base, stops, u), dive)
  assert.ok(
    spread(realSteps) < 1.02,
    `the centre must cross the screen at a constant rate; spread was ${spread(realSteps).toFixed(3)}`,
  )
  assert.ok(realSteps[0] > 0.5, 'and it must actually move — a spread of 1 over zero motion proves nothing')

  // The tempting version: lerp the centre, lerp log(zoom). Renders beautifully,
  // and is wrong. If this ever passes the check above, the check is broken.
  const naiveViewAt = (stops, u) => {
    const a = stops[0]
    const b = stops[stops.length - 1]
    return {
      ...base,
      re: a.re + (b.re - a.re) * u,
      im: a.im + (b.im - a.im) * u,
      zoom: a.zoom * Math.pow(b.zoom / a.zoom, u),
    }
  }
  const naiveSteps = screenSteps(naiveViewAt, dive)
  assert.ok(
    spread(naiveSteps) > 1000,
    'the linear-pan oracle must FAIL the uniform-speed check, or the check has no teeth',
  )

  // The weight's own shape: 0 and 1 at the ends, monotone in between, and
  // front-loaded diving in / back-loaded pulling out — in both cases travelling
  // while the screen is cheap.
  assert.equal(dsPanWeight(1, 1e6, 0), 0)
  assert.equal(dsPanWeight(1, 1e6, 1), 1)
  assert.ok(dsPanWeight(1, 1e6, 0.25) > 0.9, 'diving in, the pan happens early')
  assert.ok(dsPanWeight(1e6, 1, 0.75) < 0.1, 'pulling out, the pan happens late')
  assert.ok(Math.abs(dsPanWeight(100, 100, 0.5) - 0.5) < 1e-12, 'constant zoom has no weighting to apply')
  let prevW = -1
  for (let i = 0; i <= 100; i += 1) {
    const w = dsPanWeight(1, 1e9, i / 100)
    assert.ok(w >= prevW, 'the pan must never reverse')
    prevW = w
  }

  /* ── 3. Geometric zoom, and every frame inside the bounds. ──
     Equal steps of `u` inside one segment must magnify by the same FACTOR. And
     no interpolated view may need clamping: a clamp taking effect mid-dive would
     silently bend the path away from the stops it was told to visit. */
  let prevZoom = 0
  let ratio = 0
  for (let i = 0; i <= 200; i += 1) {
    const v = dsTourViewAt(base, dive, i / 200)
    assert.ok(v.zoom >= DS_MIN_ZOOM && v.zoom <= DS_MAX_ZOOM, 'a frame outside the zoom bounds')
    assert.ok(Math.abs(v.re) <= DS_MAX_COORD && Math.abs(v.im) <= DS_MAX_COORD, 'a frame outside the plane')
    assert.deepEqual(dsClampView(v), v, 'an interpolated view must already be in range — clamping mid-dive bends the path')
    if (i > 0) {
      assert.ok(v.zoom > prevZoom, 'a dive that only goes in must never back up')
      const step = v.zoom / prevZoom
      if (i === 1) ratio = step
      else assert.ok(Math.abs(step / ratio - 1) < 1e-9, 'equal steps of u must magnify by an equal FACTOR, not an equal amount')
    }
    prevZoom = v.zoom
  }

  /* ── 4. A pure pan still takes time. ──
     Weighting a dive by zoom decades alone gives a sideways drift along the
     coastline ZERO duration and skips it entirely — the frames all go to the
     zooming leg and the pan happens between two of them. */
  const panThenDive = [
    { re: -0.745, im: 0.113, zoom: 120 },
    { re: -0.7, im: 0.28, zoom: 120 },
    { re: -0.7, im: 0.28, zoom: 4e5 },
  ]
  assert.ok(dsSegmentScreenSpan(panThenDive[0], panThenDive[1]) > 1, 'a pan of many viewport widths must have real length')
  assert.equal(dsSegmentScreenSpan(panThenDive[1], panThenDive[2]), 0, 'a segment that only zooms has no screen travel')
  const earlyPan = dsTourViewAt(base, panThenDive, 0.2)
  assert.ok(Math.abs(earlyPan.zoom - 120) < 1e-6, 'a fifth of the way in, the dive is still on its panning leg')
  assert.ok(earlyPan.im > 0.113 && earlyPan.im < 0.28, 'and that leg is being travelled, not held')

  /* ── 5. Degenerate dives are answers, not NaN. ── */
  const still = [{ re: -0.6, im: 0, zoom: 4 }, { re: -0.6, im: 0, zoom: 4 }]
  for (const u of [0, 0.5, 1]) {
    const v = dsTourViewAt(base, still, u)
    assert.equal(v.zoom, 4, 'a dive between two identical stops is a still, not a divide-by-zero')
    assert.ok(Number.isFinite(v.re) && Number.isFinite(v.im))
  }
  assert.equal(dsTourViewAt(base, [], 0.5).zoom, dsClampView(base).zoom, 'no stops is the live view')
  assert.equal(dsTourViewAt(base, [{ re: 1, im: 0, zoom: 9 }], 0.5).zoom, 9, 'one stop is a destination, not a dive')

  /* ── 6. Stops are normalised at mint, which is what makes an out-of-range stop
     on decode proof of a hand-built token. ── */
  const hostileStops = [
    { re: 1e9, im: -1e9, zoom: 1e99 },
    { re: -0.6, im: 0, zoom: 1e-9 },
    ...Array.from({ length: 20 }, (_, i) => ({ re: 0, im: 0, zoom: 2 + i })),
  ]
  const normalised = dsNormalizeStops(hostileStops)
  assert.equal(normalised.length, DS_TOUR_MAX_STOPS, 'the stop count is capped at mint')
  for (const s of normalised) {
    assert.ok(Math.abs(s.re) <= DS_MAX_COORD && Math.abs(s.im) <= DS_MAX_COORD, 'coordinates clamped at mint')
    assert.ok(s.zoom >= DS_MIN_ZOOM && s.zoom <= DS_MAX_ZOOM, 'zoom clamped at mint')
  }
  assert.deepEqual(dsNormalizeStops([{ re: Number.NaN, im: 0, zoom: 1 }]), [], 'a stop that is not a number is not a stop')
  assert.deepEqual(dsNormalizeStops(undefined), [], 'no stops at all must not throw')

  /* ── 7. The permalink: enough digits, byte-stable, and exactly as bounded as
     `#view=` — because it IS `#view=` for its first stop. ── */
  assert.equal(dsEncodeTour(base, [dive[0]]), '', 'one stop is not a dive and mints no token')
  assert.equal(dsEncodeTour(base, []), '', 'nor is none')

  for (const stops of [dive, threeLeg, panThenDive]) {
    const token = dsEncodeTour(base, stops)
    assert.ok(token.length <= DS_TOUR_MAX_TOKEN_CHARS, "a minted token must fit inside the decoder's own character bound")
    const decoded = dsDecodeTour(token)
    assert.ok(decoded, 'a minted token must decode')
    assert.equal(decoded.stops.length, stops.length, 'every stop must survive the round trip')
    // Re-minting must be byte-identical, or the address bar drifts on its own as
    // replaceState re-encodes a dive it just read back.
    assert.equal(dsEncodeTour(decoded.view, decoded.stops), token, 'encode ∘ decode ∘ encode must be encode')
    // The precision rule, per stop: the round trip must land inside half a pixel
    // of a 3840px canvas at that stop's OWN zoom. Six fixed decimals fails this
    // past a zoom of about 10^5, which is the whole reason dsCoordDigits exists.
    for (let i = 0; i < stops.length; i += 1) {
      const half = dsPixelScale(stops[i].zoom, 3840) / 2
      assert.ok(
        Math.abs(decoded.stops[i].re - stops[i].re) <= half,
        `stop ${i + 1} lost more than half a pixel of precision`,
      )
      assert.ok(Math.abs(decoded.stops[i].im - stops[i].im) <= half, `stop ${i + 1} lost more than half a pixel`)
    }
  }

  // The character cap must EXCEED the widest token this encoder can mint, or it
  // silently refuses a legitimate eight-stop dive — a bound that rejects real
  // links is worse than no bound, because nothing looks broken until someone's
  // dive will not open. Derived from the bounds, not eyeballed.
  const widest = dsEncodeTour(
    { ...base, mode: 'julia', seedRe: -1.2345678, seedIm: 0.8765432, iter: 5000, density: 200 },
    Array.from({ length: DS_TOUR_MAX_STOPS }, (_, i) => ({
      re: -7.123456789012345 + i * 1e-15,
      im: 7.987654321098765 - i * 1e-15,
      zoom: DS_MAX_ZOOM / (i + 1),
    })),
  )
  assert.equal(widest.split(',').length, 12 + (DS_TOUR_MAX_STOPS - 1) * 3, 'the widest dive is a julia head plus seven geometry-only stops')
  assert.ok(
    widest.length <= DS_TOUR_MAX_TOKEN_CHARS,
    `the token cap (${DS_TOUR_MAX_TOKEN_CHARS}) must exceed the widest mintable dive (${widest.length})`,
  )
  assert.ok(dsDecodeTour(widest), 'and the widest mintable dive must decode')

  // Everything that is not a token this encoder could have minted.
  const good = dsEncodeTour(base, threeLeg)
  const goodParts = good.split(',')
  const refusals = [
    ['', 'empty'],
    ['t1', 'nothing but a version'],
    ['t2,' + goodParts.slice(1).join(','), 'an unknown version tag'],
    [good.replace('t1,3', 't1,1'), 'fewer stops than a dive has'],
    [good.replace('t1,3', `t1,${DS_TOUR_MAX_STOPS + 1}`), 'more stops than the cap'],
    // Field-count-consistent, so ONLY the ceiling can refuse it. The version of
    // this fixture that just edited the count field was refused by the field
    // count instead, and a mutation dropping the ceiling survived it.
    [
      ['t1', String(DS_TOUR_MAX_STOPS + 1), dsEncodeView(base),
        ...Array.from({ length: DS_TOUR_MAX_STOPS }, (_, i) => `0.${i}1,0.0${i}1,1000`)].join(','),
      'a well-formed dive with one stop too many',
    ],
    [goodParts.slice(0, goodParts.length - 1).join(','), 'a truncated tail — NOT silently a shorter dive'],
    [good + ',0', 'a field too many'],
    [good.replace('ember', 'chartreuse'), 'a palette outside the allowlist'],
    [good.replace(',m,', ',q,'), 'a mode that is neither'],
    [good.replace('-0.6', '99'), 'a stop outside the plane'],
    [good.replace('-0.6', '0x1'), 'a coordinate that is not a decimal number'],
    [good.replace(/,\d+$/, ',999999'), 'a zoom code past the ceiling'],
    ['t1,3,' + 'x'.repeat(DS_TOUR_MAX_TOKEN_CHARS), 'a token past the character cap'],
    [null, 'not a string'],
    [{}, 'not a string at all'],
  ]
  for (const [bad, why] of refusals) {
    assert.equal(dsDecodeTour(bad), null, `a tour token must be refused: ${why}`)
  }

  // The two formats must not be confusable for one another.
  assert.equal(dsDecodeTour(dsEncodeView(base)), null, 'a view token is not a dive')
  assert.equal(dsDecodeView(good), null, 'a dive token is not a view')

  // Fuzz: a hand-mangled link costs the dive, never the explorer. Deterministic
  // LCG so a failure is reproducible.
  let seed = 20260924
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  for (let i = 0; i < 4000; i += 1) {
    const chars = [...good]
    const cuts = 1 + Math.floor(rand() * 3)
    for (let c = 0; c < cuts; c += 1) {
      const at = Math.floor(rand() * chars.length)
      const how = Math.floor(rand() * 3)
      if (how === 0) chars.splice(at, 1)
      else if (how === 1) chars[at] = ',-.0123456789emj'[Math.floor(rand() * 16)]
      else chars.splice(at, 0, chars[at] ?? ',')
    }
    const token = chars.join('')
    let out
    assert.doesNotThrow(() => { out = dsDecodeTour(token) }, `decoding must not throw on ${token}`)
    if (out) {
      assert.ok(out.stops.length >= DS_TOUR_MIN_STOPS && out.stops.length <= DS_TOUR_MAX_STOPS)
      for (const s of out.stops) {
        assert.ok(Math.abs(s.re) <= DS_MAX_COORD && Math.abs(s.im) <= DS_MAX_COORD, 'a decoded stop outside the plane')
        assert.ok(s.zoom >= DS_MIN_ZOOM && s.zoom <= DS_MAX_ZOOM, 'a decoded stop outside the zoom bounds')
      }
    }
  }

  /* ── 8. The two fragment keys coexist. ──
     `dsTokenFromHash` was written to tolerate `&`-joined keys so the fragment
     could grow one later. This is that later, so both directions are pinned:
     neither reader may swallow the other's value, in either order. */
  const viewToken = dsEncodeView(base)
  for (const hash of [`#view=${viewToken}&tour=${good}`, `#tour=${good}&view=${viewToken}`]) {
    assert.equal(dsTokenFromHash(hash), viewToken, 'the view key must survive a tour key beside it')
    assert.equal(dsTourTokenFromHash(hash), good, 'and the tour key must survive the view key')
  }
  assert.equal(dsTourTokenFromHash(`#view=${viewToken}`), null, 'no tour key is no dive')
  assert.equal(dsTourTokenFromHash(''), null)
  assert.ok(dsDecodeTour(dsTourTokenFromHash(`#view=${viewToken}&tour=${good}`)), 'and the extracted token still decodes')

  /* ── 9. The cost ceiling spends a time budget against a measurement. ── */
  assert.equal(dsTourFrameCount(1), DS_TOUR_MAX_FRAMES, 'a machine this fast gets the maximum, not more')
  assert.equal(dsTourFrameCount(1e9), DS_TOUR_MIN_FRAMES, 'and one this slow gets the minimum, not zero')
  assert.equal(dsTourFrameCount(0), DS_TOUR_MAX_FRAMES, 'an unmeasurable frame must not divide by zero')
  assert.equal(dsTourFrameCount(Number.NaN), DS_TOUR_MAX_FRAMES, 'nor NaN its way to a NaN frame count')
  assert.equal(dsTourFrameCount(-5), DS_TOUR_MAX_FRAMES, 'nor a negative measurement to a negative count')
  let prevCount = Number.POSITIVE_INFINITY
  for (const ms of [10, 50, 100, 200, 400, 800, 1600]) {
    const n = dsTourFrameCount(ms)
    assert.ok(Number.isInteger(n), 'a frame count is a whole number of frames')
    assert.ok(n >= DS_TOUR_MIN_FRAMES && n <= DS_TOUR_MAX_FRAMES, 'bounded at both ends')
    assert.ok(n <= prevCount, 'a slower frame must never buy MORE frames')
    prevCount = n
  }
  // A smaller budget must buy fewer frames, or the budget is decorative.
  assert.ok(dsTourFrameCount(100, 2000) < dsTourFrameCount(100, 9000), 'the budget argument must matter')

  for (const n of [1, DS_TOUR_MIN_FRAMES, 24, DS_TOUR_MAX_FRAMES, 1000]) {
    const delay = dsTourDelay(n)
    assert.ok(delay >= DS_TOUR_DELAY_MIN && delay <= DS_TOUR_DELAY_MAX, 'the frame delay is bounded')
    assert.equal(delay % 10, 0, "GIF's clock counts centiseconds, so a delay must be a multiple of 10ms")
  }
  assert.ok(dsTourDelay(DS_TOUR_MAX_FRAMES) < dsTourDelay(DS_TOUR_MIN_FRAMES), 'more frames must play faster per frame')

  assert.ok(Math.abs(dsTourDecades(dive) - Math.log10(5e7)) < 1e-9, 'the quoted depth is the zoom range it covers')
  assert.ok(dsTourDecades(threeLeg) > dsTourDecades(dive), 'a leg that climbs back out still costs decades of travel')

  /* ── 10. The component and the shared export bar are wired the way the module
     assumes, and the module stays DOM-free so all of the above can run here. ── */
  const tourSrc = await readFile(new URL('../src/components/games/deep-shore/tour.ts', import.meta.url), 'utf-8')
  // Comments stripped first: the prose in this module discusses the canvas and
  // the document it is not allowed to touch, and an assertion that cannot tell
  // the two apart is one somebody deletes rather than satisfies.
  const tourCode = tourSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  for (const forbidden of ['document', 'window', 'localStorage', 'HTMLCanvasElement', 'ImageData', 'requestAnimationFrame']) {
    assert.ok(!new RegExp(`\\b${forbidden}\\b`).test(tourCode),
      `tour.ts must stay DOM-free (found "${forbidden}") — it is asserted in Node, and a claim buried in a DOM handler cannot be`)
  }
  assert.ok(!/DS_BAILOUT|Math\.log2\(Math\.log\(/.test(tourSrc), 'the iteration belongs to escape.ts; the path belongs here')

  const dsSrc2 = await readFile(new URL('../src/components/games/deep-shore/DeepShore.ts', import.meta.url), 'utf-8')
  assert.ok(/from '\.\/tour'/.test(dsSrc2), 'the component imports the path maths rather than carrying its own copy')
  assert.ok(/dsTourViewAt\(/.test(dsSrc2), 'and asks it for each frame')
  assert.ok(!/Math\.pow\([^)]*zoom/.test(dsSrc2), 'no second zoom interpolation in the component')
  assert.ok(/#view=\$\{token\}&tour=\$\{tour\}/.test(dsSrc2), 'the dive rides the FRAGMENT, in its own key beside the view')
  assert.ok(!/\?tour=/.test(dsSrc2), 'and never a query string — a fragment reaches no server log or Referer header')
  assert.ok(/dsDecodeTour\(/.test(dsSrc2), 'a restored dive is validated by the same decoder as a shared one')
  assert.ok(/liveGif: false/.test(dsSrc2),
    'live capture must stay OFF here: this canvas only redraws when touched, so filming it records a still frame')
  assert.ok(/dsTourFrameCount\(Math\.max\(1, first\.ms, last\.ms\)\)/.test(dsSrc2),
    'the frame count comes from a MEASUREMENT of both ends, not from a constant')
  assert.ok(/if \(cancelled\(\)\)/.test(dsSrc2), 'a render whose frames cost a second each must be stoppable')
  assert.ok(/await this\.yieldTurn\(\)[\s\S]{0,200}renderTourFrameData/.test(dsSrc2),
    'and must yield BEFORE each frame, or the progress line never repaints and the stop button is never seen')
  assert.ok(/this\.diveBusy = false/.test(dsSrc2.slice(dsSrc2.indexOf('disconnectedCallback()'), dsSrc2.indexOf('disconnectedCallback()') + 600)),
    'leaving the page must end a preview — a loop painting into a detached canvas runs forever')

  const cxSrc = await readFile(new URL('../src/lib/canvas-export.ts', import.meta.url), 'utf-8')
  assert.ok(/plan\.frames\[Math\.min\(frame, plan\.frames\.length - 1\)\]/.test(cxSrc),
    'held end frames must REUSE the last frame — re-rendering the most expensive frame in the dive is the last thing this should cost')
  assert.ok(/escapeAttr\(animation\.title\)/.test(cxSrc) && /escapeText\(animation\.label\)/.test(cxSrc),
    'a label interpolated into HTML is escaped, whatever the call site passes today')
  assert.ok(/bar\.querySelector\('\[data-cx="gif"\]'\)\?\./.test(cxSrc),
    'the live-GIF handler must be optional-chained, or a bar built without that button throws on mount')
  assert.ok(/if \(running\) \{/.test(cxSrc), 'a second click on a running render is a stop, not a second render')
}
console.log('deep shore dive recorder: the pan is weighted by the zoom (and the naive version fails that check), the dive arrives exactly, #tour= is bounded at mint and decode, and the frame count is measured rather than assumed')

/* ─────  404 suggested links read the section predicate  ─────
   The 404 page's link list is one more consumer of "which sections exist".
   Hand-written, it advertised /blogs for days after the section was gated
   hidden — the one link list no predicate reached. It must derive from
   navLinks(), which applies isBlogsPublic (asserted in both flag states
   elsewhere in this file), so it can never disagree with the nav and footer. */
{
  const nf = await readFile(new URL('../src/pages/404.astro', import.meta.url), 'utf8')
  assert.ok(/import \{ getSite, navLinks \} from/.test(nf), '404 must derive its suggested links from navLinks()')
  assert.ok(/links\.map\(/.test(nf), '404 must render the derived links, not a literal list')
  assert.ok(!/href="\/blogs"/.test(nf), '404 must not hand-write a /blogs link — the flag gates it via navLinks()')
}
console.log('404 suggested links derive from navLinks() — no hand-written section list to drift from the flag')

/* ─────  Link Peek: the fetch is the trust boundary  ─────

   /api/tools/link-peek makes the ORIGIN fetch a URL an anonymous visitor
   typed — textbook SSRF surface. The guard has to hold in both halves:
   the address classifier (pure — asserted against literal addresses, private,
   link-local/metadata, CGNAT, mapped-v6 and the decimal/hex/octal IPv4 forms
   the WHATWG URL parser canonicalises), and the fetch loop (asserted at source
   level: every REDIRECT hop re-runs the full validation, because a redirect is
   the remote server choosing the next URL — the thing being checked must not
   supply the terms of its own check).

   The unfurl side is asserted the same way the tool's product demands: the
   extraction ignores commented-out and script-quoted tags, entities decode in
   one pass, platform precedence matches the platforms, and — the negative that
   keeps the linter honest — a complete, correct tag set produces ZERO findings,
   while the snippet the tool recommends passes its own lint. */
{
  const {
    LP_MAX_HTML_BYTES, LP_MAX_IMAGE_BYTES, LP_MAX_REDIRECTS, LP_TIMEOUT_MS, LP_USER_AGENTS,
    lpDecodeHtml, lpIsForbiddenHostname, lpIsForbiddenIp, lpValidateUrl,
  } = await import('../src/lib/link-peek-fetch.ts')
  const {
    lpDecodeEntities, lpExtractMeta, lpFirst, lpLint, lpMetaSnippet, lpResolvePreviews,
  } = await import('../src/components/tools/link-peek/unfurl.ts')

  // ── URL gate: scheme, credentials, port, length ──
  assert.ok(lpValidateUrl('https://example.com/page').ok)
  assert.ok(lpValidateUrl('http://example.com').ok)
  for (const bad of [
    'ftp://example.com/x', 'javascript:alert(1)', 'file:///etc/passwd',
    'https://user:pw@example.com/', 'https://example.com:8443/', 'http://example.com:8080/',
    '', 'not a url', 'https://' + 'a'.repeat(3000) + '.com/',
  ]) {
    assert.equal(lpValidateUrl(bad).ok, false, `URL gate must refuse: ${bad.slice(0, 40)}`)
  }

  // ── address classifier: every range the origin must never dial ──
  for (const ip of [
    '127.0.0.1', '127.255.255.255', '0.0.0.0', '10.0.0.1', '192.168.1.1',
    '172.16.0.1', '172.31.255.255', '169.254.169.254', '100.64.0.1', '100.127.9.9',
    '192.0.0.1', '192.0.2.1', '198.18.0.1', '198.51.100.7', '203.0.113.9',
    '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fec0::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:169.254.169.254',
    '64:ff9b::a00:1', '2001:db8::1', 'ff02::1', 'not-an-ip',
    // 6to4 (2002::/16) is routed to the v4 address in its next 32 bits, so it is
    // classified AS that address: loopback, RFC 1918 and the metadata service.
    '2002:7f00:0001::', '2002:0a00:0001::1', '2002:a9fe:a9fe::1',
    // Teredo (2001::/32) tunnels to wherever the relay says; discard-only 100::/64.
    '2001::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '100::1', '100::ffff:ffff:ffff:ffff',
    // The 6to4 relay anycast block, deprecated by RFC 7526.
    '192.88.99.1', '192.88.99.255',
  ]) {
    assert.ok(lpIsForbiddenIp(ip), `classifier must forbid ${ip}`)
  }
  for (const ip of [
    '1.1.1.1', '8.8.8.8', '93.184.216.34', '172.15.0.1', '172.32.0.1',
    '100.63.255.255', '100.128.0.1', '198.17.0.1', '223.255.255.255',
    '2606:4700:4700::1111', '2600::1', '::ffff:8.8.8.8',
    // The v6 rules are prefixes, not "starts with 2001": Google's public
    // resolver lives in 2001:4860::/32, one hextet away from Teredo. And a
    // 6to4 address embedding a PUBLIC v4 is that public address.
    '2001:4860:4860::8888', '2002:0808:0808::1',
    '192.88.98.1', '192.88.100.1',
  ]) {
    assert.equal(lpIsForbiddenIp(ip), false, `classifier must allow public ${ip}`)
  }

  // The WHATWG URL parser canonicalises decimal/hex/octal IPv4 forms — assert
  // the pipeline (parse, then classify .hostname) catches the classic bypass
  // spellings of 127.0.0.1.
  for (const sneaky of ['http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/', 'http://127.1/']) {
    const parsed = lpValidateUrl(sneaky)
    assert.ok(parsed.ok, `URL parser should parse ${sneaky}`)
    assert.ok(lpIsForbiddenHostname(parsed.url.hostname), `canonicalised ${sneaky} → ${parsed.url.hostname} must be forbidden`)
  }

  // ── hostname gate ──
  for (const host of ['localhost', 'sub.localhost', 'printer.local', 'db.internal', 'nas.home.arpa', 'router', '[::1]', '']) {
    assert.ok(lpIsForbiddenHostname(host), `hostname gate must refuse ${host || '(empty)'}`)
  }
  assert.equal(lpIsForbiddenHostname('example.com'), false)
  assert.equal(lpIsForbiddenHostname('example.com.'), false, 'a trailing dot is still the same public name')

  // ── bounds exist and are sane ──
  assert.ok(LP_MAX_HTML_BYTES <= 1024 * 1024, 'HTML read cap stays bounded')
  assert.ok(LP_MAX_IMAGE_BYTES <= 1024 * 1024, 'image proxy cap stays bounded')
  assert.ok(LP_MAX_REDIRECTS <= 5 && LP_TIMEOUT_MS <= 10_000, 'redirects and total time stay bounded')
  assert.ok(!Object.values(LP_USER_AGENTS).some(v => /[\r\n]/.test(v)), 'no UA value can smuggle a header break')

  // ── the redirect loop re-validates every hop, at source level ──
  const lpFetchSrc = await readFile(new URL('../src/lib/link-peek-fetch.ts', import.meta.url), 'utf8')
  const loopAt = lpFetchSrc.indexOf('for (let hop')
  const fetchAt = lpFetchSrc.indexOf('await fetch(', loopAt)
  assert.ok(loopAt !== -1 && fetchAt !== -1, 'the hop loop and its fetch exist')
  for (const guard of ['lpValidateUrl(current)', 'lpIsForbiddenHostname(', 'lpCheckResolved(']) {
    const at = lpFetchSrc.indexOf(guard, loopAt)
    assert.ok(at !== -1 && at < fetchAt, `${guard} must run INSIDE the hop loop, before the fetch — a redirect is the server choosing the next URL`)
  }
  assert.ok(lpFetchSrc.includes("redirect: 'manual'"), 'fetch must not auto-follow redirects past the guard')

  // ── the route: both limiters, allowlisted UA, no-store, image type check ──
  const lpRouteSrc = await readFile(new URL('../src/pages/api/tools/link-peek.ts', import.meta.url), 'utf8')
  assert.equal((lpRouteSrc.match(/createRateLimiter\(/g) || []).length, 2, 'per-client AND global outbound limiters — each hit costs the origin an outbound fetch')
  assert.ok(lpRouteSrc.includes("'Cache-Control': 'no-store'"), 'preview responses are never edge-cached')
  assert.ok(lpRouteSrc.includes('hasOwnProperty.call(LP_USER_AGENTS'), 'the UA is an allowlist KEY — free text here is header injection')
  assert.ok(/const type = lpImageMediaType\(fetched\.contentType\)/.test(lpRouteSrc) && !lpRouteSrc.includes("startsWith('image/')"),
    'the image proxy relays only an allowlisted image media type — see the PR 19 nits block for the grammar')

  // ── charset decode: header wins, sniff second, junk falls back ──
  const enc = new TextEncoder()
  assert.equal(lpDecodeHtml(enc.encode('<p>plain</p>'), 'text/html; charset=utf-8').charset, 'utf-8')
  assert.equal(lpDecodeHtml(enc.encode('<meta charset="ISO-8859-1"><p>x</p>'), 'text/html').charset, 'iso-8859-1')
  assert.equal(lpDecodeHtml(enc.encode('<p>x</p>'), 'text/html; charset=no-such-charset').charset, 'utf-8', 'an unknown label degrades to utf-8, never throws')

  // ── entities: one pass, no double decode ──
  assert.equal(lpDecodeEntities('&amp;lt;'), '&lt;', 'single-pass decode — &amp;lt; is the TEXT "&lt;"')
  assert.equal(lpDecodeEntities('&#x27;&#39;'), "''")
  assert.equal(lpDecodeEntities('a &amp; b &lt;c&gt;'), 'a & b <c>')
  assert.equal(lpDecodeEntities('&#xD800;'), '&#xD800;', 'a surrogate half is not a code point')
  assert.equal(lpDecodeEntities('&nosuch;'), '&nosuch;')

  // ── extraction ──
  const lpPage = 'https://example.com/post?utm=1'
  const lpHtml = `<!doctype html><html><head>
    <title> The &amp; Title </title>
    <meta charset=utf-8>
    <!-- <meta property="og:title" content="commented out"> -->
    <script>var x = '<meta property="og:title" content="in a script">';</script>
    <meta property="og:title" content="First &quot;Wins&quot;">
    <meta property="og:title" content="Second is dead weight">
    <meta property='og:description' content='Desc &#8212; here'>
    <meta property="og:image" content="/img/card.png">
    <meta property="og:image:alt" content="">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="TW Title">
    <meta name="description" content="Plain meta description">
    <link rel="canonical" href="/post">
    <link rel="shortcut icon" href="/fav.png">
  </head><body></body></html>`
  const lpMeta = lpExtractMeta(lpHtml, lpPage)
  assert.equal(lpMeta.title, 'The & Title')
  assert.equal(lpFirst(lpMeta.og, 'og:title'), 'First "Wins"', 'og repeats: first tag wins; commented/script-quoted tags are not tags')
  assert.equal(lpFirst(lpMeta.og, 'og:description'), 'Desc — here')
  assert.equal(lpMeta.metaDescription, 'Plain meta description')
  assert.equal(lpMeta.canonical, 'https://example.com/post', 'relative canonical resolves against the final URL')
  assert.equal(lpMeta.faviconUrl, 'https://example.com/fav.png')
  assert.ok(lpMeta.og.some(t => t.key === 'og:image:alt' && t.value === ''), 'present-but-empty tags are KEPT — they lint as empty, not as missing')
  assert.equal(lpMeta.charsetDeclared, 'utf-8')

  // ── platform precedence ──
  const lpPrev = lpResolvePreviews(lpMeta, lpPage)
  assert.equal(lpPrev.domain, 'example.com')
  assert.equal(lpPrev.x.title, 'TW Title', 'X reads twitter:* before og:*')
  assert.equal(lpPrev.slack.title, 'First "Wins"', 'Slack reads og:* before twitter:*')
  assert.equal(lpPrev.x.card, 'summary_large_image')
  assert.equal(lpPrev.slack.large, true, 'Slack sizes its image from the twitter:card type')
  assert.equal(lpPrev.slack.imageUrl, 'https://example.com/img/card.png', 'a relative og:image resolves against the page')
  const lpNoCard = lpResolvePreviews(lpExtractMeta('<meta property="og:title" content="T">', lpPage), lpPage)
  assert.equal(lpNoCard.x.card, null, 'no twitter:card → X renders NO card, however complete the og: tags')
  const lpBadCard = lpResolvePreviews(lpExtractMeta('<meta name="twitter:card" content="mega"><meta property="og:title" content="T">', lpPage), lpPage)
  assert.equal(lpBadCard.x.card, 'summary', 'an unknown card value degrades to summary')
  const lpJsImg = lpResolvePreviews(lpExtractMeta('<meta property="og:image" content="javascript:alert(1)">', lpPage), lpPage)
  assert.equal(lpJsImg.slack.imageUrl, null, 'a non-http(s) og:image never survives resolution')

  // ── lint: the negative first — a correct page yields ZERO findings ──
  const lpCleanHtml = `<title>Short title</title>
    <meta charset="utf-8">
    <meta property="og:title" content="Short title">
    <meta property="og:description" content="A short description.">
    <meta property="og:image" content="https://example.com/card.png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:url" content="https://example.com/post">
    <meta name="twitter:card" content="summary_large_image">`
  assert.deepEqual(lpLint(lpExtractMeta(lpCleanHtml, lpPage), lpPage), [], 'a complete, correct tag set produces ZERO findings — a linter that always finds something gets ignored')

  const lpFind = (html, code) => lpLint(lpExtractMeta(html, lpPage), lpPage).some(f => f.code === code)
  assert.ok(lpFind('<title>t</title>', 'IMAGE_MISSING'))
  assert.ok(lpFind('<meta property="og:title" content="">', 'EMPTY:og:title'), 'present-but-empty is its own finding, not "missing"')
  assert.ok(lpFind('<meta property="og:image" content="/rel.png">', 'IMAGE_RELATIVE'))
  assert.ok(lpFind('<meta property="og:image" content="http://example.com/x.png">', 'IMAGE_INSECURE'))
  assert.ok(lpFind('<meta property="og:title" content="T">', 'CARD_MISSING'))
  assert.ok(lpFind('<meta property="og:image" content="https://e.com/x.png"><meta property="og:image:width" content="64"><meta property="og:image:height" content="64">', 'IMAGE_TINY'))
  assert.ok(lpFind(`<meta property="og:title" content="${'x'.repeat(80)}">`, 'TITLE_LONG'))
  assert.ok(lpFind('<meta property="og:title" content="a"><meta property="og:title" content="b">', 'DUPLICATE:og:title'))

  // ── the snippet the tool recommends passes its own lint ──
  const lpSnippet = lpMetaSnippet(lpExtractMeta(lpCleanHtml, lpPage), lpPage)
  assert.ok(!lpSnippet.includes('TODO'), 'a complete page needs no TODOs')
  const lpRelint = lpLint(lpExtractMeta(`<title>Short title</title><meta charset="utf-8">${lpSnippet}`, lpPage), lpPage)
  assert.deepEqual(lpRelint, [], 'the corrected snippet must pass the same lint that produced it')
  assert.ok(lpMetaSnippet(lpExtractMeta('<meta property="og:title" content=\'has "quotes" & <angles>\'>', lpPage), lpPage).includes('has &quot;quotes&quot; &amp; &lt;angles&gt;'), 'snippet values are attribute-escaped')

  // ── the component mounts through the shared dispatch ──
  const lpSlugSrc = await readFile(new URL('../src/pages/tools/[slug].astro', import.meta.url), 'utf8')
  assert.ok(lpSlugSrc.includes("slug === 'link-peek'") && lpSlugSrc.includes('link-peek/LinkPeek.ts'), 'link-peek is wired into the tool page and its astro:page-load mount dispatch')
}
console.log('link peek refuses every private address (each redirect hop re-checked), and its linter earns a clean bill')

/* ────────────────────────── daily streak strip (/games hub) ──────────────────
   The cross-game play-streak store: pure arithmetic (idempotent, rollback-
   safe, gap-resetting), storage re-validated on read, keys from a fixed slug
   allowlist, and the strip painted inside astro:page-load. The arithmetic is
   exercised for real; the DOM-bound wiring is asserted at source level. */
{
  const {
    DAILY_SLUGS,
    MAX_STREAK,
    advanceStreak,
    currentStreak,
    sanitizeStreak,
    utcDayFromDateString,
  } = await import('../src/lib/daily-streak.ts')
  const { quintleDayNumber } = await import('../src/lib/quintle-daily.ts')

  // ── pure arithmetic ──
  const d0 = 600
  const s1 = advanceStreak(null, d0)
  assert.deepEqual(s1, { last: d0, streak: 1, best: 1 }, 'first daily → 1-day streak')
  assert.deepEqual(advanceStreak(s1, d0), s1, 'a same-day record is a no-op — a re-render or second finish must not double-count')
  const s2 = advanceStreak(s1, d0 + 1)
  assert.deepEqual(s2, { last: d0 + 1, streak: 2, best: 2 }, 'the next day advances the streak')
  const s3 = advanceStreak(s2, d0 + 5)
  assert.deepEqual(s3, { last: d0 + 5, streak: 1, best: 2 }, 'a missed day resets the streak to 1 but never erases best')
  assert.deepEqual(advanceStreak(s3, d0 + 3), s3, 'a day EARLIER than the recorded one is refused — a rolled-back clock must not rewrite history')
  assert.deepEqual(advanceStreak(s3, Number.NaN), s3, 'a non-day is refused')
  assert.deepEqual(advanceStreak(s3, 10_000_000), s3, 'an out-of-range day is refused')

  // ── liveness as the hub reads it ──
  assert.equal(currentStreak(s2, d0 + 1), 2, 'finished today → streak shows')
  assert.equal(currentStreak(s2, d0 + 2), 2, 'finished yesterday → still alive (the come-back-today nudge)')
  assert.equal(currentStreak(s2, d0 + 3), 0, 'two days silent → lapsed, reads 0')
  assert.equal(currentStreak(null, d0), 0, 'no record → 0')

  // ── storage re-validation: corrupt or hand-edited data degrades to null ──
  assert.equal(sanitizeStreak('nope'), null)
  assert.equal(sanitizeStreak(null), null)
  assert.equal(sanitizeStreak({ last: 5, streak: 0, best: 0 }), null, 'a stored streak below 1 is not a state this module writes')
  assert.equal(sanitizeStreak({ last: 5, streak: 3, best: 2 }), null, 'best < streak is internally inconsistent')
  assert.equal(sanitizeStreak({ last: 5.5, streak: 1, best: 1 }), null, 'non-integer day')
  assert.equal(sanitizeStreak({ last: -1, streak: 1, best: 1 }), null, 'negative day')
  assert.equal(sanitizeStreak({ last: 5, streak: MAX_STREAK + 1, best: MAX_STREAK + 1 }), null, 'a streak past the ceiling is corrupt, not impressive')
  assert.deepEqual(sanitizeStreak({ last: 5, streak: 2, best: 4 }), { last: 5, streak: 2, best: 4 }, 'a valid state round-trips')

  // ── day-space glue ──
  assert.equal(utcDayFromDateString('2026-08-26'), Math.floor(Date.UTC(2026, 7, 26) / 86400000), "type trial's UTC date string converts to the raw UTC day number")
  assert.ok(Number.isNaN(utcDayFromDateString('26/08/2026')), 'a malformed date string yields NaN (which recordDailyPlay refuses)')
  assert.equal(quintleDayNumber(new Date(Date.UTC(2025, 0, 1))), 0, "quintle's launch date is day 0 in the shared module")
  assert.equal(quintleDayNumber(new Date(Date.UTC(2025, 0, 3, 12))), 2, 'quintle day numbers advance at UTC midnight')

  // ── each daily game records at its real completion point, with its own slug ──
  const qSrc = await readFile(new URL('../src/components/games/quintle/Quintle.ts', import.meta.url), 'utf8')
  assert.ok(qSrc.includes("from '../../../lib/quintle-daily'"), 'quintle imports its day derivation from the shared module')
  assert.ok(!qSrc.includes('Q_EPOCH_DAY'), 'the private epoch copy is gone — one day derivation, not two that can drift')
  assert.ok(qSrc.includes("recordDailyPlay('quintle', day)"), 'quintle records a played daily (win or lose) into the shared store')
  const ttSrc = await readFile(new URL('../src/components/games/type-trial/TypeTrial.ts', import.meta.url), 'utf8')
  assert.ok(ttSrc.includes("recordDailyPlay('type-trial', utcDayFromDateString(todayUtcDay()))"), 'type trial records a finished plausible daily run')
  const hhSrc = await readFile(new URL('../src/components/games/hue-hunt/HueHunt.ts', import.meta.url), 'utf8')
  assert.ok(hhSrc.includes("recordDailyPlay('hue-hunt', this.daily.day)"), 'hue hunt records when the fifth colour is scored')

  // ── the hub strip's wiring ──
  const stripSrc = await readFile(new URL('../src/lib/daily-streak-strip.ts', import.meta.url), 'utf8')
  assert.ok(stripSrc.includes('astro:page-load'), 'the strip must keep mounting inside astro:page-load (blank-on-nav bug otherwise)')
  assert.ok(stripSrc.includes('badge.textContent'), 'badge text is written via textContent')
  assert.ok(!stripSrc.includes('innerHTML'), 'the strip never writes innerHTML')
  assert.ok(/badge\?\.remove\(\)/.test(stripSrc), 'a lapsed streak repaints away instead of lingering')
  const gamesSrc = await readFile(new URL('../src/pages/games.astro', import.meta.url), 'utf8')
  assert.ok(gamesSrc.includes('registerDailyStreaks()'), 'the /games hub registers the strip')
  // The hub's intro counts the dailies in words. Pinned to the claim itself,
  // not to the first number word in the paragraph (the lesson of the /tools
  // intro assertion), and compared with the list the strip actually records.
  const gamesIntro = gamesSrc.slice(gamesSrc.indexOf('data-type="page-intro"'), gamesSrc.indexOf('</p>', gamesSrc.indexOf('data-type="page-intro"')))
  const dailyClaim = gamesIntro.match(/\b([A-Za-z]+)\s+have\s+a\s+daily\s+round\s+that\s+is\s+the\s+same\s+for\s+everyone\b/)
  assert.ok(dailyClaim, 'the /games intro still says, in words, how many games "have a daily round that is the same for everyone"')
  const DAILY_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }
  assert.equal(DAILY_WORDS[dailyClaim[1].toLowerCase()], DAILY_SLUGS.length,
    `the /games intro says "${dailyClaim[1]}" games have a daily round, but DAILY_SLUGS records ${DAILY_SLUGS.length} — update the copy and the list together`)

  // ── the slug allowlist is exactly the games the site ships as dailies ──
  assert.deepEqual([...DAILY_SLUGS], ['quintle', 'type-trial', 'hue-hunt'], 'DAILY_SLUGS is the fixed store-key allowlist')
}
console.log('daily streaks: arithmetic idempotent + rollback-safe, stored state re-validated, all three dailies record at their completion points, strip mounts inside astro:page-load')


/* ────────────────────────────────────────────────────────────────────────────
   Chainsaw — the TLS chain inspector (/tools/chainsaw).

   Three families of assertion, because the tool makes three kinds of claim:
   the DIAL is guarded (an anonymous visitor makes the origin open a socket),
   the READING of the chain is what the server actually sent (the two-handshake
   mechanism), and the FINDINGS are true about the certificates.

   The fixture PKI below is a real three-level EC chain generated with openssl
   — root → intermediate → leaf for fixture.chainsaw.test, with a wildcard SAN
   and a twenty-year life so the assertions do not rot. It is used to run REAL
   handshakes against a local TLS server, which is the only way to prove the
   load-bearing claim: that a probe with an empty trust store reports what the
   server put on the wire, while the ordinary one reports the chain the local
   store helped build.
   ──────────────────────────────────────────────────────────────────────────── */
{
  const CS_FIX_LEAF = `-----BEGIN CERTIFICATE-----
MIICGDCCAb2gAwIBAgIUNPDb09uBvmH3fEQCsOv8ZJ3RR4AwCgYIKoZIzj0EAwIw
QzEZMBcGA1UECgwQQ2hhaW5zYXcgRml4dHVyZTEmMCQGA1UEAwwdQ2hhaW5zYXcg
Rml4dHVyZSBJbnRlcm1lZGlhdGUwHhcNMjYwOTE5MTUzNjQ1WhcNNDYwOTE0MTUz
NjQ1WjAgMR4wHAYDVQQDDBVmaXh0dXJlLmNoYWluc2F3LnRlc3QwWTATBgcqhkjO
PQIBBggqhkjOPQMBBwNCAAQns7Com2fUdccespLjYjz/l3gADNvC3p9OzlURh/Mn
G0VvFGdV+Z5lDS2umBRED2hEO3Bwv77004nesJ+0wXtXo4GxMIGuMAwGA1UdEwEB
/wQCMAAwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMDkGA1Ud
EQQyMDCCFWZpeHR1cmUuY2hhaW5zYXcudGVzdIIXKi5maXh0dXJlLmNoYWluc2F3
LnRlc3QwHQYDVR0OBBYEFPNcosGIO+1vnmYt6+mzQfHE7HRSMB8GA1UdIwQYMBaA
FI4Q3zjY9Bmg9Diur9bxq9ruLMgQMAoGCCqGSM49BAMCA0kAMEYCIQDdMafp2mHQ
Lvuh0wKiv+nRULnhBm62KAtnIjE6OU5TDQIhAKcmpLL+3GdPbBtDyHpH3IN2giaB
bvD64SQyvLLJ3b7F
-----END CERTIFICATE-----`
  const CS_FIX_INT = `-----BEGIN CERTIFICATE-----
MIIB5TCCAYygAwIBAgIUDaf6+aTK5CHgXeoFFxoEG8pgeQUwCgYIKoZIzj0EAwIw
OzEZMBcGA1UECgwQQ2hhaW5zYXcgRml4dHVyZTEeMBwGA1UEAwwVQ2hhaW5zYXcg
Rml4dHVyZSBSb290MB4XDTI2MDkxOTE1MzY0NVoXDTQ2MDkxNDE1MzY0NVowQzEZ
MBcGA1UECgwQQ2hhaW5zYXcgRml4dHVyZTEmMCQGA1UEAwwdQ2hhaW5zYXcgRml4
dHVyZSBJbnRlcm1lZGlhdGUwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARpRCv9
t6ESGpDvvhIqb+g+FqSMR2/j7L8o3w2kYlJMMvVuV/EPPTShwbcatvdfS5aDJoHx
ZUALL9cnFdZit2xKo2YwZDASBgNVHRMBAf8ECDAGAQH/AgEAMA4GA1UdDwEB/wQE
AwICBDAdBgNVHQ4EFgQUjhDfONj0GaD0OK6v1vGr2u4syBAwHwYDVR0jBBgwFoAU
YvBGstWm2dLeccA5CtU/Ox5sEGUwCgYIKoZIzj0EAwIDRwAwRAIgb9CiHomVDBgA
zbgKvhJAxFoK9G4mTG2AfnSic9mVeScCICPPT5UZMNpBKaPaYWPcCen2rjow274c
SLMhT7XXqw/P
-----END CERTIFICATE-----`
  const CS_FIX_ROOT = `-----BEGIN CERTIFICATE-----
MIIB3DCCAYGgAwIBAgIUZn87TImMxfM794apaOy3MImWs0swCgYIKoZIzj0EAwIw
OzEZMBcGA1UECgwQQ2hhaW5zYXcgRml4dHVyZTEeMBwGA1UEAwwVQ2hhaW5zYXcg
Rml4dHVyZSBSb290MB4XDTI2MDkxOTE1MzY0NVoXDTQ2MDkxNDE1MzY0NVowOzEZ
MBcGA1UECgwQQ2hhaW5zYXcgRml4dHVyZTEeMBwGA1UEAwwVQ2hhaW5zYXcgRml4
dHVyZSBSb290MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE9VdIxM1xJ+rSkP1Z
T7OhkSbY1GleG6h8qWGuCLPEzRg/Y+G5ePci3BrLdYTLKn5ymdQ+riSj39KQiYnf
ws590aNjMGEwHQYDVR0OBBYEFGLwRrLVptnS3nHAOQrVPzsebBBlMB8GA1UdIwQY
MBaAFGLwRrLVptnS3nHAOQrVPzsebBBlMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0P
AQH/BAQDAgEGMAoGCCqGSM49BAMCA0kAMEYCIQDuhmrlA3ypANlq00VV4TQ16u9A
7urajAwB3oA7SyavtAIhAPdFskmuZeGFz5/bc1ijnZTJZ/hmljeE1G5c4+2Mf2cG
-----END CERTIFICATE-----`
  const CS_FIX_KEY = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIE0+m48DSPKeiIH0amLVvmoq1MM37Iakn1El2TRJCYisoAoGCCqGSM49
AwEHoUQDQgAEJ7OwqJtn1HXHHrKS42I8/5d4AAzbwt6fTs5VEYfzJxtFbxRnVfme
ZQ0trpgURA9oRDtwcL++9NOJ3rCftMF7Vw==
-----END EC PRIVATE KEY-----`

  // ── the target gate: what may be dialled at all ──
  const ok = (t) => {
    const v = csValidateTarget(t)
    assert.ok(v.ok, `${t} should be accepted: ${v.ok ? '' : v.reason}`)
    return v
  }
  const no = (t, why) => assert.equal(csValidateTarget(t).ok, false, why)

  assert.deepEqual({ ...ok('example.com') }, { ok: true, host: 'example.com', port: 443, isIpLiteral: false })
  assert.equal(ok('EXAMPLE.com.').host, 'example.com', 'case and the trailing root dot are normalised')
  assert.equal(ok('example.com:8443').port, 8443)
  assert.equal(ok('https://example.com/deep/path?q=1').host, 'example.com', 'a pasted URL is reduced to its host')
  assert.equal(ok('https://example.com:993/x').port, 993)
  assert.equal(ok('[2606:4700:4700::1111]:993').host, '2606:4700:4700::1111')
  assert.equal(ok('1.1.1.1').isIpLiteral, true, 'an IP literal is flagged so SNI is omitted — SNI may not carry an address')

  // A port that is not on the TLS-on-connect list turns this into a port
  // scanner, which is the reason the allowlist exists rather than a range.
  for (const port of [22, 23, 80, 3306, 5432, 6379, 8080, 9200, 25, 587, 0, 65535]) {
    no(`example.com:${port}`, `port ${port} must not be dialled`)
  }
  for (const port of CS_ALLOWED_PORTS) assert.ok(csValidateTarget(`example.com:${port}`).ok, `${port} is on the allowlist`)
  assert.ok(CS_ALLOWED_PORTS.includes(443) && !CS_ALLOWED_PORTS.includes(80) && !CS_ALLOWED_PORTS.includes(22),
    'the allowlist holds TLS-on-connect ports and nothing else')

  no('', 'empty')
  no('   ', 'whitespace')
  no('ftp://example.com', 'a non-http scheme is refused rather than reinterpreted as a host')
  no('file:///etc/passwd', 'file: is refused')
  no('https://user:pw@example.com', 'embedded credentials are refused')
  no('ex ample.com', 'a space is not a hostname')
  no('exa\u0000mple.com', 'a NUL is not a hostname')
  no('example.com/../x', 'a slash is not part of a bare hostname')
  no('-example.com', 'a leading hyphen is not a hostname')
  no('a'.repeat(400), 'over the length ceiling')

  // ── the SSRF guard: ONE copy of the address rules, borrowed from Link Peek ──
  for (const addr of [
    '127.0.0.1', '10.0.0.1', '192.168.1.1', '172.16.0.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fc00::1', 'fec0::1', '64:ff9b::1', '::ffff:127.0.0.1',
  ]) {
    const v = await csResolvePinned(addr)
    assert.equal(v.ok, false, `${addr} must never be dialled`)
  }
  for (const name of ['localhost', 'db.local', 'vault.internal', 'router', 'printer.home.arpa', '2130706433', '0x7f000001']) {
    const v = await csResolvePinned(name)
    assert.equal(v.ok, false, `${name} must never be dialled`)
  }
  for (const addr of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) {
    const v = await csResolvePinned(addr)
    assert.ok(v.ok, `${addr} is a public address and may be dialled`)
    assert.equal(v.address, addr, 'the checked address is the one handed on to be pinned')
  }

  // ── source-level: the guard is reused, not re-implemented, and it is pinned ──
  const tlsSrc = await readFile(new URL('../src/lib/tls-inspect.ts', import.meta.url), 'utf-8')
  assert.ok(tlsSrc.includes("from './link-peek-fetch'"), 'the address classifier has ONE copy and this file imports it')
  assert.ok(!/\b169\.254\b/.test(tlsSrc.replace(/\/\*[\s\S]*?\*\//g, '')), 'no second copy of the private-range table outside comments')
  const inspectBody = tlsSrc.slice(tlsSrc.indexOf('export async function csInspect'))
  assert.ok(inspectBody.indexOf('csResolvePinned') < inspectBody.indexOf('csDial'), 'the address is resolved and checked BEFORE anything is dialled')
  assert.ok(tlsSrc.includes('host: opts.address'), 'the socket connects to the checked address')
  assert.ok(tlsSrc.includes('servername: opts.servername'), 'the NAME travels only as SNI — there is no second resolution to disagree with the first')
  assert.ok(tlsSrc.includes('ca: []'), 'the second handshake trusts nothing, which is how the presented chain is observed')
  assert.ok(/!bare\.authorized/.test(tlsSrc), 'an empty-store probe that comes back AUTHORIZED is discarded, not believed')
  assert.ok(tlsSrc.includes('rejectUnauthorized: false'), 'a bad certificate is the product — the dial must not refuse to look at one')

  const routeSrc = await readFile(new URL('../src/pages/api/tools/chainsaw.ts', import.meta.url), 'utf-8')
  assert.ok(routeSrc.includes('createRateLimiter(60_000, 6)') && routeSrc.includes("createRateLimiter(60_000, 24)"),
    'both a per-client and a global limiter — each hit costs the origin two outbound handshakes')
  assert.ok(routeSrc.includes("'Cache-Control': 'no-store'"), 'nothing about an inspection is cached')
  assert.ok(routeSrc.indexOf('csValidateTarget') < routeSrc.indexOf('allowClient'), 'a typo is rejected before it spends a rate-limit token')
  assert.ok(!routeSrc.includes('csDial('), 'the route goes through csInspect, which guards — it never dials directly')
  assert.ok(routeSrc.includes('csNameTrustAnchor'), 'the trust anchor is named by proof, not inferred from the authorized flag')

  // ── csAuthCode: Node hands this back as a string on some versions and an
  //    Error on others. Getting it wrong silently disables the anchor finding.
  assert.equal(csAuthCode('SELF_SIGNED_CERT_IN_CHAIN'), 'SELF_SIGNED_CERT_IN_CHAIN')
  assert.equal(csAuthCode(Object.assign(new Error('x'), { code: 'CERT_HAS_EXPIRED' })), 'CERT_HAS_EXPIRED')
  assert.equal(csAuthCode(new Error('CERT_HAS_EXPIRED')), 'CERT_HAS_EXPIRED')
  assert.equal(csAuthCode(null), null)
  assert.equal(csAuthCode(undefined), null)

  // ── the DER signature-algorithm read (X509Certificate does not expose it) ──
  const { X509Certificate } = await import('node:crypto')
  const fixLeaf = csDescribeCert(new X509Certificate(CS_FIX_LEAF))
  const fixInt = csDescribeCert(new X509Certificate(CS_FIX_INT))
  const fixRoot = csDescribeCert(new X509Certificate(CS_FIX_ROOT))
  assert.equal(fixLeaf.sigAlg, 'ecdsa-with-SHA256', 'the signature algorithm is read out of the DER')
  assert.equal(fixLeaf.subjectCN, 'fixture.chainsaw.test')
  assert.deepEqual(fixLeaf.san, ['DNS:fixture.chainsaw.test', 'DNS:*.fixture.chainsaw.test'])
  assert.deepEqual(fixLeaf.eku, ['serverAuth'], 'the EKU OID is resolved to a name')
  assert.equal(fixLeaf.isCa, false)
  assert.equal(fixLeaf.selfSigned, false)
  assert.equal(fixRoot.selfSigned, true, 'a root names itself as its own issuer')
  assert.equal(fixInt.isCa, true)
  assert.equal(fixLeaf.keyType, 'ec')
  // A certificate this cannot parse must cost the one field, never the report.
  assert.equal(csSignatureAlgorithm(new Uint8Array(0)), null)
  assert.equal(csSignatureAlgorithm(new Uint8Array([0x30, 0x80, 0x01])), null, 'indefinite length is BER, not DER — refused rather than guessed')
  assert.equal(csSignatureAlgorithm(new Uint8Array([1, 2, 3, 4, 5])), null)
  assert.equal(csSignatureAlgorithm(new Uint8Array(new X509Certificate(CS_FIX_LEAF).raw).subarray(0, 20)), null, 'a truncated certificate yields null, not a throw')

  // ── name matching: the wildcard rules clients actually enforce ──
  assert.equal(csNameMatches('example.com', 'example.com').match, true)
  assert.equal(csNameMatches('EXAMPLE.com', 'example.COM.').match, true, 'case-insensitive, trailing dot stripped')
  assert.equal(csNameMatches('*.example.com', 'www.example.com').match, true)
  assert.equal(csNameMatches('*.example.com', 'example.com').match, false, 'a wildcard stands for one label, not for nothing')
  assert.equal(csNameMatches('*.example.com', 'a.b.example.com').match, false, 'a wildcard is one label, not a suffix')
  assert.equal(csNameMatches('www*.example.com', 'www1.example.com').match, false, 'a partial label is not a wildcard to any modern client')
  assert.equal(csNameMatches('*.com', 'example.com').match, false, 'a registry-wide wildcard is refused')
  assert.equal(csNameMatches('*', 'example.com').match, false)
  // The label COUNT is what stops a suffix match, and the first version of this
  // block asserted only the cases the left-aligned comparison already caught —
  // so a mutation loosening the count survived. This is the case it guards: the
  // labels line up from the left and the real domain is somebody else's.
  assert.equal(csNameMatches('*.example.com', 'www.example.com.evil.test').match, false,
    'a wildcard must not match a host that merely STARTS with its domain')
  assert.equal(csNameMatches('*.a.example.com', 'x.example.com').match, false,
    '…nor a host with fewer labels than the pattern')
  assert.equal(csMatchHost('www.fixture.chainsaw.test.evil.test', fixLeaf).covered, false,
    'and the same through the SAN matcher the page actually calls')

  const fixMatch = csMatchHost('a.fixture.chainsaw.test', fixLeaf)
  assert.equal(fixMatch.covered, true)
  assert.equal(fixMatch.viaWildcard, true)
  assert.equal(csMatchHost('fixture.chainsaw.test', fixLeaf).viaWildcard, false, 'the exact SAN wins over the wildcard')
  assert.equal(csMatchHost('a.b.fixture.chainsaw.test', fixLeaf).covered, false)
  assert.deepEqual(fixMatch.dnsNames, ['fixture.chainsaw.test', '*.fixture.chainsaw.test'], 'the DNS: prefix is stripped off the SAN entries')

  // ── the CN-only trap: a name in the Common Name and in no SAN ──
  const cnOnlyCert = { ...fixLeaf, san: [], subjectCN: 'legacy.example.com' }
  const cnMatch = csMatchHost('legacy.example.com', cnOnlyCert)
  assert.equal(cnMatch.covered, false, 'the Common Name does not cover anything — clients stopped reading it in 2017')
  assert.equal(cnMatch.cnOnly, true, '…and the tool says WHY rather than just "no match"')

  // ── an IP SAN ──
  const ipCert = { ...fixLeaf, san: ['IP Address:203.0.113.10'] }
  assert.equal(csMatchHost('203.0.113.10', ipCert).covered, true)
  assert.equal(csMatchHost('203.0.113.11', ipCert).covered, false)

  // ── …and an IPv6 SAN, where ONE address has many legal spellings. The
  //    comparison used to be a string equality, so a certificate that really
  //    did cover the address being checked was reported as not covering it
  //    whenever Node's rendering and the visitor's typing disagreed — the worst
  //    failure mode this tool has, since the answer looks authoritative.
  assert.equal(csCanonicalIp('2001:0DB8:0000:0000:0000:0000:0000:0001'), csCanonicalIp('2001:db8::1'),
    'expanded and compressed spellings of one address canonicalise together')
  assert.equal(csCanonicalIp('[2001:db8::1]'), csCanonicalIp('2001:db8::1'), 'brackets are not part of the address')
  assert.equal(csCanonicalIp('fe80::1%eth0'), csCanonicalIp('fe80::1'), 'a zone id is local to a machine, never to a certificate')
  assert.equal(csCanonicalIp('::ffff:192.0.2.1'), csCanonicalIp('0:0:0:0:0:ffff:c000:201'), 'a trailing dotted quad is two hex groups')
  assert.equal(csCanonicalIp('::'), '0:0:0:0:0:0:0:0', 'the all-zero address is still an address')
  assert.equal(csCanonicalIp('203.0.113.10'), '203.0.113.10', 'a dotted quad canonicalises to itself')
  // …and it must REFUSE, not guess, so a DNS name never takes the IP path.
  for (const bad of ['example.com', '2001:db8::1::2', '2001:db8:0:0:0:0:0:0:1', 'gggg::1', '203.0.113', '203.0.113.256', '', '   ']) {
    assert.equal(csCanonicalIp(bad), null, `not an IP literal: ${JSON.stringify(bad)}`)
  }
  assert.notEqual(csCanonicalIp('::ffff:192.0.2.1'), csCanonicalIp('192.0.2.1'),
    'a v4-mapped v6 address is a DIFFERENT SAN entry from the v4 address it embeds, and is deliberately not folded onto it')

  const ip6Cert = { ...fixLeaf, san: ['IP Address:2001:DB8:0:0:0:0:0:1'] }
  assert.equal(csMatchHost('2001:db8::1', ip6Cert).covered, true, 'the host is covered however either side spells it')
  assert.equal(csMatchHost('[2001:db8::1]', ip6Cert).covered, true)
  assert.equal(csMatchHost('2001:db8::2', ip6Cert).covered, false, '…and a different address is still not covered')
  // An unparseable SAN value must not become a silent never-match.
  assert.equal(csMatchHost('not-an-ip', { ...fixLeaf, san: ['IP Address:not-an-ip'] }).covered, true,
    'an IP SAN this parser cannot read falls back to the literal comparison rather than to "no"')

  /* --- synthetic reports: one factory, so a finding test changes one field --- */
  const CS_DAY = 86_400_000
  const nowMs = Date.UTC(2026, 5, 1)
  const cert = (over = {}) => ({
    ...fixLeaf,
    validFrom: new Date(nowMs - 30 * CS_DAY).toISOString(),
    validTo: new Date(nowMs + 200 * CS_DAY).toISOString(),
    ...over,
  })
  const report = (over = {}) => ({
    host: 'fixture.chainsaw.test',
    port: 443,
    address: '203.0.113.1',
    family: 4,
    handshake: {
      protocol: 'TLSv1.3', cipher: 'TLS_AES_128_GCM_SHA256', cipherStandard: 'TLS_AES_128_GCM_SHA256',
      alpn: 'h2', ephemeralKey: 'ECDH X25519', ocspStapled: true,
      authorized: true, authorizationError: null, verifiedLength: 3,
    },
    presented: [cert(), cert({ ...fixInt, fingerprint256: 'INT', validTo: new Date(nowMs + 900 * CS_DAY).toISOString() })],
    anchorIncluded: false,
    presentedObserved: true,
    storeRoot: null,
    namedRoot: 'Chainsaw Fixture Root',
    elapsedMs: 42,
    ...over,
  })

  // ── the negative that matters: a correct host produces NO findings at all ──
  assert.deepEqual(csFindings(report(), nowMs), [],
    'a healthy host yields ZERO findings — a linter that always finds something is indistinguishable from one that guesses')
  assert.equal(csChainState(report()).state, 'complete')

  const idsOf = (r, t = nowMs) => csFindings(r, t).map(f => f.id)

  // incomplete chain: the headline finding
  const leafOnly = report({
    presented: [cert({ caIssuerUrls: ['http://ca.example/int.crt'] })],
    handshake: { ...report().handshake, authorized: false, authorizationError: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', verifiedLength: 1 },
  })
  assert.equal(csChainState(leafOnly).state, 'leaf-only')
  assert.ok(idsOf(leafOnly).includes('chain-incomplete'), 'a server that sent only the leaf is called out')
  assert.ok(idsOf(leafOnly).includes('aia-available'), '…and the URL of the missing certificate is handed over')
  assert.equal(idsOf(leafOnly).includes('untrusted'), false, 'the generic "not trusted" is suppressed when a specific finding already explains it')

  // an anchor the server should not be sending
  const withAnchor = report({
    presented: [cert(), cert({ ...fixInt, fingerprint256: 'INT' }), cert({ ...fixRoot, fingerprint256: 'ROOT', selfSigned: true })],
    anchorIncluded: true,
  })
  assert.equal(csChainState(withAnchor).state, 'anchor-included')
  assert.ok(idsOf(withAnchor).includes('anchor-included'))

  // expiry, in all four shapes
  assert.ok(idsOf(report({ presented: [cert({ validTo: new Date(nowMs - CS_DAY).toISOString() })] })).includes('expired'))
  assert.ok(idsOf(report({ presented: [cert({ validTo: new Date(nowMs + 5 * CS_DAY).toISOString() })] })).includes('expires-soon'))
  assert.ok(idsOf(report({ presented: [cert({ validFrom: new Date(nowMs + 2 * CS_DAY).toISOString() })] })).includes('not-yet-valid'))
  assert.ok(idsOf(report({
    presented: [cert({ validFrom: new Date(nowMs - 500 * CS_DAY).toISOString() })],
  })).includes('over-max-lifetime'), 'a leaf living longer than 398 days is flagged')

  // the expiry nobody watches: an intermediate that goes first
  const shortInt = report({
    presented: [cert(), cert({ ...fixInt, fingerprint256: 'INT', validTo: new Date(nowMs + 20 * CS_DAY).toISOString() })],
  })
  const effective = csEffectiveExpiry(shortInt.presented)
  assert.equal(effective.cert.fingerprint256, 'INT', 'the chain dies with its earliest certificate, which is not always the leaf')
  assert.ok(idsOf(shortInt).includes('intermediate-expires-first'))
  // …and an anchor's own expiry is the trust store's problem, not this server's
  assert.equal(csEffectiveExpiry([cert(), cert({ fingerprint256: 'ROOT', selfSigned: true, validTo: new Date(nowMs + CS_DAY).toISOString() })]).cert.fingerprint256,
    fixLeaf.fingerprint256, 'a self-signed anchor is excluded from the effective expiry')

  // hostname, keys and protocol
  assert.ok(idsOf(report({ host: 'elsewhere.example.com' })).includes('hostname-uncovered'))
  assert.ok(idsOf(report({ host: 'legacy.example.com', presented: [cert({ san: [], subjectCN: 'legacy.example.com' })] })).includes('cn-only'))
  assert.ok(idsOf(report({ presented: [cert({ sigAlg: 'sha1WithRSA' })] })).includes('weak-signature'))
  assert.ok(idsOf(report({ presented: [cert({ keyType: 'rsa', keyBits: 1024, keyCurve: null })] })).includes('weak-key'))
  assert.equal(idsOf(report({ presented: [cert({ keyType: 'rsa', keyBits: 2048, keyCurve: null })] })).includes('weak-key'), false, '2048-bit RSA is the floor, not a failure')
  assert.ok(idsOf(report({ handshake: { ...report().handshake, protocol: 'TLSv1.1' } })).includes('old-tls'))
  assert.ok(idsOf(report({ handshake: { ...report().handshake, ocspStapled: false } })).includes('no-ocsp-staple'))
  assert.ok(idsOf(report({ presented: [cert({ eku: ['clientAuth'] })] })).includes('no-serverauth'))
  assert.ok(idsOf(report({ presentedObserved: false })).includes('presented-unobserved'),
    'when the sent chain could not be observed the tool says so instead of reporting a guess')

  // findings are ordered errors → warns → infos, so the worst thing is first
  const mixed = csFindings(report({
    host: 'elsewhere.example.com',
    handshake: { ...report().handshake, ocspStapled: false, protocol: 'TLSv1.1' },
  }), nowMs)
  const levels = mixed.map(f => f.level)
  assert.deepEqual(levels, [...levels].sort((a, b) => ({ error: 0, warn: 1, info: 2 })[a] - ({ error: 0, warn: 1, info: 2 })[b]),
    'findings run errors first')

  // ── the PEM the user takes away ──
  const three = [fixLeaf, fixInt, { ...fixRoot, selfSigned: true }]
  assert.equal((csChainPem(three).match(/BEGIN CERTIFICATE/g) || []).length, 3, 'the chain as sent keeps everything')
  const serve = csServeChainPem(three)
  assert.equal((serve.match(/BEGIN CERTIFICATE/g) || []).length, 2, 'the chain to SERVE is leaf + intermediates and no anchor')
  assert.ok(serve.startsWith('-----BEGIN CERTIFICATE-----') && serve.endsWith('\n'), 'a PEM bundle starts at a header and ends with a newline')
  assert.ok(csServeChainPem([{ ...fixLeaf, selfSigned: true }]).includes('BEGIN CERTIFICATE'), 'a self-signed leaf is still the leaf — index 0 is never dropped')

  /* --- and now the load-bearing one, against real handshakes ---------------
     `getPeerCertificate(true)` reports the chain OpenSSL BUILT, not the one the
     server sent: with the root trusted it hands back three certificates for a
     server that sent two. A tool whose headline finding is "your chain is
     incomplete" cannot read the chain through a lens that completes it. These
     three servers prove the empty-store probe reports the wire, exactly. */
  const tlsMod = await import('node:tls')
  const serveFixture = (certBuf, port) => new Promise((res) => {
    const server = tlsMod.createServer({ key: CS_FIX_KEY, cert: certBuf }, (sock) => sock.end())
    server.listen(port, '127.0.0.1', () => res(server))
  })
  const shapes = [
    ['leaf only', CS_FIX_LEAF, 1, 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'],
    ['leaf + intermediate', `${CS_FIX_LEAF}\n${CS_FIX_INT}`, 2, 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'],
    ['leaf + intermediate + root', `${CS_FIX_LEAF}\n${CS_FIX_INT}\n${CS_FIX_ROOT}`, 3, 'SELF_SIGNED_CERT_IN_CHAIN'],
  ]
  let fixturePort = 15801
  for (const [label, certText, expected, expectedCode] of shapes) {
    const port = fixturePort++
    const server = await serveFixture(certText, port)
    try {
      const seen = await csDial({ address: '127.0.0.1', port, servername: 'fixture.chainsaw.test', emptyStore: true, deadline: Date.now() + 5000 })
      assert.ok(!seen.error, `${label}: the fixture handshake completed`)
      assert.equal(seen.authorized, false, `${label}: an empty trust store can never authorize — that is what makes the reading honest`)
      assert.equal(seen.chain.length, expected, `${label}: the empty-store probe reports exactly what the server put on the wire`)
      assert.equal(seen.authorizationError, expectedCode, `${label}: the verification code is the signal an anchor was sent`)
      assert.equal(seen.chain[0].subjectCN, 'fixture.chainsaw.test', `${label}: the leaf comes first`)
      // The anchor set is held against the code a server that really does send
      // its root produces, not against a remembered string.
      assert.equal(CS_ANCHOR_CODES.has(seen.authorizationError), expected === 3,
        `${label}: "the server sent its own root" is decided by the code this very handshake returned`)
    } finally {
      server.close()
    }
  }

  /* --- …and the same servers, with a store that CAN complete the chain -----
     This is the half that makes the claim falsifiable offline. The fixture root
     is handed in as an explicit trust store, which is what a public root does
     in production: the ordinary handshake then reports THREE certificates for a
     server that sent two — the third came out of the store, not off the wire —
     while the empty-store probe, applied afterwards and winning, still reports
     two. Drop `ca: []` and this is where it shows: the probe starts authorizing
     and starts reporting a certificate that never crossed the wire. */
  {
    const port = fixturePort++
    const server = await serveFixture(`${CS_FIX_LEAF}\n${CS_FIX_INT}`, port)
    try {
      const dial = (over) => csDial({
        address: '127.0.0.1', port, servername: 'fixture.chainsaw.test',
        trustAnchors: [CS_FIX_ROOT], deadline: Date.now() + 5000, emptyStore: false, ...over,
      })
      const built = await dial({})
      assert.equal(built.authorized, true, 'with the root trusted the chain verifies')
      assert.equal(built.chain.length, 3, 'a trusting client reports the chain it BUILT — root included — for a server that sent two certificates')
      assert.equal(built.chain[2].selfSigned, true, '…and that third certificate is the anchor the store supplied')

      const wire = await dial({ emptyStore: true })
      assert.equal(wire.authorized, false, 'the empty store beats an explicit one — it cannot authorize anything')
      assert.equal(wire.chain.length, 2, 'the empty-store probe still reports exactly the two certificates the server sent')
      assert.equal(wire.chain.some(c => c.selfSigned), false, 'no anchor appears in the wire reading, so "the server sends its root" is never reported for a correctly configured host')
    } finally {
      server.close()
    }
  }

  /* --- a name mismatch must not contaminate the CHAIN verdict --------------
     Node runs its own hostname check after path validation and, on a mismatch,
     reports `authorized: false` with ERR_TLS_CERT_ALTNAME_INVALID even though
     the chain verified perfectly. Left in place that leaked a hostname fact
     into the trust tile, and `csChainState` read the false flag and fell
     through to `incomplete` — telling the owner of a correctly configured
     server that an intermediate was missing. The fixture certificate covers
     fixture.chainsaw.test and nothing else, so dialling it under another SNI
     is exactly that case. */
  {
    const port = fixturePort++
    const server = await serveFixture(`${CS_FIX_LEAF}\n${CS_FIX_INT}`, port)
    try {
      const mismatched = await csDial({
        address: '127.0.0.1', port, servername: 'wrong.example.test',
        trustAnchors: [CS_FIX_ROOT], emptyStore: false, deadline: Date.now() + 5000,
      })
      assert.equal(mismatched.authorized, true, 'a chain that verifies is trusted even when the NAME does not match — the two are separate answers')
      assert.equal(mismatched.authorizationError, null, 'no ERR_TLS_CERT_ALTNAME_INVALID leaks into the chain-trust signal')

      const asReport = report({
        host: 'wrong.example.test',
        handshake: { ...report().handshake, authorized: mismatched.authorized, authorizationError: mismatched.authorizationError },
      })
      assert.equal(csChainState(asReport).state, 'complete', 'a perfect chain is still complete when the hostname is wrong')
      const ids = idsOf(asReport)
      assert.equal(ids.includes('chain-incomplete'), false, 'a hostname mismatch must never be reported as a missing intermediate')
      assert.ok(ids.includes('hostname-uncovered'), '…it is reported as what it is, by the matcher that can explain why')
    } finally {
      server.close()
    }
  }

  // A root's trust comes from the store, not from its own signature, so clients
  // exempt a root self-signature from the SHA-1 rule. Walking anchors here fired
  // a false weak-signature ERROR on healthy hosts that merely send their root.
  {
    const sha1Anchor = report({
      presented: [cert(), cert({ ...fixInt, fingerprint256: 'INT' }), cert({ ...fixRoot, fingerprint256: 'ROOT', selfSigned: true, sigAlg: 'sha1WithRSA' })],
      anchorIncluded: true,
    })
    const ids = idsOf(sha1Anchor)
    assert.equal(ids.includes('weak-signature'), false, "a SHA-1 SELF-signature on an anchor is not a finding — plenty of trusted roots carry one")
    assert.ok(ids.includes('anchor-included'), '…the anchor is still reported as wasted bytes')
    assert.ok(idsOf(report({ presented: [cert(), cert({ ...fixInt, fingerprint256: 'INT', sigAlg: 'sha1WithRSA' })] })).includes('weak-signature'),
      'a SHA-1 signature on a real INTERMEDIATE is still a finding')
  }

  // The port allowlist has ONE home. It used to be a hand-typed prose copy in
  // the component, free to drift the first time a port was added.
  {
    const uiSrc = await readFile(new URL('../src/components/tools/chainsaw/Chainsaw.ts', import.meta.url), 'utf-8')
    assert.ok(uiSrc.includes('CS_ALLOWED_PORTS.join'), 'the page renders the port list from the array it is enforced from')
    for (const port of CS_ALLOWED_PORTS) {
      assert.equal(new RegExp(`\\b${port}, `).test(uiSrc), false, `the component must not hand-type port ${port}`)
    }
    assert.ok(tlsSrc.includes('checkServerIdentity'), 'the dial neutralises Node\'s hostname check so `authorized` means chain trust alone')
  }

  // ── Naming the anchor when the server sends its OWN root.
  //    The self-signed case used to return null, so the one configuration the
  //    `anchor-included` finding is written about was also the only one whose
  //    anchor the tool could not name. The name is in the subject line — and a
  //    subject line is the cheapest thing on earth to forge on a self-signed
  //    certificate, so it is proved instead: the exact certificate has to be in
  //    the bundled store, byte for byte.
  {
    const { rootCertificates: storeRoots } = await import('node:tls')
    assert.ok(storeRoots.length > 25, 'the premise: this build ships a root store')
    const named = storeRoots
      .slice(0, 25)
      .map(pem => csNameTrustAnchor(pem))
      .filter(n => typeof n === 'string' && n.length > 0)
    assert.equal(named.length, 25, 'every certificate IN the store is named by the self-signed branch')

    // The fixture root is self-signed and is emphatically not in any store.
    assert.equal(csNameTrustAnchor(CS_FIX_ROOT), null,
      'a self-signed top that is NOT in the store is a private CA and stays unnamed — the name is not read off the subject line')
    // A self-signed certificate whose SUBJECT collides with a real store root
    // must still be refused: the byte comparison is what does the work, and a
    // subject match alone is one name collision away from a lie.
    assert.ok(tlsSrc.includes('root.raw.equals(top.raw)'),
      'the self-signed branch matches the whole certificate, not its subject')
    assert.equal(csNameTrustAnchor('not a certificate'), null, 'unparseable input is not an anchor')
    assert.equal(csNameTrustAnchor(CS_FIX_INT), null, 'an intermediate signed by a private root reaches no public anchor')
  }

  // …and csInspect must never reach for that test-only door.
  assert.ok(!inspectBody.includes('trustAnchors'), 'csInspect never passes an explicit trust store — that field exists for the assertions above')
}
console.log('chainsaw: port allowlist + reused SSRF guard + pinned address, DER sig-alg read, wildcard/CN-only name rules, effective expiry across the chain, findings named (and ZERO for a healthy host), empty-store probe proven against real handshakes')


/* ────────────────────────────────────────────────────────────────────────────
   Regression guards from the 2026-09-20 review pass. Each one is here because
   a real bug was found and fixed; the assertion is what stops it coming back.
   ──────────────────────────────────────────────────────────────────────────── */
{
  // ── Link Peek: a bracketed IPv6 literal is an ADDRESS, not a name to resolve.
  //    `URL.hostname` keeps the brackets and `isIP('[::1]')` is 0, so without
  //    unwrapping, every IPv6-literal URL — public ones included — fell through
  //    to a DNS lookup of a string that can never resolve.
  const { lpCheckResolved, lpIsForbiddenHostname } = await import('../src/lib/link-peek-fetch.ts')
  const { lpMetaSnippet } = await import('../src/components/tools/link-peek/unfurl.ts')
  assert.equal(isIP('[2606:4700:4700::1111]'), 0, 'the premise: a bracketed literal is not an IP to isIP')
  const publicV6 = new URL('https://[2606:4700:4700::1111]/x').hostname
  assert.equal(publicV6, '[2606:4700:4700::1111]', 'URL.hostname keeps the brackets')
  assert.equal(lpIsForbiddenHostname(publicV6), false, 'the hostname gate already unwrapped and allowed it')
  assert.deepEqual(await lpCheckResolved(publicV6), { ok: true }, 'a public IPv6 literal resolves to itself instead of failing as an unresolvable name')
  const privateV6 = new URL('https://[::1]/x').hostname
  assert.equal((await lpCheckResolved(privateV6)).ok, false, '…and a loopback literal is still refused through the same path')
  assert.equal((await lpCheckResolved(new URL('https://[fe80::1]/x').hostname)).ok, false, 'link-local too')

  // ── …and the name lookup is bounded. dns.lookup runs on libuv's 4-slot
  //    threadpool and takes the OS resolver's timeout, which is outside this
  //    module's own budget; a few black-holed names would otherwise occupy
  //    every slot and stall unrelated fs/crypto work container-wide. The bound
  //    now lives in src/lib/dns-lookup.ts, shared with Chainsaw, and is proved
  //    against a lookup that never answers in the PR 19 review block below.
  const lpSrc = await readFile(new URL('../src/lib/link-peek-fetch.ts', import.meta.url), 'utf-8')
  assert.ok(/await lookupAllBounded\(bare, dns\)/.test(lpSrc), 'the DNS lookup goes through the one bounded helper')

  // ── one escaping rule, not a second weaker copy. The local one omitted `'`,
  //    which AGENTS.md names explicitly.
  const snippet = lpMetaSnippet(
    { title: null, metaDescription: null, canonical: null, og: [{ key: 'og:title', value: `it's "quoted" & <hot>` }], twitter: [] },
    'https://example.com/',
  )
  assert.ok(snippet.includes('&#39;'), "the generated meta snippet escapes a single quote")
  assert.ok(snippet.includes('&quot;') && snippet.includes('&lt;') && snippet.includes('&amp;'), '…along with the rest')
  const unfurlSrc = await readFile(new URL('../src/components/tools/link-peek/unfurl.ts', import.meta.url), 'utf-8')
  assert.ok(unfurlSrc.includes("from '../../../lib/escape'"), 'unfurl.ts uses the shared escape rather than a private copy')

  // ── Link Peek: a late image load must not be measured against a newer page.
  const peekSrc = await readFile(new URL('../src/components/tools/link-peek/LinkPeek.ts', import.meta.url), 'utf-8')
  assert.ok(/reportImageSize\(img, result\.bytes \?\? 0, meta\)/.test(peekSrc), 'the meta is captured when the load listener is BOUND')
  assert.ok(/meta !== forMeta/.test(peekSrc), '…and re-checked before the verdict is appended')

  // ── Type Trial: one input event may add at most one character to a typed run.
  //    The instant-fill guard only covered the FIRST event, so a mid-run jump
  //    back-filled every newly-reached ghost mark with one identical timestamp.
  const ttSrc2 = await readFile(new URL('../src/components/games/type-trial/TypeTrial.ts', import.meta.url), 'utf-8')
  assert.ok(/len - this\.prevLen > 1\) this\.jumped = true/.test(ttSrc2), 'a multi-character jump is detected mid-run, not just at the start')
  assert.ok(/plausible = s\.sec >= 1 && !this\.jumped/.test(ttSrc2), '…and disqualifies the ghost, the personal best and the daily board together')
  assert.equal((ttSrc2.match(/this\.jumped = false/g) || []).length, 2, 'the flag is cleared on reset AND on the instant-fill discard, which rewinds without reset()')

  // ── The Node-only boundary AGENTS.md claims. Nothing enforced it before.
  //    Any module the browser can reach must carry no `node:` import — a leak
  //    is a build failure at best and a server module shipped to visitors at
  //    worst. Derived from the tree, so a new tool/game is covered automatically.
  const browserDirs = ['../src/components/tools', '../src/components/games']
  const offenders = []
  const walk = async (dir) => {
    for (const entry of await readdir(new URL(dir + '/', import.meta.url), { withFileTypes: true })) {
      const child = `${dir}/${entry.name}`
      if (entry.isDirectory()) { await walk(child); continue }
      if (!entry.name.endsWith('.ts')) continue
      const body = await readFile(new URL(child, import.meta.url), 'utf-8')
      if (/from '(node:|.*\/lib\/(tls-inspect|link-peek-fetch|dns-lookup|webhook-store|visits|session))'/.test(body)) offenders.push(child)
    }
  }
  for (const dir of browserDirs) await walk(dir)
  assert.deepEqual(offenders, [], 'no browser-reachable component imports a Node-only module')
  const analyzeSrc = await readFile(new URL('../src/components/tools/chainsaw/analyze.ts', import.meta.url), 'utf-8')
  assert.equal(/from 'node:/.test(analyzeSrc), false, "chainsaw's claims module stays isomorphic — the server and the browser share it")

  // ── "SSR everywhere" was a convention with nothing enforcing it, and two
  //    pages had quietly drifted off it. Derived by walking src/pages, so a new
  //    route is covered the moment it exists rather than when someone remembers.
  const pagesWithoutSsr = []
  const walkPages = async (dir) => {
    for (const entry of await readdir(new URL(dir + '/', import.meta.url), { withFileTypes: true })) {
      const child = `${dir}/${entry.name}`
      if (entry.isDirectory()) { await walkPages(child); continue }
      if (!/\.(astro|ts)$/.test(entry.name)) continue
      const body = await readFile(new URL(child, import.meta.url), 'utf-8')
      if (!body.includes('prerender = false')) pagesWithoutSsr.push(child.replace('../src/pages/', ''))
    }
  }
  await walkPages('../src/pages')
  assert.deepEqual(pagesWithoutSsr, [], 'every route declares prerender = false — KV reads and middleware headers both need request time')
}
console.log('review regressions: v6 literals resolve, DNS bounded, one escape rule, late images self-check, typed runs stay typed, no node: import reaches the browser')

/* ────────────────────────────────────────────────────────────────────────────
   Accessibility invariants, from the 2026-09-20 audit pass.

   The palette half is the important one. Contrast was a thing somebody had
   measured once, in a session nobody can rerun, and every token edit since has
   been a bet that the measurement still held. It is now derived from
   `theme.css` on every run, so a palette change that drops real body text under
   AA fails here instead of shipping.
   ──────────────────────────────────────────────────────────────────────────── */
{
  const themeSrc = await readFile(new URL('../src/styles/theme.css', import.meta.url), 'utf-8')

  // Pull one palette out of a selector block. Only hex tokens participate —
  // `--color-bg-blur` is an rgba() over whatever is behind it and has no fixed
  // ratio to compute against.
  const paletteIn = (selector) => {
    const at = themeSrc.indexOf(selector)
    assert.notEqual(at, -1, `theme.css still defines ${selector}`)
    const open = themeSrc.indexOf('{', at)
    const close = themeSrc.indexOf('}', open)
    const body = themeSrc.slice(open, close)
    const out = {}
    for (const [, name, hex] of body.matchAll(/--color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) out[name] = hex.toLowerCase()
    return out
  }
  const light = paletteIn(':root')
  // The site RUNS dark, so the dark block is the one that ships; it overrides
  // the light palette rather than restating all of it.
  const dark = { ...light, ...paletteIn('[data-theme="dark"]') }

  const relLum = (hex) => {
    const chan = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2]
  }
  const ratio = (a, b) => {
    const [x, y] = [relLum(a), relLum(b)]
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
  }
  // Sanity-check the maths against the two ratios everyone knows by heart
  // before trusting it about anything else.
  assert.equal(ratio('#000000', '#ffffff').toFixed(2), '21.00', 'black on white is 21:1')
  assert.equal(ratio('#777777', '#ffffff').toFixed(2), '4.48', '#777 on white is the classic just-fails-AA value')

  // Every pairing below is real text on a real surface, not a combinatorial
  // sweep — `--color-border` is absent on purpose: it is a hairline, never a
  // text colour, and holding a divider to a text ratio would force a palette
  // change to satisfy an assertion nobody could read.
  const textPairings = [
    ['text', 'bg'], ['text', 'surface'],
    ['muted', 'bg'], ['muted', 'surface'],
    ['accent', 'bg'], ['accent', 'surface'],
    ['error', 'bg'], ['error', 'surface'],
    ['success', 'bg'], ['success', 'surface'],
    // The label on an accent-filled button — the one place --color-bg is ink.
    ['bg', 'accent'],
  ]
  const AA_NORMAL = 4.5
  for (const [name, palette] of [['light', light], ['dark', dark]]) {
    for (const [ink, ground] of textPairings) {
      assert.ok(palette[ink], `${name}: --color-${ink} is defined`)
      assert.ok(palette[ground], `${name}: --color-${ground} is defined`)
      const r = ratio(palette[ink], palette[ground])
      assert.ok(
        r >= AA_NORMAL,
        `${name}: --color-${ink} (${palette[ink]}) on --color-${ground} (${palette[ground]}) is ${r.toFixed(2)}:1 — under the ${AA_NORMAL}:1 WCAG AA floor for normal text`,
      )
    }
  }

  // …and the last pairing is a claim about the code, so it is read from the
  // code: the accent-filled button really does set its ink to --color-bg.
  const cxSrc = await readFile(new URL('../src/styles/canvas-export.css', import.meta.url), 'utf-8')
  assert.ok(/background:\s*var\(--color-accent\);\s*\n\s*color:\s*var\(--color-bg\);/.test(cxSrc),
    'the accent-filled button still pairs --color-accent with --color-bg, which is the pairing asserted above')

  /* ── The card hairline has a floor of its own (2026-09-24) ───────────────
     --color-border is excluded from the text sweep above for a good reason
     (it is never ink), but "not a text colour" had been read as "unmeasured",
     and it sat at 1.25:1 dark / 1.23:1 light — invisible. Every listing card
     on the site is bounded by it, so the grids read as floating text rather
     than as cards.

     The floor here is 2:1, NOT the 3:1 that WCAG 1.4.11 asks for non-text UI
     boundaries. That gap is deliberate and this is the honest place to say
     so: 3:1 needs #515d71 dark / #949494 light, which stops being a hairline
     and boxes every card on the site. 1.4.11 applies to a boundary REQUIRED
     to identify a control, and here the card's own content identifies it —
     the border is reinforcement. What the floor prevents is the regression
     that actually happened: a border quietly tuned back down to invisible.

     Note the hover border is --color-muted, which clears 3:1 comfortably and
     is already covered by the text sweep above. */
  const NON_TEXT_FLOOR = 2
  for (const [name, palette] of [['light', light], ['dark', dark]]) {
    const r = ratio(palette.border, palette.bg)
    assert.ok(
      r >= NON_TEXT_FLOOR,
      `${name}: --color-border (${palette.border}) on --color-bg (${palette.bg}) is ${r.toFixed(2)}:1 — `
      + `under the ${NON_TEXT_FLOOR}:1 floor that keeps a listing card readable as a card`,
    )
  }

  // ── The skip link must produce a PERCEIVABLE result (WCAG 2.4.7). A blanket
  //    `main:focus { outline: none }` silently undid the only rule that draws
  //    the ring, so keyboard users got no indication the skip had happened.
  const sharedSrc = await readFile(new URL('../src/styles/shared.css', import.meta.url), 'utf-8')
  assert.ok(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--color-accent\)/.test(sharedSrc),
    'the one rule that draws a focus ring is still there, and still token-driven')
  assert.equal(/(^|[\s,>])main:focus\s*\{/m.test(sharedSrc), false,
    'no blanket main:focus rule — it would suppress the ring for the keyboard user the skip link exists for')
  assert.ok(/main:focus:not\(:focus-visible\)\s*\{\s*outline:\s*none/.test(sharedSrc),
    '…the mouse case is silenced narrowly instead')

  // Both shells wire the link to a focusable target, or the rule above guards
  // nothing. Derived from the layouts so a third shell cannot skip it.
  for (const layout of ['Base.astro', 'ToolBase.astro']) {
    const src = await readFile(new URL(`../src/layouts/${layout}`, import.meta.url), 'utf-8')
    assert.ok(src.includes('href="#main-content"') && src.includes('data-type="skip-link"'), `${layout} renders the skip link`)
    assert.ok(/<main[^>]*id="main-content"/s.test(src), `${layout} gives main the id the link targets`)
    assert.ok(/<main[^>]*tabindex="-1"/s.test(src), `${layout} makes main focusable, or the link jumps without moving focus`)
  }

  // ── Controls that are named by JavaScript are not named until JavaScript
  //    runs. Regression guards for the three found in the audit.
  const wiSrc = await readFile(new URL('../src/components/tools/webhook-inspector/WebhookInspector.ts', import.meta.url), 'utf-8')
  const pollBtn = wiSrc.match(/<button data-action="toggle-poll"[^>]*>([\s\S]*?)<\/button>/)
  assert.ok(pollBtn, 'the poll toggle is still in the markup')
  assert.notEqual(pollBtn[1].trim(), '', 'the poll toggle ships with a label instead of being named by the first reflect() call')
  assert.equal((wiSrc.match(/'Pause \(P\)'/g) ?? []).length, 1, 'that label has ONE definition, not one per call site')

  const atSrc = await readFile(new URL('../src/components/tools/audio-transcriber/AudioTranscriber.ts', import.meta.url), 'utf-8')
  assert.ok(/const MIC_SVG = `<svg aria-hidden="true"/.test(atSrc), 'the mic glyph is decoration and says so')
  assert.ok(/aria-label="Start recording"/.test(atSrc), 'the mic button ships with a real accessible name, not just a tooltip')
  assert.ok(/mic\.setAttribute\('aria-label', label\)/.test(atSrc) && /mic\.setAttribute\('aria-pressed'/.test(atSrc),
    '…and the name and the pressed state move together with the recording state')

  const dbSrc = await readFile(new URL('../src/components/tools/draftboard/Draftboard.ts', import.meta.url), 'utf-8')
  assert.ok(/data-action="close-help"[^>]*aria-label="Close syntax reference"/.test(dbSrc),
    'an icon-only close button is named by aria-label, not by the glyph it happens to contain')

  // ── Validate before spending a rate-limit token. Both outbound-fetching
  //    routes, stated once: a typo must not cost the visitor a chance or the
  //    instance an outbound-request slot.
  for (const [route, validator] of [
    ['link-peek.ts', 'lpValidateUrl('],
    ['chainsaw.ts', 'csValidateTarget('],
    ['dns-sightline.ts', 'sgValidateName('],
  ]) {
    const src = await readFile(new URL(`../src/pages/api/tools/${route}`, import.meta.url), 'utf-8')
    const validatedAt = src.indexOf(`= ${validator}`)
    const limitedAt = src.indexOf('allowClient(')
    assert.notEqual(validatedAt, -1, `${route} validates its target`)
    assert.notEqual(limitedAt, -1, `${route} rate-limits`)
    assert.ok(validatedAt < limitedAt, `${route} validates BEFORE spending a rate-limit token`)
  }
}
console.log('a11y: palette contrast derived from theme.css clears AA, the skip link keeps a visible focus ring, JS-named controls ship named, and both fetch routes validate before rate-limiting')

/* ─────────────────  DNS Sightline  ─────────────────

   A DNS checker fails the way Chainsaw and the fractal renderer fail: not by
   crashing, but by rendering a confident, attractive, wrong sentence about
   somebody's zone. Every assertion below guards a claim whose failure mode is
   a plausible answer.

   Four of them are load-bearing and each one guards a bug that ships silently:

   1. The RESOLVER DIFF excludes TTL and record order. Include either and the
      tool reports that every load-balanced domain on the internet is
      inconsistent — the page still renders, the finding is still phrased
      confidently, and the one signal this tool exists for means nothing.

   2. The SPF LOOKUP COUNT is checked against an INDEPENDENT implementation
      written here, not against remembered numbers. The real one is bounded,
      memoised, cycle-aware and breadth-first; the oracle below is a dumb
      recursive string scan with no bounds at all, and it shares no code. Same
      structure as `evaluateBest`/`scoreBest`: the fast, careful thing is held
      to a slow, obvious thing. The bug it catches is the one every other SPF
      checker has — counting the terms written in the record rather than the
      terms the whole evaluation performs.

   3. CAA's `issuewild` REPLACES `issue` for wildcards rather than adding to it,
      and the policy comes from the closest ancestor that publishes one. Both
      are easy to get backwards and neither produces an error when you do; you
      just get told the opposite of the truth about whether your renewal will
      work.

   4. "DANGLING" means NXDOMAIN at the target, not "no address record". A tool
      that reports a subdomain takeover on a name that merely has no A record
      is inventing a vulnerability, which is worse than missing one.

   The transport is exercised against a LOCAL FIXTURE resolver over loopback —
   the timeout, the byte cap, a malformed body, the shared query budget and the
   memo — so none of this needs the network and all of it is real. */
{
  const sg = await import('../src/components/tools/dns-sightline/analyze.ts')
  const doh = await import('../src/lib/dns-doh.ts')
  const { canonicalIp } = await import('../src/lib/ip.ts')

  /* ── 1. The name. ──────────────────────────────────────────────────────── */

  assert.equal(sg.sgValidateName('https://Example.COM/pricing?a=1').name, 'example.com')
  assert.equal(sg.sgValidateName('example.com.').name, 'example.com', 'a trailing root dot is not part of the name')
  assert.equal(sg.sgValidateName('  EXAMPLE.com  ').name, 'example.com')
  assert.equal(sg.sgValidateName('example.com:8443').name, 'example.com')
  assert.equal(sg.sgValidateName('user@example.com').name, 'example.com')
  // Underscore labels are the whole point of a DNS tool — `_dmarc` and
  // `_acme-challenge` are what a person debugging mail or a certificate has in
  // their clipboard. A hostname-shaped validator rejects them.
  assert.equal(sg.sgValidateName('_dmarc.example.com').ok, true)
  assert.equal(sg.sgValidateName('_acme-challenge.www.example.com').ok, true)
  // IDNA through the engine's own implementation, not a hand-rolled encoder.
  assert.equal(sg.sgValidateName('bücher.de').name, 'xn--bcher-kva.de')
  // An IP is refused rather than silently asked as a name: NXDOMAIN for a real
  // address is a worse answer than "this tool does not do reverse lookups".
  assert.equal(sg.sgValidateName('1.2.3.4').ok, false)
  assert.equal(sg.sgValidateName('2001:db8::1').ok, false)
  assert.equal(sg.sgValidateName('localhost').ok, false, 'a single label is not a domain name')
  assert.equal(sg.sgValidateName('a..b.com').ok, false)
  assert.equal(sg.sgValidateName(`${'a'.repeat(64)}.com`).ok, false, 'a label stops at 63 characters')
  assert.equal(sg.sgValidateName(`${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.${'e'.repeat(60)}.com`).ok, false,
    'a whole name stops at 253 characters even when every label is legal')
  // The parameter-injection shape. The name is the only caller-supplied value
  // that reaches a DoH URL, so a name that could carry its own `&type=` is
  // refused here AND encoded there (asserted against the fixture below).
  for (const hostile of ['a&type=ANY&name=b.com', 'ex.com?x=1', 'ex .com', 'ex .com', '-lead.com', 'trail-.com', 'ex.com#frag']) {
    assert.equal(sg.sgValidateName(hostile).ok, false, `refused: ${JSON.stringify(hostile)}`)
  }

  /* ── 2. TXT is a LIST of strings, joined with nothing. ─────────────────── */

  // RFC 1035 §3.3.14. DoH JSON renders the list quoted and space-separated, so
  // the tempting `.replace(/"/g,'')` leaves a stray space where the split was —
  // which lands in the middle of a DKIM key's base64 and stops it verifying, or
  // splits an SPF mechanism in half. Neither throws.
  assert.equal(sg.sgTxtValue('"abc" "def"'), 'abcdef')
  assert.equal(sg.sgTxtValue('"v=spf1 ip4:1.2.3.4 " "include:x.net -all"'), 'v=spf1 ip4:1.2.3.4 include:x.net -all')
  assert.equal(sg.sgTxtValue('"one"'), 'one')
  assert.equal(sg.sgTxtValue('bare'), 'bare')
  assert.equal(sg.sgTxtValue('"a\\"b"'), 'a"b', 'an escaped quote is content, not a delimiter')

  /* ── 3. The diff: what it compares, and what it must not. ──────────────── */

  const mkAnswer = (resolver, type, datas, rcode = 'NOERROR', ttlBase = 0) => ({
    resolver,
    type,
    name: 'ex.com',
    rcode,
    // Deliberately different TTLs per resolver — that is the real world.
    records: datas.map((d, i) => ({ type: 1, name: 'ex.com', data: d, ttl: ttlBase + i * 17 + 3 })),
    elapsedMs: 4,
  })

  assert.equal(
    sg.sgDiffAnswers('A', [mkAnswer('a', 'A', ['1.2.3.4', '5.6.7.8'], 'NOERROR', 30), mkAnswer('b', 'A', ['5.6.7.8', '1.2.3.4'], 'NOERROR', 3500)]).agree,
    true,
    'round-robin order and per-resolver TTLs must NOT read as a disagreement',
  )
  assert.equal(
    sg.sgDiffAnswers('AAAA', [mkAnswer('a', 'AAAA', ['2001:0db8:0000:0000:0000:0000:0000:0001']), mkAnswer('b', 'AAAA', ['2001:DB8::1'])]).agree,
    true,
    'two legal spellings of one IPv6 address are one address',
  )
  assert.equal(
    sg.sgDiffAnswers('CNAME', [mkAnswer('a', 'CNAME', ['Target.Example.COM.']), mkAnswer('b', 'CNAME', ['target.example.com'])]).agree,
    true,
    'DNS names are case-insensitive and the root dot is not data',
  )
  // …but a real difference is still a difference, or the tool says nothing ever.
  const realDiff = sg.sgDiffAnswers('A', [mkAnswer('a', 'A', ['1.2.3.4']), mkAnswer('b', 'A', ['9.9.9.9'])])
  assert.equal(realDiff.agree, false)
  assert.equal(sg.sgDiffFindings([realDiff])[0].id, 'diff-A')
  // A changed MX PREFERENCE is a real change and must survive normalisation.
  assert.equal(sg.sgDiffAnswers('MX', [mkAnswer('a', 'MX', ['10 mail.ex.com']), mkAnswer('b', 'MX', ['20 mail.ex.com'])]).agree, false)
  // One silent resolver among answering ones is FILTERING, not propagation —
  // a different cause with a different fix, reported separately.
  const filtered = sg.sgDiffAnswers('A', [mkAnswer('a', 'A', ['1.2.3.4']), mkAnswer('b', 'A', ['1.2.3.4']), mkAnswer('q', 'A', [], 'NXDOMAIN')])
  assert.equal(filtered.looksFiltered, true)
  assert.equal(sg.sgDiffFindings([filtered])[0].id, 'filtered-A')
  assert.equal(sg.sgDiffFindings([filtered])[0].level, 'info', 'a policy decision at one operator is not a warning about your zone')
  // A resolver that could not be reached is excluded from the verdict rather
  // than counted as a third opinion.
  const dead = resolver => ({ resolver, type: 'A', name: 'ex.com', rcode: 'ERROR', records: [], elapsedMs: 1, error: 'timeout' })
  const withDead = sg.sgDiffAnswers('A', [mkAnswer('a', 'A', ['1.2.3.4']), dead('x')])
  assert.equal(withDead.agree, true)
  assert.equal(withDead.answered, 1)
  assert.deepEqual(withDead.failed, ['x'])

  /* …and when NOBODY answered, "they agree" is a sentence nobody earned. This
     one was found by running the endpoint with outbound network blocked: all
     three resolvers errored and the page reported agreement on eight record
     types, which is precisely the confident-wrong-sentence failure the evidence
     rule exists to prevent. `answered` is what the UI and the finding read. */
  const blackout = ['A', 'AAAA', 'CNAME', 'MX'].map(t =>
    sg.sgDiffAnswers(t, ['cloudflare', 'google', 'quad9'].map(r => ({ ...dead(r), type: t }))))
  for (const d of blackout) {
    assert.equal(d.answered, 0, `${d.type}: nothing was observed`)
    assert.equal(d.groups.length, 0)
  }
  const blackoutFindings = sg.sgReachabilityFindings(blackout)
  assert.equal(blackoutFindings.length, 1, 'said once, not once per record type')
  assert.equal(blackoutFindings[0].id, 'resolvers-unreachable')
  assert.equal(blackoutFindings[0].level, 'error')
  assert.ok(/could not ask/.test(blackoutFindings[0].detail), 'it has to say this is not a fact about the zone')
  // One working resolver and the blackout finding must go away, or it fires on
  // every partial outage and stops meaning anything.
  assert.deepEqual(sg.sgReachabilityFindings([...blackout, withDead]), [])
  assert.deepEqual(sg.sgReachabilityFindings([]), [])
  // The component must read `answered`, not `agree`, for that row.
  const uiSrc = await readFile(new URL('../src/components/tools/dns-sightline/DnsSightline.ts', import.meta.url), 'utf-8')
  const answeredAt = uiSrc.indexOf('d.answered === 0')
  const agreeAt = uiSrc.indexOf('if (d.agree)')
  assert.notEqual(answeredAt, -1, 'the diff table handles the nobody-answered case')
  assert.ok(answeredAt < agreeAt, 'and handles it BEFORE the agreement branch, or the branch never runs')

  /* ── 4. SPF, against an independent oracle. ────────────────────────────── */

  const spfZone = {
    'ex.com': ['"v=spf1 ip4:1.2.3.4 ip6:2001:db8::/32 include:a.net include:b.net ~all"'],
    'a.net': ['"v=spf1 a mx include:c.org ~all"'],
    'b.net': ['"v=spf1 ip4:5.6.7.8 -all"'],
    'c.org': ['"v=spf1 a:mail.c.org exists:%{i}._spf.c.org ptr -all"'],
    'wide.com': ['"v=spf1 include:a.net include:c.org include:d.net include:e.net -all"'],
    // Exactly nine of the ten — the "one more provider and you are broken" case.
    'near.com': ['"v=spf1 include:a.net a mx -all"'],
    'd.net': ['"v=spf1 mx mx:alt.d.net -all"'],
    'e.net': ['"v=spf1 a a:x.e.net a:y.e.net -all"'],
    'exp.com': ['"v=spf1 ip4:1.1.1.1 exp=why.exp.com -all"'],
    'loop.com': ['"v=spf1 include:loop2.com -all"'],
    'loop2.com': ['"v=spf1 include:loop.com -all"'],
    'two.com': ['"v=spf1 -all"', '"v=spf1 ip4:9.9.9.9 -all"'],
    'redir.com': ['"v=spf1 redirect=b.net"'],
    'redirall.com': ['"v=spf1 redirect=b.net -all"'],
    'open.com': ['"v=spf1 +all"'],
    'noall.com': ['"v=spf1 ip4:1.2.3.4"'],
    'void.com': ['"v=spf1 include:gone1.net include:gone2.net include:gone3.net -all"'],
  }
  let spfQueries = 0
  const spfLookup = async (name, type) => {
    spfQueries += 1
    const key = name.toLowerCase().replace(/\.+$/, '')
    const data = type === 'TXT' ? spfZone[key] : undefined
    return {
      resolver: 'fixture',
      type,
      name: key,
      rcode: data ? 'NOERROR' : 'NXDOMAIN',
      records: (data ?? []).map(d => ({ type: 16, name: key, data: d, ttl: 300 })),
      elapsedMs: 0,
    }
  }

  /* The oracle. Deliberately the dumbest possible implementation: no bounds, no
     memo, no queue, and no line of code shared with the module it checks. It
     exists to make the ANSWER checkable rather than remembered — a hand-written
     expected number is a second chance to make the same counting mistake twice.

     Note `path`, not a shared visited set: a domain reached twice by two routes
     is a DIAMOND and a receiver evaluates it twice, so only a name inside its
     own ancestry is a cycle. Writing this oracle is what caught the walker
     doing the other thing — a single global visited set, which silently
     under-counts exactly the diamond-shaped zones that are near the limit.
     Valid only on acyclic zones, which is why the loop fixtures are asserted
     separately and not put through it. */
  const naiveSpfCount = (domain, path = []) => {
    const key = domain.toLowerCase().replace(/\.+$/, '')
    if (path.includes(key)) throw new Error('oracle is only valid on acyclic zones')
    const seen = [...path, key]
    const raw = (spfZone[key] ?? []).find(r => /v=spf1/i.test(r))
    if (!raw) return 0
    const record = raw.replace(/"/g, '')
    const tokens = record.trim().split(/\s+/).slice(1)
    const hasAll = tokens.some(t => /^[+\-~?]?all$/i.test(t))
    let n = 0
    for (const token of tokens) {
      const bare = token.replace(/^[+\-~?]/, '').toLowerCase()
      if (/^all$/.test(bare) || bare.startsWith('ip4') || bare.startsWith('ip6') || bare.startsWith('exp=')) continue
      if (bare.startsWith('redirect=')) continue // handled after the loop
      const kind = bare.split(/[:/=]/)[0]
      if (!['include', 'a', 'mx', 'ptr', 'exists'].includes(kind)) continue
      n += 1
      if (kind === 'include') n += naiveSpfCount(token.split(':')[1], seen)
    }
    const redirect = tokens.find(t => /^redirect=/i.test(t))
    if (redirect && !hasAll) n += 1 + naiveSpfCount(redirect.split('=')[1], seen)
    return n
  }

  for (const domain of ['ex.com', 'a.net', 'b.net', 'c.org', 'wide.com', 'd.net', 'e.net', 'exp.com', 'redir.com', 'redirall.com', 'noall.com']) {
    const report = await sg.sgAnalyzeSpf(domain, spfLookup)
    assert.equal(
      report.lookups,
      naiveSpfCount(domain),
      `${domain}: the walker and the independent oracle must count the same terms (walker ${report.lookups})`,
    )
  }

  // Nine of ten is its own finding: the record works today and breaks on the
  // next provider, which is the only moment a warning is useful.
  const nearReport = await sg.sgAnalyzeSpf('near.com', spfLookup)
  assert.equal(nearReport.lookups, 9)
  assert.equal(nearReport.exceeded, false)
  assert.ok(sg.sgSpfFindings(nearReport, 'near.com').some(f => f.id === 'spf-lookup-near'))

  // The specific shape the rule exists for: a three-mechanism record whose real
  // cost is eight, because an include spends the SAME budget inside itself.
  const exReport = await sg.sgAnalyzeSpf('ex.com', spfLookup)
  assert.equal(exReport.lookups, 8)
  assert.ok(
    exReport.record.split(/\s+/).filter(t => /^(include|a|mx|ptr|exists)/.test(t)).length < exReport.lookups,
    'the top-level term count must be LOWER than the real total, or this fixture is not testing the thing',
  )
  assert.equal(exReport.exceeded, false)
  assert.equal(exReport.all, '~')

  // `ip4`/`ip6` are free however many there are; `exp=` is exempt by §4.6.4.
  assert.equal((await sg.sgAnalyzeSpf('exp.com', spfLookup)).lookups, 0)
  assert.equal((await sg.sgAnalyzeSpf('b.net', spfLookup)).lookups, 0)

  // `redirect=` counts — and is ignored entirely when the record also has `all`.
  assert.equal((await sg.sgAnalyzeSpf('redirall.com', spfLookup)).lookups, 0, 'a redirect alongside `all` is never evaluated')
  const redirReport = await sg.sgAnalyzeSpf('redir.com', spfLookup)
  assert.equal(redirReport.lookups, 1)
  assert.equal(redirReport.terms[0].kind, 'redirect')

  // Over the limit, and the finding names the number.
  const wide = await sg.sgAnalyzeSpf('wide.com', spfLookup)
  assert.ok(wide.lookups > sg.SG_SPF_LOOKUP_LIMIT, `wide.com should exceed ten (got ${wide.lookups})`)
  assert.equal(wide.exceeded, true)
  const wideFindings = sg.sgSpfFindings(wide, 'wide.com')
  assert.ok(wideFindings.some(f => f.id === 'spf-lookup-limit'))
  assert.ok(wideFindings.find(f => f.id === 'spf-lookup-limit').title.includes(String(wide.lookups)))

  // A cycle TERMINATES and is reported, rather than hanging the request. The
  // oracle above cannot check this one — it throws on a cycle by construction,
  // which is exactly why the real walker needs the visited set.
  assert.throws(() => naiveSpfCount('loop.com'), /acyclic/)
  const loopReport = await sg.sgAnalyzeSpf('loop.com', spfLookup)
  assert.ok(loopReport.problems.some(p => p.includes('loop')), 'an include cycle is a finding')
  assert.ok(loopReport.queries < sg.SG_SPF_MAX_QUERIES, 'the cycle must stop on the visited set, not on the ceiling')
  assert.ok(sg.sgSpfFindings(loopReport, 'loop.com').some(f => f.id === 'spf-loop'))

  // Void lookups are their own §4.6.4 limit.
  const voidReport = await sg.sgAnalyzeSpf('void.com', spfLookup)
  assert.equal(voidReport.voidLookups, 3)
  assert.equal(voidReport.voidExceeded, true)
  assert.ok(sg.sgSpfFindings(voidReport, 'void.com').some(f => f.id === 'spf-void-limit'))

  // Two SPF records is a permerror, not a merge.
  const twoReport = await sg.sgAnalyzeSpf('two.com', spfLookup)
  assert.equal(twoReport.recordCount, 2)
  assert.ok(sg.sgSpfFindings(twoReport, 'two.com').some(f => f.id === 'spf-multiple'))

  assert.ok(sg.sgSpfFindings(await sg.sgAnalyzeSpf('open.com', spfLookup), 'open.com').some(f => f.id === 'spf-all-pass'))
  assert.ok(sg.sgSpfFindings(await sg.sgAnalyzeSpf('noall.com', spfLookup), 'noall.com').some(f => f.id === 'spf-no-all'))
  assert.ok(sg.sgSpfFindings(await sg.sgAnalyzeSpf('nothing.com', spfLookup), 'nothing.com').some(f => f.id === 'spf-missing'))

  // The walk is bounded whatever the zone says. A zone that hands back a fresh
  // include every time cannot make this run forever.
  /* The fixture resolver REFUSES to be asked more than the ceiling allows,
     rather than answering forever and letting the assertion below decide. An
     unbounded walk then fails with a named error instead of hanging the suite —
     a test that hangs is a test that gets its timeout raised. */
  const SG_FIXTURE_CEILING = sg.SG_SPF_MAX_QUERIES + 5
  let generated = 0
  const hostileLookup = async (name, type) => {
    generated += 1
    if (generated > SG_FIXTURE_CEILING) throw new Error(`the SPF walk is unbounded: it asked ${generated} questions, past its own ceiling of ${sg.SG_SPF_MAX_QUERIES}`)
    const n = generated
    return {
      resolver: 'fixture',
      type,
      name,
      rcode: 'NOERROR',
      records: [{ type: 16, name, data: `"v=spf1 include:gen${n}.evil.test -all"`, ttl: 1 }],
      elapsedMs: 0,
    }
  }
  const hostile = await sg.sgAnalyzeSpf('evil.test', hostileLookup)
  assert.ok(hostile.truncated, 'an unbounded include chain must stop on this tool\'s ceiling and SAY so')
  assert.ok(hostile.queries <= sg.SG_SPF_MAX_QUERIES + 1, `the walk spent ${hostile.queries} queries — the ceiling is ${sg.SG_SPF_MAX_QUERIES}`)

  /* …and a WIDE zone, which the depth ceiling cannot stop. Twelve includes per
     record, each of which has twelve of its own, is 157 queries at depth two —
     shallow enough that only the query ceiling and the overshoot guard bound
     it. Depth and breadth are separate attacks and each needs its own bound;
     asserting only the chain lets the breadth ceiling be deleted unnoticed. */
  let wideQueries = 0
  const hostileWide = await sg.sgAnalyzeSpf('fan.test', async (name, type) => {
    wideQueries += 1
    if (wideQueries > SG_FIXTURE_CEILING) throw new Error(`the SPF walk is unbounded in BREADTH: it asked ${wideQueries} questions, past its own ceiling of ${sg.SG_SPF_MAX_QUERIES}`)
    const includes = Array.from({ length: 12 }, (_, i) => `include:c${i}.${name}`).join(' ')
    return { resolver: 'fixture', type, name, rcode: 'NOERROR', elapsedMs: 0, records: [{ type: 16, name, data: `"v=spf1 ${includes} -all"`, ttl: 1 }] }
  })
  assert.ok(hostileWide.truncated, 'a fan-shaped include tree must stop on a ceiling and say so')
  assert.ok(wideQueries <= sg.SG_SPF_MAX_QUERIES + 1, `a wide tree spent ${wideQueries} queries — the ceiling is ${sg.SG_SPF_MAX_QUERIES}`)
  assert.ok(hostileWide.lookups < 500, `the term count must stay bounded too (got ${hostileWide.lookups})`)
  // …and "truncated" must be distinguishable from "over the limit", because one
  // is a fact about the zone and the other is a fact about this tool.
  assert.notEqual(hostile.truncated, false)

  /* ── 5. DMARC: alignment is a different question from the SPF pass. ────── */

  const txtAnswer = (name, values) => ({
    resolver: 'fixture',
    type: 'TXT',
    name,
    rcode: values.length ? 'NOERROR' : 'NXDOMAIN',
    records: values.map(v => ({ type: 16, name, data: v, ttl: 300 })),
    elapsedMs: 0,
  })

  const strict = sg.sgReadDmarc(txtAnswer('_dmarc.ex.com', ['"v=DMARC1; p=reject; aspf=s; rua=mailto:a@ex.com"']), txtAnswer('ex.com', []), 2)
  assert.equal(strict.tags.p, 'reject')
  const strictFindings = sg.sgDmarcFindings(strict, 'ex.com')
  assert.ok(strictFindings.some(f => f.id === 'dmarc-strict-alignment'))
  assert.ok(
    strictFindings.find(f => f.id === 'dmarc-strict-alignment').detail.includes('MAIL FROM'),
    'the strict-alignment finding has to explain the failure it predicts, not just name the tag',
  )
  // Relaxed is the default and must NOT produce the finding, or it fires on
  // every domain and stops meaning anything.
  assert.equal(
    sg.sgDmarcFindings(sg.sgReadDmarc(txtAnswer('_dmarc.ex.com', ['"v=DMARC1; p=reject; rua=mailto:a@ex.com"']), txtAnswer('ex.com', []), 2), 'ex.com')
      .some(f => f.id === 'dmarc-strict-alignment'),
    false,
  )
  // Two records DISCARD each other — the surprising one, because the zone looks
  // more protected than a zone with one record and is protected by neither.
  const dup = sg.sgReadDmarc(txtAnswer('_dmarc.ex.com', ['"v=DMARC1; p=reject"', '"v=DMARC1; p=none"']), txtAnswer('ex.com', []), 2)
  assert.equal(dup.recordCount, 2)
  assert.ok(sg.sgDmarcFindings(dup, 'ex.com').some(f => f.id === 'dmarc-multiple'))
  // A DMARC record published at the apex is read by nobody.
  const misplaced = sg.sgReadDmarc(txtAnswer('_dmarc.ex.com', []), txtAnswer('ex.com', ['"v=spf1 -all"', '"v=DMARC1; p=reject"']), 2)
  assert.equal(misplaced.atApex, true)
  assert.ok(sg.sgDmarcFindings(misplaced, 'ex.com').some(f => f.id === 'dmarc-at-apex'))
  assert.ok(sg.sgDmarcFindings(strict, 'ex.com').every(f => f.id !== 'dmarc-at-apex'), 'a correctly-placed record must not trip the apex finding')
  // For a subdomain the tool says what it does NOT know rather than guessing at
  // the organizational domain without a Public Suffix List.
  const sub = sg.sgDmarcFindings(sg.sgReadDmarc(txtAnswer('_dmarc.mail.ex.com', []), txtAnswer('mail.ex.com', []), 3), 'mail.ex.com')
  assert.ok(sub.find(f => f.id === 'dmarc-missing').detail.includes('Public Suffix List'))
  assert.equal(sub.find(f => f.id === 'dmarc-missing').level, 'info', 'an inherited policy is not the same as no policy')

  /* ── 6. CAA: the ancestor walk, and issuewild REPLACING issue. ─────────── */

  const caaZone = { 'ex.com': ['0 issue "letsencrypt.org"', '0 issuewild ";"'] }
  const caaLookup = async (name, type) => {
    const key = name.toLowerCase()
    const data = type === 'CAA' ? (caaZone[key] ?? []) : []
    return { resolver: 'fixture', type, name: key, rcode: 'NOERROR', records: data.map(d => ({ type: 257, name: key, data: d, ttl: 60 })), elapsedMs: 0 }
  }
  const walk = await sg.sgAnalyzeCaa('www.ex.com', caaLookup)
  assert.equal(walk.foundAt, 'ex.com', 'a CA checks the exact name and then each parent — a policy at the apex governs a host with none')
  assert.deepEqual(walk.walked, ['www.ex.com', 'ex.com'])
  const verdict = sg.sgCaaVerdict(walk)
  assert.equal(sg.sgCaaAllows(verdict, 'letsencrypt.org', false), true)
  assert.equal(sg.sgCaaAllows(verdict, 'digicert.com', false), false)
  assert.equal(
    sg.sgCaaAllows(verdict, 'letsencrypt.org', true),
    false,
    'issuewild ";" blocks wildcards for EVERY CA, including one that issue permits',
  )
  // The other direction: with no issuewild at all, issue governs wildcards too.
  const noWild = sg.sgCaaVerdict({ foundAt: 'ex.com', walked: ['ex.com'], entries: [sg.sgParseCaa('0 issue "letsencrypt.org"')] })
  assert.equal(sg.sgCaaAllows(noWild, 'letsencrypt.org', true), true)
  assert.equal(sg.sgCaaAllows(noWild, 'digicert.com', true), false)
  // `issue ";"` is a deliberate instruction that nobody may issue.
  const none = sg.sgCaaVerdict({ foundAt: 'ex.com', walked: ['ex.com'], entries: [sg.sgParseCaa('0 issue ";"')] })
  assert.equal(none.forbidsAll, true)
  assert.equal(sg.sgCaaAllows(none, 'letsencrypt.org', false), false)
  // An unrecognised CRITICAL tag blocks every CA — a spectacular silent way to
  // break a renewal, and the reason the flag is parsed rather than ignored.
  const crit = sg.sgCaaVerdict({ foundAt: 'ex.com', walked: ['ex.com'], entries: [sg.sgParseCaa('128 weirdtag "x"'), sg.sgParseCaa('0 issue "letsencrypt.org"')] })
  assert.deepEqual(crit.unknownCritical, ['weirdtag'])
  assert.equal(sg.sgCaaAllows(crit, 'letsencrypt.org', false), false)
  // A non-critical unknown tag does NOT block anything.
  const softUnknown = sg.sgCaaVerdict({ foundAt: 'ex.com', walked: ['ex.com'], entries: [sg.sgParseCaa('0 weirdtag "x"'), sg.sgParseCaa('0 issue "letsencrypt.org"')] })
  assert.deepEqual(softUnknown.unknownCritical, [])
  assert.equal(sg.sgCaaAllows(softUnknown, 'letsencrypt.org', false), true)
  // No policy anywhere means any CA may issue — the walk must not invent one.
  const empty = await sg.sgAnalyzeCaa('a.b.nothing.test', caaLookup)
  assert.equal(empty.foundAt, null)
  assert.equal(sg.sgCaaAllows(sg.sgCaaVerdict(empty), 'anyone.example', true), true)
  assert.deepEqual(empty.walked, ['a.b.nothing.test', 'b.nothing.test', 'nothing.test'], 'the walk stops at two labels')
  // The blocked-CA finding fires, and only when a CA was actually named.
  assert.ok(sg.sgCaaFindings(verdict, 'ex.com', 'digicert.com').some(f => f.id === 'caa-blocks-ca'))
  assert.equal(sg.sgCaaFindings(verdict, 'ex.com', null).some(f => f.id === 'caa-blocks-ca'), false)
  // Every id this route can offer is one the parser recognises, or the picker
  // silently offers a CA the checker can never match.
  for (const ca of sg.SG_KNOWN_CAS) {
    assert.match(ca.id, /^[a-z0-9.-]+$/, `${ca.id} is a CAA identifier, not a label`)
    assert.equal(sg.sgCaaAllows(sg.sgCaaVerdict({ foundAt: 'ex.com', walked: ['ex.com'], entries: [sg.sgParseCaa(`0 issue "${ca.id}"`)] }), ca.id, false), true)
  }

  /* ── 7. MX and CNAME. ──────────────────────────────────────────────────── */

  const mxAnswer = {
    resolver: 'fixture',
    type: 'MX',
    name: 'ex.com',
    rcode: 'NOERROR',
    elapsedMs: 0,
    records: [
      { type: 15, name: 'ex.com', data: '10 mail.ex.com.', ttl: 300 },
      { type: 15, name: 'ex.com', data: '20 1.2.3.4', ttl: 300 },
      { type: 15, name: 'ex.com', data: '30 gone.ex.com', ttl: 300 },
    ],
  }
  const mailZone = {
    'mail.ex.com': { CNAME: ['alias.host.net.'], A: ['9.9.9.9'] },
  }
  const mxLookup = async (name, type) => {
    const key = name.toLowerCase()
    const data = mailZone[key]?.[type] ?? []
    return { resolver: 'fixture', type, name: key, rcode: data.length ? 'NOERROR' : 'NXDOMAIN', records: data.map(d => ({ type: 1, name: key, data: d, ttl: 60 })), elapsedMs: 0 }
  }
  const targets = await sg.sgResolveMxTargets(mxAnswer, mxLookup)
  const mxFindings = sg.sgMxFindings(mxAnswer, targets)
  const mxIds = mxFindings.map(f => f.id)
  assert.ok(mxIds.includes('mx-cname-target'), 'an MX pointing at a CNAME is forbidden by RFC 2181 §10.3')
  assert.ok(mxIds.includes('mx-ip-target'), 'an MX holds a hostname; an address there resolves to NXDOMAIN at every sender')
  assert.ok(mxIds.includes('mx-unresolvable'))
  // A perfectly ordinary MX must produce NONE of those, or every domain gets a
  // mail error and the section is noise.
  const goodMx = { ...mxAnswer, records: [{ type: 15, name: 'ex.com', data: '10 mail.ex.com', ttl: 300 }] }
  const goodTargets = await sg.sgResolveMxTargets(goodMx, async (name, type) => ({
    resolver: 'fixture', type, name, rcode: type === 'A' ? 'NOERROR' : 'NXDOMAIN', elapsedMs: 0,
    records: type === 'A' ? [{ type: 1, name, data: '9.9.9.9', ttl: 60 }] : [],
  }))
  assert.deepEqual(sg.sgMxFindings(goodMx, goodTargets), [], 'a healthy MX produces no findings at all')
  // Null MX is a correct record, reported as information rather than a fault.
  const nullMx = { ...mxAnswer, records: [{ type: 15, name: 'ex.com', data: '0 .', ttl: 300 }] }
  assert.equal(sg.sgIsNullMx(nullMx.records), true)
  assert.equal(sg.sgMxFindings(nullMx, []).map(f => f.level).join(), 'info')
  assert.equal(sg.sgIsNullMx([{ type: 15, name: 'x', data: '0 mail.ex.com', ttl: 1 }]), false)
  assert.equal(sg.sgIsNullMx([{ type: 15, name: 'x', data: '0 .', ttl: 1 }, { type: 15, name: 'x', data: '10 m.ex.com', ttl: 1 }]), false,
    'a null MX is only null when it is the ONLY record')

  /* "Dangling" must mean NXDOMAIN, not "has no address record". Getting this
     wrong does not break the page — it reports a subdomain takeover on a name
     nobody can take over, which is the most damaging sentence this tool could
     print. The rule is a claim and therefore lives in `analyze.ts`, not in the
     orchestrator, so it can be driven directly. */
  const nx = type => ({ resolver: 'f', type, name: 't.test', rcode: 'NXDOMAIN', records: [], elapsedMs: 0 })
  const ok0 = (type, data) => ({ resolver: 'f', type, name: 't.test', rcode: 'NOERROR', records: data ? [{ type: 1, name: 't.test', data, ttl: 60 }] : [], elapsedMs: 0 })
  assert.equal(sg.sgIsDangling(nx('A'), nx('AAAA'), nx('CNAME')), true)
  assert.equal(sg.sgIsDangling(ok0('A', '1.2.3.4'), nx('AAAA'), nx('CNAME')), false)
  // The name exists carrying nothing of these three types — an odd zone, not an
  // unclaimed hostname. NOERROR is not NXDOMAIN.
  assert.equal(sg.sgIsDangling(ok0('A', null), ok0('AAAA', null), ok0('CNAME', null)), false,
    'a name that exists with no address is not available for anyone to claim')
  // A CNAME chain is ordinary hosted-service plumbing, not a dangling record.
  assert.equal(sg.sgIsDangling(nx('A'), nx('AAAA'), ok0('CNAME', 'next.host.net')), false)
  // A resolver that failed is not evidence of absence.
  assert.equal(sg.sgIsDangling({ ...nx('A'), rcode: 'ERROR', error: 'timeout' }, nx('AAAA'), nx('CNAME')), false)

  // The finding itself, given the flag.
  const dangling = sg.sgCnameFindings({ target: 'proj.github.io', dangling: true, service: 'GitHub Pages', coexisting: [], atApex: false }, 'blog.ex.com')
  assert.equal(dangling[0].id, 'cname-dangling')
  assert.ok(dangling[0].detail.includes('GitHub Pages'), 'naming the service is what turns this from a broken link into a takeover')
  const live = sg.sgCnameFindings({ target: 'proj.github.io', dangling: false, service: 'GitHub Pages', coexisting: [], atApex: false }, 'blog.ex.com')
  assert.equal(live.some(f => f.id === 'cname-dangling'), false)
  assert.equal(live[0].id, 'cname-hosted')
  assert.equal(live[0].level, 'info')
  assert.equal(sg.sgTakeoverService('x.herokuapp.com'), 'Heroku')
  assert.equal(sg.sgTakeoverService('www.example.com'), null)
  assert.equal(sg.sgTakeoverService('notgithub.io'), null, 'the suffix match is on a label boundary, not a substring')
  assert.ok(sg.sgCnameFindings({ target: 'x.net', dangling: false, service: null, coexisting: ['MX'], atApex: true }, 'ex.com').map(f => f.id).includes('cname-at-apex'))
  assert.ok(sg.sgCnameFindings({ target: 'x.net', dangling: false, service: null, coexisting: ['MX'], atApex: true }, 'ex.com').map(f => f.id).includes('cname-coexists'))
  assert.deepEqual(sg.sgCnameFindings({ target: null, dangling: false, service: null, coexisting: [], atApex: true }, 'ex.com'), [],
    'no CNAME, no CNAME findings')

  /* ── 7b. A question that got no ANSWER is not a record that is absent. ────

     The CAA walk learned this first (see the CAA-and-issuer block at the end of
     this file); SPF, DMARC and MX learned it when the inspection gained a
     deadline, because a deadline turns every question still queued into a
     failure at once. Before, a stalled include read exactly like NXDOMAIN —
     "include:x has no SPF record — a receiver treats that as a permerror", plus
     a void lookup — so one slow resolver produced a permerror finding, a
     void-limit error and a lookup count presented as complete; and a failed MX
     target read "no address, so mail bounces". Every fixture below fails with
     the same empty record set a real absence has, which is the point. */
  const noAnswer = (name, type, error = 'inspection deadline reached') =>
    ({ resolver: 'fixture', type, name, rcode: 'ERROR', records: [], elapsedMs: 0, error })
  const stallAt = names => async (name, type) => {
    const key = name.toLowerCase().replace(/\.+$/, '')
    return names.includes(key) ? noAnswer(key, type) : spfLookup(name, type)
  }
  assert.equal(sg.sgUnanswered(noAnswer('x.test', 'TXT')), true)
  assert.equal(sg.sgUnanswered({ ...noAnswer('x.test', 'TXT'), error: undefined, rcode: 'SERVFAIL' }), true,
    'SERVFAIL is not an answer even when the transport reported no error of its own')
  assert.equal(sg.sgUnanswered({ ...noAnswer('x.test', 'TXT'), error: undefined, rcode: 'NXDOMAIN' }), false,
    'NXDOMAIN IS an answer: the name holds nothing')

  // An include that got no answer: the walk goes on, and the count is a floor.
  const stalledSpf = await sg.sgAnalyzeSpf('ex.com', stallAt(['c.org']))
  assert.equal(stalledSpf.truncated, true, 'an unanswered include cuts the walk short, and the report must say so')
  assert.deepEqual(stalledSpf.unanswered, ['c.org'])
  assert.ok(stalledSpf.lookups < naiveSpfCount('ex.com'), 'the fixture really did hide part of the tree from the walk')
  assert.equal(stalledSpf.voidLookups, 0, 'a lookup that got no answer is not a void lookup — that is an ANSWER saying "nothing here"')
  assert.equal(stalledSpf.problems.some(p => /permerror/.test(p)), false, '…and not a permerror either')
  const stalledSpfFindings = sg.sgSpfFindings(stalledSpf, 'ex.com')
  assert.deepEqual(stalledSpfFindings.map(f => f.id), ['spf-truncated'])
  assert.ok(/^At least /.test(stalledSpfFindings[0].title), 'a floor is titled as a floor, not as the count')
  // Over the limit AND cut short is still over the limit — the count only grows
  // with what was not walked — but it is still a floor.
  const stalledWide = await sg.sgAnalyzeSpf('wide.com', stallAt(['e.net']))
  assert.ok(stalledWide.exceeded && stalledWide.truncated, `wide.com stays over the limit with e.net unanswered (${stalledWide.lookups} counted)`)
  const stalledWideFindings = sg.sgSpfFindings(stalledWide, 'wide.com')
  assert.ok(/^At least \d+ DNS lookups/.test(stalledWideFindings.find(f => f.id === 'spf-lookup-limit').title))
  assert.equal(stalledWideFindings.some(f => f.id === 'spf-truncated'), false, 'one finding for the count, not two')
  // The ROOT lookup unanswered is not "no SPF record".
  const unreadSpf = await sg.sgAnalyzeSpf('ex.com', stallAt(['ex.com']))
  assert.equal(unreadSpf.recordCount, 0)
  assert.deepEqual(unreadSpf.unanswered, ['ex.com'])
  const unreadSpfFindings = sg.sgSpfFindings(unreadSpf, 'ex.com')
  assert.deepEqual(unreadSpfFindings.map(f => f.id), ['spf-inconclusive'], 'the opposite sentence to spf-missing, off the same zero records')

  // DMARC: a failed `_dmarc` lookup is not a missing policy.
  const unreadDmarc = sg.sgReadDmarc(noAnswer('_dmarc.ex.com', 'TXT'), txtAnswer('ex.com', []), 2)
  assert.equal(unreadDmarc.unanswered, true)
  const unreadDmarcFindings = sg.sgDmarcFindings(unreadDmarc, 'ex.com')
  assert.deepEqual(unreadDmarcFindings.map(f => f.id), ['dmarc-inconclusive'])
  assert.equal(sg.sgReadDmarc(txtAnswer('_dmarc.ex.com', []), txtAnswer('ex.com', []), 2).unanswered, false,
    'an NXDOMAIN at _dmarc is an answer, and still reads as no DMARC record')

  // MX: the question itself unanswered, and the targets' address lookups.
  const unreadMxFindings = sg.sgMxFindings(noAnswer('ex.com', 'MX'), [])
  assert.deepEqual(unreadMxFindings.map(f => f.id), ['mx-inconclusive'])
  const stalledTargets = await sg.sgResolveMxTargets(goodMx, async (name, type) => noAnswer(name, type))
  assert.equal(stalledTargets[0].resolves, false)
  assert.equal(stalledTargets[0].unanswered, true)
  const stalledMxFindings = sg.sgMxFindings(goodMx, stalledTargets)
  assert.deepEqual(stalledMxFindings.map(f => f.id), ['mx-unchecked'], 'no answer to an address lookup is not "no address, so mail bounces"')
  // …and a host that really has no address still says so.
  assert.ok(mxIds.includes('mx-unresolvable'), 'NXDOMAIN at an MX target is still an unresolvable target')

  /* ── 8. Every finding cites the record it rests on. ────────────────────── */

  /* The organising rule of this tool, asserted on EVERY producer rather than on
     the ones it was written for — the token-bench lesson, where a `proof` label
     was checked on the diagnosis half and a lint finding dressed as proved
     survived a merge. The producer list is DERIVED from the module's exports,
     so a finding function added later is covered without anybody remembering
     this block exists. */
  const analyzeSrc = await readFile(new URL('../src/components/tools/dns-sightline/analyze.ts', import.meta.url), 'utf-8')
  // Derived from the signatures rather than from the names: a producer RETURNS
  // findings and does not TAKE them, which excludes `sgSortFindings` without
  // naming it and picks up a producer called something else entirely.
  const producers = [...analyzeSrc.matchAll(/export function (sg\w+)\(([^{}]*?)\): SgFinding\[\]/g)]
    .filter(m => !m[2].includes('SgFinding[]'))
    .map(m => m[1])
  assert.ok(producers.length >= 6, `expected the finding producers to be discoverable from their signatures (found ${producers.join(', ')})`)
  for (const name of producers) assert.equal(typeof sg[name], 'function', `${name} is exported`)
  const exercised = {
    sgSpfFindings: [
      sg.sgSpfFindings(wide, 'wide.com'),
      sg.sgSpfFindings(voidReport, 'void.com'),
      sg.sgSpfFindings(twoReport, 'two.com'),
      sg.sgSpfFindings(nearReport, 'near.com'),
      sg.sgSpfFindings(loopReport, 'loop.com'),
      sg.sgSpfFindings(await sg.sgAnalyzeSpf('open.com', spfLookup), 'open.com'),
      sg.sgSpfFindings(await sg.sgAnalyzeSpf('noall.com', spfLookup), 'noall.com'),
      sg.sgSpfFindings(await sg.sgAnalyzeSpf('a.net', spfLookup), 'a.net'),
      sg.sgSpfFindings(await sg.sgAnalyzeSpf('nothing.com', spfLookup), 'nothing.com'),
      stalledSpfFindings,
      stalledWideFindings,
      unreadSpfFindings,
    ],
    sgDmarcFindings: [
      strictFindings,
      sg.sgDmarcFindings(dup, 'ex.com'),
      sub,
      sg.sgDmarcFindings(misplaced, 'ex.com'),
      // p=none with a pct rollout, and a record missing the mandatory p= tag.
      sg.sgDmarcFindings(sg.sgReadDmarc(txtAnswer('_dmarc.ex.com', ['"v=DMARC1; p=none; rua=mailto:a@ex.com"']), txtAnswer('ex.com', []), 2), 'ex.com'),
      sg.sgDmarcFindings(sg.sgReadDmarc(txtAnswer('_dmarc.ex.com', ['"v=DMARC1; p=quarantine; pct=25; rua=mailto:a@ex.com"']), txtAnswer('ex.com', []), 2), 'ex.com'),
      sg.sgDmarcFindings(sg.sgReadDmarc(txtAnswer('_dmarc.ex.com', ['"v=DMARC1; rua=mailto:a@ex.com"']), txtAnswer('ex.com', []), 2), 'ex.com'),
      unreadDmarcFindings,
    ],
    sgCaaFindings: [
      sg.sgCaaFindings(verdict, 'ex.com', 'digicert.com'),
      sg.sgCaaFindings(crit, 'ex.com', null),
      sg.sgCaaFindings(none, 'ex.com', 'letsencrypt.org'),
      sg.sgCaaFindings(sg.sgCaaVerdict(empty), 'x.test', null),
      // An empty walk whose lookups FAILED. Same zero entries as `empty` above
      // and the opposite conclusion — see the CAA-and-issuer block at the end
      // of this file for why that distinction is the load-bearing one.
      sg.sgCaaFindings(sg.sgCaaVerdict({ foundAt: null, walked: ['x.test'], entries: [], incomplete: true }), 'x.test', null),
      // …and a policy FOUND above a lookup that failed, which cites what it found.
      sg.sgCaaFindings(sg.sgCaaVerdict({ foundAt: 'ex.com', walked: ['www.ex.com', 'ex.com'], entries: [sg.sgParseCaa('0 issue "letsencrypt.org"')], incomplete: true }), 'www.ex.com', 'digicert.com'),
    ],
    sgMxFindings: [mxFindings, sg.sgMxFindings(nullMx, []), sg.sgMxFindings({ ...mxAnswer, records: [] }, []), unreadMxFindings, stalledMxFindings],
    sgCnameFindings: [dangling, live, sg.sgCnameFindings({ target: 'x.net', dangling: false, service: null, coexisting: ['MX'], atApex: true }, 'ex.com')],
    sgDiffFindings: [sg.sgDiffFindings([realDiff, filtered])],
    sgReachabilityFindings: [blackoutFindings],
    sgNsFindings: [
      sg.sgNsFindings({ resolver: 'f', type: 'NS', name: 'ex.com', rcode: 'NOERROR', elapsedMs: 0, records: [{ type: 2, name: 'ex.com', data: 'a.ns.ex.com', ttl: 60 }] }, { resolver: 'f', type: 'SOA', name: 'ex.com', rcode: 'NOERROR', elapsedMs: 0, records: [] }, 'ex.com'),
      sg.sgNsFindings({ resolver: 'f', type: 'NS', name: 'ex.com', rcode: 'NOERROR', elapsedMs: 0, records: [] }, { resolver: 'f', type: 'SOA', name: 'ex.com', rcode: 'NOERROR', elapsedMs: 0, records: [{ type: 6, name: 'ex.com', data: 'a b 1', ttl: 1 }, { type: 6, name: 'ex.com', data: 'c d 2', ttl: 1 }] }, 'ex.com'),
    ],
  }
  for (const name of producers) {
    assert.ok(exercised[name], `${name} is a finding producer with no fixture here — add one rather than letting it go unchecked`)
  }
  const everyFinding = Object.values(exercised).flat(2)
  assert.ok(everyFinding.length >= 20, `expected a broad sample of findings (got ${everyFinding.length})`)
  const seenIds = new Set()
  for (const f of everyFinding) {
    assert.ok(f.id && f.title && f.detail, `a finding needs an id, a title and a detail: ${JSON.stringify(f)}`)
    assert.ok(['error', 'warn', 'info'].includes(f.level), `${f.id} has a real level`)
    assert.ok(['record', 'absence'].includes(f.basis), `${f.id} declares its basis`)
    if (f.basis === 'record') {
      assert.ok(f.evidence.length > 0, `${f.id} claims to rest on a record and cites none`)
      assert.ok(f.evidence.every(e => typeof e === 'string' && e.trim()), `${f.id} cites an empty string as evidence`)
    } else {
      assert.equal(f.evidence.length, 0, `${f.id} is about an absent record and must cite nothing`)
    }
    seenIds.add(f.id)
  }
  /* …and the fixtures above have to REACH every finding the module can emit.
     The evidence rule is only as strong as its coverage: mutation 12 (a finding
     that claims a record and cites none) survived the first version of this
     block, because the one producer branch that emitted it had no fixture. The
     id list is derived from the source, so a finding added later either gets a
     fixture or fails here — nobody has to remember. Ids built at runtime carry
     a template literal and are matched by prefix. */
  const declaredIds = [...analyzeSrc.matchAll(/^\s+id: '([a-z0-9-]+)',$/gm)].map(m => m[1])
  const templateIds = [...analyzeSrc.matchAll(/^\s+id: [`']([a-z-]+)-\$\{/gm)].map(m => m[1])
  assert.ok(declaredIds.length >= 15, `expected the finding ids to be discoverable in the source (found ${declaredIds.length})`)
  for (const id of declaredIds) {
    assert.ok(seenIds.has(id), `no fixture above ever produces the finding "${id}" — its evidence is unchecked`)
  }
  for (const prefix of new Set(templateIds)) {
    assert.ok([...seenIds].some(id => id.startsWith(`${prefix}-`)), `no fixture produces a "${prefix}-*" finding`)
  }
  assert.ok(seenIds.size >= 15, `expected many distinct finding ids (got ${seenIds.size})`)

  // Ordering: errors first. A page that leads with a note while an error sits
  // below the fold has technically reported it.
  const sorted = sg.sgSortFindings(everyFinding)
  let worst = 0
  for (const f of sorted) {
    const rank = { error: 0, warn: 1, info: 2 }[f.level]
    assert.ok(rank >= worst, 'findings are ordered error → warn → info')
    worst = rank
  }

  /* ── 9. The transport, against a fixture resolver on loopback. ─────────── */

  const { createServer } = await import('node:http')
  let lastQuery = null
  let hits = 0
  const fixture = createServer((req, res) => {
    hits += 1
    const u = new URL(req.url, 'http://127.0.0.1')
    lastQuery = u.searchParams
    const name = u.searchParams.get('name') ?? ''
    if (name === 'slow.test') return // never answers — exercises the timeout
    if (name === 'huge.test') {
      res.writeHead(200, { 'content-type': 'application/dns-json' })
      res.end(JSON.stringify({ Status: 0, Answer: [{ name, type: 16, TTL: 1, data: 'x'.repeat(200_000) }] }))
      return
    }
    if (name === 'garbage.test') {
      res.writeHead(200, { 'content-type': 'application/dns-json' })
      res.end('<html>not json</html>')
      return
    }
    if (name === 'error.test') {
      res.writeHead(503)
      res.end('nope')
      return
    }
    res.writeHead(200, { 'content-type': 'application/dns-json' })
    res.end(JSON.stringify({
      Status: name === 'missing.test' ? 3 : 0,
      Answer: name === 'missing.test' ? [] : [
        { name, type: 1, TTL: 60, data: '1.2.3.4' },
        // A record of a DIFFERENT type in the same answer section — a CNAME on
        // the way to the A record is normal, and counting it as an A record
        // would make every aliased name disagree with itself.
        { name, type: 5, TTL: 60, data: 'alias.test' },
      ],
    }))
  })
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const endpointOverride = `http://127.0.0.1:${fixture.address().port}/dns-query`

  try {
    const ok = await doh.sgQuery('cloudflare', 'ex.test', 'A', { endpointOverride })
    assert.equal(ok.rcode, 'NOERROR')
    assert.equal(ok.records.length, 1, 'only records of the type asked for are kept')
    assert.equal(ok.records[0].data, '1.2.3.4')
    assert.equal(lastQuery.get('type'), 'A')

    // Parameter injection: the name is the only caller-supplied value that
    // reaches the URL, and it must arrive as ONE parameter value rather than
    // rewriting the question.
    await doh.sgQuery('cloudflare', 'a&type=ANY&name=evil.test', 'A', { endpointOverride })
    assert.equal(lastQuery.getAll('type').length, 1, 'a crafted name must not inject a second type parameter')
    assert.equal(lastQuery.get('type'), 'A')
    assert.equal(lastQuery.get('name'), 'a&type=ANY&name=evil.test', 'the whole name arrives as one encoded value')

    // NXDOMAIN is an answer, not an error.
    const missing = await doh.sgQuery('cloudflare', 'missing.test', 'A', { endpointOverride })
    assert.equal(missing.rcode, 'NXDOMAIN')
    assert.equal(missing.error, undefined)

    // Failure modes come back as answers carrying `error`, never as throws —
    // one slow resolver must not cost the whole inspection.
    const slow = await doh.sgQuery('cloudflare', 'slow.test', 'A', { endpointOverride, timeoutMs: 150 })
    assert.ok(slow.error && /no answer within/.test(slow.error), `timeout should be reported, got ${JSON.stringify(slow.error)}`)
    const huge = await doh.sgQuery('cloudflare', 'huge.test', 'TXT', { endpointOverride })
    assert.ok(huge.error && /size cap/.test(huge.error), 'an oversized body is refused by the byte ceiling')
    const garbage = await doh.sgQuery('cloudflare', 'garbage.test', 'A', { endpointOverride })
    assert.ok(garbage.error && /not JSON/.test(garbage.error))
    const http503 = await doh.sgQuery('cloudflare', 'error.test', 'A', { endpointOverride })
    assert.ok(http503.error && /HTTP 503/.test(http503.error))

    // An unknown resolver key does not reach the network at all.
    const before = hits
    const unknown = await doh.sgQuery('not-a-resolver', 'ex.test', 'A', { endpointOverride })
    assert.equal(unknown.error, 'unknown resolver')
    assert.equal(hits, before, 'an unknown key must not cause a request')

    // The override is loopback-and-http only, so even a caller that wired it to
    // a request parameter by mistake could not turn it into an SSRF.
    for (const bad of ['https://127.0.0.1/x', 'http://169.254.169.254/latest', 'http://example.com/', 'http://[::ffff:127.0.0.1]/', 'not a url']) {
      assert.equal(doh.sgOverrideAllowed(bad), false, `override refused: ${bad}`)
      const refused = await doh.sgQuery('cloudflare', 'ex.test', 'A', { endpointOverride: bad })
      assert.equal(refused.error, 'endpoint override refused')
    }
    assert.equal(doh.sgOverrideAllowed('http://127.0.0.1:8080/dns-query'), true)
    assert.equal(doh.sgOverrideAllowed('http://localhost:1/x'), true)

    // The budget is shared and it actually stops the work.
    const budget = doh.sgNewBudget(3)
    const spent = []
    for (let i = 0; i < 5; i += 1) spent.push(await doh.sgQuery('cloudflare', `b${i}.test`, 'A', { endpointOverride, budget }))
    assert.equal(budget.spent, 3)
    assert.equal(budget.left, 0)
    assert.equal(spent.filter(s => s.error === 'query budget exhausted').length, 2)

    // The memo: same question once, different questions separately, and an
    // ERROR is not retained — a timeout is a fact about one moment, and caching
    // it would turn one slow response into a whole inspection of failures.
    const memoBudget = doh.sgNewBudget(20)
    const lookup = doh.sgMakeLookup('cloudflare', memoBudget, { endpointOverride })
    const a1 = await lookup('ex.test', 'A')
    const a2 = await lookup('EX.test.', 'A')
    assert.equal(memoBudget.spent, 1, 'the memo key is derived from the normalised name and the type')
    assert.deepEqual(a1.records, a2.records, 'the memo must AGREE with the uncached function, not merely be fast')
    await lookup('ex.test', 'TXT')
    assert.equal(memoBudget.spent, 2, 'a different type is a different question')
    await lookup('other.test', 'A')
    assert.equal(memoBudget.spent, 3)
    const errBudget = doh.sgNewBudget(20)
    const errLookup = doh.sgMakeLookup('cloudflare', errBudget, { endpointOverride, timeoutMs: 120 })
    await errLookup('slow.test', 'A')
    await errLookup('slow.test', 'A')
    assert.equal(errBudget.spent, 2, 'a failed answer is retried rather than remembered')

    // The pool keeps result order regardless of completion order.
    const pooled = await doh.sgPool([
      () => new Promise(r => setTimeout(() => r('a'), 30)),
      () => Promise.resolve('b'),
      () => new Promise(r => setTimeout(() => r('c'), 10)),
    ], 3)
    assert.deepEqual(pooled, ['a', 'b', 'c'])
  } finally {
    await new Promise(resolve => fixture.close(resolve))
  }

  /* ── 10. The outbound surface, and the escape hatch staying shut. ──────── */

  assert.ok(doh.SG_RESOLVERS.length >= 3, 'the diff needs at least three opinions to be worth having')
  assert.equal(new Set(doh.SG_RESOLVERS.map(r => r.key)).size, doh.SG_RESOLVERS.length)
  for (const r of doh.SG_RESOLVERS) {
    assert.ok(r.endpoint.startsWith('https://'), `${r.key} is reached over TLS`)
    assert.doesNotThrow(() => new URL(r.endpoint))
  }
  assert.ok(doh.SG_RESOLVERS.some(r => r.key === doh.SG_PRIMARY_RESOLVER), 'the analysis resolver is one of the three')

  const dohSrc = await readFile(new URL('../src/lib/dns-doh.ts', import.meta.url), 'utf-8')
  // The destination is only ever `info.endpoint` or a loopback override. If a
  // future edit interpolates anything else into the fetch URL, this fails.
  assert.ok(/const url = `\$\{base\}\?name=\$\{encodeURIComponent\(name\)\}&type=\$\{encodeURIComponent\(type\)\}`/.test(dohSrc),
    'the DoH URL is built from the allowlisted base with both parameters encoded')
  assert.equal((dohSrc.match(/await fetch\(/g) ?? []).length, 1, 'there is exactly one outbound call site in the transport')
  assert.ok(/redirect: 'error'/.test(dohSrc), 'a resolver redirecting us somewhere else is an error, not a hop to follow')

  const inspectSrc = await readFile(new URL('../src/components/tools/dns-sightline/inspect.ts', import.meta.url), 'utf-8')
  const routeSrc = await readFile(new URL('../src/pages/api/tools/dns-sightline.ts', import.meta.url), 'utf-8')
  // The override exists for the fixture above and nothing else. Mentioning it
  // in a comment is fine; passing it is not.
  assert.equal(/endpointOverride\s*[:=]/.test(inspectSrc.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')), false,
    'sgInspect must never set endpointOverride')
  assert.equal(/endpointOverride/.test(routeSrc), false, 'the route must never mention endpointOverride')
  assert.ok(/export const prerender = false/.test(routeSrc))
  assert.ok(/'Cache-Control': 'no-store'/.test(routeSrc), 'an inspection is per-request and must not be cached')
  // The CA parameter is an allowlist selection, not free text echoed back.
  assert.ok(/SG_KNOWN_CAS\.some\(c => c\.id === caParam\)/.test(routeSrc),
    'the ca parameter must be matched against the bundled identifiers, never used as given')

  /* ── 11. Every live tool reaches its module AND its stylesheet. ────────── */

  /* The tools-lane twin of the game-wiring guard above, and it closes the same
     silent pair: no dispatch branch renders an empty custom element, and a
     missing stylesheet import renders an unstyled one. Derived from the tools
     config and from the route's own dispatch, so the next tool is covered
     without anybody remembering this exists. */
  const slugRoute = await readFile(new URL('../src/pages/tools/[slug].astro', import.meta.url), 'utf-8')
  for (const tool of tools) {
    if (tool.status !== 'live' || tool.slug === 'driftfield') continue // driftfield is its own hub route
    const marker = `slug === '${tool.slug}') import('`
    const at = slugRoute.indexOf(marker)
    assert.notEqual(at, -1, `${tool.slug} has no dispatch branch in tools/[slug].astro — its page would render an empty element`)
    const importPath = slugRoute.slice(at + marker.length, slugRoute.indexOf("'", at + marker.length))
    const dir = importPath.replace(/\/[^/]+$/, '').replace('../../components/tools/', '')
    assert.ok(dir && dir !== importPath, `${tool.slug}'s dispatch must import from src/components/tools/`)
    assert.ok(
      slugRoute.includes(`../../components/tools/${dir}/`) && new RegExp(`import '\\.\\./\\.\\./components/tools/${dir}/[a-z0-9-]+\\.css'`).test(slugRoute),
      `${tool.slug}'s stylesheet is not imported by tools/[slug].astro — the page would render unstyled`,
    )
  }

  /* ── 12. The hoisted IP canonicaliser still serves both callers. ───────── */

  /* `canonicalIp` moved out of chainsaw/analyze.ts so DNS Sightline could reuse
     it. Chainsaw's own assertions still run against `csCanonicalIp`; this pins
     the two names to ONE implementation, so a later "tidy-up" cannot fork them
     and leave the two tools disagreeing about whether two spellings of an
     address are the same address. */
  const csAnalyze = await import('../src/components/tools/chainsaw/analyze.ts')
  assert.equal(csAnalyze.csCanonicalIp, canonicalIp, 'Chainsaw and DNS Sightline must share one canonicaliser, not two copies')
  assert.equal(canonicalIp('2001:0DB8:0000:0000:0000:0000:0000:0001'), canonicalIp('2001:db8::1'))
  assert.equal(canonicalIp('not-an-ip'), null)
}
console.log('dns sightline: the resolver diff ignores TTL and order, the SPF walk matches an independent oracle and terminates on a hostile zone, CAA issuewild replaces issue, every finding cites its record, and the only hosts reachable are the three allowlisted resolvers')

/* ─────  The Diagram Atlas: seven notations, and what each one cannot say  ─────

   Shipped 2026-09-25 as the figure for /learnings/how-to-think-on-paper. The
   article's argument is Larkin & Simon's — a picture is cheap only for the
   question its layout groups for — and the figure proves it by drawing ONE
   unchanged scenario seven ways, each view naming the question it has gone blind
   to. Every failure mode here renders a correct-looking diagram:

     · a step naming an id that is not in the SVG lights nothing, and the
       diagram still draws perfectly — nobody watching a seven-beat animation
       notices that beat four highlighted nothing at all;
     · a token placed outside the viewBox is simply not on screen;
     · a view shipped without its legend leaves the panel half empty, which
       reads as a layout bug rather than as a missing claim;
     · and an eighth notation added later leaves the prose saying "seven".

   Same family as the SERVER_TOOLS badge (a number word in copy, checked against
   the set it describes) and the Maze Weaver article's recomputed counts: an
   article that quotes the component is quoting code, so the number is asserted
   rather than proof-read. */
{
  const { ATLAS_VIEWS, atlasView } = await import('../src/components/games/diagram-atlas/atlas.ts')
  const article = learnings.find(l => l.embed === 'diagram-atlas')
  assert.ok(article, 'the diagram atlas has no article to be the figure for')

  /* ── 1. The prose's number word matches the number of views. ──
     Pinned to the exact phrase and NOT by iterating a map of number words: the
     SERVER_TOOLS assertion did the latter and matched "three DNS resolvers"
     several paragraphs from the sentence it meant to check. */
  const WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }

  // Checked in EVERY field that states it, and the field list is derived from
  // the entry rather than written down. The body is the obvious one; the count
  // is also in `summary` (the hub card and the share card) and in
  // `metaDescription` (the search snippet), and a mutation of the body alone
  // proved those two were unguarded. Same shape as the blogs flag: a fact
  // corrected in one signal and stale in another is worse than either alone,
  // because whoever reads the wrong one has no way to know.
  const claims = Object.entries(article)
    .filter(([, v]) => typeof v === 'string')
    .flatMap(([field, v]) =>
      [...v.matchAll(/\bdrawn ([a-z]+) ways\b/gi)].map(m => ({ field, word: m[1] })))
  assert.ok(
    claims.length >= 2,
    'the figure\'s view count must be stated in the body AND in the copy that leaves the page',
  )
  assert.ok(
    claims.some(c => c.field === 'content'),
    'the article body must introduce the figure with "drawn <number> ways"',
  )
  for (const { field, word } of claims) {
    assert.equal(
      WORDS[word.toLowerCase()], ATLAS_VIEWS.length,
      `${field} says the system is drawn "${word}" ways but the atlas has ${ATLAS_VIEWS.length} views`,
    )
  }

  /* …and the article shows one figure per view, for the same reason. A notation
     in the atlas and absent from the article is the contradiction the reader
     resolves by trusting neither.

     This used to count rows of a markdown table. The house format (see
     docs/plans/learnings-voice.md) replaced that table with a pinned figure per
     notation, so the mapping now lives in the `{{embed:view}}` markers — which
     is a stronger place for it than prose, because the marker is the thing that
     actually renders. Both directions are asserted, and the second one is the
     one a table could never give: a marker naming a view that does not exist
     renders the full picker instead, which looks deliberate and is not. */
  const pinned = [...article.content.matchAll(/^[ \t]*\{\{embed:([a-z0-9-]+)\}\}[ \t]*$/gm)].map(m => m[1])
  for (const id of pinned) {
    assert.ok(
      ATLAS_VIEWS.some(v => v.id === id),
      `the article pins a figure to "${id}", which is not a view — it would silently render the full picker`,
    )
  }
  assert.deepEqual(
    [...pinned].sort(), ATLAS_VIEWS.map(v => v.id).sort(),
    'every view must get its own figure in the article, and none twice',
  )

  /* ── 2. Every view carries a full legend. ──
     The key set is compared across views rather than spot-checked, so a field
     added to AtlasView later has to be populated everywhere — the Token Bench
     lesson, where a `proof` label was asserted on one producer and a second
     producer shipped able to lie. */
  const shape = Object.keys(ATLAS_VIEWS[0]).sort().join(',')
  for (const v of ATLAS_VIEWS) {
    assert.equal(Object.keys(v).sort().join(','), shape, `view "${v.id}" has a different shape to the others`)
    for (const field of ['id', 'question', 'notation', 'node', 'arrow', 'blind', 'svg']) {
      assert.ok(
        typeof v[field] === 'string' && v[field].trim().length > 0,
        `view "${v.id}" ships an empty ${field} — the panel would render a blank row`,
      )
    }
    // The question is the button label and has to read as a question.
    assert.ok(v.question.endsWith('?'), `view "${v.id}"'s label must be a question, not a notation name`)
    // `blind` is the teaching payload, so a one-word filler must not pass for it.
    assert.ok(v.blind.length > 40, `view "${v.id}"'s "cannot tell you" line is too short to be a real claim`)
  }
  assert.equal(new Set(ATLAS_VIEWS.map(v => v.id)).size, ATLAS_VIEWS.length, 'two views share an id')
  assert.equal(
    new Set(ATLAS_VIEWS.map(v => v.arrow)).size, ATLAS_VIEWS.length,
    'two notations claim the same verb for their arrow — that claim is the whole figure',
  )

  /* ── 3. A structural diagram has no time axis, and must not animate. ──
     A class diagram or a schema is true at every instant. Walking a token along
     one would be a lie about the notation dressed as a feature, and it is the
     mistake the article names as the standard misreading of UML — so the two
     structural views carry zero steps deliberately, and the component hides its
     transport rather than offering a button. Asserted in BOTH directions: a
     behavioural view with no steps is a figure that silently does not move. */
  const STRUCTURAL = new Set(['class', 'er'])
  for (const v of ATLAS_VIEWS) {
    if (STRUCTURAL.has(v.id)) {
      assert.equal(v.steps.length, 0, `"${v.id}" is structural and must not animate`)
    } else {
      assert.ok(v.steps.length >= 3, `"${v.id}" is behavioural and needs beats to walk through`)
    }
  }
  assert.ok(STRUCTURAL.size < ATLAS_VIEWS.length, 'if every view is structural, nothing in the figure moves')

  /* ── 4. Every beat lights something that is really in the SVG. ──
     THE silent one. A mistyped id renders a flawless diagram in which one beat
     highlights nothing, and no screenshot of any single frame shows it. */
  for (const v of ATLAS_VIEWS) {
    const ids = new Set([...v.svg.matchAll(/id="([^"]+)"/g)].map(m => m[1]))
    assert.equal(ids.size, (v.svg.match(/id="/g) ?? []).length, `view "${v.id}" reuses an id — querySelector takes the first`)
    v.steps.forEach((step, i) => {
      assert.ok(step.on.length > 0, `view "${v.id}" beat ${i} lights nothing`)
      for (const id of step.on) {
        assert.ok(ids.has(id), `view "${v.id}" beat ${i} lights "#${id}", which is not in its SVG`)
      }
      assert.ok(step.say && step.say.trim().length > 0, `view "${v.id}" beat ${i} has no caption`)
      // A token outside the viewBox is off screen, which looks like no token.
      for (const [which, at] of [['token', step.token], ['token2', step.token2]]) {
        if (!at) continue
        assert.ok(
          at[0] >= 0 && at[0] <= 680 && at[1] >= 0 && at[1] <= 364,
          `view "${v.id}" beat ${i} puts ${which} at ${at} — outside the viewBox, so it is invisible`,
        )
      }
    })
    // A second token is a claim of concurrency, so it may only appear in a view
    // whose notation can express it — and the activity diagram is the only one.
    if (v.steps.some(s => s.token2)) {
      assert.equal(v.id, 'activity', `"${v.id}" draws two tokens but its notation has one thread of control`)
    }
  }
  assert.ok(
    ATLAS_VIEWS.find(v => v.id === 'activity').steps.some(s => s.token2),
    'the activity view must actually show two tokens at once — it is the one thing a flowchart cannot draw',
  )

  /* ── 5. Selection cannot land on nothing, including on a prototype key. ── */
  assert.equal(atlasView('flow').id, 'flow')
  assert.equal(atlasView('not-a-view').id, ATLAS_VIEWS[0].id, 'an unknown id falls back to the first view')
  assert.equal(atlasView(null).id, ATLAS_VIEWS[0].id)
  assert.equal(atlasView('constructor').id, ATLAS_VIEWS[0].id, 'prototype keys are not views')

  /* ── 6. The component is wired the way the module assumes. ── */
  const atSrc = await readFile(new URL('../src/components/games/diagram-atlas/DiagramAtlas.ts', import.meta.url), 'utf-8')
  assert.ok(
    /customElements\.define\('diagram-atlas-figure'/.test(atSrc),
    'the element registers under the tag EMBED_TAGS names',
  )
  assert.equal(EMBED_TAGS['diagram-atlas'], 'diagram-atlas-figure')
  // The claims live in atlas.ts so this file can test them. A second copy in the
  // component is how the panel and the assertions start disagreeing.
  for (const v of ATLAS_VIEWS) {
    assert.ok(!atSrc.includes(v.blind), `view "${v.id}"'s claim is duplicated in the component`)
  }
  assert.ok(
    /prefers-reduced-motion/.test(atSrc),
    'a figure that animates on its own must not autoplay for a reader who asked it not to',
  )
  assert.ok(/disconnectedCallback/.test(atSrc) && /clearInterval/.test(atSrc),
    'the beat clock is torn down on unmount — ClientRouter keeps the document, so it would otherwise tick forever')

  /* ── 7. The figure scrolls on a phone instead of shrinking its own labels. ──

     An <svg> at width:100% scales its viewBox as ONE object, text included, so
     the figure stayed inside the viewport at 375px by rendering every label at
     about 5px. Nothing overflowed, no assertion of "does it fit" would have
     complained, and a screenshot taken at desktop width looks perfect — the
     defect only exists on the device. A diagram also does not reflow: there is
     no arrangement of four lifelines that is still a sequence diagram at 300px.
     So the label size is the thing held and the stage scrolls, which is the
     trade the article route already makes for a wide table.

     Asserted because the min-width reads like a stray constraint to anyone
     tidying this file, and removing it restores the unreadable version silently. */
  const atCss = await readFile(new URL('../src/components/games/diagram-atlas/diagram-atlas.css', import.meta.url), 'utf-8')
  const stageRule = /\[data-type="at-stage"\] \{([^}]*)\}/.exec(atCss.replace(/\/\*[\s\S]*?\*\//g, ''))
  assert.ok(stageRule, 'the stage has a rule')
  assert.ok(/overflow-x:\s*auto/.test(stageRule[1]), 'the stage must scroll rather than clip the diagram')
  const svgRule = /\[data-type="at-stage"\] svg \{([^}]*)\}/.exec(atCss.replace(/\/\*[\s\S]*?\*\//g, ''))
  assert.ok(svgRule, 'the stage svg has a rule')
  const floor = /min-width:\s*([0-9.]+)rem/.exec(svgRule[1])
  assert.ok(floor, 'the svg needs a min-width, or it scales its own text down with the geometry')
  assert.ok(
    Number(floor[1]) >= 34,
    `the legibility floor is ${floor[1]}rem — below ~34rem the 680-unit viewBox renders labels under 8px`,
  )
  assert.ok(
    /data-type="at-stage" tabindex="0"/.test(atSrc),
    'a horizontally scrollable region must be reachable without a pointer',
  )
}
/* ─────  the house article format: many figures, and a cost that follows them  ──

   `{{embed:view}}` lets one article carry a figure every few lines
   (docs/plans/learnings-voice.md). That is the format the owner asked for, and
   it brings a cost the single-embed version did not have: the diagrams article
   now mounts EIGHT copies of the same component, five of which animate on a
   timer. The component autoplayed in `select()`, so the first version of this
   started five setIntervals on connect and ran all of them forever, on a page
   whose entire job is to be read — the same objection that took the starfield
   off tool and game pages, arrived at from the other direction.

   Playback therefore follows visibility. The invariant is that no path starts
   the timer without checking it, which is asserted at the source rather than by
   counting timers, because a leaked interval is invisible in every screenshot
   and is exactly what a later refactor would reintroduce. */
{
  const atlasComponent = await readFile(
    new URL('../src/components/games/diagram-atlas/DiagramAtlas.ts', import.meta.url), 'utf-8')

  assert.ok(
    /IntersectionObserver/.test(atlasComponent),
    'the atlas must gate playback on visibility — eight copies of it share one article',
  )
  assert.ok(
    /private autoplay\(\)[\s\S]*?this\.visible/.test(atlasComponent),
    'autoplay() must check visibility before starting the timer',
  )
  // select() runs on connect for every copy, so a bare play() there is the
  // regression: it would restore autoplay-on-mount for all eight at once.
  const selectBody = atlasComponent.slice(
    atlasComponent.indexOf('private select('),
    atlasComponent.indexOf('private autoplay('))
  assert.ok(
    !/\bthis\.play\(\)/.test(selectBody),
    'select() must reach playback through autoplay(), never call play() directly',
  )
  assert.ok(
    /prefers-reduced-motion/.test(atlasComponent),
    'a figure that moves on its own must respect prefers-reduced-motion',
  )

  /* ── Read time is derived, never stored ──
     Same rule as `learningsAboutEmbed`: a number typed into config is a second
     copy of a fact the content already states, and it goes stale on the next
     edit with nothing to catch it. */
  const { readingTime } = await import('../src/lib/learnings.ts')
  const learningsConfigSrc = await readFile(new URL('../src/config/learnings.ts', import.meta.url), 'utf-8')
  assert.ok(
    !/"(readingTime|minutes|readTime)"\s*:/.test(learningsConfigSrc),
    'read time must not be a config field — it is derived from the content by readingTime()',
  )
  assert.equal(readingTime(''), 1, 'a "0 min read" is not a thing')
  assert.ok(
    readingTime('word '.repeat(400)) > readingTime('word '.repeat(100)),
    'read time must grow with the article',
  )
  // Figures are most of a house-format article; counting only the prose between
  // them reports "1 min" for a page that takes several.
  assert.ok(
    readingTime('word '.repeat(100) + '\n{{embed:flow}}\n'.repeat(7))
      > readingTime('word '.repeat(100)),
    'figures must count toward the read time, or a figure-led article reads as a minute',
  )
  assert.ok(
    learningRouteSrc.includes('readingTime(learning.content)'),
    'the article route must derive the read time from the content it renders',
  )
  assert.ok(
    /min read/.test(learningRouteSrc),
    'the article must show its read time — the owner asked for the Medium-style estimate',
  )
}
console.log('learnings format: figures are visibility-gated and motion-safe, and the read time is derived from the content')

console.log('diagram atlas: seven views, every beat lights an element that exists, the structural notations refuse to animate, and the prose still says seven')

/* ─────  CAA x issuer: the finding neither tool can make alone  ─────────────

   Shipped 2026-09-25. DNS Sightline knows which CA a zone's CAA policy PERMITS;
   Chainsaw knows which CA actually ISSUED the certificate on the wire. Put the
   two side by side and you get the answer people currently discover on renewal
   day: *will the next renewal be refused?*

   Four failure modes here all produce a confident, plausible, wrong sentence,
   and none of them look like a bug in a screenshot:

     · calling a certificate mis-issued because the CURRENT policy forbids its
       CA — CAA is consulted only in the eight hours before a CA signs, so a
       policy published afterwards says nothing about that certificate. The tool
       would be accusing a correctly-run CA of breaking the rules because
       somebody edited a DNS record last Tuesday;
     · reading "no CAA record" off a walk whose LOOKUPS FAILED, which turns a
       DNS timeout into "any CA may issue" — the most reassuring sentence this
       tool can print, produced by the least evidence;
     · going silent on the zones that are most broken, by checking "can I
       identify the issuer?" before the two conclusions that hold whoever the
       issuer is (a critical tag nobody understands, and `issue ";"`);
     · fuzzy-matching an unrecognised issuer onto the nearest registry entry,
       manufacturing "your policy forbids your CA" out of a gap in a table.

   The table mapping issuer names to CAA identifiers is the fallible part of all
   this, which is exactly why an unmatched issuer produces null and a state that
   draws no conclusion. */
{
  const caa = await import('../src/lib/caa.ts')
  const sgc = await import('../src/components/tools/dns-sightline/analyze.ts')
  const insp = await import('../src/components/tools/dns-sightline/inspect.ts')
  const { SG_MAX_QUERIES } = await import('../src/lib/dns-doh.ts')

  /* ── 1. One implementation, two spellings. ───────────────────────────────

     The CAA vocabulary moved out of dns-sightline/analyze.ts into src/lib/caa.ts
     so Chainsaw could reuse it, exactly as `canonicalIp` moved the other way.
     Sightline re-exports its old names; this pins them to the same objects, so a
     later "tidy-up" cannot fork them and leave the two tools telling the same
     visitor opposite things about whose CA is permitted. */
  assert.equal(sgc.sgCaaAllows, caa.caaAllows, 'one issue/issuewild rule, not two')
  assert.equal(sgc.sgParseCaa, caa.parseCaa, 'one CAA record parser, not two')
  assert.equal(sgc.SG_KNOWN_CAS, caa.CA_REGISTRY, 'one CA identifier registry, not two')
  const chainsawSrc = await readFile(new URL('../src/components/tools/chainsaw/Chainsaw.ts', import.meta.url), 'utf-8')
  // Comments stripped, the way the endpointOverride assertion strips them:
  // naming the rule in a docblock is how the next reader finds it, re-deriving it
  // in code is the thing being forbidden.
  const chainsawCode = chainsawSrc.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
  assert.equal(/issuewild|allowedWild|forbidsAll/.test(chainsawCode), false,
    'Chainsaw must call the shared rule, not carry its own copy of the issuewild logic')

  /* ── 2. The identity table does not drift from the registry. ───────────── */

  for (const p of caa.CA_ISSUER_PATTERNS) {
    assert.ok(caa.CA_REGISTRY.some(c => c.id === p.caId),
      `the issuer pattern for ${p.caId} names an identifier that is not in CA_REGISTRY — the label lookup would come back null and the sentence would read "null may renew this"`)
  }
  for (const c of caa.CA_REGISTRY) {
    assert.ok(/^[a-z0-9.-]+\.[a-z]{2,}$/.test(c.id), `${c.id} is not a domain-shaped CAA identifier`)
    assert.ok(c.label && c.label.trim(), `${c.id} has no label`)
  }
  assert.equal(new Set(caa.CA_REGISTRY.map(c => c.id)).size, caa.CA_REGISTRY.length, 'no duplicate identifiers')

  /* ── 3. caIdentify: recognise, or say nothing. ───────────────────────────

     The identifier is a domain the CA CHOSE; nothing on the certificate spells
     it. "Google Trust Services LLC" renews against `pki.goog`, and no string
     processing gets you from one to the other — which is the whole reason this
     is a table and the whole reason a miss must return null. */
  assert.equal(caa.caIdentify({ issuerO: "Let's Encrypt", issuerCN: 'R11' }).caId, 'letsencrypt.org')
  assert.equal(caa.caIdentify({ issuerO: 'Google Trust Services LLC', issuerCN: 'WR3' }).caId, 'pki.goog')
  assert.equal(caa.caIdentify({ issuerO: 'DigiCert Inc', issuerCN: 'DigiCert TLS RSA SHA256 2020 CA1' }).caId, 'digicert.com')
  // Brands, which are not cosmetic: all three renew against digicert.com, and a
  // table that only knew the current corporate names would report them unknown.
  assert.equal(caa.caIdentify({ issuerO: 'GeoTrust Inc.', issuerCN: 'GeoTrust TLS CA' }).caId, 'digicert.com')
  assert.equal(caa.caIdentify({ issuerO: 'Thawte, Inc.', issuerCN: 'Thawte TLS CA' }).caId, 'digicert.com')
  // Sectigo still signs some chains as COMODO, and ZeroSSL runs on its hierarchy.
  assert.equal(caa.caIdentify({ issuerO: 'COMODO CA Limited', issuerCN: 'COMODO RSA CA' }).caId, 'sectigo.com')
  assert.equal(caa.caIdentify({ issuerO: 'ZeroSSL', issuerCN: 'ZeroSSL RSA Domain Secure Site CA' }).caId, 'sectigo.com')
  assert.equal(caa.caIdentify({ issuerO: 'Amazon', issuerCN: 'Amazon RSA 2048 M01' }).caId, 'amazon.com')

  // The CN rules are a FALLBACK for issuers that ship no organisation at all.
  assert.equal(caa.caIdentify({ issuerO: null, issuerCN: 'E6' }).caId, 'letsencrypt.org')
  assert.equal(caa.caIdentify({ issuerO: null, issuerCN: 'E6' }).matchedOn, 'common name')
  // …and must never outrank another CA's exact organisation match. `^(r|e)\d+$`
  // is two characters and a digit: matched in table order alongside the org
  // rules it would win ties it has no business winning.
  const branded = caa.caIdentify({ issuerO: 'DigiCert Inc', issuerCN: 'R11' })
  assert.equal(branded.caId, 'digicert.com', 'an organisation match outranks every CN fallback')
  assert.equal(branded.matchedOn, 'organisation')

  // A miss is a miss. No nearest-neighbour, no partial credit.
  const unknown = caa.caIdentify({ issuerO: 'Acme Local CA', issuerCN: 'internal-ca-1' })
  assert.equal(unknown.caId, null, 'an unrecognised issuer must not be guessed at')
  assert.equal(unknown.label, null)
  assert.equal(unknown.matchedOn, null)
  assert.equal(unknown.issuerText, 'internal-ca-1 (Acme Local CA)', 'the issuer is still quoted back verbatim')
  assert.equal(caa.caIdentify({ issuerO: null, issuerCN: null }).issuerText, '')

  /* ── 4. incomplete is not the same as absent. ────────────────────────────

     Both end with zero entries. One means "no policy governs this name, so any
     CA may issue"; the other means "nobody read the policy". */
  const failing = async (name, type) => ({
    resolver: 'fixture', type, name, rcode: 'SERVFAIL', records: [], elapsedMs: 0, error: 'timeout',
  })
  const nx = async (name, type) => ({ resolver: 'fixture', type, name, rcode: 'NXDOMAIN', records: [], elapsedMs: 0 })

  const brokenWalk = await sgc.sgAnalyzeCaa('a.b.example.com', failing)
  assert.equal(brokenWalk.incomplete, true, 'a SERVFAIL anywhere in the walk makes the empty result inconclusive')
  const cleanWalk = await sgc.sgAnalyzeCaa('a.b.example.com', nx)
  assert.equal(cleanWalk.incomplete, false, 'NXDOMAIN IS an answer: the name has no CAA because it has nothing')
  assert.equal(sgc.sgCaaVerdict(brokenWalk).incomplete, true)
  assert.equal(sgc.sgCaaVerdict(cleanWalk).incomplete, false)

  // A policy that WAS found is NOT complete by construction — this line used to
  // assert that it was. The walk stops at the first name with a policy, so
  // nothing ABOVE it matters; a name BELOW it that never answered might hold a
  // CAA set of its own. The verdict must carry the flag through; section 6b
  // below holds the walk, the findings and the outlook to it.
  const foundDespite = caa.caaVerdict([caa.parseCaa('0 issue "letsencrypt.org"')], 'example.com', true)
  assert.equal(foundDespite.incomplete, true, 'the verdict passes incomplete through even when a policy was found')

  // The finding side of the same distinction: opposite ids off the same zero.
  const inconclusive = sgc.sgCaaFindings(sgc.sgCaaVerdict(brokenWalk), 'a.b.example.com', null)
  assert.deepEqual(inconclusive.map(f => f.id), ['caa-inconclusive'])
  assert.equal(inconclusive[0].level, 'warn')
  assert.deepEqual(sgc.sgCaaFindings(sgc.sgCaaVerdict(cleanWalk), 'a.b.example.com', null).map(f => f.id), ['caa-none'])

  /* ── 5. The join, state by state. ────────────────────────────────────────

     `leafHasWildcard` is the certificate's own SAN set, not a guess: it is what
     puts `issuewild` in play, and `issuewild` REPLACES `issue` for wildcards
     rather than adding to it. */
  const le = { issuerO: "Let's Encrypt", issuerCN: 'R11' }
  const outlook = (verdict, over = {}) => caa.caaRenewalOutlook({
    verdict, issuer: le, leafHasWildcard: false, selfSigned: false, host: 'www.example.com', ...over,
  })
  const v = (lines, at = 'example.com', incomplete = false) =>
    caa.caaVerdict(lines.map(l => caa.parseCaa(l)).filter(Boolean), at, incomplete)

  // No policy at all: a fact, not a warning, and it cites nothing.
  const noPolicy = outlook(caa.caaVerdict([], null))
  assert.equal(noPolicy.state, 'no-policy')
  assert.equal(noPolicy.problem, false)
  assert.deepEqual(noPolicy.evidence, [], 'a conclusion about an absent record must cite nothing')

  // Permitted.
  const permitted = outlook(v(['0 issue "letsencrypt.org"']))
  assert.equal(permitted.state, 'permitted')
  assert.equal(permitted.problem, false)
  assert.deepEqual(permitted.evidence, ['0 issue "letsencrypt.org"'], 'a conclusion about a record cites it literally')
  assert.equal(permitted.policyAt, 'example.com')

  // Refused — and the sentence is about the RENEWAL, never about the served
  // certificate being invalid. This is the assertion that stops the tool
  // accusing a CA of mis-issuance because a DNS record changed afterwards.
  const refused = outlook(v(['0 issue "digicert.com"']))
  assert.equal(refused.state, 'refused')
  assert.equal(refused.problem, true)
  assert.ok(/not a mis-issuance/i.test(refused.detail), 'the refusal must disclaim mis-issuance explicitly')
  assert.ok(/renewal/i.test(refused.detail), 'the refusal must be framed as a future renewal failing')
  assert.equal(/invalid|untrusted|revoke/i.test(refused.detail), false,
    'a CAA mismatch says nothing about the validity of the certificate on the wire')

  // A policy with no `issue` term at all restricts nobody.
  assert.equal(outlook(v(['0 iodef "mailto:sec@example.com"'])).state, 'permitted')

  // The wildcard rule, both ways round. `issuewild ";"` forbids every wildcard
  // while `issue` still permits Let's Encrypt the plain names.
  const wildBlocked = ['0 issue "letsencrypt.org"', '0 issuewild ";"']
  assert.equal(outlook(v(wildBlocked), { leafHasWildcard: true }).state, 'refused-wildcard')
  assert.equal(outlook(v(wildBlocked), { leafHasWildcard: true }).problem, true)
  // …and a certificate carrying no wildcard name is simply not affected by it.
  assert.equal(outlook(v(wildBlocked), { leafHasWildcard: false }).state, 'permitted')
  // Reading issuewild as an ADDITION to issue would make this permitted.
  assert.equal(
    outlook(v(['0 issue "letsencrypt.org"', '0 issuewild "digicert.com"']), { leafHasWildcard: true }).state,
    'refused-wildcard',
  )

  // Self-signed: no CA issued it, so CAA has nothing to say about it.
  assert.equal(outlook(v(['0 issue "letsencrypt.org"']), { selfSigned: true }).state, 'self-signed')
  assert.equal(outlook(v(['0 issue "letsencrypt.org"']), { selfSigned: true }).problem, false)

  // An unidentifiable issuer draws no verdict — and says so rather than nothing.
  const mystery = outlook(v(['0 issue "letsencrypt.org"']), { issuer: { issuerO: 'Acme Local CA', issuerCN: 'ca-1' } })
  assert.equal(mystery.state, 'issuer-unknown')
  assert.equal(mystery.problem, false)
  assert.ok(mystery.detail.includes('Acme Local CA'), 'the unidentified issuer is quoted back')

  /* ── 6. The two issuer-INDEPENDENT conclusions survive an unknown issuer. ──

     This is the precedence rule, and it is the one an "obvious" implementation
     gets wrong: check the issuer first, bail out to issuer-unknown, and the tool
     goes quiet on exactly the zones where a renewal is already failing for
     everybody. A critical tag nobody understands and `issue ";"` hold whoever
     the CA is, so they are reported whoever the CA is. */
  const stranger = { issuer: { issuerO: 'Acme Local CA', issuerCN: 'ca-1' } }
  for (const [lines, state] of [
    [['128 weirdtag "x"', '0 issue "letsencrypt.org"'], 'blocked-critical'],
    [['0 issue ";"'], 'forbidden-all'],
  ]) {
    assert.equal(outlook(v(lines)).state, state, `${state} with a known issuer`)
    assert.equal(outlook(v(lines), stranger).state, state,
      `${state} must still be reported when the issuer cannot be identified — it does not depend on the issuer`)
    assert.equal(outlook(v(lines)).problem, true, `${state} is something the owner must act on`)
    assert.ok(outlook(v(lines)).evidence.length > 0, `${state} must cite the records it rests on`)
  }
  // Both also outrank self-signed, for the same reason: they are facts about the
  // zone, and a self-signed certificate does not make a broken policy fine.
  assert.equal(outlook(v(['0 issue ";"']), { selfSigned: true }).state, 'forbidden-all')

  // An unknown tag WITHOUT the critical bit blocks nobody.
  assert.equal(outlook(v(['0 weirdtag "x"', '0 issue "letsencrypt.org"'])).state, 'permitted')

  // An inconclusive walk outranks everything: there is nothing to reason from.
  const unavailable = outlook(caa.caaVerdict([], null, true))
  assert.equal(unavailable.state, 'unavailable')
  assert.equal(unavailable.problem, false, 'a failed lookup is not a finding about somebody else\'s zone')
  assert.deepEqual(unavailable.evidence, [])
  assert.equal(/any CA may issue/i.test(unavailable.detail), false,
    'the inconclusive message must not contain the sentence the absent-policy message exists to say')

  /* ── 6b. A failed lookup BELOW a found policy leaves the answer open. ─────

     `sub.example.com` did not answer and `example.com` publishes a policy. A CA
     checks the exact name first and stops at the first name with any CAA set,
     so if sub.example.com holds one, THAT governs and example.com's is
     irrelevant — and nobody knows whether it does. The walk used to return the
     parent's policy with no flag, and every sentence built on it (who may
     issue, "CAA blocks your CA", "may renew this") was a confident answer to a
     question nobody got answered. */
  const caaAt = (fail = {}, zone = { 'example.com': ['0 issue "letsencrypt.org"'] }) => async (name, type) => {
    if (fail[name]) return { resolver: 'fixture', type, name, records: [], elapsedMs: 0, ...fail[name] }
    const data = zone[name] ?? []
    return { resolver: 'fixture', type, name, rcode: 'NOERROR', records: data.map(d => ({ type: 257, name, data: d, ttl: 60 })), elapsedMs: 0 }
  }
  const digicert = { issuer: { issuerO: 'DigiCert Inc', issuerCN: 'DigiCert TLS RSA SHA256 2020 CA1' } }
  for (const [why, failure] of [
    ['SERVFAIL', { rcode: 'SERVFAIL' }],
    ['a timeout', { rcode: 'ERROR', error: 'no answer within 4000ms' }],
    ['the query budget', { rcode: 'ERROR', error: 'query budget exhausted' }],
    ['the deadline', { rcode: 'ERROR', error: 'inspection deadline reached' }],
  ]) {
    const walk = await sgc.sgAnalyzeCaa('sub.example.com', caaAt({ 'sub.example.com': failure }))
    assert.equal(walk.foundAt, 'example.com', `(${why}) the walk still reaches the parent's policy`)
    assert.equal(walk.incomplete, true, `(${why}) a failed lookup below the stop point makes the answer incomplete`)
    const verdict = sgc.sgCaaVerdict(walk)
    assert.equal(verdict.incomplete, true, `(${why}) and the verdict carries it rather than dropping it because a policy was found`)
    const found = sgc.sgCaaFindings(verdict, 'sub.example.com', 'digicert.com')
    assert.deepEqual(found.map(f => f.id), ['caa-inconclusive'],
      `(${why}) no caa-policy and no caa-blocks-ca off a policy that may not be the one that governs`)
    assert.ok(/take precedence/.test(found[0].detail) && found[0].detail.includes('example.com'), 'it names the policy it found and why that is not the answer')
    assert.equal(found[0].basis, 'record')
    assert.deepEqual(found[0].evidence, ['example.com  0 issue "letsencrypt.org"'], 'and cites the records it found, literally')
    for (const [issuer, label] of [[{}, "Let's Encrypt, whom the parent permits"], [digicert, 'DigiCert, whom the parent forbids']]) {
      const o = outlook(verdict, issuer)
      assert.equal(o.state, 'unavailable', `(${why}) ${label}: neither "may renew" nor "refused" — the governing policy is unknown`)
      assert.equal(o.problem, false)
      assert.equal(o.policyAt, null, 'the facts row must not present the parent as the policy that governs')
      assert.deepEqual(o.evidence, [])
      assert.ok(o.detail.includes('example.com') && /take precedence/.test(o.detail))
      assert.equal(/any CA may issue/i.test(o.detail), false)
    }
  }
  // NXDOMAIN at the full name IS an answer — the name holds nothing, so it holds
  // no CAA — and the parent's policy governs, completely.
  const nxBelow = await sgc.sgAnalyzeCaa('sub.example.com', caaAt({ 'sub.example.com': { rcode: 'NXDOMAIN' } }))
  assert.equal(nxBelow.foundAt, 'example.com')
  assert.equal(nxBelow.incomplete, false, 'NXDOMAIN below the policy is an answer, not a failure')
  const nxVerdict = sgc.sgCaaVerdict(nxBelow)
  assert.deepEqual(sgc.sgCaaFindings(nxVerdict, 'sub.example.com', null).map(f => f.id), ['caa-policy'])
  assert.equal(outlook(nxVerdict).state, 'permitted')
  assert.equal(outlook(nxVerdict, digicert).state, 'refused')
  // …and so is the ordinary case, an empty NOERROR on the way up.
  assert.equal((await sgc.sgAnalyzeCaa('sub.example.com', caaAt())).incomplete, false)
  // A failure ABOVE the stop point cannot matter, and the walk never asks it.
  const above = await sgc.sgAnalyzeCaa('a.b.example.com',
    caaAt({ 'example.com': { rcode: 'SERVFAIL' } }, { 'b.example.com': ['0 issue "letsencrypt.org"'] }))
  assert.deepEqual(above.walked, ['a.b.example.com', 'b.example.com'], 'the walk stops at the first name with a policy')
  assert.equal(above.incomplete, false, 'nothing above the stop point can change the answer')

  /* ── 6c. An empty issuer authorises nobody, whatever follows the `;`. ────

     RFC 8659 §4.2: the issuer-domain-name is optional, and an `issue` value
     without one grants no issuance. Parameters may still follow the semicolon,
     so `"; accounturi=…"` is `";"` with extra words — and testing the whole
     value against `";"` read it as an allowed CA called "", which no CA ever
     matches: every renewal refused while `forbidsAll` said false. */
  const paramsOnly = v(['0 issue "; accounturi=https://acme.example/acct/1"'])
  assert.equal(paramsOnly.forbidsAll, true, 'an empty issuer-domain-name forbids issuance, parameters or not')
  assert.deepEqual(paramsOnly.allowed, [], 'and is not a permitted CA with an empty name')
  assert.equal(caa.caaAllows(paramsOnly, 'letsencrypt.org', false), false)
  assert.equal(outlook(paramsOnly).state, 'forbidden-all')
  assert.equal(v(['0 issue "letsencrypt.org"', '0 issuewild " ; validationmethods=dns-01"']).forbidsAllWild, true,
    'the same rule for issuewild, whitespace and all')
  assert.deepEqual(v(['0 issue "LetsEncrypt.org; validationmethods=dns-01"']).allowed, ['letsencrypt.org'],
    'a named issuer keeps its name and drops its parameters')
  const mixed = v(['0 issue ";"', '0 issue "letsencrypt.org"'])
  assert.equal(mixed.forbidsAll, false, 'one empty issue entry beside a named one forbids nobody the named one permits')
  assert.equal(caa.caaAllows(mixed, 'letsencrypt.org', false), true)
  assert.equal(caa.caaAllows(mixed, 'digicert.com', false), false)

  // Every state the type declares is reachable from a fixture above, so a state
  // added later without one fails here rather than shipping unexercised.
  const declaredStates = [...(await readFile(new URL('../src/lib/caa.ts', import.meta.url), 'utf-8'))
    .matchAll(/^\s+\| '([a-z-]+)'$/gm)].map(m => m[1])
  const reached = new Set([
    'no-policy', 'permitted', 'refused', 'refused-wildcard',
    'forbidden-all', 'blocked-critical', 'issuer-unknown', 'self-signed', 'unavailable',
  ])
  for (const st of declaredStates) {
    assert.ok(reached.has(st), `the outlook state "${st}" has no fixture in this block`)
  }
  assert.ok(declaredStates.length >= 8, `expected the states to be discoverable in the source (found ${declaredStates.length})`)
  // Every fixture above produced a headline and a detail — an empty one renders
  // a blank panel, which reads as a layout bug rather than as a missing claim.
  for (const o of [noPolicy, permitted, refused, mystery, unavailable]) {
    assert.ok(o.headline.trim() && o.detail.trim(), `${o.state} needs both a headline and a detail`)
  }

  /* ── 7. The narrow scope is cheaper than the allowance it was given. ─────

     `scope=caa` exists so Chainsaw can ask one question without paying for a
     24-query resolver diff, and it gets its OWN rate-limit buckets — otherwise a
     Chainsaw visitor's cheap questions would lock them out of DNS Sightline. A
     separate, more generous limiter is only defensible if the thing being bounded
     — outbound DoH queries per minute — still comes out lower. Held as an
     inequality over the four numbers rather than as a comment, so raising any one
     of them fails here. */
  const routeSrc2 = await readFile(new URL('../src/pages/api/tools/dns-sightline.ts', import.meta.url), 'utf-8')
  const limiters = Object.fromEntries(
    [...routeSrc2.matchAll(/const (allow\w+) = createRateLimiter\((\d[\d_]*), (\d+)\)/g)]
      .map(m => [m[1], { window: Number(m[2].replace(/_/g, '')), cap: Number(m[3]) }]),
  )
  for (const name of ['allowClient', 'allowGlobal', 'allowCaaClient', 'allowCaaGlobal']) {
    assert.ok(limiters[name], `${name} is not declared in the route the way this assertion reads it`)
    assert.equal(limiters[name].window, 60_000, `${name} must be a per-minute bucket for the comparison below to mean anything`)
  }
  assert.ok(insp.SG_CAA_SCOPE_QUERIES > 0 && insp.SG_CAA_SCOPE_QUERIES < SG_MAX_QUERIES,
    'the narrow scope must have a smaller query budget than the full one, or it is not a narrow scope')
  assert.ok(
    limiters.allowCaaClient.cap * insp.SG_CAA_SCOPE_QUERIES <= limiters.allowClient.cap * SG_MAX_QUERIES,
    `the CAA scope allows ${limiters.allowCaaClient.cap * insp.SG_CAA_SCOPE_QUERIES} outbound queries per client per minute against the full scope's ${limiters.allowClient.cap * SG_MAX_QUERIES} — its looser limit is no longer paid for by its smaller budget`,
  )
  assert.ok(
    limiters.allowCaaGlobal.cap * insp.SG_CAA_SCOPE_QUERIES <= limiters.allowGlobal.cap * SG_MAX_QUERIES,
    'the same inequality must hold for the shared global bucket, which is what bounds the instance',
  )
  // The scope is a closed choice. An unrecognised value must be refused, not
  // quietly treated as the expensive default.
  assert.ok(/scopeParam !== 'full' && scopeParam !== 'caa'/.test(routeSrc2),
    'the scope parameter must be matched against a closed set, never used as given')
  assert.ok(/unknown scope/.test(routeSrc2), 'an unknown scope is refused with a 400, not defaulted')
  // …and the cheap path must actually take the cheap budget: `sgInspectCaa`
  // defaults to SG_CAA_SCOPE_QUERIES rather than to the full allowance.
  const inspSrc2 = await readFile(new URL('../src/components/tools/dns-sightline/inspect.ts', import.meta.url), 'utf-8')
  assert.ok(/opts\.budget \?\? sgNewBudget\(SG_CAA_SCOPE_QUERIES\)/.test(inspSrc2),
    'the CAA-only inspection must default to its own budget, not to SG_MAX_QUERIES')

  /* ── 8. The two tools now link to each other, and to the same question. ── */

  assert.ok(/scope=caa&name=\$\{encodeURIComponent\(report\.host\)\}/.test(chainsawSrc),
    'Chainsaw asks the narrow scope, not the full inspection')
  assert.ok(/\/tools\/dns-sightline\?name=\$\{encodeURIComponent\(report\.host\)\}/.test(chainsawSrc),
    'the Chainsaw cross-link carries the host across')
  assert.ok(/ca=\$\{encodeURIComponent\(outlook\.ca\.caId\)\}/.test(chainsawSrc),
    "…and hands the identified CA to DNS Sightline's own renewal picker, which is the handoff neither tool could make alone")
  const sightlineSrc = await readFile(new URL('../src/components/tools/dns-sightline/DnsSightline.ts', import.meta.url), 'utf-8')
  assert.ok(/\/tools\/chainsaw\?host=\$\{encodeURIComponent\(r\.name\)\}/.test(sightlineSrc),
    'the DNS Sightline cross-link carries the name to Chainsaw')

  // The panel's prose is added to ESCAPED text, never to raw text: `csTicks`
  // escapes first and only then introduces <code>, so by the time the regex runs
  // every `<` the sentence contained is already `&lt;`. Order is the whole
  // control, and it is one line, so it is asserted rather than trusted.
  assert.ok(/function csTicks\(text: string\): string \{\s*return csEsc\(text\)\.replace\(/.test(chainsawSrc),
    'csTicks must escape before it adds markup')
  // An IP has no CAA policy and no parent to inherit one from, so Chainsaw must
  // not spend a query to be told nothing.
  assert.ok(/if \(csCanonicalIp\(report\.host\)\)/.test(chainsawSrc),
    'an address-dialled host skips the CAA lookup entirely')
  // A failed CAA lookup must cost the panel and nothing else: the certificate
  // report above is already rendered by the time this fetch is made.
  assert.ok(/void this\.loadCaa\(report, match\)/.test(chainsawSrc),
    'the CAA lookup is fired after the certificate report is rendered, not before it')
  assert.ok(/this\.caaInflight\?\.abort\(\)/.test(chainsawSrc),
    'the CAA fetch is aborted on unmount and on a new inspection — ClientRouter keeps the document')
}
console.log('caa x issuer: one issue/issuewild rule shared by both tools, an unrecognised issuer draws no verdict, a failed lookup is neither an absent policy nor licence to trust the one found above it, an empty issuer forbids all, the issuer-independent refusals survive an unknown CA, and the narrow scope\'s looser rate limit is paid for by its smaller query budget')

/* ─────  the boot check boots what the image runs, and the shell cannot pass it  ─────
   `npm run boot:check` exists because build and check were both green on a
   server that crashed on its first line (AGENTS.md → Build / Test / Run). Two
   things make it meaningful and both read like details. It must start the SAME
   entry point the Dockerfile's CMD starts, so that path is derived from the
   Dockerfile rather than trusted to agree. And it must scrub
   ASTRO_NODE_LOGGING from the child's env: the crash lived in the adapter's
   startup-logging branch, which that variable switches off, so a check that
   inherited it from the caller's shell passed on the broken build — measured,
   not assumed, by deleting the scrub and running it against 11.1.0.
   ──────────────────────────────────────────────────────────────────────────── */
{
  const bootSrc = await readFile(new URL('./boot-check.mjs', import.meta.url), 'utf-8')
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf-8')
  const cmd = /^CMD \["node", "([^"]+)"\]$/m.exec(dockerfile)
  assert.ok(cmd, 'the Dockerfile CMD is `node <entry>` — the boot check derives its entry point from it')
  assert.ok(bootSrc.includes(`new URL('../${cmd[1]}', import.meta.url)`),
    `the boot check must start ${cmd[1]}, the file the image's CMD runs`)
  assert.ok(/spawn\(process\.execPath, \[entry\]/.test(bootSrc), 'the boot check runs the entry under node itself')
  assert.ok(/^delete env\.ASTRO_NODE_LOGGING$/m.test(bootSrc),
    'the boot check must scrub ASTRO_NODE_LOGGING — inherited, it disables the branch that crashed')
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf-8'))
  assert.equal(pkg.scripts['boot:check'], 'node scripts/boot-check.mjs', 'npm run boot:check is the documented entry')
}
console.log('boot check: starts the entry the Dockerfile runs, and no inherited env var can switch off the branch that crashed')

/* ─────  PR 19 review: who pays for a refusal, and how long one request may hold a socket  ─────

   Three bounds that each existed somewhere and were missing somewhere else,
   which is the shape every one of them had in the review: a rule one tool
   followed and its sibling did not.

     1. A per-client bucket must be consulted BEFORE the shared one, and the
        shared one only when the client was allowed. `createRateLimiter`
        counts a hit even when it refuses, so a route that asks both buckets
        unconditionally lets one client who is already over its own limit keep
        spending everybody's allowance. DNS Sightline did; Link Peek and
        Chainsaw did not.
     2. DNS Sightline had a per-question timeout and no deadline, and its SPF
        walk asks one question after another — forty of them at four seconds
        each is close to three minutes of one held socket.
     3. Link Peek raced its name lookup against a timer; Chainsaw awaited the
        same call bare. The bound now has one home both of them import.
   ──────────────────────────────────────────────────────────────────────────── */
{
  /* ── 1. A refused client does not spend the shared bucket. ────────────────

     Derived from every API route, not listed: a limiter called with a string
     literal is one bucket for everybody, anything else is keyed per client,
     and every call to a shared bucket must be the right-hand side of a
     short-circuit whose left-hand side is a per-client bucket that ALLOWED the
     request — `client(k) && shared('g')`, or `!client(k) || !shared('g')`. */
  const callOf = name => new RegExp(`\\b${name}\\(((?:[^()]|\\([^()]*\\))*)\\)`, 'g')
  const pairedRoutes = []
  for (const route of await apiRouteFiles()) {
    const code = (await readFile(new URL(`../${route}`, import.meta.url), 'utf-8'))
      .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
    const limiters = [...code.matchAll(/const (\w+) = createRateLimiter\(/g)].map(m => m[1])
    const calls = limiters.flatMap(name => [...code.matchAll(callOf(name))].map(m => ({ name, arg: m[1].trim(), at: m.index })))
    const shared = c => /^(['"`])[^'"`]*\1$/.test(c.arg)
    const sharedCalls = calls.filter(shared)
    if (!sharedCalls.length) continue
    pairedRoutes.push(route)
    const clientNames = [...new Set(calls.filter(c => !shared(c)).map(c => c.name))]
    assert.ok(clientNames.length, `${route} has a shared rate-limit bucket with no per-client bucket in front of it — one client can drain it for everybody`)
    const clientCall = `(?:${clientNames.join('|')})\\((?:[^()]|\\([^()]*\\))*\\)`
    for (const g of sharedCalls) {
      const before = code.slice(0, g.at)
      const andForm = new RegExp(`(?<![!\\w])${clientCall}\\s*&&\\s*$`).test(before)
      const notOrForm = new RegExp(`!\\s*${clientCall}\\s*\\|\\|\\s*!\\s*$`).test(before)
      assert.ok(andForm || notOrForm,
        `${route}: ${g.name}(${g.arg}) must run only once a per-client bucket has allowed the request — createRateLimiter counts refused hits, so asking it unconditionally lets one refused client drain the shared bucket`)
    }
  }
  assert.ok(pairedRoutes.length >= 3, `expected to discover the routes that pair a client and a shared bucket (found ${pairedRoutes.join(', ')})`)
  assert.ok(pairedRoutes.includes('src/pages/api/tools/dns-sightline.ts'), 'DNS Sightline is one of them')

  /* …and the same thing as behaviour, on the route that got it wrong. One
     address floods; a different visitor must still get in. The outbound side
     is stubbed to fail at once, so the few requests that ARE allowed cost
     nothing and touch no network. */
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new TypeError('offline in the smoke suite') }
  try {
    const { GET } = await import('../src/pages/api/tools/dns-sightline.ts')
    const ask = ip => GET({ request: new Request('http://localhost/api/tools/dns-sightline?name=example.com', { headers: { 'cf-connecting-ip': ip } }) })
    const flood = []
    for (let i = 0; i < 20; i += 1) flood.push((await ask('203.0.113.7')).status)
    assert.equal(flood.filter(s => s === 429).length, 16, 'one client past its own four requests a minute is refused')
    const bystander = await ask('198.51.100.9')
    assert.notEqual(bystander.status, 429,
      'a flood from one address that was already being refused must not lock a different visitor out — the refused hits were spending the shared bucket')
    const failing = await bystander.json()
    assert.equal(failing.ok, true, 'the bystander gets a report, whose failed lookups say so inside it')
  } finally {
    globalThis.fetch = realFetch
  }

  /* ── 2. The inspection has a deadline, and reaching it is not an answer. ──

     A resolver that accepts the connection and never says a word, which is
     what a black-holed endpoint looks like from here. Every resolver is pointed
     at it by stubbing `fetch` itself — sgInspect takes no endpoint override,
     and that is asserted in the DNS Sightline block — so the real transport,
     its real per-question timeout and the real abort path are what run. The
     per-question timeout is left at its default on purpose: it is FOUR
     SECONDS, so a pass here can only come from the deadline. */
  const insp = await import('../src/components/tools/dns-sightline/inspect.ts')
  const doh = await import('../src/lib/dns-doh.ts')
  const { SG_TYPES } = await import('../src/components/tools/dns-sightline/analyze.ts')
  const { createServer } = await import('node:http')
  const silent = createServer(() => { /* never answers */ })
  await new Promise(resolve => silent.listen(0, '127.0.0.1', resolve))
  const silentBase = `http://127.0.0.1:${silent.address().port}/dns-query`
  globalThis.fetch = (url, init) => realFetch(`${silentBase}${new URL(url).search}`, init)
  const DEADLINE = 300
  const SLACK = 2_000
  try {
    let t0 = Date.now()
    const full = await insp.sgInspect('deadline.example.com', { deadlineMs: DEADLINE })
    const took = Date.now() - t0
    assert.ok(took < DEADLINE + SLACK, `one inspection held its request for ${took}ms against a ${DEADLINE}ms deadline`)
    assert.equal(full.deadlineHit, true, 'the report says it stopped at the deadline')
    assert.ok(full.queries <= doh.SG_CONCURRENCY,
      `only the questions already in flight when the deadline arrived may be charged (spent ${full.queries}) — one asked afterwards would still go out and sit through its own timeout`)
    const ids = full.findings.map(f => f.id)
    for (const id of ['resolvers-unreachable', 'spf-inconclusive', 'dmarc-inconclusive', 'mx-inconclusive', 'caa-inconclusive']) {
      assert.ok(ids.includes(id), `a deadline-cut inspection reports ${id} (got ${ids.join(', ')})`)
    }
    for (const id of ['spf-missing', 'dmarc-missing', 'mx-none', 'caa-none']) {
      assert.equal(ids.includes(id), false, `${id} is a claim about the zone, and a deadline is not evidence for it`)
    }
    assert.equal(full.spf.truncated, true)
    assert.equal(full.caa.incomplete, true)

    t0 = Date.now()
    const narrow = await insp.sgInspectCaa('deadline.example.com', { deadlineMs: DEADLINE })
    assert.ok(Date.now() - t0 < DEADLINE + SLACK, 'the CAA-only scope has the same deadline')
    assert.equal(narrow.deadlineHit, true)
    assert.equal(narrow.caa.incomplete, true)
    assert.deepEqual(narrow.findings.map(f => f.id), ['caa-inconclusive'])
  } finally {
    globalThis.fetch = realFetch
    silent.closeAllConnections?.()
    await new Promise(resolve => silent.close(resolve))
  }
  // The default has to leave the diff its own worst case, or a slow-but-working
  // set of resolvers could never finish even the first half of an inspection —
  // and stay small enough to be a bound on a held socket at all.
  const diffWorstCase = Math.ceil((SG_TYPES.length * doh.SG_RESOLVERS.length) / doh.SG_CONCURRENCY) * doh.SG_TIMEOUT_MS
  assert.ok(doh.SG_INSPECT_DEADLINE_MS > diffWorstCase,
    `the deadline (${doh.SG_INSPECT_DEADLINE_MS}ms) must exceed the diff's own worst case (${diffWorstCase}ms)`)
  assert.ok(doh.SG_INSPECT_DEADLINE_MS <= 20_000, 'and stay a bound on how long one request may hold a socket')
  const dnsRouteSrc = await readFile(new URL('../src/pages/api/tools/dns-sightline.ts', import.meta.url), 'utf-8')
  assert.equal(/deadlineMs/.test(dnsRouteSrc), false, 'the deadline is injectable for this block alone — the route never sets it')

  /* ── 3. One bounded name lookup, and both dialers use it. ─────────────────

     Each call is raced against this block's own timer as well, so a mutation
     that removes the bound FAILS here with a named error instead of hanging
     the suite — a test that hangs is a test whose timeout gets raised. */
  const { DNS_LOOKUP_TIMEOUT_MS } = await import('../src/lib/dns-lookup.ts')
  const { lpCheckResolved } = await import('../src/lib/link-peek-fetch.ts')
  const { CS_TIMEOUT_MS } = await import('../src/lib/tls-inspect.ts')
  const HUNG = Symbol('hung')
  const within = (p, ms) => Promise.race([p, new Promise(resolve => setTimeout(() => resolve(HUNG), ms))])
  const neverAnswers = () => new Promise(() => {})
  const pinned = await within(csResolvePinned('black-hole.example', { resolve: neverAnswers, timeoutMs: 100 }), 2_000)
  assert.notEqual(pinned, HUNG, 'csResolvePinned must stop waiting on a lookup that never answers — it runs before any handshake deadline applies')
  assert.equal(pinned.ok, false)
  assert.ok(/did not resolve within/.test(pinned.reason), `…and say it got no answer, not that the name does not exist (${pinned.reason})`)
  const peeked = await within(lpCheckResolved('black-hole.example', { resolve: neverAnswers, timeoutMs: 100 }), 2_000)
  assert.notEqual(peeked, HUNG, 'Link Peek has the same bound through the same helper')
  assert.equal(peeked.ok, false)
  const enotfound = async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }) }
  assert.ok(/does not resolve\.$/.test((await csResolvePinned('gone.example', { resolve: enotfound })).reason), 'a real NXDOMAIN still reads as one')
  // The answers still go through the ONE classifier, seam or no seam.
  assert.equal((await csResolvePinned('rebind.example', { resolve: async () => [{ address: '10.0.0.1', family: 4 }] })).ok, false)
  assert.equal((await lpCheckResolved('rebind.example', { resolve: async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }] })).ok, false)
  assert.ok(DNS_LOOKUP_TIMEOUT_MS > 0 && DNS_LOOKUP_TIMEOUT_MS < CS_TIMEOUT_MS, 'the lookup bound leaves the handshakes most of their budget')
  for (const [file, production] of [
    ['../src/lib/tls-inspect.ts', /const pinned = await csResolvePinned\(host\)/],
    ['../src/lib/link-peek-fetch.ts', /const resolved = await lpCheckResolved\(checked\.url\.hostname\)/],
  ]) {
    const src = await readFile(new URL(file, import.meta.url), 'utf-8')
    assert.ok(src.includes("from './dns-lookup'"), `${file} takes its lookup from the shared bounded helper`)
    assert.equal(/from 'node:dns/.test(src), false, `${file} must not call dns.lookup itself — the bound lives in one place`)
    assert.ok(production.test(src), `${file}: the production caller passes no test seam`)
  }
}
console.log('pr 19 review: a refused client never spends the shared bucket (derived over every route), one inspection stops at its deadline without claiming absence, and both dialers share one bounded name lookup')

/* ─────  PR 19 review: what a page leaves behind, and what a keyboard can reach  ─────

   ClientRouter keeps one document for the whole session on the lanes that use
   it, so anything registered against `document` or `window` per mount outlives
   the page that registered it. Two such leaks were in the review, and both were
   invisible in every screenshot: the canvas export bar added an
   `astro:before-swap` listener on every attach and never removed it, and the
   embed chrome observer only disconnected on a hit that one figure never
   produces. The third item is the keyboard: a table that scrolls sideways is
   reachable only if its wrapper can take focus. */
{
  /* ── 1. No document or window listener outlives what added it. ────────────

     Derived from every .ts file under src/components and src/lib, not listed:
     each `document|window.addEventListener` must be removed with the SAME
     handler in the same file, be bound by a `signal` or `once`, or sit behind a
     module-level once-guard (`if (flag) return` … `flag = true`, with
     `let flag = false` at module scope) — the singleton shape nav-ui,
     analytics-client and the daily-streak strip already use. Whole comment
     lines are dropped first, so a docblock quoting a call is not a call. */
  const clientTs = []
  const walkTs = async dir => {
    for (const entry of await readdir(new URL(`${dir}/`, import.meta.url), { withFileTypes: true })) {
      const child = `${dir}/${entry.name}`
      if (entry.isDirectory()) await walkTs(child)
      else if (entry.name.endsWith('.ts')) clientTs.push(child)
    }
  }
  await walkTs('../src/components')
  await walkTs('../src/lib')
  const scanArgs = (code, from) => {
    let depth = 0
    let quote = null
    for (let i = from; i < code.length; i += 1) {
      const c = code[i]
      if (quote) { if (c === '\\') i += 1; else if (c === quote) quote = null; continue }
      if (c === "'" || c === '"' || c === '`') { quote = c; continue }
      if ('([{'.includes(c)) depth += 1
      else if (')]}'.includes(c)) { if (depth === 0) return code.slice(from, i); depth -= 1 }
    }
    return code.slice(from)
  }
  const splitFirstArg = text => {
    let depth = 0
    let quote = null
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i]
      if (quote) { if (c === '\\') i += 1; else if (c === quote) quote = null; continue }
      if (c === "'" || c === '"' || c === '`') { quote = c; continue }
      if ('([{'.includes(c)) depth += 1
      else if (')]}'.includes(c)) depth -= 1
      else if (c === ',' && depth === 0) return [text.slice(0, i), text.slice(i + 1)]
    }
    return [text, '']
  }
  const unbounded = []
  let listenerSites = 0
  for (const file of clientTs) {
    const code = (await readFile(new URL(file, import.meta.url), 'utf-8'))
      .split('\n').filter(line => !/^\s*(\/\/|\/\*|\*)/.test(line)).join('\n')
    for (const m of code.matchAll(/\b(document|window)\.addEventListener\(\s*(['"])([^'"]+)\2\s*,/g)) {
      listenerSites += 1
      const [target, , event] = [m[1], m[2], m[3]]
      const [handlerRaw, options] = splitFirstArg(scanArgs(code, m.index + m[0].length))
      const handler = handlerRaw.trim()
      if (/\bsignal\b|\bonce\s*:\s*true/.test(options)) continue
      const escaped = handler.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`\\b${target}\\.removeEventListener\\(\\s*['"]${event}['"]\\s*,\\s*${escaped}\\s*[,)]`).test(code)) continue
      const before = code.slice(0, m.index)
      const guard = [...before.matchAll(/\bif \((\w+)\) return\b/g)].pop()
      if (guard) {
        const since = before.slice(guard.index)
        if (new RegExp(`^let ${guard[1]} = false\\b`, 'm').test(code)
          && new RegExp(`\\b${guard[1]} = true\\b`).test(since)
          && !/\n\}/.test(since)) continue
      }
      unbounded.push(`${file.replace('../', '')}: ${target}.addEventListener('${event}', ${handler.slice(0, 48)})`)
    }
  }
  assert.ok(listenerSites >= 20, `expected to discover the document/window listeners (found ${listenerSites}) — has the tree moved?`)
  assert.deepEqual(unbounded, [],
    'a document/window listener added per mount must be removed with the same handler, be signal/once-bound, or be registered once behind a module-level guard — otherwise every in-site navigation leaves one more behind, holding whatever its closure reached')
  // The export bar specifically: nothing registered per attach.
  const cxSrc = await readFile(new URL('../src/lib/canvas-export.ts', import.meta.url), 'utf-8')
  const attachBody = cxSrc.slice(cxSrc.indexOf('export function attachCanvasExport'))
  assert.equal(/\b(document|window)\.addEventListener\(/.test(attachBody), false,
    'attachCanvasExport registers no document listener of its own — the shared pair in trackBar serves every bar')
  assert.ok(/trackBar\(bar, clearPending\)/.test(attachBody), '…and every bar joins that registry, or its preview is never revoked on a swap')

  /* ── 2. The chrome observer is bounded for every embed. ───────────────────

     `EMBED_NO_CHROME` is a claim about what components render, so it is held to
     the components' sources in BOTH directions: a figure that writes no h1 and
     no *-header must be listed (or its observer never disconnects), and one that
     does must not be (or its h1 survives into the article). The dispatch in
     game-mount.ts says which directory each slug renders from. */
  const { EMBED_NO_CHROME } = await import('../src/lib/embeds.ts')
  const mountSrc = await readFile(new URL('../src/lib/game-mount.ts', import.meta.url), 'utf-8')
  const dispatch = [...mountSrc.matchAll(/slug === '([^']+)'\) return import\('\.\.\/components\/games\/([^/']+)\//g)]
  assert.equal(dispatch.length, Object.keys(EMBED_TAGS).length, 'every embed has exactly one dispatch branch to read its source from')
  const chromeMarker = /<h1[\s>]|['"]h1['"]|data-type="[a-z0-9-]+-header"|'data-type': '[a-z0-9-]+-header'/
  for (const [, slug, dir] of dispatch) {
    const sources = []
    const collect = async d => {
      for (const entry of await readdir(new URL(`${d}/`, import.meta.url), { withFileTypes: true })) {
        if (entry.isDirectory()) await collect(`${d}/${entry.name}`)
        else if (entry.name.endsWith('.ts')) sources.push(await readFile(new URL(`${d}/${entry.name}`, import.meta.url), 'utf-8'))
      }
    }
    await collect(`../src/components/games/${dir}`)
    const writesChrome = sources.some(src => chromeMarker.test(src))
    assert.equal(EMBED_NO_CHROME.has(slug), !writesChrome, writesChrome
      ? `${slug} writes its own title block, so EMBED_NO_CHROME must not list it — its h1 would survive into the article`
      : `${slug} writes no h1 and no *-header, so its chrome observer would never get a hit — list it in EMBED_NO_CHROME`)
  }
  assert.ok(EMBED_NO_CHROME.has('diagram-atlas'), 'the figure the review found is one of them')
  const stripBody = mountSrc.slice(mountSrc.indexOf('export function stripEmbedChrome'), mountSrc.indexOf('export function mountEmbed'))
  const at = needle => stripBody.indexOf(needle)
  assert.ok(at('new MutationObserver(') !== -1, 'still an observer, not a timed sweep — cold and warm module caches land the markup on opposite sides of page-load')
  assert.ok(at('if (handled.has(container)) return') !== -1 && at('if (handled.has(container)) return') < at('new MutationObserver('),
    'one observer per container: both routes mount twice on a cold load, and the second observer would never see a hit')
  assert.ok(at('EMBED_NO_CHROME.has(slug)) return') !== -1 && at('EMBED_NO_CHROME.has(slug)) return') < at('new MutationObserver('),
    'a figure that writes no chrome gets no observer at all')
  assert.ok(/addEventListener\('astro:before-swap', \(\) => \{\s*for \(const waiter of \[\.\.\.waiting\]\) waiter\(\)/.test(stripBody),
    'whatever is still waiting is released at the next swap, so no observer outlives its page')
  assert.ok(/waiting\.add\(release\)/.test(stripBody) && /waiting\.delete\(release\)/.test(stripBody),
    'an observer that got its hit leaves the waiting set, so the set is bounded by what is on the page')

  /* ── 3. A table that scrolls sideways can be reached from the keyboard. ───

     A scroll container nobody can focus is unreachable without a pointer. The
     two wrappers the review found are asserted directly — which element a
     tool stylesheet scrolls cannot be mapped onto rendered markup robustly
     from here — and each must be a NAMED region, so the extra tab stop
     announces what it is, and ringed by the site's own :focus-visible rule. */
  for (const [component, sheet, dt] of [
    ['../src/components/tools/dns-sightline/DnsSightline.ts', '../src/components/tools/dns-sightline/dns-sightline.css', 'sg-scroll'],
    ['../src/components/tools/link-peek/LinkPeek.ts', '../src/components/tools/link-peek/link-peek.css', 'lp-tablewrap'],
  ]) {
    const css = await readFile(new URL(sheet, import.meta.url), 'utf-8')
    assert.ok(new RegExp(`\\[data-type="${dt}"\\] \\{\\s*overflow-x: auto;`).test(css), `${dt} is the element that scrolls`)
    assert.equal(/outline:\s*(none|0)\b/.test(css), false, `${sheet} must not switch the focus ring off`)
    const src = await readFile(new URL(component, import.meta.url), 'utf-8')
    const wrappers = [...src.matchAll(new RegExp(`<div data-type="${dt}"([^>]*)>`, 'g'))]
    assert.ok(wrappers.length > 0, `${component} renders ${dt}`)
    for (const w of wrappers) {
      assert.ok(/\btabindex="0"/.test(w[1]), `every ${dt} wrapper takes focus (tabindex="0") — the columns past the edge are otherwise out of a keyboard's reach`)
      assert.ok(/\brole="region"/.test(w[1]) && /\baria-label="[^"]+"/.test(w[1]), `every ${dt} wrapper is a named region, so the tab stop says what it is`)
    }
  }
  const sharedCssSrc = await readFile(new URL('../src/styles/shared.css', import.meta.url), 'utf-8')
  assert.ok(/(^|\n):focus-visible \{\s*outline: 2px solid var\(--color-accent\);/.test(sharedCssSrc),
    'the site-wide ring that shows where keyboard focus went applies to any focusable element, a scroll region included')
}
console.log('pr 19 review: no document/window listener outlives what added it (derived over every client module), the chrome observer is bounded for every embed, and the scrolling tables take keyboard focus')

/* ─────  PR 19 review: the small trust boundaries  ─────

   Each of these is one line wide and sits where text from somebody else's
   server meets this site's output: a Content-Type header that becomes part of
   CSS, a URL off a stranger's certificate that becomes a link, and an
   exception's message that became part of a JSON answer. */
{
  const { lpImageMediaType } = await import('../src/lib/link-peek-fetch.ts')
  const { csLinkableUrl } = await import('../src/components/tools/chainsaw/analyze.ts')

  /* ── 1. The proxied image's media type is allowlisted, not prefix-matched. ──
     It becomes part of a `data:` URI the page drops into CSS `url("…")`. */
  for (const [header, type] of [
    ['image/png', 'image/png'],
    ['IMAGE/PNG; charset=binary', 'image/png'],
    ['image/svg+xml', 'image/svg+xml'],
    ['image/vnd.microsoft.icon', 'image/vnd.microsoft.icon'],
    ['  image/webp  ', 'image/webp'],
  ]) {
    assert.equal(lpImageMediaType(header), type, `${JSON.stringify(header)} is the image type ${type}`)
  }
  for (const hostile of [
    'image/png"); background:url(https://x.test/steal', "image/png'", 'image/png )', 'image/pn g',
    'image/', 'image', 'text/html', 'image/png\u0000', 'image/*', '', null,
  ]) {
    assert.equal(lpImageMediaType(hostile), null, `${JSON.stringify(hostile)} is refused, not relayed`)
  }
  const lpRoute = await readFile(new URL('../src/pages/api/tools/link-peek.ts', import.meta.url), 'utf-8')
  const typeAt = lpRoute.indexOf('const type = lpImageMediaType(fetched.contentType)')
  const uriAt = lpRoute.indexOf('dataUri: `data:${type};base64,')
  assert.ok(typeAt !== -1 && uriAt > typeAt, 'the data URI is built from the allowlisted type and nothing else')

  /* ── 2. A URL off a certificate is a link only when it is plainly http(s). ── */
  assert.equal(csLinkableUrl('http://r11.i.lencr.org/'), 'http://r11.i.lencr.org/', 'AIA is usually plain http, and that is still a link')
  assert.equal(csLinkableUrl('https://pki.goog/repo/certs/gts1c3.der'), 'https://pki.goog/repo/certs/gts1c3.der')
  for (const hostile of [
    'javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x',
    'http://user:pw@ca.example/x', 'http://ca.example/a b', 'http://ca.example/\u0000', 'ldap://ca.example/cn=x',
    'not a url', '',
  ]) {
    assert.equal(csLinkableUrl(hostile), null, `${JSON.stringify(hostile)} stays text`)
  }
  const csComponent = await readFile(new URL('../src/components/tools/chainsaw/Chainsaw.ts', import.meta.url), 'utf-8')
  assert.ok(/<dd>\$\{csIssuerLink\(cert\.caIssuerUrls\[0\]\)\}<\/dd>/.test(csComponent), 'the Issuer URL row goes through csIssuerLink')
  assert.ok(/const href = csLinkableUrl\(raw\)\s*return href\s*\? `<a href="\$\{csEsc\(href\)\}" rel="noopener noreferrer" target="_blank">\$\{csEsc\(raw\)\}<\/a>`\s*: csEsc\(raw\)/.test(csComponent),
    'the link is escaped, opens with no opener and no referrer, and anything csLinkableUrl refuses is escaped text')

  /* ── 3. An exception's message is not an answer. ────────────────────────
     Every failure these routes expect comes back as a fixed sentence; the text
     of one they did not expect — a runtime's wording about this server's own
     connection — is not something to hand a stranger. */
  for (const file of ['../src/pages/api/tools/dns-sightline.ts', '../src/pages/api/tools/chainsaw.ts', '../src/lib/dns-doh.ts']) {
    const code = (await readFile(new URL(file, import.meta.url), 'utf-8')).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/[^\n]*/gm, '')
    assert.equal(/\berr(or)?\??\.message\b/.test(code), false, `${file} must not put an exception's message into a response`)
  }
  const csRoute = await readFile(new URL('../src/pages/api/tools/chainsaw.ts', import.meta.url), 'utf-8')
  assert.ok(/try \{\s*result = await csInspect\([^)]*\)\s*\} catch \{\s*return json\(\{ ok: false, error: '[^']+' \}, 500\)/.test(csRoute),
    'csInspect is wrapped, so a throw answers a fixed JSON error rather than Astro\'s error page')
  assert.ok(/'Cache-Control': 'no-store'/.test(csRoute.slice(csRoute.indexOf('function json('))), '…through the same no-store json() every answer uses')
}
console.log('pr 19 review: an image type is allowlisted before it reaches CSS, a certificate\'s URL is a link only when plainly http(s), and no exception text reaches a response')

/* ─────  PR 19 review: a retired article keeps its readers  ─────

   `/learnings/the-test-that-shared-the-bug` is live on `main`, and the merge
   that retires it would have turned every link to it — shares, bookmarks, the
   search result — into a 404. RETIRED_LEARNINGS answers those with a 301 to the
   hub, and a redirect is not a page: the one publish predicate refuses a retired
   slug, so the sitemap and every listing follow without a second list. */
{
  const { RETIRED_LEARNINGS, retiredLearningTarget } = await import('../src/lib/learnings.ts')

  assert.equal(retiredLearningTarget('the-test-that-shared-the-bug'), '/learnings',
    'the article this merge retires redirects to the hub — its replacement is about a different question')
  assert.equal(retiredLearningTarget('constructor'), null, 'an inherited property is not a retired slug')
  assert.equal(retiredLearningTarget(undefined), null)
  for (const [slug, to] of Object.entries(RETIRED_LEARNINGS)) {
    assert.ok(/^\/learnings(\/[a-z0-9-]+)?$/.test(to), `${slug} redirects to ${to}, which is not a learnings URL`)
    const targetSlug = to.slice('/learnings/'.length)
    assert.ok(to === '/learnings' || learnings.some(l => l.slug === targetSlug && isPublishedLearning(l)),
      `${slug} redirects to ${to}, which this site does not serve`)
    assert.equal(retiredLearningTarget(targetSlug || undefined), null, `${slug} redirects to another retired slug — a chain, not a destination`)
    assert.equal(learnings.some(l => l.slug === slug), false,
      `${slug} is retired AND in the learnings config — its route redirects before the article can render; drop one of the two`)
  }

  // A redirect is not a page, whatever the flags say.
  assert.equal(isPublishedLearning({ slug: 'the-test-that-shared-the-bug', published: true, content: 'a body' }), false,
    'a retired slug is not a page, even saved again as published with a body — the sitemap, hub and cards all read this predicate')
  assert.equal(isPublishedLearning({ slug: 'which-diagram-to-draw', published: true, content: 'a body' }), true,
    'a live slug is unaffected')
  assert.equal(isPublishedLearning({ published: true, content: 'a body' }), true, 'flags without a slug read as they always did')

  // The REAL sitemap route, fed a config that saves an entry under the retired
  // slug again (as an /admin save could). The canary proves the stub config was
  // used at all — getConfig falls back to the bundled config on invalid data,
  // and the bundled config has no retired slug in it, so without the canary
  // this would pass by never reading the fixture.
  const { GET: sitemapRoute } = await import('../src/pages/sitemap.xml.ts')
  const resaved = [
    { slug: 'the-test-that-shared-the-bug', title: 'Back again', summary: 's', date: '2026-09-25', content: 'a body', published: true },
    { slug: 'retirement-canary', title: 'Canary', summary: 's', date: '2026-09-24', content: 'a body', published: true },
  ]
  const stubLocals = { runtime: { env: { SITE_CONFIG: { get: async key => (key === 'learnings' ? resaved : key === 'site' ? site : null) } } } }
  const xml = await (await sitemapRoute({ locals: stubLocals })).text()
  assert.ok(xml.includes('/learnings/retirement-canary'), 'the sitemap read the fixture config (canary present)')
  assert.equal(xml.includes('the-test-that-shared-the-bug'), false, 'a retired slug is never in the sitemap — its URL answers 301')

  // The route answers the redirect FIRST — before config, before the 404 — with
  // the map's own target, and a policy that keeps browsers from pinning it.
  const slugRouteSrc = await readFile(new URL('../src/pages/learnings/[slug].astro', import.meta.url), 'utf-8')
  const frontmatter = slugRouteSrc.slice(0, slugRouteSrc.indexOf('\n---', 4))
  const retiredAt = frontmatter.indexOf('const retiredTo = retiredLearningTarget(slug)')
  assert.ok(retiredAt !== -1, 'the article route consults RETIRED_LEARNINGS')
  assert.ok(retiredAt < frontmatter.indexOf('getLearnings(') && retiredAt < frontmatter.indexOf('status: 404'),
    'the redirect is answered before config is read and before the 404 — a retired slug is not in config, so a later check would never run')
  assert.ok(/if \(retiredTo\) \{\s*return new Response\(null, \{\s*status: 301,\s*headers: \{ Location: retiredTo, 'Cache-Control': 'public, max-age=0, s-maxage=\d+' \},/.test(frontmatter),
    'a permanent redirect to the mapped target, edge-cacheable but not pinned in the browser')
}
console.log('pr 19 review: a retired learning answers 301 to the hub, the publish predicate refuses it so no sitemap can list it, and the /games intro counts its dailies')
