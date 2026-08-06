// Аудит содержимого: можно ли игру пройти.
//
//   node tools/content-audit.js
//
// Аудит зон отвечал на вопрос «куда можно дойти». Этот отвечает на другой:
// «есть ли до чего доходить». Невыполнимое задание — тот же тупик, что этаж без
// спуска, только злее: игрок ищет часами и винит себя.
//
// Проверяется:
//   1. каждое задание выполнимо — цель существует и водится там, куда пускают;
//   2. каждый материал, нужный рецепту, откуда-то падает, и не из биома,
//      который откроется на двадцать уровней позже самого рецепта;
//   3. генератор предметов не рождает бессмыслицу — нулевой урон, пустые
//      характеристики, отрицательные значения.

import { installHeadless } from '../src/core/headless.js';

installHeadless();

const { ENEMIES } = await import('../src/entities/enemies.js');
const { BIOMES, OVERWORLD } = await import('../src/world/biomes.js');
const { QUEST_LINE } = await import('../src/systems/quests.js');
const { CRAFT_CATS, WEAPON_SUBS, recipesFor } = await import('../src/systems/craft.js');
const { makeItem, MATERIAL_KEYS, rollRarity } = await import('../src/systems/items.js');
const { makeRng } = await import('../src/core/rng.js');
const { ABYSS_BOSSES, ABYSS_START } = await import('../src/systems/abyss.js');

const bad = [];
const note = (kind, what) => bad.push({ kind, what });

// ─────────────────────────────────────────── где кто водится

/** Биомы, в чьих таблицах встречается этот враг, и с какого уровня туда пускают. */
function whereEnemy(key) {
  const out = [];
  // Боссы Бездны не значатся ни в одной таблице биома: они появляются по
  // ротации на глубоких этажах. Без этой ветки инструмент считал, что «Слеза
  // Бездны» не падает ниоткуда, — и был неправ.
  if (ABYSS_BOSSES.includes(key)) {
    out.push({ id: 'abyss', unlock: BIOMES.dungeon ? (BIOMES.dungeon.unlockLevel || 3) : 3, boss: true, abyss: true });
  }
  for (const id of [...OVERWORLD, 'dungeon']) {
    const b = BIOMES[id];
    if (!b) continue;
    if (b.enemies && b.enemies.some(([k]) => k === key)) out.push({ id, unlock: b.unlockLevel || 1 });
    if (b.boss === key) out.push({ id, unlock: b.unlockLevel || 1, boss: true });
    if (b.elite === key) out.push({ id, unlock: b.unlockLevel || 1, elite: true });
  }
  return out;
}

/** Кто роняет этот материал и с какого уровня до него добраться. */
function whereMaterial(key) {
  const out = [];
  for (const [ekey, def] of Object.entries(ENEMIES)) {
    if (!def.drops || !def.drops.includes(key)) continue;
    for (const w of whereEnemy(ekey)) out.push({ ...w, from: ekey });
  }
  return out;
}

// ─────────────────────────────────────────── 1. задания

for (const q of QUEST_LINE) {
  const lvl = q.minLevel || 1;
  if (q.type === 'kill' || q.type === 'head') {
    const w = whereEnemy(q.target);
    if (!w.length) { note('цель задания не водится нигде', `${q.id} «${q.title}» → ${q.target}`); continue; }
    const soonest = Math.min(...w.map((x) => x.unlock));
    if (soonest > lvl) note('цель задания заперта по уровню', `${q.id} «${q.title}»: даётся на ${lvl}, ${q.target} только с ${soonest}`);
  } else if (q.type === 'boss') {
    const w = whereEnemy(q.target).filter((x) => x.boss);
    if (!w.length) note('босс задания не найден', `${q.id} «${q.title}» → ${q.target}`);
  } else if (q.type === 'collect') {
    const w = whereMaterial(q.target);
    if (!w.length) { note('материал задания ниоткуда не падает', `${q.id} «${q.title}» → ${q.target}`); continue; }
    const soonest = Math.min(...w.map((x) => x.unlock));
    if (soonest > lvl) note('материал задания заперт по уровню', `${q.id} «${q.title}»: даётся на ${lvl}, ${q.target} только с ${soonest}`);
  } else if (q.type === 'reach') {
    const b = BIOMES[q.target];
    if (!b) note('цель перехода не существует', `${q.id} → ${q.target}`);
    else if ((b.unlockLevel || 1) > lvl) note('переход заперт по уровню', `${q.id}: даётся на ${lvl}, ${q.target} с ${b.unlockLevel}`);
  }
}

