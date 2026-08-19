// Игра на одном адресе, комната на другом.
//
//   node tools/cross-origin-check.js [порт]
//
// Зачем это мерить. Живая ссылка живёт на GitHub Pages — это статика, и никаких
// вебсокетов она не отдаёт и не будет. Комната обязана стоять где-то ещё. А
// клиент до сих пор ходил только к тому хосту, который отдал страницу:
// `fetch('/auth/nonce')` относительным путём и `new WebSocket(location.host)`.
// То есть весь общий мир для настоящего игрока не существовал по устройству —
// не из-за отсутствия сервера, а из-за того, что до него нечем дотянуться.
//
// Здесь проверяется вторая половина той же задачи: пустит ли комната чужой
// источник и пустит ли осознанно. Браузер к чужому источнику не пойдёт без
// заголовков CORS, а пускать вообще всех нельзя — сокет комнаты тогда откроет
// любой сайт и будет держать в ней своих ботов.
//
// ЧЕГО ЭТОТ СТЕНД НЕ МЕРЯЕТ. Настоящий браузер: как поведёт себя его проверка
// источника, видно только в браузере, и это делается отдельно, вручную, на двух
// портах. И сам факт публикации — где стоит комната, стенд не знает.

const PORT = Number(process.argv[2] || 3000);
const U = `http://localhost:${PORT}`;
// Откуда «пришла» страница. Порт нарочно другой: именно это и есть чужой
// источник с точки зрения браузера.
const ЧУЖОЙ = 'https://therealden4700.github.io';
const ВРАЖДЕБНЫЙ = 'https://veloria-farm.example';

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

let живой = false;
try { живой = (await fetch(`${U}/health`)).ok; } catch { /* нет */ }
if (!живой) {
  console.log(`сервера на ${PORT} нет — мерить нечего`);
  console.log(`подними: PORT=${PORT} VELORIA_ORIGINS='${ЧУЖОЙ}' node server/server.js`);
  process.exit(1);
}

// ══════════════════════════════ клиент знает, куда идти

log('── клиент знает, куда идти');
// Модуля может не быть вовсе — так было до этой работы. Это находка, а не повод
// падать: стенд, который бросает исключение вместо отчёта, ничего не измерил.
let адрес = {};
try { адрес = await import('../src/core/server-url.js'); }
catch { /* нет так нет — скажем об этом проверкой */ }
const { serverBase, serverWsUrl, apiUrl } = адрес;

проверить('адрес комнаты берётся из настройки', typeof serverBase === 'function',
  typeof serverBase === 'function' ? '' : 'src/core/server-url.js нет',
  'адрес зашит — на GitHub Pages клиент будет стучаться в статику');

