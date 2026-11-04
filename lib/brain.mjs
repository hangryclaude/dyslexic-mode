// A procedural 3D brain, ray-marched once per terminal cell. Pure: same input, same frame.
// Local axes: x right, y up, z forward (frontal lobe at +z, cerebellum at -z).

const BOUND = 1.35;
const RAMP = '.:-=+*#%@';
const F1 = 4.2, F2 = 9.1;
// The view: seen from a little above, centred a little below the middle of the brain.
export const TILT = 0.42;
const YC = -0.15;
const LIGHT = (() => { const l = Math.hypot(-0.45, 0.55, 0.7); return [-0.45 / l, 0.55 / l, 0.7 / l]; })();

const len = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const clamp01 = v => Math.min(1, Math.max(0, v));

function ellipsoid(x, y, z, rx, ry, rz) {
  const k0 = len(x / rx, y / ry, z / rz);
  // k1 is zero only at the exact centre; the floor keeps that one point from turning into NaN.
  const k1 = Math.max(len(x / (rx * rx), y / (ry * ry), z / (rz * rz)), 1e-9);
  return k0 * (k0 - 1) / k1;
}

function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function capsule(x, y, z, ax, ay, az, bx, by, bz, r) {
  const px = x - ax, py = y - ay, pz = z - az, vx = bx - ax, vy = by - ay, vz = bz - az;
  const h = clamp01((px * vx + py * vy + pz * vz) / (vx * vx + vy * vy + vz * vz));
  return len(px - vx * h, py - vy * h, pz - vz * h) - r;
}

function hash(i, j, k) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295 * 2 - 1;
}

const fade = t => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;

function noise(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const u = fade(x - i), v = fade(y - j), w = fade(z - k);
  return mix(
    mix(mix(hash(i, j, k), hash(i + 1, j, k), u), mix(hash(i, j + 1, k), hash(i + 1, j + 1, k), u), v),
    mix(mix(hash(i, j, k + 1), hash(i + 1, j, k + 1), u), mix(hash(i, j + 1, k + 1), hash(i + 1, j + 1, k + 1), u), v),
    w);
}

// Set by every cerebrum() call and read right after the hit, so the hot march loop
// never allocates an object per step.
let groove = 0, crease = 0, hemiD = 0, temporalD = 0;

// |x| mirrors one hemisphere into two; the fold at x = 0 is the longitudinal fissure.
const hemiOf = (ax, y, z) => ellipsoid(ax - 0.2, (y < 0 ? y * 1.3 : y) - 0.05, z, 0.58 + 0.05 * Math.max(0, -z), 0.62, 0.95);
const temporalOf = (ax, y, z) => ellipsoid(ax - 0.55, y + 0.3, z - 0.1, 0.3, 0.27, 0.52);

function cerebrum(x, y, z) {
  const ax = Math.abs(x), hemi = hemiOf(ax, y, z), temporal = temporalOf(ax, y, z);
  // Sulci sit on the zero lines of the noise: 1 - |n| peaks there, and the 8th power keeps them narrow.
  const n = noise(ax * F1, y * F1, z * F1) + 0.45 * noise(ax * F2 + 17, y * F2, z * F2);
  groove = (1 - Math.min(1, Math.abs(n))) ** 8;
  crease = Math.exp(-Math.abs(hemi - temporal) * 25);
  hemiD = hemi;
  temporalD = temporal;
  // Shallow on purpose: deep grooves bend the normals into speckle; the dark lines come from shade().
  return smin(hemi, temporal, 0.06) + 0.02 * groove;
}

const cerebellum = (x, y, z) => ellipsoid(x, y + 0.45, z + 0.62, 0.5, 0.24, 0.3);
const stem = (x, y, z) => capsule(x, y, z, 0, -0.45, -0.25, 0, -1.0, -0.38, 0.11);

export const field = (x, y, z) => Math.min(cerebrum(x, y, z), cerebellum(x, y, z), stem(x, y, z));

// The same shape without its grooves: cheap enough to measure how far round the brain is.
const outline = (x, y, z) => {
  const ax = Math.abs(x);
  return Math.min(smin(hemiOf(ax, y, z), temporalOf(ax, y, z), 0.06), cerebellum(x, y, z), stem(x, y, z));
};

function march(ox, oy, oz, dx, dy, dz) {
  const b = ox * dx + oy * dy + oz * dz, disc = b * b - (ox * ox + oy * oy + oz * oz - BOUND * BOUND);
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  // The groove displacement makes the field steeper than a true distance, so steps are cut to 75%.
  for (let t = -b - s, i = 0; i < 80 && t < -b + s; i++) {
    const d = field(ox + dx * t, oy + dy * t, oz + dz * t);
    if (d < 0.003) return t;
    t += d * 0.75;
  }
  return null;
}

