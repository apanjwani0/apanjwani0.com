/**
 * Helpers for generating JSON-LD structured data.
 * Used by pages to inject <script type="application/ld+json"> into <head>.
 */

import { loadOgCardNames, ogCardPathForPage } from './og'

// Read once at module load so webAppJsonLd can stay synchronous: the pages call
// it without awaiting. Null when the runtime cannot list the cards.
const ogCardNames = await loadOgCardNames()

/**
 * JSON.stringify for a `set:html` <script> body.
 *
 * Every helper here is injected raw into `<script type="application/ld+json">`,
 * and JSON.stringify does not escape `<`. A value containing `</script>` — a
 * blog headline, a person's name — therefore closed the tag and everything after
 * it became live markup. Escaping `<` keeps the JSON valid (< decodes back
 * to `<`) while making the sequence impossible to write.
 */
function serialize(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/**
 * One entity, everywhere. The Person and the WebSite are DEFINED once each (the
 * home page: a ProfilePage whose main entity is the Person, and the WebSite),
 * under the stable ids below. Every other page's `author` and `publisher` is a
 * reference to those ids and nothing more, so a crawler can merge the 48 pages'
 * authorship back into the one Person instead of reading 48 unrelated names.
 *
 * The id is the site origin plus a fragment, so it is derived from the site URL
 * the pages already pass as `authorUrl` and never typed twice.
 */
export function personId(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/#person`
}

export function webSiteId(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/#website`
}

/** A reference to the Person, by id. `name` rides along for readers that do not follow ids. */
function personRef(siteUrl: string, name: string) {
  return { '@id': personId(siteUrl), name }
}

/**
 * What the Person is known for, as a literal list on purpose: a fact about the
 * owner, not about any one page. It follows the owner's day job (payments) and
 * the subjects of the tools and articles the site ships (webhooks, TLS, DNS,
 * cron, poker). It is not derived from `tools.ts`: a tool added or retired must
 * not silently rewrite who the owner says they know.
 */
const KNOWS_ABOUT = ['payment systems', 'webhooks', 'TLS', 'DNS', 'cron scheduling', 'poker math']

export interface PersonSchema {
  name: string
  url: string
  /** The handle, as the Person's alternate name (what people type to find the site). */
  alternateName?: string
  jobTitle?: string
  description?: string
  sameAs?: string[]
  image?: string
}

function personNode(p: PersonSchema) {
  return {
    '@type': 'Person',
    '@id': personId(p.url),
    name: p.name,
    url: p.url,
    ...(p.alternateName && { alternateName: p.alternateName }),
    ...(p.jobTitle && { jobTitle: p.jobTitle }),
    ...(p.description && { description: p.description }),
    ...(p.sameAs?.length && { sameAs: p.sameAs }),
    ...(p.image && { image: p.image }),
    knowsAbout: KNOWS_ABOUT,
  }
}

/**
 * The home page's Person, wrapped in a ProfilePage (Google's markup for a page
 * whose subject is a person). The Person inside is the one definition of
 * `#person`.
 */
export function profilePageJsonLd(p: PersonSchema): string {
  return serialize({
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url: p.url,
    name: p.name,
    isPartOf: { '@id': webSiteId(p.url) },
    mainEntity: personNode(p),
  })
}

export interface BlogPostingSchema {
  headline: string
  description: string
  url: string
  datePublished: string
  /** Only when the article was really revised; omit rather than repeat `datePublished`. */
  dateModified?: string
  authorName: string
  /** The site origin: names the Person (`<origin>/#person`) the article is by. */
  authorUrl: string
  /** Absolute URL of the share card. Google wants an image for Article results. */
  image?: string
  /** Plain words in the body. */
  wordCount?: number
  /** Absolute URLs of the tools or games the article embeds, as WebApplications it is about. */
  aboutApps?: string[]
}

export function blogPostingJsonLd(b: BlogPostingSchema): string {
  return serialize({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: b.headline,
    description: b.description,
    url: b.url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': b.url },
    inLanguage: 'en',
    datePublished: b.datePublished,
    ...(b.dateModified && { dateModified: b.dateModified }),
    author: personRef(b.authorUrl, b.authorName),
    publisher: personRef(b.authorUrl, b.authorName),
    isPartOf: { '@id': webSiteId(b.authorUrl) },
    ...(b.wordCount && { wordCount: b.wordCount }),
    ...(b.aboutApps?.length && { about: b.aboutApps.map(url => ({ '@type': 'WebApplication', url })) }),
    ...(b.image && { image: b.image }),
  })
}

export interface ItemListEntry {
  name: string
  url: string
}

/**
 * ItemList structured data for a listing/index page (e.g. /games, /tools).
 * Gives search engines an explicit, ordered map of the items on the page —
 * the listing-page counterpart to the per-item WebApplication schema.
 */
export function itemListJsonLd(name: string, items: ItemListEntry[]): string {
  return serialize({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      url: it.url,
    })),
  })
}

export interface CollectionEntry extends ItemListEntry {
  /** One plain sentence about the item (schema.org Thing.description). */
  description?: string
}

