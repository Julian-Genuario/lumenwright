// End-to-end hand-interaction check in the IWER emulator (needs the dev server).
// Enters XR, solves boards with emulated hands only, and pokes the buttons.
// Usage: node scripts/hand-test.mjs [https://localhost:8081/]
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const url = process.argv[2] ?? 'https://localhost:8081/';
const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => window.lumenwright && window.IWER_DEVICE, null, { timeout: 30000 });
await page.evaluate(() => {
  const g = window.lumenwright.game;
  g.progress.done.fill(false);
  g.loadLevel(0);
});
await page.click('#enter-vr');
await page.waitForFunction(() => !!window.lumenwright.world.session, null, { timeout: 15000 });
await page.addScriptTag({ content: readFileSync(new URL('./drive.js', import.meta.url), 'utf8') });
await page.evaluate(() => window.drive.setup());
await page.waitForTimeout(1200);

const check = (label, v) => {
  console.log(`${v ? 'PASS' : 'FAIL'} ${label}`);
  if (!v) process.exitCode = 1;
};

check('hands are tracked', await page.evaluate(() => window.lumenwright.game.hands.right.tracked && window.lumenwright.game.hands.left.tracked));

// Board 1: the mirror is piece 1; it needs 2 notches counter-clockwise.
await page.evaluate(() => window.drive.turnPiece('right', 1, 2));
await page.waitForTimeout(300);
check('board 1 solved by pinch + twist', await page.evaluate(() => window.lumenwright.game.solved));
await page.screenshot({ path: 'artifacts/hand-board1.png' });

await page.evaluate(() => window.drive.press('right', window.drive.buttonTop('next')));
await page.waitForTimeout(400);
check('poking Next loads board 2', await page.evaluate(() => window.lumenwright.game.levelIndex === 1));

// Board 2: mirror at (3,3) needs m=2, mirror at (3,0) needs m=6 (= -2).
await page.evaluate(() => window.drive.turnPiece('right', 1, 2));
await page.evaluate(() => window.drive.turnPiece('left', 2, -2));
await page.waitForTimeout(300);
check('board 2 solved with both hands', await page.evaluate(() => window.lumenwright.game.solved));

// Board 3 with a forearm roll (key turn) instead of a wrist yaw: a clockwise
// key turn worth 2 notches should turn the mirror clockwise (-2).
await page.evaluate(() => window.lumenwright.game.loadLevel(2));
await page.waitForTimeout(1200);
const rollResult = await page.evaluate(async () => {
  const d = window.drive;
  const g = d.pieceGrip(1);
  await d.grasp('right');
  await d.moveTo('right', g, 500);
  await d.pinch('right', 1);
  await d.wait(100);
  await d.twist('right', (2 * Math.PI) / 8 / 1.6, 500, 'roll');
  await d.wait(100);
  const turn = window.lumenwright.game.view.pieces[1].turn;
  await d.pinch('right', 0);
  await d.grasp('right');
  return turn;
});
check('forearm roll also turns a held mirror (turn = -2)', rollResult === -2);

// Rails (board 10).
await page.evaluate(() => window.lumenwright.game.loadLevel(9));
await page.waitForTimeout(1200);
await page.evaluate(() => window.drive.slidePiece('right', 1, 3, 3));
await page.waitForTimeout(300);
check('board 10 solved by sliding along the rail', await page.evaluate(() => window.lumenwright.game.solved));
await page.screenshot({ path: 'artifacts/hand-board10.png' });

await page.evaluate(() => window.drive.press('right', window.drive.buttonTop('reset')));
await page.waitForTimeout(300);
check(
  'poking Reset restores the board',
  await page.evaluate(() => !window.lumenwright.game.solved && window.lumenwright.game.pieces[1].x === 1),
);

console.log(JSON.stringify({ errors }, null, 1));
await browser.close();
