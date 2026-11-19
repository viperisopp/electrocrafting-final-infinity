// The procedural universe, generated on demand from a world seed.
//
// Two grids:
//  - cells (1 million ly): each cell's galaxies come from hash(cell, seed).
//  - supercells (SUPER cells = 100 million ly): decide the large-scale structure.
//    A smooth "cosmic web" noise field says where superclusters and voids are;
//    each supercell places galaxy groups and rich clusters where the web is dense,
//    and those raise the galaxy density of the cells around them.
// regionAt(pos) classifies where the ship is and returns the speed cap for it.

import { CELL, LY_PER_AU, delta, length, cellKey, normalize } from './coords.js';
import { mulberry32, hash, poisson } from './rng.js';
import { makeGalaxy, toGalaxyLocal, nearestStar } from './galaxy.js';

export const SUPER = 100; // cells per supercell edge
const FIELD_DENSITY = 0.002; // mean galaxies per cell outside groups
const GROUP_CANDIDATES = 70; // per supercell; most are rejected in voids
const BOOST_REACH = 7; // max cells a group's boost can spill past its supercell

export const CAPS = {
  solarSystem: 1 * LY_PER_AU, // ~1 AU/s
  starClump: 10,
  galaxy: 1e3,
  cluster: 1e5,
  void: 1e7, // also superclusters
};

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Speed cap that blends in log space from capIn (at d <= rIn) to capOut (at d >= rOut).
export function capBlend(d, rIn, rOut, capIn, capOut) {
  if (d <= rIn) return capIn;
  if (d >= rOut) return capOut;
  const t = Math.log(d / rIn) / Math.log(rOut / rIn);
  return Math.exp(Math.log(capIn) + (Math.log(capOut) - Math.log(capIn)) * t);
}

