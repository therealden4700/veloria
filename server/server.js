// Сервер Veloria: раздача файлов игры и комната на WebSocket.
//
// Комната считает мир сама: строит зону тем же генератором, что клиент, водит
// врагов и двигает игроков. От клиента приходит намерение («иду туда»), а не
// положение («я тут») — иначе прислать координату посреди стены мог бы кто
// угодно.
//
// Общий спавн — город: там встречаются все, кто вошёл.
//
//   node server/server.js            # порт 8123
//   PORT=9000 node server/server.js
//
// Игру после этого открывать по адресу сервера: он раздаёт и файлы, и сокет,
// поэтому отдельный питоновский раздатчик больше не нужен.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachWebSocket } from './ws.js';
import { World } from './world.js';
import { issueNonce, buildMessage, verifySignature, newSession, readSession, stats as authStats } from './auth.js';
import { openDb, touchAccount, loadCharacter, saveCharacter, topDepth, dbStats } from './db.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || 8123);
const TICK_HZ = 20;
const TICK_MS = 1000 / TICK_HZ;
const PING_MS = 5000;         // как часто щупаем живых
const DEAD_MS = 15000;        // молчит дольше — отключаем

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

// ─────────────────────────────────────────── комната

let nextPid = 1;

class Room {
  constructor(id, worldOpts) {
    this.id = id;
    // Общий спавн — город: там встречаются все, кто вошёл. Биомы и подземелья
    // станут отдельными комнатами на отряд, когда до них дойдёт очередь.
    this.world = new World(worldOpts || { kind: 'city', seed: 20260805 });
    this.players = new Map();     // conn.id → игрок
    this.tick = 0;
    this.lastStep = Date.now();
    this.startedAt = Date.now();
    this.stats = { joined: 0, left: 0, in: 0, out: 0, maxPlayers: 0 };
  }

  get size() { return this.players.size; }

  add(conn, hello) {
    const p = {
      conn,
      pid: nextPid++,
      name: String((hello && hello.name) || 'Странник').slice(0, 24),
      // Адрес берётся из сессии, а не из слов клиента: сессию выдают только
      // против проверенной подписи. Присланному в `hello` адресу веры нет.
      address: (hello && hello.session && hello.session.address) || null,
      guest: !(hello && hello.session && hello.session.address),
      x: 520, y: 512, facing: 0,
      joinedAt: Date.now(),
      lastSeen: Date.now(),
    };
    this.players.set(conn.id, p);
        // персонаж берётся из базы по адресу сессии, а не из слов клиента
    const character = p.address ? loadCharacter(p.address) : null;
    p.ent = this.world.addPlayer({
      pid: p.pid, name: p.name, address: p.address,
      look: hello && hello.look, character: character ? character.data : null,
    });
    this.stats.joined++;
    this.stats.maxPlayers = Math.max(this.stats.maxPlayers, this.players.size);

    this.sendTo(p, {
      t: 'welcome', pid: p.pid, room: this.id, tickHz: TICK_HZ, now: Date.now(),
      world: this.world.describe(),
    });
    this.broadcast({ t: 'join', player: shortOf(p) }, p);
    return p;
  }

  remove(connId) {
    const p = this.players.get(connId);
    if (!p) return;
    this.players.delete(connId);
    this.world.removePlayer(p.pid);
    this.stats.left++;
    this.broadcast({ t: 'leave', pid: p.pid });
  }

  onMessage(p, msg) {
    p.lastSeen = Date.now();
    this.stats.in++;
    switch (msg.t) {
      case 'input':
        // Приходит намерение, а не положение: «иду туда» вместо «я тут».
        // Иначе игрок мог бы прислать координату посреди стены.
        this.world.applyInput(p.pid, msg);
        break;
      case 'ping':
        this.sendTo(p, { t: 'pong', c: msg.c, now: Date.now() });
        break;
      default:
        break;
    }
  }

  step() {
    this.tick++;
    const now = Date.now();
    const dt = Math.min(0.25, (now - this.lastStep) / 1000);
    this.lastStep = now;
    this.world.step(dt);
    // отключаем молчунов
    for (const [cid, p] of this.players) {
      if (now - p.lastSeen > DEAD_MS) { try { p.conn.close(1001, 'молчит'); } catch { /* уже нет */ } this.remove(cid); }
    }
    if (!this.players.size) return;
    const s = this.world.snapshot();
    this.broadcast({ t: 'snap', tick: this.tick, now, players: s.players, enemies: s.enemies });
  }

  sendTo(p, obj) {
    if (p.conn.send(JSON.stringify(obj))) this.stats.out++;
  }

  broadcast(obj, except) {
    const s = JSON.stringify(obj);
    for (const p of this.players.values()) {
      if (p === except) continue;
      if (p.conn.send(s)) this.stats.out++;
    }
  }
}

const shortOf = (p) => ({ pid: p.pid, name: p.name });

// ─────────────────────────────────────────── вход и персонаж

