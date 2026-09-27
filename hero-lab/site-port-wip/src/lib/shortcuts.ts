/**
 * Keyboard shortcuts: the three global ones, and the registry a page's own
 * shortcuts are listed in so the `?` sheet can show them.
 *
 * The rules live here, not in the handler, so security:smoke can hold them to
 * a truth table:
 *
 *  - `/` and `?` never fire from a typing target. They are characters people
 *    type — into Regex Lab's pattern, Type Trial's passage, Draftboard's
 *    editor — and stealing one would eat the keystroke.
 *  - ⌘K / Ctrl+K works everywhere, a text field included (it types nothing),
 *    EXCEPT inside `[data-keys="own"]`: a component that declares it owns the
 *    keyboard (an editor with its own ⌘K) keeps it.
 *  - An event that is composing (an IME mid-word), auto-repeating, or already
 *    handled (`defaultPrevented`) is never a shortcut.
 *
 * No DOM access at module scope; the listener itself is item C's
 * (src/lib/find-ui.ts), which reads these functions.
 */

export type GlobalShortcutId = 'palette' | 'search' | 'shortcuts'

export interface Shortcut {
  /** Key names as shown on the sheet, e.g. ['Mod', 'K'] (Mod is ⌘ on Apple, Ctrl elsewhere) or ['/']. */
  keys: readonly string[]
  /** What it does, as a sentence fragment: "Open the command palette". */
  label: string
}

export interface GlobalShortcut extends Shortcut {
  id: GlobalShortcutId
}

export const GLOBAL_SHORTCUTS: readonly GlobalShortcut[] = Object.freeze([
  { id: 'palette', keys: ['Mod', 'K'], label: 'Open the command palette' },
  { id: 'search', keys: ['/'], label: 'Search the site' },
  { id: 'shortcuts', keys: ['?'], label: 'Show keyboard shortcuts' },
])

/** The fields of a KeyboardEvent these rules read — a plain object satisfies it, which is what the truth table uses. */
export interface KeyLike {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  repeat?: boolean
  isComposing?: boolean
  keyCode?: number
  defaultPrevented?: boolean
  target?: EventTarget | null
}

interface ElementLike {
  tagName?: string
  isContentEditable?: boolean
  getAttribute?(name: string): string | null
  closest?(selector: string): unknown
}

/** Input types that take no typed text, so a keystroke there is still a keystroke for the page. */
const NON_TEXT_INPUTS = new Set([
  'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit',
])

/** True when a keystroke at `target` would type into something. */
export function isTypingTarget(target: EventTarget | null | undefined): boolean {
  const el = target as ElementLike | null | undefined
  if (!el || typeof el !== 'object') return false
  if (el.isContentEditable) return true
  const tag = (el.tagName ?? '').toLowerCase()
  if (tag === 'textarea' || tag === 'select') return true
  if (tag === 'input') return !NON_TEXT_INPUTS.has((el.getAttribute?.('type') ?? 'text').toLowerCase())
  const role = el.getAttribute?.('role')
  return role === 'textbox' || role === 'searchbox' || role === 'combobox'
}

function ownsKeys(target: EventTarget | null | undefined): boolean {
  const el = target as ElementLike | null | undefined
  return Boolean(el && typeof el.closest === 'function' && el.closest('[data-keys="own"]'))
}

/** The global shortcut this event is, or null. Applies every rule in the module docblock. */
export function matchGlobalShortcut(e: KeyLike): GlobalShortcut | null {
  if (!e || typeof e.key !== 'string') return null
  if (e.defaultPrevented || e.repeat || e.isComposing || e.keyCode === 229) return null
  const byId = (id: GlobalShortcutId) => GLOBAL_SHORTCUTS.find(s => s.id === id) ?? null
  const mod = Boolean(e.metaKey || e.ctrlKey)
  if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
    return ownsKeys(e.target) ? null : byId('palette')
  }
  if (mod || e.altKey) return null
  if (isTypingTarget(e.target) || ownsKeys(e.target)) return null
  // `key` is the character produced, so Shift is not checked for these two:
  // `?` is Shift+/ on a US layout, and `/` itself needs Shift on a German one.
  if (e.key === '/') return byId('search')
  if (e.key === '?') return byId('shortcuts')
  return null
}

/** Whether a global key handler should act on this event at all. */
export function shouldHandleGlobalKey(e: KeyLike): boolean {
  return matchGlobalShortcut(e) !== null
}

/* ── Page shortcuts: listed for the sheet, never dispatched from here ───── */

const pageShortcuts = new Map<string, readonly Shortcut[]>()

/**
 * List a page's own shortcuts (Webhook Inspector's R/C/N/P, a game's keys) so
 * the `?` sheet can show them. The page still handles its own keys; this is
 * the listing only. Returns the unregister, which the component calls from its
 * `disconnectedCallback` so a ClientRouter session does not keep listing the
 * shortcuts of a page it left.
 */
export function registerPageShortcuts(owner: string, list: readonly Shortcut[]): () => void {
  const entry = Object.freeze(list.map(s => Object.freeze({ keys: [...s.keys], label: s.label })))
  pageShortcuts.set(owner, entry)
  return () => {
    if (pageShortcuts.get(owner) === entry) pageShortcuts.delete(owner)
  }
}

/** The page shortcuts currently registered, per owner, in registration order. */
export function listPageShortcuts(): { owner: string; shortcuts: readonly Shortcut[] }[] {
  return [...pageShortcuts].map(([owner, shortcuts]) => ({ owner, shortcuts }))
}
