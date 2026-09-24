/**
 * Live filter for the /tools and /games hub pages.
 *
 * Progressive enhancement: the `<form data-type="hub-filter">` ships with the
 * `hidden` attribute and is revealed here, so a no-JS visitor sees the full
 * list and no dead control. Matching is term-AND over a card's full text
 * (title, description, badges) — "daily game" narrows to cards containing both
 * words. Matches are highlighted in place with `<mark data-hub-mark>` (Oat
 * styles `mark` from its own tokens), so the eye lands on WHY a card survived
 * the filter, not just that it did. The query mirrors into `?q=` via
 * replaceState, so a filtered view is shareable (`/tools?q=webhook`) and
 * arrives pre-filtered.
 *
 * STATUS FACETS: alongside the text box, a row of toggle chips ("all" plus one
 * per status, each with its live card count) narrows by the `data-status`
 * attribute the hub pages stamp on every card (/tools: live | wip | external;
 * /games: playable | soon). The chips are built HERE, from the cards actually
 * in the grid — a status the grid doesn't contain gets no chip, and the counts
 * can never disagree with the page, because they are derived from it. Facet
 * and text compose (AND), the active facet mirrors into `?status=` next to
 * `?q=`, and a `?status=` arriving in a deep link is checked against the set
 * of statuses the grid really has before it is trusted. Chips only render when
 * the grid has at least two distinct statuses — one status means the facet
 * could never narrow anything and would be pure chrome.
 *
 * The `?q=`/`?status=` URL mirror is DEBOUNCED (and each scheduled write is
 * pinned to the pathname it was scheduled on): Safari rate-limits
 * history.replaceState and throws when a fast typist exceeds it, and a write
 * that fires after an in-site navigation would graffiti the NEXT page's URL
 * with this page's filter state.
 *
 * Highlighting invariants (asserted in scripts/security-smoke.mjs):
 * - every previous mark is unwrapped (and the text re-normalized) BEFORE new
 *   ones are painted — re-wrapping over stale marks nests them and corrupts
 *   the card text a little more on every keystroke;
 * - user terms are regex-escaped before being compiled into the highlight
 *   pattern — "c++" is a search term, not a syntax error;
 * - terms are sorted longest-first so an alternation like "web|webhook"
 *   cannot shadow the longer match;
 * - and — the one the first version got wrong — **the highlighter matches the
 *   same string the filter matched**. A card survives on its `textContent`,
 *   which is every text node in the subtree concatenated, but the paint used to
 *   run the pattern against each text node ON ITS OWN. Any occurrence straddling
 *   an element boundary (`<h2>Web</h2><span>hook</span>`, a title with an inline
 *   `<code>` or `<abbr>` in it, a description broken by an `<em>`) therefore kept
 *   the card and highlighted nothing, which reads as a false positive: the filter
 *   says this matched and the card cannot show you where. `hubMarkRanges` below
 *   is the fix — it matches over the JOINED text and hands each node back the
 *   slices of that match it owns, so one logical hit paints as one contiguous
 *   run of `<mark>`s across however many nodes the markup happens to use.
 *   Splitting the same text into more nodes must never change what is marked.
 *
 * Mounting rules (see AGENTS.md): the ClientRouter means bundled scripts run
 * once per session, so all work happens inside an `astro:page-load` listener.
 * Two guards keep that safe however many hub pages register it: the
 * module-level flag ensures only ONE listener + ONE "/" shortcut handler exist
 * (this module is a session singleton), and the per-form `data-wired` marker
 * makes a second init call on the same fresh DOM a no-op.
 */

/** Below this many cards a filter is chrome, not utility — stay hidden. */
const MIN_CARDS_FOR_FILTER = 5

/**
 * Human labels for the `data-status` values the two hubs stamp on their cards.
 * Both hubs' "not yet playable/usable" statuses read "coming soon" on purpose —
 * the chip vocabulary should match the badge on the card, not the config enum.
 * An unmapped status falls back to its raw value rather than being dropped, so
 * a future status still gets a (rough) chip instead of silently no facet.
 */
const FACET_LABELS: Record<string, string> = {
  live: 'live',
  wip: 'coming soon',
  external: 'external',
  playable: 'playable',
  soon: 'coming soon',
}

let registered = false

/** Regex-escape a user-typed term so it can join the highlight pattern. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Unwrap every highlight this module painted into `root`, merging the split
 * text nodes back together. Scoped by the data attribute so an author-written
 * `==highlight==` mark in a card description is never touched.
 */
function clearMarks(root: HTMLElement): void {
  const marks = root.querySelectorAll('mark[data-hub-mark]')
  if (marks.length === 0) return
  for (const m of Array.from(marks)) {
    const parent = m.parentNode
    if (!parent) continue
    m.replaceWith(document.createTextNode(m.textContent ?? ''))
    parent.normalize()
  }
}

/**
 * Compile the highlight pattern for a set of user terms. Each term is
 * regex-escaped (the box is a search field: "c++" is a term, not a syntax
 * error that would kill every later keystroke's handler) and longer terms sort
 * first, so an alternation built from "web" and "webhook" prefers the fuller
 * match instead of leaving "hook" unpainted.
 *
 * Exported so the assertions compile the real pattern rather than a copy of it.
 */
