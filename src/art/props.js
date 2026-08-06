// Объекты мира: деревья, камни, дома, сундуки, порталы — и иконки предметов.

import { makeCanvas, rect, box, ellipse, line, px, outline, shadow, glow, dither, rimLight, inkAndRim } from './pixel.js';
import { RAMP, INK, RARITY, TIER_RAMP, rgba, shade } from './palette.js';
import { makeRng } from '../core/rng.js';
import { TAU } from '../core/util.js';

export const PROPS = {};

/** Контур + подсветка кромки. Единая финальная обработка для всего реквизита. */
function finish(g, rim = 0.4) {
  if (rim > 0) inkAndRim(g, INK, [255, 244, 216], rim);
  else outline(g, INK);
  return g.canvas;
}

// ─────────────────────────────────────────── мелочь на земле

/** Пучок травы — качается на ветру, ставится россыпью поверх земли. */
function grassTuft(cfg) {
  const w = cfg.w || 12, h = cfg.h || 13;
  const g = makeCanvas(w, h);
  const r = makeRng(cfg.seed || 5);
  const ramp = cfg.ramp || RAMP.emerald;
  const n = cfg.blades || 6;
  for (let i = 0; i < n; i++) {
    const bx = w / 2 + (r() - 0.5) * (w - 4);
    const bh = 4 + r() * (h - 6);
    const bend = (r() - 0.5) * 3;
    const col = ramp[1 + ((r() * 2.6) | 0)];
    line(g, bx, h - 1, bx + bend, h - 1 - bh, col, 1);
    px(g, bx + bend, h - 2 - bh, ramp[3]);
  }
  if (cfg.flower) {
    const fx = w / 2 + (r() - 0.5) * 4;
    const fy = h - 3 - r() * (h - 6);
    px(g, fx, fy, cfg.flower);
    px(g, fx + 1, fy, cfg.flower);
    px(g, fx, fy - 1, cfg.flower);
    px(g, fx, fy + 1, '#f6f0c8');
  }
  return finish(g, 0);
}

/** Плоская деталь: камешки, кости, трещины, корни — без тени и качания. */
function groundDetail(cfg) {
  const w = cfg.w || 14, h = cfg.h || 8;
  const g = makeCanvas(w, h);
  const r = makeRng(cfg.seed || 9);
  const ramp = cfg.ramp || RAMP.stone;
  const kind = cfg.kind || 'pebble';
  if (kind === 'pebble') {
    for (let i = 0; i < 4; i++) {
      const rr = 1 + r() * 1.8;
      ellipse(g, 2 + r() * (w - 4), 2 + r() * (h - 3), rr, rr * 0.75, ramp[1 + ((r() * 2) | 0)]);
    }
  } else if (kind === 'crack') {
    let x = 1, y = h / 2;
    for (let i = 0; i < w - 2; i++) {
      px(g, x, y, ramp[0]);
      if (r() < 0.3) px(g, x, y + (r() < 0.5 ? 1 : -1), ramp[0]);
      x++; y += (r() - 0.5) * 1.2;
      y = Math.max(1, Math.min(h - 2, y));
    }
  } else if (kind === 'bone') {
    line(g, 2, h - 3, w - 3, h - 5, RAMP.bone[3], 1);
    px(g, 2, h - 4, RAMP.bone[2]); px(g, 2, h - 2, RAMP.bone[2]);
    px(g, w - 3, h - 6, RAMP.bone[2]); px(g, w - 3, h - 4, RAMP.bone[2]);
  } else if (kind === 'root') {
    let x = 0, y = h - 2;
    for (let i = 0; i < w; i++) {
      px(g, x, y, ramp[1]);
      px(g, x, y - 1, ramp[2]);
      x++; y += (r() - 0.5);
      y = Math.max(1, Math.min(h - 1, y));
    }
  }
  return g.canvas;
}

// ─────────────────────────────────────────── деревья

function tree(cfg) {
  const w = cfg.w || 40, h = cfg.h || 52;
  const g = makeCanvas(w, h);
  const r = makeRng(cfg.seed || 7);
  const cx = w / 2, base = h - 2;
  const trunk = cfg.trunk || RAMP.wood;
  const leaf = cfg.leaf || RAMP.emerald;

  shadow(g, cx, base, w * 0.28, 3, 0.3);

  // ствол
  const th = cfg.trunkH || h * 0.42;
  for (let i = 0; i < th; i++) {
    const yy = base - i;
    const wd = Math.max(3, (cfg.trunkW || 6) - i * 0.05);
    rect(g, cx - wd / 2, yy, wd, 1, trunk[1]);
    rect(g, cx - wd / 2, yy, Math.max(1, wd * 0.35), 1, trunk[2]);
  }
  // корни
  line(g, cx - 3, base - 1, cx - 6, base, trunk[0], 1);
  line(g, cx + 3, base - 1, cx + 6, base, trunk[0], 1);

  if (cfg.shape === 'dead') {
    for (let i = 0; i < 5; i++) {
      const a = -0.4 - r() * 2.4;
      const bx = cx + (r() - 0.5) * 3, by = base - th + r() * 8;
      line(g, bx, by, bx + Math.cos(a) * (7 + r() * 6), by + Math.sin(a) * (7 + r() * 6), trunk[1], 1);
    }
    return finish(g);
  }

  if (cfg.shape === 'pine') {
    const top = base - th - 2;
    for (let layer = 0; layer < 4; layer++) {
      const ly = top + layer * (h * 0.13);
      const lw = 6 + layer * (w * 0.11);
      for (let i = 0; i < 12; i++) {
        const t = i / 11;
        const xx = cx - lw + t * lw * 2;
        const hh = (1 - Math.abs(t - 0.5) * 2) * 8 + 3;
        rect(g, xx, ly, 2, hh, i % 3 === 0 ? leaf[2] : leaf[1]);
      }
      rect(g, cx - lw * 0.4, ly, lw * 0.5, 3, leaf[3]);
    }
    ellipse(g, cx, top - 2, 3, 5, leaf[2]);
  } else if (cfg.shape === 'mushroom') {
    ellipse(g, cx, base - th - 4, w * 0.42, h * 0.2, leaf[1]);
    ellipse(g, cx - 2, base - th - 6, w * 0.3, h * 0.13, leaf[2]);
    for (let i = 0; i < 7; i++) {
      ellipse(g, cx + (r() - 0.5) * w * 0.6, base - th - 4 + (r() - 0.5) * 6, 2 + r() * 2, 1.5 + r(), leaf[3]);
    }
  } else {
    // раскидистая крона — несколько перекрывающихся эллипсов
    const cy = base - th - h * 0.16;
    const blobs = cfg.blobs || 7;
    for (let i = 0; i < blobs; i++) {
      const a = (i / blobs) * TAU;
      const rr = w * 0.2 + r() * w * 0.08;
      ellipse(g, cx + Math.cos(a) * w * 0.22, cy + Math.sin(a) * h * 0.1, rr, rr * 0.85, leaf[1]);
    }
    ellipse(g, cx, cy, w * 0.32, h * 0.19, leaf[2]);
    ellipse(g, cx - w * 0.1, cy - h * 0.06, w * 0.19, h * 0.1, leaf[3]);
    // листва-точки для фактуры
    for (let i = 0; i < 22; i++) {
      const a = r() * TAU, d = r();
      px(g, cx + Math.cos(a) * w * 0.34 * d, cy + Math.sin(a) * h * 0.2 * d, r() > 0.5 ? leaf[3] : leaf[0]);
    }
    if (cfg.fruit) {
      for (let i = 0; i < 5; i++) {
        px(g, cx + (r() - 0.5) * w * 0.55, cy + (r() - 0.3) * h * 0.28, cfg.fruit);
      }
    }
  }
  return finish(g);
}

// ─────────────────────────────────────────── камни, кусты, мелочь

function rock(cfg) {
  const w = cfg.w || 24, h = cfg.h || 18;
  const g = makeCanvas(w, h);
  const r = makeRng(cfg.seed || 3);
  const ramp = cfg.ramp || RAMP.stone;
  shadow(g, w / 2, h - 2, w * 0.34, 2.4, 0.3);
  const n = cfg.chunks || 3;
  for (let i = 0; i < n; i++) {
    const cx = w / 2 + (r() - 0.5) * w * 0.4;
    const cy = h - 4 - r() * h * 0.35;
    const rr = w * (0.16 + r() * 0.14);
    ellipse(g, cx, cy, rr, rr * 0.8, ramp[1]);
    ellipse(g, cx - rr * 0.2, cy - rr * 0.25, rr * 0.7, rr * 0.5, ramp[2]);
    px(g, cx - rr * 0.5, cy - rr * 0.5, ramp[3]);
  }
  if (cfg.crystal) {
    for (let i = 0; i < 3; i++) {
      const bx = w / 2 + (r() - 0.5) * w * 0.4, by = h - 5;
      const hgt = 5 + r() * 7;
      line(g, bx, by, bx + (r() - 0.5) * 3, by - hgt, cfg.crystal[2], 2);
      line(g, bx, by, bx + (r() - 0.5) * 3, by - hgt, cfg.crystal[3], 1);
    }
    glow(g, w / 2, h - 8, 12, rgba(cfg.crystal[2], 0.3), 0.9);
  }
  return finish(g);
}

