/**
 * Find UI: the command palette. ⌘K or Ctrl+K, or the nav's search button,
 * opens a dialog that finds any page on the site by name.
 *
 * Plain behaviour, each part the reason a line below exists:
 *
 *  - **The index is fetched once, on first open.** `/search.json` (the same
 *    pages as the sitemap, src/pages/search.json.ts) is memoised for the life of
 *    the document. Closing the dialog while it is still loading aborts the
 *    request, and the next open asks again. Nothing is fetched on page load, so
 *    a visitor who never searches pays nothing.
 *  - **It stores nothing.** No recent searches, no counts: the query lives in the
 *    input until the dialog closes (see /terms).
 *  - **Scored by `rankEntries`** (src/lib/fuzzy.ts), shown eight at a time,
 *    grouped by kind, each with its one-line description.
 *  - **Links, not scripted navigation.** Every result is an `<a>`, so the
 *    ClientRouter, a middle click and "open in a new tab" all work. A link into
 *    a ToolBase page carries `data-astro-reload` (`shellLinkAttrs`).
 *  - **Mounting.** `initFindUI()` is called once per document by `initSiteUI()`
 *    (src/lib/site-ui.ts). Its listeners sit on `document`, which a ClientRouter
 *    session keeps, and the per-page step runs on `astro:page-load` (and once at
 *    module run, for ToolBase pages, which have no router). A swap replaces the
 *    body, so a dialog that was open is gone; the per-page step notices and
 *    forgets it.
 *
 * Must never import `astro:transitions/client`: this module loads on ToolBase
 * pages too, and that import would pull the router onto them.
 */

import { rankEntries } from './fuzzy'
import { shellLinkAttrs } from './shells'
import type { IndexEntry, IndexKind } from './site-index'

const INDEX_URL = '/search.json'
const RESULTS_MAX = 8
const QUERY_MAX = 64
const ENTRIES_MAX = 500

const KIND_LABEL: Readonly<Record<IndexKind, string>> = {
  section: 'Pages',
  tool: 'Tools',
  game: 'Games',
  learning: 'Learnings',
  project: 'Projects',
  post: 'Posts',
  mode: 'Driftfield modes',
  preset: 'Cron presets',
}

const MESSAGES = {
  empty: "Nothing matches that yet. Try a tool's name or what it does.",
  loading: 'Loading the list of pages…',
  failed: 'The list of pages could not be loaded. Close this and open it again to retry.',
  title: 'Search the site',
  placeholder: 'Search tools, games and articles',
} as const

const isKind = (value: unknown): value is IndexKind => typeof value === 'string' && value in KIND_LABEL

/** A same-site path: one slash, never `//host` or a backslash trick that a browser reads as another origin. */
const isLocalPath = (value: unknown): value is string => typeof value === 'string' && /^\/(?![/\\])/.test(value)

/** Keep only well-formed entries: the response is data, never trusted for its shape. */
function readIndex(data: unknown): IndexEntry[] {
  if (!Array.isArray(data)) return []
  const out: IndexEntry[] = []
  for (const item of data.slice(0, ENTRIES_MAX)) {
    if (!item || typeof item !== 'object') continue
    const { t, u, k, d, w } = item as Record<string, unknown>
    if (typeof t !== 'string' || !isLocalPath(u) || !isKind(k)) continue
    out.push({ t, u, k, d: typeof d === 'string' ? d : undefined, w: typeof w === 'string' ? w : undefined })
  }
  return out
}

/* ── The index: fetched once, memoised ─────────────────────────────────── */

let index: IndexEntry[] | null = null
let inflight: Promise<IndexEntry[]> | null = null
let abortLoad: AbortController | null = null

function loadIndex(): Promise<IndexEntry[]> {
  if (index) return Promise.resolve(index)
  if (inflight) return inflight
  const controller = new AbortController()
  abortLoad = controller
  inflight = fetch(INDEX_URL, { signal: controller.signal, headers: { accept: 'application/json' } })
    .then(response => {
      if (!response.ok) throw new Error('index request failed')
      return response.json()
    })
    .then(data => {
      index = readIndex(data)
      return index
    })
    .finally(() => {
      inflight = null
      abortLoad = null
    })
  return inflight
}

/* ── The dialog ────────────────────────────────────────────────────────── */

interface Palette {
  root: HTMLElement
  input: HTMLInputElement
  list: HTMLElement
  status: HTMLElement
  count: HTMLElement
  options: HTMLAnchorElement[]
  active: number
}

let palette: Palette | null = null
let opener: HTMLElement | null = null
let inerted: Element[] = []
let loadState: 'loading' | 'ready' | 'failed' = 'loading'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value)
  if (text !== undefined) node.textContent = text
  return node
}

