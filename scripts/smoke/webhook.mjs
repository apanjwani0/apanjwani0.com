/**
 * Webhook Inspector invariants: the live stream, resend, the configured response,
 * persistence, the ndjson export and the signature schemes.
 *
 * Standalone (run by `npm run security:smoke` via scripts/run-smoke.mjs, or
 * `npx tsx scripts/smoke/webhook.mjs`). One printed line per invariant; the
 * first failure throws and the process exits non-zero.
 *
 * Fixtures: Standard Webhooks and Twilio use the vendors' own published test
 * vectors. Paddle, Mailgun, Discord and SendGrid are built here from each
 * vendor's documented algorithm with keys generated for the test, because those
 * vendors publish no fixed vector this file could check against; the expected
 * values come from node:crypto, never from the module under test.
 */
import assert from 'node:assert/strict'
import { createHmac, generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import http from 'node:http'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mock } from 'node:test'

import {
  acquireStreamSlot,
  clearBin,
  clearBinResponse,
  configurePersistence,
  flushWebhookBins,
  getBinResponse,
  isAllowedResponseHeader,
  listRequests,
  openStreamCount,
  parsePersistedBins,
  rawBodyIfLossy,
  recordRequest,
  safeResponseContentType,
  sanitizeStoredRequest,
  serializeBins,
  setBinResponse,
  subscribeBin,
  validateBinResponse,
  WEBHOOK_BIN_TTL_MS,
  WEBHOOK_FLUSH_MS,
  WEBHOOK_MAX_BINS,
  WEBHOOK_MAX_BODY_BYTES,
  WEBHOOK_MAX_FILE_BYTES,
  WEBHOOK_MAX_REQUESTS_PER_BIN,
  WEBHOOK_MAX_RESPONSE_BODY_BYTES,
  WEBHOOK_MAX_RESPONSE_HEADERS,
  WEBHOOK_MAX_STREAMS,
  WEBHOOK_MAX_TOTAL_BYTES,
  WEBHOOK_STREAM_KEEPALIVE_MS,
  WEBHOOK_STREAM_MAX_MS,
} from '../../src/lib/webhook-store.ts'
import {
  wiBodyBytes,
  wiDecodeSecret,
  wiDerToRawEcdsa,
  wiDetectScheme,
  wiKeyFor,
  wiVerifyScheme,
} from '../../src/components/tools/webhook-inspector/signature.ts'
import { wiCurlCommand, wiReplayHeader } from '../../src/components/tools/webhook-inspector/curl.ts'
import {
  REPLAY_MAX_INFLIGHT,
  REPLAY_MAX_RESPONSE_BYTES,
  REPLAY_PREVIEW_BYTES,
  REPLAY_TIMEOUT_MS,
  replayRequest,
  replayResolvePinned,
} from '../../src/lib/webhook-replay.ts'

const ok = line => console.log(`webhook: ${line}`)
const root = new URL('../../', import.meta.url)
const read = rel => readFile(new URL(rel, root), 'utf-8')

const newBin = () => `smoke${crypto.randomUUID().replace(/-/g, '')}`
let seq = 0
const mkReq = (over = {}) => ({
  id: crypto.randomUUID(),
  method: 'POST',
  query: '',
  headers: [{ name: 'content-type', value: 'application/json' }],
  contentType: 'application/json',
  source: null,
  bodyText: '{"hello":"smoke"}',
  bodyTruncated: false,
  size: 17,
  receivedAt: Date.now() + seq++,
  ...over,
})
const asRequest = (ip, url = 'http://localhost/api/hook/x', init = {}) =>
  new Request(url, { ...init, headers: { 'cf-connecting-ip': ip, ...(init.headers ?? {}) } })

// The DNS bound's own timer is unref'd (a pending lookup must never hold a server
// up), so a test that waits on it needs something else keeping the loop alive.
const keepAlive = setInterval(() => {}, 1000)

// Memory-only store for everything that is not about the file.
configurePersistence(null)

/* ======================================================================== */
/* signature schemes                                                        */
/* ======================================================================== */

// Always a different character, and one that is valid in hex and in base64.
const flipFirst = text => (text[0] === '0' ? '1' : '0') + text.slice(1)
const flipLastByte = bytes => {
  const out = new Uint8Array(bytes)
  out[out.length - 1] ^= 0x01
  return out
}
const enc = text => new TextEncoder().encode(text)
const verifyWith = async (headers, body, secret, ctx, encoding = 'utf-8') => {
  const scheme = wiDetectScheme(headers, body, ctx)
  assert.ok(scheme, 'a scheme must be recognised')
  return { scheme, result: await wiVerifyScheme(scheme, wiKeyFor(scheme, secret, encoding)) }
}

