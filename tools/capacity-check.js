// Сколько народу выдержит один процесс.
//
// Вопрос стоит так: пятьдесят человек онлайн на старте. Ответ упирается в три
// числа — сколько стоит построить зону, сколько она занимает памяти и сколько
// стоит один такт с врагами. Всё остальное (сеть, база) на этом фоне мелочь.
//
//   jsc --module-file=tools/capacity-check.js
//   node tools/capacity-check.js

import { installHeadless } from '../src/core/headless.js';

installHeadless();

const { initProps } = await import('../src/art/props.js');
const { bakeAllMonsters } = await import('../src/art/sprites.js');
const { generateBiomeZone } = await import('../src/world/zone.js');
const { generateCity } = await import('../src/world/city.js');
const { generateDungeon } = await import('../src/world/dungeon.js');
const { Enemy } = await import('../src/entities/enemies.js');

const log = (typeof console !== 'undefined' && console.log) ? console.log : print;
initProps();
bakeAllMonsters();

// ── 1. цена постройки зоны
const build = (fn, n) => {
  const t = Date.now();
  const zs = [];
  for (let i = 0; i < n; i++) zs.push(fn(i + 1));
  return { ms: (Date.now() - t) / n, zs };
};
const biome = build((s) => generateBiomeZone('forest', s), 10);
const dung = build((s) => generateDungeon(7, s), 10);
log(`постройка зоны: биом ${biome.ms.toFixed(0)} мс, подземелье ${dung.ms.toFixed(0)} мс`);

// ── 2. память на зону: считаем только крупное — тайлы, коллизию, реквизит
function zoneBytes(z) {
  let b = 0;
  b += z.tiles.length * (z.tiles.BYTES_PER_ELEMENT || 1);
  b += z.solid ? z.solid.length * (z.solid.BYTES_PER_ELEMENT || 1) : 0;
  b += z.blockBoxes ? z.blockBoxes.length * 4 : 0;
  b += (z.blockGrid || []).reduce((a, v) => a + (v ? 8 + v.length * 8 : 8), 0);
  b += z.props.length * 120;          // грубая оценка объекта реквизита
  b += z.spawns.length * 80;
  return b;
}
const zb = zoneBytes(biome.zs[0]);
log(`память на зону (без картинок): ${(zb / 1024).toFixed(0)} КБ`);

// ── 3. цена такта: враги без экрана
const nul = () => {};
const fx = { add: nul, burst: nul, ring: nul, spawn: nul, update: nul };
function makeRoom(z, howMany) {
  const room = {
    time: 0, zone: z, enemies: [], projectiles: [],
    particles: fx, floats: fx, shake: { add: nul, update: nul },
    player: { x: z.spawnPoint.x, y: z.spawnPoint.y, hp: 500, maxHp: 500, dead: false,
              level: 20, iframe: 0, effects: {}, buffs: {} },
    solidAt: (x, y) => z.solidAtPx(x, y),
    hasLineOfSight: () => true,
    nearestEnemy: () => null,
    moveEntity(e, dx, dy) {
      if (!z.solidAtPx(e.x + dx, e.y)) e.x += dx;
      if (!z.solidAtPx(e.x, e.y + dy)) e.y += dy;
    },
    damageEnemy: nul, killEnemy: nul, summonAdds: nul, shockwave: nul,
  };
  for (const s of z.spawns.slice(0, howMany)) room.enemies.push(new Enemy(s.key, s.level, s.x, s.y));
  return room;
}
function tickCost(rooms, ticks) {
  const t = Date.now();
  for (let i = 0; i < ticks; i++) {
    for (const r of rooms) { r.time += 0.05; for (const e of r.enemies) e.update(0.05, r); }
  }
  return (Date.now() - t) / ticks;
}

for (const nRooms of [1, 4, 13, 25, 50]) {
  const rooms = [];
  for (let i = 0; i < nRooms; i++) rooms.push(makeRoom(biome.zs[i % biome.zs.length], 37));
  const per = tickCost(rooms, 200);
  const budget = 50;                          // такт 20 Гц = 50 мс на всё
  log(`${String(nRooms).padStart(2)} комнат × 37 врагов: такт ${per.toFixed(2)} мс ` +
      `(${((per / budget) * 100).toFixed(1)}% бюджета 20 Гц), память зон ~${((zb * nRooms) / 1048576).toFixed(0)} МБ`);
}

// ── 4. сколько весит снимок мира
const P = 24;    // байт на игрока: id, x, y, направление, поза, hp
const E = 16;    // байт на врага: id, x, y, hp, состояние
for (const [players, enemies] of [[4, 37], [10, 37], [50, 0]]) {
  const snap = players * P + enemies * E;
  log(`снимок: ${players} игроков + ${enemies} врагов = ${snap} байт; ` +
      `на 20 Гц это ${((snap * 20) / 1024).toFixed(1)} КБ/с одному клиенту, ` +
      `${((snap * 20 * players) / 1024).toFixed(0)} КБ/с исходящих у сервера`);
}
