# Graph Report - portfolio-apanjwani0  (2026-07-03)

## Corpus Check
- 56 files · ~31,746 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 570 nodes · 897 edges · 35 communities (31 shown, 4 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 12 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `4c67b0a9`
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

## God Nodes (most connected - your core abstractions)
1. `JsonTidyTool` - 42 edges
2. `../../components/tools/json-tidy/JsonTidy.ts` - 33 edges
3. `../../components/tools/pattern-forge/PatternForge.ts` - 23 edges
4. `GameOfLifeGame` - 22 edges
5. `$()` - 21 edges
6. `../../layouts/Base.astro` - 17 edges
7. `getSite()` - 16 edges
8. `../../components/games/type-trial/TypeTrial.ts` - 15 edges
9. `TypeTrialTool` - 15 edges
10. `adminSavePlugin` - 11 edges

## Surprising Connections (you probably didn't know these)
- `tools/index.astro tools listing` --references--> `../../layouts/Base.astro`  [EXTRACTED]
  src/pages/tools/index.astro → src/layouts/Base.astro
- `tools/[slug].astro dynamic tool page` --references--> `../../layouts/ToolBase.astro`  [EXTRACTED]
  src/pages/tools/[slug].astro → src/layouts/ToolBase.astro
- `ToolBase.astro (tools layout)` --semantically_similar_to--> `Base.astro (default layout)`  [INFERRED] [semantically similar]
  src/layouts/ToolBase.astro → src/layouts/Base.astro
- `[slug].astro top-level redirect router` --references--> `games/[slug].astro game detail page`  [INFERRED]
  src/pages/[slug].astro → src/pages/games/[slug].astro
- `blogs/[slug].astro post detail page` --references--> `../../layouts/Base.astro`  [EXTRACTED]
  src/pages/blogs/[slug].astro → src/layouts/Base.astro

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Runtime config: KV/file/static fallback chain** — lib_config_get_config, lib_config_from_kv, lib_config_from_file [INFERRED 0.85]
- **Site layout shell (Head + Nav + Base/ToolBase)** — layouts_base_layout, layouts_toolbase_layout, components_head_component, components_nav_component [INFERRED 0.85]
- **MD Enhanced tool subsystem** — md_enhanced_mdenhancedtool, md_enhanced_helpsections, md_enhanced_toggleextension, md_enhanced_startertemplate [INFERRED 0.75]
- **Client-side interactive browser tools** — audio_transcriber_audiotranscribertool, md_enhanced_mdenhancedtool, layouts_toolbase_layout [INFERRED 0.75]
- **Admin content editor tabs save via /api/admin/save with allowed types** — pages_admin, pages_admin_tabs, pages_admin_save_handler, admin_save_route, admin_save_allowed_types [INFERRED 0.85]

## Communities (35 total, 4 thin omitted)

### Community 0 - "Content Types + AdminSavePlugin Dispatch"
Cohesion: 0.07
Nodes (39): adminSavePlugin, ExperienceItem Props, Post, Post (interface), posts, Company, Company (interface), experience (+31 more)

### Community 1 - "Community 1"
Cohesion: 0.27
Nodes (8): POST(), POST(), POST(), createSession(), deleteSession(), devSessions, generateToken(), validateSession()

### Community 2 - "Config KV-with-Fallback Chain"
Cohesion: 0.05
Nodes (39): 1. Authentication & Session Management, 2. Input Validation & Injection, 3. Infrastructure & Deployment, 4. Middleware, Config Access & Data Flow, 5. Dependencies & Supply Chain, Consolidated Remediation Roadmap, CRITICAL — C1.1: Timing Attack on Password Comparison, CRITICAL — C1.2: Auth Bypass if ADMIN_SECRET Is Unset in Production (+31 more)

### Community 3 - "Community 3"
Cohesion: 0.21
Nodes (6): ../components/home/StarField.ts, parseColor(), RGB, Star, StarField, TrailPoint

### Community 4 - "Community 4"
Cohesion: 0.15
Nodes (12): ../components/Avatar.astro, ../components/Head.astro, ../components/Nav.astro, ../../layouts/Base.astro, ../../layouts/ToolBase.astro, personJsonLd(), ldJson, sameAs (+4 more)

### Community 5 - "MdEnhanced Tool (markdown render)"
Cohesion: 0.11
Nodes (13): HelpEntry, HelpSection, helpSections, ../../components/tools/md-enhanced/MdEnhanced.ts, MdEnhancedTool, dependencies, astro, @astrojs/cloudflare (+5 more)

### Community 6 - "MdEnhanced Export Pipeline (PDF/Image)"
Cohesion: 0.14
Nodes (11): DOMPurify library, exportImage() (html2canvas), exportPdf(), handleExport(), HelpEntry interface, HelpSection interface, helpSections const, marked library (+3 more)

### Community 7 - "Admin API Route Handlers (login/logout/save)"
Cohesion: 0.09
Nodes (21): ../../components/tools/pattern-forge/PatternForge.ts, decodeState(), encodeState(), GENERATORS, makeNoise(), mulberry32(), paint(), Palette (+13 more)

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
Cohesion: 0.10
Nodes (19): devDependencies, @astrojs/check, @types/dompurify, @types/node, typescript, engines, node, name (+11 more)

### Community 19 - "Community 19"
Cohesion: 0.14
Nodes (14): ../../components/games/type-trial/TypeTrial.ts, Best, Bests, CATEGORIES, Category, categoryName(), escapeHtml(), loadBests() (+6 more)

### Community 20 - "Community 20"
Cohesion: 0.18
Nodes (10): ldJson, post, blogPostingJsonLd(), BlogPostingSchema, ItemListEntry, itemListJsonLd(), PersonSchema, WebApplicationSchema (+2 more)

### Community 21 - "Community 21"
Cohesion: 0.22
Nodes (7): Config Schema (conceptual), Data Flow, Directory Structure, Extensibility Points, Oat UI Integration, Philosophy, SSR & Adapter

### Community 22 - "Community 22"
Cohesion: 0.22
Nodes (8): Content, Deploy to Cloudflare Workers, Deploy to Raspberry Pi, Deploy to VPS / cloud registry, Docker, portfolio-apanjwani0, Run locally, Stack

### Community 23 - "Community 23"
Cohesion: 0.40
Nodes (4): Adding a new game, Current games, Games, How it works

### Community 24 - "Community 24"
Cohesion: 0.50
Nodes (3): exclude, extends, include

### Community 25 - "Community 25"
Cohesion: 0.12
Nodes (12): ../../components/games/game-of-life/GameOfLife.ts, clamp(), GameOfLifeGame, GLIDER, GOSPER_GUN, LWSS, PatternDef, patternHeight() (+4 more)

### Community 27 - "Community 27"
Cohesion: 0.05
Nodes (30): ../../components/tools/json-tidy/JsonTidy.ts, analyze(), byteLength(), childPath(), cleanMessage(), countKeys(), ErrorLoc, escapeHtml() (+22 more)

### Community 28 - "Community 28"
Cohesion: 0.12
Nodes (20): ../components/ExperienceItem.astro, ../components/ProjectCard.astro, ProjectCard Props, buildResult(), CACHE_PATH, getProjectStats(), GitHubStats, memCache (+12 more)

### Community 29 - "Community 29"
Cohesion: 0.20
Nodes (11): POST /api/admin/login, POST /api/admin/logout, admin save allowed types whitelist, POST /api/admin/save, __admin_session HttpOnly cookie, admin auth gate / login form, admin projects drag-to-reorder, admin IP whitelist 404 guard (+3 more)

### Community 30 - "Community 30"
Cohesion: 0.15
Nodes (12): Tool, Tool (interface), ToolStatus (type), tools, ToolStatus, tools/index.astro tools listing, tools/[slug].astro dynamic tool page, ldJson (+4 more)

### Community 31 - "Community 31"
Cohesion: 0.27
Nodes (8): getGames(), getPosts(), blogs/[slug].astro post detail page, GET(), [slug].astro top-level redirect router, gameMatch, normalizedSlug, postMatch

### Community 32 - "Community 32"
Cohesion: 0.25
Nodes (7): ldJson, string, tool, ../../components/tools/audio-transcriber/audio-transcriber.css, ../../components/tools/json-tidy/json-tidy.css, ../../components/tools/md-enhanced/md-enhanced.css, ../../components/tools/pattern-forge/pattern-forge.css

### Community 33 - "Community 33"
Cohesion: 0.48
Nodes (5): ClientRouter (view transitions), Head Props (SEO meta), Base.astro (default layout), ToolBase.astro (tools layout), getSite()

### Community 34 - "Community 34"
Cohesion: 0.29
Nodes (6): game, ldJson, liveGame, webAppJsonLd(), ../../components/games/game-of-life/game-of-life.css, ../../components/games/type-trial/type-trial.css

## Knowledge Gaps
- **193 isolated node(s):** `name`, `type`, `version`, `node`, `dev` (+188 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `../../components/tools/json-tidy/JsonTidy.ts` connect `Community 27` to `Community 32`?**
  _High betweenness centrality (0.182) - this node is a cross-community bridge._
- **Why does `../../components/games/game-of-life/GameOfLife.ts` connect `Community 25` to `Community 34`?**
  _High betweenness centrality (0.130) - this node is a cross-community bridge._
- **What connects `name`, `type`, `version` to the rest of the system?**
  _193 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Content Types + AdminSavePlugin Dispatch` be split into smaller, more focused modules?**
  _Cohesion score 0.0666049953746531 - nodes in this community are weakly interconnected._
- **Should `Config KV-with-Fallback Chain` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `MdEnhanced Tool (markdown render)` be split into smaller, more focused modules?**
  _Cohesion score 0.10666666666666667 - nodes in this community are weakly interconnected._
- **Should `MdEnhanced Export Pipeline (PDF/Image)` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._