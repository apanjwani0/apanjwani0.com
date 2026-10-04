# SEO backlog (from an outside review, 2026-10-04)

An outside SEO review (Gemini) of every tool and game, triaged against
AGENTS.md. This file keeps what still holds; pick items from here later.

## Already done or declined

- **Done:** keyword-first `seoTitle` on every tool and game, `WebApplication`
  JSON-LD, shareable results (Quintle, Hue Hunt), Deep Shore permalinks, and
  Cron Whisperer preset pages (`/tools/cron-whisperer/<slug>`, `src/lib/cron-presets.ts`).
- **Declined:**
  - Per-tool FAQ / how-to blocks: SEO support copy is off by design.
  - A site-wide "about apanjwani0" FAQ.
  - A live timestamp in Epoch Wizard's title: it breaks edge caching.
  - Translations with `hreflang`: too much work for a portfolio.

## Worth building (best first)

1. **Learnings articles that answer real error searches.** Each one mounts its
   tool as the figure and follows `docs/plans/learnings-voice.md`.
   - Chainsaw: "unable to get local issuer certificate" (a missing
     intermediate). This one first: the most urgent searches.
   - Token Bench: "JWT signature verification failed" (RS256 vs HS256
     confusion, a stale `kid`, clock skew).
   - Cron Whisperer: "does cron run twice when the clocks go back" (links the
     preset pages).
2. **Type Trial challenge links.** A permalink that dares a friend to race one
   passage. It deepens an existing game, per *The bar for a new tool or game*,
   and spreads person to person.
3. **Hue Hunt's share card shows its colour distance (ΔE)** for each guess,
   which makes it more worth posting.

## Cheap tweaks

4. **Token Bench `metaDescription`**: say that verification runs in the
   browser and the key never leaves it, to reassure security-minded searchers.
5. **Driftfield example gallery**: pre-rendered wallpapers with descriptive
   alt text, so it can be found through image search.

## Valid, but not now

6. **Embeddable widgets** (`/embed/<tool>` iframes) earn backlinks. Each needs
   its own route that relaxes the CSP's `frame-ancestors`, so it is a security
   change. Wait until a tool has an audience.
7. **More preset pages** (e.g. `/tools/json-tidy/json-to-yaml`). Only where
   the page's text can be derived from the engine, as with cron. A
   converter's page would be thin text around a mode switch.
8. **Flash Cricket, timed to the IPL or a World Cup**, once the game is
   playable.

## Owner actions, not code

9. **Community posts**: Show HN or r/devops (Webhook Inspector, Chainsaw),
   r/poker (Poker Trainer), r/wordle (Quintle, Hue Hunt). Backlinks are the
   real ceiling on reach.
10. **After each deploy**: purge the Cloudflare cache and run
    `npm run origin:check`. In Search Console, resubmit `/sitemap.xml` and
    watch Pages → "Crawled – currently not indexed".
11. **Automate the purge**: add a step to `.github/workflows/deploy.yml` that
    calls Cloudflare's `purge_cache` API. Use a GitHub Actions secret holding
    a token limited to Zone → Cache Purge, never the container's env.
