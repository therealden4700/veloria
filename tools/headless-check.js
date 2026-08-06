// Проверка безголовой сборки: строит зоны без экрана и печатает, что вышло.
//
// Запуск (пока в системе нет Node — системным JavaScriptCore):
//   jsc --module-file=tools/headless-check.js
// После установки Node — просто:
//   node tools/headless-check.js
//
// Это не тест ради теста: сервер комнаты будет делать ровно то же самое —
// импортировать генерацию и получить из неё тайлы, коллизию, спавны и выходы.
// Если этот файл не проходит, серверу не на чем стоять.

import { installHeadless } from '../src/core/headless.js';

installHeadless();

const { initProps } = await import('../src/art/props.js');
const { generateBiomeZone } = await import('../src/world/zone.js');
const { generateCity } = await import('../src/world/city.js');
const { generateDungeon } = await import('../src/world/dungeon.js');

const out = [];
const say = (s) => out.push(s);

const t0 = Date.now();
initProps();
say(`запекание реквизита без экрана: ${Date.now() - t0} мс`);

function report(name, z) {
  const solid = z.solid ? z.solid.reduce((a, v) => a + v, 0) : -1;
  const boxes = z.blockBoxes ? z.blockBoxes.length / 4 : -1;
  say(`${name}: ${z.w}×${z.h} клеток, тайлов ${z.tiles.length}, стен ${solid}, ` +
      `коробок ${boxes}, спавнов ${z.spawns.length}, выходов ${z.exits.length}, ` +
      `реквизита ${z.props.length}, сундуков ${(z.chests || []).length}`);
}

for (const id of ['forest', 'swamp', 'frost', 'ember']) {
  report(id, generateBiomeZone(id, 12345));
}
report('город', generateCity(999));
report('подземелье, этаж 7', generateDungeon(7, 4242));

// Главная проверка: коллизия должна получиться настоящей, а не пустой —
// иначе сервер пустит игроков сквозь стены.
const z = generateBiomeZone('forest', 12345);
let hits = 0, tries = 0;
for (let y = 0; y < z.h; y += 3) {
  for (let x = 0; x < z.w; x += 3) {
    tries++;
    if (z.solidAtPx(x * 16 + 8, y * 16 + 8)) hits++;
  }
}
say(`проба коллизии: ${hits} из ${tries} точек непроходимы`);
say(hits > 0 && hits < tries ? 'ИТОГ: зона живая — есть и проходимое, и стены'
                             : 'ИТОГ: ПЛОХО — коллизия вырождена');

const say2 = (typeof console !== 'undefined' && console.log) ? console.log : print;
say2(out.join('\n'));

// ── вторая проверка: живёт ли боевая симуляция без экрана
//
// Врагам от игры нужно немного: игрок, список врагов, время, движение с
// коллизией и несколько «эффектных» служб. Эффекты на сервере не нужны —
// им хватает пустышек. Если ИИ так заводится, значит переносится и он.
const { bakeAllMonsters } = await import('../src/art/sprites.js');
const { Enemy } = await import('../src/entities/enemies.js');
bakeAllMonsters();

const zf = generateBiomeZone('forest', 12345);
const nul = () => {};
const stubFx = { add: nul, burst: nul, ring: nul, spawn: nul, update: nul };
const fake = {
  time: 0,
  zone: zf,
  enemies: [],
  projectiles: [],
  particles: stubFx,
  floats: stubFx,
  shake: { add: nul, update: nul },
  player: { x: zf.spawnPoint.x, y: zf.spawnPoint.y, hp: 100, maxHp: 100, dead: false,
            level: 1, iframe: 0, effects: {}, buffs: {} },
  solidAt: (x, y) => zf.solidAtPx(x, y),
  hasLineOfSight: () => true,
  nearestEnemy: () => null,
  moveEntity(e, dx, dy) {
    if (!zf.solidAtPx(e.x + dx, e.y)) e.x += dx;
    if (!zf.solidAtPx(e.x, e.y + dy)) e.y += dy;
  },
  damageEnemy: nul, killEnemy: nul, summonAdds: nul, shockwave: nul,
};
for (const s of zf.spawns.slice(0, 24)) fake.enemies.push(new Enemy(s.key, s.level, s.x, s.y));

const before = fake.enemies.map((e) => `${Math.round(e.x)},${Math.round(e.y)}`).join('|');
const tSim = Date.now();
let ticks = 0, err = null;
try {
  for (let i = 0; i < 600; i++) { fake.time += 1 / 60; for (const e of fake.enemies) e.update(1 / 60, fake); ticks++; }
} catch (e) { err = e; }
const after = fake.enemies.map((e) => `${Math.round(e.x)},${Math.round(e.y)}`).join('|');

say2(`\nбоевая симуляция без экрана: врагов ${fake.enemies.length}, тактов ${ticks}, ` +
     `${Date.now() - tSim} мс` + (err ? `\n  СБОЙ: ${err.message}` : ''));
say2('  положения ' + (before === after ? 'НЕ изменились — ИИ не работает' : 'изменились — ИИ считает'));
say2('  живых после 10 с: ' + fake.enemies.filter((e) => !e.dead).length);
