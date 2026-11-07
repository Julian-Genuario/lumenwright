// Desktop fallback check: solve board 1 with two mouse clicks, press Next,
// then slide the rail piece on board 10 by dragging.
// Usage: node scripts/mouse-test.mjs [url]
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'https://localhost:4173/';
const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => window.lumenwright, null, { timeout: 30000 });
await page.evaluate(() => {
  const g = window.lumenwright.game;
  g.progress.done.fill(false);
  g.loadLevel(0);
  document.getElementById('card').hidden = true;
});
await page.waitForTimeout(1200);

const screenOf = (expr) =>
  page.evaluate((expr) => {
    const { world, game } = window.lumenwright;
    const v = world.camera.position.clone();
    // eslint-disable-next-line no-eval
    eval(expr);
    v.project(world.camera);
    return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight];
  }, expr);

const check = (label, v) => {
  console.log(`${v ? 'PASS' : 'FAIL'} ${label}`);
  if (!v) process.exitCode = 1;
};

const [mx, my] = await screenOf('game.view.gripPoint(1, v); v.y -= 0.02;');
await page.mouse.click(mx, my);
await page.waitForTimeout(200);
await page.mouse.click(mx, my);
await page.waitForTimeout(400);
check('board 1 solved with two clicks', await page.evaluate(() => window.lumenwright.game.solved));

const [nx, ny] = await screenOf("const b = game.view.buttons.find((x) => x.id === 'next'); game.view.buttonTopWorld(b, v);");
await page.mouse.click(nx, ny);
await page.waitForTimeout(400);
check('Next button loads board 2', await page.evaluate(() => window.lumenwright.game.levelIndex === 1));

await page.evaluate(() => window.lumenwright.game.loadLevel(9));
await page.waitForTimeout(1200);
const [px, py] = await screenOf('game.view.gripPoint(1, v); v.y -= 0.02;');
const [tx, ty] = await screenOf('game.view.cellToLocal(3, 3, v); game.view.root.localToWorld(v);');
await page.mouse.move(px, py);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(px + ((tx - px) * i) / 10, py + ((ty - py) * i) / 10);
await page.mouse.up();
await page.waitForTimeout(400);
check('board 10 solved by dragging along the rail', await page.evaluate(() => window.lumenwright.game.solved));
const info = await page.evaluate(() => window.lumenwright.world.renderer.info.render);
console.log('draw calls per frame:', info.calls, 'triangles:', info.triangles);
console.log(JSON.stringify({ errors }));
await browser.close();
