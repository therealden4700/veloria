// Умения — не привязаны к оружию, а вставляются рунами в слоты.
// Каждое описано данными + функцией применения; урон считается от характеристик
// героя, поэтому одна и та же руна растёт вместе с ним.

import { TAU, clamp, dist, angle } from '../core/util.js';
import { audio } from '../core/audio.js';

const ELEM = {
  phys:   { color: '#dfe9ff', color2: '#ffffff', name: 'физический' },
  fire:   { color: '#ff6a1a', color2: '#ffd66a', name: 'огонь' },
  ice:    { color: '#4aa8e0', color2: '#c8f0ff', name: 'лёд' },
  poison: { color: '#5fb83a', color2: '#c6ff8a', name: 'яд' },
  arcane: { color: '#8b4fd8', color2: '#e0b8ff', name: 'аркана' },
  holy:   { color: '#ffd66a', color2: '#fff6c8', name: 'свет' },
};

export { ELEM };

/**
 * glyph — отрезки в сетке 10×10 для иконки руны.
 * atk/mag — доли урона от физической атаки и силы магии.
 */
export const SKILLS = {
  // ─────────────── ближний бой
  whirl: {
    name: 'Вихрь клинков', elem: 'phys', cost: 16, cd: 4.2, atk: 1.3, mag: 0,
    desc: 'Круговой удар по всем вокруг с сильным отбросом.',
    glyph: [[1, 5, 5, 1], [5, 1, 9, 5], [9, 5, 5, 9], [5, 9, 1, 5], [4, 5, 6, 5]],
    run(g, c) {
      const p = g.player;
      g.slashes.push({ x: p.x, y: p.y - 12, a: 0, r: 52, spread: Math.PI, t: 0, dur: 0.36, color: '#ffe6a0', ring: true });
      g.aoeDamage(p.x, p.y - 6, 56, c.dmg, { knock: 190, heavy: true, crit: 0.1 });
      g.shake.add(5, 0.3);
      g.particles.burst(p.x, p.y - 8, 20, { color: '#ffe6a0', speed: 120, life: 0.35, size: 2, flat: true, glow: 5 });
    },
  },
  cleave: {
    name: 'Раскол земли', elem: 'phys', cost: 20, cd: 5.4, atk: 1.9, mag: 0,
    desc: 'Тяжёлый удар перед собой, волна вешает обморожение на уцелевших.',
    glyph: [[2, 1, 5, 8], [8, 1, 5, 8], [1, 9, 9, 9]],
    run(g, c) {
      const p = g.player;
      const tx = p.x + Math.cos(p.facing) * 28, ty = p.y - 4 + Math.sin(p.facing) * 18;
      g.shockwave(tx, ty, 46, 0, '#ffa14a');
      g.aoeDamage(tx, ty, 50, c.dmg, { knock: 240, heavy: true, effect: ['slow', 2.5, 1] });
      g.shake.add(8, 0.4);
    },
  },
  quake: {
    name: 'Сотрясение', elem: 'phys', cost: 26, cd: 8.5, atk: 1.1, mag: 0,
    desc: 'Удар оземь: оглушает всех вокруг на 1,4 сек.',
    glyph: [[5, 1, 5, 6], [2, 6, 8, 6], [1, 9, 3, 7], [9, 9, 7, 7], [5, 6, 5, 9]],
    run(g, c) {
      const p = g.player;
      g.shockwave(p.x, p.y, 74, 0, '#ffce6a');
      g.aoeDamage(p.x, p.y - 6, 76, c.dmg, { knock: 120, heavy: true, stun: 1.4 });
      g.shake.add(11, 0.6);
      audio.play('boss', 0.6);
    },
  },
  blink: {
    name: 'Теневой рывок', elem: 'arcane', cost: 14, cd: 3.4, atk: 1.5, mag: 0,
    desc: 'Рывок сквозь врагов: неуязвимость и гарантированный крит.',
    glyph: [[2, 8, 5, 2], [5, 2, 8, 8], [3, 5, 7, 5], [1, 2, 3, 1]],
    run(g, c) {
      const p = g.player;
      const d = 84;
      const tx = clamp(p.x + Math.cos(p.facing) * d, 12, g.zone.pxW - 12);
      const ty = clamp(p.y + Math.sin(p.facing) * d, 16, g.zone.pxH - 8);
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        g.particles.spawn({ x: p.x + (tx - p.x) * t, y: p.y - 10 + (ty - p.y) * t, color: '#c99cff', life: 0.4, size: 2, glow: 6 });
      }
      g.lineDamage(p.x, p.y - 8, p.facing, d, 24, c.dmg, { crit: 1, heavy: true, knock: 90 });
      if (g.canBeAt(tx, ty, p.w, p.h)) { p.x = tx; p.y = ty; }
      p.iframe = Math.max(p.iframe, 0.4);
    },
  },
  pierce: {
    name: 'Пронзание', elem: 'phys', cost: 15, cd: 3.8, atk: 1.55, mag: 0,
    desc: 'Длинный колющий выпад по прямой.',
    glyph: [[1, 9, 9, 1], [7, 1, 9, 1], [9, 1, 9, 3], [3, 6, 6, 3]],
    run(g, c) {
      const p = g.player;
      const d = 100;
      for (let i = 0; i <= 14; i++) {
        const t = i / 14;
        g.particles.spawn({ x: p.x + Math.cos(p.facing) * d * t, y: p.y - 11 + Math.sin(p.facing) * d * t, color: '#dfe9ff', life: 0.35, size: 2, glow: 5 });
      }
      g.lineDamage(p.x, p.y - 8, p.facing, d, 17, c.dmg, { knock: 130, heavy: true });
      g.shake.add(4, 0.2);
    },
  },

  // ─────────────── дальний бой
  bolts: {
    name: 'Аркановый залп', elem: 'arcane', cost: 22, cd: 2.9, atk: 0, mag: 1.5,
    desc: 'Три самонаводящихся снаряда, пробивают цель насквозь. Вешают разряд.',
    glyph: [[2, 8, 4, 2], [5, 9, 5, 2], [8, 8, 6, 2], [4, 2, 5, 1], [6, 2, 5, 1]],
    run(g, c) {
      const p = g.player;
      for (let i = 0; i < 3; i++) {
        const off = (i - 1) * 0.3;
        g.spawnBolt(p.facing + off, c.dmg, { color: '#8b4fd8', color2: '#e6c0ff', homing: 2.2, pierce: 1, size: 3.5, glow: 14, speed: 190, effect: 'shock' });
      }
    },
  },
  arrows: {
    name: 'Ливень стрел', elem: 'phys', cost: 18, cd: 3.4, atk: 0.9, mag: 0,
    desc: 'Веер из пяти стрел, каждая пробивает одну цель.',
    glyph: [[1, 9, 4, 1], [5, 9, 5, 1], [9, 9, 6, 1], [3, 4, 7, 4]],
    run(g, c) {
      const p = g.player;
      for (let i = 0; i < 5; i++) {
        g.spawnBolt(p.facing + (i - 2) * 0.16, c.dmg, { color: '#d8c48a', color2: '#fff0c0', pierce: 1, size: 2, glow: 6, speed: 280, life: 1.5 });
      }
    },
  },
  chain: {
    name: 'Цепная молния', elem: 'arcane', cost: 22, cd: 5, atk: 0, mag: 1.4,
    desc: 'Молния прыгает по четырём целям, слабея на каждой. Вешает разряд.',
    glyph: [[3, 1, 6, 4], [6, 4, 3, 5], [3, 5, 7, 9], [1, 3, 3, 1]],
    run(g, c) {
      const p = g.player;
      let from = { x: p.x, y: p.y - 12 };
      const hit = new Set();
      let dmg = c.dmg;
      for (let i = 0; i < 4; i++) {
        const t = g.nearestEnemy(from.x, from.y, i === 0 ? 130 : 96, hit);
        if (!t) break;
        hit.add(t);
        g.bolt(from.x, from.y, t.x, t.y - t.r * 0.6, '#b98cff');
        g.damageEnemy(t, dmg, { crit: Math.random() < p.critChance, heavy: true });
        t.stun = Math.max(t.stun || 0, 0.35 * (t.boss ? 0.35 : 1));
        t.applyEffect('shock', 4, 1, g);
        from = { x: t.x, y: t.y - t.r * 0.6 };
        dmg *= 0.75;
      }
      audio.play('bolt', 0.9);
    },
  },

  // ─────────────── стихии и контроль
  firewall: {
    // mag было 0,5, и стена давала 370% вклада за откат — вдвое больше, чем
    // следующее умение, и больше всех по одиночной цели. Причина в объёме:
    // пять плиток × 5 секунд × два тика в секунду = полсотни попаданий с
    // одного нажатия. 0,2 ставит её вровень с ядовитым облаком (143%), её
    // прямым родственником: та же идея зоны, тот же размер вклада.
    name: 'Стена огня', elem: 'fire', cost: 24, cd: 8, atk: 0, mag: 0.2,
    desc: 'Полоса пламени горит 5 сек и поджигает всех, кто в неё войдёт.',
    glyph: [[2, 9, 3, 5], [3, 5, 4, 8], [5, 9, 6, 4], [6, 4, 7, 8], [1, 9, 9, 9]],
    run(g, c) {
      const p = g.player;
      const n = 5;
      const perp = p.facing + Math.PI / 2;
      const bx = p.x + Math.cos(p.facing) * 34, by = p.y + Math.sin(p.facing) * 22;
      for (let i = 0; i < n; i++) {
        const k = (i - (n - 1) / 2) * 17;
        g.hazards.push({
          x: bx + Math.cos(perp) * k, y: by + Math.sin(perp) * k * 0.7,
          r: 15, life: 5, dps: c.dmg, effect: ['burn', 3, c.dmg * 0.25],
          color: '#ff6a1a', color2: '#ffd66a', tick: 0,
        });
      }
      audio.play('cast', 0.9);
    },
  },
  frostNova: {
    name: 'Ледяная новая', elem: 'ice', cost: 20, cd: 6, atk: 0, mag: 1.1,
    desc: 'Кольцо холода: урон и сильное замедление на 4 сек.',
    glyph: [[5, 1, 5, 9], [1, 5, 9, 5], [2, 2, 8, 8], [8, 2, 2, 8]],
    run(g, c) {
      const p = g.player;
      g.shockwave(p.x, p.y, 62, 0, '#7fd8ff');
      g.aoeDamage(p.x, p.y - 6, 66, c.dmg, { effect: ['slow', 4, 1], knock: 40 });
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * TAU;
        g.particles.spawn({ x: p.x + Math.cos(a) * 10, y: p.y - 8 + Math.sin(a) * 7, vx: Math.cos(a) * 130, vy: Math.sin(a) * 90, color: '#c8f0ff', life: 0.5, size: 2, drag: 3, glow: 6 });
      }
      audio.play('cast', 0.8);
    },
  },
  poisonCloud: {
    name: 'Ядовитое облако', elem: 'poison', cost: 18, cd: 7, atk: 0, mag: 0.45,
    desc: 'Облако едкого газа на 6 сек: постоянный урон и отравление.',
    glyph: [[3, 3, 7, 3], [2, 5, 8, 5], [3, 7, 7, 7], [5, 1, 5, 2]],
    run(g, c) {
      const p = g.player;
      const bx = p.x + Math.cos(p.facing) * 40, by = p.y + Math.sin(p.facing) * 26;
      g.hazards.push({
        x: bx, y: by, r: 34, life: 6, dps: c.dmg,
        effect: ['poison', 4, c.dmg * 0.3], color: '#3f7a2a', color2: '#c6ff8a', tick: 0, cloud: true,
      });
      audio.play('cast', 0.7);
    },
  },

  // ─────────────── поддержка
  heal: {
    name: 'Слово исцеления', elem: 'holy', cost: 26, cd: 12, atk: 0, mag: 0,
    desc: 'Восстанавливает 28% здоровья и снимает горение и яд.',
    glyph: [[5, 1, 5, 9], [2, 4, 8, 4]],
    run(g, c) {
      const p = g.player;
      const amount = Math.round(p.maxHp * 0.28 * c.power + p.magicPower * 0.6);
      p.heal(amount);
      p.effects.burn = 0; p.effects.poison = 0;
      g.floats.add(p.x, p.y - 34, '+' + amount, { color: '#8ff0b0', size: 12, bold: true });
      g.particles.burst(p.x, p.y - 12, 26, { color: '#ffd66a', color2: '#fff6c8', speed: 44, life: 0.8, size: 2, glow: 8, vz: 40, g: 60 });
      audio.play('level', 0.6);
    },
  },
  barrier: {
    name: 'Барьер', elem: 'holy', cost: 24, cd: 14, atk: 0, mag: 0,
    desc: 'Щит поглощает урон, равный 25% здоровья, в течение 10 сек.',
    glyph: [[5, 1, 1, 3], [1, 3, 5, 9], [5, 9, 9, 3], [9, 3, 5, 1]],
    run(g, c) {
      const p = g.player;
      p.shield = Math.round(p.maxHp * 0.25 * c.power + p.magicPower * 0.8);
      p.shieldMax = p.shield;
      p.shieldT = 10;
      g.toast('Барьер: ' + p.shield, '#ffd66a', 1.6);
      g.particles.burst(p.x, p.y - 12, 22, { color: '#ffd66a', speed: 40, life: 0.7, size: 2, glow: 7 });
      audio.play('cast', 0.8);
    },
  },
};

