// Профайлер кадра: честное время, а не то, что кажется.
//
// ── Зачем он отдельно
//
// За эту работу я мерил кадр руками пять раз, и дважды замер соврал: один раз я
// гонял `update` со своими паузами и игра шла втрое быстрее реального времени,
// другой — звал `update` поверх работающего цикла страницы, и она шла вдвое.
// Оба раза числа выглядели убедительно и были ложью.
//
// Отсюда правило, на котором построен этот файл: **профайлер ничего не двигает
// и никого не вызывает**. Он только смотрит со стороны на цикл, который и так
// идёт. `frame()` зовётся из настоящего `loop`, `mark()` — из мест, которые уже
// выполняются. Если убрать профайлер, игра пойдёт ровно так же.
//
// ── Что он меряет
//
// Кадр целиком, `update` и `draw` по отдельности, и произвольные участки внутри
// них через `mark`. Плюс промежуток между кадрами — по нему видно просадки,
// которых в самом кадре нет: сборка мусора и работа браузера случаются **между**
// вызовами, и замер только внутри кадра их не заметит.
//
// Хранится кольцо на 240 кадров — четыре секунды при шестидесяти в секунду.
// Медиана и худшие 5% берутся по нему: среднее по кадрам бесполезно, редкий
// провал в нём растворяется, а игроку заметен именно он.

const РАЗМЕР = 240;

class Profiler {
  constructor() {
    this.on = false;
    this.frames = new Float32Array(РАЗМЕР);
    this.updates = new Float32Array(РАЗМЕР);
    this.draws = new Float32Array(РАЗМЕР);
    this.gaps = new Float32Array(РАЗМЕР);
    this.i = 0;
    this.n = 0;
    this._t0 = 0;
    this._prevEnd = 0;
    this._marks = new Map();     // имя → накопленное за текущий кадр
    this._open = new Map();      // имя → момент начала
    this.sections = new Map();   // имя → { сум, кадров }
  }

  /** Начало кадра. Зовётся из настоящего цикла, ничего не запускает сам. */
  frameStart() {
    if (!this.on) return;
    const t = performance.now();
    // промежуток между концом прошлого кадра и началом этого: сюда попадает
    // всё, что делает браузер, — сборка мусора, вёрстка, декодирование
    if (this._prevEnd) this.gaps[this.i] = t - this._prevEnd;
    this._t0 = t;
    this._marks.clear();
  }

  updateEnd() { if (this.on) this.updates[this.i] = performance.now() - this._t0; }

  /** Конец кадра: закрываем кольцо и переносим участки в накопитель. */
  frameEnd() {
    if (!this.on) return;
    const t = performance.now();
    this.frames[this.i] = t - this._t0;
    this.draws[this.i] = this.frames[this.i] - this.updates[this.i];
    this._prevEnd = t;
    for (const [имя, мс] of this._marks) {
      const s = this.sections.get(имя) || { сум: 0, кадров: 0 };
      s.сум += мс; s.кадров++;
      this.sections.set(имя, s);
    }
    this.i = (this.i + 1) % РАЗМЕР;
    if (this.n < РАЗМЕР) this.n++;
  }

  /** Участок внутри кадра: `mark('свет')` … `mark('свет')`. */
  mark(имя) {
    if (!this.on) return;
    const t = performance.now();
    const был = this._open.get(имя);
    if (был === undefined) { this._open.set(имя, t); return; }
    this._open.delete(имя);
    this._marks.set(имя, (this._marks.get(имя) || 0) + (t - был));
  }

  /** Медиана и худшие 5% по кольцу. Среднее не считаем: провалы в нём тонут. */
  _свод(arr) {
    if (!this.n) return { мед: 0, p95: 0, макс: 0 };
    const v = Array.from(arr.subarray(0, this.n)).sort((a, b) => a - b);
    return { мед: v[v.length >> 1], p95: v[Math.floor(v.length * 0.95)], макс: v[v.length - 1] };
  }

  snapshot() {
    const f = this._свод(this.frames);
    return {
      кадров: this.n,
      кадр: f,
      update: this._свод(this.updates),
      draw: this._свод(this.draws),
      пауза: this._свод(this.gaps),
      // доля бюджета 60 кадров в секунду — то, что важно на самом деле
      бюджет: f.мед / 16.67,
      участки: [...this.sections].map(([имя, s]) => ({ имя, мс: s.сум / Math.max(1, s.кадров) }))
        .sort((a, b) => b.мс - a.мс),
    };
  }

  toggle() {
    this.on = !this.on;
    if (this.on) { this.i = 0; this.n = 0; this._prevEnd = 0; this.sections.clear(); }
    return this.on;
  }
}

export const profiler = new Profiler();
