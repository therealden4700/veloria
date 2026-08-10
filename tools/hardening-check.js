// Сторож найденного: тридцать шесть дефектов, которые уже были.
//
//   node tools/hardening-check.js [порт]
//
// Все остальные стенды были зелёными, когда эти дефекты жили в игре, — значит
// сами по себе они их не ловят. Здесь каждая находка проверяется её же
// воспроизведением: если оно снова сработает, стенд покраснеет.
//
// Часть проверок требует живого сервера (порт по умолчанию 3000). Если его нет,
// сетевая половина не молчит, а прямо говорит, что её не мерили.
//
// ЧЕГО ЭТОТ СТЕНД НЕ МЕРЯЕТ. Он не ищет новых дефектов — только стережёт
// закрытые. И не проверяет зрелище: баннеры, музыку, отрисовку — их видно
// только в браузере.

import { installHeadless } from '../src/core/headless.js';

installHeadless();

const { initProps } = await import('../src/art/props.js');
const { bakeAllMonsters } = await import('../src/art/sprites.js');
const { Player } = await import('../src/entities/player.js');
const { Enemy } = await import('../src/entities/enemies.js');
const { makeItem, makeRune, reviveItem, RARITY } = await import('../src/systems/items.js');
const { nearestEnemy } = await import('../src/world/collide.js');
const { SKILLS } = await import('../src/systems/skills.js');
const { World, prepareArt } = await import('../server/world.js');

initProps();
bakeAllMonsters();
prepareArt();

