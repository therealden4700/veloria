// WebSocket без зависимостей: рукопожатие и кадры по RFC 6455.
//
// Библиотеку `ws` сюда не взяли намеренно. В проекте нет ни одной зависимости —
// вся графика, звук и шрифт написаны руками, — и сервер держит ту же линию:
// один `npm install` тянет за собой дерево чужого кода, которое потом надо
// обновлять и за которым надо следить. Здесь нужен разбор кадров, а это
// рукопожатие на SHA-1 и десяток строк битовой арифметики.
//
// Что поддерживается: текстовые и двоичные кадры, склейка продолжений,
// ping/pong, закрытие. Чего нет: расширений (сжатие permessage-deflate) и
// серверных масок — по стандарту сервер и не должен маскировать.

import { createHash, randomBytes } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** Максимум на кадр: игровой ввод — десятки байт, всё крупнее подозрительно. */
const MAX_FRAME = 1 << 20;   // 1 МБ

export function acceptKey(key) {
  return createHash('sha1').update(key + GUID).digest('base64');
}

/**
 * Соединение поверх сырого сокета.
 *
 * Событий три: `message(data, isBinary)`, `close(code, reason)`, `error(err)`.
 * Намеренно без EventEmitter — три колбэка читаются проще, чем подписка.
 */
export class Conn {
  constructor(socket, id) {
    this.socket = socket;
    this.id = id;
    this.alive = true;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this.lastPong = Date.now();

    this._buf = Buffer.alloc(0);
    this._frag = null;          // склейка продолжений
    this._fragOp = 0;

    socket.on('data', (chunk) => this._feed(chunk));
    socket.on('close', () => this._closed(1006, 'сокет закрыт'));
    socket.on('error', (e) => { if (this.onerror) this.onerror(e); this._closed(1006, String(e && e.message)); });
    socket.setNoDelay(true);    // игре важнее задержка, чем экономия пакетов
  }

  _closed(code, reason) {
    if (!this.alive) return;
    this.alive = false;
    try { this.socket.destroy(); } catch { /* уже мёртв */ }
    if (this.onclose) this.onclose(code, reason);
  }

  _feed(chunk) {
    this._buf = this._buf.length ? Buffer.concat([this._buf, chunk]) : chunk;
    for (;;) {
      const f = this._readFrame();
      if (!f) return;
      if (f === 'bad') { this.close(1002, 'кадр не по стандарту'); return; }
      this._handle(f);
      if (!this.alive) return;
    }
  }

  /** Достать один кадр из буфера или вернуть null, если данных мало. */
  _readFrame() {
    const b = this._buf;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    const rsv = b[0] & 0x70;
    const op = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (rsv) return 'bad';                    // расширений не заявляли
    if (!masked) return 'bad';                // клиент обязан маскировать
    if (len === 126) {
      if (b.length < off + 2) return null;
      len = b.readUInt16BE(off); off += 2;
    } else if (len === 127) {
      if (b.length < off + 8) return null;
      const big = b.readBigUInt64BE(off); off += 8;
      if (big > BigInt(MAX_FRAME)) return 'bad';
      len = Number(big);
    }
    if (len > MAX_FRAME) return 'bad';
    if (b.length < off + 4 + len) return null;
    const mask = b.subarray(off, off + 4); off += 4;
    const payload = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) payload[i] = b[off + i] ^ mask[i & 3];
    this._buf = b.subarray(off + len);
    return { fin, op, payload };
  }

  _handle(f) {
    switch (f.op) {
      case 0x0: {                              // продолжение
        if (this._frag === null) { this.close(1002, 'продолжение без начала'); return; }
        this._frag = Buffer.concat([this._frag, f.payload]);
        if (f.fin) { const d = this._frag, op = this._fragOp; this._frag = null; this._deliver(op, d); }
        break;
      }
      case 0x1:                                // текст
      case 0x2:                                // двоичные
        if (!f.fin) { this._frag = f.payload; this._fragOp = f.op; }
        else this._deliver(f.op, f.payload);
        break;
      case 0x8: {                              // закрытие
        const code = f.payload.length >= 2 ? f.payload.readUInt16BE(0) : 1005;
        this._sendFrame(0x8, f.payload.subarray(0, 2));
        this._closed(code, f.payload.subarray(2).toString('utf8'));
        break;
      }
      case 0x9: this._sendFrame(0xa, f.payload); break;   // ping → pong
      case 0xa: this.lastPong = Date.now(); break;        // pong
      default: this.close(1002, 'неизвестный код операции');
    }
  }

  _deliver(op, data) {
    if (!this.onmessage) return;
    try {
      this.onmessage(op === 0x1 ? data.toString('utf8') : data, op === 0x2);
    } catch (e) {
      if (this.onerror) this.onerror(e);
    }
  }

  _sendFrame(op, payload) {
    if (!this.alive) return false;
    const len = payload.length;
    let head;
    if (len < 126) {
      head = Buffer.allocUnsafe(2);
      head[1] = len;
    } else if (len < 65536) {
      head = Buffer.allocUnsafe(4);
      head[1] = 126;
      head.writeUInt16BE(len, 2);
    } else {
      head = Buffer.allocUnsafe(10);
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(len), 2);
    }
    head[0] = 0x80 | op;
    try {
      this.socket.write(head);
      if (len) this.socket.write(payload);
      return true;
    } catch (e) {
      if (this.onerror) this.onerror(e);
      return false;
    }
  }

  send(data) {
    if (typeof data === 'string') return this._sendFrame(0x1, Buffer.from(data, 'utf8'));
    return this._sendFrame(0x2, Buffer.isBuffer(data) ? data : Buffer.from(data));
  }

  ping() { return this._sendFrame(0x9, Buffer.alloc(0)); }

  close(code = 1000, reason = '') {
    if (!this.alive) return;
    const r = Buffer.from(String(reason), 'utf8');
    const p = Buffer.allocUnsafe(2 + r.length);
    p.writeUInt16BE(code, 0);
    r.copy(p, 2);
    this._sendFrame(0x8, p);
    this._closed(code, reason);
  }
}

/**
 * Повесить приём WebSocket на обычный http-сервер.
 * `onConn(conn, req)` зовётся на каждое установленное соединение.
 */
export function attachWebSocket(httpServer, onConn) {
  let seq = 0;
  httpServer.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    const ver = req.headers['sec-websocket-version'];
    if (String(req.headers.upgrade || '').toLowerCase() !== 'websocket' || !key || ver !== '13') {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
    onConn(new Conn(socket, `c${++seq}-${randomBytes(3).toString('hex')}`), req);
  });
}
