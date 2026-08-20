// Хранилище: учётные записи и персонажи.
//
// SQLite взят встроенный (`node:sqlite`) — зависимостей по-прежнему ноль, а
// файл базы можно скопировать, посмотреть и починить обычными средствами.
//
// Персонаж лежит одним слепком JSON плюс несколько вынесенных колонок — уровень
// и рекорд глубины. Вынесены они не для красоты: по ним строится таблица
// рекордов, а лезть за этим внутрь слепка каждого игрока — верный способ
// получить полный перебор на ровном месте.
//
// Персонажей у адреса два, и это не небрежность, а граница доверия.
//
// `data` — резервная копия одиночной игры. Её присылает клиент, и проверить её
// нельзя ничем: в слепке можно попросить что угодно. Она нужна ровно для
// одного — чтобы герой не пропал вместе с кэшем браузера. В общий мир она не
// входит никогда.
//
// `world` — герой общего мира. Его считает комната: бой, добыча, опыт и
// уровень меняются только там и оттуда же уезжают сюда. Клиент к этой колонке
// не притрагивается.
//
// Раньше колонка была одна, и та, которую присылает клиент. Замер: настоящая
// учётка попросила легендарку с атакой 9999 и девять миллионов золота — сервер
// положил это в базу и вернул при следующем входе.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FILE = process.env.VELORIA_DB || resolve(ROOT, 'data/veloria.db');

let db = null;