function bush(cfg) {
  const w = cfg.w || 22, h = cfg.h || 16;
  const g = makeCanvas(w, h);
  const r = makeRng(cfg.seed || 11);
  const leaf = cfg.leaf || RAMP.emerald;
  shadow(g, w / 2, h - 2, w * 0.32, 2, 0.26);
  for (let i = 0; i < 5; i++) {
    ellipse(g, w / 2 + (r() - 0.5) * w * 0.5, h - 5 - r() * 4, w * 0.2, h * 0.24, leaf[1]);
  }
  ellipse(g, w / 2, h - 7, w * 0.28, h * 0.24, leaf[2]);
  for (let i = 0; i < 8; i++) px(g, w / 2 + (r() - 0.5) * w * 0.7, h - 4 - r() * 7, leaf[3]);
  if (cfg.berry) for (let i = 0; i < 4; i++) px(g, w / 2 + (r() - 0.5) * w * 0.6, h - 5 - r() * 6, cfg.berry);
  return finish(g);
}

// ─────────────────────────────────────────── постройки

/**
 * Ряды черепицы на скате. Раньше крыша была гладким треугольником с редкими
 * точками — на референсах видно другое: чешуя лежит рядами, между рядами тёмная
 * линия, а внутри ряда чешуйки разделены и сдвинуты через ряд.
 */
function shingles(g, cx, topY, rh, halfW, ramp, o = {}) {
  const step = o.step ?? 3, scale = o.scale ?? 4;
  const ridge = o.ridge ?? 0;      // полуширина конька: 0 — сходится в точку
  const flare = o.flare ?? 0;      // разлёт свесов у карниза
  for (let i = 0; i < rh; i++) {
    const t = (i + 1) / rh;
    const hw = Math.max(1, ridge + (halfW - ridge) * t + flare * t * t * t);
    const y = topY + i;
    const row = (i / step) | 0;
    // левый скат светлее правого — то же солнце, что у всех спрайтов
    rect(g, cx - hw, y, hw, 1, row % 2 ? ramp[2] : ramp[1]);
    rect(g, cx, y, hw, 1, row % 2 ? ramp[1] : ramp[0]);
    if (i % step === step - 1) {
      rect(g, cx - hw, y, hw * 2, 1, ramp[0]);            // граница ряда
    } else {
      const off = row % 2 ? 0 : scale / 2;                // шахматка чешуи
      for (let x = -hw + off; x < hw; x += scale) px(g, cx + x, y, ramp[0]);
    }
    if (o.edge) { px(g, cx - hw, y, ramp[0]); px(g, cx + hw - 1, y, ramp[0]); }
  }
  // конёк: у вальмовой — горизонтальная планка, у двускатной — гребешок
  if (ridge > 1) rect(g, cx - ridge, topY, ridge * 2, 2, ramp[3]);
  else rect(g, cx - 1, topY, 2, 2, ramp[3]);
}

/** Кладка: камень или кирпич блоками со швами, а не крапом. */
function masonry(g, x, y, w, h, ramp, bw = 6, bh = 3) {
  rect(g, x, y, w, h, ramp[1]);
  rect(g, x, y, w, 1, ramp[2]);
  for (let ry = 0; ry < h; ry += bh) {
    rect(g, x, y + ry, w, 1, ramp[0]);
    const off = ((ry / bh) | 0) % 2 ? (bw / 2) | 0 : 0;
    for (let bx2 = off; bx2 < w; bx2 += bw) rect(g, x + bx2, y + ry, 1, bh, ramp[0]);
  }
  rect(g, x + w - 1, y, 1, h, ramp[0]);
}

function window4(g, x, y, w, h, frame, lit, pane) {
  rect(g, x - 1, y - 1, w + 2, h + 2, frame[0]);
  rect(g, x, y, w, h, lit ? '#ffcf6a' : (pane || '#2a3550'));
  rect(g, x + (w / 2 | 0), y, 1, h, frame[1]);
  rect(g, x, y + (h / 2 | 0), w, 1, frame[1]);
  rect(g, x - 1, y - 2, w + 2, 1, frame[2]);
  if (lit) glow(g, x + w / 2, y + h / 2, 12, 'rgba(255,190,90,0.35)', 0.9);
}

function building(cfg) {
  const w = cfg.w || 72, h = cfg.h || 74;
  const g = makeCanvas(w, h);
  const wall = cfg.wall || RAMP.bone;
  const roof = cfg.roof || RAMP.crimson;
  const wood = RAMP.wood;
  const beam = cfg.beam || wood;
  const stone = cfg.stone || RAMP.stone;
  const base = h - 2;
  // крыша занимает больше половины высоты — как на референсах
  const rh = cfg.roofH ?? Math.round(h * 0.52);
  const bh = h - rh - 2;
  const bw = w - 6;
  const bx = 3, by = base - bh;

  shadow(g, w / 2, base, w * 0.42, 4, 0.32);

  // ── стены
  if (cfg.wallStyle === 'brick') masonry(g, bx, by, bw, bh, wall, 5, 3);
  else if (cfg.wallStyle === 'stone') masonry(g, bx, by, bw, bh, wall, 7, 4);
  else {
    rect(g, bx, by, bw, bh, wall[1]);
    rect(g, bx, by, bw, 2, wall[2]);
    rect(g, bx + bw - 1, by, 1, bh, wall[0]);
    // фахверк
    for (let i = 0; i <= 3; i++) rect(g, bx + (i * (bw - 2)) / 3, by, 2, bh, beam[1]);
    const mid = by + bh * 0.5;
    rect(g, bx, mid, bw, 2, beam[1]);
    rect(g, bx, mid, bw, 1, beam[2]);
    for (let i = 0; i < 3; i++) {
      const x0 = bx + 2 + i * (bw / 3), x1 = x0 + bw / 3 - 4;
      if (i % 2) { line(g, x0, mid, x1, by + 2, beam[0], 1); }
      else { line(g, x0, by + 2, x1, mid, beam[0], 1); line(g, x0, mid, x1, by + 2, beam[0], 1); }
    }
  }
  // цоколь
  rect(g, bx - 1, base - 3, bw + 2, 3, stone[1]);
  rect(g, bx - 1, base - 3, bw + 2, 1, stone[2]);

  // ── крыша. Три формы, а не одна: вальмовая с горизонтальным коньком,
  // двускатная в точку и крутая двускатная с разлетающимися свесами.
  const over = cfg.overhang ?? 4;
  const half = w / 2 + over - 1;
  shingles(g, w / 2, by - rh, rh, half, roof, {
    ridge: cfg.hip ? half * 0.34 : 0,
    flare: cfg.flare ?? 0,
    step: cfg.shingleStep ?? 3,
    edge: true,
  });
  rect(g, (w / 2) - half - (cfg.flare ?? 0), by - 1, (half + (cfg.flare ?? 0)) * 2, 2, beam[0]);  // карниз
  rect(g, 0, by + 1, w, 1, 'rgba(0,0,0,0.34)');                                                   // тень под свесом

  // ── поперечный фронтон по центру (дом с вальмовой крышей)
  if (cfg.crossGable) {
    const cw = Math.round(w * 0.34), ch2 = Math.round(rh * 0.92);
    const cy3 = by - ch2;
    shingles(g, w / 2, cy3, ch2, cw, roof, { step: cfg.shingleStep ?? 3, edge: true });
    // Ребро — тень, а не блик: выступ отделяется от основного ската именно
    // тёмной линией примыкания, светлая читалась просто царапиной по крыше.
    line(g, w / 2, cy3, w / 2 - cw, by - 1, roof[0], 1);
    line(g, w / 2, cy3, w / 2 + cw, by - 1, roof[0], 1);
    line(g, w / 2 - 1, cy3 + 1, w / 2 - cw + 1, by, 'rgba(0,0,0,0.28)', 1);
    line(g, w / 2 + 1, cy3 + 1, w / 2 + cw - 1, by, 'rgba(0,0,0,0.28)', 1);
  }

  // ── крыльцо с собственным фронтоном над дверью
  if (cfg.porch) {
    const ph = 11, pw2 = 24;
    const py2 = by - ph + 2;
    shingles(g, w / 2, py2, ph, pw2 / 2, roof, { step: 3, scale: 4, edge: true });
    line(g, w / 2, py2, w / 2 - pw2 / 2, py2 + ph - 1, roof[0], 1);
    line(g, w / 2, py2, w / 2 + pw2 / 2, py2 + ph - 1, roof[0], 1);
    rect(g, w / 2 - pw2 / 2, py2 + ph - 1, pw2, 1, beam[0]);
  }

  // ── слуховое окно
  if (cfg.dormer) {
    const dx2 = Math.round(w / 2 - 5), dy2 = by - Math.round(rh * 0.46);
    shingles(g, w / 2, dy2 - 7, 7, 8, roof, { step: 3, scale: 4, edge: true });
    rect(g, dx2, dy2, 10, 9, wall[1]);
    rect(g, dx2, dy2, 10, 1, wall[2]);
    rect(g, dx2, dy2, 1, 9, beam[2]); rect(g, dx2 + 9, dy2, 1, 9, beam[0]);
    window4(g, dx2 + 2, dy2 + 2, 6, 5, beam, cfg.lit);
  }

  // ── труба. Основание обязано лежать НА скате: скат сужается кверху, и
  // труба, поставленная по абсолютной координате, повисала в воздухе сбоку.
  if (cfg.chimney !== false) {
    const k = cfg.chimneyY ?? 0.62;                 // доля высоты крыши сверху вниз
    const cy2 = Math.round(by - rh + rh * k);       // где стоит основание
    const halfHere = (cfg.hip ? half * 0.34 : 0) + (half - (cfg.hip ? half * 0.34 : 0)) * k;
    const dirn = (cfg.chimneyX ?? 0.78) > 0.5 ? 1 : -1;
    const cx2 = Math.round(w / 2 + dirn * (halfHere - 8));
    const ch = Math.round(rh * 0.45) + 5;
    masonry(g, cx2, cy2 - ch, 7, ch, stone, 4, 3);
    rect(g, cx2 - 1, cy2 - ch - 2, 9, 2, stone[2]);
    rect(g, cx2 - 1, cy2 - 1, 9, 1, stone[0]);      // примыкание к кровле
  }

  // ── дверь
  const dw = cfg.doorW ?? 12, dx = Math.round(w / 2 - dw / 2);
  rect(g, dx, base - 16, dw, 16, wood[0]);
  rect(g, dx + 1, base - 15, dw - 2, 15, cfg.doorColor || wood[1]);
  ellipse(g, dx + dw / 2, base - 15, dw / 2 - 1, 3, cfg.doorColor || wood[1]);      // арка
  for (let i = 2; i < dw - 2; i += 3) rect(g, dx + i, base - 13, 1, 13, wood[2]);
  ellipse(g, dx + dw - 4, base - 7, 1.2, 1.2, RAMP.gold[2]);

  // ── окна по сторонам двери
  const wy = cfg.winY ?? by + Math.round(bh * 0.26);
  for (const ox of [bx + 4, bx + bw - 12]) window4(g, ox, wy, 8, 8, beam, cfg.lit);
  if (cfg.winRow2) for (const ox of [bx + 4, bx + bw - 12]) window4(g, ox, wy + 14, 8, 8, beam, cfg.lit);

  // ── вывеска
  if (cfg.sign) {
    const sx = w / 2 + 16, sy = base - 26;
    line(g, w / 2 + 8, sy, sx, sy, wood[1], 1);
    rect(g, sx - 8, sy + 1, 16, 12, wood[1]);
    rect(g, sx - 7, sy + 2, 14, 10, wood[0]);
    cfg.sign(g, sx, sy + 7);
  }
  return finish(g);
}

