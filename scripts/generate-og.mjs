/**
 * Generates the 1200×630 social share card for every tool and game.
 *
 * WHY THIS EXISTS: every page used to share as the 320×468 portrait avatar, so a
 * link to any tool unfurled on Slack/X/LinkedIn as a photo of a person with no
 * indication of what the link was. These cards make each tool look like the
 * product it is.
 *
 * WHY IT IS A SCRIPT AND NOT A ROUTE: rendering PNGs on demand needs satori +
 * resvg (two dependencies, native binaries, an Alpine/musl build risk in the
 * Docker image) and burns CPU and memory per request on a 1 GB box. Generating
 * once and committing the PNGs makes them ordinary static assets — zero runtime
 * cost, cached at the edge like any image, and nothing new in package.json.
 * Headless Chrome does the rasterising and is already on the machine; it is
 * never needed in CI or production.
 *
 *   npm run og            # regenerate all cards
 *
 * Re-run after adding a tool/game or changing one's title/description. Cards are
 * committed, so forgetting means the new page falls back to the avatar rather
 * than 404ing — degraded, not broken.
 *
 * ponytail: shells out to Chrome one page at a time; parallelise only if the
 * catalogue grows enough that ~25s becomes annoying.
 */
import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { tools } from '../src/config/tools.ts'
import { games } from '../src/config/games.ts'

const run = promisify(execFile)

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const WIDTH = 1200
const HEIGHT = 630
const OUT_DIR = join(process.cwd(), 'public', 'og')
const TMP_DIR = join(process.cwd(), '.og-tmp')

/** Escape for HTML text nodes — titles and descriptions are authored content and
 *  can legitimately contain &, <, quotes. */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Deterministic star field, seeded off the slug so each card differs but any
 * given card is identical on every regeneration (a diff should be empty unless
 * the copy actually changed).
 */
function stars(seed) {
  let h = 2166136261
  for (const ch of seed) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  const next = () => {
    h ^= h << 13; h >>>= 0
    h ^= h >> 17
    h ^= h << 5; h >>>= 0
    return h / 4294967296
  }
  const out = []
  for (let i = 0; i < 110; i += 1) {
    const x = (next() * WIDTH).toFixed(1)
    const y = (next() * HEIGHT).toFixed(1)
    const r = (next() * 1.5 + 0.4).toFixed(2)
    const o = (next() * 0.5 + 0.12).toFixed(2)
    out.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="#dfe6f5" opacity="${o}"/>`)
  }
  return out.join('')
}

/** Card markup. Colours are the site's own theme tokens (theme.css dark block)
 *  written literally — this file is rendered by Chrome outside the app, so it
 *  cannot read the stylesheet's custom properties. */
function cardHtml({ label, title, description, slug }) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:${WIDTH}px;height:${HEIGHT}px;background:#05070c;overflow:hidden;position:relative;
       font-family:'Source Serif 4',Georgia,serif;color:#e8ecf5}
  svg.sky{position:absolute;inset:0}
  .glow{position:absolute;width:900px;height:900px;left:-220px;top:-460px;border-radius:50%;
        background:radial-gradient(circle,rgba(120,150,220,0.13) 0%,rgba(5,7,12,0) 68%)}
  .wrap{position:relative;height:100%;padding:74px 80px;display:flex;flex-direction:column}
  .label{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:20px;letter-spacing:.22em;
         text-transform:uppercase;color:#8fa3c8}
  .mid{flex:1;display:flex;flex-direction:column;justify-content:center;padding-bottom:26px}
  h1{font-size:76px;line-height:1.06;font-weight:600;letter-spacing:-.015em;max-width:16ch}
  p{margin-top:26px;font-size:31px;line-height:1.42;color:#aab4c8;max-width:30ch}
  .foot{display:flex;align-items:center;gap:14px;font-family:'JetBrains Mono',ui-monospace,monospace;
        font-size:22px;color:#8fa3c8}
  .dot{width:7px;height:7px;border-radius:50%;background:#5c7fd0}
</style></head>
<body>
  <svg class="sky" width="${WIDTH}" height="${HEIGHT}">${stars(slug)}</svg>
  <div class="glow"></div>
  <div class="wrap">
    <div class="label">${esc(label)}</div>
    <div class="mid">
      <h1>${esc(title)}</h1>
      <p>${esc(description)}</p>
    </div>
    <div class="foot"><span class="dot"></span><span>apanjwani0.com</span></div>
  </div>
</body></html>`
}

/**
 * Trim a description to what fits the card at 31px.
 *
 * Breaks on the strongest boundary available rather than the nearest one: ending
 * mid-clause ("…runs on simple per-cell…") reads as a truncation bug, while
 * ending on a sentence reads as deliberate copy. Only falls back to a bare word
 * break when there is no punctuation in the usable range.
 */
function shorten(text, max = 118) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)

  const sentence = cut.lastIndexOf('. ')
  if (sentence > max * 0.5) return cut.slice(0, sentence + 1)

  const clause = Math.max(cut.lastIndexOf(' — '), cut.lastIndexOf(', '))
  if (clause > max * 0.5) return `${cut.slice(0, clause)}…`

  return `${cut.slice(0, cut.lastIndexOf(' '))}…`
}

async function main() {
  const items = [
    ...tools
      .filter(t => t.status !== 'external' && t.status !== 'disabled')
      .map(t => ({ kind: 'tools', slug: t.slug, label: 'Tool', title: t.title, description: t.description })),
    ...games
      .filter(g => g.enabled && g.interactive)
      .map(g => ({ kind: 'games', slug: g.slug, label: 'Game', title: g.title, description: g.description })),
  ]

  await mkdir(OUT_DIR, { recursive: true })
  await mkdir(TMP_DIR, { recursive: true })

  console.log(`Rendering ${items.length} cards at ${WIDTH}×${HEIGHT}…`)
  for (const item of items) {
    const name = `${item.kind}-${item.slug}`
    const htmlPath = join(TMP_DIR, `${name}.html`)
    const pngPath = join(OUT_DIR, `${name}.png`)
    await writeFile(htmlPath, cardHtml({ ...item, description: shorten(item.description) }), 'utf-8')
    await run(CHROME, [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      // Give webfonts time to arrive; without it the card rasterises in the
      // fallback serif and every card looks subtly wrong.
      '--virtual-time-budget=3000',
      `--window-size=${WIDTH},${HEIGHT}`,
      `--screenshot=${pngPath}`,
      `file://${htmlPath}`,
    ])
    console.log(`  ✓ public/og/${name}.png  ${item.title}`)
  }

  await rm(TMP_DIR, { recursive: true, force: true })
  console.log(`\nDone — ${items.length} cards in public/og/. Commit them.`)
}

main().catch(err => {
  console.error('\nFailed to generate cards.')
  console.error('Needs Google Chrome at:', CHROME)
  console.error(err.message)
  process.exit(1)
})
