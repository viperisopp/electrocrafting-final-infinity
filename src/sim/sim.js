// Simulation core. Owns all state; never imports Three.js, input or UI code.

import { OBSERVABLE_RADIUS_LY, fromLy, offset, toLy, delta } from './coords.js';
import { mulberry32 } from './rng.js';
import { Universe } from './universe.js';
import { createShip, updateShip } from './ship.js';
import { createSession, updateSession } from './session.js';
import { createDirector, updateDirector } from './director.js';
import { qLookDir } from './vec.js';

// Uniform in volume: the cube root keeps starts from clustering near Earth.
export function randomStartPos(rng) {
  const R = OBSERVABLE_RADIUS_LY;
  const r = R * Math.cbrt(rng());
  const theta = 2 * Math.PI * rng();
  const phi = Math.acos(2 * rng() - 1);
  return fromLy(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi));
}

// Earth is at the universe origin. For console logging only; never shown on screen.
export function distanceFromEarthLy(pos) {
  const p = toLy(pos);
  return Math.hypot(p.x, p.y, p.z);
}

export function createSim({ worldSeed, startSeed }) {
  const universe = new Universe(worldSeed);
  const startRng = mulberry32(startSeed);
  const state = {
    worldSeed,
    elapsed: 0,
    ship: createShip(randomStartPos(startRng)),
    region: null,
    session: createSession(),
    director: createDirector(),
  };
  state.region = universe.regionAt(state.ship.pos);

  function place(pos, lookAt) {
    state.ship = createShip(pos, lookAt ? qLookDir(lookAt) : state.ship.q);
    state.region = universe.regionAt(state.ship.pos);
  }

  return {
    state,
    universe,

    update(dt, controls) {
      state.elapsed += dt;
      state.region = universe.regionAt(state.ship.pos);
      updateShip(state.ship, dt, controls, state.region.cap);
      updateDirector(state.director, dt, state);
      updateSession(state.session, dt, controls, state);
    },

    newRandomStart() {
      state.elapsed = 0;
      place(randomStartPos(startRng));
    },

    // ---- dev helpers (keyboard only) ----

    // Fly to a viewpoint 3 radii from the biggest galaxy of the nearest group.
    devJumpToGalaxy(inside = false) {
      const g = biggestGalaxyNear(universe, state.ship.pos);
      if (!g) return null;
      if (inside) {
        // In the disk at ~55% of the radius, looking toward the core.
        const r = (g.type === 'spiral' ? 0.55 : 0.3) * g.R;
        const p = offset(g.pos, g.u[0] * r, g.u[1] * r, g.u[2] * r);
        place(p, [-g.u[0], -g.u[1], -g.u[2]]);
      } else {
        // Inclined view so spirals show their face.
        const dir = [0.6 * g.n[0] + 0.8 * g.u[0], 0.6 * g.n[1] + 0.8 * g.u[1], 0.6 * g.n[2] + 0.8 * g.u[2]];
        const r = 3 * g.R;
        const p = offset(g.pos, dir[0] * r, dir[1] * r, dir[2] * r);
        place(p, [-dir[0], -dir[1], -dir[2]]);
      }
      return g;
    },

    devJumpToCluster() {
      const groups = universe.groupsNear(state.ship.pos, 2).filter((g) => g.rich);
      if (!groups.length) return null;
      groups.sort((a, b) => dist(state.ship.pos, a.pos) - dist(state.ship.pos, b.pos));
      const g = groups[0];
      const p = offset(g.pos, 0, 0, 2 * g.R);
      place(p, [0, 0, -1]);
      return g;
    },
  };
}

function dist(a, b) {
  const d = delta(a, b);
  return Math.hypot(d.x, d.y, d.z);
}

function biggestGalaxyNear(universe, pos) {
  const groups = universe.groupsNear(pos, 1);
  groups.sort((a, b) => dist(pos, a.pos) - dist(pos, b.pos));
  for (const grp of groups.slice(0, 10)) {
    let best = null;
    // Prefer spirals: they show the most structure.
    const score = (g) => g.R * (g.type === 'spiral' ? 10 : 1);
    for (const { g } of universe.galaxiesNear(grp.pos, 1)) if (!best || score(g) > score(best)) best = g;
    if (best) return best;
  }
  return null;
}
