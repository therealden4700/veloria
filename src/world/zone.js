// Генерация зон открытого мира + общие утилиты карт.

import { T, TILE, SOLID, buildTileset, renderZoneCanvas } from '../art/tiles.js';
import { PROPS } from '../art/props.js';
import { BIOMES, zoneLevel } from './biomes.js';
import { buildPacks } from '../systems/packs.js';
import { bakeNPC } from '../art/sprites.js';
import { RAMP } from '../art/palette.js';
import { makeRng, fbm, worley, warpFbm } from '../core/rng.js';
import { clamp, TAU, dist } from '../core/util.js';
import { findSpot, canBeAt, reachMask, nearestReachable } from './collide.js';
import { ENEMIES } from '../entities/enemies.js';

/**
 * Полоса земли, которую объект занимает под собой: ширина `w`, глубина `d`.
 *
 * Нижняя грань поднята на 7 пикселей над низом спрайта не по вкусу, а по
 * устройству габаритов: существо задаётся точкой ног и высотой вверх (у героя
 * 9). Если полоса кончается на уровне низа спрайта, ноги упираются на эти 9
 * пикселей раньше — и перед каждой бочкой остаётся полоса травы, сквозь которую
 * не пройти. С подъёмом на 7 ноги доходят до самого основания, а спрайты
 * перекрываются, как и положено в косом виде сверху.
 */
export function footBlock(w, d = 6) {
  return [-w / 2, -7 - d, w, d];
}

export class Zone {
  constructor(w, h, biomeId, kind) {
    this.w = w; this.h = h;
    this.biomeId = biomeId;
    this.kind = kind;
    this.tiles = new Uint8Array(w * h);
    this.solid = new Uint8Array(w * h);
    this.props = [];
    this.exits = [];
    this.lights = [];
    this.spawns = [];
    this.chests = [];
    this.npcs = [];
    this.spawnPoint = { x: w * TILE / 2, y: h * TILE / 2 };
    this.level = 1;
    this.pxW = w * TILE;
    this.pxH = h * TILE;
  }

  at(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return T.WALL;
    return this.tiles[y * this.w + x];
  }
  set(x, y, t) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.tiles[y * this.w + x] = t;
  }
  isSolid(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return true;
    return this.solid[ty * this.w + tx] === 1;
  }
  solidAtPx(x, y) {
    if (this.isSolid(Math.floor(x / TILE), Math.floor(y / TILE))) return true;
    return this.boxAt(x, y, 0, 0);
  }

  /**
   * Пересекает ли прямоугольник хоть один блок объекта. Прямоугольник задаётся
   * центром по x и нижней гранью по y — так же, как габарит существа.
   */
  boxAt(cx, by, w, h) {
    const bucket = this.blockGrid;
    if (!bucket) return false;
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = by - h, y1 = by;
    const tx0 = Math.max(0, Math.floor(x0 / TILE)), tx1 = Math.min(this.w - 1, Math.floor(x1 / TILE));
    const ty0 = Math.max(0, Math.floor(y0 / TILE)), ty1 = Math.min(this.h - 1, Math.floor(y1 / TILE));
    const b = this.blockBoxes;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const list = bucket[ty * this.w + tx];
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const o = list[i] * 4;
          if (x1 > b[o] && x0 < b[o + 2] && y1 > b[o + 1] && y0 < b[o + 3]) return true;
        }
      }
    }
    return false;
  }

  /**
   * Клетки — только для рельефа (стены, вода, обрыв). Объекты держим отдельным
   * списком пиксельных прямоугольников.
   *
   * Раньше блок объекта запекался в клетки, и прямоугольник 56×18 у дома
   * раздувался до 80×32: вокруг каждого дома вставала невидимая стена шириной
   * до 10 пикселей по бокам и целую клетку снизу — подойти вплотную было
   * нельзя. Точность здесь дороже, чем один байт на клетку, поэтому объекты
   * проверяются попиксельно, а клетки служат лишь индексом: в списке клетки
   * лежат номера пересекающих её прямоугольников, и проверять приходится
   * один-два.
   */
  bakeSolid() {
    for (let i = 0; i < this.tiles.length; i++) this.solid[i] = SOLID.has(this.tiles[i]) ? 1 : 0;

    const boxes = [];
    const grid = new Array(this.w * this.h).fill(null);
    for (const p of this.props) {
      if (!p.blocks) continue;
      const [bx, by, bw, bh] = p.blocks;
      const x0 = p.x + bx, y0 = p.y + by, x1 = x0 + bw, y1 = y0 + bh;
      const idx = boxes.length / 4;
      boxes.push(x0, y0, x1, y1);
      const tx0 = Math.max(0, Math.floor(x0 / TILE)), tx1 = Math.min(this.w - 1, Math.floor((x1 - 0.01) / TILE));
      const ty0 = Math.max(0, Math.floor(y0 / TILE)), ty1 = Math.min(this.h - 1, Math.floor((y1 - 0.01) / TILE));
      for (let ty = ty0; ty <= ty1; ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const k = ty * this.w + tx;
          (grid[k] || (grid[k] = [])).push(idx);
        }
      }
    }
    this.blockBoxes = Float32Array.from(boxes);
    this.blockGrid = grid;
  }

  bakeGround() {
    this.tileset = buildTileset(BIOMES[this.biomeId].tiles);
    const r = renderZoneCanvas(this, this.tileset);
    this.ground = r.canvas;
    this.liquidTiles = r.liquidTiles;
  }

  /** Ближайшая свободная точка к заданной (в пикселях). */
  findFree(px, py, maxR = 22) {
    for (let r = 0; r < maxR; r++) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * TAU;
        const x = px + Math.cos(ang) * r * TILE;
        const y = py + Math.sin(ang) * r * TILE;
        if (!this.solidAtPx(x, y) && !this.solidAtPx(x, y - 6)) return { x, y };
      }
    }
    return { x: px, y: py };
  }
}

