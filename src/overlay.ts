// The flat-screen card shown outside VR: title, enter button, mouse hints.

export interface OverlayHooks {
  canEnterXR(): Promise<boolean>;
  enterXR(): void;
  unlockAudio(): void;
}

export function setupOverlay(hooks: OverlayHooks) {
  const card = document.getElementById('card') as HTMLDivElement;
  const enter = document.getElementById('enter-vr') as HTMLButtonElement;
  const note = document.getElementById('xr-note') as HTMLParagraphElement;
  const level = document.getElementById('level-line') as HTMLParagraphElement;

  enter.addEventListener('click', () => hooks.enterXR());
  window.addEventListener('pointerdown', () => hooks.unlockAudio(), { once: true });

  hooks.canEnterXR().then((ok) => {
    if (ok) {
      enter.hidden = false;
      note.textContent = 'Best with hand tracking. Put the controllers down.';
    } else {
      enter.hidden = true;
      note.textContent = 'Open this page in the Meta Quest browser to play with your hands.';
    }
  });

  return {
    setLevel(i: number, name: string) {
      level.textContent = name ? `Board ${i + 1} of 12 · ${name}` : `Board ${i + 1} of 12`;
    },
    setImmersive(on: boolean) {
      card.hidden = on;
    },
  };
}
