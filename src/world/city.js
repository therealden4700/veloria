// Велория — безопасный город: лавки, тренер, доска заданий и порталы к биомам.

import { T, TILE } from '../art/tiles.js';
import { PROPS } from '../art/props.js';
import { RAMP } from '../art/palette.js';
import { bakeNPC } from '../art/sprites.js';
import { Zone, addProp, footBlock } from './zone.js';
import { BIOMES, OVERWORLD } from './biomes.js';
import { makeRng, warpFbm } from '../core/rng.js';
import { TAU } from '../core/util.js';

export const NPC_DEFS = [
  {
    id: 'smith', name: 'Кузнец Борин', title: 'оружейных дел мастер',
    look: { skin: RAMP.skin, cloth: RAMP.crimson, apron: '#4a2f1f', scale: 1.1 },
    shop: 'smith',
    smith: true,
    lines: [
      'Металл не врёт, парень. Врут только те, кто им торгует… но я честный.',
      'Принеси руду — выкую что-нибудь стоящее. А пока бери, что есть.',
      'Клинок тупится не о шкуру, а о нерешительность.',
      'Точить берусь, но металл иногда не выдерживает. Уговор такой: рискуешь ты.',
    ],
  },
  {
    id: 'armorer', name: 'Оружейница Мира', title: 'доспехи и обереги',
    look: { skin: RAMP.skin, cloth: RAMP.steel, scale: 1.0, hat: '#3a4a7a' },
    shop: 'armory',
    lines: [
      'Живой герой лучше красивого. Бери броню, а не побрякушки… хотя побрякушки тоже есть.',
      'В Мёрзлом кряже без тёплой стали делать нечего.',
    ],
  },
  {
    id: 'alchemist', name: 'Алхимик Сельвин', title: 'зелья и настойки',
    look: { skin: RAMP.skinPale, cloth: RAMP.arcane, scale: 0.95, hood: true, eye: '#c99cff' },
    shop: 'alchemy',
    lines: [
      'Всё есть яд, и всё есть лекарство. Вопрос лишь в цене… и цена вот такая.',
      'Свиток возврата спас больше жизней, чем весь городской гарнизон.',
    ],
  },
  {
    id: 'trainer', name: 'Мастер Кален', title: 'наставник',
    look: { skin: RAMP.skin, cloth: RAMP.leather, scale: 1.15, weapon: 'spear', weaponRamp: RAMP.iron },
    trainer: true,
    lines: [
      'Сила растёт не от ударов, а от того, что ты после них встаёшь.',
      'Есть очки развития? Вкладывай. Мёртвым они ни к чему.',
    ],
  },
  {
    id: 'captain', name: 'Капитан Дрейн', title: 'гильдия искателей',
    look: { skin: RAMP.skin, cloth: RAMP.gold, scale: 1.1, weapon: 'sword', weaponRamp: RAMP.steel },
    quests: true,
    lines: [
      'Велория держится, пока кто-то ходит за её стены. Сегодня это ты.',
      'Задания на доске. Награда — золотом и уважением. Уважение бесплатно.',
    ],
  },
  {
    id: 'runesmith', name: 'Рунная ткачиха Сивилла', title: 'руны умений',
    look: { skin: RAMP.skinPale, cloth: RAMP.emerald, scale: 0.95, hat: '#2f7a4a', eye: '#8ff0b0' },
    shop: 'runes',
    lines: [
      'Умение живёт в камне, а не в руке. Вставь руну — и рука вспомнит, что делать.',
      'Три знака сразу носить можно. Четвёртый — тот, что молчит и работает всегда.',
      'Не бывает плохих рун. Бывают вставленные не в тот бой.',
    ],
  },
  {
    id: 'keeper', name: 'Хранитель врат Азель', title: 'смотритель порталов',
    look: { skin: RAMP.skinPale, cloth: RAMP.arcane, scale: 1.0, hood: true, eye: '#7ae8ff', weapon: 'staff', weaponRamp: RAMP.arcane },
    portalMaster: true,
    lines: [
      'Врата помнят каждого, кто прошёл. И не всех возвращают.',
      'Открытые дороги — те, что по силам. Остальные подождут твоего роста.',
    ],
  },
];

