#!/usr/bin/env node
/**
 * Tell IndexNow search engines (Bing, Yandex, Seznam, Naver) which URLs changed.
 *
 *   npm run indexnow -- https://apanjwani0.com/learnings/a-new-article
 *   printf '%s\n' <url> <url> | npm run indexnow
 *   npm run indexnow -- --dry-run <url>      # print the request, send nothing
 *
 * URLs come from the arguments, or from stdin (one per line) when there are
 * none. Only https URLs on this site's own host are sent, because IndexNow
 * refuses a submission that names a host other than the key's. At most 1000 go
 * in one request; any more are dropped and said so, never silently.
 *
 * The key is public by design: it is the name and the content of a file in
 * public/, which is how the engines check that the submitter controls the site.
 * No secret is involved, so nothing here needs a token. Exit 0 on a 200 or 202
 * answer and print the status; anything else exits 1.
 */
import { readFile, readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'
export const MAX_URLS = 1000

const root = new URL('../', import.meta.url)

/** The 32-hex key: the one public/<key>.txt whose content is its own name. */
export async function findKey() {
  const files = (await readdir(new URL('public/', root))).filter(f => /^[0-9a-f]{32}\.txt$/.test(f))
  for (const f of files) {
    const key = f.slice(0, -4)
    if ((await readFile(new URL(`public/${f}`, root), 'utf-8')).trim() === key) return key
  }
  throw new Error('no public/<32 hex>.txt file whose content is its own name')
}

/** The URLs worth sending: https, on `host`, unique, in order, capped. */
export function parseUrls(lines, host) {
  const seen = new Set()
  const urls = []
  let skipped = 0
  for (const line of lines) {
    const text = line.trim()
    if (!text) continue
    let u
    try { u = new URL(text) } catch { skipped += 1; continue }
    if (u.protocol !== 'https:' || u.host !== host) { skipped += 1; continue }
    u.hash = ''
    if (seen.has(u.href)) continue
    seen.add(u.href)
    urls.push(u.href)
  }
  return { urls: urls.slice(0, MAX_URLS), skipped, dropped: Math.max(0, urls.length - MAX_URLS) }
}

export function buildPayload(host, key, urls) {
  return { host, key, keyLocation: `https://${host}/${key}.txt`, urlList: urls }
}

async function readStdin() {
  if (process.stdin.isTTY) return []
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  return text.split(/\r?\n/)
}

async function main() {
  const args = process.argv.slice(2)
  const dry = args.includes('--dry-run')
  const given = args.filter(a => a !== '--dry-run')
  const site = JSON.parse(await readFile(new URL('src/config/site.json', root), 'utf-8'))
  const host = new URL(site.url).host
  const key = await findKey()

  const { urls, skipped, dropped } = parseUrls(given.length ? given : await readStdin(), host)
  if (skipped) console.error(`skipped ${skipped} entries that are not https URLs on ${host}`)
  if (dropped) console.error(`dropped ${dropped} URLs past the ${MAX_URLS} a single request may carry`)
  if (!urls.length) { console.log('nothing to submit'); return 0 }

  const payload = buildPayload(host, key, urls)
  if (dry) { console.log(JSON.stringify(payload, null, 2)); return 0 }

  let res
  try {
    res = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    console.error('IndexNow was not reachable')
    return 1
  }
  console.log(`IndexNow answered ${res.status} for ${urls.length} URL${urls.length === 1 ? '' : 's'}`)
  return res.status === 200 || res.status === 202 ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main())
