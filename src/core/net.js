// Сеть на стороне клиента: ввод туда, снимки обратно.
//
// Две вещи, ради которых этот файл вообще существует.
//
// ── Предсказание своего движения
//
// Наивно было бы слать ввод и ждать, что ответит сервер. В реальной сети это
// 50–100 мс до отклика на каждое нажатие, и игра, в которой бьют мышью,
// превращается в мокрую тряпку. Поэтому клиент двигает героя сразу, а вводы
// складывает в очередь с номерами. Сервер в каждом снимке говорит, какой номер
// он уже учёл; клиент берёт присланное положение как истину и переигрывает
// поверх него те вводы, до которых сервер ещё не дошёл. На экране движение
// мгновенное, а правда всё равно за сервером.
//
// Шаг ходьбы взят из общего модуля (`world/collide.js`, `stepMove`) — того же,
// которым считает сервер. Разойдись они хоть коэффициентом затухания, сверка
// каждый раз давала бы другой ответ, и героя трясло бы на месте.
//
// ── Сглаживание чужих
//
// Снимки приходят двадцать раз в секунду, а рисуем мы шестьдесят. Показывать
// чужих там, где они были в последнем снимке, — значит дёргать их каждые 50 мс.
// Поэтому чужие рисуются с задержкой в сотню миллисекунд: между двумя снимками
// всегда есть третий, и положение берётся интерполяцией. Размен честный —
// чужие слегка в прошлом, зато движутся плавно.

import { stepMove } from '../world/collide.js';

const SEND_HZ = 20;                 // как часто шлём ввод
const SEND_MS = 1000 / SEND_HZ;
const INTERP_MS = 100;              // на сколько отстаёт отрисовка чужих
const HISTORY_MAX = 120;            // хватит на три секунды при 20 Гц
const SNAP_KEEP = 20;

export class Net {
  constructor() {
    this.ws = null;
    this.state = 'offline';         // offline | connecting | online | error
    this.error = null;
    this.pid = null;
    this.world = null;              // описание зоны от сервера
    this.snaps = [];                // последние снимки, для сглаживания
    this.history = [];              // неподтверждённые вводы
    this.seq = 0;
    this.clockOffset = 0;           // серверное время минус наше
    this.rtt = 0;
    this._sendAcc = 0;
    this._pingAt = 0;
    this.stats = { sent: 0, got: 0, corrections: 0, maxError: 0 };
    this.onWelcome = null;
  }

  get online() { return this.state === 'online'; }

