// Стихийные метки и реакции между ними.
//
// До этого модуля поджиг, яд и замедление были параллельными таймерами: каждый
// сам по себе, ни один не знал про остальные. Здесь они превращаются в общую
// валюту — метку, — и встреча двух меток даёт третий эффект. У каждой реакции
// своя роль в бою, иначе выбор между ними был бы косметическим:
//
//   Пар          — защита: гасит дальний бой
//   Разъедание   — урон по одиночной цели: сильный DoT и минус броня
//   Проводимость — толпа: разряд по соседям
//   Раскол       — бурст: награда за «заморозил, потом ударил»

import { dist } from '../core/util.js';

/** Метки, которые можно повесить на врага. `res` — метка-результат реакции. */
export const MARKS = {
  burn:    { name: 'Горение',      elem: 'fire',   color: '#ff6a1a', color2: '#ffd66a', icon: 'flame' },
  slow:    { name: 'Обморожение',  elem: 'ice',    color: '#4aa8e0', color2: '#c8f0ff', icon: 'flake' },
  poison:  { name: 'Отравление',   elem: 'poison', color: '#5fb83a', color2: '#c6ff8a', icon: 'drop' },
  shock:   { name: 'Разряд',       elem: 'arcane', color: '#a06cff', color2: '#e0b8ff', icon: 'bolt' },
  corrode: { name: 'Разъедание',   elem: 'poison', color: '#b8e04a', color2: '#f0ffa0', icon: 'skull', res: true },
  steam:   { name: 'Ослепление',   elem: 'ice',    color: '#cfe4f0', color2: '#ffffff', icon: 'cloud', res: true },
};

export const MARK_KEYS = Object.keys(MARKS);

/**
 * Внутренний откат реакции на цели. Без него две стихии на оружии давали бы
 * реакцию каждым ударом — по 3–5 за убийство, — и связка перестала бы быть
 * решением игрока, превратившись в пассивный множитель урона.
 */
export const REACT_ICD = 1.2;

export function canReact(game, e) {
  return game.time >= (e.reactCd || 0);
}

/** Разряд делает цель уязвимее — иначе метка была бы только ключом к реакции. */
export const SHOCK_VULN = 0.22;
/** Разъедание снимает часть защиты. */
export const CORRODE_ARMOR = 0.30;

/**
 * Пары меток. Порядок важен: если на цели висят обе половинки разных пар,
 * срабатывает первая подходящая — урон приоритетнее контроля.
 */
export const REACTIONS = {
  corrosion: {
    name: 'РАЗЪЕДАНИЕ', pair: ['burn', 'poison'], color: '#b8e04a',
    hint: 'Сильный яд и −30% защиты на 6 сек.',
  },
  conduction: {
    name: 'ПРОВОДИМОСТЬ', pair: ['shock', 'slow'], color: '#a06cff',
    hint: 'Разряд по трём ближайшим врагам, метка передаётся.',
  },
  steam: {
    name: 'ПАР', pair: ['burn', 'slow'], color: '#cfe4f0',
    hint: 'Облако пара: враги внутри не стреляют и не колдуют.',
  },
  shatter: {
    name: 'РАСКОЛ', pair: ['удар', 'slow'], color: '#c8f0ff', melee: true,
    hint: 'Тяжёлый удар по обмороженному бьёт вдвое сильнее.',
  },
};

export const REACTION_ORDER = ['corrosion', 'conduction', 'steam'];

/**
 * Какая реакция сработает, если повесить метку `kind` на этого врага.
 * Возвращает ключ реакции или null.
 */
export function reactionFor(e, kind) {
  if (!MARKS[kind] || MARKS[kind].res) return null;
  for (const key of REACTION_ORDER) {
    const [a, b] = REACTIONS[key].pair;
    const other = kind === a ? b : kind === b ? a : null;
    if (other && (e.effects[other] || 0) > 0) return key;
  }
  return null;
}

