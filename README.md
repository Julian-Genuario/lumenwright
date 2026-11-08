# Lumenwright

A seated, hands-only light puzzle for Meta Quest, built with the Immersive Web
SDK (WebXR). You sit at a small brass-and-walnut workbench on a rooftop
observatory at dusk. Each board has a lamp, a few lanterns and some optics.
Pinch a mirror and twist your wrist to turn it, slide pieces along their rails,
and route the light until every lantern glows in the color it asks for.

**Play:** https://julian-genuario.github.io/lumenwright/ (open it in the Meta
Quest browser, tap Enter VR, put the controllers down).

There are twelve short boards. Each one adds a single idea:

1. Turning a mirror
2. Two turns
3. Diagonals (mirrors click in 22.5 degree steps)
4. Half-silvered glass that splits a beam
5. Splitting into separate paths
6. Colored glass that keeps one color
7. Two colors from one white lamp
8. Mixing two colors in one lantern
9. Sorting glass that turns one color and passes the rest
10. Pieces on rails
11. Slide, then turn
12. All of it on one table

A full run takes about ten minutes. Progress and your best run time are kept
in the browser.

## Controls

In the headset (hand tracking):

- **Pinch** a knob to hold a piece, **twist your wrist** to turn it. Turning
  your hand around like a knob or rolling your forearm like a key both work.
  Each notch clicks.
- **Pinch and drag** a piece that sits on a brass rail to slide it.
- **Poke** the round buttons on the front of the table: Reset, Next, and Center
  (moves the table back in front of you).
- **Poke** one of the twelve small studs to replay a board you have finished.

Everything happens within arm's reach of a chair. No controllers are needed at
any point.

On a desktop browser (no headset) the same game runs with a mouse: click a
mirror to turn it one notch, drag sideways to spin it, drag rail pieces along
their rail, scroll over a mirror to turn it. `R` resets, `N` goes to the next
board, `M` mutes.

## How it works

- `src/game/optics.ts` is the puzzle logic, with no 3D code in it. The board is
  a grid, beams travel in eight directions, and mirror-like pieces have eight
  orientations. Reflection is `(m - d) mod 8`. Colors are RGB bitmasks, so
  filters are `AND`, sorting glass splits a beam into `color & c` and
  `color & ~c`, and a lantern is lit when the union of the beams it receives
  equals the color it wants.
- `src/game/levels.ts` holds the twelve boards.
- `src/game/hands.ts` reads the 25 hand joints from each `XRFrame`, detects
  pinches from the thumb-to-index distance (with hysteresis), and tracks the
  wrist rotation. A held piece turns by how far the wrist has rotated since
  the pinch started, measured either around the vertical (turning a knob) or
  around the forearm (turning a key), whichever is larger.
- `src/game/hands-view.ts` draws the hands as jointed maple mannequin hands
  (two instanced draw calls).
- `src/game/table-view.ts`, `environment.ts` and `textures.ts` build every
  model and texture procedurally. `audio.ts` synthesizes all sound with Web
  Audio. There are no asset files.
- `src/index.ts` creates the IWSDK `World` and runs the game as an ECS system.

## Running locally

Requires Node.js 20.19+ (22 or 24 work).

```sh
npm install
npm run dev        # starts Vite plus the IWSDK managed browser
npm test           # beam tracing and level tests
npm run typecheck
npm run build      # static site in dist/
```

The dev server injects IWER, the Immersive Web Emulator, so you can enter VR
on a desktop browser at https://localhost:8081 and switch the emulated input
to hands. To try it on a Quest on the same network, open the network URL that
`npx @iwsdk/cli dev status` prints and accept the local certificate warning.

`scripts/hand-test.mjs` drives the emulated hands through a few boards
(pinch and twist, both hands, rail slide, poking buttons) and
`scripts/mouse-test.mjs` checks the desktop fallback against a built copy.

## Tests

`npm test` runs `tests/optics.test.ts` with Node's built-in test runner. Besides
unit tests for reflection, splitting, filtering, color mixing and loop
termination, it brute-forces every board: each one must start unsolved and
have at least one solution.

## License

MIT. See `LICENSE`. Third-party pieces are listed in `CREDITS.md`.
