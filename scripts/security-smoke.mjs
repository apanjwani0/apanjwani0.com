import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { INTEREST_MAX_COUNT, sanitizeStore } from '../src/lib/interest.ts'
import { render, renderInline, splitOnEmbed } from '../src/lib/markdown.ts'
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
import {
  wiDecodeSecret,
  wiDetectScheme,
  wiDiscoverSignature,
  wiHmac,
  wiVerifyScheme,
} from '../src/components/tools/webhook-inspector/signature.ts'
import { GAME_TAGS, gameTag, isPlayableGame } from '../src/lib/games.ts'
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
import { isPublishedLearning, learningEmbedTag } from '../src/lib/learnings.ts'
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

// {{embed}} placement. No marker means the whole article is `before` — the
// caller then falls back to putting the figure after the prose, never dropping
// it, because a typo in /admin should cost the position and not the simulation.
assert.deepEqual(splitOnEmbed('a\n{{embed}}\nb'), { before: 'a\n', after: '\nb' })
assert.deepEqual(splitOnEmbed('a only'), { before: 'a only', after: '' })
assert.equal(splitOnEmbed('inline {{embed}} text').after, '', 'the marker must be on its own line')

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
// The maze-generation article's numbers are claims about the CODE.
//
// Its title is "There are 192 mazes on a 3×3 grid. The recursive backtracker
// can build 14", and the body adds that the grid ships at 28×17, that the
// shortest corner-to-corner route on it is 44 cells, and that there are three
// builders. None of that is a fact about mazes in general: it falls out of
// MazeWeaver's default column count, its ASPECT constant, its generator list
// and the cell its backtracker starts from. Change any one of those and the
// shipped prose is simply false — while the article still renders, the maze
// still works, and the build still passes. Nothing else looks at both halves.
//
// The two headline counts are RECOMPUTED here from the 3×3 grid graph rather
// than read from the article or from the component, so no assertion below can
// pass by the prose agreeing with itself.
{
  const maze = learnings.find(l => l.slug === 'maze-generation-bias')
  assert.ok(maze, 'the maze-generation article is shipped')
  assert.equal(maze.embed, 'maze-weaver', 'the article argues about the component it embeds')

  // A perfect maze on a 3×3 grid of cells IS a spanning tree of the 3×3 grid
  // graph, so enumerate them: 9 cells, 12 possible walls to knock out, 8 in any
  // tree.
  const EDGES = []
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      const i = r * 3 + c
      if (c < 2) EDGES.push([i, i + 1])
      if (r < 2) EDGES.push([i, i + 3])
    }
  }
  const spanning = []
  for (let mask = 0; mask < 1 << EDGES.length; mask += 1) {
    const chosen = EDGES.filter((_, e) => mask & (1 << e))
    if (chosen.length !== 8) continue
    const parent = Array.from({ length: 9 }, (_, i) => i)
    const find = (x) => {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] }
      return x
    }
    const acyclic = chosen.every(([a, b]) => {
      const ra = find(a), rb = find(b)
      if (ra === rb) return false
      parent[ra] = rb
      return true
    })
    if (acyclic) spanning.push(mask)
  }

  // Tarjan 1972: a spanning tree is a DFS tree exactly when every edge the
  // search declined joins an ancestor to a descendant, never two cousins. That
  // is the article's entire argument for why the backtracker cannot reach most
  // mazes, so it is the thing worth executing rather than restating.
  const isDfsTree = (mask) => {
    const adj = Array.from({ length: 9 }, () => [])
    EDGES.forEach(([a, b], e) => {
      if (mask & (1 << e)) { adj[a].push(b); adj[b].push(a) }
    })
    const parent = Array(9).fill(-2)
    parent[0] = -1
    const queue = [0]
    for (let head = 0; head < queue.length; head += 1) {
      for (const v of adj[queue[head]]) if (parent[v] === -2) { parent[v] = queue[head]; queue.push(v) }
    }
    const isAncestor = (a, d) => {
      for (let x = d; x !== -1; x = parent[x]) if (x === a) return true
      return false
    }
    return EDGES.every(([a, b], e) => (mask & (1 << e)) || isAncestor(a, b) || isAncestor(b, a))
  }
  const reachable = spanning.filter(isDfsTree).length

  const mazeText = `${maze.title}\n${maze.summary}\n${maze.content}`
  for (const claim of [
    `${spanning.length} mazes on a 3×3 grid`,
    `3×3 gives ${spanning.length}`,
    `can build ${reachable}`,
    `reaches ${reachable}`,
    `the missing ${spanning.length - reachable}`,
  ]) {
    assert.ok(mazeText.includes(claim), `the article must still say "${claim}"`)
  }

  const mazeSrc = await readFile(
    new URL('../src/components/games/maze-weaver/MazeWeaver.ts', import.meta.url),
    'utf-8',
  )
  const constant = (re, what) => {
    const m = mazeSrc.match(re)
    assert.ok(m, `MazeWeaver.ts no longer declares ${what} — the checks below are only meaningful if it found it`)
    return Number(m[1])
  }
  // rows derive from cols exactly as the component derives them.
  const cols = constant(/private cols = (\d+)/, 'a default column count')
  const rows = Math.max(6, Math.round(cols * constant(/const ASPECT = ([\d.]+)/, 'an aspect ratio')))

  assert.ok(maze.content.includes(`${cols} by ${rows} out of the box`), `the default grid is ${cols}×${rows}`)
  assert.ok(maze.content.includes(`${cols}×${rows} grid`), 'the measured averages are quoted for the default grid')
  // Corner to corner in a perfect maze is at best the Manhattan walk, in cells.
  assert.ok(
    maze.content.includes(`can be on that grid is ${cols + rows - 1} cells`),
    `the shortest corner-to-corner route on a ${cols}×${rows} grid is ${cols + rows - 1} cells`,
  )

  // The builder buttons. The article names all three and the caption tells the
  // reader to press one by its LABEL, so a rename breaks an instruction and a
  // fourth builder ("Wilson's", which the article itself recommends) makes
  // "three builders" and "Two of the three" false.
  const genBlock = mazeSrc.slice(mazeSrc.indexOf('const GEN_NAMES'), mazeSrc.indexOf('const SOLVE_NAMES'))
  const genNames = [...genBlock.matchAll(/:\s*["']([^"']+)["']/g)].map(m => m[1])
  assert.equal(genNames.length, 3, 'the article counts the builders — "three builders", "Two of the three", "All three"')
  for (const name of genNames) {
    assert.ok(maze.content.includes(name), `the article must name the builder button "${name}"`)
  }
  assert.ok(
    genNames.some(name => maze.embedCaption.includes(name)),
    'the caption tells the reader to press a builder by its label — that label must still exist',
  )

  // "read the last figure in the status line — path N cells"
  assert.ok(maze.embedCaption.includes('path N cells'), 'the caption points at the path figure')
  assert.match(mazeSrc, /`path \$\{this\.path\.length\} cells`/, 'the status line still prints "path N cells"')

  // "it rebuilds the same seed, so only the rule has changed" — which is only
  // true because switching builder passes false where Regenerate passes true.
  // Assert both halves: the flag has to mean "take a new seed" for the caption's
  // promise to hold, and a swap of the two arguments is invisible on screen.
  assert.match(
    mazeSrc,
    /\[data-action="generate"\][\s\S]{0,140}?startGenerate\(true\)/,
    'Regenerate takes a NEW seed — that is what makes the flag mean "new seed"',
  )
  // EVERY startGenerate inside the builder-switch handler, not just one of them:
  // the handler has two (switch builder, re-press the current one) and both keep
  // the seed. A `false` somewhere else in that block is what let an earlier draft
  // of this check pass a mutant that took a new seed on switch.
  const genHandlerStart = mazeSrc.indexOf("querySelectorAll<HTMLButtonElement>('[data-gen]')")
  const genHandlerEnd = mazeSrc.indexOf("querySelectorAll<HTMLButtonElement>('[data-solver]')")
  assert.ok(
    genHandlerStart !== -1 && genHandlerEnd > genHandlerStart,
    'could not locate the builder-switch handler — the check below is only meaningful if it found it',
  )
  const seedFlags = [...mazeSrc
    .slice(genHandlerStart, genHandlerEnd)
    .matchAll(/startGenerate\((true|false)\)/g)].map(m => m[1])
  assert.ok(seedFlags.length >= 2, 'the builder-switch handler regenerates on both of its paths')
  assert.deepEqual(
    [...new Set(seedFlags)],
    ['false'],
    'switching builder must rebuild the SAME seed, or the caption is asking the reader to compare two different mazes',
  )

  // The 14 is counted from the top-left cell ("Enumerate the 3×3 spanning trees
  // that satisfy Tarjan's condition from the top-left cell"). A backtracker that
  // started anywhere else reaches a different set, and the count would move.
  assert.match(
    mazeSrc.slice(mazeSrc.indexOf('*genBacktracker'), mazeSrc.indexOf('*genPrim')),
    /stack: number\[\] = \[0\]/,
    'the backtracker roots at cell 0 — the article counts its reachable mazes from there',
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
  assert.ok(isMode || isLearning || isGame, `"${from}" redirects to ${to}, which is not a published page`)
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
  learningRouteSrc.includes('splitOnEmbed(learning.content)'),
  'learning content is split for embed placement',
)
for (const half of ['before', 'after']) {
  assert.ok(
    new RegExp(`render\\(${half}\\)`).test(learningRouteSrc),
    `the ${half} half is rendered through markdown.ts`,
  )
}
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

