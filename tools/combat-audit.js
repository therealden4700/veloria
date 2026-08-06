// Аудит боя: жизнеспособны ли оружие, умения и реакции.
//
//   node tools/combat-audit.js
//
// Аудиты зон и содержимого отвечали на вопросы «куда можно дойти» и «есть ли до
// чего доходить». Этот отвечает на третий, самый важный: **как играется то, чем
// игрок занят всё время**. Про бой мы до сих пор не знали ничего числами.
//
// Проверяется:
//   1. время убийства по уровням — не с одного удара и не за минуту;
//   2. все ли шесть типов оружия жизнеспособны;
//   3. окупаются ли стихийные метки и реакции;
//   4. не делает ли щит или броня кого-то практически неуязвимым;
//   5. переживает ли герой размен ударами со своим ровесником.
//
// ── Чем это меряет
//
// Настоящим кодом игры, а не его пересказом: `resolveHit` (то самое правило,
// вынесенное из `damageEnemy`), `swingHits`, геттеры героя, `scaleStats` врага,
// `Player.takeDamage`. Ни одна формула здесь не повторена.
//
// Что всё-таки смоделировано и почему — сказано на месте. Число, полученное
// моделью, помечено в отчёте словом «оценка».

import { installHeadless } from '../src/core/headless.js';

installHeadless();

const { initProps } = await import('../src/art/props.js');
const { bakeAllMonsters } = await import('../src/art/sprites.js');
const { Player } = await import('../src/entities/player.js');
const { Enemy, ENEMIES } = await import('../src/entities/enemies.js');
const { swingHits, resolveHit } = await import('../src/systems/combat.js');
const { markDamageMult } = await import('../src/systems/reactions.js');
const { makeItem } = await import('../src/systems/items.js');
const { BIOMES, OVERWORLD } = await import('../src/world/biomes.js');
const { makeRng } = await import('../src/core/rng.js');
const { angle } = await import('../src/core/util.js');
const { WEAPON_SUBS } = await import('../src/systems/craft.js');

initProps();
bakeAllMonsters();

const problems = [];
const note = (kind, what) => problems.push({ kind, what });
const fmt = (v, n = 1) => (Math.round(v * 10 ** n) / 10 ** n).toFixed(n).replace('.', ',');

// ─────────────────────────────────────────── герой-эталон

/**
 * Герой такой, каким он приходит на этот уровень: ранг вещей по той же формуле,
 * что и в `makeItem` (`(level-1)/5`), редкость — «редкая» как типичный середняк,
 * очки характеристик разложены поровну. Это допущение, и оно одно на весь аудит:
 * сравнения между оружием и умениями от него не зависят, зависит только
 * абсолютное время убийства.
 */
/**
 * Герой для стенда. `build` — во что вложены очки характеристик:
 * null — поровну (так меряется всё, что не про сборки), 'str' — в силу,
 * 'int' — в разум. Игрок распределяет их не поровну, и сравнивать пути
 * «сила» и «разум» на ровной раскладке бессмысленно: она не встречается.
 */
function hero(level, sub = 'sword', seed = 4242, build = null) {
  const rng = makeRng(seed);
  const p = new Player(0, 0);
  p.level = level;
  const tier = Math.max(0, Math.min(6, Math.floor((level - 1) / 5)));
  p.equipment.weapon = makeItem({ kind: 'weapon', sub, tier, rarity: 'rare', level, rng });
  p.equipment.armor = makeItem({ kind: 'armor', tier, rarity: 'rare', level, rng });
  p.equipment.helm = makeItem({ kind: 'helm', tier, rarity: 'uncommon', level, rng });
  // очки характеристик: игра даёт их по уровню
  const pts = Math.max(0, (level - 1) * 3);
  if (build === 'str' || build === 'int') {
    const главная = Math.round(pts * 0.5), прочее = Math.round(pts * 0.25);
    p.vit += прочее; p.agi += pts - главная - прочее;
    if (build === 'str') p.str += главная; else p.int += главная;
  } else {
    const each = Math.floor(pts / 4);
    p.str += each; p.agi += each; p.vit += each; p.int += pts - each * 3;
  }
  p.hp = p.maxHp; p.mp = p.maxMp;
  return p;
}