function build(): Palette {
  const input = el('input', {
    type: 'text',
    role: 'combobox',
    'aria-label': MESSAGES.title,
    'aria-autocomplete': 'list',
    'aria-expanded': 'true',
    'aria-controls': 'palette-list',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'go',
    maxlength: String(QUERY_MAX),
    placeholder: MESSAGES.placeholder,
  })
  const close = el('button', { type: 'button', 'data-action': 'palette-close', 'aria-label': 'Close search' }, 'Esc')
  const list = el('div', { id: 'palette-list', role: 'listbox', 'aria-label': 'Matching pages' })
  const status = el('p', { 'data-type': 'palette-status' })
  const count = el('p', { 'data-type': 'palette-count', 'aria-live': 'polite' })
  const hint = el('p', { 'data-type': 'palette-hint' }, 'Use the up and down arrow keys to choose, Enter to open and Escape to close.')
  const dialog = el('div', {
    'data-type': 'palette-dialog',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': MESSAGES.title,
  })
  dialog.append(el('div', { 'data-type': 'palette-field' }), list, status, count, hint)
  dialog.firstElementChild!.append(input, close)
  const scrim = el('div', { 'data-type': 'palette-scrim' })
  const root = el('div', { 'data-type': 'palette' })
  root.append(scrim, dialog)

  const made: Palette = { root, input, list, status, count, options: [], active: -1 }
  input.addEventListener('input', () => render(made))
  scrim.addEventListener('click', () => closePalette())
  close.addEventListener('click', () => closePalette())
  root.addEventListener('keydown', event => onDialogKey(made, event))
  list.addEventListener('mousemove', event => {
    const option = (event.target as Element).closest<HTMLAnchorElement>('a[role="option"]')
    const at = option ? made.options.indexOf(option) : -1
    if (at !== -1 && at !== made.active) setActive(made, at, false)
  })
  // A result opens through its own link. The dialog then steps aside on the next
  // tick, which a same-page link (a project card on /projects) needs, since no
  // page load follows it.
  list.addEventListener('click', event => {
    if ((event.target as Element).closest('a[role="option"]')) setTimeout(() => closePalette(), 0)
  })
  return made
}

function setActive(p: Palette, at: number, scroll = true): void {
  p.options.forEach((option, i) => option.setAttribute('aria-selected', i === at ? 'true' : 'false'))
  p.active = at
  const current = p.options[at]
  if (current) {
    p.input.setAttribute('aria-activedescendant', current.id)
    if (scroll) current.scrollIntoView({ block: 'nearest' })
  } else {
    p.input.removeAttribute('aria-activedescendant')
  }
}

/** The title with the matched letters wrapped in <mark>, built from text nodes only. */
function titleNode(title: string, hits: number[]): HTMLElement {
  const node = el('span', { 'data-type': 'palette-title' })
  const marked = new Set(hits)
  let run = ''
  let runMarked = false
  const flush = () => {
    if (!run) return
    if (runMarked) node.append(el('mark', {}, run))
    else node.append(document.createTextNode(run))
    run = ''
  }
  for (let i = 0; i < title.length; i += 1) {
    const isMarked = marked.has(i)
    if (isMarked !== runMarked) flush()
    runMarked = isMarked
    run += title[i]
  }
  flush()
  return node
}

function render(p: Palette): void {
  const query = p.input.value
  p.list.replaceChildren()
  p.options = []
  p.status.textContent = ''
  p.status.removeAttribute('role')
  if (loadState === 'loading' && !index) {
    p.status.textContent = MESSAGES.loading
    p.status.setAttribute('role', 'status')
    p.count.textContent = ''
    setActive(p, -1)
    return
  }
  if (loadState === 'failed' && !index) {
    p.status.textContent = MESSAGES.failed
    p.status.setAttribute('role', 'alert')
    p.count.textContent = ''
    setActive(p, -1)
    return
  }
  const ranked = rankEntries(query, index ?? [], RESULTS_MAX)
  if (ranked.length === 0) {
    p.status.textContent = MESSAGES.empty
    p.status.setAttribute('role', 'status')
    p.count.textContent = ''
    setActive(p, -1)
    return
  }
  // Grouped by kind, groups in the order of their best result.
  const groups = new Map<IndexKind, typeof ranked>()
  for (const item of ranked) {
    const group = groups.get(item.entry.k)
    if (group) group.push(item)
    else groups.set(item.entry.k, [item])
  }
  let n = 0
  for (const [kind, items] of groups) {
    const labelId = `palette-group-${kind}`
    const group = el('div', { role: 'group', 'aria-labelledby': labelId })
    group.append(el('p', { id: labelId, 'data-type': 'palette-group' }, KIND_LABEL[kind]))
    for (const { entry, hits } of items) {
      const option = el('a', { id: `palette-option-${n}`, role: 'option', href: entry.u, 'aria-selected': 'false', ...shellLinkAttrs(entry.u) })
      option.append(titleNode(entry.t, hits))
      if (entry.d) option.append(el('span', { 'data-type': 'palette-desc' }, entry.d))
      group.append(option)
      p.options.push(option)
      n += 1
    }
    p.list.append(group)
  }
  p.count.textContent = `${n} ${n === 1 ? 'page matches' : 'pages match'}.`
  setActive(p, 0, false)
}

