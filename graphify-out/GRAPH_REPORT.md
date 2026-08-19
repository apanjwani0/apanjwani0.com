# Graph Report - portfolio-apanjwani0  (2026-08-18)

## Corpus Check
- 135 files · ~193,551 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2121 nodes · 4423 edges · 87 communities (74 shown, 13 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8df74ca8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Content Types + AdminSavePlugin Dispatch|Content Types + AdminSavePlugin Dispatch]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Config KV-with-Fallback Chain|Config KV-with-Fallback Chain]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_MdEnhanced Tool (markdown render)|MdEnhanced Tool (markdown render)]]
- [[_COMMUNITY_MdEnhanced Export Pipeline (PDFImage)|MdEnhanced Export Pipeline (PDF/Image)]]
- [[_COMMUNITY_Admin API Route Handlers (loginlogoutsave)|Admin API Route Handlers (login/logout/save)]]
- [[_COMMUNITY_astro.config.mjs Plugin Generators|astro.config.mjs Plugin Generators]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_AudioTranscriber Custom Element + Web Speech|AudioTranscriber Custom Element + Web Speech]]
- [[_COMMUNITY_GitHub Project Stats Cache|GitHub Project Stats Cache]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_BlogPosting JSON-LD Schema|BlogPosting JSON-LD Schema]]
- [[_COMMUNITY_Person JSON-LD Schema|Person JSON-LD Schema]]
- [[_COMMUNITY_WebApplication JSON-LD Schema|WebApplication JSON-LD Schema]]
- [[_COMMUNITY_Session Token Generation|Session Token Generation]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 175|Community 175]]
- [[_COMMUNITY_Community 176|Community 176]]
- [[_COMMUNITY_Community 178|Community 178]]

## God Nodes (most connected - your core abstractions)
1. `JsonTidyTool` - 60 edges
2. `MazeWeaverGame` - 45 edges
3. `../../components/tools/json-tidy/JsonTidy.ts` - 44 edges
4. `Twenty48Game` - 41 edges
5. `SandLoomGame` - 38 edges
6. `QuintleGame` - 37 edges
7. `WallpaperForgeTool` - 34 edges
8. `../../components/tools/cron-whisperer/CronWhisperer.ts` - 33 edges
9. `LSystemGame` - 30 edges
10. `EpochWizardTool` - 30 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `ogCardFile()`  [EXTRACTED]
  scripts/generate-og.mjs → src/lib/og.ts
- `esc()` --calls--> `escapeHtml()`  [EXTRACTED]
  scripts/generate-og.mjs → src/lib/escape.ts
- `size()` --calls--> `parseRange()`  [EXTRACTED]
  scripts/poker-check.mjs → src/components/games/poker-trainer/engine/ranges.ts
- `size()` --calls--> `rangeCombos()`  [EXTRACTED]
  scripts/poker-check.mjs → src/components/games/poker-trainer/engine/ranges.ts
- `tools/index.astro tools listing` --references--> `../../layouts/Base.astro`  [EXTRACTED]
  src/pages/tools/index.astro → src/layouts/Base.astro

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Runtime config: KV/file/static fallback chain** — lib_config_get_config, lib_config_from_kv, lib_config_from_file [INFERRED 0.85]
- **Site layout shell (Head + Nav + Base/ToolBase)** — layouts_base_layout, layouts_toolbase_layout, components_head_component, components_nav_component [INFERRED 0.85]
- **MD Enhanced tool subsystem** — md_enhanced_mdenhancedtool, md_enhanced_helpsections, md_enhanced_toggleextension, md_enhanced_startertemplate [INFERRED 0.75]
- **Client-side interactive browser tools** — audio_transcriber_audiotranscribertool, md_enhanced_mdenhancedtool, layouts_toolbase_layout [INFERRED 0.75]
- **Admin content editor tabs save via /api/admin/save with allowed types** — pages_admin, pages_admin_tabs, pages_admin_save_handler, admin_save_route, admin_save_allowed_types [INFERRED 0.85]

## Communities (87 total, 13 thin omitted)

### Community 0 - "Content Types + AdminSavePlugin Dispatch"
Cohesion: 0.09
Nodes (29): Post, Post (interface), posts, Company, Company (interface), experience, Role, Role (interface) (+21 more)

### Community 1 - "Community 1"
Cohesion: 0.10
Nodes (21): accuracyPct(), buildOptions(), clampByte(), colorDistance(), DiffConfig, DiffId, DIFFS, farEnough() (+13 more)