/** Мир-пустышка: бою нужен только тот, кто держит время и гасит зрелище. */
const NOOP = () => {};
function stand() {
  const w = {
    time: 0,
    zone: { mod: {} },
    floats: { add: NOOP }, particles: { burst: NOOP, spawn: NOOP, add: NOOP, clear: NOOP },
    shake: { add: NOOP }, slashes: [], enemies: [], projectiles: [],
    toast: NOOP, proc: NOOP, hud: { toast: NOOP, showBanner: NOOP, showLesson: NOOP },
    quests: { onKill: NOOP, onEliteKill: NOOP }, onPlayerDeath: NOOP, onLevelUp: NOOP,
    dropLoot: NOOP, spawnLoot: NOOP, killEnemy: NOOP, save: NOOP,
  };
  return w;
}

// ─────────────────────────────────────────── 1. время убийства

/**
 * Сколько секунд герой бьёт эту цель обычными ударами.
 *
 * Смоделирован здесь только **темп**: удары идут ровно через `attackRate`
 * (настоящий геттер), связка крутится 0-1-2 (как в `Player.attack`), герой стоит
 * в упор и всегда попадает. Живой игрок промахивается и отходит, поэтому число
 * — нижняя граница, «идеальный размен». Всё остальное — настоящее.
 */
function timeToKill(p, e, rng, maxSec = 300) {
  const dt = 1 / 60;
  let t = 0, combo = 0, cd = 0, swings = 0, dodged = 0, blocked = 0, dealt = 0;
  // Цель стоит вплотную и лицом к герою — худший случай для щитоносца.
  //
  // Герой при этом обязан на неё СМОТРЕТЬ. Первый прогон об это и споткнулся:
  // `facing` у свежего героя равен π/2 (взгляд вниз), а цель я ставил справа —
  // дуга взмаха её не захватывала. У мелких врагов попадал только третий удар
  // связки (у него разброс шире), у крупных — ни один, и стенд отрапортовал
  // «> 300 с» на половине игры. Числа были про мою ошибку, а не про игру.
  e.x = p.x + 18; e.y = p.y; e.face = Math.PI;
  p.facing = angle(p.x, p.y - 11, e.x, e.y - e.r * 0.6);
  while (e.hp > 0 && t < maxSec) {
    t += dt; cd -= dt;
    if (cd <= 0) {
      cd = p.attackRate;
      combo = (combo + 1) % 3;
      swings++;
      for (const h of swingHits(p, [e], { combo, time: t, rng })) {
        const hit = resolveHit(p, h.enemy, h.dmg, { heavy: h.heavy, from: p }, rng, markDamageMult);
        if (hit.dodged) { dodged++; continue; }
        if (hit.blocked) blocked++;
        h.enemy.hp -= hit.dmg; dealt += hit.dmg;
      }
    }
  }
  return { sec: t, swings, dodged, blocked, dealt, killed: e.hp <= 0 };
}

/** Рядовой, элита и босс биома на уровне, на котором туда приходят. */
const CASES = [];
for (const id of OVERWORLD) {
  const b = BIOMES[id];
  const lvl = b.unlockLevel || 1;
  const trash = b.enemies[0][0];
  CASES.push({ биом: b.name, ур: lvl, кто: 'рядовой', key: trash });
  if (b.elite) CASES.push({ биом: b.name, ур: lvl + 2, кто: 'элита', key: b.elite });
  if (b.boss) CASES.push({ биом: b.name, ур: (b.levelRange ? b.levelRange[1] : lvl + 5), кто: 'босс', key: b.boss });
}

