// Процедурные спрайты существ. Вместо ручного пиксель-арта — «бумажные куклы»:
// пять семейств форм (гуманоид, зверь, слизь, летун, голем), каждое параметризуется
// палитрой, размером и деталями. Кадры анимации запекаются один раз при загрузке.

import { makeCanvas, rect, box, ellipse, line, px, outline, shadow, mirror, glow, dither, rimLight, inkAndRim, bakeFrame } from './pixel.js';
import { RAMP, INK, TIER_RAMP, rgba, shade } from './palette.js';
import { TAU } from '../core/util.js';
import { makeRng } from '../core/rng.js';

// ─────────────────────────────────────────── оружие

export function drawBlade(g, x, y, ang, len, ramp, type = 'sword') {
  const cx = Math.cos(ang), sy = Math.sin(ang);
  const tipX = x + cx * len, tipY = y + sy * len;
  // рукоять
  line(g, x - cx * 4, y - sy * 4, x - cx * 1, y - sy * 1, RAMP.wood[1], 2);
  px(g, Math.round(x - cx * 5), Math.round(y - sy * 5), ramp[3]);

  if (type === 'staff') {
    line(g, x - cx * 5, y - sy * 5, tipX, tipY, RAMP.wood[2], 2);
    line(g, x - cx * 5, y - sy * 5, tipX, tipY, RAMP.wood[3], 1);
    ellipse(g, tipX, tipY, 2.4, 2.4, ramp[2]);
    ellipse(g, tipX - 0.5, tipY - 0.5, 1.2, 1.2, ramp[3]);
    return;
  }
  if (type === 'bow') {
    for (let i = -6; i <= 6; i++) {
      const a = ang + (i / 6) * 1.15;
      px(g, Math.round(x + Math.cos(a) * 6), Math.round(y + Math.sin(a) * 6), RAMP.wood[2]);
    }
    line(g, x + Math.cos(ang - 1.15) * 6, y + Math.sin(ang - 1.15) * 6,
            x + Math.cos(ang + 1.15) * 6, y + Math.sin(ang + 1.15) * 6, RAMP.bone[2], 1);
    return;
  }
  // клинок
  line(g, x, y, tipX, tipY, ramp[1], 2);
  line(g, x + cx, y + sy, tipX, tipY, ramp[3], 1);
  // гарда
  const px_ = -sy, py_ = cx;
  line(g, x - px_ * 2.5, y - py_ * 2.5, x + px_ * 2.5, y + py_ * 2.5, ramp[2], 1);

  if (type === 'axe') {
    const hx = x + cx * (len - 3), hy = y + sy * (len - 3);
    ellipse(g, hx + px_ * 2, hy + py_ * 2, 3, 3.4, ramp[2]);
    ellipse(g, hx + px_ * 2.4, hy + py_ * 2.4, 1.6, 2.2, ramp[3]);
  } else if (type === 'spear') {
    ellipse(g, tipX, tipY, 1.6, 2.6, ramp[3]);
  }
}

// ─────────────────────────────────────────── герой

// Герой выше прежнего: крупная голова и длинные ноги в 38 пикселей не влезали.
// Запас сверху нужен под гребень с 3-го ранга и рога с 5-го — они рисуются
// выше макушки и на 44 пикселях срезались.
// Размер согласован с горожанами: у NPC фигура 24 пикселя, у героя 26–28.
// Чуть выше жителя, но не в полтора раза — раньше он был 47 и смотрелся
// великаном рядом с любым человеком в кадре.
const HERO_W = 28, HERO_H = 36, GROUND = 30, HCX = 14;
const HERO_ACCENT = ['#141f3e', '#25396e', '#3a5aa0', '#7fa8e0'];

/**
 * Кадр героя. Собирается из слоёв, как бумажная кукла: плащ, ноги, торс,
 * набедренники, руки, наплечники, голова, шлем, оружие.
 * cfg: { dir, pose, t (0..1), armorTier, weaponTier, weaponType, cape }
 */
