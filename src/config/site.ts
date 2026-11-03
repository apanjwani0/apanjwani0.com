import data from './site.json'

/** One nav entry. `children` renders as a dropdown and is flattened by navLinks(). */
export interface NavItem {
  label: string
  href: string
  children?: NavItem[]
}

/**
 * The site's personal data, as callers receive it. The values live in
 * `site.json` (reviewable on its own, written by /admin); this file owns the
 * types, which are declared rather than inferred from the JSON so nothing is a
 * literal: at runtime KV or data/site.json may carry any valid nav (with
 * `children`), either theme, and either state of any section flag.
 */
export interface Site {
  url: string
  name: string
  handle: string
  theme: 'light' | 'dark'
  tagline: string
  bio: string
  /** The short blurb in the footer's "About the developer" column. */
  footerBio: string
  avatar: string
  nav: NavItem[]
  /**
   * Identity and contact links. `email` is an address, not a URL: pages render
   * it as a `mailto:` link only after `safeEmailAddress()` accepts it.
   */
  social: { github: string; linkedin: string; email?: string }
  /** A résumé or CV: an https URL or a path on this site. Unset hides the link. */
  resumeUrl?: string
  sections: Record<string, boolean>
}

export const site: Site = data as Site
