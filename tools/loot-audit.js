// Аудит добычи: где какая редкость падает и всё ли остаётся достижимым.
//
//   node tools/loot-audit.js
//
// Замер до правки показал, что редкость не зависела от места вовсе: 0,9%
// легендарок с рядового и 3,8% с элиты — одинаково в лесу на первом уровне и в
// пустоши на двадцать первом, а босс первого биома ронял легендарку в 40%
// случаев. Теперь у каждого места свой потолок.
//
// Потолок — вещь опасная: им легко запереть то, что игрок обязан получить.
// Поэтому здесь две половины. Первая проверяет само правило, вторая — что от
// него ничего не сломалось:
//
//   1. лестница редкостей растёт от биома к биому и нигде не проваливается;
//   2. в первом биоме легендарок нет ни из одного источника;
//   3. каждое уникальное свойство и каждый комплект где-то достижимы;
//   4. награды за задания не упираются в потолок места, где их выдают;
//   5. герой на входе в каждый биом одет не хуже, чем предполагает бой.

import { installHeadless } from '../src/core/headless.js';

installHeadless();

const { initProps } = await import('../src/art/props.js');
const items = await import('../src/systems/items.js');
const { dropRarity, capRarity, raiseRarity, rollRarity, rarityCapFor, RARITY_ORDER,
        makeItem, rollShopStock } = items;
const { UNIQUES, SETS, uniquesFor, breachUniquesFor } = await import('../src/systems/uniques.js');
const { recipesFor } = await import('../src/systems/craft.js');
const { BIOMES, OVERWORLD } = await import('../src/world/biomes.js');
const { QUEST_LINE } = await import('../src/systems/quests.js');
const { dungeonLevel } = await import('../src/systems/abyss.js');
const { makeRng } = await import('../src/core/rng.js');

initProps();

const problems = [];
const note = (kind, what) => problems.push({ kind, what });
const pct = (n, N) => (n / N * 100).toFixed(1).padStart(5);
const idx = (r) => RARITY_ORDER.indexOf(r);

const N = 40000;

/** Раскладка редкостей по одному источнику в месте с таким потолком. */
function spread(cap, kind) {
  const rng = makeRng(4242);
  const c = {};
  for (const r of RARITY_ORDER) c[r] = 0;
  for (let i = 0; i < N; i++) {
    let r;
    if (kind === 'сундук') r = capRarity(rollRarity(rng, 3), cap);
    else r = dropRarity(rng, { boss: kind === 'босс', elite: kind === 'элита', cap });
    c[r]++;
  }
  return c;
}

// ─────────────────────────────────────────── 1. лестница по местам

console.log('── 1. Что падает в каждом месте\n');
console.log('               ' + RARITY_ORDER.map((r) => r.slice(0, 6).padStart(6)).join(' '));

const МЕСТА = [
  ...OVERWORLD.map((id) => ({ name: BIOMES[id].name, cap: BIOMES[id].maxRarity, lvl: BIOMES[id].unlockLevel || 1 })),
  { name: 'Катакомбы эт.5', cap: rarityCapFor(dungeonLevel(5)), lvl: dungeonLevel(5) },
  { name: 'Катакомбы эт.15', cap: rarityCapFor(dungeonLevel(15)), lvl: dungeonLevel(15) },
  { name: 'Бездна эт.40', cap: rarityCapFor(dungeonLevel(40)), lvl: dungeonLevel(40) },
];

const лестница = [];
for (const м of МЕСТА) {
  console.log(`\n  ${м.name} (ур. ${м.lvl}, потолок «${м.cap}»)`);
  for (const kind of ['рядовой', 'элита', 'босс', 'сундук']) {
    const c = spread(м.cap, kind);
    console.log(`      ${kind.padEnd(9)} ` + RARITY_ORDER.map((r) => pct(c[r], N)).join(' '));
    if (kind === 'рядовой') лестница.push({ ...м, легендарок: c.legendary });
    // Потолок обязан соблюдаться всеми источниками без исключения.
    const выше = RARITY_ORDER.filter((r) => idx(r) > idx(kind === 'босс' ? raiseRarity(м.cap, 1) : м.cap));
    for (const r of выше) {
      if (c[r] > 0) note('источник пробивает потолок', `${м.name}, ${kind}: ${c[r]} шт. «${r}» при потолке «${м.cap}»`);
    }
  }
}

// ─────────────────────────────────────────── 2. первый биом без легендарок

