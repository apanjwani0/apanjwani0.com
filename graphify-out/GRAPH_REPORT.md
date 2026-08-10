# Graph Report - portfolio-apanjwani0  (2026-08-11)

## Corpus Check
- 104 files · ~141,648 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1774 nodes · 3693 edges · 78 communities (68 shown, 10 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 33 edges (avg confidence: 0.81)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `acde9a4d`
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
- [[_COMMUNITY_AudioTranscriber Tool Logic|AudioTranscriber Tool Logic]]
- [[_COMMUNITY_AudioTranscriber Custom Element + Web Speech|AudioTranscriber Custom Element + Web Speech]]
- [[_COMMUNITY_GitHub Project Stats Cache|GitHub Project Stats Cache]]
- [[_COMMUNITY_Layout Shell (Base + ToolBase + Head + Nav)|Layout Shell (Base + ToolBase + Head + Nav)]]
- [[_COMMUNITY_Request Middleware (CSP + Admin No-Index Gate)|Request Middleware (CSP + Admin No-Index Gate)]]
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
- [[_COMMUNITY_Community 173|Community 173]]
- [[_COMMUNITY_Community 175|Community 175]]
- [[_COMMUNITY_Community 176|Community 176]]
- [[_COMMUNITY_Community 178|Community 178]]

## God Nodes (most connected - your core abstractions)
1. `PokerGame` - 64 edges
2. `JsonTidyTool` - 60 edges
3. `MazeWeaverGame` - 45 edges
4. `../../components/tools/json-tidy/JsonTidy.ts` - 44 edges
5. `Twenty48Game` - 41 edges
6. `QuintleGame` - 37 edges
7. `WallpaperForgeTool` - 34 edges
8. `../../components/tools/cron-whisperer/CronWhisperer.ts` - 33 edges
9. `LSystemGame` - 30 edges
10. `EpochWizardTool` - 30 edges

## Surprising Connections (you probably didn't know these)
- `readTheme()` --calls--> `v()`  [INFERRED]
  src/components/games/poker/ui/renderer.ts → public/oat.min.js
- `chooseAction()` --calls--> `decide()`  [EXTRACTED]
  scripts/poker-golden/generate.ts → src/components/games/poker/engine/bots.ts
- `chooseAction()` --calls--> `botInputFor()`  [EXTRACTED]
  scripts/poker-golden/generate.ts → src/components/games/poker/engine/engine.ts
- `shuffle()` --calls--> `Rng`  [INFERRED]
  src/components/games/poker/engine/cards.ts → src/components/games/poker/engine/bots.ts
- `randInt()` --calls--> `Rng`  [INFERRED]
  src/components/games/poker/engine/engine.selfcheck.ts → src/components/games/poker/engine/bots.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Runtime config: KV/file/static fallback chain** — lib_config_get_config, lib_config_from_kv, lib_config_from_file [INFERRED 0.85]
- **Site layout shell (Head + Nav + Base/ToolBase)** — layouts_base_layout, layouts_toolbase_layout, components_head_component, components_nav_component [INFERRED 0.85]
- **MD Enhanced tool subsystem** — md_enhanced_mdenhancedtool, md_enhanced_helpsections, md_enhanced_toggleextension, md_enhanced_startertemplate [INFERRED 0.75]
- **Client-side interactive browser tools** — audio_transcriber_audiotranscribertool, md_enhanced_mdenhancedtool, layouts_toolbase_layout [INFERRED 0.75]
- **Admin content editor tabs save via /api/admin/save with allowed types** — pages_admin, pages_admin_tabs, pages_admin_save_handler, admin_save_route, admin_save_allowed_types [INFERRED 0.85]

## Communities (78 total, 10 thin omitted)

### Community 0 - "Content Types + AdminSavePlugin Dispatch"
Cohesion: 0.05
Nodes (52): adminSavePlugin, Post, Post (interface), posts, Company, Company (interface), experience, Role (+44 more)

### Community 1 - "Community 1"
Cohesion: 0.10
Nodes (22): ../../components/games/hue-hunt/HueHunt.ts, accuracyPct(), buildOptions(), clampByte(), colorDistance(), DiffConfig, DiffId, DIFFS (+14 more)

### Community 2 - "Config KV-with-Fallback Chain"
Cohesion: 0.05
Nodes (39): 1. Authentication & Session Management, 2. Input Validation & Injection, 3. Infrastructure & Deployment, 4. Middleware, Config Access & Data Flow, 5. Dependencies & Supply Chain, Consolidated Remediation Roadmap, CRITICAL — C1.1: Timing Attack on Password Comparison, CRITICAL — C1.2: Auth Bypass if ADMIN_SECRET Is Unset in Production (+31 more)

### Community 4 - "Community 4"
Cohesion: 0.10
Nodes (13): ../../components/games/lsystem/LSystem.ts, FG_PALETTES, FG_PRESETS, fgClamp(), fgExpand(), fgHash(), fgMulberry32(), FgPalette (+5 more)

### Community 6 - "MdEnhanced Export Pipeline (PDF/Image)"
Cohesion: 0.14
Nodes (11): DOMPurify library, exportImage() (html2canvas), exportPdf(), handleExport(), HelpEntry interface, HelpSection interface, helpSections const, marked library (+3 more)

### Community 7 - "Admin API Route Handlers (login/logout/save)"
Cohesion: 0.19
Nodes (5): HelpEntry, HelpSection, helpSections, ../../components/tools/md-enhanced/MdEnhanced.ts, MdEnhancedTool

### Community 8 - "astro.config.mjs Plugin Generators"
Cohesion: 0.07
Nodes (16): Admin Config Management, `/antigravity <task>`, `/browser-debug [url] [what to check]`, Build / Test / Run, Caching & Performance, Code graph (graphify), Configuration, Design System (+8 more)

### Community 9 - "AudioTranscriber Tool Logic"
Cohesion: 0.27
Nodes (3): ../../components/tools/audio-transcriber/AudioTranscriber.ts, AudioTranscriberTool, LANGUAGES

### Community 10 - "AudioTranscriber Custom Element + Web Speech"
Cohesion: 0.22
Nodes (5): AudioTranscriberTool (custom element), LANGUAGES const, MIC_SVG const, Web Speech API (SpeechRecognition), toggleRecording()

### Community 11 - "GitHub Project Stats Cache"
Cohesion: 0.38
Nodes (7): buildResult, fetchStats, getProjectStats, GitHubStats (interface), parseGithubUrl, readCache, writeCache

### Community 12 - "Layout Shell (Base + ToolBase + Head + Nav)"
Cohesion: 0.19
Nodes (16): $(), activeIndex(), b(), cleanup(), connectedCallback(), disconnectedCallback(), #e(), emit() (+8 more)

### Community 13 - "Request Middleware (CSP + Admin No-Index Gate)"
Cohesion: 0.67
Nodes (3): Admin path no-store/noindex gate, CSP, onRequest

### Community 18 - "Community 18"
Cohesion: 0.07
Nodes (25): ../../components/games/quintle/Quintle.ts, Q_ANSWERS, q_bestState(), q_dailyAnswer(), q_dayNumber(), q_el(), Q_EPOCH_DAY, q_evaluate() (+17 more)

### Community 19 - "Community 19"
Cohesion: 0.14
Nodes (14): ../../components/games/type-trial/TypeTrial.ts, Best, Bests, CATEGORIES, Category, categoryName(), escapeHtml(), loadBests() (+6 more)

### Community 20 - "Community 20"
Cohesion: 0.29
Nodes (8): buildResult(), CACHE_PATH, getProjectStats(), memCache, parseGithubUrl(), readCache(), StatsCache, writeCache()

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
Nodes (11): ../../components/games/game-of-life/GameOfLife.ts, clamp(), GameOfLifeGame, GLIDER, GOSPER_GUN, LWSS, PatternDef, patternHeight() (+3 more)

### Community 28 - "Community 28"
Cohesion: 0.09
Nodes (21): ../../components/tools/hash-smith/HashSmith.ts, HashSmithTool, HS_ALGOS, HS_DEFAULTS, HsAlgo, hsBuildV4(), hsBuildV7(), hsBytesLabel() (+13 more)

### Community 29 - "Community 29"
Cohesion: 0.09
Nodes (26): ../../components/tools/wallpaper-forge/WallpaperForge.ts, AspectId, clamp(), fade(), fbm(), hash2(), LEGACY_PALETTE, lerp() (+18 more)

### Community 30 - "Community 30"
Cohesion: 0.15
Nodes (6): currentActorKind(), fmtChips(), clamp(), GameState, makeInviteCode(), PokerGame

### Community 31 - "Community 31"
Cohesion: 0.16
Nodes (29): attempts, clearRateLimit(), isRateLimited(), loginKey(), POST(), POST(), POST(), isConfigType() (+21 more)

### Community 32 - "Community 32"
Cohesion: 0.09
Nodes (10): ../../components/games/maze-weaver/MazeWeaver.ts, clamp(), DIRS, GEN_NAMES, GenId, MazeWeaverGame, mulberry32(), Phase (+2 more)

### Community 33 - "Community 33"
Cohesion: 0.18
Nodes (13): ClientRouter (view transitions), Head Props (SEO meta), Base.astro (default layout), ToolBase.astro (tools layout), getGames(), getPosts(), getSite(), blogs/[slug].astro post detail page (+5 more)

### Community 34 - "Community 34"
Cohesion: 0.09
Nodes (28): AVATAR_COLORS, avatarSvg(), BTN, ButtonKind, buttonSvg(), CHIP, CHIP_VALUES, chipLabel() (+20 more)

### Community 35 - "Community 35"
Cohesion: 0.12
Nodes (11): ../../components/games/flow-field/FlowField.ts, clamp(), fade(), FlowFieldGame, hash2(), lerp(), mulberry32(), Palette (+3 more)

### Community 36 - "Community 36"
Cohesion: 0.16
Nodes (21): CONFIG_TYPES, ConfigType, isRecord(), isString(), optionalSafeExternalUrl(), optionalString(), safeBlogHref(), TOOL_STATUSES (+13 more)

### Community 37 - "Community 37"
Cohesion: 0.11
Nodes (21): ../../components/tools/list-forge/ListForge.ts, applyTransforms(), buildList(), decodeEscapes(), DEFAULTS, DELIM_LABEL, delimiterFor(), DelimKey (+13 more)

### Community 38 - "Community 38"
Cohesion: 0.12
Nodes (21): ../../components/tools/chroma-lab/ChromaLab.ts, ChromaLabTool, clClamp(), clContrast(), clEsc(), clFmt(), clHex2(), ClHSL (+13 more)

### Community 39 - "Community 39"
Cohesion: 0.08
Nodes (28): ../../components/tools/json-tidy/JsonTidy.ts, analyze(), childPath(), cleanMessage(), countKeys(), ErrorLoc, Indent, isPrimitive() (+20 more)

### Community 40 - "Community 40"
Cohesion: 0.09
Nodes (26): ExperienceItem Props, ../components/ProjectCard.astro, forksUrl, projectUrl, ProjectCard Props, stargazersUrl, GitHubStats, markdown (+18 more)

### Community 41 - "Community 41"
Cohesion: 0.50
Nodes (3): Design Thinking, Frontend Aesthetics Guidelines, Portfolio Override (apanjwani0)

### Community 42 - "Community 42"
Cohesion: 0.09
Nodes (24): cardLabel(), cryptoInt(), hashSeed(), shuffle(), ActionType, BotsAPI, Card, EvaluatorAPI (+16 more)

### Community 43 - "Community 43"
Cohesion: 0.12
Nodes (18): ../../components/tools/epoch-wizard/EpochWizard.ts, EF_DEFAULTS, EF_UNIT_LABEL, EfBreakdown, efDetectUnit(), efDigits(), efEsc(), efFormatDate() (+10 more)

### Community 44 - "Community 44"
Cohesion: 0.13
Nodes (15): bankroll(), BOT_NAMES, botName(), hostName(), makeSeats(), oddsPet(), Prefs, randomPersonality() (+7 more)

### Community 45 - "Community 45"
Cohesion: 0.09
Nodes (15): ../../components/games/twenty48/Twenty48.ts, TW_SIZES, TW_VECTORS, twBestKey(), twClamp(), TwDir, twEaseOutCubic(), Twenty48Game (+7 more)

### Community 46 - "Community 46"
Cohesion: 0.14
Nodes (26): ALL_RANKS, buildRemainingDeck(), cardKey(), decide(), estimateEquity(), makeRng(), PersonalityProfile, PROFILES (+18 more)

### Community 47 - "Community 47"
Cohesion: 0.29
Nodes (7): POST /api/admin/login, POST /api/admin/logout, admin save allowed types whitelist, POST /api/admin/save, __admin_session HttpOnly cookie, admin auth gate / login form, admin client save() fetch helper

### Community 48 - "Community 48"
Cohesion: 0.06
Nodes (34): dependencies, astro, @astrojs/node, dompurify, gifenc, html2canvas, marked, devDependencies (+26 more)

### Community 49 - "Community 49"
Cohesion: 0.13
Nodes (23): Account, API_BASE, apiHealth(), currentUser(), idEmail(), login(), logout(), pb() (+15 more)

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
Cohesion: 0.15
Nodes (12): D0 — Autonomous mode + heartbeat (2026-07-09), D1 — Execution order (2026-07-09), D2 — Desktop/web UI (2026-07-09), D3 — PocketBase auth scope + mechanics (2026-07-09), D4 — P2P live sync: scaffold now, defer cross-device sync (2026-07-09), D5 — Slice 6: real-money acks + audit books (2026-07-09), D6 — Desktop, take 2: real dashboard (2026-07-09), D7 — Live P2P, step 1: log-driven loop unification (2026-07-09) (+4 more)

### Community 55 - "Community 55"
Cohesion: 0.22
Nodes (8): Build order & checks, Phase A — Networked transport (lightest first), Phase B — Replicated append-only log (host can leave), Phase C — Provably-fair shuffle, Phase D — Money-persistent books, Poker Together — real multiplayer plan, The one insight everything rests on, What we are *not* building (and why)

### Community 56 - "Community 56"
Cohesion: 0.10
Nodes (13): v(), ../../components/games/turing-bloom/TuringBloom.ts, TB_PALETTES, TB_PRESETS, tbClamp(), tbMulberry32(), TbPalette, TbPreset (+5 more)

### Community 57 - "Community 57"
Cohesion: 0.08
Nodes (27): ../../components/tools/codec-forge/CodecForge.ts, CF_DEFAULTS, CF_REV, CF_TABS, CfB64Source, cfB64Status(), cfB64ToText(), CfB64Variant (+19 more)

### Community 58 - "Community 58"
Cohesion: 0.18
Nodes (3): createPbSession(), makeSeed(), iconSvg()

### Community 59 - "Community 59"
Cohesion: 0.29
Nodes (6): Phasing (when each piece is actually needed), Poker Together — backend (free, portable, Pi-on-demand), Portability contract (so "move it" is one setting), Principle: the backend is thin because the game is P2P, Recommended stack, Security (exposing a Pi to the internet is a real surface)

### Community 60 - "Community 60"
Cohesion: 0.29
Nodes (6): Asset system — single source, referenced everywhere, Design language, Locked decisions (2026-07-09), Poker Together — design language & asset system, Product model (ideation capture, to be refined), Product stance (2026-07-09)

### Community 61 - "Community 61"
Cohesion: 0.33
Nodes (5): Client wiring (not yet — comes with the rooms slice), Layout, Online-play collections (the sequencer), PocketBase — local backend (dev only, for now), Run

### Community 62 - "Community 62"
Cohesion: 0.07
Nodes (35): breadcrumbLd, crumbs, ldJson, post, ../../components/Breadcrumbs.astro, breadcrumbLd, crumbs, game (+27 more)

### Community 65 - "Community 65"
Cohesion: 0.11
Nodes (18): breadcrumbLd, crumbs, ldJson, string, tool, ../../components/tools/audio-transcriber/audio-transcriber.css, ../../components/tools/chroma-lab/chroma-lab.css, ../../components/tools/codec-forge/codec-forge.css (+10 more)

### Community 66 - "Community 66"
Cohesion: 0.10
Nodes (17): ../components/Avatar.astro, ../components/Head.astro, ../components/Nav.astro, RGB, Star, TrailPoint, ../../layouts/Base.astro, ../../layouts/ToolBase.astro (+9 more)

### Community 67 - "Community 67"
Cohesion: 0.43
Nodes (3): SeatView, TableView, crownSvg()

### Community 68 - "Community 68"
Cohesion: 0.12
Nodes (14): ../../components/tools/regex-lab/RegexLab.ts, RegexLabTool, RL_EXAMPLES, RL_FLAG_SET, RL_FLAGS, RL_REFERENCE, rlAdvanceStringIndex(), rlBuildHighlight() (+6 more)

### Community 69 - "Community 69"
Cohesion: 0.20
Nodes (25): makeDeck(), advanceAction(), applyAction(), awardUncontested(), botInputFor(), cap(), commit(), dealStreet() (+17 more)

### Community 70 - "Community 70"
Cohesion: 0.11
Nodes (15): ActionRequest, VARIANTS, BLIND_TIERS, counters, files, games, manifest, MIXED_TIERS (+7 more)

### Community 71 - "Community 71"
Cohesion: 0.58
Nodes (8): seededRng(), legalActions(), projection(), randInt(), randomLegalAction(), runConservationCheck(), runReplayCheck(), runShortAllInReopenCheck()

### Community 72 - "Community 72"
Cohesion: 0.33
Nodes (8): StartSeat, DealConfig, Peer, SeatSnapshot, Action, BotPersonality, SeatKind, VariantId

### Community 173 - "Community 173"
Cohesion: 0.14
Nodes (7): ../../components/games/starfield-toy/Starfield.ts, SF_PALETTES, sfClamp(), SfPalette, SfStar, sfToRGB(), StarfieldVoyagerGame

### Community 175 - "Community 175"
Cohesion: 0.11
Nodes (8): ../../components/games/murmuration/Murmuration.ts, BO_PALETTES, BoBoid, boClamp(), BoPalette, BoPointerMode, boToRGB(), MurmurationGame

### Community 176 - "Community 176"
Cohesion: 0.27
Nodes (4): byteLength(), escapeHtml(), formatBytes(), toCsv()

### Community 178 - "Community 178"
Cohesion: 0.27
Nodes (3): indentString(), repairJson(), sortDeep()

## Knowledge Gaps
- **439 isolated node(s):** `name`, `type`, `version`, `node`, `dev` (+434 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `v()` connect `Community 56` to `Community 32`, `Community 35`, `Community 4`, `Community 42`, `Layout Shell (Base + ToolBase + Head + Nav)`, `Community 173`, `Community 45`, `Community 175`, `Community 25`, `Community 29`?**
  _High betweenness centrality (0.150) - this node is a cross-community bridge._
- **Why does `../../components/games/lsystem/LSystem.ts` connect `Community 4` to `Community 62`?**
  _High betweenness centrality (0.142) - this node is a cross-community bridge._
- **Why does `Rng` connect `Community 46` to `Community 42`, `Community 4`, `Community 71`?**
  _High betweenness centrality (0.120) - this node is a cross-community bridge._
- **What connects `name`, `type`, `version` to the rest of the system?**
  _439 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Content Types + AdminSavePlugin Dispatch` be split into smaller, more focused modules?**
  _Cohesion score 0.0519774011299435 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.09745293466223699 - nodes in this community are weakly interconnected._
- **Should `Config KV-with-Fallback Chain` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._