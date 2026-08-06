// Частицы, всплывающие числа, погода и освещение.
// Свет собирается в отдельный буфер и накладывается умножением — отсюда
// «объёмная» подземельная тьма и тёплые пятна от факелов.

import { makeCanvas, glow } from './pixel.js';
import { rgba, RAMP } from './palette.js';
import { TAU, clamp } from '../core/util.js';
import { text } from './text.js';

export class Particles {
  constructor(max = 900) {
    this.max = max;
    this.list = [];
  }

  spawn(o) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({
      x: o.x, y: o.y, z: o.z || 0,
      vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      g: o.g ?? 0,
      life: o.life || 0.5, max: o.life || 0.5,
      size: o.size || 1, shrink: o.shrink ?? 1,
      color: o.color || '#ffffff',
      color2: o.color2 || null,
      glow: o.glow || 0,
      drag: o.drag ?? 0,
      shape: o.shape || 'px',
      spin: o.spin || 0, rot: o.rot || 0,
      layer: o.layer || 0,
    });
  }

  burst(x, y, n, o = {}) {
    for (let i = 0; i < n; i++) {
      const a = o.angle !== undefined ? o.angle + (Math.random() - 0.5) * (o.spread ?? TAU) : Math.random() * TAU;
      const sp = (o.speed || 30) * (0.5 + Math.random() * 0.8);
      this.spawn({
        ...o,
        x: x + (Math.random() - 0.5) * (o.jitter || 0),
        y: y + (Math.random() - 0.5) * (o.jitter || 0),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * (o.flat ? 0.45 : 1),
        vz: o.vz !== undefined ? o.vz * (0.4 + Math.random()) : 0,
        life: (o.life || 0.5) * (0.6 + Math.random() * 0.7),
      });
    }
  }

  update(dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.life -= dt;
      if (p.life <= 0) { L.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.vz || p.g) {
        p.z += p.vz * dt;
        p.vz -= p.g * dt;
        if (p.z < 0) { p.z = 0; p.vz *= -0.35; p.vx *= 0.6; p.vy *= 0.6; }
      }
      if (p.drag) {
        const f = Math.exp(-p.drag * dt);
        p.vx *= f; p.vy *= f;
      }
      p.rot += p.spin * dt;
    }
  }

  draw(g, cam, layer = 0) {
    for (const p of this.list) {
      if ((p.layer || 0) !== layer) continue;
      const t = p.life / p.max;
      const sx = (p.x - cam.x) | 0, sy = (p.y - p.z - cam.y) | 0;
      if (sx < -20 || sy < -20 || sx > cam.w + 20 || sy > cam.h + 20) continue;
      const s = Math.max(1, Math.round(p.size * (p.shrink ? t : 1)));
      const col = p.color2 && t < 0.5 ? p.color2 : p.color;
      g.globalAlpha = clamp(t * 1.6, 0, 1);
      if (p.glow) {
        g.globalAlpha = clamp(t, 0, 1) * 0.5;
        glow(g, sx, sy, p.glow, rgba(col, 0.7), 1);
        g.globalAlpha = clamp(t * 1.6, 0, 1);
      }
      g.fillStyle = col;
      if (p.shape === 'line') {
        const len = 2 + s * 2;
        const a = Math.atan2(p.vy, p.vx);
        g.fillRect(sx, sy, Math.max(1, Math.cos(a) * len) | 0 || 1, Math.max(1, s) | 0);
      } else if (p.shape === 'ring') {
        const r = (1 - t) * p.size * 6 + 2;
        g.globalAlpha = t * 0.7;
        g.strokeStyle = col;
        g.lineWidth = 1;
        g.beginPath(); g.arc(sx + 0.5, sy + 0.5, r, 0, TAU); g.stroke();
      } else {
        g.fillRect(sx, sy, s, s);
      }
    }
    g.globalAlpha = 1;
  }

  clear() { this.list.length = 0; }
}

// ─────────────────────────────────────────── всплывающий текст

export class FloatText {
  constructor() { this.list = []; }
  add(x, y, str, opts = {}) {
    this.list.push({
      x, y, str, life: opts.life || 0.9, max: opts.life || 0.9,
      color: opts.color || '#ffffff', size: opts.size || 10,
      vy: opts.vy ?? -26, vx: opts.vx ?? (Math.random() - 0.5) * 12,
      bold: opts.bold ?? false, crit: opts.crit || false,
    });
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.life -= dt;
      if (f.life <= 0) { this.list.splice(i, 1); continue; }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vy += 34 * dt;
    }
  }
  draw(g, cam) {
    for (const f of this.list) {
      const t = f.life / f.max;
      const pop = f.crit ? 1 + Math.max(0, (t - 0.75) * 4) * 0.5 : 1;
      text(g, f.str, (f.x - cam.x) | 0, (f.y - cam.y) | 0, {
        size: Math.round(f.size * pop), color: f.color, bold: f.bold || f.crit,
        align: 'center', outline: 'rgba(8,6,16,0.9)', alpha: clamp(t * 2, 0, 1),
      });
    }
  }
  clear() { this.list.length = 0; }
}

