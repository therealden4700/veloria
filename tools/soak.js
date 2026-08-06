// Долгий прогон: игра играет сама и ловит то, что падает.
//
//   node tools/soak.js [минут игрового времени]
//
// Прежние аудиты проверяли данные и геометрию — их можно посчитать, не запуская
// игру. Этот делает обратное: гоняет настоящую симуляцию долго и в разных
// условиях и ловит то, что видно только в движении — исключения, NaN в
// координатах, застрявшие состояния, утечки списков.
//
// Клиентской части (меню, отрисовка) здесь нет: она проверяется в браузере.
// Здесь мир, враги, снаряды, урон и смерть.

import { installHeadless } from '../src/core/headless.js';

installHeadless();

const { initProps } = await import('../src/art/props.js');
const { bakeAllMonsters } = await import('../src/art/sprites.js');
const { generateBiomeZone } = await import('../src/world/zone.js');
const { generateDungeon } = await import('../src/world/dungeon.js');
const { generateCity } = await import('../src/world/city.js');
const { Enemy } = await import('../src/entities/enemies.js');
const { Player } = await import('../src/entities/player.js');
const collide = await import('../src/world/collide.js');
const { swingHits } = await import('../src/systems/combat.js');
const { makeItem, makeRune, reviveItem, MATERIAL_KEYS, makeMaterial } = await import('../src/systems/items.js');
const { makeRng } = await import('../src/core/rng.js');

initProps();
bakeAllMonsters();

const MINUTES = Number(process.argv[2] || 20);
const DT = 1 / 30;
const problems = [];
const seen = new Set();
const bug = (kind, what) => {
  const k = kind + '|' + what;
  if (seen.has(k)) return;
  seen.add(k);
  problems.push({ kind, what });
};

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

const NOOP = () => {};
const FX = { add: NOOP, burst: NOOP, ring: NOOP, spawn: NOOP, update: NOOP, draw: NOOP };

/** Мир для прогона: тот же, что у сервера, плюс настоящий урон. */
function makeWorld(zone, player) {
  const w = {
    time: 0, zone, enemies: [], projectiles: [], loot: [], hazards: [],
    particles: FX, floats: FX, slashes: [], decals: [],
    shake: { add: NOOP, update: NOOP },
    player,
    corruption: 0,
    solidAt: (x, y) => collide.solidAt(zone, x, y),
    hasLineOfSight: (a, b) => collide.hasLineOfSight(zone, a, b),
    nearestEnemy: (x, y, r) => collide.nearestEnemy(w.enemies, x, y, r),
    moveEntity: (e, dt, c = true) => collide.moveEntity(zone, e, dt, c),
    canBeAt: (x, y, ww, hh, fly) => collide.canBeAt(zone, x, y, ww, hh, fly),
    // Стенд обязан отвечать на всё, что игра зовёт у себя: недостающий метод
    // выглядит как баг игры, хотя это дырка в стенде. Первый прогон споткнулся
    // ровно об это — `onLevelUp` не было, и падение приписалось «кряжу».
    proc: NOOP, toast: NOOP, shockwave: NOOP,
    onLevelUp: NOOP, onQuestComplete: NOOP, onPlayerDeath: NOOP,
    onReaction: NOOP, spawnLoot: NOOP, dropLoot: NOOP, useSkill: NOOP,
    aoeDamage: NOOP, lineDamage: NOOP, spawnBolt: NOOP, bolt: NOOP,
    quests: { onKill: NOOP, onEliteKill: NOOP, onReaction: NOOP, onCollect: NOOP, syncCollect: NOOP, onDepth: NOOP },
    hud: { toast: NOOP, showBanner: NOOP, showLesson: NOOP },
    menus: { blocking: false },
    input: { axis: () => ({ x: 0, y: 0 }), held: () => false, pressed: () => false, consume: () => false, mouse: { x: 0, y: 0 } },
    cam: { x: 0, y: 0, w: 480, h: 270 },
    view: { w: 480, h: 270 },
    summonAdds(boss, key, n) {
      for (let i = 0; i < n; i++) w.enemies.push(new Enemy(key, boss.level, boss.x + i * 8, boss.y + i * 6));
    },
    damageEnemy(e, amount, opts = {}) {
      if (!e || e.dead) return;
      const dmg = Math.max(1, Math.round(amount));
      e.hp -= dmg;
      e.hurtT = 0.16;
      if (!e.aggro) { e.aggro = true; if (e.wakePack) e.wakePack(w); }
      if (e.hp <= 0) w.killEnemy(e);
    },
    killEnemy(e) {
      if (e.dead) return;
      e.dead = true; e.deadT = 0;
      player.kills++;
      player.gainXp(Math.max(1, Math.round(e.xpValue || 5)), w);
    },
  };
  return w;
}

