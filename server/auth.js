// Вход по подписи кошелька: та половина, которой не хватало.
//
// До сих пор адрес приходил от клиента и означал ровно ничего — назваться чужим
// адресом мог кто угодно, подменив ответ кошелька в консоли. Здесь появляется
// доказательство: сервер выдаёт одноразовое число, кошелёк подписывает текст с
// ним, сервер проверяет подпись ed25519 против публичного ключа. Публичный ключ
// у Solana — это и есть адрес, только записанный base58.
//
// Ни библиотек, ни зависимостей: base58 — двадцать строк, ed25519 умеет сам
// Node через JWK.
//
// Чего эта проверка НЕ делает: она подтверждает, что человек владеет ключом от
// адреса. Она не подтверждает, что он не запустил изменённый клиент. Честность
// самой игры — отдельная работа, и она в том, чтобы сервер считал бой сам.

import { createPublicKey, verify, randomBytes, timingSafeEqual } from 'node:crypto';
// Сессии живут на диске: обновление сервера не должно разлогинивать всех.
import { saveSession, loadSession, dropSession, sweepSessions } from './db.js';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58MAP = (() => { const m = new Map(); for (let i = 0; i < B58.length; i++) m.set(B58[i], i); return m; })();

/** base58 → байты. Ошибка — null, а не исключение: сюда приходит чужой ввод. */
export function base58Decode(s) {
  if (typeof s !== 'string' || !s.length || s.length > 64) return null;
  const bytes = [0];
  for (const ch of s) {
    const v = B58MAP.get(ch);
    if (v === undefined) return null;
    let carry = v;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  // ведущие единицы в base58 — это ведущие нули в байтах
  for (let i = 0; i < s.length && s[i] === '1'; i++) bytes.push(0);
  return Buffer.from(bytes.reverse());
}

const NONCE_TTL = 5 * 60 * 1000;      // пять минут на подпись — с запасом
const nonces = new Map();             // одноразовое число → { address, born }

// Сколько кодов и сессий держим. Обе карты наполняются с открытых входов —
// `POST /auth/nonce` и `POST /auth/verify {guest:true}` не требуют ничего, — и
// без потолка растут ровно столько, сколько к серверу обращаются.
const MAX_NONCES = 20000;
const MAX_SESSIONS = 50000;

/**
 * Убрать просроченное и, если всё ещё тесно, самое старое.
 *
 * Карты в JS хранят порядок вставки, поэтому «самое старое» — это первые ключи;
 * перебирать всё ради этого не нужно.
 */
function подрезать(карта, ttl, потолок) {
  const now = Date.now();
  if (карта.size > потолок) {
    for (const [k, v] of карта) {
      if (now - v.born <= ttl && карта.size <= потолок) break;
      карта.delete(k);
      if (карта.size <= потолок * 0.9) break;
    }
  }
}

// Просрочку снимаем по времени, а не обходом на каждой выдаче: обход стоил
// линейно от числа накопленных, то есть суммарно квадрат — и всё это в том же
// однопоточном цикле, где идёт такт комнаты.
const уборка = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of nonces) { if (now - v.born > NONCE_TTL) nonces.delete(k); else break; }
  for (const [k, v] of sessions) { if (now - v.born > SESSION_TTL) sessions.delete(k); else break; }
  // На диске тоже: таблица маленькая, но не бесконечная, и протухшее в ней
  // копилось бы всё время жизни сервера.
  sweepSessions(now - SESSION_TTL);
}, 60000);
if (уборка.unref) уборка.unref();

/** Выдать одноразовое число под конкретный адрес. */
export function issueNonce(address) {
  const n = randomBytes(16).toString('hex');
  nonces.set(n, { address: String(address || ''), born: Date.now() });
  подрезать(nonces, NONCE_TTL, MAX_NONCES);
  return n;
}

/**
 * Текст, который подписывает кошелёк.
 *
 * Обязан совпадать с тем, что строит клиент, до последнего пробела — иначе
 * подпись не сойдётся. Поэтому образец живёт в одном месте и здесь, и там.
 */
/**
 * Текст, который игрок увидит в окне кошелька, — на его языке.
 *
 * Подписывать «непонятные байты» — худшая привычка, которую можно привить
 * игроку: ровно так уводят средства. Значит текст обязан быть читаемым, а
 * читаемый — это на языке, которым человек играет. Игра по умолчанию
 * английская, а текст оставался русским; найдено проверкой готовности к релизу.
 *
 * Сервер проверяет подпись над присланными байтами и сверяет лишь то, что
 * одноразовый код в них — его собственный. Поэтому язык может назвать клиент:
 * подделать этим нечего.
 */
