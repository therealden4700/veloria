// Что комната обязана считать, но не считала.
//
//   node tools/world-keeps-check.js [порт]
//
// Четыре находки проверки готовности к релизу об одном: правила, которые в
// одиночной игре ведёт клиент, а в общем мире не ведёт никто.
//
//   1. Рекорд глубины растёт только в клиентском `doTravel`. Комната при
//      переезде на этаж отмечает задание, а рекорд не трогает — и в общем мире
//      он остаётся нулём навсегда. Пропадают и вид контракта на глубину, и
//      таблица рекордов.
//   2. Возрождение в подземелье звало `respawnOne` с пустыми доводами вместо
//      `населениеOpts()` — и вернувшийся враг терял порчу этажа. Соседние два
//      места в том же файле передают её правильно.
//   3. Список опасностей местности в комнате только пополняется. Реакция «пар»
//      кладёт туда облако, а вычитать срок и выбрасывать истёкшие некому:
//      список растёт всё время жизни комнаты.
//   4. Спуск на боссовом этаже заперт до убийства стража, а замок снимает
//      только событие убийства. Пришёл на этаж, где страж уже убит и ждёт
//      возвращения, — и спуск заперт стражем, которого на этаже нет.
//
// ЧЕГО ЭТОТ СТЕНД НЕ МЕРЯЕТ. Зрелище: баннер «ПОВЕРЖЕН», музыку и открытие
// спуска видно только в браузере.

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

const { installHeadless } = await import('../src/core/headless.js');
installHeadless();
const { World, prepareArt } = await import('../server/world.js');
prepareArt();

// ══════════════════════════════ порча этажа переживает возрождение

log('── порча этажа и возрождение');
{
  // Порчу берём ту, что правит СВОЙСТВА врага, а не их число. Первая версия
  // взяла «Полчище» (оно меняет только количество), сравнила здоровье и уровень
  // — они совпали, и проверка была зелёной, ничего не измерив. Порча правит
  // `spdMul`, урон и броню; их и смотрим.
  const w = new World({ kind: 'dungeon', floor: 7, seed: 20260805, mod: 'fortified' });
  const порча = w.zone.mod;
  log(`  этаж 7, порча: ${порча ? порча.name : 'нет'}${порча ? ` (броня +${порча.armor || 0}, темп ×${порча.spdMul || 1}, урон ×${порча.dmgMul || 1})` : ''}`);
  const живой = w.enemies.find((e) => e && !e.dead && !e.boss);
  if (!живой || !порча) {
    note('подземелье без порчи или без населения — возрождение не проверено');
    log('  ✗ сцену собрать не удалось');
  } else {
    const снять = (e) => ({ броня: +(e.armorBonus || 0).toFixed(3), урон: e.damage, темп: +(e.spdMul || 1).toFixed(3) });
    const было = снять(живой);
    const i = живой.nid;
    log(`  враг #${i} ${живой.key}: броня ${было.броня}, урон ${было.урон}, темп ${было.темп}`);
    w.killEnemy(живой, null);
    for (let t = 0; t < 200; t += 0.05) w.step(0.05);
    const свежий = w.enemies[i];
    const стало = свежий ? снять(свежий) : null;
    log(`  вернулся: ${стало ? `броня ${стало.броня}, урон ${стало.урон}, темп ${стало.темп}` : 'никто'}`);
    проверить('возрождённый враг помнит порчу этажа',
      !!стало && стало.броня === было.броня && стало.урон === было.урон && стало.темп === было.темп,
      стало ? `броня ${было.броня}→${стало.броня}, урон ${было.урон}→${стало.урон}, темп ${было.темп}→${стало.темп}` : 'не вернулся',
      'вернувшийся вышел обычным: порча этажа его не коснулась, а платит игрок за неё полной ценой');
  }
}

// ══════════════════════════════ опасности местности не копятся

log('');
log('── опасности местности');
{
  const w = new World({ kind: 'biome', id: 'forest', seed: 20260805 });
  const p = w.addPlayer({ pid: 1, name: 'Проверяющий', look: {}, character: null });
  p.level = 30; p.hp = p.maxHp;
  // Кладём облака прямо тем же путём, каким их кладут правила.
  for (let i = 0; i < 40; i++) w.hazards.push({ x: 100 + i, y: 100, r: 20, life: 0.5, dps: 1, color: '#fff' });
  const было = w.hazards.length;
  for (let t = 0; t < 20; t += 0.05) w.step(0.05);
  log(`  положили ${было} облаков, через двадцать секунд осталось ${w.hazards.length}`);
  проверить('истёкшие опасности убираются', w.hazards.length < было,
    `${было} → ${w.hazards.length}`,
    'список растёт всё время жизни комнаты и не убывает никогда');
}

