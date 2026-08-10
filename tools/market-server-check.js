// Лавки и кузня общего мира: считает комната, а не клиент.
//
//   node tools/market-server-check.js [порт]
//
// Замер до этой работы: покупка в городе меняла только клиентскую копию —
// клиент показывал 4874 золота, мир знал про 40, и при следующем входе покупки
// не было вовсе. Тем же способом можно было объявить о чём угодно: цену,
// товар, удачную заточку.
//
// Стенд — нечестный клиент. Он не открывает окон и не смотрит на цены: он
// шлёт намерения прямо в комнату и проверяет, что она отвечает.
//
// ЧЕГО ЭТОТ СТЕНД НЕ МЕРЯЕТ. Одиночную игру: там торгует и кует клиент, и это
// нарочно — без сети игра обязана работать. И вид окон: их видно в браузере.

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
const base58 = (buf) => {
  let n = BigInt('0x' + Buffer.from(buf).toString('hex')), out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b === 0) out = '1' + out; else break; }
  return out;
};
const j = async (p, b) => (await fetch(U + p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})).json();

async function войти() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const address = base58(Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url'));
  const { nonce } = await j('/auth/nonce', { address });
  const msg = buildMessage(nonce, `localhost:${PORT}`, new Date().toISOString());
  const v = await j('/auth/verify', { address, message: msg, signature: sign(null, Buffer.from(msg, 'utf8'), privateKey).toString('hex') });
  if (!v.ok) throw new Error('вход не удался: ' + JSON.stringify(v));
  return v.token;
}

/** Клиент, который умеет ждать конкретный ответ комнаты. */
async function подключиться(token, at) {
  const c = { snaps: [], пришло: [], pid: null, ws: new WebSocket(`ws://localhost:${PORT}/`) };
  await new Promise((done, fail) => {
    c.ws.addEventListener('open', () => c.ws.send(JSON.stringify({ t: 'hello', token, name: 'Купец', at })));
    c.ws.addEventListener('close', (e) => fail(new Error(`комната закрыла связь: ${e.code} ${e.reason}`)));
    c.ws.addEventListener('message', (m) => {
      const msg = JSON.parse(m.data);
      if (msg.t === 'snap') { c.snaps.push(msg); if (c.snaps.length > 20) c.snaps.shift(); return; }
      c.пришло.push(msg);
      if (msg.t === 'me') c.me = msg;
      if (msg.t === 'bag') c.bag = msg;
      // `welcome` приходит и при переезде. Старые снимки надо выбросить: они
      // из прошлой комнаты, и по ним стенд решил бы, что в лесу нет врагов.
      if (msg.t === 'welcome') { c.pid = msg.pid; c.welcome = msg; c.snaps.length = 0; done(); }
    });
    setTimeout(() => fail(new Error('нет welcome за 5 с')), 5000);
  });
  c.спросить = async (msg, ждём) => {
    const было = c.пришло.length;
    c.ws.send(JSON.stringify(msg));
    for (let i = 0; i < 40; i++) {
      await wait(50);
      const н = c.пришло.slice(было).find((x) => x.t === ждём);
      if (н) return н;
    }
    return null;
  };
  return c;
}
const снимок = (c) => c.snaps[c.snaps.length - 1];
const я = (c) => { const s = снимок(c); return s && s.players.find((p) => p.pid === c.pid); };
async function шагать(c, dx, dy, мс) {
  const t0 = Date.now(); let было = t0;
  while (Date.now() - t0 < мс) {
    await wait(50);
    const now = Date.now(), dt = (now - было) / 1000; было = now;
    c.ws.send(JSON.stringify({ t: 'input', s: [[dx, dy, dt]], f: Math.atan2(dy, dx) }));
  }
}

let живой = false;
try { живой = (await fetch(`${U}/health`)).ok; } catch { /* нет */ }
if (!живой) {
  console.log(`сервера на ${PORT} нет — мерить нечего`);
  console.log(`подними: PORT=${PORT} RESPAWN_SEC=8 node server/server.js`);
  process.exit(1);
}

const token = await войти();

// ══════════════════════════════ лавка

log('── лавка');
const c = await подключиться(token, { kind: 'city' });
await wait(800);

