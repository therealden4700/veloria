// Безголовый холст: слой графики работает там, где нет экрана.
//
// Сервер должен уметь построить зону — тайлы, коллизию, спавны, выходы — и ни
// разу ничего не нарисовать. Мешает одно: генерация зон зовёт `addProp`, а тот
// берёт готовые холсты спрайтов и читает у них `width`/`height`. То есть, чтобы
// получить список камней, надо сначала эти камни нарисовать.
//
// Переписывать 216 функций рисования ради этого не нужно. Им от холста требуется
// удивительно мало: размеры, контекст, который молча проглатывает вызовы, и
// честный `getImageData`/`putImageData` — на них держатся обводка и подсветка
// кромки. Здесь ровно это и сделано: заглушка хранит размеры и буфер пикселей,
// а рисование выбрасывает.
//
// Важно, чего заглушка НЕ делает: она не притворяется, что рисует. Пиксели
// остаются нулями, `inkAndRim` честно обходит пустой буфер и ничего не находит.
// Серверу это безразлично — ему нужны габариты и коллизия, а не картинка.

/** Плоская заглушка ImageData: тот же интерфейс, что у настоящей. */
class StubImageData {
  constructor(w, h, data) {
    this.width = w;
    this.height = h;
    this.data = data || new Uint8ClampedArray(w * h * 4);
  }
}

const NOOP = () => {};

/** Контекст, глотающий рисование. Возвращает то, что от него читают. */
class StubContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = '#000';
    this.strokeStyle = '#000';
    this.globalAlpha = 1;
    this.globalCompositeOperation = 'source-over';
    this.imageSmoothingEnabled = false;
    this.lineWidth = 1;
    this.lineJoin = 'miter';
    this.font = '10px sans-serif';
    this.textAlign = 'left';
    this.textBaseline = 'alphabetic';
    // пиксели живут здесь: getImageData/putImageData работают по-настоящему,
    // иначе обводка спрайтов уронила бы генерацию на первом же вызове
    this._px = new Uint8ClampedArray(canvas.width * canvas.height * 4);
  }

  getImageData(x, y, w, h) {
    const out = new StubImageData(w, h);
    const cw = this.canvas.width, ch = this.canvas.height;
    for (let row = 0; row < h; row++) {
      const sy = y + row;
      if (sy < 0 || sy >= ch) continue;
      for (let col = 0; col < w; col++) {
        const sx = x + col;
        if (sx < 0 || sx >= cw) continue;
        const s = (sy * cw + sx) * 4, d = (row * w + col) * 4;
        out.data[d] = this._px[s];
        out.data[d + 1] = this._px[s + 1];
        out.data[d + 2] = this._px[s + 2];
        out.data[d + 3] = this._px[s + 3];
      }
    }
    return out;
  }

  putImageData(img, x, y) {
    const cw = this.canvas.width, ch = this.canvas.height;
    for (let row = 0; row < img.height; row++) {
      const dy = y + row;
      if (dy < 0 || dy >= ch) continue;
      for (let col = 0; col < img.width; col++) {
        const dx = x + col;
        if (dx < 0 || dx >= cw) continue;
        const s = (row * img.width + col) * 4, d = (dy * cw + dx) * 4;
        this._px[d] = img.data[s];
        this._px[d + 1] = img.data[s + 1];
        this._px[d + 2] = img.data[s + 2];
        this._px[d + 3] = img.data[s + 3];
      }
    }
  }

  createImageData(w, h) { return new StubImageData(w, h); }
  measureText(s) { return { width: String(s).length * 6 }; }
  createLinearGradient() { return { addColorStop: NOOP }; }
  createRadialGradient() { return { addColorStop: NOOP }; }
  createPattern() { return null; }
}

for (const m of ['fillRect', 'strokeRect', 'clearRect', 'beginPath', 'moveTo', 'lineTo',
  'arc', 'arcTo', 'ellipse', 'closePath', 'fill', 'stroke', 'save', 'restore', 'translate',
  'rotate', 'scale', 'clip', 'drawImage', 'fillText', 'strokeText', 'setTransform',
  'resetTransform', 'transform', 'quadraticCurveTo', 'bezierCurveTo', 'rect', 'setLineDash']) {
  StubContext.prototype[m] = NOOP;
}

class StubCanvas {
  constructor(w = 300, h = 150) {
    this._w = w; this._h = h;
    this._ctx = null;
  }
  get width() { return this._w; }
  set width(v) { this._w = v | 0; this._ctx = null; }
  get height() { return this._h; }
  set height(v) { this._h = v | 0; this._ctx = null; }
  getContext() {
    if (!this._ctx) this._ctx = new StubContext(this);
    return this._ctx;
  }
}

export function isHeadless() {
  return typeof document === 'undefined' || !document.createElement;
}

/**
 * Поставить заглушки в глобальную область. Зовётся один раз до импорта
 * графики; в браузере не делает ничего.
 */
export function installHeadless(g = globalThis) {
  if (!isHeadless()) return false;
  g.document = g.document || {
    createElement(tag) {
      if (String(tag).toLowerCase() !== 'canvas') return { style: {} };
      return new StubCanvas();
    },
    getElementById() { return null; },
  };
  if (!g.performance) g.performance = { now: () => 0 };
  if (!g.requestAnimationFrame) g.requestAnimationFrame = () => 0;
  if (!g.addEventListener) g.addEventListener = NOOP;
  if (!g.removeEventListener) g.removeEventListener = NOOP;
  if (!g.localStorage) {
    const mem = new Map();
    g.localStorage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
    };
  }
  if (!g.window) g.window = g;
  return true;
}
