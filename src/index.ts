import { VisibilityState, World, createSystem, type Object3D } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { buildEnvironment } from './game/environment.ts';
import { Game } from './game/game.ts';
import { setupOverlay } from './overlay.ts';

const container = document.getElementById('scene-container') as HTMLDivElement;

// Wait for the plaque font so canvas text renders with it (falls back after 1.5 s).
const fontReady = Promise.race([
  document.fonts?.load('600 40px "Fraunces"').catch(() => undefined),
  new Promise((r) => setTimeout(r, 1500)),
]);

World.create(container, projectOptions).then(async (world) => {
  await fontReady;

  const env = buildEnvironment();
  world.createTransformEntity(env.root);

  let overlay: ReturnType<typeof setupOverlay> | undefined;
  const game = new Game({
    camera: world.camera,
    canvas: world.renderer.domElement,
    inXR: () => world.visibilityState.peek() !== VisibilityState.NonImmersive,
    xrFrame: () => world.xrFrame,
    xrSpace: () => world.xrReferenceSpace,
    origin: () => world.player,
    onLevelChange: (i, name) => overlay?.setLevel(i, name),
  });
  world.createTransformEntity(game.view.root);
  world.createTransformEntity(game.handsView.root);
  const sdkHands = world.input.xr.visualAdapters.hand;
  const sdkHandMeshes: Object3D[] = [];
  let scanCountdown = 0;

  overlay = setupOverlay({
    canEnterXR: async () => {
      try {
        return (await navigator.xr?.isSessionSupported('immersive-vr')) ?? false;
      } catch {
        return false;
      }
    },
    enterXR: () => {
      game.sound.unlock();
      world.launchXR();
    },
    unlockAudio: () => game.sound.unlock(),
  });
  overlay.setLevel(game.levelIndex, game.view.level.name);

  world.visibilityState.subscribe((s) => overlay?.setImmersive(s !== VisibilityState.NonImmersive));

  class GameSystem extends createSystem({}) {
    update(delta: number, time: number): void {
      const vis = world.visibilityState.peek();
      // Lumenwright draws its own hands; keep the SDK's outline hands hidden.
      if (vis !== VisibilityState.NonImmersive) {
        sdkHands.left.toggleVisual(false);
        sdkHands.right.toggleVisual(false);
        if (sdkHandMeshes.length < 2 && ++scanCountdown % 30 === 0) {
          sdkHandMeshes.length = 0;
          world.scene.traverse((o) => {
            if (/handMeshNode/.test(o.name)) sdkHandMeshes.push(o);
          });
        }
        for (const o of sdkHandMeshes) o.visible = false;
      }
      game.update(delta, time, vis === VisibilityState.VisibleBlurred);
      env.update(Math.min(delta, 0.1), time, game.view.glow);
    }
  }
  world.registerSystem(GameSystem);

  // Small hook for automated checks and recordings.
  (window as unknown as { lumenwright: unknown }).lumenwright = { world, game };
});
