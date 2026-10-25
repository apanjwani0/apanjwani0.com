/**
 * Which pages render through ToolBase, the shell that ships no ClientRouter.
 *
 * Base pages (the hubs, games, home) run Astro's ClientRouter. When one of
 * them links to a ToolBase page, the router fetches the page, finds no router
 * in it and then loads it again as a normal navigation: two requests for one
 * click, the second only after the first has finished. `data-astro-reload` on
 * the link tells the router to skip its fetch and navigate straight away.
 *
 * Every ToolBase route lives under /tools/<x>: the tools, Driftfield and its
 * modes, and the cron presets. The /tools hub itself is a Base page, and so
 * are the learnings articles and the games, whose links need nothing.
 * `scripts/tools-hub-smoke.mjs` derives the shell of every page file and holds
 * this predicate to it, so a new ToolBase route outside /tools/ fails the gate
 * instead of double-loading.
 */
const TOOLBASE_PATH = /^\/tools\/[^/?#]/

/** True when `href` is a same-site path rendered by ToolBase. */
export function crossesShell(href: string | null | undefined): boolean {
  return typeof href === 'string' && TOOLBASE_PATH.test(href)
}

/** Spread onto an `<a>`: the reload attribute when the link leaves the router. */
export function shellLinkAttrs(href: string | null | undefined): Record<string, string> {
  return crossesShell(href) ? { 'data-astro-reload': '' } : {}
}