console.log('\n── 2. Первый биом\n');
{
  const первый = BIOMES[OVERWORLD[0]];
  const cap = первый.maxRarity;
  let всего = 0;
  for (const kind of ['рядовой', 'элита', 'босс', 'сундук']) {
    всего += spread(cap, kind).legendary;
  }
  // лавка на уровне первого биома
  const rng = makeRng(77);
  let вЛавке = 0;
  for (let i = 0; i < 400; i++) {
    for (const it of rollShopStock('smith', первый.unlockLevel || 1, i * 7919)) {
      if (it.rarity === 'legendary') вЛавке++;
    }
    for (const it of rollShopStock('trader', первый.unlockLevel || 1, i * 104729)) {
      if (it.rarity === 'legendary') вЛавке++;
    }
  }
  console.log(`      из мобов, боссов и сундуков: ${всего} легендарок на ${N * 4} бросков`);
  console.log(`      в лавке на ${первый.unlockLevel || 1}-м уровне: ${вЛавке} за 800 обновлений`);
  if (всего > 0) note('легендарка в первом биоме', `${всего} шт. из добычи`);
  if (вЛавке > 0) note('легендарка в первом биоме', `${вЛавке} шт. в лавке`);
}

// ─────────────────────────────────────────── 3. всё ли достижимо

console.log('\n── 3. Достижимость уникальных свойств и комплектов\n');
{
  // Легендарки падают там, где потолок это позволяет. Проверяем, что такие
  // места вообще есть и что в них выпадает каждое свойство каждого вида вещи.
  const мест = МЕСТА.filter((м) => idx(raiseRarity(м.cap, 1)) >= idx('legendary') || м.cap === 'legendary');
  console.log(`      мест, где легендарка возможна: ${мест.length} — ${мест.map((м) => м.name).join(', ')}`);
  if (!мест.length) note('легендарки не падают нигде', 'потолки закрыли все места');

  const rng = makeRng(31337);
  const найдено = new Set();
  const виды = ['weapon', 'armor', 'helm', 'trinket'];
  for (let i = 0; i < 40000; i++) {
    const kind = виды[i % виды.length];
    const it = makeItem({ kind, level: 34, rarity: 'legendary', rng });
    if (it && it.unique) найдено.add(it.unique);
  }
  const все = Object.keys(UNIQUES);
  const пропали = все.filter((u) => !найдено.has(u) && !UNIQUES[u].abyss && !UNIQUES[u].breach);
  console.log(`      уникальных свойств выпало: ${найдено.size} из ${все.length}`);
  for (const u of пропали) note('уникальное свойство недостижимо', `${UNIQUES[u].name} (${u})`);

  // Свойства Пролома живут в своём пуле и в общий не попадают намеренно —
  // но «намеренно вне пула» не значит «достижимо». Проверяем оба настоящих
  // пути: выпадение с обитателей биома и ковку у кузнеца. Просто исключить их
  // из проверки означало бы выключить её: список бы рос, а проверять было бы
  // нечего.
  const ковка = new Set(recipesFor('breach').map((r) => r.out.unique).filter(Boolean));
  const пулы = new Set();
  for (const kind of виды) for (const u of breachUniquesFor(kind)) пулы.add(u);
  const проломные = все.filter((u) => UNIQUES[u].breach);
  console.log(`      свойств Пролома: ${проломные.length}, из них куются ${ковка.size}, падают ${пулы.size}`);
  for (const u of проломные) {
    if (пулы.has(u) || ковка.has(u)) continue;
    note('свойство Пролома недостижимо', `${UNIQUES[u].name} (${u}) — ни в выпадении, ни в ковке`);
  }
  // И наоборот: рецепт, который кует несуществующее свойство, — тихая дыра.
  for (const u of ковка) {
    if (!UNIQUES[u]) note('ковка Пролома кует пустоту', `рецепт ссылается на «${u}», которого нет`);
    else if (!UNIQUES[u].breach) note('ковка Пролома кует чужое', `«${u}» не помечен как свойство Пролома`);
  }

  // комплекты требуют 3-го ранга, то есть 16-го уровня — а туда потолок пускает
  const наборы = new Set();
  for (let i = 0; i < 40000; i++) {
    const it = makeItem({ kind: ['armor', 'helm', 'trinket'][i % 3], level: 24, tier: 4, rarity: 'rare', rng });
    if (it && it.set) наборы.add(it.set);
  }
  console.log(`      комплектов выпало: ${наборы.size} из ${Object.keys(SETS).length}`);
  for (const k of Object.keys(SETS)) if (!наборы.has(k)) note('комплект недостижим', SETS[k].name || k);
}

// ─────────────────────────────────────────── 4. проходимость под потолком

