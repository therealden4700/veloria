// Прогресс считает мир, а не присылает клиент.
//
//   node tools/progress-server-check.js [порт]
//
// Стенд написан как нечестный клиент с настоящей учёткой: он входит по подписи
// — точно так же, как это делает Phantom, — и просит у сервера то, чего не
// зарабатывал. Замер до этой работы: попросил легендарку с атакой 9999 и девять
// миллионов золота, сервер положил это в базу и вернул при следующем входе.
//
// Проверяется четыре вещи, и все — снаружи, как их видит игрок:
//   1. выпрошенное не входит в общий мир;
//   2. добычу роняет комната, и она знает, чья;
//   3. поднять можно только своё и только вблизи;
//   4. то, что насчитал мир, переживает выход и возвращение.
//
// ЧЕГО ЭТОТ СТЕНД НЕ МЕРЯЕТ. Одиночную игру: там прогресс по-прежнему ведёт
// клиент, и это нарочно — играть без сети игра обязана. Резервная копия
// одиночного героя живёт отдельной колонкой и в мир не входит никогда.

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
function base58Encode(buf) {
  let n = BigInt('0x' + Buffer.from(buf).toString('hex'));
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of buf) { if (b === 0) out = '1' + out; else break; }
  return out;
}
const j = async (p, b) => (await fetch(U + p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})).json();

/** Настоящий кошелёк: то же, что делает Phantom, только своими руками. */
async function войти() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const address = base58Encode(Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url'));
  const пустить = async () => {
    const { nonce } = await j('/auth/nonce', { address });
    const msg = buildMessage(nonce, `localhost:${PORT}`, new Date().toISOString());
    return j('/auth/verify', { address, message: msg, signature: sign(null, Buffer.from(msg, 'utf8'), privateKey).toString('hex') });
  };
  const v = await пустить();
  if (!v.ok) throw new Error('вход не удался: ' + JSON.stringify(v));
  return { address, token: v.token, пустить, character: v.character };
}

