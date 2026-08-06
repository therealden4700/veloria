// Мобы: описания, масштабирование по уровню, конечный автомат поведения.

import { bakeMonster } from '../art/sprites.js';
import { clamp, dist, damp, TAU, angle, angDiff, weighted } from '../core/util.js';
import { audio } from '../core/audio.js';
import { reactionFor, runReaction, canReact, MARK_KEYS } from '../systems/reactions.js';
import { markIcon } from '../art/marks.js';
import { makeRng } from '../core/rng.js';
import { rgba } from '../art/palette.js';

/**
 * ai:
 *  melee   — сближается и бьёт
 *  ranged  — держит дистанцию и стреляет
 *  charger — телеграфирует и делает рывок
 *  caster  — держит дистанцию, кастует по площади
 *  boss    — набор приёмов + фазы
 */
export const ENEMIES = {
  slime:      { art: 'slime', role: 'melee',      name: 'Слизень',           ai: 'melee',   hp: 0.85, atk: 0.8, spd: 30, xp: 1.0, r: 8,  atkCd: 1.3, drops: ['slimeGel', 'herbBundle'] },
  bigslime:   { art: 'bigslime', role: 'brute',   name: 'Матёрый слизень',   ai: 'melee',   hp: 2.2,  atk: 1.1, spd: 26, xp: 2.4, r: 12, atkCd: 1.5, elite: true, drops: ['slimeGel', 'essence'] },
  goblin:     { art: 'goblin', role: 'melee',     name: 'Гоблин',            ai: 'melee',   hp: 1.0,  atk: 1.0, spd: 46, xp: 1.1, r: 8,  atkCd: 1.0, drops: ['hide', 'ironOre'] },
  goblinArcher:{art: 'goblinArcher', role: 'ranged',name:'Гоблин-лучник',     ai: 'ranged',  hp: 0.8,  atk: 0.9, spd: 40, xp: 1.2, r: 8,  atkCd: 1.7, keep: 84, drops: ['hide', 'herbBundle'] },
  wolf:       { art: 'wolf', role: 'charger',       name: 'Волк',              ai: 'charger', hp: 1.0,  atk: 1.15,spd: 62, xp: 1.2, r: 9,  atkCd: 1.4, drops: ['fang', 'hide'] },
  wisp:       { art: 'wisp', role: 'caster',       name: 'Лесной дух',        ai: 'caster',  hp: 0.7,  atk: 1.0, spd: 38, xp: 1.4, r: 8,  atkCd: 2.0, keep: 70, flying: true, drops: ['essence', 'herbBundle'] },
  boar:       { art: 'boar', role: 'charger',       name: 'Вепрь',             ai: 'charger', hp: 1.4,  atk: 1.2, spd: 52, xp: 1.3, r: 10, atkCd: 1.8, drops: ['hide', 'ironOre'] },

  // Ведьме топи стояло hp 1.2 — меньше, чем у рядового болотника (1.3):
  // элита умирала с ним вровень, за те же пять ударов. Прочие элиты держат
  // 2.2…3.4; 2.1 оставляет её самой хрупкой из элит, но всё же элитой.
  bogling:    { art: 'bogling', role: 'melee',    name: 'Болотник',          ai: 'melee',   hp: 1.3,  atk: 1.15,spd: 38, xp: 1.3, r: 9,  atkCd: 1.2, effect: 'poison', drops: ['bogHeart', 'hide'] },
  spitter:    { art: 'spitter', role: 'ranged',    name: 'Плевун',            ai: 'ranged',  hp: 1.0,  atk: 1.0, spd: 24, xp: 1.4, r: 9,  atkCd: 1.6, keep: 96, effect: 'poison', drops: ['bogHeart', 'herbBundle'] },
  swampWolf:  { art: 'swampWolf', role: 'charger',  name: 'Тинный волк',       ai: 'charger', hp: 1.2,  atk: 1.25,spd: 66, xp: 1.4, r: 9,  atkCd: 1.3, drops: ['fang'] },
  leech:      { art: 'leech', role: 'melee',      name: 'Пиявка',            ai: 'melee',   hp: 0.7,  atk: 0.9, spd: 54, xp: 1.0, r: 7,  atkCd: 0.9, flying: true, lifesteal: true, drops: ['bogHeart'] },
  mireWitch:  { art: 'mireWitch', role: 'caster',  name: 'Ведьма топи',       ai: 'caster',  hp: 2.1,  atk: 1.3, spd: 32, xp: 1.9, r: 9,  atkCd: 2.2, keep: 100, flying: true, elite: true, drops: ['essence', 'bogHeart'] },

  frostWolf:  { art: 'frostWolf', role: 'charger',  name: 'Ледяной волк',      ai: 'charger', hp: 1.4,  atk: 1.3, spd: 70, xp: 1.5, r: 10, atkCd: 1.3, effect: 'slow', drops: ['fang', 'iceShard'] },
  iceWraith:  { art: 'iceWraith', role: 'caster',  name: 'Ледяной призрак',   ai: 'caster',  hp: 1.1,  atk: 1.25,spd: 42, xp: 1.7, r: 9,  atkCd: 1.9, keep: 82, flying: true, effect: 'slow', drops: ['essence', 'iceShard', 'silverOre'] },
  frostArcher:{ art: 'frostArcher', role: 'ranged',name: 'Мёрзлый стрелок',   ai: 'ranged',  hp: 1.0,  atk: 1.2, spd: 40, xp: 1.6, r: 9,  atkCd: 1.5, keep: 108, drops: ['iceShard', 'silverOre'] },
  yeti:       { art: 'yeti', role: 'brute',       name: 'Йети',              ai: 'melee',   hp: 2.4,  atk: 1.5, spd: 36, xp: 2.6, r: 13, atkCd: 1.6, elite: true, knock: 2, drops: ['hide', 'iceShard', 'silverOre'] },
  bat:        { art: 'bat', role: 'melee',        name: 'Пещерная мышь',     ai: 'melee',   hp: 0.6,  atk: 0.85,spd: 76, xp: 0.9, r: 7,  atkCd: 0.9, flying: true, erratic: true, drops: [] },

  imp:        { art: 'imp', role: 'ranged',        name: 'Бес',               ai: 'ranged',  hp: 0.9,  atk: 1.2, spd: 56, xp: 1.6, r: 8,  atkCd: 1.3, keep: 76, flying: true, effect: 'burn', drops: ['ember'] },
  ashRaven:   { art: 'ashRaven', role: 'charger',   name: 'Пепельный ворон',   ai: 'charger', hp: 0.9,  atk: 1.15,spd: 82, xp: 1.5, r: 8,  atkCd: 1.2, flying: true, drops: ['ember'] },
  cinderKnight:{art:'cinderKnight', role: 'melee', name: 'Тлеющий рыцарь',    ai: 'melee',   hp: 2.0,  atk: 1.55,spd: 42, xp: 2.4, r: 11, atkCd: 1.4, effect: 'burn', drops: ['ember', 'runeCore', 'dragonScale'] },
  magmaGolem: { art: 'magmaGolem', role: 'brute', name: 'Магмовый голем',    ai: 'melee',   hp: 3.4,  atk: 1.8, spd: 28, xp: 3.4, r: 16, atkCd: 1.9, elite: true, knock: 2.4, effect: 'burn', drops: ['ember', 'runeCore', 'dragonScale'] },
  // ── архетипы, требующие особой игры
  goblinShield:{art:'goblinShield', role: 'shield', name: 'Гоблин-щитоносец',  ai: 'melee',   hp: 1.7,  atk: 1.0, spd: 34, xp: 1.7, r: 9,  atkCd: 1.3,
                shield: { arc: 1.25, reduce: 0.82 }, drops: ['hide', 'ironOre'] },
  boneShield: { art: 'boneShield', role: 'shield', name: 'Костяной страж',    ai: 'melee',   hp: 1.6,  atk: 1.15,spd: 36, xp: 1.6, r: 9,  atkCd: 1.2,
                shield: { arc: 1.25, reduce: 0.82 }, drops: ['boneDust', 'ironOre'] },
  frostGuard: { art: 'frostGuard', role: 'shield', name: 'Мёрзлый латник',    ai: 'melee',   hp: 2.3,  atk: 1.45,spd: 30, xp: 2.5, r: 11, atkCd: 1.5, knock: 2,
                shield: { arc: 1.3, reduce: 0.85 }, armor: 0.45, effect: 'slow', drops: ['iceShard', 'silverOre', 'runeCore'] },
  bloater:    { art: 'bloater', role: 'bomber',    name: 'Гнилой вздутыш',    ai: 'bomber',  hp: 1.1,  atk: 1.6, spd: 42, xp: 1.6, r: 10, atkCd: 1,
                bomber: { fuse: 1.15, radius: 54 }, effect: 'poison', drops: ['bogHeart'] },
  emberBomber:{ art: 'emberBomber', role: 'bomber',name: 'Тлеющий шар',       ai: 'bomber',  hp: 1.3,  atk: 1.9, spd: 50, xp: 2.0, r: 10, atkCd: 1,
                bomber: { fuse: 1.0, radius: 60 }, effect: 'burn', flying: true, drops: ['ember'] },
  mireShaman: { art: 'mireShaman', role: 'healer', name: 'Шаман топи',        ai: 'caster',  hp: 1.3,  atk: 0.9, spd: 30, xp: 2.1, r: 9,  atkCd: 2.4, keep: 96, flying: true,
                healer: { frac: 0.11, radius: 100, cd: 3.4 }, effect: 'poison', drops: ['bogHeart', 'essence'] },
  cultShaman: { art: 'cultShaman', role: 'healer', name: 'Жрец культа',       ai: 'caster',  hp: 1.3,  atk: 1.0, spd: 32, xp: 2.2, r: 9,  atkCd: 2.4, keep: 100,
                healer: { frac: 0.12, radius: 110, cd: 3.2 }, drops: ['essence', 'runeCore', 'voidShard'] },

  skeleton:   { art: 'skeleton', role: 'melee',   name: 'Скелет',            ai: 'melee',   hp: 1.1,  atk: 1.1, spd: 44, xp: 1.2, r: 9,  atkCd: 1.1, drops: ['boneDust', 'ironOre'] },
  cultist:    { art: 'cultist', role: 'caster',    name: 'Культист',          ai: 'caster',  hp: 1.1,  atk: 1.25,spd: 36, xp: 1.6, r: 9,  atkCd: 2.0, keep: 92, drops: ['essence'] },
  shade:      { art: 'shade', role: 'charger',      name: 'Тень',              ai: 'charger', hp: 1.0,  atk: 1.35,spd: 68, xp: 1.7, r: 9,  atkCd: 1.5, flying: true, drops: ['essence', 'voidShard'] },
  boneGolem:  { art: 'boneGolem', role: 'brute',  name: 'Костяной голем',    ai: 'melee',   hp: 3.0,  atk: 1.6, spd: 30, xp: 3.0, r: 15, atkCd: 1.8, elite: true, knock: 2.2, drops: ['boneDust', 'runeCore', 'voidShard'] },

  // ── Пролом: обитатели третьего акта
  //
  // Сложность здесь набрана **приёмами, а не здоровьем**. Урок записан в
  // `abyss.js` и стоил целой переделки глубины: «она не ломалась, она
  // провисала — бои растягивались, но опасность не росла». Поэтому в Проломе
  // почти каждый враг чего-то требует от игрока: у ловчего уклонение, у стража
  // щит и броня, хор бьёт издалека и замедляет, зев летает и пьёт кровь, кузнец
  // разъедает защиту. Здоровье при этом лишь немного выше пустоши.
  voidling:   { art: 'voidling', role: 'melee',      name: 'Порождение пустоты', ai: 'melee',   hp: 0.95, atk: 1.35, spd: 68, xp: 1.9, r: 8,  atkCd: 0.85, erratic: true, drops: ['voidShard', 'paleAsh'] },
  riftStalker:{ art: 'riftStalker', role: 'charger', name: 'Ловчий разлома',     ai: 'charger', hp: 1.5,  atk: 1.95, spd: 92, xp: 2.6, r: 9,  atkCd: 1.05, flying: true, dodge: 0.22, drops: ['voidShard', 'paleAsh', 'fang'] },
  paleWarden: { art: 'paleWarden', role: 'shield',   name: 'Бледный страж',      ai: 'melee',   hp: 2.9,  atk: 1.75, spd: 32, xp: 3.2, r: 11, atkCd: 1.5, knock: 2.2,
                shield: { arc: 1.35, reduce: 0.86 }, armor: 0.5, drops: ['voidShard', 'paleAsh', 'runeCore'] },
  hollowChoir:{ art: 'hollowChoir', role: 'caster',  name: 'Полый хор',          ai: 'caster',  hp: 1.6,  atk: 1.85, spd: 30, xp: 2.8, r: 10, atkCd: 1.9, keep: 118, flying: true, effect: 'slow', drops: ['essence', 'paleAsh'] },
  riftMaw:    { art: 'riftMaw', role: 'charger',     name: 'Зев',                ai: 'charger', hp: 1.35, atk: 2.05, spd: 84, xp: 2.5, r: 9,  atkCd: 1.15, flying: true, lifesteal: true, drops: ['voidShard'] },
  paleSmith:  { art: 'paleSmith', role: 'melee',     name: 'Бледный кузнец',     ai: 'melee',   hp: 2.4,  atk: 2.1,  spd: 40, xp: 3.0, r: 11, atkCd: 1.45, armor: 0.34, effect: 'corrode', drops: ['paleAsh', 'ironOre', 'riftGlass'] },
  riftTitan:  { art: 'riftTitan', role: 'brute',     name: 'Титан разлома',      ai: 'melee',   hp: 4.4,  atk: 2.3,  spd: 30, xp: 4.4, r: 17, atkCd: 1.7, elite: true, knock: 2.8, knockRes: 0.3,
                armor: 0.42, drops: ['riftGlass', 'runeCore', 'abyssTear'] },

  // ── Боссы
  //
  // Их сила поднята вдвое, и мерка здесь — не здоровье и не урон по
  // отдельности, а **бюджет урона**: сколько шкал жизни герой примет за бой,
  // если стоять и меняться ударами. Было 0,9 / 1,6 / 2,5 / 3,9 шкалы по
  // биомам, стало 1,8 / 3,2 / 5,0 / 7,7.
  //
  // Удвоить и здоровье, и урон было бы вчетверо по этому счёту — и повторило бы
  // ошибку, про которую в `abyss.js` уже записано: «она не ломалась, она
  // провисала — бои растягивались, но опасность не росла». Поэтому здоровье
  // ×1,45, урон ×1,40: бой становится опаснее вдвое, а длиннее — меньше чем
  // наполовину.
  treant:     { art: 'treant',     name: 'Древень Корнегрив', ai: 'boss', hp: 13.05, atk: 2.1, spd: 30, xp: 14, r: 22, atkCd: 1.8, boss: true, summon: 'wisp', drops: ['runeCore', 'essence', 'herbBundle'] },
  hagBoss:    { art: 'hagBoss',    name: 'Тинная Карга',      ai: 'boss', hp: 14.5, atk: 2.24, spd: 38, xp: 18, r: 18, atkCd: 1.6, boss: true, flying: true, ranged: true, summon: 'spitter', effect: 'poison', drops: ['runeCore', 'bogHeart', 'herbBundle'] },
  frostWarden:{ art: 'frostWarden',name: 'Хранитель Стужи',   ai: 'boss', hp: 18.85, atk: 2.38, spd: 34, xp: 24, r: 22, atkCd: 1.7, boss: true, summon: 'iceWraith', effect: 'slow', drops: ['runeCore', 'iceShard', 'silverOre'] },
  colossus:   { art: 'colossus',   name: 'Расплавленный Колосс', ai: 'boss', hp: 23.2, atk: 2.66, spd: 30, xp: 34, r: 26, atkCd: 1.8, boss: true, summon: 'imp', effect: 'burn', drops: ['runeCore', 'ember', 'dragonScale', 'voidShard'] },
  // Сердце Пролома — самый тяжёлый бой в игре. Числа выше Колосса, но главное
  // не они: щит держит удар в лоб, броня режет лёгкие, а призыв идёт
  // порождениями — их много и они быстры.
  breachHeart:{ art: 'breachHeart', name: 'Сердце Пролома', ai: 'boss', hp: 15, atk: 3.1, spd: 32, xp: 46, r: 30, atkCd: 1.7, boss: true,
                summon: 'voidling', effect: 'corrode', armor: 0.3, shield: { arc: 1.1, reduce: 0.7 }, knockRes: 0.15,
                drops: ['runeCore', 'voidShard', 'abyssTear', 'dragonScale'] },
  lich:       { art: 'lich',       name: 'Лич Морвэн',        ai: 'boss', hp: 20.3, atk: 2.38, spd: 40, xp: 30, r: 18, atkCd: 1.5, boss: true, flying: true, ranged: true, summon: 'skeleton', drops: ['runeCore', 'voidShard', 'essence'] },

  // ── стражи Бездны: на боссовых этажах глубины чередуются, чтобы бесконечный
  // ладдер не упирался в одного и того же лича двадцать шесть раз подряд
  voidMaw:    { art: 'colossus',   name: 'Пасть Пустоты',     ai: 'boss', hp: 24.65, atk: 2.59, spd: 32, xp: 36, r: 26, atkCd: 1.7, boss: true, summon: 'shade',     effect: 'poison', drops: ['runeCore', 'voidShard', 'abyssTear'] },
  hollowKing: { art: 'lich',       name: 'Полый Государь',    ai: 'boss', hp: 21.75, atk: 2.66, spd: 42, xp: 38, r: 19, atkCd: 1.4, boss: true, flying: true, ranged: true, summon: 'boneGolem', effect: 'slow', drops: ['runeCore', 'voidShard', 'abyssTear'] },
  emberWidow: { art: 'hagBoss',    name: 'Тлеющая Вдова',     ai: 'boss', hp: 21.75, atk: 2.52, spd: 40, xp: 36, r: 19, atkCd: 1.5, boss: true, flying: true, ranged: true, summon: 'imp',       effect: 'burn',  drops: ['runeCore', 'ember', 'abyssTear'] },
  rootWarden: { art: 'frostWarden',name: 'Корневой Страж',    ai: 'boss', hp: 27.55, atk: 2.45, spd: 30, xp: 34, r: 24, atkCd: 1.9, boss: true, summon: 'iceWraith', effect: 'slow',  drops: ['runeCore', 'iceShard', 'abyssTear'] },
};

