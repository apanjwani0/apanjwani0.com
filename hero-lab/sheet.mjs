// node sheet.mjs out.png cols a.png b.png ...  (each tile 720px wide, labelled by file name)
import { execSync } from 'node:child_process'
import { join, basename } from 'node:path'
import { readFileSync } from 'node:fs'
const { chromium } = await import(join(execSync('npm root -g').toString().trim(), 'playwright/index.mjs'))
const [out, cols, ...files] = process.argv.slice(2)
const cw = Math.floor(1440 / +cols)
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1448, height: 300 } })
await p.setContent('<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(' + cols + ',' + cw + 'px);gap:4px;font:13px monospace;color:#eee">' +
  files.map((f) => `<div><img style="width:${cw}px;display:block" src="data:image/png;base64,${readFileSync(f).toString('base64')}"><div style="padding:2px 6px">${basename(f)}</div></div>`).join('') + '</body>')
await p.waitForTimeout(300); await p.screenshot({ path: out, fullPage: true }); await b.close()
