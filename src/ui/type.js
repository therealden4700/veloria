// Шрифт интерфейса: настоящий, со сглаживанием.
//
// В мире шрифт остаётся пиксельным — цифры урона и таблички над врагами должны
// жить в той же сетке, что и спрайты. Интерфейс же рисуется в разрешении
// экрана, и там пиксельная имитация не нужна и вредна: она была вынужденной
// мерой при кегле 10 и стоила читаемости. Порог альфы раздувал округлые глифы,
// `%` слипался с цифрой, и «−9%» в листе героя читалось как «−94».
//
// Здесь ничего резать не надо, и заодно отсюда берётся обещанное место.
//
// Кегли приходят прежние — вызовы отрисовки не переписывались, — но вектор при
// той же высоте занимает заметно меньше ширины, чем пиксельная имитация с её
// обязательным зазором между знаками. Поэтому кегль ещё и уменьшается на
// COMPACT: строка «Продолжить» при `size: 10` была 60 пикселей раскладки, стала
// 34. Панели от этого получают вдвое больше места при тех же размерах.

import { t } from '../core/i18n.js';

// Гротеск без засечек: ровный ритм, есть везде. Кириллица и латиница обязаны
// браться из одного семейства, иначе «ур. 12 / lv. 12» разъезжаются по высоте.
const FAMILY = '"Inter", "Segoe UI Variable", "Segoe UI", "Helvetica Neue", Arial, sans-serif';

/**
 * Во сколько раз кегль меньше прежнего пиксельного.
 *
 * 0,62 подобрано по мелкому тексту: подписи `size: 8` не должны стать нечитаемо
 * мелкими (8 × 0,62 ≈ 5 единиц = 20 настоящих пикселей на 1080p — как раз
 * нижняя граница удобного чтения), а заголовки `size: 42` не должны раздуться.
 */
const COMPACT = 0.62;

const px = (size) => Math.max(3.2, size * COMPACT);
const face = (size, bold) => `${bold ? 600 : 400} ${px(size)}px ${FAMILY}`;

let measCtx = null;
const widths = new Map();
const bases = new Map();

/**
 * Куда ставить базовую линию, чтобы буква встала по центру строки высотой
 * `size`.
 *
 * Все раскладки интерфейса писались под пиксельный шрифт, где строка `size: 10`
 * занимала ровно десять единиц: «по центру кнопки» означало `y + (h - 10) / 2`.
 * Вектор той же нарицательной высоты занимает 6,2 — и подпись вставала на 1,75
 * единицы выше центра, то есть на семь настоящих пикселей при 1080p. Заметно
 * это было именно в кнопках, где есть с чем сравнивать.
 *
 * Поэтому `y` здесь по-прежнему означает верх строки высотой `size`, а буква
 * центруется внутри неё. Так все четыреста мест остались правильными.
 */
function baseline(size, bold) {
  const k = size + (bold ? 'b' : 'n');
  let v = bases.get(k);
  if (v === undefined) {
    const g = mc();
    g.font = face(size, bold);
    const m = g.measureText('Нx');
    const cap = m.actualBoundingBoxAscent || px(size) * 0.72;
    v = size / 2 + cap / 2;
    bases.set(k, v);
  }
  return v;
}

function mc() {
  if (!measCtx) {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    measCtx = c.getContext('2d');
  }
  return measCtx;
}

/** Ширина строки в единицах раскладки. Кэш: за кадр одно и то же меряется десятки раз. */
export function uiMeasure(str, size = 10, bold = false) {
  str = t(String(str));
  const k = size + (bold ? 'b' : 'n') + str;
  let w = widths.get(k);
  if (w === undefined) {
    const g = mc();
    g.font = face(size, bold);
    w = g.measureText(str).width;
    if (widths.size > 6000) widths.clear();
    widths.set(k, w);
  }
  return w;
}

/**
 * Написать строку. `y` — верх строки, как было у пиксельного шрифта: смысл
 * координаты не изменился, поэтому раскладки переносятся без правки.
 */
export function uiText(g, str, x, y, opts = {}) {
  str = t(String(str));
  const size = opts.size || 10;
  const s = px(size);
  g.save();
  g.font = face(size, opts.bold);
  g.textAlign = opts.align === 'center' ? 'center' : opts.align === 'right' ? 'right' : 'left';
  g.textBaseline = 'alphabetic';
  const by = y + baseline(size, opts.bold);
  if (opts.alpha !== undefined) g.globalAlpha = opts.alpha;
  if (opts.outline) {
    // 0,28 кегля было взято от пиксельного шрифта, где обводка рисовалась
    // сдвигом на целый пиксель. Для вектора это слишком: у цифры высотой пять
    // пикселей обводка съедала форму, и «265» на полосе здоровья читалось как
    // тёмное пятно. 0,18 хватает, чтобы отделить текст от заливки полосы.
    g.lineWidth = Math.max(0.8, s * 0.18);
    g.lineJoin = 'round';
    g.miterLimit = 2;
    g.strokeStyle = opts.outline;
    g.strokeText(str, x, by);
  } else if (opts.shadow) {
    g.fillStyle = typeof opts.shadow === 'string' ? opts.shadow : 'rgba(6,4,14,0.7)';
    g.fillText(str, x, by + Math.max(0.6, s * 0.09));
  }
  g.fillStyle = opts.color || '#e6eaf5';
  g.fillText(str, x, by);
  g.restore();
  return uiMeasure(str, size, opts.bold);
}

/** Разбить по ширине. Переводить надо до разбиения — переносы у языков разные. */
export function uiWrap(str, maxW, size = 10, bold = false) {
  const words = t(String(str)).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (uiMeasure(test, size, bold) > maxW && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function uiBlock(g, str, x, y, maxW, opts = {}) {
  const size = opts.size || 10;
  const lh = opts.lineHeight || Math.round(size * 1.3);
  const lines = uiWrap(str, maxW, size, opts.bold);
  lines.forEach((ln, i) => uiText(g, ln, x, y + i * lh, opts));
  return lines.length * lh;
}

/** Обрезать по ширине с многоточием. */
export function uiEllipsize(str, maxW, size = 10, bold = false) {
  str = t(String(str));
  if (uiMeasure(str, size, bold) <= maxW) return str;
  let lo = 1, hi = str.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (uiMeasure(str.slice(0, mid) + '…', size, bold) <= maxW) lo = mid; else hi = mid - 1;
  }
  return str.slice(0, lo) + '…';
}
