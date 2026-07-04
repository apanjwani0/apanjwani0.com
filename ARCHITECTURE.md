# ARCHITECTURE.md

## Philosophy

Config-first, content-centered portfolio dashboard. The codebase is intentionally small — if something can be driven by `src/config/`, it should be. No component library bloat; Oat UI is built from source and vendored as flat CSS+JS files.

**Loose coupling principle**: infrastructure decisions (deployment adapter, hosting) must never bleed into application code. The single swap point for any infrastructure change is `astro.config.mjs` — nowhere else.

---

## Directory Structure

```
portfolio-apanjwani0/
├── src/
│   ├── config/              # All personal data lives here
│   │   ├── site.ts          # Global: name, bio, nav, social, feature flags
│   │   ├── projects.ts      # Project entries (title, url, description, tags)
│   │   ├── experience.ts    # Work history (role, company, period, bullets)
│   │   ├── blogs.ts         # Blog/writing entries
│   │   ├── games.ts         # Games index (game-of-life, type-trial, hue-hunt, …)
│   │   └── tools.ts         # Tools index (json-tidy, pattern-forge, md-enhanced, …)
│   │
│   ├── layouts/
│   │   ├── Base.astro       # Root HTML shell: Oat CSS/JS, meta, nav, footer
│   │   └── ToolBase.astro   # Detail-page shell
│   │
│   ├── components/
│   │   ├── Nav.astro        # Top navigation driven by site.nav
│   │   ├── Head.astro       # <head> meta + SEO/OG tags
│   │   ├── Avatar.astro / ProjectCard.astro / ExperienceItem.astro / SocialLinks.astro
│   │   ├── home/            # Home hero pieces (star canvas, …)
│   │   ├── tools/           # Tool WebComponents (json-tidy/, pattern-forge/, md-enhanced/, …)
│   │   └── games/           # Game WebComponents (game-of-life/, type-trial/, hue-hunt/)
│   │
│   ├── lib/
│   │   ├── config.ts        # KV-aware config accessors (always use these)
│   │   ├── session.ts       # Session create/validate/delete
│   │   ├── markdown.ts      # marked + dompurify render/sanitize
│   │   ├── jsonld.ts        # JSON-LD structured-data builders
│   │   └── github.ts        # GitHub data helper
│   │
│   ├── middleware.ts         # Security headers (CSP, HSTS, …) + Cache-Control on responses
│   │
│   ├── pages/
│   │   ├── index.astro      # Home: bio + highlights
│   │   ├── projects.astro / experience.astro / blogs.astro / games.astro
│   │   ├── [slug].astro     # Top-level dynamic page   ·   404.astro
│   │   ├── admin.astro      # Content editor (dev-open, IP-gated in prod)
│   │   ├── sitemap.xml.ts   # Dynamic sitemap (iterates getGames / getPosts / tools)
│   │   ├── blogs/[slug].astro   ·   games/[slug].astro
│   │   ├── tools/
│   │   │   ├── index.astro  # Tools index (prerender = true)
│   │   │   └── [slug].astro # Individual tool page
│   │   └── api/admin/       # login / logout (content saves via Vite middleware in astro.config.mjs)
│   │
│   └── styles/
│       ├── theme.css        # Design tokens — single source of truth (palette/fonts/scale/spacing)
│       ├── shared.css       # Base elements + header (shared by both layouts)
│       ├── global.css       # Content-page styles
│       ├── home.css         # Home hero
│       └── tools.css        # Tools index
│
├── public/
│   ├── oat.min.css          # Oat UI stylesheet (vendored)
│   ├── oat.min.js           # Oat UI scripts (vendored)
│   └── avatar.webp          # Profile image (gitignored — add your own)
│
├── scripts/
│   ├── deploy-cloud.sh      # Build multi-platform image + SSH deploy to VPS
│   └── deploy-rpi.sh        # Build arm64 image + deploy to Raspberry Pi
│
├── astro.config.mjs         # output: 'server', adapter config + dev save middleware
├── wrangler.jsonc            # Cloudflare Workers config (KV namespace IDs go here)
└── tsconfig.json
```

---

## Data Flow

```
src/config/*.ts
      │
      ▼
  Astro Pages  (SSR, server-rendered per request)
      │
      ▼
  Astro Components  (receive config as props)
      │
      ▼
  Oat UI HTML/CSS  (semantic tags auto-styled by oat.min.css)
      │
      ▼
  Browser  (oat.min.js activates any WebComponents)
```

No client-side data fetching on first render. SSR ensures all content is in the initial HTML.

---

## Config Schema (conceptual)

```ts
// src/config/site.ts
export const site = {
  name: string,
  tagline: string,
  bio: string,
  avatar: string,           // path in /public
  nav: { label: string; href: string }[],
  social: {
    github?: string,
    twitter?: string,
    linkedin?: string,
  },
  sections: {               // feature flags — hide sections you don't need
    projects: boolean,
    writing: boolean,
    experience: boolean,
  }
}
```

---

## Oat UI Integration

Oat is sourced from the fork **[apanjwani0/oat](https://github.com/apanjwani0/oat)** (based on `knadh/oat`). It is built locally via its `Makefile` and the output is **vendored** into `/public` — no npm install, no build-time dependency.

**Updating Oat:**
```bash
# From the cloned fork (adjust PORTFOLIO to your local repo path)
PORTFOLIO=../your-portfolio-repo
make         # produces dist/oat.min.css + dist/oat.min.js
cp dist/oat.min.css "$PORTFOLIO/public/"
cp dist/oat.min.js  "$PORTFOLIO/public/"
```

Any fixes to Oat's behavior go in the fork, not in portfolio-level CSS overrides.

Include in `Base.astro`:
```html
<link rel="stylesheet" href="/oat.min.css" />
<script src="/oat.min.js" defer></script>
```

Oat styles semantic HTML automatically. Conventions:
- Use `<nav>`, `<article>`, `<aside>`, `<header>`, `<footer>` for layout
- Use `role` and `data-*` attributes for component variants per Oat docs
- Avoid writing custom CSS classes for things Oat already handles

---

## SSR & Adapter

`astro.config.mjs` sets `output: 'server'`. The **adapter is the only deployment-specific line** in the entire codebase:

```js
// astro.config.mjs
import adapter from '@astrojs/node' // swap this line only — nothing else changes

export default defineConfig({
  output: 'server',
  adapter: adapter({ mode: 'standalone' }),
})
```

Rules:
- No adapter-specific APIs (e.g., Cloudflare KV, Vercel Edge Config) in page or component code
- If you need environment-specific behavior, abstract it behind a generic interface in `src/lib/`
- Static pages opt out individually: `export const prerender = true`

---

## Extensibility Points

| Feature | Where to add |
|---|---|
| CMS-backed blog | Replace `src/config/blogs.ts` with a server-side fetch in `blogs.astro` |
| Analytics | Add script tag in `Base.astro` |
| Contact form | New page `src/pages/contact.astro` with a server `POST` endpoint |
| RSS feed | `src/pages/rss.xml.ts` using Astro's RSS helper |