console.log('── 1. Время убийства (идеальный размен, обычные удары)\n');
const ttkRows = [];
for (const c of CASES) {
  const rng = makeRng(777);
  const p = hero(c.ур);
  const e = new Enemy(c.key, c.ур, 0, 0);
  const r = timeToKill(p, e, rng);
  ttkRows.push({ ...c, ...r, hp: e.maxHp });
  const s = r.killed ? fmt(r.sec) + ' с' : '> 300 с';
  console.log(`  ${c.биом.padEnd(18)} ур.${String(c.ур).padStart(2)}  ${c.кто.padEnd(8)} ${ENEMIES[c.key].name.padEnd(22)} ${s.padStart(8)}  ударов ${r.swings}`);

  // Порог снизу — только для рядовых, и не для первого биома: слизень на первом
  // уровне обязан умирать быстро, это первое убийство в игре, и пять взмахов
  // здесь читались бы залипанием, а не боем. Порог сверху — чтобы рядовой не
  // превращался в губку. Боссам нижний порог не ставим вовсе: правильная
  // проверка для них не «дольше N секунд», а «каждый следующий дольше
  // предыдущего», и она идёт ниже.
  const первыйБиом = c.биом === BIOMES[OVERWORLD[0]].name;
  if (!r.killed) note('цель не убивается вовсе', `${c.биом}, ${ENEMIES[c.key].name} на ур.${c.ур}`);
  else if (c.кто === 'рядовой' && !первыйБиом && r.sec < 0.8) note('умирает слишком быстро', `${c.биом}, рядовой ${ENEMIES[c.key].name}: ${fmt(r.sec)} с`);
  else if (c.кто === 'рядовой' && r.sec > 14) note('убивается слишком долго', `${c.биом}, рядовой ${ENEMIES[c.key].name}: ${fmt(r.sec)} с`);
  else if (c.кто === 'босс' && r.sec > 120) note('убивается слишком долго', `${c.биом}, босс ${ENEMIES[c.key].name}: ${fmt(r.sec)} с`);
}

// Боссы: важно не абсолютное время, а что бой растёт от биома к биому. Первый
// босс обязан быть короче последнего — иначе кривая сложности сломана.
{
  const bosses = ttkRows.filter((x) => x.кто === 'босс');
  for (let i = 1; i < bosses.length; i++) {
    if (bosses[i].sec <= bosses[i - 1].sec) {
      note('бой с боссом не растёт', `${bosses[i].биом} ${fmt(bosses[i].sec)} с не длиннее, чем ${bosses[i - 1].биом} ${fmt(bosses[i - 1].sec)} с`);
    }
  }
}

// Элиту абсолютным порогом мерить нельзя: она бывает и хрупким колдуном, и
// тушей. Смысл у слова «элита» один — она должна быть заметно крепче рядового
// СВОЕГО биома. Это и проверяем, сравнением, а не числом с потолка.
for (const c of CASES.filter((x) => x.кто === 'элита')) {
  const trash = ttkRows.find((x) => x.биом === c.биом && x.кто === 'рядовой');
  const el = ttkRows.find((x) => x.биом === c.биом && x.кто === 'элита');
  if (!trash || !el) continue;
  const ratio = el.sec / trash.sec;
  if (ratio < 1.5) {
    note('элита не крепче рядового', `${c.биом}: ${ENEMIES[el.key].name} ${fmt(el.sec)} с против ${ENEMIES[trash.key].name} ${fmt(trash.sec)} с — ×${fmt(ratio, 2)}`);
  }
}

// ─────────────────────────────────────────── 2. оружие

console.log('\n── 2. Шесть типов оружия по одной цели\n');
const WLEVEL = 20;
const WTARGET = 'cinderKnight';        // крепкий рядовой: видно и урон, и темп
for (const lvlCase of [8, 20, 34]) {
  const row = [];
  for (const w of WEAPON_SUBS) {
    const rng = makeRng(1313);
    const p = hero(lvlCase, w.id);
    const e = new Enemy(WTARGET, lvlCase, 0, 0);
    const r = timeToKill(p, e, rng);
    row.push({ id: w.id, name: w.name, sec: r.sec, swings: r.swings, killed: r.killed });
  }
  const best = Math.min(...row.map((x) => x.sec));
  const worst = Math.max(...row.map((x) => x.sec));
  console.log(`  уровень ${lvlCase}:`);
  for (const x of row.sort((a, b) => a.sec - b.sec)) {
    console.log(`      ${x.name.padEnd(8)} ${fmt(x.sec).padStart(6)} с   ударов ${String(x.swings).padStart(3)}   ×${fmt(x.sec / best, 2)}`);
  }
  // Лук и посох здесь заведомо в проигрыше: они бьют издалека, а стенд ставит
  // всех вплотную. Безопасность в секундах не мерится, поэтому разрыв ищем
  // только среди ближнего боя — там сравнение честное.
  const melee = row.filter((x) => x.id !== 'bow' && x.id !== 'staff');
  const mBest = Math.min(...melee.map((x) => x.sec)), mWorst = Math.max(...melee.map((x) => x.sec));
  if (mWorst / mBest > 1.6) {
    const slow = melee.reduce((a, b) => (a.sec > b.sec ? a : b));
    const fast = melee.reduce((a, b) => (a.sec < b.sec ? a : b));
    note('разрыв в ближнем бою', `ур.${lvlCase}: ${fast.name} ${fmt(fast.sec)} с против ${slow.name} ${fmt(slow.sec)} с — ×${fmt(mWorst / mBest, 2)}`);
  }
}

