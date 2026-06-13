# Graph Report - .  (2026-06-13)

## Corpus Check
- 60 files · ~25,585 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 252 nodes · 400 edges · 18 communities (13 shown, 5 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.8)
- Token cost: 126,122 input · 14,015 output

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

## God Nodes (most connected - your core abstractions)
1. `../../layouts/Base.astro` - 17 edges
2. `getSite()` - 14 edges
3. `adminSavePlugin` - 11 edges
4. `MdEnhancedTool` - 11 edges
5. `getPosts()` - 10 edges
6. `getGames()` - 10 edges
7. `MdEnhancedTool (custom element)` - 10 edges
8. `../components/ProjectCard.astro` - 9 edges
9. `getConfig()` - 9 edges
10. `AudioTranscriberTool` - 8 edges

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

## Communities (18 total, 5 thin omitted)

### Community 0 - "Content Types + AdminSavePlugin Dispatch"
Cohesion: 0.06
Nodes (30): adminSavePlugin, ExperienceItem Props, Post, Post (interface), posts, Company, Company (interface), experience (+22 more)

### Community 1 - "Dynamic [slug] Routes + SEO ld+json"
Cohesion: 0.10
Nodes (21): ldJson, post, ../components/Head.astro, ../components/Nav.astro, ../components/SocialLinks.astro, game, ldJson, ../../layouts/Base.astro (+13 more)

### Community 2 - "Config KV-with-Fallback Chain"
Cohesion: 0.14
Nodes (20): site, fromFile(), fromKV(), getConfig(), getExperience(), getGames(), getKV(), getPosts() (+12 more)

### Community 3 - "Admin UI + Save API + Tools Config"
Cohesion: 0.10
Nodes (23): POST /api/admin/login, POST /api/admin/logout, admin save allowed types whitelist, POST /api/admin/save, __admin_session HttpOnly cookie, Tool, Tool (interface), ToolStatus (type) (+15 more)

### Community 4 - "Card Components + GitHub Stats"
Cohesion: 0.12
Nodes (18): ../components/ExperienceItem.astro, ../components/ProjectCard.astro, ProjectCard Props, buildResult(), CACHE_PATH, getProjectStats(), GitHubStats, memCache (+10 more)

### Community 5 - "MdEnhanced Tool (markdown render)"
Cohesion: 0.15
Nodes (6): HelpEntry, HelpSection, helpSections, ../../components/tools/md-enhanced/MdEnhanced.ts, MdEnhancedTool, toggleExtension

### Community 6 - "MdEnhanced Export Pipeline (PDF/Image)"
Cohesion: 0.13
Nodes (13): DOMPurify library, exportImage() (html2canvas), exportPdf(), handleExport(), HelpEntry interface, HelpSection interface, helpSections const, marked library (+5 more)

### Community 7 - "Admin API Route Handlers (login/logout/save)"
Cohesion: 0.23
Nodes (9): POST(), POST(), POST(), logger, createSession(), deleteSession(), devSessions, generateToken() (+1 more)

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
Cohesion: 0.47
Nodes (4): ClientRouter (view transitions), Head Props (SEO meta), Base.astro (default layout), ToolBase.astro (tools layout)

### Community 13 - "Request Middleware (CSP + Admin No-Index Gate)"
Cohesion: 0.67
Nodes (3): Admin path no-store/noindex gate, CSP, onRequest

## Knowledge Gaps
- **69 isolated node(s):** `deploy-cloud.sh script`, `deploy-rpi.sh script`, `LANGUAGES`, `HelpEntry`, `HelpSection` (+64 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `../../components/tools/md-enhanced/MdEnhanced.ts` connect `MdEnhanced Tool (markdown render)` to `Admin UI + Save API + Tools Config`?**
  _High betweenness centrality (0.101) - this node is a cross-community bridge._
- **Why does `../../layouts/Base.astro` connect `Dynamic [slug] Routes + SEO ld+json` to `Config KV-with-Fallback Chain`, `Admin UI + Save API + Tools Config`, `Card Components + GitHub Stats`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `adminSavePlugin` (e.g. with `blogs.ts` and `experience.ts`) actually correct?**
  _`adminSavePlugin` has 5 INFERRED edges - model-reasoned connections that need verification._
- **What connects `deploy-cloud.sh script`, `deploy-rpi.sh script`, `LANGUAGES` to the rest of the system?**
  _69 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Content Types + AdminSavePlugin Dispatch` be split into smaller, more focused modules?**
  _Cohesion score 0.06218487394957983 - nodes in this community are weakly interconnected._
- **Should `Dynamic [slug] Routes + SEO ld+json` be split into smaller, more focused modules?**
  _Cohesion score 0.10344827586206896 - nodes in this community are weakly interconnected._
- **Should `Config KV-with-Fallback Chain` be split into smaller, more focused modules?**
  _Cohesion score 0.1402116402116402 - nodes in this community are weakly interconnected._