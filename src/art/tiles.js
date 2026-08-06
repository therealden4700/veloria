// Тайлсеты биомов и запекание карты в один большой канвас.
// Ключевой приём: шум генерируется не по одной клетке, а блоком 5×5 тайлов.
// Тайлы берутся из этого блока по (x%5, y%5) — рисунок перетекает через границы,
// и сетка 16×16 перестаёт бросаться в глаза.

import { makeCanvas, rect, px, ellipse, line, dither, glow, ditherEdge } from './pixel.js';
import { RAMP, INK, rgba, mix, shade, hex2rgb } from './palette.js';
import { fbm, worley, warpFbm, makeRng, hashStr, hash2 } from '../core/rng.js';
import { clamp, TAU } from '../core/util.js';

export const TILE = 16;
const BLOCK = 5;                 // земля: блок 5×5 тайлов
const SHEET = TILE * BLOCK;      // 80×80
const WBLOCK = 8;                // скалы лежат большими массивами — им нужен блок побольше
const WSHEET = TILE * WBLOCK;    // 128×128

export const T = {
  GROUND: 0,
  GROUND2: 1,
  PATH: 2,
  LIQUID: 3,
  WALL: 4,
  FLOOR: 5,
  VOID: 6,
};

export const SOLID = new Set([T.WALL, T.LIQUID, T.VOID]);

/** Быстрая заливка листа по попиксельной функции цвета (индекс рампы). */
function makeSheet(ramp, pick, size = SHEET) {
  const g = makeCanvas(size, size);
  const img = g.createImageData(size, size);
  const d = img.data;
  const rgb = ramp.map(hex2rgb);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = pick(x, y);
      const c = rgb[clamp(i | 0, 0, rgb.length - 1)];
      const o = (y * size + x) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return g;
}

/** Лист вместе с числом тайлов в блоке — по нему считается смещение при укладке. */
const sheet = (canvas, n) => ({ c: canvas, n });

function groundSheet(cfg, ramp, seed, opts = {}) {
  // частота высокая намеренно: крупные пятна внутри листа заметно повторялись бы
  // каждые 5 тайлов. Большой масштаб даёт отдельный слой macro поверх всей карты.
  const g = makeSheet(ramp, (x, y) => {
    const n = fbm(x * 0.19, y * 0.19, seed, 3) * 0.62 +
              fbm(x * 0.52, y * 0.52, seed + 31, 2) * 0.38;
    return n < 0.40 ? 0 : n < 0.53 ? 1 : n < 0.70 ? 2 : 3;
  });
  // травинки / камешки — мелкая деталь поверх
  const r = makeRng(seed * 977 + 11);
  if (opts.blades) {
    for (let i = 0; i < opts.blades * BLOCK * BLOCK; i++) {
      const x = (r() * SHEET) | 0, y = (r() * SHEET) | 0;
      const h = 1 + ((r() * 2) | 0);
      for (let j = 0; j < h; j++) px(g, x, (y - j + SHEET) % SHEET, ramp[3]);
    }
  }
  if (opts.speck) {
    for (let i = 0; i < opts.speck * BLOCK * BLOCK; i++) {
      px(g, (r() * SHEET) | 0, (r() * SHEET) | 0, opts.speckColor || ramp[0]);
    }
  }
  if (opts.flowers) {
    for (let i = 0; i < 14; i++) {
      const x = (r() * SHEET) | 0, y = (r() * SHEET) | 0;
      const c = opts.flowers[(r() * opts.flowers.length) | 0];
      px(g, x, y, c);
      if (r() < 0.5) px(g, x + 1, y, c);
    }
  }
  return sheet(g.canvas, BLOCK);
}

/**
 * Мостовая: клеточный шум даёт неровные камни, а разница до второй ближайшей
 * точки — шов между ними. Ровно то, чего не хватало площади и полам подземелья.
 */
function cobbleSheet(ramp, seed, cell = 0.17, jointW = 0.13) {
  return sheet(makeSheet(ramp, (x, y) => {
    const fx = x * cell, fy = y * cell;
    const xi = Math.floor(fx), yi = Math.floor(fy);
    let d1 = 9, d2 = 9, id = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const cx = xi + ox, cy = yi + oy;
        const pxx = cx + 0.15 + hash2(cx, cy, seed) * 0.7;
        const pyy = cy + 0.15 + hash2(cx, cy, seed + 7919) * 0.7;
        const d = Math.hypot(pxx - fx, pyy - fy);
        if (d < d1) { d2 = d1; d1 = d; id = (cx * 73 + cy * 151) & 255; }
        else if (d < d2) d2 = d;
      }
    }
    if (d2 - d1 < jointW) return 0;                       // шов
    const tone = 1 + (id % 3 === 0 ? 1 : 0);              // разнобой камней
    const wear = fbm(x * 0.5, y * 0.5, seed + 11, 2);     // мелкая шероховатость
    return clamp(tone + (wear > 0.62 ? 1 : wear < 0.36 ? -1 : 0), 0, 3);
  }).canvas, BLOCK);
}

