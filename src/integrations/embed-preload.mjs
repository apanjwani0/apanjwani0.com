/**
 * Gives the server the hashed URL of each embed's JavaScript chunk, so a page
 * can name it in the head as `<link rel="modulepreload">`.
 *
 * Why this exists: Astro builds the server bundle first and the client bundle
 * second, so while the page code is being built the hash of
 * `/_astro/PokerTrainer.<hash>.js` does not exist yet. Vite's `?url` import
 * works for stylesheets (`embed-styles.ts`) because it hands back the built
 * file, but for a script it copies the raw `.ts` source. Without the URL the
 * browser learns about the game's code only after the page script has run, and
 * learns about that code's own imports only after the game has been parsed:
 * three requests in a row.
 *
 * How it works: `embed-styles.ts` holds one placeholder string, `TABLE_TOKEN`.
 * While the client bundle is written, a small plugin records which output file
 * holds each component under `src/components/games/`. When the build is done,
 * the placeholder in the server files is replaced by `path=url;path=url;…`.
 * The format has no quotes or backslashes, so it survives whichever string
 * quoting the bundler chose. In `astro dev` nothing replaces it, and the helper
 * reads an unreplaced placeholder as "no preloads".
 *
 * Assumes `output: 'server'` and an adapter that writes server files under
 * `dist/server/`. A different layout finds no placeholder and fails the build
 * rather than silently shipping pages without preloads.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/** Must equal `TABLE_TOKEN` in src/lib/embed-styles.ts; security:smoke asserts it. */
const TABLE_TOKEN = '@@embed-chunks@@'
const COMPONENTS = 'src/components/games/'

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else yield full
  }
}

export default function embedPreload() {
  /** Source path under src/ (components/games/x/X.ts) to its output URL. */
  const chunks = new Map()
  let root = ''
  let outDir = ''
  let base = '/'

  return {
    name: 'embed-preload',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({
          vite: {
            plugins: [{
              name: 'embed-preload-collect',
              apply: 'build',
              generateBundle(_options, bundle) {
                for (const item of Object.values(bundle)) {
                  if (item.type !== 'chunk') continue
                  // The chunk that holds the module, not only a chunk it is the
                  // entry of: a game the page script also imports sits in a shared
                  // chunk with no entry module of its own.
                  for (const id of item.moduleIds ?? Object.keys(item.modules ?? {})) {
                    const file = id.split('?')[0].split(path.sep).join('/')
                    const at = file.lastIndexOf(COMPONENTS)
                    if (at === -1) continue
                    const inside = file.slice(at + COMPONENTS.length)
                    // `<game>/<Component>.ts`: the controllers, which are named in
                    // PascalCase. Their engines and helpers (lower case, deeper) are
                    // not mounted by name and would only bloat the table.
                    if (/^[a-z0-9-]+\/[A-Z][A-Za-z0-9]*\.ts$/.test(inside)) chunks.set(`components/games/${inside}`, item.fileName)
                  }
                }
              },
            }],
          },
        })
      },
      'astro:config:done': ({ config }) => {
        root = fileURLToPath(config.root)
        outDir = fileURLToPath(config.outDir)
        base = config.base.endsWith('/') ? config.base : `${config.base}/`
      },
      'astro:build:done': async () => {
        const table = [...chunks].map(([source, file]) => `${source}=${base}${file}`).join(';')
        if (!table) throw new Error('embed-preload: the client build produced no embed chunks to preload.')
        let replaced = 0
        for await (const file of walk(path.join(outDir, 'server'))) {
          if (!/\.(mjs|js)$/.test(file)) continue
          const text = await readFile(file, 'utf8')
          if (!text.includes(TABLE_TOKEN)) continue
          await writeFile(file, text.replaceAll(TABLE_TOKEN, table))
          replaced++
        }
        if (replaced === 0) {
          throw new Error(`embed-preload: no server file under ${path.relative(root, outDir)}/server contains ${TABLE_TOKEN}, so no page would preload its embed.`)
        }
      },
    },
  }
}
