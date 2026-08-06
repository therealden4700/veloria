// Модификаторы этажей, проклятые алтари и аффиксы элиты.
// Спуск перестаёт быть «дальше = больше опыта» и становится цепочкой решений.

import { ABYSS_START } from './abyss.js';

export const FLOOR_MODS = {
  none:      { name: 'Тишина',        desc: 'Обычный этаж без особенностей.' },
  swarm:     { name: 'Полчище',       desc: 'Врагов вдвое больше.',                    enemyMul: 1.9, lootMul: 1.35, xpMul: 1.25 },
  frenzy:    { name: 'Исступление',   desc: 'Враги быстрее и бьют сильнее.',           spdMul: 1.35, dmgMul: 1.3, lootMul: 1.5, xpMul: 1.2 },
  // Броня против лёгких ударов растягивает этаж почти вдвое (цена ×1,74 на
  // десятом этаже), а платила меньше всех. Награда поднята под эту цену.
  fortified: { name: 'Укрепление',    desc: 'У всех врагов броня против лёгких ударов.', armor: 0.4, xpMul: 1.8, lootMul: 1.9 },
  darkness:  { name: 'Мгла',          desc: 'Свет героя вдвое короче.',                light: 0.5, lootMul: 1.45 },
  famine:    { name: 'Голод',         desc: 'Зелья на этаже не действуют.',            noPotions: true, xpMul: 1.9, lootMul: 1.3 },
  // «Алчность» выходила бесплатными деньгами: цена спуска ×1,27 при награде,
  // которой не было равных. Жадность должна кусаться — добро стерегут гуще и
  // бьют больнее.
  greed:     { name: 'Алчность',       desc: 'Золота и добычи куда больше, но добро стерегут.', lootMul: 2.2, goldMul: 2.6, enemyMul: 1.5, dmgTakenMul: 1.3 },
  brittle:   { name: 'Хрупкость',     desc: 'Ты получаешь вдвое больше урона.',        dmgTakenMul: 2, lootMul: 1.9, xpMul: 1.7 },
  hunt:      { name: 'Травля',        desc: 'По этажу ходит отряд с аффиксами.',       eliteHunt: true, lootMul: 1.6, xpMul: 1.3 },
  bounty:    { name: 'Щедрость',      desc: 'Втрое больше сундуков.',                  chestMul: 3 },
  calm:      { name: 'Затишье',       desc: 'Врагов меньше, но и награда скромнее.',   enemyMul: 0.55, lootMul: 0.75, xpMul: 0.8 },

  // ── только Бездна, с 26-го этажа
  //
  // Аудит спуска показал вырождение: пул дверей не зависел от глубины, и на
  // пятидесятом этаже игрок видел ровно те же одиннадцать вариантов, что на
  // третьем. Глубина росла, выбор — нет. Эти три появляются только за порогом
  // Бездны и бьют по тому, чем порча ещё не бьёт.
  maw:       { name: 'Пасть',          desc: 'Бездна дышит: врагов гуще и они быстрее.', enemyMul: 1.6, spdMul: 1.5, lootMul: 1.5, xpMul: 1.4, abyss: true },
  thirst:    { name: 'Жажда',          desc: 'Зелья мертвы, а раны глубже.',             noPotions: true, dmgTakenMul: 1.4, lootMul: 2.0, xpMul: 1.8, abyss: true },
  hollow:    { name: 'Полость',        desc: 'Враги в панцире, и света почти нет.',      armor: 0.45, light: 0.5, lootMul: 2.1, xpMul: 1.7, abyss: true },
};

const RISKY = ['swarm', 'frenzy', 'fortified', 'darkness', 'famine', 'brittle', 'hunt'];
const SAFE = ['greed', 'bounty', 'calm', 'none'];
const ABYSS_ONLY = Object.keys(FLOOR_MODS).filter((k) => FLOOR_MODS[k].abyss);

/**
 * Две двери: одна с риском, вторая — либо выгода, либо другой риск.
 *
 * За порогом Бездны в рискованный пул добавляются её собственные модификаторы:
 * иначе глубина растёт, а выбор остаётся тем же, что на третьем этаже.
 */
export function rollDoors(rng, floor) {
  const risky = floor >= ABYSS_START ? RISKY.concat(ABYSS_ONLY) : RISKY;
  const a = rng.pick(risky);
  const pool = (floor >= 8 && rng() < 0.45 ? risky : SAFE).filter((k) => k !== a);
  const b = rng.pick(pool);
  return [a, b];
}

// Во что игрок оценивает награду. Добыча весит больше остального: в ARPG ходят
// за вещами, золото и опыт — приложение.
const REWARD_WEIGHTS = { loot: 0.5, gold: 0.25, xp: 0.25 };