if (typeof serverBase === 'function') {
  // Без всяких подсказок клиент обязан вести себя как раньше: свой же хост.
  проверить('без настройки — свой хост', serverBase({ origin: 'https://тут', search: '', meta: null }) === 'https://тут',
    serverBase({ origin: 'https://тут', search: '', meta: null }), 'сломали привычный случай');
  проверить('мета-тег задаёт адрес',
    serverBase({ origin: 'https://pages', search: '', meta: 'https://room.example' }) === 'https://room.example',
    serverBase({ origin: 'https://pages', search: '', meta: 'https://room.example' }),
    'в index.html нечем указать комнату — публиковать нечем');
  // На своей машине довод в ссылке сильнее — им пользуются проверки.
  проверить('у себя довод в ссылке сильнее мета-тега',
    serverBase({ origin: 'http://localhost:4173', search: '?server=http://localhost:3000', meta: 'https://room.example' }) === 'http://localhost:3000',
    '', 'проверить чужой адрес на своей странице нечем');

  // А на опубликованной странице — нет, и это про безопасность, а не про удобство.
  //
  // Комната даёт текст, который игрок подписывает кошельком, и забирает
  // персонажа. Значит ссылка `…github.io/veloria/?server=https://чужой` была бы
  // готовой удочкой: игра спросила бы текст у мошенника, показала его в окне
  // кошелька как свой и отдала бы туда же героя. Проверки схемы адреса мало —
  // `https://` есть и у мошенника.
  проверить('на опубликованной странице ссылка комнату не выбирает',
    serverBase({ origin: 'https://therealden4700.github.io', search: '?server=https://злой.example', meta: 'https://room.example' }) === 'https://room.example',
    serverBase({ origin: 'https://therealden4700.github.io', search: '?server=https://злой.example', meta: 'https://room.example' }),
    'ссылкой можно увести игрока в подставную комнату и получить его подпись и персонажа');
  проверить('без мета-тега ссылка тоже не уводит',
    serverBase({ origin: 'https://therealden4700.github.io', search: '?server=https://злой.example', meta: null }) === 'https://therealden4700.github.io',
    serverBase({ origin: 'https://therealden4700.github.io', search: '?server=https://злой.example', meta: null }),
    'без мета-тега игра слушается ссылки');
  проверить('мусор в доводе не принимается',
    serverBase({ origin: 'http://localhost:4173', search: '?server=javascript:alert(1)', meta: null }) === 'http://localhost:4173',
    serverBase({ origin: 'http://localhost:4173', search: '?server=javascript:alert(1)', meta: null }),
    'в адрес комнаты проходит не адрес');
  проверить('http превращается в ws, https в wss',
    serverWsUrl('https://room.example') === 'wss://room.example/' && serverWsUrl('http://localhost:3000') === 'ws://localhost:3000/',
    `${serverWsUrl('https://room.example')} и ${serverWsUrl('http://localhost:3000')}`, 'сокет пойдёт не по той схеме');
  проверить('путь к запросу складывается без двойной косой',
    apiUrl('/auth/nonce', 'https://room.example/') === 'https://room.example/auth/nonce',
    apiUrl('/auth/nonce', 'https://room.example/'), 'адрес собирается неверно');
}

// ══════════════════════════════ раздатчик отдаёт только игру

log('');
log('── раздатчик отдаёт только игру');

// Найдено проверкой готовности к релизу: защита у раздатчика была одна — от
// «../», — и этого мало. `GET /data/veloria.db` отдавал 200 и базу целиком, с
// адресами кошельков всех, кто заходил. Рядом лежали исходники сервера,
// `fly.toml` и `Dockerfile`. Теперь разрешённое перечислено поимённо: список
// запретов отставал бы от репозитория на каждый новый файл.
const код = async (p) => (await fetch(U + p, { redirect: 'manual' })).status;

const игра = ['/index.html', '/styles.css', '/src/main.js', '/assets/title.png'];
const отданы = [];
for (const p of игра) if (await код(p) === 200) отданы.push(p);
проверить('файлы игры отдаются', отданы.length === игра.length,
  `${отданы.length} из ${игра.length}`, 'игра не загрузится');

const чужое = ['/data/veloria.db', '/server/db.js', '/server/auth.js', '/server/server.js',
  '/fly.toml', '/Dockerfile', '/DEPLOY.md', '/README.md', '/tools/soak.js', '/.git/config'];
const утекло = [];
for (const p of чужое) if (await код(p) === 200) утекло.push(p);
проверить('ничего, кроме игры, не отдаётся', утекло.length === 0,
  утекло.length ? утекло.join(', ') : `все ${чужое.length} закрыты`,
  'сервер раздаёт свою базу, исходники и настройки любому желающему');

const обходы = ['/src/../data/veloria.db', '/src/%2e%2e/data/veloria.db',
  '/data/..%2fdata/veloria.db', '//data/veloria.db', '/srcX/../data/veloria.db'];
const прошли = [];
for (const p of обходы) if (await код(p) === 200) прошли.push(p);
проверить('обход разрешения не проходит', прошли.length === 0,
  прошли.length ? прошли.join(', ') : `все ${обходы.length} закрыты`,
  'список разрешённого обходится точками или кодированием');

// ══════════════════════════════ комната пускает чужой источник

log('');
log('── комната пускает чужой источник');

