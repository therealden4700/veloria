// Аудит спуска: честна ли сделка «риск за добычу».
//
//   node tools/descent-audit.js
//
// Модификаторы этажей уже есть — одиннадцать штук, выбор из двух дверей, плюс
// проклятые алтари и аффиксы элиты. Спуск задуман как цепочка решений: берёшь
// «Хрупкость» и получаешь вдвое больше урона, зато добычи вдвое с лишним.
//
// Чего никто не проверял — **сходится ли размен**. Подпись «+90% награды» игрок
// видит, а цену в трудности не видит никто, включая меня: она размазана по
// урону, скорости, броне, числу врагов и свету. Здесь она считается.
//
// Меряется настоящими правилами боя: `resolveHit`, `swingHits`, `scaleStats`,
// `Player.takeDamage` — теми же, что вынесены ради аудита боя. Смоделирован
// только темп: удары идут ровно через `attackRate`, враг бьёт через свой
// `atkCd`, оба всегда попадают.

import { installHeadless } from '../src/core/headless.js';

installHeadless();

const { initProps } = await import('../src/art/props.js');
const { bakeAllMonsters } = await import('../src/art/sprites.js');
const { Player } = await import('../src/entities/player.js');
const { Enemy, ENEMIES } = await import('../src/entities/enemies.js');
const { swingHits, resolveHit } = await import('../src/systems/combat.js');
const { markDamageMult } = await import('../src/systems/reactions.js');
const { makeItem } = await import('../src/systems/items.js');
const { makeRng } = await import('../src/core/rng.js');
const { angle } = await import('../src/core/util.js');
const { FLOOR_MODS, modReward, rollDoors } = await import('../src/systems/dungeon_mods.js');
const { dungeonLevel, corruptionOf, corruptionEffects, ABYSS_START } = await import('../src/systems/abyss.js');

initProps();
bakeAllMonsters();

const problems = [];
const note = (kind, what) => problems.push({ kind, what });
const fmt = (v, n = 1) => (Math.round(v * 10 ** n) / 10 ** n).toFixed(n).replace('.', ',');

const NOOP = () => {};
function stand(floor) {
  return {
    time: 0,
    zone: { kind: 'dungeon', floor, mod: {} },
    floats: { add: NOOP }, particles: { burst: NOOP, spawn: NOOP },
    shake: { add: NOOP }, hud: { toast: NOOP, showBanner: NOOP, showLesson: NOOP },
    toast: NOOP, proc: NOOP, onPlayerDeath: NOOP, onLevelUp: NOOP,
  };
}

function hero(level) {
  const rng = makeRng(4242);
  const p = new Player(0, 0);
  p.level = level;
  const tier = Math.max(0, Math.min(6, Math.floor((level - 1) / 5)));
  p.equipment.weapon = makeItem({ kind: 'weapon', sub: 'sword', tier, rarity: 'rare', level, rng });
  p.equipment.armor = makeItem({ kind: 'armor', tier, rarity: 'rare', level, rng });
  p.equipment.helm = makeItem({ kind: 'helm', tier, rarity: 'uncommon', level, rng });
  const pts = Math.max(0, (level - 1) * 3), each = Math.floor(pts / 4);
  p.str += each; p.agi += each; p.vit += each; p.int += pts - each * 3;
  p.hp = p.maxHp; p.mp = p.maxMp;
  return p;
}

/**
 * Один этаж под модификатором: сколько секунд герой чистит его и сколько
 * ударов держит.
 *
 * Порча этажа применяется так же, как в игре: `hpMul` сжимает шкалу жизни
 * героя, `enemyDmg` и `enemySpd` усиливают врагов.
 */