### Community 2 - "Config KV-with-Fallback Chain"
Cohesion: 0.05
Nodes (39): 1. Authentication & Session Management, 2. Input Validation & Injection, 3. Infrastructure & Deployment, 4. Middleware, Config Access & Data Flow, 5. Dependencies & Supply Chain, Consolidated Remediation Roadmap, CRITICAL — C1.1: Timing Attack on Password Comparison, CRITICAL — C1.2: Auth Bypass if ADMIN_SECRET Is Unset in Production (+31 more)

### Community 3 - "Community 3"
Cohesion: 0.21
Nodes (5): parseColor(), RGB, Star, StarField, TrailPoint

### Community 4 - "Community 4"
Cohesion: 0.10
Nodes (12): FG_PALETTES, FG_PRESETS, fgClamp(), fgExpand(), fgHash(), fgMulberry32(), FgPalette, FgPreset (+4 more)

### Community 6 - "MdEnhanced Export Pipeline (PDF/Image)"
Cohesion: 0.14
Nodes (11): DOMPurify library, exportImage() (html2canvas), exportPdf(), handleExport(), HelpEntry interface, HelpSection interface, helpSections const, marked library (+3 more)

### Community 7 - "Admin API Route Handlers (login/logout/save)"
Cohesion: 0.08
Nodes (33): ../../../components/RelatedLinks.astro, breadcrumbLd, crumbs, ldJson, tool, breadcrumbLd, crumbs, EngineTag (+25 more)

### Community 8 - "astro.config.mjs Plugin Generators"
Cohesion: 0.04
Nodes (33): A verifier's algorithm must not come from the thing it is verifying, Admin Config Management, Analytics, `/antigravity <task>`, Before merging anything that touches a trust boundary, `/browser-debug [url] [what to check]`, Build / Test / Run, Caching & Performance (+25 more)

### Community 9 - "Community 9"
Cohesion: 0.08
Nodes (30): classCombos(), classOf(), expandToken(), NamedRange, ParsedRange, parseRange(), PRESET_RANGES, rangeCombos() (+22 more)

### Community 10 - "AudioTranscriber Custom Element + Web Speech"
Cohesion: 0.22
Nodes (5): AudioTranscriberTool (custom element), LANGUAGES const, MIC_SVG const, Web Speech API (SpeechRecognition), toggleRecording()

### Community 11 - "GitHub Project Stats Cache"
Cohesion: 0.38
Nodes (7): buildResult, fetchStats, getProjectStats, GitHubStats (interface), parseGithubUrl, readCache, writeCache

### Community 12 - "Community 12"
Cohesion: 0.17
Nodes (15): blogPostingJsonLd(), BlogPostingSchema, BreadcrumbEntry, breadcrumbListJsonLd(), ItemListEntry, itemListJsonLd(), personJsonLd(), PersonSchema (+7 more)

### Community 13 - "Community 13"
Cohesion: 0.16
Nodes (17): bump(), flushVisits(), looksAutomated(), mergeRow(), mergeStore(), pending, pruneVisits(), recordVisit() (+9 more)

### Community 18 - "Community 18"
Cohesion: 0.07
Nodes (24): Q_ANSWERS, q_bestState(), q_dailyAnswer(), q_dayNumber(), q_el(), Q_EPOCH_DAY, q_evaluate(), q_freshStats() (+16 more)

### Community 19 - "Community 19"
Cohesion: 0.10
Nodes (20): breadcrumbLd, crumbs, ldJson, relatedTools, string, tool, ../../components/tools/audio-transcriber/audio-transcriber.css, ../../components/tools/chroma-lab/chroma-lab.css (+12 more)

### Community 20 - "Community 20"
Cohesion: 0.09
Nodes (38): AnalyticsAggregate, AnalyticsEvent, analyticsKey(), AnalyticsKind, AnalyticsKV, AnalyticsMetricKey, analyticsMetricKeys, AnalyticsMetrics (+30 more)

### Community 21 - "Community 21"
Cohesion: 0.22
Nodes (7): Config Schema (conceptual), Data Flow, Directory Structure, Extensibility Points, Oat UI Integration, Philosophy, SSR & Adapter

### Community 22 - "Community 22"
Cohesion: 0.22
Nodes (8): Content, Deploy to Cloudflare Workers, Deploy to Raspberry Pi, Deploy to VPS / cloud registry, Docker, portfolio-apanjwani0, Run locally, Stack

### Community 23 - "Community 23"
Cohesion: 0.50
Nodes (3): Adding a new game (TypeScript / Canvas — the common path), Current games, Games