// Standard Webhooks: the vector published in Svix's "verifying webhooks manually" guide.
{
  const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'
  const id = 'msg_p5jXN8AQM9LWM0D4loKWxJek'
  const ts = '1614265330'
  const body = '{"test": 2432232314}'
  const sig = 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE='
  const headers = (over = {}) => Object.entries({ 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': sig, ...over })
    .map(([name, value]) => ({ name, value }))

  const good = await verifyWith(headers(), body, secret)
  assert.equal(good.scheme.id, 'standard-webhooks')
  assert.equal(good.scheme.payload, `${id}.${ts}.${body}`, 'signs id.timestamp.body')
  assert.equal(good.result.signature, 'match', "the vendor's published vector verifies")
  assert.equal(good.result.freshness, 'stale', 'a 2021 timestamp is correctly signed and independently stale')
  // The pasted key is base64 after `whsec_`, whatever the dropdown says.
  assert.equal((await verifyWith(headers(), body, secret, {}, 'hex')).result.signature, 'match', 'the scheme fixes the key encoding')
  // Svix's own header names are the same scheme.
  const svix = headers({ 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': sig })
    .filter(h => !h.name.startsWith('webhook-'))
  assert.equal((await verifyWith(svix, body, secret)).result.signature, 'match')
  // One byte changed anywhere in what was signed, or in the signature, must fail.
  assert.equal((await verifyWith(headers(), body + ' ', secret)).result.signature, 'mismatch', 'body byte')
  assert.equal((await verifyWith(headers({ 'webhook-id': id.slice(0, -1) + 'x' }), body, secret)).result.signature, 'mismatch', 'id byte')
  assert.equal((await verifyWith(headers({ 'webhook-timestamp': '1614265331' }), body, secret)).result.signature, 'mismatch', 'timestamp byte')
  assert.equal((await verifyWith(headers({ 'webhook-signature': 'v1,' + flipFirst(sig.slice(3)) }), body, secret)).result.signature, 'mismatch', 'signature byte')
  assert.equal((await verifyWith(headers(), body, 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSx')).result.signature, 'mismatch', 'wrong key')
  // Several signatures during a rotation: any v1 may match; v1a (ed25519) is not v1.
  assert.equal((await verifyWith(headers({ 'webhook-signature': `v1,AAAA ${sig}` }), body, secret)).result.signature, 'match', 'rotation')
  assert.deepEqual(wiDetectScheme(headers({ 'webhook-signature': 'v1a,AAAA' }), body).provided, [], 'v1a is not checked as v1')
}
ok("Standard Webhooks verifies Svix's published vector, fixes its key encoding, and rejects a one-byte change anywhere")

// Twilio: the example in Twilio's "validate requests" documentation.
{
  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2'
  const form = 'CallSid=CA1234567890ABCDE&Caller=%2B12349013030&Digits=1234&From=%2B12349013030&To=%2B18005551212'
  const sig = '0/KCTR6DLpKmkAf8muzZqo1nDgQ='
  const headers = (s = sig) => [
    { name: 'X-Twilio-Signature', value: s },
    { name: 'Content-Type', value: 'application/x-www-form-urlencoded' },
  ]
  const good = await verifyWith(headers(), form, '12345', { url })
  assert.equal(good.scheme.id, 'twilio')
  assert.equal(good.result.signature, 'match', "Twilio's published vector verifies")
  assert.equal((await verifyWith(headers(), form.replace('1234&', '1235&'), '12345', { url })).result.signature, 'mismatch', 'a form value byte')
  assert.equal((await verifyWith(headers(), form, '12345', { url: url.replace('bar=2', 'bar=3') })).result.signature, 'mismatch', 'a URL byte')
  assert.equal((await verifyWith(headers(flipFirst(sig)), form, '12345', { url })).result.signature, 'mismatch', 'a signature byte')
  assert.equal((await verifyWith(headers(), form, '12346', { url })).result.signature, 'mismatch', 'wrong token')
  assert.ok(wiDetectScheme(headers(), form, {}).warning, 'with no URL the missing input is reported')
  // A repeated field contributes its distinct pairs in sorted order (twilio-node's rule).
  const dup = 'A=2&A=1&B=x'
  const dupSig = createHmac('sha1', 'tok').update('https://h.example/p' + 'A1' + 'A2' + 'Bx').digest('base64')
  assert.equal((await verifyWith(headers(dupSig), dup, 'tok', { url: 'https://h.example/p' })).result.signature, 'match')
}
ok("Twilio verifies Twilio's published vector and rejects a one-byte change in a field, the URL, the signature or the token")

// Paddle Billing.
{
  const secret = 'pdl_ntfset_01h_secret'
  const ts = String(Math.floor(Date.now() / 1000))
  const body = '{"event_id":"evt_01","event_type":"transaction.completed","data":{"id":"txn_01"}}'
  const h1 = createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')
  const headers = (v = `ts=${ts};h1=${h1}`) => [{ name: 'Paddle-Signature', value: v }]
  const good = await verifyWith(headers(), body, secret)
  assert.equal(good.scheme.id, 'paddle')
  assert.equal(good.scheme.payload, `${ts}:${body}`, 'Paddle signs ts:body')
  assert.equal(good.result.signature, 'match')
  assert.equal((await verifyWith(headers(), body.replace('01', '02'), secret)).result.signature, 'mismatch')
  assert.equal((await verifyWith(headers(`ts=${ts};h1=${flipFirst(h1)}`), body, secret)).result.signature, 'mismatch')
  assert.equal((await verifyWith(headers(`ts=${Number(ts) + 1};h1=${h1}`), body, secret)).result.signature, 'mismatch')
  assert.equal((await verifyWith(headers(`ts=${ts};h1=${'0'.repeat(64)};h1=${h1}`), body, secret)).result.signature, 'match', 'a second h1 during rotation')
}
ok('Paddle verifies a ts/h1 fixture and rejects a one-byte change (fixture built from the documented algorithm)')

// Mailgun: the signature is in the body, over timestamp + token.
{
  const key = 'key-mailgun-signing'
  const timestamp = '1700000000'
  const token = 'a'.repeat(50)
  const signature = createHmac('sha256', key).update(timestamp + token).digest('hex')
  const jsonBody = JSON.stringify({ signature: { timestamp, token, signature }, 'event-data': { event: 'delivered' } })
  const jsonHeaders = [{ name: 'content-type', value: 'application/json' }]
  const good = await verifyWith(jsonHeaders, jsonBody, key)
  assert.equal(good.scheme.id, 'mailgun')
  assert.equal(good.result.signature, 'match')
  assert.equal((await verifyWith(jsonHeaders, jsonBody.replace(token, 'b' + token.slice(1)), key)).result.signature, 'mismatch', 'token byte')
  assert.equal((await verifyWith(jsonHeaders, jsonBody.replace(signature, flipFirst(signature)), key)).result.signature, 'mismatch', 'signature byte')
  assert.equal((await verifyWith(jsonHeaders, jsonBody.replace(timestamp, '1700000001'), key)).result.signature, 'mismatch', 'timestamp byte')
  const form = `timestamp=${timestamp}&token=${token}&signature=${signature}&event=delivered`
  const formHeaders = [{ name: 'content-type', value: 'application/x-www-form-urlencoded' }]
  assert.equal((await verifyWith(formHeaders, form, key)).result.signature, 'match', 'the legacy form post')
  assert.equal(wiDetectScheme(jsonHeaders, '{"signature":"nope"}'), null, 'a body without the three fields is not Mailgun')
}
ok('Mailgun verifies a fixture found in the JSON and the form body and rejects a one-byte change (built from the documented algorithm)')

// Discord: ed25519 over timestamp + body, checked with a public key.
{
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pubHex = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex')
  const timestamp = '1700000000'
  const body = '{"type":1}'
  const sign = (ts, b) => cryptoSign(null, Buffer.from(ts + b), privateKey).toString('hex')
  const headers = (sig = sign(timestamp, body), ts = timestamp) => [
    { name: 'X-Signature-Ed25519', value: sig },
    { name: 'X-Signature-Timestamp', value: ts },
  ]
  const good = await verifyWith(headers(), body, pubHex)
  assert.equal(good.scheme.id, 'discord')
  assert.equal(good.scheme.kind, 'ed25519')
  assert.equal(good.scheme.keyKind, 'public-key')
  assert.equal(good.result.signature, 'match')
  assert.equal((await verifyWith(headers(), '{"type":2}', pubHex)).result.signature, 'mismatch', 'body byte')
  assert.equal((await verifyWith(headers(sign(timestamp, body), '1700000001'), body, pubHex)).result.signature, 'mismatch', 'timestamp byte')
  assert.equal((await verifyWith(headers(flipFirst(sign(timestamp, body))), body, pubHex)).result.signature, 'mismatch', 'signature byte')
  const other = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }).x
  assert.equal((await verifyWith(headers(), body, Buffer.from(other, 'base64url').toString('hex'))).result.signature, 'mismatch', 'another key')
  await assert.rejects(verifyWith(headers(), body, 'abcd'), /32 bytes/, 'a key of the wrong length is a message, not a verdict')
}
ok('Discord verifies an ed25519 fixture with a public key and rejects a one-byte change (built from the documented algorithm)')

// SendGrid: ECDSA P-256 / SHA-256 over timestamp + raw body, DER signature, SPKI key.
{
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const timestamp = '1700000000'
  const body = '[{"email":"a@example.com","event":"delivered"}]\r\n'
  const sign = (ts, b) => cryptoSign('sha256', Buffer.from(ts + b), privateKey).toString('base64')
  const headers = (sig = sign(timestamp, body), ts = timestamp) => [
    { name: 'X-Twilio-Email-Event-Webhook-Signature', value: sig },
    { name: 'X-Twilio-Email-Event-Webhook-Timestamp', value: ts },
  ]
  const good = await verifyWith(headers(), body, spki)
  assert.equal(good.scheme.id, 'sendgrid')
  assert.equal(good.result.signature, 'match', 'the trailing CRLF is part of what is signed')
  assert.equal((await verifyWith(headers(), body.trimEnd(), spki)).result.signature, 'mismatch', 'dropping the CRLF breaks it')
  assert.equal((await verifyWith(headers(), body.replace('delivered', 'deliverEd'), spki)).result.signature, 'mismatch', 'body byte')
  assert.equal((await verifyWith(headers(sign(timestamp, body), '1700000001'), body, spki)).result.signature, 'mismatch', 'timestamp byte')
  const sig = sign(timestamp, body)
  const tampered = Buffer.from(sig, 'base64')
  tampered[tampered.length - 1] ^= 1
  assert.equal((await verifyWith(headers(tampered.toString('base64')), body, spki)).result.signature, 'mismatch', 'signature byte')
  // DER integers vary in length (a leading zero byte when the top bit is set); 60 signatures cover both.
  for (let i = 0; i < 60; i += 1) {
    const b = `${body}${i}`
    assert.equal((await verifyWith(headers(sign(timestamp, b)), b, spki)).result.signature, 'match', `signature ${i}`)
  }
  assert.equal(wiDerToRawEcdsa(new Uint8Array([0x30, 0x03, 0x02, 0x01])), null, 'a truncated DER signature is refused')
  await assert.rejects(verifyWith(headers(), body, 'AAAA'), /P-256 public key/)
}
ok('SendGrid verifies an ECDSA P-256 fixture (DER signature, SPKI key) and rejects a one-byte change (built from the documented algorithm)')

// The bytes are the bytes: a body that is not UTF-8 verifies from the stored raw bytes.
{
  const secret = 'gh-secret'
  const raw = Uint8Array.from([0x7b, 0x22, 0x62, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0xc3, 0x28, 0x22, 0x7d])
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(raw)
  const stored = rawBodyIfLossy(raw, text)
  assert.ok(stored, 'a body that is not UTF-8 is kept as bytes')
  const digest = createHmac('sha256', secret).update(raw).digest('hex')
  const headers = [{ name: 'x-hub-signature-256', value: `sha256=${digest}` }]
  const key = wiDecodeSecret(secret, 'utf-8')
  const fromBytes = wiDetectScheme(headers, wiBodyBytes({ bodyText: text, bodyBase64: stored }))
  assert.equal((await wiVerifyScheme(fromBytes, key)).signature, 'match', 'raw bytes verify')
  const fromText = wiDetectScheme(headers, text)
  assert.equal((await wiVerifyScheme(fromText, key)).signature, 'mismatch', 'the decoded text alone cannot')
  // Valid UTF-8, a BOM included, costs nothing extra and still round-trips.
  for (const sample of ['{"a":"héllo ✓"}', '﻿{"bom":true}', '']) {
    const bytes = enc(sample)
    const decoded = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
    assert.equal(rawBodyIfLossy(bytes, decoded), undefined, `valid UTF-8 needs no raw copy: ${JSON.stringify(sample)}`)
    assert.deepEqual([...wiBodyBytes({ bodyText: decoded })], [...bytes])
  }
  assert.equal(rawBodyIfLossy(enc('x�y'), 'x�y'), undefined, 'a real U+FFFD in valid UTF-8 is not lossy')
}
ok('signatures are checked over the exact bytes: a non-UTF-8 body verifies from its raw copy and not from decoded text')

/* ======================================================================== */
/* configured response: bounds                                              */
/* ======================================================================== */

{
  const good = { status: 200, headers: [], contentType: 'application/json', body: '{"ok":true}' }
  assert.equal(validateBinResponse(good).ok, true)
  const bad = (patch, what) => {
    const r = validateBinResponse({ ...good, ...patch })
    assert.equal(r.ok, false, what)
    assert.ok(typeof r.error === 'string' && r.error.length > 10, `${what}: a plain sentence`)
    return r.error
  }
  for (const status of [0, 99, 100, 101, 103, 199, 600, 200.5, '200', null, NaN]) bad({ status }, `status ${String(status)}`)
  assert.match(bad({ status: 101 }), /1xx/, 'the 1xx refusal says why')
  for (const status of [200, 201, 204, 301, 429, 500, 599]) {
    const patch = status >= 301 && status <= 308 ? { status, headers: [{ name: 'Location', value: 'https://example.com/x' }] } : { status, body: status === 204 ? '' : 'x' }
    assert.equal(validateBinResponse({ ...good, ...patch }).ok, true, `status ${status}`)
  }
  bad({ status: 204, body: 'x' }, '204 cannot carry a body')
  bad({ status: 304, body: 'x' }, '304 cannot carry a body')

  const eight = Array.from({ length: WEBHOOK_MAX_RESPONSE_HEADERS }, (_, i) => ({ name: `x-h${i}`, value: 'v' }))
  assert.equal(validateBinResponse({ ...good, headers: eight }).ok, true, 'exactly eight headers')
  bad({ headers: [...eight, { name: 'x-h9', value: 'v' }] }, 'nine headers')
  assert.equal(validateBinResponse({ ...good, headers: [{ name: 'x-big', value: 'v'.repeat(250) }] }).ok, true, '256 characters of name plus value')
  bad({ headers: [{ name: 'x-big', value: 'v'.repeat(252) }] }, 'a header over 256 characters')
  bad({ headers: [{ name: 'x-a', value: '1' }, { name: 'X-A', value: '2' }] }, 'a duplicate header')
  bad({ headers: [{ name: 'x-a', value: 'a\r\nSet-Cookie: s=1' }] }, 'a header value that injects a line')
  bad({ headers: [{ name: 'x-a', value: 'café' }] }, 'a non-ASCII header value')
  bad({ headers: [{ name: 'x a', value: '1' }] }, 'a header name with a space')
  for (const name of [
    'set-cookie', 'set-cookie2', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'proxy-authenticate',
    'content-length', 'content-type', 'content-encoding', 'host', 'www-authenticate', 'refresh', 'content-location',
    'cache-control', 'expires', 'etag', 'last-modified', 'age', 'vary', 'content-security-policy', 'strict-transport-security',
    'access-control-allow-origin', 'x-frame-options', 'x-content-type-options', 'x-robots-tag', 'x-origin-auth', 'x-forwarded-for',
    'x-accel-redirect', 'x-sendfile', 'link', 'alt-svc', 'location-x',
  ]) {
    assert.equal(isAllowedResponseHeader(name), false, `${name} is not an allowed response header`)
    assert.equal(validateBinResponse({ ...good, headers: [{ name, value: 'v' }] }).ok, false, `${name} is refused`)
  }
  for (const name of ['location', 'retry-after', 'content-language', 'allow', 'ratelimit-limit', 'x-request-id', 'x-anything-custom']) {
    assert.equal(isAllowedResponseHeader(name), true, `${name} is allowed`)
  }

  assert.equal(validateBinResponse({ ...good, body: 'a'.repeat(WEBHOOK_MAX_RESPONSE_BODY_BYTES) }).ok, true, '8 KB exactly')
  bad({ body: 'a'.repeat(WEBHOOK_MAX_RESPONSE_BODY_BYTES + 1) }, 'one byte over 8 KB')
  bad({ body: 'é'.repeat(WEBHOOK_MAX_RESPONSE_BODY_BYTES / 2 + 1) }, 'multi-byte text is counted in bytes, not characters')
  bad({ body: 5 }, 'a body that is not text')

  for (const type of ['text/html', 'text/html; charset=utf-8', 'application/xhtml+xml', 'image/svg+xml', 'application/javascript', 'text/javascript', 'multipart/form-data; boundary=x', 'text', 'application/json; boundary=x', 'application/json\r\nX: y']) {
    assert.equal(safeResponseContentType(type), null, `${type} is not served`)
    bad({ contentType: type }, `content type ${type}`)
  }
  for (const type of ['application/json', 'Application/JSON; charset=UTF-8', 'text/plain', 'text/csv', 'application/xml', 'text/xml', 'application/octet-stream', 'application/problem+json']) {
    assert.ok(safeResponseContentType(type), `${type} is served`)
  }
  assert.equal(safeResponseContentType('Application/JSON; charset=UTF-8'), 'application/json; charset=utf-8', 'normalised')

  // Redirects need a Location, and the Location is held to the SSRF guard.
  for (const status of [301, 302, 303, 307, 308]) bad({ status }, `${status} needs a Location`)
  for (const target of [
    'http://127.0.0.1/', 'http://localhost/', 'http://10.0.0.5/x', 'http://172.16.0.1/', 'http://172.31.255.255/', 'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://[fc00::1]/', 'http://[fd12:3456::1]/', 'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/', 'http://[::ffff:10.0.0.1]/', 'http://[::ffff:169.254.169.254]/', 'http://0x7f000001/', 'http://2130706433/',
    'http://metadata.google.internal/', 'http://router/', 'http://printer.local/',
    'ftp://example.com/', 'javascript:alert(1)', '/relative/path', '//example.com/x', 'https://user:pw@example.com/', 'https://example.com:8443/', 'not a url',
  ]) {
    const r = validateBinResponse({ ...good, status: 302, headers: [{ name: 'Location', value: target }] })
    assert.equal(r.ok, false, `Location ${target} must be refused`)
  }
  assert.equal(validateBinResponse({ ...good, status: 302, headers: [{ name: 'Location', value: 'https://example.com/next?a=1' }] }).ok, true)
  assert.equal(validateBinResponse({ ...good, status: 201, headers: [{ name: 'Location', value: 'http://127.0.0.1/' }] }).ok, false, 'a Location on a non-redirect is held to the same rule')

  // No refusal echoes what was sent.
  const marker = 'ZZ-MARKER-ZZ'
  for (const input of [
    { ...good, status: marker }, { ...good, contentType: `text/html;${marker}` }, { ...good, body: 7, marker },
    { ...good, headers: [{ name: `x-${marker}`.repeat(30), value: 'v' }] }, { ...good, headers: [{ name: 'set-cookie', value: marker }] },
    { ...good, status: 302, headers: [{ name: 'location', value: `http://127.0.0.1/${marker}` }] },
    { ...good, headers: [{ name: 'x-a', value: `${marker}\r\nX-Evil: 1` }] }, marker, [marker],
  ]) {
    const r = validateBinResponse(input)
    assert.equal(r.ok, false)
    assert.ok(!r.error.includes(marker), `a refusal never echoes the input: ${r.error}`)
  }
}
ok('a configured response is held to its bounds: status 200-599, 8 headers of 256 characters from an allowlist, 8 KB body, safe content types, public Location only; refusals echo nothing')

// The configured response is counted in the global byte budget.
{
  configurePersistence(null)
  const bins = []
  const fillTo = (count, bodyLen) => {
    for (let i = 0; i < count; i += 1) {
      if (i % WEBHOOK_MAX_REQUESTS_PER_BIN === 0) bins.push(newBin())
      recordRequest(bins.at(-1), mkReq({ headers: [], bodyText: 'a'.repeat(bodyLen), size: bodyLen }))
    }
  }
  // 254 requests of 65,536 characters (65,792 bytes each as accounted) and one of 64,000:
  // 1,792 bytes under the 16 MB ceiling.
  fillTo(254, WEBHOOK_MAX_BODY_BYTES)
  recordRequest(bins.at(-1), mkReq({ headers: [], bodyText: 'a'.repeat(64000), size: 64000 }))
  assert.equal(WEBHOOK_MAX_TOTAL_BYTES - (254 * (WEBHOOK_MAX_BODY_BYTES + 256) + 64000 + 256), 1792)
  const first = bins[0]
  assert.equal(listRequests(first).length, WEBHOOK_MAX_REQUESTS_PER_BIN, 'nothing evicted yet')
  setBinResponse(newBin(), { status: 200, headers: [], contentType: 'text/plain', body: '' })
  assert.equal(listRequests(first).length, WEBHOOK_MAX_REQUESTS_PER_BIN, 'an empty response fits under the ceiling')
  setBinResponse(newBin(), { status: 200, headers: [], contentType: 'text/plain', body: 'b'.repeat(8000) })
  assert.equal(listRequests(first).length, 0, 'an 8 KB response pushed the store over its ceiling, so the least-recently-used bin was evicted')
  configurePersistence(null)
}
ok('a configured response body counts against the 16 MB global byte budget')

/* ======================================================================== */
/* copy as curl                                                             */
/* ======================================================================== */

{
  const captured = (over = {}) => ({
    method: 'POST',
    headers: [
      { name: 'host', value: 'apanjwani0.com' },
      { name: 'connection', value: 'keep-alive' },
      { name: 'content-length', value: '999' },
      { name: 'transfer-encoding', value: 'chunked' },
      { name: 'cf-connecting-ip', value: '203.0.113.9' },
      { name: 'cf-ray', value: 'abc' },
      { name: 'x-forwarded-for', value: '203.0.113.9' },
      { name: 'x-real-ip', value: '203.0.113.9' },
      { name: 'accept-encoding', value: 'gzip' },
      { name: 'content-type', value: 'application/json' },
      { name: 'x-signature', value: "it's=signed" },
      { name: 'authorization', value: 'Bearer abc' },
    ],
    bodyText: `{"quote":"it's","nl":"a\nb"}`,
    bodyTruncated: false,
    ...over,
  })
  for (const dropped of ['host', 'connection', 'content-length', 'transfer-encoding', 'cf-connecting-ip', 'cf-ray', 'x-forwarded-for', 'x-real-ip', 'accept-encoding', 'keep-alive', 'upgrade', 'te', 'proxy-authorization', 'x-origin-auth']) {
    assert.equal(wiReplayHeader(dropped), false, `${dropped} is not replayed`)
  }
  for (const kept of ['content-type', 'authorization', 'x-signature', 'stripe-signature', 'user-agent']) assert.equal(wiReplayHeader(kept), true, `${kept} is replayed`)

  // Run the command through a real shell with `curl` stubbed to dump what it received.
  const dir = await mkdtemp(path.join(tmpdir(), 'wh-curl-'))
  try {
    const run = async command => {
      const args = path.join(dir, 'args')
      const body = path.join(dir, 'body')
      await rm(args, { force: true })
      await rm(body, { force: true })
      const script = `curl() { printf '%s\\0' "$@" > "${args}"; for a in "$@"; do if [ "$a" = "@-" ]; then cat > "${body}"; fi; done; }\n${command}\n`
      const res = spawnSync('sh', ['-c', script], { encoding: 'utf-8' })
      assert.equal(res.status, 0, `the command must run in sh: ${res.stderr}`)
      return {
        argv: (await readFile(args, 'utf-8')).split('\0').slice(0, -1),
        body: await readFile(body).catch(() => null),
      }
    }
    const url = 'https://apanjwani0.com/api/hook/BIN?a=1&b=it%27s'
    const text = await run(wiCurlCommand(captured(), url))
    assert.deepEqual(text.argv, [
      '-X', 'POST', url,
      '-H', 'content-type: application/json',
      '-H', "x-signature: it's=signed",
      '-H', 'authorization: Bearer abc',
      '--data-binary', `{"quote":"it's","nl":"a\nb"}`,
    ], 'method, URL, kept headers and the body arrive as the shell parsed them')

    const bytes = Uint8Array.from([0x7b, 0xff, 0xfe, 0x00, 0x27, 0x7d])
    const raw = await run(wiCurlCommand(captured({ bodyText: '{��\u0000\'}', bodyBase64: Buffer.from(bytes).toString('base64') }), url))
    assert.deepEqual([...raw.body], [...bytes], 'a body that is not text is piped in byte for byte')
    assert.ok(raw.argv.includes('@-'))

    const get = await run(wiCurlCommand({ method: 'GET', headers: [], bodyText: '', bodyTruncated: false }, url))
    assert.deepEqual(get.argv, [url], 'a plain GET is just the URL')
    const head = await run(wiCurlCommand({ method: 'HEAD', headers: [], bodyText: '', bodyTruncated: false }, url))
    assert.deepEqual(head.argv, ['--head', url])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  assert.match(wiCurlCommand(captured({ bodyTruncated: true }), 'https://x.example/'), /^# The captured body was cut off/)
}
ok('copy as curl keeps method, headers and exact body bytes, drops hop-by-hop and edge-added headers, and survives a real shell')

/* ======================================================================== */
/* resend to URL                                                            */
/* ======================================================================== */

{
  const dnsFor = answers => ({ resolve: async () => answers })
  const reasons = new Set()
  const refuse = async (url, dns) => {
    const r = await replayResolvePinned(url, dns)
    assert.equal(r.ok, false, `${url} must be refused`)
    assert.ok(!r.error.includes(new URL(url, 'http://placeholder.invalid').hostname) || !url.includes('.'), 'a fixed sentence')
    reasons.add(r.error)
  }
  for (const url of [
    'http://127.0.0.1/', 'http://127.1/', 'http://0.0.0.0/', 'http://10.1.2.3/hook', 'http://172.16.0.9/', 'http://172.31.1.1/', 'http://192.168.0.10/',
    'http://169.254.169.254/latest/meta-data/', 'http://100.64.0.1/', 'http://[::1]/', 'http://[fc00::1]/', 'http://[fd00::abcd]/', 'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:10.0.0.1]/', 'http://[::ffff:192.168.1.1]/', 'http://[::ffff:169.254.169.254]/', 'http://[::ffff:a9fe:a9fe]/',
    'http://[2002:7f00:1::]/', 'http://[64:ff9b::7f00:1]/', 'http://localhost/', 'http://app.localhost/', 'http://db.internal/', 'http://printer.local/', 'http://intranet/',
    'https://127.0.0.1/', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://017700000001/',
    'ftp://example.com/', 'file:///etc/passwd', 'gopher://example.com/', 'javascript:alert(1)', 'https://user:pass@example.com/', 'https://example.com:8080/', 'http://example.com:22/', 'nonsense', '',
  ]) await refuse(url)
  // A name is only as good as every address it answers with.
  await refuse('https://rebind.example.test/', dnsFor([{ address: '127.0.0.1', family: 4 }]))
  await refuse('https://rebind.example.test/', dnsFor([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }]))
  await refuse('https://rebind.example.test/', dnsFor([{ address: '::ffff:10.0.0.1', family: 6 }]))
  await refuse('https://rebind.example.test/', dnsFor([{ address: '169.254.169.254', family: 4 }]))
  await refuse('https://gone.example.test/', dnsFor([]))
  await refuse('https://gone.example.test/', { resolve: async () => { throw new Error('ENOTFOUND') } })
  await refuse('https://slow.example.test/', { resolve: () => new Promise(() => {}), timeoutMs: 40 })
  const pinned = await replayResolvePinned('https://public.example.test/a?b=1', dnsFor([{ address: '93.184.216.34', family: 4 }, { address: '93.184.216.35', family: 4 }]))
  assert.equal(pinned.ok, true)
  assert.equal(pinned.address, '93.184.216.34')
  assert.equal((await replayResolvePinned('http://93.184.216.34/')).ok, true, 'a public literal needs no lookup')
  assert.ok(reasons.size >= 3 && [...reasons].every(r => !/https?:|\d+\.\d+\.\d+\.\d+/.test(r)), 'refusal sentences are fixed and carry no address')

  // Send for real against a local server, through a transport that proves the pin.
  const seen = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) })
      if (req.url.startsWith('/big')) return res.end(Buffer.alloc(200_000, 0x61))
      if (req.url.startsWith('/redirect')) { res.writeHead(302, { location: 'http://127.0.0.1/' }); return res.end() }
      if (req.url.startsWith('/hang')) return // never answers
      res.writeHead(201, { 'content-type': 'text/plain' })
      res.end('hello from the target')
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  let pinnedTo = null
  const transport = {
    request(options, cb) {
      // What the socket would ask the resolver; it must get the checked address back, whatever it asks.
      options.lookup('rebinding.example.test', { all: true }, (_e, list) => { pinnedTo = list[0].address })
      options.lookup('rebinding.example.test', {}, (_e, address) => { assert.equal(address, pinnedTo) })
      return http.request({ ...options, lookup: undefined, hostname: '127.0.0.1', port, protocol: 'http:' }, cb)
    },
  }
  const opts = { dns: dnsFor([{ address: '93.184.216.34', family: 4 }]), transport }
  try {
    const bytes = Uint8Array.from([0x7b, 0xff, 0xfe, 0x7d])
    const req = mkReq({
      method: 'POST',
      headers: [
        { name: 'host', value: 'apanjwani0.com' }, { name: 'connection', value: 'close' }, { name: 'cf-connecting-ip', value: '203.0.113.9' },
        { name: 'x-forwarded-for', value: '203.0.113.9' }, { name: 'content-type', value: 'application/octet-stream' },
        { name: 'stripe-signature', value: 't=1,v1=abc' },
      ],
      bodyText: '{��}', bodyBase64: Buffer.from(bytes).toString('base64'),
    })
    const secretTarget = 'https://secret-target-host.example.test/path?token=SECRETQUERY'
    const sent = await replayRequest(req, `${secretTarget}`, opts)
    assert.equal(sent.ok, true, JSON.stringify(sent))
    assert.equal(sent.status, 201)
    assert.equal(sent.preview, 'hello from the target')
    assert.equal(pinnedTo, '93.184.216.34', 'the socket was handed the checked address and nothing else')
    assert.ok(!JSON.stringify(sent).includes('secret-target-host') && !JSON.stringify(sent).includes('SECRETQUERY'), 'the target is not echoed on success either')
    const got = seen.at(-1)
    assert.equal(got.method, 'POST')
    assert.equal(got.url, '/path?token=SECRETQUERY')
    assert.deepEqual([...got.body], [...bytes], 'the exact body bytes arrive')
    assert.equal(got.headers['stripe-signature'], 't=1,v1=abc', 'signature headers are kept')
    assert.equal(got.headers['x-forwarded-for'], undefined)
    assert.equal(got.headers['cf-connecting-ip'], undefined)
    assert.equal(got.headers['x-webhook-inspector-replay'], '1', 'the receiver can tell it is a replay')

    const big = await replayRequest(mkReq({ method: 'GET', bodyText: '', size: 0 }), 'http://public.example.test/big', opts)
    assert.equal(big.ok, true)
    assert.ok(big.bytes <= REPLAY_MAX_RESPONSE_BYTES && big.preview.length <= REPLAY_PREVIEW_BYTES && big.previewTruncated, 'a 200 KB answer is capped at 64 KB read and 2 KB shown')

    const before = seen.length
    const redirected = await replayRequest(mkReq({ method: 'GET', bodyText: '', size: 0 }), 'http://public.example.test/redirect', opts)
    assert.equal(redirected.status, 302, 'a redirect is reported, not followed')
    assert.equal(seen.length, before + 1, 'and nothing else was requested')

    assert.equal((await replayRequest(mkReq({ bodyTruncated: true }), 'http://public.example.test/', opts)).kind, 'refused', 'a truncated body is not replayed as if whole')
    assert.equal((await replayRequest(mkReq({ method: 'CONNECT' }), 'http://public.example.test/', opts)).kind, 'refused')
    const privateOnly = await replayRequest(mkReq(), 'http://10.0.0.1/secret-marker-path', opts)
    assert.equal(privateOnly.kind, 'refused')
    assert.ok(!JSON.stringify(privateOnly).includes('secret-marker-path') && !JSON.stringify(privateOnly).includes('10.0.0.1'), 'a refusal does not echo the URL')
    assert.ok(seen.every(s => !s.url.includes('secret-marker-path')), 'a refused address is never dialled')

    // Time and concurrency: four hang for the full timeout, the fifth is turned away at once.
    const t0 = Date.now()
    const hanging = Array.from({ length: REPLAY_MAX_INFLIGHT }, () => replayRequest(mkReq({ method: 'GET', bodyText: '', size: 0 }), 'http://public.example.test/hang', opts))
    await new Promise(r => setTimeout(r, 60))
    const turnedAway = await replayRequest(mkReq({ method: 'GET', bodyText: '', size: 0 }), 'http://public.example.test/', opts)
    assert.equal(turnedAway.kind, 'busy', 'no more than REPLAY_MAX_INFLIGHT sends at once')
    const timedOut = await Promise.all(hanging)
    assert.ok(timedOut.every(r => !r.ok && r.kind === 'timeout'), 'a server that never answers is cut off')
    const took = Date.now() - t0
    assert.ok(took >= REPLAY_TIMEOUT_MS - 100 && took < REPLAY_TIMEOUT_MS + 2500, `the whole send is bounded at ${REPLAY_TIMEOUT_MS} ms (took ${took})`)
  } finally {
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  }
}
ok('resend refuses loopback, private, link-local, metadata, ULA, ::ffff: mapped, 6to4 and NAT64 forms, bad schemes and ports; pins the connection to the checked address; never follows redirects; caps time and bytes; never echoes the URL')

// The route: ids, origin, limiter order.
{
  const { POST } = await import('../../src/pages/api/hook/[bin]/requests/[id]/replay.ts')
  const bin = newBin()
  const req = mkReq({ method: 'POST', bodyText: 'x=1', size: 3 })
  recordRequest(bin, req)
  const post = (ip, url, over = {}) => POST({
    params: { bin: over.bin ?? bin, id: over.id ?? req.id },
    request: asRequest(ip, 'http://localhost/api/hook/x/requests/y/replay', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(over.headers ?? {}) }, body: JSON.stringify({ url }),
    }),
  })
  const target = 'http://169.254.169.254/latest/meta-data/iam'
  const refused = await post('198.51.100.1', target)
  assert.equal(refused.status, 400)
  const text = await refused.text()
  assert.ok(!text.includes('169.254') && !text.includes('iam'), 'the route never echoes the URL')
  assert.equal(refused.headers.get('cache-control'), 'no-store')
  assert.equal((await post('198.51.100.1', target, { headers: { origin: 'https://evil.example' } })).status, 403, 'cross-origin is refused')
  assert.equal((await post('198.51.100.1', target, { bin: 'short' })).status, 404)
  assert.equal((await post('198.51.100.1', target, { id: '../../etc' })).status, 404)
  assert.equal((await post('198.51.100.1', target, { id: crypto.randomUUID() })).status, 404)
  const noUrl = await POST({ params: { bin, id: req.id }, request: asRequest('198.51.100.2', 'http://localhost/x', { method: 'POST', body: '{}' }) })
  assert.equal(noUrl.status, 400)

  // 6 a minute per client. 198.51.100.1 has used 5 (2 refused-by-id calls count: the limiter is asked first).
  const A = '198.51.100.50'
  const statuses = []
  for (let i = 0; i < 40; i += 1) statuses.push((await post(A, target)).status)
  assert.equal(statuses.filter(s => s === 429).length, 34, 'six a minute per client, the rest 429')
  // The shared bucket (24 a minute) was asked only for the six that passed, so
  // 40 hits from one client left room for others. Reversed, A alone would have drained it.
  const others = []
  // 12 shared hits so far (5 + 1 + A's 6); 12 more clients make 24.
  for (let i = 0; i < 12; i += 1) others.push((await post(`198.51.100.${100 + i}`, target)).status)
  assert.ok(others.every(s => s === 400), `other clients are unaffected by a refused one: ${others}`)
  assert.equal((await post('198.51.100.200', target)).status, 429, 'the shared bucket then caps every client together')
}
ok('the resend route validates both ids, checks the origin, never echoes the URL, and asks the shared limiter only after the client limiter says yes')

/* ======================================================================== */
/* the live stream                                                          */
/* ======================================================================== */

{
  const { GET } = await import('../../src/pages/api/hook/[bin]/stream.ts')
  const open = (bin, ip) => GET({ params: { bin }, request: asRequest(ip, `http://localhost/api/hook/${bin}/stream`) })
  const decoder = new TextDecoder()
  const reader = res => res.body.getReader()
  const readText = async r => decoder.decode((await r.read()).value ?? new Uint8Array())
  const readUntil = async (r, needle, limit = 20) => {
    let text = ''
    for (let i = 0; i < limit && !text.includes(needle); i += 1) {
      const { value, done } = await r.read()
      if (done) break
      text += decoder.decode(value)
    }
    return text
  }

  // Order: one client hammering must not drain the shared bucket.
  const hammer = '203.0.113.200'
  let passed = 0
  for (let i = 0; i < 200; i += 1) {
    const res = await open(newBin(), hammer)
    if (res.status === 200) { passed += 1; await res.body.cancel() } else assert.equal(res.status, 429)
  }
  assert.equal(passed, 12, 'twelve opens a minute per client')
  assert.equal(openStreamCount(), 0, 'a cancelled stream gives its slot back')
  const polite = await open(newBin(), '203.0.113.201')
  assert.equal(polite.status, 200, 'another client is not starved by the one that was refused')
  await polite.body.cancel()

  // Shape, and one stream per client per bin.
  const bin = newBin()
  const first = await open(bin, '203.0.113.10')
  assert.equal(first.status, 200)
  assert.match(first.headers.get('content-type'), /^text\/event-stream/)
  assert.equal(first.headers.get('cache-control'), 'no-store')
  assert.equal(first.headers.get('x-accel-buffering'), 'no')
  const dup = await open(bin, '203.0.113.10')
  assert.equal(dup.status, 409, 'a second stream for the same client and bin is refused')
  assert.equal(dup.headers.get('cache-control'), 'no-store')
  const other = await open(bin, '203.0.113.11')
  assert.equal(other.status, 200, 'a different client may stream the same bin')
  await other.body.cancel()
  assert.equal((await open('short', '203.0.113.12')).status, 404)

  // Events: the same JSON the poll returns.
  const r1 = reader(first)
  const head = await readUntil(r1, 'event: ready')
  assert.match(head, /retry: 3000/)
  assert.match(head, /event: ready/)
  const sent = mkReq({ headers: [{ name: 'x-a', value: 'b\nc' }], bodyText: 'line1\nline2' })
  recordRequest(bin, sent)
  const frame = await readUntil(r1, 'event: request')
  const data = frame.split('\n').find(l => l.startsWith('data: '))
  assert.deepEqual(JSON.parse(data.slice(6)), listRequests(bin)[0], 'a request event carries one element of the poll list')
  assert.ok(frame.includes(`id: ${sent.id}\n`))
  clearBin(bin)
  assert.match(await readUntil(r1, 'event: cleared'), /event: cleared/)

  // Process-wide cap: 64 slots, the 65th is a 503 with a fixed sentence.
  const base = openStreamCount()
  const extra = []
  for (let i = base; i < WEBHOOK_MAX_STREAMS; i += 1) {
    const res = await open(newBin(), `192.0.2.${i}`)
    assert.equal(res.status, 200, `stream ${i + 1} of ${WEBHOOK_MAX_STREAMS}`)
    extra.push(res)
  }
  assert.equal(openStreamCount(), WEBHOOK_MAX_STREAMS)
  const over = await open(newBin(), '192.0.2.250')
  assert.equal(over.status, 503)
  assert.ok(!(await over.text()).includes('192.0.2'), 'a fixed sentence')
  assert.equal(over.headers.get('cache-control'), 'no-store')
  await r1.cancel()
  for (const res of extra) await res.body.cancel()
  assert.equal(openStreamCount(), 0, 'every cancelled stream released its slot')
  const slot = acquireStreamSlot('x'.repeat(24), 'a')
  assert.equal(slot.ok, true)
  assert.equal(acquireStreamSlot('x'.repeat(24), 'a').ok, false, 'one slot per client and bin')
  slot.release()
  slot.release()
  assert.equal(openStreamCount(), 0, 'release is idempotent')

  // The bin going away closes the stream, with a reason.
  const goneBin = newBin()
  recordRequest(goneBin, mkReq())
  const gone = await open(goneBin, '192.0.2.200')
  const rg = reader(gone)
  await readUntil(rg, 'event: ready')
  const realNow = Date.now
  Date.now = () => realNow() + WEBHOOK_BIN_TTL_MS + 60_000
  try { listRequests(goneBin) } finally { Date.now = realNow }
  const bye = await readUntil(rg, 'event: bye')
  assert.match(bye, /event: bye\ndata: \{"reason":"expired"\}/)
  assert.equal((await rg.read()).done, true, 'and the stream ends')
  assert.equal(openStreamCount(), 0)

  const evictedBin = newBin()
  recordRequest(evictedBin, mkReq())
  const ev = await open(evictedBin, '192.0.2.201')
  const re = reader(ev)
  await readUntil(re, 'event: ready')
  for (let i = 0; i < WEBHOOK_MAX_BINS; i += 1) recordRequest(newBin(), mkReq({ bodyText: '' }))
  assert.match(await readUntil(re, 'event: bye'), /"reason":"evicted"/)
  assert.equal(openStreamCount(), 0)
  configurePersistence(null)

  // A reader that stops reading is closed, not buffered for.
  const slowBin = newBin()
  const slow = await open(slowBin, '192.0.2.202')
  assert.equal(openStreamCount(), 1)
  for (let i = 0; i < 12; i += 1) recordRequest(slowBin, mkReq({ bodyText: 'z'.repeat(WEBHOOK_MAX_BODY_BYTES) }))
  assert.equal(openStreamCount(), 0, 'a stream whose reader fell 256 KB behind was closed')
  await slow.body.cancel()
  configurePersistence(null)

  // Time: keep-alive every 20 s, a hard close at 25 minutes, with the clock under test control.
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() })
  try {
    const timed = await open(newBin(), '192.0.2.203')
    const rt = reader(timed)
    await readUntil(rt, 'event: ready')
    mock.timers.tick(WEBHOOK_STREAM_KEEPALIVE_MS)
    assert.match(await readUntil(rt, ': keep-alive'), /: keep-alive/, 'a keep-alive comment every 20 s')
    mock.timers.tick(WEBHOOK_STREAM_MAX_MS)
    const last = await readUntil(rt, 'event: bye', 5000)
    assert.match(last, /"reason":"max-age"/, 'a hard close after 25 minutes')
    assert.equal((await rt.read()).done, true)
    assert.equal(openStreamCount(), 0)
  } finally {
    mock.timers.reset()
  }
}
ok('the stream is text/event-stream with no-store and X-Accel-Buffering: no; one per client per bin, 64 in the process (then a 503), a hard close at 25 minutes, a keep-alive every 20 s, closed on expiry or eviction and on a slow reader; events carry the poll\'s JSON')