/**
 * Базовые числа от уровня — единая кривая для всех мобов.
 * Здоровье почти линейно: квадратичный рост обгонял урон героя и растягивал
 * поздние бои втрое. Урон поднят так, чтобы рядовой моб убивал за 7–10 ударов.
 */
export function scaleStats(def, level) {
  const l = Math.max(1, level);
  return {
    maxHp: Math.round((38 + l * 26 + l * l * 0.35) * def.hp),
    damage: Math.round((7 + l * 3.3) * def.atk),
    xp: Math.round((7 + l * 3.4) * def.xp),
    gold: Math.round((4 + l * 2.4) * (def.boss ? 14 : def.elite ? 3.2 : 1)),
  };
}

export class Projectile {
  constructor(o) {
    Object.assign(this, {
      x: 0, y: 0, vx: 0, vy: 0, r: 3, damage: 5, life: 2.4,
      color: '#ff8a3a', color2: '#ffe08a', friendly: false, pierce: 0,
      effect: null, trail: true, homing: 0, size: 3, glow: 8, spin: 0, rot: 0,
    }, o);
    this.dead = false;
    this.age = 0;
    this.hitSet = new Set();
  }

  update(dt, game) {
    this.age += dt;
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    if (this.homing) {
      const t = this.friendly ? game.nearestEnemy(this.x, this.y, 120) : game.player;
      if (t) {
        const a = angle(this.x, this.y, t.x, t.y - 10);
        const cur = Math.atan2(this.vy, this.vx);
        const sp = Math.hypot(this.vx, this.vy);
        let d = a - cur;
        while (d > Math.PI) d -= TAU;
        while (d < -Math.PI) d += TAU;
        const na = cur + clamp(d, -this.homing * dt, this.homing * dt);
        this.vx = Math.cos(na) * sp; this.vy = Math.sin(na) * sp;
      }
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.rot += this.spin * dt;

    if (this.trail && Math.random() < 0.75) {
      game.particles.spawn({
        x: this.x, y: this.y, color: this.color2 || this.color, life: 0.3,
        size: this.size * 0.8, drag: 4, vx: -this.vx * 0.12, vy: -this.vy * 0.12,
      });
    }

    if (game.solidAt(this.x, this.y)) { this.explode(game); return; }

    if (this.friendly) {
      for (const e of game.enemies) {
        if (e.dead || this.hitSet.has(e)) continue;
        if (dist(this.x, this.y, e.x, e.y - e.r * 0.6) < e.r + this.r) {
          this.hitSet.add(e);
          game.damageEnemy(e, this.damage, { crit: this.crit, source: 'spell', knock: 60, from: this });
          if (this.effect) e.applyEffect(this.effect, 3, this.damage * 0.16, game);
          if (this.pierce-- <= 0) { this.explode(game); return; }
        }
      }
    } else {
      const p = game.player;
      if (!p.dead && dist(this.x, this.y, p.x, p.y - 10) < 8 + this.r) {
        p.takeDamage(this.damage, game, this);
        if (this.effect) p.applyEffect(this.effect, 3.5, this.damage * 0.14);
        this.explode(game);
      }
    }
  }

  explode(game) {
    this.dead = true;
    game.particles.burst(this.x, this.y, 9, {
      color: this.color, color2: this.color2, speed: 60, life: 0.35, size: this.size, glow: this.glow * 0.6,
    });
  }

  draw(g, cam) {
    const sx = (this.x - cam.x) | 0, sy = (this.y - cam.y) | 0;
    g.save();
    g.globalCompositeOperation = 'lighter';
    const grd = g.createRadialGradient(sx, sy, 0, sx, sy, this.glow);
    grd.addColorStop(0, rgba(this.color2 || this.color, 0.7));
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(sx - this.glow, sy - this.glow, this.glow * 2, this.glow * 2);
    g.restore();
    g.fillStyle = this.color;
    g.fillRect(sx - this.size, sy - this.size, this.size * 2, this.size * 2);
    g.fillStyle = this.color2 || '#ffffff';
    g.fillRect(sx - this.size / 2, sy - this.size / 2, Math.max(1, this.size), Math.max(1, this.size));
  }
}

export class Enemy {
  constructor(key, level, x, y) {
    const def = ENEMIES[key] || ENEMIES.slime;
    this.key = key;
    this.def = def;
    this.name = def.name;
    this.level = level;
    const s = scaleStats(def, level);
    this.maxHp = s.maxHp;
    this.hp = s.maxHp;
    this.damage = s.damage;
    this.xpValue = s.xp;
    this.goldValue = s.gold;

    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.w = def.r * 1.6; this.h = def.r;
    this.r = def.r;
    this.spr = bakeMonster(def.art);
    this.flip = false;
    this.animT = Math.random();
    this.state = 'idle';
    this.stateT = 0;
    this.atkCd = Math.random() * def.atkCd;
    this.hurtT = 0;
    this.dead = false;
    this.deadT = 0;
    this.aggro = false;
    this.aggroRange = def.boss ? 400 : def.elite ? 190 : 148;
    this.wander = Math.random() * TAU;
    this.wanderT = 0;
    this.effects = {};
    this.effTick = 0;
    this.blind = 0;   // в облаке пара дальний бой не работает
    this.noDodge = 0;      // «Верный глаз»: уклонение временно не работает
    this.shieldBroken = 0; // «Створ»: щит временно вскрыт
    this.reactCd = 0; // внутренний откат реакции
    this.elite = !!def.elite;
    this.boss = !!def.boss;
    this.phase = 0;
    this.homeX = x; this.homeY = y;
    this.attackWind = 0;
    this.telegraph = 0;
    this.summonCd = 6;
    this.stun = 0;
    this.blockT = 0;
    // щит поворачивается с задержкой — за счёт этого обход сбоку работает
    this.face = Math.random() * TAU;
    this.fuse = 0;
    this.healCd = def.healer ? def.healer.cd * Math.random() : 0;
    this.healBeam = null;
    this.knockRes = def.boss ? 0.12 : def.elite ? 0.45 : 1;
    this.pack = null;
    // множители от модификатора этажа и аффикса
    this.spdMul = 1;
    this.armorBonus = 0;
    this.affix = null;
    this.sizeMul = 1;
    // Уклонение бралось только из аффикса, а `dodge` из описания врага не
    // доходил до экземпляра вовсе — `resolveHit` читает `e.dodge`, и у Ловчего
    // разлома с его 0.22 не уклонялся ни один удар. Тихая дыра: в бою она
    // выглядит как «враг просто слабее задуманного», без единой ошибки.
    this.dodge = def.dodge || 0;
  }

