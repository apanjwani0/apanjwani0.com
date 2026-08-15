/**
 * Social-share (Open Graph / Twitter) preview-image metadata, shared by both page
 * shells (Base.astro + ToolBase.astro) so the share image, its dimensions and its
 * card type live in ONE place instead of duplicated across the two layouts.
 *
 * Two shapes:
 *
 *  - Tool and game pages get a generated 1200×630 landscape card (public/og/,
 *    written by `npm run og`). A link to one of these is a link to a product, so
 *    it should unfurl showing which product — not a photo of a person. Landscape
 *    is also what earns the large Twitter card.
 *  - Everything else falls back to the portrait avatar. On the home page and the
 *    about-ish pages the subject really is the person, so the portrait is right
 *    there, and it only supports the small `summary` card at 320×468.
 *
 * The URL is resolved to an ABSOLUTE href against the site origin because
 * og:image must be absolute for cross-site unfurlers (Slack, X, iMessage…).
 *
 * scripts/generate-og.mjs imports the names, dimensions and eligibility rules
 * below — the generator and the pages cannot disagree about which cards exist.
 */

/** Dimensions of a generated card. */
export const OG_CARD_WIDTH = 1200
export const OG_CARD_HEIGHT = 630

export interface OgImage {
  src: string
  width: number
  height: number
  alt: string
  /** X/Twitter card type — large only when the image is actually landscape. */
  card: 'summary' | 'summary_large_image'
  /** MIME type, so scrapers do not have to sniff it. */
  type: string
}

/**
 * File and URL-path names of the generated card for a tool or game.
 *
 * Derived from kind + slug rather than stored as a config field: the generator
 * writes exactly these names from the same config, so a separate `image` key
 * would be a second source of truth that can only ever disagree.
 */
export function ogCardFile(kind: 'tools' | 'games', slug: string): string {
  return `${kind}-${slug}.png`
}

export function ogCardPath(kind: 'tools' | 'games', slug: string): string {
  return `/og/${ogCardFile(kind, slug)}`
}

/** Which items get a card — the generator renders exactly this set, so pages
 *  must not emit a card URL for anything outside it. */
export function toolHasOgCard(tool: { status: string }): boolean {
  return tool.status !== 'external' && tool.status !== 'disabled'
}

export function gameHasOgCard(game: { enabled?: boolean; interactive?: boolean }): boolean {
  return Boolean(game.enabled && game.interactive)
}

// Cards on disk, read once per process. Directories cover dev (public/) and the
// standalone Node build (dist/client/). `null` = could not look (non-Node
// runtime) — callers then assume the card exists rather than dropping them all.
let cardNames: Promise<Set<string> | null> | undefined

async function readCardNames(): Promise<Set<string> | null> {
  try {
    const { readdir } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const names = new Set<string>()
    let readAny = false
    for (const dir of [join('public', 'og'), join('dist', 'client', 'og')]) {
      try {
        for (const file of await readdir(join(process.cwd(), dir))) names.add(file)
        readAny = true
      } catch {
        // Directory absent in this runtime — the other one may exist.
      }
    }
    return readAny ? names : null
  } catch {
    return null
  }
}

/**
 * ogCardPath, but only when the PNG actually exists — this is what makes the
 * documented behavior true: a forgotten `npm run og` degrades the page to the
 * avatar fallback instead of shipping an og:image URL that 404s. Cached for the
 * process lifetime; a card added in dev needs a server restart to be seen.
 */
export async function existingOgCardPath(
  kind: 'tools' | 'games',
  slug: string,
): Promise<string | undefined> {
  const names = await (cardNames ??= readCardNames())
  if (names === null || names.has(ogCardFile(kind, slug))) return ogCardPath(kind, slug)
  return undefined
}

export function ogImageMeta(
  site: { url: string; avatar: string; name: string },
  /** Generated card path from existingOgCardPath(); omit for the portrait fallback. */
  cardPath?: string,
  /** Product name, used for the card's alt text. */
  cardTitle?: string,
): OgImage {
  if (cardPath) {
    return {
      src: new URL(cardPath, site.url).href,
      width: OG_CARD_WIDTH,
      height: OG_CARD_HEIGHT,
      // Describes what the card actually shows. Deliberately without the site
      // owner's name — these pages are products, and the name in a share card's
      // alt buys nothing while making the tool read as a personal side project.
      alt: cardTitle ?? site.name,
      card: 'summary_large_image',
      type: 'image/png',
    }
  }

  return {
    src: new URL(site.avatar, site.url).href,
    width: 320,
    height: 468,
    alt: `Portrait of ${site.name}`,
    card: 'summary',
    type: 'image/webp',
  }
}