// Первая версия этого раздела сравнивала награду за задание с потолком биома и
// ругалась, что «uncommon хуже, чем rare». Это была бессмыслица: потолок — это
// самое лучшее, что вообще может выпасть, а не то, что валяется под ногами; при
// потолке «rare» редких вещей всего 14%. Проверка сравнивала подарок с недосягаемым.
//
// Полезный вопрос другой, и он же — главный риск потолка: **не оставит ли он
// героя раздетым перед следующим биомом**. Отвечаем настоящими правилами боя.

console.log('\n── 4. Проходимость: герой входит в биом в том, что нашёл в предыдущем\n');
{
  const { Player } = await import('../src/entities/player.js');
  const { Enemy } = await import('../src/entities/enemies.js');
  const { swingHits, resolveHit } = await import('../src/systems/combat.js');
  const { markDamageMult } = await import('../src/systems/reactions.js');
  const { bakeAllMonsters } = await import('../src/art/sprites.js');
  const { angle } = await import('../src/core/util.js');
  bakeAllMonsters();

  const NOOP = () => {};
  const мир = { time: 0, zone: { kind: 'biome', mod: {} }, floats: { add: NOOP },
    particles: { burst: NOOP, spawn: NOOP }, shake: { add: NOOP }, toast: NOOP, proc: NOOP,
    hud: { toast: NOOP, showBanner: NOOP, showLesson: NOOP }, onPlayerDeath: NOOP, onLevelUp: NOOP };

  for (let i = 0; i < OVERWORLD.length; i++) {
    const b = BIOMES[OVERWORLD[i]];
    const lvl = b.unlockLevel || 1;
    // одет он в то, что позволял потолок ПРЕДЫДУЩЕГО места: здесь он только что
    const прежний = i === 0 ? BIOMES.city : BIOMES[OVERWORLD[i - 1]];
    const rar = прежний.maxRarity;

    const rng = makeRng(4242);
    const p = new Player(0, 0);
    p.level = lvl;
    const tier = Math.max(0, Math.min(6, Math.floor((lvl - 1) / 5)));
    p.equipment.weapon = makeItem({ kind: 'weapon', sub: 'sword', tier, rarity: rar, level: lvl, rng });
    p.equipment.armor = makeItem({ kind: 'armor', tier, rarity: rar, level: lvl, rng });
    p.equipment.helm = makeItem({ kind: 'helm', tier, rarity: rar, level: lvl, rng });
    const pts = Math.max(0, (lvl - 1) * 3), each = Math.floor(pts / 4);
    p.str += each; p.agi += each; p.vit += each; p.int += pts - each * 3;
    p.hp = p.maxHp;

    const key = b.enemies[0][0];
    const e = new Enemy(key, lvl, 0, 0);
    e.x = p.x + 18; e.y = p.y; e.face = Math.PI;
    p.facing = angle(p.x, p.y - 11, e.x, e.y - e.r * 0.6);
    const dt = 1 / 60;
    let t = 0, combo = 0, cd = 0;
    while (e.hp > 0 && t < 120) {
      t += dt; cd -= dt;
      if (cd <= 0) {
        cd = p.attackRate; combo = (combo + 1) % 3;
        for (const h of swingHits(p, [e], { combo, time: t, rng })) {
          const hit = resolveHit(p, h.enemy, h.dmg, { heavy: h.heavy, from: p }, rng, markDamageMult);
          if (!hit.dodged) h.enemy.hp -= hit.dmg;
        }
      }
    }
    const e2 = new Enemy(key, lvl, 0, 0);
    let ударов = 0;
    p.hp = p.maxHp;
    while (p.hp > 0 && ударов < 999) { ударов++; p.iframe = 0; p.takeDamage(e2.damage, мир, e2, { melee: true }); }

    console.log(`      ${b.name.padEnd(18)} ур.${String(lvl).padStart(2)}  в «${rar}» из «${прежний.name}»  →  убивает за ${t.toFixed(1)} с, держит ${ударов} ударов`);
    // Пороги те же, что в аудите боя: рядовой не должен превращаться в губку,
    // а герой — умирать с трёх ударов.
    if (t > 14) note('под потолком биом непроходим', `${b.name}: рядовой убивается ${t.toFixed(1)} с в снаряжении «${rar}»`);
    if (ударов < 4) note('под потолком герой слишком хрупок', `${b.name}: ${ударов} ударов до смерти в снаряжении «${rar}»`);
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
  for (const p of problems.filter((x) => x.kind === kind).slice(0, 8)) console.log(`      ${p.what}`);
  const rest = problems.filter((x) => x.kind === kind).length - 8;
  if (rest > 0) console.log(`      …и ещё ${rest}`);
}
process.exit(1);