function spawnAll(w, zone) {
  for (const s of zone.spawns) w.enemies.push(new Enemy(s.key, s.level, s.x, s.y));
  if (zone.boss) w.enemies.push(new Enemy(zone.boss.key, zone.boss.level, zone.boss.x, zone.boss.y));
}

/** Один прогон по зоне: герой ходит и дерётся, мир живёт. */
function run(label, zone, player, seconds) {
  const w = makeWorld(zone, player);
  spawnAll(w, zone);
  const sp = zone.spawnPoint;
  player.x = sp.x; player.y = sp.y; player.dead = false;
  player.hp = player.maxHp; player.mp = player.maxMp;

  const rng = makeRng(1234);
  const steps = Math.round(seconds / DT);
  let combo = 0;

  for (let i = 0; i < steps; i++) {
    w.time += DT;
    try {
      // герой идёт к ближайшему живому и бьёт
      const live = w.enemies.filter((e) => !e.dead);
      const t = live.length ? live.reduce((a, b) => (
        (a.x - player.x) ** 2 + (a.y - player.y) ** 2 < (b.x - player.x) ** 2 + (b.y - player.y) ** 2 ? a : b), live[0]) : null;
      if (t) {
        const dx = t.x - player.x, dy = t.y - player.y;
        const d = Math.hypot(dx, dy) || 1;
        player.facing = Math.atan2(dy, dx);
        if (d > 22) collide.stepMove(zone, player, dx / d, dy / d, player.moveSpeed, DT);
        else {
          combo = (combo + 1) % 3;
          for (const h of swingHits(player, w.enemies, { combo, time: w.time, rng })) {
            w.damageEnemy(h.enemy, h.dmg, { crit: h.crit, heavy: h.heavy, from: player });
          }
        }
      } else {
        collide.stepMove(zone, player, Math.cos(w.time), Math.sin(w.time * 0.7), player.moveSpeed, DT);
      }

      for (const e of w.enemies) if (!e.dead) e.update(DT, w);
      for (let k = w.enemies.length - 1; k >= 0; k--) {
        const e = w.enemies[k];
        if (e.dead) { e.deadT = (e.deadT || 0) + DT; if (e.deadT > 1.2) w.enemies.splice(k, 1); }
      }
      for (let k = w.projectiles.length - 1; k >= 0; k--) {
        const pr = w.projectiles[k];
        if (pr.update) pr.update(DT, w);
        if (pr.dead) w.projectiles.splice(k, 1);
      }
      if (player.hp <= 0) { player.hp = player.maxHp; player.dead = false; }   // воскрешаем и идём дальше
    } catch (e) {
      bug('исключение в симуляции', `${label}: ${e.message} @ ${(e.stack || '').split('\n')[1] || ''}`);
      break;
    }

    // ── проверки на каждом такте
    if (!finite(player.x) || !finite(player.y)) { bug('NaN в координатах героя', label); break; }
    if (!finite(player.hp) || !finite(player.mp)) { bug('NaN в здоровье или мане', label); break; }
    if (player.hp > player.maxHp + 0.5) bug('здоровье выше предела', `${label}: ${player.hp.toFixed(0)}/${player.maxHp}`);
    for (const e of w.enemies) {
      if (!finite(e.x) || !finite(e.y)) { bug('NaN в координатах врага', `${label}: ${e.name}`); break; }
      if (!finite(e.hp)) { bug('NaN в здоровье врага', `${label}: ${e.name}`); break; }
      if (e.x < -64 || e.y < -64 || e.x > zone.pxW + 64 || e.y > zone.pxH + 64) {
        bug('враг вылетел за карту', `${label}: ${e.name} в (${Math.round(e.x)},${Math.round(e.y)})`);
      }
    }
    if (w.projectiles.length > 400) { bug('снаряды не убираются', `${label}: ${w.projectiles.length}`); break; }
    if (w.enemies.length > zone.spawns.length + 80) { bug('враги плодятся без предела', `${label}: ${w.enemies.length}`); break; }
  }
  return w;
}

