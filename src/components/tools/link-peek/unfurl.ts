/**
 * Link Peek — unfurl extraction, resolution and lint. Pure string functions.
 *
 * This module is the tool's checkable claims (see AGENTS.md: a tool's claims
 * live in a module, not in the component): what the page's meta tags say, what
 * each platform renders from them, and what is wrong with them. It is
 * deliberately shared between the API route (which extracts on the server, so
 * raw HTML never travels to the browser) and the component (which resolves the
 * previews and lints the result), so the two can never disagree about what a
 * tag means — the same reason type-trial-daily.ts is shared.
 *
 * No DOM, no fetch, no Node APIs: everything here is testable in
 * security-smoke against literal HTML strings.
 */

import { escapeHtml } from '../../../lib/escape'

/** Longest meta value kept — og:description in the wild fits well under this. */
export const LP_META_VALUE_MAX = 600
/** Most og:* / twitter:* tags kept per family — real pages carry a handful. */
export const LP_META_TAGS_MAX = 40

export interface LpMetaTag {
  key: string
  value: string
}

export interface LpMeta {
  /** <title> text, cleaned; null when absent or empty. */
  title: string | null
  metaDescription: string | null
  canonical: string | null
  /** charset the DOCUMENT declares (meta charset / http-equiv), lowercased. */
  charsetDeclared: string | null
  /** Absolute icon URL — declared <link rel=icon>, else the /favicon.ico guess. */
  faviconUrl: string | null
  faviconDeclared: boolean
  /** og:* tags in document order — first occurrence of a key wins (the OG rule). */
  og: LpMetaTag[]
  /** twitter:* tags in document order. */
  twitter: LpMetaTag[]
}

/* ------------------------------------------------------------------ */
/* entities                                                            */
/* ------------------------------------------------------------------ */

const LP_NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  copy: '©', reg: '®', trade: '™', middot: '·', bull: '•',
}

/**
 * Single-pass entity decode: `&amp;lt;` becomes the text `&lt;`, never `<` —
 * a second pass over its own output is how double-decoding bugs happen.
 */
export function lpDecodeEntities(s: string): string {
  return s.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole
      // Surrogate halves are not code points fromCodePoint will accept.
      if (code >= 0xd800 && code <= 0xdfff) return whole
      return String.fromCodePoint(code)
    }
    return LP_NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

function lpCleanValue(raw: string): string {
  return lpDecodeEntities(raw).replace(/\s+/g, ' ').trim().slice(0, LP_META_VALUE_MAX)
}

/* ------------------------------------------------------------------ */
/* extraction                                                          */
/* ------------------------------------------------------------------ */

// Comments and script/style/textarea bodies are stripped BEFORE tag scanning:
// a <meta property="og:title"> quoted inside a JS string or a commented-out
// block is not a tag the page serves, and regex scanning cannot know that.
const LP_STRIP_BLOCKS =
  /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<textarea\b[^>]*>[\s\S]*?<\/textarea\s*>/gi

function lpParseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([a-zA-Z][a-zA-Z0-9:_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const name = m[1].toLowerCase()
    if (!(name in out)) out[name] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return out
}

/** Resolve href against the page URL; only http(s) results survive. */
function lpResolveUrl(href: string, base: string): string | null {
  const raw = lpDecodeEntities(href).trim()
  if (!raw) return null
  try {
    const url = new URL(raw, base)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.href
  } catch {
    return null
  }
}

export function lpExtractMeta(html: string, finalUrl: string): LpMeta {
  const doc = html.replace(LP_STRIP_BLOCKS, ' ')

  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(doc)
  const titleText = titleMatch ? lpCleanValue(titleMatch[1]) : ''

  const og: LpMetaTag[] = []
  const twitter: LpMetaTag[] = []
  let metaDescription: string | null = null
  let charsetDeclared: string | null = null
  let canonical: string | null = null
  let faviconUrl: string | null = null

  // Quote-aware tag scan: a raw `>` INSIDE a quoted attribute value
  // (content='five > four') must not end the tag early. Each alternative
  // consumes at least one character and their first characters are disjoint,
  // so this cannot backtrack pathologically.
  const metaRe = /<meta\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi
  let m: RegExpExecArray | null
  while ((m = metaRe.exec(doc))) {
    const attrs = lpParseAttrs(m[1])
    if (attrs.charset && charsetDeclared === null) {
      charsetDeclared = attrs.charset.trim().toLowerCase() || null
    }
    if (attrs['http-equiv']?.toLowerCase() === 'content-type' && charsetDeclared === null) {
      const cs = /charset\s*=\s*([\w-]+)/i.exec(attrs.content ?? '')
      if (cs) charsetDeclared = cs[1].toLowerCase()
    }
    const key = (attrs.property ?? attrs.name ?? '').trim().toLowerCase()
    if (!key || !('content' in attrs)) continue
    // Empty content is kept: "present but empty" is a lintable page bug, and
    // dropping it here would make the lint report "missing" — a different fix.
    const value = lpCleanValue(attrs.content)
    if (key.startsWith('og:')) {
      if (og.length < LP_META_TAGS_MAX) og.push({ key, value })
    } else if (key.startsWith('twitter:')) {
      if (twitter.length < LP_META_TAGS_MAX) twitter.push({ key, value })
    } else if (key === 'description' && metaDescription === null) {
      metaDescription = value || null
    }
  }

  const linkRe = /<link\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi
  while ((m = linkRe.exec(doc))) {
    const attrs = lpParseAttrs(m[1])
    if (!attrs.rel || !attrs.href) continue
    const rels = attrs.rel.toLowerCase().split(/\s+/)
    if (rels.includes('canonical') && canonical === null) {
      canonical = lpResolveUrl(attrs.href, finalUrl)
    }
    if ((rels.includes('icon') || rels.includes('apple-touch-icon')) && faviconUrl === null) {
      faviconUrl = lpResolveUrl(attrs.href, finalUrl)
    }
  }

  const faviconDeclared = faviconUrl !== null
  if (!faviconDeclared) {
    // The same guess every unfurler makes when nothing is declared.
    try {
      faviconUrl = new URL('/favicon.ico', finalUrl).href
    } catch {
      faviconUrl = null
    }
  }

  return {
    title: titleText || null,
    metaDescription,
    canonical,
    charsetDeclared,
    faviconUrl,
    faviconDeclared,
    og,
    twitter,
  }
}

/* ------------------------------------------------------------------ */
/* resolution — what each platform renders                             */
/* ------------------------------------------------------------------ */

/** First non-empty value for a key — the OG "first tag wins" rule. */
export function lpFirst(tags: LpMetaTag[], key: string): string | null {
  for (const t of tags) if (t.key === key && t.value) return t.value
  return null
}

function lpCount(tags: LpMetaTag[], key: string): number {
  let n = 0
  for (const t of tags) if (t.key === key) n += 1
  return n
}

export interface LpCard {
  title: string | null
  description: string | null
  imageUrl: string | null
}

export interface LpPreviews {
  domain: string
  slack: LpCard & { siteName: string | null; faviconUrl: string | null; large: boolean }
  /** card === null means X renders no card at all (twitter:card absent). */
  x: LpCard & { card: 'summary' | 'summary_large_image' | 'player' | 'app' | null }
  imessage: LpCard
}

const LP_KNOWN_CARDS = ['summary', 'summary_large_image', 'player', 'app'] as const

function lpImage(meta: LpMeta, keys: string[], finalUrl: string): string | null {
  for (const key of keys) {
    const raw = lpFirst(meta.og, key) ?? lpFirst(meta.twitter, key)
    if (raw) {
      const abs = lpResolveUrl(raw, finalUrl)
      if (abs) return abs
    }
  }
  return null
}

export function lpResolvePreviews(meta: LpMeta, finalUrl: string): LpPreviews {
  let domain = ''
  try {
    domain = new URL(finalUrl).hostname.replace(/^www\./, '')
  } catch { /* keep '' */ }

  const ogTitle = lpFirst(meta.og, 'og:title')
  const twTitle = lpFirst(meta.twitter, 'twitter:title')
  const ogDesc = lpFirst(meta.og, 'og:description')
  const twDesc = lpFirst(meta.twitter, 'twitter:description')
  const ogImage = lpImage(meta, ['og:image', 'og:image:secure_url', 'og:image:url'], finalUrl)
  const twImageRaw = lpFirst(meta.twitter, 'twitter:image') ?? lpFirst(meta.twitter, 'twitter:image:src')
  const twImage = twImageRaw ? lpResolveUrl(twImageRaw, finalUrl) : null
  const cardRaw = (lpFirst(meta.twitter, 'twitter:card') ?? '').toLowerCase()
  const card = (LP_KNOWN_CARDS as readonly string[]).includes(cardRaw)
    ? (cardRaw as LpPreviews['x']['card'])
    : cardRaw
      ? 'summary' // unknown value — X documents falling back to summary
      : null // absent — X renders a bare link, no card

  return {
    domain,
    slack: {
      title: ogTitle ?? twTitle ?? meta.title,
      description: ogDesc ?? twDesc ?? meta.metaDescription,
      imageUrl: ogImage ?? twImage,
      siteName: lpFirst(meta.og, 'og:site_name'),
      faviconUrl: meta.faviconUrl,
      large: cardRaw === 'summary_large_image',
    },
    x: {
      card,
      title: twTitle ?? ogTitle ?? meta.title,
      description: twDesc ?? ogDesc ?? meta.metaDescription,
      imageUrl: twImage ?? ogImage,
    },
    imessage: {
      title: ogTitle ?? twTitle ?? meta.title ?? domain,
      description: null, // iMessage shows title + domain only
      imageUrl: ogImage ?? twImage,
    },
  }
}

/* ------------------------------------------------------------------ */
/* lint                                                                */
/* ------------------------------------------------------------------ */

export type LpLintLevel = 'error' | 'warn' | 'info'

export interface LpFinding {
  level: LpLintLevel
  code: string
  message: string
}

/** Resolved title X starts truncating around; Google cuts nearer 60. */
export const LP_TITLE_SOFT_MAX = 70
export const LP_DESC_SOFT_MAX = 200
/** Below this on either edge, thumbnails render blurry or are rejected. */
export const LP_IMAGE_MIN_EDGE = 200
/** summary_large_image wants ~1.91:1; outside this band clients crop hard. */
export const LP_RATIO_MIN = 1.5
export const LP_RATIO_MAX = 2.4

/**
 * What is wrong (or missing) in the page's unfurl tags.
 *
 * Every finding is avoidable: a page with a complete, correct set produces an
 * EMPTY list, and security-smoke asserts that — a linter that always finds
 * something teaches people to ignore it.
 */
export function lpLint(meta: LpMeta, finalUrl: string): LpFinding[] {
  const findings: LpFinding[] = []
  const add = (level: LpLintLevel, code: string, message: string) =>
    findings.push({ level, code, message })

  let pageIsHttps = false
  let pageOrigin = ''
  try {
    const u = new URL(finalUrl)
    pageIsHttps = u.protocol === 'https:'
    pageOrigin = u.origin
  } catch { /* unlintable base */ }

  // Present-but-empty og/twitter tags: a real bug the "missing" checks below
  // would misreport, so it is called out by name first.
  for (const t of [...meta.og, ...meta.twitter]) {
    if (t.value === '' && !findings.some(f => f.code === 'EMPTY:' + t.key)) {
      add('error', 'EMPTY:' + t.key, `${t.key} is present but empty — scrapers read that as set, then render nothing.`)
    }
  }

  const previews = lpResolvePreviews(meta, finalUrl)
  const ogTitle = lpFirst(meta.og, 'og:title')
  const ogDesc = lpFirst(meta.og, 'og:description')
  const ogImageRaw = lpFirst(meta.og, 'og:image')

  if (!ogTitle) {
    add('warn', 'OG_TITLE_MISSING', meta.title
      ? 'No og:title — platforms fall back to the <title>, which is written for search tabs, not for a share card.'
      : 'No og:title and no <title> — the unfurl has no headline at all.')
  }
  if (!ogDesc) {
    add('warn', 'OG_DESC_MISSING', meta.metaDescription
      ? 'No og:description — the meta description is the fallback, and not every client reads it.'
      : 'No og:description and no meta description — the card renders with no summary text.')
  }
  if (!previews.slack.imageUrl && !previews.x.imageUrl) {
    add('warn', 'IMAGE_MISSING', 'No og:image or twitter:image — Slack and iMessage unfurl text-only, and an X summary card shows a grey placeholder.')
  }

  if (ogImageRaw) {
    let absolute = false
    try {
      // eslint-disable-next-line no-new
      new URL(ogImageRaw)
      absolute = true
    } catch { /* relative */ }
    if (!absolute) {
      add('warn', 'IMAGE_RELATIVE', 'og:image is a relative URL — resolved against the page here, but the OG spec wants an absolute URL and several scrapers skip relative ones.')
    } else if (pageIsHttps && ogImageRaw.startsWith('http:')) {
      add('warn', 'IMAGE_INSECURE', 'og:image is plain http on an https page — clients that refuse mixed content drop the thumbnail. Serve it over https (or add og:image:secure_url).')
    }
  }

  const cardRaw = (lpFirst(meta.twitter, 'twitter:card') ?? '').toLowerCase()
  if (!cardRaw && (meta.og.length > 0 || meta.twitter.length > 0)) {
    add('info', 'CARD_MISSING', 'No twitter:card — X renders a bare link without it, even when the og: tags are complete.')
  } else if (cardRaw && !(LP_KNOWN_CARDS as readonly string[]).includes(cardRaw)) {
    add('warn', 'CARD_UNKNOWN', `twitter:card is "${cardRaw}" — not a value X defines (summary, summary_large_image, player, app); it falls back to summary.`)
  }

  const ogUrl = lpFirst(meta.og, 'og:url')
  if (!ogUrl) {
    add('info', 'OG_URL_MISSING', 'No og:url — the canonical share URL; without it some platforms aggregate share counts per-variant (utm, trailing slash) instead of per-page.')
  } else if (pageOrigin) {
    try {
      if (new URL(ogUrl).origin !== pageOrigin) {
        add('info', 'OG_URL_MISMATCH', `og:url points at a different origin (${new URL(ogUrl).origin}) than the page — usually a copy-pasted template value.`)
      }
    } catch {
      add('warn', 'OG_URL_INVALID', 'og:url does not parse as a URL.')
    }
  }

  const shownTitle = previews.slack.title
  if (shownTitle && shownTitle.length > LP_TITLE_SOFT_MAX) {
    add('info', 'TITLE_LONG', `The title runs ${shownTitle.length} characters — X truncates around 70 and Google nearer 60, so front-load the words that matter.`)
  }
  const shownDesc = previews.slack.description
  if (shownDesc && shownDesc.length > LP_DESC_SOFT_MAX) {
    add('info', 'DESC_LONG', `The description runs ${shownDesc.length} characters — most clients cut between 125 and 200, mid-sentence.`)
  }

  const wRaw = lpFirst(meta.og, 'og:image:width')
  const hRaw = lpFirst(meta.og, 'og:image:height')
  if (previews.slack.imageUrl || previews.x.imageUrl) {
    if (!wRaw || !hRaw) {
      add('info', 'IMAGE_DIMS_UNDECLARED', 'og:image:width/height are not declared — the very first share of a URL can render image-less while the scraper fetches the file to measure it.')
    } else {
      const w = Number.parseInt(wRaw, 10)
      const h = Number.parseInt(hRaw, 10)
      if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
        add('warn', 'IMAGE_DIMS_INVALID', 'og:image:width/height do not parse as positive numbers.')
      } else if (w < LP_IMAGE_MIN_EDGE || h < LP_IMAGE_MIN_EDGE) {
        add('warn', 'IMAGE_TINY', `Declared image is ${w}×${h} — below ~${LP_IMAGE_MIN_EDGE}px on an edge, thumbnails render blurry and some clients skip them.`)
      } else if (cardRaw === 'summary_large_image') {
        const ratio = w / h
        if (ratio < LP_RATIO_MIN || ratio > LP_RATIO_MAX) {
          add('info', 'IMAGE_RATIO', `Declared image ratio is ${ratio.toFixed(2)}:1 — summary_large_image is cropped toward 1.91:1, so expect the edges to be cut.`)
        }
      }
    }
  }

  for (const key of ['og:title', 'og:description', 'og:image'] as const) {
    if (lpCount(meta.og, key) > 1) {
      add('info', 'DUPLICATE:' + key, `${key} appears ${lpCount(meta.og, key)} times — the OG rule is first-one-wins, so the later ones are dead weight (and a sign two templates are both writing tags).`)
    }
  }

  if (meta.charsetDeclared && meta.charsetDeclared !== 'utf-8' && meta.charsetDeclared !== 'utf8') {
    add('info', 'CHARSET', `Document declares charset ${meta.charsetDeclared} — scrapers assume UTF-8 and render mojibake when that assumption is wrong.`)
  }

  return findings
}

