// One galaxy: its shape, its star density, its stars (generated in chunks on demand)
// and a coarse "cloud" of glow blobs used to draw it from nearby.
//
// Galaxy-local coordinates (a, b, c): a and b lie in the disk plane, c is along the normal n.
// world offset from the galaxy center = a*u + b*v + c*n

import { mulberry32, hash, poisson, gaussian, randomUnit } from './rng.js';
import { cross, normalize3 } from './vec.js';

export const CHUNK = 20; // light years per star chunk edge
const MAX_STARS_PER_CHUNK = 220;
export const LY_PER_SUN_RADIUS = 7.354e-8;

// Rough main-sequence mix by number (Kroupa-ish), luminosity and radius in solar units.
const STAR_TYPES = [
  { p: 0.7645, L: [0.0008, 0.08], R: [0.1, 0.6], c: [1.0, 0.62, 0.42] }, // M
  { p: 0.121, L: [0.08, 0.6], R: [0.7, 0.96], c: [1.0, 0.82, 0.62] }, // K
  { p: 0.076, L: [0.6, 1.5], R: [0.96, 1.15], c: [1.0, 0.96, 0.88] }, // G
  { p: 0.03, L: [1.5, 5], R: [1.15, 1.4], c: [0.97, 0.97, 1.0] }, // F
  { p: 0.006, L: [5, 25], R: [1.4, 1.8], c: [0.8, 0.87, 1.0] }, // A
  { p: 0.0013, L: [25, 30000], R: [1.8, 6.6], c: [0.67, 0.75, 1.0] }, // B
  { p: 1, L: [30000, 1e6], R: [6.6, 15], c: [0.6, 0.7, 1.0] }, // O (catch-all)
];

const TYPE_LOOK = {
  spiral: { color: [0.82, 0.87, 1.0], sb: 1.0 },
  elliptical: { color: [1.0, 0.86, 0.68], sb: 0.9 },
  dwarf: { color: [0.9, 0.9, 1.0], sb: 0.35 },
};

const logLerp = (lo, hi, t) => Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * t);

// env: fraction of the local density that comes from a group or cluster (0..1)
export function makeGalaxy(id, seed, pos, env) {
  const rng = mulberry32(seed);
  const ellFrac = env > 0.5 ? 0.3 : 0.08;
  const t = rng();
  const type = t < 0.55 ? 'dwarf' : t < 0.55 + ellFrac ? 'elliptical' : 'spiral';
  let R;
  if (type === 'dwarf') R = 2000 + 6000 * rng();
  else if (type === 'spiral') R = 25000 + 65000 * rng();
  else R = 20000 + 130000 * rng() * rng();
  const n = randomUnit(rng);
  const ref = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize3(cross(n, ref));
  const v = cross(n, u);
  const arms = 2 + Math.floor(rng() * 3);
  const twist = 2.2 + 2 * rng();
  const flat = type === 'elliptical' ? 0.55 + 0.45 * rng() : type === 'dwarf' ? 0.6 + 0.4 * rng() : 1;
  const look = TYPE_LOOK[type];
  return { id, seed: hash(seed, 7), pos, type, R, n, u, v, arms, twist, flat, color: look.color, sb: look.sb, chunks: null, cloud: null };
}

export function toGalaxyLocal(g, d) {
  return [
    d.x * g.u[0] + d.y * g.u[1] + d.z * g.u[2],
    d.x * g.v[0] + d.y * g.v[1] + d.z * g.v[2],
    d.x * g.n[0] + d.y * g.n[1] + d.z * g.n[2],
  ];
}

export function fromGalaxyLocal(g, a, b, c, out, i) {
  out[i] = a * g.u[0] + b * g.v[0] + c * g.n[0];
  out[i + 1] = a * g.u[1] + b * g.v[1] + c * g.n[1];
  out[i + 2] = a * g.u[2] + b * g.v[2] + c * g.n[2];
}

