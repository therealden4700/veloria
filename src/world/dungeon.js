// Катакомбы: комнаты + коридоры, глубина задаёт сложность. Каждый 5-й этаж — босс.

import { T, TILE } from '../art/tiles.js';
import { PROPS } from '../art/props.js';
import { Zone, addProp, fillRect, footBlock } from './zone.js';
import { BIOMES } from './biomes.js';
import { makeRng, hashStr } from '../core/rng.js';
import { FLOOR_MODS, ALTAR_KEYS } from '../systems/dungeon_mods.js';
import { buildPacks } from '../systems/packs.js';
import { findSpot, reachMask, nearestReachable } from './collide.js';
import { ENEMIES } from '../entities/enemies.js';
import { clamp, dist, TAU } from '../core/util.js';
import { dungeonLevel, ABYSS_START, dungeonBoss } from '../systems/abyss.js';
import { rarityCapFor } from '../systems/items.js';

export function isBossFloor(floor) { return floor % 5 === 0; }

export function generateDungeon(floor, seed, modKey = 'none') {
  const rng = makeRng(seed + floor * 7919 + hashStr(modKey) % 9973);
  const boss = isBossFloor(floor);
  const mod = FLOOR_MODS[modKey] || FLOOR_MODS.none;
  const W = clamp(52 + floor * 2, 52, 84);
  const H = clamp(44 + floor * 2, 44, 70);
  const z = new Zone(W, H, 'dungeon', 'dungeon');
  z.floor = floor;
  z.level = dungeonLevel(floor);
  z.name = floor >= ABYSS_START ? `Бездна · этаж ${floor}` : `Катакомбы · этаж ${floor}`;
  z.modKey = modKey;
  z.mod = mod;
  z.isBossFloor = boss;

  z.tiles.fill(T.VOID);

  // ── комнаты
  const rooms = [];
  const target = boss ? 6 : clamp(7 + Math.floor(floor / 2), 7, 13);
  let guard = 0;
  while (rooms.length < target && guard++ < 500) {
    const rw = rng.int(7, 13), rh = rng.int(6, 11);
    const rx = rng.int(3, W - rw - 4), ry = rng.int(3, H - rh - 4);
    const r = { x: rx, y: ry, w: rw, h: rh, cx: (rx + rw / 2) | 0, cy: (ry + rh / 2) | 0 };
    if (rooms.some((o) => rx < o.x + o.w + 3 && rx + rw + 3 > o.x && ry < o.y + o.h + 3 && ry + rh + 3 > o.y)) continue;
    rooms.push(r);
  }
  // босс-зал
  if (boss) {
    const bw = 20, bh = 16;
    const bx = clamp(W - bw - 6, 4, W - bw - 4), by = clamp(((H - bh) / 2) | 0, 4, H - bh - 4);
    for (let i = rooms.length - 1; i >= 0; i--) {
      const o = rooms[i];
      if (bx < o.x + o.w + 2 && bx + bw + 2 > o.x && by < o.y + o.h + 2 && by + bh + 2 > o.y) rooms.splice(i, 1);
    }
    rooms.push({ x: bx, y: by, w: bw, h: bh, cx: (bx + bw / 2) | 0, cy: (by + bh / 2) | 0, boss: true });
  }

  rooms.sort((a, b) => a.cx - b.cx);
  for (const r of rooms) fillRect(z, r.x, r.y, r.w, r.h, T.GROUND);

  // ── коридоры
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i - 1], b = rooms[i];
    corridor(z, a.cx, a.cy, b.cx, b.cy, rng);
  }
  // пара петель, чтобы не было «кишки»
  for (let i = 0; i < 2 && rooms.length > 3; i++) {
    const a = rng.pick(rooms), b = rng.pick(rooms);
    if (a !== b) corridor(z, a.cx, a.cy, b.cx, b.cy, rng);
  }

  // ── стены вокруг пола
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (z.at(x, y) !== T.VOID) continue;
      let near = false;
      for (let oy = -1; oy <= 1 && !near; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const t = z.at(x + ox, y + oy);
          if (t === T.GROUND || t === T.GROUND2 || t === T.PATH || t === T.LIQUID) { near = true; break; }
        }
      }
      if (near) z.set(x, y, T.WALL);
    }
  }

  // ── детали пола
  for (const r of rooms) {
    for (let i = 0; i < (r.w * r.h) / 9; i++) {
      const x = rng.int(r.x, r.x + r.w - 1), y = rng.int(r.y, r.y + r.h - 1);
      if (z.at(x, y) === T.GROUND) z.set(x, y, rng() < 0.5 ? T.GROUND2 : T.PATH);
    }
    // лужи
    if (rng() < 0.3 && !r.boss) {
      const px = rng.int(r.x + 1, r.x + r.w - 3), py = rng.int(r.y + 1, r.y + r.h - 3);
      for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) z.set(px + x, py + y, T.LIQUID);
    }
  }

  const entry = rooms[0];
  const last = rooms[rooms.length - 1];

  // ── подъём наверх
  const upX = entry.cx * TILE + 8, upY = (entry.cy) * TILE + 8;
  addProp(z, PROPS.portalDungeon, upX, upY + 18, { anim: true, fps: 12, tag: 'portal' });
  z.lights.push({ x: upX, y: upY, r: 92, color: 'rgba(170,120,255,0.6)', flicker: 0.16 });
  z.exits.push({ x: upX - 18, y: upY - 8, w: 36, h: 30, dest: { kind: 'city' }, label: 'Вернуться в Велорию' });
  // Точка появления ставилась на два тайла ниже центра комнаты без всякой
  // проверки — и если там оказывалась вода (а она в непроходимых), герой
  // рождался в реке и не мог сдвинуться. Аудит ловил это на каждом шестом
  // этаже. Теперь ищем ближайшее место, где габарит героя помещается.
  z.bakeSolid();
  z.spawnPoint = findSpot(z, upX, upY + 32, 11, 9, false, 8);

  // ── спуск глубже
  //
  // На боссовых этажах лестница сдвигалась на четыре тайла ниже центра комнаты,
  // чтобы не стоять вплотную к арене. Проверки при этом не было — и если
  // комната мелкая или прижата к низу карты, спуск уезжал за её стену, в
  // пустоту. Игрок заходил на этаж и не мог пойти глубже: забег кончался
  // тупиком. Аудит ловил это на 15-м, 20-м и 30-м этажах.
  //
  // Сдвиг оставляем, но не дальше, чем позволяет комната.
  const dn = last;
  const shift = boss ? Math.min(4, Math.max(0, (dn.y2 !== undefined ? dn.y2 : dn.cy + 2) - dn.cy - 2)) : 0;
  const dnX = dn.cx * TILE + 8, dnY = (dn.cy + shift) * TILE + 8;
  const stair = addProp(z, PROPS.stairs, dnX, dnY + 14, { tag: 'stairs' });
  z.lights.push({ x: dnX, y: dnY, r: 64, color: 'rgba(120,90,200,0.45)', flicker: 0.2 });
  z.downExit = {
    x: dnX - 16, y: dnY - 8, w: 32, h: 26,
    dest: { kind: 'dungeon', floor: floor + 1 },
    label: `Спуститься на этаж ${floor + 1}`,
    locked: boss,
  };
  z.exits.push(z.downExit);
  z.stairProp = stair;

  // ── факелы на стенах
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (z.at(x, y) !== T.WALL) continue;
      const below = z.at(x, y + 1);
      if (below !== T.GROUND && below !== T.GROUND2 && below !== T.PATH) continue;
      if (rng() > 0.09) continue;
      const px = x * TILE + 8, py = y * TILE + 20;
      addProp(z, PROPS.torch, px, py, { anim: true, fps: 10 });
      z.lights.push({ x: px, y: py - 16, r: 82, color: 'rgba(255,160,70,0.85)', flicker: 0.35 });
    }
  }

  // ── световые шахты: свет с поверхности через решётки в потолке
  z.shafts = [];
  const addShaft = (px, py, scale) => {
    z.shafts.push({
      x: px, y: py,
      w: 26 * scale, len: 46 * scale,
      skew: 15 * scale,                  // свет падает слева, как и тени — пятно уходит вправо
      color: floor <= 4 ? 'rgba(198,214,255,1)' : 'rgba(150,130,220,1)',
      p: (px * 0.07 + py * 0.11) % 6.28,
    });
    z.lights.push({
      x: px + 10 * scale, y: py, r: 74 * scale,
      color: floor <= 4 ? 'rgba(170,190,255,0.55)' : 'rgba(140,120,210,0.5)',
      flicker: 0.04,
    });
  };
  for (const r of rooms) {
    if (r === entry || rng() > 0.34) continue;
    addShaft((r.cx + rng.int(-2, 2)) * TILE + 8, (r.cy + rng.int(-1, 1)) * TILE + 8, 0.85 + rng() * 0.5);
  }
  if (boss) {
    const br = rooms.find((r) => r.boss) || last;
    for (let i = 0; i < 3; i++) {
      addShaft((br.cx - 5 + i * 5) * TILE + 8, (br.cy - 3 + (i % 2) * 5) * TILE + 8, 1.3);
    }
  }

  // ── мелочь на полу: кости, трещины, щебень
  for (const r of rooms) {
    const n = rng.int(3, 8);
    for (let i = 0; i < n; i++) {
      const px = (r.x + rng.int(0, r.w - 1)) * TILE + rng.int(2, 14);
      const py = (r.y + rng.int(0, r.h - 1)) * TILE + rng.int(4, 15);
      const roll = rng();
      const set = roll < 0.4 ? PROPS.detailBone : roll < 0.75 ? PROPS.detailCrack : PROPS.detail;
      addProp(z, set[(rng() * set.length) | 0], px, py, { flat: true, sortBias: -2 });
    }
  }

  // ── реквизит
  for (const r of rooms) {
    const n = rng.int(1, 4);
    for (let i = 0; i < n; i++) {
      const x = rng.int(r.x + 1, r.x + r.w - 2), y = rng.int(r.y + 1, r.y + r.h - 2);
      const px = x * TILE + 8, py = y * TILE + 14;
      if (dist(px, py, upX, upY) < 60) continue;
      const roll = rng();
      if (roll < 0.3) addProp(z, PROPS.barrel, px, py, { blocks: footBlock(10, 5) });
      else if (roll < 0.55) addProp(z, PROPS.crate, px, py, { blocks: footBlock(10, 5) });
      else if (roll < 0.78) addProp(z, PROPS.tomb, px, py, { blocks: footBlock(10, 5) });
      else addProp(z, PROPS.pillarBone, px, py, { blocks: footBlock(12, 6) });
    }
  }

  // ── сундуки
  const nChests = Math.round((1 + (rng() < 0.5 ? 1 : 0) + (floor % 3 === 0 ? 1 : 0)) * (mod.chestMul || 1));
  for (let i = 0; i < nChests; i++) {
    const r = rng.pick(rooms);
    if (r === entry) continue;
    const px = (r.cx + rng.int(-2, 2)) * TILE + 8, py = (r.cy + rng.int(-1, 1)) * TILE + 12;
    const p = addProp(z, PROPS.chest, px, py, { tag: 'chest' });
    p.opened = false;
    z.chests.push(p);
  }

  // ── мобы: по отряду на комнату, в больших комнатах — два
  const anchors = [];
  for (const r of rooms) {
    if (r === entry || r.boss) continue;
    const n = r.w * r.h > 90 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      if (rng() > (mod.enemyMul || 1) * 0.62) continue;
      anchors.push({
        x: (r.x + rng.int(2, r.w - 3)) * TILE + 8,
        y: (r.y + rng.int(2, r.h - 3)) * TILE + 12,
      });
    }
  }
  for (const s of buildPacks(anchors, BIOMES.dungeon.enemies, z.level, rng, { exclude: boss ? ['warband', 'bulwark'] : null })) {
    const free = z.findFree(s.x, s.y, 4);
    z.spawns.push({ ...s, x: free.x, y: free.y });
  }
  if (floor >= 3 && !boss) {
    const r = rng.pick(rooms.filter((x) => x !== entry)) || last;
    z.spawns.push({ key: BIOMES.dungeon.elite, level: z.level + 2, pack: 'elite', x: r.cx * TILE + 8, y: r.cy * TILE + 12 });
  }
  // отряд с аффиксами от модификатора «Травля»
  if (mod.eliteHunt) {
    const r = rng.pick(rooms.filter((x) => x !== entry && !x.boss)) || last;
    const hunt = buildPacks([{ x: r.cx * TILE + 8, y: r.cy * TILE + 12 }], BIOMES.dungeon.enemies, z.level + 2, rng);
    for (const s of hunt) z.spawns.push({ ...s, forceAffix: true, pack: 'hunt' });
  }

  // ── проклятый алтарь
  if (!boss && rng() < 0.55) {
    const r = rng.pick(rooms.filter((x) => x !== entry)) || last;
    const ax = r.cx * TILE + 8, ay = (r.cy + 1) * TILE + 8;
    const altar = addProp(z, PROPS.altar, ax, ay, { anim: true, fps: 8, tag: 'altar', blocks: footBlock(22, 7) });
    altar.altarKey = rng.pick(ALTAR_KEYS);
    altar.used = false;
    z.lights.push({ x: ax, y: ay - 12, r: 70, color: 'rgba(200,90,140,0.55)', flicker: 0.22 });
    z.altars = [altar];
  }

  if (boss) {
    const br = rooms.find((r) => r.boss) || last;
    z.boss = {
      key: dungeonBoss(floor), level: z.level + 3,
      x: br.cx * TILE + 8, y: (br.cy - 2) * TILE + 8, spawned: false,
    };
    z.bossArena = { x: br.cx * TILE + 8, y: br.cy * TILE + 8, r: 150 };
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      addProp(z, PROPS.pillarBone, br.cx * TILE + 8 + Math.cos(a) * 110, br.cy * TILE + 8 + Math.sin(a) * 82, { blocks: footBlock(12, 6) });
    }
  }

  z.bakeSolid();

  // Тот же проход, что в биомах: точки выбирались по карте тайлов, а стоять на
  // них потом кому-то с габаритом. В подземелье это заметнее — колонны и кости
  // стоят посреди комнат, и враг внутри колонны просто не участвует в бою.
  for (const sp2 of z.spawns) {
    const def = ENEMIES[sp2.key];
    if (!def) continue;
    const f = findSpot(z, sp2.x, sp2.y, def.r * 1.6, def.r, !!def.flying, 5);
    if (f.moved > 0) { sp2.x = f.x; sp2.y = f.y; }
  }
  // Сундуки: мало поместиться — надо ещё чтобы до них дошли. Рельеф иногда
  // оставляет карманы, отрезанные стенами, и разбросанный туда сундук виден на
  // миникарте, но недостижим: игрок ходит вокруг и не понимает, что не так.
  const reach = reachMask(z, z.spawnPoint.x, z.spawnPoint.y);

  // Страховка на случай, если расчёт всё же промахнулся: спуск обязан быть
  // достижим, иначе этаж — тупик и забег кончается ничем.
  if (z.downExit) {
    const cx2 = z.downExit.x + z.downExit.w / 2, cy2 = z.downExit.y + z.downExit.h / 2;
    const tx2 = Math.floor(cx2 / TILE), ty2 = Math.floor(cy2 / TILE);
    const okHere = tx2 >= 0 && ty2 >= 0 && tx2 < z.w && ty2 < z.h && reach[ty2 * z.w + tx2];
    if (!okHere) {
      const near = nearestReachable(z, reach, cx2, cy2, 24);
      if (near) {
        const dx2 = near.x - cx2, dy2 = near.y - cy2;
        z.downExit.x += dx2; z.downExit.y += dy2;
        if (z.stairProp) { z.stairProp.x += dx2; z.stairProp.y += dy2; z.stairProp.sortY += dy2; }
      }
    }
  }

  for (const c of z.chests) {
    const f = findSpot(z, c.x, c.y, 11, 9, false, 4);
    if (f.moved > 0) { c.x = f.x; c.y = f.y; }
    const tx = Math.floor(c.x / TILE), ty = Math.floor(c.y / TILE);
    if (reach[ty * z.w + tx]) continue;
    const near = nearestReachable(z, reach, c.x, c.y, 20);
    if (near) { c.x = near.x; c.y = near.y; }
  }

  z.bakeGround();
  z.weather = null;
  z.ambient = darkenForFloor(floor);
  z.grade = BIOMES.dungeon.grade;
  z.wind = 0;              // под землёй ветра нет
  z.dappleStrength = 0;    // и солнца тоже
  // У подземелья потолок не от биома, а от глубины: этажи покрывают всю игру.
  z.maxRarity = rarityCapFor(z.level);
  z.haze = null;           // и далей
  z.music = boss ? 'boss' : 'dungeon';
  z.dustColor = '#3d3750';
  z.playerLight = (96 - Math.min(30, floor * 1.5)) * (mod.light || 1);
  return z;
}

function corridor(z, ax, ay, bx, by, rng) {
  const horizFirst = rng() < 0.5;
  const carve = (x, y) => {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (Math.abs(ox) + Math.abs(oy) > 1) continue;
        const t = z.at(x + ox, y + oy);
        if (t === T.VOID || t === T.WALL) z.set(x + ox, y + oy, T.PATH);
      }
    }
  };
  let x = ax, y = ay;
  if (horizFirst) {
    while (x !== bx) { x += Math.sign(bx - x); carve(x, y); }
    while (y !== by) { y += Math.sign(by - y); carve(x, y); }
  } else {
    while (y !== by) { y += Math.sign(by - y); carve(x, y); }
    while (x !== bx) { x += Math.sign(bx - x); carve(x, y); }
  }
}

function darkenForFloor(floor) {
  const t = Math.min(1, floor / 16);
  const r = Math.round(46 - 24 * t), g = Math.round(40 - 22 * t), b = Math.round(74 - 30 * t);
  return `rgb(${r},${g},${b})`;
}
