// Куда идти.
//
// Замер первых десяти минут показал главную дыру входа: капитан, который даёт
// первое задание, не виден со стартовой точки, а от него до ворот в лес ещё
// полтора экрана. Ни метки на миникарте, ни стрелки — игрок идёт наугад. Бот,
// знавший координаты, тратил на дорогу шестнадцать секунд из двадцати четырёх
// до первого удара; человеку, который ищет, — вдвое-втрое больше.
//
// Здесь считается одна точка: куда ведёт текущее задание прямо сейчас. Её
// рисуют в двух местах — ромбом на миникарте и стрелкой у края экрана, когда
// цель за кадром.

import { BIOMES, OVERWORLD } from '../world/biomes.js';

const ZONES = [...OVERWORLD, 'dungeon'];

/** Биом, в котором водится тварь с таким ключом. */
function biomeOfEnemy(key) {
  for (const id of ZONES) {
    const b = BIOMES[id];
    if (b && b.enemies && b.enemies.some(([k]) => k === key)) return id;
  }
  return null;
}

function biomeOfBoss(key) {
  for (const id of ZONES) if (BIOMES[id] && BIOMES[id].boss === key) return id;
  return null;
}

/** Выход из текущей зоны в нужную сторону. */
function exitTo(zone, want, label, tone) {
  const e = zone.exits.find((x) => (want === 'city' ? x.dest.kind === 'city'
    : want === 'dungeon' ? x.dest.kind === 'dungeon'
    : x.dest.id === want));
  return e ? { x: e.x + (e.w || 0) / 2, y: e.y + (e.h || 0) / 2, label, tone } : null;
}

/** Ближайшая живая тварь с таким ключом. */
function nearestEnemy(game, pred) {
  let best = null, bd = Infinity;
  for (const e of game.enemies) {
    if (e.dead || !pred(e)) continue;
    const d = Math.hypot(e.x - game.player.x, e.y - game.player.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/**
 * Текущая цель в мировых координатах или null.
 *
 * Порядок намеренный: сначала «отнести готовое», потом «взять новое», и только
 * потом «идти делать». Игрок, у которого задание уже выполнено, чаще всего не
 * помнит, кому его нести, — и это худший момент, чтобы оставить его без
 * подсказки.
 */
export function objectiveOf(game) {
  const z = game.zone, p = game.player;
  if (!z || !game.quests) return null;
  const inCity = z.kind === 'city';
  const npcById = (id) => z.npcs && z.npcs.find((n) => n.id === id);

  const ready = game.quests.active.find((q) => game.quests.canComplete(q, p));
  if (ready) {
    const n = inCity && npcById(ready.giver);
    if (n) return { x: n.x, y: n.y, label: 'Сдать: ' + ready.title, tone: '#6fdc8c' };
    return exitTo(z, 'city', 'В Велорию: ' + ready.title, '#6fdc8c');
  }

  const q = game.quests.active[0];
  if (!q) {
    const av = game.quests.available[0];
    if (!av) return null;
    const n = inCity && npcById(av.giver);
    if (n) return { x: n.x, y: n.y, label: 'Взять: ' + av.title, tone: '#f0c05a' };
    return exitTo(z, 'city', 'В Велорию — есть задание', '#f0c05a');
  }

  // цель прямо здесь?
  if (q.type === 'kill' || q.type === 'head') {
    const e = nearestEnemy(game, (x) => x.key === q.target);
    if (e) return { x: e.x, y: e.y, label: q.title, tone: '#f0c05a' };
  }
  if (q.type === 'boss') {
    const e = nearestEnemy(game, (x) => x.boss || x.key === q.target);
    if (e) return { x: e.x, y: e.y, label: q.title, tone: '#ff8a5e' };
    if (z.bossArena && biomeOfBoss(q.target) === z.biomeId) {
      return { x: z.bossArena.x, y: z.bossArena.y, label: q.title, tone: '#ff8a5e' };
    }
  }
  if (q.type === 'elite') {
    const e = nearestEnemy(game, (x) => x.elite);
    if (e) return { x: e.x, y: e.y, label: q.title, tone: '#ffa63a' };
  }

  // цель в другой зоне — ведём к нужному выходу
  const want = q.type === 'reach' ? q.target
    : q.type === 'depth' ? 'dungeon'
    : q.type === 'boss' ? biomeOfBoss(q.target)
    : (q.type === 'kill' || q.type === 'head') ? biomeOfEnemy(q.target)
    : null;

  if (want) {
    if (inCity) return exitTo(z, want, q.title, '#f0c05a');
    if (z.biomeId !== want && !(want === 'dungeon' && z.kind === 'dungeon')) {
      return exitTo(z, 'city', 'В Велорию: ' + q.title, '#f0c05a');
    }
    // мы уже в нужном биоме, но цели поблизости нет — вести некуда, и это
    // честнее стрелки в случайную сторону
    return null;
  }
  return null;
}