export function drawHero(g, cfg) {
  const { dir = 0, pose = 'idle', t = 0 } = cfg;
  const tier = Math.min(6, cfg.armorTier | 0);
  const arm = TIER_RAMP[tier];
  const wep = TIER_RAMP[Math.min(6, cfg.weaponTier | 0)];
  const lea = RAMP.leather;
  const wt = cfg.weaponType || 'sword';
  const back = dir === 3;
  const side = dir === 2;          // влево — отражение
  const cx = HCX;

  let bob = 0, legA = 0, legB = 0, armA = 0, armB = 0, lean = 0, crouch = 0;

  if (pose === 'walk') {
    const p = Math.sin(t * TAU);
    legA = p * 3; legB = -p * 3;
    armA = -p * 2.2; armB = p * 2.2;
    bob = Math.abs(Math.sin(t * TAU * 2)) > 0.5 ? -1 : 0;
  } else if (pose === 'idle') {
    bob = Math.sin(t * TAU) > 0.2 ? -1 : 0;
    armA = armB = bob * 0.5;
  } else if (pose === 'dash') {
    lean = 3; bob = -2; legA = 3.5; legB = -3.5; crouch = 1;
  } else if (pose === 'hurt') {
    lean = -3; bob = 1; crouch = 1;
  } else if (pose === 'cast') {
    bob = Math.sin(t * TAU * 2) > 0 ? -1 : 0;
    armA = -3; armB = -3;
  } else if (pose === 'attack') {
    const k = t < 0.3 ? -1 : 1.5;
    lean = k; armB = t < 0.3 ? -2 : 1;
  }

  shadow(g, cx, GROUND + 1, 7, 2, 0.26);
  if (pose === 'dead') { drawHeroDead(g, arm, wep, wt); return; }

  const gy = GROUND + bob;
  const lx = cx + lean;

  // ── оружие в замахе уходит за спину
  const wepBehind = (pose === 'attack' && t < 0.32) || back;
  if (wepBehind) drawHeroWeapon(g, pose, wep, wt, dir, t, gy, lean);

  // ── плащ: со спины полотно шире, спереди видны только края.
  // Раньше он появлялся с 10-го уровня; теперь есть всегда — это опознавательный
  // знак игрока, а cfg.cape лишь перекрашивает его.
  const cape = cfg.cape || HERO_ACCENT;
  {
    const sw = Math.sin(t * TAU) * 1.5 + lean * 0.6;
    const len = 9 - crouch * 2;
    for (let i = 0; i < len; i++) {
      const k = i / len;
      const wd = (back ? 13 : side ? 7 : 14) - k * 5 + Math.sin(k * 6 + t * TAU) * 0.6;
      const off = sw * k * k;
      const col = i < 2 ? cape[0] : (i + (sw > 0 ? 0 : 1)) % 5 === 0 ? cape[0] : cape[1];
      rect(g, lx - wd / 2 + off, gy - 15 + i, wd, 1, col);
    }
    px(g, lx - 3, gy - 15, RAMP.gold[2]);
    px(g, lx + 2, gy - 15, RAMP.gold[2]);
  }

  // ── ноги короткие и толстые: у коренастого силуэта они не должны тянуться
  const legTop = gy - 6 + crouch;
  if (side) {
    heroLeg(g, lx - 1 + legB, legTop, arm, lea, true);
    heroLeg(g, lx - 1 + legA, legTop, arm, lea, true);
  } else {
    heroLeg(g, lx - 4 + legA * 0.6, legTop, arm, lea, false);
    heroLeg(g, lx + 0 + legB * 0.6, legTop, arm, lea, false);
  }

  // ── кираса: объём даёт не контур, а три тона поперёк — плоская заливка
  // читалась как картонка
  const tw = side ? 9 : 12;
  const ty = gy - 14 + crouch;
  for (let i = 0; i < 7; i++) {
    const wd = tw - Math.round(i * 0.3);
    const x0 = lx - wd / 2;
    rect(g, x0, ty + i, wd, 1, arm[1]);
    rect(g, x0, ty + i, Math.max(1, (wd * 0.3) | 0), 1, arm[2]);        // свет слева
    rect(g, x0 + wd - 2, ty + i, 2, 1, arm[0]);                          // тень справа
  }
  rect(g, lx - tw / 2 + 1, ty, tw - 2, 1, arm[3]);
  if (!back) {
    rect(g, lx - 1, ty + 1, 2, 4, arm[3]);             // рёберный гребень кирасы
    rect(g, lx, ty + 1, 1, 4, arm[2]);
    rect(g, lx - 4, ty + 3, 3, 1, arm[2]);             // грудные пластины
    rect(g, lx + 2, ty + 3, 3, 1, arm[0]);
  } else {
    rect(g, lx - 1, ty + 1, 2, 5, arm[0]);
  }
  // пояс и латная юбка
  rect(g, lx - tw / 2 + 1, ty + 6, tw - 2, 2, lea[1]);
  rect(g, lx - tw / 2 + 1, ty + 6, tw - 2, 1, lea[2]);
  rect(g, lx - 2, ty + 6, 4, 2, RAMP.gold[2]);
  px(g, lx, ty + 6, RAMP.gold[3]);
  // Юбка короткая: длинная закрывала ноги целиком, и рыцарь стоял на двух
  // коричневых кирпичах вместо ног.
  for (const dx of side ? [-3] : [-5, -1]) {
    box(g, lx + dx, ty + 8, 4, 2, arm[1], 0);
    rect(g, lx + dx, ty + 8, 4, 1, arm[2]);
  }

  // ── руки
  const ay = ty + 3;
  if (side) {
    heroArm(g, lx - 2, ay + armB, arm, lea, tier);
  } else {
    heroArm(g, lx - 7, ay + armA, arm, lea, tier);
    heroArm(g, lx + 4, ay + armB, arm, lea, tier);
  }

  // ── наплечники. Самая широкая точка силуэта — именно они: так рыцарь
  // читается тяжёлым, а не худым человеком в рубахе.
  // Наплечник садится ВНАХЛЁСТ на плечо, а не рядом с ним: вынесенный в сторону
  // он читался крылом, оторванным от корпуса.
  const pw = tier >= 2 ? 3.4 : 2.9;
  const shy = ty + 2;
  if (side) {
    ellipse(g, lx + 1, shy, pw, pw * 0.78, arm[1]);
    ellipse(g, lx, shy - 1, pw * 0.68, pw * 0.5, arm[2]);
    ellipse(g, lx - 0.6, shy - 1.8, pw * 0.4, pw * 0.28, arm[3]);
  } else {
    for (const sgn of [-1, 1]) {
      const sx2 = lx + sgn * (tw / 2 - 1);
      ellipse(g, sx2, shy, pw, pw * 0.78, arm[1]);
      ellipse(g, sx2 - 0.8, shy - 1, pw * 0.68, pw * 0.5, arm[2]);
      ellipse(g, sx2 - 1.2, shy - 1.8, pw * 0.4, pw * 0.28, arm[3]);
      rect(g, sx2 - pw + 1, shy + 3, pw * 2 - 2, 1, arm[0]);
      // шипы: силуэт плеча перестаёт быть гладким комом
      const sc = tier >= 4 ? RAMP.gold : RAMP.bone;
      for (let k = -1; k <= 1; k++) {
        rect(g, sx2 + k * 2, shy - 3, 1, 2, sc[2]);
        px(g, sx2 + k * 2, shy - 4, sc[3]);
      }
    }
  }

  // ── щит в свободной руке. Только для ближнего оружия: лучник со щитом
  // выглядел бы нелепо, а обе руки у него заняты.
  const wtNow = cfg.weaponType || 'sword';
  if (!back && (wtNow === 'sword' || wtNow === 'axe' || wtNow === 'spear') && pose !== 'dash') {
    const sx3 = lx - (side ? 4 : 7), sy3 = ty + 3;
    const rim = tier >= 4 ? RAMP.gold : RAMP.iron;
    for (let i = 0; i < 7; i++) {
      const wd = i < 5 ? 5 : 5 - (i - 4) * 1.6;
      rect(g, sx3 - wd / 2 + 2.5, sy3 + i, wd, 1, i < 2 ? arm[2] : arm[1]);
    }
    rect(g, sx3, sy3, 5, 1, rim[2]);
    rect(g, sx3, sy3, 1, 6, rim[1]);
    rect(g, sx3 + 4, sy3, 1, 6, rim[0]);
    rect(g, sx3 + 2, sy3 + 2, 1, 3, cape[1]);            // герб цвета плаща
  }

  // ── голова
  // голова поднята: без просвета шлем сливался с наплечниками в один ком
  drawHeroHead(g, lx, gy - 22 + crouch, dir, tier, arm, cape);

  if (!wepBehind) drawHeroWeapon(g, pose, wep, wt, dir, t, gy, lean);
}

function heroArm(g, x, y, arm, lea, tier) {
  box(g, x, y, 3, 6, arm[1], 0);
  rect(g, x, y, 3, 1, arm[2]);
  if (tier >= 3) rect(g, x, y + 3, 3, 1, arm[2]);   // наруч
  rect(g, x, y + 6, 3, 2, lea[1]);                  // перчатка
  rect(g, x, y + 6, 3, 1, lea[2]);
}

function heroLeg(g, x, y, arm, lea, side) {
  const X = Math.round(x);
  box(g, X, y, 4, 4, arm[1], 0);
  rect(g, X, y, 4, 1, arm[2]);
  rect(g, X + 3, y + 1, 1, 3, arm[0]);
  box(g, X - (side ? 1 : 0), y + 4, 5, 2, lea[1], 0);   // сапог шире голени
  rect(g, X - (side ? 1 : 0), y + 4, 5, 1, lea[2]);
}

function drawHeroHead(g, cx, y, dir, tier, arm, cape) {
  const back = dir === 3, side = dir === 2 || dir === 1;
  const cr = cape || HERO_ACCENT;
  rect(g, cx - 2, y + 10, 5, 2, arm[0]);                 // горжет

  // Шлем-ведро с решётчатым забралом. Светящиеся глаза — главный опознавательный
  // знак: два ярких пятна на тёмном фоне читаются даже когда герой размером
  // с ноготь, тогда как черты лица на таком масштабе не читаются вовсе.
  ellipse(g, cx, y + 5, 5.2, 5.6, arm[1]);
  ellipse(g, cx - 1, y + 3.6, 3.4, 3, arm[2]);
  ellipse(g, cx - 1.2, y + 2.8, 1.9, 1.3, arm[3]);
  rect(g, cx - 5, y + 9, 10, 1, arm[0]);

  if (!back) {
    const ex = side ? 1 : 0;
    // тёмное поле забрала
    rect(g, cx - 4 + ex, y + 4, 8 - ex * 3, 5, INK);
    // решётка: вертикальные прутья
    for (let i = -3; i <= 3; i += 2) if (!side || i > -2) rect(g, cx + i + ex, y + 7, 1, 2, arm[0]);
    // светящиеся глаза
    const eye = '#b8ff3a';
    if (side) { rect(g, cx + 2, y + 5, 2, 2, eye); px(g, cx + 2, y + 5, '#f0ffc0'); }
    else {
      rect(g, cx - 3, y + 5, 2, 2, eye); rect(g, cx + 1, y + 5, 2, 2, eye);
      px(g, cx - 3, y + 5, '#f0ffc0'); px(g, cx + 1, y + 5, '#f0ffc0');
    }
    rect(g, cx - 1, y + 1, 2, 3, arm[3]);                // ребро по центру купола
  } else {
    rect(g, cx - 1, y + 2, 2, 7, arm[2]);
  }

  // ── рога: с них шлем и читается рыцарским, поэтому есть всегда
  // Рог толстый у основания и сходит на остриё, загибаясь внутрь: тонкая
  // линия постоянной ширины читалась антенной, а не рогом.
  const hc = tier >= 4 ? RAMP.gold : RAMP.bone;
  for (const sgn of [-1, 1]) {
    if (side && sgn < 0) continue;
    const steps = [
      [3.8, 3, 2], [4.8, 2, 2], [5.4, 1, 1], [5.6, 0, 1], [5.2, -1, 1],
    ];
    steps.forEach(([dx, dy, w], i) => {
      const X = cx + sgn * dx - (sgn < 0 ? w - 1 : 0);
      rect(g, X, y + dy, w, 1, i < 2 ? hc[1] : i < 5 ? hc[2] : hc[3]);
      if (w > 1) px(g, sgn > 0 ? X : X + w - 1, y + dy, hc[0]);   // тень с внешней стороны
    });
  }

  // гребень акцентного цвета между рогами
  if (!back) for (let i = 0; i < 2; i++) rect(g, cx - 1, y - 1 - i, 2, 1, cr[3 - i]);
  if (tier >= 5 && !back) for (let i = 0; i < 2; i++) rect(g, cx - 1, y - 1 - i, 2, 1, RAMP.crimson[3 - i]);
}

