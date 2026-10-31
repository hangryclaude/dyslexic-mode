// A procedural 3D brain, ray-marched once per terminal cell. Pure: same input, same frame.
// Local axes: x right, y up, z forward (frontal lobe at +z, cerebellum at -z).

const BOUND = 1.35;
const RAMP = '.:-=+*#%@';
const F1 = 4.2, F2 = 9.1;
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

function cerebrum(x, y, z) {
  // |x| mirrors one hemisphere into two; the fold at x = 0 is the longitudinal fissure.
  const ax = Math.abs(x), yy = y < 0 ? y * 1.3 : y;
  const hemi = ellipsoid(ax - 0.2, yy - 0.05, z, 0.58 + 0.05 * Math.max(0, -z), 0.62, 0.95);
  const temporal = ellipsoid(ax - 0.55, y + 0.3, z - 0.1, 0.3, 0.27, 0.52);
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
  return { ch: RAMP[Math.round(lum * (RAMP.length - 1))], lum, hue: LOBES[part], part };
}

// Returns rows × cols cells: null for background, else { ch, lum 0..1, hue 0..1 }.
// pulse (0..1) sweeps a band of light front to back, like a thought crossing the brain.
export function renderBrain({ cols, rows, angle = 0, tilt = 0.42, pulse = null }) {
  // Terminal cells are about twice as tall as wide, so one cell spans H/rows across and 2H/rows down.
  const H = Math.max(1.0, 2 * rows / cols), kx = H / rows, ky = 2 * H / rows, yc = -0.15;
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