  get alive() { return !this.dead; }

  /** Аффикс элиты: меняет числа, имя и добавляет ауру. */
  applyAffix(key, def) {
    this.affix = { key, ...def };
    this.name = def.name + ' ' + this.name.toLowerCase();
    this.maxHp = Math.round(this.maxHp * (def.hp || 1));
    this.hp = this.maxHp;
    this.damage = Math.round(this.damage * (def.dmg || 1));
    this.spdMul *= def.spd || 1;
    this.armorBonus += def.armor || 0;
    // Аффикс добавляет уклонение, а не заменяет: раньше здесь стояло
    // присваивание, и элитный Ловчий с аффиксом без уклонения терял своё.
    this.dodge = Math.min(0.6, Math.max(this.dodge, def.dodge || 0));
    if (def.knockRes !== undefined) this.knockRes = def.knockRes;
    if (def.big) { this.sizeMul = 1.3; this.r = Math.round(this.r * 1.25); }
    if (def.effect) this.affixEffect = def.effect;
    if (def.lifesteal) this.affixLifesteal = true;
    this.elite = true;
    this.xpValue = Math.round(this.xpValue * 1.9);
    this.goldValue = Math.round(this.goldValue * 2.2);
    this.aggroRange = Math.max(this.aggroRange, 200);
  }

