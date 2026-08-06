// Герой: движение, бой, характеристики, инвентарь.

import { bakeHero } from '../art/sprites.js';
import { clamp, dirFromVec, TAU, damp } from '../core/util.js';
import { audio } from '../core/audio.js';
import { itemPower, WEAPON_PROFILE, SWORD_RATE, SWORD_RANGE } from '../systems/items.js';
import { PASSIVES } from '../systems/skills.js';
import { UNIQUES, setBonuses } from '../systems/uniques.js';
import { corruptionEffects } from '../systems/abyss.js';

const NO_CORRUPTION = corruptionEffects(0);

export const GEAR_SLOTS = ['weapon', 'armor', 'helm', 'ring', 'amulet'];
export const RUNE_SLOTS = ['skill1', 'skill2', 'skill3', 'passive'];
export const SLOTS = [...GEAR_SLOTS, ...RUNE_SLOTS];
export const SLOT_NAMES = {
  weapon: 'Оружие', armor: 'Доспех', helm: 'Шлем', ring: 'Кольцо', amulet: 'Амулет',
  skill1: 'Умение 1', skill2: 'Умение 2', skill3: 'Умение 3', passive: 'Пассивка',
};

/** Дары и проклятия алтарей — живут, пока герой не выйдет из подземелья. */
export function emptyBoon() {
  return { dmgMul: 1, hpMul: 1, xpMul: 1, dmgTakenMul: 1, spdMul: 1, lifesteal: 0, lockSkill: -1 };
}

/**
 * Кривая опыта. Подобрана так, чтобы на уровень уходило 9 убийств в самом
 * начале и 20–27 дальше: раньше первые уровни пролетали за пару мобов.
 */
export function xpNeeded(level) {
  return Math.floor(150 + Math.pow(level, 1.6) * 14);
}

export class Player {
  constructor() {
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.w = 11; this.h = 9;
    this.dir = 0;
    this.facing = Math.PI / 2;

    this.level = 1;
    this.xp = 0;
    this.gold = 40;
    this.str = 5; this.vit = 5; this.agi = 5; this.int = 5;
    this.statPoints = 0;

    this.equipment = {};
    for (const s of SLOTS) this.equipment[s] = null;
    this.inventory = [];
    this.invSize = 30;
    this.shield = 0; this.shieldMax = 0; this.shieldT = 0;
    this.boon = emptyBoon();
    this.skillCd = [0, 0, 0];

    this.hp = 1; this.mp = 1;
    this.hp = this.maxHp; this.mp = this.maxMp;

    this.pose = 'idle';
    this.animT = 0;
    this.attackT = 0;
    this.attackCd = 0;
    this.combo = 0;
    this.comboT = 0;
    this.dashT = 0;
    this.dashCd = 0;
    this.hurtT = 0;
    this.iframe = 0;
    this.castT = 0;
    this.dead = false;
    this.deadT = 0;
    this.stepT = 0;
    this.regenT = 0;

    this.buffs = {};        // rage / stone
    this.effects = {};      // burn / poison / slow

    this.kills = 0;
    this.deepest = 0;
    this.stats = { dmgDealt: 0, dmgTaken: 0, bossKills: 0 };

    this._appKey = '';
    this.sprites = null;
    this.refreshSprites();
  }

  // ── производные характеристики
  get gear() {
    const s = { atk: 0, def: 0, hp: 0, mp: 0, str: 0, vit: 0, agi: 0, int: 0, crit: 0, cdmg: 0, spd: 0, lifesteal: 0, regen: 0, magic: 0, burn: 0, poison: 0, slow: 0 };
    for (const k of SLOTS) {
      const it = this.equipment[k];
      if (!it) continue;
      for (const key in it.stats) s[key] = (s[key] || 0) + it.stats[key];
    }
    const sets = this.sets;
    for (const key in sets.stats) s[key] = (s[key] || 0) + sets.stats[key];
    return s;
  }

