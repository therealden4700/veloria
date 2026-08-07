// Кто стоит в зоне и каким он рождается — одно правило на клиент и на комнату.
//
// Раньше это жило только в `Game.enterZone`, а комната строила врагов коротко:
// `new Enemy(key, level, x, y)`. Разница была не в мелочи — сервер не давал
// элитам их свойства, и в общем мире страж из «логова вожака» выходил
// обыкновенным. Правила боя мы уже свели в одно место; заселение — такое же
// правило, а не подробность одной из сторон.

import { Enemy } from '../entities/enemies.js';
import { makeRng } from '../core/rng.js';
import { AFFIXES, AFFIX_KEYS, affixChance } from '../systems/dungeon_mods.js';

/**
 * Собрать население зоны.
 *
 * @param {object} zone         — уже сгенерированная зона со списком `spawns`
 * @param {number} worldSeed    — сид мира: от него зависит, кому достанется свойство
 * @param {object} [opts]
 * @param {object} [opts.mod]   — порча этажа подземелья
 * @param {object} [opts.corr]  — действие порчи Бездны (`corruptionEffects`)
 * @returns {Enemy[]} список в порядке `zone.spawns` — по нему считаются номера
 */
export function populateZone(zone, worldSeed, opts = {}) {
  const { mod = null, corr = null } = opts;
  // Свой поток случайности: заселение не должно зависеть от того, сколько раз
  // до него дёрнули общий.
  const rng = makeRng(((worldSeed >>> 0) ^ ((zone.floor || 0) * 613)) >>> 0);
  const out = [];
  for (const s of zone.spawns) {
    const e = new Enemy(s.key, s.level, s.x, s.y);
    e.pack = s.pack || null;
    if (mod) {
      e.spdMul *= mod.spdMul || 1;
      e.damage = Math.round(e.damage * (mod.dmgMul || 1));
      e.armorBonus += mod.armor || 0;
    }
    if (corr) {
      e.damage = Math.round(e.damage * corr.enemyDmg);
      e.spdMul *= corr.enemySpd;
    }
    if (!e.boss && (s.forceAffix || (zone.floor && rng() < affixChance(zone.floor)))) {
      const k = rng.pick(AFFIX_KEYS);
      e.applyAffix(k, AFFIXES[k]);
    }
    out.push(e);
  }
  return out;
}

/**
 * Заново родить врага на его месте — тем же правилом, что и при заселении.
 *
 * Нужен общему миру: без возрождения первый прошедший вычищает биом навсегда
 * для всех. Замер до этого: биом пустеет за 1,5–3,5 минуты.
 */
export function respawnOne(zone, worldSeed, index, opts = {}) {
  const s = zone.spawns[index];
  if (!s) return null;
  // Считаем всё население и берём нужного: свойство элиты зависит от порядка
  // обращений к случайности, и вытащить одного в отрыве — значит родить не
  // того, кто стоял здесь вначале.
  return populateZone(zone, worldSeed, opts)[index] || null;
}