// Stars per cubic light year. Tuned so a Milky-Way-sized spiral gives ~0.003/ly³ at the Sun's radius.
export function galaxyDensity(g, a, b, c) {
  const R = g.R;
  if (g.type === 'spiral') {
    const r = Math.hypot(a, b);
    if (r > 1.4 * R) return 0;
    const h = R / 5;
    const hz = R * 0.006;
    const r0 = 0.05 * R;
    const phase = g.arms * (Math.atan2(b, a) - g.twist * Math.log(1 + r / r0));
    const armF = Math.pow(0.5 + 0.5 * Math.cos(phase), 4);
    const disk = Math.exp(-r / h - Math.abs(c) / hz) * (0.3 + 1.6 * armF);
    const bs = 0.07 * R;
    const bulge = 3 * Math.exp(-(r * r + c * c) / (2 * bs * bs));
    return 0.054 * (disk + bulge);
  }
  const aP = (g.type === 'elliptical' ? 0.12 : 0.25) * R;
  const K = g.type === 'elliptical' ? 0.1 : 0.01;
  const cc = c / g.flat;
  const d2 = a * a + b * b + cc * cc;
  if (d2 > 2.25 * R * R) return 0;
  return K * Math.pow(1 + d2 / (aP * aP), -2.5);
}

function pickStarType(rng) {
  let x = rng();
  for (const t of STAR_TYPES) {
    if (x < t.p) return t;
    x -= t.p;
  }
  return STAR_TYPES[STAR_TYPES.length - 1];
}

// Stars in chunk (i, j, k) of the galaxy-local grid. Positions are galaxy-local (a, b, c).
export function starChunk(g, i, j, k) {
  if (!g.chunks) g.chunks = new Map();
  const key = i + ',' + j + ',' + k;
  let ch = g.chunks.get(key);
  if (ch) return ch;
  if (g.chunks.size > 30000) g.chunks.clear();

  const rng = mulberry32(hash(g.seed, 31, i, j, k));
  const ca = (i + 0.5) * CHUNK;
  const cb = (j + 0.5) * CHUNK;
  const cc = (k + 0.5) * CHUNK;
  const rho = galaxyDensity(g, ca, cb, cc);
  const n = Math.min(poisson(rng, rho * CHUNK * CHUNK * CHUNK), MAX_STARS_PER_CHUNK);

  let clump = null;
  let extra = 0;
  if (g.type !== 'elliptical' && rho > 1e-4 && rng() < Math.min(0.05, rho * 3)) {
    clump = { a: ca + (rng() - 0.5) * CHUNK, b: cb + (rng() - 0.5) * CHUNK, c: cc + (rng() - 0.5) * CHUNK, r: 3 + 9 * rng() };
    extra = Math.min(40 + Math.floor(rng() * 220), MAX_STARS_PER_CHUNK);
  }

  const count = n + extra;
  const pos = new Float64Array(count * 3);
  const lum = new Float32Array(count);
  const rad = new Float32Array(count);
  const col = new Float32Array(count * 3);
  for (let s = 0; s < count; s++) {
    if (s < n) {
      pos[s * 3] = ca + (rng() - 0.5) * CHUNK;
      pos[s * 3 + 1] = cb + (rng() - 0.5) * CHUNK;
      pos[s * 3 + 2] = cc + (rng() - 0.5) * CHUNK;
    } else {
      const sig = clump.r / 2;
      pos[s * 3] = clump.a + gaussian(rng) * sig;
      pos[s * 3 + 1] = clump.b + gaussian(rng) * sig;
      pos[s * 3 + 2] = clump.c + gaussian(rng) * sig;
    }
    const t = pickStarType(rng);
    const f = rng();
    lum[s] = logLerp(t.L[0], t.L[1], f);
    rad[s] = t.R[0] + (t.R[1] - t.R[0]) * f;
    col[s * 3] = t.c[0];
    col[s * 3 + 1] = t.c[1];
    col[s * 3 + 2] = t.c[2];
  }
  ch = { count, pos, lum, rad, col, clump };
  g.chunks.set(key, ch);
  return ch;
}

