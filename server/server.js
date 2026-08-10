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
import { Market } from './market.js';
import { QuestBook } from './quests.js';
// Списки мест и модификаторов берём из самих правил: перечислять их здесь
// значило бы завести вторую копию, которая однажды разойдётся.
import { BIOMES } from '../src/world/biomes.js';
import { FLOOR_MODS } from '../src/systems/dungeon_mods.js';
import { issueNonce, buildMessage, verifySignature, newSession, readSession, stats as authStats } from './auth.js';
import { openDb, touchAccount, loadCharacter, saveCharacter, loadWorldCharacter, saveWorldCharacter, topDepth, dbStats } from './db.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || 8123);
const TICK_HZ = 20;
const TICK_MS = 1000 / TICK_HZ;
const PING_MS = 5000;         // как часто щупаем живых
const DEAD_MS = 15000;
// Разговор: как часто можно говорить и как далеко слышно.
// Сколько человек пускаем в одну комнату. Замер: 50 в городе — 45 КБ/с
// каждому, такт ровный, память 99 МБ. Выше не мерили — значит и не пускаем.
const КОМНАТА_ПОТОЛОК = Number(process.env.ROOM_MAX) || 50;
const SAY_MS = 1200;
const SAY_R = 320;
const SAVE_MS = 8000;        // как часто комната пишет персонажей в базу

/**
 * Вещь для отправки: без иконки.
 *
 * Иконка — нарисованный холст, и в нём круговая ссылка на свой контекст.
 * `JSON.stringify` на таком бросает, а бросок внутри доставки глохнет: клиент
 * не получает ни ответа, ни ошибки — просто тишина. Один раз это уже стоило
 * получаса: ассортимент лавки «не приходил», и в логе сервера было пусто.
 * Клиент рисует иконку сам — по виду, рангу и редкости.
 */