/** Пассивные руны — читаются геттерами героя и правилами боя. */
export const PASSIVES = {
  thorns:    { name: 'Шипы',            desc: 'Отражает {v}% урона, полученного в ближнем бою.', v: 26, glyph: [[5, 1, 5, 9], [2, 3, 8, 7], [8, 3, 2, 7]], elem: 'phys' },
  momentum:  { name: 'Разгон',          desc: 'После убийства +{v}% скорости на 3 сек.',        v: 20, glyph: [[1, 7, 5, 3], [5, 3, 9, 7], [3, 9, 7, 9]], elem: 'phys' },
  bloodlust: { name: 'Жажда крови',     desc: 'Ниже 40% здоровья: +{v}% вампиризма.',           v: 9,  glyph: [[5, 1, 8, 6], [8, 6, 5, 9], [5, 9, 2, 6], [2, 6, 5, 1]], elem: 'fire' },
  focus:     { name: 'Сосредоточение',  desc: 'Откат умений короче на {v}%.',                   v: 22, glyph: [[5, 2, 5, 8], [3, 5, 7, 5], [1, 1, 3, 3], [9, 9, 7, 7]], elem: 'arcane' },
  berserk:   { name: 'Берсерк',         desc: 'До +{v}% урона тем сильнее, чем меньше здоровья.',v: 40, glyph: [[2, 9, 5, 1], [5, 1, 8, 9], [3, 6, 7, 6]], elem: 'fire' },
  guardian:  { name: 'Страж',           desc: 'Урон в ближнем бою по тебе слабее на {v}%.',      v: 20, glyph: [[5, 1, 2, 3], [2, 3, 5, 9], [5, 9, 8, 3], [8, 3, 5, 1], [4, 5, 6, 5]], elem: 'holy' },
  swift:     { name: 'Проворство',      desc: 'Откат рывка короче на {v}%.',                     v: 38, glyph: [[1, 5, 6, 5], [4, 2, 7, 5], [4, 8, 7, 5], [8, 3, 9, 7]], elem: 'ice' },
  arcaneFlow:{ name: 'Поток арканы',    desc: 'Каждое убийство возвращает {v} маны.',            v: 7,  glyph: [[3, 2, 7, 2], [7, 2, 3, 8], [3, 8, 7, 8], [5, 4, 5, 6]], elem: 'arcane' },

  // ── читают состояние цели: с ними сбор снаряжения превращается в сборку билда
  pyromancy: { name: 'Пирокинез',       desc: 'По горящим целям урон выше на {v}%.',             v: 35, glyph: [[5, 9, 3, 5], [3, 5, 5, 6], [5, 6, 7, 4], [7, 4, 5, 1], [4, 7, 6, 7]], elem: 'fire', mark: 'burn' },
  cryomancy: { name: 'Ледяное сердце',  desc: 'По обмороженным шанс крита выше на {v}%.',        v: 25, glyph: [[5, 1, 5, 9], [1, 3, 9, 7], [9, 3, 1, 7], [5, 4, 5, 6]], elem: 'ice', mark: 'slow' },
  toxicology:{ name: 'Токсиколог',      desc: 'Твой яд и разъедание тикают на {v}% чаще.',       v: 80, glyph: [[3, 2, 7, 2], [4, 2, 4, 6], [6, 2, 6, 6], [3, 6, 7, 6], [5, 6, 5, 9]], elem: 'poison', mark: 'poison' },
  catalyst:  { name: 'Катализатор',     desc: 'Реакции стихий сильнее на {v}%.',                 v: 60, glyph: [[2, 8, 5, 2], [8, 8, 5, 2], [2, 8, 8, 8], [4, 5, 6, 5]], elem: 'arcane', reaction: true },
  resonance: { name: 'Резонанс',        desc: 'Каждая реакция срезает {v} десятых секунды с откатов.', v: 12, glyph: [[1, 5, 3, 3], [3, 3, 5, 5], [5, 5, 7, 3], [7, 3, 9, 5], [3, 7, 7, 7]], elem: 'arcane', reaction: true },
};

export const ACTIVE_KEYS = Object.keys(SKILLS);
export const PASSIVE_KEYS = Object.keys(PASSIVES);

/** Итоговый урон умения с учётом ранга руны. */
export function skillDamage(player, key, power) {
  const s = SKILLS[key];
  if (!s) return 0;
  return (player.attack * s.atk + player.magicPower * s.mag) * power;
}

export function skillDesc(key, power) {
  const s = SKILLS[key] || PASSIVES[key];
  if (!s) return '';
  if (PASSIVES[key]) return s.desc.replace('{v}', Math.round(s.v * power));
  return s.desc;
}