function drawHeroWeapon(g, pose, wep, wt, dir, t, gy, lean) {
  const cx = HCX + lean;
  const hx = cx + (dir === 3 ? -6 : 6);
  const hy = gy - 12;   // высота хвата = плечо; пересчитана под новый рост
  const len = wt === 'spear' ? 13 : wt === 'dagger' ? 7 : 10;

  if (pose === 'attack') {
    // замах за спину → рубящая дуга → проводка
    const a = t < 0.32 ? -2.6 + t * 1.4 : -2.15 + Math.min(1, (t - 0.32) / 0.4) * 3.4;
    drawBlade(g, hx, hy, dir === 3 ? a - 1.1 : a, len, wep, wt);
  } else if (pose === 'cast') {
    drawBlade(g, hx, hy - 3, -1.45, len, wep, wt);
  } else if (pose === 'dash') {
    drawBlade(g, hx - 2, hy + 2, 2.7, len, wep, wt);
  } else if (pose === 'idle' && dir === 0 && (wt === 'sword' || wt === 'axe' || wt === 'spear')) {
    // Покой лицом к игроку: клинок остриём вниз по центру. Это та самая поза
    // с обложки — она и делает силуэт рыцарским, а не «человек с палкой сбоку».
    drawBlade(g, HCX + lean, gy - 16, 1.571, len + 1, wep, wt);
  } else {
    drawBlade(g, hx, hy, 1.32 + Math.sin(t * TAU) * 0.06, len, wep, wt);
  }
}

function drawHeroDead(g, arm, wep, wt) {
  const y = GROUND - 5, cx = HCX;
  ellipse(g, cx, y + 3, 9, 3.6, arm[1]);
  ellipse(g, cx, y + 2, 7.6, 2.6, arm[2]);
  rect(g, cx - 8, y + 4, 5, 2, RAMP.leather[1]);
  ellipse(g, cx - 8, y, 4.4, 3.8, RAMP.skin[2]);
  ellipse(g, cx - 8, y - 1, 3.6, 2.4, arm[1]);
  drawBlade(g, cx + 8, y + 1, 0.3, 11, wep, wt);
}

/** Запекает полный набор кадров героя под текущий внешний вид. */
export function bakeHero(app) {
  const poses = { idle: 4, walk: 8, attack: 6, dash: 2, hurt: 1, cast: 4, dead: 1 };
  const out = { w: HERO_W, h: HERO_H, ground: GROUND };
  for (const pose in poses) {
    const n = poses[pose];
    out[pose] = [];
    for (let d = 0; d < 4; d++) {
      const dir = d === 1 ? 2 : d;      // влево = отражённое «вправо»
      const frames = [];
      for (let f = 0; f < n; f++) {
        const g = bakeFrame(HERO_W, HERO_H,
          (c) => drawHero(c, { ...app, dir, pose, t: n > 1 ? f / n : 0 }),
          INK, [255, 244, 214], 0.42);
        frames.push(d === 1 ? mirror(g).canvas : g.canvas);
      }
      out[pose].push(frames);
    }
  }
  return out;
}

// ─────────────────────────────────────────── семейства монстров

