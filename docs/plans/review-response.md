# Review response plan (2026-10)

On 2026-10-02 two outside reviews read the live site (`origin/main` at
`72c9015`, the PR #27 deploy, which is identical to `develop` at `ae86364`).
The first, "Review A", is a long page-by-page review. The second, "Review B",
is a short architecture and monetization note. Every concrete claim was checked
against the code, and checking turned up more than either review found. This
file is the plan that came out of that. Delete each item as it ships, and the
file with the last one. Line numbers are as of `ae86364`.

## 1. How the reviews hold up

**Review A is mostly right.** All 14 of its correctness complaints hold, six
fully and eight in part. Its strategy fits the rules this repo already keeps:
problem-first leaf pages, cross-links, depth over inventory, and Core Web
Vitals measured on mobile. Where it overreaches, it is in emphasis, not fact.
The keyword lists are noise as a meta tag, but they also feed the planned
on-site search. Poker Trainer's "every runout is counted", which it asked to be
true, is true.

**Review B is half right, and less reliable.**
- It assumes a stack the site does not have: "deferred ad execution until
  after your core WebAssembly hydrates". There is no WebAssembly anywhere in
  the repo, and the HTML is SSR cached at the edge, not "static, edge-routed".
- Two of its three recommendations break standing rules:
  - A tool dashboard on `/` breaks the hero rule ("No tools or games in the
    hero"), and Review A argues the opposite.
  - "Long-form landing pages for every tool" is the `seoContent` filler the
    owner turned off as boring, and the slop `learnings-voice.md` was written
    to stop.
- Its third point, that ad scripts will wreck Core Web Vitals and need a
  loading strategy, is correct. It is also generic.

**Both agree on one thing, and it is the plan's spine.** The tool and game
pages are the product. A stranger landing on one should see the thing they
searched for, stated plainly, and be able to trust every sentence on it.

### Claim-by-claim

| Claim | Verdict | Evidence |
| --- | --- | --- |
| Chainsaw: "nobody reads the CN" is too categorical | Confirmed | `tools.ts:57`, `chainsaw/analyze.ts:384,448`, `Chainsaw.ts:143,533` |
| Token Bench: alg mismatch read as forgery | Partly | `tools.ts:77` "is a forgery"; the structural finding says "treat the token as hostile" (`diagnose.ts:443-453`). The proved case is fair. |
| JSON Tidy: Repair framed as certainty | Partly | The banner reads "Repaired —" and NaN/undefined silently become `null` under "normalised literals" (`JsonTidy.ts:370,1538`). It does show fix categories and needs an explicit Apply. |
| Epoch Wizard: digit count treated as fact | Partly | The override exists, but the copy says "detects" and the row says "Detected unit". The copy says 10/13/16/19 digits while the code splits at ≥12/15/18 (`EpochWizard.ts:64-70`). |
| Chroma Lab: CMYK without a profile caveat | Confirmed | Naive `k = 1 − max` (`ChromaLab.ts:118-125`). The copy also says "edit any field", but CMYK is output-only. |
| Hash Smith: SHA-1 not marked legacy | Partly | The only caveat is inside a collapsed `<details>` (`HashSmith.ts:303`). |
| Cron Whisperer: one cron's rules sold as all cron | Confirmed | User copy says "cron" throughout. "Vixie" and "cronie" appear only in comments. systemd, Kubernetes and GitHub Actions are never mentioned. |
| Link Peek: platform behaviour stated as permanent | Partly | "exactly the way each platform reads them", "true precedence rules" (`tools.ts:37`). The mockups are labelled "not screenshots". |
| DNS Sightline: absolute apex language | Partly | ALIAS/ANAME is called "the supported way" (`analyze.ts:1478`). The split-horizon sentence is accurate; leave it. |
| Maze Weaver: wrong "perfect maze" definition | Confirmed | `games.ts:61` "exactly one corridor". The component's own copy is right ("exactly one path"). |
| Poker Trainer: loose "outs", "every runout" | Partly | Enumeration is true. "Set any Hold'em spot" is false, because oversized spots are refused (`PokerTrainer.ts:743,810`). The out definition (`:443`) is loose. |
| Hue Hunt: "true perceptual closeness" | Confirmed | `games.ts:81`. The metric is redmean, a weighted RGB distance (`hue-hunt-daily.ts:99`). |
| Internet article: too categorical | Partly | Packetization ("The server cuts it") is unhedged. The NAT prose is hedged, but its step captions (`atlas.ts:267-270`) are not. QUIC/UDP are never named. |
| Diagram article: taxonomy not flagged as simplified | Confirmed | Only HLD/LLD is hedged. "Class diagram. The one people mean when they say UML." |
| Meta keywords are noise | Confirmed | `<meta name="keywords">` renders on every page (`Head.astro:74`), plus JSON-LD `keywords`. Lists run to 42 terms (Cron Whisperer). |
| H1 is the brand, not the problem | Confirmed | Every `seoTitle` is problem-first, but every visible h1 is the brand, and the h1 disagrees with `<title>`. |
| Internal linking is thin | Confirmed, and worse | See §2. Cross-kind links are effectively zero. |
| `/tools` gives every card equal weight | Confirmed | Order is config order. No featured concept; the only differentiator is the `server` badge. |
| "LLM copywriting rhythm" | Confirmed | "actually" appears 7× in `tools.ts` copy. Also "every other JWT tool", "every other cron explainer", "almost nobody knows", "the things people get wrong", "Not by guessing". |
| JSON-LD | Fine | `WebApplication`, `applicationCategory`, `operatingSystem` and `offers` are all emitted. Only `image` and `alternateName` could be added. |
| WebAssembly hydration (Review B) | Wrong | No WebAssembly in the repo. |

## 2. What the reviews missed

Found while verifying. Ordered by how much each one matters.

1. **The Core Web Vitals beacon never fires on the pages it measures.**
   - What happens:
     - `initAnalytics()` records a view only on `astro:page-load` (`analytics-client.ts:141`).
     - Only `<ClientRouter />` dispatches that event, and tool and game pages render without it (`ToolBase.astro:54`, `games/[slug].astro:112`).
     - The beacon's target filter (`parseToolGamePath`) accepts only tool and game detail pages, and on those pages the handler never runs.
   - `9f5cfd8` added the beacon at 01:56 on 2026-08-11. `9e16e2d` took the router off both page kinds 54 minutes later. So the "real-user LCP, CLS and TTFB" in AGENTS.md has been dark since its first night.
   - Two more defects:
     - It sends at a fixed 1.5 s after load (`:95`), before late LCP, most layout shift and any interaction.
     - Its CLS is a running sum of every shift (`:124-131`). That is the pre-2021 definition; current CLS is the largest session window.
   - Review A's "actual UX performance: unknown" is literally true.
2. **The SPF walk is still unbounded** (`release-followups.md`, "Do this soon").
   - A crafted zone costs about 110 MB of heap per request against a 768 MB container.
   - It breaks *Public endpoints must be bounded in every dimension*.
   - Neither review could see it. It goes first, because promotion brings attention.
3. **DNS Sightline decides "apex" by counting labels.**
   - The test is `atApex: name.split('.').length === 2` (`dns-sightline/inspect.ts:212`).
   - `example.co.uk` and `example.com.au` are never treated as apexes, so CNAME-at-apex is never flagged there.
   - The zone apex is where the SOA lives, and SOA is already one of the eight questions asked.
4. **A tool page's crawlable text and its rendered text disagree.**
   - The server renders `<h1>{title}</h1><p>{intro}</p>`. `intro` runs up to 3,994 characters (Cron Whisperer); DNS Sightline's is 2,556.
   - Each component's `connectedCallback` then replaces it with its own hard-coded h1 and tagline.
   - So the long `intro` exists only for crawlers that don't run JS (most AI search crawlers). Google indexes the rendered page and sees a different, shorter header.
   - The swap also moves layout at mount, and the brand is typed in 16 component templates.
   - Game pages do the same. Thirteen game and Driftfield components write their own `<h1>`.
5. **"Read about it" links nothing.**
   - `learningsAboutEmbed()` keys on an article's `embed`. The only embeds are the two atlas figures, which are neither tool nor game slugs.
   - So no tool or game page links to an article, and neither article links to a tool.
   - The one real cross-link, DNS Sightline ↔ Chainsaw, sits in result panels written by JS after a run, so crawlers never see it.
6. **The `/tools` "More tools" list is every other live tool (15 links) in config order**, with no relevance and no descriptions. That is the "isolated tools" Review A describes.

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

## 4. The work

Phases run in order. PRs inside a phase are independent unless marked, and
each one goes feature → `develop` behind the full gate. "Model" follows the
owner's split: Opus for design, security and review; Sonnet for the
mechanical and copy work, given an exact brief and reviewed by Opus.

### Phase 0: housekeeping (owner, about 15 minutes)

- Confirm the `release-followups.md` "After #27 merges" steps ran: the cache
  purge, `npm run origin:check`, and the phone check.
- **Close the origin lock before promoting anything.** Distribution (Show HN,
  Reddit) brings scanners as well as readers, and port 80 still answers around
  Cloudflare.
- Verify the domain in Google Search Console and Bing Webmaster Tools and
  submit `/sitemap.xml`, if that isn't done. Without them, Phase 3 has no
  search data to read.
- Update AGENTS.md *Current state*: #27 merged on 2026-10-01, so `develop` and
  `main` are level. This rides the first PR below.

### Phase 1: trust (correctness and measurement)

**PR-1. The beacon fires, and measures what Google measures.** (Opus, medium. Decision D6.)
- Record the initial page view on every page, independent of the router. Use `astro:page-load` only for later client navigations, with a per-document guard against counting twice.
- Send on the first `visibilitychange → hidden` (or `pagehide`) through `sendBeacon`, not after a fixed 1.5 s.
- Take LCP, CLS (session window) and INP from `web-vitals` (about 2 KB compressed). Add `inpMs` to `analyticsMetricKeys` and to the server's bounds.
- Store fixed buckets per metric so p75 is computable. Bound the bucket count; keep 90-day retention.
- Optional: extend the beacon to `/learnings/<slug>` (a third `AnalyticsKind`).
- Assertions in `analytics:smoke` and `security:smoke`, each with its mutation:
  - A router-less page records a view (remove the fallback).
  - `inpMs` is accepted and out-of-range values are refused (widen the bound).
  - The bucket count is fixed (add one per request).
  - No user-agent or IP field appears in the stored shape (add `ua`).
- AGENTS.md: update *Analytics* (the metrics, p75, the viewport bucket and why it is not identity).

**PR-2. The tool and game copy pass.** (Sonnet with the table below; Opus reviews. Decision D4.)
- Owns: `src/config/tools.ts` and `src/config/games.ts` copy, plus user-facing strings in every tool and game component **except** DNS Sightline and Chainsaw, whose copy rides PR-4 so the two PRs don't collide.

| Where | Change |
| --- | --- |
| Token Bench `tools.ts:77` | "is a forgery anyone who can read your JWKS could have written" → "is forgeable by anyone who can read your JWKS" |
| Token Bench `diagnose.ts:443-453` (structural) | "Nothing legitimate signs this way, so treat the token as hostile" → "This is the shape of an algorithm-confusion attack. It also happens when the key belongs to a different issuer. Treat the token as untrusted until you know which." Keep the `proof: 'structural'` label. |
| JSON Tidy banner, fix labels | "Repaired —" → "Best-effort repair:", ending "Check it before you apply it." Name the lossy fix: "replaced NaN, Infinity and undefined with null". `tools.ts:87` loses "actually". |
| Epoch Wizard | "detects" → "guesses"; the row becomes "Unit: milliseconds (guessed from 13 digits)"; add "Pick a unit if the guess is wrong." Make the copy's digit counts agree with `EpochWizard.ts:64-70`. |
| Chroma Lab | A note beside the CMYK row: "A simple conversion with no colour profile. Print will differ." Change "edit any field" to name the editable fields. |
| Hash Smith | The SHA-1 row is labelled "SHA-1 (legacy)", and the intro says it is fine for checksums and not for security. Drop the "md5 alternative" keyword: MD5 isn't offered. |
| Cron Whisperer | The first mention names "Vixie cron and the crons built on it (cronie, Debian's cron)". Add one line: "systemd timers, Kubernetes CronJobs, GitHub Actions and cloud schedulers have their own rules, and many run on UTC only." Cut "the one almost nobody knows" and "every other cron explainer". |
| Link Peek | "exactly the way each platform reads them" / "true precedence rules" → "the precedence rules each platform follows today. They change without notice, and the platform's own debugger has the final word." "X renders no card at all" → "X usually shows a bare link". |
| Maze Weaver `games.ts:61` | "exactly one corridor" → "exactly one path" (and the comment at `MazeWeaver.ts:5`). |
| Poker Trainer | `games.ts:30` "Set any Hold'em spot" → "Set a Hold'em spot", and say that oversized spots are refused rather than sampled. `PokerTrainer.ts:443`: an out is "a card that puts you ahead on the next card; they can still outdraw you after it". `:444`: "systematically too optimistic" → "usually optimistic, most of all with many outs". |
| Hue Hunt `games.ts:81` | "true perceptual closeness" → "how close your colour is to the answer". Name redmean in the in-game explainer. |
| Rhetoric | Remove user-facing "actually", "every other … tool", "almost nobody knows", "the things people get wrong", "worth asking", "Not by guessing". Code comments are out of scope. |
| Meta descriptions | Bring the nine over 160 characters under it (Token Bench 216, Cron Whisperer 207 and DNS Sightline 195 are the longest). This one is from `release-followups.md`; delete it there. |

- Guardrails:
  - `security:smoke` checks some copy, for example the number word in the `/tools` intro and the pot-odds labels in `PokerTrainer.ts`.
  - Run the whole gate after every file.
  - Never change a claim a module proves without changing the module.
- AGENTS.md: none. `learnings-voice.md` gets a short "Tool copy" section listing the banned phrases and the rule "say what it does, then where it stops" (D4).

**PR-3. The article hedges.** (Sonnet; you read it for voice before merge.)
- Internet article:
  - md line 11: "The server cuts it into small pieces" → "The page travels as small pieces called packets."
  - `atlas.ts:252` gets the same change and keeps "about 1,500 bytes".
  - `atlas.ts:267` and `:270` gain "usually".
  - One new line: "With IPv6, a device can have a public address of its own."
  - md line 59 adds: "HTTP/3 runs on QUIC, over UDP instead of TCP."
  - `atlas.ts:365`: "TCP numbers every packet" → "TCP, or QUIC under HTTP/3, numbers every packet".
- Diagram article:
  - After md line 9: "Seven is a working set. BPMN, data-flow and C4 diagrams give the arrow other meanings."
  - md line 45: "The one people mean when they say UML" → "The UML diagram most people picture first. Sequence, activity, state and deployment diagrams are UML too."
- Constraints `security:smoke` holds:
  - "drawn seven ways" stays in `content`, `summary` and `metaDescription`.
  - Every `{{embed:view}}` marker stays.
  - The seven `arrow` strings stay distinct.
  - Every `blind` and `breaks` string stays over 40 characters.
  - No host or runtime names anywhere.
  - The voice file's bans apply, so no "not X, it is Y".
- Optional, your call from `release-followups.md`: shorten both titles under 65 characters and give the hub a real title.

**PR-4. DNS Sightline and Chainsaw: bounds, then correctness.** (Opus. Security first.)
- In order:
  1. **Bound the SPF walk** (`analyze.ts:602-636`): stop collecting terms once `lookups` passes the overshoot limit. Add a fixture with a crafted wide zone that asserts both heap-bounded output size and the existing verdict; the mutation removes the bound.
  2. **Apex from SOA.** A name is an apex when the SOA answer is owned by that name. Keep the label count only as the fallback when SOA went unanswered, and then follow *A failed lookup is not an absent record*: no confident `cname-at-apex` from the heuristic beyond two labels.
     - Fixtures: `example.co.uk` with an apex CNAME is flagged; `www.example.com` is not; SOA unanswered behaves as above.
  3. The remaining deferred items in `release-followups.md` (delete each there as it lands):
     - The loop flag moves to its own field instead of matching the substring "loop".
     - CAA in RFC 3597 `\#` form.
     - The Records-table message when lookups got no answer.
     - Chainsaw's raw AIA URL goes through `csLinkableUrl`.
     - The dead code.
  4. The copy in these two tools:
     - The Chainsaw CN message branches. When the certificate has SANs: "Clients that follow RFC 6125 ignore the Common Name when SANs are present, so this certificate does not cover this host." When it has none: "Browsers stopped reading the Common Name in 2017; only legacy clients still fall back to it."
     - `tools.ts:57` loses "no client has read since 2017".
     - DNS Sightline: "the supported way" → "Many DNS providers offer ALIAS, ANAME or CNAME flattening for this; check whether yours does." Trim "correct about the things people get wrong" (`tools.ts:47`, `DnsSightline.ts:60`).
- AGENTS.md: *A failed lookup is not an absent record* gains the apex rule.

### Phase 2: findability (structure)

**PR-5. One server-rendered header per tool page.** (Opus designs the recipe and converts two tools; Sonnet converts the other 14; Opus reviews. Decisions D1 and D2. After PR-2.)
- The route renders `div[data-type="tool-page"]`:
  - the eyebrow (D1), the h1 and the lede from config;
  - an empty workbench host the component renders into;
  - the "How it works" block (D2) after it.
- Components stop writing a header or an h1.
- Header extras that live in templates today (Token Bench's "decode and verify" badge, Flowmap's "a canvas for thinking on", Driftfield's "image + GIF studio") are inventoried, and each either becomes lede copy or is dropped.
- This removes four problems at once:
  - the h1 typed in 16 places;
  - the gap between raw and rendered text;
  - the layout jump at mount;
  - the `MutationObserver` the paused UI item E planned for placing the actions dock.
- The convention "every tool renders `div[data-type="tool-page"]`" moves from the component to the route, so update its assertion and AGENTS.md *Key Conventions*.
- Assertions:
  - No file under `src/components/tools/` writes `<h1` (add one back).
  - Each tool page has exactly one h1, and its text comes from config (hard-code one).
  - The eyebrow equals the `seoTitle` head (edit one by hand).
- Run `/browser-debug` on every tool, clicking in through the hub.
- **PR-5b (later, optional): the same for game pages.** Game components double as learnings embeds, whose chrome `mountEmbed` strips with a `MutationObserver`. Once components stop writing chrome, that observer and `EMBED_NO_CHROME` can go. It is a separate PR because it rewrites asserted embed machinery.

**PR-6. A derived topic graph for cross-links.** (Opus designs; Sonnet does the data entry. Decision D5. After PR-5, because both touch `tools/[slug].astro`.)
- `TOPICS` is a fixed vocabulary in `src/lib/topics.ts`, for example `dns`, `tls`, `http`, `auth`, `webhooks`, `time`, `data`, `text`, `colour`, `diagrams`, `algorithms`, `generative`, `probability`. It lives in `src/lib/`, not config, because `/admin` regenerates config wholesale.
- A `topics` field goes on tools, games and learnings: all five steps of *Admin Config Management*, including the `astro.config.mjs` generators that must mirror the interface.
- `relatedTo(item)` in `src/lib/related.ts`:
  - only items that pass their kind's indexing predicate;
  - at least one shared topic;
  - ordered by overlap, at most four, across kinds.
- `RelatedLinks` shows a title and a one-line description for each (descriptive anchors), server-rendered. "More tools" becomes those four plus a link to the hub.
- Prose links in the two articles: the DNS stop → DNS Sightline, the TLS stop → Chainsaw, and the diagram article's flowchart section → Flowmap ("edit a Mermaid flowchart visually"). `markdown.ts` already accepts internal URLs.
- Assertions:
  - Every related target is indexable (give a `wip` tool a topic).
  - Every topic is in `TOPICS` (misspell one).
  - Every live tool and playable game has at least one related item (empty one's topics).
  - The relation is symmetric when overlap is equal.
- AGENTS.md *Indexing*: "Cross-links come from `relatedTo()`". The admin checklist gains `topics`.

**PR-7. The `/tools` hub has a shape.** (Sonnet. Decision D3.)
- If grouped: a slug→group map in `src/lib/tools.ts`, beside `SERVER_TOOLS` and for the same reason. One h2 per group, flagships first.
- The JSON-LD `ItemList` follows the rendered order.
- Assertions:
  - Every live tool is in exactly one group (drop one).
  - The intro's number word still matches `SERVER_TOOLS`.

**PR-8. Head cleanup.** (Sonnet. Decision D7.)
- Drop `<meta name="keywords">` (`Head.astro:74`) and the JSON-LD `keywords` (`jsonld.ts:66,199`). Keep the config field as palette synonyms and say so in AGENTS.md.
- Add JSON-LD `alternateName` (the `seoTitle` head) and `image` (the card from `og.ts`) to tool and game entries.
- Assertion: the head renders no `name="keywords"` (re-add it).

### Phase 3: measure, then optimise (about two weeks after PR-1 deploys)

- Read the beacon: p75 LCP, INP and CLS per page and per viewport bucket, against 2.5 s, 200 ms and 0.1.
- A lab baseline: Lighthouse with the mobile preset, using the pre-installed Chromium, on the flagship URLs. Record it in this file.
- Then fix the worst first, from the candidates already in `release-followups.md`:
  - split `games-embed.css` (about 91 KB on every game and article page; this needs a rule change);
  - the long-TTL Cache Rule for `/oat.min.*` (dashboard);
  - self-hosted fonts;
  - the 1200×630 home share card.
- Search Console: which queries already land, and on which pages. That decides Phase 4's order.

### Phase 4: depth and distribution (one at a time, your pick)

- **One deeper flagship, judged by the tool bar in AGENTS.md** (state that outlives the tab, a URL other software talks to). Candidates:
  - A DNS Sightline or Chainsaw report permalink. Needs design: a crawler or link-preview bot following one must not spend the inspection budget (*Validate before you spend the token*).
  - Webhook Inspector presets for provider signature schemes (Stripe, GitHub, Slack, Standard Webhooks). First check what `signature.ts` covers.
- **One article per flagship**, each with its own figure (D9: Claude drafts each one figure-first, and the owner rewrites it before merge):
  - "Why SPF stops at ten lookups" (DNS Sightline);
  - "What a server sends in a TLS handshake" (Chainsaw);
  - "Why a JWT fails to verify" (Token Bench);
  - "What cron does when the clocks change" (Cron Whisperer).
- **Distribution, outside the repo:** Show HN or r/sysadmin for Chainsaw and DNS Sightline, after Phase 1 and the origin lock.

### Phase 5: the ads gate (a decision, not code)

Only with Phase 3's numbers. See §6.

## 5. Not doing

- **A tool dashboard on `/`.** It breaks the hero rule, Review A argues against it, and strangers land on leaf pages.
- **Generated long-form pages per tool.** `seoContent` stays off. D2's "How it works" is at most 150 plain words of the existing copy, corrected, not new filler.
- **More inventory, AI features, "FREE TOOL" banners, or an SEO-ified Driftfield.** Both reviews agree.
- **Enumerating search phrases.** After PR-8 the keyword lists feed only the on-site search.

## 6. Ads: what each option costs

- **The CSP.**
  - Today: `script-src 'self' 'nonce-…'` and one inline script, and AGENTS.md refuses to weaken the CSP even for Cloudflare's own beacon.
  - AdSense needs Google's script and frame origins, and its auction scripts inject more scripts.
  - A single-network slot (EthicalAds, Carbon) needs one or two origins.
- **Consent.**
  - Today the analytics need no banner, by design.
  - AdSense serving in the EEA, the UK and Switzerland requires a Google-certified consent platform, which means a banner.
  - EthicalAds says it sets no tracking cookies; verify that before relying on it.
- **Core Web Vitals.** Third-party ad script is main-thread work, which INP will show once PR-1 measures it. Any slot needs a reserved, fixed size (CLS 0), lazy loading after idle, and to stay off game pages and away from controls. Google's own placement policy says the same.
- **Revenue.** Developer-tool display RPM is typically low single-digit dollars per thousand views. Until the beacon and Search Console show the traffic, the expected revenue is unknown and probably small.
- **Decided (D8): defer.** If the numbers justify it, start with one fixed slot from a privacy-first developer network below the workbench on the "everyday data" tools only (JSON Tidy, List Forge, Epoch, Codec, Regex, Hash), with a smoke assertion that holds its placement.

## 7. Interaction with existing plans

- **`release-followups.md`.**
  - Its deferred DNS and Chainsaw items ride PR-4.
  - The meta description item rides PR-2; the article titles ride PR-3 (optional).
  - The performance items wait for Phase 3.
  - Delete each there as it ships.
- **The paused UI refresh (`origin/wip/ui-refresh-notes`).**
  - PR-5 replaces item E's "detail rhythm" mechanism. After it, the actions dock is a server-rendered slot, not a moved node, so update `ui-plan.md` §E before E resumes.
  - PR-6 rewrites `RelatedLinks.astro`, which E owns, so E rebases on PR-6.
  - Item C's palette gains the keyword synonyms PR-8 keeps.
  - Item F's site share card is the same as Phase 3's home card; build it once.

## 8. Summary

| PR | Phase | Size | Model | After |
| --- | --- | --- | --- | --- |
| PR-1 beacon | 1 | M | Opus | D6 |
| PR-2 tool and game copy | 1 | M | Sonnet, Opus review | D4 |
| PR-3 article hedges | 1 | S | Sonnet, owner voice read | — |
| PR-4 DNS and Chainsaw bounds and correctness | 1 | M | Opus | — |
| PR-5 server-rendered header | 2 | L | Opus recipe, Sonnet ×14 | PR-2, D1, D2 |
| PR-5b game headers | 2 | M | Opus | PR-5 |
| PR-6 topic graph | 2 | M | Opus design, Sonnet data | PR-5, D5 |
| PR-7 tools hub | 2 | S | Sonnet | D3 |
| PR-8 head cleanup | 2 | S | Sonnet | D7 |

PR-1 to PR-4 can run in parallel worktrees: they touch disjoint files, since
PR-2 leaves DNS Sightline and Chainsaw to PR-4. PR-7 and PR-8 can run beside
PR-5.
