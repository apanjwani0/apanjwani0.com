# Graph Report - portfolio-apanjwani0  (2026-07-27)

## Corpus Check
- 69 files · ~77,517 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1106 nodes · 2096 edges · 51 communities (42 shown, 9 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 21 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8d30cce7`
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
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 171|Community 171]]
- [[_COMMUNITY_Community 173|Community 173]]
- [[_COMMUNITY_Community 175|Community 175]]
- [[_COMMUNITY_Community 176|Community 176]]
- [[_COMMUNITY_Community 178|Community 178]]
- [[_COMMUNITY_Community 179|Community 179]]
- [[_COMMUNITY_Community 180|Community 180]]

## God Nodes (most connected - your core abstractions)
1. `JsonTidyTool` - 60 edges
2. `MazeWeaverGame` - 45 edges
3. `../../components/tools/json-tidy/JsonTidy.ts` - 44 edges
4. `Twenty48Game` - 41 edges
5. `LSystemGame` - 30 edges
6. `EpochWizardTool` - 30 edges
7. `MurmurationGame` - 28 edges
8. `ChromaLabTool` - 28 edges
9. `../../components/tools/codec-forge/CodecForge.ts` - 27 edges
10. `CodecForgeTool` - 26 edges

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

## Communities (51 total, 9 thin omitted)

### Community 0 - "Content Types + AdminSavePlugin Dispatch"
Cohesion: 0.07
Nodes (37): adminSavePlugin, Post, Post (interface), posts, Company, Company (interface), experience, Role (+29 more)

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
Cohesion: 0.29
Nodes (6): site, ldJson, listed, ../../config/site, ../../config/tools, ../../styles/tools.css

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

### Community 30 - "Community 30"
Cohesion: 0.09
Nodes (21): Tool, Tool (interface), ToolStatus (type), tools, ToolStatus, tools/index.astro tools listing, tools/[slug].astro dynamic tool page, breadcrumbLd (+13 more)

### Community 31 - "Community 31"
Cohesion: 0.27
Nodes (8): POST(), POST(), POST(), createSession(), deleteSession(), devSessions, generateToken(), validateSession()

### Community 32 - "Community 32"
Cohesion: 0.09
Nodes (10): ../../components/games/maze-weaver/MazeWeaver.ts, clamp(), DIRS, GEN_NAMES, GenId, MazeWeaverGame, mulberry32(), Phase (+2 more)

### Community 33 - "Community 33"
Cohesion: 0.18
Nodes (13): ClientRouter (view transitions), Head Props (SEO meta), Base.astro (default layout), ToolBase.astro (tools layout), getGames(), getPosts(), getSite(), blogs/[slug].astro post detail page (+5 more)

### Community 35 - "Community 35"
Cohesion: 0.11
Nodes (12): ../../components/games/flow-field/FlowField.ts, clamp(), fade(), FlowFieldGame, hash2(), lerp(), mulberry32(), Palette (+4 more)

### Community 36 - "Community 36"
Cohesion: 0.07
Nodes (28): breadcrumbLd, crumbs, ldJson, post, ../../components/Breadcrumbs.astro, breadcrumbLd, crumbs, game (+20 more)

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
Cohesion: 0.14
Nodes (17): ExperienceItem Props, ../components/ProjectCard.astro, ProjectCard Props, GitHubStats, itemListJsonLd(), render(), renderInline, renderInline() (+9 more)

### Community 41 - "Community 41"
Cohesion: 0.50
Nodes (3): Design Thinking, Frontend Aesthetics Guidelines, Portfolio Override (apanjwani0)

### Community 43 - "Community 43"
Cohesion: 0.12
Nodes (18): ../../components/tools/epoch-wizard/EpochWizard.ts, EF_DEFAULTS, EF_UNIT_LABEL, EfBreakdown, efDetectUnit(), efDigits(), efEsc(), efFormatDate() (+10 more)

### Community 45 - "Community 45"
Cohesion: 0.09
Nodes (15): ../../components/games/twenty48/Twenty48.ts, TW_SIZES, TW_VECTORS, twBestKey(), twClamp(), TwDir, twEaseOutCubic(), Twenty48Game (+7 more)

### Community 48 - "Community 48"
Cohesion: 0.05
Nodes (34): HelpEntry, HelpSection, helpSections, ../../components/tools/md-enhanced/MdEnhanced.ts, MdEnhancedTool, dependencies, astro, @astrojs/cloudflare (+26 more)

### Community 57 - "Community 57"
Cohesion: 0.08
Nodes (27): ../../components/tools/codec-forge/CodecForge.ts, CF_DEFAULTS, CF_REV, CF_TABS, CfB64Source, cfB64Status(), cfB64ToText(), CfB64Variant (+19 more)

### Community 171 - "Community 171"
Cohesion: 0.11
Nodes (18): ../components/Avatar.astro, ../components/Head.astro, ../components/Nav.astro, ../components/home/StarField.ts, RGB, Star, TrailPoint, ../../layouts/Base.astro (+10 more)

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

### Community 180 - "Community 180"
Cohesion: 0.20
Nodes (11): POST /api/admin/login, POST /api/admin/logout, admin save allowed types whitelist, POST /api/admin/save, __admin_session HttpOnly cookie, admin auth gate / login form, admin projects drag-to-reorder, admin IP whitelist 404 guard (+3 more)

## Knowledge Gaps
- **282 isolated node(s):** `name`, `type`, `version`, `node`, `dev` (+277 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `../../components/tools/json-tidy/JsonTidy.ts` connect `Community 39` to `MdEnhanced Tool (markdown render)`, `Community 176`, `Community 178`, `Community 179`, `Community 53`, `Community 27`, `Community 30`?**
  _High betweenness centrality (0.133) - this node is a cross-community bridge._
- **Why does `../../components/tools/codec-forge/CodecForge.ts` connect `Community 57` to `Community 30`?**
  _High betweenness centrality (0.111) - this node is a cross-community bridge._
- **Why does `../../components/games/lsystem/LSystem.ts` connect `Community 4` to `Community 36`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **What connects `name`, `type`, `version` to the rest of the system?**
  _282 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Content Types + AdminSavePlugin Dispatch` be split into smaller, more focused modules?**
  _Cohesion score 0.0743321718931475 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.09745293466223699 - nodes in this community are weakly interconnected._
- **Should `Config KV-with-Fallback Chain` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._