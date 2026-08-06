// Мелкие математические и вспомогательные функции, используемые повсюду.

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const inv = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smooth = (t) => t * t * (3 - 2 * t);
export const sign = Math.sign;

export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export const dist2 = (ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
};
export const angle = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);

/** Кратчайшая разница между углами в диапазоне (-PI, PI]. */
export function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Плавно тянет значение к цели с фиксированной скоростью. */
export function approach(v, target, step) {
  if (v < target) return Math.min(v + step, target);
  if (v > target) return Math.max(v - step, target);
  return target;
}

/** Экспоненциальное сглаживание, независимое от частоты кадров. */
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

export const aabb = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const rectHit = (ax, ay, aw, ah, bx, by, bw, bh) =>
  ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

/** Точка внутри повёрнутого сектора (для дуги удара). */
export function inArc(px, py, ox, oy, radius, facing, halfSpread) {
  if (dist2(ox, oy, px, py) > radius * radius) return false;
  return Math.abs(angDiff(facing, angle(ox, oy, px, py))) <= halfSpread;
}

export const fmt = (n) => {
  n = Math.floor(n);
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(1).replace('.0', '') + 'K';
  return String(n);
};

export const roman = (n) => {
  const t = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, r] of t) while (n >= v) { s += r; n -= v; }
  return s || 'I';
};

/** Четыре направления: 0=вниз 1=влево 2=вправо 3=вверх */
export function dirFromVec(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 1 : 2;
  return dy < 0 ? 3 : 0;
}

export const DIR_VEC = [[0, 1], [-1, 0], [1, 0], [0, -1]];

export function pick(arr, r = Math.random) {
  return arr[(r() * arr.length) | 0];
}

/** Взвешенный выбор: список пар [значение, вес]. */
export function weighted(pairs, r = Math.random) {
  let total = 0;
  for (const p of pairs) total += p[1];
  let n = r() * total;
  for (const p of pairs) { n -= p[1]; if (n <= 0) return p[0]; }
  return pairs[pairs.length - 1][0];
}

export function shuffle(arr, r = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (r() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const uid = (() => { let n = 1; return () => n++; })();
