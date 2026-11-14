/**
 * Hardening from the 15 Nov 2026 review: the image endpoint, per-/64 rate-limit
 * keys, the origin-lock compare, and the deploy pipeline's hygiene.
 *
 * Standalone (run by `npm run security:smoke`, or `npx tsx scripts/smoke/hardening.mjs`).
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { clientBucket, isFromCloudflare, rateLimitKey, timingSafeEqualText } from '../../src/lib/security.ts'

const src = (p) => readFile(new URL(`../../${p}`, import.meta.url), 'utf-8')

/* ── 1. Astro's /_image endpoint does no work. ───────────────────────────────
   Nothing imports astro:assets, so no page links to it, yet the stock endpoint
   resized any file under public/ for a stranger (about 7 s of CPU a request, and
   a different w/q misses the edge cache). The route is replaced by one that
   answers 404 before touching a file or an image library. */
{
  const config = await src('astro.config.mjs')
  assert.match(config, /entrypoint:\s*'\.\/src\/image-endpoint-gone\.ts'/, 'the image endpoint is replaced in astro.config.mjs')
  assert.match(config, /service:\s*passthroughImageService\(\)/, 'no resize service is wired up')
  const { GET } = await import('../../src/image-endpoint-gone.ts')
  const res = await GET({ request: new Request('http://localhost/_image?href=/og/hub-tools.png&w=100&q=80') })
  assert.equal(res.status, 404, '/_image answers 404 whatever it is asked')
  assert.equal(res.headers.get('cache-control'), 'no-store')
  const endpoint = await src('src/image-endpoint-gone.ts')
  assert.ok(!/sharp|astro:assets|loadImage/.test(endpoint.replace(/\/\/[^\n]*/g, '')), 'the replacement does no image work')
  const lock = JSON.parse(await src('package.json'))
  assert.ok(!('sharp' in (lock.dependencies ?? {})), 'sharp is not a direct dependency')
}
console.log('hardening: /_image answers 404 and the stock resize endpoint is not registered')