/**
 * Насколько модификатор увеличивает награду — то самое число на двери.
 *
 * Раньше три множителя **перемножались**, и это было неверно: добыча, золото и
 * опыт — разные валюты, они не составляют друг друга. У «Алчности» ×2,6 добычи
 * и ×3 золота превращались в «+680%», хотя игрок получает 2,6 раза добычи и 3
 * раза золота, а не 7,8 раза чего-то. Аудит спуска это и поймал: по такому
 * счёту «Алчность» выходила выгоднее всех прочих дверей в тридцать два раза.
 *
 * Теперь это средневзвешенное — честная сводка трёх чисел в одно.
 */
export function modReward(key) {
  const m = FLOOR_MODS[key] || {};
  // Число врагов — тоже множитель награды, и его тут не хватало. Добыча, золото
  // и опыт капают с убитых: вдвое больше врагов — вдвое больше поводов уронить
  // вещь. Без этого «Полчище» показывало вдвое меньше, чем даёт на самом деле,
  // а «Затишье» — вдвое больше.
  const n = m.enemyMul || 1;
  const v = (m.lootMul || 1) * n * REWARD_WEIGHTS.loot
          + (m.goldMul || 1) * n * REWARD_WEIGHTS.gold
          + (m.xpMul || 1) * n * REWARD_WEIGHTS.xp;
  return Math.round((v - 1) * 100);
}

// ─────────────────────────────────────────── алтари

export const ALTARS = {
  bloodPact: {
    name: 'Кровавый обет',
    offer: 'Отдай пятую часть здоровья — заберёшь треть чужого.',
    gain: '+30% урона',
    cost: '−20% максимума здоровья',
    apply: (g) => { g.player.boon.dmgMul *= 1.3; g.player.boon.hpMul *= 0.8; },
  },
  painToll: {
    name: 'Пошлина боли',
    offer: 'Камень требует крови, а не золота.',
    gain: 'эпическая руна',
    cost: '−25% текущего здоровья',
    apply: (g) => {
      const p = g.player;
      p.hp = Math.max(1, Math.round(p.hp * 0.75));
      g.grantAltarRune('epic');
    },
  },
  greedCurse: {
    name: 'Проклятие алчности',
    offer: 'Золото здесь мертво. Сталь — нет.',
    gain: 'предмет не ниже редкого, уровень +3',
    cost: 'половина золота',
    apply: (g) => {
      const p = g.player;
      p.gold = Math.floor(p.gold / 2);
      g.grantAltarItem();
    },
  },
  silence: {
    name: 'Печать тишины',
    offer: 'Замолчи — и услышишь больше.',
    gain: '+60% опыта до выхода',
    cost: 'третий слот умения запечатан',
    apply: (g) => { g.player.boon.xpMul *= 1.6; g.player.boon.lockSkill = 2; },
  },
  ironSkin: {
    name: 'Железная кожа',
    offer: 'Медленнее — значит целее.',
    gain: '−25% получаемого урона',
    cost: '−15% скорости передвижения',
    apply: (g) => { g.player.boon.dmgTakenMul *= 0.75; g.player.boon.spdMul *= 0.85; },
  },
  hunger: {
    name: 'Голодный камень',
    offer: 'Он ест зелья. Взамен даёт вампиризм.',
    gain: '+10% вампиризма',
    cost: 'все зелья лечения из рюкзака',
    apply: (g) => {
      const p = g.player;
      for (let i = p.inventory.length - 1; i >= 0; i--) {
        if (p.inventory[i].kind === 'potion' && p.inventory[i].heal) p.inventory.splice(i, 1);
      }
      p.boon.lifesteal += 10;
    },
  },
};

export const ALTAR_KEYS = Object.keys(ALTARS);

// ─────────────────────────────────────────── аффиксы элиты

export const AFFIXES = {
  swift:    { name: 'Стремительный', spd: 1.5, hp: 0.9, color: '#7fd8ff' },
  armored:  { name: 'Бронированный', armor: 0.42, hp: 1.6, spd: 0.85, color: '#b8c0d0' },
  burning:  { name: 'Пылающий',      effect: 'burn', dmg: 1.25, hp: 1.2, color: '#ff8a3a' },
  vampiric: { name: 'Вампирский',    lifesteal: true, hp: 1.4, color: '#ff5a7a' },
  giant:    { name: 'Исполинский',   hp: 2.4, dmg: 1.4, spd: 0.8, knockRes: 0.35, big: true, color: '#ffd06a' },
  spectral: { name: 'Призрачный',    spd: 1.2, hp: 1.2, dodge: 0.25, color: '#c99cff' },
};

export const AFFIX_KEYS = Object.keys(AFFIXES);

/** Шанс, что моб на этаже получит аффикс. */
export function affixChance(floor) {
  return Math.min(0.28, 0.02 + floor * 0.012);
}
