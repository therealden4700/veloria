// Пиксельный текст без файлов шрифтов: системный моноширинный рендерится в буфер,
// затем альфа режется по порогу — сглаживание пропадает, остаются чёткие пиксели.
// Результат кэшируется, поэтому дорогая операция выполняется один раз на строку.

import { makeCanvas } from './pixel.js';
import { t, onLangChange } from '../core/i18n.js';

const FONT_STACK = '"Menlo", "DejaVu Sans Mono", "Consolas", monospace';
const cache = new Map();
const MAX_CACHE = 900;

function key(str, size, color, bold, outlineCol) {
  return size + '|' + (bold ? 'b' : 'n') + '|' + color + '|' + (outlineCol || '-') + '|' + str;
}

function build(str, size, color, bold, outlineCol) {
  const measure = makeCanvas(4, 4);
  measure.font = `${bold ? 'bold ' : ''}${size}px ${FONT_STACK}`;
  const w = Math.ceil(measure.measureText(str).width) + 2;
  const h = size + 6;

  const g = makeCanvas(w + 2, h + 2);
  g.font = `${bold ? 'bold ' : ''}${size}px ${FONT_STACK}`;
  g.textBaseline = 'top';
  g.fillStyle = '#ffffff';
  g.fillText(str, 1, 1);

  // порог альфы → жёсткие края
  const img = g.getImageData(0, 0, g.canvas.width, g.canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i + 3] = d[i + 3] > 118 ? 255 : 0;
  }
  g.putImageData(img, 0, 0);

  // перекрашиваем в нужный цвет
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, g.canvas.width, g.canvas.height);
  g.globalCompositeOperation = 'source-over';

  if (outlineCol) {
    const o = makeCanvas(g.canvas.width + 2, g.canvas.height + 2);
    const sil = makeCanvas(g.canvas.width, g.canvas.height);
    sil.drawImage(g.canvas, 0, 0);
    sil.globalCompositeOperation = 'source-in';
    sil.fillStyle = outlineCol;
    sil.fillRect(0, 0, g.canvas.width, g.canvas.height);
    for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2], [0, 0], [2, 0], [0, 2], [2, 2]]) {
      o.drawImage(sil.canvas, dx, dy);
    }
    o.drawImage(g.canvas, 1, 1);
    return o;
  }
  return g;
}

function get(str, size, color, bold, outlineCol) {
  const k = key(str, size, color, bold, outlineCol);
  let c = cache.get(k);
  if (!c) {
    if (cache.size > MAX_CACHE) cache.clear();
    c = build(str, size, color, bold, outlineCol);
    cache.set(k, c);
  }
  return c;
}

// Смена языка обнуляет кэш: в нём лежат картинки старых строк, и новых там
// всё равно нет — держать их значит только занимать место до сброса по лимиту.
onLangChange(() => cache.clear());

export function measure(str, size = 10, bold = false) {
  return get(t(String(str)), size, '#fff', bold, null).canvas.width - 2;
}

/**
 * Нарисовать текст.
 * opts: { size, color, bold, align:'left'|'center'|'right', shadow, outline, alpha, maxWidth }
 */
export function text(g, str, x, y, opts = {}) {
  // Перевод стоит здесь, а не в местах вызова: через эту дверь проходит весь
  // текст игры, и 833 литерала из 901 доходят сюда нетронутыми.
  str = t(String(str));
  const size = opts.size || 10;
  const color = opts.color || '#e6eaf5';
  const bold = !!opts.bold;
  const outlineCol = opts.outline || null;
  const c = get(str, size, color, bold, outlineCol);
  const w = c.canvas.width;
  let dx = x | 0;
  if (opts.align === 'center') dx = (x - w / 2) | 0;
  else if (opts.align === 'right') dx = (x - w) | 0;
  const dy = y | 0;

  if (opts.alpha !== undefined) { g.save(); g.globalAlpha = opts.alpha; }
  if (opts.shadow) {
    const s = get(str, size, typeof opts.shadow === 'string' ? opts.shadow : 'rgba(9,7,18,0.85)', bold, null);
    g.drawImage(s.canvas, dx + (outlineCol ? 1 : 0), dy + 1);
  }
  g.drawImage(c.canvas, dx, dy);
  if (opts.alpha !== undefined) g.restore();
  return w;
}

/**
 * Текст с принудительным шагом между знаками.
 *
 * Шрифт здесь — системный моноширинный, срезанный по порогу альфы. Порог
 * раздувает округлые глифы на пиксель, и пары `00`, `0%`, `40%` склеиваются в
 * одно пятно: из двадцати одного значения громкости так слипаются шестнадцать.
 * Поднять порог нельзя — на 160 рассыпаются `N`, `m`, `ё` и точка-разделитель
 * `·`, которой в интерфейсе полно (проверено по всем знакам на четырёх
 * размерах).
 *
 * Поэтому знаки при необходимости ставятся поштучно с целым шагом. Режим
 * необязательный: обычный `text` не меняется совсем, и ни одна существующая
 * раскладка не едет. Годится для чисел и процентов, не для длинных фраз —
 * шаг тут шире натурального.
 */
export function textSpread(g, str, x, y, opts = {}) {
  str = String(str);
  const size = opts.size || 10;
  const adv = opts.advance || Math.round(size * 0.62) + 1;
  const w = str.length * adv;
  let dx = x | 0;
  if (opts.align === 'center') dx = (x - w / 2) | 0;
  else if (opts.align === 'right') dx = (x - w) | 0;
  const one = { ...opts, align: 'left' };
  for (let i = 0; i < str.length; i++) text(g, str[i], dx + i * adv, y, one);
  return w;
}

/**
 * Разбить строку на строки по ширине (в пикселях).
 *
 * Перевод обязан случиться до разбиения, а не после: английская фраза ломается
 * по другим местам, и если перевести уже готовые куски, строки разъедутся.
 */
export function wrap(str, maxW, size = 10, bold = false) {
  const words = t(String(str)).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? cur + ' ' + word : word;
    if (measure(test, size, bold) > maxW && cur) {
      lines.push(cur);
      cur = word;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function textBlock(g, str, x, y, maxW, opts = {}) {
  const size = opts.size || 10;
  const lh = opts.lineHeight || size + 4;
  const lines = wrap(str, maxW, size, opts.bold);
  lines.forEach((ln, i) => text(g, ln, x, y + i * lh, opts));
  return lines.length * lh;
}

/** Обрезает строку по ширине, добавляя многоточие. */
export function ellipsize(str, maxW, size = 10, bold = false) {
  // резать надо уже переведённое: длина у языков разная, и обрезка русского
  // варианта дала бы английский, обрезанный не там
  str = t(String(str));
  if (measure(str, size, bold) <= maxW) return str;
  let lo = 1, hi = str.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(str.slice(0, mid) + '…', size, bold) <= maxW) lo = mid; else hi = mid - 1;
  }
  return str.slice(0, lo) + '…';
}

export function clearTextCache() { cache.clear(); }