  /**
   * Вешает метку. Если game передан и на цели уже висит парная метка —
   * вместо накопления двух таймеров срабатывает реакция.
   */
  applyEffect(kind, dur, power, game) {
    if (game && !this.dead && canReact(game, this)) {
      const key = reactionFor(this, kind);
      if (key) { runReaction(game, this, key, kind); return key; }
    }
    this.effects[kind] = Math.max(this.effects[kind] || 0, dur);
    this.effects[kind + 'P'] = Math.max(this.effects[kind + 'P'] || 0, power || 1);
    return null;
  }

  update(dt, game) {
    if (this.dead) {
      this.deadT += dt;
      return;
    }
    const p = game.player;
    this.stateT += dt;
    if (this.hurtT > 0) this.hurtT -= dt;
    if (this.blockT > 0) this.blockT -= dt;
    if (this.atkCd > 0) this.atkCd -= dt;
    if (this.healBeam) { this.healBeam.t -= dt; if (this.healBeam.t <= 0) this.healBeam = null; }

    // оглушение полностью выключает ИИ
    // ── метки тикают всегда, в том числе под оглушением: иначе контроль
    // работал бы защитой от собственного же яда и поджига
    this.tickMarks(dt, game);

    if (this.stun > 0) {
      this.stun -= dt;
      this.vx = damp(this.vx, 0, 10, dt);
      this.vy = damp(this.vy, 0, 10, dt);
      game.moveEntity(this, dt, !this.def.flying);
      if (Math.random() < 0.25) {
        game.particles.spawn({
          x: this.x + (Math.random() - 0.5) * 12, y: this.y - this.r * 1.6,
          vx: (Math.random() - 0.5) * 10, vy: -6, color: '#ffe66a', life: 0.5, size: 1, glow: 4,
        });
      }
      return;
    }

    // ── лекарь: чинит союзников, поэтому его убивают первым
    if (this.def.healer && this.aggro) {
      this.healCd -= dt;
      if (this.healCd <= 0) {
        const h = this.def.healer;
        let target = null, worst = 0.96;
        for (const o of game.enemies) {
          if (o.dead || o === this) continue;
          const frac = o.hp / o.maxHp;
          if (frac < worst && dist(this.x, this.y, o.x, o.y) < h.radius) { worst = frac; target = o; }
        }
        if (target) {
          this.healCd = h.cd;
          const amt = Math.round(target.maxHp * h.frac);
          target.hp = Math.min(target.maxHp, target.hp + amt);
          this.healBeam = { x: target.x, y: target.y - target.r * 0.6, t: 0.45 };
          game.floats.add(target.x, target.y - target.spr.h * 0.8, '+' + amt, { color: '#8ff0b0', size: 9 });
          game.particles.burst(target.x, target.y - target.r * 0.6, 8, {
            color: '#8ff0b0', color2: '#e6ffe0', speed: 40, life: 0.5, size: 2, glow: 6,
          });
          audio.play('potion', 0.4);
        } else this.healCd = 0.6;
      }
    }

    // ── подрывник: подходит вплотную, раздувается и взрывается
    if (this.def.bomber) {
      const bd = dist(this.x, this.y, p.x, p.y);
      if (this.fuse > 0) {
        this.fuse -= dt;
        this.vx = damp(this.vx, 0, 6, dt);
        this.vy = damp(this.vy, 0, 6, dt);
        game.moveEntity(this, dt, !this.def.flying);
        if (this.fuse <= 0) { this.explode(game); return; }
        this.animT = (this.animT + dt * 3) % 1;
        return;
      }
      if (this.aggro && bd < this.r + 22) { this.fuse = this.def.bomber.fuse; audio.play('deny', 0.6); }
    }

    const slowed = this.effects.slow > 0 ? 0.55 : 1;

    // щитоносец доворачивает щит медленно: успел зайти сбоку — бьёшь в полную силу
    if (this.def.shield) {
      const want = angle(this.x, this.y, p.x, p.y);
      const turn = (this.state === 'windup' || this.state === 'attack' ? 0.7 : 2.1) * slowed * dt;
      this.face += clamp(angDiff(this.face, want), -turn, turn);
    }

    const d = dist(this.x, this.y, p.x, p.y);
    if (!p.dead && d < this.aggroRange && !this.aggro) { this.aggro = true; this.wakePack(game); }
    if (p.dead) this.aggro = false;

    const def = this.def;
    let mvx = 0, mvy = 0;
    const speed = def.spd * slowed * this.spdMul;

    if (!this.aggro) {
      // блуждание вокруг точки появления
      this.wanderT -= dt;
      if (this.wanderT <= 0) {
        this.wanderT = 1.4 + Math.random() * 2.4;
        this.wander = Math.random() * TAU;
        if (dist(this.x, this.y, this.homeX, this.homeY) > 70) this.wander = angle(this.x, this.y, this.homeX, this.homeY);
        this.idleMove = Math.random() < 0.6;
      }
      if (this.idleMove) { mvx = Math.cos(this.wander) * 0.4; mvy = Math.sin(this.wander) * 0.4; }
    } else {
      const a = angle(this.x, this.y, p.x, p.y - 6);
      switch (def.ai) {
        case 'ranged':
        case 'caster': {
          const keep = def.keep || 80;
          if (d > keep + 14) { mvx = Math.cos(a); mvy = Math.sin(a); }
          else if (d < keep - 22) { mvx = -Math.cos(a); mvy = -Math.sin(a); }
          else {
            // стрейф
            mvx = Math.cos(a + Math.PI / 2) * 0.6 * (this.strafeDir || 1);
            mvy = Math.sin(a + Math.PI / 2) * 0.6 * (this.strafeDir || 1);
            if (Math.random() < 0.008) this.strafeDir = -(this.strafeDir || 1);
          }
          if (this.atkCd <= 0 && d < keep + 60 && game.hasLineOfSight(this, p)) {
            this.telegraph = 0.45;
            this.atkCd = def.atkCd + Math.random() * 0.5;
            this.state = 'windup';
            this.stateT = 0;
          }
          break;
        }
        case 'charger': {
          if (this.state === 'charge') {
            mvx = Math.cos(this.chargeA) * 2.6;
            mvy = Math.sin(this.chargeA) * 2.6;
            if (this.stateT > 0.42) { this.state = 'idle'; this.stateT = 0; }
            if (d < this.r + 12) this.hitPlayer(game, 1.15);
            game.particles.spawn({ x: this.x, y: this.y - 4, color: '#ffffff', life: 0.16, size: 1, drag: 5 });
          } else if (this.telegraph > 0) {
            this.telegraph -= dt;
            if (this.telegraph <= 0) {
              this.state = 'charge'; this.stateT = 0;
              this.chargeA = angle(this.x, this.y, p.x, p.y - 6);
              audio.play('swing', 0.5);
            }
          } else {
            if (d > 34) { mvx = Math.cos(a); mvy = Math.sin(a); }
            if (this.atkCd <= 0 && d < 130 && d > 22) {
              this.telegraph = 0.5;
              this.atkCd = def.atkCd + Math.random() * 0.6;
            } else if (this.atkCd <= 0 && d <= this.r + 12) {
              this.hitPlayer(game, 1);
              this.atkCd = def.atkCd;
            }
          }
          break;
        }
        case 'boss': this.bossAI(dt, game, d, a); return;
        default: {
          if (d > this.r + 9) { mvx = Math.cos(a); mvy = Math.sin(a); }
          if (this.def.erratic) {
            mvx += Math.cos(game.time * 6 + this.homeX) * 0.5;
            mvy += Math.sin(game.time * 5 + this.homeY) * 0.5;
          }
          if (this.atkCd <= 0 && d < this.r + 16) {
            this.state = 'windup';
            this.telegraph = 0.3;
            this.atkCd = def.atkCd;
            this.stateT = 0;
          }
        }
      }

      if (this.state === 'windup') {
        this.telegraph -= dt;
        mvx *= 0.25; mvy *= 0.25;
        if (this.telegraph <= 0) {
          this.state = 'attack'; this.stateT = 0;
          if (def.ai === 'ranged' || def.ai === 'caster') {
            // в облаке пара выстрел срывается — за это пар и берут
            if (this.blind > 0) game.floats.add(this.x, this.y - this.r - 12, 'промах', { color: '#cfe4f0', size: 8 });
            else this.shoot(game, p);
          } else this.hitPlayer(game, 1);
        }
      } else if (this.state === 'attack' && this.stateT > 0.22) {
        this.state = 'idle';
      }
    }

    const len = Math.hypot(mvx, mvy);
    if (len > 0) { mvx /= len; mvy /= len; this.flip = mvx < 0; }
    else if (this.aggro && !p.dead) this.flip = p.x < this.x;

    this.vx = damp(this.vx, mvx * speed, 9, dt);
    this.vy = damp(this.vy, mvy * speed, 9, dt);

    game.moveEntity(this, dt, !def.flying);

    // разлипание мобов
    if (game.time % 1 < dt * 2) this.separate(game);

    this.animT = (this.animT + dt * (this.aggro ? 1.4 : 0.7)) % 1;
  }