// ─────────────────────────────────────────── 3. метки и реакции

console.log('\n── 3. Что дают метки\n');
{
  const p = hero(20);
  const rng = makeRng(99);
  const base = new Enemy('goblin', 20, 0, 0);
  const raw = 100;
  const plain = resolveHit(p, base, raw, { from: p }, () => 0.99, markDamageMult).dmg;
  const marks = ['shock', 'corrode', 'burn', 'slow', 'poison'];
  for (const m of marks) {
    const e = new Enemy('goblin', 20, 0, 0);
    e.effects[m] = 3;
    const with_ = resolveHit(p, e, raw, { from: p }, () => 0.99, markDamageMult).dmg;
    const gain = (with_ / plain - 1) * 100;
    console.log(`      ${m.padEnd(9)} ${with_ === plain ? 'ничего' : '+' + fmt(gain) + '%'}`);
  }
  console.log(`      (без меток удар в ${raw} проходит как ${plain})`);
  console.log('      Здесь меряется только множитель к прямому урону. Ожог и яд');
  console.log('      жгут отдельно и со временем, обморожение — это контроль;');
  console.log('      «ничего» у них означает «не усиливает удар», а не «бесполезно».');
}

// ─────────────────────────────────────────── 4. щит, броня, уклонение

console.log('\n── 4. Сколько снимают щит, броня и уклонение\n');
{
  const p = hero(20);
  const seen = new Set();
  for (const [key, def] of Object.entries(ENEMIES)) {
    if (!def.shield && !def.armor && !def.dodge) continue;
    const e = new Enemy(key, 20, 0, 0);
    e.x = p.x + 18; e.y = p.y; e.face = Math.PI;         // лицом к бьющему
    const raw = 100;
    const light = resolveHit(p, e, raw, { from: p }, () => 0.99, markDamageMult).dmg;
    const heavy = resolveHit(p, e, raw, { from: p, heavy: true }, () => 0.99, markDamageMult).dmg;
    e.face = 0;                                          // спиной
    const back = resolveHit(p, e, raw, { from: p }, () => 0.99, markDamageMult).dmg;
    const dodge = e.dodge || 0;
    const k = def.name;
    if (seen.has(k)) continue;
    seen.add(k);
    // Одиночный лёгкий удар — нечестная мерка: третий удар связки тяжёлый, и
    // игрок бьёт им постоянно, не выбирая. Считаем цикл 2 лёгких + 1 тяжёлый —
    // это то, что происходит на самом деле.
    const cycle = (light * 2 + heavy) / 3;
    const share = cycle / 100 * (1 - dodge);
    console.log(`      ${def.name.padEnd(22)} лёгким ${String(light).padStart(3)}  тяжёлым ${String(heavy).padStart(3)}  в спину ${String(back).padStart(3)}  уклон ${fmt(dodge * 100, 0)}%  →  за связку ${fmt(share * 100, 0)}%`);
    // Практическая неуязвимость: даже со связкой в лоб проходит меньше четверти.
    if (share < 0.25) note('в лоб почти непробиваем даже связкой', `${def.name}: доходит ${fmt(share * 100, 0)}% урона`);
    if (dodge > 0.4) note('слишком высокое уклонение', `${def.name}: ${fmt(dodge * 100, 0)}%`);
  }
}

// ─────────────────────────────────────────── 5. переживает ли герой размен

