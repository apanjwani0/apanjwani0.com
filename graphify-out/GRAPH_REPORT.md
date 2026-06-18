# Graph Report - portfolio-apanjwani0  (2026-06-18)

## Corpus Check
- 58 files · ~24,647 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 488 nodes · 717 edges · 34 communities (30 shown, 4 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `15ff4c51`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Content Types + AdminSavePlugin Dispatch|Content Types + AdminSavePlugin Dispatch]]
- [[_COMMUNITY_Dynamic slug Routes + SEO ld+json|Dynamic [slug] Routes + SEO ld+json]]
- [[_COMMUNITY_Config KV-with-Fallback Chain|Config KV-with-Fallback Chain]]
- [[_COMMUNITY_Admin UI + Save API + Tools Config|Admin UI + Save API + Tools Config]]
- [[_COMMUNITY_Card Components + GitHub Stats|Card Components + GitHub Stats]]
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
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]

## God Nodes (most connected - your core abstractions)
1. `../../components/tools/pattern-forge/PatternForge.ts` - 23 edges
2. `$()` - 21 edges
3. `../../layouts/Base.astro` - 17 edges
4. `../../components/tools/json-tidy/JsonTidy.ts` - 15 edges
5. `JsonTidyTool` - 15 edges
6. `getSite()` - 15 edges
7. `TypeTrialTool` - 14 edges
8. `../../components/tools/type-trial/TypeTrial.ts` - 12 edges
9. `adminSavePlugin` - 11 edges
10. `MdEnhancedTool` - 11 edges

## Surprising Connections (you probably didn't know these)
- `tools/index.astro tools listing` --references--> `../../layouts/Base.astro`  [EXTRACTED]
  src/pages/tools/index.astro → src/layouts/Base.astro
- `tools/[slug].astro dynamic tool page` --references--> `../../layouts/ToolBase.astro`  [EXTRACTED]
  src/pages/tools/[slug].astro → src/layouts/ToolBase.astro
- `MdEnhancedTool (custom element)` --conceptually_related_to--> `starterTemplate`  [INFERRED]
  src/components/tools/md-enhanced/MdEnhanced.ts → src/components/tools/md-enhanced/templates.ts
- `MdEnhancedTool (custom element)` --conceptually_related_to--> `toggleExtension (marked >+ syntax)`  [INFERRED]
  src/components/tools/md-enhanced/MdEnhanced.ts → src/components/tools/md-enhanced/toggle-extension.ts
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

## Communities (34 total, 4 thin omitted)

### Community 0 - "Content Types + AdminSavePlugin Dispatch"
Cohesion: 0.07
Nodes (38): adminSavePlugin, Post, Post (interface), posts, Company, Company (interface), experience, Role (+30 more)

### Community 1 - "Dynamic [slug] Routes + SEO ld+json"
Cohesion: 0.16
Nodes (11): ldJson, post, game, ldJson, blogPostingJsonLd(), BlogPostingSchema, personJsonLd(), PersonSchema (+3 more)

### Community 2 - "Config KV-with-Fallback Chain"
Cohesion: 0.05
Nodes (39): 1. Authentication & Session Management, 2. Input Validation & Injection, 3. Infrastructure & Deployment, 4. Middleware, Config Access & Data Flow, 5. Dependencies & Supply Chain, Consolidated Remediation Roadmap, CRITICAL — C1.1: Timing Attack on Password Comparison, CRITICAL — C1.2: Auth Bypass if ADMIN_SECRET Is Unset in Production (+31 more)

### Community 3 - "Admin UI + Save API + Tools Config"
Cohesion: 0.23
Nodes (9): POST(), POST(), POST(), logger, createSession(), deleteSession(), devSessions, generateToken() (+1 more)

### Community 4 - "Card Components + GitHub Stats"
Cohesion: 0.09
Nodes (23): ../components/ExperienceItem.astro, ExperienceItem Props, ../components/ProjectCard.astro, ProjectCard Props, buildResult(), CACHE_PATH, getProjectStats(), GitHubStats (+15 more)

### Community 5 - "MdEnhanced Tool (markdown render)"
Cohesion: 0.19
Nodes (5): HelpEntry, HelpSection, helpSections, ../../components/tools/md-enhanced/MdEnhanced.ts, MdEnhancedTool

### Community 6 - "MdEnhanced Export Pipeline (PDF/Image)"
Cohesion: 0.13
Nodes (13): DOMPurify library, exportImage() (html2canvas), exportPdf(), handleExport(), HelpEntry interface, HelpSection interface, helpSections const, marked library (+5 more)