/** Гуманоид: гоблины, скелеты, культисты, рыцари, йети, импы, личи. */
function famHumanoid(g, cx, gy, t, c) {
  const s = c.scale || 1;
  const skin = c.skin || RAMP.emerald;
  const cloth = c.cloth || RAMP.leather;
  const p = Math.sin(t * TAU);
  const bob = c.float ? Math.sin(t * TAU) * 1.6 : (Math.abs(Math.sin(t * TAU * 2)) > 0.55 ? -1 : 0);
  const y = gy + bob;
  const bodyH = Math.round(9 * s), headR = 4.4 * s;

  shadow(g, cx, gy + 2, 6 * s, 2.4 * s, c.float ? 0.18 : 0.32);

  if (c.wings) {
    const flap = Math.sin(t * TAU * 2) * 3;
    for (const sgn of [-1, 1]) {
      g.fillStyle = c.wingColor || RAMP.shadowy[2];
      for (let i = 0; i < 7; i++) {
        const wy = y - bodyH - 4 + i;
        const ww = (7 - Math.abs(i - 3)) * s;
        g.fillRect(Math.round(cx + sgn * (4 * s)), Math.round(wy + flap * 0.3), Math.round(sgn * ww), 1);
      }
    }
  }

  // ноги: дальняя темнее ближней
  if (!c.float) {
    const sw = p * 2 * s;
    const legW = Math.round(3.2 * s), legH = Math.round(6 * s);
    box(g, Math.round(cx - 3.8 * s + sw), y - legH, legW, legH, cloth[0], 0);
    rect(g, Math.round(cx - 3.8 * s + sw), y - 2, legW, 2, RAMP.leather[0]);
    box(g, Math.round(cx + 0.8 * s - sw), y - legH, legW, legH, cloth[1], 0);
    rect(g, Math.round(cx + 0.8 * s - sw), y - legH, legW, 1, cloth[2]);
    rect(g, Math.round(cx + 0.8 * s - sw), y - 2, legW, 2, RAMP.leather[1]);
  } else {
    // подол балахона тает в воздухе
    for (let i = 0; i < 8; i++) {
      const w = (7 - i * 0.7) * s;
      g.fillStyle = i > 5 ? rgba(cloth[0].replace('#', '#'), 0.5) : cloth[0];
      g.fillRect(Math.round(cx - w / 2 + Math.sin(t * TAU + i * 0.5) * 1.2), Math.round(y - 4 * s + i), Math.round(w), 1);
    }
  }

  // торс: свет сверху, тень по нижней кромке и справа
  const tx = Math.round(cx - 4.2 * s), tw = Math.round(8.4 * s), ty = Math.round(y - bodyH - 4 * s);
  box(g, tx, ty, tw, bodyH + 1, cloth[1], 1);
  rect(g, tx, ty, tw, Math.round(2.2 * s), cloth[2]);
  rect(g, tx + 1, ty + 1, tw - 2, 1, cloth[3]);
  rect(g, tx + tw - 1, ty + 2, 1, bodyH - 3, cloth[0]);
  rect(g, tx + 1, ty + bodyH - 1, tw - 2, 1, cloth[0]);
  if (c.belt) {
    rect(g, tx, Math.round(y - 5.4 * s), tw, Math.round(2 * s), RAMP.leather[1]);
    rect(g, tx, Math.round(y - 5.4 * s), tw, 1, RAMP.leather[2]);
    px(g, Math.round(cx), Math.round(y - 4.8 * s), RAMP.gold[2]);
  }
  if (c.fur) {
    for (let i = 0; i < 14; i++) {
      const fx = tx + 1 + ((i * 7) % (tw - 2));
      const fy = ty + 2 + ((i * 5) % (bodyH - 2));
      line(g, fx, fy, fx - 1, fy - 2, cloth[3], 1);
    }
  }

  // руки: плечо-шар, предплечье, кисть
  const aSw = p * 1.6 * s;
  for (const [sx, dir] of [[-5.6, -1], [5.6, 1]]) {
    const ax = cx + sx * s, ay = y - bodyH - 2.6 * s + aSw * dir;
    const tone = dir < 0 ? 0 : 1;
    ellipse(g, ax, ay - s * 0.6, 2.2 * s, 2 * s, cloth[tone + 1] || cloth[1]);
    box(g, Math.round(ax - 1.2 * s), Math.round(ay), Math.round(2.4 * s), Math.round(5 * s), skin[tone + 1] || skin[1], 0);
    rect(g, Math.round(ax - 1.2 * s), Math.round(ay), Math.round(2.4 * s), 1, skin[2]);
    ellipse(g, ax, ay + 5.4 * s, 1.7 * s, 1.5 * s, skin[tone + 1] || skin[1]);   // кисть
    if (c.claws) {
      px(g, Math.round(ax - 1.4 * s), Math.round(ay + 6.4 * s), RAMP.bone[3]);
      px(g, Math.round(ax + 1.2 * s), Math.round(ay + 6.4 * s), RAMP.bone[3]);
    }
  }

  // голова
  const hy = y - bodyH - 4 * s - headR;
  if (c.hood) {
    ellipse(g, cx, hy + 1, headR + 1, headR + 1.4, cloth[1]);
    ellipse(g, cx, hy + 2.4, headR - 0.6, headR - 0.4, '#05040c');
    px(g, Math.round(cx - 1.6 * s), Math.round(hy + 2), c.eye || '#ff4d4d');
    px(g, Math.round(cx + 1.2 * s), Math.round(hy + 2), c.eye || '#ff4d4d');
    if (c.glowEyes) glow(g, cx, hy + 2, 6 * s, rgba(c.eye || '#ff4d4d', 0.5), 0.8);
  } else {
    // шея, потом объёмная голова
    rect(g, Math.round(cx - 1.4 * s), Math.round(hy + headR - 1), Math.round(2.8 * s), Math.round(2 * s), skin[1]);
    if (c.ears) {   // уши рисуем до головы, чтобы уходили за неё
      line(g, cx - headR + 1, hy + 0.5, cx - headR - 3.4 * s, hy - 2.4 * s, skin[1], Math.max(1, Math.round(1.6 * s)));
      line(g, cx + headR - 1, hy + 0.5, cx + headR + 3.4 * s, hy - 2.4 * s, skin[2], Math.max(1, Math.round(1.6 * s)));
      px(g, Math.round(cx + headR + 3.4 * s), Math.round(hy - 2.4 * s), skin[3]);
    }
    orb(g, cx, hy + 1, headR, headR, skin);
    // надбровье и скула
    ellipse(g, cx, hy - 0.6 * s, headR * 0.9, headR * 0.32, skin[3]);
    ellipse(g, cx, hy + 2.6 * s, headR * 0.72, headR * 0.34, skin[1]);
    // глаза в тени
    const ew = Math.max(1, Math.round(1.4 * s));
    rect(g, Math.round(cx - 2.7 * s), Math.round(hy - 0.2 * s), ew + 1, Math.max(2, Math.round(2 * s)), INK);
    rect(g, Math.round(cx + 1.4 * s), Math.round(hy - 0.2 * s), ew + 1, Math.max(2, Math.round(2 * s)), INK);
    rect(g, Math.round(cx - 2.4 * s), Math.round(hy + 0.2 * s), ew, Math.max(1, Math.round(1.2 * s)), c.eye || '#ffe66a');
    rect(g, Math.round(cx + 1.6 * s), Math.round(hy + 0.2 * s), ew, Math.max(1, Math.round(1.2 * s)), c.eye || '#ffe66a');
    // пасть
    rect(g, Math.round(cx - 1.8 * s), Math.round(hy + 2.6 * s), Math.round(3.6 * s), Math.max(1, Math.round(1.2 * s)), INK);
    if (c.tusks) {
      px(g, Math.round(cx - 1.8 * s), Math.round(hy + 3.6 * s), RAMP.bone[3]);
      px(g, Math.round(cx + 1.8 * s), Math.round(hy + 3.6 * s), RAMP.bone[3]);
      px(g, Math.round(cx - 1.8 * s), Math.round(hy + 2.6 * s), RAMP.bone[2]);
      px(g, Math.round(cx + 1.8 * s), Math.round(hy + 2.6 * s), RAMP.bone[2]);
    } else {
      for (let i = 0; i < 3; i++) px(g, Math.round(cx - 1.4 * s + i * 1.4 * s), Math.round(hy + 2.6 * s), RAMP.bone[3]);
    }
  }
  if (c.horns) {
    line(g, cx - headR + 1, hy - headR + 1, cx - headR - 1.5 * s, hy - headR - 3 * s, c.hornColor || RAMP.bone[2], 1);
    line(g, cx + headR - 1, hy - headR + 1, cx + headR + 1.5 * s, hy - headR - 3 * s, c.hornColor || RAMP.bone[2], 1);
  }
  if (c.helm) {
    ellipse(g, cx, hy - 1, headR + 0.6, headR * 0.7, c.helmRamp ? c.helmRamp[1] : RAMP.iron[1]);
    rect(g, Math.round(cx - headR - 1), Math.round(hy), Math.round(headR * 2 + 2), 1, c.helmRamp ? c.helmRamp[2] : RAMP.iron[2]);
  }

  // оружие
  if (c.weapon) {
    const swing = c.attack ? -1.6 + t * 3 : 1.2 + Math.sin(t * TAU) * 0.12;
    drawBlade(g, Math.round(cx + 5.6 * s), Math.round(y - bodyH - 1 * s), swing, 9 * s, c.weaponRamp || RAMP.iron, c.weapon);
  }

  // щит на ближней руке — закрывает фронт, поэтому рисуется поверх всего
  if (c.shield) {
    const sr = c.shieldRamp || RAMP.iron;
    const sx = cx - 6.4 * s, sy = y - bodyH - 0.5 * s;
    ellipse(g, sx, sy, 4.6 * s, 5.6 * s, sr[0]);
    ellipse(g, sx, sy, 3.8 * s, 4.8 * s, sr[1]);
    ellipse(g, sx - 0.8 * s, sy - 1 * s, 2.4 * s, 2.8 * s, sr[2]);
    ellipse(g, sx, sy, 1.4 * s, 1.6 * s, sr[3]);
    rect(g, Math.round(sx - 4.6 * s), Math.round(sy - 0.5), Math.round(9.2 * s), 1, sr[2]);
  }

  // тотем лекаря
  if (c.totem) {
    const tx = cx + 6.6 * s, ty = y - bodyH - 2 * s;
    line(g, tx, ty + 8 * s, tx, ty - 3 * s, RAMP.wood[1], Math.max(1, Math.round(1.6 * s)));
    ellipse(g, tx, ty - 4 * s, 2.6 * s, 2.6 * s, c.totemColor || '#6fdc8c');
    ellipse(g, tx - 0.6, ty - 4.6 * s, 1.2 * s, 1.2 * s, '#e6ffe0');
    glow(g, tx, ty - 4 * s, 10 * s, rgba(c.totemColor || '#6fdc8c', 0.45), 0.9);
  }
}

/**
 * Объёмный «шар»: четыре слоя эллипсов со смещением к источнику света.
 * Базовый кирпич для голов, плеч, валунов и слизи — именно он убирает
 * ощущение фигуры, собранной из плоских примитивов.
 */
function orb(g, cx, cy, rx, ry, ramp, lx = -0.28, ly = -0.32) {
  ellipse(g, cx, cy, rx, ry, ramp[0]);
  ellipse(g, cx, cy - ry * 0.14, rx * 0.97, ry * 0.9, ramp[1]);
  ellipse(g, cx + rx * lx, cy + ry * ly, rx * 0.62, ry * 0.58, ramp[2]);
  ellipse(g, cx + rx * lx * 1.5, cy + ry * ly * 1.5, rx * 0.28, ry * 0.26, ramp[3]);
}