/* ------------------------------------------------------------------ */
/* snippet — the corrected tags, ready to paste                        */
/* ------------------------------------------------------------------ */

/**
 * The shared escape, not a second local one. The copy that used to live here
 * omitted `'`, which AGENTS.md names explicitly: "anything interpolated into
 * HTML gets escaped including `'` — attribute quoting is a property of the call
 * site and will eventually change". Nothing rendered this snippet through
 * innerHTML, so the gap was dormant rather than exploitable; a dormant second
 * copy of an escaping rule is still the thing that gets used by the next call
 * site that does render it.
 */
const lpAttrEscape = escapeHtml

/**
 * A ready-to-paste head snippet built from what the page already has, with a
 * TODO comment standing in for anything missing — so the fix is copy, fill the
 * TODOs, done.
 */
export function lpMetaSnippet(meta: LpMeta, finalUrl: string): string {
  const p = lpResolvePreviews(meta, finalUrl)
  const lines: string[] = []
  const tag = (key: string, value: string) =>
    lines.push(`<meta property="${lpAttrEscape(key)}" content="${lpAttrEscape(value)}" />`)
  const todo = (key: string, hint: string) =>
    lines.push(`<!-- TODO ${key}: ${hint} -->`)

  if (p.slack.title) tag('og:title', p.slack.title)
  else todo('og:title', 'the headline the share card shows')
  if (p.slack.description) tag('og:description', p.slack.description)
  else todo('og:description', 'one or two sentences, under 200 characters')
  if (p.slack.imageUrl) {
    tag('og:image', p.slack.imageUrl)
    const w = lpFirst(meta.og, 'og:image:width')
    const h = lpFirst(meta.og, 'og:image:height')
    if (w && h) {
      tag('og:image:width', w)
      tag('og:image:height', h)
    } else {
      todo('og:image:width / og:image:height', 'declare the pixel size so first shares render instantly')
    }
  } else {
    todo('og:image', 'an absolute https URL, 1200×630 for large cards')
  }
  tag('og:url', lpFirst(meta.og, 'og:url') ?? finalUrl)
  if (p.slack.siteName) tag('og:site_name', p.slack.siteName)
  const card = (lpFirst(meta.twitter, 'twitter:card') ?? '').toLowerCase()
  lines.push(`<meta name="twitter:card" content="${lpAttrEscape((LP_KNOWN_CARDS as readonly string[]).includes(card) ? card : p.slack.imageUrl ? 'summary_large_image' : 'summary')}" />`)
  return lines.join('\n')
}
