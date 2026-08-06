// Правила удара — общие для клиента и сервера.
//
// В `Game.playerSwing` правило и зрелище лежали вперемешку: дуга, проверка
// попадания и расчёт урона — рядом с искрами, тряской экрана и стоп-кадром. Для
// одиночной игры это нормально, для сети — нет: комната обязана считать тот же
// урон, но ей нечего показывать.
//
// Здесь только правило. Оно ничего не рисует, не звучит и не трясёт: берёт
// бьющего, список целей и возвращает, кто попал и на сколько. Всё остальное —
// дело того, кто вызвал: клиент из этого делает искры, сервер — новое здоровье.

import { dist, angle, angDiff } from '../core/util.js';

/** Геометрия взмаха: дальность, разброс и множитель по номеру удара в связке. */
export function swingShape(attacker, combo) {
  return {
    range: attacker.attackRange + (combo === 2 ? 8 : 0),
    spread: combo === 2 ? 1.5 : 1.05,
    mult: combo === 2 ? 1.5 : 1,
    ox: attacker.x + Math.cos(attacker.facing) * 6,
    oy: attacker.y - 11 + Math.sin(attacker.facing) * 4,
  };
}

/**
 * Кого задел взмах и на сколько.
 *
 * `rng` передаётся явно, а не берётся из `Math.random`: сервер считает правду, и
 * ему полезно уметь повторить расчёт — например, при разборе жалобы «меня убило
 * сквозь стену». Клиент может передать обычный `Math.random`.
 *
 * Возвращает список `{ enemy, dmg, crit, focused, knock, heavy }` — без единого
 * побочного действия. Ни здоровье, ни эффекты здесь не меняются.
 */
export function swingHits(attacker, enemies, opts = {}) {
  const combo = opts.combo || 0;
  const time = opts.time || 0;
  const rng = opts.rng || Math.random;
  const { range, spread, mult, ox, oy } = swingShape(attacker, combo);

  const out = [];
  for (const e of enemies) {
    if (!e || e.dead) continue;
    const ex = e.x, ey = e.y - e.r * 0.6;
    if (dist(ox, oy, ex, ey) > range + e.r) continue;
    if (Math.abs(angDiff(attacker.facing, angle(ox, oy, ex, ey))) > spread) continue;

    const focused = !!(attacker.hasUnique && attacker.hasUnique('focusEye'))
      && (attacker._focusCd || 0) <= time;
    const crit = focused || rng() < attacker.critVs(e);
    let dmg = attacker.attack * mult * (crit ? attacker.critMult : 1) * (0.9 + rng() * 0.2);
    if (focused) dmg *= 2;

    out.push({
      enemy: e, dmg, crit, focused,
      knock: 140 * mult * (e.knockRes || 1),
      heavy: combo === 2,
    });
  }
  return out;
}

// ── Формы доставки: кого задевает умение
//
// Вынесены сюда по той же причине, что и правило урона: без них стенд, который
// проверяет умения, держал бы свою копию геометрии — и мерил бы копию, а не
// игру. Здесь только «кто попал»: ни урона, ни эффектов, ни зрелища.

/** Кого накрывает круг радиуса `r` с центром в точке. */
export function aoeTargets(enemies, x, y, r) {
  const out = [];
  for (const e of enemies) {
    if (!e || e.dead) continue;
    if (dist(x, y, e.x, e.y - e.r * 0.5) > r + e.r) continue;
    out.push(e);
  }
  return out;
}

/** Кого задевает полоса длиной `len` и полушириной `halfW` под углом `ang`. */
export function lineTargets(enemies, x, y, ang, len, halfW) {
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const out = [];
  for (const e of enemies) {
    if (!e || e.dead) continue;
    const dx = e.x - x, dy = (e.y - e.r * 0.5) - y;
    const proj = dx * cos + dy * sin;
    if (proj < 0 || proj > len) continue;
    if (Math.abs(-dx * sin + dy * cos) > halfW + e.r) continue;
    out.push(e);
  }
  return out;
}

/**
 * Кого накрывает опасная зона (стена огня, ядовитое облако).
 *
 * Своя мерка высоты — `e.r * 0.4`, а не 0,5 как у круга: зона лежит на земле.
 * Ровно на такой мелочи копия и разошлась бы с игрой.
 */
// Опасность на земле против героя.
//
// Отдельное правило, потому что мерка у героя другая: габарит хранится как
// `w`×`h`, поля `r` у него нет. Если писать `h.r + p.r`, сравнение уезжает в
// NaN — и урон не проходит вообще, молча, без единой ошибки в консоли. Один
// раз мы на этом уже попались; поэтому правило живёт здесь, рядом с
// `hazardTargets`, и обе стороны считаются одинаково — от ног, а не от
// середины спрайта.
export function hazardHitsPlayer(h, p) {
  if (!p || p.dead) return false;
  return dist(h.x, h.y, p.x, p.y - 3) <= h.r + p.w * 0.5;
}

