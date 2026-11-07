// Beam tracing for Lumenwright boards.
//
// The board is a grid. x grows to the right, y grows toward the player.
// Beams travel in 8 directions, numbered counter-clockwise from east when the
// board is seen from above with "north" (y - 1) pointing away from the player:
//   0 E, 1 NE, 2 N, 3 NW, 4 W, 5 SW, 6 S, 7 SE
//
// Mirror-like pieces have an orientation m in 0..7. The reflecting line sits at
// m * 22.5 degrees, so reflecting a beam with direction d gives (m - d) mod 8.
// A beam that runs parallel to the line grazes past it untouched.
//
// Colors are RGB bitmasks: 1 red, 2 green, 4 blue, 7 white.
// This module has no three.js or DOM dependencies so it can be unit tested.

export const RED = 1;
export const GREEN = 2;
export const BLUE = 4;
export const WHITE = 7;

export const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

export type PieceKind =
  | 'emitter'
  | 'target'
  | 'wall'
  | 'mirror'
  | 'splitter'
  | 'filter'
  | 'dichroic';

export interface Piece {
  kind: PieceKind;
  x: number;
  y: number;
  /** Emitter direction (0..7). */
  dir?: number;
  /** Mirror / splitter / dichroic orientation (0..7, 22.5 degree steps). */
  m?: number;
  /** Emitter color, target required color, filter pass color, dichroic reflect color. */
  color?: number;
  /** Rotatable by the player. Defaults to true for mirror, splitter, dichroic. */
  rotatable?: boolean;
  /** Cells this piece can slide between. The piece must start on one of them. */
  rail?: ReadonlyArray<readonly [number, number]>;
}

export interface Level {
  id: string;
  name: string;
  hint: string;
  w: number;
  h: number;
  pieces: Piece[];
}

export interface Segment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  color: number;
}

export interface TraceResult {
  segments: Segment[];
  /** Color mask received by each piece index that is a target (0 when dark). */
  received: Map<number, number>;
  /** Targets whose received color equals their required color. */
  litTargets: Set<number>;
  solved: boolean;
}

export const mod8 = (n: number): number => ((n % 8) + 8) % 8;

export function reflect(d: number, m: number): number {
  return mod8(m - d);
}

/** True when a beam moving in direction d runs along a line with orientation m. */
export function isParallel(d: number, m: number): boolean {
  return m % 2 === 0 && mod8(d - m / 2) % 4 === 0;
}

export function isRotatable(p: Piece): boolean {
  if (p.rotatable !== undefined) return p.rotatable;
  return p.kind === 'mirror' || p.kind === 'splitter' || p.kind === 'dichroic';
}

export function isInteractive(p: Piece): boolean {
  return isRotatable(p) || (p.rail !== undefined && p.rail.length > 1);
}

export function clonePieces(pieces: ReadonlyArray<Piece>): Piece[] {
  return pieces.map((p) => ({ ...p }));
}

interface Ray {
  x: number;
  y: number;
  d: number;
  color: number;
}

const MAX_STEPS = 4000;