const безИконки = (i) => (i ? { ...i, icon: undefined } : null);        // молчит дольше — отключаем

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
    // Лавки и кузня общего мира: их считает комната, а не клиент.
    this.market = new Market(20260805);
    // Журналы заданий: по одному на игрока, ведёт их комната.
    this.quests = new QuestBook(this.world);
    // Мир должен уметь отметить ход задания там же, где случилось событие:
    // в убийстве и в реакции. Даём ему ссылку, а не копию логики.
    this.world.book = this.quests;
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
    // Герой берётся из базы по адресу сессии — и не любой, а тот, которого
    // ведёт сам мир. Копию из одиночной игры сюда не пускаем: её прислал
    // клиент, и в ней можно попросить что угодно. Кто в мир ещё не входил,
    // начинает в нём заново.
    // У кого есть адрес — берём из базы. У гостя адреса нет, и записывать
    // некуда; но терять его героя при каждом переезде нельзя: раньше прогресс
    // вёл клиент и это не всплывало, а теперь ведёт комната. Между комнатами
    // гостя переносит само соединение — и это состояние сервера, а не слова
    // клиента, так что верить ему можно.
    const character = p.address ? loadWorldCharacter(p.address) : (hello && hello._герой) || null;
    p.ent = this.world.addPlayer({
      pid: p.pid, name: p.name, address: p.address,
      look: hello && hello.look, character,
    });
    // Запись игрока — ПОСЛЕДНИМ действием. Раньше она стояла до чтения из базы,
    // и исключение оставляло в комнате призрака: он попадал в размер и в
    // рассылку, хотя сущности мира у него не было и `join` никому не ушёл.
    this.players.set(conn.id, p);
    this.stats.joined++;
    this.stats.maxPlayers = Math.max(this.stats.maxPlayers, this.players.size);

    this.sendTo(p, {
      t: 'welcome', pid: p.pid, room: this.id, tickHz: TICK_HZ, now: Date.now(),
      world: this.world.describe(),
    });
    // Журнал берём из того же сохранения, что и героя. У гостя его переносит
    // соединение — вместе с самим героем.
    // Журнал заводим на НАСТОЯЩЕГО героя, а не на запись соединения: у той нет
    // ни уровня, ни характеристик, а `refresh` смотрит и туда, и туда. Ошибка
    // при этом глохла: `welcome` уже ушёл, и клиент считал, что он в игре.
    this.quests.для(p.ent, (character && character.quests) || null);
    p.bagDirty = true;              // при входе клиент должен увидеть свой рюкзак
    this.broadcast({ t: 'join', player: shortOf(p) }, p);
    return p;
  }

  remove(connId) {
    const p = this.players.get(connId);
    if (!p) return;
    this.записать(p);                 // уходит — сохраняем то, что насчитала комната
    // И отдаём соединению слепок: по нему гость восстановится в следующей
    // комнате. Для учётки это лишнее — её ведёт база, — но и не мешает.
    if (p.ent && p.ent.toJSON) { try { p.наПамять = { player: p.ent.toJSON(), quests: this.quests.слепок(p.ent) }; } catch { /* не беда */ } }
    this.players.delete(connId);
    if (p.ent) this.quests.забыть(p.ent.pid);
    if (p.ent) this.market.забыть(p.ent.pid);
    this.world.removePlayer(p.pid);
    this.stats.left++;
    this.broadcast({ t: 'leave', pid: p.pid });
    for (const o of this.players.values()) if (o.знакомы) o.знакомы.delete(p.pid);
  }

  /**
   * Намерение из лавки или кузни.
   *
   * Всё, что меняет золото и вещи, проходит здесь. Клиенту уходит ответ с
   * причиной отказа — иначе он не сможет сказать игроку, чего не хватило, — и
   * свежий рюкзак, если что-то поменялось.
   */
  /**
   * Сказать вслух.
   *
   * Отдельного окна разговора нет: реплика висит над головой и гаснет. Мир
   * маленький, и сказанное на месте видно тому, кому оно.
   *
   * Проверяем то же, что и везде: длину и частоту. Без потолка одно сообщение
   * рассылается всем в области интереса двадцать раз в секунду — это готовый
   * способ забить канал соседям.
   */
  сказать(p, текст) {
    const t = String(текст || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!t) return;
    const now = Date.now();
    if (now - (p.сказалВ || 0) < SAY_MS) {
      this.sendTo(p, { t: 'сказано', ok: false, why: 'слишком часто' });
      return;
    }
    p.сказалВ = now;
    if (!p.ent) return;
    // Слышат только те, кто рядом: кричать через весь город незачем.
    for (const o of this.players.values()) {
      if (!o.ent) continue;
      if (o !== p && (o.ent.x - p.ent.x) ** 2 + (o.ent.y - p.ent.y) ** 2 > SAY_R * SAY_R) continue;
      this.sendTo(o, { t: 'сказано', ok: true, pid: p.pid, name: p.name, text: t });
    }
  }

  /**
   * Взять или сдать задание.
   *
   * Клиент называет только номер: можно ли взять и выполнено ли — решает
   * комната. Замер до этого: клиент выдавал награду сам, и сверка с миром
   * стирала её через три кадра — 120 золота обратно в 40.
   */
  заданиe(p, msg) {
    const e = p.ent;
    if (!e) return;
    const r = msg.do === 'accept' ? this.quests.взять(e, msg.id)
      : msg.do === 'complete' ? this.quests.сдать(e, msg.id)
      : { ok: false, why: 'непонятно, что делать' };
    if (r.ok) { this.world.dirty = true; p.bagDirty = true; this.quests.обновить(e); }
    this.sendTo(p, { t: 'задание', act: msg.do, ...r });
  }

  торг(p, msg) {
    const e = p.ent;
    if (!e) return;
    // Торгуют и куют в городе: там стоят лавки и кузня. Клиент открывает их
    // только рядом с жителем, но верить в это нельзя — окно рисует он.
    if (this.world.kind !== 'city') {
      this.sendTo(p, { t: 'деньги', act: msg.t, ok: false, why: 'здесь нет ни лавки, ни кузни' });
      return;
    }
    const m = this.market;
    let r;
    switch (msg.t) {
      case 'shop':
        this.sendTo(p, { t: 'shop', npc: msg.npc, stock: m.ассортимент(e, String(msg.npc || 'smith')).map(безИконки) });
        return;
      case 'buy':     r = m.buy(e, String(msg.npc || 'smith'), msg.slot); break;
      case 'sell':    r = m.sell(e, msg.id); break;
      case 'craft':
        r = m.craft(e, String(msg.cat || ''), msg.sub || null, msg.idx);
        if (r.ok) this.quests.событие(e, 'onCraft');
        break;
      case 'salvage': r = m.salvage(e, msg.id); break;
      case 'reforge': r = m.reforge(e, msg.id); break;
      case 'sharpen': r = m.sharpen(e, msg.fuel); break;
      case 'fuse':    r = m.fuse(e, msg.ids); break;
      default: return;
    }
    if (r && r.ok) { this.world.dirty = true; p.bagDirty = true; }
    this.sendTo(p, { t: 'деньги', act: msg.t, ...r });
  }

  /**
   * Записать персонажа таким, каким его насчитала комната.
   *
   * Это и есть перенос прогресса на сервер: раньше в базу ложился слепок от
   * клиента, и попросить можно было что угодно. Теперь золото, опыт, уровень и
   * рюкзак меняются только здесь — боем, добычей и поднятием, — и отсюда же
   * уезжают в базу. Гостю писать некуда: у него нет адреса.
   */
  записать(p) {
    if (!p || !p.address || !p.ent || !p.ent.toJSON) return;
    try {
      const data = { player: p.ent.toJSON(), quests: this.quests.слепок(p.ent), ver: 1 };
      saveWorldCharacter(p.address, data, p.name);
    } catch (e) {
      console.error('не записался персонаж', p.address, '—', e.message);
    }
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
      case 'swing':
        // То же правило, что и с движением: приходит «махнул», а не «попал по
        // такому-то на столько-то». Кого задело, решает комната.
        this.world.swing(p.pid, msg);
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

    // Пишем не каждый такт: база не выдержит двадцати записей в секунду на
    // игрока, а терять больше нескольких секунд игры нельзя.
    if (this.world.dirty && now - (this.lastSave || 0) > SAVE_MS) {
      this.lastSave = now;
      this.world.dirty = false;
      for (const p of this.players.values()) this.записать(p);
    }


    // Своё состояние — каждому своё. В общем снимке его быть не должно: чужое
    // золото никого не касается, а рассылать всем всё — лишний вес. Клиент
    // ведёт свои числа сам, и без этого они разошлись бы с миром: считает-то
    // теперь комната.
    if (this.tick % 4 === 0) {
      for (const p of this.players.values()) {
        const e = p.ent;
        if (!e) continue;
        this.sendTo(p, {
          t: 'me', gold: Math.round(e.gold || 0), xp: Math.round(e.xp || 0),
          lvl: e.level, pts: e.statPoints || 0, bag: (e.inventory || []).length,
        });
        // Журнал — когда изменился: ход задания идёт от событий комнаты, и
        // видеть его игрок должен таким, каким его ведёт мир.
        this.quests.сверитьСбор(e);
        const ж = this.quests.свежий(e);
        if (ж) this.sendTo(p, { t: 'журнал', quests: ж });

        // Рюкзак — не каждый такт: он тяжёлый. Шлём, когда что-то изменилось,
        // и это единственная правда о вещах в общем мире: клиент их не считает.
        if (p.bagDirty || this.world.bagChanged) {
          p.bagDirty = false;
          this.sendTo(p, {
            t: 'bag',
            inv: (e.inventory || []).map(безИконки),
            eq: Object.fromEntries(Object.entries(e.equipment || {}).map(([k, v]) => [k, безИконки(v)])),
          });
        }
      }
      this.world.bagChanged = false;
    }
    // Снимок теперь у каждого свой: в него попадает только то, что рядом.
    // Одна рассылка на всех обходилась в 67 Мбит/с при пятидесяти игроках и
    // росла квадратом — каждый новый попадал в снимок каждого.
    //
    // `ev` — что случилось за такт: попадания, промахи, смерти. Клиент играет
    // по ним зрелище. События общие: их мало, и пропустить своё убийство
    // из-за расстояния нельзя. Забираем их один раз, иначе первый же игрок
    // выгребет очередь, а остальные не увидят ничего.
    //
    // Снимок помечен комнатой. Без этого клиент применял к новой зоне то, что
    // уже летело из старой: чужой список хоронил всё население разом, а чужое
    // событие `kill` выдавало добычу за убийство в другом месте.
    const ev = this.world.takeEvents();
    for (const p of this.players.values()) {
      const s = this.world.snapshot(p.ent);
      // Кого этот игрок ещё не знает — представляем. Имя и внешность не
      // меняются, и место им не в каждом снимке, а в одном сообщении.
      const знакомы = p.знакомы || (p.знакомы = new Set());
      const новые = [];
      for (const о of s.players) {
        if (знакомы.has(о.pid)) continue;
        знакомы.add(о.pid);
        const к = this.world.кто(о.pid);
        if (к) новые.push(к);
      }
      if (новые.length) this.sendTo(p, { t: 'кто', players: новые });
      this.sendTo(p, {
        t: 'snap', room: this.id, tick: this.tick, now,
        players: s.players, enemies: s.enemies, shots: s.shots, loot: s.loot, ev,
      });
    }
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

    // Это резервная копия ОДИНОЧНОЙ игры, и только она.
    //
    // Пока прогресс считал клиент, слепок отсюда был единственным способом его
    // сохранить — и заодно способом попросить что угодно: настоящая учётка
    // положила легендарку с атакой 9999 и девять миллионов золота, а сервер
    // вернул их при следующем входе. Теперь у адреса два героя. Этот — копия,
    // чтобы не потерять нажитое без сети вместе с кэшем браузера. В общий мир
    // он не входит: там герой свой, и считает его комната.
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

// Комната по умолчанию — город: там встречаются все вошедшие и там безопасно.
// Переменными можно поднять комнату биома: это нужно проверкам, которым не на
// ком мерить бой в городе, и пригодится, когда отряды пойдут в зоны.
// ─────────────────────────────────────────── комнаты
//
// Комната была одна и навсегда город. Это и держало кооп в городе: считать бой
// сервер научился, а места, где есть с кем драться, у него не было.
//
// Теперь комнат сколько нужно. Город один на всех — там встречаются, — а на
// каждый биом заводится своя, и живёт она, пока в ней кто-то есть. Пустая
// комната считает врагов впустую, поэтому её сносим: зона в памяти стоит
// около мегабайта, и десяток брошенных — уже заметно.
//
// Ключ комнаты — вид и место. Отряды на общей карте появятся, когда будут
// правила коопа; пока в биом попадают все, кто туда пошёл, и это ровно то, что
// нужно проверить первым.

const rooms = new Map();
const ГОРОД = 'city';

function roomKey(dest) {
  if (!dest || dest.kind === 'city') return ГОРОД;
  if (dest.kind === 'biome') {
    const id = String(dest.id || 'forest');
    // Незнакомый биом не строим: generateBiomeZone на нём бросает, а бросок
    // здесь означал бы соединение без welcome и без закрытия — немой сокет.
    return BIOMES[id] && id !== 'city' && id !== 'dungeon' ? 'biome:' + id : null;
  }
  if (dest.kind === 'dungeon') {
    // Модификатор этажа — часть места, а не украшение: `generateDungeon`
    // подмешивает его прямо в сид, и без него комната строит ДРУГОЕ
    // подземелье. Клиент при этом принимает снимок как истину — номера
    // означают у него других существ, а сервер считает столкновения по своей
    // карте и тянет героя в стену клиентской.
    const mod = FLOOR_MODS[dest.mod] ? String(dest.mod) : 'none';
    return 'dungeon:' + Math.max(1, dest.floor | 0) + ':' + mod;
  }
  return ГОРОД;
}

function roomFor(dest) {
  const key = roomKey(dest);
  if (!key) return null;
  let r = rooms.get(key);
  if (r) return r;
  const части = key.split(':');
  const opts = key === ГОРОД ? { kind: 'city', seed: 20260805 }
    : части[0] === 'biome' ? { kind: 'biome', id: части[1], seed: 20260805 }
    : { kind: 'dungeon', floor: Number(части[1]) || 1, mod: части[2] || 'none', seed: 20260805 };
  r = new Room(key, opts);
  // Состояние возрождения переживает снос комнаты: иначе достаточно выйти в
  // город и вернуться, чтобы получить полный биом и живого стража мгновенно.
  const слепок = спящие.get(key);
  if (слепок) { r.world.восстановить(слепок); спящие.delete(key); }
  rooms.set(key, r);
  console.log(`комната открыта: ${key} (${r.world.describe().name}, врагов ${r.world.describe().enemies})`);
  return r;
}

// Что помним о закрытой комнате: сроки павших, стража и лагерей. Сама зона
// занимает около мегабайта и сносится, а слепок возрождения весит байты.
const спящие = new Map();
const СПЯЩИХ_ПОТОЛОК = 64;

/** Убрать опустевшие комнаты, кроме города: он ждёт всегда. */
function sweepRooms() {
  for (const [key, r] of rooms) {
    if (key === ГОРОД || r.size) continue;
    // Мир общий, и он не должен начинаться заново оттого, что все вышли.
    спящие.set(key, r.world.слепокВозрождения());
    while (спящие.size > СПЯЩИХ_ПОТОЛОК) спящие.delete(спящие.keys().next().value);
    rooms.delete(key);
    console.log(`комната закрыта: ${key}`);
  }
}

// Город поднимается сразу: в него приходят все и он не должен ждать первого.
// Переменной можно вместо этого поднять биом — так проверяют бой, в городе
// драться не с кем.
const room = process.env.ROOM_BIOME
  ? roomFor({ kind: 'biome', id: process.env.ROOM_BIOME })
  : roomFor({ kind: 'city' });

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
      players: [...rooms.values()].reduce((n, r) => n + r.size, 0),
      tick: room.tick, stats: room.stats,
      world: room.world.describe(),
      rooms: [...rooms.values()].map((r) => ({
        id: r.id, players: r.size, tick: r.tick,
        world: r.world.describe().name, enemies: r.world.describe().enemies,
      })),
      auth: authStats(), db: dbStats(),
      rss: Math.round(process.memoryUsage().rss / 1048576),
    }));
    return;
  }
  serveStatic(req, res);
});

