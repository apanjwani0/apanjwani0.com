/**
 * Shared button-label "flash" feedback — the one copy of the pattern every tool
 * uses after a copy/save/send action ("Copied!", "Failed", "Saved!").
 *
 * This replaced ten near-identical private `flash()` methods (nine tools plus
 * wallpaper-forge's `flashCopyStatus`), seven of which shared the same latent
 * bug: no per-button timer clearing, so clicking twice inside the flash window
 * left the FIRST timeout to restore the label early, cutting the second flash
 * short. codec-forge had the other variant — one timer field shared across all
 * its buttons, so flashing button B cancelled the restore of button A, leaving
 * A stuck on "Copied!". A WeakMap keyed by the element gives every button its
 * own timer, cleared before re-arming, which fixes both shapes at once.
 *
 * The original label is stashed in `data-label` on first flash (never
 * overwritten, so a flash-during-flash still restores the true label), and the
 * element gets `aria-live="polite"` once so the swap to "Copied!" is announced
 * to screen-reader users — previously the feedback was visual-only in every
 * tool. Restore is skipped if the element left the DOM.
 */

const timers = new WeakMap<HTMLElement, number>()

function rearm(el: HTMLElement, ms: number, restore: () => void): void {
  const prev = timers.get(el)
  if (prev !== undefined) window.clearTimeout(prev)
  timers.set(el, window.setTimeout(() => {
    timers.delete(el)
    restore()
  }, ms))
}

/** Swap a button's text to `label`, restoring the original after `ms`. */
export function flashLabel(el: HTMLElement | null, label: string, ms = 1200): void {
  if (!el) return
  if (!el.hasAttribute('aria-live')) el.setAttribute('aria-live', 'polite')
  const original = el.dataset.label ?? el.textContent ?? ''
  if (!el.dataset.label) el.dataset.label = original
  el.textContent = label
  rearm(el, ms, () => { if (el.isConnected) el.textContent = el.dataset.label ?? original })
}

/**
 * Attribute variant for buttons whose content is markup, not text (epoch-wizard
 * snippet buttons): sets `data-flash="label"` for CSS to render as a badge, and
 * removes it after `ms`. Same per-element timer discipline as flashLabel.
 */
export function flashBadge(el: HTMLElement | null, label: string, ms = 1200): void {
  if (!el) return
  if (!el.hasAttribute('aria-live')) el.setAttribute('aria-live', 'polite')
  el.setAttribute('data-flash', label)
  rearm(el, ms, () => el.removeAttribute('data-flash'))
}
