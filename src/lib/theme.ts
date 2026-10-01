/**
 * The visitor's theme: a preference (dark, light or system) kept per browser,
 * and the theme it resolves to on this page.
 *
 * Four rules, each one the reason a piece of this module exists:
 *
 *  - **The server never varies by theme.** There is no theme cookie. Every page
 *    ships `data-theme` = the site config's theme (`data-theme-default` carries
 *    the same value), so the edge cache holds one copy of each page for every
 *    visitor, and the choice is applied on the client.
 *  - **The choice lands before first paint.** `ROOT_BOOT_JS` is the head
 *    bootstrap Head.astro renders inline, ahead of every stylesheet. It is the
 *    site's ONLY inline executable script and it is byte-identical on every
 *    page: ClientRouter re-inserts a changed inline script with the new page's
 *    nonce, which the live document's CSP refuses, but it recognises an
 *    identical one as already run and leaves it alone. So nothing in it may be
 *    interpolated per page or per request — it is built once, from the
 *    constants below.
 *  - **A ClientRouter swap keeps it.** The router replaces every attribute on
 *    `<html>` with the incoming page's, which would reset a light visitor to
 *    dark on every in-site click. `patchIncomingDocument` (wired to
 *    `astro:before-swap` by src/lib/site-ui.ts) copies the live state onto the
 *    incoming document first.
 *  - **No DOM access at module scope.** src/lib/site-index.ts and the pages
 *    can import the types and pure functions server-side.
 *
 * The toggle (item B, src/lib/theme-ui.ts) cycles dark → light → system; see
 * `nextThemePref`.
 */

import { KIT_KEY, KIT_MAX, KIT_SLUG } from './kit'

export type ThemePref = 'light' | 'dark' | 'system'
export type Theme = 'light' | 'dark'

/** localStorage key. Versioned so a future shape can be told from this one. */
export const THEME_KEY = 'theme:v1'
/** CustomEvent<ThemeEventDetail> dispatched on `document` whenever the theme or the preference changes. */
export const THEME_EVENT = 'site:theme'

export interface ThemeEventDetail {
  theme: Theme
  /** The stored preference, or null when the visitor never chose (the site default applies). */
  pref: ThemePref | null
}

/** `<meta name="theme-color">` per theme: each theme's `--color-bg`, asserted against theme.css by security:smoke. */
export const THEME_COLOR: Readonly<Record<Theme, string>> = Object.freeze({ light: '#ffffff', dark: '#05070c' })

/** The root attributes that are client state rather than server output, which a swap must carry across. */
export const ROOT_STATE_ATTRS = ['data-theme', 'data-theme-pref', 'data-js', 'data-kit'] as const

const DARK_QUERY = '(prefers-color-scheme: dark)'
const THEME_CYCLE: readonly ThemePref[] = ['dark', 'light', 'system']

export function isThemePref(value: unknown): value is ThemePref {
  return value === 'light' || value === 'dark' || value === 'system'
}

/**
 * The theme a preference resolves to. Pure — the bootstrap, the toggle and the
 * swap patch all agree because they all mean this function (the bootstrap is
 * held to it by security:smoke across the whole truth table).
 *
 * No stored preference means the site config's theme, NOT the OS: a visitor
 * who never chose gets the site as designed, and "system" is something they
 * pick.
 */
export function resolveTheme(pref: ThemePref | null, ssrDefault: Theme, prefersDark: boolean): Theme {
  if (pref === 'light' || pref === 'dark') return pref
  if (pref === 'system') return prefersDark ? 'dark' : 'light'
  return ssrDefault
}

/** The toggle's next preference: dark → light → system → dark. */
export function nextThemePref(pref: ThemePref): ThemePref {
  return THEME_CYCLE[(THEME_CYCLE.indexOf(pref) + 1) % THEME_CYCLE.length]
}