// ─────────────────────────────────────────── свет

export class Lighting {
  constructor(w, h) {
    this.g = makeCanvas(w, h);
    this.w = w; this.h = h;
    this.lights = [];
  }

  // Здесь были солнечные пятна сквозь крону — и их пришлось убрать. Замысел
  // верный: ровно освещённая поляна выглядит так, будто над ней ничего не
  // растёт. Но замощение шумом по всему экрану даёт видимую сетку повторов:
  // на 480 пикселях ширины плитка в 128 укладывается четыре раза, и глаз
  // мгновенно ловит решётку — на воде она читалась прямоугольниками.
  //
  // Прибавка при этом вышла мизерная: разброс яркости по кадру вырос всего на
  // 5%. Менять заметную сетку на пять процентов — плохая сделка.
  //
  // Как надо: пятна должны идти не от плитки поверх всего, а от самих крон —
  // светлые лужи под деревьями, привязанные к их положению. Это другая работа,
  // и делать её надо отдельно.
  add(x, y, r, color, alpha = 1) {
    if (r > 0) this.lights.push({ x, y, r, color, alpha });
  }
  render(mainCtx, ambient, time) {
    const g = this.g;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = ambient;
    g.fillRect(0, 0, this.w, this.h);
    g.globalCompositeOperation = 'lighter';
    for (const l of this.lights) {
      const grd = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
      grd.addColorStop(0, l.color);
      grd.addColorStop(0.45, rgba(hexOf(l.color), 0.42));
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = l.alpha;
      g.fillStyle = grd;
      g.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    mainCtx.globalCompositeOperation = 'multiply';
    mainCtx.drawImage(g.canvas, 0, 0);
    mainCtx.globalCompositeOperation = 'source-over';
    this.lights.length = 0;
  }
}

function hexOf(c) {
  if (c[0] === '#') return c;
  return '#ffffff';
}

// ─────────────────────────────────────────── погода / атмосфера

export class Weather {
  constructor() { this.kind = null; this.parts = []; this.t = 0; }

  set(kind, w, h) {
    if (this.kind === kind) return;
    this.kind = kind;
    this.parts = [];
    if (!kind) return;
    const n = kind === 'snow' ? 130 : kind === 'rain' ? 160 : kind === 'ember' ? 90 : kind === 'leaves' ? 55 : kind === 'spore' ? 70 : kind === 'rift' ? 80 : 0;
    for (let i = 0; i < n; i++) {
      this.parts.push({
        x: Math.random() * w, y: Math.random() * h,
        s: 0.4 + Math.random() * 0.9, p: Math.random() * TAU,
        v: 0.5 + Math.random(),
      });
    }
  }

  update(dt, w, h) {
    this.t += dt;
    const k = this.kind;
    if (!k) return;
    for (const p of this.parts) {
      if (k === 'snow') { p.y += 16 * p.v * dt; p.x += Math.sin(this.t * 0.8 + p.p) * 9 * dt; }
      else if (k === 'rain') { p.y += 210 * p.v * dt; p.x -= 46 * dt; }
      else if (k === 'ember') { p.y -= 22 * p.v * dt; p.x += Math.sin(this.t * 1.4 + p.p) * 14 * dt; }
      else if (k === 'leaves') { p.y += 12 * p.v * dt; p.x += Math.sin(this.t * 0.7 + p.p) * 16 * dt; }
      else if (k === 'spore') { p.y -= 6 * p.v * dt; p.x += Math.sin(this.t * 0.5 + p.p) * 7 * dt; }
      // Пролом: пыль не падает и не всплывает ровно — её тянет вверх рывками,
      // как будто воздух подсасывает в разлом.
      else if (k === 'rift') { p.y -= (9 + Math.sin(this.t * 1.7 + p.p) * 7) * p.v * dt; p.x += Math.sin(this.t * 0.9 + p.p * 2) * 11 * dt; }
      if (p.y > h + 4) { p.y = -4; p.x = Math.random() * w; }
      if (p.y < -4) { p.y = h + 4; p.x = Math.random() * w; }
      if (p.x > w + 4) p.x = -4;
      if (p.x < -4) p.x = w + 4;
    }
  }

