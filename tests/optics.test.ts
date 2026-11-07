import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLUE,
  GREEN,
  RED,
  WHITE,
  countSolutions,
  isParallel,
  reflect,
  trace,
  type Piece,
} from '../src/game/optics.ts';
import { LEVELS } from '../src/game/levels.ts';

const board = { w: 5, h: 5 };

test('reflect follows the 22.5 degree mirror convention', () => {
  assert.equal(reflect(0, 2), 2); // east hits "/" -> north
  assert.equal(reflect(2, 0), 6); // north hits "-" -> south
  assert.equal(reflect(6, 6), 0); // south hits "\" -> east
  assert.equal(reflect(0, 1), 1); // east hits a 22.5 degree line -> north-east
  assert.equal(reflect(1, 4), 3); // north-east hits "|" -> north-west
});

test('parallel beams graze past mirrors', () => {
  assert.ok(isParallel(0, 0));
  assert.ok(isParallel(4, 0));
  assert.ok(isParallel(1, 2));
  assert.ok(!isParallel(0, 2));
  assert.ok(!isParallel(0, 1));
});

test('a straight beam runs to the board edge', () => {
  const pieces: Piece[] = [{ kind: 'emitter', x: 0, y: 2, dir: 0, color: WHITE }];
  const r = trace(board, pieces);
  assert.equal(r.segments.length, 1);
  assert.deepEqual(r.segments[0], { ax: 0, ay: 2, bx: 4.5, by: 2, color: WHITE });
});

test('a mirror turns the beam into a target', () => {
  const pieces: Piece[] = [
    { kind: 'emitter', x: 0, y: 2, dir: 0, color: WHITE },
    { kind: 'mirror', x: 2, y: 2, m: 2 },
    { kind: 'target', x: 2, y: 0, color: WHITE },
  ];
  const r = trace(board, pieces);
  assert.ok(r.solved);
  assert.ok(r.litTargets.has(2));
  pieces[1].m = 3;
  assert.ok(!trace(board, pieces).solved);
});

test('walls absorb light', () => {
  const pieces: Piece[] = [
    { kind: 'emitter', x: 0, y: 0, dir: 0, color: WHITE },
    { kind: 'wall', x: 2, y: 0 },
    { kind: 'target', x: 4, y: 0, color: WHITE },
  ];
  assert.ok(!trace(board, pieces).solved);
});

test('splitters feed two targets', () => {
  const pieces: Piece[] = [
    { kind: 'emitter', x: 0, y: 2, dir: 0, color: WHITE },
    { kind: 'splitter', x: 2, y: 2, m: 2 },
    { kind: 'target', x: 4, y: 2, color: WHITE },
    { kind: 'target', x: 2, y: 0, color: WHITE },
  ];
  const r = trace(board, pieces);
  assert.ok(r.solved);
  assert.equal(r.litTargets.size, 2);
});

test('filters keep only their color and can block entirely', () => {
  const pieces: Piece[] = [
    { kind: 'emitter', x: 0, y: 0, dir: 0, color: WHITE },
    { kind: 'filter', x: 2, y: 0, color: RED },
    { kind: 'target', x: 4, y: 0, color: RED },
  ];
  assert.ok(trace(board, pieces).solved);
  pieces[0].color = BLUE;
  const r = trace(board, pieces);
  assert.equal(r.received.get(2), 0);
});

test('two colors add up inside one target', () => {
  const pieces: Piece[] = [
    { kind: 'emitter', x: 0, y: 2, dir: 0, color: RED },
    { kind: 'emitter', x: 4, y: 2, dir: 4, color: BLUE },
    { kind: 'target', x: 2, y: 2, color: RED | BLUE },
  ];
  const r = trace(board, pieces);
  assert.equal(r.received.get(2), RED | BLUE);
  assert.ok(r.solved);
});

test('a target that receives extra colors is not lit', () => {
  const pieces: Piece[] = [
    { kind: 'emitter', x: 0, y: 2, dir: 0, color: WHITE },
    { kind: 'target', x: 2, y: 2, color: RED },
  ];
  assert.ok(!trace(board, pieces).solved);
});

test('dichroic glass reflects its color and passes the rest', () => {
  const pieces: Piece[] = [
    { kind: 'emitter', x: 0, y: 2, dir: 0, color: WHITE },
    { kind: 'dichroic', x: 2, y: 2, m: 2, color: RED },
    { kind: 'target', x: 2, y: 0, color: RED },
    { kind: 'target', x: 4, y: 2, color: GREEN | BLUE },
  ];
  assert.ok(trace(board, pieces).solved);
});

test('beam loops terminate', () => {
  // Four mirrors forming a closed loop fed by a splitter.
  const pieces: Piece[] = [
    { kind: 'emitter', x: 0, y: 1, dir: 0, color: WHITE },
    { kind: 'splitter', x: 1, y: 1, m: 2 },
    { kind: 'mirror', x: 1, y: 0, m: 6 },
    { kind: 'mirror', x: 3, y: 0, m: 2 },
    { kind: 'mirror', x: 3, y: 3, m: 6 },
    { kind: 'mirror', x: 1, y: 3, m: 2 },
  ];
  const r = trace(board, pieces);
  assert.ok(r.segments.length < 100);
});

test('there are twelve levels with unique ids', () => {
  assert.equal(LEVELS.length, 12);
  assert.equal(new Set(LEVELS.map((l) => l.id)).size, 12);
});

for (const level of LEVELS) {
  test(`level "${level.name}" is well formed, unsolved at start, and solvable`, () => {
    const cells = new Set<string>();
    for (const p of level.pieces) {
      assert.ok(p.x >= 0 && p.x < level.w && p.y >= 0 && p.y < level.h, `${p.kind} on board`);
      const key = `${p.x},${p.y}`;
      assert.ok(!cells.has(key), `two pieces share ${key}`);
      cells.add(key);
      if (p.rail) {
        assert.ok(p.rail.some(([x, y]) => x === p.x && y === p.y), 'piece starts on its rail');
      }
    }
    assert.ok(level.pieces.some((p) => p.kind === 'emitter'));
    assert.ok(level.pieces.some((p) => p.kind === 'target'));
    assert.equal(trace(level, level.pieces).solved, false);
    assert.ok(countSolutions(level) >= 1);
  });
}