/** Лапа зверя: бедро, голень, ступня — с одним общим оттенком. */
function beastLeg(g, x, y, s, ramp, swing, tone) {
  const S = (v) => v * s;
  ellipse(g, x, y, S(2.6), S(3.2), ramp[tone]);                       // бедро
  rect(g, x - S(1.2) + swing * 0.4, y + S(1.6), S(2.4), S(4), ramp[tone]);
  ellipse(g, x + swing, y + S(5.6), S(2.2), S(1.2), ramp[tone + 1] || ramp[tone]);
  px(g, Math.round(x + swing + S(1.8)), Math.round(y + S(5.6)), RAMP.bone[3]);  // коготь
}

/** Зверь: волки, вепри, гончие. Дальние лапы темнее — это и даёт объём. */
function famBeast(g, cx, gy, t, c) {
  const s = c.scale || 1;
  const fur = c.fur || RAMP.stone;
  const S = (v) => v * s;
  const p = Math.sin(t * TAU);
  const bob = Math.abs(Math.sin(t * TAU * 2)) > 0.5 ? -1 : 0;
  const y = gy + bob;
  const bodyY = y - S(10);

  shadow(g, cx, gy + 1, S(9), S(2.6), 0.3);

  // ── дальняя пара лап: на тон темнее, поэтому уходит вглубь
  beastLeg(g, cx - S(5), bodyY + S(2), s, fur, p * S(2), 0);
  beastLeg(g, cx + S(4.5), bodyY + S(2), s, fur, -p * S(2), 0);

  // ── хвост из сегментов
  const tw = Math.sin(t * TAU * 2) * S(2.4);
  for (let i = 5; i >= 0; i--) {
    const k = i / 5;
    ellipse(g, cx - S(8) - k * S(7), bodyY - S(1) - k * S(3.4) + tw * k,
            S(2.8 - k * 1.1), S(2.6 - k * 1), i > 3 ? fur[2] : fur[1]);
  }

  // ── корпус: круп + грудная клетка, между ними перемычка
  ellipse(g, cx - S(4), bodyY, S(5.2), S(4.4), fur[1]);
  ellipse(g, cx + S(3.4), bodyY - S(0.6), S(5.8), S(4.8), fur[1]);
  rect(g, cx - S(4), bodyY - S(3.6), S(8), S(7), fur[1]);
  // свет сверху и тень на брюхе
  ellipse(g, cx - S(3), bodyY - S(2.6), S(4.4), S(2), fur[2]);
  ellipse(g, cx + S(3), bodyY - S(3.2), S(4.8), S(2.2), fur[2]);
  ellipse(g, cx + S(2), bodyY - S(4), S(2.6), S(1.1), fur[3]);
  ellipse(g, cx, bodyY + S(3.2), S(7), S(1.7), fur[0]);

  // ── загривок
  for (let i = 0; i < 6; i++) {
    const hx = cx - S(3) + i * S(2.2);
    line(g, hx, bodyY - S(4.2), hx + S(0.8), bodyY - S(6.6) - (i % 2) * S(0.8), fur[3], 1);
  }

  // ── шея и голова
  const hx = cx + S(9.5), hy = bodyY - S(4);
  rect(g, cx + S(5), hy + S(1), S(5), S(5), fur[1]);
  ellipse(g, cx + S(7), hy + S(1), S(3.4), S(3.4), fur[2]);          // холка светлее
  orb(g, hx, hy, S(4), S(3.6), fur);
  // морда клином
  ellipse(g, hx + S(3.2), hy + S(1.4), S(3.2), S(2), fur[2]);
  ellipse(g, hx + S(4.6), hy + S(1.6), S(1.8), S(1.3), fur[1]);
  px(g, Math.round(hx + S(6)), Math.round(hy + S(1.2)), INK);        // нос
  px(g, Math.round(hx + S(6)), Math.round(hy + S(0.4)), fur[3]);
  // пасть и клыки
  rect(g, Math.round(hx + S(3)), Math.round(hy + S(2.8)), Math.round(S(3.4)), 1, INK);
  px(g, Math.round(hx + S(3.4)), Math.round(hy + S(3.4)), RAMP.bone[3]);
  px(g, Math.round(hx + S(5)), Math.round(hy + S(3.4)), RAMP.bone[3]);
  // уши: дальнее темнее
  line(g, hx - S(1.4), hy - S(2.6), hx - S(2.6), hy - S(6.4), fur[0], Math.max(1, Math.round(s * 1.6)));
  line(g, hx + S(1.6), hy - S(2.8), hx + S(1.2), hy - S(6.8), fur[2], Math.max(1, Math.round(s * 1.6)));
  px(g, Math.round(hx + S(1.2)), Math.round(hy - S(6.8)), fur[3]);
  // глаз
  rect(g, Math.round(hx + S(1.6)), Math.round(hy - S(0.6)), Math.max(1, Math.round(S(1.6))), Math.max(1, Math.round(S(1.2))), c.eye || '#ffcf4a');
  px(g, Math.round(hx + S(1.6)), Math.round(hy - S(0.6)), '#ffffff');
  if (c.glowEyes) glow(g, hx + S(2), hy - S(0.2), 8 * s, rgba(c.eye || '#ffcf4a', 0.5), 0.9);

  if (c.spikes) {
    for (let i = -2; i <= 2; i++) {
      const sx = cx + i * S(2.6);
      line(g, sx, bodyY - S(4.6), sx + S(0.5), bodyY - S(9), c.spikeColor || RAMP.ice[3], 1);
      px(g, Math.round(sx), Math.round(bodyY - S(9)), '#ffffff');
    }
  }

  // ── ближняя пара лап поверх корпуса
  beastLeg(g, cx - S(3.5), bodyY + S(2.4), s, fur, -p * S(2.4), 1);
  beastLeg(g, cx + S(6), bodyY + S(2.4), s, fur, p * S(2.4), 1);
}

/** Слизь: пульсирующая полупрозрачная капля с натёками и бликом. */
function famBlob(g, cx, gy, t, c) {
  const s = c.scale || 1;
  const ramp = c.ramp || RAMP.slime;
  const sq = Math.sin(t * TAU);
  const rx = (7.4 + sq * 1.2) * s, ry = (6.2 - sq * 1.4) * s;
  const cy = gy - ry + 1;

  shadow(g, cx, gy + 1, rx * 0.95, 2.2 * s, 0.3);

  // натёки по низу — тело «растекается»
  for (let i = 0; i < 5; i++) {
    const a = -0.35 + (i / 4) * 3.8;
    const dx = Math.cos(a) * rx * 0.85;
    const dh = (1.4 + Math.abs(Math.sin(t * TAU + i * 1.7))) * s;
    ellipse(g, cx + dx, gy - dh * 0.4, 1.8 * s, dh, ramp[0]);
  }

  orb(g, cx, cy, rx, ry, ramp, -0.3, -0.34);
  // верхняя кромка ловит свет, нижняя тонет
  ellipse(g, cx, cy + ry * 0.62, rx * 0.8, ry * 0.3, ramp[0]);
  ellipse(g, cx - rx * 0.34, cy - ry * 0.52, rx * 0.26, ry * 0.24, '#ffffff');
  px(g, Math.round(cx - rx * 0.5), Math.round(cy - ry * 0.62), '#ffffff');

  // вздутая туша подрывника: нарывы по бокам
  if (c.bloat) {
    for (let i = 0; i < 5; i++) {
      const a = -0.5 + (i / 4) * 4.2;
      const bx = cx + Math.cos(a) * rx * 0.82, by = cy + Math.sin(a) * ry * 0.82;
      const br = (1.8 + Math.sin(t * TAU * 2 + i) * 0.5) * s;
      ellipse(g, bx, by, br, br, ramp[3]);
      ellipse(g, bx - 0.4, by - 0.4, br * 0.5, br * 0.5, '#fff0c0');
    }
  }

  // «проглоченное» ядро просвечивает изнутри
  if (c.core) {
    ellipse(g, cx + 1, cy + ry * 0.24, 2 * s, 1.7 * s, ramp[0]);
    ellipse(g, cx + 1, cy + ry * 0.2, 1.5 * s, 1.3 * s, c.core);
    glow(g, cx + 1, cy + ry * 0.2, 8 * s, rgba(c.core, 0.35), 0.9);
  }

  // глаза с бликом
  const ey = cy - ry * 0.12;
  const ew = Math.max(1, Math.round(1.8 * s)), eh = Math.max(2, Math.round(2.4 * s));
  rect(g, Math.round(cx - 3 * s), Math.round(ey), ew, eh, INK);
  rect(g, Math.round(cx + 1.4 * s), Math.round(ey), ew, eh, INK);
  px(g, Math.round(cx - 3 * s), Math.round(ey), '#ffffff');
  px(g, Math.round(cx + 1.4 * s), Math.round(ey), '#ffffff');
}

