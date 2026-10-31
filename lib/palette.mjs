// Each palette is a few RGB stops sampled 0..1. One is picked at random per launch,
// and /color steps through the rest.
export const PALETTES = {
  neon: [[168, 85, 247], [236, 72, 153], [34, 211, 238]],
  fire: [[220, 38, 38], [249, 115, 22], [250, 204, 21]],
  ocean: [[37, 99, 235], [14, 165, 233], [45, 212, 191]],
  toxic: [[22, 163, 74], [132, 204, 22], [250, 204, 21]],
  sunset: [[124, 58, 237], [244, 63, 94], [251, 146, 60]],
  candy: [[244, 114, 182], [192, 132, 252], [125, 211, 252]],
  aurora: [[16, 185, 129], [59, 130, 246], [217, 70, 239]],
};
export const NAMES = Object.keys(PALETTES);
let current = 'neon';

export const palette = () => current;

export function setPalette(name) {
  if (!PALETTES[name]) throw new Error(`no palette called ${name}. Try: ${NAMES.join(', ')}`);
  current = name;
  return current;
}

export const nextPalette = () => setPalette(NAMES[(NAMES.indexOf(current) + 1) % NAMES.length]);
export const randomPalette = (rng = Math.random) => setPalette(NAMES[Math.floor(rng() * NAMES.length)]);

// Ping-pongs past the ends instead of wrapping, so a drifting hue never jumps
// from the last colour straight back to the first.
export function grad(t) {
  const stops = PALETTES[current];
  t = ((t % 2) + 2) % 2;
  if (t > 1) t = 2 - t;
  const x = t * (stops.length - 1), i = Math.min(Math.floor(x), stops.length - 2), f = x - i;
  return stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
}
