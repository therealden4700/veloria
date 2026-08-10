// Лавки и кузня общего мира: их считает комната.
//
// Замер до этой работы: покупка в городе меняла только клиентскую копию. Клиент
// показывал 4874 золота, мир знал про 40, и при следующем входе покупки не было
// вовсе. То же с ковкой и заточкой — всё это меняет золото и вещи, а комната их
// не видела.
//
// Здесь нет второй экономики. Цены, рецепты, шансы заточки и состав ассортимента
// берутся из тех же `systems/items.js` и `systems/craft.js`, которыми считает
// одиночная игра. Комната добавляет ровно одно: **проверку**. Клиент присылает
// намерение — «купить вот это», «выковать вот это», — а сойдётся ли оно с
// золотом, материалами, уровнем и местом в рюкзаке, решает сервер.
//
// Ассортимент лавки — состояние комнаты, а не клиента: иначе «куплено» можно
// объявить о чём угодно и сколько угодно раз.

import {
  makeItem, makeConsumable, makeMaterial, makeRune, rollShopStock, reviveItem, RARITY_ORDER, fuseCost,
} from '../src/systems/items.js';
import {
  recipesFor, canAfford, craftItem, salvageYield, reforgeCost,
  sharpenChance, sharpenCost, applySharpen, revertToMilestone, SHARP_MAX,
} from '../src/systems/craft.js';

/** Отказ с внятной причиной: клиент покажет её игроку. */
const нет = (why) => ({ ok: false, why });
const да = (what) => ({ ok: true, ...what });

export class Market {
  /**
   * @param {number} seed — сид мира: от него ассортимент, чтобы у всех в
   *   комнате он был один и тот же и не менялся от перезахода.
   */
  constructor(seed) {
    this.seed = seed >>> 0;
    this.stock = new Map();      // «pid:лавка» → список товаров
  }

  забыть(pid) {
    for (const k of [...this.stock.keys()]) if (k.startsWith(pid + ':')) this.stock.delete(k);
  }

  /**
   * Ассортимент лавки для игрока.
   *
   * Он зависит от уровня героя — так в одиночной игре, и менять это правило
   * незачем. Хранится в комнате: купленное исчезает, и второй раз то же самое
   * не купить.
   */
  ассортимент(p, лавка) {
    const key = p.pid + ':' + лавка;
    let s = this.stock.get(key);
    if (!s) {
      s = rollShopStock(лавка, p.level, (this.seed + p.level * 31 + лавка.length * 7919) | 0)
        .filter(Boolean)
        .map((it, i) => ({ ...it, slot: i }));
      this.stock.set(key, s);
    }
    return s;
  }

  // ─────────────────────────────────────────── торговля

  buy(p, лавка, slot) {
    const s = this.ассортимент(p, лавка);
    const it = s.find((x) => x.slot === (slot | 0));
    if (!it) return нет('такого товара нет');
    const price = Math.max(1, Math.round(it.price || 1));
    if ((p.gold || 0) < price) return нет('не хватает золота');
    if (p.inventory.length >= p.invSize && !it.stack) return нет('рюкзак полон');
    const вещь = it.stack ? makeConsumable(it.key, 1) : reviveItem(it);
    if (!вещь) return нет('товар не собрался');
    if (!p.addItem(вещь)) return нет('рюкзак полон');
    p.gold -= price;
    // Штучный товар уходит с прилавка. Стопки (зелья) остаются: их и в
    // одиночной игре можно брать сколько угодно.
    if (!it.stack) this.stock.set(p.pid + ':' + лавка, s.filter((x) => x !== it));
    return да({ what: 'куплено', name: вещь.name, gold: -price });
  }

  sell(p, id) {
    const it = p.inventory.find((x) => x.id === id);
    if (!it) return нет('этого у тебя нет');
    const шт = it.count || 1;
    const price = Math.max(1, Math.floor((it.price || 1) * 0.35)) * шт;
    p.removeItem(it, шт);
    p.gold = (p.gold || 0) + price;
    return да({ what: 'продано', name: it.name, gold: price });
  }

  // ─────────────────────────────────────────── кузня

  /** Списать стоимость рецепта — тем же порядком, что и одиночная игра. */
  списать(p, recipe) {
    p.gold -= recipe.gold || 0;
    for (const k in recipe.mats || {}) if (recipe.mats[k]) p.consumeMaterial(k, recipe.mats[k]);
  }

  craft(p, cat, sub, idx) {
    const список = recipesFor(cat, sub) || [];
    const recipe = список[idx | 0];
    if (!recipe) return нет('нет такого рецепта');
    if (p.level < recipe.lvl) return нет(`нужен уровень ${recipe.lvl}`);
    if (!canAfford(p, recipe)) return нет('не хватает материалов');
    if (p.inventory.length >= p.invSize) return нет('рюкзак полон');
    this.списать(p, recipe);
    const it = craftItem(p, recipe);
    p.addItem(it);
    return да({ what: 'выковано', name: it.name, rarity: it.rarity });
  }

