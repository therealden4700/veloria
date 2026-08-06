// Проверка сохранения: переживёт ли герой то, что с ним случается.
//
//   node tools/save-check.js
//
// Сохранение — единственное место в игре, где ошибка **необратима**. Бой можно
// перебалансировать, зону перегенерировать, а стёртого персонажа не вернуть.
// Поэтому здесь не «работает ли запись», а «что будет, когда пойдёт не так».
//
// Проверяется на настоящем `localStorage` (в Node он свой, файловый):
//   1. запись и чтение туда-обратно не теряют героя;
//   2. испорченные данные НЕ затирают целый сейв;
//   3. побитый основной слот поднимается из резервной копии;
//   4. копии разносятся по времени, а не по числу записей;
//   5. выгрузка и загрузка файлом дают того же героя;
//   6. чужой или битый файл отвергается, а свой герой при этом цел;
//   7. «новая игра» уносит и копии — иначе она не новая.

import { installHeadless } from '../src/core/headless.js';

installHeadless();

const store = await import('../src/core/save.js');
const { Player } = await import('../src/entities/player.js');
const { makeItem, makeRune, reviveItem } = await import('../src/systems/items.js');
const { makeRng } = await import('../src/core/rng.js');

const fails = [];
const ok = [];
const check = (name, cond, detail = '') => {
  if (cond) ok.push(name);
  else fails.push(name + (detail ? ' — ' + detail : ''));
};

/** Герой поплотнее: со снаряжением, рунами и добром в рюкзаке. */
function hero(level = 24) {
  const rng = makeRng(20260805);
  const p = new Player(0, 0);
  p.level = level; p.gold = 4321; p.kills = 512; p.deepest = 17;
  p.str += 20; p.agi += 14; p.vit += 18; p.int += 9;
  p.equipment.weapon = makeItem({ kind: 'weapon', sub: 'spear', tier: 4, rarity: 'legendary', level, rng });
  p.equipment.armor = makeItem({ kind: 'armor', tier: 4, rarity: 'epic', level, rng });
  p.equipment.skill1 = makeRune('firewall', 'rare', 2);
  for (let i = 0; i < 12; i++) p.inventory.push(makeItem({ kind: 'weapon', sub: 'axe', tier: 3, rarity: 'rare', level, rng }));
  p.hp = p.maxHp; p.mp = p.maxMp;
  return p;
}

const payload = (p) => ({ player: p.toJSON(), quests: { completedIds: [], list: [] }, worldSeed: 777, seenLessons: { swing: 1 } });

// ─────────────────────────────────────────── 1. туда-обратно

store.wipeSave();
const p0 = hero();
const d0 = payload(p0);
check('запись прошла', store.saveGame(d0) === true);

const back = store.loadGame();
check('чтение вернуло героя', !!back);
if (back) {
  const p1 = new Player(0, 0);
  p1.fromJSON(back.player, reviveItem);
  check('уровень цел', p1.level === p0.level, `${p0.level} → ${p1.level}`);
  check('золото цело', p1.gold === p0.gold, `${p0.gold} → ${p1.gold}`);
  check('рюкзак цел', p1.inventory.length === p0.inventory.length, `${p0.inventory.length} → ${p1.inventory.length}`);
  const eq0 = Object.values(p0.equipment).filter(Boolean).length;
  const eq1 = Object.values(p1.equipment).filter(Boolean).length;
  check('снаряжение цело', eq0 === eq1, `${eq0} → ${eq1}`);
  check('легендарное свойство цело', !!(p1.equipment.weapon && p1.equipment.weapon.unique) === !!(p0.equipment.weapon && p0.equipment.weapon.unique));
  check('руна цела', !!p1.equipment.skill1 && p1.equipment.skill1.sub === 'firewall');
}

// ─────────────────────────────────────────── 2. порча не затирает целое

const битые = [
  ['пустой объект', {}],
  ['нет героя', { player: null }],
  ['уровень NaN', { player: { ...d0.player, level: NaN } }],
  ['золото NaN', { player: { ...d0.player, gold: NaN } }],
  ['рюкзак не список', { player: { ...d0.player, inventory: 'ой' } }],
  ['null вместо всего', null],
];
for (const [name, bad] of битые) {
  const wrote = store.saveGame(bad);
  check(`отклонён сейв: ${name}`, wrote === false, 'запись прошла, хотя не должна');
}
const после = store.loadGame();
check('целый герой пережил все попытки порчи', !!после && после.player.level === p0.level,
  после ? `уровень ${после.player.level}` : 'сейв исчез');

// ─────────────────────────────────────────── 3. подъём из копии

// заводим копию: вторая запись спустя срок разноса
store.wipeSave();
store.saveGame(payload(hero(24)));
store.saveGame(payload(hero(31)));
check('копия завелась', store.saveInfo().копий === 1, `копий ${store.saveInfo().копий}`);

localStorage.setItem('veloria.save.v1', '{это не json');
const спасён = store.loadGame();
check('битый основной слот поднялся из копии', !!спасён && спасён.player.level === 24,
  спасён ? `уровень ${спасён.player.level}` : 'ничего не вернулось');
check('источник назван', store.lastLoadSource && store.lastLoadSource.откуда !== 'основной',
  JSON.stringify(store.lastLoadSource));
check('hasSave видит копию при мёртвом основном', store.hasSave() === true);

// ─────────────────────────────────────────── 4. копии разносятся по времени