export function trace(level: Pick<Level, 'w' | 'h'>, pieces: ReadonlyArray<Piece>): TraceResult {
  const { w, h } = level;
  const grid = new Map<number, number>();
  pieces.forEach((p, i) => grid.set(p.y * w + p.x, i));

  const segments: Segment[] = [];
  const received = new Map<number, number>();
  pieces.forEach((p, i) => {
    if (p.kind === 'target') received.set(i, 0);
  });

  const queue: Ray[] = [];
  pieces.forEach((p) => {
    if (p.kind === 'emitter') {
      queue.push({ x: p.x, y: p.y, d: mod8(p.dir ?? 0), color: p.color ?? WHITE });
    }
  });

  const seen = new Set<string>();
  let steps = 0;

  while (queue.length > 0 && steps < MAX_STEPS) {
    const ray = queue.shift()!;
    const key = `${ray.x},${ray.y},${ray.d},${ray.color}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const [dx, dy] = DIRS[ray.d];
    let cx = ray.x;
    let cy = ray.y;
    for (;;) {
      steps++;
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || steps > MAX_STEPS) {
        // Leave the board: stop at the board edge, half a cell out.
        segments.push({ ax: ray.x, ay: ray.y, bx: cx + dx * 0.5, by: cy + dy * 0.5, color: ray.color });
        break;
      }
      cx = nx;
      cy = ny;
      const idx = grid.get(cy * w + cx);
      if (idx === undefined) continue;
      const p = pieces[idx];
      const outs = interact(p, ray.d, ray.color);
      if (outs === 'pass') continue;
      segments.push({ ax: ray.x, ay: ray.y, bx: cx, by: cy, color: ray.color });
      if (p.kind === 'target') {
        received.set(idx, (received.get(idx) ?? 0) | ray.color);
      }
      for (const o of outs) queue.push({ x: cx, y: cy, d: o.d, color: o.color });
      break;
    }
  }

  const litTargets = new Set<number>();
  let solved = received.size > 0;
  received.forEach((got, idx) => {
    if (got === pieces[idx].color) litTargets.add(idx);
    else solved = false;
  });

  return { segments, received, litTargets, solved };
}

type Out = { d: number; color: number };

function interact(p: Piece, d: number, color: number): Out[] | 'pass' {
  switch (p.kind) {
    case 'emitter':
    case 'wall':
    case 'target':
      return [];
    case 'mirror': {
      const m = p.m ?? 0;
      if (isParallel(d, m)) return 'pass';
      return [{ d: reflect(d, m), color }];
    }
    case 'splitter': {
      const m = p.m ?? 0;
      if (isParallel(d, m)) return 'pass';
      return [
        { d, color },
        { d: reflect(d, m), color },
      ];
    }
    case 'filter': {
      const c = color & (p.color ?? WHITE);
      return c === 0 ? [] : [{ d, color: c }];
    }
    case 'dichroic': {
      const m = p.m ?? 0;
      if (isParallel(d, m)) return 'pass';
      const out: Out[] = [];
      const reflected = color & (p.color ?? WHITE);
      const passed = color & ~(p.color ?? WHITE) & WHITE;
      if (passed) out.push({ d, color: passed });
      if (reflected) out.push({ d: reflect(d, m), color: reflected });
      return out;
    }
  }
}

/**
 * Brute-force every reachable board state (orientations and rail positions)
 * and return the number of solved states. Used by tests to prove each level
 * can be finished and does not start solved.
 */
export function countSolutions(level: Level, limit = 1_000_000): number {
  const base = clonePieces(level.pieces);
  const movable = base
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => isInteractive(p));

  const options = movable.map(({ p }) => {
    const ms = isRotatable(p) ? [0, 1, 2, 3, 4, 5, 6, 7] : [p.m ?? 0];
    const cells = p.rail && p.rail.length > 0 ? p.rail : [[p.x, p.y] as const];
    const combos: Array<{ m: number; x: number; y: number }> = [];
    for (const [x, y] of cells) for (const m of ms) combos.push({ m, x, y });
    return combos;
  });

  let solutions = 0;
  let visited = 0;
  const staticCells = new Set(
    base.filter((p) => !isInteractive(p)).map((p) => p.y * level.w + p.x),
  );

  const rec = (k: number, used: Set<number>): void => {
    if (visited > limit) return;
    if (k === movable.length) {
      visited++;
      if (trace(level, base).solved) solutions++;
      return;
    }
    const { i } = movable[k];
    for (const o of options[k]) {
      const cell = o.y * level.w + o.x;
      if (staticCells.has(cell) || used.has(cell)) continue;
      base[i].x = o.x;
      base[i].y = o.y;
      base[i].m = o.m;
      used.add(cell);
      rec(k + 1, used);
      used.delete(cell);
    }
  };
  rec(0, new Set());
  return solutions;
}