function wallSheet(cfg) {
  const ramp = cfg.wall;
  if (cfg.wallStyle === 'brick') {
    const g = makeCanvas(WSHEET, WSHEET);
    const r = makeRng((cfg.seed || 2) * 131);
    rect(g, 0, 0, WSHEET, WSHEET, ramp[0]);
    for (let row = 0; row < WSHEET / 5; row++) {
      const off = row % 2 ? 5 : 0;
      for (let c = -1; c < WSHEET / 10 + 1; c++) {
        const bx = c * 10 + off, by = row * 5;
        const tone = 1 + ((r() * 2.4) | 0);
        rect(g, bx + 1, by + 1, 8, 3, ramp[clamp(tone, 1, 3)]);
        rect(g, bx + 1, by + 1, 8, 1, ramp[3]);
      }
    }
    return sheet(g.canvas, WBLOCK);
  }
  return sheet(makeSheet(ramp, (x, y) => {
    const w = worley(x * 0.075, y * 0.075, cfg.seed || 2);
    const n = fbm(x * 0.17, y * 0.17, (cfg.seed || 2) + 7, 3);
    const v = w * 0.55 + n * 0.45;
    return v < 0.28 ? 0 : v < 0.46 ? 1 : v < 0.66 ? 2 : 3;
  }, WSHEET).canvas, WBLOCK);
}

function liquidSheet(cfg, frame) {
  const ramp = cfg.liquid;
  const t = frame / 4;
  return sheet(makeSheet(ramp, (x, y) => {
    const n = fbm(x * 0.075 + t * 1.2, y * 0.075 - t * 0.5, 55, 3);
    return n < 0.44 ? 0 : n < 0.60 ? 1 : n < 0.80 ? 2 : 3;
  }).canvas, BLOCK);
}

export function buildTileset(cfg) {
  const seed = cfg.seed || 1;
  const ground = groundSheet(cfg, cfg.ramp, seed, {
    blades: cfg.blades, speck: cfg.speck, speckColor: cfg.speckColor, flowers: cfg.flowers,
  });
  const ground2 = cfg.ground2Style === 'cobble'
    ? cobbleSheet(cfg.ramp2 || cfg.ramp, seed + 40, 0.11, 0.11)
    : groundSheet(cfg, cfg.ramp2 || cfg.ramp, seed + 40, { speck: 3 });
  const path = cfg.pathStyle === 'cobble'
    ? cobbleSheet(cfg.path || RAMP.stone, seed + 80, 0.19, 0.15)
    : groundSheet(cfg, cfg.path || RAMP.stone, seed + 80, { speck: 5 });
  const edges = (s) => [0, 1, 2, 3].map((d) => sheet(ditherEdge(s.c, d, TILE), s.n));
  return {
    cfg, ground, ground2, path,
    // растушёвка стыков: по одному листу на каждую грань тайла
    edge: { [T.GROUND]: edges(ground), [T.GROUND2]: edges(ground2), [T.PATH]: edges(path) },
    wall: wallSheet(cfg),
    liquid: [0, 1, 2, 3].map((f) => liquidSheet(cfg, f)),
  };
}

const blitTile = (g, s, tx, ty, dx, dy) => {
  const n = s.n || BLOCK;
  g.drawImage(s.c, (tx % n) * TILE, (ty % n) * TILE, TILE, TILE, dx, dy, TILE, TILE);
};

/**
 * Запекает статический слой карты в один канвас.
 * Возвращает { canvas, liquidTiles } — координаты жидкости для анимации бликов.
 */
