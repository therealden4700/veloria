// Нагрузка на комнату: пятьдесят соединений, как обещано на старте.
//
//   node tools/ws-load.js [сколько] [секунд] [порт]
//
// Меряется то, что болит в сети на самом деле: сколько соединений дошло, за
// какое время, какая задержка отклика и не теряются ли такты. Клиент берётся
// встроенный в Node — зависимостей по-прежнему ноль.
//
// ВАЖНО ПРО ПРЕДЕЛ НА ИСТОЧНИК. Комната пускает с одного адреса не больше
// `PER_IP_MAX` соединений (по умолчанию шесть): полсотни гостевых сокетов с
// одной машины иначе занимают общий город целиком, и это отдельно проверяет
// `abuse-check`. Здесь же все пятьдесят идут именно с одной машины, поэтому
// сервер под этот замер поднимают с поднятым пределом:
//
//   PORT=8123 ROOM_MAX=60 PER_IP_MAX=60 node server/server.js
//
// Без этого стенд померяет не вес рассылки, а собственный предел, — и скажет
// об этом прямо, а не покажет красивые цифры на шести выживших.

const N = Number(process.argv[2] || 50);
const SECONDS = Number(process.argv[3] || 10);
const PORT = Number(process.argv[4] || 8123);
const URL_ = `ws://localhost:${PORT}/`;
// «толпа» — все стоят в одной точке (площадь в городе); иначе расходятся.
const РАЗБРЕСТИСЬ = process.argv[5] !== 'толпа';

if (typeof WebSocket === 'undefined') {
  console.error('в этом Node нет встроенного WebSocket — нужен Node 22 и новее');
  process.exit(1);
}