const sendJson = (conn, obj) => { try { conn.send(JSON.stringify(obj)); } catch { /* уже нет */ } };

attachWebSocket(http, (conn) => {
  let player = null;
  let мояКомната = null;
  let привет = null;

  // Переезд между комнатами — это выход из одной и вход в другую тем же
  // соединением. Персонаж при этом собирается заново из того же сохранения:
  // комната не пересылает его другой комнате, потому что источник правды —
  // база, а не соседняя комната.
  const переехать = (dest) => {
    // Неизвестное место — не молчание, а внятный отказ. Раньше `hello` с
    // несуществующим биомом бросал исключение в генераторе, оно глохло в
    // доставке, и клиент не получал ни welcome, ни закрытия.
    const цель = roomFor(dest);
    if (!цель) { conn.close(1008, 'нет такого места'); return; }
    // Потолок на комнату. Замер: полсотни в городе — 45 КБ/с каждому и такт в
    // норме; дальше начинается неизвестность, а узнавать её на живых игроках
    // незачем. Кто не влез — получает внятный отказ, а не молчание.
    if (цель !== мояКомната && цель.size >= КОМНАТА_ПОТОЛОК) {
      sendJson(conn, { t: 'полно', room: цель.id, limit: КОМНАТА_ПОТОЛОК });
      if (!player) conn.close(1013, 'в мире сейчас людно');
      return;
    }
    if (цель === мояКомната) return;
    const прежняя = мояКомната;
    if (player && прежняя) {
      прежняя.remove(conn.id);
      // Слепок, оставленный уходящим, кладём в «привет»: с ним герой войдёт в
      // новую комнату тем же, кем вышел из прежней.
      if (player.наПамять) привет = { ...привет, _герой: player.наПамять };
    }
    // Порядок важен: пока вход не удался, `мояКомната` не должна показывать на
    // новую — иначе следующий `hello` упрётся в «уже там» и не сделает ничего,
    // а клиент останется немым до таймаута.
    let вошёл = null;
    try {
      вошёл = цель.add(conn, привет);
    } catch (e) {
      console.error(`вход в ${цель.id} не удался:`, e.message);
      conn.close(1011, 'не удалось войти в комнату');
      мояКомната = null; player = null;
      sweepRooms();
      return;
    }
    мояКомната = цель;
    player = вошёл;
    // Дошёл — засчитываем: «добраться до Пролома» и «спуститься на этаж» тоже
    // задания, и отмечает их тот, кто знает, куда игрок на самом деле попал.
    if (player && player.ent) {
      const w = цель.world;
      if (w.kind === 'biome') цель.quests.событие(player.ent, 'onEnterBiome', w.biomeId);
      if (w.kind === 'dungeon') цель.quests.событие(player.ent, 'onDepth', w.floor);
    }
    sweepRooms();
  };

  conn.onmessage = (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { conn.close(1003, 'не JSON'); return; }
    if (!player) {
      if (msg.t !== 'hello') { conn.close(1002, 'первым должен быть hello'); return; }
      // токен обязателен: без него непонятно, чей это персонаж
      const sess = readSession(msg.token);
      if (!sess) { conn.close(1008, 'нужен токен входа'); return; }
      привет = { ...msg, session: sess };
      переехать(msg.at || { kind: 'city' });
      return;
    }
    if (msg.t === 'travel') { переехать(msg.at || { kind: 'city' }); return; }
    if (msg.t === 'pickup') { мояКомната.world.pickup(player.pid, msg.lid); return; }
    // Торговля и кузня. Клиент присылает намерение, комната отвечает «да» или
    // «нет» с причиной — и, если да, сама меняет золото и рюкзак.
    if (msg.t === 'quest') { мояКомната.заданиe(player, msg); return; }
    if (msg.t === 'say') { мояКомната.сказать(player, msg.text); return; }
    if (msg.t === 'shop' || msg.t === 'buy' || msg.t === 'sell' || msg.t === 'craft'
        || msg.t === 'salvage' || msg.t === 'reforge' || msg.t === 'sharpen' || msg.t === 'fuse') {
      мояКомната.торг(player, msg);
      return;
    }
    мояКомната.onMessage(player, msg);
  };
  conn.onclose = () => { if (player && мояКомната) { мояКомната.remove(conn.id); sweepRooms(); } };
  conn.onerror = () => { /* обрыв — обычное дело, закрытие придёт следом */ };
});

// такт комнаты
const timer = setInterval(() => {
  // Такт идёт по всем открытым комнатам: пустых среди них не бывает дольше
  // одного переезда, их сносит `sweepRooms`.
  for (const r of rooms.values()) {
    try { r.step(); } catch (e) { console.error(`сбой такта в ${r.id}:`, e); }
  }
}, TICK_MS);

// сердцебиение: ping всем, чтобы обрывы обнаруживались быстрее таймаута
const beat = setInterval(() => {
  for (const r of rooms.values()) for (const p of r.players.values()) p.conn.ping();
}, PING_MS);

http.listen(PORT, () => {
  console.log(`Veloria: файлы и комната на http://localhost:${PORT}`);
  console.log(`такт ${TICK_HZ} Гц, состояние — /health`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    clearInterval(timer); clearInterval(beat);
    for (const r of rooms.values()) for (const p of r.players.values()) { try { p.conn.close(1001, 'сервер остановлен'); } catch { /* всё равно уходим */ } }
    http.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500);
  });
}
