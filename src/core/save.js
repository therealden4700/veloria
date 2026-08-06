// Сохранение: один слот больше не единственная копия героя.
//
// ── Что именно защищаем
//
// Оборванной записи в localStorage не бывает: `setItem` либо прошёл целиком,
// либо бросил — и тогда старое значение цело. Настоящих способов потерять
// героя три, и защита у каждого своя:
//
//   1. игра сама записала испорченные данные поверх хороших  → проверка перед
//      записью: не прошла — старый сейв остаётся нетронутым;
//   2. чтение упало, и игра молча предложила начать заново    → резервные копии
//      и явный ответ, из какой копии взяли;
//   3. браузер вычистил хранилище (инкогнито, «очистить данные
//      сайта», квота)                                          → выгрузка в файл,
//      которую делает сам игрок.
//
// ── Почему копий не жалко
//
// Замер: сейв весит 4 КБ при пустом рюкзаке и 25,6 КБ при набитом под завязку.
// Четыре копии — около 100 КБ, то есть 2% от пятимегабайтного лимита. Дёшево.
//
// Копии разносим **по времени, а не по числу записей**. Игра сохраняется часто
// (автосейв, каждый переход между зонами), и три последние записи оказались бы
// все из последней минуты — от порчи, замеченной через полчаса, они не спасают.
// Поэтому новая копия заводится, только если самой свежей уже больше десяти
// минут: три копии покрывают примерно полчаса игры.

const KEY = 'veloria.save.v1';
const BAK = ['veloria.save.v1.bak1', 'veloria.save.v1.bak2', 'veloria.save.v1.bak3'];
const BAK_SPACING = 10 * 60 * 1000;

const now = () => Date.now();

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
function drop(key) {
  try { localStorage.removeItem(key); } catch {}
}

/**
 * Похоже ли это на целого героя.
 *
 * Проверка нарочно **грубая**: её дело — поймать испорченное (NaN в уровне,
 * пропавший рюкзак, пустой объект), а не пересказать формат. Строгая проверка
 * отказала бы в сохранении при первом же безобидном изменении структуры, и
 * лекарство вышло бы хуже болезни.
 *
 * Возвращает причину отказа строкой или `null`, если всё в порядке.
 */
export function checkSave(data) {
  if (!data || typeof data !== 'object') return 'данных нет';
  const p = data.player;
  if (!p || typeof p !== 'object') return 'нет героя';
  if (!Number.isFinite(p.level) || p.level < 1) return 'уровень не число';
  for (const k of ['xp', 'gold', 'hp', 'mp', 'str', 'vit', 'agi', 'int']) {
    if (p[k] !== undefined && !Number.isFinite(p[k])) return `${k} не число`;
  }
  if (p.inventory !== undefined && !Array.isArray(p.inventory)) return 'рюкзак не список';
  if (p.equipment !== undefined && (typeof p.equipment !== 'object' || p.equipment === null)) return 'снаряжение не объект';
  return null;
}

/** Разобрать запись и проверить. Возвращает `{ data, t }` или `null`. */
function parseSlot(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 1) return null;
    if (checkSave(parsed.data)) return null;
    return { data: parsed.data, t: parsed.t || 0 };
  } catch { return null; }
}

/** Сдвинуть текущий сейв в резерв, если самой свежей копии уже больше срока. */
function rotate(currentRaw) {
  if (!currentRaw) return;
  const newest = parseSlot(read(BAK[0]));
  const cur = parseSlot(currentRaw);
  if (!cur) return;                                  // нечего беречь
  if (newest && cur.t - newest.t < BAK_SPACING) return;
  for (let i = BAK.length - 1; i > 0; i--) {
    const prev = read(BAK[i - 1]);
    if (prev) write(BAK[i], prev);
  }
  write(BAK[0], currentRaw);
}

// Причину отказа кладём сюда: игре есть что показать игроку.
export let lastSaveProblem = null;

/**
 * Записать сейв.
 *
 * `opts.fresh` — это осознанное начало новой игры, единственный случай, когда
 * уровень вправе упасть.
 */
export function saveGame(data, opts = {}) {
  const problem = checkSave(data);
  if (!problem && !opts.fresh) {
    // Проверка целостности видит только испорченные данные. А потерять героя
    // можно и вполне целыми: достаточно записать поверх него свежесозданного
    // первого уровня — я сам так и сделал, вызвав сохранение с титульного
    // экрана, где `player` ещё пустой. Уровень у героя не падает никогда
    // (смерть отнимает золото, а не уровень), поэтому падение уровня — верный
    // признак, что пишут не того.
    const prev = parseSlot(read(KEY));
    if (prev && Number.isFinite(prev.data.player.level) && data.player.level < prev.data.player.level) {
      lastSaveProblem = `уровень ${data.player.level} ниже сохранённого ${prev.data.player.level}`;
      console.warn('сохранение отклонено:', lastSaveProblem);
      return false;
    }
  }
  if (problem) {
    // Главное правило: плохим хорошее не затираем. Лучше не сохраниться вовсе,
    // чем записать поверх целого героя обломки.
    lastSaveProblem = problem;
    console.warn('сохранение отклонено:', problem);
    return false;
  }
  const raw = JSON.stringify({ v: 1, t: now(), data });
  rotate(read(KEY));
  if (!write(KEY, raw)) {
    lastSaveProblem = 'хранилище недоступно';
    return false;
  }
  lastSaveProblem = null;
  return true;
}

