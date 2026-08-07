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
import { BIOMES } from './biomes.js';
import { buildPacks } from '../systems/packs.js';

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

/**
 * Страж места — та же сборка, что и у остальных, но по описанию `zone.boss`.
 *
 * В общем мире босса рождает комната: иначе у каждого свой, сервер о нём не
 * знает и не проверяет ни урона, ни добычи. Правило одно на обе стороны, чтобы
 * клиент, увидев стража в снимке, собрал ровно того же.
 */
export function makeBoss(zone) {
  const b = zone && zone.boss;
  if (!b) return null;
  const e = new Enemy(b.key, b.level, b.x, b.y);
  e.aggro = true;              // страж не дремлет: в арену входят к нему
  return e;
}

/**
 * Засадный отряд из лагеря — тоже правило, а не подробность клиента.
 *
 * В общем мире это важнее, чем кажется: пока отряд рождал клиент, комната о нём
 * не знала, а клиент хоронит всё, чего нет в снимке — и выдавал за призраков
 * полную добычу и опыт. Рождает теперь комната.
 */
export function makeAmbush(zone, ev) {
  const table = BIOMES[zone.biomeId] && BIOMES[zone.biomeId].enemies;
  if (!table) return [];
  const rng = makeRng((ev.x * 31 + ev.y * 17) | 0);
  const out = [];
  for (const s of buildPacks([{ x: ev.x, y: ev.y }, { x: ev.x + 40, y: ev.y + 26 }], table, ev.level, rng)) {
    const e = new Enemy(s.key, s.level, s.x, s.y);
    e.pack = 'ambush';
    e.aggro = true;
    out.push(e);
  }
  return out;
}
