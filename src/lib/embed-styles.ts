import { EMBED_MODULES, EMBED_STYLES } from './embeds'

/**
 * Every stylesheet an embed can name, as the hashed URL Vite emits for it.
 *
 * `?url` hands back a built, minified file without adding it to the page, which
 * is the point: a static `import '….css'` puts that CSS in the page's
 * render-blocking bundle whether or not the component renders (Astro bundles
 * the CSS of every module a page can reach). The tool route does the same for
 * `src/components/tools/*`. The glob only emits the files; a page links the ones
 * `EMBED_STYLES` names for its own component.
 */
const SHEETS = import.meta.glob<string>(
  ['../components/games/*.css', '../components/games/*/*.css', '../styles/canvas-export.css'],
  { query: '?url', import: 'default', eager: true },
)

/**
 * The stylesheet URLs for the component a page mounts, in cascade order. Empty
 * for a slug with no component. Link them with `<link slot="head">`.
 */
export function embedStyles(slug: string | undefined): string[] {
  if (!slug || !Object.hasOwn(EMBED_STYLES, slug)) return []
  return EMBED_STYLES[slug].map(file => {
    const url = SHEETS[`../${file}`]
    if (!url) throw new Error(`EMBED_STYLES names a stylesheet that does not exist: ${file}`)
    return url
  })
}

/**
 * Replaced after the client build by `src/integrations/embed-preload.mjs` with
 * `source path=url;source path=url;…` (one pair per embed chunk). Unreplaced in
 * `astro dev`, where there is no built chunk to point at. It stays a plain
 * string literal on purpose: the replacement is a text substitution in the
 * server files, so it cannot be built up at run time.
 */
const TABLE_TOKEN = '@@embed-chunks@@'

let table: Map<string, string> | undefined

function chunkTable(): Map<string, string> {
  if (table) return table
  table = new Map()
  // An unreplaced token has no `=`, so it yields no pairs.
  for (const pair of TABLE_TOKEN.split(';')) {
    const at = pair.indexOf('=')
    if (at > 0) table.set(pair.slice(0, at), pair.slice(at + 1))
  }
  return table
}

/**
 * The built script URL for the component a page mounts, as a one-item list to
 * map over (empty for a slug with no component, or while developing). Link it
 * with `<link slot="head" rel="modulepreload">` beside the stylesheets, so the
 * browser fetches the game's code, and the modules it imports, while it parses
 * the page rather than after the page script has run.
 */
export function embedPreloads(slug: string | undefined): string[] {
  if (!slug || !Object.hasOwn(EMBED_MODULES, slug)) return []
  const url = chunkTable().get(EMBED_MODULES[slug])
  return url ? [url] : []
}