function normal(x, y, z) {
  const e = 0.003;
  const a = field(x + e, y - e, z - e), b = field(x - e, y - e, z + e);
  const c = field(x - e, y + e, z - e), d = field(x + e, y + e, z + e);
  const nx = a - b - c + d, ny = -a - b + c + d, nz = -a + b - c + d;
  const l = len(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

// Anatomy-chart colouring: each lobe takes its own spot on the palette. The frontal and
// occipital borders slant like the real central and parieto-occipital sulci.
export const LOBES = { frontal: 0, parietal: 0.33, temporal: 0.62, occipital: 1, cerebellum: 0.15, stem: 0.45 };

function lobe(y, z) {
  if (temporalD < hemiD + 0.01 && y < 0.02) return 'temporal';
  if (z > 0.12 - 0.25 * y) return 'frontal';
  if (z < -0.55 + 0.1 * y) return 'occipital';
  return 'parietal';
}

function shade(x, y, z, L, V, pulseZ) {
  const [nx, ny, nz] = normal(x, y, z);
  const cer = cerebrum(x, y, z), cbl = cerebellum(x, y, z), st = stem(x, y, z);
  const diff = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
  const rim = (1 - Math.abs(nx * V[0] + ny * V[1] + nz * V[2])) ** 3;
  let lum = 0.07 + 0.75 * diff + 0.3 * rim, part;
  if (cer <= cbl && cer <= st) {
    const fissure = Math.exp(-((x / 0.07) ** 2)) * clamp01((y + 0.1) * 4);
    lum *= Math.max(0, 1 - 0.7 * groove - 0.6 * fissure - 0.45 * crease);
    if (pulseZ != null) lum += 0.5 * Math.exp(-(((z - pulseZ) / 0.13) ** 2));
    part = lobe(y, z);
  } else if (cbl <= st) {
    lum *= 0.82 + 0.18 * Math.sin(y * 70);
    part = 'cerebellum';
  } else {
    lum *= 0.8;
    part = 'stem';
  }
  lum = clamp01(lum);
  return { ch: RAMP[Math.round(lum * (RAMP.length - 1))], lum, hue: LOBES[part], part, at: [x, y, z] };
}

// How much of the brain one cell spans. Terminal cells are about twice as tall as wide, so one
// cell spans H/rows across and 2H/rows down.
export function cellSize(cols, rows) {
  const H = Math.max(1.0, 2 * rows / cols);
  return { kx: H / rows, ky: 2 * H / rows };
}

// Returns rows × cols cells: null for background, else { ch, lum 0..1, hue 0..1, at }, where
// `at` is the spot on the brain the cell shows, before any turn.
// pulse (0..1) sweeps a band of light front to back, like a thought crossing the brain.
export function renderBrain({ cols, rows, angle = 0, tilt = TILT, pulse = null }) {
  const { kx, ky } = cellSize(cols, rows), yc = YC;
  const ca = Math.cos(-angle), sa = Math.sin(-angle), cb = Math.cos(-tilt), sb = Math.sin(-tilt);
  // View → local: undo the tilt (around x), then the spin (around y).
  const toLocal = (x, y, z) => {
    const y1 = y * cb - z * sb, z1 = y * sb + z * cb;
    return [x * ca + z1 * sa, y1, -x * sa + z1 * ca];
  };
  const [dx, dy, dz] = toLocal(0, 0, -1), L = toLocal(...LIGHT), V = toLocal(0, 0, 1);
  const pulseZ = pulse == null ? null : -1.1 + 2.2 * pulse;
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const [ox, oy, oz] = toLocal((c + 0.5 - cols / 2) * kx, yc - (r + 0.5 - rows / 2) * ky, 3);
      const t = march(ox, oy, oz, dx, dy, dz);
      row.push(t == null ? null : shade(ox + dx * t, oy + dy * t, oz + dz * t, L, V, pulseZ));
    }
    grid.push(row);
  }
  return grid;
}


// Words wrap the brain like print on a globe. Rings of words sit at even steps of height around
// the middle of the brain, spaced by how far round the brain is there. Each frame, every word
// that faces you is written whole at its spot, one letter per cell, so it always reads cleanly.
// The words turn with the brain. Near the edges they hide, and the plain shading keeps the shape.
const MIDDLE = [0, -0.1, -0.1];
const SPOKES = 360;
export const DOT = [92, 98, 116];
const CALM = '.:-=+*';

// How far out the surface is from the middle along one direction. It traces in from outside,
// so it finds the outer skin, not a fold inside.
function reach(dx, dy, dz) {
  let r = 1.7;
  for (let i = 0; i < 80 && r > 0; i++) {
    const d = outline(MIDDLE[0] + dx * r, MIDDLE[1] + dy * r, MIDDLE[2] + dz * r);
    if (d < 0.002) break;
    r -= Math.max(d * 0.75, 0.002);
  }
  return Math.max(r, 0);
}