// иконки на вывесках
const signAnvil = (g, x, y) => {
  rect(g, x - 5, y - 1, 10, 3, RAMP.iron[2]);
  rect(g, x - 2, y + 2, 4, 3, RAMP.iron[1]);
  rect(g, x - 4, y + 4, 8, 2, RAMP.iron[2]);
  rect(g, x - 6, y - 2, 3, 2, RAMP.iron[3]);
};
const signFlask = (g, x, y) => {
  rect(g, x - 1, y - 5, 2, 3, RAMP.bone[3]);
  ellipse(g, x, y + 1, 4, 4, '#7fe0ff');
  ellipse(g, x, y + 2, 3, 3, RAMP.arcane[2]);
  px(g, x - 2, y, '#ffffff');
};
const signSword = (g, x, y) => {
  line(g, x - 4, y + 5, x + 4, y - 5, RAMP.steel[3], 2);
  line(g, x - 3, y - 2, x + 1, y + 2, RAMP.gold[2], 1);
};
const signScroll = (g, x, y) => {
  rect(g, x - 5, y - 5, 10, 10, RAMP.bone[3]);
  rect(g, x - 5, y - 5, 10, 2, RAMP.bone[2]);
  for (let i = 0; i < 3; i++) rect(g, x - 3, y - 1 + i * 2, 6, 1, RAMP.wood[1]);
};

// ─────────────────────────────────────────── прочее

function chest(open) {
  const g = makeCanvas(22, 20);
  const wood = RAMP.wood, gold = RAMP.gold;
  shadow(g, 11, 18, 8, 2.4, 0.3);
  rect(g, 3, 10, 16, 8, wood[1]);
  rect(g, 3, 10, 16, 1, wood[2]);
  rect(g, 3, 16, 16, 2, wood[0]);
  for (let i = 0; i < 3; i++) rect(g, 5 + i * 5, 10, 1, 8, wood[0]);
  if (open) {
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      rect(g, 3 + t * 1, 3 - t * 1, 16 - t * 2, 1, wood[i % 2 ? 1 : 2]);
    }
    rect(g, 4, 8, 14, 3, '#3a2c18');
    for (let i = 0; i < 6; i++) px(g, 5 + i * 2, 9 + (i % 2), gold[2]);
    glow(g, 11, 9, 14, 'rgba(255,200,90,0.4)', 0.9);
  } else {
    ellipse(g, 11, 9, 8, 4.4, wood[1]);
    ellipse(g, 11, 8, 7, 3.2, wood[2]);
    rect(g, 3, 9, 16, 2, gold[1]);
    rect(g, 9, 8, 4, 5, gold[2]);
    px(g, 11, 10, INK);
  }
  rect(g, 2, 9, 1, 9, gold[1]);
  rect(g, 19, 9, 1, 9, gold[1]);
  return finish(g);
}

function torch() {
  const frames = [];
  for (let f = 0; f < 6; f++) {
    const g = makeCanvas(14, 28);
    rect(g, 6, 12, 2, 14, RAMP.wood[1]);
    rect(g, 5, 10, 4, 4, RAMP.iron[1]);
    const t = f / 6;
    const flick = Math.sin(t * TAU) * 1.2;
    ellipse(g, 7, 7 + flick * 0.4, 3.2, 4.4, RAMP.fire[1]);
    ellipse(g, 7, 7 + flick * 0.5, 2.2, 3.2, RAMP.fire[2]);
    ellipse(g, 7, 6.5 + flick * 0.6, 1.2, 2, RAMP.fire[3]);
    px(g, 7, 4 + flick, '#fff6c8');
    frames.push(finish(g));
  }
  return frames;
}

function campfire() {
  const frames = [];
  for (let f = 0; f < 8; f++) {
    const g = makeCanvas(28, 24);
    const t = f / 8;
    shadow(g, 14, 21, 9, 2.6, 0.3);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI + 0.3;
      line(g, 14 - Math.cos(a) * 7, 20, 14 + Math.cos(a) * 7, 17, RAMP.wood[1], 2);
    }
    const fl = Math.sin(t * TAU) * 1.6;
    ellipse(g, 14, 13 + fl * 0.3, 5, 6.5, RAMP.fire[1]);
    ellipse(g, 14, 14 + fl * 0.4, 3.4, 4.6, RAMP.fire[2]);
    ellipse(g, 14 + Math.sin(t * TAU * 2), 13 + fl * 0.5, 1.8, 2.8, RAMP.fire[3]);
    px(g, 14, 9 + fl, '#fff6c8');
    frames.push(finish(g));
  }
  return frames;
}

function portal(ramp) {
  const frames = [];
  for (let f = 0; f < 10; f++) {
    const g = makeCanvas(40, 52);
    const t = f / 10;
    // каменная арка
    for (let i = 0; i < 26; i++) {
      const a = Math.PI + (i / 25) * Math.PI;
      const x = 20 + Math.cos(a) * 15, y = 40 + Math.sin(a) * 30;
      ellipse(g, x, y, 3, 3, RAMP.stone[1]);
      ellipse(g, x - 0.5, y - 0.5, 2, 2, RAMP.stone[2]);
    }
    rect(g, 2, 38, 6, 12, RAMP.stone[1]);
    rect(g, 32, 38, 6, 12, RAMP.stone[1]);
    // вихрь
    for (let i = 0; i < 22; i++) {
      const a = t * TAU + i * 0.55;
      const rr = 1 + (i / 22) * 12;
      const x = 20 + Math.cos(a) * rr, y = 30 + Math.sin(a) * rr * 0.95;
      ellipse(g, x, y, 2.2 - (i / 22) * 1.2, 2.2 - (i / 22) * 1.2, i % 3 ? ramp[2] : ramp[3]);
    }
    ellipse(g, 20, 30, 4, 4, ramp[3]);
    glow(g, 20, 30, 24, rgba(ramp[2], 0.45), 0.95);
    frames.push(finish(g));
  }
  return frames;
}

/** Проклятый алтарь: чаша с тёмным пламенем на ступенчатом постаменте. */
function altar() {
  const frames = [];
  for (let f = 0; f < 8; f++) {
    const g = makeCanvas(30, 34);
    const t = f / 8;
    shadow(g, 15, 32, 11, 3.2, 0.32);
    // постамент
    rect(g, 4, 24, 22, 8, RAMP.stone[1]);
    rect(g, 4, 24, 22, 1, RAMP.stone[3]);
    rect(g, 6, 18, 18, 7, RAMP.stone[1]);
    rect(g, 6, 18, 18, 1, RAMP.stone[2]);
    for (let i = 0; i < 5; i++) px(g, 7 + i * 4, 21 + (i % 2), RAMP.stone[0]);
    // чаша
    ellipse(g, 15, 16, 8, 3.4, RAMP.stone[2]);
    ellipse(g, 15, 16, 6.4, 2.4, '#120a16');
    // тёмное пламя
    const fl = Math.sin(t * TAU) * 1.8;
    ellipse(g, 15, 11 + fl * 0.3, 3.4, 5, RAMP.arcane[1]);
    ellipse(g, 15, 12 + fl * 0.4, 2.2, 3.4, RAMP.arcane[2]);
    ellipse(g, 15 + Math.sin(t * TAU * 2), 11 + fl * 0.5, 1.2, 2, RAMP.crimson[2]);
    px(g, 15, 6 + fl, '#ffb0d0');
    // руны по краю
    for (let i = 0; i < 3; i++) {
      const rx = 8 + i * 7;
      px(g, rx, 20, RAMP.crimson[2]);
      px(g, rx, 22, RAMP.crimson[1]);
    }
    glow(g, 15, 12, 16, 'rgba(200,90,160,0.4)', 0.95);
    frames.push(finish(g));
  }
  return frames;
}

