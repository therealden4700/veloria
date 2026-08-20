// Переживёт ли сервер публикацию.
//
//   node tools/ops-check.js [порт]
//
// Стенды до этого мерили игру. Этот мерит то, с чем останется человек, когда
// комната будет работать неделями без присмотра: обновления, падения, диагноз.
//
// Найдено проверкой готовности к релизу:
//   1. сессии жили только в памяти — каждое обновление сервера разлогинивало
//      всех, а клиент считает токен действительным неделю;
//   2. исключение в обработке сообщения игрока уходило в пустой `onerror` и
//      пропадало бесследно — в логе не оставалось ничего;
//   3. `/health` всегда отвечал `ok: true`, и «мир стоит» от «мир жив» не
//      отличался никак;
//   4. бросок в раздаче файлов или в `/health` ронял процесс целиком;
//   5. `.dockerignore` не было — в образ уезжала живая база с адресами
//      кошельков, `.git` и снимки экрана.
//
// ЧЕГО ЭТОТ СТЕНД НЕ МЕРЯЕТ. Само развёртывание: поднимется ли образ у хостера,
// видно только у хостера. И скорость восстановления после падения.

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

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const КОРЕНЬ = resolve(fileURLToPath(new URL('..', import.meta.url)));
const есть = (п) => existsSync(resolve(КОРЕНЬ, п));
const файл = (п) => readFileSync(resolve(КОРЕНЬ, п), 'utf8');

// ══════════════════════════════ что уезжает в образ

log('── что уезжает в образ');
{
  проверить('.dockerignore есть', есть('.dockerignore'), '',
    'в образ попадает живая база с адресами кошельков, вся история git и снимки экрана');
  if (есть('.dockerignore')) {
    const строки = файл('.dockerignore').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
    const нужно = ['data', '.git', 'tools'];
    const нет = нужно.filter((n) => !строки.some((s) => s.replace(/\/$/, '') === n || s.startsWith(n + '/') || s === n + '/'));
    log(`  правил ${строки.length}: ${строки.slice(0, 8).join(', ')}`);
    проверить('база, история и стенды исключены', нет.length === 0,
      нет.length ? `не исключено: ${нет.join(', ')}` : 'всё исключено',
      'самое чувствительное всё равно уедет в образ');
  }
}

// ══════════════════════════════ сессии переживают обновление

log('');
log('── сессии переживают обновление');
{
  // Обновление сервера — обычное дело, оно случается каждый раз при выкладке.
  // Токен при этом лежит в браузере ещё неделю, и если сессии жили только в
  // памяти, человек жмёт «В общий город» и получает отказ, ничего не сделав.
  const { newSession, readSession } = await import('../server/auth.js');
  const { openDb, closeDb } = await import('../server/db.js');
  const SP = process.env.VELORIA_DB || resolve(КОРЕНЬ, 'data/veloria.db');
  openDb(SP);

  const токен = newSession('АдресДляПроверки', false);
  проверить('сессия читается сразу', !!readSession(токен), '', 'вход не работает вовсе');

  // Изображаем перезапуск: закрываем базу и просим модуль забыть память.
  const { забытьСессии } = await import('../server/auth.js');
  if (typeof забытьСессии !== 'function') {
    проверить('сессии переживают перезапуск', false, 'забыть сессии нечем',
      'сессии живут только в памяти — каждое обновление сервера разлогинивает всех');
  } else {
    забытьСессии();
    const после = readSession(токен);
    проверить('сессии переживают перезапуск', !!после,
      после ? `адрес ${после.address}` : 'токен потерян',
      'каждое обновление сервера разлогинивает всех, а токен в браузере живёт неделю');
    if (после) {
      проверить('после перезапуска адрес тот же', после.address === 'АдресДляПроверки',
        после.address, 'сессия воскресла чужой');
    }
  }
  closeDb();
}

// ══════════════════════════════ диагноз: живой ли мир