### Community 24 - "Community 24"
Cohesion: 0.50
Nodes (3): exclude, extends, include

### Community 25 - "Community 25"
Cohesion: 0.13
Nodes (10): clamp(), GameOfLifeGame, GLIDER, GOSPER_GUN, LWSS, PatternDef, patternHeight(), PATTERNS (+2 more)

### Community 28 - "Community 28"
Cohesion: 0.09
Nodes (21): ../../components/tools/hash-smith/HashSmith.ts, HashSmithTool, HS_ALGOS, HS_DEFAULTS, HsAlgo, hsBuildV4(), hsBuildV7(), hsBytesLabel() (+13 more)

### Community 29 - "Community 29"
Cohesion: 0.09
Nodes (26): ../../../components/tools/wallpaper-forge/WallpaperForge.ts, AspectId, clamp(), fade(), fbm(), hash2(), LEGACY_PALETTE, lerp() (+18 more)

### Community 30 - "Community 30"
Cohesion: 0.09
Nodes (27): POST /api/admin/login, POST /api/admin/logout, admin save allowed types whitelist, POST /api/admin/save, __admin_session HttpOnly cookie, Tool, Tool (interface), ToolStatus (type) (+19 more)

### Community 31 - "Community 31"
Cohesion: 0.20
Nodes (25): GET(), allowAttempt, POST(), POST(), POST(), summarizeAnalytics(), isConfigType(), ADMIN_LOGIN_LIMITS (+17 more)

### Community 32 - "Community 32"
Cohesion: 0.09
Nodes (9): clamp(), DIRS, GEN_NAMES, GenId, MazeWeaverGame, mulberry32(), Phase, SOLVE_NAMES (+1 more)

### Community 33 - "Community 33"
Cohesion: 0.33
Nodes (8): directEntryFor(), initAnalytics(), markSessionEntry(), observeInitialPageVitals(), parseToolGamePath(), recordPageView(), sessionGet(), sessionSet()

### Community 34 - "Community 34"
Cohesion: 0.09
Nodes (29): AVATAR_COLORS, avatarSvg(), BTN, ButtonKind, buttonSvg(), CHIP, CHIP_VALUES, chipLabel() (+21 more)

### Community 35 - "Community 35"
Cohesion: 0.12
Nodes (10): clamp(), fade(), FlowFieldGame, hash2(), lerp(), mulberry32(), Palette, PALETTES (+2 more)

### Community 36 - "Community 36"
Cohesion: 0.17
Nodes (21): CONFIG_TYPES, ConfigType, isRecord(), isString(), optionalSafeExternalUrl(), optionalString(), safeBlogHref(), TOOL_STATUSES (+13 more)

### Community 37 - "Community 37"
Cohesion: 0.11
Nodes (21): ../../components/tools/list-forge/ListForge.ts, applyTransforms(), buildList(), decodeEscapes(), DEFAULTS, DELIM_LABEL, delimiterFor(), DelimKey (+13 more)

### Community 38 - "Community 38"
Cohesion: 0.12
Nodes (21): ../../components/tools/chroma-lab/ChromaLab.ts, ChromaLabTool, clClamp(), clContrast(), clEsc(), clFmt(), clHex2(), ClHSL (+13 more)

### Community 39 - "Community 39"
Cohesion: 0.09
Nodes (27): ../../components/tools/json-tidy/JsonTidy.ts, analyze(), childPath(), cleanMessage(), ErrorLoc, Indent, isPrimitive(), jtDeepEqual() (+19 more)

### Community 40 - "Community 40"
Cohesion: 0.27
Nodes (3): ../../components/tools/audio-transcriber/AudioTranscriber.ts, AudioTranscriberTool, LANGUAGES

### Community 41 - "Community 41"
Cohesion: 0.50
Nodes (3): Design Thinking, Frontend Aesthetics Guidelines, Portfolio Override (apanjwani0)

### Community 42 - "Community 42"
Cohesion: 0.18
Nodes (21): allowEvent, POST(), allowRead, allowVote, comingSoonSlug(), GET(), json(), NO_STORE (+13 more)

### Community 43 - "Community 43"
Cohesion: 0.12
Nodes (18): ../../components/tools/epoch-wizard/EpochWizard.ts, EF_DEFAULTS, EF_UNIT_LABEL, EfBreakdown, efDetectUnit(), efDigits(), efEsc(), efFormatDate() (+10 more)

### Community 44 - "Community 44"
Cohesion: 0.35
Nodes (10): cardKey(), combinations(), countRunouts(), EquityResult, equityVsRange(), exactEquity(), FULL_DECK, holeCount() (+2 more)