assert.equal(WEBHOOK_MAX_STREAMS, 64)
assert.equal(WEBHOOK_STREAM_MAX_MS, 25 * 60 * 1000)
assert.equal(WEBHOOK_STREAM_KEEPALIVE_MS, 20_000)

/* ======================================================================== */
/* the response route and the capture route                                 */
/* ======================================================================== */

{
  const respRoute = await import('../../src/pages/api/hook/[bin]/response.ts')
  const capture = await import('../../src/pages/api/hook/[bin].ts')
  const put = (bin, ip, body, headers = {}) => respRoute.PUT({
    params: { bin },
    request: asRequest(ip, 'http://localhost/api/hook/x/response', { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }),
  })
  const hit = (bin, ip, query = '', init = {}) => capture.ALL({
    params: { bin },
    request: asRequest(ip, `http://localhost/api/hook/x${query}`, { method: 'POST', body: 'payload', ...init }),
  })

  const bin = newBin()
  const ip = '198.18.0.1'
  // Default first.
  let res = await hit(bin, ip)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true, captured: true, method: 'POST', bin })

  res = await put(bin, ip, { status: 418, headers: [{ name: 'Retry-After', value: '30' }, { name: 'X-Custom', value: 'yes' }], body: '{"teapot":true}', contentType: 'application/json' })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.equal((await respRoute.GET({ params: { bin }, request: asRequest(ip) }).json()).response.status, 418)

  res = await hit(bin, ip)
  assert.equal(res.status, 418, 'the configured status is served')
  assert.equal(res.headers.get('retry-after'), '30')
  assert.equal(res.headers.get('x-custom'), 'yes')
  assert.equal(res.headers.get('content-type'), 'application/json')
  assert.equal(await res.text(), '{"teapot":true}')
  assert.equal(res.headers.get('cache-control'), 'no-store', 'the API\'s no-store stands')
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  assert.equal(listRequests(bin).length, 2, 'and the request was still captured')

  // The query knobs still override.
  assert.equal((await hit(bin, ip, '?status=503')).status, 503, '?status overrides the configured status')
  res = await hit(bin, ip, '?echo=1', { headers: { 'content-type': 'text/plain' } })
  assert.equal(await res.text(), 'payload', '?echo overrides the configured body')
  const t0 = Date.now()
  await hit(bin, ip, '?delay=300')
  assert.ok(Date.now() - t0 >= 280, '?delay still waits')

  // Echo no longer reflects an HTML content type from this origin.
  res = await hit(bin, ip, '?echo=1', { headers: { 'content-type': 'text/html' }, body: '<script>alert(1)</script>' })
  assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8', 'an echoed text/html is served as text')
  res = await hit(bin, ip, '?echo=1', { headers: { 'content-type': 'application/xml' }, body: '<a/>' })
  assert.equal(res.headers.get('content-disposition'), 'attachment', 'echoed XML is an attachment, not a page')

  // A bodiless status keeps its headers and sends no body.
  await put(bin, ip, { status: 204, headers: [{ name: 'x-done', value: '1' }], body: '', contentType: 'text/plain' })
  res = await hit(bin, ip)
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('x-done'), '1')
  assert.equal(await res.text(), '')

  // XML (TwiML) is served as an attachment so a browser does not render it.
  await put(bin, ip, { status: 200, headers: [], body: '<Response><Say>Hi</Say></Response>', contentType: 'text/xml' })
  res = await hit(bin, ip)
  assert.equal(res.headers.get('content-type'), 'text/xml')
  assert.equal(res.headers.get('content-disposition'), 'attachment')

  // A public redirect target is accepted (a literal address needs no lookup); a private one is not.
  assert.equal((await put(bin, ip, { status: 302, headers: [{ name: 'Location', value: 'https://93.184.216.34/next' }], body: '' })).status, 200)
  res = await hit(bin, ip)
  assert.equal(res.status, 302)
  assert.equal(res.headers.get('location'), 'https://93.184.216.34/next')
  const refused = await put(bin, ip, { status: 302, headers: [{ name: 'Location', value: 'http://169.254.169.254/latest' }], body: '' })
  assert.equal(refused.status, 400)
  assert.ok(!(await refused.text()).includes('169.254'))
  assert.equal(getBinResponse(bin).headers[0].value, 'https://93.184.216.34/next', 'a refused save leaves the previous answer in place')

  // Request-level bounds and errors.
  assert.equal((await put(bin, ip, 'not json')).status, 400)
  assert.equal((await put(bin, ip, JSON.stringify({ status: 200, body: 'x'.repeat(70_000) }))).status, 413)
  assert.equal((await put(bin, ip, { status: 200, body: 'ok' }, { origin: 'https://evil.example' })).status, 403, 'cross-origin writes are refused')
  assert.equal((await put('short', ip, { status: 200 })).status, 404)
  assert.equal((await put(bin, ip, { status: 101 })).status, 400)
  res = await respRoute.DELETE({ params: { bin }, request: asRequest(ip, 'http://localhost/x', { method: 'DELETE' }) })
  assert.equal(res.status, 204)
  assert.equal(getBinResponse(bin), null)
  assert.equal((await respRoute.DELETE({ params: { bin }, request: asRequest(ip, 'http://localhost/x', { method: 'DELETE', headers: { origin: 'https://evil.example' } }) })).status, 403)
  assert.equal((await hit(bin, ip)).status, 200, 'back to the default')

  // Per client first, then shared: 20 a minute for one client; another client is unaffected.
  const B = '198.18.0.2'
  const codes = []
  for (let i = 0; i < 40; i += 1) codes.push((await put(newBin(), B, { status: 200, body: 'x' })).status)
  assert.equal(codes.filter(c => c === 429).length, 20, 'twenty saves a minute per client')
  assert.equal((await put(newBin(), '198.18.0.3', { status: 200, body: 'x' })).status, 200, 'and one client\'s excess does not touch the others')

  // The capture route: raw bytes kept only when needed; the origin-lock secret never stored.
  const binRaw = newBin()
  const ipRaw = '198.18.0.9'
  await capture.ALL({ params: { bin: binRaw }, request: asRequest(ipRaw, 'http://localhost/api/hook/x', { method: 'POST', body: Uint8Array.from([0x7b, 0xff, 0xfe, 0x7d]), headers: { 'x-origin-auth': 'SECRET', 'content-type': 'application/octet-stream' } }) })
  await capture.ALL({ params: { bin: binRaw }, request: asRequest(ipRaw, 'http://localhost/api/hook/x', { method: 'POST', body: '﻿{"bom":"é"}' }) })
  const [utf8, rawOne] = listRequests(binRaw)
  assert.equal(rawOne.bodyBase64, Buffer.from([0x7b, 0xff, 0xfe, 0x7d]).toString('base64'), 'a non-UTF-8 body keeps its bytes')
  assert.equal(utf8.bodyBase64, undefined, 'valid UTF-8 keeps no second copy')
  assert.equal(utf8.bodyText, '﻿{"bom":"é"}', 'a leading BOM survives, so the text re-encodes to the bytes sent')
  assert.ok(!rawOne.headers.some(h => h.name === 'x-origin-auth'), 'the origin-lock secret is never captured')
}
ok('the response route and the capture route: the configured answer is served, ?status/?delay/?echo still override it, echoed and configured HTML is refused, writes are same-origin, bounded and limited per client then shared')