const лавка = await c.спросить({ t: 'shop', npc: 'smith' }, 'shop');
проверить('ассортимент приходит от комнаты', !!(лавка && лавка.stock && лавка.stock.length),
  лавка ? `${лавка.stock.length} позиций` : 'ответа нет', 'клиент назначал бы ассортимент сам');
if (лавка && лавка.stock.length) {
  проверить('в товаре нет иконки', лавка.stock.every((i) => !i.icon), '',
    'холст с круговой ссылкой роняет разбор молча — ответ не доходит вовсе');

  const дорогой = лавка.stock.slice().sort((a, b) => b.price - a.price)[0];
  const без = await c.спросить({ t: 'buy', npc: 'smith', slot: дорогой.slot }, 'деньги');
  проверить('без золота не продаёт', !!(без && !без.ok), без ? без.why : 'ответа нет', 'продали в долг');

  const нет = await c.спросить({ t: 'buy', npc: 'smith', slot: 9999 }, 'деньги');
  проверить('несуществующий товар не продаёт', !!(нет && !нет.ok), нет ? нет.why : 'ответа нет', 'купили то, чего нет');
}

// ══════════════════════════════ зарабатываем и покупаем по-настоящему

log('');
log('── круг: заработать, купить, продать');
c.ws.send(JSON.stringify({ t: 'travel', at: { kind: 'biome', id: 'forest' } }));
await wait(2500);

// торговать вне города нельзя
const вЛесу = await c.спросить({ t: 'shop', npc: 'smith' }, 'деньги');
проверить('вне города лавки нет', !!(вЛесу && !вЛесу.ok), вЛесу ? вЛесу.why : 'ответа нет', 'торгуют посреди леса');

// Бьём нескольких: с одного врага падает десяток золотых, а самая дешёвая
// вещь у кузнеца стоит полсотни. Один прогон так и встал — «на 49 золота
// нечего купить», и это было про стенд, а не про игру.
let заработал = false;
const подойти = async (предел, к) => {
  const t0 = Date.now();
  while (Date.now() - t0 < предел) {
    const m = я(c); const t = к();
    if (!m || !t) return;
    const dx = t.x - m.x, dy = t.y - m.y, d = Math.hypot(dx, dy) || 1;
    if (d < 14) return;
    await шагать(c, dx / d, dy / d, 150);
  }
};
const убитые = new Set();
for (let раз = 0; раз < 5 && (!c.me || c.me.gold < 220); раз++) {
  const s0 = снимок(c);
  if (!s0 || !(s0.enemies || []).length) break;
  const м = я(c);
  const цель = (s0.enemies || []).filter((e) => !убитые.has(e.i)).slice()
    .sort((a, b) => Math.hypot(a.x - м.x, a.y - м.y) - Math.hypot(b.x - м.x, b.y - м.y))
    .slice(0, 6).reduce((a, b) => (b.mx < a.mx ? b : a), { mx: Infinity });
  if (!цель || цель.i === undefined) break;
  убитые.add(цель.i);
  const враг = () => (снимок(c).enemies || []).find((e) => e.i === цель.i);
  await подойти(12000, враг);
  for (let i = 0; i < 45 && враг(); i++) {
    const t = враг(), m = я(c);
    if (!t || !m) break;
    if (Math.hypot(t.x - m.x, t.y - m.y) > 20) await подойти(1500, враг);
    const t2 = враг(), m2 = я(c);
    if (!t2 || !m2) break;
    c.ws.send(JSON.stringify({ t: 'swing', combo: i % 3, f: Math.atan2(t2.y - m2.y, t2.x - m2.x) }));
    await wait(280);
  }
  await wait(400);
  for (let круг = 0; круг < 8; круг++) {
    const своя = (снимок(c).loot || []).filter((l) => l.o === c.pid);
    if (!своя.length) break;
    const l = своя[0];
    await подойти(5000, () => (снимок(c).loot || []).find((x) => x.i === l.i));
    c.ws.send(JSON.stringify({ t: 'pickup', lid: l.i }));
    await wait(350);
  }
}
заработал = !!(c.me && c.me.gold > 60);
log(`  в мире: золота ${c.me ? c.me.gold : '—'}, вещей ${c.me ? c.me.bag : '—'}`);
if (!заработал) log('  · заработать не вышло — про живой круг этот прогон ничего не говорит (бот ходит вслепую)');