### Community 45 - "Community 45"
Cohesion: 0.09
Nodes (14): TW_SIZES, TW_VECTORS, twBestKey(), twClamp(), TwDir, twEaseOutCubic(), Twenty48Game, twLuminance() (+6 more)

### Community 46 - "Community 46"
Cohesion: 0.16
Nodes (12): ../components/Avatar.astro, ClientRouter (view transitions), Head Props (SEO meta), Base.astro (default layout), ToolBase.astro (tools layout), getSite(), githubUrl, ldJson (+4 more)

### Community 47 - "Community 47"
Cohesion: 0.08
Nodes (15): SandLoomGame, SL_BASE, SL_DENSITY, SL_LR, SL_MATERIALS, SL_RL, SL_TEX, SL_TYPE (+7 more)

### Community 48 - "Community 48"
Cohesion: 0.05
Nodes (39): dependencies, astro, @astrojs/node, cytoscape, dompurify, gifenc, html2canvas, marked (+31 more)

### Community 49 - "Community 49"
Cohesion: 0.11
Nodes (18): Architecture: the lazy embed, Cache, Decisions locked, Deferred: ads, Keyword reality check (2026-08-18), Learnings section + content/tool restructure, Naming: Driftfield, One predicate, as AGENTS.md requires (+10 more)

### Community 50 - "Community 50"
Cohesion: 0.06
Nodes (29): ../../components/tools/cron-whisperer/CronWhisperer.ts, CronWhispererTool, CW_DEFAULTS, CW_DOW_MAP, CW_DOW_NAMES, CW_EXAMPLES, CW_FIELD_LABEL, CW_FIELD_RANGE (+21 more)

### Community 51 - "Community 51"
Cohesion: 0.40
Nodes (4): bytes, frames, gif, header

### Community 52 - "Community 52"
Cohesion: 0.50
Nodes (3): Encoder, FrameOptions, Palette

### Community 54 - "Community 54"
Cohesion: 0.19
Nodes (16): $(), activeIndex(), b(), cleanup(), connectedCallback(), disconnectedCallback(), #e(), emit() (+8 more)

### Community 55 - "Community 55"
Cohesion: 0.21
Nodes (10): attachCanvasExport(), TB_PALETTES, TB_PRESETS, tbClamp(), tbMulberry32(), TbPalette, TbPreset, tbReadExact() (+2 more)

### Community 57 - "Community 57"
Cohesion: 0.08
Nodes (27): ../../components/tools/codec-forge/CodecForge.ts, CF_DEFAULTS, CF_REV, CF_TABS, CfB64Source, cfB64Status(), cfB64ToText(), CfB64Variant (+19 more)

### Community 58 - "Community 58"
Cohesion: 0.16
Nodes (7): ../../components/tools/webhook-inspector/WebhookInspector.ts, WebhookInspectorTool, wiFmtSize(), WiHeader, wiNewBinId(), wiRelTime(), WiRequest

### Community 59 - "Community 59"
Cohesion: 0.30
Nodes (11): outsAgainst(), rankHand(), combinations(), compareRank(), evaluate5(), evaluateBest(), evaluateOmaha(), RANK_PLURAL (+3 more)

### Community 60 - "Community 60"
Cohesion: 0.17
Nodes (11): adminSavePlugin, site, generateBlogs, generateExperience, generateGames, generateProjects, generateSite, cards (+3 more)

### Community 61 - "Community 61"
Cohesion: 0.33
Nodes (5): Client wiring (not yet — comes with the rooms slice), Layout, Online-play collections (the sequencer), PocketBase — local backend (dev only, for now), Run

### Community 62 - "Community 62"
Cohesion: 0.07
Nodes (36): breadcrumbLd, crumbs, ldJson, post, ../../../components/Breadcrumbs.astro, ExperienceItem Props, { before, after }, beforeHtml (+28 more)

### Community 66 - "Community 66"
Cohesion: 0.06
Nodes (29): blankFencedCode(), decodeGraph(), detectDialect(), encodeGraph(), Graph, GraphDialect, GraphEdge, GraphNode (+21 more)

### Community 67 - "Community 67"
Cohesion: 0.17
Nodes (6): EXPORT_SIZES, ExportSize, GifOptions, LiveExportOptions, SizeError, SizeResult

### Community 68 - "Community 68"
Cohesion: 0.12
Nodes (14): ../../components/tools/regex-lab/RegexLab.ts, RegexLabTool, RL_EXAMPLES, RL_FLAG_SET, RL_FLAGS, RL_REFERENCE, rlAdvanceStringIndex(), rlBuildHighlight() (+6 more)

