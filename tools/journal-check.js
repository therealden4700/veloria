// Журнал в общем мире ведёт комната — и только она.
//
//   node tools/journal-check.js [порт]
//
// Найдено проверкой готовности к релизу. Журнал заданий у клиента свой: он
// открывает сюжетные задания по уровню и дописывает контракты капитана. В общем
// мире это делает комната, и клиент обязан только показывать присланное. Но два
// вызова `quests.refresh` остались без проверки сети — у капитана и на взятом
// уровне, — а рядом, в `enterZone`, такая проверка уже стоит: правило известно,
// просто не применено везде.
//
// Хуже другого: `fromJSON` только дополняет. Он обновляет записи с совпавшим
// номером и ничего не убирает — значит журнал одиночной игры въезжает в общий
// мир целиком и живёт там призраком до перезахода. А номера контрактов у обоих
// журналов считаются одним счётчиком, так что призрак `b7` однажды совпадёт с
// настоящим контрактом комнаты: текст останется клиентский, состояние придёт
// серверное.
//
// Что видит игрок: подходит к капитану, видит контракт, жмёт «Принять» — и
// получает красный отказ «нет такого задания». И так каждый раз.
//
// ЧЕГО ЭТОТ СТЕНД НЕ МЕРЯЕТ. Ход заданий и награду за них: это `quests-server-check`.
// Здесь только про то, чей журнал показан игроку.

