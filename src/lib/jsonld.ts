/**
 * Helpers for generating JSON-LD structured data.
 * Used by pages to inject <script type="application/ld+json"> into <head>.
 */

export interface PersonSchema {
  name: string
  url: string
  jobTitle?: string
  description?: string
  sameAs?: string[]
  image?: string
}

export function personJsonLd(p: PersonSchema): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: p.name,
    url: p.url,
    ...(p.jobTitle && { jobTitle: p.jobTitle }),
    ...(p.description && { description: p.description }),
    ...(p.sameAs?.length && { sameAs: p.sameAs }),
    ...(p.image && { image: p.image }),
  })
}

export interface BlogPostingSchema {
  headline: string
  description: string
  url: string
  datePublished: string
  authorName: string
  authorUrl: string
  keywords?: string
}

export function blogPostingJsonLd(b: BlogPostingSchema): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: b.headline,
    description: b.description,
    url: b.url,
    datePublished: b.datePublished,
    author: {
      '@type': 'Person',
      name: b.authorName,
      url: b.authorUrl,
    },
    ...(b.keywords && { keywords: b.keywords }),
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
  return JSON.stringify({
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
  return JSON.stringify({
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
  authorUrl?: string
}

/**
 * WebSite structured data for the home page. Declares the site as a single named
 * entity so search engines connect every page under one site, and links it to
 * its author via `publisher` — complements the page-level Person schema.
 */
export function webSiteJsonLd(w: WebSiteSchema): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: w.name,
    url: w.url,
    ...(w.description && { description: w.description }),
    ...(w.authorName && {
      publisher: {
        '@type': 'Person',
        name: w.authorName,
        ...(w.authorUrl && { url: w.authorUrl }),
      },
    }),
  })
}

export interface WebApplicationSchema {
  name: string
  description: string
  url: string
  authorName: string
  authorUrl: string
  keywords?: string
  /** schema.org applicationCategory — e.g. 'Game' (default) or 'DeveloperApplication'. */
  applicationCategory?: string
}

export function webAppJsonLd(a: WebApplicationSchema): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: a.name,
    description: a.description,
    url: a.url,
    applicationCategory: a.applicationCategory ?? 'Game',
    operatingSystem: 'Any',
    // Free, browser-based — the price-0 offer is what marks it "free" for rich results.
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    author: {
      '@type': 'Person',
      name: a.authorName,
      url: a.authorUrl,
    },
    ...(a.keywords && { keywords: a.keywords }),
  })
}
