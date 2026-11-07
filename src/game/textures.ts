// Procedural canvas textures: wood grain, engraved plaques, button labels.

import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from '@iwsdk/core';

export const SERIF = '"Fraunces", "Iowan Old Style", Georgia, serif';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Small deterministic PRNG so textures look the same every load.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function woodGrain(ctx: CanvasRenderingContext2D, w: number, h: number, base: string, seed: number, vertical = false): void {
  const r = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  const lines = 140;
  for (let i = 0; i < lines; i++) {
    const p = r() * (vertical ? w : h);
    const amp = 2 + r() * 6;
    const freq = 0.004 + r() * 0.01;
    const phase = r() * 10;
    ctx.strokeStyle = r() > 0.5 ? 'rgba(20,10,5,0.18)' : 'rgba(255,220,180,0.06)';
    ctx.lineWidth = 0.6 + r() * 1.8;
    ctx.beginPath();
    const len = vertical ? h : w;
    for (let t = 0; t <= len; t += 8) {
      const off = Math.sin(t * freq + phase) * amp;
      if (vertical) ctx.lineTo(p + off, t);
      else ctx.lineTo(t, p + off);
    }
    ctx.stroke();
  }
}

/** Walnut board face with engraved brass cell rings. */
export function boardTexture(cols: number, rows: number, pxPerCell = 128): CanvasTexture {
  const pad = 0.4; // border in cells
  const W = Math.round((cols + pad * 2) * pxPerCell);
  const H = Math.round((rows + pad * 2) * pxPerCell);
  const [c, ctx] = canvas(W, H);
  woodGrain(ctx, W, H, '#3d2618', 7);
  // Soft vignette.
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.7);
  g.addColorStop(0, 'rgba(255,200,150,0.06)');
  g.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Grid of faint lines and cell rings.
  const ox = pad * pxPerCell;
  const oy = pad * pxPerCell;
  ctx.strokeStyle = 'rgba(230,194,122,0.10)';
  ctx.lineWidth = 2;
  for (let x = 0; x <= cols; x++) {
    ctx.beginPath();
    ctx.moveTo(ox + x * pxPerCell, oy);
    ctx.lineTo(ox + x * pxPerCell, oy + rows * pxPerCell);
    ctx.stroke();
  }
  for (let y = 0; y <= rows; y++) {
    ctx.beginPath();
    ctx.moveTo(ox, oy + y * pxPerCell);
    ctx.lineTo(ox + cols * pxPerCell, oy + y * pxPerCell);
    ctx.stroke();
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cx = ox + (x + 0.5) * pxPerCell;
      const cy = oy + (y + 0.5) * pxPerCell;
      ctx.strokeStyle = 'rgba(230,194,122,0.22)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, pxPerCell * 0.08, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // Inlaid brass border.
  ctx.strokeStyle = 'rgba(214,170,96,0.55)';
  ctx.lineWidth = 6;
  ctx.strokeRect(ox - pxPerCell * 0.18, oy - pxPerCell * 0.18, cols * pxPerCell + pxPerCell * 0.36, rows * pxPerCell + pxPerCell * 0.36);
  return tex(c);
}

export function woodTexture(seed: number, base = '#4a2e1f', size = 512, repeat = 1): CanvasTexture {
  const [c, ctx] = canvas(size, size);
  woodGrain(ctx, size, size, base, seed);
  const t = tex(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeat, repeat);
  return t;
}

/** Deck planks seen from above, for the observatory floor. */
export function deckTexture(): CanvasTexture {
  const S = 1024;
  const [c, ctx] = canvas(S, S);
  const r = rng(42);
  const plank = S / 8;
  for (let i = 0; i < 8; i++) {
    const shade = 40 + Math.floor(r() * 18);
    ctx.fillStyle = `rgb(${shade + 18},${shade},${shade - 12})`;
    ctx.fillRect(0, i * plank, S, plank);
    for (let k = 0; k < 18; k++) {
      ctx.strokeStyle = `rgba(15,8,4,${0.1 + r() * 0.15})`;
      ctx.lineWidth = 1 + r() * 2;
      ctx.beginPath();
      const y = i * plank + r() * plank;
      ctx.moveTo(0, y);
      for (let x = 0; x <= S; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.01 + k) * 3);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(10,5,3,0.7)';
    ctx.fillRect(0, i * plank, S, 4);
    const seam = r() * S;
    ctx.fillRect(seam, i * plank, 4, plank);
  }
  const t = tex(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

export interface PlaqueText {
  title: string;
  subtitle?: string;
  body?: string;
}

/** Draws an engraved brass-on-ink plaque into an existing canvas texture. */
export function drawPlaque(texture: CanvasTexture, text: PlaqueText): void {
  const c = texture.image as HTMLCanvasElement;
  const ctx = c.getContext('2d')!;
  const W = c.width;
  const H = c.height;
  ctx.clearRect(0, 0, W, H);
  // Plate.
  const grd = ctx.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#2a2030');
  grd.addColorStop(1, '#17111c');
  ctx.fillStyle = grd;
  roundRect(ctx, 6, 6, W - 12, H - 12, 28);
  ctx.fill();
  ctx.strokeStyle = '#c99a4a';
  ctx.lineWidth = 6;
  roundRect(ctx, 14, 14, W - 28, H - 28, 22);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(201,154,74,0.35)';
  ctx.lineWidth = 2;
  roundRect(ctx, 26, 26, W - 52, H - 52, 16);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let y = H * 0.3;
  if (text.subtitle) {
    ctx.fillStyle = 'rgba(230,194,122,0.75)';
    ctx.font = `500 ${Math.round(H * 0.085)}px ${SERIF}`;
    ctx.fillText(spaced(text.subtitle.toUpperCase()), W / 2, H * 0.19);
    y = H * 0.38;
  }
  ctx.fillStyle = '#f3e6c8';
  ctx.font = `600 ${Math.round(H * 0.2)}px ${SERIF}`;
  ctx.fillText(text.title, W / 2, y);
  if (text.body) {
    ctx.fillStyle = 'rgba(243,230,200,0.82)';
    ctx.font = `italic 400 ${Math.round(H * 0.095)}px ${SERIF}`;
    wrap(ctx, text.body, W / 2, H * 0.66, W * 0.84, H * 0.12);
  }
  texture.needsUpdate = true;
}

export function plaqueTexture(w = 1024, h = 384): CanvasTexture {
  const [c] = canvas(w, h);
  return tex(c);
}

/** Small round label for a push button. */
export function buttonLabel(label: string, glyph: string): CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#1b1420';
  ctx.beginPath();
  ctx.arc(128, 128, 124, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#d4a85a';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(128, 128, 112, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#f3e6c8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 104px ${SERIF}`;
  ctx.fillText(glyph, 128, 112);
  ctx.font = `600 30px ${SERIF}`;
  ctx.fillStyle = 'rgba(230,194,122,0.9)';
  ctx.fillText(spaced(label.toUpperCase()), 128, 196);
  return tex(c);
}

function spaced(s: string): string {
  return s.split('').join(' ');
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, maxW: number, lineH: number): void {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  const start = y - ((lines.length - 1) * lineH) / 2;
  lines.forEach((l, i) => ctx.fillText(l, cx, start + i * lineH));
}
