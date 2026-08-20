// Генерация предметов: база по типу и рангу + аффиксы по редкости.

import { RARITY, RARITY_ORDER } from '../art/palette.js';
import { itemIcon } from '../art/props.js';
import { makeRng } from '../core/rng.js';
import { clamp, weighted, roman } from '../core/util.js';
import { addResolver } from '../core/i18n.js';
import { SKILLS, PASSIVES, ACTIVE_KEYS, PASSIVE_KEYS, ELEM, skillDesc } from './skills.js';
import { UNIQUES, uniquesFor, SETS, SET_KEYS } from './uniques.js';

let nextId = 1;

export const WEAPON_NAMES = {
  sword:  ['Ржавый меч', 'Железный меч', 'Стальной клинок', 'Клинок стражи', 'Златой эсток', 'Аркановый клинок', 'Драконий палаш'],
  axe:    ['Дровяной топор', 'Бронзовый топор', 'Секира', 'Боевая секира', 'Златая секира', 'Руническая секира', 'Топор пепла'],
  dagger: ['Обломок ножа', 'Бронзовый кинжал', 'Стилет', 'Клык ночи', 'Златой кинжал', 'Теневой клык', 'Кровавый клык'],
  staff:  ['Ветвь друида', 'Бронзовый посох', 'Посох ученика', 'Посох магистра', 'Златой скипетр', 'Аркановый посох', 'Жезл Бездны'],
  bow:    ['Самодельный лук', 'Охотничий лук', 'Тисовый лук', 'Лук стражи', 'Златой лук', 'Лук Звездопада', 'Лук багровых ветров'],
  spear:  ['Заострённый кол', 'Бронзовое копьё', 'Пика', 'Алебарда', 'Златое копьё', 'Копьё Бури', 'Копьё Расплава'],
};

export const ARMOR_NAMES = ['Тряпьё странника', 'Кожаный доспех', 'Кольчуга', 'Латы стражи', 'Златые латы', 'Аркановая мантия', 'Драконья броня'];
export const HELM_NAMES  = ['Холщовая повязка', 'Кожаный шлем', 'Железный шлем', 'Шлем стражи', 'Златой шлем', 'Венец магистра', 'Шлем Колосса'];
export const RING_NAMES  = ['Медное кольцо', 'Бронзовое кольцо', 'Серебряное кольцо', 'Кольцо стражи', 'Златое кольцо', 'Кольцо Арканы', 'Кольцо Дракона'];
export const AMULET_NAMES= ['Костяной амулет', 'Бронзовый амулет', 'Серебряный оберег', 'Амулет стражи', 'Златой амулет', 'Амулет Арканы', 'Сердце Дракона'];

// Род каждого названия — чтобы префикс согласовывался: «кровавое кольцо», а не «кровавый кольцо».
const GENDER = {
  sword:  'mmmmmmm',
  axe:    'mmffffm',
  dagger: 'mmmmmmm',
  staff:  'fmmmmmm',
  bow:    'mmmmmmm',
  spear:  'mnffnnn',
  armor:  'nmfppff',
  helm:   'fmmmmmm',
  ring:   'nnnnnnn',
  amulet: 'mmmmmmn',
};
const genderOf = (key, tier) => (GENDER[key] || 'mmmmmmm')[tier] || 'm';

/**
 * Профиль типа оружия — единственное его описание.
 *
 * Было два: этот и отдельные таблицы темпа с дальностью в `Player`. Они
 * разошлись, и аудит боя поймал это числами: по профилю топор и кинжал шли
 * вровень (1,02 против 1,04), а на деле кинжал бил в 1,7 раза сильнее. Реальный
 * темп топора оказался 0,705 вместо обещанных 0,80, кинжала — 1,605 вместо
 * 1,45. Теперь `attackRate` и `attackRange` считаются отсюда, и разойтись
 * больше нечему.
 *
 * `spd` — во сколько раз чаще бьёт относительно меча, `range` — во сколько раз
 * длиннее его размах.
 */
/**
 * Профили видов оружия.
 *
 * `atk × spd` — это и есть задуманное отношение урона в секунду к мечу. Раньше
 * оно ничего не значило: множитель атаки разбавлялся вдвое (оружие — половина
 * общей атаки), скорость считалась дважды, а `crit` в расчёт не входил вовсе.
 * Всё три починены, и теперь числа здесь означают ровно то, что написано.
 *
 * `crit` учтён в `atk`: у кинжала восемь единиц крита стоят ещё +4% урона в
 * секунду, у лука четыре — +1.4%, и без поправки они снова расходились бы с
 * замыслом. Поэтому у них `atk` чуть ниже круглого.
 *
 * Разброс между пятью ближними видами держим в пределах ×1.08: оружие обязано
 * отличаться повадкой — размахом, темпом, дальностью, — но не быть строго
 * лучше или хуже. Посох стоит особняком: он отстаёт по ближнему бою нарочно,
 * и платит за это силой магии.
 */