  draw(g) {
    const k = this.kind;
    if (!k) return;
    g.save();
    for (const p of this.parts) {
      const x = p.x | 0, y = p.y | 0;
      if (k === 'snow') {
        g.globalAlpha = 0.35 + p.s * 0.5;
        g.fillStyle = '#dff2ff';
        g.fillRect(x, y, p.s > 1 ? 2 : 1, p.s > 1 ? 2 : 1);
      } else if (k === 'rain') {
        g.globalAlpha = 0.28;
        g.fillStyle = '#9fc4e8';
        g.fillRect(x, y, 1, 4 + p.s * 3);
      } else if (k === 'ember') {
        g.globalAlpha = 0.4 + Math.sin(this.t * 4 + p.p) * 0.3;
        g.fillStyle = p.s > 0.9 ? '#ffd166' : '#ff8a3a';
        g.fillRect(x, y, 1, 1);
      } else if (k === 'leaves') {
        g.globalAlpha = 0.5;
        g.fillStyle = p.s > 0.9 ? '#8fd96f' : '#4f9c46';
        g.fillRect(x, y, 2, 1);
      } else if (k === 'spore') {
        g.globalAlpha = 0.24 + Math.sin(this.t * 2 + p.p) * 0.14;
        g.fillStyle = '#c6ff8a';
        g.fillRect(x, y, 1, 1);
      } else if (k === 'rift') {
        // Пыль Пролома то вспыхивает, то гаснет — сильнее, чем споры в топи:
        // здесь она должна тревожить, а не висеть.
        g.globalAlpha = 0.20 + Math.sin(this.t * 3.1 + p.p) * 0.26;
        g.fillStyle = p.s > 0.95 ? '#e0c8ff' : '#8b5fd0';
        g.fillRect(x, y, 1, p.s > 1.1 ? 2 : 1);
      }
    }
    g.restore();
  }
}

// ─────────────────────────────────────────── пост-обработка

/**
 * Свечение ярких мест кадра. Порог берётся не через getImageData, а умножением
 * уменьшенной копии саму на себя: тёмное проваливается в ноль, яркое остаётся.
 * Дальше две ступени размытия складываются с кадром аддитивно.
 */
export class Bloom {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.w1 = Math.max(1, w >> 2); this.h1 = Math.max(1, h >> 2);
    this.w2 = Math.max(1, w >> 4); this.h2 = Math.max(1, h >> 4);
    this.s1 = makeCanvas(this.w1, this.h1);
    this.s2 = makeCanvas(this.w2, this.h2);
    this.extra = makeCanvas(w, h);   // явные источники: магия, огонь, лут
  }

  /** Дополнительный источник свечения поверх того, что нашлось в кадре. */
  add(x, y, r, color, alpha = 1) {
    if (r <= 0) return;
    const g = this.extra;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, color);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = alpha;
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
    g.restore();
    this.hasExtra = true;
  }

  render(ctx, src, strength = 1) {
    if (strength <= 0) { this.clear(); return; }
    const { s1, s2, w1, h1, w2, h2, w, h } = this;

    s1.globalCompositeOperation = 'copy';
    s1.imageSmoothingEnabled = true;
    s1.drawImage(src, 0, 0, w1, h1);
    // возведение в 4-ю степень — дешёвый порог яркости
    s1.globalCompositeOperation = 'multiply';
    s1.drawImage(s1.canvas, 0, 0);
    s1.drawImage(s1.canvas, 0, 0);
    if (this.hasExtra) {
      s1.globalCompositeOperation = 'lighter';
      s1.drawImage(this.extra.canvas, 0, 0, w1, h1);
    }
    s1.globalCompositeOperation = 'source-over';

    s2.globalCompositeOperation = 'copy';
    s2.imageSmoothingEnabled = true;
    s2.drawImage(s1.canvas, 0, 0, w2, h2);
    s2.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.42 * strength;
    ctx.drawImage(s1.canvas, 0, 0, w, h);
    ctx.globalAlpha = 0.68 * strength;
    ctx.drawImage(s2.canvas, 0, 0, w, h);
    ctx.restore();
    ctx.imageSmoothingEnabled = false;
    this.clear();
  }

  clear() {
    if (this.hasExtra) {
      this.extra.clearRect(0, 0, this.w, this.h);
      this.hasExtra = false;
    }
  }
}

/**
 * Двухтоновая тонировка: холод сверху, тепло снизу. Дешёвый приём, который
 * заменяет плоскую заливку «настроением» и делает кадр объёмнее.
 */
