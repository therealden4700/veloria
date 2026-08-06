// Бой считает сервер, а не клиент.
//
//   node tools/combat-online-check.js [порт]
//
// До этой проверки комната умела двигать героя, но урон присылал клиент готовым
// слепком — и подделать можно было всё: попадания, добычу, уровень. Здесь
// проверяется обратное: клиент говорит «махнул», а кого задело и на сколько —
// решает сервер, теми же правилами, что и одиночная игра.
//
// Стенд намеренно ведёт себя как **недобросовестный** клиент: он не считает
// попаданий вовсе и не присылает никакого урона. Если после его взмахов у врага
// убывает здоровье — значит, считает сервер. Если нет — значит, всё это время
// считал клиент, и мы ничего не перенесли.

const PORT = Number(process.argv[2] || 8123);
const URL_ = `ws://localhost:${PORT}/`;
const log = console.log;
const problems = [];
const note = (what) => problems.push(what);
const fmt = (n, d = 1) => Number(n).toFixed(d).replace('.', ',');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function guestToken() {
  const r = await fetch(`http://localhost:${PORT}/auth/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ guest: true }),
  });
  const j = await r.json();
  if (!j.ok || !j.token) throw new Error('сервер не выдал гостевой токен');
  return j.token;
}

function connect(name, token) {
  return new Promise((done, fail) => {
    const ws = new WebSocket(URL_);
    const c = { ws, name, pid: null, snaps: [], events: [], welcome: null };
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name, token }));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === 'welcome') { c.pid = m.pid; c.welcome = m; done(c); }
      else if (m.t === 'snap') {
        c.snaps.push(m); if (c.snaps.length > 60) c.snaps.shift();
        if (m.ev && m.ev.length) c.events.push(...m.ev);
      }
    };
    ws.onclose = (e) => { if (!c.welcome) fail(new Error(`комната закрыла: ${e.reason || e.code}`)); };
    setTimeout(() => fail(new Error('нет welcome за 3 с')), 3000);
  });
}

const снимок = (c) => c.snaps[c.snaps.length - 1];
const я = (c) => { const s = снимок(c); return s && s.players.find((p) => p.pid === c.pid); };

/** Идти в сторону точки, шагами того же вида, что шлёт настоящий клиент. */
async function идти(c, tx, ty, ms) {
  const до = Date.now() + ms;
  let было = Date.now();
  while (Date.now() < до) {
    await wait(50);
    const m = я(c); if (!m) continue;
    const dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy) || 1;
    if (d < 20) break;
    const now = Date.now(), dt = (now - было) / 1000; было = now;
    c.ws.send(JSON.stringify({ t: 'input', f: Math.atan2(dy, dx), s: [[dx / d, dy / d, dt]] }));
  }
}

(async () => {
  const c = await connect('Проверяющий', await guestToken());
  log(`подключились: pid ${c.pid}, мир — ${c.welcome.world.name}, врагов ${c.welcome.world.enemies}`);
  await wait(400);

  const s0 = снимок(c);
  if (!s0) { note('снимков нет вовсе'); throw new Error('комната молчит'); }
  if (!s0.enemies || !s0.enemies.length) {
    log('в этой комнате врагов нет — проверять бой не на ком');
    log('(город безопасен по устройству; для проверки нужна комната биома)');
    process.exit(0);
  }

  // ── ближайший враг
  const меня = я(c);
  const цель = s0.enemies.reduce((a, b) =>
    Math.hypot(b.x - меня.x, b.y - меня.y) < Math.hypot(a.x - меня.x, a.y - меня.y) ? b : a);
  log(`цель: ${цель.k} #${цель.i}, ${цель.hp}/${цель.mx} hp, до неё ${Math.round(Math.hypot(цель.x - меня.x, цель.y - меня.y))} px`);

  await идти(c, цель.x, цель.y, 9000);
  const после = я(c);
  log(`подошли на ${Math.round(Math.hypot(цель.x - после.x, цель.y - после.y))} px`);

  // ── бьём, не присылая никакого урона
  const было = (снимок(c).enemies.find((e) => e.i === цель.i) || {}).hp ?? 0;
  for (let i = 0; i < 12; i++) {
    const m = я(c);
    const t = (снимок(c).enemies || []).find((e) => e.i === цель.i);
    if (!t) break;
    c.ws.send(JSON.stringify({ t: 'swing', combo: i % 3, f: Math.atan2(t.y - m.y, t.x - m.x) }));
    await wait(260);
  }
  await wait(400);
  const цел = (снимок(c).enemies || []).find((e) => e.i === цель.i);
  const стало = цел ? цел.hp : 0;
  const убит = !цел;

  log('');
  log(`здоровье цели: ${было} → ${убит ? 'убита' : стало}`);
  const попаданий = c.events.filter((e) => e.t === 'hit').length;
  const промахов = c.events.filter((e) => e.t === 'dodge').length;
  const смертей = c.events.filter((e) => e.t === 'kill').length;
  log(`события от сервера: попаданий ${попаданий}, промахов ${промахов}, смертей ${смертей}`);

  if (!убит && стало >= было) note('сервер не снял здоровья — бой всё ещё у клиента');
  if (!попаданий && !смертей) note('сервер не прислал ни одного события боя');

  // ── откат: связку нельзя слать чаще, чем машет герой
  c.events.length = 0;
  const t0 = Date.now();
  for (let i = 0; i < 40; i++) c.ws.send(JSON.stringify({ t: 'swing', combo: 0, f: 0 }));
  await wait(900);
  const взмахов = c.events.filter((e) => e.t === 'swing').length;
  log(`сорок взмахов подряд за ${Date.now() - t0} мс → сервер принял ${взмахов}`);
  if (взмахов > 4) note(`откат не держит: из сорока взмахов подряд принято ${взмахов}`);

  log('');
  if (!problems.length) { log('ПРОБЛЕМ НЕ НАЙДЕНО'); process.exit(0); }
  log(`найдено: ${problems.length}`);
  for (const p of problems) log('  ' + p);
  process.exit(1);
})().catch((e) => { console.error('сбой:', e.message); process.exit(1); });
