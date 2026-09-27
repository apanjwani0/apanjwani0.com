// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
// To deploy to Cloudflare Workers instead, swap the two lines below:
// import cloudflare from '@astrojs/cloudflare';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** @param {unknown} data */
function generateSite(data) {
  return `export const site = ${JSON.stringify(data, null, 2)} as const\n`
}

/** @param {unknown} data */
function generateProjects(data) {
  return `export interface Project {
  title: string
  url: string
  description: string
  tags: string[]
  keywords?: string
}

export const projects: Project[] = ${JSON.stringify(data, null, 2)}\n`
}

/** @param {unknown} data */
function generateExperience(data) {
  return `export interface Role {
  title: string
  team?: string
  period: string
  bullets: string[]
}

export interface Company {
  name: string
  roles: Role[]
}

export const experience: Company[] = ${JSON.stringify(data, null, 2)}\n`
}

/** @param {unknown} data */
function generateBlogs(data) {
  return `export interface Post {
  title: string
  href: string
  date: string
  summary: string
  content?: string
  keywords?: string
}

export const posts: Post[] = ${JSON.stringify(data, null, 2)}\n`
}

/** @param {unknown} data */
function generateGames(data) {
  return `export interface Game {
  slug: string
  title: string
  description: string
  enabled: boolean
  seoTitle?: string
  metaDescription?: string
  intro?: string
  seoContent?: string
  keywords?: string
  /** true = ships a playable in-browser component; false/undefined = "coming soon" placeholder */
  interactive?: boolean
}

export const games: Game[] = ${JSON.stringify(data, null, 2)}\n`
}

/** @param {unknown} data */
function generateTools(data) {
  return `export type ToolStatus = 'live' | 'wip' | 'external' | 'disabled'

export interface Tool {
  slug: string
  title: string
  description: string
  status: ToolStatus
  href?: string  // required when status === 'external'
  seoTitle?: string
  metaDescription?: string
  intro?: string
  seoContent?: string
  /** Comma-separated search terms — feeds the page <meta name="keywords"> and the
      WebApplication JSON-LD, matching how games carry keywords. */
  keywords?: string
}

export const tools: Tool[] = ${JSON.stringify(data, null, 2)}\n`
}

/** @param {unknown} data */
function generateLearnings(data) {
  return `/**
 * Learnings — the long-form section.
 *
 * A learning is a blog post that can mount a live component. \`embed\` names a key
 * in GAME_TAGS (src/lib/games.ts), and the article page mounts that component
 * inline through the same dispatch the games route uses.
 *
 * Separate from \`blogs\` on purpose. Blogs are personal and occasional; these are
 * written to be found, so they carry their own keywords, share cards and
 * indexing predicate (isPublishedLearning, src/lib/learnings.ts).
 */

export interface Learning {
  slug: string
  title: string
  /** Shown on the hub and as the meta description when \`metaDescription\` is unset. */
  summary: string
  date: string
  /** Markdown. Rendered through src/lib/markdown.ts — never handed to set:html raw. */
  content: string
  /**
   * A GAME_TAGS key. Mounts that component inline, below the intro.
   * Unknown or absent → the article renders as prose, which is a valid article.
   */
  embed?: string
  /** Caption under the embed, explaining what the reader is looking at. */
  embedCaption?: string
  /** Draft when false: no page, no sitemap entry, no card. See isPublishedLearning(). */
  published: boolean
  seoTitle?: string
  metaDescription?: string
  keywords?: string
}

export const learnings: Learning[] = ${JSON.stringify(data, null, 2)}\n`
}

/** @type {import('vite').Plugin} */
const adminSavePlugin = {
  name: 'admin-save',
  configureServer(server) {
    const maxBodyBytes = 1_000_000

    server.middlewares.use('/api/admin/save', (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }

      const remote = req.socket.remoteAddress ?? ''
      const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
      const origin = req.headers.origin
      let isSameOrigin = !origin
      if (origin) {
        try {
          isSameOrigin = new URL(origin).host === req.headers.host
        } catch {
          isSameOrigin = false
        }
      }
      if (!isLoopback || !isSameOrigin) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Local same-origin requests only.' }))
        return
      }

      let body = ''
      let bodyBytes = 0
      let bodyTooLarge = false
      req.on('data', chunk => {
        if (bodyTooLarge) return
        bodyBytes += chunk.length
        if (bodyBytes > maxBodyBytes) {
          body = ''
          bodyTooLarge = true
          return
        }
        body += chunk
      })
      req.on('end', async () => {
        if (bodyTooLarge) {
          res.writeHead(413, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Request body is too large.' }))
          return
        }
        try {
          const { type, data } = JSON.parse(body)
          let content, filename
          switch (type) {
            case 'site':
              content = generateSite(data)
              filename = 'site.ts'
              break
            case 'projects':
              content = generateProjects(data)
              filename = 'projects.ts'
              break
            case 'experience':
              content = generateExperience(data)
              filename = 'experience.ts'
              break
            case 'blogs':
              content = generateBlogs(data)
              filename = 'blogs.ts'
              break
            case 'games':
              content = generateGames(data)
              filename = 'games.ts'
              break
            case 'tools':
              content = generateTools(data)
              filename = 'tools.ts'
              break
            case 'learnings':
              content = generateLearnings(data)
              filename = 'learnings.ts'
              break
            default:
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: `Unknown type: ${type}` }))
              return
          }
          const filePath = join(process.cwd(), 'src', 'config', filename)
          await writeFile(filePath, content, 'utf-8')
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
        }
      })
    })
  }
}

// Adapter is the ONLY deployment-specific line — swap here, nowhere else.
// Node (Docker/Pi/VPS): node({ mode: 'standalone' })
// Cloudflare Workers:   cloudflare()
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  // Astro's default CSRF guard (security.checkOrigin) rejects cross-origin form
  // POSTs. That is incompatible with the Webhook Inspector's capture endpoint
  // (/api/hook/*), which exists precisely to receive requests from arbitrary
  // external senders — including form-encoded webhooks (Twilio, Slack slash
  // commands) that carry no matching Origin header. checkOrigin cannot be scoped
  // to one route, so it is disabled here; CSRF on state-changing surfaces is
  // covered by stronger, explicit controls instead: the __admin_session cookie
  // is HttpOnly + SameSite=Strict (never sent cross-site), admin login requires
  // ADMIN_SECRET, and the analytics + webhook-clear endpoints call the shared
  // isSameOrigin() in src/lib/security.ts (asserted by security-smoke). Every
  // NEW state-changing endpoint must call it too — nothing global backstops it.
  security: { checkOrigin: false },
  devToolbar: { enabled: false },
  vite: {
    plugins: [adminSavePlugin],
  },
});