export class Universe {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.cells = new Map();
    this.supercells = new Map();
  }

  // ---- large-scale structure ----

  _noise(X, Y, Z, scale, salt) {
    const fx = X / scale, fy = Y / scale, fz = Z / scale;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    let tx = fx - ix, ty = fy - iy, tz = fz - iz;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    tz = tz * tz * (3 - 2 * tz);
    const v = (dx, dy, dz) => hash(this.seed, salt, ix + dx, iy + dy, iz + dz) / 4294967296;
    const x00 = v(0, 0, 0) + (v(1, 0, 0) - v(0, 0, 0)) * tx;
    const x10 = v(0, 1, 0) + (v(1, 1, 0) - v(0, 1, 0)) * tx;
    const x01 = v(0, 0, 1) + (v(1, 0, 1) - v(0, 0, 1)) * tx;
    const x11 = v(0, 1, 1) + (v(1, 1, 1) - v(0, 1, 1)) * tx;
    const y0 = x00 + (x10 - x00) * ty;
    const y1 = x01 + (x11 - x01) * ty;
    return y0 + (y1 - y0) * tz;
  }

  // Cosmic web density 0..1 at absolute light-year coordinates. High = supercluster, low = void.
  web(X, Y, Z) {
    const v = 0.68 * this._noise(X, Y, Z, 1.2e8, 11) + 0.32 * this._noise(X, Y, Z, 4e7, 12);
    return smoothstep(0.32, 0.72, v);
  }

  webAt(p) {
    return this.web(p.cx * CELL + p.x, p.cy * CELL + p.y, p.cz * CELL + p.z);
  }

  // Groups and rich clusters in one supercell, plus how much they raise each nearby cell's density.
  supercell(sx, sy, sz) {
    const key = cellKey(sx, sy, sz);
    let sc = this.supercells.get(key);
    if (sc) return sc;
    if (this.supercells.size > 3000) this.supercells.clear();

    const rng = mulberry32(hash(this.seed, 21, sx, sy, sz));
    const groups = [];
    const boost = new Map();
    for (let i = 0; i < GROUP_CANDIDATES; i++) {
      // Always draw the same number of values per candidate so results stay stable.
      const lx = rng() * SUPER, ly = rng() * SUPER, lz = rng() * SUPER;
      const rA = rng(), rB = rng(), rC = rng(), rD = rng();
      const w = this.web((sx * SUPER + lx) * CELL, (sy * SUPER + ly) * CELL, (sz * SUPER + lz) * CELL);
      if (rA >= w * w * w) continue;
      const rich = rB < 0.06 * w * w;
      const R = rich ? 2e6 + 3e6 * rC : 0.4e6 + 1.0e6 * rC;
      const N = rich ? Math.round(100 + 900 * rD * rD) : Math.round(3 + 40 * rD * rD * rD);
      const pos = normalize({ cx: sx * SUPER, cy: sy * SUPER, cz: sz * SUPER, x: lx * CELL, y: ly * CELL, z: lz * CELL });
      groups.push({ id: 'grp' + key + ':' + i, pos, R, N, rich });
      addBoost(boost, pos, R, N);
    }
    sc = { groups, boost };
    this.supercells.set(key, sc);
    return sc;
  }

  cellDensity(cx, cy, cz) {
    const web = this.web((cx + 0.5) * CELL, (cy + 0.5) * CELL, (cz + 0.5) * CELL);
    const sx = Math.floor(cx / SUPER), sy = Math.floor(cy / SUPER), sz = Math.floor(cz / SUPER);
    const lx = cx - sx * SUPER, ly = cy - sy * SUPER, lz = cz - sz * SUPER;
    const key = cellKey(cx, cy, cz);
    let boost = 0;
    for (let dx = -1; dx <= 1; dx++) {
      if ((dx < 0 && lx >= BOOST_REACH) || (dx > 0 && lx < SUPER - BOOST_REACH)) continue;
      for (let dy = -1; dy <= 1; dy++) {
        if ((dy < 0 && ly >= BOOST_REACH) || (dy > 0 && ly < SUPER - BOOST_REACH)) continue;
        for (let dz = -1; dz <= 1; dz++) {
          if ((dz < 0 && lz >= BOOST_REACH) || (dz > 0 && lz < SUPER - BOOST_REACH)) continue;
          const b = this.supercell(sx + dx, sy + dy, sz + dz).boost.get(key);
          if (b) boost += b;
        }
      }
    }
    const density = FIELD_DENSITY * (0.1 + 1.6 * web) + boost;
    return { density, boost, web };
  }

  // ---- cells and galaxies ----

  getCell(cx, cy, cz) {
    const key = cellKey(cx, cy, cz);
    let cell = this.cells.get(key);
    if (cell) return cell;
    if (this.cells.size > 250000) this.cells.clear();

    const { density, boost } = this.cellDensity(cx, cy, cz);
    const rng = mulberry32(hash(this.seed, 51, cx, cy, cz));
    const n = Math.min(poisson(rng, density), 80);
    const galaxies = [];
    for (let i = 0; i < n; i++) {
      const pos = { cx, cy, cz, x: rng() * CELL, y: rng() * CELL, z: rng() * CELL };
      galaxies.push(makeGalaxy(key + ':' + i, hash(this.seed, 52, cx, cy, cz, i), pos, boost / density));
    }
    cell = { density, galaxies };
    this.cells.set(key, cell);
    return cell;
  }

  // Galaxies in the cube of cells within `r` cells of pos, with distances.
  galaxiesNear(pos, r) {
    const out = [];
    for (let cx = pos.cx - r; cx <= pos.cx + r; cx++)
      for (let cy = pos.cy - r; cy <= pos.cy + r; cy++)
        for (let cz = pos.cz - r; cz <= pos.cz + r; cz++) {
          for (const g of this.getCell(cx, cy, cz).galaxies) out.push({ g, d: length(delta(pos, g.pos)) });
        }
    return out;
  }

  // Groups/clusters in the cube of supercells within `r` supercells of pos.
  groupsNear(pos, r) {
    const sx = Math.floor(pos.cx / SUPER), sy = Math.floor(pos.cy / SUPER), sz = Math.floor(pos.cz / SUPER);
    const out = [];
    for (let x = sx - r; x <= sx + r; x++)
      for (let y = sy - r; y <= sy + r; y++)
        for (let z = sz - r; z <= sz + r; z++) for (const g of this.supercell(x, y, z).groups) out.push(g);
    return out;
  }

  // ---- where am I? ----

  // Region name (solar system / star clump / galaxy / galaxy cluster / supercluster / void)
  // and the speed cap there. The cap falls off smoothly as you approach anything, so arriving feels like braking.
  regionAt(pos) {
    const web = this.webAt(pos);
    let name = web > 0.75 ? 'supercluster' : 'void';
    let cap = CAPS.void;

    let group = null;
    for (const g of this.groupsNear(pos, 1)) {
      const d = length(delta(pos, g.pos));
      if (d > 3 * g.R) continue;
      cap = Math.min(cap, capBlend(d, g.R, 3 * g.R, CAPS.cluster, CAPS.void));
      if (d < g.R && (!group || g.R < group.R)) group = g;
    }
    if (group) name = 'galaxy cluster';

    const galaxies = this.galaxiesNear(pos, 2);
    let host = null;
    let hostRatio = Infinity;
    let nearestGalaxy = null;
    for (const e of galaxies) {
      const { g, d } = e;
      cap = Math.min(cap, capBlend(d, g.R, Math.min(30 * g.R, 1.5e6), CAPS.galaxy, CAPS.void));
      if (!nearestGalaxy || d / g.R < nearestGalaxy.d / nearestGalaxy.g.R) nearestGalaxy = e;
      if (d < g.R && d / g.R < hostRatio) {
        host = g;
        hostRatio = d / g.R;
      }
    }

    let starDist = Infinity;
    if (host) {
      name = 'galaxy';
      const [a, b, c] = toGalaxyLocal(host, delta(host.pos, pos));
      const s = nearestStar(host, a, b, c);
      starDist = s.starDist;
      cap = Math.min(cap, capBlend(s.starDist, 50 * LY_PER_AU, 0.03, CAPS.solarSystem, CAPS.galaxy));
      if (s.clump) cap = Math.min(cap, capBlend(s.clumpDist, s.clump.r, 3 * s.clump.r, CAPS.starClump, CAPS.galaxy));
      if (s.clump && s.clumpDist < s.clump.r) name = 'star clump';
      if (s.starDist < 0.01) name = 'solar system';
    }

    return { name, cap, web, group, host, galaxies, nearestGalaxy, starDist };
  }
}

function addBoost(boost, pos, R, N) {
  const sigma = R / 2;
  const reach = Math.ceil(R / CELL) + 1;
  const entries = [];
  let sum = 0;
  for (let dx = -reach; dx <= reach; dx++)
    for (let dy = -reach; dy <= reach; dy++)
      for (let dz = -reach; dz <= reach; dz++) {
        const ex = (dx + 0.5) * CELL - pos.x;
        const ey = (dy + 0.5) * CELL - pos.y;
        const ez = (dz + 0.5) * CELL - pos.z;
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 > 4 * sigma * sigma && !(dx === 0 && dy === 0 && dz === 0)) continue;
        const w = Math.max(Math.exp(-d2 / (2 * sigma * sigma)), dx === 0 && dy === 0 && dz === 0 ? 1e-3 : 0);
        entries.push([cellKey(pos.cx + dx, pos.cy + dy, pos.cz + dz), w]);
        sum += w;
      }
  for (const [k, w] of entries) boost.set(k, (boost.get(k) || 0) + (N * w) / sum);
}