/** Палатка разбойничьего лагеря. */
function tent(cfg) {
  const g = makeCanvas(34, 28);
  const cloth = cfg.cloth || RAMP.leather;
  shadow(g, 17, 26, 12, 3, 0.3);
  // полотнище
  for (let i = 0; i < 18; i++) {
    const t = i / 17;
    const w = 4 + t * 26;
    rect(g, 17 - w / 2, 8 + i, w, 1, i % 4 === 0 ? cloth[0] : cloth[1]);
  }
  // освещённый скат
  for (let i = 0; i < 18; i++) {
    const t = i / 17;
    rect(g, 17 - (4 + t * 26) / 2, 8 + i, (2 + t * 9), 1, cloth[2]);
  }
  // вход
  for (let i = 0; i < 12; i++) {
    const w = 1 + (i / 11) * 8;
    rect(g, 17 - w / 2, 14 + i, w, 1, '#14100c');
  }
  // каркас
  line(g, 17, 6, 17, 26, RAMP.wood[1], 1);
  line(g, 8, 26, 17, 7, RAMP.wood[0], 1);
  line(g, 26, 26, 17, 7, RAMP.wood[0], 1);
  px(g, 17, 5, RAMP.wood[3]);
  return finish(g);
}

/** Обелиск древних: даёт благословение раз на посещение. */
function obelisk() {
  const frames = [];
  for (let f = 0; f < 8; f++) {
    const g = makeCanvas(24, 44);
    const t = f / 8;
    shadow(g, 12, 42, 8, 2.6, 0.32);
    rect(g, 4, 36, 16, 6, RAMP.stone[1]);
    rect(g, 4, 36, 16, 1, RAMP.stone[3]);
    // стела сужается кверху
    for (let i = 0; i < 32; i++) {
      const w = 11 - (i / 31) * 4;
      rect(g, 12 - w / 2, 36 - i, w, 1, RAMP.stone[1]);
      rect(g, 12 - w / 2, 36 - i, Math.max(1, w * 0.34), 1, RAMP.stone[2]);
    }
    // светящиеся руны
    const pulse = 0.55 + Math.sin(t * TAU) * 0.45;
    g.globalAlpha = pulse;
    for (let i = 0; i < 4; i++) {
      const y = 30 - i * 7;
      rect(g, 10, y, 4, 1, RAMP.arcane[3]);
      rect(g, 11, y + 2, 2, 1, RAMP.arcane[2]);
    }
    g.globalAlpha = 1;
    ellipse(g, 12, 5, 2.6, 3, RAMP.arcane[2]);
    ellipse(g, 12, 5, 1.4, 1.8, RAMP.arcane[3]);
    glow(g, 12, 6, 15, rgba(RAMP.arcane[2], 0.4 * pulse), 0.95);
    frames.push(finish(g));
  }
  return frames;
}

/** Полуразрушенная колонна для руин. */
function brokenPillar(cfg) {
  const g = makeCanvas(20, 30);
  const r = makeRng(cfg.seed || 1);
  const ramp = RAMP.stone;
  const h = 12 + r() * 15;
  shadow(g, 10, 28, 7, 2.4, 0.3);
  rect(g, 3, 24, 14, 5, ramp[1]);
  rect(g, 3, 24, 14, 1, ramp[2]);
  for (let i = 0; i < h; i++) {
    const w = 10 - (i / h) * 1.5;
    rect(g, 10 - w / 2, 24 - i, w, 1, ramp[1]);
    rect(g, 10 - w / 2, 24 - i, 3, 1, ramp[2]);
    if (r() < 0.12) px(g, 10 - w / 2 + r() * w, 24 - i, ramp[0]);
  }
  // скол наверху
  for (let i = 0; i < 5; i++) px(g, 6 + i * 2, 24 - h + (r() * 2 | 0), ramp[3]);
  return finish(g);
}

function stairsDown() {
  const g = makeCanvas(34, 30);
  rect(g, 1, 6, 32, 22, RAMP.stone[0]);
  for (let i = 0; i < 5; i++) {
    const y = 8 + i * 4, inset = i * 2;
    rect(g, 2 + inset, y, 30 - inset * 2, 3, RAMP.stone[1 + (i % 2)]);
    rect(g, 2 + inset, y, 30 - inset * 2, 1, RAMP.stone[3]);
  }
  rect(g, 12, 24, 10, 4, '#05040a');
  glow(g, 17, 26, 14, 'rgba(120,90,200,0.3)', 0.8);
  return finish(g);
}

function fountain() {
  const frames = [];
  for (let f = 0; f < 8; f++) {
    const g = makeCanvas(48, 44);
    const t = f / 8;
    shadow(g, 24, 41, 18, 4, 0.3);
    ellipse(g, 24, 34, 20, 8, RAMP.stone[1]);
    ellipse(g, 24, 33, 17, 6.4, RAMP.stone[2]);
    ellipse(g, 24, 33, 15, 5.4, '#2b5f8f');
    ellipse(g, 24, 32.6, 13, 4.4, '#3d84bd');
    for (let i = 0; i < 8; i++) {
      const a = t * TAU + i * 0.8;
      px(g, 24 + Math.cos(a) * 11, 33 + Math.sin(a) * 3.6, '#9fd8f5');
    }
    rect(g, 21, 16, 6, 16, RAMP.stone[1]);
    ellipse(g, 24, 16, 7, 3, RAMP.stone[2]);
    ellipse(g, 24, 15, 5, 2.2, '#3d84bd');
    ellipse(g, 24, 10, 3.4, 3.4, RAMP.stone[2]);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      const rr = 3 + ((t * 8 + i) % 8);
      px(g, 24 + Math.cos(a) * rr, 11 + Math.sin(a) * rr * 0.6 + rr * 0.5, '#b6e6ff');
    }
    frames.push(finish(g));
  }
  return frames;
}

function statue() {
  const g = makeCanvas(28, 46);
  shadow(g, 14, 43, 10, 3, 0.32);
  rect(g, 5, 36, 18, 8, RAMP.stone[1]);
  rect(g, 6, 34, 16, 3, RAMP.stone[2]);
  rect(g, 7, 33, 14, 1, RAMP.stone[3]);
  // фигура
  rect(g, 10, 18, 8, 16, RAMP.bone[2]);
  rect(g, 11, 18, 6, 3, RAMP.bone[3]);
  ellipse(g, 14, 14, 4.4, 4.6, RAMP.bone[2]);
  ellipse(g, 13, 13, 3.2, 3.2, RAMP.bone[3]);
  rect(g, 7, 20, 2, 10, RAMP.bone[1]);
  rect(g, 19, 20, 2, 10, RAMP.bone[1]);
  line(g, 20, 30, 20, 8, RAMP.steel[2], 2);
  line(g, 20, 28, 20, 10, RAMP.steel[3], 1);
  line(g, 17, 12, 23, 12, RAMP.gold[2], 1);
  return finish(g);
}

function barrel() {
  const g = makeCanvas(18, 22);
  shadow(g, 9, 20, 6, 2, 0.28);
  rect(g, 3, 4, 12, 16, RAMP.wood[1]);
  rect(g, 2, 6, 14, 12, RAMP.wood[1]);
  for (let i = 0; i < 4; i++) rect(g, 4 + i * 3, 4, 1, 16, RAMP.wood[0]);
  rect(g, 2, 8, 14, 2, RAMP.iron[2]);
  rect(g, 2, 15, 14, 2, RAMP.iron[2]);
  ellipse(g, 9, 5, 6, 2.2, RAMP.wood[2]);
  return finish(g);
}

function crate() {
  const g = makeCanvas(18, 18);
  shadow(g, 9, 17, 6, 1.8, 0.28);
  rect(g, 2, 3, 14, 14, RAMP.wood[1]);
  rect(g, 2, 3, 14, 2, RAMP.wood[2]);
  rect(g, 2, 3, 2, 14, RAMP.wood[2]);
  line(g, 3, 4, 15, 16, RAMP.wood[0], 1);
  line(g, 15, 4, 3, 16, RAMP.wood[0], 1);
  return finish(g);
}

function tombstone() {
  const g = makeCanvas(18, 22);
  shadow(g, 9, 20, 6, 2, 0.3);
  rect(g, 4, 6, 10, 14, RAMP.stone[1]);
  ellipse(g, 9, 6, 5, 4, RAMP.stone[1]);
  ellipse(g, 8, 5, 3.6, 2.6, RAMP.stone[2]);
  rect(g, 6, 9, 6, 1, RAMP.stone[0]);
  rect(g, 8, 7, 2, 6, RAMP.stone[0]);
  return finish(g);
}

