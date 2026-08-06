// Легендарные свойства и комплекты. Легендарка теперь отличается от редкой
// не числом, а срабатыванием, которое меняет то, как ты играешь.

import { TAU, dist, angle } from '../core/util.js';
import { audio } from '../core/audio.js';

/**
 * Уникальные свойства. hook — когда срабатывает:
 * hit / kill / dash / hurt / skill. hook: null — свойство не срабатывает само,
 * его проверяют по месту (раскол, проводимость).
 */
export const UNIQUES = {
  thunder: {
    kinds: ['weapon'], hook: 'hit', name: 'Громобой',
    desc: 'Каждый третий удар бьёт цепной молнией по трём целям.',
    run(g, ctx) {
      const p = g.player;
      p._thunder = (p._thunder || 0) + 1;
      if (p._thunder < 3) return;
      p._thunder = 0;
      let from = { x: p.x, y: p.y - 12 };
      const hit = new Set([ctx.enemy]);
      let dmg = p.attack * 0.9;
      g.bolt(from.x, from.y, ctx.enemy.x, ctx.enemy.y - ctx.enemy.r * 0.6, '#b8d8ff');
      g.damageEnemy(ctx.enemy, dmg, { heavy: true, color: '#b8d8ff' });
      from = { x: ctx.enemy.x, y: ctx.enemy.y - ctx.enemy.r * 0.6 };
      for (let i = 0; i < 2; i++) {
        const t = g.nearestEnemy(from.x, from.y, 92, hit);
        if (!t) break;
        hit.add(t);
        dmg *= 0.7;
        g.bolt(from.x, from.y, t.x, t.y - t.r * 0.6, '#b8d8ff');
        g.damageEnemy(t, dmg, { heavy: true });
        from = { x: t.x, y: t.y - t.r * 0.6 };
      }
      audio.play('bolt', 0.7);
    },
  },
  devour: {
    kinds: ['weapon'], hook: 'kill', name: 'Пожиратель',
    desc: 'Каждое убийство восстанавливает 5% здоровья.',
    run(g) {
      const p = g.player;
      const heal = Math.round(p.maxHp * 0.05);
      p.heal(heal);
      g.floats.add(p.x, p.y - 32, '+' + heal, { color: '#6fdc8c', size: 9 });
    },
  },
  shatter: {
    kinds: ['weapon'], hook: 'hit', name: 'Раскалыватель',
    desc: 'Критический удар выпускает четыре осколка.',
    run(g, ctx) {
      if (!ctx.crit) return;
      const p = g.player;
      for (let i = 0; i < 4; i++) {
        g.spawnBolt(p.facing + (i - 1.5) * 0.7, p.attack * 0.45, {
          color: '#dfe9ff', color2: '#ffffff', size: 2, glow: 6, speed: 230, life: 0.7,
        });
      }
    },
  },
  emberTrail: {
    kinds: ['armor'], hook: 'dash', name: 'Пепельный шаг',
    desc: 'Рывок оставляет за собой горящий след.',
    run(g) {
      const p = g.player;
      g.hazards.push({
        x: p.x, y: p.y, r: 17, life: 3.4, dps: p.attack * 0.35,
        effect: ['burn', 3, p.attack * 0.12], color: '#ff6a1a', color2: '#ffd66a', tick: 0,
      });
    },
  },
  frostHeart: {
    kinds: ['armor'], hook: 'hurt', name: 'Ледяное сердце',
    desc: 'Получив урон, раз в 6 сек бьёт ледяной волной вокруг.',
    run(g) {
      const p = g.player;
      if ((p._frostCd || 0) > g.time) return;
      p._frostCd = g.time + 6;
      g.shockwave(p.x, p.y, 58, 0, '#7fd8ff');
      g.aoeDamage(p.x, p.y - 6, 62, p.magicPower * 1.2, { effect: ['slow', 3.5, 1], knock: 70 });
    },
  },
  bulwark: {
    kinds: ['armor'], hook: 'passive', name: 'Оплот',
    desc: 'Раз в 9 сек первый удар по тебе поглощается полностью.',
  },
  stormCrown: {
    kinds: ['helm'], hook: 'passive', name: 'Венец бури',
    desc: 'Умения на 30% сильнее, но стоят на 25% больше маны.',
  },
  focusEye: {
    kinds: ['helm'], hook: 'passive', name: 'Око сосредоточения',
    desc: 'Раз в 7 сек следующий удар — гарантированный крит двойной силы.',
  },
  echoRing: {
    kinds: ['trinket'], hook: 'passive', name: 'Кольцо эха',
    desc: '22% шанс, что умение не уйдёт в откат.',
  },
  reaper: {
    kinds: ['trinket'], hook: 'kill', name: 'Печать жнеца',
    desc: 'Каждый восьмой убитый враг взрывается.',
    run(g, ctx) {
      const p = g.player;
      p._reaper = (p._reaper || 0) + 1;
      if (p._reaper < 8) return;
      p._reaper = 0;
      const e = ctx.enemy;
      g.shockwave(e.x, e.y, 62, 0, '#c05fd0');
      g.aoeDamage(e.x, e.y, 66, p.attack * 2.2, { heavy: true, knock: 150 });
      g.particles.burst(e.x, e.y - 8, 30, { color: '#c05fd0', color2: '#ffb0ff', speed: 130, life: 0.7, size: 3, glow: 10 });
      audio.play('boss', 0.5);
    },
  },

  // ── завязаны на метки и реакции: с ними стихийная связка становится билдом
  frostbrand: {
    kinds: ['weapon'], hook: 'hit', name: 'Клеймо стужи',
    desc: 'Каждый удар вешает обморожение — раскол и пар доступны без рун.',
    run(g, ctx) {
      ctx.enemy.applyEffect('slow', 2.2, 1, g);
    },
  },
  emberPlague: {
    kinds: ['armor'], hook: 'kill', name: 'Пепельный мор',
    desc: 'Смерть горящего врага поджигает всех рядом.',
    run(g, ctx) {
      const e = ctx.enemy;
      if ((e.effects.burn || 0) <= 0 && (e.effects.corrode || 0) <= 0) return;
      const pw = Math.max(2, g.player.magicPower * 0.22);
      let n = 0;
      for (const o of g.enemies) {
        if (o.dead || o === e || dist(o.x, o.y, e.x, e.y) > 62) continue;
        o.applyEffect('burn', 3.5, pw, g);
        n++;
      }
      if (!n) return;
      g.particles.burst(e.x, e.y - 8, 26, { color: '#ff6a1a', color2: '#ffd66a', speed: 130, life: 0.6, size: 2, glow: 10 });
      audio.play('cast', 0.7);
    },
  },
  iceBreaker: {
    kinds: ['weapon'], hook: null, name: 'Ледолом',
    desc: 'Раскол по обмороженной цели бьёт вдвое сильнее.',
  },
  lightningRod: {
    kinds: ['trinket'], hook: null, name: 'Громоотвод',
    desc: 'Проводимость цепляет на три цели больше.',
  },

  // ── добыча Бездны: abyss — свойство не встречается нигде, кроме глубины.
  // Иначе спускаться было бы незачем: биом фармится безопаснее и быстрее.
  hollowHeart: {
    kinds: ['armor'], hook: null, abyss: true, name: 'Полое сердце',
    desc: 'Порча Бездны отнимает вдвое меньше здоровья.',
  },
  devourer: {
    kinds: ['weapon'], hook: 'kill', abyss: true, name: 'Ненасытный',
    desc: 'Каждое убийство прибавляет +2% урона до конца этажа.',
    run(g) {
      const p = g.player;
      p._devour = Math.min(60, (p._devour || 0) + 2);
      if (p._devour % 10 === 0) {
        g.floats.add(p.x, p.y - 34, '+' + p._devour + '%', { color: '#c05fd0', size: 10, bold: true });
      }
    },
  },
  abyssGaze: {
    kinds: ['helm'], hook: 'hurt', abyss: true, name: 'Взгляд Бездны',
    desc: 'Пропущенный удар с шансом 25% накладывает на бьющего все четыре метки.',
    run(g, ctx) {
      const e = ctx.src;   // хук «hurt» отдаёт того, кто ударил
      if (!e || e.dead || !e.effects || Math.random() > 0.25) return;
      const pw = Math.max(2, g.player.magicPower * 0.2);
      // метки вешаем без game: разом четыре реакции были бы кашей
      for (const k of ['burn', 'poison', 'slow', 'shock']) e.applyEffect(k, 4, pw);
      g.floats.add(e.x, e.y - e.r - 14, 'ВЗГЛЯД', { color: '#c05fd0', size: 10, bold: true });
      g.particles.burst(e.x, e.y - e.r * 0.6, 20, { color: '#c05fd0', color2: '#ffb0ff', speed: 110, life: 0.6, size: 2, glow: 10 });
    },
  },

  // ── Пролом.
  //
  // Отдельный пул по образцу Бездны: эти свойства отвечают тому, чем Пролом
  // неудобен. Там щиты, уклонение и земля, которая отнимает здоровье долей от
  // максимума. Легендарка биома должна давать ответ на его собственный вопрос,
  // а не просто быть «ещё +урон»: иначе она не про место, а про число.
  riftStep: {
    kinds: ['armor'], hook: 'dash', breach: true, name: 'Шаг сквозь',
    desc: 'Рывок оставляет разлом: враги рядом получают урон и замедляются.',
    run(g) {
      const p = g.player;
      const dmg = Math.max(6, Math.round(p.attack * 0.85));
      g.hazards.push({
        x: p.x, y: p.y, r: 30, dps: dmg, life: 2.6, tick: 0,
        color: '#a882e0', color2: '#e2d0ff', cloud: true,
        effect: ['slow', 1.6, Math.max(1, p.magicPower * 0.2)],
      });
      g.particles.burst(p.x, p.y - 8, 16, { color: '#a882e0', color2: '#e2d0ff', speed: 90, life: 0.5, size: 2, glow: 9 });
      audio.play('acid', 0.6);
    },
  },
  shieldbreaker: {
    kinds: ['weapon'], hook: 'hit', breach: true, name: 'Створ',
    desc: 'Три удара подряд по одному врагу ломают его щит на 4 секунды.',
    run(g, ctx) {
      const p = g.player, e = ctx.enemy;
      if (!e || e.dead) return;
      // счёт ведём по цели: три удара по разным врагам — это не вскрытие
      if (p._creakOn !== e) { p._creakOn = e; p._creak = 0; }
      p._creak = (p._creak || 0) + 1;
      if (p._creak < 3) return;
      p._creak = 0;
      if (!e.def || !e.def.shield) return;
      e.shieldBroken = Math.max(e.shieldBroken || 0, 4);
      g.floats.add(e.x, e.y - e.r - 14, 'СТВОР', { color: '#d6b6ff', size: 10, bold: true });
      g.particles.burst(e.x, e.y - e.r * 0.6, 18, { color: '#d6b6ff', color2: '#ffffff', speed: 120, life: 0.5, size: 2, glow: 10 });
      audio.play('shatterItem', 0.6);
    },
  },
  voidSkin: {
    kinds: ['armor'], hook: null, breach: true, name: 'Пустотная кожа',
    desc: 'Выбросы пустоты не жгут: урон от опасностей местности вдвое меньше.',
  },
  trueSight: {
    kinds: ['helm'], hook: 'hit', breach: true, name: 'Верный глаз',
    desc: 'Уклонение врага не работает против вас чаще, чем раз в две секунды.',
    run(g, ctx) {
      const p = g.player, e = ctx.enemy;
      if (!e || e.dead) return;
      if ((p._sightCd || 0) > g.time) return;
      p._sightCd = g.time + 2;
      e.noDodge = Math.max(e.noDodge || 0, 2.2);
    },
  },
  heartOfBreach: {
    kinds: ['trinket'], hook: 'kill', breach: true, name: 'Осколок Сердца',
    desc: 'Каждое убийство в Проломе гасит ближайший выброс пустоты на 6 секунд.',
    run(g) {
      const p = g.player;
      let best = null, bd = 1e9;
      for (const h of g.hazards) {
        if (!h.hostile || (h.calm || 0) > g.time) continue;
        const d = Math.hypot(h.x - p.x, h.y - p.y);
        if (d < bd) { bd = d; best = h; }
      }
      if (!best || bd > 260) return;
      best.calm = g.time + 6;
      g.floats.add(best.x, best.y - 10, 'ТИХО', { color: '#d6b6ff', size: 9, bold: true });
    },
  },
};

