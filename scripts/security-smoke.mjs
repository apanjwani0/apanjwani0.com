import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { render, renderInline } from '../src/lib/markdown.ts'
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
import { isValidBinId } from '../src/lib/webhook-store.ts'
import { gameTag, isPlayableGame } from '../src/lib/games.ts'
import { games } from '../src/config/games.ts'
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

const unsafeMarkdown = render('[x](javascript:alert(1)) <img src=x onerror=alert(1)>')
assert.equal(unsafeMarkdown.includes('javascript:'), false)
assert.equal(unsafeMarkdown.includes('<img src=x'), false)
assert.equal(unsafeMarkdown.includes('&lt;img src=x'), true)

const safeInline = renderInline('hello **world**')
assert.equal(safeInline, 'hello <strong>world</strong>')

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
for (const route of ['src/pages/api/analytics/event.ts', 'src/pages/api/hook/[bin]/requests.ts']) {
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

console.log('security smoke ok')
