/**
 * Invariants for the agent front door and the diagnostics' permalinks:
 * the MCP server (src/pages/api/mcp.ts, src/lib/mcp.ts), the OpenAPI document
 * (src/lib/openapi.ts), /.well-known/security.txt, Link Peek's address pinning,
 * and the `#h=` permalinks on Chainsaw, DNS Sightline and Link Peek.
 *
 * Offline: the one outbound path (DNS Sightline's DoH fetch) is stubbed, and the
 * pinning test talks to a loopback server it starts itself.
 *
 * Mutations, each of which must fail a named line below:
 *   - swap `allowCallClient(key) && allowCallShared('global')` for the shared
 *     bucket first, or ask the shared one unconditionally          -> limiter order
 *   - run `mcpPrepareCall` after the limiter                       -> validation first
 *   - drop `lookup:` from the request in `lpRequestPinned`, or pass `null` for
 *     `resolved.pin` in the hop loop                               -> pinning
 *   - delete the `::ffff:` branch in `lpForbiddenV6`               -> mapped addresses
 *   - raise MCP_LIMITS.callsPerClient to 4                         -> tighter than pages
 *   - add `searchParams.get('x')` to a route without documenting it -> OpenAPI parity
 *   - set the security.txt Expires in the past                      -> security.txt
 *   - drop the length check in `permalinkParam`                     -> permalink decode
 *   - call `void this.inspect()` for the ?host= branch               -> "try" links prefill only
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFile, readdir } from 'node:fs/promises'

const root = new URL('../../', import.meta.url)
const read = async rel => readFile(new URL(rel, root), 'utf-8')
const stripComments = src => src.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`])\/\/[^\n]*/g, '$1')
const line = text => console.log(text)

/* ───────────────── Link Peek: the connection is pinned to the address that was checked ───────────────── */
{
  const { lpIsForbiddenIp, lpCheckResolved, lpPinnedLookup, lpRequestPinned } = await import('../../src/lib/link-peek-fetch.ts')

  // The checked answers are exactly what the pin carries, and a literal needs none.
  const answers = [{ address: '93.184.216.34', family: 4 }, { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }]
  const checked = await lpCheckResolved('Pin.Example', { resolve: async () => answers })
  assert.equal(checked.ok, true)
  assert.deepEqual(checked.pin, { host: 'Pin.Example', addresses: answers }, 'the pin carries exactly the addresses that were classified')
  assert.deepEqual(await lpCheckResolved('93.184.216.34'), { ok: true }, 'an IP literal resolves to itself and needs no pin')
  assert.equal((await lpCheckResolved('mixed.example', { resolve: async () => [answers[0], { address: '10.0.0.5', family: 4 }] })).ok, false, 'one private answer refuses the whole name, so nothing private can ever be in a pin')

  // The lookup answers for the pinned name only, with only the pinned addresses.
  const lookup = lpPinnedLookup(checked.pin)
  const ask = (host, options) => new Promise(resolve => lookup(host, options, (err, address, family) => resolve({ err, address, family })))
  assert.deepEqual((await ask('pin.example.', { all: true })).address, answers, 'case and a trailing dot do not matter; every checked address is offered')
  const single = await ask('pin.example', {})
  assert.equal(single.address, '93.184.216.34'); assert.equal(single.family, 4)
  assert.equal((await ask('evil.example', { all: true })).err?.code, 'ENOTFOUND', 'the pin cannot be reused for a different name')
  assert.equal((await ask('localhost', {})).err?.code, 'ENOTFOUND', '…and never resolves anything else')

  // The socket really goes to the pinned address, whatever the name would resolve to.
  let hits = 0
  let seenHost = ''
  const server = http.createServer((req, res) => { hits++; seenHost = req.headers.host ?? ''; res.writeHead(200, { 'content-type': 'text/plain' }); res.end('pinned') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    const url = new URL(`http://pinned.test:${port}/p`)
    const res = await lpRequestPinned(url, { host: 'pinned.test', addresses: [{ address: '127.0.0.1', family: 4 }] }, { headers: { 'User-Agent': 'smoke' }, signal: AbortSignal.timeout(3000) })
      .catch(err => assert.fail(`the pinned request must connect to the pinned address without resolving the name (${err.code ?? err.message})`))
    assert.equal(res.status, 200)
    assert.equal(await res.text(), 'pinned')
    assert.equal(hits, 1, 'the request reached the pinned address although the name "pinned.test" resolves nowhere')
    assert.equal(seenHost, `pinned.test:${port}`, 'the name still travels as the Host header')
    const before = hits
    await lpRequestPinned(url, null, { headers: {}, signal: AbortSignal.timeout(3000) }).then(r => r.text()).catch(() => {})
    assert.equal(hits, before, 'without a pin the same request does NOT reach the loopback server: the pin is what put it there')
    await assert.rejects(lpRequestPinned(url, { host: 'other.test', addresses: [{ address: '127.0.0.1', family: 4 }] }, { headers: {}, signal: AbortSignal.timeout(3000) }), 'a pin for another name refuses the connection')
    assert.equal(hits, before, '…and nothing was sent')
  } finally {
    await new Promise(resolve => server.close(resolve))
  }

  // The hop loop: every hop validates, classifies, resolves, then connects through the pin.
  const src = stripComments(await read('src/lib/link-peek-fetch.ts'))
  const loop = src.indexOf('for (let hop')
  const at = token => src.indexOf(token, loop)
  assert.ok(loop > -1)
  assert.ok(at('lpValidateUrl(current)') < at('lpIsForbiddenHostname(') && at('lpIsForbiddenHostname(') < at('await lpCheckResolved(') && at('await lpCheckResolved(') < at('await lpRequestPinned('), 'each hop validates, classifies the name, resolves and checks, in that order, before connecting')
  assert.match(src, /lpRequestPinned\(checked\.url, resolved\.pin \?\? null,/, 'the connection is made with the pin the check just produced')
  assert.ok(/current = new URL\(location, checked\.url\)\.href\s*\}[\s\S]{0,80}continue/.test(src) || /current = new URL\(location, checked\.url\)\.href/.test(src), 'a redirect sets the next URL and goes round the whole loop')
  assert.equal(/\bfetch\(/.test(src), false, 'no fetch() is left that could connect without the pin')
  assert.match(src, /\.\.\.\(pin \? \{ lookup: lpPinnedLookup\(pin\) \} : \{\}\)/, 'the request installs the pinned lookup')
  assert.match(src, /agent: false/, 'one connection per request, so no kept-alive socket outlives its address check')

  // `::ffff:a.b.c.d` is classified by the IPv4 rules, in every spelling.
  const v4s = ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.0.9', '172.16.5.5', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1']
  const hex = v4 => { const [a, b, c, d] = v4.split('.').map(Number); return `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}` }
  for (const v4 of v4s) {
    const want = lpIsForbiddenIp(v4)
    for (const spelled of [`::ffff:${v4}`, `::FFFF:${v4}`, `::ffff:${hex(v4)}`, `0:0:0:0:0:ffff:${hex(v4)}`, `0000:0000:0000:0000:0000:ffff:${v4}`]) {
      assert.equal(lpIsForbiddenIp(spelled), want, `${spelled} must be classified exactly as ${v4} (${want ? 'forbidden' : 'allowed'})`)
    }
  }
  line('link peek: the connection is pinned to the checked addresses (Host kept, nothing else reachable), every hop re-checks, and ::ffff: addresses are classified by the IPv4 rules in every spelling')
}

/* ───────────────── The MCP endpoint ───────────────── */
const { POST, ALL } = await import('../../src/pages/api/mcp.ts')
const { MCP_TOOLS, MCP_PROTOCOL_VERSION, MCP_MAX_BODY_BYTES, mcpParseMessage } = await import('../../src/lib/mcp.ts')
const { MCP_LIMITS, API_LIMITS, PARAMS, buildOpenApi } = await import('../../src/lib/openapi.ts')
const { recordRequest } = await import('../../src/lib/webhook-store.ts')

const URL_MCP = 'http://localhost/api/mcp'
let nextId = 1
const rpc = (message, { ip = '203.0.113.200', headers = {}, mod = POST } = {}) => mod({
  request: new Request(URL_MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(ip ? { 'cf-connecting-ip': ip } : {}), ...headers },
    body: message.raw ?? JSON.stringify({ jsonrpc: '2.0', id: nextId++, ...message }),
  }),
  locals: {},
})
const call = (name, args, opts) => rpc({ method: 'tools/call', params: { name, arguments: args } }, opts)
const body = async res => JSON.parse(await res.text())