export function addProp(zone, frames, x, y, opts = {}) {
  const arr = Array.isArray(frames);
  const c = arr ? frames[0] : frames;
  const p = {
    x, y,
    frames: arr ? frames : [frames],
    anim: !!opts.anim,
    fps: opts.fps || 8,
    phase: (Math.random() * 100) | 0,
    w: c.width, h: c.height,
    blocks: opts.blocks || null,
    light: opts.light || null,
    tag: opts.tag || null,
    data: opts.data || null,
    sortY: y + (opts.sortBias || 0),
    // покачивание на ветру и «плоскость» (лежит на земле — без тени)
    sway: opts.sway || 0,
    swaySpeed: opts.swaySpeed || 1,
    flat: !!opts.flat,
  };
  zone.props.push(p);
  return p;
}

export function fillRect(zone, x0, y0, w, h, t) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) zone.set(x, y, t);
}

export function carvePath(zone, ax, ay, bx, by, radius, tile = T.PATH, rng) {
  let x = ax, y = ay;
  let guard = 0;
  while ((x !== bx || y !== by) && guard++ < 4000) {
    const dx = bx - x, dy = by - y;
    if (Math.abs(dx) > Math.abs(dy)) x += Math.sign(dx);
    else if (dy !== 0) y += Math.sign(dy);
    else x += Math.sign(dx);
    if (rng && rng() < 0.14) { // лёгкая извилистость
      if (Math.abs(dx) > Math.abs(dy)) y += rng.sign();
      else x += rng.sign();
      x = clamp(x, 2, zone.w - 3); y = clamp(y, 2, zone.h - 3);
    }
    for (let oy = -radius; oy <= radius; oy++) {
      for (let ox = -radius; ox <= radius; ox++) {
        if (ox * ox + oy * oy > radius * radius + 1) continue;
        const t = zone.at(x + ox, y + oy);
        if (t === T.WALL || t === T.LIQUID) zone.set(x + ox, y + oy, T.GROUND);
      }
    }
    zone.set(x, y, tile);
    if (radius > 0) {
      zone.set(x + 1, y, tile); zone.set(x, y + 1, tile); zone.set(x + 1, y + 1, tile);
    }
  }
}

export function clearArea(zone, cx, cy, r, tile = T.GROUND) {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y > r * r) continue;
      const t = zone.at(cx + x, cy + y);
      if (t === T.WALL || t === T.LIQUID) zone.set(cx + x, cy + y, tile);
    }
  }
}

// ─────────────────────────────────────────── зона биома

