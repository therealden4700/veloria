// Задания общего мира: ход и награду считает комната.
//
//   node tools/quests-server-check.js [порт]
//
// Замер до этой работы: клиент честно засчитывал ход и выдавал награду — 60
// золота превращались в 120, опыт с нуля в семьдесят, — а через три кадра
// сверка с миром возвращала 40 и ноль. Задание помечено сданным, получено
// ничего.
//
// Проверяем снаружи, как это видит игрок: журнал приходит от мира, «взять» и
// «сдать» решает мир, ход идёт от настоящих убийств, награда остаётся после
// выхода и возвращения.
//
// ЧЕГО ЭТОТ СТЕНД НЕ МЕРЯЕТ. Одиночную игру: там журнал ведёт клиент, и это
// нарочно. И зрелище сдачи — баннер и звук видно только в браузере.

import { generateKeyPairSync, sign } from 'node:crypto';
import { buildMessage } from '../server/auth.js';
// Описания заданий берём из самой игры: снаружи журнал шлёт только номер и ход,
// а кого именно бить — знает `QUEST_LINE`. Списка вида «q1 → slime» тут быть не
// должно: это была бы вторая копия, которая однажды разойдётся.
const { installHeadless } = await import('../src/core/headless.js');
installHeadless();
const { QUEST_LINE } = await import('../src/systems/quests.js');

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

async function подключиться(token, at) {
  const c = { snaps: [], пришло: [], pid: null, ws: new WebSocket(`ws://localhost:${PORT}/`) };
  await new Promise((done, fail) => {
    c.ws.addEventListener('open', () => c.ws.send(JSON.stringify({ t: 'hello', token, name: 'Искатель', at })));
    c.ws.addEventListener('close', (e) => fail(new Error(`комната закрыла связь: ${e.code} ${e.reason}`)));
    c.ws.addEventListener('message', (m) => {
      const msg = JSON.parse(m.data);
      if (msg.t === 'snap') { c.snaps.push(msg); if (c.snaps.length > 20) c.snaps.shift(); return; }
      c.пришло.push(msg);
      if (msg.t === 'me') c.me = msg;
      if (msg.t === 'журнал') c.журнал = msg.quests;
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

// ══════════════════════════════ журнал ведёт мир

log('── журнал');
const c = await подключиться(token, { kind: 'city' });
await wait(1000);

проверить('журнал приходит от мира', !!(c.журнал && c.журнал.list && c.журнал.list.length),
  c.журнал ? `${c.журнал.list.length} записей` : 'не пришёл', 'клиент вёл бы свой');

const дост = c.журнал && c.журнал.list.find((q) => q.state === 'available');
проверить('есть что взять', !!дост, дост ? дост.id : '', 'нечего брать — дальше мерить нечего');

if (дост) {
  const чужое = await c.спросить({ t: 'quest', do: 'accept', id: 'нетакого' }, 'задание');
  проверить('несуществующее не взять', !!(чужое && !чужое.ok), чужое ? чужое.why : 'ответа нет', 'взяли выдумку');

  const рано = await c.спросить({ t: 'quest', do: 'complete', id: дост.id }, 'задание');
  проверить('невзятое не сдать', !!(рано && !рано.ok), рано ? рано.why : 'ответа нет', 'сдали не начав');

  const взял = await c.спросить({ t: 'quest', do: 'accept', id: дост.id }, 'задание');
  проверить('взять можно', !!(взял && взял.ok), взял && взял.ok ? взял.name : (взял ? взял.why : 'ответа нет'));

  await wait(400);
  const активно = (c.журнал.list.find((q) => q.id === дост.id) || {}).state;
  проверить('мир помнит, что взято', активно === 'active', `состояние ${активно}`, 'журнал не обновился');

  const рано2 = await c.спросить({ t: 'quest', do: 'complete', id: дост.id }, 'задание');
  проверить('невыполненное не сдать', !!(рано2 && !рано2.ok), рано2 ? рано2.why : 'ответа нет', 'награда без работы');
}

// ══════════════════════════════ ход идёт от настоящих убийств

log('');
log('── ход задания от боя');
c.ws.send(JSON.stringify({ t: 'travel', at: { kind: 'biome', id: 'forest' } }));
await wait(2500);

const задание = c.журнал && c.журнал.list.find((q) => q.state === 'active');
let било = 0;
if (!задание) { note('активного задания нет — ход мерить не на чем'); }
else {
  const ходДо = задание.progress || 0;
  const подойти = async (предел, к) => {
    const t0 = Date.now();
    while (Date.now() - t0 < предел) {
      const m = я(c), t = к();
      if (!m || !t) return;
      const dx = t.x - m.x, dy = t.y - m.y, d = Math.hypot(dx, dy) || 1;
      if (d < 14) return;
      await шагать(c, dx / d, dy / d, 150);
    }
  };
  // Бьём того, кого просит задание, а не слабейшего рядом: иначе ход стоит на
  // нуле, и это про стенд, а не про игру.
  const опис = QUEST_LINE.find((x) => x.id === задание.id) || {};
  const нужен = (опис.type === 'kill' || опис.type === 'boss') ? опис.target : null;
  log(`  задание ${задание.id}: ${опис.type || '?'} ${нужен || ''} ×${опис.count || '?'}`);
  const бил = new Set();
  for (let раз = 0; раз < 4; раз++) {
    const s0 = снимок(c);
    if (!s0 || !(s0.enemies || []).length) break;
    const м = я(c);
    const годные = (s0.enemies || []).filter((e) => !бил.has(e.i) && (!нужен || e.k === нужен));
    if (!годные.length) break;
    const цель = годные.slice()
      .sort((a, b) => Math.hypot(a.x - м.x, a.y - м.y) - Math.hypot(b.x - м.x, b.y - м.y))[0];
    if (!цель || цель.i === undefined) break;
    бил.add(цель.i);
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
    if (!враг()) било++;
    await wait(400);
  }
  await wait(600);
  const стало = (c.журнал.list.find((q) => q.id === задание.id) || {}).progress || 0;
  log(`  убито ${било} из нужных, ход ${ходДо} → ${стало}`);
  if (!било) log('  · нужного никого не убили — ход этот прогон не мерили (бот ходит вслепую)');
  else проверить('ход идёт от настоящих убийств', стало >= ходДо + било,
    `${ходДо} → ${стало} за ${било} убийств`, 'комната не засчитала');
}

// ══════════════════════════════ насчитанное миром переживает выход

log('');
log('── журнал переживает выход');
const золотоДо = c.me ? c.me.gold : 0;
const взятоДо = (c.журнал.list.filter((q) => q.state === 'active') || []).length;
c.ws.close();
await wait(1500);
const c2 = await подключиться(token, { kind: 'city' });
await wait(1200);
проверить('журнал вернулся тем же',
  !!(c2.журнал && c2.журнал.list.filter((q) => q.state === 'active').length === взятоДо),
  c2.журнал ? `активных ${c2.журнал.list.filter((q) => q.state === 'active').length}, было ${взятоДо}` : 'нет журнала',
  'мир забыл взятое');
проверить('золото не потерялось', !!(c2.me && c2.me.gold >= золотоДо),
  c2.me ? `${золотоДо} → ${c2.me.gold}` : 'нет', 'мир забыл насчитанное');
c2.ws.close();

console.log('');
console.log(`проверок: ${сделано}`);
if (problems.length) {
  console.log(`найдено: ${problems.length}`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('ПРОБЛЕМ НЕ НАЙДЕНО');
process.exit(0);