function floorCost(floor, modKey) {
  const mod = FLOOR_MODS[modKey] || FLOOR_MODS.none;
  const lvl = dungeonLevel(floor);
  const corr = corruptionEffects(corruptionOf({ kind: 'dungeon', floor }));
  const rng = makeRng(9001);
  const p = hero(Math.min(40, lvl));
  p._corr = corr;
  const w = stand(floor);
  w.zone.mod = mod;

  // ── сколько врагов на этаже: та же формула, что в генераторе
  const базовых = 26;
  const врагов = Math.round(базовых * ((mod.enemyMul || 1) * 0.62) / 0.62);

  // ── сколько секунд уходит на одного
  const e = new Enemy('skeleton', lvl, 0, 0);
  e.armorBonus += mod.armor || 0;
  e.x = p.x + 18; e.y = p.y; e.face = Math.PI;
  p.facing = angle(p.x, p.y - 11, e.x, e.y - e.r * 0.6);
  const dt = 1 / 60;
  let t = 0, combo = 0, cd = 0;
  while (e.hp > 0 && t < 200) {
    t += dt; cd -= dt;
    if (cd <= 0) {
      cd = p.attackRate;
      combo = (combo + 1) % 3;
      for (const h of swingHits(p, [e], { combo, time: t, rng })) {
        const hit = resolveHit(p, h.enemy, h.dmg, { heavy: h.heavy, from: p }, rng, markDamageMult);
        if (!hit.dodged) h.enemy.hp -= hit.dmg;
      }
    }
  }
  const наОдного = t;

  // ── сколько ударов держит герой
  const e2 = new Enemy('skeleton', lvl, 0, 0);
  const урон = Math.round(e2.damage * (mod.dmgMul || 1) * corr.enemyDmg);
  const hp0 = p.maxHp;
  let ударов = 0;
  p.hp = hp0;
  while (p.hp > 0 && ударов < 999) {
    ударов++;
    p.iframe = 0;
    p.takeDamage(урон, w, e2, { melee: true });
  }

  return {
    врагов,
    наОдного,
    этаж: наОдного * врагов,
    ударов,
    // Заявленная награда — то, что игрок читает на двери.
    награда: modReward(modKey),
  };
}

// ─────────────────────────────────────────── 1. цена и награда

/**
 * Чего этот стенд НЕ видит — и почему.
 *
 * Цена части модификаторов лежит вне того, что здесь считается: герой не пьёт
 * зелий, ничего не видит и дерётся с одиночным неподвижным скелетом. Записать
 * такой модификатор в «награда без риска» было бы враньём стенда, а не находкой
 * про игру, поэтому они помечены и исключены из приговора.
 */
const ЧАСТИЧНО = {
  hollow: 'без учёта темноты',
  greed:  'без учёта плотности стражи',
};

const НЕИЗМЕРИМО = {
  famine:   'цена — в зельях, герой их не пьёт',
  darkness: 'цена — в обзоре, у стенда нет экрана',
  hunt:     'цена — в отряде элиты, здесь один скелет',
  frenzy:   'часть цены — в скорости врага, здесь он стоит',
  bounty:   'это награда, а не риск',
};

console.log('── 1. Цена модификатора против обещанной награды\n');
console.log('   Цена — во сколько раз этаж тяжелее «Тишины»: время зачистки и');
console.log('   хрупкость героя (меньше ударов до смерти = дороже).\n');

for (const floor of [10, 30, 50]) {
  const base = floorCost(floor, 'none');
  console.log(`  этаж ${floor} (ур. мобов ${dungeonLevel(floor)}, порча ${corruptionOf({ kind: 'dungeon', floor })}) — «Тишина»: ${fmt(base.этаж)} с, ${base.ударов} ударов до смерти\n`);
  const rows = [];
  for (const key of Object.keys(FLOOR_MODS)) {
    if (key === 'none') continue;
    const c = floorCost(floor, key);
    const дольше = c.этаж / base.этаж;
    const хрупче = base.ударов / c.ударов;
    // Цена — произведение: и дольше, и опаснее.
    const цена = дольше * хрупче;
    rows.push({ key, name: FLOOR_MODS[key].name, дольше, хрупче, цена, награда: c.награда });
  }
  for (const r of rows.sort((a, b) => b.цена - a.цена)) {
    const знак = r.награда >= 0 ? '+' : '';
    const слепо = НЕИЗМЕРИМО[r.key];
    // Частично слепые судим всё равно: их измеримая цена занижена, значит и
    // сделка выходит завышенной — ошибка в сторону строгости, а не поблажки.
    const частично = ЧАСТИЧНО[r.key];
    const пометка = слепо || частично;
    console.log(`      ${r.name.padEnd(14)} дольше ×${fmt(r.дольше, 2)}  хрупче ×${fmt(r.хрупче, 2)}  →  цена ×${fmt(r.цена, 2)}  награда ${знак}${r.награда}%${пометка ? '   (' + пометка + ')' : ''}`);
    if (слепо) continue;                    // цену такого стенд не видит — молчим
    // Сделка — награда на единицу риска. Сравниваем модификаторы между собой, а
    // не с числом с потолка: важно, чтобы среди них не было явно лучшего и явно
    // худшего, иначе выбор двери перестаёт быть выбором.
    if (r.цена > 1.05) r.сделка = (r.награда / 100) / (r.цена - 1);
  }
  const измеримые = rows.filter((x) => x.сделка !== undefined);
  if (измеримые.length > 1) {
    const best = измеримые.reduce((a, b) => (a.сделка > b.сделка ? a : b));
    const worst = измеримые.reduce((a, b) => (a.сделка < b.сделка ? a : b));
    console.log(`      сделка: лучшая — ${best.name} (${fmt(best.сделка, 1)} награды за единицу риска), худшая — ${worst.name} (${fmt(worst.сделка, 1)})`);
    if (best.сделка > worst.сделка * 4) {
      note('двери неравноценны', `${floor}-й этаж: ${best.name} даёт ${fmt(best.сделка, 1)} награды за единицу риска, ${worst.name} — ${fmt(worst.сделка, 1)}, разрыв ×${fmt(best.сделка / worst.сделка, 1)}`);
    }
  }
  console.log('');
}

