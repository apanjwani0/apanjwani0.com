import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const srcPath = path.join(dir, 'hero-lab.html');
const testPath = path.join(dir, '_test.html');

const src = readFileSync(srcPath, 'utf-8');
writeFileSync(testPath, '<!doctype html>\n<meta charset="utf-8">\n' + src);

const browser = await chromium.launch();
const viewports = [
  { name: 'd', width: 1440, height: 900 },
  { name: 'm', width: 390, height: 844 },
];
const concepts = ['constellation', 'starborn', 'terminal'];

let anyErrors = false;

for (const vp of viewports) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));

  await page.goto('file://' + testPath);
  await page.waitForTimeout(600);

  for (const concept of concepts) {
    await page.click('#seg-' + concept);
    await page.waitForTimeout(2500);

    const overflow = await page.evaluate(() => {
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
      };
    });
    const hasOverflow = overflow.scrollWidth > overflow.clientWidth + 1;
    console.log(
      `[${vp.name}/${concept}] scrollWidth=${overflow.scrollWidth} clientWidth=${overflow.clientWidth} overflow=${hasOverflow}`
    );
    if (hasOverflow) anyErrors = true;

    const shotPath = path.join(dir, `${concept}-${vp.name}.png`);
    await page.screenshot({ path: shotPath });
    console.log('saved', shotPath);
  }

  if (errors.length) {
    anyErrors = true;
    console.log(`--- console/page errors for viewport ${vp.name} ---`);
    for (const e of errors) console.log(e);
  } else {
    console.log(`[${vp.name}] no console/page errors`);
  }

  await context.close();
}

await browser.close();
process.exit(anyErrors ? 1 : 0);
