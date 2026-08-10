// Столкновения и поиск целей — общие для клиента и сервера.
//
// Это первый кусок, вынутый из `Game` ради сети, и вынут он первым не случайно:
// правила «где можно стоять» обязаны совпадать у клиента и у комнаты до
// пикселя. Разойдись они хоть на единицу — и герой на экране будет стоять не
// там, где считает сервер, а игрок увидит, как его дёргает назад.
//
// Все функции чистые и берут зону явным доводом. `Game` вызывает их через свои
// прежние методы, чтобы четыре сотни мест в коде не переписывать.

import { TILE, T } from '../art/tiles.js';
import { clamp, damp, dist, dist2 } from '../core/util.js';

/** Помещается ли габарит (ширина `w`, высота `h` вверх от точки ног) в (x, y). */
export function canBeAt(z, x, y, w, h, fly) {
  const x0 = Math.floor((x - w / 2) / TILE), x1 = Math.floor((x + w / 2 - 0.01) / TILE);
  const y0 = Math.floor((y - h) / TILE), y1 = Math.floor((y - 0.01) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tx < 0 || ty < 0 || tx >= z.w || ty >= z.h) return false;
      if (fly) {
        const t = z.tiles[ty * z.w + tx];
        if (t === T.WALL || t === T.VOID) return false;
      } else if (z.solid[ty * z.w + tx]) return false;
    }
  }
  // объекты — попиксельно: рельеф грубее пикселя, дом — нет
  return fly ? true : !z.boxAt(x, y, w, h);
}

/** Сдвинуть по скорости с отскоком от препятствий и упором в края зоны. */
export function moveEntity(z, e, dt, collide = true) {
  const nx = e.x + e.vx * dt;
  const ny = e.y + e.vy * dt;
  const fly = collide === false;
  if (canBeAt(z, nx, e.y, e.w, e.h, fly)) e.x = nx;
  else e.vx *= -0.15;
  if (canBeAt(z, e.x, ny, e.w, e.h, fly)) e.y = ny;
  else e.vy *= -0.15;
  e.x = clamp(e.x, 8, z.pxW - 8);
  e.y = clamp(e.y, 12, z.pxH - 4);
}

/** Стена или пустота в точке — грубая проверка по тайлу, без объектов. */
export function solidAt(z, x, y) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= z.w || ty >= z.h) return true;
  const t = z.tiles[ty * z.w + tx];
  return t === T.WALL || t === T.VOID;
}

/** Видно ли из `a` в `b`: шагаем по прямой через каждые десять пикселей. */
export function hasLineOfSight(z, a, b) {
  const steps = Math.ceil(dist(a.x, a.y, b.x, b.y) / 10);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (solidAt(z, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
  }
  return true;
}

/** Ближайший живой враг в радиусе — цель для автонаведения и умений. */
/**
 * Ближайший враг в радиусе.
 *
 * @param {Set} [skip] — кого не брать. Нужен цепным умениям: они прыгают от
 *   цели к цели и передают сюда уже задетых. Довода не было, а звали его с
 *   ним — молча терялся, и цепь била одну цель по кругу: после прыжка точка
 *   отсчёта ставится ровно в цель, поэтому она же и оказывалась ближайшей на
 *   расстоянии ноль. Ветвилось только если цель гибла от прыжка.
 */
export function nearestEnemy(list, x, y, r, skip) {
  let best = null, bd = r * r;
  for (const e of list) {
    if (e.dead) continue;
    if (skip && skip.has(e)) continue;
    const d = dist2(x, y, e.x, e.y - e.r * 0.6);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/**
 * Один шаг ходьбы по намерению — общий для клиента и сервера.
 *
 * Это самая чувствительная функция во всей сети. Клиент двигает героя сразу, не
 * дожидаясь ответа, а потом сверяется с сервером и переигрывает свои шаги
 * заново. Если здесь и там расходится хоть коэффициент затухания, сверка каждый
 * раз будет давать другой ответ, и героя начнёт мелко трясти на месте. Поэтому
 * шаг ровно один, и живёт он тут.
 */
export function stepMove(z, e, mx, my, speed, dt) {
  const len = Math.hypot(mx, my);
  const nx = len > 1 ? mx / len : mx;
  const ny = len > 1 ? my / len : my;
  e.vx = damp(e.vx, nx * speed, 16, dt);
  e.vy = damp(e.vy, ny * speed, 16, dt);
  moveEntity(z, e, dt);
}

/**
 * Ближайшая точка, где габарит `w`×`h` действительно помещается.
 *
 * У зоны есть свой `findFree`, но он смотрит только на тайлы — а непроходимость
 * дают ещё и объекты: бочка, колонна, угол дома. Отсюда и брались герои,
 * рождённые в реке, и гоблины внутри валуна: точка выбиралась по карте, а стоял
 * на ней потом кто-то с габаритом.
 *
 * Ищем по расширяющемуся кольцу — так найденное место оказывается ближайшим, а
 * не первым попавшимся, и расстановка не съезжает.
 */
export function findSpot(z, x, y, w, h, fly = false, maxR = 6) {
  if (canBeAt(z, x, y, w, h, fly)) return { x, y, moved: 0 };
  for (let r = 1; r <= maxR; r++) {
    const steps = Math.max(8, r * 8);
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const nx = x + Math.cos(a) * r * TILE;
      const ny = y + Math.sin(a) * r * TILE;
      if (canBeAt(z, nx, ny, w, h, fly)) return { x: nx, y: ny, moved: r };
    }
  }
  return { x, y, moved: -1 };      // не нашли — пусть решает вызывающий
}

/**
 * Куда можно дойти пешком от точки. Возвращает маску по клеткам.
 *
 * Нужна генератору: рельеф иногда оставляет карманы, отрезанные стенами, и
 * разбросанный туда сундук виден на миникарте, но недостижим — игрок ходит
 * вокруг и не понимает, что не так. Дешевле проверить при постройке, чем
 * объяснять потом.
 */
export function reachMask(z, px, py) {
  const seen = new Uint8Array(z.w * z.h);
  const sx = Math.floor(px / TILE), sy = Math.floor(py / TILE);
  if (sx < 0 || sy < 0 || sx >= z.w || sy >= z.h) return seen;
  const stack = [sy * z.w + sx];
  seen[stack[0]] = 1;
  while (stack.length) {
    const k = stack.pop();
    const x = k % z.w, y = (k / z.w) | 0;
    for (let i = 0; i < 4; i++) {
      const nx = x + (i === 0 ? 1 : i === 1 ? -1 : 0);
      const ny = y + (i === 2 ? 1 : i === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= z.w || ny >= z.h) continue;
      const nk = ny * z.w + nx;
      if (seen[nk]) continue;
      if (!canBeAt(z, nx * TILE + TILE / 2, ny * TILE + TILE - 1, 11, 9, false)) continue;
      seen[nk] = 1;
      stack.push(nk);
    }
  }
  return seen;
}

/** Ближайшая к (x, y) клетка из маски достижимого — в пикселях. */
export function nearestReachable(z, mask, x, y, maxR = 24) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = tx + dx, ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= z.w || ny >= z.h) continue;
        if (mask[ny * z.w + nx]) return { x: nx * TILE + TILE / 2, y: ny * TILE + TILE - 2, moved: r };
      }
    }
  }
  return null;
}
