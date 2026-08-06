// Кузня: ковка по рецептам, переплавка аффиксов, разбор на материалы и заточка.
// Заточка — единственная механика в игре, где можно потерять надетое оружие,
// поэтому все числа вынесены сюда и показываются игроку до броска.

import { RARITY, RARITY_ORDER } from '../art/palette.js';
import { t, getLang } from '../core/i18n.js';
import { makeItem, makeConsumable, makeMaterial, MATERIALS, itemPower,
         addRandomAffix, temperName, grantUnique } from './items.js';
import { UNIQUES } from './uniques.js';
import { makeRng } from '../core/rng.js';
import { clamp } from '../core/util.js';

// ─────────────────────────────────────────── ковка

export const TIER_NAMES = ['Кожаный', 'Бронзовый', 'Железный', 'Стальной', 'Златой', 'Аркановый', 'Драконий'];

/** Материалы и цена по рангу. Ранг 0 не куётся — это стартовое барахло. */
const TIER_COST = [
  null,
  { mats: { ironOre: 3, hide: 2 },                          gold: 60,   lvl: 3 },
  { mats: { ironOre: 5, fang: 3, slimeGel: 2 },             gold: 150,  lvl: 7 },
  { mats: { ironOre: 6, silverOre: 2, bogHeart: 3 },        gold: 340,  lvl: 12 },
  { mats: { silverOre: 5, essence: 3, iceShard: 3 },        gold: 760,  lvl: 17 },
  { mats: { silverOre: 6, runeCore: 2, voidShard: 2 },      gold: 1600, lvl: 22 },
  { mats: { dragonScale: 4, runeCore: 3, voidShard: 4, ember: 5 }, gold: 3400, lvl: 27 },
];

const KIND_MULT = { weapon: 1, armor: 1.3, helm: 0.8, trinket: 0.7 };

export const WEAPON_SUBS = [
  { id: 'sword',  name: 'Меч' },
  { id: 'axe',    name: 'Топор' },
  { id: 'dagger', name: 'Кинжал' },
  { id: 'spear',  name: 'Копьё' },
  { id: 'staff',  name: 'Посох' },
  { id: 'bow',    name: 'Лук' },
];

export const CRAFT_CATS = [
  { id: 'weapon',  name: 'Оружие' },
  { id: 'armor',   name: 'Броня' },
  { id: 'trinket', name: 'Украшения' },
  { id: 'potion',  name: 'Зелья' },
  { id: 'breach',  name: 'Пролом' },
];

/**
 * Ковка Пролома.
 *
 * Стекло разлома снимают с Бледных кузнецов и Титанов — с тех, кто в Проломе
 * ковал. Логично, что из него куётся то же самое, и это единственный способ
 * получить свойство биома **выбором**, а не удачей: с тварей оно падает, но
 * какое именно — решает бросок. Здесь игрок берёт нужное.
 *
 * Цена высокая намеренно: четыре стекла — это четыре Титана или кузнеца, а
 * дешёвый путь к легендарке обесценил бы и добычу, и вехи заточки.
 */
const BREACH_FORGE = [
  { id: 'bf-weapon',  kind: 'weapon',  sub: 'sword', unique: 'shieldbreaker', name: 'Створ' },
  { id: 'bf-armor',   kind: 'armor',   unique: 'riftStep',      name: 'Шаг сквозь' },
  { id: 'bf-skin',    kind: 'armor',   unique: 'voidSkin',      name: 'Пустотная кожа' },
  { id: 'bf-helm',    kind: 'helm',    unique: 'trueSight',     name: 'Верный глаз' },
  { id: 'bf-trinket', kind: 'trinket', sub: 'amulet', unique: 'heartOfBreach', name: 'Осколок Сердца' },
];

function scaleMats(mats, mult) {
  const out = {};
  for (const k in mats) out[k] = Math.max(1, Math.round(mats[k] * mult));
  return out;
}

/** Список рецептов категории. Для оружия подтип выбирается отдельно. */
/**
 * Имя рецепта: «Бронзовый меч» / «Bronze Sword».
 *
 * Русский вариант понижает регистр существительного, английский — нет: там оба
 * слова заглавные. Собирается при показе, а не один раз при загрузке, поэтому
 * смена языка видна сразу.
 */
function craftName(tier, label) {
  return getLang() === 'ru'
    ? `${tier} ${label.toLowerCase()}`
    : `${t(tier)} ${t(label)}`;
}