### Community 7 - "Admin API Route Handlers (login/logout/save)"
Cohesion: 0.09
Nodes (21): ../../components/tools/pattern-forge/PatternForge.ts, decodeState(), encodeState(), GENERATORS, makeNoise(), mulberry32(), paint(), Palette (+13 more)

### Community 8 - "astro.config.mjs Plugin Generators"
Cohesion: 0.07
Nodes (15): Admin Config Management, `/antigravity <task>`, `/browser-debug [url] [what to check]`, Build / Test / Run, Code graph (graphify), Configuration, Design System, `/frontent-design` (+7 more)

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
Cohesion: 0.17
Nodes (16): $(), activeIndex(), b(), cleanup(), connectedCallback(), disconnectedCallback(), #e(), emit() (+8 more)

### Community 13 - "Request Middleware (CSP + Admin No-Index Gate)"
Cohesion: 0.67
Nodes (3): Admin path no-store/noindex gate, CSP, onRequest

### Community 18 - "Community 18"
Cohesion: 0.07
Nodes (26): dependencies, astro, @astrojs/cloudflare, @astrojs/node, dompurify, html2canvas, wrangler, devDependencies (+18 more)

### Community 19 - "Community 19"
Cohesion: 0.15
Nodes (12): ../../components/tools/type-trial/TypeTrial.ts, Best, CATEGORIES, Category, escapeHtml(), loadBest(), pick(), rankFor() (+4 more)

### Community 20 - "Community 20"
Cohesion: 0.21
Nodes (6): ../components/home/StarField.ts, parseColor(), RGB, Star, StarField, TrailPoint

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

### Community 27 - "Community 27"
Cohesion: 0.13
Nodes (15): ../../components/tools/json-tidy/JsonTidy.ts, analyze(), byteLength(), cleanMessage(), countKeys(), ErrorLoc, escapeHtml(), formatBytes() (+7 more)

### Community 28 - "Community 28"
Cohesion: 0.18
Nodes (13): ClientRouter (view transitions), Head Props (SEO meta), Base.astro (default layout), ToolBase.astro (tools layout), getGames(), getPosts(), getSite(), blogs/[slug].astro post detail page (+5 more)

### Community 29 - "Community 29"
Cohesion: 0.20
Nodes (11): POST /api/admin/login, POST /api/admin/logout, admin save allowed types whitelist, POST /api/admin/save, __admin_session HttpOnly cookie, admin auth gate / login form, admin projects drag-to-reorder, admin IP whitelist 404 guard (+3 more)

### Community 30 - "Community 30"
Cohesion: 0.20
Nodes (9): Tool, Tool (interface), ToolStatus (type), tools, ToolStatus, tools/index.astro tools listing, tools/[slug].astro dynamic tool page, ../../config/tools (+1 more)

### Community 31 - "Community 31"
Cohesion: 0.31
Nodes (7): ../components/Head.astro, ../components/Nav.astro, ../../layouts/Base.astro, ../../layouts/ToolBase.astro, ../../lib/config, ../styles/global.css, ../styles/shared.css

### Community 32 - "Community 32"
Cohesion: 0.25
Nodes (7): ldJson, tool, ../../components/tools/audio-transcriber/audio-transcriber.css, ../../components/tools/json-tidy/json-tidy.css, ../../components/tools/md-enhanced/md-enhanced.css, ../../components/tools/pattern-forge/pattern-forge.css, ../../components/tools/type-trial/type-trial.css

### Community 33 - "Community 33"
Cohesion: 0.33
Nodes (4): ../components/Avatar.astro, ldJson, sameAs, ../styles/home.css

## Knowledge Gaps
- **177 isolated node(s):** `name`, `type`, `version`, `node`, `dev` (+172 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `../../components/tools/pattern-forge/PatternForge.ts` connect `Admin API Route Handlers (login/logout/save)` to `Community 32`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **Why does `../../components/tools/json-tidy/JsonTidy.ts` connect `Community 27` to `Community 32`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **Why does `../../components/tools/md-enhanced/MdEnhanced.ts` connect `MdEnhanced Tool (markdown render)` to `Community 32`, `Card Components + GitHub Stats`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **What connects `name`, `type`, `version` to the rest of the system?**
  _177 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Content Types + AdminSavePlugin Dispatch` be split into smaller, more focused modules?**
  _Cohesion score 0.0707070707070707 - nodes in this community are weakly interconnected._
- **Should `Config KV-with-Fallback Chain` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Card Components + GitHub Stats` be split into smaller, more focused modules?**
  _Cohesion score 0.08571428571428572 - nodes in this community are weakly interconnected._