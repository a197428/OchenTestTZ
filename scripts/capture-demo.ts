import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = process.env.DEMO_URL ?? 'http://localhost:5173/';
const docs = path.join(projectRoot, 'docs');
mkdirSync(docs, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const frames: string[] = [];

async function shot(name: string): Promise<void> {
  const file = path.join(docs, `demo-${name}.png`);
  await page.screenshot({ path: file });
  frames.push(file);
}

await page.goto(baseUrl);
await page.locator('[data-object="book"]').waitFor({ state: 'visible' });
await shot('1-empty');

for (const objectId of ['book', 'phone', 'lamp']) {
  await page.locator(`[data-object="${objectId}"]`).click();
  await page.waitForTimeout(250);
}
await shot('2-scene');

await page.locator('[data-palette="teal"]').click();
await page.waitForTimeout(250);
await shot('3-recolor');

await page.locator('[data-action="load-palette"]').click();
await page.getByTestId('palette-input').fill('#D7CDF5 #AA9BF0 #7864D7 #F9ECB0 #F9A3AA #FFE3E1');
await page.locator('[data-action="parse-palette"]').click();
await page.waitForTimeout(200);
await shot('4-palette-dialog');
await page.mouse.click(8, 8);
await page.getByTestId('palette-dialog').waitFor({ state: 'detached' });
console.log('dialog closed');

await page.getByTestId('meaning-input').fill('обучение');
await page.locator('[data-action="compose-meaning"]').click();
await page.getByTestId('meaning-result').waitFor({ state: 'visible', timeout: 15000 });
await page.waitForTimeout(250);
console.log('intent result visible');
await shot('5-intent');

await browser.close();

execFileSync('convert', [
  '-delay',
  '110',
  '-loop',
  '0',
  ...frames,
  '-resize',
  '1200x',
  path.join(docs, 'demo.gif'),
]);
console.log(`wrote ${frames.length} screenshots and docs/demo.gif`);