console.log('\n── 5. Размен ударами со своим ровесником\n');
{
  // Урон врага по герою идёт через настоящий `Player.takeDamage`; смоделирован
  // только темп — враг бьёт ровно через свой `atkCd` и всегда попадает.
  for (const id of OVERWORLD) {
    const b = BIOMES[id];
    const lvl = b.unlockLevel || 1;
    const key = b.enemies[0][0];
    const p = hero(lvl);
    const w = stand();
    const e = new Enemy(key, lvl, 0, 0);
    const dt = 1 / 60;
    let t = 0, cd = 0, hits = 0;
    const hp0 = p.maxHp;
    while (t < 60 && p.hp > 0) {
      t += dt; cd -= dt; w.time = t;
      if (cd <= 0) { cd = e.def.atkCd; hits++; p.takeDamage(e.damage, w, e, { melee: true }); p.iframe = 0; }
    }
    const perHit = (hp0 - Math.max(0, p.hp)) / Math.max(1, hits);
    const hitsToDie = hp0 / Math.max(1, perHit);
    console.log(`      ${b.name.padEnd(18)} ур.${String(lvl).padStart(2)}  ${ENEMIES[key].name.padEnd(16)} по ${fmt(perHit)} за удар  →  ${fmt(hitsToDie)} ударов до смерти`);
    if (hitsToDie < 4) note('герой умирает слишком быстро', `${b.name}: ${ENEMIES[key].name} убивает за ${fmt(hitsToDie)} ударов`);
    if (hitsToDie > 40) note('рядовой враг не опасен вовсе', `${b.name}: ${ENEMIES[key].name} убивает за ${fmt(hitsToDie)} ударов`);
  }
}


// ─────────────────────────────────────────── 6. умения

// Стенд гоняет настоящий `run()` каждого умения. Всё, что решает урон, взято из
// `systems/combat.js`: прицеливание (`aoeTargets`, `lineTargets`,
// `hazardTargets`), бросок крита (`skillRoll`), правило урона (`resolveHit`),
// снаряд (`boltSpec`) — и настоящий `Projectile.update`. Здесь остаётся только
// проводка: кто кого зовёт. Правил в ней нет.
//
// Смоделирован такт опасных зон (0,5 с) — он лежит в игровом цикле `Game`, а не
// в правиле; и то, что цели стоят и не разбегаются.

const { SKILLS, skillDamage } = await import('../src/systems/skills.js');
const { Projectile } = await import('../src/entities/enemies.js');
const { aoeTargets, lineTargets, hazardTargets, skillRoll, boltSpec } = await import('../src/systems/combat.js');
const { makeRune } = await import('../src/systems/items.js');