log('');
log('── что говорит /health');
let живой = false;
try { живой = (await fetch(`${U}/health`)).ok; } catch { /* нет */ }
if (!живой) {
  log(`  сервера на ${PORT} нет — половину про живой сервер не мерили`);
  note('сервера нет: /health, потерянные исключения и устойчивость не проверены');
} else {
  const h = await (await fetch(`${U}/health`)).json();
  проверить('в ответе есть отметка последнего успешного такта',
    Number.isFinite(h.шагал),
    Object.keys(h).join(', ').slice(0, 90),
    '«мир жив» и «мир стоит» по этому ответу не различить: tick растёт первой же строкой такта, даже если дальше он падает');
  проверить('живой мир отвечает 200', (await fetch(`${U}/health`)).status === 200,
    `${(await fetch(`${U}/health`)).status}`, 'здоровый сервер объявлен больным');

  // А теперь то же самое, но с порогом застоя в миллисекунду: такт идёт раз в
  // пятьдесят, значит отметка всегда «старая» — и ответ обязан стать 503.
  // Без этой половины проверка ничего не значит: мутация, вернувшая вечный
  // `ok: true`, проходила мимо неё насквозь.
  const { spawn } = await import('node:child_process');
  const порт2 = PORT + 771;
  const дитя = spawn(process.execPath, ['server/server.js'], {
    cwd: КОРЕНЬ, stdio: 'ignore',
    env: { ...process.env, PORT: String(порт2), STALL_MS: '1', VELORIA_DB: (process.env.VELORIA_DB || '') + '.stall' },
  });
  await wait(3500);
  let код = 0, тело = null;
  try { const r = await fetch(`http://localhost:${порт2}/health`); код = r.status; тело = await r.json(); } catch { код = 0; }
  log(`  с порогом в 1 мс: ответ ${код}, ok=${тело ? тело.ok : '?'}, шагал ${тело ? тело.шагал : '?'} мс`);
  проверить('вставший мир отвечает 503', код === 503 && тело && тело.ok === false,
    `${код}, ok=${тело ? тело.ok : '?'}`,
    'хостер видит «всё хорошо» и не перезапускает машину, на которой мир стоит');
  try { дитя.kill('SIGKILL'); } catch { /* уже нет */ }

  // ══════════════════════════════ исключение не теряется и не роняет

  log('');
  log('── исключение в обработке сообщения');
  {
    // Шлём сообщение, на котором комната споткнётся. Игрок такое пришлёт не со
    // зла, а по ошибке клиента — и это не повод терять след.
    const { token } = await (await fetch(`${U}/auth/verify`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ guest: true }),
    })).json();
    const ws = new WebSocket(`ws://localhost:${PORT}/`);
    let вошли = false, закрыт = null;
    await new Promise((ok) => {
      ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'hello', token, name: 'Спотыкач' })));
      ws.addEventListener('close', (e) => { закрыт = e.code; ok(); });
      ws.addEventListener('message', (m) => { if (JSON.parse(m.data).t === 'welcome') { вошли = true; ok(); } });
      setTimeout(ok, 4000);
    });
    проверить('вошли, чтобы было чем спотыкаться', вошли, вошли ? '' : `закрыт ${закрыт}`, 'сцену не собрать');
    if (вошли) {
      // `ids` не массив и не число — `fuse` пойдёт по нему как по массиву.
      ws.send(JSON.stringify({ t: 'fuse', ids: { длина: 'нет' } }));
      ws.send(JSON.stringify({ t: 'quest', do: 'accept', id: { нет: 'строки' } }));
      ws.send(JSON.stringify({ t: 'travel', at: { kind: 'biome', id: 12345 } }));
      await wait(1200);
      const после = await fetch(`${U}/health`).then((r) => r.json()).catch(() => null);
      проверить('сервер пережил кривые сообщения', !!после && после.ok !== false,
        после ? 'жив' : 'не отвечает',
        'одно кривое сообщение от одного игрока роняет комнату для всех');
      try { ws.close(); } catch { /* уже нет */ }
    }
  }

  // ══════════════════════════════ кривой запрос не роняет процесс

  log('');
  log('── кривой запрос по HTTP');
  {
    const пути = ['/health', '/index.html', '/%', '/../../etc/passwd', '/src/' + 'ы'.repeat(300)];
    const коды = [];
    for (const p of пути) {
      try { коды.push((await fetch(U + p, { redirect: 'manual' })).status); } catch { коды.push('обрыв'); }
    }
    log(`  ${пути.length} запросов → ${коды.join(', ')}`);
    const жив = await fetch(`${U}/health`).then((r) => r.ok).catch(() => false);
    проверить('сервер жив после кривых запросов', жив, жив ? 'отвечает' : 'молчит',
      'бросок в раздаче файлов роняет процесс целиком');
  }
}