const PORT = Number(process.argv[2] || 3000);
const U = `http://localhost:${PORT}`;
const problems = [];
const note = (s) => problems.push(s);
const log = (s) => console.log(s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let сделано = 0;
const проверить = (имя, годно, замер, причина) => {
  сделано++;
  log(`  ${годно ? '✓' : '✗'} ${имя}${замер ? '  — ' + замер : ''}${!годно && причина ? '  (' + причина + ')' : ''}`);
  if (!годно) note(`${имя}: ${причина || замер || 'не сошлось'}`);
};

let живой = false;
try { живой = (await fetch(`${U}/health`)).ok; } catch { /* нет */ }
if (!живой) {
  console.log(`сервера на ${PORT} нет — мерить нечего`);
  console.log(`подними: PORT=${PORT} node server/server.js`);
  process.exit(1);
}

const { installHeadless } = await import('../src/core/headless.js');
installHeadless();
globalThis.location = { origin: `http://localhost:${PORT}`, protocol: 'http:', host: `localhost:${PORT}`, search: '' };

const { initProps } = await import('../src/art/props.js');
const { bakeAllMonsters } = await import('../src/art/sprites.js');
initProps();
bakeAllMonsters();

const { Game } = await import('../src/game.js');
const wallet = await import('../src/core/wallet.js');
const net = (await import('../src/core/net.js')).default || (await import('../src/core/net.js')).net;

const пусто = { canvas: { width: 480, height: 270 }, save() {}, restore() {}, drawImage() {}, fillRect() {},
  clearRect() {}, beginPath() {}, fill() {}, stroke() {}, translate() {}, scale() {}, measureText: () => ({ width: 10 }),
  fillText() {}, setTransform() {}, createLinearGradient: () => ({ addColorStop() {} }) };

try { localStorage.clear(); } catch { /* нечего */ }
const g = new Game(пусто, { w: 480, h: 270 }, пусто);
g.newGame();

// ══════════════════════════════ журнал, нажитый офлайн

log('── журнал одиночной игры');
// Поднимаем уровень и обновляем журнал так же, как это делает игра: открываются
// сюжетные задания, добираются контракты капитана.
g.player.level = 25;
g.quests.refresh(g.player);
g.quests.refresh(g.player);
const свои = g.quests.all.map((q) => q.id);
const контракты = свои.filter((id) => /^b\d+/.test(id));
log(`  своих записей ${свои.length}, из них контрактов ${контракты.length}`);
проверить('офлайн-журнал наполнен', свои.length > 0 && контракты.length > 0,
  `${свои.length} записей, ${контракты.length} контрактов`,
  'мерить нечего — журнал пуст и до общего мира');

// ══════════════════════════════ вход в общий мир

log('');
log('── вошли в общий мир');
await wallet.playAsGuest();
const ответ = await g.goOnline();
log(`  goOnline: ${ответ}`);
if (ответ !== 'online') {
  note(`в комнату не вошли (${ответ}) — правило не проверено`);
  console.log(`\nпроверок: ${сделано}\nнайдено: ${problems.length}`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
await wait(1800);

const отКомнаты = (net.quests && net.quests.quests && net.quests.quests.list || []).map((q) => q.id);
const уКлиента = g.quests.all.map((q) => q.id);
const призраки = уКлиента.filter((id) => !отКомнаты.includes(id));
log(`  комната прислала ${отКомнаты.length} записей, у клиента ${уКлиента.length}`);
log(`  призраков (есть у клиента, нет у комнаты): ${призраки.length}${призраки.length ? ' — ' + призраки.slice(0, 6).join(', ') : ''}`);

проверить('комната прислала свой журнал', отКомнаты.length > 0,
  `${отКомнаты.length} записей`, 'журнала от комнаты нет — дальше мерить нечего');
проверить('в журнале только то, что знает комната', призраки.length === 0,
  `${призраки.length} призраков из ${уКлиента.length}`,
  'игрок видит задания, которых у мира нет: «Принять» даст красный отказ');

// ══════════════════════════════ клиент не дописывает журнал сам

log('');
log('── клиент не трогает журнал в общем мире');
{
  const до = g.quests.all.length;
  const состоянияДо = g.quests.all.map((q) => q.id + ':' + q.state).join('|');
  // Зовём игру, а не журнал: правило про сеть живёт в `Game.обновитьЖурнал`, и
  // проверять надо его, а не `Quests.refresh`, который про сеть ничего не знает
  // и знать не должен. Это тот же путь, которым идут разговор с капитаном и
  // взятие уровня.
  g.обновитьЖурнал();
  const после = g.quests.all.length;
  const состоянияПосле = g.quests.all.map((q) => q.id + ':' + q.state).join('|');
  log(`  записей ${до} → ${после}`);
  const измен = состоянияДо === состоянияПосле ? [] : g.quests.all
    .filter((q, i) => (состоянияПосле.split('|')[i] || '') !== (состоянияДо.split('|')[i] || ''))
    .map((q) => q.id + '→' + q.state);
  проверить('обновление журнала клиентом ничего не меняет',
    до === после && состоянияДо === состоянияПосле,
    до !== после ? `записей ${до} → ${после}`
      : измен.length ? `состояния поменялись: ${измен.slice(0, 5).join(', ')}` : 'ничего не изменилось',
    'клиент открывает задания сам — комната о них не знает и откажет на «Принять»');
}

// ══════════════════════════════ каждое показанное можно взять

log('');
log('── всё показанное доступным можно взять');
{
  const доступные = g.quests.all.filter((q) => q.state === 'available');
  log(`  доступных к взятию: ${доступные.length}`);
  if (!доступные.length) {
    log('  · доступных нет — этот прогон взятие не мерили');
  } else {
    const q = доступные[0];
    const было = [];
    net.onQuest = (m) => было.push(m);
    net.торг({ t: 'quest', do: 'accept', id: q.id });
    let ответ2 = null;
    for (let i = 0; i < 40; i++) { await wait(50); if (было.length) { ответ2 = было[0]; break; } }
    log(`  «${q.id}» → ${ответ2 ? JSON.stringify(ответ2).slice(0, 90) : 'молчание'}`);
    проверить('показанное доступным комната принимает', !!(ответ2 && ответ2.ok),
      ответ2 ? (ответ2.why || ответ2.name || 'ok') : 'комната промолчала',
      'игрок жмёт «Принять» на подсвеченном задании и получает красный отказ');
    net.onQuest = null;
  }
}

g.goOffline();
console.log('');
console.log(`проверок: ${сделано}`);
if (problems.length) {
  console.log(`найдено: ${problems.length}`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('ПРОБЛЕМ НЕ НАЙДЕНО');
process.exit(0);