  /** Отряд поднимается целиком: заметил один — идут все. */
  wakePack(game) {
    if (!this.pack) return;
    for (const o of game.enemies) {
      if (o === this || o.dead || o.aggro || o.pack !== this.pack) continue;
      if (dist(this.x, this.y, o.x, o.y) > 220) continue;
      o.aggro = true;
    }
  }

  separate(game) {
    for (const o of game.enemies) {
      if (o === this || o.dead) continue;
      const dx = o.x - this.x, dy = o.y - this.y;
      const dd = Math.hypot(dx, dy);
      const min = this.r + o.r - 2;
      if (dd > 0 && dd < min) {
        const push = (min - dd) * 0.5;
        this.x -= (dx / dd) * push;
        this.y -= (dy / dd) * push;
      }
    }
  }

  /** Взрыв подрывника: бьёт героя и своих же, сам погибает. */
  explode(game) {
    const b = this.def.bomber;
    const p = game.player;
    game.shockwave(this.x, this.y, b.radius, 0, this.def.effect === 'burn' ? '#ff7a2a' : '#7fd83a');
    if (!p.dead && dist(this.x, this.y, p.x, p.y - 6) < b.radius) {
      p.takeDamage(this.damage * 1.9, game, this);
      if (this.def.effect) p.applyEffect(this.def.effect, 4, this.damage * 0.16);
    }
    for (const o of game.enemies) {
      if (o === this || o.dead) continue;
      if (dist(this.x, this.y, o.x, o.y) < b.radius) game.damageEnemy(o, this.damage * 0.8, { silent: true, dot: true, color: '#ffb06a' });
    }
    game.particles.burst(this.x, this.y - this.r * 0.5, 34, {
      color: this.def.effect === 'burn' ? '#ff5a1a' : '#5fb83a',
      color2: '#fff0c0', speed: 150, life: 0.6, size: 3, glow: 9,
    });
    game.shake.add(7, 0.4);
    audio.play('die', 0.9);
    game.killEnemy(this);
  }

