import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL, OBSERVABLE_RADIUS_LY, makePos, normalize, delta, offset, clone, translate } from '../src/sim/coords.js';
import { mulberry32 } from '../src/sim/rng.js';
import { Universe, CAPS } from '../src/sim/universe.js';
import { createSim, randomStartPos, distanceFromEarthLy } from '../src/sim/sim.js';

test('normalize keeps offsets inside the cell', () => {
  const p = normalize({ cx: 0, cy: 0, cz: 0, x: 2.5e6, y: -1, z: -3.5e6 });
  assert.deepEqual([p.cx, p.cy, p.cz], [2, -1, -4]);
  for (const a of ['x', 'y', 'z']) assert.ok(p[a] >= 0 && p[a] < CELL);
});

test('delta and offset round-trip', () => {
  const rng = mulberry32(1);
  for (let i = 0; i < 1000; i++) {
    const a = makePos(Math.floor(rng() * 90000 - 45000), 7, -3, rng() * CELL, rng() * CELL, rng() * CELL);
    const v = { x: (rng() - 0.5) * 4e9, y: (rng() - 0.5) * 1e3, z: (rng() - 0.5) * 1e-4 };
    const b = offset(a, v.x, v.y, v.z);
    const d = delta(a, b);
    assert.ok(Math.abs(d.x - v.x) < 1e-5 && Math.abs(d.y - v.y) < 1e-8 && Math.abs(d.z - v.z) < 1e-9, JSON.stringify({ d, v }));
    const back = delta(b, a);
    assert.ok(Math.abs(back.x + v.x) < 1e-5);
  }
});

test('small steps are not lost far from Earth (1 AU/s at 60 fps)', () => {
  const p = makePos(46000, 0, 0, 999999.5, 0, 0);
  const start = clone(p);
  const step = 1.581e-5 / 60;
  for (let i = 0; i < 600; i++) translate(p, step, 0, 0);
  assert.ok(Math.abs(delta(start, p).x - 600 * step) / (600 * step) < 1e-3);
});

test('random starts are uniform in volume and inside the observable universe', () => {
  const rng = mulberry32(42);
  let inner = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) {
    const r = distanceFromEarthLy(randomStartPos(rng));
    assert.ok(r <= OBSERVABLE_RADIUS_LY * 1.000001);
    if (r < OBSERVABLE_RADIUS_LY / 2) inner++;
  }
  // inner half-radius holds 1/8 of the volume
  assert.ok(Math.abs(inner / n - 0.125) < 0.01, `inner fraction ${inner / n}`);
});

test('the same seed gives the same universe, in any visiting order', () => {
  const a = new Universe(7);
  const b = new Universe(7);
  const cells = [];
  const rng = mulberry32(3);
  for (let i = 0; i < 300; i++) cells.push([Math.floor(rng() * 400), Math.floor(rng() * 400), Math.floor(rng() * 400)]);
  const sig = (u, list) => list.map(([x, y, z]) => u.getCell(x, y, z).galaxies.map((g) => `${g.type}${g.R.toFixed(3)}${g.pos.x.toFixed(3)}`).join('|'));
  const first = sig(a, cells);
  const second = sig(b, [...cells].reverse()).reverse();
  assert.deepEqual(first, second);
  a.cells.clear();
  a.supercells.clear();
  assert.deepEqual(sig(a, cells), first);
});

test('galaxy density is plausible (mostly empty cells)', () => {
  const u = new Universe(11);
  let n = 0;
  let empty = 0;
  const cells = 20000;
  const rng = mulberry32(5);
  for (let i = 0; i < cells; i++) {
    const c = u.getCell(Math.floor(rng() * 5000), Math.floor(rng() * 5000), Math.floor(rng() * 5000));
    n += c.galaxies.length;
    if (!c.galaxies.length) empty++;
  }
  console.log(`  mean galaxies per 1 Mly cell: ${(n / cells).toFixed(4)}, empty: ${((100 * empty) / cells).toFixed(1)}%`);
  assert.ok(n / cells > 0.0005 && n / cells < 0.05);
  assert.ok(empty / cells > 0.9);
});

test('regionAt gives the right tiers when jumping into a galaxy', () => {
  const sim = createSim({ worldSeed: 20261119, startSeed: 9 });
  assert.ok(sim.state.region.cap > 0);
  const g = sim.devJumpToGalaxy(true);
  assert.ok(g, 'found a galaxy');
  const r = sim.state.region;
  assert.ok(['galaxy', 'star clump', 'solar system'].includes(r.name), r.name);
  assert.ok(r.cap <= CAPS.galaxy);
  sim.devJumpToGalaxy(false);
  assert.ok(sim.state.region.cap > CAPS.galaxy && sim.state.region.cap < CAPS.void);
});

test('flying out and back returns to the same galaxies', () => {
  const sim = createSim({ worldSeed: 1, startSeed: 2 });
  const start = clone(sim.state.ship.pos);
  const before = sim.universe.galaxiesNear(start, 2).map((e) => e.g.id).sort();
  const controls = { pitch: 0, yaw: 0, button: true };
  for (let i = 0; i < 60 * 30; i++) sim.update(1 / 60, controls);
  assert.ok(Math.hypot(...Object.values(delta(start, sim.state.ship.pos))) > 1e7, 'travelled far');
  const after = new Universe(1).galaxiesNear(start, 2).map((e) => e.g.id).sort();
  assert.deepEqual(after, before);
});
