// Детерминированный генератор случайных чисел + шум для процедурной генерации.

/** mulberry32 — быстрый seed-based PRNG. */
export function makeRng(seed) {
  let a = seed >>> 0;
  const r = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.int = (min, max) => min + ((r() * (max - min + 1)) | 0);
  r.range = (min, max) => min + r() * (max - min);
  r.chance = (p) => r() < p;
  r.pick = (arr) => arr[(r() * arr.length) | 0];
  r.sign = () => (r() < 0.5 ? -1 : 1);
  return r;
}

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);

/** Value-noise 2D в диапазоне 0..1 */
export function noise2(x, y, seed = 1) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = fade(x - xi), yf = fade(y - yi);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return (a + (b - a) * xf) * (1 - yf) + (c + (d - c) * xf) * yf;
}

/** Фрактальный шум (сумма октав), 0..1 */
export function fbm(x, y, seed = 1, octaves = 4, lac = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq, seed + i * 977);
    norm += amp;
    amp *= gain; freq *= lac;
  }
  return sum / norm;
}

/**
 * Шум с искажением области. Обычный value-noise даёт пятна, выровненные по
 * решётке — на больших масштабах это читается как прямоугольные блоки.
 * Сдвигая координаты другим шумом, решётку «ломаем».
 */
export function warpFbm(x, y, seed = 1, octaves = 4, warp = 18) {
  const wx = x + (fbm(x * 1.7, y * 1.7, seed + 4111, 2) - 0.5) * warp;
  const wy = y + (fbm(x * 1.7 + 31, y * 1.7 + 17, seed + 8221, 2) - 0.5) * warp;
  return fbm(wx, wy, seed, octaves);
}

/** Клеточный шум: расстояние до ближайшей точки — красивые пятна и прожилки. */
export function worley(x, y, seed = 1) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let best = 9;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = xi + ox, cy = yi + oy;
      const px = cx + hash2(cx, cy, seed);
      const py = cy + hash2(cx, cy, seed + 7919);
      const d = Math.hypot(px - x, py - y);
      if (d < best) best = d;
    }
  }
  return Math.min(1, best);
}