  /** Сводка по надетым комплектам (кэшируется на кадр). */
  get sets() {
    if (this._setsKey !== this._eqKey()) { this._setsKey = this._eqKey(); this._sets = setBonuses(this.equipment); }
    return this._sets;
  }
  _eqKey() {
    let k = '';
    for (const s of SLOTS) { const it = this.equipment[s]; k += (it ? it.id : '-') + ','; }
    return k;
  }

  /** Есть ли надетое легендарное свойство с таким ключом. */
  hasUnique(key) {
    for (const s of SLOTS) { const it = this.equipment[s]; if (it && it.unique === key) return true; }
    return false;
  }
  /** Все надетые уникальные свойства с нужным хуком. */
  uniques(hook) {
    const out = [];
    for (const s of SLOTS) {
      const it = this.equipment[s];
      if (it && it.unique && UNIQUES[it.unique] && UNIQUES[it.unique].hook === hook) out.push(UNIQUES[it.unique]);
    }
    return out;
  }

  /** Значение пассивной руны (0, если такая не вставлена). */
  passive(key) {
    const r = this.equipment.passive;
    if (!r || r.sub !== key) return 0;
    const def = PASSIVES[key];
    return def ? def.v * (r.power || 1) : 0;
  }

  get maxHp() {
    const g = this.gear;
    return Math.max(10, Math.round(
      (52 + (this.vit + g.vit) * 9 + this.level * 6 + g.hp) * this.boon.hpMul * this.corr.hpMul));
  }

  /** Действие порчи текущего этажа. Обновляется при входе в зону. */
  get corr() { return this._corr || NO_CORRUPTION; }
  get maxMp() {
    const g = this.gear;
    return Math.round(28 + (this.int + g.int) * 6 + this.level * 2 + g.mp);
  }
  get attack() {
    const g = this.gear;
    // Профиль оружия множит **всю** атаку, а не только её оружейную часть.
    //
    // Раньше `atk` из профиля применялся один раз — при ковке, к урону самой
    // вещи, — а `spd` из того же профиля делил темп целиком. Замер показал,
    // что оружие даёт ровно половину атаки на всех уровнях (48–50%), то есть
    // множитель урона работал вполовину, а множитель скорости — в полную
    // силу. Профиль задумывал разброс между видами в ×1.04, на деле выходило
    // ×1.49: кинжал бил в полтора раза больше топора, и выбор оружия
    // переставал быть выбором.
    //
    // Здесь профилем множится база (уровень и сила). Урон вещи уже отмасштабирован
    // при ковке, поэтому вместе они дают ровно `atk` профиля на всю атаку, и
    // отношение урона в секунду становится честным `atk × spd`.
    const wp = WEAPON_PROFILE[this.weaponSub] || WEAPON_PROFILE.sword;
    let a = (4 + (this.str + g.str) * 1.9 + this.level * 1.1) * wp.atk + g.atk;
    if (this.buffs.rage > 0) a *= 1.35;
    const bers = this.passive('berserk');
    if (bers) a *= 1 + (bers / 100) * (1 - this.hp / this.maxHp);
    if (this._devour) a *= 1 + this._devour / 100;   // «Ненасытный»: копится за этаж
    return a * this.boon.dmgMul;
  }
  get magicPower() {
    const g = this.gear;
    return 3 + (this.int + g.int) * 2.1 + this.level * 0.8 + g.magic + g.atk * 0.5;
  }
  get defense() {
    const g = this.gear;
    return (this.vit + g.vit) * 0.9 + this.level * 0.5 + g.def;
  }
  get critChance() { return clamp(0.04 + (this.agi + this.gear.agi) * 0.006 + this.gear.crit / 100, 0, 0.75); }
  get critMult() { return 1.6 + this.gear.cdmg / 100; }
  /** Шанс крита с учётом меток на конкретной цели. */
  critVs(e) {
    let c = this.critChance;
    if (e && (e.effects.slow || 0) > 0) c += this.passive('cryomancy') / 100;
    return clamp(c, 0, 0.95);
  }
  get moveSpeed() {
    let s = 60 + (this.agi + this.gear.agi) * 0.85 + this.gear.spd * 0.5;
    if (this.effects.slow > 0) s *= 0.62;
    if (this.buffs.momentum > 0) s *= 1 + this.passive('momentum') / 100;
    return s * this.boon.spdMul * this.sets.spdMul;
  }
  get lifesteal() {
    let ls = this.gear.lifesteal || 0;
    if (this.hp < this.maxHp * 0.4) ls += this.passive('bloodlust');
    return ls + this.boon.lifesteal + this.sets.lifesteal;
  }
  get dashCooldown() { return 0.85 * (1 - this.passive('swift') / 100); }
  get cdMult() { return (1 - this.passive('focus') / 100) * this.sets.cdMul; }