c.ws.send(JSON.stringify({ t: 'travel', at: { kind: 'city' } }));
await wait(2500);

if (заработал) {
  const л2 = await c.спросить({ t: 'shop', npc: 'smith' }, 'shop');
  const по_карману = (л2.stock || []).filter((i) => i.price <= c.me.gold).sort((a, b) => a.price - b.price)[0];
  if (!по_карману) { log(`  · на ${c.me.gold} золота нечего купить — живой круг не мерили`); }
  else {
    const золотоДо = c.me.gold, вещейДо = c.me.bag;
    const r = await c.спросить({ t: 'buy', npc: 'smith', slot: по_карману.slot }, 'деньги');
    await wait(600);
    проверить('покупка проходит', !!(r && r.ok), r ? `${по_карману.name} за ${по_карману.price}` : 'ответа нет', r && r.why);
    проверить('золото списала комната', c.me.gold === золотоДо - по_карману.price,
      `${золотоДо} → ${c.me.gold}`, 'списано не столько, сколько стоит');
    проверить('вещь легла в рюкзак мира', c.me.bag === вещейДо + 1, `${вещейДо} → ${c.me.bag}`, 'вещи нет');
    проверить('рюкзак прислан клиенту', !!(c.bag && c.bag.inv && c.bag.inv.length === c.me.bag),
      c.bag ? `${c.bag.inv.length} вещей` : 'не прислан', 'клиенту нечего показать');

    // Смотрим сам прилавок, а не отказ на второй покупке: после первой золота
    // не остаётся, и отказ приходит «не хватает золота» — проверка была бы
    // зелёной и при сломанном правиле. Так и вышло на ломке.
    const л3 = await c.спросить({ t: 'shop', npc: 'smith' }, 'shop');
    const ещёТам = (л3 && л3.stock || []).some((i) => i.slot === по_карману.slot);
    проверить('купленное уходит с прилавка', !ещёТам,
      `на прилавке ${(л3 && л3.stock || []).length} позиций`,
      'один и тот же товар можно брать без конца');

    // продаём обратно
    const вещь = (c.bag.inv || []).find((i) => i && i.name === по_карману.name) || (c.bag.inv || [])[0];
    if (вещь) {
      const золото2 = c.me.gold;
      const s = await c.спросить({ t: 'sell', id: вещь.id }, 'деньги');
      await wait(600);
      проверить('продажа проходит', !!(s && s.ok), s && s.ok ? `+${s.gold} золота` : (s ? s.why : 'ответа нет'));
      проверить('золото прибавила комната', c.me.gold > золото2, `${золото2} → ${c.me.gold}`, 'золота не прибавилось');
    }
    const чужое = await c.спросить({ t: 'sell', id: 987654 }, 'деньги');
    проверить('чужое не продать', !!(чужое && !чужое.ok), чужое ? чужое.why : 'ответа нет', 'продали то, чего нет');
  }
}