export function generateCity(seed = 1234) {
  const rng = makeRng(seed);
  const W = 64, H = 48;
  const z = new Zone(W, H, 'city', 'city');
  z.level = 1;
  z.safe = true;
  z.name = 'Велория';

  // ── земля
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let t = T.GROUND;
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      if (edge < 2) t = T.WALL;
      // вытоптанные проплешины — связными пятнами, а не отдельными клетками
      else if (warpFbm(x * 0.13, y * 0.13, 7717, 3, 1.3) > 0.65) t = T.GROUND2;
      z.set(x, y, t);
    }
  }

  // городская стена
  for (let x = 2; x < W - 2; x++) { z.set(x, 2, T.WALL); z.set(x, H - 3, T.WALL); }
  for (let y = 2; y < H - 2; y++) { z.set(2, y, T.WALL); z.set(W - 3, y, T.WALL); }
  // ворота
  for (let y = 22; y <= 26; y++) { z.set(2, y, T.PATH); z.set(3, y, T.PATH); z.set(W - 3, y, T.PATH); }

  // ── дороги и площадь
  const cx = 32, cy = 25;
  for (let x = 3; x < W - 3; x++) for (let y = cy - 2; y <= cy + 2; y++) z.set(x, y, T.PATH);
  for (let y = 6; y < H - 5; y++) for (let x = cx - 2; x <= cx + 2; x++) z.set(x, y, T.PATH);
  for (let y = -9; y <= 9; y++) {
    for (let x = -11; x <= 11; x++) {
      if (x * x * 0.7 + y * y * 1.2 <= 92) z.set(cx + x, cy + y, T.PATH);
    }
  }
  // площадь порталов
  for (let y = -5; y <= 4; y++) for (let x = -13; x <= 13; x++) {
    if (x * x * 0.4 + y * y * 1.6 <= 46) z.set(cx + x, 10 + y, T.PATH);
  }

  // Пруд в юго-западном углу.
  //
  // Раньше он лежал на клетке [13,38] и накрывал собой лавку алхимика [15,36]:
  // вход в лавку и сам Сельвин оказывались под водой, обойти пруд можно было
  // только с востока. Смещён в угол — от лавки теперь полторы клетки суши.
  for (let y = 35; y < 43; y++) for (let x = 4; x < 13; x++) {
    const d = Math.hypot(x - 8, y - 39);
    if (d < 3.6) z.set(x, y, T.LIQUID);
  }

  // ── фонтан
  addProp(z, PROPS.fountain, cx * TILE + 8, cy * TILE + 14, { anim: true, fps: 9 , blocks: footBlock(40, 12) });
  z.lights.push({ x: cx * TILE + 8, y: cy * TILE, r: 74, color: 'rgba(150,200,255,0.30)' });

  // ── здания
  // Блок постройки — не её силуэт, а полоса земли под передней стеной. Отступ
  // от краёв канваса нужен потому, что низ спрайта шире стены на пару пикселей
  // тени: без него герой упирался бы в тень.
  const baseBlock = (c, inset) => footBlock(c.width - inset * 2, 16);

  const B = [
    { key: 'smithy',  tx: 15, ty: 17, npc: 'smith' },
    { key: 'armory',  tx: 49, ty: 17, npc: 'armorer' },
    { key: 'alchemy', tx: 15, ty: 36, npc: 'alchemist' },
    { key: 'guild',   tx: 49, ty: 36, npc: 'captain' },
  ];
  for (const b of B) {
    const c = PROPS[b.key];
    const px = b.tx * TILE + 8, py = b.ty * TILE + 8;
    addProp(z, c, px, py, { blocks: baseBlock(c, 4) });
    z.lights.push({ x: px, y: py - 26, r: 84, color: 'rgba(255,190,110,0.45)', flicker: 0.08 });
    b.px = px; b.py = py;
  }
  // жилые дома
  // Дома [25,12] и [39,12] убраны: они стояли в одном ряду с порталами
  // (клетки 20, 26, 32, 38, 44 при y=12) и загораживали к ним подход.
  const houses = [[24, 41], [40, 41], [9, 25], [55, 25]];
  houses.forEach((h, i) => {
    const c = PROPS.house[i % PROPS.house.length];
    const px = h[0] * TILE + 8, py = h[1] * TILE + 8;
    addProp(z, c, px, py, { blocks: baseBlock(c, 5) });
    z.lights.push({ x: px, y: py - 22, r: 62, color: 'rgba(255,180,100,0.35)', flicker: 0.06 });
  });

  // ── порталы к биомам
  const dests = OVERWORLD.map((id) => ({ id, biome: BIOMES[id] }));
  dests.push({ id: 'dungeon', biome: BIOMES.dungeon });
  dests.forEach((d, i) => {
    const px = (cx - 12 + i * 6) * TILE + 8;
    const py = 12 * TILE;
    const p = addProp(z, PROPS[d.biome.portal], px, py + 20, { anim: true, fps: 12, tag: 'portal', data: d.id });
    p.portalTo = d.id;
    z.lights.push({ x: px, y: py, r: 76, color: portalGlow(d.id), flicker: 0.18 });
    z.exits.push({
      x: px - 16, y: py - 8, w: 32, h: 30,
      dest: d.id === 'dungeon' ? { kind: 'dungeon', floor: 1 } : { kind: 'biome', id: d.id },
      label: d.biome.name,
      requireLevel: d.id === 'dungeon' ? 3 : (d.biome.unlockLevel || 1),
      biomeId: d.id,
    });
    addProp(z, PROPS.sign, px - 20, py + 22, {});
  });

  // ── украшения
  addProp(z, PROPS.statue, (cx - 9) * TILE, (cy + 8) * TILE, { blocks: footBlock(20, 7) });
  addProp(z, PROPS.statue, (cx + 9) * TILE, (cy + 8) * TILE, { blocks: footBlock(20, 7) });
  addProp(z, PROPS.anvil, 15 * TILE + 26, 19 * TILE + 8, { blocks: footBlock(14, 5) });

  // факелы вдоль дорог
  for (let i = 0; i < 14; i++) {
    const tx = 8 + i * 3.4, ty = i % 2 ? cy - 4 : cy + 4;
    if (Math.abs(tx - cx) < 12) continue;
    const px = (tx | 0) * TILE + 8, py = (ty | 0) * TILE + 12;
    addProp(z, PROPS.torch, px, py, { anim: true, fps: 10 });
    z.lights.push({ x: px, y: py - 18, r: 66, color: 'rgba(255,170,80,0.62)', flicker: 0.3 });
  }
  for (let i = 0; i < 8; i++) {
    const px = (cx - 12 + i * 3.4 | 0) * TILE + 8, py = 16 * TILE;
    addProp(z, PROPS.torch, px, py, { anim: true, fps: 10 });
    z.lights.push({ x: px, y: py - 18, r: 62, color: 'rgba(190,150,255,0.55)', flicker: 0.24 });
  }

  // знамёна у стен
  for (let i = 0; i < 6; i++) {
    addProp(z, i % 2 ? PROPS.banner : PROPS.bannerBlue, (6 + i * 10) * TILE, 4 * TILE + 8, {});
  }

  // Где будут стоять торговцы. Список нужен уже здесь: разброс украшений обязан
  // обойти эти точки стороной — иначе дерево встаёт на лавочника, и поговорить с
  // ним нельзя. Один раз так и вышло: сдвинули пруд, клетка под алхимиком
  // высохла, и на ней тут же выросло дерево.
  const npcPos = {
    smith:     { x: 15 * TILE + 8, y: 21 * TILE + 4 },
    armorer:   { x: 49 * TILE + 8, y: 21 * TILE + 4 },
    alchemist: { x: 15 * TILE + 8, y: 40 * TILE + 4 },
    captain:   { x: 49 * TILE + 8, y: 40 * TILE + 4 },
    trainer:   { x: (cx + 6) * TILE, y: (cy + 4) * TILE },
    keeper:    { x: (cx + 12) * TILE, y: 13 * TILE },
    runesmith: { x: (cx - 11) * TILE, y: 14 * TILE },
  };

  /** Занято ли место торговцем или уже поставленным объектом с блоком. */
  const occupied = (px, py) => {
    for (const n of Object.values(npcPos)) if (Math.hypot(px - n.x, py - n.y) < 26) return true;
    for (const p of z.props) {
      if (!p.blocks) continue;
      const [bx, by, bw, bh] = p.blocks;
      if (px > p.x + bx - 12 && px < p.x + bx + bw + 12 &&
          py > p.y + by - 14 && py < p.y + by + bh + 14) return true;
    }
    return false;
  };

  // деревья и кусты по периметру
  for (let i = 0; i < 60; i++) {
    const x = rng.int(4, W - 5), y = rng.int(4, H - 5);
    if (z.at(x, y) !== T.GROUND && z.at(x, y) !== T.GROUND2) continue;
    const near = Math.hypot(x - cx, y - cy) < 14 || Math.abs(y - 12) < 6;
    if (near) continue;
    const px = x * TILE + 8, py = y * TILE + 14;
    if (occupied(px, py)) continue;
    if (rng() < 0.45) {
      const v = PROPS.treeOak;
      addProp(z, v[(rng() * v.length) | 0], px, py, {
        blocks: footBlock(8, 6), sway: 0.022 + rng() * 0.014, swaySpeed: 0.5 + rng() * 0.4,
      });
    } else if (rng() < 0.5) {
      const v = PROPS.bush;
      addProp(z, v[(rng() * v.length) | 0], px, py, { sway: 0.05, swaySpeed: 1.1 });
    } else {
      addProp(z, rng() < 0.5 ? PROPS.barrel : PROPS.crate, px, py, { blocks: footBlock(10, 5) });
    }
  }

  // трава на газонах и камешки на мостовой
  for (let y = 4; y < H - 4; y++) {
    for (let x = 4; x < W - 4; x++) {
      const t = z.at(x, y);
      const px = x * TILE + 8 + (rng() - 0.5) * 10, py = y * TILE + 12 + (rng() - 0.5) * 8;
      if ((t === T.GROUND || t === T.GROUND2) && rng() < 0.34) {
        const v = PROPS.grass;
        addProp(z, v[(rng() * v.length) | 0], px, py, {
          sway: 0.10 + rng() * 0.09, swaySpeed: 1.4 + rng() * 0.9, flat: true,
        });
      } else if (t === T.PATH && rng() < 0.06) {
        const v = PROPS.detail;
        addProp(z, v[(rng() * v.length) | 0], px, py, { flat: true, sortBias: -2 });
      }
    }
  }

  // ── NPC (позиции объявлены выше, до разброса украшений)
  for (const def of NPC_DEFS) {
    const p = npcPos[def.id];
    z.npcs.push({
      ...def,
      x: p.x, y: p.y,
      spr: bakeNPC(def.look),
      animT: Math.random(), flip: false, bubble: 0,
    });
  }

  z.spawnPoint = { x: cx * TILE + 8, y: (cy + 7) * TILE };
  z.bakeSolid();
  z.bakeGround();
  z.weather = null;
  z.ambient = '#ffffff';
  z.grade = null;
  z.wind = BIOMES.city.wind ?? 1;
  z.dappleStrength = BIOMES.city.dapple ?? 0;
  z.maxRarity = BIOMES.city.maxRarity || 'legendary';
  z.haze = BIOMES.city.haze || null;
  z.music = 'city';
  z.dustColor = '#6b6b7c';
  return z;
}

function portalGlow(id) {
  return {
    forest: 'rgba(90,220,140,0.55)',
    swamp: 'rgba(140,220,80,0.55)',
    frost: 'rgba(120,200,255,0.55)',
    ember: 'rgba(255,130,50,0.6)',
    breach: 'rgba(160,110,232,0.6)',
    dungeon: 'rgba(160,100,255,0.55)',
  }[id] || 'rgba(255,200,120,0.5)';
}
