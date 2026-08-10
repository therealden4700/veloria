// Что падает с убитого — одно правило на игру и на комнату.
//
// Раньше состав добычи жил только в `Game.dropLoot`, и это было терпимо, пока
// играли порознь. В общем мире это дыра: комната ничего не роняла, добычу
// решал клиент, а свой рюкзак он же и присылал на сервер. Замер: настоящая
// учётка попросила легендарку с атакой 9999 и девять миллионов золота — сервер
// положил это в базу и вернул при следующем входе.
//
// Здесь только правило: **что** и **сколько** выпало. Куда это положить,
// как разбросать по земле и кому отдать — дело вызывающего: у клиента это
// летящие огоньки, у комнаты — список с хозяином.

import { makeItem, makeConsumable, makeMaterial, rollRune, rollRarity, dropRarity, capRarity, raiseRarity } from './items.js';
import { abyssUniquesFor, breachUniquesFor } from './uniques.js';
import { makeRng } from '../core/rng.js';

/**
 * Разыграть добычу с убитого.
 *
 * @param {object} e        — убитый враг
 * @param {object} ctx
 * @param {object} ctx.zone — зона: от неё потолок редкости, порча этажа, биом
 * @param {number} ctx.corr — порча Бездны на этом этаже
 * @param {object} ctx.ce   — действие порчи (`corruptionEffects`), если она есть
 * @param {number} ctx.level — уровень героя: от него зависит размер зелья
 * @param {number} ctx.seed — сид розыгрыша; у комнаты и клиента он свой, но
 *   решает всё равно один: тот, кто владеет добычей
 * @returns {Array<{gold?: number, item?: object}>} — в порядке выпадения
 */
export function rollDrops(e, ctx) {
  const rng = makeRng(ctx.seed >>> 0);
  const zone = ctx.zone || {};
  const mod = zone.mod || {};
  const corr = ctx.corr || 0;
  const ce = ctx.ce || null;
  const out = [];

  // золото
  const gold = Math.round(e.goldValue * (0.7 + rng() * 0.8) * (mod.goldMul || 1));
  if (gold > 0) out.push({ gold });

  // материалы
  for (const m of (e.def && e.def.drops) || []) {
    if (rng() < (e.boss ? 1 : e.elite ? 0.6 : 0.34)) out.push({ item: makeMaterial(m, 1) });
  }

  // ── добыча Бездны: слёзы и порог редкости
  if (corr) {
    const tearChance = (e.boss ? 1 : e.elite ? 0.30 : 0.05) * (1 + corr * 0.02);
    if (rng() < tearChance) out.push({ item: makeMaterial('abyssTear', 1) });
  }

  // снаряжение
  const chance = (e.boss ? 1 : e.elite ? 0.45 : 0.1) * (mod.lootMul || 1) * (ce ? ce.lootMul : 1);
  if (rng() < chance) {
    const kinds = ['weapon', 'armor', 'helm', 'trinket'];
    // порог редкости: на глубине нижние ступени просто перестают выпадать
    const floorR = ce ? ce.rarityFloor : 0;
    // Что именно выпадет — решает `dropRarity`, одна на игру и на стенд.
    // Потолок берётся у места: в первом биоме легендарке взяться неоткуда.
    const rarity = dropRarity(rng, { boss: e.boss, elite: e.elite, floorRarity: floorR, corr, cap: zone.maxRarity });
    const kind = rng.pick(kinds);
    // свойства Бездны — только с элиты и боссов на испорченных этажах
    const abyssPool = corr >= 6 && (e.boss || e.elite) ? abyssUniquesFor(kind) : [];
    const wantAbyss = abyssPool.length && rng() < (e.boss ? 0.22 : 0.05) * (1 + corr * 0.03);
    // Свойства Пролома — только с его обитателей, и без порчи: биом наземный,
    // до него не докатывается ни один этаж Бездны. Иначе легендарка биома
    // выпадала бы где угодно и перестала быть его.
    const breachPool = !wantAbyss && zone.biomeId === 'breach' ? breachUniquesFor(kind) : [];
    const wantBreach = breachPool.length && rng() < (e.boss ? 0.28 : e.elite ? 0.07 : 0.012);
    out.push({
      item: makeItem({
        kind, level: e.level, rng, luck: e.boss ? 6 : 2,
        rarity: wantAbyss || wantBreach ? 'legendary' : rarity,
        unique: wantAbyss ? rng.pick(abyssPool) : wantBreach ? rng.pick(breachPool) : undefined,
      }),
    });
  }

  // руны умений: редкая, но самая желанная добыча
  const runeChance = (e.boss ? 1 : e.elite ? 0.16 : 0.028) * (mod.lootMul || 1);
  if (rng() < runeChance) {
    const runeCap = e.boss ? raiseRarity(zone.maxRarity, 1) : zone.maxRarity;
    out.push({ item: rollRune(rng, e.level, e.boss ? (rng() < 0.5 ? 'legendary' : 'epic') : null, runeCap) });
  }

  if (e.boss) {
    for (let i = 0; i < 2; i++) {
      const extra = capRarity(rollRarity(rng, 6), raiseRarity(zone.maxRarity, 1));
      out.push({ item: makeItem({ kind: rng.pick(['weapon', 'armor', 'helm', 'trinket']), level: e.level, rarity: extra, rng, luck: 6 }) });
    }
    out.push({ item: makeConsumable('potionL', 3) });
  }

  // зелья
  if (rng() < 0.08) out.push({ item: makeConsumable((ctx.level || 1) > 12 ? 'potionM' : 'potionS', 1) });

  return out;
}
