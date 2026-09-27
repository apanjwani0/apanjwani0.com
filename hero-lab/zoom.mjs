// node zoom.mjs <in.png> <x> <y> <w> <h> <scale> <out.png>
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
const { chromium } = await import(join(execSync('npm root -g').toString().trim(), 'playwright/index.mjs'))
const [src, x, y, w, h, s, out] = process.argv.slice(2)
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: w * s, height: h * s } })
await p.setContent(`<body style="margin:0;overflow:hidden;background:#000"><img src="data:image/png;base64,${readFileSync(src).toString('base64')}" style="image-rendering:pixelated;transform-origin:0 0;transform:scale(${s}) translate(${-x}px,${-y}px)"></body>`)
await p.waitForTimeout(300)
await p.screenshot({ path: out })
await b.close()
