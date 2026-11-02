import { EMBED_STYLES } from './embeds'

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