export const WEAPON_PROFILE = {
  sword:  { atk: 1.00, spd: 1.00, range: 1.00, crit: 0, hint: 'сбалансированный' },
  axe:    { atk: 1.28, spd: 0.80, range: 0.95, crit: 0, hint: 'медленный, тяжёлый' },
  dagger: { atk: 0.69, spd: 1.45, range: 0.78, crit: 8, hint: 'быстрый, критует' },
  spear:  { atk: 1.05, spd: 0.92, range: 1.35, crit: 0, hint: 'длинный размах' },
  staff:  { atk: 0.85, spd: 1.05, range: 1.05, crit: 0, magic: 0.55, hint: '+сила магии' },
  bow:    { atk: 0.89, spd: 1.10, range: 1.10, crit: 4, hint: 'стреляет издалека' },
};

// n — формы по родам: мужской / женский / средний / множественный
const PREFIX = [
  { n: ['Острый', 'Острая', 'Острое', 'Острые'],                             s: { atk: 0.12 } },
  { n: ['Тяжёлый', 'Тяжёлая', 'Тяжёлое', 'Тяжёлые'],                         s: { atk: 0.18, spd: -4 } },
  { n: ['Быстрый', 'Быстрая', 'Быстрое', 'Быстрые'],                         s: { spd: 7 } },
  { n: ['Каменный', 'Каменная', 'Каменное', 'Каменные'],                     s: { def: 0.2, hp: 0.15 } },
  { n: ['Пылающий', 'Пылающая', 'Пылающее', 'Пылающие'],                     s: { atk: 0.1, burn: 6 } },
  { n: ['Ледяной', 'Ледяная', 'Ледяное', 'Ледяные'],                         s: { atk: 0.08, slow: 18 } },
  { n: ['Ядовитый', 'Ядовитая', 'Ядовитое', 'Ядовитые'],                     s: { poison: 8 } },
  { n: ['Благословенный', 'Благословенная', 'Благословенное', 'Благословенные'], s: { hp: 0.2, regen: 0.6 } },
  { n: ['Звёздный', 'Звёздная', 'Звёздное', 'Звёздные'],                     s: { mp: 0.3, magic: 0.15 } },
  { n: ['Кровавый', 'Кровавая', 'Кровавое', 'Кровавые'],                     s: { lifesteal: 5 } },
  { n: ['Древний', 'Древняя', 'Древнее', 'Древние'],                         s: { atk: 0.1, def: 0.1, hp: 0.1 } },
  { n: ['Точный', 'Точная', 'Точное', 'Точные'],                             s: { crit: 6 } },
];
const GIDX = { m: 0, f: 1, n: 2, p: 3 };

const SUFFIX = [
  { n: 'силы',       s: { str: 2 } },
  { n: 'стойкости',  s: { vit: 2 } },
  { n: 'ловкости',   s: { agi: 2 } },
  { n: 'мудрости',   s: { int: 2 } },
  { n: 'ярости',     s: { atk: 0.15, cdmg: 12 } },
  { n: 'вампира',    s: { lifesteal: 6 } },
  { n: 'грома',      s: { crit: 5, cdmg: 15 } },
  { n: 'вечности',   s: { hp: 0.25, mp: 0.25 } },
  { n: 'охотника',   s: { agi: 1, crit: 4 } },
  { n: 'бастиона',   s: { def: 0.3 } },
];

// ── Разбор склеенных имён для перевода
//
// «Стальной клинок ярости» собирается при выпадении и в таком виде лежит в
// сохранении. Записать все сочетания в словарь нельзя — их тысячи: семь рангов
// на шесть видов оружия, двадцать приставок в четырёх родах и десять окончаний.
// Поэтому промах по словарю разбирается здесь: приставка, основа, окончание —
// каждая часть переводится отдельно, а собирается уже по-английски, без
// понижения регистра, которое нужно только русскому.
//
// Заодно это чинит старые сохранения: имя в них лежит русской строкой, и
// разбор переведёт его так же, как свежую добычу.
const BASE_NAMES = [
  ...Object.values(WEAPON_NAMES).flat(),
  ...ARMOR_NAMES, ...HELM_NAMES, ...RING_NAMES, ...AMULET_NAMES,
];
// от длинных к коротким: «Кожаный шлем» не должен съесться разбором «шлем»
const BASE_SORTED = BASE_NAMES.slice().sort((a, b) => b.length - a.length);
const PREFIX_FORMS = PREFIX.flatMap((p) => p.n).sort((a, b) => b.length - a.length);
const SUFFIX_FORMS = SUFFIX.map((s) => s.n).sort((a, b) => b.length - a.length);
// приставка склоняется по роду, но переводится одна и та же — сводим к первой форме
const PREFIX_CANON = {};
for (const p of PREFIX) for (const f of p.n) PREFIX_CANON[f] = p.n[0];

