# Fresh-eyes architecture review

*2026-10-05. What a rebuild from scratch would change, and how much of that is reachable without one. A proposal, not a decision: nothing here is binding until the owner picks it up.*

## Verdict

Keep Astro. The problem is not the framework but **SSR everywhere**: every page sets `prerender = false`. The stated reasons are the KV/data overrides and the per-response CSP nonce (docs/conventions.md, "SSR everywhere"), and neither holds up:

- **The override layer is vestigial.** `/admin` is dev-only and writes `src/config/*.ts` into git. Nothing in production writes `data/{key}.json`; `data/` holds only `visits.json` and `experience.yaml`. The whole site is SSR so `getConfig()` can read files that do not exist.
- **The nonce can become hashes.** Static pages can carry a hash-based CSP, either Astro's own CSP support or hashes computed at build time. Headers like `frame-ancestors` move to the edge.

What SSR costs: a 1 GB VM rendering HTML, a Cache Rule and Browser Cache TTL that live in a dashboard (hence `origin:check`), manual purges, an origin reachable around Cloudflare, and a large share of AGENTS.md and docs/security.md (reroute-nonce rules, the one-inline-script rule, the order of the cache branches). Going static removes most of that.

## Ranked recommendations

### 1. A CI gate (highest value, smallest cost). Do now
- **Now:** `.github/workflows/deploy.yml` runs only on a push to `main`, and only `build` and `boot-check` run (inside the Dockerfile). `check`, `security:smoke` and `poker:check` never run in CI, and nothing runs on a PR. "The gate before any commit" relies on everyone remembering it.
- **Target:** a `ci.yml` on every PR and push running `npm ci`, `check`, `build`, `security:smoke`, `poker:check` and `boot:check`. Make the `main` ruleset require it (direct pushes are allowed today). After deploy, purge the Cloudflare cache through the API and run `origin:check`.
- **Cost:** about an hour.

### 2. Prerender content, SSR only `/api/*`. Do now, step by step
- **Target:**
  - Astro static output, rendering on demand only for the endpoints.
  - A hash-based CSP, with headers set at the edge.
  - Remove the override branch from `config.ts`.
  - A static 404.
  - Drop the visit counter in `src/middleware.ts`: it counts cache misses, which Cloudflare's analytics already show better.
- **Value:** HTML served from the edge with no work at the origin, no dashboard Cache Rule, and much of the middleware and AGENTS.md deleted.
- **Cost/risk:** medium. The ClientRouter, the hashed inline script and the share-card pages need a browser pass, so do item 4 (Playwright) first.

### 3. Hosting: split the workload. Do after item 2
- **Target:** static assets and most API routes on Cloudflare Workers.
  - Webhook bins and rate limiters move to Durable Objects, which give live arrival over hibernating WebSockets.
  - The daily boards and interest counts move to D1.
  - `tls-inspect.ts`, `link-peek-fetch.ts` (it pins a socket to the checked address) and `dns-lookup.ts` cannot run on Workers. Keep a tiny Node API for Chainsaw and Link Peek, reachable only through a **Cloudflare Tunnel**, which closes the origin for good.
- **Cost:** high. A tunnel on today's VM gets most of the security win by itself.

### 4. Testing: split the smoke script by kind. Do now
- **Now:** `scripts/security-smoke.mjs` is about 10k lines, roughly 2,000 asserts and 160 reads of source text. The first failure stops the whole run, and nothing runs in parallel or in isolation.
- **Target:**
  - **vitest** for behaviour: the claim modules, oracles, mutation-checked fixtures and the reference-vs-fast equality checks.
  - **AST rules** (ast-grep or ESLint) for the structural invariants: no static cytoscape import, no per-tool sheet import, listeners bound by a signal.
  - **Playwright** in CI for CLS budgets, the frame-width sweep, nonce parity and screenshots of each tool.
- **Keep the philosophy:** derived assertions, oracles, and "break it and watch it fail".

### 5. Content as schema-validated data. Do now
- **Now:**
  - Seven hand-written `generate*()` template strings in `astro.config.mjs` each mirror a TypeScript interface, and saves silently drop any field that drifts out of step.
  - `config-schema.ts` is a second validator.
  - Long Markdown lives as strings inside `learnings.ts`.