function skillStand(p, rng) {
  const w = {
    time: 0, player: p, enemies: [], projectiles: [], hazards: [], slashes: [], decals: [],
    zone: { mod: {}, pxW: 4000, pxH: 4000 },
    particles: { spawn: NOOP, burst: NOOP, add: NOOP, clear: NOOP },
    floats: { add: NOOP }, shake: { add: NOOP },
    dealt: 0, touched: new Set(),
    toast: NOOP, proc: NOOP, shockwave: NOOP, bolt: NOOP,
    hud: { toast: NOOP, showBanner: NOOP, showLesson: NOOP },
    canBeAt: () => true,
    solidAt: () => false,                 // стенд без стен: мерим умение, а не карту
    hasLineOfSight: () => true,
    moveEntity: NOOP,
    killEnemy(e) { e.dead = true; e.hp = 0; },
    nearestEnemy(x, y, r, skip) {
      let best = null, bd = r * r;
      for (const e of w.enemies) {
        if (e.dead || (skip && skip.has(e))) continue;
        const d = (e.x - x) ** 2 + (e.y - e.r * 0.5 - y) ** 2;
        if (d < bd) { bd = d; best = e; }
      }
      return best;
    },
    damageEnemy(e, amount, opts = {}) {
      if (!e || e.dead) return;
      const hit = resolveHit(p, e, amount, opts, rng, markDamageMult);
      if (hit.dodged) return;
      e.hp -= hit.dmg; w.dealt += hit.dmg; w.touched.add(e);
      if (e.hp <= 0) { e.dead = true; e.hp = 0; }
    },
    applySkillHit(e, dmg, opts, sx, sy) {
      const { crit, amount } = skillRoll(p, e, dmg, opts, rng);
      w.damageEnemy(e, amount, { crit, heavy: opts.heavy, knock: opts.knock, from: { x: sx, y: sy } });
      if (opts.effect) e.applyEffect(opts.effect[0], opts.effect[1], opts.effect[2], w);
      if (opts.stun) e.stun = Math.max(e.stun || 0, opts.stun * (e.boss ? 0.35 : 1));
    },
    aoeDamage(x, y, r, dmg, opts = {}) {
      const hit = aoeTargets(w.enemies, x, y, r);
      for (const e of hit) w.applySkillHit(e, dmg, opts, x, y);
      return hit.length;
    },
    lineDamage(x, y, ang, len, halfW, dmg, opts = {}) {
      for (const e of lineTargets(w.enemies, x, y, ang, len, halfW)) w.applySkillHit(e, dmg, opts, x, y);
    },
    spawnBolt(ang, dmg, o = {}) { w.projectiles.push(new Projectile(boltSpec(p, ang, dmg, o))); },
    /** Догнать время: снаряды летят, зоны тикают, эффекты жгут. */
    settle(seconds) {
      const dt = 1 / 60;
      for (let t = 0; t < seconds; t += dt) {
        w.time += dt;
        for (let i = w.projectiles.length - 1; i >= 0; i--) {
          const pr = w.projectiles[i];
          if (pr.update) pr.update(dt, w);
          if (pr.dead) w.projectiles.splice(i, 1);
        }
        for (let i = w.hazards.length - 1; i >= 0; i--) {
          const h = w.hazards[i];
          h.life -= dt;
          if (h.life <= 0) { w.hazards.splice(i, 1); continue; }
          h.tick -= dt;
          if (h.tick <= 0) {
            h.tick = 0.5;
            for (const e of hazardTargets(w.enemies, h)) {
              if (h.dps) w.damageEnemy(e, h.dps, { silent: true, dot: true });
              if (h.effect) e.applyEffect(h.effect[0], h.effect[1], h.effect[2], w);
            }
          }
        }
        for (const e of w.enemies) if (!e.dead && e.updateEffects) e.updateEffects(dt, w);
      }
    },
  };
  return w;
}

/** Одно применение умения по `count` целям: сколько урона суммарно прошло. */
function castOnce(key, level, count, rng, герой = null) {
  const p = герой || hero(level);
  p.facing = 0;
  const w = skillStand(p, rng);
  // цели — «мешки»: живучие, без брони и щита, чтобы мерить умение, а не их
  for (let i = 0; i < count; i++) {
    const e = new Enemy('slime', level, p.x + 24 + (i % 3) * 14, p.y + ((i / 3) | 0) * 12 - 6);
    e.hp = e.maxHp = 1e9;
    w.enemies.push(e);
  }
  const rune = makeRune(key, 'rare', 1);
  const def = SKILLS[key];
  const before = { hp: p.hp, shield: p.shield || 0 };
  def.run(w, { power: rune.power, dmg: skillDamage(p, key, rune.power), rune });
  // Контроль замеряем сразу после применения: `settle` его успеет израсходовать.
  let stun = 0; const marks = new Set();
  for (const e of w.enemies) {
    stun = Math.max(stun, e.stun || 0);
    for (const [k, v] of Object.entries(e.effects || {})) if (v > 0) marks.add(k);
  }
  w.settle(8);              // снаряды долетают, зоны догорают
  return {
    dmg: w.dealt, targets: w.touched.size, cost: rune.cost, cd: rune.cd,
    heal: Math.max(0, p.hp - before.hp), shield: (p.shield || 0) - before.shield,
    stun, marks: [...marks],
  };
}