const gradeCache = new Map();
export function toneGrade(g, w, h, top, bottom, alpha) {
  if (alpha <= 0) return;
  const key = w + '|' + h + '|' + top + '|' + bottom;
  let c = gradeCache.get(key);
  if (!c) {
    c = makeCanvas(w, h);
    const grd = c.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, top);
    grd.addColorStop(1, bottom);
    c.fillStyle = grd;
    c.fillRect(0, 0, w, h);
    gradeCache.set(key, c);
  }
  g.save();
  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = alpha;
  g.drawImage(c.canvas, 0, 0);
  g.restore();
  g.globalCompositeOperation = 'source-over';
}

const vignetteCache = new Map();
export function vignette(g, w, h, strength = 0.55, color = '0,0,0') {
  const key = w + 'x' + h + '|' + color;
  let c = vignetteCache.get(key);
  if (!c) {
    c = makeCanvas(w, h);
    const grd = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.74);
    grd.addColorStop(0, `rgba(${color},0)`);
    grd.addColorStop(0.6, `rgba(${color},0.35)`);
    grd.addColorStop(1, `rgba(${color},1)`);
    c.fillStyle = grd;
    c.fillRect(0, 0, w, h);
    vignetteCache.set(key, c);
  }
  g.save();
  g.globalAlpha = strength;
  g.drawImage(c.canvas, 0, 0);
  g.restore();
}

const hazeCache = new Map();

/**
 * Воздушная дымка: чем дальше от камеры, тем блёклее.
 *
 * В верхней проекции экранный `y` — это и есть расстояние до камеры: верх кадра
 * дальше низа. Поэтому дымка привязана к экрану, а не к миру, и это не
 * произвольная накладка, а честная функция расстояния — она едет по миру
 * вместе с камерой ровно так, как и должна.
 *
 * Замер показал, что признака удалённости в кадре не было вовсе: насыщенность
 * по шести полосам сверху вниз держалась 0,47–0,52, то есть плоско. Разница в
 * контрасте (23,9 сверху против 34,9 снизу) шла от виньетки, а не от глубины.
 *
 * Дымка светлит и обесцвечивает одновременно — обычным альфа-смешиванием к
 * своему цвету. Виньетка идёт **после** и продолжает затемнять края: это разные
 * вещи, дымка про даль, виньетка про кадр.
 */
// `reach` — докуда достаёт дымка, долей высоты кадра. 0,46 (до середины)
// пришлось поджать до 0,32: герой стоит в центре экрана, и полоса задевала его
// самого и всё, с чем он дерётся. Обесцвечивать бойцов ради дали — плохая
// сделка; дымка нужна над линией боя, а не в ней.
export function haze(g, w, h, color, alpha, reach = 0.32) {
  if (alpha <= 0) return;
  const key = w + '|' + h + '|' + color + '|' + reach;
  let c = hazeCache.get(key);
  if (!c) {
    c = makeCanvas(w, h);
    const grd = c.createLinearGradient(0, 0, 0, h * reach);
    grd.addColorStop(0, color);
    // Спад квадратичный, а не прямой: у прямого видно, где полоса кончается,
    // и дымка читается краем плёнки, а не воздухом.
    grd.addColorStop(0.45, color.replace(/[\d.]+\)$/, '0.34)'));
    grd.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
    c.fillStyle = grd;
    c.fillRect(0, 0, w, Math.ceil(h * reach));
    hazeCache.set(key, c);
  }
  g.save();
  g.globalAlpha = alpha;
  g.drawImage(c.canvas, 0, 0);
  g.restore();
}

/** Цветовая заливка поверх кадра — «настроение» биома. */
export function grade(g, w, h, color, alpha, mode = 'overlay') {
  if (alpha <= 0) return;
  g.save();
  g.globalCompositeOperation = mode;
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  g.restore();
  g.globalCompositeOperation = 'source-over';
}

export class Shake {
  constructor() { this.t = 0; this.power = 0; this.x = 0; this.y = 0; }
  add(power, time = 0.25) {
    if (power > this.power || this.t < time * 0.4) { this.power = Math.max(this.power, power); this.t = Math.max(this.t, time); this.max = this.t; }
  }
  update(dt) {
    if (this.t <= 0) { this.x = this.y = 0; this.power = 0; return; }
    this.t -= dt;
    const k = Math.max(0, this.t / (this.max || 0.25));
    const p = this.power * k * k;
    this.x = (Math.random() - 0.5) * p * 2;
    this.y = (Math.random() - 0.5) * p * 2;
  }
}
