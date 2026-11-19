// Level of detail by scale, all drawn from sim data:
//  clusters  - galaxy groups and rich clusters out to ~200 million ly (rebuilt per supercell)
//  galaxies  - one sprite per galaxy within ~12 million ly (rebuilt per cell)
//  clouds    - glow blobs for up to 3 galaxies you are close to (crossfades with their sprites)
//  stars     - individual stars around the ship while inside a galaxy (rebuilt per 20 ly chunk)

import { delta, length } from '../sim/coords.js';
import { SUPER } from '../sim/universe.js';
import { CHUNK, LY_PER_SUN_RADIUS, starChunk, galaxyCloud, toGalaxyLocal, fromGalaxyLocal } from '../sim/galaxy.js';
import { PointLayer } from './pointLayer.js';

const GALAXY_RADIUS_CELLS = 13;
const CLUSTER_RADIUS_SUPER = 2;
const STAR_RADIUS_CHUNKS = 3;
const MAX_CLOUDS = 3;

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createStarfield(scene, universe) {
  const clusters = new PointLayer(scene, { capacity: 40000, gain: 1.2, minPx: 1.5, maxPx: 220, nearA: 0.4, nearB: 1.5, farA: 1.4e8, farB: 1.9e8 });
  const galaxies = new PointLayer(scene, { capacity: 20000, gain: 0.9, minPx: 1.5, maxPx: 160, nearA: 8, nearB: 16, farA: 9e6, farB: 11.5e6 });
  const clouds = [];
  for (let i = 0; i < MAX_CLOUDS; i++) clouds.push({ layer: new PointLayer(scene, { capacity: 24000, gain: 0.12, minPx: 1.2, maxPx: 300, nearA: 0.7, nearB: 3 }), galaxy: null });
  const stars = new PointLayer(scene, { capacity: 160000, cpu: true, gain: 2e10, minPx: 1.6, maxPx: 14, farA: 45, farB: 60 });

  let clusterKey = null;
  let galaxyAnchor = null;
  let starKey = null;
  const stats = { clusters: 0, galaxies: 0, clouds: 0, stars: 0 };

  function rebuildClusters(ship) {
    clusters.begin(ship);
    for (const g of universe.groupsNear(ship, CLUSTER_RADIUS_SUPER)) {
      const d = delta(ship, g.pos);
      const sb = (0.012 * g.N) / ((g.R / 1e6) * (g.R / 1e6));
      if (g.rich) clusters.push(d.x, d.y, d.z, 1.0, 0.9, 0.78, g.R, sb);
      else clusters.push(d.x, d.y, d.z, 0.85, 0.88, 1.0, g.R, sb);
    }
    clusters.end();
    stats.clusters = clusters.count;
  }

  function rebuildGalaxies(ship) {
    const anchor = { cx: ship.cx, cy: ship.cy, cz: ship.cz, x: 0, y: 0, z: 0 };
    galaxies.begin(anchor);
    const R = GALAXY_RADIUS_CELLS;
    for (let dx = -R; dx <= R; dx++)
      for (let dy = -R; dy <= R; dy++)
        for (let dz = -R; dz <= R; dz++) {
          if (dx * dx + dy * dy + dz * dz > (R + 0.5) * (R + 0.5)) continue;
          for (const g of universe.getCell(ship.cx + dx, ship.cy + dy, ship.cz + dz).galaxies) {
            const d = delta(anchor, g.pos);
            galaxies.push(d.x, d.y, d.z, g.color[0], g.color[1], g.color[2], g.R, g.sb);
          }
        }
    galaxies.end();
    galaxyAnchor = anchor;
    stats.galaxies = galaxies.count;
  }

  function fillCloud(slot, g) {
    const c = galaxyCloud(g);
    const L = slot.layer;
    L.begin(g.pos);
    for (let i = 0; i < c.count; i++) L.push(c.pos[i * 3], c.pos[i * 3 + 1], c.pos[i * 3 + 2], c.col[i * 3], c.col[i * 3 + 1], c.col[i * 3 + 2], c.size[i], c.sb[i]);
    L.end();
    slot.galaxy = g;
  }

  function updateClouds(ship, region) {
    const want = region.galaxies
      .filter(({ g, d }) => d < Math.min(20 * g.R, 1.9e6))
      .sort((a, b) => a.d / a.g.R - b.d / b.g.R)
      .slice(0, MAX_CLOUDS);
    const wantIds = new Set(want.map((e) => e.g.id));
    for (const slot of clouds) if (slot.galaxy && !wantIds.has(slot.galaxy.id)) slot.galaxy = null;
    for (const { g } of want) {
      if (clouds.some((s) => s.galaxy && s.galaxy.id === g.id)) continue;
      const free = clouds.find((s) => !s.galaxy);
      if (free) fillCloud(free, g);
    }
    stats.clouds = 0;
    for (const slot of clouds) {
      if (!slot.galaxy) {
        slot.layer.opacity = 0;
        continue;
      }
      const g = slot.galaxy;
      const d = length(delta(ship, g.pos));
      slot.layer.opacity = 1 - smoothstep(10 * g.R, 20 * g.R, d);
      stats.clouds++;
    }
  }

  function rebuildStars(host, i0, j0, k0) {
    stars.begin(host.pos);
    const R = STAR_RADIUS_CHUNKS;
    const tmp = [0, 0, 0];
    for (let i = i0 - R; i <= i0 + R; i++)
      for (let j = j0 - R; j <= j0 + R; j++)
        for (let k = k0 - R; k <= k0 + R; k++) {
          const di = i - i0, dj = j - j0, dk = k - k0;
          if (di * di + dj * dj + dk * dk > (R + 0.5) * (R + 0.5)) continue;
          const ch = starChunk(host, i, j, k);
          for (let s = 0; s < ch.count; s++) {
            fromGalaxyLocal(host, ch.pos[s * 3], ch.pos[s * 3 + 1], ch.pos[s * 3 + 2], tmp, 0);
            const rad = ch.rad[s];
            if (!stars.push(tmp[0], tmp[1], tmp[2], ch.col[s * 3], ch.col[s * 3 + 1], ch.col[s * 3 + 2], rad * LY_PER_SUN_RADIUS, ch.lum[s] / (rad * rad))) break;
          }
        }
    stars.end();
    stats.stars = stars.count;
  }

  function updateStars(ship, region, speed) {
    // Individual stars only make sense at star-scale speeds; above that the cloud carries the view.
    const fade = 1 - smoothstep(Math.log10(40), Math.log10(900), Math.log10(Math.max(speed, 1e-9)));
    const host = region.host;
    if (!host || fade <= 0) {
      stars.opacity = 0;
      if (!host) {
        starKey = null;
        stars.clear();
        stats.stars = 0;
      }
      return;
    }
    const [a, b, c] = toGalaxyLocal(host, delta(host.pos, ship));
    const i0 = Math.floor(a / CHUNK), j0 = Math.floor(b / CHUNK), k0 = Math.floor(c / CHUNK);
    const key = host.id + ':' + i0 + ',' + j0 + ',' + k0;
    if (key !== starKey) {
      rebuildStars(host, i0, j0, k0);
      starKey = key;
    }
    stars.opacity = fade;
  }

  return {
    stats,
    update(state, pxPerRad) {
      const ship = state.ship.pos;
      const sKey = Math.floor(ship.cx / SUPER) + ',' + Math.floor(ship.cy / SUPER) + ',' + Math.floor(ship.cz / SUPER);
      if (sKey !== clusterKey) {
        rebuildClusters(ship);
        clusterKey = sKey;
      }
      if (!galaxyAnchor || Math.max(Math.abs(ship.cx - galaxyAnchor.cx), Math.abs(ship.cy - galaxyAnchor.cy), Math.abs(ship.cz - galaxyAnchor.cz)) >= 1) {
        rebuildGalaxies(ship);
      }
      updateClouds(ship, state.region);
      updateStars(ship, state.region, state.ship.speed);

      clusters.update(ship, pxPerRad);
      galaxies.update(ship, pxPerRad);
      for (const slot of clouds) slot.layer.update(ship, pxPerRad);
      stars.update(ship, pxPerRad);
    },
    // Forget everything (after a teleport).
    reset() {
      clusterKey = null;
      galaxyAnchor = null;
      starKey = null;
      for (const slot of clouds) slot.galaxy = null;
    },
  };
}

