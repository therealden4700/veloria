// Инструменты рисования по пиксельной сетке + запекание спрайтов в offscreen-канвасы.
// Всё рисуется в низком разрешении и потом растягивается nearest-neighbour —
// именно поэтому даже «гладкие» градиенты выглядят как честный пиксель-арт.

import { INK } from './palette.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0);
  c.height = Math.max(1, h | 0);
  const x = c.getContext('2d', { willReadFrequently: false });
  x.imageSmoothingEnabled = false;
  return x;
}

/**
 * Канвас в обычной памяти. Отсюда чтение пикселей почти бесплатно, тогда как
 * с канваса в видеопамяти каждое getImageData — принудительная выгрузка.
 */
let cpuBuf = null;
function cpuCanvas(w, h) {
  if (!cpuBuf || cpuBuf.canvas.width < w || cpuBuf.canvas.height < h) {
    const c = document.createElement('canvas');
    c.width = Math.max(w, 128); c.height = Math.max(h, 128);
    cpuBuf = c.getContext('2d', { willReadFrequently: true });
    cpuBuf.imageSmoothingEnabled = false;
  }
  cpuBuf.clearRect(0, 0, cpuBuf.canvas.width, cpuBuf.canvas.height);
  return cpuBuf;
}

/**
 * Полный цикл запекания кадра: рисуем СРАЗУ в память, там же обводим и
 * подсвечиваем кромку, и только готовое отдаём в видеопамять.
 *
 * Раньше кадр рисовался в видеопамяти, а потом дважды вычитывался оттуда
 * (обводка и подсветка — каждая со своими getImageData/putImageData). На 104
 * кадрах героя это давало 208 выгрузок и заминку в 130 мс при каждой смене
 * снаряжения. Здесь выгрузок нет вовсе: только одна загрузка готового кадра.
 */
export function bakeFrame(w, h, drawFn, ink = INK, rimColor = [255, 240, 205], strength = 0.5) {
  const b = cpuCanvas(w, h);
  drawFn(b);
  inkAndRim(b, ink, rimColor, strength, -1, -1, w, h);
  const g = makeCanvas(w, h);
  g.drawImage(b.canvas, 0, 0, w, h, 0, 0, w, h);
  return g;
}

/** Заливка прямоугольника по целым пикселям. */
export function rect(g, x, y, w, h, c) {
  g.fillStyle = c;
  g.fillRect(x | 0, y | 0, w | 0, h | 0);
}

/** Пиксель. */
export function px(g, x, y, c) {
  g.fillStyle = c;
  g.fillRect(x | 0, y | 0, 1, 1);
}

/** Заполненный эллипс по сетке (алгоритм по строкам — без сглаживания). */
export function ellipse(g, cx, cy, rx, ry, c) {
  g.fillStyle = c;
  for (let y = -ry; y <= ry; y++) {
    const t = 1 - (y * y) / (ry * ry);
    if (t <= 0) continue;
    const w = Math.sqrt(t) * rx;
    const x0 = Math.round(cx - w), x1 = Math.round(cx + w);
    g.fillRect(x0, Math.round(cy + y), Math.max(1, x1 - x0), 1);
  }
}

/** Прямоугольник со срезанными углами — база почти всех тел. */
export function box(g, x, y, w, h, c, r = 1) {
  g.fillStyle = c;
  g.fillRect(x + r, y, w - r * 2, h);
  g.fillRect(x, y + r, w, h - r * 2);
  if (r > 1) {
    g.fillRect(x + 1, y + 1, r, r);
    g.fillRect(x + w - r - 1, y + 1, r, r);
    g.fillRect(x + 1, y + h - r - 1, r, r);
    g.fillRect(x + w - r - 1, y + h - r - 1, r, r);
  }
}

/** Линия Брезенхэма. */
export function line(g, x0, y0, x1, y1, c, thick = 1) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  g.fillStyle = c;
  for (;;) {
    g.fillRect(x0, y0, thick, thick);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Строковый арт: массив строк + карта символ→цвет. */
export function stamp(g, art, map, ox = 0, oy = 0, flip = false) {
  for (let y = 0; y < art.length; y++) {
    const row = art[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const col = map[ch];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(ox + (flip ? row.length - 1 - x : x), oy + y, 1, 1);
    }
  }
}

/** Шахматный дизеринг между двумя цветами — даёт «текстуру» без шума. */
export function dither(g, x, y, w, h, c, phase = 0) {
  g.fillStyle = c;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (((i + j + phase) & 1) === 0) g.fillRect(x + i, y + j, 1, 1);
    }
  }
}

