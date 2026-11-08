// Records real gameplay from the IWER emulator (dev server) with emulated
// hand tracking. Writes video/raw/*.webm, video/audio.webm and
// video/markers.json (caption timings). Run scripts/make-trailer.mjs after.
//
// Usage: node scripts/record-trailer.mjs [https://localhost:8081/]
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

const url = process.argv[2] ?? 'https://localhost:8081/';
rmSync('video/raw', { recursive: true, force: true });
mkdirSync('video/raw', { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [
    '--ignore-certificate-errors',
    '--use-angle=d3d11',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  ignoreHTTPSErrors: true,
  recordVideo: { dir: 'video/raw', size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
const videoStart = Date.now();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(url);
await page.waitForFunction(() => window.lumenwright && window.IWER_DEVICE, null, { timeout: 30000 });
await page.evaluate(() => {
  const g = window.lumenwright.game;
  g.progress.done.fill(false);
  g.progress.runSeconds = 0;
  g.loadLevel(0);
});
await page.click('#enter-vr');
await page.waitForFunction(() => !!window.lumenwright.world.session, null, { timeout: 15000 });
await page.addScriptTag({ content: readFileSync(new URL('./drive.js', import.meta.url), 'utf8') });

await page.evaluate(async () => {
  const D = window.IWER_DEVICE;
  await window.drive.setup([0, 1.18, 0.12], -0.62);
  D.fovy = 0.95;
  // Hide the emulator's developer overlays so only the rendered view remains.
  const hide = () => {
    const keep = D.canvasContainer;
    for (const el of document.body.children) {
      if (!el.id && el.tagName === 'DIV' && el !== keep && !el.contains(keep)) el.style.display = 'none';
    }
    const app = window.lumenwright.world.renderer.domElement;
    for (const c of keep.querySelectorAll('*')) {
      if (c === app || c.contains(app)) continue;
      c.style.display = 'none';
    }
  };
  hide();
  setInterval(hide, 250);
});
await page.waitForTimeout(700);
await page.evaluate(() => {
  const g = window.lumenwright.game;
  g.recenter();
  g.recenter = () => {}; // keep the table fixed for the whole take
});
// Sit back a little (10 cm) so the hands do not fill the frame.
await page.evaluate(() =>
  window.IWER_DEVICE.remote.dispatch('set_transform', { device: 'headset', position: { x: 0, y: 1.22, z: 0.22 } }),
);

// Start capturing the game's own audio mix.
const audioStart = await page.evaluate(() => {
  const stream = window.lumenwright.game.sound.captureStream();
  window.__chunks = [];
  if (!stream) return null;
  const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
  rec.ondataavailable = (e) => window.__chunks.push(e.data);
  rec.start(500);
  window.__rec = rec;
  return Date.now();
});

const markers = [];
const t = () => (Date.now() - videoStart) / 1000;
const mark = (name, caption) => markers.push({ name, caption, at: t() });
const run = (fn, ...args) => page.evaluate(fn, args);
const load = async (i) => {
  await run(([i]) => window.lumenwright.game.loadLevel(i), i);
  await page.waitForTimeout(1300);
};
const restAt = (hand) =>
  run(async ([hand]) => {
    const view = window.lumenwright.game.view;
    const v = view.root.position.clone().set(hand === 'left' ? -0.2 : 0.2, 0.06, 0.36);
    view.root.localToWorld(v);
    await window.drive.grasp(hand);
    await window.drive.moveTo(hand, [v.x, v.y, v.z], 650);
  }, hand);
const turn = (hand, piece, steps) => run(([h, p, s]) => window.drive.turnPiece(h, p, s), hand, piece, steps);
const slide = (hand, piece, x, y) => run(([h, p, cx, cy]) => window.drive.slidePiece(h, p, cx, cy), hand, piece, x, y);
const press = (hand, id) => run(([h, id]) => window.drive.press(h, window.drive.buttonTop(id)), hand, id);

// Sync flash: a white frame whose wall-clock time we know, found later in the
// video by brightness. Done at the start and the end to map time linearly.
const flash = async () => {
  const at = await page.evaluate(async () => {
    const d = document.createElement('div');
    d.id = 'sync-flash';
    d.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:99999';
    document.body.appendChild(d);
    const t = Date.now();
    await new Promise((r) => setTimeout(r, 400));
    d.remove();
    return t;
  });
  return (at - videoStart) / 1000;
};
const flashes = [await flash()];
await page.waitForTimeout(600);
await restAt('left');
await restAt('right');
mark('start');
await page.waitForTimeout(1500);

// Board 1
mark('b1', 'Pinch a mirror. Twist your wrist.');
await turn('right', 1, 2);
await page.waitForTimeout(1800);
mark('next', 'Poke the brass buttons. No controllers, anywhere.');
await press('right', 'next');
await restAt('right');
await page.waitForTimeout(900);

// Board 2: two hands
mark('b2', 'Both hands work.');
await turn('right', 1, 2);
await turn('left', 2, -2);
await page.waitForTimeout(1500);

// Board 3: diagonals
await load(2);
mark('b3', 'Mirrors click in 22.5 degree steps.');
await turn('right', 1, 1);
await turn('right', 4, -4);
await page.waitForTimeout(1500);

// Board 4: splitter
await load(3);
mark('b4', 'Half-silvered glass splits a beam in two.');
await turn('right', 1, 1);
await page.waitForTimeout(1600);

// Board 7: color filters
await load(6);
mark('b7', 'Colored glass keeps only its own color.');
await turn('left', 1, -2);
await turn('right', 3, 2);
await turn('left', 6, -2);
await page.waitForTimeout(1500);

// Board 8: mixing
await load(7);
mark('b8', 'Red and blue meet in one lantern.');
await turn('left', 2, -1);
await turn('left', 3, 1);
await page.waitForTimeout(1600);

// Board 9: sorting glass
await load(8);
mark('b9', 'Sorting glass turns one color and lets the rest through.');
await turn('right', 1, 2);
await turn('right', 3, -2);
await page.waitForTimeout(1800);

// Board 10: rails
await load(9);
mark('b10', 'Some pieces slide on brass rails.');
await slide('right', 1, 3, 3);
await restAt('right');
await page.waitForTimeout(1500);

// Board 12: finale
await load(11);
mark('b12', 'Twelve boards. One new idea each.');
await turn('left', 1, -1);
await turn('right', 2, 2);
await turn('right', 6, -1);
await restAt('right');
await restAt('left');
await page.waitForTimeout(1200);

// Look up at the sky, then back down.
mark('sky', 'A small rooftop observatory, a few minutes of quiet.');
await run(() => window.drive.look(-0.05, 0.35, 2200));
await page.waitForTimeout(1200);
await run(() => window.drive.look(-0.05, -0.3, 2200));
await page.waitForTimeout(600);
await run(() => window.drive.look(-0.62, 0, 1800));
await page.waitForTimeout(1500);
mark('end');
await page.waitForTimeout(800);
flashes.push(await flash());
await page.waitForTimeout(800);

let audioB64 = null;
if (audioStart) {
  audioB64 = await page.evaluate(
    () =>
      new Promise((resolve) => {
        window.__rec.onstop = async () => {
          const blob = new Blob(window.__chunks, { type: 'audio/webm' });
          const buf = new Uint8Array(await blob.arrayBuffer());
          let s = '';
          for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          resolve(btoa(s));
        };
        window.__rec.stop();
      }),
  );
  writeFileSync('video/audio.webm', Buffer.from(audioB64, 'base64'));
}

const videoPath = await page.video().path();
await context.close();
await browser.close();
writeFileSync(
  'video/markers.json',
  JSON.stringify({ videoPath, audioOffset: audioStart ? (audioStart - videoStart) / 1000 : null, flashes, markers, errors }, null, 2),
);
console.log(JSON.stringify({ videoPath, markers: markers.length, errors }, null, 1));