/** Летун: духи, летучие мыши, вороны, призраки. */
function famFloater(g, cx, gy, t, c) {
  const s = c.scale || 1;
  const ramp = c.ramp || RAMP.arcane;
  const bob = Math.sin(t * TAU) * 2.2;
  const y = gy - 12 * s + bob;

  shadow(g, cx, gy + 1, 5 * s, 1.8 * s, 0.16);

  if (c.wings) {
    const flap = Math.sin(t * TAU * 2);
    for (const sgn of [-1, 1]) {
      // перепончатое крыло: вытянутый веер с фестонами по краю
      for (let i = 0; i < 11; i++) {
        const k = i / 10;
        const ww = (11 - Math.abs(k - 0.25) * 9) * s;
        const wy = y - 5 * s + i * 1.15 * s + flap * (2 + i * 0.45);
        g.fillStyle = i < 3 ? ramp[2] : ramp[1];
        g.fillRect(Math.round(cx + sgn * 3 * s), Math.round(wy), Math.round(sgn * Math.max(1, ww)), 2);
      }
      g.fillStyle = ramp[3];
      g.fillRect(Math.round(cx + sgn * 3 * s), Math.round(y - 4 * s + flap * 2), Math.round(sgn * 9 * s), 1);
      // косточки крыла
      g.fillStyle = ramp[0];
      for (let i = 1; i <= 2; i++) {
        line(g, cx + sgn * 3 * s, y - 3 * s + flap * 2,
                cx + sgn * (4 + i * 3) * s, y + (i * 2 - 2) * s + flap * (2 + i * 1.5), ramp[0], 1);
      }
    }
  }
  if (c.tail) {
    for (let i = 0; i < 10; i++) {
      const a = 0.35;
      g.globalAlpha = 1 - i / 11;
      ellipse(g, cx + Math.sin(t * TAU + i * a) * (1 + i * 0.3), y + 4 * s + i * 1.1 * s,
              (4 - i * 0.35) * s, (2.6 - i * 0.22) * s, ramp[1]);
      g.globalAlpha = 1;
    }
  }
  // тело
  ellipse(g, cx, y, 6.4 * s, 6.4 * s, ramp[1]);
  ellipse(g, cx, y, 4.6 * s, 4.6 * s, ramp[2]);
  ellipse(g, cx - 1, y - 1.2, 2.2 * s, 2.2 * s, ramp[3]);
  if (c.ears) {
    line(g, cx - 3 * s, y - 5 * s, cx - 4.5 * s, y - 9 * s, ramp[1], 1);
    line(g, cx + 3 * s, y - 5 * s, cx + 4.5 * s, y - 9 * s, ramp[1], 1);
  }
  if (c.hood) {
    ellipse(g, cx, y - 1, 7 * s, 7.2 * s, RAMP.shadowy[1]);
    ellipse(g, cx - 0.8, y - 2, 5 * s, 4.4 * s, RAMP.shadowy[2]);
    ellipse(g, cx, y + 0.6, 4.4 * s, 4.6 * s, '#05040c');
  }
  // глаза
  px(g, Math.round(cx - 1.8 * s), Math.round(y - 0.4 * s), c.eye || '#ffffff');
  px(g, Math.round(cx + 1.2 * s), Math.round(y - 0.4 * s), c.eye || '#ffffff');
  if (c.glow) glow(g, cx, y, 12 * s, rgba(c.glowColor || ramp[3], 0.4), 0.85);
  if (c.beak) {
    line(g, cx + 4 * s, y, cx + 8 * s, y + 1, RAMP.gold[2], 1);
  }
}

/** Каменный обломок со светом сверху-слева и тёмной нижней кромкой. */
function chunk(g, x, y, w, h, ramp, tone = 1) {
  box(g, Math.round(x), Math.round(y), Math.round(w), Math.round(h), ramp[tone], 1);
  rect(g, Math.round(x + 1), Math.round(y), Math.round(w - 2), 1, ramp[Math.min(3, tone + 1)]);
  rect(g, Math.round(x), Math.round(y + 1), 1, Math.round(h - 2), ramp[Math.min(3, tone + 1)]);
  rect(g, Math.round(x + 1), Math.round(y + h - 1), Math.round(w - 2), 1, ramp[Math.max(0, tone - 1)]);
  rect(g, Math.round(x + w - 1), Math.round(y + 1), 1, Math.round(h - 2), ramp[Math.max(0, tone - 1)]);
}

/**
 * Голем: не коробка с головой, а груда неровных обломков. Раскладка
 * детерминирована сидом, иначе камни дрожали бы между кадрами.
 */