export function recipesFor(cat, sub) {
  const out = [];
  if (cat === 'breach') {
    return BREACH_FORGE.map((b) => ({
      id: b.id, name: b.name, unique: b.unique,
      out: { kind: b.kind, sub: b.sub || b.kind, tier: 6, rarity: 'legendary', unique: b.unique },
      mats: { riftGlass: 4, paleAsh: 6, runeCore: 2 },
      gold: 7200, lvl: 42,
      desc: UNIQUES[b.unique] ? UNIQUES[b.unique].desc : '',
    }));
  }
  if (cat === 'potion') {
    return [
      { id: 'p1', name: 'Малое зелье лечения', out: { consumable: 'potionS', count: 3 }, mats: { herbBundle: 2 }, gold: 30, lvl: 1 },
      { id: 'p2', name: 'Зелье лечения',        out: { consumable: 'potionM', count: 3 }, mats: { herbBundle: 3, bogHeart: 1 }, gold: 90, lvl: 8 },
      { id: 'p3', name: 'Большое зелье лечения',out: { consumable: 'potionL', count: 3 }, mats: { herbBundle: 4, essence: 2 }, gold: 220, lvl: 15 },
      { id: 'p4', name: 'Зелье маны',           out: { consumable: 'manaM', count: 3 },   mats: { essence: 2, herbBundle: 2 }, gold: 110, lvl: 8 },
      // 14 → 20: тлеющий уголь падает только в Пепельной пустоши, а туда
      // пускают с 21-го. Рецепт шесть уровней висел в списке недостижимым.
      { id: 'p5', name: 'Эликсир ярости',       out: { consumable: 'elixir', count: 2 },  mats: { ember: 2, essence: 2 }, gold: 260, lvl: 20 },
      { id: 'p6', name: 'Эликсир камня',        out: { consumable: 'elixirD', count: 2 }, mats: { iceShard: 2, essence: 2 }, gold: 260, lvl: 14 },
      { id: 'p7', name: 'Свиток возврата',      out: { consumable: 'scroll', count: 3 },  mats: { essence: 1, boneDust: 2 }, gold: 120, lvl: 5 },
      // Пепел идёт и в зелья: материал, который только продают, — половина
      // материала. Оба рецепта открыты с 40-го, то есть ровно с Пролома.
      { id: 'p8', name: 'Настой пустоты',        out: { consumable: 'potionL', count: 5 },  mats: { paleAsh: 2, herbBundle: 4 }, gold: 420, lvl: 40 },
      { id: 'p9', name: 'Эликсир бледного',      out: { consumable: 'elixirD', count: 3 },  mats: { paleAsh: 3, essence: 3 },    gold: 560, lvl: 40 },
    ];
  }
  const kinds = cat === 'armor' ? [['armor', 'Доспех'], ['helm', 'Шлем']]
    : cat === 'trinket' ? [['ring', 'Кольцо'], ['amulet', 'Амулет']]
    : [['weapon', (WEAPON_SUBS.find((w) => w.id === sub) || WEAPON_SUBS[0]).name]];

  for (let tier = 1; tier <= 6; tier++) {
    const t = TIER_COST[tier];
    for (const [k, label] of kinds) {
      const kind = k === 'ring' || k === 'amulet' ? 'trinket' : k;
      const mult = KIND_MULT[kind] || 1;
      out.push({
        id: `${k}${tier}`,
        name: craftName(TIER_NAMES[tier], label),
        out: { kind, sub: kind === 'weapon' ? sub : (k === 'ring' || k === 'amulet' ? k : kind), tier },
        mats: scaleMats(t.mats, mult),
        gold: Math.round(t.gold * mult),
        lvl: t.lvl,
      });
    }
  }
  return out;
}

export function canAfford(player, recipe) {
  if (player.gold < recipe.gold) return false;
  for (const k in recipe.mats) if (player.countMaterial(k) < recipe.mats[k]) return false;
  return true;
}

/** Кованая вещь заведомо лучше случайного дропа своего ранга. */
export function craftItem(player, recipe, rng) {
  const r = rng || makeRng((Math.random() * 1e9) | 0);
  if (recipe.out.consumable) {
    const it = makeConsumable(recipe.out.consumable, recipe.out.count || 1);
    return it;
  }
  // Ковка Пролома выдаёт заранее известное свойство: за него и платят.
  if (recipe.out.unique) {
    return makeItem({
      kind: recipe.out.kind, sub: recipe.out.sub, tier: recipe.out.tier,
      level: Math.max(42, player.level), rarity: 'legendary',
      unique: recipe.out.unique, rng: r, luck: 6,
    });
  }
  const rarity = r() < 0.18 ? 'epic' : 'rare';
  return makeItem({
    kind: recipe.out.kind, sub: recipe.out.sub, tier: recipe.out.tier,
    level: Math.max(1, recipe.out.tier * 5 + r.int(0, 3)),
    rarity, rng: r,
  });
}