function onDialogKey(p: Palette, event: KeyboardEvent): void {
  if (event.isComposing) return
  switch (event.key) {
    case 'Escape':
      event.preventDefault()
      closePalette()
      return
    case 'ArrowDown':
    case 'ArrowUp': {
      event.preventDefault()
      if (p.options.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive(p, (p.active + step + p.options.length) % p.options.length)
      return
    }
    case 'Enter': {
      const option = p.options[p.active]
      if (!option || event.target !== p.input) return
      event.preventDefault()
      option.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey,
      }))
      return
    }
    case 'Tab': {
      // Focus stays inside: the field and the close button are the only stops.
      const stops = [...p.root.querySelectorAll<HTMLElement>('input, button')]
      const at = stops.indexOf(document.activeElement as HTMLElement)
      const next = event.shiftKey ? at - 1 : at + 1
      event.preventDefault()
      stops[(next + stops.length) % stops.length]?.focus()
      return
    }
  }
}

/** Everything behind the dialog is switched off while it is open, so neither a click nor Tab can reach it. */
function inertPage(except: Element): void {
  for (const child of document.body.children) {
    if (child === except || child.tagName === 'SCRIPT' || child.hasAttribute('inert')) continue
    child.setAttribute('inert', '')
    inerted.push(child)
  }
}

function restorePage(): void {
  for (const child of inerted) child.removeAttribute('inert')
  inerted = []
}

export function isPaletteOpen(): boolean {
  return palette !== null && palette.root.isConnected
}

function openPalette(): void {
  if (isPaletteOpen()) return
  palette ??= build()
  const p = palette
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  p.input.value = ''
  loadState = index ? 'ready' : 'loading'
  render(p)
  document.body.append(p.root)
  inertPage(p.root)
  document.documentElement.setAttribute('data-palette-open', '')
  p.input.focus()
  // The fade starts one frame after insertion, or the browser has nothing to ease from.
  requestAnimationFrame(() => p.root.setAttribute('data-state', 'open'))
  if (!index) {
    loadIndex().then(
      () => {
        loadState = 'ready'
        if (isPaletteOpen()) render(p)
      },
      (error: unknown) => {
        // An abort comes from closing the dialog; the next open asks again.
        if ((error as { name?: string } | null)?.name === 'AbortError') return
        loadState = 'failed'
        if (isPaletteOpen()) render(p)
      },
    )
  }
}

function closePalette(): void {
  const p = palette
  if (!p) return
  abortLoad?.abort()
  p.root.removeAttribute('data-state')
  p.root.remove()
  document.documentElement.removeAttribute('data-palette-open')
  restorePage()
  const back = opener
  opener = null
  if (back?.isConnected) back.focus()
}

/** A ClientRouter swap replaces the body: a dialog that was open is gone with it. */
function forgetStale(): void {
  if (palette && !palette.root.isConnected) {
    document.documentElement.removeAttribute('data-palette-open')
    inerted = []
    opener = null
  }
}

function onPageLoad(): void {
  forgetStale()
  // The nav's hint names the key this keyboard has.
  const apple = /Mac|iPhone|iPad/i.test(navigator.userAgent)
  for (const key of document.querySelectorAll('kbd[data-type="palette-key"]')) key.textContent = apple ? '⌘K' : 'Ctrl K'
}

function onKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey) return
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
  event.preventDefault()
  if (isPaletteOpen()) closePalette()
  else openPalette()
}

function onClick(event: MouseEvent): void {
  if (event.defaultPrevented) return
  if ((event.target as Element | null)?.closest('button[data-action="palette"]')) {
    event.preventDefault()
    openPalette()
  }
}

let wired = false

export function initFindUI(): void {
  if (wired) return
  wired = true
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('click', onClick)
  document.addEventListener('astro:page-load', onPageLoad)
  onPageLoad()
}