console.log('\n── 6. Умения\n');
{
  const LEVEL = 20;
  const rows = [];
  for (const key of Object.keys(SKILLS)) {
    const rng = makeRng(31337);
    const one = castOnce(key, LEVEL, 1, rng);
    const five = castOnce(key, LEVEL, 5, makeRng(31337));
    rows.push({ key, name: SKILLS[key].name, ...one, five: five.dmg, fiveT: five.targets });
  }
  // Мера — обычная атака, но не как замена, а как фон: герой машет всё время, и
  // умение к этому машущему **добавляется**. Поэтому считаем вклад: сколько
  // умение даёт сверх того, что за его откат нанесли бы одними взмахами.
  //
  // И судим по лучшему случаю умения, а не по одиночной цели. Вихрь и раскол —
  // площадные: мерить их по одному врагу так же нечестно, как мерить обморожение
  // прибавкой к урону. Ровно эту ошибку я и сделал первым заходом.
  const base = hero(LEVEL);
  const basicDps = base.attack / base.attackRate;
  console.log(`      мера — обычная атака: ${fmt(basicDps)} урона в секунду.`);
  console.log('      «вклад» — сколько умение добавляет сверх взмахов за свой откат.\n');
  for (const r of rows.sort((a, b) => (b.five / b.cd) - (a.five / a.cd))) {
    const fon = basicDps * r.cd;
    if (r.dmg === 0 && r.five === 0) {
      const eff = r.heal ? `лечит ${Math.round(r.heal)}` : r.shield ? `щит ${Math.round(r.shield)}` : 'поддержка';
      console.log(`      ${r.name.padEnd(20)} ${eff.padEnd(16)} откат ${fmt(r.cd)} с, мана ${r.cost}`);
      continue;
    }
    const ctl = [];
    if (r.stun > 0) ctl.push(`оглушение ${fmt(r.stun)} с`);
    if (r.marks.length) ctl.push(r.marks.join('+'));
    console.log(`      ${r.name.padEnd(20)} вклад ${(fmt(r.dmg / fon * 100, 0) + '%').padStart(5)} по одной, ${(fmt(r.five / fon * 100, 0) + '%').padStart(5)} по пятерым (целей ${r.fiveT})${ctl.length ? '  · ' + ctl.join(', ') : ''}`);
  }

  // Порог — по лучшему случаю умения и с оглядкой на контроль. Умение, которое
  // и не бьёт, и ничего не делает с целью, — мёртвая кнопка. Умение, дающее
  // втрое больше, чем все взмахи за его откат, вытесняет остальные.
  for (const r of rows) {
    if (r.dmg === 0 && r.five === 0) continue;         // поддержка судится иначе
    const fon = basicDps * r.cd;
    const best = Math.max(r.dmg, r.five) / fon;
    const контроль = r.stun > 0 || r.marks.length > 0;
    // Умение с контролем нарочно меняет урон на оглушение или метку — низкий
    // вклад у него не поломка, а сделка. Придирка «держится только на контроле»
    // здесь стояла и была снята: она описывала замысел.
    if (best > 2.5) note('умение вытесняет остальные', `${r.name}: вклад ${fmt(best * 100, 0)}% за откат`);
    else if (best < 0.35 && !контроль) note('мёртвая кнопка', `${r.name}: вклад ${fmt(best * 100, 0)}%, контроля нет`);
  }
}

// ─────────────────────────────────────────── 7. сборки: сила против разума

/**
 * Оба пути развития должны быть путями, а не один — путём, а другой ловушкой.
 *
 * Ручной подсчёт «атака × коэффициент умения» этот вопрос завалил: магические
 * умения бьют по площади, и по одной цели они выглядят вдвое слабее, чем есть.
 * Поэтому здесь урон умения не считается по формуле, а **измеряется** тем же
 * стендом, что и раздел 6, — с настоящими целями, снарядами и зонами.
 *
 * Меряем по одной цели и по пятерым: сборка может быть честной в одном и
 * провальной в другом, и это разные поломки.
 */
