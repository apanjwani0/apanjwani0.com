/**
 * Mounts the game controller for whichever component is on the page.
 *
 * Shared by the game route and the learnings route: a learnings article embeds
 * the same custom element, so both need the same slug → module dispatch. Two
 * copies would drift the first time a component is renamed, and the failure mode
 * is silent (a blank canvas, only on one of the two routes).
 *
 * The dispatch stays an explicit if-chain rather than a lookup table of dynamic
 * imports because Vite needs each `import()` specifier to be statically
 * analysable to emit a chunk for it. A computed path would defeat that and pull
 * every game into one bundle.
 *
 * Call sites must run this on `astro:page-load` as well as at module scope:
 * ClientRouter is on, so bundled scripts execute once per session and a page
 * reached by in-site navigation would otherwise render an empty element.
 *
 * Returns the import promise so a caller can act once the element has upgraded —
 * the learnings route awaits it to strip the component's own heading. Resolves
 * immediately when there is nothing on the page to mount.
 */
export function mountGame(): Promise<unknown> {
  const slug = document.querySelector('[data-game]')?.getAttribute('data-game')
  if (slug === 'quintle') return import('../components/games/quintle/Quintle.ts')
  else if (slug === '2048') return import('../components/games/twenty48/Twenty48.ts')
  else if (slug === 'game-of-life') return import('../components/games/game-of-life/GameOfLife.ts')
  else if (slug === 'flow-field') return import('../components/games/flow-field/FlowField.ts')
  else if (slug === 'maze-weaver') return import('../components/games/maze-weaver/MazeWeaver.ts')
  else if (slug === 'type-trial') return import('../components/games/type-trial/TypeTrial.ts')
  else if (slug === 'hue-hunt') return import('../components/games/hue-hunt/HueHunt.ts')
  else if (slug === 'starfield-toy') return import('../components/games/starfield-toy/Starfield.ts')
  else if (slug === 'murmuration') return import('../components/games/murmuration/Murmuration.ts')
  else if (slug === 'turing-bloom') return import('../components/games/turing-bloom/TuringBloom.ts')
  else if (slug === 'sand-loom') return import('../components/games/sand-loom/SandLoom.ts')
  else if (slug === 'lsystem-tree') return import('../components/games/lsystem/LSystem.ts')
  else if (slug === 'poker-trainer') return import('../components/games/poker-trainer/PokerTrainer.ts')
  return Promise.resolve()
}

/**
 * Remove the component's own title block from a container that supplies its own.
 *
 * Every engine writes an `<h1>` and a blurb into itself, because on its old
 * `/games/<slug>` page it WAS the page. Embedded in an article or under a
 * Driftfield mode heading, both duplicate the header just above them and the
 * stray `<h1>` gives the document two top-level headings.
 *
 * A MutationObserver and not a sweep after mount: the component's markup lands
 * BEFORE `astro:page-load` when its module is already in the session's module
 * cache (every in-site navigation) and AFTER it on a cold load, so there is no
 * single moment that is safe to sweep at. A timing-based version of this passed
 * a hard reload and failed on every in-site click. Self-disconnects on the first
 * hit — the block is written once, in connectedCallback.
 */
export function stripEmbedChrome(container: Element): void {
  const strip = () => {
    const chrome = container.querySelectorAll('[data-type$="-header"], h1')
    chrome.forEach(el => el.remove())
    return chrome.length > 0
  }
  if (strip()) return
  const observer = new MutationObserver(() => { if (strip()) observer.disconnect() })
  observer.observe(container, { childList: true, subtree: true })
}

/** Strip the component's chrome, then mount it. What both embedding routes do. */
export function mountEmbed(containerSelector: string): void {
  const container = document.querySelector(containerSelector)
  if (container) stripEmbedChrome(container)
  mountGame()
}
