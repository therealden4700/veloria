// Вход через кошелёк Phantom.
//
// ── Что здесь происходит и чего здесь не происходит
//
// Происходит: страница спрашивает у расширения публичный ключ и просит
// подписать текстовое сообщение. Расширение показывает это сообщение игроку
// своим окном и подписывает его закрытым ключом, который никогда не покидает
// кошелёк. Страница получает публичный ключ и подпись — и только их.
//
// НЕ происходит: игра никогда не просит seed-фразу, никогда не запрашивает
// закрытый ключ и никогда не зовёт `signTransaction`. Вход — это подпись
// текста, а не перевод средств. Если игра когда-нибудь попросит подтвердить
// транзакцию при входе — это не она.
//
// ── Про честность этой проверки
//
// Теперь она настоящая. Одноразовый код выдаёт сервер, он же строит текст и он
// же проверяет подпись ed25519 против публичного ключа — а публичный ключ у
// Solana это и есть адрес. Код сгорает при первой попытке, так что записанную
// подпись повторно не предъявишь.
//
// В ответ приходит токен сессии и персонаж, каким его помнит сервер. Без токена
// в общую комнату не пускают, поэтому назваться чужим адресом больше нельзя.
//
// Если сервера нет — игра работает одиночно: вход остаётся местным, `verified`
// равен false, и это честно отражено в состоянии.
//
// ── Про само сообщение
//
// Подписывается читаемый человеком текст с доменом, назначением, одноразовым
// числом и временем. Это не формальность: подписать «непонятные байты» —
// худшая привычка, которую можно привить игроку, потому что ровно так уводят
// средства. Игрок должен видеть в окне кошелька, что он подтверждает вход в
// Veloria на конкретном сайте, и ничего больше.

// Комната может стоять не там, где страница: адрес решает `server-url`.
import { apiUrl } from './server-url.js';
import { getLang } from './i18n.js';

const KEY = 'veloria.wallet.v1';
const TTL_MS = 7 * 24 * 3600 * 1000;     // неделя, дальше просим войти заново

/** Состояние входа. Меняется только через функции этого модуля. */
const state = {
  status: 'idle',       // idle | connecting | signing | ready | guest | error
  address: null,        // публичный ключ в base58
  signature: null,      // подпись сообщения
  message: null,        // ровно то, что подписали
  token: null,          // сессия от сервера; без неё в общую комнату не пускают
  verified: false,      // подпись проверена сервером, а не только собрана
  character: null,      // персонаж, каким его помнит сервер
  error: null,          // текст последней неудачи — для экрана входа
  since: 0,
};

const listeners = new Set();
export function onWalletChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) { try { fn(getWallet()); } catch { /* слушатель не должен ронять вход */ } } }

export function getWallet() { return { ...state }; }
export function isSignedIn() { return state.status === 'ready' || state.status === 'guest'; }

/** Короткая запись адреса: «7xKX…mR9t». Полный не влезает никуда и не нужен. */
export function shortAddress(a = state.address) {
  if (!a) return '';
  return a.length <= 12 ? a : a.slice(0, 4) + '…' + a.slice(-4);
}

/**
 * Расширение Phantom, если оно есть.
 *
 * Phantom кладёт себя в два места: новое `window.phantom.solana` и старое
 * `window.solana`. Второе могут занимать и другие кошельки, поэтому проверяем
 * признак `isPhantom`.
 */
export function getProvider() {
  const g = typeof window !== 'undefined' ? window : null;
  if (!g) return null;
  const p = (g.phantom && g.phantom.solana) || g.solana;
  return p && p.isPhantom ? p : null;
}

export function hasPhantom() { return !!getProvider(); }

/** Ссылка на установку — её показывает экран входа, когда кошелька нет. */
export const PHANTOM_URL = 'https://phantom.app/download';

/**
 * Одноразовое число и текст берём у сервера.
 *
 * Раньше и то и другое рождалось здесь — и подпись не значила ничего: проверять
 * её было некому, а подменить ответ кошелька в консоли мог кто угодно. Теперь
 * код выдаёт сервер, он же строит текст (проверять он будет ровно эти байты) и
 * он же сжигает код при первой попытке.
 *
 * Если сервера нет — играем одиночно: вход остаётся местным и непроверенным,
 * `verified` при этом false, и в общую комнату с ним не пустят.
 */
async function askChallenge(address) {
  try {
    const r = await fetch(apiUrl('/auth/nonce'), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      // Язык — чтобы окно кошелька говорило с игроком на его языке. Текст
      // строит сервер, он же и переводит.
      body: JSON.stringify({ address, lang: getLang() }),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/** Текст, который увидит игрок в окне кошелька. */
export function buildMessage(nonce, domain) {
  const d = domain || (typeof location !== 'undefined' ? location.host : 'veloria');
  const время = new Date().toISOString();
  if (getLang() === 'en') {
    return [
      `${d} asks you to confirm signing in to Veloria.`,
      '',
      'This signature is for signing in to the game.',
      'It does NOT move funds and grants no access to your wallet.',
      '',
      `One-time code: ${nonce}`,
      `Time: ${время}`,
    ].join('\n');
  }
  return [
    `${d} просит подтвердить вход в Veloria.`,
    '',
    'Это подпись для входа в игру.',
    'Она НЕ переводит средства и не даёт доступа к кошельку.',
    '',
    `Одноразовый код: ${nonce}`,
    `Время: ${время}`,
  ].join('\n');
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      address: state.address, signature: state.signature,
      message: state.message, since: state.since, status: state.status,
      token: state.token, verified: state.verified,
    }));
  } catch { /* приватный режим — просто не запомним */ }
}