console.log('\n── 7. Сборки: сила против разума\n');
{
  const наборы = {
    сила:  { build: 'str', sub: 'sword', skills: null },
    разум: { build: 'int', sub: 'staff', skills: null },
  };
  for (const lvl of [8, 20, 34, 46]) {
    const итог = {};
    for (const [имя, cfg] of Object.entries(наборы)) {
      const p = hero(lvl, cfg.sub, 4242, cfg.build);
      const basic = p.attack * (1 + p.critChance * (p.critMult - 1)) / p.attackRate;
      // сборка берёт три лучших умения для себя, а не «свои по стихии»:
      // игрок выбирает то, что бьёт, а не то, что тематично
      const оценка = Object.keys(SKILLS).map((key) => {
        const one = castOnce(key, lvl, 1, makeRng(31337), hero(lvl, cfg.sub, 4242, cfg.build));
        const five = castOnce(key, lvl, 5, makeRng(31337), hero(lvl, cfg.sub, 4242, cfg.build));
        return { key, name: SKILLS[key].name, cd: one.cd, one: one.dmg, five: five.dmg };
      }).filter((r) => r.one > 0 || r.five > 0);
      const тройка1 = [...оценка].sort((a, b) => b.one / b.cd - a.one / a.cd).slice(0, 3);
      const тройка5 = [...оценка].sort((a, b) => b.five / b.cd - a.five / a.cd).slice(0, 3);
      итог[имя] = {
        по1: basic + тройка1.reduce((a, r) => a + r.one / r.cd, 0),
        по5: basic + тройка5.reduce((a, r) => a + r.five / r.cd, 0),
        basic, набор: тройка5.map((r) => r.name),
      };
    }
    const с = итог.сила, р = итог.разум;
    console.log(`  ур.${String(lvl).padStart(2)}  по одной: сила ${String(Math.round(с.по1)).padStart(5)}, разум ${String(Math.round(р.по1)).padStart(5)}  → разум ×${fmt(р.по1 / с.по1, 2)}`);
    console.log(`        по пятерым: сила ${String(Math.round(с.по5)).padStart(5)}, разум ${String(Math.round(р.по5)).padStart(5)}  → разум ×${fmt(р.по5 / с.по5, 2)}`);
    console.log(`        разум берёт: ${р.набор.join(', ')}`);
    // Отдельный вопрос: нужен ли магической сборке посох. Он обещает силу
    // магии подсказкой, но сила магии считается и от половины атаки — а атака
    // у посоха ниже. Если с мечом магическая сборка бьёт не хуже, обещание
    // пустое, и вид оружия ни на что не влияет.
    const сМечом = (() => {
      const q = hero(lvl, 'sword', 4242, 'int');
      const b = q.attack * (1 + q.critChance * (q.critMult - 1)) / q.attackRate;
      const оц = Object.keys(SKILLS).map((key) => {
        const five = castOnce(key, lvl, 5, makeRng(31337), hero(lvl, 'sword', 4242, 'int'));
        return { cd: five.cd, five: five.dmg };
      }).filter((r) => r.five > 0).sort((a, b2) => b2.five / b2.cd - a.five / a.cd).slice(0, 3);
      return b + оц.reduce((a, r) => a + r.five / r.cd, 0);
    })();
    console.log(`        посох против меча в магической сборке: ×${fmt(р.по5 / сМечом, 3)}`);
    if (р.по5 / сМечом < 1.02) note('посох ничего не решает', `ур.${lvl}: магическая сборка с посохом ×${fmt(р.по5 / сМечом, 3)} от неё же с мечом`);
    // Порог широкий нарочно: пути обязаны отличаться, но не быть ловушкой.
    // Судим по лучшему из двух случаев — сборка вправе быть заточена под одно.
    const лучшее = Math.max(р.по1 / с.по1, р.по5 / с.по5);
    if (лучшее < 0.75) note('путь развития отстаёт', `ур.${lvl}: разум даёт ${fmt(лучшее * 100, 0)}% от силы даже в своём лучшем случае`);
    if (лучшее > 1.4) note('путь развития вырывается', `ур.${lvl}: разум даёт ${fmt(лучшее * 100, 0)}% от силы`);
  }
}

// ─────────────────────────────────────────── итог

console.log('');
if (!problems.length) { console.log('ПРОБЛЕМ НЕ НАЙДЕНО'); process.exit(0); }
const byKind = new Map();
for (const p of problems) byKind.set(p.kind, (byKind.get(p.kind) || 0) + 1);
console.log(`найдено: ${problems.length}`);
for (const [kind, n] of [...byKind].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${kind}: ${n}`);
  for (const p of problems.filter((x) => x.kind === kind).slice(0, 6)) console.log(`      ${p.what}`);
  const rest = problems.filter((x) => x.kind === kind).length - 6;
  if (rest > 0) console.log(`      …и ещё ${rest}`);
}
process.exit(1);