  /** Активные умения в порядке слотов; null там, где руны нет. */
  get skills() { return [0, 1, 2].map((i) => this.equipment['skill' + (i + 1)]); }
  get weaponSub() { return this.equipment.weapon ? this.equipment.weapon.sub : 'sword'; }
  // Темп и дальность берутся из профиля оружия, а не из своих таблиц. Раньше
  // таблицы были здесь и втихую разошлись с профилем — см. `WEAPON_PROFILE`.
  get attackRate() {
    const p = WEAPON_PROFILE[this.weaponSub] || WEAPON_PROFILE.sword;
    return (SWORD_RATE / p.spd) / (1 + (this.agi + this.gear.agi) * 0.006 + this.gear.spd / 220);
  }
  get attackRange() {
    const p = WEAPON_PROFILE[this.weaponSub] || WEAPON_PROFILE.sword;
    return Math.round(SWORD_RANGE * p.range);
  }
  get isRanged() { return this.weaponSub === 'bow' || this.weaponSub === 'staff'; }

  get damageReduction() {
    let r = this.defense / (this.defense + 46 + this.level * 5);
    if (this.buffs.stone > 0) r = 1 - (1 - r) * 0.65;
    return clamp(r, 0, 0.82);
  }

  get power() {
    let p = this.level * 12 + this.str * 3 + this.vit * 3 + this.agi * 3 + this.int * 3;
    for (const k of SLOTS) if (this.equipment[k]) p += itemPower(this.equipment[k]);
    return Math.round(p);
  }

  /** Заточка поднимает визуальный ранг оружия — заточенное видно по яркости. */
  weaponLook() {
    const w = this.equipment.weapon;
    if (!w) return 0;
    return Math.min(6, w.tier + Math.min(2, Math.floor((w.sharp || 0) / 3)));
  }

  appearanceKey() {
    const a = this.equipment.armor, w = this.equipment.weapon;
    return `${a ? a.tier : 0}|${this.weaponLook()}|${w ? w.sub : 'sword'}`;
  }

  refreshSprites() {
    const key = this.appearanceKey();
    if (key === this._appKey && this.sprites) return;
    this._appKey = key;
    const w = this.equipment.weapon, a = this.equipment.armor;
    this.sprites = bakeHero({
      armorTier: a ? a.tier : 0,
      weaponTier: this.weaponLook(),
      weaponType: w ? (w.sub === 'dagger' ? 'sword' : w.sub) : 'sword',
      cape: this.level >= 10 ? ['#3a1020', '#7a1f34', '#b83a4e'] : null,
    });
  }

  // ── инвентарь
  addItem(item) {
    if (!item) return false;
    if (item.stack) {
      const ex = this.inventory.find((i) => i.key === item.key && i.count < i.stack);
      if (ex) { ex.count += item.count || 1; return true; }
    }
    if (this.inventory.length >= this.invSize) return false;
    this.inventory.push(item);
    return true;
  }

  removeItem(item, n = 1) {
    const i = this.inventory.indexOf(item);
    if (i < 0) return;
    if (item.count && item.count > n) item.count -= n;
    else this.inventory.splice(i, 1);
  }