/** Восстановить прошлый вход. Зовётся один раз при запуске. */
export function restoreWallet() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return getWallet();
    const d = JSON.parse(raw);
    if (!d || !d.since || Date.now() - d.since > TTL_MS) { localStorage.removeItem(KEY); return getWallet(); }
    if (d.status === 'guest') { state.status = 'guest'; state.since = d.since; state.token = d.token || null; }
    else if (d.address) {
      state.status = 'ready';
      state.address = d.address;
      state.signature = d.signature || null;
      state.message = d.message || null;
      state.token = d.token || null;
      state.verified = !!d.verified;
      state.since = d.since;
    }
  } catch { /* повреждённая запись не должна мешать войти заново */ }
  emit();
  return getWallet();
}

export async function playAsGuest() {
  state.status = 'guest';
  state.address = null; state.signature = null; state.message = null; state.error = null;
  state.character = null; state.verified = false;
  state.since = Date.now();
  // гостю тоже нужен токен, иначе в общую комнату не войти; нет сервера —
  // играем одиночно, это не ошибка
  const v = await postJson('/auth/verify', { guest: true });
  state.token = v && v.ok ? v.token : null;
  save(); emit();
  return getWallet();
}

export function signOut() {
  const p = getProvider();
  try { p && p.disconnect && p.disconnect(); } catch { /* кошелёк мог уже отключиться сам */ }
  state.status = 'idle';
  state.address = null; state.signature = null; state.message = null; state.error = null;
  state.token = null; state.verified = false; state.character = null;
  try { localStorage.removeItem(KEY); } catch { /* см. save() */ }
  emit();
  return getWallet();
}

/**
 * Полный вход: подключение и подпись.
 *
 * Ошибки разложены по смыслу, а не свалены в одну: «кошелька нет» — это ссылка
 * на установку, «игрок отменил» — не ошибка вовсе и не должно выглядеть сбоем,
 * а всё прочее — настоящая неудача.
 */
export async function signInWithPhantom() {
  const p = getProvider();
  if (!p) {
    state.status = 'error';
    state.error = 'Кошелёк Phantom не найден';
    emit();
    return getWallet();
  }
  try {
    state.status = 'connecting'; state.error = null; emit();
    const res = await p.connect();
    const address = (res && res.publicKey ? res.publicKey : p.publicKey);
    if (!address) throw new Error('нет публичного ключа');
    const addr = address.toString();

    state.status = 'signing'; emit();
    const ch = await askChallenge(addr);
    const msg = ch ? ch.message : buildMessage(makeLocalNonce());
    const bytes = new TextEncoder().encode(msg);
    const signed = await p.signMessage(bytes, 'utf8');
    const sig = signed && (signed.signature || signed);
    const sigHex = sig ? bytesToHex(sig) : null;

    let verified = false, token = null, character = null;
    if (ch) {
      const v = await postJson('/auth/verify', { address: addr, message: msg, signature: sigHex });
      if (v && v.ok) { verified = true; token = v.token; character = v.character || null; }
      else if (v && v.why) { throw new Error(v.why); }
    }

    state.status = 'ready';
    state.address = addr;
    state.signature = sigHex;
    state.message = msg;
    state.token = token;
    state.verified = verified;
    state.character = character;
    state.since = Date.now();
    state.error = null;
    save(); emit();
    return getWallet();
  } catch (e) {
    const code = e && (e.code || e.errorCode);
    const cancelled = code === 4001 || /reject|denied|cancel|отклон/i.test((e && e.message) || '');
    state.status = cancelled ? 'idle' : 'error';
    state.error = cancelled ? null : 'Не удалось войти через кошелёк';
    state.address = null; state.signature = null;
    emit();
    return getWallet();
  }
}

function bytesToHex(b) {
  const a = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (const v of a) s += v.toString(16).padStart(2, '0');
  return s;
}

/** Локальный код — только на случай, когда сервера нет и играем одиночно. */
function makeLocalNonce() {
  const b = new Uint8Array(16);
  (globalThis.crypto || {}).getRandomValues?.(b);
  let s = '';
  for (const v of b) s += v.toString(16).padStart(2, '0');
  return s || String(Date.now());
}

async function postJson(path, body) {
  try {
    const r = await fetch(apiUrl(path), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch { return null; }
}

export function getToken() { return state.token; }
export function getCharacter() { return state.character; }
export function isVerified() { return state.verified; }

/** Отправить персонажа на сервер. Гостя и непроверенный вход — молча мимо. */
export async function pushCharacter(data, name) {
  if (!state.token || !state.verified) return false;
  const r = await postJson('/char/save', { token: state.token, name, data });
  return !!(r && r.ok);
}