// ─────────────────────────────────────────── разбор

/** Что даёт разбор: зависит от ранга и редкости. */
export function salvageYield(item) {
  const tier = clamp(item.tier || 0, 0, 6);
  const rIdx = Math.max(0, RARITY_ORDER.indexOf(item.rarity || 'common'));
  const out = {};
  const add = (k, n) => { if (n > 0) out[k] = (out[k] || 0) + n; };
  if (tier <= 2) add('ironOre', 1 + tier + rIdx);
  else if (tier <= 4) { add('ironOre', 2); add('silverOre', tier - 1 + rIdx); }
  else { add('silverOre', 3); add('voidShard', tier - 4 + rIdx); }
  if (tier >= 5 && rIdx >= 3) add('dragonScale', 1);
  // Пепел с разбора: иначе добыча Пролома идёт только с тварей, и вещи,
  // принесённые оттуда, разбираются в то же серебро, что и хлам из топи.
  if (tier >= 6 && rIdx >= 3) add('paleAsh', rIdx - 2);
  if (rIdx >= 2) add('essence', rIdx - 1);
  return { mats: out, gold: Math.round((item.price || 10) * 0.18) };
}

// ─────────────────────────────────────────── переплавка

export function reforgeCost(item) {
  const rIdx = Math.max(0, RARITY_ORDER.indexOf(item.rarity || 'common'));
  const tier = clamp(item.tier || 0, 0, 6);
  return {
    gold: Math.round(120 + tier * 90 + rIdx * 160),
    mats: { essence: 1 + rIdx, ironOre: 2 + tier },
  };
}

// ─────────────────────────────────────────── заточка

/** Базовый шанс успеха по редкости основного оружия. */
export const SHARP_BASE = {
  common: 0.60, uncommon: 0.40, rare: 0.25, epic: 0.14, legendary: 0.08,
};
export const SHARP_MAX = 8;
/** Прирост характеристик за каждый уровень заточки. */
export const SHARP_GAIN = 0.12;

/**
 * Шанс плоский по редкости. Спад за уровень тут был, но цепочка «всё или ничего»
 * его не выдерживает: со спадом 18% дойти до +7 на редком оружии — 1 случай из
 * 68 000, то есть веха просто не существовала бы. Сложность держит редкость.
 */
export function sharpenChance(item) {
  return clamp(SHARP_BASE[item.rarity] ?? 0.4, 0.02, 0.95);
}

export function sharpenCost(item) {
  const rIdx = Math.max(0, RARITY_ORDER.indexOf(item.rarity || 'common'));
  const lvl = item.sharp || 0;
  // Цена росла только от редкости и числа заточек, но не от уровня вещи —
  // и к 40-му уровню эндгеймовый сток стоил столько же, сколько на 10-м.
  const scale = 1 + (item.level || 1) * 0.06;
  const mats = { ironOre: 2 + lvl, silverOre: rIdx >= 2 ? 1 + Math.floor(lvl / 2) : 0 };
  // Стекло разлома — только на последнюю ступень, +7 → +8.
  //
  // Сначала оно требовалось с пятой, и замер показал, чем это кончится: до +5
  // на редком оружии уходит ~53к золота и ~60 стволов на топливо, то есть
  // игрок доходит туда задолго до 40-го уровня. А веха +7 — это уникальное
  // свойство, ради которого оружие и держат долго; отодвинуть её за Пролом
  // значит сломать то, зачем вехи делались. Все три вехи (3, 5, 7) остаются
  // где были, за Проломом — только шаг, который ни одной вехи не даёт.
  if (lvl >= 7) mats.riftGlass = 2;
  return {
    gold: Math.round((80 + rIdx * 220) * (1 + lvl * 0.55) * scale),
    mats,
  };
}

/** Топливо: три оружия ровно той же редкости, не надетые. */
export function sharpenFuel(player, base) {
  return player.inventory
    .filter((i) => i.kind === 'weapon' && i.rarity === base.rarity && i !== base)
    .sort((a, b) => itemPower(a) - itemPower(b))
    .slice(0, 3);
}

