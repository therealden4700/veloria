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
import { ENEMIES } from '../entities/enemies.js';

const ZONES = [...OVERWORLD, 'dungeon'];

/** Биом, в котором водится тварь с таким ключом. */
function biomeOfEnemy(key) {
  for (const id of ZONES) {
    const b = BIOMES[id];
    if (!b) continue;
    // Не только рядовые: элита биома в таблицу `enemies` не входит, а задания
    // на неё есть — «Титаны» вели в никуда именно поэтому.
    if ((b.enemies && b.enemies.some(([k]) => k === key)) || b.elite === key || b.boss === key) return id;
  }
  return null;
}

function biomeOfBoss(key) {
  for (const id of ZONES) if (BIOMES[id] && BIOMES[id].boss === key) return id;
  return null;
}

/**
 * Где падает материал: сперва находим, кто его роняет, потом где он водится.
 *
 * Правило это знал только стенд содержимого (`tools/content-audit.js`), а
 * указателю оно было нужно не меньше: у семи заданий «собери» цель — материал,
 * и без этого пути указатель просто гас. Замер поймал: герой пять минут стоял
 * в городе с активным заданием и без единой подсказки, куда идти.
 */
function biomeOfMaterial(key) {
  let лучший = null;
  for (const [ekey, def] of Object.entries(ENEMIES)) {
    if (!def.drops || !def.drops.includes(key)) continue;
    for (const id of ZONES) {
      const b = BIOMES[id];
      if (!b) continue;
      const тут = (b.enemies && b.enemies.some(([k]) => k === ekey)) || b.boss === ekey || b.elite === ekey;
      if (!тут) continue;
      // Ведём в самое раннее место: туда игрок уже допущен наверняка.
      if (!лучший || (b.unlockLevel || 1) < лучший.lvl) лучший = { id, lvl: b.unlockLevel || 1 };
    }
  }
  return лучший && лучший.id;
}

/** Ближайший биом по уровню героя — для целей без своего места. */
function biomeForLevel(level) {
  let лучший = null;
  for (const id of OVERWORLD) {
    const b = BIOMES[id];
    if (!b || (b.unlockLevel || 1) > level) continue;
    if (!лучший || (b.unlockLevel || 1) > лучший.lvl) лучший = { id, lvl: b.unlockLevel || 1 };
  }
  return лучший && лучший.id;
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
  if (q.type === 'collect') {
    // Материал падает с определённых тварей — на них и указываем. Без этой
    // ветки указатель гас ровно там, где игрок уже дошёл куда надо: он стоит
    // в нужном биоме, вокруг те самые волки, а стрелки нет.
    const e = nearestEnemy(game, (x) => ENEMIES[x.key] && ENEMIES[x.key].drops && ENEMIES[x.key].drops.includes(q.target));
    if (e) return { x: e.x, y: e.y, label: q.title, tone: '#f0c05a' };
  }

  // цель в другой зоне — ведём к нужному выходу
  const want = q.type === 'reach' ? q.target
    : q.type === 'depth' ? 'dungeon'
    // Боссы Бездны не стоят ни в одном биоме: они выходят по очереди на
    // глубоких этажах. Их место — спуск.
    : q.type === 'boss' ? (biomeOfBoss(q.target) || 'dungeon')
    : (q.type === 'kill' || q.type === 'head') ? biomeOfEnemy(q.target)
    // «Собери» и «убей элиту» своего места не называют, и указатель на них
    // гас — а это девять заданий из тридцати одного. Материал ведём туда, где
    // он падает; элиту — в биом по уровню героя: элиты есть в каждом.
    : q.type === 'collect' ? biomeOfMaterial(q.target)
    : q.type === 'elite' ? biomeForLevel(p.level)
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