  hitPlayer(game, mult = 1) {
    const p = game.player;
    if (p.dead) return;
    if (dist(this.x, this.y, p.x, p.y - 6) > this.r + 22) return;
    const dealt = p.takeDamage(this.damage * mult, game, this, { melee: true });
    const eff = this.def.effect || this.affixEffect;
    if (dealt && eff) p.applyEffect(eff, 3.5, this.damage * 0.14);
    if (dealt && (this.def.lifesteal || this.affixLifesteal)) this.hp = Math.min(this.maxHp, this.hp + dealt * 0.5);
    audio.play('swing', 0.6);
  }

  shoot(game, p) {
    const a = angle(this.x, this.y - this.r * 0.8, p.x, p.y - 10);
    const col = this.def.effect === 'burn' ? ['#ff5a1a', '#ffd66a']
      : this.def.effect === 'slow' ? ['#4aa8e0', '#c8f0ff']
      : this.def.effect === 'poison' ? ['#5fb83a', '#c6ff8a']
      : ['#a05fe0', '#e0b8ff'];
    const n = this.def.ai === 'caster' && this.elite ? 3 : 1;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 0.24;
      game.projectiles.push(new Projectile({
        x: this.x, y: this.y - this.r * 0.9,
        vx: Math.cos(a + off) * 122, vy: Math.sin(a + off) * 122,
        damage: this.damage * 0.9, color: col[0], color2: col[1],
        effect: this.def.effect, size: 2.4, glow: 9, life: 3,
      }));
    }
    audio.play('bolt', 0.55);
  }

