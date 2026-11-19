// Seeded randomness. The same inputs always give the same universe, so nothing has to be stored.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// murmur3-style hash of a seed and any number of integers -> uint32
export function hash(seed, ...ints) {
  let h = (seed | 0) ^ 0x9e3779b9;
  for (let i = 0; i < ints.length; i++) {
    let k = Math.imul(ints[i] | 0, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= ints.length;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// The signature named in PLAN.md.
export function hashCell(cx, cy, cz, seed) {
  return hash(seed, cx, cy, cz);
}

export function gaussian(rng) {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}

export function poisson(rng, mean) {
  if (mean <= 0) return 0;
  if (mean < 30) {
    const L = Math.exp(-mean);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rng();
    } while (p > L);
    return k - 1;
  }
  return Math.max(0, Math.round(mean + Math.sqrt(mean) * gaussian(rng)));
}

export function randomUnit(rng) {
  const z = 2 * rng() - 1;
  const t = 2 * Math.PI * rng();
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(t), r * Math.sin(t), z];
}