  salvage(p, id) {
    const it = p.inventory.find((x) => x.id === id);
    if (!it) return нет('этого у тебя нет');
    const y = salvageYield(it);
    p.removeItem(it, it.count || 1);
    p.gold = (p.gold || 0) + (y.gold || 0);
    for (const k in y.mats || {}) p.addItem(makeMaterial(k, y.mats[k]));
    return да({ what: 'разобрано', name: it.name, gold: y.gold || 0 });
  }

  reforge(p, id) {
    const it = p.inventory.find((x) => x.id === id) || (p.equipment && Object.values(p.equipment).find((x) => x && x.id === id));
    if (!it) return нет('этого у тебя нет');
    const cost = reforgeCost(it);
    if ((p.gold || 0) < cost.gold) return нет('не хватает золота');
    for (const k in cost.mats || {}) if (p.countMaterial(k) < cost.mats[k]) return нет('не хватает материалов');
    this.списать(p, cost);
    const fresh = makeItem({
      kind: it.kind, sub: it.sub, tier: it.tier, level: it.level, rarity: it.rarity, unique: it.unique,
    });
    fresh.sharp = it.sharp || 0;
    // Заменяем на месте: вещь могла быть надета, и терять слот незачем.
    const i = p.inventory.indexOf(it);
    if (i >= 0) p.inventory[i] = fresh;
    else for (const s in p.equipment) if (p.equipment[s] === it) p.equipment[s] = fresh;
    p._setsKey = null;
    if (p.refreshSprites) p.refreshSprites();
    return да({ what: 'переплавлено', name: fresh.name, rarity: fresh.rarity });
  }

  /**
   * Заточка. Топливо называет клиент — тремя номерами вещей, — а годность
   * каждого проверяем здесь: тот же вид, та же редкость, и оно правда в рюкзаке.
   */
  sharpen(p, fuelIds) {
    const base = p.equipment && p.equipment.weapon;
    if (!base) return нет('надень оружие');
    if ((base.sharp || 0) >= SHARP_MAX) return нет('дальше точить некуда');
    const ids = Array.isArray(fuelIds) ? fuelIds.slice(0, 3) : [];
    const fuel = [];
    for (const id of ids) {
      const f = p.inventory.find((x) => x.id === id && x !== base);
      if (!f || f.kind !== 'weapon' || f.rarity !== base.rarity) return нет('топливо не годится');
      if (fuel.includes(f)) return нет('одно и то же дважды');
      fuel.push(f);
    }
    if (fuel.length < 3) return нет('нужно три оружия той же редкости');
    const cost = sharpenCost(base);
    if ((p.gold || 0) < cost.gold) return нет('не хватает золота');
    for (const k in cost.mats || {}) if (cost.mats[k] && p.countMaterial(k) < cost.mats[k]) return нет('не хватает материалов');

    const chance = sharpenChance(base);
    this.списать(p, cost);
    for (const f of fuel) p.removeItem(f, 1);

    // Бросок здесь, а не у клиента: иначе «удалось» объявлял бы тот, кому
    // выгодно.
    if (Math.random() < chance) {
      const gained = applySharpen(base);
      p._setsKey = null;
      if (p.refreshSprites) p.refreshSprites();
      return да({ what: 'заточено', name: base.name, sharp: base.sharp, gained });
    }
    if (revertToMilestone(base)) {
      p._setsKey = null;
      if (p.refreshSprites) p.refreshSprites();
      return да({ what: 'откат', name: base.name, sharp: base.sharp });
    }
    p.equipment.weapon = null;
    p._setsKey = null;
    if (p.refreshSprites) p.refreshSprites();
    return да({ what: 'рассыпалось', name: base.name });
  }

  /** Три одинаковые руны + золото → одна руна следующего ранга. */
  fuse(p, ids) {
    const выбор = (Array.isArray(ids) ? ids : []).slice(0, 3)
      .map((id) => p.inventory.find((x) => x.id === id))
      .filter(Boolean);
    if (выбор.length < 3) return нет('нужно три руны');
    const [a] = выбор;
    if (a.kind !== 'rune') return нет('это не руны');
    if (!выбор.every((r) => r.kind === 'rune' && r.sub === a.sub && r.rarity === a.rarity)) {
      return нет('руны должны быть одинаковые');
    }
    const next = RARITY_ORDER[RARITY_ORDER.indexOf(a.rarity) + 1];
    if (!next) return нет('выше некуда');
    const cost = fuseCost(a.rarity, p.level);
    if ((p.gold || 0) < cost) return нет('не хватает золота');
    p.gold -= cost;
    const lvl = Math.max(...выбор.map((i) => i.level || 1));
    for (const r of выбор) p.removeItem(r, 1);
    const made = makeRune(a.sub, next, lvl);
    p.addItem(made);
    return да({ what: 'слито', name: made.name, rarity: next });
  }
}