export function parseItemName(s, tr) {
  let rest = s, pre = null, suf = null;
  // Заточка дописывает к имени « +N», а на пятой ступени ещё и «Закалённый».
  // Разбор этого не знал, окончание переставало совпадать — и заточенная вещь
  // оставалась русской навсегда. А точат её все.
  let ступень = '';
  const хвост = rest.match(/\s\+\d+$/);
  if (хвост) { ступень = хвост[0]; rest = rest.slice(0, -хвост[0].length); }
  let закал = null;
  for (const f of TEMPER_FORMS) {
    if (rest.startsWith(f + ' ')) { закал = f; rest = rest.slice(f.length + 1); break; }
  }
  // Регистр не в счёт: под «Закалённым» аффикс уходит в нижний — «Закалённый
  // звёздный клинок», — и точное сравнение переставало срабатывать. Основу
  // ниже ищут так же, без учёта регистра, и по той же причине.
  const низ = rest.toLowerCase();
  for (const f of PREFIX_FORMS) {
    if (низ.startsWith(f.toLowerCase() + ' ')) { pre = f; rest = rest.slice(f.length + 1); break; }
  }
  for (const f of SUFFIX_FORMS) {
    if (rest.endsWith(' ' + f)) { suf = f; rest = rest.slice(0, -f.length - 1); break; }
  }
  if (!pre && !suf && !закал) return null;
  // с приставкой основа стоит в нижнем регистре — ищем без учёта регистра
  const low = rest.toLowerCase();
  const base = BASE_SORTED.find((b) => b.toLowerCase() === low);
  if (!base) return null;
  const parts = [];
  if (закал) parts.push(tr(закал));
  if (pre) parts.push(tr(PREFIX_CANON[pre] || pre));
  parts.push(tr(base));
  if (suf) parts.push(tr(suf));
  // Ступень приклеиваем обратно как есть: это число, переводить нечего.
  return parts.join(' ') + ступень;
}

addResolver((s, tr) => parseItemName(s, tr));

export const STAT_LABEL = {
  atk: 'Урон', dps: 'Урон в секунду', def: 'Защита', hp: 'Здоровье', mp: 'Мана',
  str: 'Сила', vit: 'Выносл.', agi: 'Ловкость', int: 'Разум',
  crit: 'Крит %', cdmg: 'Крит.урон %', spd: 'Скорость %',
  lifesteal: 'Вампиризм %', regen: 'Реген/с', magic: 'Сила магии',
  burn: 'Поджиг', poison: 'Яд', slow: 'Замедление %',
};

function baseFor(kind, sub, tier, level) {
  const t = tier + 1;
  switch (kind) {
    case 'weapon': {
      const p = WEAPON_PROFILE[sub] || WEAPON_PROFILE.sword;
      const base = 4 + t * 4.6 + level * 1.05;
      return {
        atk: Math.round(base * p.atk),
        crit: p.crit,
        // `spd` профиля здесь больше не откладывается статом.
        //
        // Он уже делит темп атаки в `attackRate`, а стат `spd` делит его ещё
        // раз через `gear.spd/220` — то есть скорость считалась дважды. У
        // кинжала это давало лишние 4.5% сверх профиля, у топора отнимало 1.8%,
        // и разброс между видами рос сам собой. `spd` остаётся статом аффиксов
        // («Быстрый») и украшений — там он не дублирует ничего.
        //
        // Посох наконец получает то, что обещает подсказка «+сила магии».
        // Раньше её не было вовсе: магия считается от `g.magic` и половины
        // `g.atk`, а раз атака посоха ниже средней, он давал магии **меньше**
        // меча. Обещание в подсказке — тоже часть правил.
        ...(p.magic ? { magic: Math.round(base * p.magic) } : {}),
      };
    }
    case 'armor': return { def: Math.round(2 + t * 3.1 + level * 0.72), hp: Math.round(6 + t * 7 + level * 2.1) };
    case 'helm':  return { def: Math.round(1 + t * 1.9 + level * 0.42), mp: Math.round(3 + t * 4 + level * 1.1) };
    case 'trinket': return sub === 'amulet'
      ? { mp: Math.round(5 + t * 5 + level * 1.4), int: Math.max(1, Math.round(t * 0.7)), crit: 2 + tier }
      : { hp: Math.round(4 + t * 4 + level * 1.2), crit: 3 + tier, spd: 2 + tier };
    default: return {};
  }
}

function applyAffix(stats, affix, base) {
  for (const k in affix.s) {
    const v = affix.s[k];
    if (k === 'atk' || k === 'def' || k === 'hp' || k === 'mp' || k === 'magic') {
      // доля от базы — аффиксы масштабируются вместе с рангом
      const b = base[k] || (k === 'hp' ? 20 : k === 'mp' ? 12 : 6);
      stats[k] = (stats[k] || 0) + Math.max(1, Math.round(b * v));
    } else {
      stats[k] = (stats[k] || 0) + v;
    }
  }
}

