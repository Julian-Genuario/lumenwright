// Warm brass, walnut, frosted glass, and a dusk sky.

export const PALETTE = {
  brass: 0xb8893a,
  brassDark: 0x7a5624,
  brassBright: 0xe6c27a,
  walnut: 0x4a2e1f,
  walnutLight: 0x6b4630,
  slate: 0x2c2a33,
  glass: 0xdfe8ee,
  silver: 0xe8edf2,
  cream: 0xf3e6c8,
  ink: 0x1d1622,
  plum: 0x2a1f35,
  dusk: 0xe39a72,
  moon: 0xf4ead2,
};

/** Display color for each RGB light mask. Muted and warm rather than neon. */
const BEAM_COLORS: Record<number, number> = {
  0: 0x3a3340,
  1: 0xff6a45, // red
  2: 0x8fe07c, // green
  3: 0xffd36a, // yellow
  4: 0x6fa2ff, // blue
  5: 0xe486ff, // magenta
  6: 0x72e4dc, // cyan
  7: 0xfff0d2, // white
};

export function beamColor(mask: number): number {
  return BEAM_COLORS[mask & 7] ?? 0xffffff;
}

export const COLOR_NAMES: Record<number, string> = {
  1: 'red',
  2: 'green',
  3: 'amber',
  4: 'blue',
  5: 'violet',
  6: 'teal',
  7: 'white',
};