// ─────────────────────────────────────────── 2. рецепты

const recipes = [];
for (const c of CRAFT_CATS) {
  if (c.id === 'weapon') for (const s of WEAPON_SUBS) recipes.push(...recipesFor('weapon', s.id));
  else recipes.push(...recipesFor(c.id));
}
const seenRecipe = new Set();
for (const r of recipes) {
  const key = r.name + '|' + r.lvl;
  if (seenRecipe.has(key)) continue;
  seenRecipe.add(key);
  for (const mat of Object.keys(r.mats || {})) {
    if (!MATERIAL_KEYS.includes(mat)) { note('рецепт просит несуществующий материал', `«${r.name}» → ${mat}`); continue; }
    const w = whereMaterial(mat);
    if (!w.length) { note('материал ниоткуда не падает', `${mat} (нужен для «${r.name}»)`); continue; }
    const soonest = Math.min(...w.map((x) => x.unlock));
    if (soonest > (r.lvl || 1) + 2) {
      note('рецепт открыт раньше сырья', `«${r.name}» с ${r.lvl} ур., а ${mat} — только с ${soonest}`);
    }
  }
}

// материалы, которые не нужны никому и ниоткуда не падают
for (const m of MATERIAL_KEYS) {
  const dropped = whereMaterial(m).length > 0;
  const used = recipes.some((r) => r.mats && r.mats[m]) || QUEST_LINE.some((q) => q.target === m);
  if (!dropped && used) note('материал нужен, но не падает', m);
  if (dropped && !used) note('материал падает, но никому не нужен', m);
}

// ─────────────────────────────────────────── 3. предметы

const rng = makeRng(20260805);
const kinds = [['weapon', 'sword'], ['weapon', 'axe'], ['weapon', 'bow'], ['weapon', 'staff'],
               ['weapon', 'spear'], ['weapon', 'dagger'], ['armor', null], ['helm', null],
               ['trinket', 'ring'], ['trinket', 'amulet']];
const rar = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
let made = 0, noName = 0;
for (let tier = 0; tier <= 6; tier++) {
  for (const [k, sub] of kinds) {
    for (const rr of rar) {
      for (let i = 0; i < 6; i++) {
        const it = makeItem({ kind: k, sub, tier, rarity: rr, level: 1 + tier * 6, rng });
        if (!it) { note('предмет не собрался', `${k}/${sub}/${tier}/${rr}`); continue; }
        made++;
        if (!it.name || !it.name.trim()) noName++;
        const st = it.stats || {};
        for (const [sk, sv] of Object.entries(st)) {
          if (!Number.isFinite(sv)) note('нечисловая характеристика', `${it.name}: ${sk}=${sv}`);
          else if (sv < 0 && !['spd'].includes(sk)) note('отрицательная характеристика', `${it.name}: ${sk}=${sv}`);
        }
        if (k === 'weapon' && !(st.atk > 0)) note('оружие без урона', `${it.name} (ранг ${tier}, ${rr})`);
        if (k === 'armor' && !(st.def > 0)) note('доспех без защиты', `${it.name} (ранг ${tier}, ${rr})`);
        if (rr !== 'common' && Object.keys(st).length === 0) note('редкая вещь без свойств', `${it.name} (${rr})`);
      }
    }
  }
}
if (noName) note('предмет без названия', `${noName} шт.`);

// ─────────────────────────────────────────── итог

const byKind = new Map();
for (const b of bad) byKind.set(b.kind, (byKind.get(b.kind) || 0) + 1);

console.log(`заданий ${QUEST_LINE.length}, рецептов ${seenRecipe.size}, материалов ${MATERIAL_KEYS.length}, предметов собрано ${made}`);
if (!bad.length) { console.log('ПРОБЛЕМ НЕ НАЙДЕНО'); process.exit(0); }
console.log(`\nнайдено: ${bad.length}`);
for (const [kind, n] of [...byKind].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${kind}: ${n}`);
  for (const b of bad.filter((x) => x.kind === kind).slice(0, 6)) console.log(`      ${b.what}`);
  const rest = bad.filter((x) => x.kind === kind).length - 6;
  if (rest > 0) console.log(`      …и ещё ${rest}`);
}