export function hazardTargets(enemies, h) {
  const out = [];
  for (const e of enemies) {
    if (!e || e.dead) continue;
    if (dist(h.x, h.y, e.x, e.y - e.r * 0.4) > h.r + e.r) continue;
    out.push(e);
  }
  return out;
}

/**
 * Снаряд героя — тот же и в игре, и на стенде.
 *
 * Вынесено, потому что копировать пришлось бы поля, влияющие на урон:
 * `heavy` (обходит броню), `pierce`, `effect`. Разойдись любое — и стенд мерил
 * бы другой снаряд.
 */
export function boltSpec(p, ang, dmg, o = {}) {
  const sp = o.speed || 200;
  return {
    x: p.x, y: p.y - 13,
    vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
    damage: dmg, friendly: true, heavy: true,
    color: o.color || '#8b4fd8', color2: o.color2 || '#e6c0ff',
    size: o.size || 3, glow: o.glow || 12, life: o.life || 2.2,
    homing: o.homing || 0, pierce: o.pierce || 0, effect: o.effect || null,
  };
}

/**
 * Бросок крита и разброса для попадания умением.
 *
 * `opts.crit === 1` — гарантированный крит (им пользуется теневой рывок),
 * иначе `opts.crit` прибавляется к обычному шансу.
 */
export function skillRoll(attacker, e, dmg, opts = {}, rng = Math.random) {
  const crit = opts.crit === 1 || rng() < attacker.critVs(e) + (opts.crit || 0);
  return { crit, amount: dmg * (crit ? attacker.critMult : 1) * (0.92 + rng() * 0.16) };
}

/**
 * Сколько урона на самом деле дойдёт до цели.
 *
 * Раньше здесь была дыра, и в комментарии стояло, почему: расчёт урона я
 * однажды написал по памяти, а сверка с настоящим `Game.damageEnemy` показала
 * расхождение по каждому пункту. Вывод тогда был — не переписывать заново, а
 * разделить настоящий расчёт на правило и зрелище. Это и сделано: тело функции
 * перенесено из `damageEnemy` дословно, а `damageEnemy` теперь её зовёт.
 *
 * Здесь только правило: ни всплывающих чисел, ни искр, ни звука, ни вампиризма,
 * ни смерти цели — всё это осталось у вызывающего. Поэтому одно и то же число
 * получают и игра, и стенд, который её проверяет.
 *
 * `rng` передаётся явно ради повторяемости: уклонение — бросок, а стенду нужно
 * уметь прогнать тот же бой дважды.
 *
 * Возвращает `{ dmg, dodged, blocked, incoming }`. При `dodged` урон нулевой.
 * `incoming` — угол, с которого пришёл удар: он нужен зрелищу для искр о щит.
 */
export function resolveHit(attacker, e, amount, opts = {}, rng = Math.random, markMult = null) {
  const def = e.def;
  // `noDodge` и `shieldBroken` — временные вскрытия от легендарок Пролома.
  // Живут здесь, а не в игре, потому что это правило боя: стенд обязан
  // считать их так же, иначе аудит будет мерить не ту игру.
  if (e.dodge && !opts.dot && !(e.noDodge > 0) && rng() < e.dodge) {
    return { dmg: 0, dodged: true, blocked: false, incoming: 0 };
  }

  // ── щит держит удар спереди: обойти или пробить тяжёлой атакой
  let blocked = false, incoming = 0;
  if (def.shield && !opts.dot && !(e.shieldBroken > 0)) {
    const from = opts.from || attacker;
    incoming = angle(e.x, e.y, from.x, from.y);
    if (Math.abs(angDiff(e.face, incoming)) < def.shield.arc) {
      const reduce = opts.heavy ? def.shield.reduce * 0.45 : def.shield.reduce;
      amount *= 1 - reduce;
      blocked = true;
    }
  }

  // ── броня срезает лёгкие удары, тяжёлые проходят целиком
  const armor = (def.armor || 0) + (e.armorBonus || 0);
  if (armor && !opts.heavy && !opts.dot) amount *= 1 - Math.min(0.8, armor);

  // ── метки: разряд и разъедание делают цель уязвимее, пассивки читают состояние
  if (!opts.pure && markMult) amount *= markMult(attacker, e);

  return { dmg: Math.max(1, Math.round(amount)), dodged: false, blocked, incoming };
}