/**
 * Обводка непрозрачных пикселей. Ключевой приём: именно контур делает
 * процедурные формы похожими на нарисованный пиксель-арт.
 */
export function outline(g, color = INK, diagonal = false) {
  const cv = g.canvas, w = cv.width, h = cv.height;
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const solid = new Uint8Array(w * h);
  // порог высокий: полупрозрачное свечение не должно считаться телом спрайта
  for (let i = 0; i < w * h; i++) solid[i] = d[i * 4 + 3] > 110 ? 1 : 0;

  const [r, gg, b] = parseRGB(color);
  const offs = diagonal
    ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
    : [[1, 0], [-1, 0], [0, 1], [0, -1]];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (solid[i]) continue;
      let near = false;
      for (const [ox, oy] of offs) {
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (solid[ny * w + nx]) { near = true; break; }
      }
      if (near) {
        const p = i * 4;
        d[p] = r; d[p + 1] = gg; d[p + 2] = b; d[p + 3] = 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
  return g;
}

/**
 * Обводка и подсветка кромки одним проходом.
 *
 * Раньше это были две функции, каждая со своими getImageData/putImageData —
 * на 104 кадрах героя выходило 208 выгрузок пикселей с видеопамяти, и смена
 * снаряжения замирала на 130 мс. Здесь чтение одно, и оно идёт с отдельного
 * CPU-канваса (willReadFrequently), где выгрузка почти бесплатна.
 */
export function inkAndRim(g, ink = INK, rimColor = [255, 240, 205], strength = 0.5, dx = -1, dy = -1, ow = 0, oh = 0) {
  const cv = g.canvas;
  const w = ow || cv.width, h = oh || cv.height;
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;

  // тело: порог высокий, чтобы полупрозрачное свечение не считалось спрайтом
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) solid[i] = d[i * 4 + 3] > 110 ? 1 : 0;

  // ── обводка по четырём сторонам
  const [r0, g0, b0] = parseRGB(ink);
  const inked = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (solid[i]) continue;
      const near =
        (x + 1 < w && solid[i + 1]) || (x > 0 && solid[i - 1]) ||
        (y + 1 < h && solid[i + w]) || (y > 0 && solid[i - w]);
      if (!near) continue;
      const p = i * 4;
      d[p] = r0; d[p + 1] = g0; d[p + 2] = b0; d[p + 3] = 255;
      inked[i] = 1;
    }
  }

  // ── подсветка кромки поверх уже обведённого силуэта
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!solid[i] && !inked[i]) continue;
      const nx = x + dx, ny = y + dy;
      const inside = nx >= 0 && ny >= 0 && nx < w && ny < h;
      const nb = inside ? ny * w + nx : -1;
      if (inside && (solid[nb] || inked[nb])) continue;   // сосед не пуст — не кромка
      const p = i * 4;
      const lum = (d[p] + d[p + 1] + d[p + 2]) / 3;
      if (lum < 34) continue;                             // сам контур не подсвечиваем
      d[p] = d[p] * (1 - strength) + rimColor[0] * strength;
      d[p + 1] = d[p + 1] * (1 - strength) + rimColor[1] * strength;
      d[p + 2] = d[p + 2] * (1 - strength) + rimColor[2] * strength;
    }
  }

  g.putImageData(img, 0, 0);
  return g;
}

/**
 * Подсветка кромки: пиксели тела, у которых сосед сверху-слева пустой,
 * получают примесь тёплого света. Это то, что отличает «фигуру из примитивов»
 * от нарисованного спрайта — появляется ощущение направленного солнца.
 */
