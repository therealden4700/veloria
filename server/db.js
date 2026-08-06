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
// Честно о том, чем это пока не является. Сервер ХРАНИТ персонажа и выдаёт его
// по подписи — то есть прогресс больше не теряется с кэшем браузера и не
// принадлежит устройству. Но проверять КАЖДОЕ изменение он пока не умеет:
// слепок приходит от клиента целиком. Чтобы сервер стал источником правды, а не
// сейфом, мутации должны считаться на нём — это следующая работа, и начнётся
// она с боя.

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
      data      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_depth ON characters(deepest DESC);
    CREATE INDEX IF NOT EXISTS idx_level ON characters(level DESC);
  `);
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
  const row = q('SELECT * FROM characters WHERE address = ?').get(address);
  if (!row) return null;
  try {
    return { ...row, data: JSON.parse(row.data) };
  } catch {
    // повреждённый слепок не должен запирать игрока снаружи: считаем, что
    // персонажа нет, и даём начать заново
    return null;
  }
}

export function saveCharacter(address, data, name) {
  const level = Number(data && data.player && data.player.level) || 1;
  const deepest = Number(data && data.player && data.player.deepest) || 0;
  const text = JSON.stringify(data);
  if (text.length > 512 * 1024) return { ok: false, why: 'слепок слишком велик' };
  q(`INSERT INTO characters (address, name, level, deepest, updated, data)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(address) DO UPDATE SET
       name = excluded.name, level = excluded.level,
       deepest = MAX(characters.deepest, excluded.deepest),
       updated = excluded.updated, data = excluded.data`)
    .run(address, String(name || '').slice(0, 24), level, deepest, Date.now(), text);
  return { ok: true, level, deepest };
}

/** Таблица глубины — то, ради чего в Бездну возвращаются. */
export function topDepth(n = 20) {
  return q('SELECT address, name, level, deepest FROM characters WHERE deepest > 0 ORDER BY deepest DESC, level DESC LIMIT ?')
    .all(Math.min(100, Math.max(1, n | 0)));
}

export function dbStats() {
  const a = q('SELECT COUNT(*) AS n FROM accounts').get();
  const c = q('SELECT COUNT(*) AS n FROM characters').get();
  return { accounts: a.n, characters: c.n, file: FILE };
}

export function closeDb() { if (db) { db.close(); db = null; } }
