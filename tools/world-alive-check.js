// Общий мир не должен вычищаться.
//
//   node tools/world-alive-check.js [порт]
//
// Против боевой комнаты прогон длится две с половиной минуты: срок возрождения
// там 45 с, а проверять надо и «рано», и «уже нельзя держать». Для регресса
// комнату поднимают с коротким сроком:
//
//   PORT=3000 RESPAWN_SEC=8 node server/server.js
//
// Сроки стенд не помнит наизусть — берёт их из `welcome`.
//
// Мир один на всех: то, что убил один, не должно исчезнуть для остальных
// навсегда. Замер до возрождения — биом пустеет за 1,5–3,5 минуты, а населения
// в нём около сорока. Здесь проверяется обратное: комната возвращает павших,
// возвращает их **на те же номера** и не воскрешает никого на глазах.
//
// Стенд разговаривает с комнатой как нечестный клиент — своего мира у него нет,
// он верит только снимкам. Всё, что он умеет: войти, переехать в биом, убить и
// подождать.
//
// ЧЕГО ЭТОТ СТЕНД НЕ МЕРЯЕТ. Он не проверяет, что возрождённый враг — тот же
// самый по свойствам (щит, ярость): снимок несёт только вид и здоровье.
// Совпадение вида и полного здоровья — это всё, что видно снаружи.

const PORT = Number(process.argv[2] || 8123);

