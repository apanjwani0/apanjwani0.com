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
