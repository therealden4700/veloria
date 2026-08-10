// Общий город: кого видно, что слышно и сколько влезает.
//
//   node tools/city-shared-check.js [порт]
//
// Замер до этой работы: снимок был один на комнату и уходил всем целиком —
// 8756 байт при полусотне игроков, 67 Мбит/с наружу и 172 КБ/с каждому, то есть
// десять мегабайт в минуту на телефон. Росло это квадратом: каждый новый игрок
// попадал в снимок каждого. Из 8878 байт `look` занимал 3550, имя — ещё 940:
// половина рассылки уходила на то, что не меняется.
//
// Здесь проверяется, что стало: имя и внешность приходят один раз, в снимке
// только то, что рядом и что движется, разговор ограничен по длине и частоте,
// а в комнату пускают не больше, чем намерено.
//
// Вес рассылки меряет `ws-load` — там для этого есть полсотни ботов.
//
// ЧЕГО ЭТОТ СТЕНД НЕ МЕРЯЕТ. Как это выглядит: подпись над головой, полоску
// здоровья и облачко реплики видно только в браузере.

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

const j = async (p, b) => (await fetch(U + p, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
})).json();

async function открыть(имя) {
  const { token } = await j('/auth/verify', { guest: true });
  const c = { пр: [], снимок: null, закрыт: null, ws: new WebSocket(`ws://localhost:${PORT}/`) };
  c.ws.addEventListener('close', (e) => { c.закрыт = `${e.code} ${e.reason}`; });
  c.ws.addEventListener('open', () => c.ws.send(JSON.stringify({ t: 'hello', token, name: имя })));
  c.ws.addEventListener('message', (m) => {
    const x = JSON.parse(m.data);
    if (x.t === 'snap') { c.снимок = x; return; }
    c.пр.push(x);
    if (x.t === 'welcome') c.pid = x.pid;
  });
  await wait(900);
  return c;
}
const последнее = (c, t) => c.пр.filter((x) => x.t === t).pop();

let живой = false;
try { живой = (await fetch(`${U}/health`)).ok; } catch { /* нет */ }
if (!живой) {
  console.log(`сервера на ${PORT} нет — мерить нечего`);
  console.log(`подними: PORT=${PORT} ROOM_MAX=4 node server/server.js`);
  process.exit(1);
}
const health = await (await fetch(`${U}/health`)).json();

// ══════════════════════════════ кого видно

log('── кого видно');
const a = await открыть('Первый');
const b = await открыть('Второй');
await wait(900);

const кто = последнее(a, 'кто');
проверить('имя и внешность приходят отдельно', !!(кто && кто.players && кто.players.length),
  кто ? `${кто.players.length} представлено` : 'не пришло', 'клиенту нечем подписать соседа');
if (кто && кто.players.length) {
  const п = кто.players[0];
  проверить('в представлении есть имя, уровень и внешность',
    !!(п.name && п.lvl !== undefined && п.look), JSON.stringify(п).slice(0, 80));
}

const запись = a.снимок && (a.снимок.players || [])[0];
проверить('в снимке нет имени', !!(запись && запись.name === undefined),
  запись ? Object.keys(запись).join(',') : 'снимка нет', 'имя уезжает двадцать раз в секунду');
проверить('в снимке нет внешности', !!(запись && запись.look === undefined), '',
  'внешность уезжает двадцать раз в секунду');
проверить('в снимке есть здоровье соседа', !!(запись && запись.hp !== undefined && запись.mhp !== undefined),
  '', 'полоску здоровья нечем нарисовать');
проверить('соседи видны друг другу', (a.снимок.players || []).length >= 2,
  `${(a.снимок.players || []).length} в снимке`, 'мир кажется пустым');

// ══════════════════════════════ что слышно

log('');
log('── что слышно');
a.ws.send(JSON.stringify({ t: 'say', text: '  привет,   мир!  ' }));
await wait(500);
const услышал = последнее(b, 'сказано');
проверить('сказанное доходит до соседа', !!(услышал && услышал.ok && услышал.text === 'привет, мир!'),
  услышал ? `«${услышал.text}» от ${услышал.name}` : 'не дошло', 'разговора нет');

a.ws.send(JSON.stringify({ t: 'say', text: 'сразу ещё' }));
await wait(400);
const часто = последнее(a, 'сказано');
проверить('часто говорить нельзя', !!(часто && !часто.ok), часто ? часто.why : 'ответа нет',
  'одним сообщением можно забить канал соседям');

await wait(1400);
a.ws.send(JSON.stringify({ t: 'say', text: 'ы'.repeat(500) }));
await wait(500);
const длинное = последнее(b, 'сказано');
проверить('длина обрезана', !!(длинное && длинное.text.length <= 120),
  длинное ? `${длинное.text.length} знаков` : 'не дошло', 'длину никто не сторожит');

await wait(1400);
a.ws.send(JSON.stringify({ t: 'say', text: '   ' }));
await wait(400);
const пусто = b.пр.filter((x) => x.t === 'сказано').pop();
проверить('пустое не рассылается', пусто === длинное, '', 'пробелы уходят всем');

// ══════════════════════════════ сколько влезает

log('');
log('── сколько влезает');
const потолок = 4;
if (health.rooms && health.rooms.find((r) => r.id === 'city' && r.players > потолок - 2)) {
  log('  · в городе уже людно — потолок этот прогон не мерили');
} else {
  const ещё = [];
  for (let i = 0; i < потолок + 2; i++) ещё.push(await открыть('Гость' + i));
  await wait(900);
  const отказы = ещё.filter((c) => c.закрыт || последнее(c, 'полно'));
  проверить('потолок комнаты держит', отказы.length > 0,
    `вошло ${ещё.length - отказы.length}, отказано ${отказы.length}`,
    `в комнату пустили всех — при ${потолок} потолке (подними сервер с ROOM_MAX=${потолок})`);
  const п = отказы.map((c) => последнее(c, 'полно')).find(Boolean);
  if (отказы.length) {
    проверить('отказ внятный', !!(п && п.limit) || !!(отказы[0].закрыт),
      п ? `предел ${п.limit}` : отказы[0].закрыт, 'закрыли молча');
  }
  for (const c of ещё) { try { c.ws.close(); } catch { /* уже нет */ } }
}

for (const c of [a, b]) { try { c.ws.close(); } catch { /* уже нет */ } }

console.log('');
console.log(`проверок: ${сделано}`);
if (problems.length) {
  console.log(`найдено: ${problems.length}`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('ПРОБЛЕМ НЕ НАЙДЕНО');
process.exit(0);