const problems = [];
const note = (s) => problems.push(s);
const log = (s) => console.log(s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── вход тем же путём, что и титульный экран: гостевой токен
async function токен() {
  const r = await fetch(`http://localhost:${PORT}/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ guest: true }),
  });
  const j = await r.json();
  if (!j.token) throw new Error('комната не выдала токен: ' + JSON.stringify(j));
  return j.token;
}

async function войти(имя) {
  const t = await токен();
  const c = { snaps: [], events: [], pid: null };
  c.ws = new WebSocket(`ws://localhost:${PORT}/`);
  await new Promise((done, fail) => {
    c.ws.addEventListener('open', () => c.ws.send(JSON.stringify({ t: 'hello', token: t, name: имя })));
    c.ws.addEventListener('close', (e) => fail(new Error(`комната закрыла связь: ${e.code} ${e.reason}`)));
    c.ws.addEventListener('message', (m) => {
      const msg = JSON.parse(m.data);
      if (msg.t === 'welcome') { c.pid = msg.pid; c.welcome = msg; done(); }   // приходит и при переезде
      else if (msg.t === 'snap') {
        c.snaps.push(msg);
        if (c.snaps.length > 40) c.snaps.shift();
        for (const e of msg.ev || []) c.events.push(e);
      }
    });
    setTimeout(() => fail(new Error('нет welcome за 5 с')), 5000);
  });
  return c;
}

// Стоять молча нельзя: комната отключает молчунов через 15 с, и стенд, который
// ждёт возрождения неподвижно, читает потом застывший снимок и уверенно врёт
// «мир не восстановился». Ждём с биением — шлём нулевой шаг, как живой клиент.
async function ждать(c, мс) {
  const t0 = Date.now();
  while (Date.now() - t0 < мс) {
    await wait(500);
    if (c.ws.readyState === 1) c.ws.send(JSON.stringify({ t: 'input', s: [[0, 0, 0.001]] }));
  }
  if (c.ws.readyState !== 1) note('комната закрыла связь во время ожидания — дальше стенд читал бы старый снимок');
}

const снимок = (c) => c.snaps[c.snaps.length - 1];
const я = (c) => { const s = снимок(c); return s && s.players.find((p) => p.pid === c.pid); };
const враг = (c, i) => { const s = снимок(c); return s && (s.enemies || []).find((e) => e.i === i); };

// Шаги шлём с **настоящим** прошедшим временем, а не с задуманным. Комната
// считает время по шагам — так работает защита от ускорителей, — и стенд,
// присылающий 50 мс каждые 60, отдаёт лишнее в никуда: герой ползёт, а стенд
// потом говорит «сервер не двигает». Один раз это уже стоило часа.
async function шагать(c, dx, dy, мс) {
  const t0 = Date.now();
  let было = t0;
  while (Date.now() - t0 < мс) {
    await wait(50);
    const now = Date.now(), dt = (now - было) / 1000; было = now;
    c.ws.send(JSON.stringify({ t: 'input', s: [[dx, dy, dt]], f: Math.atan2(dy, dx) }));
  }
}

async function подойти(c, i, предел) {
  const t0 = Date.now();
  while (Date.now() - t0 < предел) {
    const e = враг(c, i), m = я(c);
    if (!e || !m) return;
    const dx = e.x - m.x, dy = e.y - m.y, d = Math.hypot(dx, dy);
    if (d < 16) return;
    await шагать(c, dx / d, dy / d, 120);
  }
}

async function main() {
  const c = await войти('Живучесть');
  log(`вошли: pid ${c.pid}, мир — ${c.welcome.world.name}, врагов ${c.welcome.world.enemies}`);

  c.ws.send(JSON.stringify({ t: 'travel', at: { kind: 'biome', id: 'forest' } }));
  await wait(2500);
  if (!снимок(c)) { note('после переезда нет снимков'); throw new Error('комната молчит'); }
  const всего = снимок(c).enemies.length;
  const срок = c.welcome.world.respawn, порог = c.welcome.world.respawnNear, предел = c.welcome.world.respawnMax;
  log(`переехали: ${c.welcome.world.name}, врагов ${всего}`);
  log(`правило комнаты: срок ${срок} с, не ближе ${порог} px, ждать не дольше ${предел} с`);
  if (!всего) { note('в биоме нет врагов — мерить нечего'); throw new Error('пусто'); }
  if (!срок) { note('комната не называет свой срок возрождения — стенду нечего ждать'); throw new Error('нет срока'); }

  // ── убиваем ближайшего
  // Цель выбираем не «ближайшую», а посильную: гость входит первым уровнем, и
  // ближайшим часто оказывается щитоносец на 155 hp, который держит удар в лоб.
  // Один прогон так и вышел — цель не умерла, а стенд пошёл проверять
  // возрождение живого и уверенно сказал «откладывание не работает». Мы меряем
  // возрождение, а не бой: берём слабейшего из шести ближних.
  const м = я(c);
  const ближние = снимок(c).enemies.slice()
    .sort((a, b) => Math.hypot(a.x - м.x, a.y - м.y) - Math.hypot(b.x - м.x, b.y - м.y))
    .slice(0, 6);
  const цель = ближние.reduce((a, b) => (b.mx < a.mx ? b : a));
  const nid = цель.i, вид = цель.k, полное = цель.mx;
  // Место рождения снаружи не видно: снимок несёт только «где сейчас». Ближайшее,
  // что у нас есть, — где враг стоял в первом же снимке зоны. Он к тому времени
  // мог тронуться, и сравнивать с местом **смерти** нельзя вовсе: умирают там,
  // куда добежали за игроком. Отсюда и допуск.
  const первое = { x: цель.x, y: цель.y };
  log(`цель: ${вид} #${nid}, ${цель.hp}/${полное} hp`);

  await подойти(c, nid, 15000);
  for (let i = 0; i < 45 && враг(c, nid); i++) {
    const t = враг(c, nid), m = я(c);
    if (!t || !m) break;
    if (Math.hypot(t.x - m.x, t.y - m.y) > 20) await подойти(c, nid, 1500);
    const t2 = враг(c, nid), m2 = я(c);
    if (!t2 || !m2) break;
    c.ws.send(JSON.stringify({ t: 'swing', combo: i % 3, f: Math.atan2(t2.y - m2.y, t2.x - m2.x) }));
    await wait(300);
  }
  await wait(500);
  if (враг(c, nid)) {
    // Дальше идти нельзя: проверять возрождение живого — значит мерить не игру.
    note(`не смогли убить ${вид} #${nid} — дальше мерить нечего`);
    c.ws.close();
    return;
  }
  log(`убит #${nid}, в снимке осталось ${снимок(c).enemies.length}`);

  // ── рядом с телом возрождение откладывается, но не навсегда
  //
  // Стоим на месте: сперва враг не должен вернуться (срок вышел, а мы рядом),
  // а после предела — должен, иначе один игрок держал бы кусок мира пустым.
  log('');
  log(`стоим у тела: ${срок + 3} с — рано, ${предел + 6} с — уже нельзя держать`);
  await ждать(c, (срок + 3) * 1000);
  if (враг(c, nid)) note(`враг #${nid} вернулся у нас на глазах через ${срок + 3} с — откладывание не работает`);
  else log(`через ${срок + 3} с рядом: не вернулся — правильно`);

  await ждать(c, (предел - срок + 6) * 1000);
  const камп = враг(c, nid);
  if (!камп) {
    note(`простояли ${предел + 6} с у тела и мир не восстановился — так его держат пустым для всех`);
  } else {
    log(`через ${предел + 6} с: #${nid} вернулся — ${камп.k} ${камп.hp}/${камп.mx} hp`);
    if (камп.k !== вид) note(`на номере #${nid} теперь ${камп.k}, а был ${вид} — номер стал означать другое существо`);
    if (камп.hp !== камп.mx) note('вернулся раненым — возрождение должно давать полное здоровье');
    if (камп.mx !== полное) note(`здоровья ${камп.mx}, а было ${полное} — родился не тем, кем стоял`);
    const сдвинулся = Math.hypot(камп.x - первое.x, камп.y - первое.y);
    log(`от первого места: ${Math.round(сдвинулся)} px`);
    if (сдвинулся > 260) {
      note(`вернулся в ${Math.round(сдвинулся)} px от своего угла — возрождаться надо на месте, а не где придётся`);
    }
  }

  // ── население восстанавливается, а не только один
  const живых = снимок(c).enemies.length;
  log(`население: ${всего} → ${живых}`);
  if (живых < всего) note(`в зоне ${живых} из ${всего} — часть павших не вернулась`);

  c.ws.close();
}

try {
  await main();
} catch (e) {
  note('сбой: ' + e.message);
}

console.log('');
if (problems.length) {
  console.log(`найдено: ${problems.length}`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('ПРОБЛЕМ НЕ НАЙДЕНО');
