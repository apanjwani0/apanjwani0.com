/**
 * My kit — the tools a visitor has starred, kept in their browser, plus the
 * `/tools/kit?t=…` permalink that carries a kit to someone else and the
 * bookmarks file that exports one.
 *
 * Only LIVE tools can be starred (the Driftfield hub included, since it is a
 * live tool). Games and Driftfield modes cannot: that keeps one predicate
 * (`status === 'live'`), one namespace for `?t=`, and an export that really is
 * a folder of tools. If games are ever wanted, give them a `g:` prefix rather
 * than a second parameter.
 *
 * Every input here is bounded before anything else reads it: a stored kit and a
 * `?t=` value are both attacker-controlled (a link can carry any query string),
 * so the slug grammar, the count and the raw length are enforced in this one
 * module, and `parseKitParam` is the ONLY parser — the route and the client
 * both call it, so the page a link renders and the kit it saves cannot
 * disagree.
 *
 * No DOM access at module scope: the kit route imports the parser server-side.
 */

import { escapeHtml } from './escape'

/** localStorage key; the stored value is `{ v: 1, slugs: string[] }`. */
export const KIT_KEY = 'kit:v1'
/** CustomEvent<KitEventDetail> dispatched on `document` whenever the kit changes. */
export const KIT_EVENT = 'site:kit'
/** Most tools a kit may hold — in storage, in a link, and in an export. */
export const KIT_MAX = 24
/** The permalink's query parameter: `/tools/kit?t=json-tidy,regex-lab`. */
export const KIT_PARAM = 't'
/** Longest `?t=` value read at all; anything past it is ignored unread. */
export const KIT_RAW_MAX = 1024
/** A tool slug as a kit may carry it. Same grammar the tool routes serve. */
export const KIT_SLUG = /^[a-z0-9-]{1,48}$/
/** Where the permalink lives. */
export const KIT_PATH = '/tools/kit'

export interface KitEventDetail {
  slugs: string[]
}

/** Valid, unique slugs in their original order, capped at KIT_MAX. Anything that is not an array is an empty kit. */
export function sanitizeKit(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    if (out.length >= KIT_MAX) break
    if (typeof item === 'string' && KIT_SLUG.test(item) && !out.includes(item)) out.push(item)
  }
  return out
}

/**
 * The one parser for `?t=`. Reads at most KIT_RAW_MAX characters, splits on
 * commas or whitespace (`+` has already decoded to a space), lowercases, keeps
 * only slugs that are live tools right now, drops duplicates, keeps order, caps
 * at KIT_MAX. A kit route compares `kitHref(parseKitParam(...))` with the URL it
 * was asked for and redirects to the canonical one when they differ.
 */
export function parseKitParam(raw: string | null | undefined, liveSlugs: Iterable<string>): string[] {
  if (typeof raw !== 'string' || raw === '') return []
  const live = new Set(liveSlugs)
  const candidates = raw.slice(0, KIT_RAW_MAX).toLowerCase().split(/[\s,]+/)
  return sanitizeKit(candidates.filter(slug => live.has(slug)))
}

/** The canonical permalink for a kit: `/tools/kit?t=a,b`, or `/tools/kit` when empty. */
export function kitHref(slugs: readonly string[]): string {
  const clean = sanitizeKit(slugs)
  return clean.length ? `${KIT_PATH}?${KIT_PARAM}=${clean.join(',')}` : KIT_PATH
}

/* ── Browser-side state. Everything below touches the DOM only when called. ── */

/** The stored kit. Unreadable or malformed storage is an empty kit, never an error. */
export function readKit(): string[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(KIT_KEY) ?? 'null')
    return stored && stored.v === 1 ? sanitizeKit(stored.slugs) : []
  } catch {
    return []
  }
}

function markRoot(slugs: readonly string[]): void {
  const el = typeof document === 'undefined' ? null : document.documentElement
  if (!el) return
  if (slugs.length) el.setAttribute('data-kit', String(slugs.length))
  else el.removeAttribute('data-kit')
}

function announce(slugs: string[]): void {
  markRoot(slugs)
  document.dispatchEvent(new CustomEvent<KitEventDetail>(KIT_EVENT, { detail: { slugs } }))
}

/** Replace the stored kit. Returns what was actually kept after sanitising. */
export function writeKit(slugs: readonly string[]): string[] {
  const clean = sanitizeKit(slugs)
  try {
    window.localStorage.setItem(KIT_KEY, JSON.stringify({ v: 1, slugs: clean }))
  } catch {
    // Storage refused: this page still reflects the change; it will not persist.
  }
  announce(clean)
  return clean
}

/**
 * Star or unstar one tool. Returns whether it is starred afterwards — so a
 * `false` for a slug that was not starred means the kit is full (KIT_MAX) or
 * the slug is not one a kit can hold.
 */
export function toggleKit(slug: string): boolean {
  const kit = readKit()
  if (kit.includes(slug)) {
    writeKit(kit.filter(s => s !== slug))
    return false
  }
  if (!KIT_SLUG.test(slug) || kit.length >= KIT_MAX) return false
  return writeKit([...kit, slug]).includes(slug)
}

let watching = false

/** Follow a kit changed in another tab. Registered once per document, like the theme's. */
function watchKitStorage(): void {
  if (watching) return
  if (typeof window === 'undefined') return
  watching = true
  window.addEventListener('storage', onKitStorage)
}

function onKitStorage(event: StorageEvent): void {
  if (event.key === KIT_KEY || event.key === null) announce(readKit())
}

/** Subscribe to kit changes from this tab and others. Returns the unsubscribe. */
export function onKitChange(callback: (slugs: string[]) => void): () => void {
  if (typeof document === 'undefined') return () => {}
  watchKitStorage()
  const handler = (event: Event) => callback((event as CustomEvent<KitEventDetail>).detail.slugs)
  document.addEventListener(KIT_EVENT, handler)
  return () => document.removeEventListener(KIT_EVENT, handler)
}

/* ── Export ─────────────────────────────────────────────────────────────── */

export interface BookmarkItem {
  title: string
  url: string
}

/**
 * Only an absolute https URL with no credentials becomes a bookmark. A
 * bookmarks file is imported straight into someone's browser, so a
 * `javascript:` or `data:` item would be a stored script waiting for a click.
 */
function bookmarkableUrl(value: string): string | null {
  if (typeof value !== 'string' || /[\u0000-\u001F\u007F\s]/.test(value)) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

/**
 * A Netscape bookmark file (the format every major browser imports) holding one
 * folder of the given items. Every value that reaches the markup — the folder
 * name, each title and each URL — passes through escapeHtml(), because the
 * importer parses it as HTML; and only https URLs are written at all.
 */
export function bookmarksFile(
  items: readonly BookmarkItem[],
  { folder, now }: { folder: string; now: Date | number },
): string {
  const stamp = String(Math.floor((typeof now === 'number' ? now : now.getTime()) / 1000))
  const rows = items.slice(0, KIT_MAX).flatMap(item => {
    const href = bookmarkableUrl(item.url)
    if (!href) return []
    return [`        <DT><A HREF="${escapeHtml(href)}" ADD_DATE="${stamp}">${escapeHtml(String(item.title))}</A>`]
  })
  return [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file.',
    '     It will be read and overwritten.',
    '     DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    `    <DT><H3 ADD_DATE="${stamp}" LAST_MODIFIED="${stamp}">${escapeHtml(folder)}</H3>`,
    '    <DL><p>',
    ...rows,
    '    </DL><p>',
    '</DL><p>',
    '',
  ].join('\n')
}