function famGolem(g, cx, gy, t, c) {
  const s = c.scale || 1;
  const ramp = c.ramp || RAMP.stone;
  const vein = c.vein;
  const S = (v) => v * s;
  const r = makeRng(c.seed || 4242);
  const p = Math.sin(t * TAU);
  const y = gy + (Math.abs(Math.sin(t * TAU * 2)) > 0.5 ? -1 : 0);

  shadow(g, cx, gy + 1, S(11), S(3.4), 0.36);

  // ── короткие тумбы-ноги
  chunk(g, cx - S(8), y - S(9), S(6.5), S(9), ramp, 0);
  chunk(g, cx + S(1.5), y - S(9), S(6.5), S(9), ramp, 1);
  chunk(g, cx - S(8.5), y - S(2.5), S(7.5), S(2.5), ramp, 1);
  chunk(g, cx + S(1), y - S(2.5), S(7.5), S(2.5), ramp, 2);

  // ── дальняя рука уходит за корпус
  const sw = p * S(2);
  chunk(g, cx - S(14), y - S(19) + sw, S(5), S(12), ramp, 0);
  orb(g, cx - S(11.5), y - S(7) + sw, S(4), S(3.8), ramp);

  // ── торс из перекрывающихся глыб
  const torsoY = y - S(21);
  chunk(g, cx - S(9.5), torsoY, S(19), S(13), ramp, 1);
  for (let i = 0; i < 7; i++) {
    const bw = S(4 + r() * 4), bh = S(3 + r() * 3.5);
    const bx = cx - S(9) + r() * S(18) - bw / 2;
    const by = torsoY + r() * S(11) - bh / 2;
    chunk(g, bx, by, bw, bh, ramp, r() < 0.45 ? 2 : r() < 0.8 ? 1 : 0);
  }
  // плечевой пояс ловит свет
  chunk(g, cx - S(10), torsoY - S(1.5), S(20), S(4), ramp, 2);
  rect(g, Math.round(cx - S(8)), Math.round(torsoY - S(1)), Math.round(S(16)), 1, ramp[3]);

  // ── светящиеся жилы в щелях
  if (vein) {
    const pulse = 0.5 + Math.sin(t * TAU) * 0.5;
    g.save();
    g.globalAlpha = 0.55 + pulse * 0.45;
    line(g, cx - S(6), torsoY + S(2), cx - S(2), torsoY + S(7), vein[2], 1);
    line(g, cx - S(2), torsoY + S(7), cx + S(3), torsoY + S(5), vein[3], 1);
    line(g, cx + S(5), torsoY + S(1.5), cx + S(2), torsoY + S(9), vein[2], 1);
    line(g, cx - S(4), torsoY + S(10), cx + S(4), torsoY + S(11), vein[1], 1);
    g.restore();
    glow(g, cx, torsoY + S(6), S(18), rgba(vein[2], 0.3 * (0.5 + pulse * 0.5)), 0.9);
  }

  // ── голова утоплена между плечами
  const hy = y - S(27);
  chunk(g, cx - S(5.5), hy, S(11), S(7.5), ramp, 2);
  chunk(g, cx - S(4), hy - S(1.5), S(8), S(2), ramp, 3);
  rect(g, Math.round(cx - S(5)), Math.round(hy + S(5.5)), Math.round(S(10)), Math.round(S(2)), ramp[0]);
  const ec = c.eye || '#ffd15a';
  const ew = Math.max(1, Math.round(S(2.2))), eh = Math.max(1, Math.round(S(1.8)));
  rect(g, Math.round(cx - S(3.6)), Math.round(hy + S(3.2)), ew, eh, ec);
  rect(g, Math.round(cx + S(1.4)), Math.round(hy + S(3.2)), ew, eh, ec);
  glow(g, cx, hy + S(4), S(12), rgba(ec, 0.42), 0.95);

  // ── ближняя рука поверх всего
  chunk(g, cx + S(9), y - S(20) - sw, S(5.5), S(13), ramp, 2);
  orb(g, cx + S(11.7), y - S(7.5) - sw, S(4.4), S(4.2), ramp);
  px(g, Math.round(cx + S(13)), Math.round(y - S(9) - sw), ramp[3]);

  if (c.canopy) {  // крона для энта
    const cr = c.canopy;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + t * 0.3;
      ellipse(g, cx + Math.cos(a) * S(9), hy - S(7) + Math.sin(a) * S(5), S(6), S(5), cr[1]);
    }
    ellipse(g, cx, hy - S(8), S(11), S(7), cr[2]);
    ellipse(g, cx - S(4), hy - S(10), S(6), S(3.4), cr[3]);
    for (let i = 0; i < 16; i++) {
      px(g, cx - S(11) + r() * S(22), hy - S(13) + r() * S(10), r() < 0.5 ? cr[3] : cr[0]);
    }
  }
}

const FAMILIES = { humanoid: famHumanoid, beast: famBeast, blob: famBlob, floater: famFloater, golem: famGolem };

// ─────────────────────────────────────────── внешний вид монстров