// Порядок редкостей уже описан в палитре — берём оттуда, чтобы не завести
// второй список, который однажды разойдётся с первым.
export { RARITY_ORDER };

/** Опустить редкость до потолка, если она его перевалила. */
export function capRarity(rarity, cap) {
  if (!cap) return rarity;
  const i = RARITY_ORDER.indexOf(rarity), c = RARITY_ORDER.indexOf(cap);
  return (c >= 0 && i > c) ? RARITY_ORDER[c] : rarity;
}

/** Поднять потолок на несколько ступеней — для боссов. */
export function raiseRarity(cap, steps = 1) {
  const c = RARITY_ORDER.indexOf(cap);
  if (c < 0) return RARITY_ORDER[RARITY_ORDER.length - 1];
  return RARITY_ORDER[Math.min(RARITY_ORDER.length - 1, c + steps)];
}

/**
 * Потолок редкости по уровню места.
 *
 * Пороги совпадают с наградами за задания (необычная → редкая → эпическая):
 * добыча не должна обгонять сюжет, иначе награда за задание выглядит подачкой.
 */
export function rarityCapFor(level) {
  if (level < 7) return 'rare';
  if (level < 14) return 'epic';
  return 'legendary';
}

/**
 * Какая редкость выпадет с этого врага в этом месте — единственное место, где
 * это решается.
 *
 * Раньше решение было размазано по `dropLoot`, сундукам и лавке, и оттого
 * редкость не зависела от места вовсе: замер показал 0,9% легендарок с рядового
 * и 3,8% с элиты одинаково в лесу на первом уровне и в пустоши на двадцать
 * первом. Босс первого биома и вовсе ронял легендарку в 40% случаев.
 *
 * Потолок опускает выпавшую редкость, а не выбрасывает бросок: у леса под
 * потолком «редкая» доля редких вещей просто становится выше. Босс получает
 * ступень сверх потолка своего места — он и должен быть событием.
 */
export function dropRarity(rng, o = {}) {
  const { boss = false, elite = false, floorRarity = 0, corr = 0, cap = null } = o;
  const потолок = boss ? raiseRarity(cap, 1) : cap;
  let r;
  if (boss) r = rng() < 0.4 + corr * 0.01 ? 'legendary' : 'epic';
  else if (elite) r = rollRarity(rng, 4, floorRarity + 1);
  else r = rollRarity(rng, 1, floorRarity);
  return capRarity(r, потолок);
}

export function rollRarity(rng, luck = 0, floorRarity = 0) {
  const table = [
    ['common', 100 - luck * 6],
    ['uncommon', 34 + luck * 2],
    ['rare', 13 + luck * 2],
    ['epic', 4 + luck * 1.2],
    ['legendary', 0.9 + luck * 0.5],
  ].slice(floorRarity);
  return weighted(table.map(([k, w]) => [k, Math.max(0.4, w)]), rng);
}

