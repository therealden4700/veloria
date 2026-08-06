// Проверка того, что мир считает сервер, а не клиент.
//
//   node tools/world-check.js [порт]
//
// Три вопроса, на которые надо ответить «да»:
//   1. видят ли игроки друг друга в снимках;
//   2. двигает ли сервер героя по намерению, а не по присланной координате;
//   3. отказывается ли он вести героя сквозь стену.

const PORT = Number(process.argv[2] || 8123);
const URL_ = `ws://localhost:${PORT}/`;
const log = console.log;

/**
 * Токен гостя.
 *
 * Комната перестала пускать по одному имени, когда появились учётные записи:
 * без токена соединение закрывается кодом 1008 ещё до `welcome`. Проверка при
 * этом валилась с «нет welcome за 3 с» — то есть сообщала о симптоме и молчала
 * о причине. Берём гостевой токен тем же путём, которым его берёт титульный
 * экран, и проверяем ровно то, что собирались: считает ли мир сервер.
 */
async function guestToken() {
  const r = await fetch(`http://localhost:${PORT}/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ guest: true }),
  });
  const j = await r.json();
  if (!j.ok || !j.token) throw new Error('сервер не выдал гостевой токен');
  return j.token;
}

function connect(name, token) {
  return new Promise((done, fail) => {
    const ws = new WebSocket(URL_);
    const c = { ws, name, pid: null, snaps: [], welcome: null };
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name, token }));
    ws.onclose = (ev) => { if (!c.welcome) fail(new Error(`комната закрыла соединение: ${ev.reason || ev.code}`)); };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === 'welcome') { c.pid = m.pid; c.welcome = m; done(c); }
      else if (m.t === 'snap') { c.snaps.push(m); if (c.snaps.length > 40) c.snaps.shift(); }
    };
    ws.onerror = () => fail(new Error('не подключиться — сервер запущен?'));
    setTimeout(() => fail(new Error('нет welcome за 3 с')), 3000);
  });
}

const me = (c) => {
  const s = c.snaps[c.snaps.length - 1];
  return s && s.players.find((p) => p.pid === c.pid);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Держать направление.
 *
 * Комната принимает не «иду туда», а список отыгранных шагов `[mx, my, dt]`:
 * так появился бюджет времени против ускорителя. Инструмент слал старую форму
 * без `s`, и `applyInput` выходил на первой же строке — герой честно стоял на
 * месте, а проверка объявляла «сервер не двигает героя». Ошибка была в мерке,
 * а не в сервере; поэтому здесь шлём ровно то, что шлёт клиент.
 */
async function hold(c, mx, my, ms) {
  const until = Date.now() + ms;
  let last = Date.now();
  while (Date.now() < until) {
    await wait(50);
    const now = Date.now();
    const dt = (now - last) / 1000;
    last = now;
    c.ws.send(JSON.stringify({ t: 'input', f: Math.atan2(my, mx), s: [[mx, my, dt]] }));
  }
  c.ws.send(JSON.stringify({ t: 'input', s: [[0, 0, 0.05]] }));
  await wait(200);
}

(async () => {
  const token = await guestToken();
  const a = await connect('Первый', token);
  const b = await connect('Второй', await guestToken());
  log(`подключились: ${a.name}=${a.pid}, ${b.name}=${b.pid}`);
  log(`мир: ${a.welcome.world.name} ${a.welcome.world.w}×${a.welcome.world.h}, ` +
      `спавн (${a.welcome.world.spawn.x},${a.welcome.world.spawn.y}), врагов ${a.welcome.world.enemies}`);

  await wait(400);
  const seesB = (a.snaps.at(-1)?.players || []).some((p) => p.pid === b.pid);
  const seesA = (b.snaps.at(-1)?.players || []).some((p) => p.pid === a.pid);
  log(`видят друг друга: ${a.name}→${b.name} ${seesB ? 'да' : 'НЕТ'}, ${b.name}→${a.name} ${seesA ? 'да' : 'НЕТ'}`);

  const start = me(a);
  log(`спавн ${a.name}: (${start.x},${start.y})`);

  // 1. идём вправо — сервер должен двигать
  await hold(a, 1, 0, 1500);
  const right = me(a);
  log(`после 1,5 с вправо: (${right.x},${right.y}) — сдвиг ${right.x - start.x} px`);

  // 2. пробуем прислать координату вместо намерения: сервер обязан её не заметить
  a.ws.send(JSON.stringify({ t: 'input', x: 40, y: 40, mx: 0, my: 0 }));
  await wait(300);
  const cheat = me(a);
  log(`попытка телепорта в (40,40): герой в (${cheat.x},${cheat.y}) — ` +
      (Math.abs(cheat.x - 40) > 50 ? 'отклонено, правильно' : 'ПРОШЛО, это дыра'));

  // 3. упираемся в край карты — за границу выйти нельзя
  await hold(a, -1, 0, 6000);
  const wall = me(a);
  log(`после 6 с влево: (${wall.x},${wall.y}) — в пределах карты: ` +
      (wall.x >= 0 && wall.x <= a.welcome.world.w * 16 ? 'да' : 'НЕТ'));

  // 4. второй игрок ходит независимо
  await hold(b, 0, 1, 1200);
  const bb = me(b);
  log(`${b.name} после 1,2 с вниз: (${bb.x},${bb.y}) — сдвиг ${bb.y - start.y} px`);
  log(`${a.name} видит ${b.name} там же: ` +
      JSON.stringify((a.snaps.at(-1).players.find((p) => p.pid === b.pid)) || null));

  a.ws.close(); b.ws.close();
  setTimeout(() => process.exit(0), 300);
})().catch((e) => { console.error('сбой:', e.message); process.exit(1); });