export const UNIQUE_KEYS = Object.keys(UNIQUES);

/** Обычный пул: свойства Бездны и Пролома сюда не попадают. */
export function uniquesFor(kind) {
  return UNIQUE_KEYS.filter((k) => UNIQUES[k].kinds.includes(kind) && !UNIQUES[k].abyss && !UNIQUES[k].breach);
}

/** Пул Пролома — только с его обитателей. */
export function breachUniquesFor(kind) {
  return UNIQUE_KEYS.filter((k) => UNIQUES[k].kinds.includes(kind) && UNIQUES[k].breach);
}

/** Пул Бездны — только для добычи с испорченных этажей. */
export function abyssUniquesFor(kind) {
  return UNIQUE_KEYS.filter((k) => UNIQUES[k].kinds.includes(kind) && UNIQUES[k].abyss);
}

// ─────────────────────────────────────────── комплекты

export const SETS = {
  guardian: {
    name: 'Страж Велории',
    two: { label: '+16 защиты', stats: { def: 16 } },
    four: { label: '−18% получаемого урона', dmgTakenMul: 0.82 },
  },
  arcanist: {
    name: 'Облачение Арканиста',
    two: { label: '+45 маны', stats: { mp: 45 } },
    four: { label: '−20% отката умений', cdMul: 0.8 },
  },
  hunter: {
    name: 'Снаряжение Ловчего',
    two: { label: '+8% крит. шанса', stats: { crit: 8 } },
    four: { label: '+12% скорости, +30% крит. урона', spdMul: 1.12, stats4: { cdmg: 30 } },
  },
  dragon: {
    name: 'Драконья кладка',
    two: { label: '+20 урона', stats: { atk: 20 } },
    four: { label: '+9% вампиризма', lifesteal: 9 },
  },
};

