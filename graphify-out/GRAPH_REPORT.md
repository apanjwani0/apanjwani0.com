# Graph Report - portfolio-apanjwani0  (2026-06-13)

## Corpus Check
- 54 files · ~29,341 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 385 nodes · 565 edges · 26 communities (21 shown, 5 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `61b95267`
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

## God Nodes (most connected - your core abstractions)
1. `../../components/tools/pattern-forge/PatternForge.ts` - 23 edges
2. `$()` - 21 edges
3. `../../layouts/Base.astro` - 17 edges
4. `getSite()` - 14 edges
5. `adminSavePlugin` - 11 edges
6. `MdEnhancedTool` - 11 edges
7. `PatternForgeTool` - 11 edges
8. `getPosts()` - 10 edges
9. `getGames()` - 10 edges
10. `MdEnhancedTool (custom element)` - 10 edges

## Surprising Connections (you probably didn't know these)
- `tools/index.astro tools listing` --references--> `../../layouts/Base.astro`  [EXTRACTED]
  src/pages/tools/index.astro → src/layouts/Base.astro
- `MdEnhancedTool (custom element)` --conceptually_related_to--> `starterTemplate`  [INFERRED]
  src/components/tools/md-enhanced/MdEnhanced.ts → src/components/tools/md-enhanced/templates.ts
- `MdEnhancedTool (custom element)` --conceptually_related_to--> `toggleExtension (marked >+ syntax)`  [INFERRED]
  src/components/tools/md-enhanced/MdEnhanced.ts → src/components/tools/md-enhanced/toggle-extension.ts
- `ToolBase.astro (tools layout)` --semantically_similar_to--> `Base.astro (default layout)`  [INFERRED] [semantically similar]
  src/layouts/ToolBase.astro → src/layouts/Base.astro
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

## Communities (26 total, 5 thin omitted)

### Community 0 - "Content Types + AdminSavePlugin Dispatch"
Cohesion: 0.07
Nodes (39): adminSavePlugin, ExperienceItem Props, Post, Post (interface), posts, Company, Company (interface), experience (+31 more)

### Community 1 - "Dynamic [slug] Routes + SEO ld+json"
Cohesion: 0.07
Nodes (35): ldJson, post, ../components/Avatar.astro, ../components/ExperienceItem.astro, ../components/Head.astro, ../components/Nav.astro, ../components/ProjectCard.astro, ProjectCard Props (+27 more)

### Community 2 - "Config KV-with-Fallback Chain"
Cohesion: 0.18
Nodes (14): ClientRouter (view transitions), Head Props (SEO meta), Base.astro (default layout), ToolBase.astro (tools layout), getGames(), getPosts(), getSite(), blogs/[slug].astro post detail page (+6 more)

### Community 3 - "Admin UI + Save API + Tools Config"
Cohesion: 0.07
Nodes (32): POST(), POST /api/admin/login, POST(), POST /api/admin/logout, admin save allowed types whitelist, POST(), POST /api/admin/save, __admin_session HttpOnly cookie (+24 more)

### Community 4 - "Card Components + GitHub Stats"
Cohesion: 0.27
Nodes (7): buildResult(), CACHE_PATH, getProjectStats(), memCache, readCache(), StatsCache, writeCache()

### Community 6 - "MdEnhanced Export Pipeline (PDF/Image)"
Cohesion: 0.13
Nodes (13): DOMPurify library, exportImage() (html2canvas), exportPdf(), handleExport(), HelpEntry interface, HelpSection interface, helpSections const, marked library (+5 more)

### Community 7 - "Admin API Route Handlers (login/logout/save)"
Cohesion: 0.09
Nodes (21): ../../components/tools/pattern-forge/PatternForge.ts, decodeState(), encodeState(), GENERATORS, makeNoise(), mulberry32(), paint(), Palette (+13 more)

### Community 8 - "astro.config.mjs Plugin Generators"
Cohesion: 0.09
Nodes (11): Admin Config Management, `/antigravity <task>`, `/browser-debug [url] [what to check]`, Configuration, Design System, `/frontent-design`, Key Conventions, Skills & Commands (+3 more)

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
Cohesion: 0.11
Nodes (18): devDependencies, @astrojs/check, @types/dompurify, @types/node, typescript, engines, node, name (+10 more)

### Community 19 - "Community 19"
Cohesion: 0.13
Nodes (13): HelpEntry, HelpSection, helpSections, ../../components/tools/md-enhanced/MdEnhanced.ts, toggleExtension, dependencies, astro, @astrojs/cloudflare (+5 more)

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

## Knowledge Gaps
- **129 isolated node(s):** `name`, `type`, `version`, `node`, `dev` (+124 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `../../components/tools/pattern-forge/PatternForge.ts` connect `Admin API Route Handlers (login/logout/save)` to `Admin UI + Save API + Tools Config`?**
  _High betweenness centrality (0.118) - this node is a cross-community bridge._
- **Why does `../../components/tools/md-enhanced/MdEnhanced.ts` connect `Community 19` to `Admin UI + Save API + Tools Config`, `MdEnhanced Tool (markdown render)`?**
  _High betweenness centrality (0.092) - this node is a cross-community bridge._
- **What connects `name`, `type`, `version` to the rest of the system?**
  _129 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Content Types + AdminSavePlugin Dispatch` be split into smaller, more focused modules?**
  _Cohesion score 0.06763285024154589 - nodes in this community are weakly interconnected._
- **Should `Dynamic [slug] Routes + SEO ld+json` be split into smaller, more focused modules?**
  _Cohesion score 0.06745098039215686 - nodes in this community are weakly interconnected._
- **Should `Admin UI + Save API + Tools Config` be split into smaller, more focused modules?**
  _Cohesion score 0.07317073170731707 - nodes in this community are weakly interconnected._
- **Should `MdEnhanced Export Pipeline (PDF/Image)` be split into smaller, more focused modules?**
  _Cohesion score 0.1323529411764706 - nodes in this community are weakly interconnected._