// ─────────────────────────────────────────── 2. что вообще предлагают двери

console.log('── 2. Что игрок видит на дверях за сто спусков\n');
{
  const счёт = {};
  const пары = new Map();
  for (const key of Object.keys(FLOOR_MODS)) счёт[key] = 0;
  const rng = makeRng(4242);
  for (let run = 0; run < 100; run++) {
    for (let floor = 2; floor <= 60; floor++) {
      const [a, b] = rollDoors(rng, floor);
      счёт[a]++; счёт[b]++;
      пары.set(a + '|' + b, (пары.get(a + '|' + b) || 0) + 1);
    }
  }
  const всего = Object.values(счёт).reduce((s, n) => s + n, 0);
  for (const [key, n] of Object.entries(счёт).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${FLOOR_MODS[key].name.padEnd(14)} ${(fmt(n / всего * 100) + '%').padStart(6)}`);
    if (n === 0) note('модификатор не предлагается никогда', FLOOR_MODS[key].name);
  }
  console.log(`      (разных пар дверей: ${пары.size})`);
}

// ─────────────────────────────────────────── 3. глубина против модификатора

console.log('\n── 3. Кто главнее на глубине: порча или модификатор\n');
{
  for (const floor of [10, 26, 40, 60]) {
    const c = corruptionOf({ kind: 'dungeon', floor });
    const eff = corruptionEffects(c);
    const base = floorCost(floor, 'none');
    const worst = Object.keys(FLOOR_MODS).filter((k) => k !== 'none')
      .map((k) => ({ k, c: floorCost(floor, k) }))
      .sort((a, b) => a.c.ударов - b.c.ударов)[0];
    console.log(`      этаж ${String(floor).padStart(2)}  порча ${String(c).padStart(2)}  ударов до смерти: без мода ${String(base.ударов).padStart(2)}, с худшим (${FLOOR_MODS[worst.k].name}) ${worst.c.ударов}`);
    // Модификатор должен что-то значить и на глубине. Если порча съела всё и
    // выбор двери перестал влиять — цепочка решений выродилась.
    if (base.ударов > 3 && base.ударов - worst.c.ударов < 1) {
      note('на глубине модификатор перестаёт значить', `этаж ${floor}: без мода ${base.ударов} ударов, с худшим ${worst.c.ударов}`);
    }
  }
}

// ─────────────────────────────────────────── итог

console.log('');
if (!problems.length) { console.log('ПРОБЛЕМ НЕ НАЙДЕНО'); process.exit(0); }
const byKind = new Map();
for (const p of problems) byKind.set(p.kind, (byKind.get(p.kind) || 0) + 1);
console.log(`найдено: ${problems.length}`);
for (const [kind, n] of [...byKind].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${kind}: ${n}`);
  for (const p of problems.filter((x) => x.kind === kind).slice(0, 6)) console.log(`      ${p.what}`);
  const rest = problems.filter((x) => x.kind === kind).length - 6;
  if (rest > 0) console.log(`      …и ещё ${rest}`);
}
process.exit(1);
