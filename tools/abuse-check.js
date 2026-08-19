// Чего добьётся человек с открытой консолью.
//
//   node tools/abuse-check.js [порт]
//
// Комната проверяет намерения: можно ли купить, хватает ли материалов, дошёл ли
// удар. Этот стенд про другое — не про «что можно», а про «сколько раз». Игра
// раздаётся ссылкой, консоль есть у каждого, и первое, что делает любопытный
// человек, — шлёт то же сообщение тысячу раз.
//
// Проверяется:
//   1. поток `travel` — каждое сообщение строит зону заново, а такт один на всех;
//   2. лавка с выдуманным именем — ключ в карте ассортимента не удаляется;
//   3. слияние рун из одной и той же — дубликаты в списке номеров;
//   4. одна учётка в двух окнах — чей прогресс победит;
//   5. захват комнаты гостевыми соединениями с одной машины.
//
// ЧЕГО ЭТОТ СТЕНД НЕ МЕРЯЕТ. Настоящую распределённую атаку: здесь один
// источник, и меряется устойчивость к одному любопытному, а не к толпе.

import { generateKeyPairSync, sign } from 'node:crypto';
import { buildMessage } from '../server/auth.js';

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

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const base58 = (b) => { let n = BigInt('0x' + Buffer.from(b).toString('hex')), o = ''; while (n > 0n) { o = B58[Number(n % 58n)] + o; n /= 58n; } return o; };
const j = async (p, b) => (await fetch(U + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();

async function учётка() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const address = base58(Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url'));
  const { nonce } = await j('/auth/nonce', { address });
  const msg = buildMessage(nonce, `localhost:${PORT}`, new Date().toISOString());
  const v = await j('/auth/verify', { address, message: msg, signature: sign(null, Buffer.from(msg, 'utf8'), privateKey).toString('hex') });
  if (!v.ok) throw new Error('вход не удался');
  return { token: v.token, address };
}
const гость = async () => (await j('/auth/verify', { guest: true })).token;

async function войти(token, имя, at) {
  const c = { пришло: [], snaps: [], pid: null, закрыт: null, ws: new WebSocket(`ws://localhost:${PORT}/`) };
  await new Promise((ok, fail) => {
    c.ws.addEventListener('open', () => c.ws.send(JSON.stringify({ t: 'hello', token, name: имя, at })));
    c.ws.addEventListener('close', (e) => { c.закрыт = e.code; fail(new Error('закрыто ' + e.code)); });
    c.ws.addEventListener('message', (m) => {
      const x = JSON.parse(m.data);
      if (x.t === 'snap') { c.snaps.push(x); if (c.snaps.length > 5) c.snaps.shift(); return; }
      c.пришло.push(x);
      if (x.t === 'me') c.me = x;
      if (x.t === 'bag') c.bag = x;
      if (x.t === 'welcome') { c.pid = x.pid; ok(); }
    });
    setTimeout(() => fail(new Error('нет welcome за 5 с')), 5000);
  });
  c.пульс = setInterval(() => { try { c.ws.send(JSON.stringify({ t: 'input', s: [] })); } catch { /* нет */ } }, 3000);
  c.стоп = () => { clearInterval(c.пульс); try { c.ws.close(); } catch { /* нет */ } };
  return c;
}

let живой = false;
try { живой = (await fetch(`${U}/health`)).ok; } catch { /* нет */ }
if (!живой) {
  console.log(`сервера на ${PORT} нет — мерить нечего`);
  console.log(`подними: PORT=${PORT} node server/server.js`);
  process.exit(1);
}

// ══════════════════════════════ поток переездов

log('── поток переездов');
{
  // Пока один шлёт travel без остановки, второй просто стоит в городе и считает
  // приходящие снимки. Если такт встал, это видно по ним, а не по словам.
  const зритель = await войти(await гость(), 'Зритель');
  await wait(700);
  зритель.snaps.length = 0;
  const t0 = Date.now();
  await wait(2000);
  const мирно = зритель.snaps.length;

  const буян = await войти(await гость(), 'Буян');
  зритель.snaps.length = 0;
  const до = Date.now();
  for (let i = 0; i < 400; i++) {
    буян.ws.send(JSON.stringify({ t: 'travel', at: i % 2 ? { kind: 'dungeon', floor: 5 } : { kind: 'dungeon', floor: 6 } }));
  }
  await wait(2000);
  const подНапором = зритель.snaps.length;
  log(`  снимков зрителю: спокойно ${мирно} за 2 с, под потоком ${подНапором}`);
  проверить('поток переездов не роняет такт остальным',
    подНапором >= мирно * 0.6,
    `${подНапором} против ${мирно}`,
    'один человек с консолью останавливает мир для всех в комнате');
  const отказы = буян.пришло.filter((x) => x.t === 'полно' || x.t === 'отказ' || x.why).length;
  log(`  буяну отказано ${отказы} раз из 400`);
  проверить('переезды ограничены по частоте', отказы > 0,
    `${отказы} отказов`, 'откат на переезд отсутствует');
  буян.стоп(); зритель.стоп();
  await wait(400);
  void t0; void до;
}

// ══════════════════════════════ лавка с выдуманным именем

log('');
log('── лавка с выдуманным именем');
{
  const c = await войти(await гость(), 'Скупщик');
  await wait(500);
  const было = await (await fetch(`${U}/health`)).json();
  for (let i = 0; i < 200; i++) {
    c.ws.send(JSON.stringify({ t: 'shop', npc: 'ф'.repeat(2000) + i }));
  }
  await wait(1500);
  const ассортименты = c.пришло.filter((x) => x.t === 'shop');
  log(`  двести имён по два килобайта: ассортиментов прислано ${ассортименты.length}`);
  проверить('на выдуманное имя ассортимент не собирается', ассортименты.length === 0,
    `${ассортименты.length} ассортиментов`,
    'ключ заводится под любое имя и живёт до выхода игрока — память растёт от каждого сообщения');

  // Отдельно и по одному: молчание нельзя засчитывать за отказ. Ждём именно
  // «нет такой лавки», иначе проверка зелёная и когда сообщение потерялось.
  await wait(400);
  const было2 = c.пришло.length;
  c.ws.send(JSON.stringify({ t: 'shop', npc: 'подпольная' }));
  let отказ = null;
  for (let i = 0; i < 30; i++) { await wait(50); отказ = c.пришло.slice(было2).find((x) => x.t === 'деньги' && x.act === 'shop'); if (отказ) break; }
  проверить('на выдуманное имя приходит внятный отказ', !!(отказ && отказ.ok === false),
    отказ ? отказ.why : 'комната промолчала',
    'клиент не отличит «лавки нет» от потерянного сообщения');

  // А настоящая лавка обслуживаться обязана — иначе мы просто сломали торговлю.
  await wait(400);
  const было3 = c.пришло.length;
  c.ws.send(JSON.stringify({ t: 'shop', npc: 'smith' }));
  let живая = null;
  for (let i = 0; i < 30; i++) { await wait(50); живая = c.пришло.slice(было3).find((x) => x.t === 'shop'); if (живая) break; }
  проверить('настоящая лавка по-прежнему открывается', !!(живая && Array.isArray(живая.stock) && живая.stock.length),
    живая ? `${живая.stock.length} товаров` : 'ассортимент не пришёл',
    'запретили лишнее вместе с нужным — торговля не работает');
  c.стоп();
  await wait(300);
  void было;
}

// ══════════════════════════════ слияние из одной руны

// Правило проверяем прямо на `Market`, а не через сокет.
//
// Через сокет не вышло: у свежего героя рун нет вовсе, комната отказывала
// «нужно три руны», проверка была зелёной — и мутация, снявшая обе защиты от
// дубликата, прошла насквозь. Опять зелено там, где ничего не измерено.
// С настоящей руной в рюкзаке разница между «нет руны» и «одна и та же дважды»
// становится видна.

log('');
log('── слияние из одной руны');
{
  const { installHeadless } = await import('../src/core/headless.js');
  installHeadless();
  const { Market } = await import('../server/market.js');
  const { Player } = await import('../src/entities/player.js');
  const { makeRune } = await import('../src/systems/items.js');

  const рынок = new Market(20260805);
  const p = new Player(0, 0);
  p.pid = 1; p.level = 20; p.gold = 100000;
  const руна = makeRune('whirl', 'common', 10);
  p.addItem(руна);
  const рунДо = p.inventory.filter((x) => x.kind === 'rune').length;

  const один = рынок.fuse(p, [руна.id, руна.id, руна.id]);
  log(`  одна руна трижды: ${JSON.stringify(один)}`);
  проверить('одну руну трижды не сливают', один && один.ok === false,
    один ? один.why : 'ответа нет',
    'руна повышается в редкости из самой себя — лестница до легендарной без добычи');
  проверить('руна осталась той же', p.inventory.filter((x) => x.kind === 'rune').length === рунДо
    && p.inventory.find((x) => x.id === руна.id) && p.inventory.find((x) => x.id === руна.id).rarity === 'common',
    `рун ${p.inventory.filter((x) => x.kind === 'rune').length}, редкость ${(p.inventory.find((x) => x.id === руна.id) || {}).rarity}`,
    'руна всё-таки поднялась в редкости');

  // И честное слияние обязано работать — иначе мы просто сломали кузню.
  const б = makeRune('whirl', 'common', 10), в = makeRune('whirl', 'common', 10);
  p.addItem(б); p.addItem(в);
  const честно = рынок.fuse(p, [руна.id, б.id, в.id]);
  log(`  три разные руны: ${JSON.stringify(честно)}`);
  проверить('три разные руны сливаются', !!(честно && честно.ok),
    честно ? (честно.why || честно.rarity) : 'ответа нет',
    'запретили лишнее вместе с нужным — слияние не работает');
}

// ══════════════════════════════ одна учётка в двух окнах

log('');
log('── одна учётка в двух окнах');
{
  const { token } = await учётка();
  const первое = await войти(token, 'Окно1');
  await wait(800);
  let второе = null;
  try { второе = await войти(token, 'Окно2'); } catch (e) { log(`  второе окно не пустили: ${e.message}`); }
  await wait(800);

  if (второе) {
    проверить('одна учётка не держит два соединения',
      первое.закрыт !== null,
      первое.закрыт !== null ? `первое закрыто кодом ${первое.закрыт}` : 'оба окна в мире',
      'закрытие старого окна затирает прогресс нового — игрок выбирает, какой исход оставить');
    второе.стоп();
  } else {
    проверить('одна учётка не держит два соединения', true, 'второе окно отклонено');
  }
  первое.стоп();
  await wait(300);
}

// ══════════════════════════════ захват комнаты гостями

log('');
log('── захват комнаты гостями');
{
  const потолок = Number(process.env.ROOM_MAX) || 50;
  const свои = [];
  let отказано = 0;
  for (let i = 0; i < потолок + 4; i++) {
    try { свои.push(await войти(await гость(), 'Захват' + i)); } catch { отказано++; }
    if (отказано > 2) break;
  }
  log(`  одним источником открыто ${свои.length} соединений, отказов ${отказано}`);
  проверить('одна машина не занимает комнату целиком', отказано > 0 && свои.length < потолок,
    `${свои.length} из потолка ${потолок}`,
    'полсотни гостевых сокетов с одного адреса закрывают общий город для всех');
  for (const c of свои) c.стоп();
  await wait(400);
}

console.log('');
console.log(`проверок: ${сделано}`);
if (problems.length) {
  console.log(`найдено: ${problems.length}`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('ПРОБЛЕМ НЕ НАЙДЕНО');
process.exit(0);