function signpost(cfg) {
  const g = makeCanvas(22, 28);
  shadow(g, 11, 26, 5, 2, 0.28);
  rect(g, 10, 10, 3, 16, RAMP.wood[1]);
  rect(g, 2, 6, 18, 9, RAMP.wood[1]);
  rect(g, 3, 7, 16, 7, RAMP.wood[0]);
  for (let i = 0; i < 3; i++) rect(g, 5, 9 + i * 2, 10 - i * 2, 1, RAMP.bone[2]);
  return finish(g);
}

function anvilProp() {
  const g = makeCanvas(22, 18);
  shadow(g, 11, 17, 7, 2, 0.3);
  rect(g, 4, 4, 14, 4, RAMP.iron[1]);
  rect(g, 4, 4, 14, 1, RAMP.iron[3]);
  rect(g, 1, 5, 4, 2, RAMP.iron[2]);
  rect(g, 8, 8, 6, 5, RAMP.iron[0]);
  rect(g, 5, 13, 12, 3, RAMP.iron[1]);
  return finish(g);
}

function banner(ramp) {
  const g = makeCanvas(16, 34);
  rect(g, 7, 0, 2, 34, RAMP.wood[1]);
  rect(g, 2, 2, 12, 22, ramp[1]);
  rect(g, 2, 2, 12, 2, ramp[2]);
  for (let i = 0; i < 4; i++) rect(g, 2 + i * 3, 24, 2, 4, ramp[1]);
  ellipse(g, 8, 12, 3.4, 4, ramp[3]);
  ellipse(g, 8, 12, 2, 2.6, ramp[0]);
  return finish(g);
}

function pillar(ramp) {
  const g = makeCanvas(20, 42);
  shadow(g, 10, 40, 7, 2.4, 0.3);
  rect(g, 3, 36, 14, 5, ramp[1]);
  rect(g, 5, 6, 10, 31, ramp[1]);
  rect(g, 6, 6, 3, 31, ramp[2]);
  rect(g, 2, 2, 16, 5, ramp[1]);
  rect(g, 2, 2, 16, 2, ramp[2]);
  for (let i = 0; i < 6; i++) rect(g, 5, 10 + i * 5, 10, 1, ramp[0]);
  return finish(g);
}

// ─────────────────────────────────────────── иконки предметов (20×20)
//
// Иконка выросла с 16 до 20 пикселей. Причина не в красоте ради красоты:
// ячейка рюкзака 26×26, и шестнадцатипиксельная картинка тонула в ней с полем
// в пять пикселей по кругу. Двадцать — это в полтора раза больше площади, и в
// них наконец помещается то, на что раньше не хватало места: сужение клинка,
// огранка камня, обмотка рукояти, фаска на доспехе.
//
// Свет во всех иконках один и тот же — сверху слева. Это не мелочь: когда у
// одного предмета блик слева, а у соседнего справа, сетка рюкзака начинает
// рябить, и глаз перестаёт различать вещи по силуэту.

const ICON = 20;

/**
 * Сужающийся клинок. Идём по оси и на каждом шаге кладём поперечный штрих:
 * со стороны света — светлая грань, по центру — тело, с теневой — тёмное ядро.
 * Так из одной линии получается объём, а не палка.
 */
function taper(g, x0, y0, x1, y1, w0, w1, ramp) {
  const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) * 2));
  const dx = (x1 - x0) / n, dy = (y1 - y0) / n;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  for (let i = 0; i <= n; i++) {
    const w = w0 + (w1 - w0) * (i / n);
    const cx = x0 + dx * i, cy = y0 + dy * i;
    for (let s = -w / 2; s <= w / 2; s += 0.4) {
      px(g, cx + nx * s, cy + ny * s, s < -w / 5 ? ramp[3] : s > w / 6 ? ramp[0] : ramp[2]);
    }
  }
}

/**
 * Гранёный камень: ромб, разрезанный по диагонали света. Верхняя левая грань
 * ловит свет, нижняя правая уходит в тень, по краю идёт тёмная кромка — этого
 * хватает, чтобы стекляшка читалась как огранка, а не как цветное пятно.
 */
function facet(g, cx, cy, r, col) {
  cx = Math.round(cx); cy = Math.round(cy); r = Math.max(1, Math.round(r));
  const hi = shade(col, 0.5), lo = shade(col, -0.42), edge = shade(col, -0.68);
  for (let y = -r; y <= r; y++) {
    const w = r - Math.abs(y);
    for (let x = -w; x <= w; x++) {
      px(g, cx + x, cy + y, x + y <= -r * 0.4 ? hi : x + y >= r * 0.5 ? lo : col);
    }
  }
  px(g, cx - r, cy, edge); px(g, cx + r, cy, edge);
  px(g, cx, cy - r, edge); px(g, cx, cy + r, edge);
  if (r >= 2) px(g, cx - 1, cy - 1, '#ffffff');
}

/**
 * Иконка предмета 20×20. Для рун sub — цвет стихии, а форма знака приходит
 * отдельным списком отрезков в сетке 10×10.
 */