export function rimLight(g, color = [255, 240, 205], strength = 0.5, dx = -1, dy = -1) {
  const cv = g.canvas, w = cv.width, h = cv.height;
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = d[i * 4 + 3] > 128 ? 1 : 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!solid[i]) continue;
      const nx = x + dx, ny = y + dy;
      const outside = nx < 0 || ny < 0 || nx >= w || ny >= h || !solid[ny * w + nx];
      if (!outside) continue;
      // не подсвечиваем сам контур — он должен остаться тёмным
      const p = i * 4;
      const lum = (d[p] + d[p + 1] + d[p + 2]) / 3;
      if (lum < 34) continue;
      const a = strength;
      d[p] = d[p] * (1 - a) + color[0] * a;
      d[p + 1] = d[p + 1] * (1 - a) + color[1] * a;
      d[p + 2] = d[p + 2] * (1 - a) + color[2] * a;
    }
  }
  g.putImageData(img, 0, 0);
  return g;
}

/**
 * Чёрный силуэт спрайта для отбрасываемой тени. Кэшируется на самом канвасе,
 * порог по альфе отсекает запечённую мягкую тень под ногами.
 */
const silCache = new WeakMap();
export function silhouette(canvas) {
  let s = silCache.get(canvas);
  if (s) return s;
  const g = makeCanvas(canvas.width, canvas.height);
  g.drawImage(canvas, 0, 0);
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] > 128 ? 255 : 0;
    d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = a;
  }
  g.putImageData(img, 0, 0);
  s = g.canvas;
  silCache.set(canvas, s);
  return s;
}

// матрица Байера 4×4 — упорядоченный дизер без «шума»
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * Копия листа, у которой внутри каждого тайла плотность падает от указанной
 * грани к противоположной. Так стык двух типов земли растушёвывается только
 * вдоль общего ребра, а не заливает клетку целиком.
 * dir: 0 сверху, 1 снизу, 2 слева, 3 справа.
 */
export function ditherEdge(canvas, dir, tile = 16, reach = 0.75) {
  const g = makeCanvas(canvas.width, canvas.height);
  g.drawImage(canvas, 0, 0);
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000';
  const w = canvas.width, h = canvas.height;
  const span = Math.max(1, (tile - 1) * reach);
  for (let y = 0; y < h; y++) {
    const ly = y % tile;
    for (let x = 0; x < w; x++) {
      const lx = x % tile;
      const d = dir === 0 ? ly : dir === 1 ? tile - 1 - ly : dir === 2 ? lx : tile - 1 - lx;
      const level = 16 - Math.round(Math.min(1, d / span) * 17);
      if (BAYER4[(y & 3) * 4 + (x & 3)] >= level) g.fillRect(x, y, 1, 1);
    }
  }
  g.globalCompositeOperation = 'source-over';
  return g.canvas;
}

function parseRGB(c) {
  if (c[0] === '#') {
    let h = c.slice(1);
    if (h.length === 3) h = h.split('').map((v) => v + v).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = c.match(/[\d.]+/g);
  return [+m[0], +m[1], +m[2]];
}

/** Мягкая тень-эллипс под персонажем. */
export function shadow(g, cx, cy, rx, ry, a = 0.34) {
  g.save();
  g.globalAlpha = a;
  ellipse(g, cx, cy, rx, ry, '#000000');
  g.restore();
}

/** Копия канваса, перекрашенная в сплошной цвет (вспышка урона). */
export function tintCopy(src, color) {
  const g = makeCanvas(src.canvas.width, src.canvas.height);
  g.drawImage(src.canvas, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, src.canvas.width, src.canvas.height);
  g.globalCompositeOperation = 'source-over';
  return g;
}

/**
 * Радиальный градиент-«свечение». Складывается со сценой (lighter), а не
 * закрывает её — иначе спрайт под свечением превращается в мутное пятно.
 */
export function glow(g, x, y, r, color, alpha = 1) {
  if (r <= 0) return;
  const grd = g.createRadialGradient(x, y, 0, x, y, r);
  grd.addColorStop(0, color);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = alpha;
  g.fillStyle = grd;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  g.restore();
}

/** Отражённая по горизонтали копия — экономит половину кадров анимации. */
export function mirror(src) {
  const g = makeCanvas(src.canvas.width, src.canvas.height);
  g.translate(src.canvas.width, 0);
  g.scale(-1, 1);
  g.drawImage(src.canvas, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  return g;
}