const PORT = Number(process.argv[2] || 3000);
const problems = [];
const note = (s) => problems.push(s);
const log = (s) => console.log(s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let сделано = 0;
/**
 * @param {string} имя
 * @param {boolean} годно
 * @param {string} [замер]   — что намерено; печатается всегда
 * @param {string} [причина] — чем плохо; печатается только при провале
 *
 * Разведено нарочно: зелёная строка с текстом провала («вещь исчезла в
 * никуда») однажды введёт в заблуждение того, кто читает вывод.
 */
const проверить = (имя, годно, замер, причина) => {
  сделано++;
  log(`  ${годно ? '✓' : '✗'} ${имя}${замер ? '  — ' + замер : ''}${!годно && причина ? '  (' + причина + ')' : ''}`);
  if (!годно) note(`${имя}: ${причина || замер || 'вернулось'}`);
};

const пустаяИгра = () => ({
  particles: { add() {}, burst() {}, ring() {}, spawn() {}, clear() {} },
  floats: { add() {}, clear() {} }, shake: { add() {} }, slashes: [], projectiles: [],
  enemies: [], hazards: [], loot: [], proc() {}, onLevelUp() {}, onPlayerDeath() {},
  quests: { onKill() {}, onEliteKill() {}, refresh() {}, onReaction() {} },
  hud: { showBanner() {}, toast() {} }, toast() {}, save() {}, time: 0,
  spawnLoot(x, y, o) { this.loot.push(o); },
  damageEnemy(e, n) { e.hp -= n; }, killEnemy(e) { e.dead = true; },
});

log('── правила боя и комната');

// 1. реакция «пар» на сервере: у комнаты не было hazards
{
  const w = new World({ kind: 'biome', id: 'forest', seed: 20260805 });
  const p = w.addPlayer({ pid: 1, name: 'П', look: {}, character: null });
  w.player = p;
  const e = w.enemies.find((x) => !x.dead);
  let упало = null;
  try {
    e.applyEffect('burn', 3, 2, w);
    e.applyEffect('slow', 3, 1, w);       // пара меток → реакция
  } catch (err) { упало = err.message; }
  проверить('реакция стихий не роняет комнату', !упало, упало);
}

// 2. легендарка на крючке «hurt»: у комнаты не было aoeDamage
{
  const w = new World({ kind: 'biome', id: 'forest', seed: 20260805 });
  const p = w.addPlayer({ pid: 1, name: 'Л', look: {}, character: null });
  p.equipment.armor = makeItem({ kind: 'armor', rarity: 'legendary', unique: 'frostHeart', level: 30 });
  p.refreshSprites();
  w.player = p;
  let упало = null;
  try { p.takeDamage(5, w, { x: p.x + 8, y: p.y }); } catch (err) { упало = err.message; }
  проверить('«Ледяное сердце» не роняет такт', !упало, упало);
  проверить('у комнаты есть aoeDamage', typeof w.aoeDamage === 'function');
}

// 3. цепь ветвится, а не бьёт одну цель по кругу
{
  const w = new World({ kind: 'biome', id: 'forest', seed: 20260805 });
  const p = w.addPlayer({ pid: 1, name: 'Ц', look: {}, character: null });
  p.level = 20; w.player = p;
  w.enemies.length = 0;
  for (let i = 0; i < 4; i++) { const e = new Enemy('goblin', 20, p.x + 40 + i * 38, p.y); e.aggro = true; w.enemies.push(e); }
  const было = w.enemies.map((e) => e.hp);
  SKILLS.chain.run(w, { dmg: 40 });
  const задето = w.enemies.filter((e, i) => e.hp !== было[i]).length;
  проверить('цепная молния ветвится', задето >= 3, `задето ${задето} из 4`, 'бьёт одну цель по кругу');
  const skip = new Set([w.enemies[0]]);
  проверить('nearestEnemy знает список задетых', nearestEnemy(w.enemies, w.enemies[0].x, w.enemies[0].y, 200, skip) !== w.enemies[0]);
}

// 4. снаряды: их двигают, убирают и показывают
{
  const w = new World({ kind: 'biome', id: 'forest', seed: 20260805 });
  const p = w.addPlayer({ pid: 1, name: 'С', look: {}, character: null });
  p.level = 40; p.hp = p.maxHp;
  const стрелок = w.enemies.find((e) => e.key && e.key.includes('Archer')) || w.enemies[0];
  стрелок.x = p.x + 90; стрелок.y = p.y; стрелок.aggro = true;
  for (let t = 0; t < 60; t += 1 / 20) w.step(1 / 20);
  const снимок = w.snapshot();
  проверить('снаряды не копятся вечно', w.projectiles.length < 40, `в списке ${w.projectiles.length}`, 'список растёт вечно');
  проверить('снаряды есть в снимке', Array.isArray(снимок.shots));
}

log('');
log('── слепок персонажа и предметы');

// 5. накрутка и нечисла в слепке
{
  const мера = (d) => { const p = new Player(0, 0); p.fromJSON(d, reviveItem); return p; };
  const чит = мера({ level: 9999, str: 1e5, vit: 1e5, agi: 1e5, int: 1e5, hp: 1e9, equipment: {}, inventory: [] });
  проверить('уровень из слепка в границах', чит.level <= 60, `ур ${чит.level}`);
  проверить('характеристики в границах', чит.str < 400, `str ${чит.str}`);
  проверить('здоровье в границах', чит.maxHp < 6000, `hp ${Math.round(чит.maxHp)}`);
  const дрянь = мера({ level: 'ой', str: 'абв', vit: 'абв', agi: 'абв', equipment: {}, inventory: [] });
  проверить('строки не дают NaN', Number.isFinite(дрянь.maxHp) && Number.isFinite(дрянь.hp));
  const инф = мера({ level: Infinity, str: Infinity, equipment: {}, inventory: [] });
  проверить('Infinity не проходит', Number.isFinite(инф.maxHp) && инф.level <= 60);

  const без = мера({ level: 12, gold: 500, str: 9, vit: 9, agi: 9, int: 9, equipment: {}, inventory: [] });
  let потрачено = 0;
  for (let i = 0; i < 40; i++) if (без.spendStat('str')) потрачено++;
  проверить('очки развития не бесконечны', потрачено === 0, `потрачено ${потрачено}`, 'очки тратятся без счёта');
  без.gainXp(5000, пустаяИгра());
  проверить('опыт не умирает без поля xp', без.level > 12, `уровень ${без.level}, xp ${без.xp}`);
}

// 6. неизвестная редкость и счётчик id
{
  let упало = null;
  try { makeRune('firewall', 'божественная', 3); makeItem({ kind: 'weapon', sub: 'sword', level: 5, rarity: 'божественная' }); }
  catch (e) { упало = e.message; }
  проверить('чужая редкость не роняет заход в игру', !упало, упало);
  проверить('битый предмет не уносит героя', (() => { try { reviveItem({ kind: 'rune', sub: 'нетакой', rarity: 'x' }); return true; } catch { return false; } })(), '', 'исключение уносит весь сейв');
  reviveItem({ kind: 'weapon', sub: 'sword', id: 5000, tier: 1, rarity: 'common' });
  const свежий = makeItem({ kind: 'weapon', sub: 'axe', level: 3 });
  проверить('id не повторяются после загрузки', свежий.id > 5000, `id ${свежий.id}`);
}

// 7. награда за задание при полном рюкзаке
{
  const { QUEST_LINE, Quests } = await import('../src/systems/quests.js');
  const p = new Player(0, 0);
  p.level = 5;
  while (p.inventory.length < p.invSize) p.inventory.push(makeItem({ kind: 'armor', sub: 'helm', level: 1 }));
  const игра = пустаяИгра();
  игра.onQuestComplete = () => {};
  const шаблон = QUEST_LINE.find((x) => x && x.item && x.item.kind !== 'consumable' && x.type !== 'collect');
  if (!шаблон) { log('  · задания с вещью не нашлось — эту проверку не мерили'); }
  else {
    игра.player = p;
    const журнал = new Quests();
    // Берём настоящую запись журнала и доводим её до сдачи: `complete` сам
    // спросит `canComplete`, поэтому подделываем не результат, а состояние.
    const q = журнал.all.find((x) => x.id === шаблон.id) || { ...шаблон };
    q.state = 'active';
    q.progress = (q.count || 1) + 5;
    if (q.type === 'collect') { p.addMaterial ? p.addMaterial(q.target, q.count) : null; }
    const сдано = журнал.complete(q, игра);
    if (!сдано) log('  · задание не сдалось (нужны материалы) — эту проверку не мерили');
    else проверить('награда не пропадает при полном рюкзаке', игра.loot.length > 0, `на земле ${игра.loot.length}`, 'вещь исчезла в никуда');
  }
}

log('');
log('── общий мир: своё и чужое');

// 8. чужой снимок и чужие события
{
  const { net } = await import('../src/core/net.js');
  net.room = 'biome:forest';
  net.snaps.length = 0; net._events = [];
  net._onSnap({ t: 'snap', room: 'biome:forest', enemies: [{ i: 0 }], ev: [{ t: 'kill', i: 0 }] });
  net._onSnap({ t: 'snap', room: 'city', enemies: [], ev: [{ t: 'kill', i: 5 }] });
  проверить('снимок чужой комнаты отброшен', net.snaps.length === 1, `принято ${net.snaps.length}`);
  проверить('события чужой комнаты отброшены', (net._events || []).length === 1, `в очереди ${(net._events || []).length}`);
  net.room = null; net.snaps.length = 0; net._events = [];
}

// 9. состояние возрождения переживает снос комнаты
{
  const w = new World({ kind: 'biome', id: 'forest', seed: 20260805 });
  const p = w.addPlayer({ pid: 1, name: 'В', look: {}, character: null });
  const место = w.enemies.findIndex((e) => !e.dead);
  const жертва = w.enemies[место];
  w.killEnemy(жертва, p);
  const сл = w.слепокВозрождения();
  проверить('слепок возрождения помнит павших', (сл.павшие || []).length > 0);
  const w2 = new World({ kind: 'biome', id: 'forest', seed: 20260805 });
  w2.восстановить(сл);
  const тот = w2.enemies[место];
  проверить('после сна павший всё ещё мёртв', !!(тот && тот.dead), тот && тот.dead ? 'срок сохранён' : '', 'мир начался заново');
}

// 10. подземелье: модификатор этажа — часть места
{
  const a = new World({ kind: 'dungeon', floor: 3, mod: 'none', seed: 20260805 });
  const b = new World({ kind: 'dungeon', floor: 3, mod: 'swarm', seed: 20260805 });
  проверить('комната подземелья знает модификатор',
    a.enemies.length !== b.enemies.length || a.zone.spawnPoint.x !== b.zone.spawnPoint.x,
    `с модификатором и без — врагов ${a.enemies.length} и ${b.enemies.length}`);
}

// 11. Infinity во вводе
{
  const w = new World({ kind: 'biome', id: 'forest', seed: 20260805 });
  const p = w.addPlayer({ pid: 1, name: 'И', look: {}, character: null });
  w.applyInput(1, { t: 'input', s: [[0.1, 0, 0.05]], f: 0 });
  await wait(120);
  w.applyInput(1, { t: 'input', s: [[Infinity, Infinity, 0.05]], f: 0 });
  проверить('Infinity не портит координаты', Number.isFinite(p.x) && Number.isFinite(p.y), `x=${p.x} y=${p.y}`);
}

// 12. внешность из чужих рук
{
  const w = new World({ kind: 'city', seed: 20260805 });
  const p = w.addPlayer({ pid: 1, name: 'В', look: { armorTier: 1e9, weaponType: 'ы'.repeat(100000), лишнее: 'дрянь' }, character: null });
  проверить('look проверен по белому списку', JSON.stringify(p.look).length < 200, `${JSON.stringify(p.look).length} байт`);
}

log('');
log('── сеть');

let живой = false;
try { живой = (await fetch(`http://localhost:${PORT}/health`)).ok; } catch { живой = false; }
if (!живой) {
  log(`  · сервера на ${PORT} нет — сетевую половину НЕ МЕРИЛИ (подними: PORT=${PORT} node server/server.js)`);
} else {
  const U = `http://localhost:${PORT}`;
  const токен = async () => (await (await fetch(U + '/auth/verify', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ guest: true }),
  })).json()).token;

  // 13. громадное deepest не должно отравлять доску и вход
  const t = await токен();
  await fetch(U + '/char/save', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: t, data: { player: { level: 5, deepest: 1e18 } } }),
  });
  проверить('доска глубины пережила громадное число', (await fetch(U + '/leaderboard')).ok);
  проверить('вход пережил громадное число', (await fetch(U + '/auth/verify', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ guest: true }),
  })).ok);

  // 14. неизвестное место — отказ, а не молчание
  const t2 = await токен();
  const ws = new WebSocket(`ws://localhost:${PORT}/`);
  let закрыт = null;
  ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'hello', token: t2, at: { kind: 'biome', id: 'нетакого' } })));
  ws.addEventListener('close', (e) => { закрыт = e.code; });
  await wait(1200);
  проверить('несуществующее место закрывает связь', закрыт !== null, закрыт ? 'код ' + закрыт : '', 'сокет висит молча');

  // 15. клиент не молчит, пока открыто окно
  //
  // Сеть у клиента стояла внутри блока, закрытого паузой: любое окно —
  // инвентарь, лавка, журнал — и ввод перестаёт уходить. Комната отключает
  // молчунов через пятнадцать секунд, то есть задержаться в лавке значило
  // вылететь из мира. Здесь проверяем то же снаружи: соединение, которое
  // только шлёт нулевой шаг, обязано выжить дольше этого срока.
  {
    const tМолч = await токен();
    const wsМ = new WebSocket(`ws://localhost:${PORT}/`);
    let живо = true, причина = null;
    wsМ.addEventListener('close', (e) => { живо = false; причина = e.code + ' ' + e.reason; });
    wsМ.addEventListener('open', () => wsМ.send(JSON.stringify({ t: 'hello', token: tМолч, name: 'Стоящий' })));
    await wait(800);
    const t0 = Date.now();
    while (Date.now() - t0 < 20000 && живо) {
      await wait(400);
      if (wsМ.readyState === 1) wsМ.send(JSON.stringify({ t: 'input', s: [[0, 0, 0.4]], f: 0 }));
    }
    проверить('стоящий на месте не вылетает', живо, живо ? '20 с на нулевом шаге' : '', `отключён: ${причина}`);
    if (живо) wsМ.close();
  }

  // 16. молчащий сокет закрывается сам
  const ws2 = new WebSocket(`ws://localhost:${PORT}/`);
  let з2 = null;
  ws2.addEventListener('close', (e) => { з2 = e.code; });
  await wait(10000);
  проверить('молчащий сокет закрывается', з2 !== null, з2 ? 'код ' + з2 : '', 'висит вечно');
}

console.log('');
console.log(`проверок: ${сделано}`);
if (problems.length) {
  console.log(`найдено: ${problems.length}`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('ПРОБЛЕМ НЕ НАЙДЕНО');