export function renderZoneCanvas(zone, ts) {
  const g = makeCanvas(zone.w * TILE, zone.h * TILE);
  const cfg = ts.cfg;
  const at = (x, y) => (x < 0 || y < 0 || x >= zone.w || y >= zone.h ? T.WALL : zone.tiles[y * zone.w + x]);
  const liquidTiles = [];

  rect(g, 0, 0, zone.w * TILE, zone.h * TILE, cfg.void || '#07060d');

  for (let y = 0; y < zone.h; y++) {
    for (let x = 0; x < zone.w; x++) {
      const t = zone.tiles[y * zone.w + x];
      if (t === T.VOID) continue;
      const dx = x * TILE, dy = y * TILE;
      if (t === T.LIQUID) {
        blitTile(g, ts.liquid[0], x, y, dx, dy);
        liquidTiles.push(x, y);
      } else if (t === T.WALL) {
        blitTile(g, ts.wall, x, y, dx, dy);
      } else {
        blitTile(g, t === T.PATH ? ts.path : t === T.GROUND2 ? ts.ground2 : ts.ground, x, y, dx, dy);
      }
    }
  }

  // ── растушёвка стыков: земля соседа «заползает» на клетку вдоль общей грани
  const NB = [[0, -1, 0], [0, 1, 1], [-1, 0, 2], [1, 0, 3]];  // dx, dy, сторона
  for (let y = 0; y < zone.h; y++) {
    for (let x = 0; x < zone.w; x++) {
      const t = at(x, y);
      if (t === T.WALL || t === T.VOID || t === T.LIQUID) continue;
      const dx = x * TILE, dy = y * TILE;
      for (const [ox, oy, side] of NB) {
        const n = at(x + ox, y + oy);
        if (n === t) continue;
        const sheets = ts.edge[n];
        if (sheets) blitTile(g, sheets[side], x, y, dx, dy);
      }
    }
  }

  // ── кромки: берег, край дороги, скос скалы
  for (let y = 0; y < zone.h; y++) {
    for (let x = 0; x < zone.w; x++) {
      const t = at(x, y);
      const dx = x * TILE, dy = y * TILE;

      if (t !== T.LIQUID && t !== T.WALL && t !== T.VOID) {
        const shore = cfg.shore || RAMP.bone[2];
        if (at(x, y + 1) === T.LIQUID) { rect(g, dx, dy + TILE - 3, TILE, 3, shore); rect(g, dx, dy + TILE - 3, TILE, 1, shade(shore, 0.2)); }
        if (at(x, y - 1) === T.LIQUID) rect(g, dx, dy, TILE, 2, shore);
        if (at(x - 1, y) === T.LIQUID) rect(g, dx, dy, 2, TILE, shore);
        if (at(x + 1, y) === T.LIQUID) rect(g, dx + TILE - 2, dy, 2, TILE, shore);
      }

      if (t === T.WALL) {
        const wr = cfg.wall;
        if (at(x, y - 1) !== T.WALL) {
          rect(g, dx, dy, TILE, 2, wr[3]);
          rect(g, dx, dy + 2, TILE, 1, wr[2]);
        }
        if (at(x, y + 1) !== T.WALL && at(x, y + 1) !== T.VOID) {
          rect(g, dx, dy + TILE - 6, TILE, 6, wr[0]);
          rect(g, dx, dy + TILE - 6, TILE, 1, wr[1]);
          for (let i = 0; i < 5; i++) px(g, dx + ((i * 5 + x * 3) % TILE), dy + TILE - 5 + (i % 4), wr[1]);
          g.globalAlpha = 0.3;
          rect(g, dx, dy + TILE, TILE, 5, '#000000');
          g.globalAlpha = 0.14;
          rect(g, dx, dy + TILE + 5, TILE, 3, '#000000');
          g.globalAlpha = 1;
        }
        if (at(x - 1, y) !== T.WALL) rect(g, dx, dy, 1, TILE, wr[0]);
        if (at(x + 1, y) !== T.WALL) rect(g, dx + TILE - 1, dy, 1, TILE, wr[0]);
      }

    }
  }

  // ── макро-освещённость: крупные мягкие пятна света и тени поверх всей карты.
  // Именно это убирает ощущение равномерного «коврика» под ногами.
  // 2 пикселя на тайл; шум с искажением области, иначе решётка value-noise
  // читается как прямоугольные блоки на всю карту
  const mw = zone.w * 2, mh = zone.h * 2;
  const macro = makeCanvas(mw, mh);
  const mimg = macro.createImageData(mw, mh);
  const ms = (cfg.seed || 1) + 611;
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const n = warpFbm(x * 0.045, y * 0.045, ms, 4, 1.4);
      const v = clamp(128 + (n - 0.5) * 168, 84, 182) | 0;
      const o = (y * mw + x) * 4;
      mimg.data[o] = v; mimg.data[o + 1] = v; mimg.data[o + 2] = v; mimg.data[o + 3] = 255;
    }
  }
  macro.putImageData(mimg, 0, 0);
  g.save();
  g.imageSmoothingEnabled = true;
  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = cfg.macro ?? 0.5;
  g.drawImage(macro.canvas, 0, 0, zone.w * TILE, zone.h * TILE);
  g.restore();
  g.globalCompositeOperation = 'source-over';

  return { canvas: g.canvas, liquidTiles };
}