// ─────────────────────────────────────────── прогон

const t0 = Date.now();
const player = new Player(0, 0);
// одеваем героя, чтобы работали ветки со снаряжением, заточкой и уникальными
const rng = makeRng(77);
player.equipment.weapon = makeItem({ kind: 'weapon', sub: 'sword', tier: 4, rarity: 'legendary', level: 30, rng });
player.equipment.armor = makeItem({ kind: 'armor', tier: 4, rarity: 'epic', level: 30, rng });
player.equipment.helm = makeItem({ kind: 'helm', tier: 3, rarity: 'rare', level: 30, rng });
player.equipment.skill1 = makeRune('firebolt', 'rare', 2);
for (const m of MATERIAL_KEYS.slice(0, 6)) { const it = makeMaterial(m, 5); if (it) player.inventory.push(it); }
player.level = 30; player.statPoints = 0;

const perZone = Math.max(6, (MINUTES * 60) / 10);
const zones = [
  ['лес', () => generateBiomeZone('forest', 4242)],
  ['топь', () => generateBiomeZone('swamp', 5353)],
  ['кряж', () => generateBiomeZone('frost', 6464)],
  ['пустошь', () => generateBiomeZone('ember', 7575)],
  ['город', () => generateCity(8686)],
  ['подземелье 3', () => generateDungeon(3, 111)],
  ['подземелье 12', () => generateDungeon(12, 222)],
  ['подземелье 26 (Бездна)', () => generateDungeon(26, 333)],
  ['подземелье 30 (босс)', () => generateDungeon(30, 444)],
  ['подземелье 45', () => generateDungeon(45, 555)],
];

let totalKills = 0;
for (const [name, gen] of zones) {
  const z = gen();
  const w = run(name, z, player, perZone);
  totalKills = player.kills;
}

// ── сохранение туда-обратно не должно терять героя
try {
  const j = JSON.parse(JSON.stringify(player.toJSON()));
  const p2 = new Player(0, 0);
  p2.fromJSON(j, reviveItem);
  const same = p2.level === player.level && p2.kills === player.kills
    && Object.keys(p2.equipment).filter((k) => !!p2.equipment[k]).length
       === Object.keys(player.equipment).filter((k) => !!player.equipment[k]).length;
  if (!same) bug('сохранение теряет героя', `ур. ${player.level}→${p2.level}, вещей ${Object.values(player.equipment).filter(Boolean).length}→${Object.values(p2.equipment).filter(Boolean).length}`);
} catch (e) {
  bug('сохранение падает', e.message);
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`прогон: ${zones.length} зон по ${Math.round(perZone)} с игрового времени, ${secs} с реального`);
console.log(`герой: ур. ${player.level}, убито ${totalKills}, опыт ${Math.round(player.xp)}`);

if (!problems.length) { console.log('БАГОВ НЕ НАЙДЕНО'); process.exit(0); }
console.log(`\nнайдено: ${problems.length}`);
const byKind = new Map();
for (const p of problems) byKind.set(p.kind, (byKind.get(p.kind) || 0) + 1);
for (const [kind, n] of [...byKind].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${kind}: ${n}`);
  for (const p of problems.filter((x) => x.kind === kind).slice(0, 5)) console.log(`      ${p.what}`);
}
process.exit(1);
