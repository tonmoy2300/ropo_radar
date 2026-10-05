// Seeded pseudo-random numbers. Everything synthetic in Ropon Radar flows from here.

export const SEED = 42;

/** mulberry32 — tiny 32-bit PRNG, uniform in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a label, mixed with the seed, so sub-streams are independent. */
function mix(seed, label) {
  let h = 0x811c9dc5 ^ seed;
  for (const ch of String(label)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Random stream with helpers. `rng.sub("rain", "Kaunia", 2004)` returns an
 * independent child stream, so adding a new generator never reshuffles old ones.
 */
export function createRng(seed = SEED) {
  const next = mulberry32(seed);
  let spare = null;
  const rng = {
    seed,
    next,
    uniform: (a = 0, b = 1) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    chance: (p) => next() < p,
    exp: (mean) => -mean * Math.log(1 - next()),
    normal(mu = 0, sigma = 1) {
      if (spare !== null) {
        const z = spare;
        spare = null;
        return mu + sigma * z;
      }
      let u = 0;
      while (u === 0) u = next();
      const v = next();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return mu + sigma * r * Math.cos(2 * Math.PI * v);
    },
    sub: (...labels) => createRng(labels.reduce((h, l) => mix(h, l), seed)),
  };
  return rng;
}