export function itemIcon(kind, sub, tier, rarityKey, glyph = null, passive = false) {
  const g = makeCanvas(ICON, ICON);
  const ramp = TIER_RAMP[Math.min(6, tier)];
  const rar = RARITY[rarityKey] || RARITY.common;
  // золото и выше — снаряжение с украшением: золотая гарда, камень в навершии
  const rich = tier >= 4;
  const gemc = rarityKey && rarityKey !== 'common' ? rar.color : RAMP.crimson[2];
  const trim = rich ? RAMP.gold : ramp;

  switch (kind) {
    case 'weapon': {
      if (sub === 'staff') {
        taper(g, 5, 17.5, 13, 7, 2.6, 2.2, RAMP.wood);
        for (let i = 1; i <= 3; i++) {
          const t2 = i / 4;
          px(g, 5 + (13 - 5) * t2, 17.5 + (7 - 17.5) * t2, RAMP.wood[0]);
        }
        // держатели вокруг навершия — из них и растёт шар
        taper(g, 12, 8.4, 15.6, 6.4, 1.6, 1.2, trim);
        taper(g, 11.4, 6.6, 14.6, 3.6, 1.6, 1.2, trim);
        ellipse(g, 14, 5.4, 3.4, 3.4, shade(gemc, -0.6));
        facet(g, 14, 5.4, 2, gemc);
        glow(g, 14, 5.4, 9, rgba(gemc, 0.45), 0.95);
      } else if (sub === 'bow') {
        // плечо лука — дуга влево, тетива прямой хордой
        for (let i = 0; i <= 34; i++) {
          const a = 2.3 + (i / 34) * 1.68;
          const bx = 13.5 + Math.cos(a) * 9.4, by = 10 + Math.sin(a) * 9.4;
          px(g, bx + 2, by, RAMP.wood[0]);
          px(g, bx + 1, by, RAMP.wood[2]);
          px(g, bx, by, RAMP.wood[3]);
        }
        // рога и тетива: тетива тоньше плеча, иначе дуга в ней теряется
        ellipse(g, 7, 3.4, 1.4, 1.2, trim[2]);
        ellipse(g, 7, 16.6, 1.4, 1.2, trim[1]);
        line(g, 7, 4, 7, 16, 'rgba(226,214,180,0.75)', 1);
        // стрела на тетиве
        taper(g, 5.5, 10, 15, 10, 1.8, 1.8, ramp);
        for (let k = 0; k < 4; k++) rect(g, 16 - k, 10 - k, 1, 1 + k * 2, k < 2 ? ramp[3] : ramp[2]);
        for (let k = 0; k < 3; k++) rect(g, 4 + k, 8 + k, 1, 5 - k * 2, RAMP.crimson[2]);
      } else if (sub === 'axe') {
        taper(g, 4.5, 17.5, 13.5, 5.5, 2.8, 2.2, RAMP.wood);
        // полотно — серп: круг минус круг. Вырезаем на отдельном холсте, иначе
        // вместе с полотном стёрлось бы и топорище под ним.
        const hd = makeCanvas(ICON, ICON);
        ellipse(hd, 12.4, 7, 5.2, 5.8, ramp[1]);
        ellipse(hd, 11.6, 7, 4.2, 4.8, ramp[2]);
        hd.save();
        hd.globalCompositeOperation = 'destination-out';
        ellipse(hd, 7.6, 7.4, 4.6, 5.4, '#000');
        hd.restore();
        g.drawImage(hd.canvas, 0, 0);
        for (let i = 0; i <= 20; i++) {
          const a = -1.2 + (i / 20) * 2.4;
          px(g, 12.4 + Math.cos(a) * 5, 7 + Math.sin(a) * 5.6, ramp[3]);
        }
        taper(g, 9.4, 11.4, 12.4, 8.4, 2.4, 2.4, trim);
        if (rich) facet(g, 11, 10, 1, gemc);
      } else if (sub === 'dagger') {
        taper(g, 8, 12.5, 15.5, 5, 3, 0.8, ramp);
        px(g, 15.5, 5, '#fff8dc');
        taper(g, 5.4, 11.6, 9.6, 15.8, 1.8, 1.8, trim);
        taper(g, 7.2, 13.4, 4.8, 15.8, 2.4, 2.2, RAMP.leather);
        ellipse(g, 4.2, 16.4, 1.6, 1.6, trim[1]);
        px(g, 3.6, 15.8, trim[3]);
      } else if (sub === 'spear') {
        taper(g, 3.5, 17.5, 12, 9, 2.4, 2, RAMP.wood);
        for (let i = 1; i <= 2; i++) {
          const t2 = i / 3;
          px(g, 3.5 + 8.5 * t2, 17.5 - 8.5 * t2, RAMP.leather[1]);
        }
        taper(g, 10.8, 10.2, 12.4, 8.6, 2.8, 2.8, trim);     // втулка
        taper(g, 12, 9, 17, 4, 2.8, 0.6, ramp);              // перо
        line(g, 13, 8, 16.2, 4.8, shade(ramp[3], 0.25), 1);  // ребро
        px(g, 17, 4, '#fff8dc');
      } else {
        // меч: клинок, гарда поперёк оси, обмотанная рукоять, навершие
        taper(g, 7, 13, 16.5, 3.5, 3.6, 0.8, ramp);
        px(g, 16.5, 3.5, '#fff8dc');
        line(g, 8, 12, 15, 5, shade(ramp[2], 0.3), 1);       // дол
        taper(g, 6.2, 14, 3.6, 16.6, 2.6, 2.4, RAMP.leather);
        px(g, 5.4, 14.8, RAMP.leather[0]); px(g, 4.6, 15.6, RAMP.leather[0]);
        taper(g, 4.2, 11.8, 9.4, 17, 2.2, 2.2, trim);
        ellipse(g, 3.2, 17.4, 1.7, 1.7, trim[1]);
        px(g, 2.6, 16.8, trim[3]);
        if (rich) facet(g, 6.8, 14.4, 1, gemc);
      }
      break;
    }
    case 'armor': {
      const cx = 10;
      // силуэт задан списком полуширин: так кираса сужается к поясу ровно, а не
      // ступеньками, и её легко подправить, не пересчитывая формулу
      const HW = [6, 6, 6, 6, 6, 6, 6, 6, 5, 5, 4, 4, 3];
      for (let i = 0; i < HW.length; i++) {
        const y = 4 + i, hw = HW[i];
        rect(g, cx - hw, y, hw * 2, 1, ramp[1]);
        rect(g, cx - hw, y, 2, 1, ramp[2]);
        rect(g, cx + hw - 1, y, 1, 1, ramp[0]);
      }
      g.save();
      g.globalCompositeOperation = 'destination-out';
      ellipse(g, cx, 3.4, 2.2, 1.8, '#000');
      g.restore();
      // наплечники: приплюснутые шапки на плечах, а не крылья по бокам
      ellipse(g, 4.2, 5.6, 2.4, 2.2, ramp[2]);
      ellipse(g, 3.8, 5, 1.4, 1, ramp[3]);
      ellipse(g, 15.8, 5.6, 2.4, 2.2, ramp[1]);
      // нагрудная пластина со швом
      rect(g, cx - 3, 7, 6, 5, ramp[2]);
      rect(g, cx - 3, 7, 1, 5, ramp[3]);
      rect(g, cx - 1, 7, 1, 5, ramp[0]);
      px(g, cx - 4, 9, ramp[3]); px(g, cx + 3, 9, ramp[3]);
      // пояс с пряжкой
      rect(g, cx - 5, 12, 10, 2, RAMP.leather[1]);
      rect(g, cx - 5, 12, 10, 1, RAMP.leather[2]);
      rect(g, cx - 2, 12, 4, 2, trim[2]);
      if (rich) facet(g, cx, 13, 1, gemc);
      break;
    }
    case 'helm': {
      ellipse(g, 10, 9, 6.4, 6.6, ramp[1]);
      ellipse(g, 9, 7.4, 5, 4.4, ramp[2]);
      ellipse(g, 7.8, 5.8, 2.8, 2, ramp[3]);
      // забрало
      rect(g, 4, 9, 12, 4, ramp[0]);
      rect(g, 4, 9, 12, 1, ramp[2]);
      rect(g, 5, 10, 4, 2, INK);
      rect(g, 11, 10, 4, 2, INK);
      px(g, 5, 10, shade(gemc, -0.2));
      // переносица и нащёчники
      rect(g, 9, 8, 2, 8, ramp[1]);
      rect(g, 9, 8, 1, 8, ramp[2]);
      rect(g, 4, 13, 3, 3, ramp[1]);
      rect(g, 13, 13, 3, 3, ramp[0]);
      // гребень — только у дорогого снаряжения
      if (rich) {
        for (let i = 0; i < 5; i++) rect(g, 9, 1 + i, 2, 1, RAMP.crimson[1 + (i % 2)]);
        px(g, 9, 1, RAMP.crimson[3]);
      }
      break;
    }
    case 'trinket': {
      if (sub === 'amulet') {
        // цепочка провисает, а не висит прямой палкой
        for (let i = 0; i <= 12; i++) {
          const t2 = i / 12;
          px(g, 4 + t2 * 12, 3 + Math.sin(t2 * Math.PI) * 2.6, i % 2 ? ramp[1] : ramp[3]);
        }
        rect(g, 9, 6, 2, 2, ramp[2]);
        ellipse(g, 10, 12, 4.8, 5, ramp[1]);
        ellipse(g, 10, 11.6, 3.6, 3.8, ramp[2]);
        ellipse(g, 8.4, 10, 1.6, 1.4, ramp[3]);
        facet(g, 10, 12, 2, gemc);
        glow(g, 10, 12, 10, rgba(gemc, 0.4), 0.9);
      } else {
        ellipse(g, 10, 12.5, 5.6, 5, ramp[1]);
        ellipse(g, 10, 12.5, 4.4, 3.8, ramp[2]);
        ellipse(g, 6.6, 11.4, 1.4, 1.6, ramp[3]);
        g.save();
        g.globalCompositeOperation = 'destination-out';
        ellipse(g, 10, 12.6, 3.2, 2.6, '#000');
        g.restore();
        // оправа и камень
        ellipse(g, 10, 5.6, 3.4, 3.2, rich ? RAMP.gold[1] : ramp[1]);
        facet(g, 10, 5.6, 2, gemc);
        glow(g, 10, 5.6, 9, rgba(gemc, 0.45), 0.9);
      }
      break;
    }
    case 'potion': {
      const col = sub === 'mana' ? ['#1a3a8a', '#3a6fe0', '#8fc0ff']
                : sub === 'elixir' ? ['#5a2a8a', '#a04fe0', '#e0a8ff']
                : ['#7a1020', '#d8434b', '#ff9a95'];
      // пробка, горлышко, стекло
      rect(g, 8, 1, 4, 3, RAMP.leather[1]);
      rect(g, 8, 1, 4, 1, RAMP.leather[2]);
      rect(g, 8, 4, 4, 3, '#b9d4e4');
      rect(g, 8, 4, 1, 3, '#e4f2fa');
      rect(g, 7, 6, 6, 2, '#cfe4f0');
      ellipse(g, 10, 12.6, 6, 6, '#cfe4f0');
      ellipse(g, 10, 12.6, 5, 5, shade(col[0], -0.4));
      // жидкость: уровень, тело, осадок
      ellipse(g, 10, 13.4, 4.8, 4.2, col[1]);
      ellipse(g, 10, 14.6, 4, 3, col[0]);
      rect(g, 6, 10, 8, 1, col[2]);
      px(g, 12, 12, col[2]); px(g, 11, 15, col[2]); px(g, 8, 14, col[2]);
      // блик на стекле
      rect(g, 6, 11, 1, 3, '#ffffff');
      px(g, 7, 10, '#ffffff');
      glow(g, 10, 13, 11, rgba(col[2], 0.3), 0.9);
      break;
    }
    case 'material': {
      const cols = {
        ore: RAMP.iron, hide: RAMP.leather, essence: RAMP.arcane, fang: RAMP.bone,
        ember: RAMP.fire, ice: RAMP.ice, herb: RAMP.emerald,
        silver: RAMP.steel, scale: RAMP.crimson, void: RAMP.shadowy,
      };
      const c = cols[sub] || RAMP.stone;
      if (sub === 'essence') {
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * TAU - 1.6;
          ellipse(g, 10 + Math.cos(a) * 4.2, 10.5 + Math.sin(a) * 4.2, 2.8, 2.8, c[1]);
          ellipse(g, 10 + Math.cos(a) * 4.2 - 0.8, 10.5 + Math.sin(a) * 4.2 - 0.8, 1.4, 1.4, c[3]);
        }
        facet(g, 10, 10.5, 3, c[2]);
        glow(g, 10, 10.5, 11, rgba(c[2], 0.42), 0.92);
      } else if (sub === 'scale') {
        // черепицей: нижний ряд кладём первым, верхние перекрывают его кромку
        const one = (sx, sy, r2) => {
          ellipse(g, sx, sy, r2, r2 * 1.05, c[0]);
          ellipse(g, sx, sy - 0.4, r2 - 0.9, r2 * 0.92, c[1]);
          ellipse(g, sx - r2 * 0.3, sy - r2 * 0.4, r2 * 0.48, r2 * 0.42, c[2]);
          px(g, sx - r2 * 0.45, sy - r2 * 0.55, c[3]);
        };
        one(6.5, 14.5, 3.6); one(13.5, 14.5, 3.6);
        one(10, 11, 3.6);
        one(6.5, 7.5, 3.6); one(13.5, 7.5, 3.6);
        one(10, 4, 3.4);
      } else if (sub === 'void') {
        for (let i = 0; i < 4; i++) {
          const a2 = (i / 4) * TAU + 0.4;
          taper(g, 10, 10, 10 + Math.cos(a2) * 7, 10 + Math.sin(a2) * 7, 3, 0.6, c);
        }
        ellipse(g, 10, 10, 3, 3, '#0a0612');
        ellipse(g, 10, 10, 1.4, 1.4, c[3]);
        glow(g, 10, 10, 12, rgba(c[2], 0.5), 0.95);
      } else if (sub === 'silver') {
        for (const [sx, sy, r2] of [[7, 13, 4.6], [13.4, 8.4, 3.8]]) {
          ellipse(g, sx, sy, r2, r2 * 0.82, c[0]);
          ellipse(g, sx, sy - 0.5, r2 - 1, r2 * 0.68, c[1]);
          ellipse(g, sx - r2 * 0.3, sy - r2 * 0.42, r2 * 0.5, r2 * 0.34, c[3]);
          px(g, sx - r2 * 0.5, sy - r2 * 0.55, '#ffffff');
          line(g, sx - r2 + 1, sy + 1, sx + r2 - 1, sy - 0.5, c[0], 1);
        }
      } else if (sub === 'fang') {
        taper(g, 5.5, 3, 8.5, 16, 3.4, 0.6, c);
        taper(g, 13.5, 4, 11.5, 14, 3, 0.6, c);
        px(g, 8.5, 16, '#ffffff');
      } else if (sub === 'herb') {
        taper(g, 10, 18, 10, 6, 1.8, 1.4, RAMP.emerald);
        for (const [lx, ly, tx2, ty2] of [[10, 13, 4, 9], [10, 11, 16, 8], [10, 8, 5.5, 4]]) {
          taper(g, lx, ly, tx2, ty2, 3.2, 0.8, c);
        }
        px(g, 10, 5, '#ffe9a8');
      } else if (sub === 'ember' || sub === 'ice') {
        for (const [ex, ey, r2] of [[7.5, 12.5, 4.4], [13, 9.5, 3.8], [11, 15, 2.6]]) {
          ellipse(g, ex, ey, r2, r2 * 0.9, c[1]);
          facet(g, ex, ey, Math.round(r2 * 0.6), c[2]);
        }
        glow(g, 10, 12, 11, rgba(c[2], 0.35), 0.9);
      } else {
        // самородок и всё прочее: гранёные куски, свет сверху слева
        for (const [ox2, oy2, r2] of [[7.5, 12.5, 4.6], [13, 9, 3.8], [11.5, 15, 2.8]]) {
          ellipse(g, ox2, oy2, r2, r2 * 0.86, c[1]);
          ellipse(g, ox2 - r2 * 0.25, oy2 - r2 * 0.3, r2 * 0.6, r2 * 0.5, c[2]);
          px(g, ox2 - r2 * 0.5, oy2 - r2 * 0.55, c[3]);
        }
      }
      break;
    }
    case 'coin': {
      // столбик монет: одна монета читается как «мелочь», три — как деньги
      for (let i = 0; i < 3; i++) {
        const cy2 = 15 - i * 3;
        ellipse(g, 10, cy2, 6, 2.8, RAMP.gold[0]);
        ellipse(g, 10, cy2 - 0.6, 5.6, 2.4, RAMP.gold[1]);
      }
      ellipse(g, 10, 6, 5.8, 2.6, RAMP.gold[2]);
      ellipse(g, 10, 5.6, 4.4, 1.8, RAMP.gold[3]);
      rect(g, 9, 5, 2, 2, RAMP.gold[1]);
      px(g, 6, 5, '#fff8dc');
      break;
    }
    case 'key': {
      ellipse(g, 6, 6, 4.2, 4.2, RAMP.gold[1]);
      ellipse(g, 6, 6, 3, 3, RAMP.gold[2]);
      px(g, 4, 4, '#fff8dc');
      g.save();
      g.globalCompositeOperation = 'destination-out';
      ellipse(g, 6, 6, 1.8, 1.8, '#000');
      g.restore();
      taper(g, 7.6, 8.2, 15, 15.6, 2.4, 2.4, RAMP.gold);
      rect(g, 13, 15, 4, 1, RAMP.gold[3]);
      rect(g, 11, 13, 1, 4, RAMP.gold[3]);
      break;
    }
    case 'rune': {
      // каменная табличка со сколотым краем, знак горит изнутри
      const st = passive ? RAMP.bone : RAMP.stone;
      box(g, 3, 2, 14, 16, st[0], 2);
      box(g, 4, 3, 12, 14, st[2], 2);
      box(g, 5, 4, 10, 12, st[0], 1);
      rect(g, 4, 3, 11, 1, st[3]);
      rect(g, 4, 3, 1, 13, st[3]);
      rect(g, 15, 4, 1, 13, st[1]);
      if (glyph) {
        for (const [x1, y1, x2, y2] of glyph) {
          line(g, 5 + x1, 4.4 + y1 * 1.2, 5 + x2, 4.4 + y2 * 1.2, sub, 1);
        }
      }
      glow(g, 10, 10, 12, rgba(sub, 0.42), 0.95);
      break;
    }
    case 'scroll': {
      rect(g, 5, 3, 10, 14, RAMP.bone[3]);
      rect(g, 5, 3, 1, 14, RAMP.bone[2]);
      rect(g, 14, 3, 1, 14, RAMP.bone[1]);
      for (let i = 0; i < 4; i++) rect(g, 7, 7 + i * 2, i % 2 ? 4 : 6, 1, RAMP.wood[1]);
      // валики сверху и снизу
      rect(g, 3, 2, 14, 3, RAMP.wood[1]);
      rect(g, 3, 2, 14, 1, RAMP.wood[3]);
      rect(g, 3, 15, 14, 3, RAMP.wood[1]);
      rect(g, 3, 15, 14, 1, RAMP.wood[2]);
      // сургучная печать
      ellipse(g, 15, 11, 2.4, 2.4, RAMP.crimson[1]);
      ellipse(g, 14.6, 10.6, 1.4, 1.4, RAMP.crimson[2]);
      break;
    }
  }
  return finish(g, 0.5);
}