/* ── 2. Rate-limit keys: one bucket per IPv4 address, per IPv6 /64. ───────── */
{
  const key = (ip) => rateLimitKey(new Request('https://example.com/', { headers: { 'cf-connecting-ip': ip } }))
  assert.equal(key('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), key('2001:db8:1:2::1'), 'two addresses in one /64 share a key')
  assert.equal(key('2001:db8:1:2:ffff:ffff:ffff:ffff'), key('2001:0db8:0001:0002:0000:0000:0000:0001'), 'compressed and expanded spellings agree')
  assert.equal(key('2001:DB8:1:2::1'), key('2001:db8:1:2::1'), 'case does not matter')
  assert.notEqual(key('2001:db8:1:2::1'), key('2001:db8:1:3::1'), 'two /64s do not share a key')
  assert.notEqual(key('2001:db8:1:2::1'), key('2001:db8:9:2::1'), 'a difference in the third group splits them')
  assert.equal(key('::ffff:203.0.113.9'), key('203.0.113.9'), 'a mapped IPv4 address is the plain IPv4 bucket')
  assert.equal(key('::ffff:cb00:7109'), key('203.0.113.9'), 'the hex spelling of a mapped address is too')
  assert.equal(key('203.0.113.9'), '203.0.113.9', 'IPv4 is unchanged')
  assert.notEqual(key('203.0.113.9'), key('203.0.113.10'), 'IPv4 addresses stay separate')
  assert.equal(key('fe80::1%eth0'), key('fe80::2'), 'a zone id is dropped')
  assert.equal(key('[2001:db8:1:2::1]'), key('2001:db8:1:2::9'), 'brackets are dropped')
  assert.equal(key('::1'), key('0:0:0:0:ffff:ffff:ffff:1'), 'both land in the all-zero /64')
  assert.equal(key('not-an-ip'), 'not-an-ip', 'a non-address is left alone (the limiter caps keys)')
  assert.equal(rateLimitKey(new Request('https://example.com/')), 'unattributed')
  assert.equal(clientBucket('2001:db8::'), '2001:db8:0:0::/64', 'a trailing :: expands')
}
console.log('hardening: IPv6 clients share a bucket per /64 and a mapped IPv4 address is its IPv4 bucket')

/* ── 3a. The origin lock never waits on libuv's thread pool. ───────────────
   crypto.subtle.digest runs on the pool slow DNS lookups fill, so an awaited
   digest on every request stalled the site behind a lookup. */
{
  const code = (await src('src/lib/security.ts')).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
  assert.ok(!/crypto\.subtle/.test(code), 'security.ts does not use WebCrypto')
  assert.ok(/timingSafeEqual\(/.test(code) && /createHash\('sha256'\)/.test(code), 'the compare is node:crypto createHash + timingSafeEqual')
  assert.equal(typeof isFromCloudflare(new Request('https://example.com/'), 'sekrit'), 'boolean', 'the lock answers synchronously')
  assert.equal(timingSafeEqualText('sekrit', 'sekrit'), true)
  assert.equal(timingSafeEqualText('sekrit', 'sekriT'), false)
  assert.equal(timingSafeEqualText('', 'x'), false)
  assert.equal(timingSafeEqualText('a'.repeat(5000), 'a'.repeat(5000)), true, 'unequal or long lengths never throw')
  assert.equal(timingSafeEqualText('a'.repeat(5000), 'a'), false)
  assert.equal(isFromCloudflare(new Request('https://example.com/', { headers: { 'x-origin-auth': 'sekrit' } }), 'sekrit'), true)
  assert.equal(isFromCloudflare(new Request('https://example.com/', { headers: { 'x-origin-auth': 'sekriT' } }), 'sekrit'), false)
  assert.match(await src('Dockerfile'), /^ENV UV_THREADPOOL_SIZE=16$/m, 'the image widens the thread pool for the lookups that still use it')
}
console.log('hardening: the origin lock compares with synchronous node:crypto and the pool is widened')

/* ── 3c. Visitor-typed names resolve through c-ares, with every SSRF guard kept.
   The resolver is pointed at a stub nameserver on loopback (the `servers` seam),
   so this runs offline and proves the real default path, not the test seam. */
{
  const { createSocket } = await import('node:dgram')
  const { lookupAllBounded, isLocalOnlyName } = await import('../../src/lib/dns-lookup.ts')
  const { lpCheckResolved, lpIsForbiddenHostname } = await import('../../src/lib/link-peek-fetch.ts')
  const { csResolvePinned } = await import('../../src/lib/tls-inspect.ts')
  const { replayResolvePinned } = await import('../../src/lib/webhook-replay.ts')

  // Answers A queries from a table; any other type gets an empty NOERROR answer
  // (no AAAA), a name not in the table gets NXDOMAIN, "hole.example" gets silence.
  const zone = { 'ok.example': [93, 184, 216, 34], 'private.example': [10, 0, 0, 5], 'mixed.example': [8, 8, 8, 8], 'loop.example': [127, 0, 0, 1] }
  const seen = []
  const server = createSocket('udp4')
  server.on('message', (msg, rinfo) => {
    let o = 12
    const labels = []
    while (msg[o]) { labels.push(msg.subarray(o + 1, o + 1 + msg[o]).toString()); o += msg[o] + 1 }
    const name = labels.join('.')
    const qEnd = o + 5
    const type = msg.readUInt16BE(o + 1)
    seen.push(`${name}/${type}`)
    if (name === 'hole.example') return
    const ip = zone[name]
    const head = Buffer.from(msg.subarray(0, 2))
    const question = msg.subarray(12, qEnd)
    const answered = ip && type === 1
    const flags = Buffer.from([0x81, ip ? 0x80 : 0x83])
    const counts = Buffer.from([0, 1, 0, answered ? 1 : 0, 0, 0, 0, 0])
    const rr = answered ? Buffer.concat([Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4]), Buffer.from(ip)]) : Buffer.alloc(0)
    server.send(Buffer.concat([head, flags, counts, question, rr]), rinfo.port, rinfo.address)
  })
  await new Promise((resolve) => server.bind(0, '127.0.0.1', resolve))
  const servers = [`127.0.0.1:${server.address().port}`]
  try {
    const answers = await lookupAllBounded('ok.example', { servers })
    assert.deepEqual(answers, [{ address: '93.184.216.34', family: 4 }], 'the default path resolves through c-ares')
    assert.ok(seen.includes('ok.example/1'), 'the query really went to the nameserver')

    // The classifier still decides, and the connection is still pinned to what it checked.
    const good = await lpCheckResolved('ok.example', { servers })
    assert.equal(good.ok, true)
    assert.deepEqual(good.pin, { host: 'ok.example', addresses: [{ address: '93.184.216.34', family: 4 }] }, 'Link Peek is pinned to the checked answer')
    assert.equal((await lpCheckResolved('private.example', { servers })).ok, false, 'a private answer is refused')
    assert.equal((await lpCheckResolved('loop.example', { servers })).ok, false, 'a loopback answer is refused')
    assert.equal((await csResolvePinned('private.example', { servers })).ok, false, 'Chainsaw refuses it too')
    const pinnedGood = await csResolvePinned('ok.example', { servers })
    assert.deepEqual([pinnedGood.ok, pinnedGood.address, pinnedGood.family], [true, '93.184.216.34', 4])
    assert.equal((await replayResolvePinned('https://private.example/x', { servers })).ok, false, 'Resend to URL refuses it too')
    assert.equal((await replayResolvePinned('https://ok.example/x', { servers })).ok, true)
    assert.equal((await lpCheckResolved('nxdomain.example', { servers })).ok, false, 'NXDOMAIN reads as unresolvable')

    // Names that never leave the machine are refused by name, before any query.
    const before = seen.length
    for (const name of ['localhost', 'LOCALHOST.', 'foo.localhost', 'intranet', 'db.internal', 'printer.local', 'router.home.arpa', '127.0.0.1', '169.254.169.254', '::1', '']) {
      await assert.rejects(lookupAllBounded(name, { servers }), (e) => e.code === 'ENOTFOUND', `${name || '(empty)'} is refused without a query`)
    }
    assert.equal(seen.length, before, 'no query left the process for any of them')
    for (const name of ['localhost', 'foo.localhost', 'intranet', 'db.internal', 'printer.local', 'router.home.arpa', 'example.com', 'a.b.example.org', '127.0.0.1', 'ok.example']) {
      assert.equal(isLocalOnlyName(name), lpIsForbiddenHostname(name), `${name}: the resolver's name rule agrees with Link Peek's`)
    }

    // A silent nameserver stops at the bound, and the cancel leaves nothing running.
    const t0 = Date.now()
    await assert.rejects(lookupAllBounded('hole.example', { servers, timeoutMs: 300 }), (e) => e.name === 'DnsLookupTimeout')
    assert.ok(Date.now() - t0 < 1500, 'the wait ends at the bound')
  } finally {
    server.close()
  }

  const dnsSrc = (await src('src/lib/dns-lookup.ts')).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
  assert.ok(/new Resolver\(/.test(dnsSrc) && !/\blookup\(/.test(dnsSrc.replace(/lookupAllBounded/g, '')), 'the default is the c-ares Resolver, not dns.lookup')
  assert.ok(/resolver\.cancel\(\)/.test(dnsSrc), 'a timed-out query is cancelled')
}
console.log('hardening: names resolve through c-ares, local-only names are refused by name, answers are still classified and pinned')

/* ── 2b. Every write route has a site-wide bucket behind the client's. ───────
   Rotating addresses (a botnet, or an IPv6 range's worth) beats any per-client
   limit, so the routes that store something or hold a socket also spend a shared
   bucket, asked only after the client's said yes (security-smoke derives that
   pairing over every route; this pins that these routes HAVE one, and that the
   shared cap is larger than one client's, or normal use would trip it). */
{
  const writes = ['src/pages/api/hook/[bin].ts', 'src/pages/api/games/type-trial/daily.ts', 'src/pages/api/games/hue-hunt/daily.ts', 'src/pages/api/games/interest.ts', 'src/pages/api/hook/[bin]/stream.ts', 'src/pages/api/analytics/event.ts']
  for (const route of writes) {
    const code = (await src(route)).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
    const caps = Object.fromEntries([...code.matchAll(/const (allow\w+) = createRateLimiter\(60_000, (\d+)\)/g)].map((m) => [m[1], Number(m[2])]))
    const pair = code.match(/(allow\w+)\(\s*(?:rateLimitKey\(request\)|client)\s*\)\s*&&\s*(allow\w+)\('global'\)/)
    assert.ok(pair, `${route}: the write path asks a client bucket and then a shared one`)
    assert.ok(caps[pair[2]] >= caps[pair[1]] * 4, `${route}: the shared cap (${caps[pair[2]]}) leaves room for several clients at their own cap (${caps[pair[1]]})`)
  }
}
console.log('hardening: capture, both leaderboard submits, interest votes, stream opens and analytics events each spend a shared bucket after the client\'s')

/* ── 6. Deploy hygiene: what the pipeline passes, pulls and bases on. ─────── */
{
  const deploy = (await src('.github/workflows/deploy.yml')).replace(/^\s*#.*$/gm, '')
  assert.ok(!/-e\s+\w+="?\$/.test(deploy) && !/--env\s/.test(deploy), 'no secret is passed to docker run as an argument')
  assert.match(deploy, /--env-file "\$envfile"/, 'the container gets its secrets from an env file')
  assert.match(deploy, /mktemp/, 'the env file is a fresh temp file')
  assert.match(deploy, /chmod 600 "\$envfile"/, 'readable by the runner user only')
  assert.match(deploy, /trap 'rm -f "\$envfile"' EXIT/, 'and deleted when the step ends, however it ends')
  assert.ok(deploy.indexOf('chmod 600') < deploy.indexOf('printf'), 'the mode is set before the secret is written')
  assert.match(deploy, /DOCKER_IMAGE: \$\{\{ env\.IMAGE \}\}:sha-\$\{\{ github\.sha \}\}/, 'deploys the immutable per-commit tag')
  assert.ok(!/DOCKER_IMAGE:.*:latest/.test(deploy), 'never deploys :latest')
  assert.match(deploy, /\$\{\{ env\.IMAGE \}\}:sha-\$\{\{ github\.sha \}\}\n/, 'the build job pushes that same tag')
  assert.ok(!/ADMIN_SECRET/.test(deploy), 'ADMIN_SECRET is still not passed')
  const docker = await src('Dockerfile')
  const froms = docker.split('\n').filter((l) => l.startsWith('FROM '))
  assert.equal(froms.length, 2)
  for (const l of froms) assert.match(l, /^FROM node:22-alpine@sha256:[0-9a-f]{64} AS \w+$/, `${l} is pinned by digest`)
  assert.equal(new Set(froms.map((l) => l.split(' ')[1])).size, 1, 'both stages use the same base')
  assert.match(await src('.dockerignore'), /^secrets\/$/m, 'a secrets/ folder never enters the build context')
}
console.log('hardening: deploy passes secrets by a 0600 env file, ships the sha- tag, bases on a digest and keeps secrets/ out of the image')
