// Usage: node scripts/shot.mjs <url> <out.png> [jsToEvalAfterLoad]
// Loads the page in headless Chromium, waits for the game, saves a screenshot,
// and prints any console errors.
import { chromium } from 'playwright';

const [url = 'https://localhost:8081/', out = 'artifacts/shot.png', extra = ''] = process.argv.slice(2);
const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.lumenwright, null, { timeout: 30000 });
await page.waitForTimeout(2500);
if (extra) { await page.evaluate(extra); await page.waitForTimeout(1500); }
await page.screenshot({ path: out });
console.log(JSON.stringify({ out, errors }, null, 1));
await browser.close();
