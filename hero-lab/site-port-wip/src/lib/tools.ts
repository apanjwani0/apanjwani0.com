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
