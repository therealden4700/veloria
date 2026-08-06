// Нагрузка на комнату: пятьдесят соединений, как обещано на старте.
//
//   node tools/ws-load.js [сколько] [секунд] [порт]
//
// Меряется то, что болит в сети на самом деле: сколько соединений дошло, за
// какое время, какая задержка отклика и не теряются ли такты. Клиент берётся
// встроенный в Node — зависимостей по-прежнему ноль.

const N = Number(process.argv[2] || 50);
const SECONDS = Number(process.argv[3] || 10);
const PORT = Number(process.argv[4] || 8123);
const URL_ = `ws://localhost:${PORT}/`;

if (typeof WebSocket === 'undefined') {
  console.error('в этом Node нет встроенного WebSocket — нужен Node 22 и новее');
  process.exit(1);
}

const rtt = [];
const clients = [];
let connected = 0, failed = 0, snaps = 0, gaps = 0;
const t0 = Date.now();

function spawn(i) {
  return new Promise((done) => {
    const ws = new WebSocket(URL_);
    const c = { ws, pid: null, lastTick: 0, connectedAt: 0 };
    let settled = false;
    const finish = () => { if (!settled) { settled = true; done(c); } };

    ws.onopen = () => {
      c.connectedAt = Date.now() - t0;
      connected++;
      ws.send(JSON.stringify({ t: 'hello', name: 'бот-' + i, address: null }));
      finish();
    };
    ws.onerror = () => { failed++; finish(); };
    ws.onmessage = (ev) => {
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
  for (let i = 0; i < N; i++) clients.push(await spawn(i));
  const connMs = Date.now() - t0;
  console.log(`подключено ${connected} из ${N}${failed ? `, отказов ${failed}` : ''}, за ${connMs} мс`);

  // шлём ввод как настоящий клиент — 20 раз в секунду — и щупаем отклик
  let step = 0;
  const send = setInterval(() => {
    step++;
    for (const c of clients) {
      if (c.ws.readyState !== 1) continue;
      const a = step / 20 + c.connectedAt;
      c.ws.send(JSON.stringify({ t: 'input', x: 520 + Math.cos(a) * 60, y: 512 + Math.sin(a) * 60, f: a % 6.28 }));
      if (step % 20 === 0) c.ws.send(JSON.stringify({ t: 'ping', c: Date.now() }));
    }
  }, 50);

  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  clearInterval(send);

  const live = clients.filter((c) => c.ws.readyState === 1).length;
  const expect = connected * SECONDS * 20;
  console.log(`живых к концу: ${live} из ${connected}`);
  console.log(`снимков получено: ${snaps} из ~${expect} ожидаемых (${((snaps / expect) * 100).toFixed(0)}%), разрывов нумерации: ${gaps}`);
  console.log(`отклик: медиана ${q(rtt, 0.5)} мс, 95-й ${q(rtt, 0.95)} мс, худший ${Math.max(...rtt, -1)} мс, замеров ${rtt.length}`);

  const health = await fetch(`http://localhost:${PORT}/health`).then((r) => r.json()).catch(() => null);
  if (health) {
    console.log(`сервер: игроков ${health.players}, тактов ${health.tick}, память ${health.rss} МБ, ` +
                `принято ${health.stats.in}, отправлено ${health.stats.out}, пик ${health.stats.maxPlayers}`);
  }
  for (const c of clients) { try { c.ws.close(); } catch { /* уже закрыт */ } }
  setTimeout(() => process.exit(0), 300);
})();