// The one outbound path (DNS-over-HTTPS) is stubbed offline.
const realFetch = globalThis.fetch
globalThis.fetch = async () => { throw new TypeError('offline in the smoke suite') }

try {
  /* ── the protocol surface ── */
  {
    const init = await body(await rpc({ method: 'initialize', params: { protocolVersion: MCP_PROTOCOL_VERSION } }))
    assert.equal(init.result.protocolVersion, MCP_PROTOCOL_VERSION)
    assert.match(MCP_PROTOCOL_VERSION, /^\d{4}-\d{2}-\d{2}$/, 'the protocol version is one dated constant')
    assert.equal((await rpc({ method: 'initialize', params: { protocolVersion: '1999-01-01' } }).then(body)).result.protocolVersion, MCP_PROTOCOL_VERSION, 'an unknown version is answered with the one this server speaks')
    assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } })
    const initialized = await rpc({ raw: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
    assert.equal(initialized.status, 202); assert.equal(await initialized.text(), '', 'a notification is accepted with no body')
    assert.deepEqual((await body(await rpc({ method: 'ping' }))).result, {})
    const list = await body(await rpc({ method: 'tools/list' }))
    assert.deepEqual(list.result.tools.map(t => t.name), ['inspect_tls', 'inspect_dns', 'peek_link', 'create_webhook_bin', 'list_webhook_requests'])
    for (const t of list.result.tools) assert.ok(t.inputSchema.type === 'object' && t.inputSchema.additionalProperties === false, `${t.name} takes a closed object`)
    for (const method of ['resources/list', 'prompts/list', 'tools/delete', 'sampling/createMessage', 'logging/setLevel', '']) {
      const r = await rpc({ method })
      assert.equal((await body(r)).error.code, -32601, `${JSON.stringify(method)} is a method this server does not have: -32601`)
    }
    assert.equal(mcpParseMessage([{ jsonrpc: '2.0', id: 1, method: 'ping' }]).kind, 'invalid', 'a batch is refused')
    assert.equal(mcpParseMessage({ jsonrpc: '2.0', id: null, method: 'ping' }).kind, 'invalid', 'a null request id is refused')
    assert.equal(mcpParseMessage({ jsonrpc: '2.0', id: {}, method: 'ping' }).kind, 'invalid', 'an object request id is refused')
    line('mcp: initialize / initialized / tools/list / ping answer, the version is one constant, and every other method is -32601')
  }

  /* ── transport: GET, content type, body cap, origin, no CORS, no store ── */
  {
    for (const method of ['GET', 'OPTIONS', 'DELETE', 'PUT']) {
      const r = await ALL({ request: new Request(URL_MCP, { method: method === 'GET' ? 'GET' : method }) })
      assert.equal(r.status, 405, `${method} answers 405`)
      assert.equal(r.headers.get('allow'), 'POST')
      assert.equal(r.headers.get('cache-control'), 'no-store')
      assert.equal(r.headers.get('access-control-allow-origin'), null, 'no CORS')
      assert.match((await body(r)).error, /stateless and has no event stream/, 'a fixed sentence')
    }
    const ok = await rpc({ method: 'ping' })
    assert.equal(ok.headers.get('content-type'), 'application/json')
    assert.equal(ok.headers.get('cache-control'), 'no-store')
    assert.equal([...ok.headers.keys()].some(h => h.startsWith('access-control-')), false, 'no CORS headers on an answer')
    assert.equal((await rpc({ method: 'ping' }, { headers: { 'content-type': 'text/plain' } })).status, 415, 'a simple (no-preflight) content type is refused')
    assert.equal((await rpc({ method: 'ping' }, { headers: { origin: 'https://evil.example' } })).status, 403, 'a foreign Origin is refused')
    assert.equal((await rpc({ method: 'ping' }, { headers: { 'mcp-protocol-version': '1999-01-01' } })).status, 400, 'a protocol version this server does not speak is refused')
    assert.equal((await rpc({ raw: '{not json' })).status, 400)
    assert.equal((await body(await rpc({ raw: '{not json' }))).error.code, -32700)

    assert.equal(MCP_MAX_BODY_BYTES, 16 * 1024)
    const padded = size => { const base = JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping', params: { pad: '' } }); return base.replace('"pad":""', `"pad":"${'x'.repeat(size - base.length)}"`) }
    assert.equal(new TextEncoder().encode(padded(MCP_MAX_BODY_BYTES)).length, MCP_MAX_BODY_BYTES)
    assert.equal((await rpc({ raw: padded(MCP_MAX_BODY_BYTES) })).status, 200, 'a body of exactly 16 KB is read')
    const tooBig = await rpc({ raw: padded(MCP_MAX_BODY_BYTES + 1) })
    assert.equal(tooBig.status, 413, 'one byte over 16 KB is refused')
    assert.equal((await body(tooBig)).error.code, -32600)
    // A body with no Content-Length (a stream) is cut at the cap too, not buffered whole.
    const streamed = new ReadableStream({ start(c) { const chunk = new TextEncoder().encode('{"jsonrpc":"2.0","id":1,"method":"ping","params":{"p":"' + 'y'.repeat(8000)); c.enqueue(chunk); c.enqueue(new TextEncoder().encode('y'.repeat(9000) + '"}}')); c.close() } })
    const streamRes = await POST({ request: new Request(URL_MCP, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.201' }, body: streamed, duplex: 'half' }), locals: {} })
    assert.equal(streamRes.status, 413, 'a streamed body is cut at the cap')
    line('mcp transport: GET and every non-POST method is 405 with a fixed sentence, JSON only, no-store, no CORS, a foreign Origin and a wrong content type are refused, and the body is capped at 16 KB')
  }

  /* ── limiter order: validate, then the caller's bucket, then the shared one, then the tool's own ── */
  {
    const route = stripComments(await read('src/pages/api/mcp.ts'))
    const idx = token => { const i = route.indexOf(token); assert.ok(i > -1, `api/mcp.ts must contain ${token}`); return i }
    const order = [
      "allowOther(key)",
      'readLimitedJson(request',
      'mcpPrepareCall(message.params)',
      "allowCallClient(key) && allowCallShared('global')",
      'prepared.tool.run(',
    ].map(idx)
    assert.deepEqual(order, [...order].sort((a, b) => a - b), 'order: the generic bound, the capped read, VALIDATION, the caller bucket then the shared bucket, and only then the tool (which spends its own buckets)')
    assert.equal((route.match(/allowCallShared\(/g) || []).length, 1, 'the shared bucket is asked in exactly one place, behind the caller\'s')
    assert.match(route, /const allowed = allowCallClient\(key\) && allowCallShared\('global'\)/, 'a refused caller never spends the shared bucket (a refused hit still counts)')
    assert.equal((route.match(/createRateLimiter\(/g) || []).length, 3, 'three limiters: caller, shared, and the generic per-client bound')
    assert.match(route, /createRateLimiter\(MCP_LIMITS\.windowMs, MCP_LIMITS\.callsPerClient\)/)
    assert.match(route, /createRateLimiter\(MCP_LIMITS\.windowMs, MCP_LIMITS\.callsShared\)/)
    assert.match(route, /createRateLimiter\(MCP_LIMITS\.windowMs, MCP_LIMITS\.otherPerClient\)/)
    assert.equal((route.match(/'Retry-After': '60'/g) || []).length, 1, 'every refusal goes through the one `refuse` helper, which sets Retry-After: 60')
    assert.match(route, /RPC_RATE_LIMITED/); assert.equal(MCP_LIMITS.windowMs, 60_000)
    assert.ok(!/fetch\(/.test(stripComments(await read('src/lib/mcp.ts'))), 'tools call the routes\' handlers in memory, never fetch them over HTTP')
    for (const [name, mod] of [['chainsawGet', 'tools/chainsaw'], ['dnsSightlineGet', 'tools/dns-sightline'], ['linkPeekGet', 'tools/link-peek']]) {
      assert.match(await read('src/lib/mcp.ts'), new RegExp(`import \\{ GET as ${name} \\} from '../pages/api/${mod}'`), `${mod}: the tool calls the route's own handler, so its body shaping and buckets are the page's`)
    }

    /* behaviour, driven through the real handler. Each client is its own address. */
    const create = ip => call('create_webhook_bin', {}, { ip })
    const refusedBy = async res => { const b = await body(res); return { status: res.status, retry: res.headers.get('retry-after'), code: b.error?.code, message: b.error?.message } }

    // Validation runs first: refused calls cost the caller none of its allowance.
    for (let i = 0; i < 6; i++) {
      const bad = await call('inspect_tls', { target: 'ftp://nope' }, { ip: '198.51.100.10' })
      assert.equal(bad.status, 200); assert.equal((await body(bad)).result.isError, true, 'a bad argument is a tool error the model can read')
    }
    assert.equal((await call('inspect_tls', { target: 'a.com', extra: 1 }, { ip: '198.51.100.10' }).then(body)).result.isError, true, 'an unknown argument is refused')
    assert.equal((await call('nope', {}, { ip: '198.51.100.10' }).then(body)).error.code, -32602, 'an unknown tool is a protocol error')
    for (let i = 0; i < 3; i++) assert.equal((await create('198.51.100.10')).status, 200, `after 7 refused calls, valid call ${i + 1} of 3 is still allowed`)
    // …but a flood of refused calls is bounded by the generic per-client bucket.
    let other429 = 0
    for (let i = 0; i < MCP_LIMITS.otherPerClient + 10; i++) {
      const r = await call('inspect_tls', { target: 'ftp://nope' }, { ip: '198.51.100.11' })
      if (r.status === 429) { other429++; assert.equal(r.headers.get('retry-after'), '60') }
    }
    assert.ok(other429 > 0, 'a flood of invalid calls from one client is stopped by the generic bucket')

    // The caller's own bucket: 3 a minute, and the fourth is refused once with the fixed form.
    for (let i = 0; i < MCP_LIMITS.callsPerClient; i++) assert.equal((await create('198.51.100.20')).status, 200)
    const fourth = await refusedBy(await create('198.51.100.20'))
    assert.deepEqual([fourth.status, fourth.retry, fourth.code], [429, '60', -32000])
    assert.match(fourth.message, /rate limited/)
    // …and a client that keeps hammering does NOT drain the shared bucket for everyone.
    for (let i = 0; i < 25; i++) assert.equal((await create('198.51.100.20')).status, 429)
    // Shared so far: 3 (client 10) + 3 (client 20). Two more clients take it to 12.
    for (const ip of ['198.51.100.21', '198.51.100.22']) for (let i = 0; i < 3; i++) {
      assert.equal((await create(ip)).status, 200, `${ip} call ${i + 1}: the shared bucket still has room, so the refused client above did not drain it`)
    }
    const shared = await refusedBy(await create('198.51.100.23'))
    assert.deepEqual([shared.status, shared.retry, shared.code], [429, '60', -32000], 'the thirteenth call in a minute is refused by the shared bucket')
    line('mcp limits: validation spends nothing, the caller\'s 3 a minute is asked before the shared 12, a refused caller does not drain the shared bucket, and a flood of invalid calls is bounded')
  }

  /* ── the called tool's own buckets come after, and are the page's ── */
  {
    const fresh = await import('../../src/pages/api/mcp.ts?second-instance')
    const dnsRoute = await import('../../src/pages/api/tools/dns-sightline.ts')
    const viaPage = ip => dnsRoute.GET({ request: new Request('http://localhost/api/tools/dns-sightline?name=example.com', { headers: { 'cf-connecting-ip': ip } }) })
    const viaMcp = ip => call('inspect_dns', { name: 'example.com' }, { ip, mod: fresh.POST })

    // Three calls through MCP use three of the client's four page allowances…
    const ip = '198.51.100.30'
    for (let i = 0; i < 3; i++) {
      const res = await viaMcp(ip)
      const out = (await body(res)).result
      assert.ok(!out.isError, 'the inspection answers')
      const report = JSON.parse(out.content[1].text)
      assert.equal(report.ok, true); assert.equal(report.report.name, 'example.com')
      assert.match(out.content[0].text, /^Asked three resolvers about example\.com in \d+ DNS queries/, 'a one-sentence summary precedes the route\'s JSON')
    }
    assert.equal((await viaPage(ip)).status, 200, 'the fourth page allowance is still there')
    assert.equal((await viaPage(ip)).status, 429, 'and the fifth is gone: MCP and the page spend ONE per-client bucket, so an agent cannot do more than a page')

    // A client the PAGE has already refused is refused through MCP too, after MCP's own buckets said yes.
    const busy = '198.51.100.31'
    for (let i = 0; i < 6; i++) await viaPage(busy)
    const refused = await viaMcp(busy)
    assert.equal(refused.status, 429); assert.equal(refused.headers.get('retry-after'), '60')
    const refusal = (await body(refused)).error
    assert.equal(refusal.code, -32000); assert.match(refusal.message, /tool behind this call is at its own limit/)
    line('mcp tools: a call spends the called route\'s own buckets (the page\'s), after the MCP ones, and its refusal comes back as -32000 with Retry-After: 60')
  }

  /* ── tighter than the pages, as the owner decided (D-8) ── */
  {
    const pageClient = [API_LIMITS.chainsaw.perClient, API_LIMITS.dnsSightline.perClient, API_LIMITS.linkPeek.perClient]
    const pageShared = [API_LIMITS.chainsaw.global, API_LIMITS.dnsSightline.global, API_LIMITS.linkPeek.global]
    assert.ok(MCP_LIMITS.callsPerClient < Math.min(...pageClient), `MCP allows ${MCP_LIMITS.callsPerClient} calls a minute per client, fewer than the tightest page (${Math.min(...pageClient)})`)
    assert.ok(MCP_LIMITS.callsShared < Math.min(...pageShared), `MCP's shared bucket (${MCP_LIMITS.callsShared}) is smaller than the tightest page's (${Math.min(...pageShared)})`)
    assert.ok(MCP_LIMITS.otherPerClient >= MCP_LIMITS.callsPerClient * 10 && MCP_LIMITS.otherPerClient <= 120, 'the generic bound is generous next to a call but still a bound')
    assert.deepEqual([MCP_LIMITS.callsPerClient, MCP_LIMITS.callsShared], [3, 12], 'the owner\'s numbers')
    line('mcp limits are tighter than every page route: 3 calls a minute per client against the pages\' 4 to 10, 12 shared against 16 to 40')
  }

  /* ── what a tool returns ── */
  {
    const fresh = await import('../../src/pages/api/mcp.ts?third-instance')
    const ip = '198.51.100.40'
    const made = JSON.parse((await body(await call('create_webhook_bin', {}, { ip, mod: fresh.POST }))).result.content[1].text)
    assert.match(made.bin, /^[0-9a-f]{32}$/, '128 random bits, hex')
    const { isValidBinId } = await import('../../src/lib/webhook-store.ts')
    assert.ok(isValidBinId(made.bin), 'it passes the capture route\'s own validator')
    assert.equal(made.captureUrl, `https://apanjwani0.com/api/hook/${made.bin}`); assert.equal(made.listUrl, `${made.captureUrl}/requests`)
    const other = JSON.parse((await body(await call('create_webhook_bin', {}, { ip, mod: fresh.POST }))).result.content[1].text)
    assert.notEqual(other.bin, made.bin, 'bins do not repeat')

    // list_webhook_requests returns the route's JSON, cut to a bounded size with a flag saying so.
    const { MCP_MAX_BIN_LISTING_CHARS } = await import('../../src/lib/mcp.ts')
    const shape = { method: 'POST', query: '', headers: [], contentType: 'text/plain', source: null, bodyTruncated: false, receivedAt: Date.now() }
    for (let i = 0; i < 4; i++) recordRequest(made.bin, { ...shape, id: crypto.randomUUID(), bodyText: 'x'.repeat(64 * 1024), size: 64 * 1024 })
    const listed = await body(await call('list_webhook_requests', { bin: made.bin }, { ip, mod: fresh.POST }))
    const listing = JSON.parse(listed.result.content[1].text)
    assert.equal(listing.count, 4); assert.ok(listing.returned < 4 && listing.truncated === true, 'a bin larger than the listing budget is cut, and says so')
    assert.ok(listed.result.content[1].text.length <= MCP_MAX_BIN_LISTING_CHARS + 2000)
    assert.match(listed.result.content[0].text, /^The bin holds 4 captured requests; \d of them are shown/)
    assert.equal((await body(await call('list_webhook_requests', { bin: 'short' }, { ip, mod: fresh.POST }))).result.isError, true, 'a bin id under 24 characters is refused before the store is touched')

    // An exception's text never reaches the caller.
    const original = MCP_TOOLS[2].run
    MCP_TOOLS[2].run = async () => { throw new Error('SECRET-INTERNAL-PATH /srv/app') }
    try {
      const res = await call('peek_link', { url: 'https://example.com/' }, { ip: '198.51.100.41', mod: fresh.POST })
      const text = await res.text()
      assert.equal(text.includes('SECRET'), false, 'the exception text stays inside')
      assert.equal(JSON.parse(text).result.isError, true)
    } finally {
      MCP_TOOLS[2].run = original
    }
    line('mcp results: a bin id is 128 random bits, a listing is bounded and flagged, a route\'s JSON follows a one-sentence summary, and an exception\'s text never leaves')
  }
} finally {
  globalThis.fetch = realFetch
}

/* ───────────────── OpenAPI ───────────────── */
{
  const doc = buildOpenApi('https://apanjwani0.com/')
  assert.equal(doc.openapi, '3.1.0')
  assert.deepEqual(doc.servers, [{ url: 'https://apanjwani0.com' }])

  // Structural validity: every $ref resolves, operation ids are unique, path templates are fully declared.
  const refs = []
  const walk = node => { if (Array.isArray(node)) node.forEach(walk); else if (node && typeof node === 'object') { if (typeof node.$ref === 'string') refs.push(node.$ref); Object.values(node).forEach(walk) } }
  walk(doc)
  const resolve = ref => ref.slice(2).split('/').reduce((n, k) => n?.[k], doc)
  for (const ref of refs) assert.ok(resolve(ref) !== undefined, `$ref ${ref} resolves`)
  const ids = []
  for (const [path, ops] of Object.entries(doc.paths)) {
    for (const [verb, op] of Object.entries(ops)) {
      if (op.operationId) ids.push(op.operationId)
      assert.ok(op.responses && Object.keys(op.responses).length, `${verb} ${path} has responses`)
      for (const m of path.matchAll(/\{(\w+)\}/g)) assert.ok((op.parameters ?? []).some(p => p.in === 'path' && p.name === m[1] && p.required === true), `${path} declares {${m[1]}}`)
    }
  }
  assert.equal(new Set(ids).size, ids.length, 'operation ids are unique')

  // The 429 shape and Retry-After, on every tool route and the MCP route.
  const rl = doc.components.responses.RateLimited
  assert.ok(rl.headers['Retry-After'] && doc.components.schemas.Error.required.join() === 'ok,error', 'the 429 is {ok:false,error} with Retry-After')
  for (const p of ['/api/tools/chainsaw', '/api/tools/dns-sightline', '/api/tools/link-peek']) assert.equal(doc.paths[p].get.responses['429'].$ref, '#/components/responses/RateLimited')

  // Every query parameter a route reads is documented for it, and every documented one is read.
  const routeOf = { '/api/tools/chainsaw': 'src/pages/api/tools/chainsaw.ts', '/api/tools/dns-sightline': 'src/pages/api/tools/dns-sightline.ts', '/api/tools/link-peek': 'src/pages/api/tools/link-peek.ts', '/api/hook/{bin}': 'src/pages/api/hook/[bin].ts', '/api/hook/{bin}/requests': 'src/pages/api/hook/[bin]/requests.ts', '/api/mcp': 'src/pages/api/mcp.ts' }
  for (const [path, file] of Object.entries(routeOf)) {
    const code = stripComments(await read(file))
    const read_ = new Set([...code.matchAll(/searchParams\.get\('([^']+)'\)/g)].map(m => m[1]))
    const documented = new Set(Object.values(doc.paths[path]).flatMap(op => (op.parameters ?? []).filter(p => p.in === 'query').map(p => p.name)))
    assert.deepEqual([...read_].sort(), [...documented].sort(), `${path}: the query parameters ${file} reads and the ones the document lists must be the same set`)
    for (const name of documented) assert.ok(PARAMS[name], `${name} has a shared description`)
  }
  // A new tool route must be described before it can ship.
  const toolRoutes = (await readdir(new URL('src/pages/api/tools/', root))).filter(f => f.endsWith('.ts')).map(f => `/api/tools/${f.replace(/\.ts$/, '')}`)
  for (const path of toolRoutes) assert.ok(doc.paths[path], `${path} exists as a route and must be in /openapi.json`)

  // Limits are the routes' own numbers.
  const limiters = async file => Object.fromEntries([...stripComments(await read(file)).matchAll(/const (allow\w+) = createRateLimiter\((\d[\d_]*), (\d+)\)/g)].map(m => [m[1], { windowMs: Number(m[2].replace(/_/g, '')), max: Number(m[3]) }]))
  const chainsaw = await limiters('src/pages/api/tools/chainsaw.ts')
  const dns = await limiters('src/pages/api/tools/dns-sightline.ts')
  const peek = await limiters('src/pages/api/tools/link-peek.ts')
  const capture = await limiters('src/pages/api/hook/[bin].ts')
  const playback = await limiters('src/pages/api/hook/[bin]/requests.ts')
  assert.deepEqual([chainsaw.allowClient.max, chainsaw.allowGlobal.max], [API_LIMITS.chainsaw.perClient, API_LIMITS.chainsaw.global], 'chainsaw limits')
  assert.deepEqual([dns.allowClient.max, dns.allowGlobal.max, dns.allowCaaClient.max, dns.allowCaaGlobal.max], [API_LIMITS.dnsSightline.perClient, API_LIMITS.dnsSightline.global, API_LIMITS.dnsSightlineCaa.perClient, API_LIMITS.dnsSightlineCaa.global], 'dns-sightline limits, scope=caa included')
  assert.deepEqual([peek.allowClient.max, peek.allowGlobal.max], [API_LIMITS.linkPeek.perClient, API_LIMITS.linkPeek.global], 'link-peek limits')
  assert.equal(capture.allowCapture.max, API_LIMITS.hookCapture.perClient, 'capture limit')
  assert.equal(playback.allowPlayback.max, API_LIMITS.hookList.perClient, 'list limit')
  for (const l of [chainsaw.allowClient, dns.allowClient, peek.allowClient, capture.allowCapture, playback.allowPlayback]) assert.equal(l.windowMs, 60_000, 'every documented window is a minute')
  const xl = path => doc.paths[path][Object.keys(doc.paths[path]).find(v => doc.paths[path][v]['x-rate-limit'])]['x-rate-limit']
  assert.deepEqual([xl('/api/tools/chainsaw').perClient, xl('/api/tools/chainsaw').global], [6, 24])
  assert.equal(xl('/api/tools/dns-sightline').scopeCaa.perClient, 12)
  assert.equal(xl('/api/mcp').toolCallsPerClient, MCP_LIMITS.callsPerClient)

  // MCP tool schemas are the OpenAPI parameters: one description each.
  const opOf = { inspect_tls: ['/api/tools/chainsaw', 'get'], inspect_dns: ['/api/tools/dns-sightline', 'get'], peek_link: ['/api/tools/link-peek', 'get'], list_webhook_requests: ['/api/hook/{bin}/requests', 'get'] }
  for (const tool of MCP_TOOLS) {
    const props = Object.entries(tool.inputSchema.properties)
    if (tool.name === 'create_webhook_bin') { assert.equal(props.length, 0); continue }
    const [path, verb] = opOf[tool.name]
    const params = doc.paths[path][verb].parameters
    for (const [name, schema] of props) {
      const p = params.find(x => x.name === name)
      assert.ok(p, `${tool.name}.${name} is an OpenAPI parameter of ${path}`)
      assert.deepEqual(schema, { ...p.schema, description: p.description }, `${tool.name}.${name}: the MCP schema and the OpenAPI parameter are one definition`)
    }
    const required = new Set(params.filter(p => p.required).map(p => p.name))
    assert.deepEqual([...tool.inputSchema.required].sort(), [...required].sort(), `${tool.name}: required arguments match the route's required parameters`)
  }
  // The tools' description and limits sentence name the real numbers.
  for (const tool of MCP_TOOLS) assert.ok(tool.description.includes(`${MCP_LIMITS.callsPerClient} tool calls a minute`), `${tool.name} states the limit an agent will meet`)

  // robots.txt must not hide the document or the well-known files from crawlers.
  const robots = await read('public/robots.txt')
  const disallowed = [...robots.split(/\n\s*\n/)[0].matchAll(/^Disallow:\s*(\S*)/gm)].map(m => m[1]).filter(Boolean)
  for (const path of ['/openapi.json', '/.well-known/security.txt']) assert.ok(!disallowed.some(d => path.startsWith(d)), `robots.txt must not disallow ${path}`)
  assert.ok(disallowed.includes('/api/'), 'while /api/ itself stays disallowed, which is why the document is not under it')
  line('openapi: valid 3.1 structure, every parameter a route reads is documented and vice versa, limits equal the routes\' createRateLimiter numbers, MCP tool schemas are the same definitions, robots.txt leaves it crawlable')
}

/* ───────────────── security.txt (RFC 9116) ───────────────── */
{
  const text = await read('public/.well-known/security.txt')
  const fields = new Map()
  for (const l of text.split(/\r?\n/).filter(Boolean)) { const m = /^([A-Za-z-]+):\s*(.+)$/.exec(l); assert.ok(m, `well-formed line: ${l}`); fields.set(m[1], [...(fields.get(m[1]) ?? []), m[2]]) }
  assert.deepEqual(fields.get('Contact'), ['mailto:apanjwani0@gmail.com'])
  assert.deepEqual(fields.get('Canonical'), ['https://apanjwani0.com/.well-known/security.txt'])
  assert.deepEqual(fields.get('Preferred-Languages'), ['en'])
  assert.equal(fields.get('Expires')?.length, 1, 'exactly one Expires field')
  const expires = fields.get('Expires')[0]
  assert.match(expires, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/, 'Expires is an RFC 3339 date-time')
  const days = (Date.parse(expires) - Date.now()) / 86_400_000
  assert.ok(days > 0, `Expires (${expires}) must be in the future, or every scanner reads the file as stale`)
  assert.ok(days < 400, `Expires (${expires}) is ${Math.round(days)} days away: RFC 9116 wants under a year, and under 400 days keeps it reviewed`)
  line(`security.txt: Contact, Canonical and Preferred-Languages as specified, Expires ${expires} is ${Math.round(days)} days away`)
}

/* ───────────────── permalinks ───────────────── */
{
  const { permalinkParam, readPermalink, permalinkHash, PERMALINK_MAX_CHARS } = await import('../../src/lib/permalink.ts')
  const { csCheckTarget } = await import('../../src/components/tools/chainsaw/analyze.ts')
  const { csValidateTarget } = await import('../../src/lib/tls-inspect.ts')
  const { sgValidateName, SG_MAX_INPUT_CHARS } = await import('../../src/components/tools/dns-sightline/analyze.ts')
  const { lpValidateUrl, LP_MAX_URL_CHARS } = await import('../../src/components/tools/link-peek/validate.ts')
  const always = () => true

  // Round trip, including characters that would break a naive fragment.
  for (const v of ['github.com', 'example.com:8443', 'https://example.com/a b?c=d&e=f#g', 'ünïcode.example', '[2606:4700::1111]:443', 'a+b%c']) {
    assert.equal(readPermalink(permalinkHash(v), 400, always), v, `round trip ${v}`)
  }
  assert.equal(permalinkHash('a b&c'), '#h=a%20b%26c', 'encoded with encodeURIComponent')
  assert.equal(permalinkParam(permalinkHash('x.example', { ca: 'letsencrypt.org', ua: '' }), 'ca', 64), 'letsencrypt.org')
  assert.equal(permalinkHash('x.example', { ua: '' }), '#h=x.example', 'an empty extra is left out')

  // Over-long and malformed values are rejected, never thrown on.
  assert.equal(readPermalink('#h=' + 'a'.repeat(300), 300, always), 'a'.repeat(300), 'exactly at the cap is read')
  assert.equal(readPermalink('#h=' + 'a'.repeat(301), 300, always), null, 'one over the cap is refused')
  assert.equal(readPermalink('#h=' + '%61'.repeat(301), 300, always), null, 'percent-encoding does not smuggle a longer value past the cap')
  assert.equal(readPermalink('#h=' + '%61'.repeat(400000), 300, always), null, 'a megabyte fragment is not even decoded')
  {
    // The bound is on the raw text, so an over-long fragment is refused before it is decoded at all.
    const realDecode = globalThis.decodeURIComponent
    let decoded = 0
    globalThis.decodeURIComponent = value => { decoded++; return realDecode(value) }
    try {
      assert.equal(readPermalink('#h=' + '%61'.repeat(1000), 300, always), null)
      assert.equal(decoded, 0, 'a fragment longer than any valid value could encode to is never decoded')
      assert.equal(readPermalink('#h=ab', 300, always), 'ab'); assert.equal(decoded, 1, '…while a plausible one is decoded exactly once')
    } finally {
      globalThis.decodeURIComponent = realDecode
    }
  }
  assert.equal(readPermalink('#' + 'z=1&'.repeat(100000) + 'h=ab', 300, always), null, 'a fragment of any length is not even split, so a huge one costs nothing')
  for (const bad of ['#h=%E0%A4%A', '#h=%', '#h=%zz', '#h=a%00b', '#h=a%0Ab', '#h=%7F', '#h=', '#h=%20%20', '#', '', 'h=github.com', '#x=github.com', '#=github.com']) {
    assert.equal(readPermalink(bad, 300, always), null, `${JSON.stringify(bad)} is not a permalink`)
  }
  assert.equal(readPermalink('#h=ftp%3A%2F%2Fx', LP_MAX_URL_CHARS, v => lpValidateUrl(v).ok), null, 'the tool\'s own validator has the last word')
  assert.equal(readPermalink('#h=ftp%3A%2F%2Fx&h=https%3A%2F%2Fa.example%2F', 400, v => lpValidateUrl(v).ok), null, 'the first h= is the one read')
  assert.ok(PERMALINK_MAX_CHARS >= LP_MAX_URL_CHARS, 'the shared ceiling covers the longest tool input')

  // The page's validators are the server's: one corpus, same verdict, same sentence.
  const corpus = ['github.com', 'github.com:8443', 'github.com:22', 'https://github.com/a/b?c', 'http://u:p@x.com', 'ftp://x', '[2606:4700::1111]', '[2606:4700::1111]:443', '2606:4700::1111', '1.1.1.1', '1.1.1.1:993', '', '   ', 'a'.repeat(300), 'bad host', '-bad.com', 'bad-.com', 'x_y.com', 'exa mple.com', 'example.com.', 'EXAMPLE.COM', 'example.com:0', 'example.com:99999', 'example.com:abc', '[::1', 'a:b:c', '::1', '::ffff:1.2.3.4', 'xn--bcher-kva.example', 'é.com', 'example.com:', 'http://', 'https://example.com:8443/x', '999.1.1.1', '1.2.3', 'localhost', 'a..b', 'https://[::1]:443/', 'a'.repeat(254), 'a'.repeat(253), '2001:db8::1', '[fe80::1%25eth0]']
  for (const input of corpus) {
    const page = csCheckTarget(input); const server = csValidateTarget(input)
    assert.equal(page.ok, server.ok, `chainsaw: page and server agree on ${JSON.stringify(input.slice(0, 40))}`)
    if (!server.ok) assert.equal(page.reason, server.reason, `…and on the sentence for ${JSON.stringify(input.slice(0, 40))}`)
  }
  assert.ok(SG_MAX_INPUT_CHARS > 0 && sgValidateName('example.com').ok && !sgValidateName('1.1.1.1').ok)

  // Each component: a permalink fills AND runs, only through the form's own validator; everything else only fills.
  const specs = [
    { file: 'src/components/tools/chainsaw/Chainsaw.ts', run: 'inspect', validator: 'csCheckTarget', query: "get('host')" },
    { file: 'src/components/tools/dns-sightline/DnsSightline.ts', run: 'inspect', validator: 'sgValidateName', query: "get('name')" },
    { file: 'src/components/tools/link-peek/LinkPeek.ts', run: 'peek', validator: 'lpValidateUrl', query: null },
  ]
  for (const { file, run, validator, query } of specs) {
    const src = stripComments(await read(file))
    const name = file.split('/').pop()
    assert.match(src, new RegExp(`permalinked = readPermalink\\(location\\.hash, [^,]+, v => ${validator}\\(v\\)\\.ok\\)`), `${name}: the fragment is read through ${validator}, the validator the form uses`)
    assert.match(src, new RegExp(`${validator}\\(raw\\)|${validator}\\(value\\)`), `${name}: the form runs the same validator before asking`)
    const autoRuns = [...src.matchAll(/if \((\w+)\) void this\.(inspect|peek)\(\)/g)]
    assert.deepEqual(autoRuns.map(m => m[1]), ['permalinked'], `${name}: the ONLY automatic run is the permalink's`)
    assert.ok(autoRuns.every(m => m[2] === run))
    if (query) assert.ok(src.includes(query) && !/\bdeepLinked\b/.test(src), `${name}: ${query} still prefills`)
    assert.match(src, /Copy link to this check/, `${name}: the button`)
    assert.match(src, /This link re-runs the check when opened\./, `${name}: the note says what the link does`)
    assert.match(src, /history\.replaceState\(null, '', `\$\{[^`]*permalink[^`]*`\)/i, `${name}: the address bar is the permalink`)
    assert.match(src, /role', error \? 'alert' : 'status'|role', tone === 'bad' \? 'alert' : 'status'/, `${name}: a failure is announced as an alert, progress as a status`)
    assert.ok(!/node:/.test(src), `${name} imports nothing from node:`)
  }
  const lib = stripComments(await read('src/lib/permalink.ts'))
  assert.ok(!/from 'node:/.test(lib), 'the permalink helper is browser-safe')

  // "try" links and the query forms only fill: they never use the fragment that runs.
  const { toolTries } = await import('../../src/lib/tool-tries.ts')
  const tries = toolTries()
  for (const slug of ['chainsaw', 'dns-sightline']) {
    assert.ok(tries[slug].href.includes('?') && !tries[slug].href.includes('#h='), `the hub's "try" link for ${slug} only prefills (a query, not the running fragment)`)
  }
  const tools = stripComments(await read('src/lib/tool-tries.ts'))
  assert.ok(!tools.includes('#h='), 'tool-tries.ts never mints a running permalink')
  line('permalinks: #h= round-trips, over-long and malformed values are refused, the page\'s validators equal the server\'s, a permalink is the only thing that runs on open, and "try" links still only fill')
}