export function hubHighlightPattern(terms: string[]): RegExp {
  return new RegExp(
    [...terms].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|'),
    'gi',
  )
}

/**
 * Map term occurrences onto a run of consecutive text-node strings.
 *
 * `chunks` is the card's text nodes in document order; the return value is, per
 * chunk, the `[start, end)` slices to wrap in `<mark>`. **Matching happens on
 * the JOINED string**, which is exactly the `textContent` the filter itself
 * matched against, and each match is then cut at the node boundaries it crosses.
 * That is the whole point: a term spanning two nodes yields a range in each, so
 * the paint can never disagree with the decision to keep the card.
 *
 * Pure and DOM-free so `security:smoke` can hold it to the property that
 * matters — re-splitting the same text into different nodes marks the same
 * characters — rather than to a screenshot of one markup shape.
 */
export function hubMarkRanges(chunks: string[], terms: string[]): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = chunks.map(() => [])
  const real = terms.filter(t => t.length > 0)
  if (real.length === 0 || chunks.length === 0) return out

  const joined = chunks.join('')
  if (joined.length === 0) return out
  // Start offset of each chunk within `joined`, so a match can be cut at the
  // boundaries it crosses without re-scanning anything.
  const starts: number[] = []
  for (let i = 0, acc = 0; i < chunks.length; i++) {
    starts.push(acc)
    acc += chunks[i].length
  }

  const pattern = hubHighlightPattern(real)
  for (let m = pattern.exec(joined); m; m = pattern.exec(joined)) {
    // A zero-length match cannot happen with non-empty terms, but a guard is
    // cheaper than the infinite loop it would otherwise cause.
    if (m[0].length === 0) { pattern.lastIndex++; continue }
    const from = m.index
    const to = m.index + m[0].length
    for (let i = 0; i < chunks.length; i++) {
      const cs = starts[i]
      const ce = cs + chunks[i].length
      // An EMPTY text node sitting inside a match (a comment or an empty inline
      // element leaves them) intersects it by zero characters — skipped here, or
      // the caller would wrap an empty <mark> that no one can see and no
      // subsequent slice can account for.
      if (ce === cs || ce <= from || cs >= to) continue
      out[i].push([Math.max(from, cs) - cs, Math.min(to, ce) - cs])
    }
  }
  return out
}

/**
 * Wrap each term occurrence in `root`'s text with `<mark data-hub-mark>`.
 * Text nodes are collected FIRST and then rewritten — mutating while the
 * TreeWalker is live would walk the nodes the rewrite just created — and the
 * ranges come from `hubMarkRanges`, which matches across node boundaries.
 */
function highlightTerms(root: HTMLElement, terms: string[]): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text)
  if (nodes.length === 0) return

  const ranges = hubMarkRanges(nodes.map(n => n.nodeValue ?? ''), terms)
  for (let i = 0; i < nodes.length; i++) {
    const spans = ranges[i]
    if (spans.length === 0) continue
    const text = nodes[i].nodeValue ?? ''
    const frag = document.createDocumentFragment()
    let last = 0
    for (const [from, to] of spans) {
      if (from > last) frag.appendChild(document.createTextNode(text.slice(last, from)))
      const mark = document.createElement('mark')
      mark.dataset.hubMark = ''
      mark.textContent = text.slice(from, to)
      frag.appendChild(mark)
      last = to
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
    nodes[i].replaceWith(frag)
  }
}

export function registerHubFilter(): void {
  if (registered) return
  registered = true

  // Fires on the initial load too when the ClientRouter is active (it is on
  // every Base page), so no separate first call is needed — but one is made
  // anyway in case this ever runs on a page without the router, where the
  // event never fires. `data-wired` makes the double call harmless.
  document.addEventListener('astro:page-load', initHubFilter)
  initHubFilter()

  // "/" focuses the filter — matching the keyboard-first convention the tools
  // themselves follow. Registered once at module level: the listener survives
  // client-side navigation and re-resolves the current page's input each press,
  // so it works on every hub without stacking handlers.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
    const input = document.querySelector<HTMLInputElement>(
      'form[data-type="hub-filter"]:not([hidden]) input[type="search"]',
    )
    if (!input) return
    e.preventDefault()
    input.focus()
    input.select()
  })
}

