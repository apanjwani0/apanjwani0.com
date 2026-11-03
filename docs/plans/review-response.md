# Review response plan (2026-10)

Two outside reviews of the live site (2026-10-02), checked against the code.
This file keeps the findings still open, the owner's decisions and the PRs not
yet shipped. Delete each item as it ships, and the file with the last one.

## 2. Findings still open

1. **The Core Web Vitals beacon never fires on the pages it measures.** It
   records a view only on `astro:page-load`, which only `<ClientRouter />`
   dispatches, and tool and game pages render without it: the "real-user LCP,
   CLS and TTFB" in docs/operations.md has been dark since August 2026. It also
   sends at a fixed 1.5 s and sums CLS instead of taking the largest session
   window. PR-1.
3. **DNS Sightline decides "apex" by counting labels** (`atApex`), so
   `example.co.uk` is never an apex; an SOA test alone cannot fix it. PR-4b.
4. **A tool page's crawlable text and rendered text disagree**: each component
   replaces the server's h1 and `intro` with its own hard-coded h1. PR-5.
5. **"Read about it" links nothing.** `learningsAboutEmbed()` keys on an
   article's `embed`, and the only embeds are the two atlas figures. PR-6.

## 3. Decisions (owner, 2026-10-02)

All ten are settled. Nine took the recommendation; D9 did not.

**Product pages**
- **D1. The tool page h1:** keep the brand h1 and add an eyebrow line above it with the problem noun ("DNS checker" over "DNS Sightline"). The eyebrow is derived from the head of `seoTitle` (the text before " — "), so there is no new field.
- **D2. The long `intro`:** trim it to at most 150 plain words and render it under the tool as a visible "How it works" section, after the copy pass fixes its claims. `seoContent` folds into the same field, so there is one long-copy field rather than two.
- **D3. The `/tools` hub:** three or four h2 groups ("Debug a live system", "Everyday data", "Make something"), with flagships first in each.
- **D10. The home page:** unchanged. The hero rule stands, and strangers land on leaf pages, not on `/`.