/**
 * Прочитать сейв: основной слот, а если он мёртв — самая свежая живая копия.
 *
 * Возвращает данные, как и раньше. Откуда именно взяли — в `lastLoadSource`,
 * чтобы игра могла сказать игроку «загружена копия получасовой давности»
 * вместо молчаливого предложения начать заново.
 */
export let lastLoadSource = null;

export function loadGame() {
  const main = parseSlot(read(KEY));
  if (main) { lastLoadSource = { откуда: 'основной', t: main.t }; return main.data; }

  for (let i = 0; i < BAK.length; i++) {
    const b = parseSlot(read(BAK[i]));
    if (b) {
      lastLoadSource = { откуда: `копия ${i + 1}`, t: b.t, возраст: now() - b.t };
      return b.data;
    }
  }
  lastLoadSource = null;
  return null;
}

export function hasSave() {
  if (parseSlot(read(KEY))) return true;
  return BAK.some((k) => !!parseSlot(read(k)));
}

/** Стереть героя. Копии уходят вместе с ним — иначе «новая игра» не новая. */
export function wipeSave() {
  drop(KEY);
  for (const k of BAK) drop(k);
}

// ─────────────────────────────────────────── выгрузка и загрузка файлом

/** Что показать игроку про его сохранения. */
export function saveInfo() {
  const main = parseSlot(read(KEY));
  const copies = BAK.map((k) => parseSlot(read(k))).filter(Boolean);
  const size = (read(KEY) || '').length + copies.reduce((s, _, i) => s + (read(BAK[i]) || '').length, 0);
  return {
    есть: !!main,
    уровень: main ? main.data.player.level : 0,
    когда: main ? main.t : 0,
    копий: copies.length,
    старшаяКопия: copies.length ? copies[copies.length - 1].t : 0,
    байт: size,
  };
}

/** Текст файла для выгрузки. `null`, если сохранять нечего. */
export function exportSave() {
  const main = parseSlot(read(KEY)) || BAK.map((k) => parseSlot(read(k))).find(Boolean);
  if (!main) return null;
  return JSON.stringify({ game: 'veloria', v: 1, t: main.t, data: main.data }, null, 1);
}

/**
 * Принять файл обратно.
 *
 * Перед записью текущий сейв уходит в резерв безусловно — импорт чужого файла
 * не должен стирать своего героя без следа. Возвращает `{ ok, reason, level }`.
 */
export function importSave(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { ok: false, reason: 'файл не читается' }; }
  if (!parsed || parsed.game !== 'veloria') return { ok: false, reason: 'это не сохранение Велории' };
  const problem = checkSave(parsed.data);
  if (problem) return { ok: false, reason: 'сохранение испорчено: ' + problem };

  const cur = read(KEY);
  if (cur) {
    for (let i = BAK.length - 1; i > 0; i--) {
      const prev = read(BAK[i - 1]);
      if (prev) write(BAK[i], prev);
    }
    write(BAK[0], cur);
  }
  if (!write(KEY, JSON.stringify({ v: 1, t: now(), data: parsed.data }))) {
    return { ok: false, reason: 'хранилище недоступно' };
  }
  return { ok: true, level: parsed.data.player.level };
}

// ── настройки тоже отдельно от сейва: громкость принадлежит человеку, а не
// персонажу. Иначе «Новая игра» каждый раз возвращала бы звук на максимум, а до
// первого сохранения настройки вообще негде было бы хранить.
const OPT_KEY = 'veloria.options.v1';

export function loadOptions() {
  try {
    const o = JSON.parse(localStorage.getItem(OPT_KEY) || '{}');
    return (o && typeof o === 'object') ? o : {};
  } catch { return {}; }
}

export function saveOptions(o) {
  try { localStorage.setItem(OPT_KEY, JSON.stringify(o)); } catch {}
}

// ── рекорд глубины живёт отдельно от сейва: новая игра его не стирает,
// иначе ладдер обнулялся бы вместе с персонажем и терял смысл
const DEPTH_KEY = 'veloria.depth.v1';

export function bestDepth() {
  try { return parseInt(localStorage.getItem(DEPTH_KEY), 10) || 0; } catch { return 0; }
}

export function recordDepth(floor) {
  try {
    if (floor > bestDepth()) { localStorage.setItem(DEPTH_KEY, String(floor)); return true; }
  } catch {}
  return false;
}