/**
 * A hub page as a CollectionPage whose main entity is the ordered ItemList.
 * The list keeps Google's summary-page shape (each ListItem carries a URL to
 * its own page) and adds each item's one-line description, which answer
 * engines quote. Items are deliberately not typed WebApplication: Google then
 * validates them as software rich results and reports every missing rating.
 */
export function collectionPageJsonLd(opts: {
  name: string
  description: string
  url: string
  items: CollectionEntry[]
}): string {
  return serialize({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: opts.name,
    description: opts.description,
    url: opts.url,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: opts.items.length,
      itemListElement: opts.items.map((it, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: it.name,
        url: it.url,
        ...(it.description ? { description: it.description } : {}),
      })),
    },
  })
}

export interface BreadcrumbEntry {
  name: string
  /** Absolute URL. The final (current-page) crumb still carries its own URL. */
  url: string
}

/**
 * BreadcrumbList structured data for a detail page (/tools/x, /games/x, /blogs/x).
 * Must mirror the visible trail rendered by src/components/Breadcrumbs.astro —
 * search engines only surface a breadcrumb path when the markup and the data agree.
 */
export function breadcrumbListJsonLd(items: BreadcrumbEntry[]): string {
  return serialize({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  })
}

export interface WebSiteSchema {
  name: string
  url: string
  description?: string
  authorName?: string
}

/**
 * WebSite structured data for the home page: the one definition of `#website`.
 * Every other page points at it by id (`isPartOf`), and its `publisher` is the
 * Person by id.
 */
export function webSiteJsonLd(w: WebSiteSchema): string {
  return serialize({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': webSiteId(w.url),
    name: w.name,
    url: w.url,
    inLanguage: 'en',
    ...(w.description && { description: w.description }),
    ...(w.authorName && { publisher: personRef(w.url, w.authorName) }),
  })
}

export interface WebApplicationSchema {
  name: string
  description: string
  url: string
  authorName: string
  /** The site origin: names the Person (`<origin>/#person`) and the WebSite the tool belongs to. */
  authorUrl: string
  /**
   * Ignored. JSON-LD `keywords` is gone (decision D7); the field stays only so
   * the pages that still pass it type-check until they stop.
   */
  keywords?: string
  featureList?: string[]
  applicationSubCategory?: string
  /** schema.org applicationCategory — e.g. 'Game' (default) or 'DeveloperApplication'. */
  applicationCategory?: string
  /**
   * Extra schema.org type emitted alongside WebApplication.
   *
   * Games pass 'VideoGame': it is the type search engines actually treat as a
   * game, but it is not a supertype of WebApplication, so declaring both (which
   * schema.org allows via an @type array) keeps every field below valid while
   * making the page eligible for game-specific handling. Declaring VideoGame
   * alone would orphan browserRequirements and the free-to-play Offer.
   */
  alsoType?: string
}

export function webAppJsonLd(a: WebApplicationSchema): string {
  // The share card, found from the page's own URL so the tool and game pages
  // need no argument: present exactly when `npm run og` wrote one.
  const cardPath = ogCardPathForPage(a.url, ogCardNames)
  return serialize({
    '@context': 'https://schema.org',
    '@type': a.alsoType ? [a.alsoType, 'WebApplication'] : 'WebApplication',
    name: a.name,
    description: a.description,
    url: a.url,
    mainEntityOfPage: a.url,
    applicationCategory: a.applicationCategory ?? 'Game',
    operatingSystem: 'Any',
    inLanguage: 'en',
    isAccessibleForFree: true,
    browserRequirements: 'Requires JavaScript. Runs in a modern browser.',
    // Free, browser-based — the price-0 offer is what marks it "free" for rich results.
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    author: personRef(a.authorUrl, a.authorName),
    isPartOf: { '@id': webSiteId(a.authorUrl) },
    ...(cardPath && { image: new URL(cardPath, a.url).href }),
    ...(a.alsoType === 'VideoGame' && {
      gamePlatform: 'Web browser',
      playMode: 'SinglePlayer',
    }),
    ...(a.featureList?.length && { featureList: a.featureList }),
    ...(a.applicationSubCategory && { applicationSubCategory: a.applicationSubCategory }),
  })
}

export interface FaqEntry {
  question: string
  answer: string
}

/**
 * FAQPage structured data. Emitted when a page has an FAQ section so search
 * engines and AI agents can digest explicit question-answer pairs for rich snippets.
 */
export function faqPageJsonLd(faqs: FaqEntry[]): string {
  return serialize({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: f.answer,
      },
    })),
  })
}

/**
 * Extracts Q&A pairs from markdown text with '### Question?' followed by an answer paragraph.
 */
export function extractFaqs(markdown: string): FaqEntry[] {
  const faqs: FaqEntry[] = []
  const regex = /###\s+([^\n\r]+?\?)\s*\n+([\s\S]+?)(?=\n+###|\n+##|$)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(markdown)) !== null) {
    const question = match[1].trim()
    const answer = match[2]
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`#>~]|==/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (question && answer) {
      faqs.push({ question, answer })
    }
  }
  return faqs
}