/**
 * Вехи заточки — то, ради чего оружие держат долго. Обычный уровень даёт только
 * числа, а веха — свойство, которое в ковке не достать.
 */
export const SHARP_MILESTONES = {
  3: { label: 'бонусный аффикс' },
  5: { label: 'ещё аффикс и закалка' },
  // легендарное свойство на обычном хламе обесценило бы редкость — только с редкого
  7: { label: 'уникальное свойство', minRarity: 'rare' },
};
export const MILESTONE_LEVELS = [3, 5, 7];

/** Доступна ли веха этой вещи (у +7 есть порог редкости). */
export function milestoneOpen(item, lvl) {
  const m = SHARP_MILESTONES[lvl];
  if (!m) return false;
  if (!m.minRarity) return true;
  return RARITY_ORDER.indexOf(item.rarity || 'common') >= RARITY_ORDER.indexOf(m.minRarity);
}

/** Что даст следующая заточка, если она удастся. Null — просто числа. */
export function nextMilestone(item) {
  const at = (item.sharp || 0) + 1;
  return milestoneOpen(item, at) ? { at, ...SHARP_MILESTONES[at] } : null;
}

/**
 * Последняя взятая веха — она же точка отката при провале. Вехи работают
 * контрольными точками: иначе каждая попытка начиналась бы с нуля и глубокая
 * заточка была бы арифметически мертва.
 */
export function sharpFloor(item) {
  const lvl = item.sharp || 0;
  let f = null;
  for (const m of MILESTONE_LEVELS) if (m <= lvl) f = m;
  return f;
}

function snapshot(it) {
  return {
    sharp: it.sharp, name: it.name, price: it.price, stats: { ...it.stats },
    temper: it.temper ? [...it.temper] : null,
    affixNames: it.affixNames ? [...it.affixNames] : null,
    tempered: it.tempered || false, unique: it.unique || null, desc: it.desc || null,
  };
}

/** Откат к последней вехе после провала. false — откатывать некуда. */
export function revertToMilestone(item) {
  const c = item.checkpoint;
  if (!c) return false;
  item.sharp = c.sharp;
  item.name = c.name;
  item.price = c.price;
  item.stats = { ...c.stats };
  item.temper = c.temper ? [...c.temper] : undefined;
  item.affixNames = c.affixNames ? [...c.affixNames] : undefined;
  item.tempered = c.tempered;
  item.unique = c.unique || undefined;
  item.desc = c.desc || undefined;
  return true;
}

/** Применяет успешную заточку прямо к предмету. Возвращает список наград-вех. */
export function applySharpen(item, rng) {
  item.sharp = (item.sharp || 0) + 1;
  const s = item.stats;
  for (const k of ['atk', 'def', 'hp', 'mp', 'magic']) {
    if (s[k]) s[k] = Math.max(s[k] + 1, Math.round(s[k] * (1 + SHARP_GAIN)));
  }

  const gained = [];
  if ((item.sharp === 3 || item.sharp === 5) && milestoneOpen(item, item.sharp)) {
    const a = addRandomAffix(item, rng);
    if (a) gained.push('аффикс «' + a + '»');
  }
  if (item.sharp === 7 && milestoneOpen(item, 7)) {
    const u = grantUnique(item, rng);
    if (u) gained.push('свойство «' + UNIQUES[u].name + '»');
  }

  let bare = item.name.replace(/\s\+\d+$/, '');
  if (item.sharp >= 5 && !item.tempered && milestoneOpen(item, 5)) {
    item.tempered = true;
    bare = temperName(item) + ' ' + bare.charAt(0).toLowerCase() + bare.slice(1);
    gained.push('закалка');
  }
  item.name = bare + ' +' + item.sharp;
  item.price = Math.round(item.price * (1 + SHARP_GAIN * 1.6));
  // взятая веха становится точкой отката
  if (MILESTONE_LEVELS.includes(item.sharp)) item.checkpoint = snapshot(item);
  return gained;
}

// ─────────────────────────────────────────── общее

export function matName(key) {
  return (MATERIALS[key] || {}).name || key;
}

export function matsText(mats, player) {
  const parts = [];
  for (const k in mats) {
    if (!mats[k]) continue;
    const have = player ? player.countMaterial(k) : 0;
    parts.push({ key: k, need: mats[k], have, ok: have >= mats[k], name: matName(k) });
  }
  return parts;
}