/**
 * Проводит реакцию. Возвращает её ключ (для всплывающего текста) или null.
 * Сила берётся от накопленных меток и силы магии — иначе реакции обгоняли бы
 * прокачку в начале и отставали в конце.
 */
export function runReaction(game, e, key, ctx) {
  const r = REACTIONS[key];
  if (!r) return null;
  e.reactCd = game.time + REACT_ICD;
  const p = game.player;
  const boost = 1 + (p.passive('catalyst') || 0) / 100;
  const base = (p.magicPower * 0.55 + p.attack * 0.25) * boost;

  if (key === 'corrosion') {
    const pw = (e.effects.burnP || 0) + (e.effects.poisonP || 0);
    clearMark(e, 'burn'); clearMark(e, 'poison');
    e.effects.corrode = 6;
    e.effects.corrodeP = Math.max(2, (pw * 0.9 + base * 0.18) * boost);
    game.damageEnemy(e, Math.round(base * 0.4), { silent: true, dot: true, color: r.color });
  } else if (key === 'conduction') {
    clearMark(e, 'shock');
    const dmg = Math.round(base * 0.75);
    const extra = p.hasUnique && p.hasUnique('lightningRod') ? 3 : 0;
    const near = game.enemies
      .filter((o) => !o.dead && o !== e && dist(o.x, o.y, e.x, e.y) < 84)
      .sort((a, b) => dist(a.x, a.y, e.x, e.y) - dist(b.x, b.y, e.x, e.y))
      .slice(0, 3 + extra);
    for (const o of near) {
      game.damageEnemy(o, dmg, { color: r.color });
      o.applyEffect('shock', 3.5, 1);
      game.bolt(e.x, e.y - e.r * 0.6, o.x, o.y - o.r * 0.6, r.color);
    }
    game.damageEnemy(e, dmg, { color: r.color });
  } else if (key === 'steam') {
    clearMark(e, 'burn'); clearMark(e, 'slow');
    game.hazards.push({
      kind: 'steam', x: e.x, y: e.y - 6, r: 48, life: 3.6, tick: 0, dps: 0,
      color: '#cfe4f0', color2: '#ffffff', cloud: true, blind: true,
    });
  } else if (key === 'shatter') {
    // считается от нанесённого удара, а не по своей формуле: иначе раскол
    // отставал бы от прокачки и к середине игры перестал быть заметен
    clearMark(e, 'slow');
    const mult = (p.hasUnique && p.hasUnique('iceBreaker') ? 1.8 : 0.9) * boost;
    const hit = Math.max(base * 0.5, (ctx && ctx.dmg) || 0);
    game.damageEnemy(e, Math.round(hit * mult), { crit: true, heavy: true, pure: true, color: r.color });
  }

  // резонанс: каждая реакция подрезает откаты — плата за подготовку связки
  const res = p.passive('resonance');
  if (res) for (let i = 0; i < p.skillCd.length; i++) p.skillCd[i] = Math.max(0, p.skillCd[i] - res / 10);

  game.onReaction(e, key, r);
  return key;
}

function clearMark(e, k) {
  e.effects[k] = 0;
  e.effects[k + 'P'] = 0;
}

/** Тяжёлый удар по обмороженному колет лёд. Возвращает true, если сработало. */
export function tryShatter(game, e, dmg, heavy) {
  if (!heavy || e.dead || (e.effects.slow || 0) <= 0 || !canReact(game, e)) return false;
  runReaction(game, e, 'shatter', { dmg });
  return true;
}

/** Множитель урона по цели с учётом её меток и пассивок героя. */
export function markDamageMult(player, e) {
  let m = 1;
  if ((e.effects.shock || 0) > 0) m += SHOCK_VULN;
  if ((e.effects.corrode || 0) > 0) m += CORRODE_ARMOR;
  const pyro = player.passive('pyromancy');
  if (pyro && (e.effects.burn || 0) > 0) m += pyro / 100;
  return m;
}