  countMaterial(key) {
    let n = 0;
    for (const it of this.inventory) if (it.key === key) n += it.count || 1;
    return n;
  }

  consumeMaterial(key, n) {
    for (let i = this.inventory.length - 1; i >= 0 && n > 0; i--) {
      const it = this.inventory[i];
      if (it.key !== key) continue;
      const take = Math.min(n, it.count || 1);
      n -= take;
      if ((it.count || 1) > take) it.count -= take;
      else this.inventory.splice(i, 1);
    }
    return n === 0;
  }

  slotOf(item) {
    if (item.kind === 'weapon') return 'weapon';
    if (item.kind === 'armor') return 'armor';
    if (item.kind === 'helm') return 'helm';
    if (item.kind === 'trinket') return item.sub === 'amulet' ? 'amulet' : 'ring';
    if (item.kind === 'rune') {
      if (item.runeType === 'passive') return 'passive';
      // активная руна занимает первый свободный слот, иначе первый
      return RUNE_SLOTS.slice(0, 3).find((s) => !this.equipment[s]) || 'skill1';
    }
    return null;
  }

  equip(item) {
    const slot = this.slotOf(item);
    if (!slot) return false;
    const old = this.equipment[slot];
    this.equipment[slot] = item;
    const i = this.inventory.indexOf(item);
    if (i >= 0) this.inventory.splice(i, 1);
    if (old) this.inventory.push(old);
    this.hp = Math.min(this.hp, this.maxHp);
    this.mp = Math.min(this.mp, this.maxMp);
    this.refreshSprites();
    audio.play('uiBig');
    return true;
  }

  unequip(slot) {
    const it = this.equipment[slot];
    if (!it) return false;
    if (this.inventory.length >= this.invSize) return false;
    this.equipment[slot] = null;
    this.inventory.push(it);
    this.refreshSprites();
    return true;
  }

  // ── прогресс
  get xpNext() { return xpNeeded(this.level); }

  gainXp(n, game) {
    if (this.dead) return;
    const mod = game.zone && game.zone.mod;
    this.xp += Math.round(n * this.boon.xpMul * ((mod && mod.xpMul) || 1));
    let ups = 0;
    while (this.xp >= this.xpNext && this.level < 60) {
      this.xp -= this.xpNext;
      this.level++;
      this.statPoints += 3;
      ups++;
    }
    if (ups) {
      this.hp = this.maxHp;
      this.mp = this.maxMp;
      audio.play('level');
      game.onLevelUp(ups);
      this.refreshSprites();
    }
  }

