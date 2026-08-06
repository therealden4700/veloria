// Аудит зон: где игрока запирает, куда нельзя дойти, кто стоит в стене.
//
//   node tools/zone-audit.js [сколько сидов]
//
// Проверяется то, что ломает игру молча:
//   1. точка появления проходима — иначе герой родится в воде и не сдвинется;
//   2. от неё достижимы выходы, арена босса, сундуки и жители;
//   3. никто не стоит внутри стены или объекта.
//
// Проверка идёт заливкой по настоящей коллизии — той же функции `canBeAt`,
// которой ходит герой, — а не по тайлам: дом стоит на проходимой земле, но
// пройти сквозь него нельзя.

import { installHeadless } from '../src/core/headless.js';

installHeadless();

const { initProps } = await import('../src/art/props.js');
const { generateBiomeZone } = await import('../src/world/zone.js');
const { generateCity } = await import('../src/world/city.js');
const { generateDungeon } = await import('../src/world/dungeon.js');
const { canBeAt } = await import('../src/world/collide.js');
const { TILE } = await import('../src/art/tiles.js');
const { ENEMIES } = await import('../src/entities/enemies.js');

initProps();

const SEEDS = Number(process.argv[2] || 12);
const PW = 11, PH = 9;                     // габарит героя

const walkable = (z, tx, ty) => canBeAt(z, tx * TILE + TILE / 2, ty * TILE + TILE - 1, PW, PH, false);

/** Заливка от точки: какие клетки достижимы пешком. */
function reachFrom(z, px, py) {
  const seen = new Uint8Array(z.w * z.h);
  const sx = Math.floor(px / TILE), sy = Math.floor(py / TILE);
  if (sx < 0 || sy < 0 || sx >= z.w || sy >= z.h) return { seen, n: 0, ok: false };
  const q = [sy * z.w + sx];
  seen[q[0]] = 1;
  let n = 0;
  while (q.length) {
    const k = q.pop(); n++;
    const x = k % z.w, y = (k / z.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= z.w || ny >= z.h) continue;
      const nk = ny * z.w + nx;
      if (seen[nk]) continue;
      if (!walkable(z, nx, ny)) continue;
      seen[nk] = 1; q.push(nk);
    }
  }
  return { seen, n, ok: true };
}

const at = (seen, z, x, y) => {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= z.w || ty >= z.h) return false;
  // объект может стоять на краю клетки — смотрим и соседние
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = tx + dx, ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= z.w || ny >= z.h) continue;
      if (seen[ny * z.w + nx]) return true;
    }
  }
  return false;
};

const problems = [];
const add = (zone, kind, what) => problems.push({ zone, kind, what });

function audit(label, z) {
  const sp = z.spawnPoint;
  if (!sp) { add(label, 'нет точки появления', ''); return; }

  // 1. в самой точке появления вообще можно стоять?
  if (!canBeAt(z, sp.x, sp.y, PW, PH, false)) {
    add(label, 'ЗАПЕРТ НА СТАРТЕ', `точка (${Math.round(sp.x)},${Math.round(sp.y)}) непроходима`);
  }

  const { seen, n } = reachFrom(z, sp.x, sp.y);
  let total = 0;
  for (let y = 0; y < z.h; y++) for (let x = 0; x < z.w; x++) if (walkable(z, x, y)) total++;
  if (n < 12) add(label, 'ЗАПЕРТ НА СТАРТЕ', `из точки появления доступно ${n} клеток`);
  else if (total && n / total < 0.55) {
    add(label, 'карта разорвана', `от старта достижимо ${n} из ${total} проходимых клеток (${Math.round(n / total * 100)}%)`);
  }

  // 2. выходы
  for (const e of z.exits) {
    if (!at(seen, z, e.x + (e.w || 0) / 2, e.y + (e.h || 0) / 2)) {
      add(label, 'выход недостижим', `${e.dest.kind}${e.dest.id ? '/' + e.dest.id : ''}`);
    }
  }
  if (z.downExit && !at(seen, z, z.downExit.x + (z.downExit.w || 0) / 2, z.downExit.y + (z.downExit.h || 0) / 2)) {
    add(label, 'спуск недостижим', '');
  }

  // 3. жители
  for (const npc of z.npcs || []) {
    if (!canBeAt(z, npc.x, npc.y, PW, PH, false)) add(label, 'житель в стене', npc.name || npc.id);
    else if (!at(seen, z, npc.x, npc.y)) add(label, 'житель недостижим', npc.name || npc.id);
  }

  // 4. сундуки и арена босса
  let lockedChests = 0;
  for (const c of z.chests || []) if (!at(seen, z, c.x, c.y)) lockedChests++;
  if (lockedChests) add(label, 'сундуки недостижимы', `${lockedChests} из ${(z.chests || []).length}`);
  if (z.bossArena && !at(seen, z, z.bossArena.x, z.bossArena.y)) add(label, 'арена босса недостижима', '');
  if (z.boss && !at(seen, z, z.boss.x, z.boss.y)) add(label, 'босс недостижим', '');

  // 5. враги в стенах
  let stuck = 0;
  for (const sp2 of z.spawns) {
    const def = ENEMIES[sp2.key];
    if (!def) continue;
    // габарит врага, а не героя; летающие проходят над водой
    if (!canBeAt(z, sp2.x, sp2.y, def.r * 1.6, def.r, !!def.flying)) stuck++;
  }
  if (stuck) add(label, 'враги в стенах', `${stuck} из ${z.spawns.length}`);
}

// ─────────────────────────────────────────── прогон

const t0 = Date.now();
let zones = 0;

for (let s = 1; s <= SEEDS; s++) { audit(`город/сид${s}`, generateCity(s * 7919)); zones++; }
for (const id of ['forest', 'swamp', 'frost', 'ember']) {
  for (let s = 1; s <= SEEDS; s++) { audit(`${id}/сид${s}`, generateBiomeZone(id, s * 104729)); zones++; }
}
for (let floor = 1; floor <= 30; floor++) {
  for (let s = 1; s <= Math.max(2, SEEDS / 3 | 0); s++) {
    audit(`подземелье эт.${floor}/сид${s}`, generateDungeon(floor, s * 15485863 + floor));
    zones++;
  }
}

const byKind = new Map();
for (const p of problems) byKind.set(p.kind, (byKind.get(p.kind) || 0) + 1);

console.log(`проверено зон: ${zones} за ${((Date.now() - t0) / 1000).toFixed(1)} с`);
if (!problems.length) { console.log('ПРОБЛЕМ НЕ НАЙДЕНО'); process.exit(0); }

console.log(`\nнайдено проблем: ${problems.length}`);
for (const [kind, n] of [...byKind].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${kind}: ${n}`);
  for (const p of problems.filter((x) => x.kind === kind).slice(0, 4)) {
    console.log(`      ${p.zone}${p.what ? ' — ' + p.what : ''}`);
  }
  const rest = problems.filter((x) => x.kind === kind).length - 4;
  if (rest > 0) console.log(`      …и ещё ${rest}`);
}