// MD Enhanced's map reads the same parsers. Fenced code is the case that breaks
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
  // handed back": a tool may split a helper module out (md-enhanced's
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
  const article = learnings.find(l => l.slug === 'pot-odds-and-bluff-frequency')
  assert.ok(article, 'the pot-odds article is shipped')
  assert.equal(article.embed, 'poker-trainer', 'the article argues about the component it embeds')

  const ptSrc = await readFile(
    new URL('../src/components/games/poker-trainer/PokerTrainer.ts', import.meta.url),
    'utf-8',
  )
  const text = `${article.title}\n${article.summary}\n${article.content}`

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

  assert.ok(
    text.includes('C(48,5) = 1,712,304 boards'),
    'the article must still quote the pre-flop runout count it was written from',
  )
  assert.ok(text.includes('C(45,2) = 990'), 'the article must still quote the flop count')

  // The claim "the trainer refuses pre-flop" is only true while the ceiling is
  // under the pre-flop count. Read the ceiling out of source rather than
  // assuming it.
  const ceilingMatch = ptSrc.match(/const PT_MAX_RUNOUTS = ([\d_]+)/)
  assert.ok(ceilingMatch, 'PokerTrainer.ts no longer declares PT_MAX_RUNOUTS — the check below is meaningless without it')
  const ceiling = Number(ceilingMatch[1].replace(/_/g, ''))
  assert.ok(
    ceiling < preflop,
    `the article says a pre-flop hand-vs-hand query is refused, so PT_MAX_RUNOUTS (${ceiling}) must stay below ${preflop}`,
  )

  // The four prices. `pot` and `sizes` are the drill's, pinned from source: the
  // article names 24.8/33.3/39.8/50.0 and those are functions of these two
  // literals and nothing else.
  const potMatch = ptSrc.match(/const pot = (\d+)\n/)
  const sizesMatch = ptSrc.match(/const sizes = \[([\d, ]+)\]/)
  assert.ok(potMatch, 'the drill no longer declares `const pot = …`')
  assert.ok(sizesMatch, 'the drill no longer declares `const sizes = [...]`')
  const drillPot = Number(potMatch[1])
  const drillSizes = sizesMatch[1].split(',').map(n => Number(n.trim()))
  assert.deepEqual(drillSizes, [33, 50, 66, 100], 'the article quotes one price per drill bet size')
  assert.equal(drillPot, 100, 'the article says the drill builds a pot of 100')

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

  // The two fractions the article now deliberately separates. If they ever collapse
  // back into one number the article is wrong again, so pin both.
  for (const bet of drillSizes) {
    const foldShare = bet / (drillPot + bet)
    assert.ok(
      foldShare > breakeven(drillPot, bet),
      'the share you may fold must stay strictly above the equity a call needs',
    )
  }
  assert.ok(
    text.includes('B / (P + 2B)** of the time') && text.includes('B / (P + B) is the number most tables quote'),
    'the article must keep both fractions distinct and name the near-miss',
  )
  assert.ok(
    text.includes('bets 33, 50, 66 or 100 into it'),
    'the article must still name the drill bet sizes',
  )
  assert.ok(
    text.includes(prices.map(p => p.replace('%', '')).join('%, ') + '%'),
    `the article must still quote the four prices as "${prices.join(', ')}"`,
  )
  // One decimal place, because that is how the article and the caption write
  // them; a formatter change would make both wrong.
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
  for (const claim of [
    'a specific pair is 6 two-card combinations, a suited hand 4, an offsuit hand 12',
    'Ace-king arrives sixteen ways and aces six',
    'their aces drop from 6 to 3',
  ]) {
    assert.ok(text.includes(claim), `the article must still say "${claim}"`)
  }

  // The caption is an instruction, so every control and readout it names has to
  // exist character for character. This is the half that rots silently: a
  // reworded table heading leaves the caption pointing at nothing.
  for (const label of [
    'Play a spot',
    'Next spot',
    'Your equity against their whole range',
    'Equity you needed to call',
  ]) {
    assert.ok(ptSrc.includes(label), `PokerTrainer.ts must still render "${label}" — the caption points at it`)
    assert.ok(article.embedCaption.includes(label), `the caption must still name "${label}"`)
  }
  assert.ok(
    article.embedCaption.includes('19.9, 25.0, 28.4 or 33.3'),
    'the caption tells the reader which four numbers to watch; keep it in step with the prices above',
  )
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
  const locals = {
    runtime: { env: { SITE_CONFIG: { get: async key => (key === 'blogs' ? posts : null) } } },
  }
  const body = await (await GET({ locals })).text()

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


console.log('security smoke ok')