/** Собирает предмет. Всё детерминировано от seed, чтобы иконка совпадала с сейвом. */
export function makeItem(o) {
  const rng = o.rng || makeRng((Math.random() * 1e9) | 0);
  const kind = o.kind;
  const level = Math.max(1, o.level | 0 || 1);
  const tier = clamp(o.tier ?? Math.min(6, Math.floor((level - 1) / 5)), 0, 6);
  // Редкость из чужого файла может быть какой угодно. Соседние обращения
  // нарочно защищены (`WEAPON_PROFILE[sub] || sword`, `MATERIALS[key] || {}`),
  // а эти два выпадали из ряда — и один битый предмет ронял весь заход в игру:
  // `continueGame` ничем не обёрнут, а `checkSave` в предметы не смотрит вовсе.
  const rarity = RARITY[o.rarity] ? o.rarity : (o.rarity ? 'common' : rollRarity(rng, o.luck || 0));
  const rInfo = RARITY[rarity] || RARITY.common;

  let sub = o.sub;
  if (!sub) {
    if (kind === 'weapon') sub = rng.pick(['sword', 'axe', 'dagger', 'spear', 'staff', 'bow']);
    else if (kind === 'trinket') sub = rng.pick(['ring', 'amulet']);
    else sub = kind;
  }

  const base = baseFor(kind, sub, tier, level);
  const stats = {};
  for (const k in base) stats[k] = Math.round(base[k] * (k === 'crit' || k === 'spd' ? 1 : rInfo.mult));

  // Имя берётся по таблице, и обращение вслепую здесь опасно: неизвестный
  // подтип оружия или ранг за краем таблицы роняли всю сборку предмета — а это
  // значит, что добыча с врага просто пропала бы, и понять почему было бы не по
  // чему. Подставляем разумное вместо падения.
  const nameAt = (table, i) => (table && table.length ? table[Math.max(0, Math.min(table.length - 1, i | 0))] : null);
  let name =
    kind === 'weapon' ? nameAt(WEAPON_NAMES[sub] || WEAPON_NAMES.sword, tier) :
    kind === 'armor' ? nameAt(ARMOR_NAMES, tier) :
    kind === 'helm' ? nameAt(HELM_NAMES, tier) :
    sub === 'amulet' ? nameAt(AMULET_NAMES, tier) : nameAt(RING_NAMES, tier);
  if (!name) name = 'Находка';

  const affixNames = [];
  const affixes = [];
  const n = rInfo.affixes;
  const usedP = new Set(), usedS = new Set();
  for (let i = 0; i < n; i++) {
    const usePrefix = i % 2 === 0;
    const pool = usePrefix ? PREFIX : SUFFIX;
    const used = usePrefix ? usedP : usedS;
    let a = null;
    for (let tries = 0; tries < 8; tries++) {
      const c = rng.pick(pool);
      const id = Array.isArray(c.n) ? c.n[0] : c.n;
      if (!used.has(id)) { a = c; used.add(id); break; }
    }
    if (!a) continue;
    affixNames.push(Array.isArray(a.n) ? a.n[0] : a.n);
    affixes.push({ ...a, prefix: usePrefix });
    applyAffix(stats, a, base);
  }
  const gender = genderOf(kind === 'trinket' ? sub : kind === 'weapon' ? sub : kind, tier);
  const pre = affixes.filter((a) => a.prefix);
  const suf = affixes.filter((a) => !a.prefix);
  if (pre.length) name = pre[0].n[GIDX[gender] ?? 0] + ' ' + name.toLowerCase();
  if (suf.length) name = name + ' ' + suf[0].n;

  // ── легендарка получает уникальное свойство и своё имя
  let unique = null;
  if (rarity === 'legendary') {
    const pool = uniquesFor(kind);
    // явно заданное свойство берём даже вне обычного пула: так падают
    // свойства Бездны, которых в обычной таблице нет
    const asked = o.unique && UNIQUES[o.unique] && UNIQUES[o.unique].kinds.includes(kind);
    if (asked) unique = o.unique;
    else if (pool.length) unique = rng.pick(pool);
    if (unique) name = UNIQUES[unique].name;
  }

  // ── с 3-го ранга броня, шлемы и украшения могут входить в комплект
  let set = null;
  if (!unique && SET_SLOTS_KINDS.includes(kind) && (o.set || (tier >= 3 && rng() < 0.42))) {
    // название не удлиняем: принадлежность к комплекту видна по метке в слоте
    set = o.set || rng.pick(SET_KEYS);
  }

  const power = itemPower({ stats });
  const price = Math.max(6, Math.round((8 + power * 2.4 + tier * 22) * rInfo.mult * (unique ? 2.2 : set ? 1.3 : 1) * (o.priceMult || 1)));

  return {
    id: nextId++,
    kind, sub, tier, rarity, level, name,
    stats,
    price,
    unique, set, affixNames,
    icon: itemIcon(kind, sub, tier, rarity),
    hint: kind === 'weapon' ? (WEAPON_PROFILE[sub] || {}).hint : null,
    desc: unique ? UNIQUES[unique].desc : null,
    reqLevel: Math.max(1, level - 2),
  };
}

const SET_SLOTS_KINDS = ['armor', 'helm', 'trinket'];

/**
 * Навешивает на предмет ещё один аффикс — используется вехами заточки.
 * Имя не трогаем: закалочные аффиксы показываются отдельным блоком в карточке,
 * иначе название обрастало бы вторым и третьим прилагательным.
 */
export function addRandomAffix(item, rng) {
  const r = rng || makeRng((Math.random() * 1e9) | 0);
  const usePrefix = r() < 0.5;
  const pool = usePrefix ? PREFIX : SUFFIX;
  const used = new Set(item.affixNames || []);
  let a = null;
  for (let t = 0; t < 14; t++) {
    const c = r.pick(pool);
    const id = Array.isArray(c.n) ? c.n[0] : c.n;
    if (!used.has(id)) { a = c; break; }
  }
  if (!a) return null;
  const base = baseFor(item.kind, item.sub, item.tier || 0, item.level || 1);
  applyAffix(item.stats, a, base);
  const id = Array.isArray(a.n) ? a.n[0] : a.n;
  (item.affixNames ||= []).push(id);
  (item.temper ||= []).push(id.toLowerCase());
  return id;
}

/**
 * Приставка «Закалённый» во всех родах.
 *
 * Список общий со сборкой имени нарочно: разбору имени он нужен ровно тот же, а
 * вторая копия однажды разойдётся — и заточенная вещь снова перестанет
 * переводиться.
 */
export const TEMPER_FORMS = ['Закалённый', 'Закалённая', 'Закалённое', 'Закалённые'];