/** Анимированный блеск воды/лавы поверх статического слоя (только видимое). */
export function drawLiquidShimmer(g, zone, cam, ts, time) {
  if (!zone.liquidTiles || !zone.liquidTiles.length) return;
  const cfg = ts.cfg;
  const ramp = cfg.liquid;
  const x0 = Math.floor(cam.x / TILE) - 1, x1 = Math.ceil((cam.x + cam.w) / TILE) + 1;
  const y0 = Math.floor(cam.y / TILE) - 1, y1 = Math.ceil((cam.y + cam.h) / TILE) + 1;
  const L = zone.liquidTiles;
  g.save();
  for (let i = 0; i < L.length; i += 2) {
    const tx = L[i], ty = L[i + 1];
    if (tx < x0 || tx > x1 || ty < y0 || ty > y1) continue;
    const sx = tx * TILE - cam.x, sy = ty * TILE - cam.y;
    const ph = tx * 3 + ty * 7;
    for (let k = 0; k < 3; k++) {
      const w = 3 + Math.sin(time * 1.6 + ph + k * 2) * 2.5;
      const yy = (k * 5 + ph) % TILE;
      const xx = 3 + ((Math.sin(time * 0.9 + ph * 0.3 + k) * 4 + 4) | 0);
      g.globalAlpha = 0.5 + Math.sin(time * 2 + ph + k) * 0.25;
      g.fillStyle = ramp[3];
      g.fillRect((sx + xx) | 0, (sy + yy) | 0, Math.max(1, w | 0), 1);
    }
    if (cfg.liquidGlow) {
      g.globalAlpha = 0.18 + Math.sin(time * 1.3 + ph) * 0.07;
      g.fillStyle = cfg.liquidGlow;
      g.fillRect(sx, sy, TILE, TILE);
    }
    // ── глубина
    //
    // Пруд был всюду одного цвета и оттого читался лужей краски. Клетки, у
    // которых все четыре соседа — вода, темнеют: у воды появляется дно, а у
    // берега — мель. Считается по соседям на месте: клеток жидкости в зоне
    // шесть десятков, заводить ради этого предрасчёт незачем.
    const nU = zone.at(tx, ty - 1) === T.LIQUID, nD = zone.at(tx, ty + 1) === T.LIQUID;
    const nL = zone.at(tx - 1, ty) === T.LIQUID, nR = zone.at(tx + 1, ty) === T.LIQUID;
    const deep = nU && nD && nL && nR;
    if (deep) {
      g.globalAlpha = 0.30;
      g.fillStyle = ramp[0];
      g.fillRect(sx, sy, TILE, TILE);
    }

    // ── пена по всем берегам, а не только по верхнему
    //
    // Раньше полоска бежала только там, где земля сверху: пруд выглядел
    // обрезанным по трём сторонам из четырёх. Кромка — это то, по чему глаз
    // читает, где кончается вода.
    // Пена штрихами, а не сплошной линией.
    //
    // Сплошная полоса во всю клетку складывалась с соседними в непрерывный
    // контур, и пруд получал обводку: не берег, а ступенчатый прямоугольник
    // вокруг воды. Здесь на каждую сторону приходится по два коротких штриха со
    // своей фазой — кромка рвётся, и глаз читает её как прибой.
    const foam = cfg.foam || '#dff2ff';
    g.fillStyle = foam;
    const dash = (fx, fy, horiz, ph2, amp) => {
      for (let d = 0; d < 2; d++) {
        const seed = ph2 + d * 3.1;
        const len = 3 + ((Math.sin(seed * 1.7) * 0.5 + 0.5) * 5 | 0);
        const pos = ((Math.sin(time * 0.7 + seed) * 0.5 + 0.5) * (TILE - len)) | 0;
        const off = ((Math.sin(time * 1.1 + seed * 1.3) * 0.5 + 0.5) * 3) | 0;
        const a = 0.16 + Math.max(0, Math.sin(time * 2.0 + seed)) * 0.30;
        g.globalAlpha = a * amp;
        if (horiz) g.fillRect(fx + pos, fy + off * (amp > 0.85 ? 1 : -1), len, 1);
        else g.fillRect(fx + off * (amp > 0.85 ? 1 : -1), fy + pos, 1, len);
      }
    };
    if (!nU) dash(sx, sy, true, tx * 0.7 + ty * 1.9, 1);
    if (!nD) dash(sx, sy + TILE - 1, true, tx * 1.1 + ty * 0.5 + 2, 0.8);
    if (!nL) dash(sx, sy, false, ty * 0.8 + tx * 1.3 + 1, 1);
    if (!nR) dash(sx + TILE - 1, sy, false, ty * 0.6 + tx * 1.7 + 3, 0.8);
  }
  g.restore();
}