// ══════════════════════════════ удачные пути — в процессе
//
// По сети удачную покупку можно проверить, только сперва заработав, а
// зарабатывает бот вслепую: один прогон из нескольких он просто не находит,
// кого бить. Постоянно краснеющий стенд хуже отсутствующего, поэтому «купил,
// сковал, заточил» меряем прямо на правилах комнаты — там ничего не зависит от
// того, куда он забрёл. По сети остаются отказы и живой круг как наблюдение.
{
  const { installHeadless } = await import('../src/core/headless.js');
  installHeadless();
  const { prepareArt } = await import('../server/world.js');
  prepareArt();
  const { Market } = await import('../server/market.js');
  const { Player } = await import('../src/entities/player.js');
  const { makeItem, makeMaterial, makeRune } = await import('../src/systems/items.js');

  const m = new Market(20260805);
  const p = new Player(0, 0);
  p.pid = 1; p.level = 20; p.gold = 100000;

  const ст = m.ассортимент(p, 'smith');
  const было = p.gold, вещей = p.inventory.length;
  const r1 = m.buy(p, 'smith', ст[0].slot);
  проверить('покупка списывает ровно цену', !!(r1.ok && p.gold === было - ст[0].price),
    `${было} → ${p.gold} за ${ст[0].price}`, 'списано не столько');
  проверить('вещь попадает в рюкзак', p.inventory.length === вещей + 1, `${вещей} → ${p.inventory.length}`);
  проверить('купленное уходит с прилавка (в процессе)',
    !m.ассортимент(p, 'smith').some((x) => x.slot === ст[0].slot),
    `осталось ${m.ассортимент(p, 'smith').length}`, 'товар можно брать без конца');

  const золото2 = p.gold;
  const r2 = m.sell(p, p.inventory[p.inventory.length - 1].id);
  проверить('продажа возвращает золото', !!(r2.ok && p.gold > золото2), `${золото2} → ${p.gold}`);

  for (const k of ['ironOre', 'silverOre', 'herbBundle', 'dragonScale', 'fang', 'hide', 'essence',
    'runeCore', 'boneDust', 'iceShard', 'ember', 'bogHeart', 'slimeGel']) p.addItem(makeMaterial(k, 40));
  const меч = makeItem({ kind: 'weapon', sub: 'sword', level: 20, rarity: 'rare' });
  p.equip(меч);
  const топливо = [];
  for (let i = 0; i < 3; i++) { const f = makeItem({ kind: 'weapon', sub: 'axe', level: 20, rarity: 'rare' }); p.addItem(f); топливо.push(f.id); }
  const r3 = m.sharpen(p, топливо);
  проверить('заточка проходит и съедает топливо', !!(r3.ok && !p.inventory.some((i) => топливо.includes(i.id))),
    r3.ok ? r3.what : r3.why, 'топливо осталось в рюкзаке');
  проверить('тем же топливом второй раз нельзя', !m.sharpen(p, топливо).ok, '', 'одно оружие сгорело дважды');

  const руны = [];
  for (let i = 0; i < 3; i++) { const r = makeRune('firewall', 'common', 5); p.addItem(r); руны.push(r.id); }
  const r4 = m.fuse(p, руны);
  проверить('слияние даёт следующий ранг', !!(r4.ok && r4.rarity === 'uncommon'), r4.ok ? r4.rarity : r4.why);
}

// ══════════════════════════════ кузня
log('');
log('── кузня');
const крив = await c.спросить({ t: 'craft', cat: 'weapon', sub: 'sword', idx: 9999 }, 'деньги');
проверить('чужой рецепт не куётся', !!(крив && !крив.ok), крив ? крив.why : 'ответа нет', 'выковали несуществующее');
const пусто = await c.спросить({ t: 'sharpen', fuel: [1, 2, 3] }, 'деньги');
проверить('заточка чужим топливом не проходит', !!(пусто && !пусто.ok), пусто ? пусто.why : 'ответа нет', 'заточили тем, чего нет');
const рун = await c.спросить({ t: 'fuse', ids: [1, 2, 3] }, 'деньги');
проверить('слияние из ничего не проходит', !!(рун && !рун.ok), рун ? рун.why : 'ответа нет', 'слили руны из воздуха');

// ══════════════════════════════ иконки не должны уезжать по сети
//
// Отдельной проверкой, а не только у ассортимента: холст с круговой ссылкой
// роняет `JSON.stringify`, а он стоит в рассылке — падает не одно сообщение, а
// весь такт, и снимка не получает никто в комнате. Ловилось это только по
// строчке «сбой такта» в логе сервера.
{
  const есть = (o, глубина = 0) => {
    if (!o || typeof o !== 'object' || глубина > 6) return false;
    if ('icon' in o && o.icon) return true;
    return Object.values(o).some((v) => есть(v, глубина + 1));
  };
  const грязные = c.пришло.filter(есть).map((m) => m.t);
  проверить('в сообщениях нет иконок', !грязные.length,
    `просмотрено ${c.пришло.length} сообщений`, `иконка едет в: ${[...new Set(грязные)].join(', ')}`);
}

c.ws.close();

console.log('');
console.log(`проверок: ${сделано}`);
if (problems.length) {
  console.log(`найдено: ${problems.length}`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('ПРОБЛЕМ НЕ НАЙДЕНО');
process.exit(0);