/** Приставка «Закалённый» в правильном роде. */
export function temperName(item) {
  const key = item.kind === 'weapon' || item.kind === 'trinket' ? item.sub : item.kind;
  const g = genderOf(key, item.tier || 0);
  return TEMPER_FORMS[GIDX[g] ?? 0];
}

/** Случайное уникальное свойство под тип предмета (веха +7). */
export function grantUnique(item, rng) {
  if (item.unique) return null;
  const pool = uniquesFor(item.kind);
  if (!pool.length) return null;
  const r = rng || makeRng((Math.random() * 1e9) | 0);
  item.unique = r.pick(pool);
  item.desc = UNIQUES[item.unique].desc;
  return item.unique;
}

export function itemPower(it) {
  const s = it.stats || {};
  return Math.round(
    (s.atk || 0) * 2 + (s.def || 0) * 1.8 + (s.hp || 0) * 0.35 + (s.mp || 0) * 0.3 +
    (s.crit || 0) * 1.6 + (s.cdmg || 0) * 0.5 + (s.spd || 0) * 1.2 +
    ((s.str || 0) + (s.vit || 0) + (s.agi || 0) + (s.int || 0)) * 3 +
    (s.lifesteal || 0) * 2 + (s.regen || 0) * 3 + (s.magic || 0) * 1.5
  );
}

// ─────────────────────────────────────────── расходники и материалы

const CONSUMABLES = {
  potionS: { kind: 'potion', sub: 'health', name: 'Малое зелье лечения', heal: 45, price: 22, stack: 20, desc: 'Восстанавливает 45 HP.' },
  potionM: { kind: 'potion', sub: 'health', name: 'Зелье лечения', heal: 120, price: 58, stack: 20, desc: 'Восстанавливает 120 HP.' },
  potionL: { kind: 'potion', sub: 'health', name: 'Большое зелье лечения', heal: 300, price: 140, stack: 20, desc: 'Восстанавливает 300 HP.' },
  manaS:   { kind: 'potion', sub: 'mana', name: 'Малое зелье маны', mana: 40, price: 26, stack: 20, desc: 'Восстанавливает 40 MP.' },
  manaM:   { kind: 'potion', sub: 'mana', name: 'Зелье маны', mana: 110, price: 64, stack: 20, desc: 'Восстанавливает 110 MP.' },
  elixir:  { kind: 'potion', sub: 'elixir', name: 'Эликсир ярости', buff: 'rage', dur: 22, price: 190, stack: 10, desc: '+35% урона на 22 сек.' },
  elixirD: { kind: 'potion', sub: 'elixir', name: 'Эликсир камня', buff: 'stone', dur: 22, price: 190, stack: 10, desc: '-35% получаемого урона на 22 сек.' },
  scroll:  { kind: 'scroll', sub: 'town', name: 'Свиток возврата', price: 90, stack: 10, desc: 'Мгновенно телепортирует в Велорию.' },
};

const MATERIALS = {
  fang:    { name: 'Волчий клык',      sub: 'fang',    price: 14 },
  hide:    { name: 'Грубая шкура',     sub: 'hide',    price: 12 },
  slimeGel:{ name: 'Слизистый сгусток',sub: 'herb',    price: 9 },
  essence: { name: 'Тусклая эссенция', sub: 'essence', price: 30 },
  bogHeart:{ name: 'Сердце топи',      sub: 'herb',    price: 34 },
  iceShard:{ name: 'Осколок льда',     sub: 'ice',     price: 46 },
  ember:   { name: 'Тлеющий уголь',    sub: 'ember',   price: 60 },
  boneDust:{ name: 'Костяная пыль',    sub: 'ore',     price: 26 },
  runeCore:{ name: 'Рунное ядро',      sub: 'essence', price: 120 },
  // ── кузнечное сырьё
  ironOre:    { name: 'Железная руда',     sub: 'ore',    price: 18 },
  silverOre:  { name: 'Серебряная жила',   sub: 'silver', price: 55 },
  herbBundle: { name: 'Пучок трав',        sub: 'herb',   price: 16 },
  dragonScale:{ name: 'Драконья чешуя',    sub: 'scale',  price: 150 },
  voidShard:  { name: 'Осколок пустоты',   sub: 'void',   price: 180 },
  // ── только из Бездны: единственный способ добыть — спуститься глубже 25-го
  abyssTear:  { name: 'Слеза Бездны',      sub: 'void',   price: 420 },
  // ── только из Пролома. Задание на сбор обязано вести именно туда, иначе
  // третий акт закрывается на старых картах и биом остаётся декорацией.
  paleAsh:    { name: 'Бледный пепел',     sub: 'void',   price: 260 },
  riftGlass:  { name: 'Стекло разлома',    sub: 'void',   price: 540 },
};

// ─────────────────────────────────────────── руны умений

const RUNE_POWER = { common: 1.0, uncommon: 1.16, rare: 1.34, epic: 1.58, legendary: 1.95 };

