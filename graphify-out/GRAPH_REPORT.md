# Graph Report - portfolio-apanjwani0  (2026-07-07)

## Corpus Check
- 66 files · ~52,119 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 822 nodes · 1513 edges · 54 communities (47 shown, 7 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 27 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b05ffc2f`
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

## God Nodes (most connected - your core abstractions)
1. `JsonTidyTool` - 56 edges
2. `../../components/tools/json-tidy/JsonTidy.ts` - 39 edges
3. `PokerGame` - 37 edges
4. `../../components/games/poker/Poker.ts` - 35 edges
5. `FlowFieldGame` - 23 edges
6. `../../components/tools/pattern-forge/PatternForge.ts` - 23 edges
7. `GameOfLifeGame` - 22 edges
8. `../../components/games/hue-hunt/HueHunt.ts` - 22 edges
9. `HueHuntGame` - 22 edges
10. `$()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `readTheme()` --calls--> `v()`  [INFERRED]
  src/components/games/poker/ui/renderer.ts → public/oat.min.js
- `shuffle()` --calls--> `Rng`  [INFERRED]
  src/components/games/poker/engine/cards.ts → src/components/games/poker/engine/bots.ts
- `tools/index.astro tools listing` --references--> `../../layouts/Base.astro`  [EXTRACTED]
  src/pages/tools/index.astro → src/layouts/Base.astro
- `tools/[slug].astro dynamic tool page` --references--> `../../layouts/ToolBase.astro`  [EXTRACTED]
  src/pages/tools/[slug].astro → src/layouts/ToolBase.astro
- `ToolBase.astro (tools layout)` --semantically_similar_to--> `Base.astro (default layout)`  [INFERRED] [semantically similar]
  src/layouts/ToolBase.astro → src/layouts/Base.astro

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Runtime config: KV/file/static fallback chain** — lib_config_get_config, lib_config_from_kv, lib_config_from_file [INFERRED 0.85]
- **Site layout shell (Head + Nav + Base/ToolBase)** — layouts_base_layout, layouts_toolbase_layout, components_head_component, components_nav_component [INFERRED 0.85]
- **MD Enhanced tool subsystem** — md_enhanced_mdenhancedtool, md_enhanced_helpsections, md_enhanced_toggleextension, md_enhanced_startertemplate [INFERRED 0.75]
- **Client-side interactive browser tools** — audio_transcriber_audiotranscribertool, md_enhanced_mdenhancedtool, layouts_toolbase_layout [INFERRED 0.75]
- **Admin content editor tabs save via /api/admin/save with allowed types** — pages_admin, pages_admin_tabs, pages_admin_save_handler, admin_save_route, admin_save_allowed_types [INFERRED 0.85]

## Communities (54 total, 7 thin omitted)

### Community 0 - "Content Types + AdminSavePlugin Dispatch"
Cohesion: 0.30
Nodes (9): site, fromFile(), fromKV(), getConfig(), getExperience(), getKV(), getProjects(), KVStore (+1 more)

### Community 1 - "Community 1"
Cohesion: 0.10
Nodes (22): ../../components/games/hue-hunt/HueHunt.ts, accuracyPct(), buildOptions(), clampByte(), colorDistance(), DiffConfig, DiffId, DIFFS (+14 more)

### Community 2 - "Config KV-with-Fallback Chain"
Cohesion: 0.05
Nodes (39): 1. Authentication & Session Management, 2. Input Validation & Injection, 3. Infrastructure & Deployment, 4. Middleware, Config Access & Data Flow, 5. Dependencies & Supply Chain, Consolidated Remediation Roadmap, CRITICAL — C1.1: Timing Attack on Password Comparison, CRITICAL — C1.2: Auth Bypass if ADMIN_SECRET Is Unset in Production (+31 more)

### Community 3 - "Community 3"
Cohesion: 0.21
Nodes (6): ../components/home/StarField.ts, parseColor(), RGB, Star, StarField, TrailPoint

### Community 4 - "Community 4"
Cohesion: 0.15
Nodes (11): ldJson, post, blogPostingJsonLd(), BlogPostingSchema, ItemListEntry, itemListJsonLd(), PersonSchema, WebApplicationSchema (+3 more)

### Community 5 - "MdEnhanced Tool (markdown render)"
Cohesion: 0.19
Nodes (5): HelpEntry, HelpSection, helpSections, ../../components/tools/md-enhanced/MdEnhanced.ts, MdEnhancedTool

### Community 6 - "MdEnhanced Export Pipeline (PDF/Image)"
Cohesion: 0.14
Nodes (11): DOMPurify library, exportImage() (html2canvas), exportPdf(), handleExport(), HelpEntry interface, HelpSection interface, helpSections const, marked library (+3 more)

### Community 7 - "Admin API Route Handlers (login/logout/save)"
Cohesion: 0.10
Nodes (22): Rng, ../../components/tools/pattern-forge/PatternForge.ts, decodeState(), encodeState(), GENERATORS, makeNoise(), mulberry32(), paint() (+14 more)

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
Nodes (26): dependencies, astro, @astrojs/cloudflare, @astrojs/node, dompurify, html2canvas, wrangler, devDependencies (+18 more)

### Community 19 - "Community 19"
Cohesion: 0.14
Nodes (14): ../../components/games/type-trial/TypeTrial.ts, Best, Bests, CATEGORIES, Category, categoryName(), escapeHtml(), loadBests() (+6 more)

### Community 20 - "Community 20"
Cohesion: 0.48
Nodes (5): ClientRouter (view transitions), Head Props (SEO meta), Base.astro (default layout), ToolBase.astro (tools layout), getSite()

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
Cohesion: 0.12
Nodes (12): ../../components/games/game-of-life/GameOfLife.ts, clamp(), GameOfLifeGame, GLIDER, GOSPER_GUN, LWSS, PatternDef, patternHeight() (+4 more)

### Community 28 - "Community 28"
Cohesion: 0.22
Nodes (11): ../components/ProjectCard.astro, buildResult(), CACHE_PATH, getProjectStats(), memCache, parseGithubUrl(), readCache(), StatsCache (+3 more)

### Community 29 - "Community 29"
Cohesion: 0.15
Nodes (12): ../components/Avatar.astro, ../components/Head.astro, ../components/Nav.astro, ../../layouts/Base.astro, ../../layouts/ToolBase.astro, personJsonLd(), ldJson, sameAs (+4 more)

### Community 30 - "Community 30"
Cohesion: 0.15
Nodes (12): Tool, Tool (interface), ToolStatus (type), tools, ToolStatus, tools/index.astro tools listing, tools/[slug].astro dynamic tool page, ldJson (+4 more)

### Community 31 - "Community 31"
Cohesion: 0.27
Nodes (8): POST(), POST(), POST(), createSession(), deleteSession(), devSessions, generateToken(), validateSession()

### Community 32 - "Community 32"
Cohesion: 0.20
Nodes (11): POST /api/admin/login, POST /api/admin/logout, admin save allowed types whitelist, POST /api/admin/save, __admin_session HttpOnly cookie, admin auth gate / login form, admin projects drag-to-reorder, admin IP whitelist 404 guard (+3 more)

### Community 33 - "Community 33"
Cohesion: 0.27
Nodes (8): getGames(), getPosts(), blogs/[slug].astro post detail page, GET(), [slug].astro top-level redirect router, gameMatch, normalizedSlug, postMatch

### Community 34 - "Community 34"
Cohesion: 0.09
Nodes (32): StartSeat, BOT_NAMES, botName(), makeSeats(), Prefs, randomPersonality(), readPrefs(), rooms (+24 more)

### Community 35 - "Community 35"
Cohesion: 0.12
Nodes (11): ../../components/games/flow-field/FlowField.ts, clamp(), fade(), FlowFieldGame, hash2(), lerp(), mulberry32(), Palette (+3 more)

### Community 36 - "Community 36"
Cohesion: 0.14
Nodes (14): ../components/ExperienceItem.astro, game, ldJson, liveGame, render(), renderInline, games/[slug].astro game detail page, ../../components/games/flow-field/flow-field.css (+6 more)

### Community 37 - "Community 37"
Cohesion: 0.13
Nodes (7): currentActorKind(), fmtChips(), hostName(), clamp(), GameState, esc(), PokerGame

### Community 38 - "Community 38"
Cohesion: 0.19
Nodes (28): makeDeck(), advanceAction(), applyAction(), awardUncontested(), botInputFor(), cap(), commit(), dealStreet() (+20 more)

### Community 39 - "Community 39"
Cohesion: 0.10
Nodes (25): ../../components/tools/json-tidy/JsonTidy.ts, analyze(), childPath(), cleanMessage(), ErrorLoc, Indent, isPrimitive(), jtDeepEqual() (+17 more)

### Community 40 - "Community 40"
Cohesion: 0.17
Nodes (16): ALL_RANKS, buildRemainingDeck(), cardKey(), decide(), estimateEquity(), makeRng(), PersonalityProfile, PROFILES (+8 more)

### Community 41 - "Community 41"
Cohesion: 0.15
Nodes (14): cardLabel(), cryptoInt(), shuffle(), evaluate5(), RANK_PLURAL, singular(), Card, CATEGORY_NAME (+6 more)

### Community 42 - "Community 42"
Cohesion: 0.20
Nodes (4): byteLength(), escapeHtml(), formatBytes(), toCsv()

### Community 43 - "Community 43"
Cohesion: 0.17
Nodes (8): LayoutConfig, Renderer, SeatView, SUIT_COLOR, TableView, createRenderer(), readTheme(), Theme

### Community 45 - "Community 45"
Cohesion: 0.25
Nodes (3): exceedsNodeCap(), indentString(), sortDeep()

### Community 46 - "Community 46"
Cohesion: 0.22
Nodes (8): webAppJsonLd(), ldJson, string, tool, ../../components/tools/audio-transcriber/audio-transcriber.css, ../../components/tools/json-tidy/json-tidy.css, ../../components/tools/md-enhanced/md-enhanced.css, ../../components/tools/pattern-forge/pattern-forge.css

### Community 47 - "Community 47"
Cohesion: 0.25
Nodes (7): adminSavePlugin, Post, generateBlogs, generateExperience, generateGames, generateProjects, generateSite

### Community 48 - "Community 48"
Cohesion: 0.25
Nodes (8): Post (interface), posts, fromFile, fromKV, getConfig, getKV, getPosts, getSite

### Community 49 - "Community 49"
Cohesion: 0.29
Nodes (5): ExperienceItem Props, ProjectCard Props, Company, GitHubStats, renderInline()

### Community 50 - "Community 50"
Cohesion: 0.33
Nodes (5): Company (interface), experience, Role, Role (interface), getExperience

### Community 51 - "Community 51"
Cohesion: 0.40
Nodes (4): Game, Game (interface), games, getGames

### Community 52 - "Community 52"
Cohesion: 0.40
Nodes (4): Project, Project (interface), projects, getProjects

## Knowledge Gaps
- **224 isolated node(s):** `name`, `type`, `version`, `node`, `dev` (+219 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `../../components/games/poker/Poker.ts` connect `Community 34` to `Community 36`, `Community 37`, `Community 38`, `Community 40`, `Community 41`, `Community 43`?**
  _High betweenness centrality (0.249) - this node is a cross-community bridge._
- **Why does `../../components/tools/json-tidy/JsonTidy.ts` connect `Community 39` to `Community 42`, `Community 44`, `Community 45`, `Community 46`, `Community 53`, `Community 27`?**
  _High betweenness centrality (0.177) - this node is a cross-community bridge._
- **Why does `JsonTidyTool` connect `Community 27` to `Community 39`, `Community 42`, `Community 44`, `Community 45`, `Community 53`?**
  _High betweenness centrality (0.098) - this node is a cross-community bridge._
- **What connects `name`, `type`, `version` to the rest of the system?**
  _224 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.09745293466223699 - nodes in this community are weakly interconnected._
- **Should `Config KV-with-Fallback Chain` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `MdEnhanced Export Pipeline (PDF/Image)` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._