const rtt = [];
// Токен нужен так же, как настоящему клиенту. Без него комната закрывает
// связь кодом 1008 — и стенд, который слал `hello` без токена, тихо получал
// ноль снимков из восьми тысяч и всё равно выходил с нулём. Зелёный стенд,
// который ничего не мерит, хуже красного: к красному хотя бы приглядываются.
async function токен() {
  const r = await fetch(`http://localhost:${PORT}/auth/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ guest: true }),
  });
  const j = await r.json();
  if (!j.token) throw new Error('комната не выдала токен: ' + JSON.stringify(j));
  return j.token;
}

const clients = [];
let connected = 0, failed = 0, snaps = 0, gaps = 0, байт = 0;
const t0 = Date.now();

function spawn(i, token) {
  return new Promise((done) => {
    const ws = new WebSocket(URL_);
    const c = { ws, pid: null, lastTick: 0, connectedAt: 0 };
    let settled = false;
    const finish = () => { if (!settled) { settled = true; done(c); } };

    ws.onopen = () => {
      c.connectedAt = Date.now() - t0;
      connected++;
      ws.send(JSON.stringify({ t: 'hello', token, name: 'бот-' + i }));
      finish();
    };
    ws.onerror = () => { failed++; finish(); };
    ws.onclose = (e) => { if (!c.закрыт) c.закрыт = (e && e.code) + ' ' + ((e && e.reason) || ''); finish(); };
    ws.onmessage = (ev) => {
      байт += (typeof ev.data === 'string' ? ev.data.length : 0);
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'welcome') c.pid = m.pid;
      else if (m.t === 'snap') {
        snaps++;
        if (c.lastTick && m.tick !== c.lastTick + 1) gaps++;
        c.lastTick = m.tick;
      } else if (m.t === 'pong') {
        rtt.push(Date.now() - m.c);
      }
    };
    setTimeout(finish, 4000);
  });
}

const q = (arr, p) => (arr.length ? arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))] : -1);

(async () => {
  // Каждому свой токен: гостевой вход выдаёт сессию без вопросов, а один токен
  // на всех — это один и тот же игрок, и комната имеет право так не считать.
  for (let i = 0; i < N; i++) clients.push(await spawn(i, await токен()));
  const connMs = Date.now() - t0;
  console.log(`подключено ${connected} из ${N}${failed ? `, отказов ${failed}` : ''}, за ${connMs} мс`);

  // Шлём ввод как настоящий клиент: список отыгранных ШАГОВ, а не координату.
  // Комната принимает только шаги — так работает защита от ускорителей, — и
  // стенд, слоавший `{x, y}`, не двигал ботов вовсе: все пятьдесят стояли в
  // точке входа. Замер «области интереса ничего не дали» был про это.
  //
  // Каждый идёт в свою сторону: полсотни человек в одной точке — не тот мир,
  // ради которого пишут области интереса. Толпу меряем отдельно.
  let step = 0;
  let было = Date.now();
  const send = setInterval(() => {
    step++;
    const now = Date.now(), dt = Math.min(0.1, (now - было) / 1000);
    было = now;
    for (let i = 0; i < clients.length; i++) {
      const c = clients[i];
      if (c.ws.readyState !== 1) continue;
      const a = РАЗБРЕСТИСЬ ? (i / clients.length) * Math.PI * 2 : step / 20 + c.connectedAt;
      c.ws.send(JSON.stringify({ t: 'input', s: [[Math.cos(a), Math.sin(a), dt]], f: a }));
      if (step % 20 === 0) c.ws.send(JSON.stringify({ t: 'ping', c: Date.now() }));
    }
  }, 50);

  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  clearInterval(send);

  const live = clients.filter((c) => c.ws.readyState === 1).length;
  const expect = connected * SECONDS * 20;
  console.log(`живых к концу: ${live} из ${connected}`);
  console.log(`снимков получено: ${snaps} из ~${expect} ожидаемых (${((snaps / expect) * 100).toFixed(0)}%), разрывов нумерации: ${gaps}`);
  // Вес рассылки — то, во что упирается «все видят всех»: снимок уходит
  // каждому, и в нём каждый.
  const наСнимок = snaps ? байт / snaps : 0;
  console.log(`вес: ${(байт / 1048576).toFixed(1)} МБ за ${SECONDS} с, ` +
              `${Math.round(наСнимок)} байт на снимок, ` +
              `${((байт / SECONDS / 131072)).toFixed(2)} Мбит/с на всех, ` +
              `${((байт / SECONDS / connected / 1024)).toFixed(1)} КБ/с одному`);
  console.log(`отклик: медиана ${q(rtt, 0.5)} мс, 95-й ${q(rtt, 0.95)} мс, худший ${Math.max(...rtt, -1)} мс, замеров ${rtt.length}`);

  const health = await fetch(`http://localhost:${PORT}/health`).then((r) => r.json()).catch(() => null);
  if (health) {
    console.log(`сервер: игроков ${health.players}, тактов ${health.tick}, память ${health.rss} МБ, ` +
                `принято ${health.stats.in}, отправлено ${health.stats.out}, пик ${health.stats.maxPlayers}`);
  }
  const беды = [];
  // Предел на источник узнаём по коду закрытия, а не гадаем: иначе стенд
  // отчитается про «комната не успевает», хотя она просто не пустила ботов с
  // одной машины — и это её работа, а не поломка.
  const поПределу = clients.filter((c) => String(c.закрыт || '').includes('1013')).length;
  if (поПределу) {
    console.log('');
    console.log(`── ${поПределу} соединений закрыто кодом 1013: сработал предел на один адрес.`);
    console.log('   Это защита комнаты, а не поломка: полсотни сокетов с одной машины иначе');
    console.log('   занимают общий город целиком. Для этого замера подними сервер так:');
    console.log(`   PORT=${PORT} ROOM_MAX=${Math.max(60, N + 10)} PER_IP_MAX=${Math.max(60, N + 10)} node server/server.js`);
    console.log('   Иначе меряется предел, а не вес рассылки.');
  }
  if (!connected) беды.push('ни одно соединение не открылось');
  if (!snaps) беды.push('снимков не пришло вовсе — комната молчит или закрыла связь');
  else if (snaps < expect * 0.5) беды.push(`снимков ${((snaps / expect) * 100).toFixed(0)}% от ожидаемых — комната не успевает`);
  if (live < connected * 0.9) {
    const почему = [...new Set(clients.map((c) => c.закрыт).filter(Boolean))];
    беды.push(`выжило ${live} из ${connected}${почему.length ? ' (' + почему.join('; ') + ')' : ''}`);
  }
  for (const c of clients) { try { c.ws.close(); } catch { /* уже закрыт */ } }
  console.log('');
  if (беды.length) {
    console.log(`найдено: ${беды.length}`);
    for (const b of беды) console.log('  ' + b);
    setTimeout(() => process.exit(1), 300);
  } else {
    console.log('ПРОБЛЕМ НЕ НАЙДЕНО');
    setTimeout(() => process.exit(0), 300);
  }
})();