// ─────────────────────────────────────────── сборка всей библиотеки

/** Слегка сдвигает рампу по тону — чтобы соседние деревья не были клонами. */
function tint(ramp, k) {
  return ramp.map((c, i) => shade(c, (k - 0.5) * 0.22 + (i === 3 ? 0.04 : 0)));
}

export function initProps() {
  const N = (n, f) => Array.from({ length: n }, (_, i) => f(i));

  // деревья по биомам — по 6 вариантов разного размера и оттенка
  PROPS.treeOak = N(6, (s) => tree({
    seed: 20 + s, leaf: tint(RAMP.emerald, s / 5), w: 34 + s * 4, h: 44 + s * 6,
    blobs: 6 + (s % 3), trunkW: 5 + (s % 3), fruit: s === 4 ? '#e05a5a' : null,
  }));
  PROPS.treeOakBig = N(3, (s) => tree({
    seed: 41 + s, leaf: tint(RAMP.emerald, 0.3 + s * 0.25), w: 54 + s * 6, h: 66 + s * 8,
    blobs: 9, trunkW: 8, fruit: '#e05a5a',
  }));
  PROPS.treeSwamp = N(5, (s) => tree({
    seed: 60 + s, leaf: tint(RAMP.poison, s / 4), trunk: ['#1a1208', '#2e2113', '#463421', '#5f4a2f'],
    w: 40 + s * 4, h: 50 + s * 5, blobs: 5 + (s % 3),
  }));
  PROPS.treeDead = N(4, (s) => tree({
    seed: 80 + s, shape: 'dead', trunk: ['#1a1520', '#2e2635', '#463c50', '#5f5468'],
    w: 30 + s * 4, h: 40 + s * 6,
  }));
  PROPS.treePine = N(5, (s) => tree({
    seed: 100 + s, shape: 'pine', leaf: tint(['#0d2e2a', '#12463c', '#1c6b52', '#2f9670'], s / 4),
    trunk: RAMP.wood, w: 34 + s * 3, h: 54 + s * 6,
  }));
  PROPS.treeFrost = N(5, (s) => tree({
    seed: 120 + s, shape: 'pine', leaf: tint(['#153048', '#1f4d6b', '#2f7396', '#8fc8e0'], s / 4),
    trunk: ['#231d28', '#392f3f', '#4f4356', '#6a5c72'], w: 34 + s * 3, h: 52 + s * 6,
  }));
  PROPS.treeMushroom = N(4, (s) => tree({
    seed: 140 + s, shape: 'mushroom', leaf: tint(RAMP.crimson, s / 3), trunk: RAMP.bone,
    w: 28 + s * 5, h: 34 + s * 5, trunkH: 14 + s * 2,
  }));
  PROPS.treeCharred = N(4, (s) => tree({
    seed: 160 + s, shape: 'dead', trunk: ['#140d0d', '#251717', '#3a2320', '#4d302a'],
    w: 28 + s * 4, h: 38 + s * 5,
  }));

  // ── Пролом: место, где Бездна вышла наружу
  //
  // Деревья здесь не сгорели и не засохли — их выбелило. Поэтому «мёртвая»
  // форма, но ствол бледный, а не обугленный: биом должен читаться не как
  // вторая пустошь, а как своё.
  PROPS.treePale = N(4, (s) => tree({
    seed: 180 + s, shape: 'dead', trunk: RAMP.pale,
    w: 30 + s * 4, h: 44 + s * 6,
  }));
  PROPS.treeRift = N(3, (s) => tree({
    seed: 190 + s, shape: 'dead', trunk: ['#1c1428', '#2f2140', '#463059', '#5f4275'],
    w: 26 + s * 5, h: 50 + s * 7,
  }));

  PROPS.rock = N(5, (s) => rock({ seed: 200 + s, w: 22 + s * 3, h: 17 + s * 2, chunks: 2 + (s % 3) }));
  PROPS.rockBig = N(3, (s) => rock({ seed: 210 + s, w: 38 + s * 5, h: 28 + s * 4, chunks: 4 }));
  PROPS.rockIce = N(3, (s) => rock({ seed: 220 + s, ramp: RAMP.ice, w: 26 + s * 3, h: 20 + s * 3, crystal: RAMP.ice }));
  PROPS.rockEmber = N(3, (s) => rock({ seed: 240 + s, ramp: ['#1c1114', '#2e1c1c', '#452824', '#5c352c'], w: 26 + s * 3, h: 20 + s * 3, crystal: RAMP.fire }));
  PROPS.crystal = N(3, (s) => rock({ seed: 260 + s, ramp: RAMP.shadowy, w: 22 + s * 3, h: 22 + s * 3, crystal: RAMP.arcane }));
  // Осколки самого Пролома: камень выбеленный, а жила в нём — пустота.
  PROPS.rockPale = N(3, (s) => rock({ seed: 270 + s, ramp: RAMP.pale, w: 26 + s * 4, h: 20 + s * 3, crystal: RAMP.voidRift }));
  PROPS.shardVoid = N(4, (s) => rock({ seed: 280 + s, ramp: ['#140d1e', '#241734', '#38254e', '#4d3468'], w: 18 + s * 3, h: 24 + s * 4, crystal: RAMP.voidRift }));

  PROPS.bush = N(4, (s) => bush({ seed: 300 + s, leaf: tint(RAMP.emerald, s / 3), berry: s % 2 ? '#e05a7a' : null, w: 18 + s * 3, h: 13 + s * 2 }));
  PROPS.bushSwamp = N(3, (s) => bush({ seed: 320 + s, leaf: tint(RAMP.poison, s / 2), w: 18 + s * 3, h: 13 + s * 2 }));
  PROPS.bushFrost = N(3, (s) => bush({ seed: 340 + s, leaf: tint(['#1a3550', '#274d6e', '#3d7396', '#a8d8ee'], s / 2), w: 18 + s * 3, h: 13 + s * 2 }));

  // трава и мелкая деталировка земли — то, что оживляет пустые пятна
  PROPS.grass = N(6, (s) => grassTuft({
    seed: 400 + s, ramp: tint(['#1e3a1c', '#2e5628', '#3f7336', '#569145'], s / 5),
    w: 9 + (s % 3) * 2, h: 6 + (s % 4),
    blades: 4 + (s % 3), flower: s === 2 ? '#e8d45a' : s === 5 ? '#d86a8a' : null,
  }));
  PROPS.grassSwamp = N(4, (s) => grassTuft({ seed: 420 + s, ramp: tint(RAMP.poison, s / 3), w: 9 + s, h: 6 + s, blades: 4 + (s % 3) }));
  PROPS.grassFrost = N(3, (s) => grassTuft({ seed: 440 + s, ramp: ['#39536a', '#4a6a86', '#5f849e', '#87a8c0'], w: 9 + s, h: 5 + s, blades: 3 + s }));
  PROPS.grassEmber = N(3, (s) => grassTuft({ seed: 460 + s, ramp: ['#331912', '#472317', '#5c301b', '#754322'], w: 9 + s, h: 5 + s, blades: 3 + s }));
  PROPS.grassPale = N(3, (s) => grassTuft({ seed: 480 + s, ramp: ['#38343f', '#514c5c', '#6d6779', '#918a9e'], w: 9 + s, h: 5 + s, blades: 3 + s }));

  PROPS.detail = N(4, (s) => groundDetail({ seed: 500 + s, kind: 'pebble', w: 12 + s * 2, h: 7 + (s % 2) }));
  PROPS.detailCrack = N(3, (s) => groundDetail({ seed: 520 + s, kind: 'crack', w: 16 + s * 3, h: 8 }));
  PROPS.detailBone = N(2, (s) => groundDetail({ seed: 540 + s, kind: 'bone', w: 14 + s * 3, h: 9 }));
  PROPS.detailRoot = N(3, (s) => groundDetail({ seed: 560 + s, kind: 'root', ramp: RAMP.wood, w: 16 + s * 4, h: 8 }));

  PROPS.chest = chest(false);
  PROPS.chestOpen = chest(true);
  PROPS.torch = torch();
  PROPS.campfire = campfire();
  PROPS.stairs = stairsDown();
  PROPS.altar = altar();
  PROPS.obelisk = obelisk();
  PROPS.tent = N(3, (s) => tent({ cloth: s === 0 ? RAMP.leather : s === 1 ? RAMP.crimson : RAMP.emerald }));
  PROPS.brokenPillar = N(4, (s) => brokenPillar({ seed: 700 + s }));
  PROPS.fountain = fountain();
  PROPS.statue = statue();
  PROPS.barrel = barrel();
  PROPS.crate = crate();
  PROPS.tomb = tombstone();
  PROPS.sign = signpost();
  PROPS.anvil = anvilProp();
  PROPS.pillar = pillar(RAMP.stone);
  PROPS.pillarBone = pillar(RAMP.bone);
  PROPS.banner = banner(RAMP.crimson);
  PROPS.bannerBlue = banner(RAMP.steel);

  PROPS.portalCity = portal(RAMP.gold);
  PROPS.portalForest = portal(RAMP.emerald);
  PROPS.portalSwamp = portal(RAMP.poison);
  PROPS.portalFrost = portal(RAMP.ice);
  PROPS.portalEmber = portal(RAMP.fire);
  PROPS.portalBreach = portal(RAMP.voidRift);
  PROPS.portalDungeon = portal(RAMP.arcane);

  PROPS.smithy   = building({ w: 78, h: 78, roof: RAMP.crimson, wall: RAMP.bone, lit: true, sign: signAnvil });
  PROPS.alchemy  = building({ w: 70, h: 82, roof: RAMP.arcane, wall: ['#3a3550', '#4d4668', '#6b6288', '#8f86ab'], lit: true, sign: signFlask, bodyH: 44 });
  PROPS.armory   = building({ w: 76, h: 76, roof: RAMP.steel, wall: RAMP.bone, lit: true, sign: signSword });
  PROPS.guild    = building({ w: 86, h: 86, roof: RAMP.gold, wall: ['#4a4436', '#6b6250', '#8a8067', '#b0a68a'], lit: true, sign: signScroll, bodyH: 48 });
  // Три дома по присланным референсам. Отличаются не только цветом: кладка,
  // форма крыши, крыльцо и слуховое окно дают разные силуэты.
  const BRICK  = ['#4a2820', '#77413a', '#9c5c50', '#c08172'];
  const PALE   = ['#6e685a', '#a9a294', '#cdc7b6', '#e8e2d2'];
  const MINT   = ['#2c6a60', '#419287', '#63b9ac', '#9adcd0'];
  const NAVY   = ['#1b2740', '#2c3f63', '#42598a', '#6b83b8'];
  const TERRA  = ['#5a2f1c', '#8c4c2c', '#b56f45', '#d99a6c'];
  const BROWN  = ['#4a2c1c', '#70452a', '#98653f', '#c08f61'];
  PROPS.house = [
    // 1 — кирпичный: двускатная крыша, отдельный фронтон крыльца над дверью
    { w: 66, h: 78, roof: NAVY, wall: BRICK, wallStyle: 'brick', stone: RAMP.stone,
      beam: PALE, porch: true, winRow2: true, chimneyX: 0.8, chimneyY: 0.5,
      doorColor: '#5a3a24', roofH: 40 },
    // 2 — каменный: вальмовая крыша с горизонтальным коньком и поперечным фронтоном
    { w: 74, h: 74, roof: TERRA, wall: PALE, wallStyle: 'stone', stone: PALE,
      beam: ['#3a4a3e', '#5f7a63', '#87a48c', '#c8dccb'], hip: true, crossGable: true,
      winRow2: true, chimneyX: 0.86, chimneyY: 0.55, roofH: 34, doorColor: '#6d452a' },
    // 3 — фахверк: очень крутая крыша с разлетающимися свесами и слуховым окном
    { w: 60, h: 82, roof: BROWN, wall: MINT, beam: ['#8a8878', '#c6c2ad', '#e4e0cc', '#f6f3e6'],
      stone: RAMP.stone, dormer: true, chimney: false, flare: 5, overhang: 2,
      doorColor: '#2f7a6d', roofH: 46 },
  ].map((c) => building({ lit: true, ...c }));

  return PROPS;
}