/** Руна: активная вставляется в слот умения, пассивная — в слот пассивки. */
export function makeRune(key, rarityIn = 'common', level = 1) {
  const rarity = RARITY[rarityIn] ? rarityIn : 'common';
  const active = !!SKILLS[key];
  const def = active ? SKILLS[key] : PASSIVES[key];
  if (!def) return null;
  const power = RUNE_POWER[rarity] || 1;
  const elem = ELEM[def.elem] || ELEM.phys;
  const rInfo = RARITY[rarity] || RARITY.common;
  return {
    id: nextId++, kind: 'rune', sub: key, runeType: active ? 'active' : 'passive',
    name: 'Руна: ' + def.name,
    rarity, level, tier: RARITY_ORDER.indexOf(rarity),
    power,
    cost: active ? Math.round(def.cost * (1.1 - power * 0.1)) : 0,
    cd: active ? +(def.cd * (1.12 - power * 0.12)).toFixed(2) : 0,
    stats: {},
    desc: skillDesc(key, power),
    price: Math.round((60 + level * 14) * rInfo.mult * (active ? 1 : 1.3)),
    reqLevel: Math.max(1, level - 2),
    icon: itemIcon('rune', elem.color, 0, rarity, def.glyph, !active),
  };
}

/** Сколько стоит слить три руны в одну рангом выше. */
export function fuseCost(rarity, level) {
  const idx = RARITY_ORDER.indexOf(rarity);
  return Math.round((90 + idx * 130) * (1 + level * 0.06));
}

/** Группы одинаковых рун в рюкзаке — основа экрана слияния. */
export function runeGroups(player) {
  const map = new Map();
  for (const it of player.inventory) {
    if (it.kind !== 'rune') continue;
    const k = it.sub + '|' + it.rarity;
    if (!map.has(k)) map.set(k, { sub: it.sub, rarity: it.rarity, items: [] });
    map.get(k).items.push(it);
  }
  const idx = (r) => RARITY_ORDER.indexOf(r);
  return [...map.values()]
    .filter((g) => idx(g.rarity) < RARITY_ORDER.length - 1)
    .sort((a, b) => b.items.length - a.items.length || idx(b.rarity) - idx(a.rarity));
}

/**
 * Случайная руна. `cap` — потолок места: руна такой же предмет, как меч, и
 * легендарной в первом биоме ей взяться неоткуда. Аудит добычи поймал именно
 * это: снаряжение потолку подчинилось, а руны в лавке — нет.
 */
export function rollRune(rng, level, rarity, cap = null) {
  const active = rng() < 0.72;
  const pool = active ? ACTIVE_KEYS : PASSIVE_KEYS;
  return makeRune(rng.pick(pool), capRarity(rarity || rollRarity(rng, 2), cap), level);
}

export function makeConsumable(key, count = 1) {
  const c = CONSUMABLES[key];
  if (!c) return null;
  return {
    id: nextId++, key, kind: c.kind, sub: c.sub, name: c.name,
    heal: c.heal, mana: c.mana, buff: c.buff, dur: c.dur,
    price: c.price, count, stack: c.stack, desc: c.desc,
    rarity: 'common', tier: 0,
    icon: itemIcon(c.kind, c.sub, 1, 'common'),
  };
}

export function makeMaterial(key, count = 1) {
  const m = MATERIALS[key];
  if (!m) return null;
  return {
    id: nextId++, key, kind: 'material', sub: m.sub, name: m.name,
    price: m.price, count, stack: 99, rarity: 'common', tier: 0,
    desc: 'Материал. Продаётся торговцам, нужен для заданий.',
    icon: itemIcon('material', m.sub, 1, 'common'),
  };
}

export const CONSUMABLE_KEYS = Object.keys(CONSUMABLES);
export const MATERIAL_KEYS = Object.keys(MATERIALS);
export { CONSUMABLES, MATERIALS };

/** Ассортимент лавки — зависит от уровня героя, обновляется при заходе в город. */
/**
 * Какие лавки в игре есть.
 *
 * Список рядом с тем, кто по нему раскладывает товар, — чтобы не разошёлся.
 * Нужен комнате: она обязана отказать на выдуманное имя, иначе ассортимент
 * заводится под любую строку и остаётся в памяти до выхода игрока. Замер:
 * двести сообщений с новым именем по два килобайта — двести ключей, ни одного
 * отказа.
 */
export const SHOPS = ['smith', 'armory', 'runes', 'alchemy', 'wander'];