export const MONSTER_ART = {
  slime:      { fam: 'blob',     w: 22, h: 22, cfg: { ramp: RAMP.slime, scale: 0.9 } },
  bigslime:   { fam: 'blob',     w: 34, h: 32, cfg: { ramp: RAMP.emerald, scale: 1.5, core: '#ffe07a' } },
  goblin:     { fam: 'humanoid', w: 24, h: 26, cfg: { skin: RAMP.emerald, cloth: RAMP.leather, scale: 0.85, ears: true, claws: true, weapon: 'sword', weaponRamp: RAMP.iron, belt: true } },
  goblinArcher:{fam: 'humanoid', w: 24, h: 26, cfg: { skin: RAMP.emerald, cloth: RAMP.cloth, scale: 0.85, ears: true, weapon: 'bow', weaponRamp: RAMP.wood } },
  wolf:       { fam: 'beast',    w: 32, h: 26, cfg: { fur: RAMP.stone, scale: 0.9, eye: '#ffcf4a' } },
  wisp:       { fam: 'floater',  w: 24, h: 26, cfg: { ramp: RAMP.emerald, scale: 0.8, glow: true, glowColor: '#8ff5c6', tail: true } },
  boar:       { fam: 'beast',    w: 32, h: 26, cfg: { fur: RAMP.leather, scale: 1.0, eye: '#ff8a4a' } },

  bogling:    { fam: 'humanoid', w: 26, h: 28, cfg: { skin: RAMP.poison, cloth: RAMP.wood, scale: 0.95, tusks: true, claws: true, eye: '#b6ee6a' } },
  spitter:    { fam: 'blob',     w: 26, h: 26, cfg: { ramp: RAMP.poison, scale: 1.05, core: '#3f7a2a' } },
  mireWitch:  { fam: 'humanoid', w: 26, h: 30, cfg: { cloth: RAMP.arcane, scale: 0.95, hood: true, float: true, weapon: 'staff', weaponRamp: RAMP.poison, eye: '#b6ee6a', glowEyes: true } },
  leech:      { fam: 'floater',  w: 22, h: 22, cfg: { ramp: RAMP.blood.concat(['#f57a6b']), scale: 0.7, tail: true, eye: '#ffdddd' } },
  swampWolf:  { fam: 'beast',    w: 32, h: 26, cfg: { fur: RAMP.poison, scale: 0.95, eye: '#d9ff7a', glowEyes: true } },

  frostWolf:  { fam: 'beast',    w: 34, h: 28, cfg: { fur: RAMP.ice, scale: 1.0, eye: '#b0e4fb', glowEyes: true, spikes: true } },
  iceWraith:  { fam: 'floater',  w: 28, h: 32, cfg: { ramp: RAMP.ice, scale: 1.15, hood: true, tail: true, glow: true, glowColor: '#b0e4fb', eye: '#dffaff' } },
  yeti:       { fam: 'humanoid', w: 32, h: 34, cfg: { skin: RAMP.bone, cloth: RAMP.ice, scale: 1.35, fur: true, tusks: true, claws: true, eye: '#7fd8ff' } },
  frostArcher:{ fam: 'humanoid', w: 26, h: 28, cfg: { skin: RAMP.bone, cloth: RAMP.ice, scale: 0.95, weapon: 'bow', weaponRamp: RAMP.ice, eye: '#8fe8ff', helm: true, helmRamp: RAMP.ice } },

  imp:        { fam: 'humanoid', w: 26, h: 28, cfg: { skin: RAMP.fire, cloth: RAMP.crimson, scale: 0.75, horns: true, claws: true, wings: true, wingColor: '#8a2a12', eye: '#ffd94a' } },
  magmaGolem: { fam: 'golem',    w: 48, h: 48, cfg: { ramp: RAMP.stone, scale: 0.85, vein: RAMP.fire, eye: '#ffb03a', seed: 101 } },
  ashRaven:   { fam: 'floater',  w: 34, h: 28, cfg: { ramp: ['#241c30', '#3c3050', '#584a72', '#7c6a9a'], scale: 0.85, wings: true, beak: true, eye: '#ff6a3a' } },
  cinderKnight:{fam: 'humanoid', w: 28, h: 30, cfg: { skin: RAMP.crimson, cloth: RAMP.iron, scale: 1.1, helm: true, helmRamp: RAMP.crimson, weapon: 'axe', weaponRamp: RAMP.fire, belt: true, eye: '#ff6a2a' } },

  skeleton:   { fam: 'humanoid', w: 24, h: 28, cfg: { skin: RAMP.bone, cloth: RAMP.bone, scale: 0.9, weapon: 'sword', weaponRamp: RAMP.iron, eye: '#ff5a5a' } },
  bat:        { fam: 'floater',  w: 30, h: 24, cfg: { ramp: ['#2a1a2e', '#452a48', '#63406a', '#8a5f92'], scale: 0.7, wings: true, ears: true, eye: '#ff8a8a' } },
  cultist:    { fam: 'humanoid', w: 26, h: 30, cfg: { cloth: RAMP.crimson, scale: 0.95, hood: true, weapon: 'staff', weaponRamp: RAMP.arcane, eye: '#ff3a5a', glowEyes: true } },
  shade:      { fam: 'floater',  w: 26, h: 28, cfg: { ramp: RAMP.shadowy, scale: 0.95, hood: true, tail: true, eye: '#c99cff', glow: true, glowColor: '#8b4fd8' } },
  boneGolem:  { fam: 'golem',    w: 46, h: 46, cfg: { ramp: RAMP.bone, scale: 0.8, vein: RAMP.arcane, eye: '#c99cff', seed: 202 } },

  // ── архетипы: щитоносцы, подрывники, лекари
  goblinShield:{fam: 'humanoid', w: 28, h: 28, cfg: { skin: RAMP.emerald, cloth: RAMP.leather, scale: 0.9, ears: true, belt: true,
                 weapon: 'sword', weaponRamp: RAMP.bronze, shield: true, shieldRamp: RAMP.wood, eye: '#ffe66a' } },
  boneShield: { fam: 'humanoid', w: 28, h: 30, cfg: { skin: RAMP.bone, cloth: RAMP.bone, scale: 0.92, weapon: 'sword', weaponRamp: RAMP.iron,
                 shield: true, shieldRamp: RAMP.bone, eye: '#ff5a5a' } },
  frostGuard: { fam: 'humanoid', w: 32, h: 34, cfg: { skin: RAMP.ice, cloth: RAMP.steel, scale: 1.2, helm: true, helmRamp: RAMP.ice, belt: true,
                 weapon: 'axe', weaponRamp: RAMP.ice, shield: true, shieldRamp: RAMP.steel, eye: '#8fe8ff' } },
  bloater:    { fam: 'blob',     w: 28, h: 26, cfg: { ramp: RAMP.poison, scale: 1.1, bloat: true, core: '#c6ff5a' } },
  emberBomber:{ fam: 'blob',     w: 28, h: 26, cfg: { ramp: RAMP.fire, scale: 1.05, bloat: true, core: '#fff0a0' } },
  mireShaman: { fam: 'humanoid', w: 30, h: 32, cfg: { cloth: RAMP.poison, scale: 1.0, hood: true, float: true, totem: true,
                 totemColor: '#a8ee5a', eye: '#c6ff5a', glowEyes: true } },
  cultShaman: { fam: 'humanoid', w: 30, h: 32, cfg: { cloth: RAMP.crimson, scale: 1.0, hood: true, totem: true, belt: true,
                 totemColor: '#ff8a6a', eye: '#ff5a5a', glowEyes: true } },

  // ── Пролом: третий акт
  voidling:   { fam: 'blob',     w: 26, h: 24, cfg: { ramp: RAMP.voidRift, scale: 0.9, core: '#c9a8ff' } },
  riftStalker:{ fam: 'floater',  w: 32, h: 28, cfg: { ramp: RAMP.voidRift, scale: 0.95, tail: true, glow: true, glowColor: '#a882e0', eye: '#e8d4ff' } },
  paleWarden: { fam: 'humanoid', w: 32, h: 34, cfg: { skin: RAMP.pale, cloth: RAMP.voidRift, scale: 1.22, helm: true, helmRamp: RAMP.pale, belt: true,
                 weapon: 'sword', weaponRamp: RAMP.voidRift, shield: true, shieldRamp: RAMP.pale, eye: '#c9a8ff' } },
  hollowChoir:{ fam: 'humanoid', w: 30, h: 32, cfg: { cloth: RAMP.pale, scale: 1.05, hood: true, float: true, totem: true,
                 totemColor: '#a882e0', eye: '#d8c0ff', glowEyes: true } },
  riftMaw:    { fam: 'floater',  w: 34, h: 30, cfg: { ramp: ['#1a1024', '#2c1b3e', '#452a5e', '#63407f'], scale: 0.95, wings: true, beak: true, eye: '#c9a8ff' } },
  paleSmith:  { fam: 'humanoid', w: 30, h: 32, cfg: { skin: RAMP.pale, cloth: RAMP.steel, scale: 1.1, helm: true, helmRamp: RAMP.steel,
                 weapon: 'axe', weaponRamp: RAMP.voidRift, belt: true, eye: '#b090e0' } },
  riftTitan:  { fam: 'golem',    w: 52, h: 52, cfg: { ramp: RAMP.pale, scale: 0.95, vein: RAMP.voidRift, eye: '#c9a8ff', seed: 606 } },
  breachHeart:{ fam: 'golem',    w: 80, h: 86, cfg: { ramp: RAMP.pale, scale: 1.5, vein: RAMP.voidRift, eye: '#e8d4ff', seed: 707 } },

  // боссы
  treant:     { fam: 'golem',    w: 66, h: 74, cfg: { ramp: RAMP.wood, scale: 1.25, canopy: RAMP.emerald, eye: '#a8ff7a', seed: 303 } },
  hagBoss:    { fam: 'humanoid', w: 40, h: 46, cfg: { cloth: RAMP.poison, scale: 1.7, hood: true, float: true, weapon: 'staff', weaponRamp: RAMP.arcane, eye: '#c6ff5a', glowEyes: true } },
  frostWarden:{ fam: 'golem',    w: 62, h: 66, cfg: { ramp: RAMP.ice, scale: 1.15, vein: RAMP.ice, eye: '#dffaff', seed: 404 } },
  colossus:   { fam: 'golem',    w: 74, h: 80, cfg: { ramp: RAMP.stone, scale: 1.4, vein: RAMP.fire, eye: '#ffdc6a', seed: 505 } },
  lich:       { fam: 'humanoid', w: 40, h: 48, cfg: { cloth: RAMP.arcane, scale: 1.7, hood: true, float: true, weapon: 'staff', weaponRamp: RAMP.ice, eye: '#7ae8ff', glowEyes: true } },
};

const FRAMES = 8;
const bakedMonsters = {};

export function bakeMonster(key) {
  if (bakedMonsters[key]) return bakedMonsters[key];
  const art = MONSTER_ART[key] || MONSTER_ART.slime;
  const fn = FAMILIES[art.fam];
  const idle = [], attack = [];
  const rim = art.cfg.glow ? 0.3 : 0.45;
  for (let f = 0; f < FRAMES; f++) {
    idle.push(bakeFrame(art.w, art.h,
      (c) => fn(c, art.w / 2, art.h - 3, f / FRAMES, art.cfg),
      INK, [255, 242, 212], rim).canvas);

    attack.push(bakeFrame(art.w, art.h,
      (c) => fn(c, art.w / 2, art.h - 3, f / FRAMES, { ...art.cfg, attack: true }),
      INK, [255, 242, 212], rim).canvas);
  }
  const flipped = idle.map((c) => { const m = makeCanvas(art.w, art.h); m.drawImage(c, 0, 0); return mirror(m).canvas; });
  const flippedAtk = attack.map((c) => { const m = makeCanvas(art.w, art.h); m.drawImage(c, 0, 0); return mirror(m).canvas; });

  return (bakedMonsters[key] = { w: art.w, h: art.h, idle, attack, idleL: flipped, attackL: flippedAtk });
}

export function bakeAllMonsters() {
  for (const k in MONSTER_ART) bakeMonster(k);
}

// ─────────────────────────────────────────── NPC города

export function bakeNPC(cfg) {
  const frames = [];
  for (let f = 0; f < 6; f++) {
    const g = bakeFrame(24, 30, (c) => { famHumanoid(c, 12, 27, f / 6, {
      skin: cfg.skin || RAMP.skin,
      cloth: cfg.cloth || RAMP.cloth,
      scale: cfg.scale || 1,
      belt: true,
      hood: cfg.hood,
      eye: cfg.eye || '#3a2a1a',
      weapon: cfg.weapon, weaponRamp: cfg.weaponRamp,
      });
      if (cfg.apron) rect(c, 8, 14, 8, 8, cfg.apron);
      if (cfg.hat) { ellipse(c, 12, 6, 7, 2.2, cfg.hat); ellipse(c, 12, 4, 4, 3, cfg.hat); }
    }, INK, [255, 242, 212], 0.45);
    frames.push(g.canvas);
  }
  return { w: 24, h: 30, frames };
}
