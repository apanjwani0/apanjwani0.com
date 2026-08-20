/**
 * catalogue.gen.ts — renders the visual asset catalogue FROM the asset modules,
 * so the preview is never a stale copy: every asset has ONE definition (in
 * cards-svg.ts / assets-svg.ts) that the game and this sheet both pull from.
 * Change an asset there → re-run this → the catalogue updates. Dev tooling only
 * (uses node:fs, run via tsx — never bundled into the site):
 *
 *   npx tsx src/components/games/poker/ui/catalogue.gen.ts [out.html]
 */
import { writeFileSync } from 'node:fs'
import type { Suit } from '../engine/types'
import { cardSvg, cardBackSvg, suitSvg, CARD_BACKS } from './cards-svg'
import {
  chipSvg, CHIP_VALUES, chipStackSvg, buttonSvg, avatarSvg, AVATAR_COUNT,
  openSeatSvg, timerPieSvg, iconSvg, crownSvg, wordmarkSvg, REACTIONS,
} from './assets-svg'

const SUITS: { s: Suit; name: string }[] = [
  { s: 's', name: 'Spades' }, { s: 'h', name: 'Hearts' }, { s: 'd', name: 'Diamonds' }, { s: 'c', name: 'Clubs' },
]

const asset = (svg: string, name: string, px = 64, cls = '') =>
  `<div class="asset ${cls}"><div class="a-box" style="width:${px}px;height:${px}px">${svg}</div><span class="a-name">${name}</span></div>`

const deck = () => {
  const cols = SUITS.map(({ s, name }) => {
    let cells = `<h2>${name.toUpperCase()}</h2>`
    for (let r = 14; r >= 2; r--) cells += `<div class="card">${cardSvg({ r, s })}</div>`
    return `<div class="col">${cells}</div>`
  }).join('')
  return `<div class="grid4">${cols}</div>`
}

const section = (title: string, body: string) => `<div class="divider"></div><h2>${title}</h2>${body}`