function shufflePoi(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function generateBiomeZone(biomeId, seed, opts = {}) {
  const biome = BIOMES[biomeId];
  const rng = makeRng(seed);
  const W = opts.w || 90, H = opts.h || 66;
  const z = new Zone(W, H, biomeId, 'biome');
  z.level = opts.level ?? zoneLevel(biome);
  z.seed = seed;
  z.name = biome.name;

  const ns = seed % 10000;
  // ── рельеф
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const e = warpFbm(x * 0.055, y * 0.055, ns, 4, 1.6);
      const m = warpFbm(x * 0.09 + 100, y * 0.09 + 100, ns + 55, 3, 1.2);
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      let t = T.GROUND;
      if (edge < 3) t = T.WALL;
      else if (edge < 6 && e > 0.44) t = T.WALL;
      else if (e > 0.655) t = T.WALL;
      else if (e < 0.315) t = T.LIQUID;
      else if (m > 0.60) t = T.GROUND2;
      z.set(x, y, t);
    }
  }
  // сгладить одиночные пиксели
  for (let pass = 0; pass < 2; pass++) {
    const copy = z.tiles.slice();
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (copy[i] !== T.WALL) continue;
        let n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (copy[i + dy * W + dx] === T.WALL) n++;
        if (n <= 1 && Math.min(x, y, W - 1 - x, H - 1 - y) > 4) z.tiles[i] = T.GROUND;
      }
    }
  }

  // ── ключевые точки
  const entry = { x: 8, y: (H / 2) | 0 };
  const mid = { x: (W * 0.45) | 0, y: (H * 0.3 + rng() * H * 0.4) | 0 };
  const dungeon = { x: (W * 0.72) | 0, y: (H * 0.2 + rng() * H * 0.25) | 0 };
  const bossPt = { x: W - 12, y: (H * 0.62) | 0 };
  const camp = { x: (W * 0.28) | 0, y: (H * 0.72) | 0 };

  clearArea(z, entry.x, entry.y, 6);
  clearArea(z, mid.x, mid.y, 6);
  clearArea(z, dungeon.x, dungeon.y, 6);
  clearArea(z, bossPt.x, bossPt.y, 9);
  clearArea(z, camp.x, camp.y, 5);

  carvePath(z, entry.x, entry.y, mid.x, mid.y, 2, T.PATH, rng);
  carvePath(z, mid.x, mid.y, dungeon.x, dungeon.y, 2, T.PATH, rng);
  carvePath(z, mid.x, mid.y, bossPt.x, bossPt.y, 2, T.PATH, rng);
  carvePath(z, entry.x, entry.y, camp.x, camp.y, 2, T.PATH, rng);
  carvePath(z, camp.x, camp.y, bossPt.x, bossPt.y, 1, T.PATH, rng);

  // выложенная арена — чтобы место боя читалось сразу
  for (let y = -8; y <= 8; y++) {
    for (let x = -9; x <= 9; x++) {
      const d = x * x * 0.8 + y * y;
      if (d > 72) continue;
      const t = z.at(bossPt.x + x, bossPt.y + y);
      if (t === T.WALL || t === T.LIQUID) continue;
      z.set(bossPt.x + x, bossPt.y + y, d > 52 ? T.GROUND2 : T.PATH);
    }
  }
  // площадка у костра
  for (let y = -4; y <= 4; y++) {
    for (let x = -4; x <= 4; x++) {
      if (x * x + y * y > 16) continue;
      if (z.at(camp.x + x, camp.y + y) === T.GROUND) z.set(camp.x + x, camp.y + y, T.PATH);
    }
  }

  z.bossArena = { x: bossPt.x * TILE, y: bossPt.y * TILE, r: 118 };

  // ── точки интереса: ради них и стоит сходить с тропы
  const keepClearExtra = [];
  z.events = [];
  const poiSpots = [];
  let pg = 0;
  while (poiSpots.length < 3 && pg++ < 2000) {
    const x = rng.int(10, W - 11), y = rng.int(10, H - 11);
    const t = z.at(x, y);
    if (t !== T.GROUND && t !== T.GROUND2) continue;
    const px = x * TILE + 8, py = y * TILE + 12;
    // 240 → 460: «логово вожака» ставит элиту на три уровня выше зоны, а на
    // 240 px это полтора экрана от ворот. Замер новой игры: в двух прогонах из
    // восьми элита с 1092 hp оказывалась ближайшей тварью к герою первого
    // уровня со 103 hp — сорок четыре удара, чтобы убить, три, чтобы умереть.
    if (dist(px, py, entry.x * TILE, entry.y * TILE) < 460) continue;
    if (dist(px, py, bossPt.x * TILE, bossPt.y * TILE) < 200) continue;
    if (poiSpots.some((s) => dist(s.x, s.y, px, py) < 240)) continue;
    poiSpots.push({ x, y, px, py });
  }

  const poiKinds = shufflePoi(['ruins', 'ambush', 'miniboss', 'merchant'], rng).slice(0, poiSpots.length);
  poiSpots.forEach((spot, i) => {
    const kind = poiKinds[i];
    clearArea(z, spot.x, spot.y, 5);
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        if (dx * dx + dy * dy > 18) continue;
        const t = z.at(spot.x + dx, spot.y + dy);
        if (t === T.GROUND || t === T.GROUND2) z.set(spot.x + dx, spot.y + dy, T.GROUND2);
      }
    }
    keepClearExtra.push({ x: spot.x, y: spot.y, r: 6 });

    if (kind === 'ruins') {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU + rng() * 0.3;
        const v = PROPS.brokenPillar;
        addProp(z, v[(rng() * v.length) | 0], spot.px + Math.cos(a) * 52, spot.py + Math.sin(a) * 38,
                { blocks: footBlock(10, 5) });
      }
      const ob = addProp(z, PROPS.obelisk, spot.px, spot.py, { anim: true, fps: 8, tag: 'obelisk', blocks: footBlock(12, 6) });
      ob.used = false;
      (z.obelisks ||= []).push(ob);
      z.lights.push({ x: spot.px, y: spot.py - 24, r: 76, color: 'rgba(150,100,255,0.5)', flicker: 0.14 });
      for (let k = 0; k < 2; k++) {
        const c = addProp(z, PROPS.chest, spot.px + (k ? 34 : -34), spot.py + 18, { tag: 'chest' });
        c.opened = false; z.chests.push(c);
      }
      z.spawns.push(...buildPacks([{ x: spot.px, y: spot.py + 30 }], biome.enemies, z.level + 1, rng));
      z.pois = z.pois || [];
      z.pois.push({ kind, x: spot.px, y: spot.py, name: 'Древние руины' });
    } else if (kind === 'ambush') {
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * TAU + 0.6;
        const v = PROPS.tent;
        addProp(z, v[(rng() * v.length) | 0], spot.px + Math.cos(a) * 40, spot.py + Math.sin(a) * 28,
                { blocks: footBlock(26, 7) });
      }
      addProp(z, PROPS.campfire, spot.px, spot.py, { anim: true, fps: 10 });
      z.lights.push({ x: spot.px, y: spot.py - 8, r: 84, color: 'rgba(255,170,70,0.7)', flicker: 0.3 });
      addProp(z, PROPS.barrel, spot.px + 20, spot.py + 14, { blocks: footBlock(10, 5) });
      z.events.push({ kind: 'ambush', x: spot.px, y: spot.py, r: 86, level: z.level + 2, done: false, rewarded: false, enemies: [] });
      z.pois = z.pois || [];
      z.pois.push({ kind, x: spot.px, y: spot.py, name: 'Разбойничий лагерь' });
    } else if (kind === 'miniboss') {
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU + 0.4;
        addProp(z, PROPS.pillar, spot.px + Math.cos(a) * 46, spot.py + Math.sin(a) * 34, { blocks: footBlock(12, 6) });
      }
      z.spawns.push({ key: biome.elite, level: z.level + 3, pack: 'poi', forceAffix: true, x: spot.px, y: spot.py });
      z.spawns.push(...buildPacks([{ x: spot.px + 30, y: spot.py + 24 }], biome.enemies, z.level + 1, rng));
      const c = addProp(z, PROPS.chest, spot.px, spot.py + 34, { tag: 'chest' });
      c.opened = false; c.rich = true; z.chests.push(c);
      z.pois = z.pois || [];
      z.pois.push({ kind, x: spot.px, y: spot.py, name: 'Логово вожака' });
    } else if (kind === 'merchant') {
      addProp(z, PROPS.tent[0], spot.px - 26, spot.py + 6, { blocks: footBlock(26, 7) });
      addProp(z, PROPS.crate, spot.px + 22, spot.py + 8, { blocks: footBlock(10, 5) });
      addProp(z, PROPS.campfire, spot.px + 4, spot.py + 20, { anim: true, fps: 10 });
      z.lights.push({ x: spot.px, y: spot.py, r: 78, color: 'rgba(255,190,110,0.6)', flicker: 0.2 });
      z.npcs.push({
        id: 'wander', name: 'Бродячий торговец Хальд', title: 'редкости из дальних мест',
        shop: 'wander', x: spot.px, y: spot.py,
        lines: [
          'Дороги опасны, зато цены честные. Почти.',
          'Товар редкий: что было по пути, то и есть.',
        ],
        spr: bakeNPC({ skin: RAMP.skin, cloth: RAMP.gold, scale: 1.0, hat: '#6b4a16', eye: '#3a2a1a' }),
        animT: 0, flip: false,
      });
      z.pois = z.pois || [];
      z.pois.push({ kind, x: spot.px, y: spot.py, name: 'Стоянка торговца' });
    }
  });

  // ── реквизит
  const treeKeys = biome.trees || [];
  const rockKeys = biome.rocks || [];
  const bushKeys = biome.bushes || [];
  const grassKeys = { forest: 'grass', swamp: 'grassSwamp', frost: 'grassFrost', ember: 'grassEmber' }[biomeId];
  const detailKeys = biomeId === 'ember' ? PROPS.detailCrack
    : biomeId === 'swamp' ? PROPS.detailRoot
    : biomeId === 'frost' ? PROPS.detail : PROPS.detailRoot;

  const occupied = new Set();
  const tryPlace = (tx, ty) => {
    const k = ty * W + tx;
    if (occupied.has(k)) return false;
    occupied.add(k);
    return true;
  };

  // площадки, которые нельзя заставлять реквизитом (в тайлах)
  const keepClear = [
    ...keepClearExtra,
    { x: entry.x, y: entry.y, r: 7 },
    { x: dungeon.x, y: dungeon.y, r: 6 },
    { x: camp.x, y: camp.y, r: 6 },
    { x: bossPt.x, y: bossPt.y, r: 11 },
    { x: mid.x, y: mid.y, r: 4 },
  ];
  const isClearZone = (x, y) => keepClear.some((c) => (c.x - x) ** 2 + (c.y - y) ** 2 < c.r * c.r);

  for (let y = 4; y < H - 4; y++) {
    for (let x = 4; x < W - 4; x++) {
      const t = z.at(x, y);
      if (t !== T.GROUND && t !== T.GROUND2 && t !== T.PATH) continue;
      if (isClearZone(x, y)) continue;

      // Рядом с дорогой нельзя ставить то, что загораживает проход, — но это
      // правило раньше отсекало и траву с мелочью. В итоге вдоль каждой дороги
      // тянулась голая полоса в клетку шириной, а сама дорога была пуста
      // совсем: замер показал мелочь на 4% проходимой земли и ноль на 577
      // клетках дорог. Теперь запрет действует только на крупное.
      let nearPath = t === T.PATH;
      for (let oy = -1; oy <= 1 && !nearPath; oy++) for (let ox = -1; ox <= 1; ox++) if (z.at(x + ox, y + oy) === T.PATH) { nearPath = true; break; }

      const px = x * TILE + TILE / 2, py = y * TILE + TILE;
      const dens = fbm(x * 0.11 + 400, y * 0.11 + 400, ns + 9, 3);
      const r = nearPath ? 1 : rng();      // 1 — крупное не пройдёт ни по одному порогу

      if (treeKeys.length && dens > 0.52 && r < 0.30) {
        if (!tryPlace(x, y)) continue;
        const key = treeKeys[(rng() * treeKeys.length) | 0];
        const variants = PROPS[key];
        const c = variants[(rng() * variants.length) | 0];
        addProp(z, c, px, py, {
          blocks: footBlock(8, 6),
          sway: 0.022 + rng() * 0.016, swaySpeed: 0.5 + rng() * 0.4,
        });
      } else if (rockKeys.length && r < 0.055) {
        if (!tryPlace(x, y)) continue;
        const key = rockKeys[(rng() * rockKeys.length) | 0];
        const variants = PROPS[key];
        const c = variants[(rng() * variants.length) | 0];
        addProp(z, c, px, py, { blocks: footBlock(12, 5) });
        if (key === 'rockIce' || key === 'rockEmber' || key === 'crystal') {
          z.lights.push({ x: px, y: py - 10, r: 46, color: key === 'rockEmber' ? 'rgba(255,120,40,0.5)' : key === 'rockIce' ? 'rgba(120,200,255,0.42)' : 'rgba(150,90,255,0.42)', flicker: 0.1 });
        }
      } else if (bushKeys.length && r < 0.10) {
        if (!tryPlace(x, y)) continue;
        const key = bushKeys[(rng() * bushKeys.length) | 0];
        const variants = PROPS[key];
        addProp(z, variants[(rng() * variants.length) | 0], px, py, {
          sway: 0.04 + rng() * 0.03, swaySpeed: 0.9 + rng() * 0.6,
        });
      } else if (r < 0.012) {
        addProp(z, rng() < 0.5 ? PROPS.barrel : PROPS.crate, px, py, { blocks: footBlock(10, 5) });
      }

      // ── мелочь: своя лотерея, не хвост от крупного
      //
      // Раньше трава и сор доставались из того же броска, что деревья и камни:
      // всё, что не выпало сверху, попадало в узкую щель 0,19…0,24. Оттого
      // земля и была голой на 96%. Теперь бросок отдельный, и пороги видно.
      // Пороги подобраны глазом по кадру, а не по вкусу к числам. На 0,30/0,46
      // земля стала богатой, но герой начал теряться в мусоре, а дорога
      // перестала читаться дорогой — а это хуже, чем пустая земля: по дороге
      // игрок ориентируется. Читаемость важнее богатства.
      const r2 = rng();
      if (grassKeys && t !== T.PATH && r2 < 0.20) {
        // трава качается на ветру — главный источник «жизни» на земле
        const variants = PROPS[grassKeys];
        addProp(z, variants[(rng() * variants.length) | 0],
          px + (rng() - 0.5) * 12, py + (rng() - 0.5) * 8,
          { sway: 0.10 + rng() * 0.09, swaySpeed: 1.4 + rng() * 0.9, flat: true });
      } else if (r2 < (t === T.PATH ? 0.14 : 0.30)) {
        // На дороге лежит камешек и трещина, а не куст травы: дорога — то
        // место, где трава как раз вытоптана, и голой она выглядит неправильно
        // ровно так же, как заросшей.
        const set = t === T.PATH ? (rng() < 0.7 ? PROPS.detail : detailKeys)
          : (rng() < 0.6 ? PROPS.detail : detailKeys);
        addProp(z, set[(rng() * set.length) | 0],
          px + (rng() - 0.5) * 12, py + (rng() - 0.5) * 8, { flat: true, sortBias: -2 });
      }
    }
  }

  // ── портал возврата в город
  const ep = { x: entry.x * TILE + 8, y: entry.y * TILE + 8 };
  addProp(z, PROPS[biome.portal], ep.x, ep.y + 22, { anim: true, fps: 12, tag: 'portal' });
  z.lights.push({ x: ep.x, y: ep.y, r: 90, color: 'rgba(180,150,255,0.6)', flicker: 0.16 });
  z.exits.push({ x: ep.x - 18, y: ep.y - 6, w: 36, h: 30, dest: { kind: 'city' }, label: 'Вернуться в Велорию' });
  z.spawnPoint = { x: ep.x, y: ep.y + 34 };

  // ── вход в подземелье
  const dp = { x: dungeon.x * TILE + 8, y: dungeon.y * TILE + 8 };
  addProp(z, PROPS.stairs, dp.x, dp.y + 14, { tag: 'stairs' });
  z.lights.push({ x: dp.x, y: dp.y, r: 70, color: 'rgba(140,90,220,0.5)', flicker: 0.2 });
  z.exits.push({ x: dp.x - 16, y: dp.y - 8, w: 32, h: 26, dest: { kind: 'dungeon', floor: 1 }, label: 'Спуститься в катакомбы' });
  addProp(z, PROPS.sign, dp.x - 26, dp.y + 14, {});

  // ── лагерь-костёр (точка возрождения)
  const cp = { x: camp.x * TILE + 8, y: camp.y * TILE + 8 };
  addProp(z, PROPS.campfire, cp.x, cp.y + 10, { anim: true, fps: 10, tag: 'campfire' });
  z.lights.push({ x: cp.x, y: cp.y, r: 96, color: 'rgba(255,170,70,0.75)', flicker: 0.3 });
  addProp(z, PROPS.crate, cp.x + 22, cp.y + 8, { blocks: footBlock(10, 5) });
  addProp(z, PROPS.barrel, cp.x - 24, cp.y + 10, { blocks: footBlock(10, 5) });
  z.campfire = { x: cp.x, y: cp.y + 4 };

  // ── сундуки
  const chestSpots = [];
  for (let i = 0; i < 5; i++) {
    for (let tries = 0; tries < 60; tries++) {
      const x = rng.int(6, W - 7), y = rng.int(6, H - 7);
      if (z.at(x, y) !== T.GROUND && z.at(x, y) !== T.GROUND2) continue;
      const px = x * TILE + 8, py = y * TILE + 12;
      if (chestSpots.some((c) => dist(c.x, c.y, px, py) < 190)) continue;
      if (dist(px, py, ep.x, ep.y) < 150) continue;
      chestSpots.push({ x: px, y: py });
      break;
    }
  }
  for (const c of chestSpots) {
    const prop = addProp(z, PROPS.chest, c.x, c.y, { tag: 'chest' });
    prop.opened = false;
    z.chests.push(prop);
  }

  // ── босс
  const bp = { x: bossPt.x * TILE + 8, y: bossPt.y * TILE + 8 };
  // уровень босса привязан к нижней границе биома: верхняя — это «перерос зону»,
  // и по ней босс получался на 8 уровней выше игрока, который до него доходит
  const bossLvl = (biome.levelRange ? biome.levelRange[0] : 1) + 4;
  z.boss = { key: biome.boss, level: bossLvl, x: bp.x, y: bp.y, spawned: false };
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    addProp(z, PROPS.pillar, bp.x + Math.cos(a) * 96, bp.y + Math.sin(a) * 70, { blocks: footBlock(12, 6) });
    z.lights.push({ x: bp.x + Math.cos(a) * 96, y: bp.y + Math.sin(a) * 70 - 30, r: 54, color: 'rgba(255,160,80,0.4)', flicker: 0.25 });
  }
  addProp(z, PROPS.sign, bp.x - 90, bp.y + 60, {});

  // ── отряды: сначала якоря, потом расстановка по ролям вокруг каждого
  const anchors = [];
  const wanted = opts.packs || 11;
  let guard = 0;
  while (anchors.length < wanted && guard++ < 4000) {
    const x = rng.int(6, W - 7), y = rng.int(6, H - 7);
    const t = z.at(x, y);
    if (t !== T.GROUND && t !== T.GROUND2 && t !== T.PATH) continue;
    const px = x * TILE + 8, py = y * TILE + 12;
    if (dist(px, py, ep.x, ep.y) < 200) continue;
    if (dist(px, py, cp.x, cp.y) < 130) continue;
    if (dist(px, py, bp.x, bp.y) < 165) continue;
    if (anchors.some((a) => dist(a.x, a.y, px, py) < 130)) continue;
    if (poiSpots.some((sp) => dist(sp.px, sp.py, px, py) < 150)) continue;
    anchors.push({ x: px, y: py });
  }
  for (const s of buildPacks(anchors, biome.enemies, z.level, rng)) {
    const free = z.findFree(s.x, s.y, 4);
    z.spawns.push({ ...s, x: free.x, y: free.y });
  }


  // стража арены босса — отдельный элитный отряд
  for (let i = 0; i < 3; i++) {
    const a = rng() * TAU, r = 92 + rng() * 40;
    z.spawns.push({ key: biome.elite, level: z.level + 2, pack: 'arena', x: bp.x + Math.cos(a) * r, y: bp.y + Math.sin(a) * r });
  }

  // ── отмель у входа
  //
  // Отряды и так не ставятся ближе 200 px от портала, но дальше этой черты
  // сразу начинается полная сила биома: `buildPacks` даёт уровень зоны ±1, и
  // игрок, вышедший из города первого уровня, встречал отряд второго-пятого, а
  // в четверти прогонов — элиту с 1092 hp в 240 px от ворот.
  //
  // Проход стоит в самом конце: спавны сюда добавляют четыре разных места —
  // отряды, точки интереса, стража арены босса, — и правка в середине половину
  // из них не заставала. Первые полтора экрана прижаты к нижней границе биома,
  // аффиксы сняты, элита выселена. Это не «лёгкая зона», а пологий вход:
  // дальше черты всё как было.
  const SHALLOW = 420;
  z.spawns = z.spawns.filter((s) => {
    if (dist(s.x, s.y, ep.x, ep.y) > SHALLOW) return true;
    if (s.key === biome.elite || s.pack === 'arena' || s.pack === 'poi' || s.forceAffix) return false;
    s.level = Math.max(1, Math.min(s.level, z.level - 1));
    return true;
  });

  // Коллизию печём до расстановки: без неё `canBeAt` не знает ни про один
  // объект и считает проходимым всё подряд — первая версия этой правки
  // именно поэтому не сдвинула ни одного врага.
  z.bakeSolid();

  // ── расстановка по настоящей коллизии
  //
  // Точки выбирались по карте тайлов, а стоять на них потом кто-то с
  // габаритом: `z.findFree` не знает про объекты, и враги оказывались внутри
  // валунов и колонн — аудит находил по 2–9 таких на зону. Здесь каждого
  // сдвигаем на ближайшее место, где он действительно помещается; летающие
  // проходят над водой, поэтому им мерка своя.
  for (const sp2 of z.spawns) {
    const def = ENEMIES[sp2.key];
    if (!def) continue;
    const f = findSpot(z, sp2.x, sp2.y, def.r * 1.6, def.r, !!def.flying, 5);
    if (f.moved > 0) { sp2.x = f.x; sp2.y = f.y; }
  }
  // сундук за колонной ничем не лучше сундука в стене
  // Сундуки: мало поместиться — надо ещё чтобы до них дошли. Рельеф иногда
  // оставляет карманы, отрезанные стенами, и разбросанный туда сундук виден на
  // миникарте, но недостижим: игрок ходит вокруг и не понимает, что не так.
  const reach = reachMask(z, z.spawnPoint.x, z.spawnPoint.y);

  // Жители в биомах — это бродячий торговец у точки интереса. Он тоже может
  // оказаться в отрезанном кармане, и тогда игрок видит лавку, до которой не
  // дойти. Для торговца это хуже, чем для сундука: сундук просто не открыть, а
  // сюда игрок пойдёт целенаправленно и будет искать проход.
  for (const npc of z.npcs || []) {
    const tx = Math.floor(npc.x / TILE), ty = Math.floor(npc.y / TILE);
    if (tx >= 0 && ty >= 0 && tx < z.w && ty < z.h && reach[ty * z.w + tx]) continue;
    const near = nearestReachable(z, reach, npc.x, npc.y, 24);
    if (near) { npc.x = near.x; npc.y = near.y; }
  }

  for (const c of z.chests) {
    const f = findSpot(z, c.x, c.y, 11, 9, false, 4);
    if (f.moved > 0) { c.x = f.x; c.y = f.y; }
    const tx = Math.floor(c.x / TILE), ty = Math.floor(c.y / TILE);
    if (reach[ty * z.w + tx]) continue;
    const near = nearestReachable(z, reach, c.x, c.y, 20);
    if (near) { c.x = near.x; c.y = near.y; }
  }


  // ── Выбросы пустоты: опасность самой местности
  //
  // Сложность биома можно набрать здоровьем мобов — и это ровно та ошибка,
  // которая уже стоила нам переделки глубины: «бои растягивались, но опасность
  // не росла». Здесь она набирается иначе: у самой земли есть места, где стоять
  // нельзя. Игрок обязан смотреть под ноги, а не только на врага.
  //
  // Выбросы жмутся к разломам — к клеткам жидкости, — и садятся только на
  // проходимую землю, иначе они бесполезны: в стену и так не зайти.
  if (biome.hazard) {
    z.hazardSpots = [];
    const hz = biome.hazard;
    const want = hz.count || 14;
    let guard = 0;
    while (z.hazardSpots.length < want && guard++ < 4000) {
      const x = 3 + ((rng() * (z.w - 6)) | 0);
      const y = 3 + ((rng() * (z.h - 6)) | 0);
      const t = z.at(x, y);
      if (t !== T.GROUND && t !== T.GROUND2 && t !== T.PATH) continue;
      // рядом должен быть разлом — иначе выброс висит посреди пустого поля
      let рядом = false;
      for (let oy = -3; oy <= 3 && !рядом; oy++) {
        for (let ox = -3; ox <= 3; ox++) if (z.at(x + ox, y + oy) === T.LIQUID) { рядом = true; break; }
      }
      if (!рядом) continue;
      // Тайл проходимый — ещё не значит, что туда можно встать: там может
      // стоять валун или колонна. Выброс в объекте не опасен вообще, его
      // просто нельзя задеть. Двигаем на ближайшее место с настоящим зазором —
      // тем же средством, которым генератор уже вытаскивает врагов из стен.
      const f = findSpot(z, x * TILE + TILE / 2, y * TILE + TILE / 2, 11, 9, false, 3);
      if (f.moved < 0) continue;
      const px = f.x, py = f.y;
      // не сажаем два выброса друг на друга и не перекрываем точку появления
      if (dist(px, py, z.spawnPoint.x, z.spawnPoint.y) < 120) continue;
      if (z.hazardSpots.some((h) => dist(h.x, h.y, px, py) < 70)) continue;
      z.hazardSpots.push({ x: px, y: py, r: hz.r || 22, dps: hz.dps || 1, effect: hz.effect || null });
    }
  }

  z.bakeGround();
  z.weather = biome.weather;
  z.ambient = biome.ambient;
  z.grade = biome.grade;
  z.wind = biome.wind ?? 1;
  z.dappleStrength = biome.dapple ?? 0;
  z.maxRarity = biome.maxRarity || 'legendary';
  z.haze = biome.haze || null;
  z.music = biome.music;
  z.dustColor = biome.tiles.ramp[1];
  return z;
}