const предполёт = await fetch(`${U}/auth/nonce`, {
  method: 'OPTIONS',
  headers: { origin: ЧУЖОЙ, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
});
const разрешён = предполёт.headers.get('access-control-allow-origin');
проверить('предполётный запрос получает ответ', предполёт.status >= 200 && предполёт.status < 300,
  `${предполёт.status}`, 'браузер не станет и пытаться');
проверить('свой источник назван поимённо', разрешён === ЧУЖОЙ,
  разрешён || 'заголовка нет',
  'без этого заголовка браузер отбросит ответ, и вход не начнётся');
проверить('разрешён нужный заголовок', (предполёт.headers.get('access-control-allow-headers') || '').toLowerCase().includes('content-type'),
  предполёт.headers.get('access-control-allow-headers') || 'нет', 'запрос с телом JSON не пройдёт');

const свой = await fetch(`${U}/auth/nonce`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: ЧУЖОЙ },
  body: JSON.stringify({ address: 'проверка' }),
});
const тело = await свой.json().catch(() => null);
проверить('вход отвечает чужому источнику',
  свой.ok && !!(тело && тело.nonce) && свой.headers.get('access-control-allow-origin') === ЧУЖОЙ,
  `${свой.status}, заголовок ${свой.headers.get('access-control-allow-origin') || 'нет'}`,
  'страница с GitHub Pages не сможет получить одноразовый код');

const чужак = await fetch(`${U}/auth/nonce`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: ВРАЖДЕБНЫЙ },
  body: JSON.stringify({ address: 'проверка' }),
});
проверить('незнакомому источнику разрешения нет',
  чужак.headers.get('access-control-allow-origin') !== ВРАЖДЕБНЫЙ && чужак.headers.get('access-control-allow-origin') !== '*',
  чужак.headers.get('access-control-allow-origin') || 'заголовка нет',
  'разрешено всем — чужой сайт сможет ходить в комнату от имени игрока');

// ══════════════════════════════ сокет тоже смотрит, кто пришёл

log('');
log('── сокет смотрит, кто пришёл');

const токен = await (await fetch(`${U}/auth/verify`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: ЧУЖОЙ },
  body: JSON.stringify({ guest: true }),
})).json();

async function постучаться(origin) {
  return new Promise((готово) => {
    const c = { принят: false, закрыт: null };
    let ws;
    try { ws = new WebSocket(`ws://localhost:${PORT}/`, { headers: origin ? { origin } : {} }); }
    catch { готово({ принят: false, закрыт: 'не открылся' }); return; }
    ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'hello', token: токен.token, name: 'Проверка' })));
    ws.addEventListener('message', (m) => {
      const x = JSON.parse(m.data);
      if (x.t === 'welcome') { c.принят = true; try { ws.close(); } catch { /* уже нет */ } готово(c); }
    });
    ws.addEventListener('close', (e) => { c.закрыт = `${e.code} ${e.reason || ''}`.trim(); готово(c); });
    setTimeout(() => { try { ws.close(); } catch { /* уже нет */ } готово(c); }, 4000);
  });
}

const свойСокет = await постучаться(ЧУЖОЙ);
проверить('свой источник в комнату пускают', свойСокет.принят,
  свойСокет.принят ? 'welcome получен' : `закрыт: ${свойСокет.закрыт || 'молча'}`,
  'игра с живой ссылки не войдёт в общий мир');

await wait(300);
const врагСокет = await постучаться(ВРАЖДЕБНЫЙ);
проверить('незнакомый источник в комнату не пускают', !врагСокет.принят,
  врагСокет.принят ? 'впустили' : `закрыт: ${врагСокет.закрыт || 'молча'}`,
  'сокет комнаты откроет любой сайт — и будет держать в ней своих');

await wait(300);
const безИсточника = await постучаться(null);
проверить('запрос без источника пускают', безИсточника.принят,
  безИсточника.принят ? 'welcome получен' : `закрыт: ${безИсточника.закрыт || 'молча'}`,
  'заголовка Origin нет ни у одного стенда — так мы отрежем сами себя');

console.log('');
console.log(`проверок: ${сделано}`);
if (problems.length) {
  console.log(`найдено: ${problems.length}`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('ПРОБЛЕМ НЕ НАЙДЕНО');
process.exit(0);
