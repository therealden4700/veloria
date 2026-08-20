// Чего стоит кадр в общем мире и что на нём не видно.
//
//   node tools/client-cost-check.js
//
// Пять находок проверки готовности к релизу про клиентскую половину: две про
// цену кадра, три про то, что игрок не увидит.
//
//   1. Иконка каждой лежащей вещи в общем мире перепекается двадцать раз в
//      секунду. Кэш стоит на объекте добычи, а список добычи целиком заменяется
//      разобранным снимком — кэшу нечего пережить.
//   2. Чужой подбор вещи заставляет ВСЕХ в комнате пересобрать весь рюкзак:
//      комната ставит общий признак вместо признака хозяина, а клиент на нём
//      пересоздаёт каждую иконку.
//   3. Строка «Сказать» берёт размеры буфера в настоящих пикселях и рисует ими
//      по слою, у которого стоит масштаб, — уезжает вчетверо за экран.
//   4. Звук не возвращается после сворачивания: `resume` зовётся трижды за
//      жизнь страницы, и ни разу — когда вкладку открыли снова.
//   5. Причину отказа кнопки «В общий город» показывают через HUD, который на
//      титульном экране не рисуется вовсе.
//
// ЧЕГО ЭТОТ СТЕНД НЕ МЕРЯЕТ. Настоящую частоту кадров: она зависит от машины, и
// мерить её надо в браузере. Здесь — сколько работы кадр просит.

const problems = [];
const note = (s) => problems.push(s);
const log = (s) => console.log(s);
let сделано = 0;
const проверить = (имя, годно, замер, причина) => {
  сделано++;
  log(`  ${годно ? '✓' : '✗'} ${имя}${замер ? '  — ' + замер : ''}${!годно && причина ? '  (' + причина + ')' : ''}`);
  if (!годно) note(`${имя}: ${причина || замер || 'не сошлось'}`);
};

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const КОРЕНЬ = resolve(fileURLToPath(new URL('..', import.meta.url)));
// Половина проверок обходится без сервера, половине он нужен: тогда порт
// называют доводом. Без него эта половина честно говорит, что не мерила.
const ПОРТ = Number(process.argv[2] || 0);
const файл = (п) => readFileSync(resolve(КОРЕНЬ, п), 'utf8');

const { installHeadless } = await import('../src/core/headless.js');
installHeadless();

// Считаем запечённые холсты: иконка — это холст, и её перепекание видно здесь.
let холстов = 0;
const былCreate = document.createElement.bind(document);
document.createElement = (tag) => { if (String(tag).toLowerCase() === 'canvas') холстов++; return былCreate(tag); };

const { initProps } = await import('../src/art/props.js');
const { bakeAllMonsters } = await import('../src/art/sprites.js');
initProps();
bakeAllMonsters();

const { Game } = await import('../src/game.js');
const net = (await import('../src/core/net.js')).default || (await import('../src/core/net.js')).net;

