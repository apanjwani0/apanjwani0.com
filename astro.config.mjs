// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
// To deploy to Cloudflare Workers instead, swap the two lines below:
// import cloudflare from '@astrojs/cloudflare';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function generateSite(data) {
  return `export const site = ${JSON.stringify(data, null, 2)} as const\n`
}

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

function generateGames(data) {
  return `export interface Game {
  slug: string
  title: string
  description: string
  enabled: boolean
  keywords?: string
}

export const games: Game[] = ${JSON.stringify(data, null, 2)}\n`
}

/** @type {import('vite').Plugin} */
const adminSavePlugin = {
  name: 'admin-save',
  configureServer(server) {
    // Auth is intentionally skipped here — this middleware only runs in local dev
    // (npm run dev) and is never reachable from outside localhost. The production
    // auth check lives in src/pages/api/admin/save.ts.
    server.middlewares.use('/api/admin/save', (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', async () => {
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
  vite: {
    plugins: [adminSavePlugin],
  },
});