export function rollShopStock(shop, playerLevel, seed) {
  const rng = makeRng(seed);
  const lvl = Math.max(1, playerLevel);
  // Потолок редкости у лавки свой — по уровню героя, а не по месту: город один
  // на всю игру. Оборачиваем **каждую** строку ассортимента: аудит добычи
  // поймал, что закрыть их выборочно не выходит — я закрыл снаряжение
  // бродячего торговца, а кузнец продолжил торговать легендарками на первом
  // уровне.
  const R = (r) => capRarity(r, rarityCapFor(lvl));
  const out = [];
  if (shop === 'smith') {
    for (let i = 0; i < 6; i++) {
      const lv = clamp(lvl + rng.int(-1, 3), 1, 40);
      out.push(makeItem({ kind: 'weapon', level: lv, rng, luck: 1, rarity: i < 3 ? 'common' : R(rollRarity(rng, 2)) }));
    }
    for (let i = 0; i < 3; i++) {
      out.push(makeItem({ kind: 'armor', level: clamp(lvl + rng.int(-1, 2), 1, 40), rng, rarity: i < 2 ? 'common' : R(rollRarity(rng, 2)) }));
    }
  } else if (shop === 'armory') {
    for (let i = 0; i < 5; i++) {
      out.push(makeItem({ kind: 'armor', level: clamp(lvl + rng.int(0, 3), 1, 40), rng, rarity: i < 2 ? 'uncommon' : R(rollRarity(rng, 3)) }));
    }
    for (let i = 0; i < 3; i++) {
      out.push(makeItem({ kind: 'helm', level: clamp(lvl + rng.int(0, 3), 1, 40), rng, rarity: R(rollRarity(rng, 2)) }));
    }
    for (let i = 0; i < 3; i++) {
      out.push(makeItem({ kind: 'trinket', level: clamp(lvl + rng.int(0, 3), 1, 40), rng, rarity: R(rollRarity(rng, 3)) }));
    }
  } else if (shop === 'wander') {
    // бродячий торговец: мало позиций, зато редких, и наценка
    for (let i = 0; i < 3; i++) {
      out.push(makeItem({ kind: rng.pick(['weapon', 'armor', 'helm', 'trinket']), level: clamp(lvl + rng.int(1, 4), 1, 40),
                          rng, luck: 5, rarity: R(rollRarity(rng, 6)), priceMult: 1.5 }));
    }
    out.push(rollRune(rng, lvl + 2, R(rollRarity(rng, 5))));
    out.push(makeConsumable('potionM', 99));
    out.push(makeConsumable('scroll', 99));
    if (lvl >= 10) out.push(makeConsumable('elixir', 99));
  } else if (shop === 'runes') {
    const seen = new Set();
    for (let i = 0; i < 7; i++) {
      const active = i < 5;
      const pool = active ? ACTIVE_KEYS : PASSIVE_KEYS;
      let key = null;
      for (let t = 0; t < 10; t++) { const k = rng.pick(pool); if (!seen.has(k)) { key = k; seen.add(k); break; } }
      if (!key) continue;
      out.push(makeRune(key, i < 3 ? 'common' : R(rollRarity(rng, 3)), clamp(lvl + rng.int(-1, 2), 1, 40)));
    }
  } else if (shop === 'alchemy') {
    out.push(makeConsumable('potionS', 99));
    if (lvl >= 5) out.push(makeConsumable('potionM', 99));
    if (lvl >= 14) out.push(makeConsumable('potionL', 99));
    out.push(makeConsumable('manaS', 99));
    if (lvl >= 7) out.push(makeConsumable('manaM', 99));
    out.push(makeConsumable('scroll', 99));
    if (lvl >= 10) { out.push(makeConsumable('elixir', 99)); out.push(makeConsumable('elixirD', 99)); }
  }
  return out;
}

/**
 * Восстановить предмет из сохранения: иконка не сериализуется, её перерисовываем.
 *
 * Жил в `game.js`, переехал сюда, когда персонажа понадобилось собирать и на
 * сервере: комната загружает сохранённого героя и обязана получить те же самые
 * предметы, что и клиент. Правило про предметы должно жить рядом с предметами.
 */
export function reviveItem(o) {
  if (!o) return null;
  try {
    // Счётчик id — модульный, он начинается с единицы при каждой загрузке
    // страницы. Если его не подтянуть, свежий предмет получит id уже надетого,
    // а по id строится ключ кэша комплектов: герой продолжал получать бонусы
    // сета, который снял.
    if (Number.isFinite(o.id) && o.id >= nextId) nextId = Math.floor(o.id) + 1;
    // руна пересобирается целиком — так подтягиваются актуальные откаты и описания
    if (o.kind === 'rune') {
      const r = makeRune(o.sub, o.rarity || 'common', o.level || 1);
      if (r) { r.id = o.id; return r; }
      return null;
    }
    return { ...o, icon: itemIcon(o.kind, o.sub, o.tier || 0, o.rarity || 'common') };
  } catch (e) {
    // Один непонятный предмет не должен уносить весь сейв: теряем вещь, а не героя.
    console.warn('предмет не восстановился и пропущен:', e.message);
    return null;
  }
}

// Темп и дальность меча — мера для остальных: всё прочее считается от них.
export const SWORD_RATE = 0.40;
export const SWORD_RANGE = 26;
