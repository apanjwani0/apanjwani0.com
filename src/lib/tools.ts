/**
 * Tools that cannot run in the browser alone — each one needs this site's own
 * origin server. That is the quality bar AGENTS.md sets for a new tool ("a tool
 * must do something a static HTML page cannot"), so it is also the one
 * distinction worth showing on the hub: without it, Chainsaw and a Base64
 * encoder carry identical visual weight in a grid of sixteen cards, and the
 * page intro's claim that "four need a real server" points at nothing.
 *
 * Lives in `src/lib/` and NOT in `src/config/tools.ts` on purpose: the /admin
 * Vite middleware regenerates that config file wholesale from `generateTools()`,
 * so an export added there is deleted on the next admin save. Same reason
 * `EMBED_TAGS` and `GAME_TAGS` live outside the config.
 *
 * It is also not an admin-editable field, because it is a fact about *code* —
 * does a route exist that this tool calls — rather than about content.
 * `security:smoke` asserts every slug here is a `live` tool and is backed by a
 * real route file, so a tool that loses its server cannot keep the badge.
 */
export const SERVER_TOOLS: ReadonlySet<string> = new Set([
  'webhook-inspector', // /api/hook/[bin]            — captures real inbound requests
  'link-peek',         // /api/tools/link-peek       — outbound fetch, SSRF-guarded
  'chainsaw',          // /api/tools/chainsaw        — raw TLS handshakes
  'dns-sightline',     // /api/tools/dns-sightline   — three resolvers, compared
])

/** True when this tool's slug needs the origin server to do its job. */
export function isServerTool(slug: string): boolean {
  return SERVER_TOOLS.has(slug)
}

/**
 * The /tools hub's sections, in display order. Like SERVER_TOOLS this is a fact
 * about the shelf, not admin-editable content, so it lives here and not in
 * src/config/tools.ts (the /admin save regenerates that file wholesale).
 *
 * Headings are plain words a searcher would use; the lede under each is one
 * full sentence that says what the group has in common (AGENTS.md: UI copy is
 * plain, explanatory sentences). `scripts/tools-hub-smoke.mjs` holds every live
 * tool to exactly one group. A tool missing from every group still renders, in
 * a closing "More tools" section, so a new tool can never vanish from the hub.
 */
export interface ToolGroup {
  id: string
  title: string
  lede: string
  slugs: readonly string[]
}

export const TOOL_GROUPS: readonly ToolGroup[] = [
  {
    id: 'live-diagnostics',
    title: 'Live diagnostics',
    lede: 'A web page is not allowed to catch a webhook, open a raw TLS connection, ask three DNS resolvers the same question or fetch a page the way a chat app\'s bot does, so these four do it from this site\'s server.',
    slugs: ['webhook-inspector', 'chainsaw', 'dns-sightline', 'link-peek'],
  },
  {
    id: 'verify-and-explain',
    title: 'Verify & explain',
    lede: 'These check the things that fail quietly and tell you why: a JWT signature that will not verify, a cron job that skips or repeats when the clocks change, a checksum that does not match.',
    slugs: ['token-bench', 'cron-whisperer', 'hash-smith'],
  },
  {
    id: 'create',
    title: 'Create',
    lede: 'Turn text into something you can see and share: a diagram from an outline, a Markdown document with a map of its own headings, or generative art you can export.',
    slugs: ['flowmap', 'draftboard', 'driftfield'],
  },
  {
    id: 'everyday-utilities',
    title: 'Everyday utilities',
    lede: 'Small converters and testers for the data you handle every day. They run entirely in your browser, so nothing you paste is sent anywhere.',
    slugs: ['json-tidy', 'regex-lab', 'list-forge', 'epoch-wizard', 'codec-forge', 'chroma-lab'],
  },
]

/** The heading for tools no group names (a new tool, a wip or external one). */
export const UNGROUPED_TITLE = 'More tools'
