# Fresh-eyes architecture review

*2026-10-05. What a rebuild from scratch would change, and how much of that is reachable without one. A proposal, not a decision: nothing here is binding until the owner picks it up.*

## Verdict

Keep Astro. The problem is not the framework but **SSR everywhere**: every page sets `prerender = false`. The stated reasons are the KV/data overrides and the per-response CSP nonce, and neither holds up:

- **The override layer is vestigial.** `/admin` is dev-only and writes `src/config/*.ts` into git. Nothing in production writes `data/{key}.json`; `data/` holds only `visits.json` and `experience.yaml`. The whole site is SSR so `getConfig()` can read files that do not exist.
- **The nonce can become hashes.** Static pages can carry a hash-based CSP, either Astro's own CSP support or hashes computed at build time. Headers like `frame-ancestors` move to the edge.

What SSR costs: a 1 GB VM rendering HTML, a Cache Rule and Browser Cache TTL that live in a dashboard (hence `origin:check`), manual purges, an origin reachable around Cloudflare, and a large share of AGENTS.md and docs/security.md (reroute-nonce rules, the one-inline-script rule, the order of the cache branches). Going static removes most of that.

## Recommendations

1. **A CI gate. Shipped in part.** `.github/workflows/ci.yml` runs the gate on every PR and push to `develop`. Still open: make the `main` ruleset require it, purge the Cloudflare cache through the API after deploy, and run `origin:check` there.
2. **Prerender content, SSR only `/api/*`. Do step by step.** Astro static output with on-demand rendering only for endpoints, a hash-based CSP with headers at the edge, the override branch removed from `config.ts`, a static 404, and the visit counter in `src/middleware.ts` dropped (it counts cache misses, which Cloudflare's analytics show better). Value: HTML from the edge with no origin work, no dashboard Cache Rule, and much of the middleware and AGENTS.md deleted. Medium risk: the ClientRouter, the hashed inline script and the share-card pages need a browser pass, so build the Playwright harness (item 4) first.
3. **Hosting: split the workload, after item 2.** Static assets and most API routes on Cloudflare Workers; webhook bins and rate limiters on Durable Objects; daily boards and interest counts on D1. `tls-inspect.ts`, `link-peek-fetch.ts` (it pins a socket to the checked address) and `dns-lookup.ts` cannot run on Workers, so a tiny Node API for Chainsaw and Link Peek stays, reachable only through a **Cloudflare Tunnel**, which closes the origin for good. High cost; a tunnel on today's VM gets most of the security win by itself.
4. **Testing: split the smoke script by kind.** `scripts/security-smoke.mjs` is about 10k lines and 2,000 asserts, the first failure stops the run, and nothing runs in parallel. Move behaviour (claim modules, oracles, reference-vs-fast equality) to vitest, structural invariants (no static cytoscape import, listeners bound by a signal) to AST rules, and CLS budgets, frame-width sweeps, nonce parity and screenshots to Playwright in CI. Keep the philosophy: derived assertions, oracles, "break it and watch it fail".
5. **Content as schema-validated data.** Seven hand-written `generate*()` strings in `astro.config.mjs` each mirror a TypeScript interface (saves silently drop drifted fields), `config-schema.ts` is a second validator, and long Markdown lives as strings in `learnings.ts`. Target: content collections with zod schemas, learnings as `src/content/learnings/*.md`, and `/admin` writing data files. A new section becomes one schema and one form instead of a five-place checklist.
6. **Client component structure, when next touching a tool.** `JsonTidy.ts` is about 2,000 lines with about 40 element-ref fields, and escaping is enforced only by convention. Give each tool `claims.ts` (the house rule), `state.ts` (typed state and pure transitions), `view.ts` (rendering) and an element that holds only lifecycle, with lit-html (about 3 KB) or an in-house escaping `html` tag. Do not rewrite working tools all at once.
7. **Styling with cascade layers, after Playwright screenshots exist.** Declare `@layer oat, tokens, base, kit, tool, overrides;` once, make `controls.css` the only control styling and delete the lane floors and opt-out lists. One large CSS PR, which is why the screenshot baselines come first.
8. **Persistence.** Hand-rolled stores (`visits`, `analytics`, the leaderboards, `interest`) each carry their own flush, retention and prototype-pollution guards; webhook bins live only in memory. Target `node:sqlite` on the VM, or D1/Durable Objects on Workers.
9. **Smaller items.** Type `App.Locals` (`cspNonce`, the runtime env) and remove the `(locals as any)` casts (still present in `middleware.ts`, `config.ts`, `security.ts`); turn on `noUncheckedIndexedAccess`; deploy by starting the new container before swapping; keep AGENTS.md to rules and move its history into short ADRs.

## Alternatives considered

SvelteKit/Next/Nuxt add a framework runtime the site deliberately avoids. Hono or plain Vite on Workers rebuilds Astro's Markdown, SEO and static output for no gain. A monorepo of tool packages gives no more isolation than folders and lint rules. **Astro static + Workers API + a tiny tunnelled Node API is the recommended end state, reachable step by step.**

## Roadmap

1. **CI gate:** finish it (require on `main`, post-deploy purge and `origin:check`), and type `App.Locals`.
2. **Test harness:** vitest for claims and oracles, Playwright for CLS, frame width, nonce parity and screenshots, AST rules where cheap.
3. **Content collections:** zod schemas, JSON/MD files, `/admin` pointed at them, then delete the `generate*()` functions and the override branch.
4. **Go static:** prerender, hash-based CSP, edge headers, drop the Cache Rule and visit counter, put the VM behind a Cloudflare Tunnel.
5. **CSS layers and the kit:** one layering PR against the screenshot baselines, then each tool onto `controls.css` as it is touched.
6. **Optional:** the API on Durable Objects and D1; Chainsaw and Link Peek stay on the tunnelled Node service.

Steps 1-4 get most of the value and none needs a rewrite: an enforced gate, HTML from the edge, the origin closed, one schema for content, and a much shorter AGENTS.md.