const html = `<meta charset="utf-8">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body,.wrap{background:#0b0b0d}
  .wrap{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif;color:#eee;padding:22px 16px 60px;max-width:760px;margin:0 auto}
  h1{font-size:20px;font-weight:700;margin-bottom:4px}
  .sub{font-size:13px;color:#8a8a8f;line-height:1.5;margin-bottom:8px}
  code{background:#1a1a1e;padding:1px 5px;border-radius:4px;font-size:12px}
  h2{font-size:13px;font-weight:600;color:#9a9a9f;margin:24px 0 12px;letter-spacing:.02em}
  .divider{height:1px;background:#1c1c20;margin:26px 0}
  .grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
  .col{display:flex;flex-direction:column;gap:10px}
  .col h2{margin:0 0 4px;text-align:center}
  .card{width:100%;aspect-ratio:60/84}
  .card svg{display:block;width:100%;height:100%;filter:drop-shadow(0 4px 9px rgba(0,0,0,.55))}
  .assets{display:flex;gap:18px;flex-wrap:wrap;align-items:flex-end}
  .asset{display:flex;flex-direction:column;align-items:center;gap:7px}
  .a-box svg{display:block;width:100%;height:100%}
  .a-name{font-size:11px;color:#8a8a8f;font-variant-numeric:tabular-nums}
  .shadow svg{filter:drop-shadow(0 3px 7px rgba(0,0,0,.5))}
  .glyph{width:44px;height:44px;border-radius:50%;background:#161616;display:grid;place-items:center;color:#f2f2f2}
  .glyph svg{width:22px;height:22px}
  .react{font-size:30px;line-height:1}
  .backs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:16px}
  .bk{display:flex;flex-direction:column;align-items:center;gap:7px}
  .bk .card{width:100%}
  .bk-name{font-size:11px;color:#8a8a8f;text-transform:capitalize}
  .row{display:flex;align-items:flex-end;gap:20px;flex-wrap:wrap}
  .demo{display:flex;flex-direction:column;align-items:center;gap:6px}
  .demo .px{font-size:11px;color:#7a7a7f;font-variant-numeric:tabular-nums}
  .demo svg{display:block;filter:drop-shadow(0 5px 12px rgba(0,0,0,.55))}
  .brand svg{display:block;height:40px;width:auto}
</style>
<div class="wrap">
  <h1>Poker Together — asset catalogue</h1>
  <p class="sub">Generated from <code>cards-svg.ts</code> + <code>assets-svg.ts</code>. One definition per asset, referenced everywhere — change it there and the game and this sheet both update.</p>

  <h2>DECK — 52 faces (A → 2)</h2>
  ${deck()}

  ${section('SUIT PIPS — <code>suitSvg(suit)</code>', `<div class="assets">${SUITS.map(({ s, name }) => asset(suitSvg(s), name, 42)).join('')}</div>`)}
  ${section('CHIPS — <code>chipSvg(value)</code>', `<div class="assets">${CHIP_VALUES.map(v => asset(chipSvg(v), v >= 1000 ? v / 1000 + 'K' : '' + v, 64, 'shadow')).join('')}</div>`)}
  ${section('CHIP STACKS — <code>chipStackSvg(value)</code>', `<div class="assets">${[5, 25, 100, 500].map(v => asset(chipStackSvg(v as typeof CHIP_VALUES[number]), '' + v, 60, 'shadow')).join('')}</div>`)}
  ${section('DEALER &amp; BLIND BUTTONS — <code>buttonSvg(kind)</code>', `<div class="assets">${(['D', 'SB', 'BB'] as const).map(k => asset(buttonSvg(k), k, 60, 'shadow')).join('')}</div>`)}
  ${section('AVATARS &amp; OPEN SEAT — <code>avatarSvg(i)</code>, <code>openSeatSvg()</code>', `<div class="assets">${Array.from({ length: 6 }, (_, i) => asset(avatarSvg(i), '', 56, 'shadow')).join('')}${asset(openSeatSvg(), 'open', 56)}</div>`)}
  ${section('TURN TIMER — <code>timerPieSvg(pct)</code>', `<div class="assets">${[[1, '100%'], [0.66, '66%'], [0.33, '33%'], [0.1, '10%']].map(([p, l]) => asset(timerPieSvg(p as number), l as string, 50)).join('')}</div>`)}
  ${section('WINNER — <code>crownSvg()</code>', `<div class="assets">${asset(crownSvg(), 'crown', 56)}</div>`)}
  ${section('UI GLYPHS — <code>iconSvg(name)</code>', `<div class="assets">${(['back', 'raise', 'check', 'cancel', 'react'] as const).map(n => `<div class="asset"><div class="glyph">${iconSvg(n)}</div><span class="a-name">${n}</span></div>`).join('')}</div>`)}
  ${section('REACTIONS — <code>REACTIONS</code> (system emoji)', `<div class="assets">${REACTIONS.map(e => `<div class="asset"><div class="react">${e}</div></div>`).join('')}</div>`)}
  ${section('WORDMARK — <code>wordmarkSvg()</code>', `<div class="brand">${wordmarkSvg()}</div>`)}
  ${section('CARD BACKS — <code>cardBackSvg(id)</code>', `<div class="backs-grid">${CARD_BACKS.map(id => `<div class="bk"><div class="card">${cardBackSvg(id)}</div><span class="bk-name">${id}</span></div>`).join('')}</div>`)}
  ${section('SCALING — one A♠, sized by the container', `<div class="row">${[40, 64, 100, 150].map(px => `<div class="demo"><div style="width:${Math.round(px * 60 / 84)}px;height:${px}px">${cardSvg({ r: 14, s: 's' })}</div><span class="px">${px}px</span></div>`).join('')}</div>`)}
</div>
`

const out = process.argv[2] || 'poker-catalogue.html'
writeFileSync(out, html)
console.log(`✓ catalogue → ${out} (${AVATAR_COUNT} avatars, ${CARD_BACKS.length} backs, ${CHIP_VALUES.length} chips)`)