// ══════════════════════════════ уйти можно так же просто, как прийти

log('');
log('── удаление учётки');
if (живой) {
  const { generateKeyPairSync, sign } = await import('node:crypto');
  const { buildMessage } = await import('../server/auth.js');
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const b58 = (b) => { let n = BigInt('0x' + Buffer.from(b).toString('hex')), o = ''; while (n > 0n) { o = B58[Number(n % 58n)] + o; n /= 58n; } return o; };
  const j = async (p2, b) => (await fetch(U + p2, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const address = b58(Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url'));
  const { nonce } = await j('/auth/nonce', { address });
  const msg = buildMessage(nonce, `localhost:${PORT}`, new Date().toISOString(), 'ru');
  const v = await j('/auth/verify', { address, message: msg, signature: sign(null, Buffer.from(msg, 'utf8'), privateKey).toString('hex') });
  проверить('вход по подписи работает', !!(v && v.ok && v.token), v && v.why ? v.why : 'вошли',
    'сцену не собрать — удалять нечего');

  if (v && v.ok) {
    const чужой = await j('/account/forget', { token: 'не-мой-токен' });
    проверить('без своей сессии не удалить', !(чужой && чужой.ok), чужой ? чужой.why : 'ответа нет',
      'стереть чужого героя смог бы кто угодно');

    const ушёл = await j('/account/forget', { token: v.token });
    log(`  удаление: ${JSON.stringify(ушёл).slice(0, 70)}`);
    проверить('удалиться можно', !!(ушёл && ушёл.ok), ушёл ? (ушёл.why || ушёл.what) : 'ответа нет',
      'сервер хранит адрес кошелька, а уйти игроку нечем');

    // И проверяем, что правда удалилось: вход тем же адресом должен дать
    // чистую учётку, а не прежнюю.
    const { nonce: n2 } = await j('/auth/nonce', { address });
    const m2 = buildMessage(n2, `localhost:${PORT}`, new Date().toISOString(), 'ru');
    const v2 = await j('/auth/verify', { address, message: m2, signature: sign(null, Buffer.from(m2, 'utf8'), privateKey).toString('hex') });
    проверить('после удаления учётка чистая', !!(v2 && v2.ok && v2.account && v2.account.logins === 1),
      v2 && v2.account ? `входов ${v2.account.logins}` : 'не вошли',
      'удаление ничего не удалило — прежняя учётка на месте');
  }
}

// ══════════════════════════════ сторож на непойманное

log('');
log('── сторож на непойманное');
{
  const текст = файл('server/server.js');
  const есть2 = /process\.on\(\s*'uncaughtException'/.test(текст);
  const есть3 = /process\.on\(\s*'unhandledRejection'/.test(текст);
  проверить('непойманное исключение не роняет молча', есть2, есть2 ? 'сторож есть' : 'сторожа нет',
    'процесс умирает без записи в лог — оператор увидит только, что сервера нет');
  проверить('непойманный отказ обещания тоже под сторожем', есть3, есть3 ? 'сторож есть' : 'сторожа нет',
    'самый частый способ уронить Node — и след от него тоже не остаётся');
}

console.log('');
console.log(`проверок: ${сделано}`);
if (problems.length) {
  console.log(`найдено: ${problems.length}`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('ПРОБЛЕМ НЕ НАЙДЕНО');
process.exit(0);