/**
 * The head bootstrap. Runs synchronously before any stylesheet, so the first
 * paint is already in the visitor's theme. Every storage access is inside a
 * try — a private window, blocked site data or a sandboxed preview makes the
 * `localStorage` getter itself throw — and a failure falls back to the page's
 * own SSR theme.
 *
 * It also marks the document `data-js` (the nav's JS-only buttons stay hidden
 * without it) and `data-kit="<n>"` when the visitor has starred tools, so the
 * /tools shelf can reserve its height before the kit script runs. The count is
 * `sanitizeKit(stored).length` (src/lib/kit.ts) — security:smoke holds the two
 * to the same answer.
 */
export const ROOT_BOOT_JS = `(function(){var d=document.documentElement,p=null,n=0,m=false;`
  + `try{var s=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(s==="light"||s==="dark"||s==="system")p=s}catch(e){}`
  + `try{m=matchMedia(${JSON.stringify(DARK_QUERY)}).matches}catch(e){}`
  + `var t=p==="light"||p==="dark"?p:p==="system"?(m?"dark":"light"):(d.getAttribute("data-theme-default")||d.getAttribute("data-theme"))==="light"?"light":"dark";`
  + `try{var k=JSON.parse(localStorage.getItem(${JSON.stringify(KIT_KEY)})||"null"),q=[];`
  + `if(k&&k.v===1&&Array.isArray(k.slugs))for(var i=0;i<k.slugs.length&&q.length<${KIT_MAX};i++){var x=k.slugs[i];`
  + `if(typeof x==="string"&&/${KIT_SLUG.source}/.test(x)&&q.indexOf(x)<0)q.push(x)}n=q.length}catch(e){}`
  + `d.setAttribute("data-theme",t);if(p)d.setAttribute("data-theme-pref",p);else d.removeAttribute("data-theme-pref");`
  + `d.setAttribute("data-js","");if(n)d.setAttribute("data-kit",String(n));else d.removeAttribute("data-kit");`
  + `var c=document.querySelector('meta[name="theme-color"]');if(c)c.setAttribute("content",t==="light"?${JSON.stringify(THEME_COLOR.light)}:${JSON.stringify(THEME_COLOR.dark)});`
  + `var cs=document.querySelector('meta[name="color-scheme"]');if(cs)cs.setAttribute("content",t)})();`

/* ── Browser-side state. Everything below touches the DOM only when called. ── */

function root(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.documentElement
}

function ssrDefault(): Theme {
  return root()?.getAttribute('data-theme-default') === 'light' ? 'light' : 'dark'
}

function prefersDark(): boolean {
  try {
    return window.matchMedia(DARK_QUERY).matches
  } catch {
    return false
  }
}

/**
 * The stored preference, or null when there is none. When storage itself is
 * unavailable, the preference this page is already showing (set by the
 * bootstrap or by `setThemePref`) stands in, so a toggle still holds for the
 * rest of the visit.
 */
export function readThemePref(): ThemePref | null {
  try {
    const stored = window.localStorage.getItem(THEME_KEY)
    return isThemePref(stored) ? stored : null
  } catch {
    const shown = root()?.getAttribute('data-theme-pref')
    return isThemePref(shown) ? shown : null
  }
}

