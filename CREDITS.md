# Credits

Lumenwright has no imported art or audio files. Every model, texture and
sound is generated in code at runtime:

- Geometry: three.js primitives assembled in `src/game/table-view.ts`,
  `src/game/environment.ts` and `src/game/hands-view.ts`.
- Textures (wood grain, deck planks, plaque, button labels): drawn on a
  canvas in `src/game/textures.ts`.
- Sound (beam hum, detent clicks, glass bells, chords, reverb): synthesized
  with the Web Audio API in `src/game/audio.ts`.

Third-party software and fonts:

| What | License | Source |
| --- | --- | --- |
| Immersive Web SDK (`@iwsdk/*`) | MIT | https://github.com/facebook/immersive-web-sdk |
| three.js (as `super-three`) | MIT | https://github.com/mrdoob/three.js |
| IWER, Immersive Web Emulation Runtime (dev only) | MIT | https://github.com/meta-quest/immersive-web-emulation-runtime |
| Vite, TypeScript (build tools) | MIT / Apache-2.0 | https://vitejs.dev, https://www.typescriptlang.org |
| Fraunces typeface, loaded from Google Fonts | SIL Open Font License 1.1 | https://fonts.google.com/specimen/Fraunces |
| Playwright (test and recording scripts only) | Apache-2.0 | https://playwright.dev |
