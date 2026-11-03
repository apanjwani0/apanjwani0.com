/**
 * Every custom element that can be mounted into a page, by slug.
 *
 * This is the master list, and it is deliberately larger than the set of games.
 * A component can appear in three places now:
 *
 *   /games/<slug>                   — it is the page (GAME_TAGS, a subset of this)
 *   /tools/driftfield/<mode>        — it is one mode of the generative tool
 *   /learnings/<slug>               — it is a figure inside an article
 *
 * The six Driftfield engines are in none of the games config any more, but they
 * are still mounted by two of those three routes, so "is wired to a component"
 * and "is a game" had to stop being the same question. They were the same
 * question until the generative engines moved out of /games, and conflating them
 * would have silently emptied every article embed.
 *
 * Lives in src/lib/ and NOT in src/config/ because the /admin Vite middleware
 * regenerates the config files wholesale — an export added there is deleted on
 * the next admin save.
 */
export const EMBED_TAGS: Record<string, string> = {
  // Games — playable, with their own /games page.
  '2048': 'twenty48-game',
  'quintle': 'quintle-game',
  'maze-weaver': 'maze-weaver-game',
  'type-trial': 'type-trial-game',
  'hue-hunt': 'hue-hunt-game',
  'poker-trainer': 'poker-trainer-game',
  'deep-shore': 'deep-shore-game',
  // Simulations — no /games page; they live in articles and/or Driftfield.
  'game-of-life': 'game-of-life-game',
  'flow-field': 'flow-field-game',
  'starfield-toy': 'starfield-voyager-game',
  'murmuration': 'murmuration-game',
  'turing-bloom': 'turing-bloom-game',
  'sand-loom': 'sand-loom-game',
  'lsystem-tree': 'lsystem-tree-game',
  // Figures — neither a game nor a Driftfield mode. These exist only to be
  // embedded in an article, which is why EMBED_TAGS is the wider list.
  'diagram-atlas': 'diagram-atlas-figure',
  'internet-atlas': 'internet-atlas-figure',
}

/**
 * The module each embed's controller lives in, by slug, as a path under `src/`:
 * the same file `mountGame()` (src/lib/game-mount.ts) imports for that slug.
 *
 * Pages name it in the head as `<link rel="modulepreload">` (`embedPreloads()`
 * in `embed-styles.ts`), so the browser fetches the game's code while it parses
 * the page instead of after the page script has run. `security:smoke` reads
 * both files and fails if a slug's path here is not the one `mountGame()`
 * imports, or if a slug in one has no entry in the other.
 */
export const EMBED_MODULES: Record<string, string> = {
  'quintle': 'components/games/quintle/Quintle.ts',
  '2048': 'components/games/twenty48/Twenty48.ts',
  'game-of-life': 'components/games/game-of-life/GameOfLife.ts',
  'flow-field': 'components/games/flow-field/FlowField.ts',
  'maze-weaver': 'components/games/maze-weaver/MazeWeaver.ts',
  'type-trial': 'components/games/type-trial/TypeTrial.ts',
  'hue-hunt': 'components/games/hue-hunt/HueHunt.ts',
  'starfield-toy': 'components/games/starfield-toy/Starfield.ts',
  'murmuration': 'components/games/murmuration/Murmuration.ts',
  'turing-bloom': 'components/games/turing-bloom/TuringBloom.ts',
  'sand-loom': 'components/games/sand-loom/SandLoom.ts',
  'lsystem-tree': 'components/games/lsystem/LSystem.ts',
  'poker-trainer': 'components/games/poker-trainer/PokerTrainer.ts',
  'deep-shore': 'components/games/deep-shore/DeepShore.ts',
  'diagram-atlas': 'components/games/diagram-atlas/DiagramAtlas.ts',
  'internet-atlas': 'components/games/internet-atlas/InternetAtlas.ts',
}