// Холст, который запоминает, что и куда рисовали.
function следящий() {
  const прямоугольники = [];
  return new Proxy({ прямоугольники }, {
    get(ц, k) {
      if (k === 'прямоугольники') return прямоугольники;
      if (k === 'canvas') return { width: 1920, height: 1080 };
      if (k === 'fillRect') return (x, y, w, h) => прямоугольники.push({ x, y, w, h });
      if (k === 'measureText') return () => ({ width: 8 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k === 'getImageData' || k === 'createImageData') return () => ({ data: new Uint8ClampedArray(4) });
      return () => {};
    },
    set() { return true; },
  });
}

const мимо = следящий();
const g = new Game(мимо, { w: 480, h: 270 }, мимо);
g.newGame();

// ══════════════════════════════ цена кадра при лежащей добыче

log('── цена кадра при лежащей добыче');
{
  // Изображаем общий мир: добыча приходит снимком и заменяется целиком.
  net.state = 'online';
  net.pid = 1;
  const снимок = () => ({
    loot: Array.from({ length: 12 }, (_, i) => ({
      i: i + 1, x: 100 + i * 5, y: 100, g: 0, k: 'weapon', r: 'rare', o: 1,
    })),
  });
  g.loot = снимок().loot;
  g.draw();                       // первый кадр печёт иконки — это законно
  const после1 = холстов;
  for (let к = 0; к < 10; к++) { g.loot = снимок().loot; g.draw(); }
  const напечено = холстов - после1;
  log(`  двенадцать вещей, десять кадров: запечено холстов ${напечено}`);
  проверить('иконки лежащей добычи не перепекаются каждый кадр', напечено <= 12,
    `${напечено} за десять кадров при двенадцати вещах`,
    'каждая иконка строится заново двадцать раз в секунду — и каждая выгружает пиксели из видеопамяти');
  net.state = 'offline'; net.pid = null;
}

// ══════════════════════════════ чужой подбор не касается моего рюкзака

log('');
log('── чей подбор — чей рюкзак');
if (!ПОРТ) {
  log('  · сервера нет — чей подбор, чей рюкзак этот прогон не мерили');
  note('сервера нет: рассылка рюкзака не проверена');
} else {
  // Меряем поведение двумя настоящими игроками, а не поиском условия по тексту:
  // поиск проверял ровно ту форму записи, что была раньше, и любая другая
  // неверная проходила мимо.
  const U2 = `http://localhost:${ПОРТ}`;
  const гость = async () => (await (await fetch(`${U2}/auth/verify`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ guest: true }),
  })).json()).token;
  const войти = async (имя) => {
    const token = await гость();
    const c = { имя, рюкзаков: 0, pid: null, снимки: [], ws: new WebSocket(`ws://localhost:${ПОРТ}/`) };
    await new Promise((ok, fail) => {
      c.ws.addEventListener('open', () => c.ws.send(JSON.stringify({ t: 'hello', token, name: имя, at: { kind: 'biome', id: 'forest' } })));
      c.ws.addEventListener('close', () => fail(new Error('закрыто')));
      c.ws.addEventListener('message', (m) => {
        const x = JSON.parse(m.data);
        if (x.t === 'snap') { c.снимки.push(x); if (c.снимки.length > 4) c.снимки.shift(); return; }
        if (x.t === 'bag') c.рюкзаков++;
        if (x.t === 'welcome') { c.pid = x.pid; ok(); }
      });
      setTimeout(() => fail(new Error('нет welcome')), 5000);
    });
    c.пульс = setInterval(() => { try { c.ws.send(JSON.stringify({ t: 'input', s: [] })); } catch { /* нет */ } }, 3000);
    c.стоп = () => { clearInterval(c.пульс); try { c.ws.close(); } catch { /* нет */ } };
    return c;
  };

  const A = await войти('Подбирающий');
  const B = await войти('Сосед');
  await new Promise((r) => setTimeout(r, 1500));
  // Кладём добычу рядом с A прямо правилами комнаты — так же, как её кладёт
  // убитый враг. Через сокет её иначе не добыть быстро.
  const до = B.рюкзаков;
  const мой = (A.снимки.at(-1).players || []).find((p2) => p2.pid === A.pid);
  // Просим комнату уронить вещь: убиваем ближнего врага руками A.
  const цель = (A.снимки.at(-1).enemies || [])[0];
  if (цель && мой) {
    for (let i = 0; i < 60; i++) {
      const s2 = A.снимки.at(-1);
      const t2 = (s2.enemies || []).find((e) => e.i === цель.i);
      const m2 = (s2.players || []).find((p2) => p2.pid === A.pid);
      if (!t2 || !m2) break;
      const dx = t2.x - m2.x, dy = t2.y - m2.y, d = Math.hypot(dx, dy) || 1;
      if (d > 18) A.ws.send(JSON.stringify({ t: 'input', s: [[dx / d, dy / d, 0.05]], f: Math.atan2(dy, dx) }));
      else A.ws.send(JSON.stringify({ t: 'swing', combo: i % 3, f: Math.atan2(dy, dx) }));
      await new Promise((r) => setTimeout(r, 200));
    }
    // Поднимаем то, что выпало.
    const лежит = (A.снимки.at(-1).loot || [])[0];
    if (лежит) {
      for (let i = 0; i < 30; i++) {
        const s2 = A.снимки.at(-1);
        const m2 = (s2.players || []).find((p2) => p2.pid === A.pid);
        const l2 = (s2.loot || []).find((x) => x.i === лежит.i);
        if (!l2 || !m2) break;
        const dx = l2.x - m2.x, dy = l2.y - m2.y, d = Math.hypot(dx, dy) || 1;
        if (d > 12) A.ws.send(JSON.stringify({ t: 'input', s: [[dx / d, dy / d, 0.05]], f: 0 }));
        else { A.ws.send(JSON.stringify({ t: 'pickup', lid: l2.i })); break; }
        await new Promise((r) => setTimeout(r, 200));
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  const соседу = B.рюкзаков - до;
  log(`  A подбирал вещь; рюкзаков прислали соседу: ${соседу}`);
  проверить('чужой подбор не рассылает рюкзак соседям', соседу === 0,
    `${соседу} рассылок соседу`,
    'каждый подбор в комнате заставляет всех пересобрать весь рюкзак — с новой иконкой на каждую вещь');
  A.стоп(); B.стоп();
  await new Promise((r) => setTimeout(r, 300));
}

// ══════════════════════════════ строка «Сказать» на экране

log('');
log('── строка разговора');
{
  const { input } = await import('../src/core/input.js');
  input.набор = { text: 'привет' };
  const до = мимо.прямоугольники.length;
  g.draw();
  input.набор = null;
  const новые = мимо.прямоугольники.slice(до);
  // Полосу строки узнаём по ширине во весь экран.
  const полоса = новые.filter((r) => r.w >= 400 && r.h > 2 && r.h < 200);
  const видно = полоса.filter((r) => r.y >= 0 && r.y + r.h <= 270 && r.w <= 480);
  log(`  полос во всю ширину: ${полоса.length}, из них в пределах экрана: ${видно.length}`);
  if (!полоса.length) {
    note('строку разговора не нашли — этот прогон её не мерили');
    log('  ✗ строку не нашли');
  } else {
    проверить('строка разговора помещается на экран', видно.length === полоса.length,
      полоса.map((r) => `y=${Math.round(r.y)} h=${Math.round(r.h)} w=${Math.round(r.w)}`).join(', ').slice(0, 80),
      'печатаешь вслепую: строка уехала за край, потому что взяты размеры буфера, а рисуется по слою с масштабом');
  }
}

// ══════════════════════════════ звук после сворачивания

log('');
log('── звук после сворачивания');
{
  // Меряем поведение: подписываемся, шлём событие, смотрим, разбудили ли звук.
  // Поиск слова `visibilitychange` по тексту ничего не значил — мутация,
  // обернувшая слушателя в `if (false)`, проходила мимо него насквозь.
  const { audio } = await import('../src/core/audio.js');
  const слушатели = [];
  const окно = {
    addEventListener: (имя, fn) => слушатели.push([имя, fn]),
    document: { visibilityState: 'visible' },
  };
  let будили = 0;
  const былResume = audio.resume.bind(audio);
  audio.resume = () => { будили++; };
  const включили = audio.следитьЗаВкладкой(окно);
  проверить('звук умеет следить за вкладкой', включили === true,
    включили ? 'подписались' : 'подписаться нечем',
    'правила «проснуться вместе с вкладкой» нет вовсе');
  for (const [имя, fn] of слушатели) if (имя === 'visibilitychange') fn();
  проверить('возвращение на вкладку будит звук', будили > 0,
    `разбудили ${будили} раз`,
    'свернул игру на телефоне — и звука нет до перезагрузки страницы');
  audio.resume = былResume;
}

// ══════════════════════════════ причина отказа видна на титуле

log('');
log('── отказ входа в общий мир');
{
  const текст = файл('src/ui/menus.js');
  // На титуле HUD не рисуется — значит и `toast` там никто не увидит.
  const черезHUD = /goOnline\(\)\.then\([^)]*\)\s*=>\s*\{[^}]*toast\(/.test(текст.replace(/\n/g, ' '));
  проверить('причина отказа не уходит в HUD с титульного экрана', !черезHUD,
    черезHUD ? 'показывают через toast' : 'своя строка состояния',
    'игрок жмёт кнопку, вход не удаётся, и на экране не появляется ничего');
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