  connect(url, hello) {
    this.disconnect();
    this.state = 'connecting';
    this.error = null;
    return new Promise((done) => {
      let ws;
      try { ws = new WebSocket(url); } catch (e) { this.state = 'error'; this.error = String(e.message); done(null); return; }
      this.ws = ws;
      const fail = (why) => { this.state = 'error'; this.error = why; done(null); };
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', ...hello }));
      ws.onerror = () => fail('нет связи с комнатой');
      ws.onclose = () => { if (this.state !== 'error') { this.state = 'offline'; } this.ws = null; };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        this.stats.got++;
        if (m.t === 'welcome') {
          this.pid = m.pid;
          this.world = m.world;
          // Комната, в которой мы теперь: по ней отбраковываются снимки и
          // события, долетевшие из прежней.
          this.room = m.room || null;
          this._events = [];
          this.snaps.length = 0;
          this.state = 'online';
          this.clockOffset = m.now - Date.now();
          if (this.onWelcome) this.onWelcome(m);
          done(m);
        } else if (m.t === 'bag') {
          this.bag = m;
          if (this.onBag) this.onBag(m);
        } else if (m.t === 'shop') {
          if (this.onShop) this.onShop(m);
        } else if (m.t === 'деньги') {
          if (this.onDeal) this.onDeal(m);
        } else if (m.t === 'me') {
          this.me = m;
          if (this.onMe) this.onMe(m);
        } else if (m.t === 'snap') {
          this._onSnap(m);
        } else if (m.t === 'pong') {
          this.rtt = Date.now() - m.c;
          // половина круга — поправка часов; сглаживаем, чтобы не прыгала
          this.clockOffset = this.clockOffset * 0.8 + (m.now + this.rtt / 2 - Date.now()) * 0.2;
        }
      };
      setTimeout(() => { if (this.state === 'connecting') fail('комната не ответила'); }, 5000);
    });
  }

  /**
   * Взмах: в общий мир уходит намерение, а не результат.
   *
   * Клиент говорит «махнул, вот куда смотрю и какой это удар в связке».
   * Кого задело и на сколько, решает комната — теми же `swingHits` и
   * `resolveHit`, которыми бьёт одиночная игра. Прислать сюда урон было бы
   * ровно тем, от чего мы уходили: сервер обязан быть источником правды.
   */
  sendSwing(combo, facing) {
    if (!this.online || !this.ws) return;
    try { this.ws.send(JSON.stringify({ t: 'swing', combo, f: +facing.toFixed(2) })); this.stats.sent++; } catch { /* оборвалось — переживём */ }
  }

  /**
   * Намерение из лавки или кузни. Решает комната: она знает золото, материалы
   * и ассортимент, и она же меняет рюкзак.
   */
  торг(msg) {
    if (!this.online || !this.ws) return false;
    try { this.ws.send(JSON.stringify(msg)); this.stats.sent++; return true; } catch { return false; }
  }

  /** Поднять лежащее: решает комната, мы только просим. */
  pickup(lid) {
    if (!this.online || !this.ws) return;
    try { this.ws.send(JSON.stringify({ t: 'pickup', lid })); this.stats.sent++; } catch { /* оборвалось */ }
  }

  /** Переезд в другую комнату тем же соединением. */
  travel(at) {
    if (!this.online || !this.ws) return;
    this.snaps.length = 0;
    this.history.length = 0;
    // Очередь событий чистилась не здесь, и лесное попадание отыгрывалось в
    // болоте — на существе с тем же номером, но другом.
    this._events = [];
    // До нового `welcome` мы не знаем, в какой мы комнате: всё, что прилетит,
    // относится к прежней.
    this.room = null;
    try { this.ws.send(JSON.stringify({ t: 'travel', at })); } catch { /* см. выше */ }
  }

  /** События последнего снимка: попадания, промахи, смерти. */
  takeEvents() {
    const e = this._events || [];
    this._events = [];
    return e;
  }

  disconnect() {
    if (this.ws) { try { this.ws.close(); } catch { /* уже закрыт */ } }
    this.ws = null;
    this.state = 'offline';
    this.pid = null;
    this.snaps.length = 0;
    this.history.length = 0;
    this._events = [];
    this.room = null;
  }

  _onSnap(m) {
    // Снимок из прошлой комнаты применять нельзя: номера в нём означают других
    // существ. Комната рассылает двадцать раз в секунду, и всё, что уже в
    // полёте, приходит уже после входа в новую зону — при задержке от 420 мс
    // это хоронило всё население новой зоны разом.
    if (m.room && this.room && m.room !== this.room) return;
    if (m.ev && m.ev.length) (this._events ||= []).push(...m.ev);
    this.snaps.push(m);
    if (this.snaps.length > SNAP_KEEP) this.snaps.shift();
    this._fresh = true;          // сверяться есть с чем
  }

  /**
   * Отправить ввод и подвинуть своего героя предсказанием.
   * Зовётся каждый кадр; на провод уходит двадцать раз в секунду.
   */
  sendInput(dt, mx, my, facing) {
    if (!this.online) return;

    // Копим ШАГИ, а не последнее значение.
    //
    // Раньше сюда уходило «куда я иду прямо сейчас» двадцать раз в секунду, а
    // сервер применял это своим тактом. Формула шага одна и та же, но клиент
    // интегрирует шестьдесят раз в секунду, а сервер двадцать — и пошаговое
    // интегрирование при разном шаге даёт разные координаты. Отсюда и брались
    // поправки на трети вводов при полностью совпадающих характеристиках.
    //
    // Теперь клиент шлёт ровно те шаги, которые сделал сам, вместе с их dt, а
    // сервер их проигрывает. Совпадение становится точным, а не приблизительным.
    this._batch = this._batch || [];
    this._batch.push({ mx, my, dt });
    this._sendAcc += dt * 1000;
    if (this._sendAcc < SEND_MS) return;
    this._sendAcc = 0;
    this.seq++;
    const steps = this._batch;
    this._batch = [];
    this.history.push({ seq: this.seq, steps });
    if (this.history.length > HISTORY_MAX) this.history.shift();
    try {
      this.ws.send(JSON.stringify({
        t: 'input', seq: this.seq, f: +facing.toFixed(3),
        // округляем: направление задаётся десятыми, точнее не нужно, а строка короче
        s: steps.map((x) => [+x.mx.toFixed(2), +x.my.toFixed(2), +x.dt.toFixed(4)]),
      }));
      this.stats.sent++;
    } catch { /* обрыв — onclose разберётся */ }

    const now = Date.now();
    if (now - this._pingAt > 1000) {
      this._pingAt = now;
      try { this.ws.send(JSON.stringify({ t: 'ping', c: now })); } catch { /* см. выше */ }
    }
  }

  /** Последнее известное состояние своего героя по мнению сервера. */
  myServerState() {
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      const p = this.snaps[i].players.find((x) => x.pid === this.pid);
      if (p) return p;
    }
    return null;
  }

  /**
   * Сверка: подвинуть героя туда, где его видит сервер, и переиграть свои
   * шаги, которых сервер ещё не учёл.
   *
   * Порог в один пиксель не прихоть: сервер округляет координаты до целых, и
   * без порога сверка срабатывала бы каждый снимок на ровном месте.
   */
  reconcile(zone, ent, speed) {
    if (!this.online || !this._fresh) return false;
    // Сверяться имеет смысл ровно на новом снимке. Раньше `reconcile` звался
    // каждый кадр, то есть шестьдесят раз в секунду против двадцати приходящих
    // снимков: две трети вызовов пересчитывали одно и то же и тянули героя
    // назад к устаревшей истине. В замере это выглядело как 116 поправок на 49
    // отправленных вводов.
    this._fresh = false;
    const s = this.myServerState();
    if (!s) return false;

    this.history = this.history.filter((h) => h.seq > s.seq);

    const ghost = { x: s.x, y: s.y, vx: s.vx, vy: s.vy, w: ent.w, h: ent.h };
    for (const h of this.history) for (const st of h.steps) stepMove(zone, ghost, st.mx, st.my, speed, st.dt);

    const err = Math.hypot(ghost.x - ent.x, ghost.y - ent.y);
    this.stats.maxError = Math.max(this.stats.maxError, err);
    // Порог в пиксель: сервер округляет координаты до целых, и без порога
    // сверка срабатывала бы на ровном месте каждый снимок.
    if (err < 0.8) return false;

    this.stats.corrections++;
    if (err > 48) {
      // расхождение больше полутора клеток — что-то серьёзное (телепорт,
      // долгий обрыв). Ставим жёстко, плавность тут неуместна.
      ent.x = ghost.x; ent.y = ghost.y;
    } else {
      // мелкое расхождение подтягиваем, а не дёргаем: рывок заметнее ошибки
      ent.x += (ghost.x - ent.x) * 0.25;
      ent.y += (ghost.y - ent.y) * 0.25;
    }
    ent.vx = ghost.vx; ent.vy = ghost.vy;
    return true;
  }

  /** Чужие игроки, сглаженные во времени. Своего в списке нет. */
  others() {
    if (!this.online || this.snaps.length < 2) return [];
    const render = Date.now() + this.clockOffset - INTERP_MS;

    let a = null, b = null;
    for (let i = this.snaps.length - 1; i > 0; i--) {
      if (this.snaps[i - 1].now <= render && this.snaps[i].now >= render) { a = this.snaps[i - 1]; b = this.snaps[i]; break; }
    }
    if (!a) { a = b = this.snaps[this.snaps.length - 1]; }

    const span = Math.max(1, b.now - a.now);
    const t = Math.max(0, Math.min(1, (render - a.now) / span));
    const out = [];
    for (const pb of b.players) {
      if (pb.pid === this.pid) continue;
      const pa = a.players.find((x) => x.pid === pb.pid) || pb;
      out.push({
        pid: pb.pid, name: pb.name, look: pb.look, hp: pb.hp,
        x: pa.x + (pb.x - pa.x) * t,
        y: pa.y + (pb.y - pa.y) * t,
        facing: angleLerp(pa.f, pb.f, t),
        moving: Math.hypot(pb.vx || 0, pb.vy || 0) > 6,
      });
    }
    return out;
  }
}

/** Углы нельзя смешивать напрямую: между 3,1 и −3,1 короткий путь через π. */
function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export const net = new Net();