/**
 * Embeds that write NO title block of their own, so `stripEmbedChrome` has
 * nothing to wait for and starts no observer.
 *
 * Every game and simulation writes an `<h1>` and a blurb into itself, because on
 * its own page it WAS the page, and the embedding routes strip them with a
 * MutationObserver that disconnects on its first hit. A figure written only to
 * be embedded writes neither — so its observer never got a hit, never
 * disconnected, and re-scanned the container on every mutation for the life of
 * the page: eight of them on the diagrams article, five of whose figures redraw
 * on a timer. `security:smoke` derives this set from the components' own sources
 * in both directions, so it cannot drift from what they actually render.
 */
export const EMBED_NO_CHROME: ReadonlySet<string> = new Set(['diagram-atlas', 'internet-atlas'])

/**
 * The tag to mount for a slug, or undefined when nothing is wired.
 *
 * `Object.hasOwn` and not `EMBED_TAGS[slug]`: a slug of `constructor` or
 * `toString` would otherwise resolve to an inherited function, which is truthy.
 */
export function embedTag(slug: string | undefined): string | undefined {
  if (!slug || !Object.hasOwn(EMBED_TAGS, slug)) return undefined
  return EMBED_TAGS[slug]
}

const GAMES_COMMON = 'components/games/games-common.css'
const EXPORT_BAR = 'styles/canvas-export.css'

/**
 * The stylesheets each embed needs, by slug, as paths under `src/`: the one
 * list of component stylesheets.
 *
 * A page links the sheets of the one component it renders (`embedStyles()` in
 * `embed-styles.ts`) instead of a bundle of all of them, which put every game's
 * CSS (about 115 KB) on every game and article page. Order is cascade order:
 * the shared floor first, then the component's own sheets, then the export bar
 * for the engines that attach one (src/lib/canvas-export.ts).
 *
 * `security:smoke` asserts the list from the other side: every `EMBED_TAGS`
 * slug has an entry, every sheet exists, every stylesheet under
 * `src/components/games/` is named here, and a component that imports
 * `canvas-export` lists its sheet. Internet Atlas draws its figure with Diagram
 * Atlas's classes, so it lists both.
 */
export const EMBED_STYLES: Record<string, readonly string[]> = {
  '2048': [GAMES_COMMON, 'components/games/twenty48/twenty48.css'],
  'quintle': [GAMES_COMMON, 'components/games/quintle/quintle.css'],
  'maze-weaver': [GAMES_COMMON, 'components/games/maze-weaver/maze-weaver.css'],
  'type-trial': [GAMES_COMMON, 'components/games/type-trial/type-trial.css'],
  'hue-hunt': [GAMES_COMMON, 'components/games/hue-hunt/hue-hunt.css'],
  'poker-trainer': [GAMES_COMMON, 'components/games/poker-trainer/poker-trainer.css'],
  'deep-shore': [GAMES_COMMON, 'components/games/deep-shore/deep-shore.css', EXPORT_BAR],
  'game-of-life': [GAMES_COMMON, 'components/games/game-of-life/game-of-life.css'],
  'flow-field': [GAMES_COMMON, 'components/games/flow-field/flow-field.css', EXPORT_BAR],
  'starfield-toy': [GAMES_COMMON, 'components/games/starfield-toy/starfield.css', EXPORT_BAR],
  'murmuration': [GAMES_COMMON, 'components/games/murmuration/murmuration.css', EXPORT_BAR],
  'turing-bloom': [GAMES_COMMON, 'components/games/turing-bloom/turing-bloom.css', EXPORT_BAR],
  'sand-loom': [GAMES_COMMON, 'components/games/sand-loom/sand-loom.css', EXPORT_BAR],
  'lsystem-tree': [GAMES_COMMON, 'components/games/lsystem/lsystem.css', EXPORT_BAR],
  'diagram-atlas': [GAMES_COMMON, 'components/games/diagram-atlas/diagram-atlas.css'],
  'internet-atlas': [
    GAMES_COMMON,
    'components/games/diagram-atlas/diagram-atlas.css',
    'components/games/internet-atlas/internet-atlas.css',
  ],
}