const readBody = (req) => new Promise((done) => {
  let n = 0; const parts = [];
  req.on('data', (c) => {
    n += c.length;
    if (n > 640 * 1024) { req.destroy(); done(null); return; }   // слепок больше — подозрительно
    parts.push(c);
  });
  req.on('end', () => { try { done(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch { done(null); } });
  req.on('error', () => done(null));
});

const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

async function routeApi(req, res, path) {
  if (path === '/auth/nonce' && req.method === 'POST') {
    const b = await readBody(req);
    const address = b && typeof b.address === 'string' ? b.address : '';
    const nonce = issueNonce(address);
    // Текст строит сервер, а не клиент: проверять он будет ровно эти байты, и
    // расхождение хоть в пробеле означало бы, что честная подпись не сходится.
    const message = buildMessage(nonce, req.headers.host || 'veloria', new Date().toISOString());
    json(res, 200, { nonce, message });
    return true;
  }

  if (path === '/auth/verify' && req.method === 'POST') {
    const b = await readBody(req);
    if (!b) { json(res, 400, { ok: false, why: 'тело не разобрать' }); return true; }
    if (b.guest) {
      json(res, 200, { ok: true, guest: true, token: newSession(null, true), character: null });
      return true;
    }
    const v = verifySignature({ address: b.address, message: b.message, signature: b.signature });
    if (!v.ok) { json(res, 401, v); return true; }
    const acc = touchAccount(v.address);
    const ch = loadCharacter(v.address);
    json(res, 200, {
      ok: true, address: v.address, token: newSession(v.address),
      account: { created: acc.created, logins: acc.logins },
      character: ch ? ch.data : null,
    });
    return true;
  }

  if (path === '/char/save' && req.method === 'POST') {
    const b = await readBody(req);
    const sess = readSession(b && b.token);
    if (!sess) { json(res, 401, { ok: false, why: 'сессия неизвестна' }); return true; }
    if (sess.guest) { json(res, 200, { ok: true, guest: true, saved: false }); return true; }
    const r = saveCharacter(sess.address, b.data, b.name);
    json(res, r.ok ? 200 : 400, r);
    return true;
  }

  if (path === '/leaderboard') {
    json(res, 200, { top: topDepth(20).map((r) => ({
      // адрес показываем укороченным: полный на доске никому не нужен
      who: r.name || (r.address.slice(0, 4) + '…' + r.address.slice(-4)),
      level: r.level, deepest: r.deepest,
    })) });
    return true;
  }
  return false;
}

// ─────────────────────────────────────────── раздача файлов

async function serveStatic(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    // выход за корень запрещён: обычная защита раздатчика от «../»
    const full = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!full.startsWith(ROOT)) { res.writeHead(403).end('нельзя'); return; }
    const st = await stat(full);
    if (st.isDirectory()) { res.writeHead(403).end('каталог'); return; }
    const body = await readFile(full);
    res.writeHead(200, {
      'content-type': MIME[extname(full).toLowerCase()] || 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('не найдено');
  }
}

// ─────────────────────────────────────────── запуск

const room = new Room('veloria-1');

openDb();

const http = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  try {
    if (await routeApi(req, res, path)) return;
  } catch (e) {
    console.error('сбой в /api:', e);
    json(res, 500, { ok: false, why: 'внутренняя ошибка' });
    return;
  }
  if (path === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true, uptime: Math.round((Date.now() - room.startedAt) / 1000),
      players: room.size, tick: room.tick, stats: room.stats,
      world: room.world.describe(),
      auth: authStats(), db: dbStats(),
      rss: Math.round(process.memoryUsage().rss / 1048576),
    }));
    return;
  }
  serveStatic(req, res);
});

attachWebSocket(http, (conn) => {
  let player = null;
  conn.onmessage = (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { conn.close(1003, 'не JSON'); return; }
    if (!player) {
      if (msg.t !== 'hello') { conn.close(1002, 'первым должен быть hello'); return; }
      // токен обязателен: без него непонятно, чей это персонаж
      const sess = readSession(msg.token);
      if (!sess) { conn.close(1008, 'нужен токен входа'); return; }
      player = room.add(conn, { ...msg, session: sess });
      return;
    }
    room.onMessage(player, msg);
  };
  conn.onclose = () => { if (player) room.remove(conn.id); };
  conn.onerror = () => { /* обрыв — обычное дело, закрытие придёт следом */ };
});

// такт комнаты
const timer = setInterval(() => {
  try { room.step(); } catch (e) { console.error('сбой такта:', e); }
}, TICK_MS);

// сердцебиение: ping всем, чтобы обрывы обнаруживались быстрее таймаута
const beat = setInterval(() => {
  for (const p of room.players.values()) p.conn.ping();
}, PING_MS);

http.listen(PORT, () => {
  console.log(`Veloria: файлы и комната на http://localhost:${PORT}`);
  console.log(`такт ${TICK_HZ} Гц, состояние — /health`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    clearInterval(timer); clearInterval(beat);
    for (const p of room.players.values()) { try { p.conn.close(1001, 'сервер остановлен'); } catch { /* всё равно уходим */ } }
    http.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500);
  });
}