/* ======================================================================== */
/* ndjson export                                                            */
/* ======================================================================== */

{
  const route = await import('../../src/pages/api/hook/[bin]/requests.ts')
  const bin = newBin()
  const mine = [mkReq({ bodyText: 'one\ntwo' }), mkReq({ bodyText: '{"two":2}' }), mkReq({ bodyText: '  line  sep' })]
  for (const r of mine) recordRequest(bin, r)
  const get = (ip, q = '', b = bin) => route.GET({ params: { bin: b }, request: asRequest(ip, `http://localhost/api/hook/x/requests${q}`) })
  const res = await get('198.19.0.1', '?format=ndjson')
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /^application\/x-ndjson/)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  const text = await res.text()
  const lines = text.split('\n')
  assert.equal(lines.at(-1), '', 'every line, the last included, ends with a newline')
  assert.equal(lines.length - 1, mine.length, 'one object per line')
  assert.deepEqual(lines.slice(0, -1).map(l => JSON.parse(l)), mine, 'each line is one captured request, oldest first')
  assert.ok(lines.slice(0, -1).every(l => !l.includes('\r')), 'no line is broken by a carriage return in a body')
  assert.equal((await (await get('198.19.0.1', '?format=ndjson', 'short')).text()), '', 'an invalid bin is an empty export, as the list answers it')
  assert.equal((await (await get('198.19.0.1', '?format=ndjson', newBin())).text()), '')
  assert.equal((await get('198.19.0.1', '?format=csv')).status, 400)
  assert.equal((await (await get('198.19.0.1')).json()).count, 3, 'the JSON list is unchanged')
  // The same limiter as the JSON list: 120 a minute, shared between the two shapes.
  const ip = '198.19.0.77'
  let limited = 0
  for (let i = 0; i < 130; i += 1) if ((await get(ip, i % 2 ? '?format=ndjson' : '')).status === 429) limited += 1
  assert.equal(limited, 10, 'the export spends the same 120 a minute as the list')
}
ok('ndjson export: one captured request per line, oldest first, newline-terminated, an invalid bin is empty, an unknown format is a 400, and it spends the JSON list\'s limiter')