  spendStat(k) {
    if (this.statPoints <= 0) return false;
    if (!['str', 'vit', 'agi', 'int'].includes(k)) return false;
    this[k]++;
    this.statPoints--;
    if (k === 'vit') this.hp += 9;
    if (k === 'int') this.mp += 6;
    audio.play('uiBig');
    return true;
  }

  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); }
  restoreMp(n) { this.mp = Math.min(this.maxMp, this.mp + n); }

  takeDamage(amount, game, src, opts = {}) {
    if (this.dead || this.iframe > 0 || this.dashT > 0) return 0;
    if (opts.melee) amount *= 1 - this.passive('guardian') / 100;
    amount *= this.boon.dmgTakenMul * this.sets.dmgTakenMul * ((game.zone.mod && game.zone.mod.dmgTakenMul) || 1);

    // «Оплот»: раз в 9 секунд удар гасится целиком
    if (this.hasUnique('bulwark') && (this._bulwarkCd || 0) <= game.time) {
      this._bulwarkCd = game.time + 9;
      this.iframe = 0.4;
      game.floats.add(this.x, this.y - 30, 'ОПЛОТ', { color: '#9fc4e8', size: 10, bold: true });
      game.particles.burst(this.x, this.y - 12, 14, { color: '#dfe9ff', speed: 70, life: 0.4, size: 2, glow: 7 });
      return 0;
    }
    let dmg = Math.max(1, Math.round(amount * (1 - this.damageReduction)));

    // барьер съедает урон первым
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, dmg);
      this.shield -= absorbed;
      dmg -= absorbed;
      game.floats.add(this.x, this.y - 30, '-' + absorbed, { color: '#ffd66a', size: 9 });
      game.particles.burst(this.x, this.y - 12, 8, { color: '#ffd66a', speed: 60, life: 0.3, size: 2, glow: 6 });
      if (dmg <= 0) { this.iframe = 0.28; return absorbed; }
    }

    // шипы бьют в ответ по источнику
    const th = this.passive('thorns');
    if (th && opts.melee && src && src.hp !== undefined && !src.dead) {
      game.damageEnemy(src, dmg * th / 100, { silent: true, dot: true, color: '#ff9a9a' });
    }

    this.hp -= dmg;
    this.stats.dmgTaken += dmg;
    this.hurtT = 0.22;
    this.iframe = 0.42;
    game.shake.add(3.2 + Math.min(5, dmg / 12), 0.2);
    game.floats.add(this.x, this.y - 26, '-' + dmg, { color: '#ff8a80', size: 11, bold: true });
    game.particles.burst(this.x, this.y - 10, 8, {
      color: '#d8434b', color2: '#ff9a8a', speed: 52, life: 0.4, size: 2, g: 130, vz: 40,
    });
    if (src) {
      const a = Math.atan2(this.y - src.y, this.x - src.x);
      this.vx += Math.cos(a) * 120;
      this.vy += Math.sin(a) * 120;
    }
    audio.play('hurt');
    game.proc('hurt', { dmg, src });
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.deadT = 0;
      this.pose = 'dead';
      audio.play('die');
      game.onPlayerDeath();
    }
    return dmg;
  }

  applyEffect(kind, dur, power = 1) {
    this.effects[kind] = Math.max(this.effects[kind] || 0, dur);
    this.effects[kind + 'P'] = power;
  }

  // ── обновление
  update(dt, game) {
    const inp = game.input;

    for (const k in this.buffs) if (this.buffs[k] > 0) this.buffs[k] -= dt;
    for (let i = 0; i < 3; i++) if (this.skillCd[i] > 0) this.skillCd[i] -= dt;
    if (this.shieldT > 0) { this.shieldT -= dt; if (this.shieldT <= 0) this.shield = 0; }
    for (const k in this.effects) if (k.endsWith('P')) continue; else if (this.effects[k] > 0) this.effects[k] -= dt;

    if (this.effects.burn > 0) {
      this.regenT += dt;
      if (this.regenT > 0.5) {
        this.regenT = 0;
        const d = Math.max(1, Math.round((this.effects.burnP || 3)));
        this.hp -= d;
        game.floats.add(this.x, this.y - 22, '-' + d, { color: '#ff9a3a', size: 8 });
        game.particles.burst(this.x, this.y - 12, 3, { color: '#ff8a3a', speed: 24, life: 0.35, size: 1, vz: 20, g: 60 });
        if (this.hp <= 0 && !this.dead) { this.hp = 0; this.dead = true; this.pose = 'dead'; game.onPlayerDeath(); }
      }
    } else if (this.effects.poison > 0) {
      this.regenT += dt;
      if (this.regenT > 0.7) {
        this.regenT = 0;
        const d = Math.max(1, Math.round(this.effects.poisonP || 3));
        this.hp -= d;
        game.floats.add(this.x, this.y - 22, '-' + d, { color: '#a8ee5a', size: 8 });
        if (this.hp <= 0 && !this.dead) { this.hp = 0; this.dead = true; this.pose = 'dead'; game.onPlayerDeath(); }
      }
    } else {
      // естественная регенерация
      this.regenT += dt;
      if (this.regenT > 1) {
        this.regenT = 0;
        const g = this.gear;
        if (this.hp < this.maxHp) this.heal(Math.max(0.5, this.maxHp * 0.006 + this.vit * 0.08 + (g.regen || 0)));
        if (this.mp < this.maxMp) this.restoreMp(this.maxMp * 0.02 + this.int * 0.12);
      }
    }

    if (this.dead) {
      this.deadT += dt;
      this.vx = damp(this.vx, 0, 8, dt);
      this.vy = damp(this.vy, 0, 8, dt);
      return;
    }

    if (this.iframe > 0) this.iframe -= dt;
    if (this.hurtT > 0) this.hurtT -= dt;
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.dashCd > 0) this.dashCd -= dt;
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }

    const busy = this.attackT > 0 || this.castT > 0;

    // ── ввод
    const ax = inp.axis();
    let mvx = ax.x, mvy = ax.y;

    if (this.dashT > 0) {
      this.dashT -= dt;
      this.pose = 'dash';
      game.particles.spawn({
        x: this.x + (Math.random() - 0.5) * 6, y: this.y - 6, vx: -this.vx * 0.2, vy: -this.vy * 0.2,
        color: '#9fb8ff', life: 0.28, size: 2, drag: 3,
      });
    } else {
      const speed = this.moveSpeed * (busy ? 0.34 : 1);
      const targetVx = mvx * speed, targetVy = mvy * speed;
      this.vx = damp(this.vx, targetVx, 16, dt);
      this.vy = damp(this.vy, targetVy, 16, dt);
    }

    // направление взгляда — по мыши, если она двигалась, иначе по движению
    if (game.aimByMouse) {
      const wx = game.cam.x + inp.mouse.x, wy = game.cam.y + inp.mouse.y;
      this.facing = Math.atan2(wy - (this.y - 12), wx - this.x);
    } else if (mvx || mvy) {
      this.facing = Math.atan2(mvy, mvx);
    }
    if (!busy) this.dir = dirFromVec(Math.cos(this.facing), Math.sin(this.facing));

    // ── действия
    if (!busy && this.dashT <= 0) {
      if (inp.pressed('dash') && this.dashCd <= 0) {
        const dx = mvx || Math.cos(this.facing), dy = mvy || Math.sin(this.facing);
        const l = Math.hypot(dx, dy) || 1;
        this.vx = (dx / l) * 285; this.vy = (dy / l) * 285;
        this.dashT = 0.2; this.dashCd = this.dashCooldown;
        game.proc('dash', {});
        audio.play('dash');
        game.particles.burst(this.x, this.y - 6, 12, { color: '#b8d0ff', speed: 60, life: 0.3, size: 2, flat: true });
      } else if (inp.pressed('skill1')) game.useSkill(0);
      else if (inp.pressed('skill2')) game.useSkill(1);
      else if (inp.pressed('skill3')) game.useSkill(2);
      else if (inp.held('attack') && this.attackCd <= 0) {
        this.startAttack(game);
      }
    }

    if (inp.consume('potion')) game.quickPotion();

    if (this.attackT > 0) {
      this.attackT -= dt;
      if (this.attackT <= 0) this.pose = 'idle';
    }
    if (this.castT > 0) {
      this.castT -= dt;
      this.pose = 'cast';
      if (this.castT <= 0) this.pose = 'idle';
    }

    // ── движение и столкновения
    game.moveEntity(this, dt);

    // ── анимация
    const moving = Math.hypot(this.vx, this.vy) > 12;
    if (this.attackT > 0) this.pose = 'attack';
    else if (this.castT > 0) this.pose = 'cast';
    else if (this.dashT > 0) this.pose = 'dash';
    else if (this.hurtT > 0) this.pose = 'hurt';
    else if (moving) this.pose = 'walk';
    else this.pose = 'idle';

    const rate = this.pose === 'walk' ? Math.hypot(this.vx, this.vy) / 46 : this.pose === 'attack' ? 0 : 1.1;
    if (this.pose === 'attack') {
      this.animT = 1 - clamp(this.attackT / Math.max(0.01, this.attackDur), 0, 1);
    } else {
      this.animT = (this.animT + dt * rate) % 1;
    }

    if (moving && this.dashT <= 0) {
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = 0.32;
        audio.play('step', 0.6);
        game.particles.burst(this.x, this.y, 2, { color: game.zone.dustColor || '#8a7a5a', speed: 14, life: 0.3, size: 1, flat: true });
      }
    }
  }

  get attackDur() { return Math.max(0.16, this.attackRate * 0.95); }

  startAttack(game) {
    this.combo = (this.combo + 1) % 3;
    this.comboT = 0.8;
    this.attackT = this.attackDur;
    this.attackCd = this.attackRate;
    this.pose = 'attack';
    this.animT = 0;
    game.playerSwing(this.combo);
  }

  /** Канвас текущего кадра — нужен и для отрисовки, и для отброшенной тени. */
  frame() {
    const sp = this.sprites;
    const set = sp[this.pose] || sp.idle;
    const frames = set[this.dir] || set[0];
    return frames[Math.min(frames.length - 1, Math.floor(this.animT * frames.length))];
  }

  draw(g, cam) {
    const sp = this.sprites;
    const c = this.frame();
    const dx = Math.round(this.x - cam.x - sp.w / 2);
    const dy = Math.round(this.y - cam.y - sp.ground);

    if (this.iframe > 0 && !this.dead && Math.floor(this.iframe * 22) % 2 === 0) g.globalAlpha = 0.45;
    g.drawImage(c, dx, dy);
    g.globalAlpha = 1;

    if (this.hurtT > 0) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = clamp(this.hurtT * 3, 0, 0.7);
      g.drawImage(c, dx, dy);
      g.restore();
    }
  }

  // ── сериализация
  toJSON() {
    const ser = (it) => it ? {
      id: it.id, key: it.key, kind: it.kind, sub: it.sub, tier: it.tier, rarity: it.rarity,
      level: it.level, name: it.name, stats: it.stats, price: it.price, count: it.count,
      stack: it.stack, heal: it.heal, mana: it.mana, buff: it.buff, dur: it.dur, desc: it.desc,
      hint: it.hint, reqLevel: it.reqLevel,
      // без этих полей легендарные свойства, комплекты, заточка и её вехи
      // терялись при загрузке — сериализуем явно
      unique: it.unique, set: it.set, sharp: it.sharp,
      affixNames: it.affixNames, temper: it.temper, tempered: it.tempered,
      checkpoint: it.checkpoint,
    } : null;
    return {
      level: this.level, xp: this.xp, gold: this.gold,
      str: this.str, vit: this.vit, agi: this.agi, int: this.int, statPoints: this.statPoints,
      hp: this.hp, mp: this.mp,
      equipment: Object.fromEntries(SLOTS.map((s) => [s, ser(this.equipment[s])])),
      inventory: this.inventory.map(ser),
      kills: this.kills, deepest: this.deepest, stats: this.stats,
    };
  }

  fromJSON(d, reviveItem) {
    Object.assign(this, {
      level: d.level, xp: d.xp, gold: d.gold,
      str: d.str, vit: d.vit, agi: d.agi, int: d.int, statPoints: d.statPoints,
      kills: d.kills || 0, deepest: d.deepest || 0,
      stats: d.stats || { dmgDealt: 0, dmgTaken: 0, bossKills: 0 },
    });
    for (const s of SLOTS) this.equipment[s] = reviveItem(d.equipment ? d.equipment[s] : null);
    this.inventory = (d.inventory || []).map(reviveItem).filter(Boolean);
    this.refreshSprites();
    this.hp = clamp(d.hp ?? this.maxHp, 1, this.maxHp);
    this.mp = clamp(d.mp ?? this.maxMp, 0, this.maxMp);
    this.dead = false;
  }
}
