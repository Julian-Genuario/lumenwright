// Saved progress. Browser storage can be missing or blocked, so every access
// is wrapped and the game works without it.

const KEY = 'lumenwright.progress.v1';

export interface Progress {
  current: number;
  done: boolean[];
  bestRunSeconds: number | null;
  runSeconds: number;
}

export function freshProgress(count: number): Progress {
  return { current: 0, done: new Array(count).fill(false), bestRunSeconds: null, runSeconds: 0 };
}

export function loadProgress(count: number): Progress {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return freshProgress(count);
    const p = JSON.parse(raw) as Partial<Progress>;
    const done = new Array(count).fill(false).map((_, i) => Boolean(p.done?.[i]));
    return {
      current: Math.max(0, Math.min(count - 1, Number(p.current) || 0)),
      done,
      bestRunSeconds: typeof p.bestRunSeconds === 'number' ? p.bestRunSeconds : null,
      runSeconds: typeof p.runSeconds === 'number' ? p.runSeconds : 0,
    };
  } catch {
    return freshProgress(count);
  }
}

export function saveProgress(p: Progress): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage unavailable: progress lasts for this visit only.
  }
}

/** Highest level index the player may jump to. */
export function unlockedUpTo(p: Progress): number {
  let i = 0;
  while (i < p.done.length - 1 && p.done[i]) i++;
  return Math.max(i, p.current);
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