- **Target:**
  - Astro content collections with zod schemas, with types inferred from the schemas.
  - JSON or YAML data, and learnings as `src/content/learnings/*.md` with frontmatter.
  - `/admin` writes data files instead of generating code.
- **Value:** a new section is one schema and one form instead of a five-place checklist, and an article's diff reads as prose.

### 6. Client component structure. Do when you next touch a tool
- **Now:** `JsonTidy.ts` is about 2,000 lines with about 40 element-ref fields. `CronWhisperer.ts` has about 20 `innerHTML =` template writes. Escaping is enforced only by convention.
- **Minimum structure:** each tool gets four parts.
  - `claims.ts`: already the house rule.
  - `state.ts`: typed state plus pure transitions, including persistence.
  - `view.ts`: rendering.
  - The element itself: lifecycle only.
- **Templates:** **lit-html** (about 3 KB), or a small in-house `html` tag that escapes by construction. Do not rewrite working tools all at once.

### 7. Styling with cascade layers. Do after Playwright screenshots exist
- Declare `@layer oat, tokens, base, kit, tool, overrides;` once. Oat stays vendored, inside its layer.
- `controls.css` becomes the only control styling, and the lane floors and opt-out lists get deleted.
- This ends the specificity workarounds (`[data-tool=…]` prefixes, hover rules restated at equal specificity). It is one large CSS PR, which is why the screenshot baselines must exist first.

### 8. Persistence
- **Now:** hand-rolled stores, each with its own debounced flush, retention and bounds: `visits`, `analytics`, the leaderboards and `interest`. Prototype-pollution guards exist because attacker-chosen keys land in plain objects, and `data/visits.json` does hold `__proto__` and `constructor` referrers. Webhook bins live only in memory.
- **Target:** `node:sqlite` (built in) on the VM, or D1/Durable Objects on Workers.

### 9. Smaller items. Do now
- Type `App.Locals` (`cspNonce`, the runtime env) and remove the `(locals as any)` casts.
- Turn on `noUncheckedIndexedAccess`.
- Deploy by starting the new container before swapping (no downtime).
- Move the history in AGENTS.md into short ADRs under `docs/adr/` and keep AGENTS.md to rules.

## Alternatives considered

| Option | Verdict |
|---|---|
| SvelteKit / Next / Nuxt | Not worth it: a framework runtime the site deliberately avoids, and content pages that are no longer zero-JS. |
| Hono on Workers/Bun with Vite pages | Fine for the API alone, but you would rebuild Astro's Markdown, SEO and static output yourself. |
| Plain Vite + Workers | The same cost with less included. |
| **Astro static + Workers API + a tiny tunnelled Node API** | **The recommended end state, reachable step by step.** |
| Monorepo (tools as packages) | Not worth it at this size: folder boundaries and lint rules give the same isolation. |

## Roadmap

1. **CI gate.** Add `ci.yml` for PRs and pushes and make `main` require it. Add the post-deploy purge and `origin:check`. Type `App.Locals`.
2. **Test harness.** Add vitest and move the claim and oracle regions over. Add Playwright for CLS, frame width, nonce parity and screenshots. Turn the source-text invariants into AST rules where that is cheap.
3. **Content collections.** Write the zod schemas and convert the content to JSON/MD files. Point `/admin` at the data files, then delete the `generate*()` functions and the override branch.
4. **Go static.** Prerender the pages, use a hash-based CSP and set headers at the edge. Drop the Cache Rule and the visit counter, then put the VM behind a Cloudflare Tunnel.
5. **CSS layers and the kit.** Do one layering PR against the screenshot baselines. Then move each tool onto `controls.css` as it is touched, splitting it into claims, state and view.
6. **Optional:** move the API to Durable Objects and D1. Chainsaw and Link Peek stay on the tunnelled Node service.

Steps 1–4 get most of the value, and none of them needs a rewrite: an enforced gate, HTML served from the edge, the origin closed, one schema for content, and a much shorter AGENTS.md.