// Первая копия заводится сразу — это верно: вторая копия нужна с первой же
// минуты, а не через десять. Проверяем другое, то, ради чего и разносили по
// времени: частые записи не должны **вытеснять** уже накопленные копии.
store.wipeSave();
// Времени в стенде не течёт, поэтому старим **все** слоты сразу: правило
// разноса сравнивает свежесть основного слота со свежестью копии, и сдвиг
// одного лишь основного ничего не меняет — на эту тонкость я и наступил.
const старение = (мин) => {
  for (const k of ['veloria.save.v1', 'veloria.save.v1.bak1', 'veloria.save.v1.bak2', 'veloria.save.v1.bak3']) {
    const raw = localStorage.getItem(k);
    if (!raw) continue;
    try { const o = JSON.parse(raw); o.t -= мин * 60 * 1000; localStorage.setItem(k, JSON.stringify(o)); } catch {}
  }
};
store.saveGame(payload(hero(10))); старение(11);
store.saveGame(payload(hero(11))); старение(11);
store.saveGame(payload(hero(12))); старение(11);
store.saveGame(payload(hero(13)));
const цепочка = store.saveInfo().копий;
check('копии накопились с разносом по времени', цепочка === 3, `копий ${цепочка}`);
// Одно смещение цепочки после серии законно: с последней копии прошло больше
// срока разноса, и текущий сейв заслужил место в резерве. Недопустимо другое —
// чтобы тридцать записей подряд вымыли резерв целиком. Это и проверяем: сколько
// из прежних копий пережило серию.
const метки = () => ['bak1', 'bak2', 'bak3']
  .map((b) => localStorage.getItem('veloria.save.v1.' + b))
  .filter(Boolean).map((r) => { try { return JSON.parse(r).t; } catch { return 0; } });
const было = метки();
for (let i = 0; i < 30; i++) store.saveGame(payload(hero(20 + i)));
const стало = метки();
const выжило = было.filter((t) => стало.includes(t)).length;
check('тридцать записей подряд не вымыли резерв', выжило >= было.length - 1,
  `из ${было.length} копий пережило ${выжило}`);
check('резерв остался полным', store.saveInfo().копий === цепочка, `копий ${store.saveInfo().копий}`);

// ─────────────────────────────────────────── 5. файл туда-обратно

store.wipeSave();
const pf = hero(28);
store.saveGame(payload(pf));
const file = store.exportSave();
check('выгрузка дала файл', typeof file === 'string' && file.length > 100);

store.wipeSave();
check('после стирания сейва нет', store.hasSave() === false);
const imp = store.importSave(file);
check('загрузка файла прошла', imp.ok === true, imp.reason || '');
const afterImport = store.loadGame();
check('герой из файла тот же', !!afterImport && afterImport.player.level === 28,
  afterImport ? `уровень ${afterImport.player.level}` : 'ничего');
if (afterImport) {
  const p2 = new Player(0, 0);
  p2.fromJSON(afterImport.player, reviveItem);
  check('рюкзак из файла цел', p2.inventory.length === pf.inventory.length, `${pf.inventory.length} → ${p2.inventory.length}`);
}

// ─────────────────────────────────────────── 6. чужой файл отвергается

const мой = store.loadGame().player.level;
for (const [name, text] of [
  ['мусор', 'просто текст'],
  ['чужая игра', JSON.stringify({ game: 'other', v: 1, data: { player: { level: 99 } } })],
  ['битый герой', JSON.stringify({ game: 'veloria', v: 1, data: { player: { level: 'много' } } })],
]) {
  const r = store.importSave(text);
  check(`отвергнут файл: ${name}`, r.ok === false, 'принят, хотя не должен');
}
const целПосле = store.loadGame();
check('свой герой пережил чужие файлы', !!целПосле && целПосле.player.level === мой,
  целПосле ? `уровень ${целПосле.player.level}` : 'исчез');

// импорт кладёт прежнего героя в резерв, а не выбрасывает
store.wipeSave();
store.saveGame(payload(hero(33)));
store.importSave(store.exportSave().replace('"level": 33', '"level": 7'));
check('прежний герой ушёл в резерв, а не пропал', store.saveInfo().копий >= 1,
  `копий ${store.saveInfo().копий}`);

// ─────────────────────────────────────────── 7. понижение уровня отвергается

store.wipeSave();
store.saveGame(payload(hero(30)));
const слабый = payload(hero(1));
check('запись героя послабее отклонена', store.saveGame(слабый) === false,
  'прошла, хотя уровень 1 против 30');
check('причина названа', /ниже сохранённого/.test(store.lastSaveProblem || ''), store.lastSaveProblem || '');
const выжил = store.loadGame();
check('сильный герой цел', !!выжил && выжил.player.level === 30,
  выжил ? `уровень ${выжил.player.level}` : 'исчез');
check('новая игра всё же пишется', store.saveGame(слабый, { fresh: true }) === true);
check('после новой игры герой первого уровня', store.loadGame().player.level === 1);
check('рост уровня проходит как обычно', store.saveGame(payload(hero(2))) === true);

// ─────────────────────────────────────────── 8. новая игра уносит копии

store.wipeSave();
check('стирание уносит и копии', store.hasSave() === false && store.saveInfo().копий === 0);

// ─────────────────────────────────────────── итог

console.log(`проверок пройдено: ${ok.length}`);
if (!fails.length) { console.log('ПРОБЛЕМ НЕ НАЙДЕНО'); process.exit(0); }
console.log(`\nнайдено: ${fails.length}`);
for (const f of fails) console.log('  ' + f);
process.exit(1);