/** Соединение с комнатой: снимки и события, как у настоящего клиента. */
async function вКомнату(token, at) {
  const c = { snaps: [], events: [], pid: null, ws: new WebSocket(`ws://localhost:${PORT}/`) };
  await new Promise((done, fail) => {
    c.ws.addEventListener('open', () => c.ws.send(JSON.stringify({ t: 'hello', token, name: 'Проба', at })));
    c.ws.addEventListener('close', (e) => fail(new Error(`комната закрыла связь: ${e.code} ${e.reason}`)));
    c.ws.addEventListener('message', (m) => {
      const msg = JSON.parse(m.data);
      if (msg.t === 'snap') { c.snaps.push(msg); if (c.snaps.length > 30) c.snaps.shift(); for (const e of msg.ev || []) c.events.push(e); return; }
      (c.пришло ||= []).push(msg);
      if (msg.t === 'welcome') { c.pid = msg.pid; c.welcome = msg; done(); }
    });
    setTimeout(() => fail(new Error('нет welcome за 5 с')), 5000);
  });
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

// ══════════════════════════════ 1. выпрошенное не входит в мир

log('── нечестный клиент просит');
const чит = await войти();
const выпрошено = {
  kind: 'weapon', sub: 'sword', tier: 6, rarity: 'legendary', unique: 'frostHeart',
  id: 1, level: 60, name: 'Выпрошенный клинок', stats: { atk: 9999 }, price: 1,
};
const ответ = await j('/char/save', {
  token: чит.token, name: 'Нечестный',
  data: { player: { level: 40, gold: 9999999, str: 60, vit: 60, agi: 60, int: 60,
    equipment: { weapon: выпрошено }, inventory: [выпрошено] } },
});
log(`  /char/save ответил: ${JSON.stringify(ответ)}`);

const c1 = await вКомнату(чит.token, { kind: 'city' });
await wait(1200);
const герой = я(c1);
проверить('выпрошенный уровень в мир не вошёл', герой && герой.lvl <= 1, герой ? `ур ${герой.lvl}` : 'нет героя', 'слепок клиента стал героем мира');
проверить('выпрошенное здоровье в мир не вошло', герой && герой.hp < 300, герой ? `${герой.hp} hp` : '—', 'характеристики взяты из слепка');
// Внешность в снимке больше не ездит — она приходит один раз сообщением
// «кто». Ищем её там.
const себя = (c1.пришло || []).filter((m) => m.t === 'кто').flatMap((m) => m.players || []).find((p) => p.pid === c1.pid);
const ранг = себя && себя.look ? (себя.look.weaponTier | 0) : 0;
проверить('выпрошенное оружие в мир не вошло', ранг === 0, `ранг ${ранг}`, 'вещь из слепка надета в мире');
c1.ws.close();
await wait(300);

// ══════════════════════════════ 2-3. добыча комнаты: чья и с какого расстояния

log('');
log('── добыча общего мира');
const боец = await войти();
const c2 = await вКомнату(боец.token, { kind: 'biome', id: 'forest' });
await wait(1500);
if (!снимок(c2)) { note('после входа в биом нет снимков'); }
else {
  const м = я(c2);
  const ближние = (снимок(c2).enemies || []).slice()
    .sort((a, b) => Math.hypot(a.x - м.x, a.y - м.y) - Math.hypot(b.x - м.x, b.y - м.y)).slice(0, 6);
  // Слабейший из ближних: герой мира начинает первым уровнем, и ближайшим
  // часто оказывается щитоносец, которого он не пробьёт. Мы меряем добычу, а
  // не бой.
  const цель = ближние.reduce((a, b) => (b.mx < a.mx ? b : a));
  // Подходим и бьём. Подход — отдельным циклом: если тратить на него попытки
  // взмаха, до самого удара дело может и не дойти, а стенд потом скажет «не
  // убили» — и это будет про него, а не про игру.
  const подойти = async (предел) => {
    const t0 = Date.now();
    // Идти прямо на цель мало: между ботом и врагом бывает дерево, и упор в
    // него выглядит как «бой ничего не дал». Стенд при этом краснеет на пустом
    // месте — это про него, а не про игру. Если расстояние перестало
    // сокращаться, берём вбок и обходим. Тот же приём, что в `together-check`,
    // где эта беда нашлась впервые.
    let лучшее = Infinity, застрял = 0;
    while (Date.now() - t0 < предел) {
      const t = (снимок(c2).enemies || []).find((e) => e.i === цель.i);
      const m = я(c2);
      if (!t || !m) return;
      const dx = t.x - m.x, dy = t.y - m.y, d = Math.hypot(dx, dy) || 1;
      if (d < 16) return;
      if (d < лучшее - 2) { лучшее = d; застрял = 0; } else застрял++;
      if (застрял >= 8) {
        застрял = 0; лучшее = Infinity;
        const бок = (Date.now() % 2 === 0) ? 1 : -1;
        await шагать(c2, (-dy / d) * бок, (dx / d) * бок, 700);
        continue;
      }
      await шагать(c2, dx / d, dy / d, 150);
    }
  };
  await подойти(15000);
  for (let i = 0; i < 45; i++) {
    const t = (снимок(c2).enemies || []).find((e) => e.i === цель.i);
    const m = я(c2);
    if (!t || !m) break;
    if (Math.hypot(t.x - m.x, t.y - m.y) > 20) await подойти(1500);
    const t2 = (снимок(c2).enemies || []).find((e) => e.i === цель.i), m2 = я(c2);
    if (!t2 || !m2) break;
    c2.ws.send(JSON.stringify({ t: 'swing', combo: i % 3, f: Math.atan2(t2.y - m2.y, t2.x - m2.x) }));
    await wait(300);
  }
  await wait(600);
  const убит = !(снимок(c2).enemies || []).find((e) => e.i === цель.i);
  log(`  цель ${цель.k}: ${убит ? 'убита' : 'выжила'}`);
  if (!убит) { note('не смогли убить — про добычу этот прогон ничего не говорит'); }
  else {
    const добыча = (снимок(c2).loot || []);
    проверить('комната уронила добычу', добыча.length > 0, `на земле ${добыча.length}`, 'после убийства на земле пусто');
    const своя = добыча.filter((l) => l.o === c2.pid);
    проверить('у добычи есть хозяин', своя.length > 0, `своих ${своя.length} из ${добыча.length}`, 'добыча ничья с самого начала');

    if (своя.length) {
      const l = своя[0];
      // Отходим нарочно: добыча падает под ноги, и без этого проверка
      // «издалека не отдаёт» просто не выполнялась бы — а сломать её тогда
      // можно незаметно (проверено ломкой: убрал проверку расстояния — стенд
      // остался зелёным).
      for (let i = 0; i < 8; i++) {
        const m = я(c2);
        if (!m || Math.hypot(l.x - m.x, l.y - m.y) > 70) break;
        const a = Math.atan2(m.y - l.y, m.x - l.x) || 0;
        await шагать(c2, Math.cos(a), Math.sin(a), 400);
      }
      const было = я(c2);
      const далеко = Math.hypot(l.x - было.x, l.y - было.y);
      if (далеко > 40) {
        c2.ws.send(JSON.stringify({ t: 'pickup', lid: l.i }));
        await wait(400);
        const ещё = (снимок(c2).loot || []).find((x) => x.i === l.i);
        проверить('издалека не отдаёт', !!ещё, `до неё ${Math.round(далеко)} px`, 'подняли, не подходя');
      } else {
        note(`не смогли отойти от добычи дальше ${Math.round(далеко)} px — проверку «издалека» не мерили`);
      }
      // подходим и берём
      for (let i = 0; i < 20; i++) {
        const m = я(c2);
        const dx = l.x - m.x, dy = l.y - m.y, d = Math.hypot(dx, dy) || 1;
        if (d < 14) break;
        await шагать(c2, dx / d, dy / d, 200);
      }
      c2.ws.send(JSON.stringify({ t: 'pickup', lid: l.i }));
      await wait(600);
      const взято = c2.events.filter((e) => e.t === 'took' && e.lid === l.i);
      проверить('вблизи отдаёт', взято.length > 0, взято.length ? (взято[0].gold ? `+${взято[0].gold} золота` : 'вещь') : '', 'подойти и взять не вышло');
    }
  }

  // ══════════════════════════════ 4. насчитанное миром переживает выход
  log('');
  log('── то, что насчитал мир');
  // Своё состояние комната шлёт каждому отдельно — по нему и сверяем.
  const своё = (c) => new Promise((done) => {
    const h = (m) => { const x = JSON.parse(m.data); if (x.t === 'me') { c.ws.removeEventListener('message', h); done(x); } };
    c.ws.addEventListener('message', h);
    setTimeout(() => done(null), 3000);
  });
  const до = await своё(c2);
  log(`  в мире: золота ${до ? до.gold : '—'}, опыта ${до ? до.xp : '—'}, в рюкзаке ${до ? до.bag : '—'}`);
  c2.ws.close();
  await wait(1500);          // комната пишет при уходе

  const c3 = await вКомнату(боец.token, { kind: 'city' });
  const после = await своё(c3);
  проверить('герой мира вернулся тем же',
    !!(до && после && после.gold === до.gold && после.xp === до.xp && после.bag === до.bag),
    после ? `золота ${после.gold}, опыта ${после.xp}, в рюкзаке ${после.bag}` : 'нет ответа',
    'мир забыл, что насчитал');
  проверить('насчитанное миром не нулевое', !!(до && (до.gold > 40 || до.xp > 0)),
    до ? `золота ${до.gold}, опыта ${до.xp}` : '—', 'бой ничего не дал — сверять нечего');
  c3.ws.close();
}

// ══════════════════════════════ доска — про мир, а не про копии
log('');
const доска = await (await fetch(`${U}/leaderboard`)).json();
const врун = (доска.top || []).find((r) => r.level >= 40);
проверить('в доске нет выпрошенных уровней', !врун, `записей ${(доска.top || []).length}`, `на доске уровень ${врун && врун.level} из клиентской копии`);

console.log('');
console.log(`проверок: ${сделано}`);
if (problems.length) {
  console.log(`найдено: ${problems.length}`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('ПРОБЛЕМ НЕ НАЙДЕНО');
process.exit(0);