/* ======================================================================== */
/* persistence                                                              */
/* ======================================================================== */

{
  const dir = await mkdtemp(path.join(tmpdir(), 'wh-bins-'))
  const file = path.join(dir, 'data', 'webhook-bins.json')
  try {
    assert.equal(configurePersistence(file), 0, 'a missing file is an empty store')
    const a = newBin()
    const b = newBin()
    const reqs = [mkReq({ bodyText: '{"a":1}' }), mkReq({ bodyText: '{�}', bodyBase64: Buffer.from([0x7b, 0xff, 0x7d]).toString('base64') })]
    for (const r of reqs) recordRequest(a, r)
    setBinResponse(b, { status: 429, headers: [{ name: 'retry-after', value: '9' }], contentType: 'text/plain', body: 'slow down' })

    // Debounced: not written per request, written once the timer fires.
    assert.equal(await stat(file).then(() => true, () => false), false, 'nothing is written per request')
    // The timer was armed by the writes above, on the real clock; wait it out.
    recordRequest(a, mkReq({ bodyText: 'later' }))
    for (let i = 0; i < (WEBHOOK_FLUSH_MS + 2000) / 10 && !(await stat(file).then(() => true, () => false)); i += 1) await new Promise(r => setTimeout(r, 10))
    assert.equal(await stat(file).then(() => true, () => false), true, 'the debounced flush wrote the file')
    assert.equal((await stat(file)).mode & 0o777, 0o600, 'the file is private to the server user')
    assert.equal(await stat(`${file}.tmp`).then(() => true, () => false), false, 'written atomically: no temp file left')

    recordRequest(a, mkReq({ bodyText: 'final' }))
    assert.equal(await flushWebhookBins(), true)
    const before = { a: structuredClone(listRequests(a)), b: structuredClone(getBinResponse(b)) }

    // "A deploy": drop everything in memory and load the file.
    assert.equal(configurePersistence(file), 2, 'both bins come back')
    assert.deepEqual(listRequests(a), before.a, 'requests round-trip, raw bytes included')
    assert.deepEqual(getBinResponse(b), before.b, 'the configured response comes back with its bin')

    // Re-validation: every one of these rows must be refused, and the good ones kept.
    const now = Date.now()
    const goodReq = sanitizeStoredRequest(JSON.parse(JSON.stringify(reqs[0])), now)
    assert.ok(goodReq, 'a good row passes')
    const mutate = patch => sanitizeStoredRequest({ ...reqs[0], ...patch }, now)
    for (const [what, patch] of Object.entries({
      'a short id': { id: 'abc' },
      'a traversal id': { id: '../../etc/passwd' },
      'a method with a space': { method: 'GET /x' },
      'a non-string query': { query: 5 },
      'an oversized query': { query: 'q'.repeat(16_385) },
      'headers that are not a list': { headers: 'x' },
      'a header with a bad name': { headers: [{ name: 'bad name', value: 'v' }] },
      'a header with a non-string value': { headers: [{ name: 'x', value: 5 }] },
      'too many headers': { headers: Array.from({ length: 257 }, (_, i) => ({ name: `h${i}`, value: 'v' })) },
      'a body over 64 KB': { bodyText: 'a'.repeat(WEBHOOK_MAX_BODY_BYTES + 1) },
      'a body that is not text': { bodyText: 5 },
      'raw bytes that are not base64': { bodyBase64: 'not base64!!' },
      'oversized raw bytes': { bodyBase64: 'QUJD'.repeat(30_000) },
      'a truncated flag that is not a boolean': { bodyTruncated: 'no' },
      'a negative size': { size: -1 },
      'a fractional size': { size: 1.5 },
      'a receipt in the future': { receivedAt: now + 3_600_000 },
      'a receipt of zero': { receivedAt: 0 },
      'a source that is not text': { source: 5 },
    })) {
      assert.equal(mutate(patch), null, `refused: ${what}`)
    }
    assert.equal(sanitizeStoredRequest(null), null)
    assert.equal(sanitizeStoredRequest([]), null)
    const stripped = mutate({ evil: 'x', headers: [{ name: 'x-origin-auth', value: 'S' }, { name: 'x-ok', value: '1' }] })
    assert.equal(stripped.evil, undefined, 'fields the server never wrote are not carried through')
    assert.deepEqual(stripped.headers, [{ name: 'x-ok', value: '1' }], 'the origin-lock secret is dropped even from a file that carries it')

    // A whole file: one malformed row costs that row only.
    const fileFor = bins => JSON.stringify({ v: 1, savedAt: now, bins })
    const goodBin = (id, over = {}) => ({ id, lastActivity: now, response: null, requests: [reqs[0]], ...over })
    const idGood = newBin()
    const loaded = parsePersistedBins(fileFor([
      goodBin(idGood, { requests: [reqs[0], { ...reqs[1], id: 'x' }, reqs[1]] }),
      goodBin('tooshort'),
      goodBin(newBin(), { lastActivity: now - WEBHOOK_BIN_TTL_MS - 1 }),
      goodBin(newBin(), { lastActivity: 'yesterday' }),
      goodBin(newBin(), { requests: [] }),
      goodBin(newBin(), { requests: [], response: { status: 200, headers: [{ name: 'set-cookie', value: 'a=b' }], body: 'x' } }),
      goodBin(newBin(), { requests: [], response: { status: 200, headers: [], body: 'kept', contentType: 'text/plain' } }),
      'not an object',
    ]), now)
    assert.equal(loaded.size, 2, 'only the good bin and the bin with a valid response survive')
    assert.equal(loaded.get(idGood).requests.length, 2, 'the malformed row is dropped, its neighbours kept')
    assert.equal(parsePersistedBins('{not json', now).size, 0)
    assert.equal(parsePersistedBins(JSON.stringify({ v: 2, bins: [goodBin(newBin())] }), now).size, 0, 'an unknown version is not guessed at')
    assert.equal(parsePersistedBins(JSON.stringify([goodBin(newBin())]), now).size, 0)
    assert.equal(parsePersistedBins('x'.repeat(WEBHOOK_MAX_FILE_BYTES + 1), now).size, 0, 'a file over the cap is not parsed')

    // Caps apply to what is loaded.
    const crowded = parsePersistedBins(fileFor(Array.from({ length: WEBHOOK_MAX_BINS + 25 }, (_, i) => goodBin(`crowded${String(i).padStart(20, '0')}`, { lastActivity: now - i }))), now)
    assert.equal(crowded.size, WEBHOOK_MAX_BINS, 'no more bins than the live cap, most recent first')
    assert.ok(crowded.has('crowded' + '0'.padStart(20, '0')) && !crowded.has(`crowded${String(WEBHOOK_MAX_BINS + 24).padStart(20, '0')}`))
    const many = Array.from({ length: WEBHOOK_MAX_REQUESTS_PER_BIN + 30 }, () => mkReq())
    assert.equal(parsePersistedBins(fileFor([goodBin(newBin(), { requests: many })]), now).values().next().value.requests.length, WEBHOOK_MAX_REQUESTS_PER_BIN)
    const fat = id => goodBin(id, { requests: Array.from({ length: 40 }, () => mkReq({ bodyText: 'f'.repeat(WEBHOOK_MAX_BODY_BYTES) })) })
    const heavy = parsePersistedBins(fileFor(Array.from({ length: 8 }, () => fat(newBin()))), now)
    let held = 0
    for (const bin of heavy.values()) for (const r of bin.requests) held += r.bodyText.length + 256 + (r.query?.length ?? 0) + r.headers.reduce((n, h) => n + h.name.length + h.value.length, 0)
    assert.ok(held <= WEBHOOK_MAX_TOTAL_BYTES && heavy.size < 8, `the 16 MB budget applies to a loaded file (${held} bytes in ${heavy.size} bins)`)

    // The idle clock applies after a restart too: the file's age is not reset by loading it.
    await writeFile(file, fileFor([goodBin(newBin(), { lastActivity: now - WEBHOOK_BIN_TTL_MS + 60_000 })]), 'utf-8')
    assert.equal(configurePersistence(file), 1)
    const realNow = Date.now
    Date.now = () => realNow() + 120_000
    try { assert.equal(serializeBins().includes('"requests":[{'), false, 'a bin past the idle window is not written back') } finally { Date.now = realNow }
    await writeFile(file, 'x'.repeat(WEBHOOK_MAX_FILE_BYTES + 1), 'utf-8')
    assert.equal(configurePersistence(file), 0, 'a file over the cap is left alone')
    await writeFile(file, '\u0000\u0000garbage', 'utf-8')
    assert.equal(configurePersistence(file), 0, 'garbage is an empty store, not a crash')
  } finally {
    configurePersistence(null)
    await rm(dir, { recursive: true, force: true })
  }
  const src = await read('src/lib/webhook-store.ts')
  assert.match(src, /process\.once\(signal, \(\) => \{\s*flushSync\(\)/, 'a SIGTERM (a deploy) flushes once, synchronously')
  assert.match(src, /import\.meta\.env\.SSR === true/, 'persistence is on only inside the running site, never under the smoke runner')
  assert.equal(WEBHOOK_BIN_TTL_MS, 6 * 60 * 60 * 1000, 'the idle window is still six hours')
}
ok('bins and their configured responses flush (debounced, atomic, mode 0600) to data/webhook-bins.json and reload with every row re-validated: ids, sizes, counts, TTL, bin cap and byte budget; a malformed row is dropped alone')

/* ======================================================================== */
/* source-level invariants                                                  */
/* ======================================================================== */

{
  const routes = ['src/pages/api/hook/[bin]/stream.ts', 'src/pages/api/hook/[bin]/response.ts', 'src/pages/api/hook/[bin]/requests/[id]/replay.ts']
  for (const route of routes) {
    const src = await read(route)
    assert.ok(/createRateLimiter\(/.test(src) && /rateLimitKey\(request\)/.test(src) && /isValidBinId\(/.test(src), `${route} limits and validates`)
    assert.ok(!/allow\w*Global\('global'\)\s*&&/.test(src), `${route} must ask the client's limiter before the shared one`)
    if (!route.includes('response.ts')) assert.match(src, /allow\w+Client\(\w+\)\s*&&\s*allow\w+Global\('global'\)|allow\w+Client\(rateLimitKey\(request\)\)\s*&&\s*allow\w+Global\('global'\)/, `${route} pairs client then shared`)
    assert.ok(!/\b(?:error|err|e)\.message\b/.test(src), `${route} never puts an exception's message in a response`)
  }
  const replay = await read('src/lib/webhook-replay.ts')
  assert.ok(!/redirect:\s*['"]follow['"]/.test(replay) && !/followRedirects/.test(replay), 'the sender never follows a redirect')
  assert.match(replay, /lpIsForbiddenIp/, 'the sender uses Link Peek\'s address guard')
  assert.match(replay, /lookup,/, 'and pins the connection through the request\'s lookup hook')

  // The terms say what is now kept, from the module's own constants.
  const terms = await read('src/pages/terms.astro')
  assert.match(terms, /WEBHOOK_BIN_TTL_MS/)
  assert.match(terms, /written to a file on the server|file on the server/i, '/terms says captures now reach the disk')
  assert.match(terms, /survive(?:s)? a (?:site )?(?:update|deploy)/i, '/terms says bins survive an update')
  assert.match(terms, /(?:configured|custom) (?:answer|response)/i, '/terms says the configured response is kept with the URL')
  assert.match(terms, /(?:address|URL)[^.]{0,80}(?:not (?:kept|stored)|is not kept)/i, '/terms says a resend target is not kept')
  assert.ok(Math.round(WEBHOOK_BIN_TTL_MS / 3_600_000) === 6)
}
ok('every new route limits per client then shared, validates the bin id and never returns an exception message; the sender cannot follow a redirect; /terms states the new retention')

/* ======================================================================== */
/* the page itself                                                          */
/* ======================================================================== */

{
  const src = await read('src/components/tools/webhook-inspector/WebhookInspector.ts')
  const tags = [...src.matchAll(/<(input|textarea|select)(?=[\s/>])[^>]*>/g)].map(m => m[0])
  assert.ok(tags.length >= 8, `found ${tags.length} controls`)
  const forIds = new Set([...src.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map(m => m[1]))
  for (const tag of tags) {
    const id = tag.match(/\bid="([^"]+)"/)?.[1]
    assert.ok(/\baria-label=/.test(tag) || (id && forIds.has(id)), `a control with no name: ${tag.slice(0, 80)}`)
  }
  for (const [what, re] of [
    ['the resend result is a status', /data-type="wi-resend-msg" role="status"/],
    ['the resend error is an alert', /data-type="wi-resend-err" role="alert"/],
    ['the saved-answer result is a status', /data-type="wi-resp-msg" role="status"/],
    ['the saved-answer error is an alert', /data-type="wi-resp-err" role="alert"/],
    ['the signature note is a status', /data-type="wi-secretnote" role="status"/],
    ['the action status is a status', /data-type="wi-status" role="status"/],
  ]) assert.match(src, re, what)
  // Behaviour the page promises.
  assert.match(src, /new EventSource\(`\/api\/hook\/\$\{bin\}\/stream`\)/, 'the page opens the stream')
  assert.match(src, /WI_STREAM_MAX_ERRORS = 2/, 'and falls back to the poll after two errors')
  assert.match(src, /document\.title = `\(\$\{this\.unread\}\) /, 'with an unread count in the title')
  assert.match(src, /if \(document\.hidden\) return\s*\n\s*if \(this\.paused\) this\.updateTimes\(\)/, 'the fallback poll pauses while the tab is hidden')
  assert.ok(!/innerHTML\s*=\s*[^;\n]*\bdata\.preview\b/.test(src), 'a resent answer is never put into the page unescaped')
}
ok('the inspector labels every input, gives results role="status" and errors role="alert", opens the stream, falls back after two errors, pauses when hidden and counts unread in the title')

clearInterval(keepAlive)