/** The theme this page is rendering right now. */
export function currentTheme(): Theme {
  return root()?.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

function setMeta(name: string, content: string): void {
  document.querySelector(`meta[name="${name}"]`)?.setAttribute('content', content)
}

/** Resolve a preference, paint it, and tell subscribers if anything changed. */
function applyThemePref(pref: ThemePref | null): Theme {
  const el = root()
  const theme = resolveTheme(pref, ssrDefault(), prefersDark())
  if (!el) return theme
  const changed = el.getAttribute('data-theme') !== theme || el.getAttribute('data-theme-pref') !== pref
  el.setAttribute('data-theme', theme)
  if (pref) el.setAttribute('data-theme-pref', pref)
  else el.removeAttribute('data-theme-pref')
  setMeta('theme-color', THEME_COLOR[theme])
  setMeta('color-scheme', theme)
  if (changed) {
    document.dispatchEvent(new CustomEvent<ThemeEventDetail>(THEME_EVENT, { detail: { theme, pref } }))
  }
  return theme
}

/** Store a preference and apply it to this page. Returns the theme it resolved to. */
export function setThemePref(pref: ThemePref): Theme {
  if (!isThemePref(pref)) return currentTheme()
  try {
    window.localStorage.setItem(THEME_KEY, pref)
  } catch {
    // Storage refused (private window, blocked site data): the choice still
    // applies to this page, it just will not outlive it.
  }
  return applyThemePref(pref)
}

let watching = false

/**
 * Keep the page on the visitor's preference when it changes somewhere other
 * than this page's own toggle: another tab (`storage`), the OS while the
 * preference is `system`, and a restore from the back/forward cache, where the
 * page comes back exactly as it was left even if the choice changed since.
 *
 * Registered once per document, behind the module guard: `window` outlives
 * every ClientRouter navigation, so once is both correct and leak-free.
 * src/lib/site-ui.ts calls this on every page; `onThemeChange` calls it too.
 */
export function watchThemePref(): void {
  if (watching) return
  if (typeof window === 'undefined') return
  watching = true
  window.addEventListener('storage', onStorage)
  window.addEventListener('pageshow', onPageShow)
  try {
    window.matchMedia(DARK_QUERY).addEventListener('change', onSchemeChange)
  } catch {
    // An engine without matchMedia listeners cannot follow the OS live; the
    // next page load still resolves `system` correctly.
  }
}

function onStorage(event: StorageEvent): void {
  // A null key is storage.clear() from another tab.
  if (event.key === THEME_KEY || event.key === null) applyThemePref(readThemePref())
}

function onPageShow(event: PageTransitionEvent): void {
  if (event.persisted) applyThemePref(readThemePref())
}

function onSchemeChange(): void {
  // Only a `system` preference follows the OS. Explicit dark/light, and no
  // preference at all (the site default), ignore it.
  if (readThemePref() === 'system') applyThemePref('system')
}

/**
 * Subscribe to theme changes — this tab's toggle, another tab, and the OS while
 * the preference is `system`. Returns the unsubscribe, which a component calls
 * from its `disconnectedCallback`: the listener is on `document`, which a
 * ClientRouter session keeps for its whole life.
 */
export function onThemeChange(callback: (detail: ThemeEventDetail) => void): () => void {
  if (typeof document === 'undefined') return () => {}
  watchThemePref()
  const handler = (event: Event) => callback((event as CustomEvent<ThemeEventDetail>).detail)
  document.addEventListener(THEME_EVENT, handler)
  return () => document.removeEventListener(THEME_EVENT, handler)
}

/**
 * Carry the live document's client state onto the document ClientRouter is
 * about to swap in: `data-theme`, `data-theme-pref`, `data-js`, `data-kit`,
 * and the theme-color / color-scheme metas the bootstrap maintains. Without
 * it, `swapRootAttributes` resets every one of them to the incoming page's SSR
 * value, and a light visitor's page flashes dark on every in-site click.
 */
export function patchIncomingDocument(doc: Document): void {
  const live = root()
  const next = doc?.documentElement
  if (!live || !next) return
  for (const name of ROOT_STATE_ATTRS) {
    const value = live.getAttribute(name)
    if (value === null) next.removeAttribute(name)
    else next.setAttribute(name, value)
  }
  for (const name of ['theme-color', 'color-scheme']) {
    const content = document.querySelector(`meta[name="${name}"]`)?.getAttribute('content')
    const incoming = doc.querySelector(`meta[name="${name}"]`)
    if (content != null && incoming) incoming.setAttribute('content', content)
  }
}