export function openDb(file = FILE) {
  if (db) return db;
  mkdirSync(dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS accounts (
      address   TEXT PRIMARY KEY,
      created   INTEGER NOT NULL,
      seen      INTEGER NOT NULL,
      logins    INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS characters (
      address   TEXT PRIMARY KEY,
      name      TEXT,
      level     INTEGER NOT NULL DEFAULT 1,
      deepest   INTEGER NOT NULL DEFAULT 0,
      updated   INTEGER NOT NULL,
      data      TEXT NOT NULL,
      world     TEXT
    );
    -- Сессии.
    --
    -- Жили только в памяти, и каждое обновление сервера разлогинивало всех: а
    -- токен лежит в браузере неделю, и человек жал «В общий город» и получал
    -- отказ, ничего не сделав. Выкладка — обычное дело, и она не должна
    -- выбрасывать тех, кто в этот миг играет.
    CREATE TABLE IF NOT EXISTS sessions (
      token   TEXT PRIMARY KEY,
      address TEXT,
      guest   INTEGER NOT NULL DEFAULT 0,
      born    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sess_born ON sessions(born);
    CREATE INDEX IF NOT EXISTS idx_depth ON characters(deepest DESC);
    CREATE INDEX IF NOT EXISTS idx_level ON characters(level DESC);
  `);
  // База могла родиться до разделения на «копию клиента» и «героя мира».
  const колонки = db.prepare('PRAGMA table_info(characters)').all().map((c) => c.name);
  if (!колонки.includes('world')) db.exec('ALTER TABLE characters ADD COLUMN world TEXT');
  return db;
}

const q = (sql) => openDb().prepare(sql);

/** Отметить вход. Возвращает запись — новую или уже бывшую. */
export function touchAccount(address) {
  const now = Date.now();
  q(`INSERT INTO accounts (address, created, seen, logins) VALUES (?, ?, ?, 1)
     ON CONFLICT(address) DO UPDATE SET seen = excluded.seen, logins = logins + 1`)
    .run(address, now, now);
  return q('SELECT * FROM accounts WHERE address = ?').get(address);
}

export function loadCharacter(address) {
  // `.get()` тоже может бросить: node:sqlite не умеет отдать целое больше 2^53
  // и роняет чтение строки целиком. Такая строка запирала владельца снаружи —
  // ни входа, ни персонажа, а try стоял только вокруг разбора JSON.
  let row;
  try {
    row = q('SELECT * FROM characters WHERE address = ?').get(address);
  } catch (e) {
    console.error('чтение персонажа', address, '—', e.message);
    return null;
  }
  if (!row) return null;
  try {
    return { ...row, data: JSON.parse(row.data) };
  } catch {
    // повреждённый слепок не должен запирать игрока снаружи: считаем, что
    // персонажа нет, и даём начать заново
    return null;
  }
}

/** Целое из чужих рук: только конечное и только в границах колонки. */
const цел = (v, min, max, свой) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : свой;
};

/**
 * Герой общего мира — тот, которого считает комната.
 *
 * Возвращает `null`, если этот адрес в мир ещё не входил: тогда комната
 * начинает ему нового. Копию из одиночной игры сюда не берём никогда — её
 * прислал клиент, и верить ей нечем.
 */
export function loadWorldCharacter(address) {
  let row;
  try { row = q('SELECT world FROM characters WHERE address = ?').get(address); }
  catch (e) { console.error('чтение героя мира', address, '—', e.message); return null; }
  if (!row || !row.world) return null;
  try { return JSON.parse(row.world); } catch { return null; }
}

/** Записать героя мира. Пишет только комната. */
export function saveWorldCharacter(address, data, name) {
  const level = цел(data && data.player && data.player.level, 1, 60, 1);
  const deepest = цел(data && data.player && data.player.deepest, 0, 9999, 0);
  const text = JSON.stringify(data);
  if (text.length > 512 * 1024) return { ok: false, why: 'слепок слишком велик' };
  q(`INSERT INTO characters (address, name, level, deepest, updated, data, world)
     VALUES (?, ?, ?, ?, ?, '{}', ?)
     ON CONFLICT(address) DO UPDATE SET
       name = excluded.name, level = excluded.level,
       deepest = MAX(characters.deepest, excluded.deepest),
       updated = excluded.updated, world = excluded.world`)
    .run(address, String(name || '').slice(0, 24), level, deepest, Date.now(), text);
  return { ok: true, level, deepest };
}

export function saveCharacter(address, data, name) {
  // Границы здесь не украшение. Число больше 2^53 sqlite примет, а при чтении
  // node:sqlite бросит RangeError — и одна такая строка отравляет всё, что её
  // читает: доску глубины для всех и вход для самого владельца. Проверено
  // одним POST с deepest = 1e18: /leaderboard и /auth/verify начали отдавать 500.
  const level = цел(data && data.player && data.player.level, 1, 60, 1);
  const deepest = цел(data && data.player && data.player.deepest, 0, 9999, 0);
  const text = JSON.stringify(data);
  if (text.length > 512 * 1024) return { ok: false, why: 'слепок слишком велик' };
  // Уровень и глубину из копии клиента на доску не пускаем: доска — про общий
  // мир, а копию присылает клиент. Колонки трогает только герой мира.
  q(`INSERT INTO characters (address, name, level, deepest, updated, data)
     VALUES (?, ?, 1, 0, ?, ?)
     ON CONFLICT(address) DO UPDATE SET
       name = excluded.name, updated = excluded.updated, data = excluded.data`)
    .run(address, String(name || '').slice(0, 24), Date.now(), text);
  return { ok: true, level, deepest, saved: 'копия одиночной игры' };
}

/** Таблица глубины — то, ради чего в Бездну возвращаются. */
export function topDepth(n = 20) {
  // Старые строки могли лечь до проверки границ — одна такая не должна ронять
  // доску целиком.
  try {
    return q('SELECT address, name, level, deepest FROM characters WHERE deepest > 0 AND world IS NOT NULL ORDER BY deepest DESC, level DESC LIMIT ?')
      .all(Math.min(100, Math.max(1, n | 0)));
  } catch (e) {
    console.error('доска глубины: битая строка в базе —', e.message);
    return [];
  }
}

export function dbStats() {
  const a = q('SELECT COUNT(*) AS n FROM accounts').get();
  const c = q('SELECT COUNT(*) AS n FROM characters').get();
  return { accounts: a.n, characters: c.n, file: FILE };
}

/** Записать сессию: она должна пережить обновление сервера. */
export function saveSession(token, address, guest, born) {
  try { q('INSERT OR REPLACE INTO sessions (token,address,guest,born) VALUES (?,?,?,?)').run(token, address ?? null, guest ? 1 : 0, born); } catch { /* не беда: в памяти она есть */ }
}

/** Прочитать сессию с диска. Зовут только когда в памяти её нет. */
export function loadSession(token) {
  try {
    const r = q('SELECT address, guest, born FROM sessions WHERE token = ?').get(token);
    return r ? { address: r.address ?? null, guest: !!r.guest, born: r.born } : null;
  } catch { return null; }
}

export function dropSession(token) {
  try { q('DELETE FROM sessions WHERE token = ?').run(token); } catch { /* нет так нет */ }
}

/** Выбросить протухшие. Зовут изредка: таблица маленькая, но не бесконечная. */
export function sweepSessions(старше) {
  try { q('DELETE FROM sessions WHERE born < ?').run(старше); } catch { /* нет так нет */ }
}

/**
 * Забыть учётку целиком: адрес, персонажа и все её сессии.
 *
 * Хранится немного — адрес кошелька, время входов и герой, — но это чужие
 * данные, и уйти человек должен уметь так же просто, как пришёл. Стираем всё
 * разом, а не помечаем удалённым: помеченное остаётся хранимым.
 */
export function forgetAccount(address) {
  try {
    const db2 = openDb();
    db2.exec('BEGIN');
    q('DELETE FROM characters WHERE address = ?').run(address);
    q('DELETE FROM sessions WHERE address = ?').run(address);
    q('DELETE FROM accounts WHERE address = ?').run(address);
    db2.exec('COMMIT');
    return { ok: true, what: 'удалено' };
  } catch (e) {
    try { openDb().exec('ROLLBACK'); } catch { /* уже откатилось */ }
    return { ok: false, why: 'не удалось удалить: ' + e.message };
  }
}

export function closeDb() { if (db) { db.close(); db = null; } }
