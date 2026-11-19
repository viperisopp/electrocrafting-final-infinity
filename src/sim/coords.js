// Positions are an integer cell index plus a precise offset inside the cell.
// Units are light years. Nothing here may import Three.js.

export const CELL = 1e6; // light years per cell
export const OBSERVABLE_RADIUS_LY = 46.5e9;
export const LY_PER_AU = 1.581e-5;

// position = { cx, cy, cz, x, y, z }  where 0 <= x,y,z < CELL
export function makePos(cx = 0, cy = 0, cz = 0, x = 0, y = 0, z = 0) {
  return normalize({ cx, cy, cz, x, y, z });
}

export function normalize(p) {
  for (const a of ['x', 'y', 'z']) {
    const c = 'c' + a;
    const shift = Math.floor(p[a] / CELL);
    if (shift !== 0) {
      p[c] += shift;
      p[a] -= shift * CELL;
    }
    // Floating-point rounding can leave an offset exactly at CELL or a hair below 0.
    if (p[a] >= CELL) {
      p[a] -= CELL;
      p[c] += 1;
    }
    if (p[a] < 0) p[a] = 0;
  }
  return p;
}

export function clone(p) {
  return { cx: p.cx, cy: p.cy, cz: p.cz, x: p.x, y: p.y, z: p.z };
}

// vector from a to b in light years (safe as long as they are within a few thousand cells)
export function delta(a, b) {
  return {
    x: (b.cx - a.cx) * CELL + (b.x - a.x),
    y: (b.cy - a.cy) * CELL + (b.y - a.y),
    z: (b.cz - a.cz) * CELL + (b.z - a.z),
  };
}

// Move p in place by a vector in light years.
export function translate(p, dx, dy, dz) {
  p.x += dx;
  p.y += dy;
  p.z += dz;
  return normalize(p);
}

// New position offset from p by a vector in light years.
export function offset(p, dx, dy, dz) {
  return translate(clone(p), dx, dy, dz);
}

// Absolute light-year coordinates (Earth at the origin) to a position.
export function fromLy(X, Y, Z) {
  return normalize({ cx: 0, cy: 0, cz: 0, x: X, y: Y, z: Z });
}

// Position to absolute light years. Lossy far from Earth (about 1e-5 ly at the edge); fine for noise and logging.
export function toLy(p) {
  return { x: p.cx * CELL + p.x, y: p.cy * CELL + p.y, z: p.cz * CELL + p.z };
}

export function length(v) {
  return Math.hypot(v.x, v.y, v.z);
}

export function cellKey(cx, cy, cz) {
  return cx + ',' + cy + ',' + cz;
}