// Nearest star and star clump to a galaxy-local point (searches the surrounding 3x3x3 chunks).
export function nearestStar(g, a, b, c) {
  const i0 = Math.floor(a / CHUNK);
  const j0 = Math.floor(b / CHUNK);
  const k0 = Math.floor(c / CHUNK);
  let starDist = Infinity;
  let clumpRatio = Infinity;
  let clump = null;
  for (let i = i0 - 1; i <= i0 + 1; i++)
    for (let j = j0 - 1; j <= j0 + 1; j++)
      for (let k = k0 - 1; k <= k0 + 1; k++) {
        const ch = starChunk(g, i, j, k);
        const p = ch.pos;
        for (let s = 0; s < ch.count; s++) {
          const d = Math.hypot(p[s * 3] - a, p[s * 3 + 1] - b, p[s * 3 + 2] - c);
          if (d < starDist) starDist = d;
        }
        if (ch.clump) {
          const cl = ch.clump;
          const ratio = Math.hypot(cl.a - a, cl.b - b, cl.c - c) / cl.r;
          if (ratio < clumpRatio) {
            clumpRatio = ratio;
            clump = cl;
          }
        }
      }
  return { starDist, clump, clumpDist: clump ? clumpRatio * clump.r : Infinity };
}

// Glow blobs that stand in for the galaxy's billions of stars when seen from nearby.
// Positions are world-oriented offsets from the galaxy center.
export function galaxyCloud(g, N = 24000) {
  if (g.cloud) return g.cloud;
  const rng = mulberry32(hash(g.seed, 41));
  const R = g.R;
  const pos = new Float64Array(N * 3);
  const size = new Float32Array(N);
  const sb = new Float32Array(N);
  const col = new Float32Array(N * 3);
  const setCol = (i, r, gg, b) => {
    col[i * 3] = r;
    col[i * 3 + 1] = gg;
    col[i * 3 + 2] = b;
  };
  for (let i = 0; i < N; i++) {
    let a, b, c;
    if (g.type === 'spiral') {
      if (rng() < 0.16) {
        const s = 0.07 * R;
        a = gaussian(rng) * s;
        b = gaussian(rng) * s;
        c = gaussian(rng) * s * 0.7;
        size[i] = R * 0.025;
        sb[i] = 0.3;
        setCol(i, 1.0, 0.85, 0.62);
      } else {
        const h = R / 5;
        let r;
        do r = -h * Math.log(rng() * rng() + 1e-12);
        while (r > 1.35 * R);
        const onArm = rng() < 0.7;
        const theta = onArm
          ? (2 * Math.PI * Math.floor(rng() * g.arms)) / g.arms + g.twist * Math.log(1 + r / (0.05 * R)) + gaussian(rng) * 0.22
          : rng() * 2 * Math.PI;
        a = r * Math.cos(theta);
        b = r * Math.sin(theta);
        c = (rng() < 0.5 ? -1 : 1) * -Math.log(rng() + 1e-12) * R * 0.006 * 3;
        size[i] = R * (0.008 + 0.018 * rng());
        sb[i] = onArm ? 0.5 : 0.3;
        if (onArm && rng() < 0.06) setCol(i, 1.0, 0.55, 0.7);
        else if (onArm) setCol(i, 0.75, 0.85, 1.0);
        else setCol(i, 1.0, 0.9, 0.78);
      }
    } else {
      const aP = (g.type === 'elliptical' ? 0.12 : 0.25) * R;
      let r;
      do r = aP / Math.sqrt(Math.pow(rng() + 1e-9, -2 / 3) - 1);
      while (r > 1.5 * R);
      const d = randomUnit(rng);
      a = d[0] * r;
      b = d[1] * r;
      c = d[2] * r * g.flat;
      size[i] = R * 0.02;
      sb[i] = g.type === 'elliptical' ? 0.25 : 0.4;
      if (g.type === 'elliptical') setCol(i, 1.0, 0.86, 0.68);
      else setCol(i, 0.88, 0.9, 1.0);
    }
    fromGalaxyLocal(g, a, b, c, pos, i * 3);
  }
  g.cloud = { count: N, pos, size, sb, col };
  return g.cloud;
}