  bossAI(dt, game, d, a) {
    const p = game.player;
    const def = this.def;
    const hpFrac = this.hp / this.maxHp;
    this.phase = hpFrac < 0.35 ? 2 : hpFrac < 0.7 ? 1 : 0;
    const rage = 1 + this.phase * 0.28;
    let mvx = 0, mvy = 0;

    this.summonCd -= dt;
    if (this.summonCd <= 0 && this.phase >= 1 && def.summon) {
      this.summonCd = 11 - this.phase * 2;
      game.summonAdds(this, def.summon, 1 + this.phase);
    }

    if (this.state === 'charge') {
      mvx = Math.cos(this.chargeA) * 2.4; mvy = Math.sin(this.chargeA) * 2.4;
      if (this.stateT > 0.5) { this.state = 'idle'; this.stateT = 0; }
      if (d < this.r + 16) this.hitPlayer(game, 1.2);
      game.particles.spawn({ x: this.x + (Math.random() - .5) * 16, y: this.y - 4, color: '#ffce6a', life: 0.24, size: 2, drag: 4 });
    } else if (this.telegraph > 0) {
      this.telegraph -= dt;
      mvx = mvy = 0;
      if (this.telegraph <= 0) {
        if (this.blind > 0 && (this.nextAttack === 'barrage' || this.nextAttack === 'nova')) {
          game.floats.add(this.x, this.y - this.r - 12, 'сорвано', { color: '#cfe4f0', size: 9 });
        } else this.fireAttack(game, p, a);
      }
    } else {
      if (def.ranged) {
        const keep = 96;
        if (d > keep + 20) { mvx = Math.cos(a); mvy = Math.sin(a); }
        else if (d < keep - 30) { mvx = -Math.cos(a); mvy = -Math.sin(a); }
        else { mvx = Math.cos(a + 1.57) * 0.7; mvy = Math.sin(a + 1.57) * 0.7; }
      } else if (d > this.r + 12) { mvx = Math.cos(a); mvy = Math.sin(a); }

      if (this.atkCd <= 0) {
        this.atkCd = (def.atkCd + Math.random() * 0.6) / rage;
        this.nextAttack = weighted([
          ['slam', d < 70 ? 40 : 8],
          ['nova', 26],
          ['barrage', def.ranged ? 40 : 20],
          ['charge', d > 60 ? 30 : 6],
        ]);
        this.telegraph = this.nextAttack === 'charge' ? 0.6 : 0.7;
        game.shake.add(1.4, 0.2);
      }
    }

    const len = Math.hypot(mvx, mvy);
    if (len > 0) { mvx /= len; mvy /= len; this.flip = mvx < 0; }
    else this.flip = p.x < this.x;
    const slowed = this.effects.slow > 0 ? 0.6 : 1;
    const bspd = def.spd * slowed * this.spdMul * (1 + this.phase * 0.1);
    this.vx = damp(this.vx, mvx * bspd, 8, dt);
    this.vy = damp(this.vy, mvy * bspd, 8, dt);
    game.moveEntity(this, dt, !def.flying);
    this.animT = (this.animT + dt * 1.3) % 1;
  }

