# PR #27 follow-ups

What the 2026-10-01 release reviews of PR #27 and the page audit left open
once their fixes landed (PRs #28 and #29). Delete each item as it ships, and this file with the
last one. Line numbers are as of `9433d9a`.

## After #27 merges

1. Purge the Cloudflare cache right after the deploy: cached HTML points at
   asset hashes the new image doesn't have.
2. Run `npm run origin:check`.
3. Open the home page on a phone, in portrait and landscape. It is the first
   real run of the `/cdn-cgi/trace` path, so expect your city, and "Cloudflare
   had a copy" on a repeat visit.
4. Still open: the origin lock (see AGENTS.md *Origin exposure*).

## The owner's calls

- **The deployment view's database arrow reads "sql"**, the review's
  suggestion, where it read "5432" (Postgres's port on a generic "database").
  To put it back, change `de3`'s text in `diagram-atlas/atlas.ts`.
- **The paused foundation:** keep it, or park it on `wip/ui-refresh-notes`.
  - The code: `fuzzy.ts`, `kit.ts`, four empty stubs, the unused theme
    functions, `Base`'s `canonicalPath`, and 34 unused tokens (about 1.3 KB of
    CSS on every page).
  - `ROOT_BOOT_JS` survives in the client chunk as a dead statement; move it
    to a server-only module.

- **Copy the audit flagged** (left unchanged):
  - Nine meta descriptions run over 160 characters, so results truncate them:
    Token Bench (216), Cron Whisperer (207) and DNS Sightline (195) longest.
  - Both learnings article titles run over 65 characters, and the hub's title
    is a bare `learnings · Aman Panjwani`.
- **The home share image is a WebP portrait**, which some apps (LinkedIn)
  handle poorly. A 1200×630 PNG card would fix it.
- **Oat's files revalidate on every page view** (`/oat.min.*` is not hashed).
  A Cloudflare Cache Rule giving them a long edge and browser TTL fixes it;
  serving them through Vite does not (see AGENTS.md *Stack*).
- **Self-hosting the Google Fonts** removes one render-blocking request.
- **Game and article pages load every game's CSS** (about 91 KB), because
  `games-embed.css` is the one list of component stylesheets. Splitting it
  means changing that rule.

## Deferred: separate PRs

- **The SPF walk collects terms without a bound** (`analyze.ts:602-636`). A
  crafted zone costs about 110 MB of heap and a 74 MB response per request (a
  stub run), against a 768 MB container. Stop collecting once `lookups`
  passes the overshoot limit. Do this soon: it breaks the "bounded in every
  dimension" rule.
- **Loop detection matches the substring "loop"** in problem text
  (`analyze.ts:772`, `:818`), so an unanswered `include:_spf.loopia.se` reads
  as a loop error. Keep loops in their own field.
- **CAA in RFC 3597 `\#` hex form reads as no CAA** (`analyze.ts:1074-1079`).
- **The Records table says "No records of any queried type"** when lookups got
  no answer (`panels.ts:151`).
- **Chainsaw's `aia-available` quotes the raw URL** (`chainsaw/analyze.ts:518`).
  Name it only when `csLinkableUrl` accepts it.
- **Dead code:**
  - `SG_TYPES.includes(t)` is always true (`inspect.ts:166`).
  - The branch at `analyze.ts:275` is unreachable, and its export is unused.
  - `sgIsDangling` and `sgCnameTargetUnchecked` can be one function.
- **Hidden sections are listed in two places:** `GATED_SECTIONS`
  (`config.ts:138`) and `SECTIONS[].gated` (`site-index.ts:84`). Merge them
  into one `isSectionPublic(site, path)`.