export function buildMessage(nonce, domain, iso, lang = 'ru') {
  if (lang === 'en') {
    return [
      `${domain} asks you to confirm signing in to Veloria.`,
      '',
      'This signature is for signing in to the game.',
      'It does NOT move funds and grants no access to your wallet.',
      '',
      `One-time code: ${nonce}`,
      `Time: ${iso}`,
    ].join('\n');
  }
  return [
    `${domain} просит подтвердить вход в Veloria.`,
    '',
    'Это подпись для входа в игру.',
    'Она НЕ переводит средства и не даёт доступа к кошельку.',
    '',
    `Одноразовый код: ${nonce}`,
    `Время: ${iso}`,
  ].join('\n');
}

/**
 * Проверить подпись. Возвращает { ok, address } или { ok: false, why }.
 *
 * Одноразовое число сжигается при первой же попытке — удачной или нет. Иначе
 * подобранную подпись можно было бы пробовать бесконечно.
 */
export function verifySignature({ address, message, signature }) {
  const rec = pickNonce(message);
  if (!rec) return { ok: false, why: 'код не выдавался или просрочен' };
  nonces.delete(rec.key);
  if (Date.now() - rec.born > NONCE_TTL) return { ok: false, why: 'код просрочен' };
  if (rec.address && rec.address !== address) return { ok: false, why: 'код выдан другому адресу' };

  const pub = base58Decode(address);
  if (!pub || pub.length !== 32) return { ok: false, why: 'адрес не похож на ключ' };
  const sig = Buffer.from(String(signature || ''), 'hex');
  if (sig.length !== 64) return { ok: false, why: 'подпись не той длины' };

  try {
    const key = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: pub.toString('base64url') },
      format: 'jwk',
    });
    const ok = verify(null, Buffer.from(message, 'utf8'), key, sig);
    return ok ? { ok: true, address } : { ok: false, why: 'подпись не сходится' };
  } catch (e) {
    return { ok: false, why: 'ключ не разобрать' };
  }
}

/** Найти выданное число внутри подписанного текста. */
function pickNonce(message) {
  const m = /Одноразовый код: ([0-9a-f]{32})/.exec(String(message || ''));
  if (!m) return null;
  const rec = nonces.get(m[1]);
  return rec ? { ...rec, key: m[1] } : null;
}

// ─────────────────────────────────────────── сессии

const SESSION_TTL = 7 * 24 * 3600 * 1000;
const sessions = new Map();           // токен → { address, born, guest }

export function newSession(address, guest = false) {
  const token = randomBytes(24).toString('hex');
  const born = Date.now();
  sessions.set(token, { address, born, guest });
  // И на диск: сессия обязана пережить обновление сервера. Раньше она жила
  // только в памяти, и каждая выкладка разлогинивала всех, кто в этот миг
  // играл, — а токен лежит в браузере ещё неделю.
  saveSession(token, address, guest, born);
  // За токеном могут и не вернуться, а гостевой вход не требует ничего: без
  // потолка карта росла на каждый заход на страницу и не убывала никогда —
  // три тысячи запросов давали три тысячи вечных записей.
  подрезать(sessions, SESSION_TTL, MAX_SESSIONS);
  return token;
}

export function readSession(token) {
  if (typeof token !== 'string' || token.length !== 48) return null;
  let s = sessions.get(token);
  // Нет в памяти — смотрим на диск: значит сервер перезапускали, а игрок нет.
  if (!s) {
    s = loadSession(token);
    if (s) sessions.set(token, s);
  }
  if (!s) return null;
  if (Date.now() - s.born > SESSION_TTL) { sessions.delete(token); dropSession(token); return null; }
  return s;
}

/**
 * Забыть сессии, оставшиеся в памяти.
 *
 * Нужно ровно одному — стенду: обновление сервера иначе не изобразить, а
 * проверять «переживает ли сессия перезапуск» надо именно им. Диск при этом не
 * трогаем: в том и смысл.
 */
export function забытьСессии() { sessions.clear(); }

/** Сравнение без утечки по времени — на случай перебора токенов. */
export function sameToken(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export const stats = () => ({ nonces: nonces.size, sessions: sessions.size });
