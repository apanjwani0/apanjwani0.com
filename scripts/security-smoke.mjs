import assert from 'node:assert/strict'
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
  assert.ok(isMode || isLearning, `"${from}" redirects to ${to}, which is not a published page`)
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
// Trellis: the text→graph parsers, and the share link.
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
// exactly what token-bench and trellis did until Aug 2026. Nothing about that
// failure is loud: the tool works, it is just narrower and unfocusable, so it
// survives review and is only caught by looking at two tabs side by side.
const toolDirs = await readdir(new URL('../src/components/tools/', import.meta.url), {
  withFileTypes: true,
})
for (const dir of toolDirs.filter(d => d.isDirectory())) {
  const files = await readdir(new URL(`../src/components/tools/${dir.name}/`, import.meta.url))
  const entry = files.find(f => f.endsWith('.ts'))
  if (!entry) continue
  const source = await readFile(
    new URL(`../src/components/tools/${dir.name}/${entry}`, import.meta.url),
    'utf-8',
  )
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

console.log('security smoke ok')
