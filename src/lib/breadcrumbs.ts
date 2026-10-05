import { breadcrumbListJsonLd } from './jsonld'

/**
 * One trail, two renderings: the visible `<Breadcrumbs>` items and the matching
 * BreadcrumbList JSON-LD come from the same list, so the labels cannot drift
 * (search engines surface a breadcrumb path only when markup and data agree).
 */
export interface BreadcrumbItem {
  /** Visible text. Section crumbs are lowercase ("tools"); a title is shown as written. */
  label: string
  /** Site-relative path ("/tools/x"; "/" for home). The last item is the current page. */
  path: string
  /** JSON-LD name when it must differ from the rule in `structuredName`. */
  name?: string
}

export interface VisibleCrumb {
  label: string
  /** Omitted on the current (last) crumb: you don't link to the page you're on. */
  href?: string
}

/**
 * The structured-data name: the visible label with its first letter capitalised
 * when the label is entirely lowercase ("tools" -> "Tools", the site's section
 * words), and unchanged otherwise (a title is already written as a name).
 */
function structuredName(label: string): string {
  return label === label.toLowerCase() ? label.charAt(0).toUpperCase() + label.slice(1) : label
}

export function buildBreadcrumbs(
  items: BreadcrumbItem[],
  siteUrl: string,
): { crumbs: VisibleCrumb[]; json: string } {
  const last = items.length - 1
  return {
    crumbs: items.map((it, i) => (i === last ? { label: it.label } : { label: it.label, href: it.path })),
    json: breadcrumbListJsonLd(
      items.map(it => ({
        name: it.name ?? structuredName(it.label),
        url: it.path === '/' ? siteUrl : `${siteUrl}${it.path}`,
      })),
    ),
  }
}