### Community 69 - "Community 69"
Cohesion: 0.11
Nodes (20): cryptoInt(), shuffle(), handClass(), RangeEquityResult, Card, HandRank, Rank, RANK_LABEL (+12 more)

### Community 70 - "Community 70"
Cohesion: 0.19
Nodes (8): callEv(), requiredEquity(), Variant, pct(), pct2(), PokerTrainerGame, ptShuffledDeck(), ptTerm()

### Community 71 - "Community 71"
Cohesion: 0.20
Nodes (13): Game (interface), games, getGames, escapeHtml(), toolHasOgCard(), cardHtml(), esc(), main() (+5 more)

### Community 73 - "Community 73"
Cohesion: 0.06
Nodes (45): Game, Learning, learnings, EMBED_TAGS, embedTag(), GAME_SLUGS, GAME_TAGS, GameFlags (+37 more)

### Community 74 - "Community 74"
Cohesion: 0.18
Nodes (20): DELETE(), GET(), NO_STORE, ALL(), allowCapture, baseHeaders(), clampInt(), CORS_HEADERS (+12 more)

### Community 76 - "Community 76"
Cohesion: 0.06
Nodes (39): DAILY_TEXTS, dailyPassage(), fnv1a(), msUntilUtcMidnight(), todayUtcDay(), boardPath(), BoardStore, compareEntries() (+31 more)

### Community 77 - "Community 77"
Cohesion: 0.16
Nodes (18): algParams(), base64UrlToBytes(), base64UrlToText(), checkTimeClaims(), CURVES, HASHES, importVerificationKey(), isJwtAlg() (+10 more)

### Community 78 - "Community 78"
Cohesion: 0.60
Nodes (5): bad(), note(), ok(), warn(), origin-check.sh script

### Community 80 - "Community 80"
Cohesion: 0.12
Nodes (20): ../components/ProjectCard.astro, forksUrl, projectUrl, ProjectCard Props, stargazersUrl, buildResult(), CACHE_PATH, getProjectStats() (+12 more)

### Community 81 - "Community 81"
Cohesion: 0.11
Nodes (23): ../components/Footer.astro, links, social, year, ../components/Head.astro, ../components/Nav.astro, links, ../../layouts/Base.astro (+15 more)

### Community 82 - "Community 82"
Cohesion: 0.20
Nodes (8): mountEmbed(), mountGame(), stripEmbedChrome(), v(), SF_PALETTES, SfPalette, SfStar, sfToRGB()

### Community 83 - "Community 83"
Cohesion: 0.29
Nodes (6): Hard bans, Learnings — house voice, Requirements, The four failures, named, The marks available, What good looks like

### Community 175 - "Community 175"
Cohesion: 0.11
Nodes (7): BO_PALETTES, BoBoid, boClamp(), BoPalette, BoPointerMode, boToRGB(), MurmurationGame

### Community 176 - "Community 176"
Cohesion: 0.27
Nodes (4): byteLength(), escapeHtml(), formatBytes(), toCsv()

### Community 178 - "Community 178"
Cohesion: 0.27
Nodes (3): indentString(), repairJson(), sortDeep()

## Knowledge Gaps
- **569 isolated node(s):** `name`, `type`, `version`, `node`, `dev` (+564 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `mountGame()` connect `Community 82` to `Community 32`, `Community 1`, `Community 35`, `Community 4`, `Community 69`, `Community 76`, `Community 45`, `Community 175`, `Community 47`, `Community 18`, `Community 55`, `Community 25`?**
  _High betweenness centrality (0.138) - this node is a cross-community bridge._
- **Why does `../../components/tools/json-tidy/JsonTidy.ts` connect `Community 39` to `MdEnhanced Tool (markdown render)`, `Community 75`, `Community 176`, `Community 178`, `Community 19`, `Community 53`, `Community 27`?**
  _High betweenness centrality (0.100) - this node is a cross-community bridge._
- **Why does `../../components/tools/codec-forge/CodecForge.ts` connect `Community 57` to `Community 19`?**
  _High betweenness centrality (0.084) - this node is a cross-community bridge._
- **What connects `name`, `type`, `version` to the rest of the system?**
  _569 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Content Types + AdminSavePlugin Dispatch` be split into smaller, more focused modules?**
  _Cohesion score 0.08912655971479501 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.09745293466223699 - nodes in this community are weakly interconnected._
- **Should `Config KV-with-Fallback Chain` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._