**Copy and content**
- **D4. The copy pass:** correctness hedges, the rhetoric trim (Review A's "about 20%"), and a short "Tool copy" section in `learnings-voice.md` so it doesn't drift back.
- **D9. New articles:** Claude drafts and the owner rewrites. The guardrails come from `learnings-voice.md`:
  - every draft is built figure-first (rule 4: the figure list comes first, the lines between come after);
  - it stays inside the 350–550-word budget and the hard bans;
  - it is marked as a draft in its PR;
  - nothing merges until the owner has rewritten it. Rule 1, "read as if the owner handwrote it", is the owner's pass, not Claude's.

**SEO plumbing and links**
- **D5. Cross-links:** a derived topic graph. Each item stores one `topics` list from a fixed vocabulary in `src/lib/`, the relation is derived from it, and the two articles get prose links.
- **D7. Meta keywords:** drop `<meta name="keywords">` and the JSON-LD `keywords`. Keep the lists as search synonyms for the planned command palette (`site-index.ts` already builds `w` from them).

**Measurement and money**
- **D6. Analytics:** the full fix:
  - the `web-vitals` library, sent on page hide;
  - INP recorded;
  - fixed histogram buckets, so p75 can be computed;
  - a coarse viewport bucket (narrow ≤ 640 px / wide), which is not a user agent and is counts only.
- **D8. Ads:** deferred. Decide after four to six weeks of fixed beacon data and Search Console numbers. Nothing touches the CSP or adds a consent banner in the meantime. §6 says what each option would cost.

## 4. Work still to do

One PR each, feature to `develop`. For Opus items, post a short design note in
the PR and wait for the owner's go-ahead. **Shipped: PR-7**, the grouped
`/tools` hub (`TOOL_GROUPS`), under the owner's own group names (tools-week.md).
**Open, in this order:**

1. **PR-1. The beacon** (Opus; D6). Record each hard load once, independent of
   the router; send once on the first `visibilitychange` to hidden through
   `sendBeacon`; take LCP, CLS (session window), INP and TTFB from the
   `web-vitals` package, bundled (the CSP allows `'self'`, never a CDN); add
   `inpMs`; store fixed histogram buckets with Google's "good" threshold as an
   edge, so p75 is computable; add a `narrow` (up to 640 CSS px) or `wide`
   bucket from `innerWidth`, never the user agent. Ship to `main` soon after
   merging: the two weeks of data start at deploy.
2. **PR-2. The tool and game copy pass** (Sonnet, then `/code-review`; D4).
   Open: Token Bench "is a forgery", Epoch Wizard "detects", JSON Tidy
   "Repaired —", Chroma Lab's CMYK caveat, Hash Smith's SHA-1 label, Cron
   Whisperer and Link Peek stated as universal, Maze Weaver "exactly one
   corridor", Poker Trainer "Set any Hold'em spot", Hue Hunt "true perceptual
   closeness", and the rhetoric trim. Run `npm run og` for a changed
   `description`.
3. **PR-3. The article hedges** (Sonnet; the owner reads it for voice). Open:
   "The server cuts it into small pieces", "usually" on the NAT captions, a line
   each on IPv6 and HTTP/3 over QUIC; in the diagram article, "Seven is a working
   set" and "The UML diagram most people picture first". Keep "drawn seven ways"
   and the `{{embed:view}}` markers, which `security:smoke` holds.
4. **PR-8. Head cleanup** (Sonnet; D7). Drop `<meta name="keywords">`, the
   JSON-LD `keywords` and their dead props; keep the config `keywords` field for
   palette synonyms and say so in AGENTS.md; add JSON-LD `alternateName` and
   `image`.
5. **PR-4b. DNS Sightline and Chainsaw correctness** (Opus). Apex by Public
   Suffix List (a server-only dependency such as `tldts`) or an SOA owned by the
   name; with neither decidable, emit no `cname-at-apex`. Also the DNS Sightline
   and Chainsaw loose ends in ideas.md, Chainsaw's Common Name message
   branching on whether the certificate lists DNS names (RFC 6125), and
   "the supported way" for ALIAS/ANAME softened. docs/security.md gains the
   apex rule.
6. **PR-5. One server-rendered header per tool page** (Opus recipe, Sonnet
   conversions; D1, D2; after PR-2). The route renders the eyebrow (the
   `seoTitle` head before " — "), the h1, the lede (`description`), the empty
   custom element and "How it works" (`intro`, at most 150 words). `seoContent`
   is deleted across the five *Admin Config Management* steps, AGENTS.md's
   "SEO support copy is off" bullet is rewritten and components stop writing an
   h1. PR-5b (optional) does the same for game pages.
7. **PR-6. A derived topic graph** (Opus design, Sonnet data; D5; after PR-5). A
   fixed `TOPICS` list in `src/lib/topics.ts` (not config, which `/admin`
   regenerates), a `topics` field through the five admin steps, and `relatedTo()`
   in `src/lib/related.ts` (indexable items sharing a topic, at most four). The
   two articles gain prose links to DNS Sightline, Chainsaw and Flowmap.

**Owner first:** close the origin lock before promoting anything, and verify the
domain in Search Console and Bing Webmaster Tools. **About two weeks after PR-1
deploys:** read p75 LCP, INP and CLS per page and viewport against 2.5 s, 200 ms
and 0.1, and fix the worst first (split `games-embed.css`, about 91 KB on every
game and article page; a long-TTL Cache Rule for `/oat.min.*`; a 1200x630 home
share card). **Then** one deeper flagship by the tool bar in AGENTS.md and one
article per flagship, drafted figure-first and rewritten by the owner (D9).

## 5. Not doing

A tool dashboard on `/` (breaks the hero rule), generated long-form pages per
tool, more inventory, "FREE TOOL" banners and enumerating search phrases.

## 6. Ads: what each option costs

Deferred (D8). AdSense needs Google's script and frame origins in a CSP that
today allows `'self'` plus a nonce, and a consent banner in the EEA, UK and
Switzerland; a single-network slot (EthicalAds, Carbon) needs one or two origins
and says it sets no tracking cookies (verify). Any slot needs a reserved size
and lazy loading, and stays off game pages.