export const SET_KEYS = Object.keys(SETS);
export const SET_SLOTS = ['armor', 'helm', 'ring', 'amulet'];

/** Сколько частей каждого комплекта надето и что это даёт. */
export function setBonuses(equipment) {
  const count = {};
  for (const s of SET_SLOTS) {
    const it = equipment[s];
    if (it && it.set) count[it.set] = (count[it.set] || 0) + 1;
  }
  const res = { stats: {}, dmgTakenMul: 1, cdMul: 1, spdMul: 1, lifesteal: 0, active: [] };
  for (const key in count) {
    const n = count[key], def = SETS[key];
    if (!def) continue;
    res.active.push({ key, name: def.name, count: n });
    if (n >= 2) for (const k in def.two.stats) res.stats[k] = (res.stats[k] || 0) + def.two.stats[k];
    if (n >= 4) {
      const f = def.four;
      if (f.dmgTakenMul) res.dmgTakenMul *= f.dmgTakenMul;
      if (f.cdMul) res.cdMul *= f.cdMul;
      if (f.spdMul) res.spdMul *= f.spdMul;
      if (f.lifesteal) res.lifesteal += f.lifesteal;
      for (const k in f.stats4 || {}) res.stats[k] = (res.stats[k] || 0) + f.stats4[k];
    }
  }
  return res;
}