  fireAttack(game, p, a) {
    const kind = this.nextAttack || 'slam';
    const col = this.def.effect === 'burn' ? ['#ff5a1a', '#ffd66a']
      : this.def.effect === 'slow' ? ['#4aa8e0', '#c8f0ff']
      : this.def.effect === 'poison' ? ['#5fb83a', '#c6ff8a']
      : ['#a05fe0', '#e0b8ff'];

    if (kind === 'charge') {
      this.state = 'charge'; this.stateT = 0;
      this.chargeA = angle(this.x, this.y, p.x, p.y - 6);
      audio.play('boss', 0.5);
      return;
    }
    if (kind === 'slam') {
      game.shockwave(this.x, this.y, this.r + 46, this.damage * 1.15, col[0]);
      game.shake.add(7, 0.4);
      audio.play('boss', 0.7);
      return;
    }
    if (kind === 'nova') {
      const n = 10 + this.phase * 4;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * TAU + Math.random() * 0.1;
        game.projectiles.push(new Projectile({
          x: this.x, y: this.y - this.r * 0.7,
          vx: Math.cos(ang) * 96, vy: Math.sin(ang) * 96,
          damage: this.damage * 0.7, color: col[0], color2: col[1],
          effect: this.def.effect, size: 2.6, glow: 10, life: 2.6,
        }));
      }
      audio.play('cast', 0.7);
      return;
    }
    // barrage
    const n = 3 + this.phase;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 0.2;
      game.projectiles.push(new Projectile({
        x: this.x, y: this.y - this.r * 0.7,
        vx: Math.cos(a + off) * 142, vy: Math.sin(a + off) * 142,
        damage: this.damage * 0.85, color: col[0], color2: col[1],
        effect: this.def.effect, size: 3, glow: 11, life: 3, homing: this.phase >= 2 ? 1.2 : 0,
      }));
    }
    audio.play('bolt', 0.8);
  }

  /** Канвас текущего кадра — используется и для тени. */
  frame() {
    const sp = this.spr;
    const atk = this.state === 'attack' || this.state === 'windup' || this.state === 'charge';
    const set = this.flip ? (atk ? sp.attackL : sp.idleL) : (atk ? sp.attack : sp.idle);
    return set[Math.floor(this.animT * set.length) % set.length];
  }

  draw(g, cam, time) {
    const sp = this.spr;
    const c = this.frame();
    const dx = Math.round(this.x - cam.x - sp.w / 2);
    const dy = Math.round(this.y - cam.y - sp.h + 3 + (this.def.flying ? -6 : 0));

    if (this.dead) {
      g.save();
      g.globalAlpha = Math.max(0, 1 - this.deadT * 2.2);
      g.translate(dx + sp.w / 2, dy + sp.h);
      g.scale(1, Math.max(0.1, 1 - this.deadT * 1.6));
      g.drawImage(c, -sp.w / 2, -sp.h);
      g.restore();
      return;
    }

    // телеграф: круг на земле + вспышка силуэта — видно, что сейчас прилетит
    if (this.telegraph > 0) {
      const k = 1 - clamp(this.telegraph / 0.6, 0, 1);
      g.save();
      g.globalAlpha = 0.35 + k * 0.4;
      g.strokeStyle = '#ff4a3a';
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(this.x - cam.x, this.y - cam.y, (this.r + 14) * (0.5 + k * 0.7), (this.r + 14) * 0.45 * (0.5 + k * 0.7), 0, 0, TAU);
      g.stroke();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.25 + Math.sin(time * 28) * 0.18;
      g.drawImage(c, dx, dy);
      g.restore();
    }

    // аура аффикса
    if (this.affix) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.22 + Math.sin(time * 3 + this.x) * 0.1;
      const rr = this.r + 7;
      const grd = g.createRadialGradient(this.x - cam.x, this.y - cam.y - 2, 0, this.x - cam.x, this.y - cam.y - 2, rr);
      grd.addColorStop(0, this.affix.color);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(this.x - cam.x - rr, this.y - cam.y - 2 - rr * 0.6, rr * 2, rr * 1.2);
      g.restore();
    }

    // дуга щита на земле: сразу видно, с какой стороны бить бесполезно
    if (this.def.shield && this.aggro) {
      const a = this.def.shield.arc;
      g.save();
      g.globalAlpha = this.blockT > 0 ? 0.75 : 0.3;
      g.strokeStyle = '#9fc4e8';
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(this.x - cam.x, this.y - cam.y - 2, this.r + 9, (this.r + 9) * 0.5, 0, this.face - a, this.face + a);
      g.stroke();
      g.restore();
    }

    // луч исцеления к раненому союзнику
    if (this.healBeam) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = clamp(this.healBeam.t * 2.2, 0, 0.85);
      g.strokeStyle = '#8ff0b0';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(this.x - cam.x, this.y - cam.y - this.r);
      g.lineTo(this.healBeam.x - cam.x, this.healBeam.y - cam.y);
      g.stroke();
      g.restore();
    }

    // подрывник раздувается и мигает перед взрывом
    if (this.fuse > 0) {
      const k = 1 - this.fuse / (this.def.bomber.fuse || 1);
      g.save();
      g.translate(dx + sp.w / 2, dy + sp.h);
      const sc = 1 + k * 0.35 + Math.sin(time * 30) * k * 0.08;
      g.scale(sc, sc);
      g.drawImage(c, -sp.w / 2, -sp.h);
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.3 + Math.sin(time * 26) * 0.3;
      g.drawImage(c, -sp.w / 2, -sp.h);
      g.restore();
    } else {
      g.drawImage(c, dx, dy);
    }

    if (this.blockT > 0) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = clamp(this.blockT * 4, 0, 0.8);
      g.drawImage(c, dx, dy);
      g.restore();
    }

    if (this.hurtT > 0) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = clamp(this.hurtT * 4.5, 0, 0.9);
      g.drawImage(c, dx, dy);
      g.restore();
    }
    if (this.effects.burn > 0) {
      g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.28;
      g.fillStyle = '#ff6a1a'; g.fillRect(dx, dy, sp.w, sp.h);
      g.restore();
    }
    if (this.effects.slow > 0) {
      g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.24;
      g.fillStyle = '#5fc8ff'; g.fillRect(dx, dy, sp.w, sp.h);
      g.restore();
    }
  }

  tickMarks(dt, game) {
    if (this.blind > 0) this.blind -= dt;
    if (this.noDodge > 0) this.noDodge -= dt;
    if (this.shieldBroken > 0) this.shieldBroken -= dt;
    for (const k in this.effects) {
      if (k.endsWith('P')) continue;
      if (this.effects[k] > 0) this.effects[k] -= dt;
    }
    if (this.effects.burn > 0 || this.effects.poison > 0 || this.effects.corrode > 0) {
      this.effTick -= dt;
      if (this.effTick <= 0) {
        // токсиколог ускоряет собственный яд героя — чаще тик, а не сильнее
        const tox = this.effects.poison > 0 || this.effects.corrode > 0 ? game.player.passive('toxicology') : 0;
        this.effTick = 0.55 / (1 + tox / 100);
        const cor = this.effects.corrode > 0;
        const dmg = Math.max(1, Math.round(cor
          ? this.effects.corrodeP
          : (this.effects.burnP || this.effects.poisonP || 2)));
        game.damageEnemy(this, dmg, {
          silent: true, dot: true,
          color: cor ? '#b8e04a' : this.effects.burn > 0 ? '#ff9a3a' : '#a8ee5a',
        });
      }
    }
  }

  /** Метки над врагом: по ним игрок и планирует связку. */
  drawMarks(g, cam) {
    if (this.dead) return;
    const on = [];
    for (const k of MARK_KEYS) if (k !== 'steam' && (this.effects[k] || 0) > 0) on.push(k);
    if (this.blind > 0) on.push('steam');
    if (!on.length) return;
    const y = Math.round(this.y - cam.y - this.spr.h + (this.def.flying ? -8 : 0)) - 9;
    let x = Math.round(this.x - cam.x - (on.length * 8 - 2) / 2);
    for (const k of on) {
      // последняя секунда — мигание, чтобы успеть достроить связку
      const t = k === 'steam' ? this.blind : this.effects[k];
      if (t > 1 || Math.sin(t * 18) > -0.3) g.drawImage(markIcon(k), x, y);
      x += 8;
    }
  }

  drawBar(g, cam) {
    if (this.dead || this.boss) return;
    if (this.hp >= this.maxHp && !this.aggro) return;
    const w = Math.max(16, this.r * 2.2) | 0;
    const x = Math.round(this.x - cam.x - w / 2);
    const y = Math.round(this.y - cam.y - this.spr.h + (this.def.flying ? -8 : 0));
    g.fillStyle = 'rgba(8,6,16,0.75)';
    g.fillRect(x - 1, y - 1, w + 2, 4);
    g.fillStyle = '#3a0d16';
    g.fillRect(x, y, w, 2);
    g.fillStyle = this.elite ? '#f0a03a' : '#e0484f';
    g.fillRect(x, y, Math.max(0, (w * this.hp / this.maxHp)) | 0, 2);
  }
}