function initHubFilter(): void {
  const form = document.querySelector<HTMLFormElement>('form[data-type="hub-filter"]')
  if (!form || form.dataset.wired) return
  form.dataset.wired = '1'

  const input = form.querySelector<HTMLInputElement>('input[type="search"]')
  const status = form.querySelector<HTMLElement>('[data-type="hub-filter-status"]')
  const grid = document.querySelector<HTMLElement>('[data-type="card-grid"]')
  if (!input || !status || !grid) return

  const cards = Array.from(grid.children).filter((c): c is HTMLElement => c instanceof HTMLElement)
  if (cards.length < MIN_CARDS_FOR_FILTER) return
  form.hidden = false

  // Filtering is live; Enter must not reload the page into a GET /?q= submit.
  form.addEventListener('submit', (e) => e.preventDefault())

  // Each card's searchable text, computed once — lowercased, whitespace-collapsed.
  const haystacks = cards.map(c => (c.textContent ?? '').toLowerCase().replace(/\s+/g, ' '))
  const total = cards.length
  const noun = form.dataset.noun || 'items'

  // ── Status facet chips, derived from the cards actually in the grid ──
  // First-appearance order keeps the chip row aligned with the page's own
  // ordering; counts come from the same walk, so they cannot disagree with it.
  const statusCounts = new Map<string, number>()
  for (const card of cards) {
    const s = card.dataset.status
    if (s) statusCounts.set(s, (statusCounts.get(s) ?? 0) + 1)
  }
  /** '' = all. The only values ever assigned are keys of statusCounts. */
  let facet = ''
  const facetButtons = new Map<string, HTMLButtonElement>()
  if (statusCounts.size >= 2) {
    const row = document.createElement('div')
    row.dataset.type = 'hub-filter-facets'
    row.setAttribute('role', 'group')
    row.setAttribute('aria-label', `Filter ${noun} by status`)
    const addChip = (value: string, label: string, count: number) => {
      const btn = document.createElement('button')
      // A button inside a form defaults to type=submit; without this every
      // chip click would fire the submit handler's preventDefault path AND
      // look like a form submission to assistive tech.
      btn.type = 'button'
      btn.dataset.facet = value
      btn.setAttribute('aria-pressed', value === facet ? 'true' : 'false')
      btn.textContent = `${label} (${count})`
      btn.addEventListener('click', () => {
        facet = facet === value ? '' : value
        for (const [v, b] of facetButtons) b.setAttribute('aria-pressed', v === facet ? 'true' : 'false')
        apply()
      })
      facetButtons.set(value, btn)
      row.appendChild(btn)
    }
    // Toggling a chip off returns to 'all'; the click handler repaints every
    // chip's aria-pressed (including 'all'), so exactly one always reads
    // pressed whichever way a toggle lands.
    addChip('', 'all', total)
    for (const [s, n] of statusCounts) addChip(s, FACET_LABELS[s] ?? s, n)
    form.appendChild(row)
  }

  // The URL mirror is debounced: Safari rate-limits replaceState (and throws
  // past the limit), and a per-keystroke write is churn the address bar never
  // shows anyway. The scheduled write is pinned to the pathname it was
  // scheduled on — firing after an in-site navigation would stamp this page's
  // filter state onto the NEXT page's URL.
  let urlTimer: ReturnType<typeof setTimeout> | undefined
  const syncUrl = () => {
    const url = new URL(location.href)
    if (input.value) url.searchParams.set('q', input.value)
    else url.searchParams.delete('q')
    if (facet) url.searchParams.set('status', facet)
    else url.searchParams.delete('status')
    // Keep the filtered view shareable without polluting history. Passing the
    // existing state through preserves the ClientRouter's scroll bookkeeping.
    try { history.replaceState(history.state, '', url) } catch { /* throttled — the next edit retries */ }
  }

  const apply = () => {
    const terms = input.value.toLowerCase().split(/\s+/).filter(Boolean)
    let shown = 0
    cards.forEach((card, i) => {
      const hit =
        terms.every(t => haystacks[i].includes(t)) &&
        (facet === '' || card.dataset.status === facet)
      card.hidden = !hit
      // Old marks come off unconditionally (the query changed, so every
      // existing highlight is stale); fresh ones go only on visible cards.
      // Marks alter element structure, never character data, so the
      // precomputed haystacks stay truthful.
      clearMarks(card)
      if (hit && terms.length > 0) highlightTerms(card, terms)
      if (hit) shown++
    })
    if (terms.length === 0 && facet === '') {
      status.hidden = true
      status.textContent = ''
    } else {
      status.hidden = false
      status.textContent =
        shown === 0
          ? `No ${noun} match “${input.value.trim()}” — try a shorter term or another status.`
          : `${shown} of ${total} ${noun} shown`
    }
    clearTimeout(urlTimer)
    const path = location.pathname
    urlTimer = setTimeout(() => { if (location.pathname === path) syncUrl() }, 250)
  }

  input.addEventListener('input', apply)
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    if (input.value) {
      input.value = ''
      apply()
      // Cleared is a state change worth keeping focus for; only a second
      // Escape on an already-empty box releases the input.
      e.stopPropagation()
    } else {
      input.blur()
    }
  })

  // Deep link: /tools?q=webhook&status=live arrives already narrowed. The
  // ?status value is checked against the statuses the grid really contains
  // before it is trusted — a stale or hand-edited value degrades to 'all'
  // rather than silently hiding every card.
  const arriveUrl = new URL(location.href)
  const q = arriveUrl.searchParams.get('q')
  const st = arriveUrl.searchParams.get('status')
  if (st && statusCounts.has(st) && facetButtons.has(st)) {
    facet = st
    for (const [v, b] of facetButtons) b.setAttribute('aria-pressed', v === facet ? 'true' : 'false')
  }
  if (q) input.value = q
  if (q || facet !== '') apply()
}