// words: [{ name, color: [r, g, b] }]. Returns a function that writes the words that face you
// onto a renderBrain frame of the same size: (cells, { angle, tilt }) => cells.
export function wordSkin(words, { cols, rows }) {
  const { kx, ky } = cellSize(cols, rows);
  // One ring per row of cells, on a brain about 0.95 across from its middle.
  const step = ky / 0.95;
  const rings = [];
  for (let e = -Math.PI / 2; e <= Math.PI / 2 + 1e-9; e += step) {
    const R = new Float64Array(SPOKES + 1), S = new Float64Array(SPOKES + 1);
    let prev = null;
    for (let j = 0; j <= SPOKES; j++) {
      const a = -Math.PI + (2 * Math.PI * j) / SPOKES;
      const dir = [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
      R[j] = reach(...dir);
      const p = dir.map(v => v * R[j]);
      if (prev) S[j] = S[j - 1] + len(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
      prev = p;
    }
    rings.push({ e, R, S, n: Math.round(S[SPOKES] / kx) });
  }

  // The band that faces you takes the first words, so they sit in front. Each word is kept as
  // the spot under its middle letter and the way out from the brain there.
  const front = Math.round((0.3 + Math.PI / 2) / step);
  const order = rings.map((_, k) => k).sort((a, b) => Math.abs(a - front) - Math.abs(b - front));
  const placed = [];
  let w = 0;
  for (const k of order) {
    const { e, R, S, n } = rings[k], picked = [];
    let used = 0;
    while (words.length && picked.length < n) {
      const word = words[w % words.length], need = word.name.length + 3;
      if (used + need > n) break;
      picked.push(word);
      used += need;
      w++;
    }
    // The spare cells spread over the gaps, so no ring has a hole where its ends meet.
    const spare = n - used;
    let at = 0;
    picked.forEach((word, g) => {
      const s = ((at + word.name.length / 2) / n) * S[SPOKES];
      let j = 0;
      while (j < SPOKES - 1 && S[j + 1] < s) j++;
      const f = (s - S[j]) / (S[j + 1] - S[j] || 1), a = -Math.PI + (2 * Math.PI * (j + f)) / SPOKES;
      const out = [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
      const r = R[j] + (R[j + 1] - R[j]) * f;
      placed.push({ ...word, at: out.map((v, i) => MIDDLE[i] + v * r), out });
      at += word.name.length + 3 + Math.floor(spare / picked.length) + (g < spare % picked.length ? 1 : 0);
    });
  }

  return (cells, { angle = 0, tilt = TILT } = {}) => {
    const ca = Math.cos(angle), sa = Math.sin(angle), ct = Math.cos(tilt), st = Math.sin(tilt);
    // Brain → view: renderBrain's view → brain run backwards, the spin and then the tilt.
    const toView = ([x, y, z]) => {
      const z1 = -sa * x + ca * z;
      return [ca * x + sa * z, ct * y - st * z1, st * y + ct * z1];
    };
    // Between the words, the brain's own shading in dim grey and light strokes keeps its shape and
    // folds. It never lights up past 0.7, so the words stay the brightest thing on screen.
    const frame = cells.map(row => row.map(c => (c ? { ...c, ch: CALM[Math.round(c.lum * (CALM.length - 1))], rgb: DOT, lum: Math.min(c.lum, 0.7) } : null)));
    const shown = [];
    for (const word of placed) {
      const facing = toView(word.out)[2];
      if (facing < 0.25) continue;
      const [x, y] = toView(word.at);
      const r = Math.round((YC - y) / ky + rows / 2 - 0.5), c = Math.round(x / kx + cols / 2 - 0.5);
      const hit = cells[r]?.[c];
      // Behind another part of the brain, the cell there shows a different spot.
      if (!hit || len(hit.at[0] - word.at[0], hit.at[1] - word.at[1], hit.at[2] - word.at[2]) > 0.12) continue;
      shown.push({ word, r, start: c - ((word.name.length - 1) >> 1), facing });
    }
    // The words that face you most go first. A word that would run off the brain, or come
    // within two cells of a word already there, is left out: every word on screen is whole, and
    // two names never read as one.
    shown.sort((p, q) => q.facing - p.facing);
    const taken = new Set(), sides = [];
    for (const { word, r, start, facing } of shown) {
      const row = frame[r], letters = [...word.name];
      if (letters.some((_, i) => !row[start + i])) continue;
      let clear = true;
      for (let i = start - 2; i <= start + letters.length + 1; i++) if (taken.has(`${r},${i}`)) clear = false;
      if (!clear) continue;
      // One brightness for the whole word, from how squarely it faces you: its colour reads
      // evenly, and it dims as it turns away.
      const lum = 0.5 + 0.3 * facing;
      letters.forEach((ch, i) => {
        row[start + i] = { ...row[start + i], ch, rgb: word.color, lum };
        taken.add(`${r},${start + i}`);
      });
      sides.push([r, start - 1], [r, start + letters.length]);
    }
    // A blank cell each side keeps a word apart from the shading around it.
    for (const [r, i] of sides) if (frame[r][i] && !taken.has(`${r},${i}`)) frame[r][i] = null;
    return frame;
  };
}