// ══════════════════════════════ спуск не заперт отсутствующим стражем

log('');
log('── спуск на боссовом этаже');
{
  const w = new World({ kind: 'dungeon', floor: 10, seed: 20260805 });
  if (!w.zone.boss || !w.zone.downExit) {
    log('  · на этом этаже нет ни стража, ни спуска — не мерили');
  } else {
    const p = w.addPlayer({ pid: 1, name: 'Спускающийся', look: {}, character: null });
    p.level = 40; p.hp = p.maxHp;
    p.x = w.zone.boss.x; p.y = w.zone.boss.y;
    w.step(0.05);
    const страж = w.enemies.find((e) => e && e.boss);
    проверить('страж поднялся при входе в арену', !!страж && !страж.dead,
      страж ? 'стоит' : 'нет стража', 'сцену не собрать');
    if (страж && !страж.dead) {
      w.killEnemy(страж, p);
      w.step(0.05);
      log(`  страж убит, вернётся через ${Math.round((страж._вернётся || 0) - w.time)} с`);
      проверить('комната говорит, что со стражем',
        typeof w.стражСостояние === 'function',
        typeof w.стражСостояние === 'function' ? w.стражСостояние().побеждён + '' : 'спросить нечем',
        'клиент не может узнать, убит ли страж, — и держит спуск запертым стражем, которого на этаже нет');
      if (typeof w.стражСостояние === 'function') {
        const с = w.стражСостояние();
        проверить('после убийства страж числится побеждённым', с.побеждён === true,
          JSON.stringify(с), 'комната считает стража живым после его смерти');
      }
    }
  }
}

// ══════════════════════════════ рекорд глубины ведёт комната

log('');
log('── рекорд глубины');
let живойСервер = false;
try { живойСервер = (await fetch(`${U}/health`)).ok; } catch { /* нет */ }
if (!живойСервер) {
  log(`  сервера на ${PORT} нет — рекорд не мерили`);
  note('сервера нет: рекорд глубины не проверен');
} else {
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

  const ws = new WebSocket(`ws://localhost:${PORT}/`);
  let pid = null, я = null, привет = null;
  await new Promise((ok) => {
    ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'hello', token: v.token, name: 'Глубинный' })));
    ws.addEventListener('message', (m) => {
      const x = JSON.parse(m.data);
      if (x.t === 'welcome') { pid = x.pid; привет = x; ok(); }
      if (x.t === 'me') я = x;
    });
    setTimeout(ok, 5000);
  });

  // Состояние стража должно ДОЙТИ до клиента, а не просто существовать в
  // комнате. Проверять его только на `World` было мало: мутация, убравшая поле
  // из `welcome`, прошла мимо — клиент по-прежнему не узнавал бы ничего.
  проверить('состояние стража приходит клиенту при входе',
    !!(привет && привет.страж && typeof привет.страж.побеждён === 'boolean'),
    привет && привет.страж ? JSON.stringify(привет.страж) : 'поля нет',
    'спуск останется запертым стражем, которого на этаже нет');
  const пульс = setInterval(() => { try { ws.send(JSON.stringify({ t: 'input', s: [] })); } catch { /* нет */ } }, 3000);
  проверить('вошли в мир', !!pid, pid ? 'да' : 'нет', 'сцену не собрать');

  if (pid) {
    // Спускаемся на пятый этаж — так же, как это делает игрок.
    ws.send(JSON.stringify({ t: 'travel', at: { kind: 'dungeon', floor: 5 } }));
    await wait(2500);
    // И выходим, чтобы комната записала героя.
    clearInterval(пульс);
    try { ws.close(); } catch { /* уже нет */ }
    await wait(1500);

    const доска = await (await fetch(`${U}/leaderboard`)).json();
    const мой = (доска.top || []).find((r) => r.deepest >= 5);
    log(`  на доске записей: ${(доска.top || []).length}${мой ? `, лучшая глубина ${мой.deepest}` : ''}`);
    проверить('спуск на пятый этаж отмечен рекордом', !!мой,
      мой ? `глубина ${мой.deepest}` : 'доска пуста',
      'рекорд глубины в общем мире остаётся нулём: пропадает и вид контракта, и таблица');
  }
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
