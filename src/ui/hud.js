// Игровой HUD: полосы, панель умений, трекер заданий, мини-карта, тосты.

import { UI, RARITY, rgba, RAMP } from '../art/palette.js';
import { pixelBlit } from './stage.js';
import { t } from '../core/i18n.js';
import { text, measure, wrap, ellipsize } from './text.js';
import { panel, bar, itemSlot, bevelPath, hudPlate, goldRule, vgrad } from './widgets.js';
import { clamp, fmt, TAU } from '../core/util.js';
import { GEAR_SLOTS, RUNE_SLOTS } from '../entities/player.js';
import { TILE, T } from '../art/tiles.js';
import { corruptionName } from '../systems/abyss.js';
import { objectiveOf } from '../systems/objective.js';

export class Hud {
  constructor(view) {
    this.view = view;
    this.toasts = [];
    this.banner = null;
    this.hpGhost = 1;
    this.mpGhost = 1;
    this.xpGhost = 0;
    this.minimapOn = true;
    this.beltTop = 225;
    this._mini = null;
    this.lessons = [];
  }

  toast(msg, color = UI.text, dur = 2.6) {
    this.toasts.push({ msg, color, t: dur, max: dur });
    if (this.toasts.length > 6) this.toasts.shift();
  }

  showBanner(title, sub, color = UI.accent) {
    this.banner = { title, sub, color, t: 3.2 };
  }

  /**
   * Карточка обучения. Выезжает сбоку и живёт сама: модальное окно посреди боя
   * было бы худшим способом что-то объяснить. Если сработало несколько разом —
   * встают в очередь и показываются по одной.
   */
  showLesson(lesson) {
    this.lessons.push({ ...lesson, t: 0, life: 9.5 });
  }

  dismissLesson() {
    if (this.lessons.length) { this.lessons[0].life = Math.min(this.lessons[0].life, 0.35); return true; }
    return false;
  }

  update(dt, game) {
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      this.toasts[i].t -= dt;
      if (this.toasts[i].t <= 0) this.toasts.splice(i, 1);
    }
    if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }
    if (this.lessons.length) {
      const l = this.lessons[0];
      l.t += dt; l.life -= dt;
      if (l.life <= 0) this.lessons.shift();
    }
    const p = game.player;
    this.hpGhost += (p.hp / p.maxHp - this.hpGhost) * Math.min(1, dt * 3.2);
    this.mpGhost += (p.mp / p.maxMp - this.mpGhost) * Math.min(1, dt * 3.2);
    this.xpGhost += (p.xp / p.xpNext - this.xpGhost) * Math.min(1, dt * 5);
  }

  draw(g, game) {
    const { w: W, h: H } = this.view;
    const p = game.player;

    const boss = game.enemies.find((e) => e.boss && !e.dead && e.aggro);
    this.drawVitals(g, p, game);
    this.drawSkills(g, p, game);
    this.drawStick(g, game);
    if (!boss) this.drawQuestTracker(g, game);
    if (this.minimapOn) this.drawMinimap(g, game);
    if (boss) this.drawBossBar(g, boss);
    this.drawObjective(g, game);
    this.drawToasts(g);
    this.drawLesson(g);
    this.drawBanner(g, game);
    this.drawPrompt(g, game);
  }

  drawVitals(g, p, game) {
    const x = 8, y = 8;
    // рамка уровня
    g.fillStyle = 'rgba(10,8,20,0.85)';
    g.fillRect(x, y, 26, 26);
    g.fillStyle = UI.border;
    g.fillRect(x, y, 26, 1); g.fillRect(x, y + 25, 26, 1);
    g.fillRect(x, y, 1, 26); g.fillRect(x + 25, y, 1, 26);
    g.fillStyle = rgba(UI.accent, 0.12);
    g.fillRect(x + 1, y + 1, 24, 24);
    text(g, String(p.level), x + 13, y + 5, { size: 14, bold: true, align: 'center', color: UI.accent, shadow: true });
    text(g, 'ур.', x + 13, y + 18, { size: 7, align: 'center', color: UI.textDim });

    const bx = x + 31;
    bar(g, bx, y + 2, 118, 8, p.hp / p.maxHp, UI.hp, UI.hpDark, { ghost: this.hpGhost, label: `${Math.ceil(p.hp)} / ${p.maxHp}` });
    // барьер поверх полосы здоровья
    if (p.shield > 0) {
      const sw = Math.round(118 * Math.min(1, p.shield / p.maxHp));
      g.fillStyle = 'rgba(255,214,106,0.85)';
      g.fillRect(bx, y + 2, sw, 3);
    }
    // мана в том же виде, что здоровье: «156» без второго числа не говорит,
    // много это или почти пусто
    bar(g, bx, y + 13, 96, 6, p.mp / p.maxMp, UI.mp, UI.mpDark,
        { ghost: this.mpGhost, label: `${Math.floor(p.mp)} / ${p.maxMp}`, labelSize: 7 });
    bar(g, bx, y + 22, 118, 3, p.xp / p.xpNext, UI.xp, UI.xpDark, {});

    // золото
    text(g, fmt(p.gold), x + 31 + 124, y + 13, { size: 10, color: UI.gold, bold: true, shadow: true });
    g.fillStyle = UI.gold;
    g.fillRect(x + 31 + 118, y + 15, 4, 4);

    // порча: постоянная метка, пока герой в Бездне — она объясняет,
    // почему шкала жизни короче обычной
    if (game.corruption > 0) {
      const cn = corruptionName(game.corruption);
      const cw = measure(cn, 8, true) + 22;
      const cx = x + 31, cy = y + 27;
      g.fillStyle = 'rgba(70,20,80,0.72)';
      g.fillRect(cx, cy, cw, 10);
      g.fillStyle = '#d06ad0';
      g.fillRect(cx, cy, 2, 10);
      text(g, cn, cx + 5, cy + 1, { size: 8, bold: true, color: '#ff9ae0' });
      text(g, String(game.corruption), cx + cw - 4, cy + 1, { size: 8, align: 'right', bold: true, color: '#ffd0f0' });
    }

    // эффекты
    let ex = x, ey = y + (game.corruption > 0 ? 40 : 30);
    const eff = [];
    if (p.buffs.rage > 0) eff.push(['ЯРОСТЬ', '#ff8a4a', p.buffs.rage]);
    if (p.buffs.stone > 0) eff.push(['КАМЕНЬ', '#9fb8d8', p.buffs.stone]);
    if (p.effects.burn > 0) eff.push(['ГОРИТ', '#ff6a2a', p.effects.burn]);
    if (p.effects.poison > 0) eff.push(['ЯД', '#a8ee5a', p.effects.poison]);
    if (p.effects.slow > 0) eff.push(['ХОЛОД', '#7fd8ff', p.effects.slow]);
    for (const [name, col, t] of eff) {
      const w = measure(name, 8) + 8;
      g.fillStyle = 'rgba(10,8,20,0.8)';
      g.fillRect(ex, ey, w, 11);
      g.fillStyle = rgba(col, 0.35);
      g.fillRect(ex, ey, Math.round(w * clamp(t / 8, 0, 1)), 11);
      g.fillStyle = col;
      g.fillRect(ex, ey, w, 1); g.fillRect(ex, ey + 10, w, 1);
      text(g, name, ex + 4, ey + 2, { size: 8, color: col });
      ex += w + 3;
    }
  }

  /**
   * Кольцо стика под пальцем.
   *
   * Без него палец не знает, где начало отсчёта: стик появляется там, где его
   * поставили, и невидимый центр превращает точное движение в угадывание.
   * Рисуем только пока держат — в остальное время экран телефона и так тесный.
   */
  drawStick(g, game) {
    const inp = game.input;
    if (!inp || !inp.stick.active) return;
    const s = inp.stick;
    const cx = s.ox ?? 44;
    const cy = s.oy ?? (this.view.h - 52);
    g.save();
    g.globalAlpha = 0.5;
    g.strokeStyle = '#cbb8ff'; g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, 24, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 0.85;
    g.fillStyle = '#e6dcff';
    g.beginPath(); g.arc(cx + s.x * 20, cy + s.y * 20, 7, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  drawSkills(g, p, game) {
    const { w: W, h: H } = this.view;
    const keys = ['F', 'R', 'G'];
    const slots = [
      { key: 'ЛКМ', label: 'Удар', cd: p.attackCd, max: p.attackRate, icon: 'sword', action: 'attack' },
    ];
    // На поясе только то, что действительно вставлено. Пустые гнёзда рун
    // занимали два места из шести и обещали умение, которого нет: до первой
    // руны пояс читался наполовину пустым, а дальше — ровно настолько, на
    // сколько игрок ещё не собрал набор. Где лежат руны и куда их вставлять,
    // объясняет подсказка при выпадении первой и вкладка «Инвентарь», так что
    // держать ради этого дырки на экране незачем.
    //
    // Удар, рывок и зелье остаются всегда: это не снаряжение, а то, что у героя
    // есть с первой минуты. У пустого пояса зелий счётчик краснеет — исчезни
    // гнездо, и посреди боя пропала бы и подсказка «зелья кончились», и пояс
    // прыгнул бы под рукой.
    for (let i = 0; i < 3; i++) {
      const r = p.equipment['skill' + (i + 1)];
      if (!r) continue;
      slots.push({
        key: keys[i], label: r.name,
        cd: p.skillCd[i], max: (p.skillCdMax && p.skillCdMax[i]) || 1,
        rune: r, cost: r.cost, action: 'skill' + (i + 1),
      });
    }
    slots.push({ key: 'ПКМ', label: 'Рывок', cd: p.dashCd, max: p.dashCooldown, icon: 'dash', action: 'dash' });
    slots.push({ key: 'Q', label: 'Зелье', cd: 0, max: 1, icon: 'potion', count: game.potionCount(), action: 'potion' });
    // Клавиша переехала с подписи под слотом в уголок самого слота, а на
    // остывающем умении показывается остаток в секундах. Подпись снизу была
    // придумана под пиксельный шрифт: кегль 7 читался только потому, что каждый
    // знак был отдельным квадратом. Главное же, чего не хватало, — понимания,
    // сколько ждать: заливка сверху вниз показывает долю, но не время.
    //
    // Отделка та же, что у кнопок главного экрана и полос: фаска вместо прямого
    // угла, градиент вместо плоской заливки, приглушённое золото рамки. Шесть
    // отдельных квадратов не выглядели набором — теперь под ними общая
    // подложка, и панель читается одной вещью, поясом с гнёздами.
    // ── надетое: верхний ярус того же пояса
    //
    // Второй ряд, а не продолжение первого. В строку это не влезает: миникарта
    // занимает справа x 404…472 на той же высоте, что и пояс, а шесть умений с
    // шестью вещами в ряд — это 329 единиц, то есть край панели упёрся бы в неё.
    // Вверх места сколько угодно, поэтому вещи легли ярусом выше умений, и пояс
    // остался прежней ширины.
    //
    // Ярусы разные по смыслу и потому разные по виду: у нижнего гнёзда крупнее
    // и с ярлыком клавиши — на них нажимают; верхний мельче и без ярлыков — на
    // него смотрят. Между ними золотая нить, та же, что во всех панелях.
    const gear = [];
    for (const s of GEAR_SLOTS) if (p.equipment[s]) gear.push(p.equipment[s]);
    const passive = p.equipment[RUNE_SLOTS[3]];
    if (passive) gear.push(passive);

    const size = 28, gap = 4, bev = 4;
    const GS = 20, GGAP = 3, ROWGAP = 6;
    const total = slots.length * size + (slots.length - 1) * gap;
    const gtotal = gear.length ? gear.length * GS + (gear.length - 1) * GGAP : 0;
    const inner = Math.max(total, gtotal);
    let x = (W - total) / 2 | 0;
    const y = H - size - 11;
    const gy = y - ROWGAP - GS;

    // ── подложка под оба ряда
    const px = ((W - inner) / 2 | 0) - 7, pw = inner + 14;
    const py = (gear.length ? gy : y) - 5;
    const ph = y + size + 5 - py;
    bevelPath(g, px, py, pw, ph, 6);
    g.fillStyle = vgrad(g, py, ph, [0, 'rgba(26,21,44,0.80)', 1, 'rgba(10,8,20,0.86)']);
    g.fill();
    g.save();
    bevelPath(g, px, py, pw, ph, 6); g.clip();
    g.fillStyle = 'rgba(255,232,170,0.13)';
    g.fillRect(px, py, pw, 1);
    g.restore();
    bevelPath(g, px, py, pw, ph, 6);
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(150,126,80,0.40)';
    g.stroke();
    // Всё, что жмётся к низу экрана, отсчитывается от верхней кромки пояса, а не
    // от края экрана: пояс меняет высоту на 24 единицы, когда появляется ряд
    // надетого, и жёсткие отступы от низа тут же уехали бы под него.
    this.beltTop = py;

    if (gear.length) {
      let gx = (W - gtotal) / 2 | 0;
      for (const it of gear) {
        itemSlot(g, gx, gy, GS, it, { time: game.time });
        gx += GS + GGAP;
      }
      goldRule(g, px + 8, gy + GS + 2, pw - 16, 0.45);
    }

    // Пояс сообщает, где нарисовал гнёзда.
    //
    // Управление с касаний бьёт по этим же прямоугольникам, а не по своим.
    // Второй набор координат разъехался бы с первой же правкой вёрстки, и
    // кнопка оказалась бы не там, где её видно, — а на телефоне это и есть
    // «игра не слушается».
    this.touchSlots = [];
    for (const s of slots) {
      const cooling = s.cd > 0 && s.max > 0;
      const noMana = s.cost && p.mp < s.cost;
      if (s.action) this.touchSlots.push({ x, y, w: size, h: size, action: s.action });

      // гнездо: градиент снизу вверх — так оно выглядит утопленным, а не
      // наклеенным поверх подложки
      bevelPath(g, x, y, size, size, bev);
      g.fillStyle = vgrad(g, y, size, [0, 'rgba(9,7,18,0.90)', 1, 'rgba(30,25,50,0.90)']);
      g.fill();

      if (s.rune) pixelBlit(g, s.rune.icon, x + (size - s.rune.icon.width) / 2 | 0, y + (size - s.rune.icon.height) / 2 | 0);
      else if (s.icon) this.skillIcon(g, s.icon, x + size / 2, y + size / 2, game.time);

      g.save();
      bevelPath(g, x, y, size, size, bev); g.clip();

      if (cooling) {
        const frac = clamp(s.cd / s.max, 0, 1);
        const fh = Math.round(size * frac);
        g.fillStyle = 'rgba(6,5,14,0.74)';
        g.fillRect(x, y, size, fh);
        // светлая кромка на границе — по ней видно, что откат идёт, а не завис
        g.fillStyle = 'rgba(255,226,150,0.55)';
        g.fillRect(x, y + fh - 1, size, 1);
      }
      if (noMana) {
        g.fillStyle = 'rgba(80,20,30,0.42)';
        g.fillRect(x, y, size, size);
      }
      // внутренняя фаска: светлая сверху, тёмная снизу
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(x, y, size, 1);
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(x, y + size - 1, size, 1);
      g.restore();

      // рамка: при нехватке маны золото уходит в красный
      bevelPath(g, x, y, size, size, bev);
      g.lineWidth = 1;
      g.strokeStyle = noMana ? 'rgba(200,110,110,0.55)' : 'rgba(198,170,112,0.55)';
      g.stroke();

      if (cooling && s.cd >= 0.6) {
        // остаток показываем только когда ждать заметно — иначе цифра мигает
        text(g, s.cd >= 10 ? String(Math.ceil(s.cd)) : s.cd.toFixed(1), x + size / 2, y + size / 2 - 5, {
          size: 11, align: 'center', bold: true, color: '#ffffff', outline: 'rgba(0,0,0,0.9)',
        });
      }
      if (s.count !== undefined) {
        text(g, String(s.count), x + size - 3, y + size - 11, {
          size: 10, align: 'right', bold: true,
          color: s.count ? '#fff' : UI.danger, outline: 'rgba(0,0,0,0.9)',
        });
      }

      // ярлык клавиши: тёмный язычок со скошенным углом, чтобы читался на любой
      // иконке и не спорил с фаской гнезда
      const kw = measure(s.key, 8, true) + 6;
      g.beginPath();
      g.moveTo(x + 1, y + 1);
      g.lineTo(x + 1 + kw, y + 1);
      g.lineTo(x + 1 + kw - 3, y + 10);
      g.lineTo(x + 1, y + 10);
      g.closePath();
      g.fillStyle = 'rgba(8,6,16,0.90)';
      g.fill();
      text(g, s.key, x + 4, y + 2, { size: 8, bold: true, color: '#cdb98a' });
      x += size + gap;
    }
  }

  skillIcon(g, kind, cx, cy, time) {
    cx |= 0; cy |= 0;
    if (kind === 'sword') {
      g.strokeStyle = RAMP.steel[3]; g.lineWidth = 2;
      g.beginPath(); g.moveTo(cx - 6, cy + 6); g.lineTo(cx + 5, cy - 5); g.stroke();
      g.fillStyle = RAMP.gold[2]; g.fillRect(cx - 6, cy + 1, 5, 2);
    } else if (kind === 'skill') {
      const pulse = 0.6 + Math.sin(time * 3) * 0.3;
      g.fillStyle = rgba('#8b4fd8', pulse);
      g.beginPath(); g.arc(cx, cy, 6, 0, TAU); g.fill();
      g.fillStyle = '#c99cff';
      g.beginPath(); g.arc(cx - 1, cy - 1, 3, 0, TAU); g.fill();
    } else if (kind === 'dash') {
      g.fillStyle = '#9fb8ff';
      for (let i = 0; i < 3; i++) g.fillRect(cx - 7 + i * 3, cy - 4 + i * 2, 2 + i * 3, 2);
      g.fillStyle = '#dbe6ff';
      g.fillRect(cx + 1, cy + 2, 6, 2);
    } else if (kind === 'potion') {
      g.fillStyle = '#cfe4f0'; g.fillRect(cx - 3, cy - 6, 6, 3);
      g.fillStyle = '#d8434b';
      g.beginPath(); g.arc(cx, cy + 1, 5, 0, TAU); g.fill();
      g.fillStyle = '#ff9a95'; g.fillRect(cx - 3, cy - 2, 2, 2);
    }
  }

  /**
   * Трекер заданий.
   *
   * Ширина считается по содержимому. Раньше стояло 140 — под пиксельный шрифт,
   * где «Первая кровь 0/6» занимало почти всю строку. С векторным та же надпись
   * вдвое уже, и жёсткое число превращало трекер в чёрную плашку на четверть
   * ширины экрана ради одной строки.
   */
  drawQuestTracker(g, game) {
    const { w: W } = this.view;
    const active = game.quests.active.slice(0, 3);
    if (!active.length) return;

    const rows = active.map((q) => {
      const done = game.quests.canComplete(q, game.player);
      const frac = q.type === 'collect'
        ? clamp(game.player.countMaterial(q.target) / q.count, 0, 1)
        : clamp(q.progress / q.count, 0, 1);
      return { q, done, frac, prog: game.quests.progressText(q, game.player) };
    });

    // Отделка та же, что у панели умений: фаска, градиент, золото вполсилы.
    // Здесь добавлена тень — трекер лежит прямо на мире, а не на затемнённом
    // фоне, и без тени читался дырой в картинке, а не предметом поверх неё.
    //
    // Слева у каждой строки метка состояния: она же стоит в журнале заданий, и
    // одинаковый знак в двух местах избавляет от необходимости запоминать два.
    const PAD = 9, GAP = 12, ROW = 17, PIP = 5;
    const wantW = rows.reduce((m, r) =>
      Math.max(m, PIP + measure(r.q.title, 9) + measure(r.prog, 9) + GAP), measure('ЗАДАНИЯ', 8, true) + 20);
    const w = Math.round(clamp(wantW + PAD * 2, 96, 194));
    const h = 20 + rows.length * ROW;
    const x = W - w - 8, y = 8;

    hudPlate(g, x, y, w, h);
    text(g, 'ЗАДАНИЯ', x + PAD, y + 4, { size: 8, color: UI.accent, bold: true });
    goldRule(g, x + PAD, y + 15, w - PAD * 2, 0.55);

    let ty = y + 21;
    for (const r of rows) {
      const col = r.done ? UI.good : UI.accent;
      // метка состояния — ромбик, а не квадрат: квадрат сливается с сеткой
      g.save();
      g.translate(x + PAD + 2, ty + 3.5);
      g.rotate(Math.PI / 4);
      g.fillStyle = col;
      g.fillRect(-1.6, -1.6, 3.2, 3.2);
      g.restore();

      const tx = x + PAD + PIP + 3;
      const pw = measure(r.prog, 9);
      text(g, ellipsize(r.q.title, w - PAD - PIP - 3 - pw - 10, 9), tx, ty,
           { size: 9, color: r.done ? UI.good : UI.text });
      text(g, r.prog, x + w - PAD, ty, { size: 9, align: 'right', color: r.done ? UI.good : UI.textDim });
      bar(g, tx, ty + 9, x + w - PAD - tx, 2, r.frac, r.done ? UI.good : '#6f7ba8', '#1e1c2e');
      ty += ROW;
    }
  }

  drawMinimap(g, game) {
    const zone = game.zone;
    if (!zone) return;
    const { w: W, h: H } = this.view;
    // 62 → 68: подпись зоны уехала на язычок и перестала занимать строку
    // над картой, а векторный шрифт освободил место справа снизу
    const size = 68;
    const x = W - size - 8;
    const y = H - size - 8;

    if (!this._mini || this._mini.zone !== zone) this._mini = { zone, canvas: buildMinimap(zone) };
    const mm = this._mini.canvas;

    // Оправа та же, что у остальных панелей: фаска, тень, золото вполсилы.
    // Карта обрезается по той же фаске, поэтому углы у картинки и у рамки
    // совпадают — иначе на скосе торчал бы прямой угол миникарты.
    const BEV = 5;
    bevelPath(g, x, y + 2, size, size, BEV);
    g.fillStyle = 'rgba(0,0,0,0.32)';
    g.fill();

    // окно вокруг игрока
    const scale = size / Math.max(zone.w, zone.h);
    const viewTiles = size / (scale * 3.1);
    const px = game.player.x / TILE, py = game.player.y / TILE;
    const sx = clamp(px - viewTiles / 2, 0, Math.max(0, zone.w - viewTiles));
    const sy = clamp(py - viewTiles / 2, 0, Math.max(0, zone.h - viewTiles));

    g.save();
    bevelPath(g, x, y, size, size, BEV); g.clip();
    g.fillStyle = 'rgba(8,6,16,0.9)';
    g.fillRect(x, y, size, size);
    g.imageSmoothingEnabled = false;
    g.drawImage(mm, sx, sy, viewTiles, viewTiles, x, y, size, size);
    g.imageSmoothingEnabled = true;

    // виньетка: карта гаснет к краям и не обрывается по рамке ножом
    if (!this._miniVig || this._miniVig.size !== size) {
      const r = g.createRadialGradient(x + size / 2, y + size / 2, size * 0.28,
                                       x + size / 2, y + size / 2, size * 0.72);
      r.addColorStop(0, 'rgba(6,4,12,0)');
      r.addColorStop(1, 'rgba(6,4,12,0.62)');
      this._miniVig = { size, grad: r };
    }
    g.fillStyle = this._miniVig.grad;
    g.fillRect(x, y, size, size);

    const k = size / viewTiles;
    const pip = (cx, cy, r2, col) => {
      g.save(); g.translate(cx, cy); g.rotate(Math.PI / 4);
      g.fillStyle = 'rgba(4,3,10,0.85)'; g.fillRect(-r2 - 0.7, -r2 - 0.7, r2 * 2 + 1.4, r2 * 2 + 1.4);
      g.fillStyle = col; g.fillRect(-r2, -r2, r2 * 2, r2 * 2);
      g.restore();
    };
    for (const e of zone.exits) {
      pip(x + (e.x / TILE - sx) * k, y + (e.y / TILE - sy) * k, 1.6,
          e.dest.kind === 'city' ? '#f0c05a' : e.dest.kind === 'dungeon' ? '#a86fff' : '#6fdc8c');
    }
    for (const c of zone.chests) {
      if (c.opened) continue;
      pip(x + (c.x / TILE - sx) * k, y + (c.y / TILE - sy) * k, 1.3, '#ffd970');
    }
    for (const e of game.enemies) {
      if (e.dead) continue;
      const ex = x + (e.x / TILE - sx) * k, ey = y + (e.y / TILE - sy) * k;
      if (e.boss) {
        // босса видно издалека: пульсирующий ореол
        const pu = 2.4 + Math.sin(game.time * 4) * 0.8;
        g.fillStyle = 'rgba(255,74,74,0.30)';
        g.beginPath(); g.arc(ex, ey, pu + 1.6, 0, TAU); g.fill();
        pip(ex, ey, 2, '#ff4a4a');
      } else {
        g.fillStyle = 'rgba(4,3,10,0.8)';
        g.fillRect(ex - 1.4, ey - 1.4, 2.8, 2.8);
        g.fillStyle = e.elite ? '#ffa63a' : '#e0646a';
        g.fillRect(ex - 0.9, ey - 0.9, 1.8, 1.8);
      }
    }

    // ── цель задания: та же точка, что у стрелки на экране
    //
    // Метка ставится последней среди меток и первой по заметности: пульсирующий
    // ореол и ромб крупнее прочих. Раньше на миникарте были выходы, сундуки и
    // враги — всё, кроме того, ради чего игрок вообще идёт.
    if (this.objective) {
      const ox = x + (this.objective.x / TILE - sx) * k, oy = y + (this.objective.y / TILE - sy) * k;
      const col = this.objective.tone || UI.accent;
      const pu = 3 + Math.sin(game.time * 3.4) * 1.2;
      g.fillStyle = rgba(col, 0.26);
      g.beginPath(); g.arc(ox, oy, pu + 2, 0, TAU); g.fill();
      pip(ox, oy, 2.6, col);
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.fillRect(Math.round(ox) - 0.5, Math.round(oy) - 0.5, 1, 1);
    }

    // ── герой: стрелка по направлению взгляда, а не точка
    //
    // Точка говорит только «ты здесь». Стрелка отвечает ещё и на «куда ты
    // смотришь» — на миникарте это половина пользы, потому что по ней
    // ориентируются, не глядя на мир.
    const ppx = x + (px - sx) * k, ppy = y + (py - sy) * k;
    const ang = game.player.facing || 0;
    g.save();
    g.translate(ppx, ppy);
    // мягкий ореол, чтобы стрелку было видно на любой карте
    g.fillStyle = 'rgba(255,246,214,0.22)';
    g.beginPath(); g.arc(0, 0, 4.6, 0, TAU); g.fill();
    g.rotate(ang);
    const arrow = () => {
      g.beginPath();
      g.moveTo(4.2, 0);
      g.lineTo(-2.6, 3.1);
      g.lineTo(-1.1, 0);
      g.lineTo(-2.6, -3.1);
      g.closePath();
    };
    arrow();
    g.fillStyle = 'rgba(4,3,10,0.9)';
    g.lineWidth = 2; g.lineJoin = 'round'; g.strokeStyle = 'rgba(4,3,10,0.9)';
    g.stroke();
    g.fillStyle = '#fff6d6';
    g.fill();
    g.restore();
    g.restore();

    // оправа
    bevelPath(g, x, y, size, size, BEV);
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(198,170,112,0.50)';
    g.stroke();

    // название зоны — язычком на верхней грани, а не подписью в воздухе
    const nm = t(zone.name || '');
    if (nm) {
      const tw = measure(nm, 8, true) + 14;
      const tx = x + (size - tw) / 2, ty = y - 11;
      hudPlate(g, tx, ty, tw, 12, { bevel: 3 });
      text(g, nm, x + size / 2, ty + 2, { size: 8, align: 'center', bold: true, color: '#cdb98a' });
    }
  }

  drawBossBar(g, boss) {
    const { w: W } = this.view;
    const w = 220, x = (W - w) / 2, y = 46;
    text(g, `${t(boss.name)}  ·  ${t("ур.")} ${boss.level}`, W / 2, y - 12, {
      size: 10, align: 'center', bold: true, color: '#ffd0a0', outline: 'rgba(0,0,0,0.9)',
    });
    bar(g, x, y, w, 7, boss.hp / boss.maxHp, '#d8434b', '#3a0d16', {});
    // деления фаз
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(x + w * 0.35, y, 1, 7);
    g.fillRect(x + w * 0.7, y, 1, 7);
  }

  /**
   * Указатель цели: ромб над ней, пока она в кадре, и стрелка у края, когда
   * ушла за него. Цель считается одна на всю игру (`objectiveOf`) и рисуется
   * здесь же и на миникарте — одна точка, два места, ничего запоминать не надо.
   *
   * Стрелка прижимается к рамке, отступив от края: сверху справа трекер
   * заданий, снизу пояс, и упереться в них ей нельзя. Нижняя граница берётся от
   * `beltTop` — пояс меняет высоту, когда надето снаряжение.
   */
  drawObjective(g, game) {
    const o = objectiveOf(game);
    this.objective = o;
    this._objLabel = null;
    if (!o) return;
    const { w: W, h: H } = this.view;
    const cam = game.cam;
    const sx = o.x - cam.x, sy = o.y - cam.y;
    const bob = Math.sin(game.time * 3) * 2;
    const col = o.tone || UI.accent;

    const M = 24;
    const top = 44, bottom = (this.beltTop || H - 45) - 14;
    if (sx > M && sx < W - M && sy > top && sy < bottom) {
      // цель видна — ромб над ней и тонкий столбик до земли
      const dy = sy - 26 + bob;
      g.save();
      g.globalAlpha = 0.5;
      g.fillStyle = col;
      g.fillRect(Math.round(sx), Math.round(dy + 8), 1, 12);
      g.restore();
      g.save();
      g.translate(Math.round(sx), Math.round(dy));
      g.rotate(Math.PI / 4);
      g.fillStyle = 'rgba(4,3,10,0.85)';
      g.fillRect(-5, -5, 10, 10);
      g.fillStyle = col;
      g.fillRect(-3.5, -3.5, 7, 7);
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.fillRect(-3.5, -3.5, 3, 3);
      g.restore();
      return;
    }

    // цель за кадром — стрелка у рамки с подписью
    const cx = W / 2, cy = (top + bottom) / 2;
    const a = Math.atan2(sy - cy, sx - cx);
    const rx = (W / 2) - M, ry = (bottom - top) / 2 - 6;
    const k = Math.min(rx / Math.max(1e-3, Math.abs(Math.cos(a))), ry / Math.max(1e-3, Math.abs(Math.sin(a))));
    const ax = Math.round(cx + Math.cos(a) * k), ay = Math.round(cy + Math.sin(a) * k);

    g.save();
    g.translate(ax, ay);
    g.rotate(a);
    g.beginPath();
    g.moveTo(9, 0); g.lineTo(-5, 6); g.lineTo(-2, 0); g.lineTo(-5, -6);
    g.closePath();
    g.lineWidth = 2.4; g.lineJoin = 'round';
    g.strokeStyle = 'rgba(4,3,10,0.9)';
    g.stroke();
    g.fillStyle = col;
    g.fill();
    g.restore();

    const label = ellipsize(o.label, 120, 8, true);
    const lw = measure(label, 8, true) + 10;
    const lx = clamp(ax - lw / 2, 6, W - lw - 6);
    const ly = clamp(ay + (Math.sin(a) > 0 ? -16 : 10), top - 12, bottom + 2);
    bevelPath(g, lx, ly, lw, 11, 3);
    g.fillStyle = 'rgba(8,6,16,0.88)';
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = rgba(col, 0.5);
    g.stroke();
    text(g, label, lx + lw / 2, ly + 1, { size: 8, align: 'center', bold: true, color: col });
    // Подпись запоминает, где встала: уведомления рисуются следом и обязаны её
    // обойти. На первом же экране новой игры они налезали друг на друга —
    // «…даст первое задание» упиралось во «Взять: Первая кровь».
    this._objLabel = { x: lx, y: ly, w: lw, h: 11 };
  }

  drawToasts(g) {
    const { w: W, h: H } = this.view;
    let y = (this.beltTop ?? H - 45) - 34;
    // Уведомления обходят и подпись цели, и обучающую карточку.
    //
    // Первый заход двигал их только с подписи — и строка тут же уехала под
    // карточку «Как играть», которая рисуется следом и накрывает собой. Обход
    // одного препятствия, создающий второе, — не починка, поэтому считаем оба.
    //
    // Прямоугольник карточки вычисляем здесь, а не берём из `drawLesson`: та
    // рисуется после нас, и её значения опоздали бы на кадр.
    const ob = this._objLabel;
    let card = null;
    if (this.lessons.length) {
      const l = this.lessons[0];
      const pw = 190, lines = wrap(l.body, pw - 18, 9);
      const inA = clamp(l.t / 0.28, 0, 1), outA = clamp(l.life / 0.35, 0, 1);
      const a2 = Math.min(inA, outA);
      card = {
        x: Math.round(-pw + (pw + 10) * (a2 * a2 * (3 - 2 * a2))),
        y: Math.round(H * 0.42), w: pw, h: 22 + lines.length * 11,
      };
    }
    const мешает = (r, x, y, w2, h2) =>
      r && x < r.x + r.w + 4 && x + w2 > r.x - 4 && y < r.y + r.h + 2 && y + h2 > r.y - 2;
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const t = this.toasts[i];
      const tw = measure(t.msg, 10, true), tx = W / 2 - tw / 2;
      if (мешает(ob, tx, y, tw, 11)) y = ob.y - 15;
      if (мешает(card, tx, y, tw, 11)) y = card.y - 15;
      const a = clamp(t.t / 0.5, 0, 1) * clamp((t.max - t.t) / 0.18, 0, 1);
      text(g, t.msg, W / 2, y, {
        size: 10, align: 'center', color: t.color, alpha: a, bold: true, outline: 'rgba(6,4,12,0.92)',
      });
      y -= 13;
    }
  }

  drawLesson(g) {
    const l = this.lessons[0];
    if (!l) return;
    const { w: W, h: H } = this.view;
    const pw = 190;
    const lines = wrap(l.body, pw - 18, 9);
    const ph = 22 + lines.length * 11;
    // выезд слева и уезд обратно — карточка не мигает, а приходит
    const inA = clamp(l.t / 0.28, 0, 1);
    const outA = clamp(l.life / 0.35, 0, 1);
    const a = Math.min(inA, outA);
    const x = Math.round(-pw + (pw + 10) * (a * a * (3 - 2 * a)));
    const y = Math.round(H * 0.42);

    g.save();
    g.globalAlpha = 0.94;
    g.fillStyle = 'rgba(10,8,20,0.96)';
    g.fillRect(x, y, pw, ph);
    g.fillStyle = l.tone;
    g.fillRect(x, y, 2, ph);
    g.fillStyle = rgba(l.tone, 0.30);
    g.fillRect(x, y, pw, 1); g.fillRect(x, y + ph - 1, pw, 1); g.fillRect(x + pw - 1, y, 1, ph);
    g.restore();

    text(g, l.title, x + 8, y + 5, { size: 10, bold: true, color: l.tone });
    let ty = y + 18;
    for (const ln of lines) { text(g, ln, x + 8, ty, { size: 9, color: UI.text }); ty += 11; }
    // полоса остатка времени: видно, что карточка уйдёт сама
    g.fillStyle = rgba(l.tone, 0.5);
    g.fillRect(x + 2, y + ph - 1, Math.round((pw - 3) * clamp(l.life / 9.5, 0, 1)), 1);
  }

  drawBanner(g, game) {
    if (!this.banner) return;
    const { w: W, h: H } = this.view;
    const b = this.banner;
    const t = b.t;
    const a = clamp(t / 0.7, 0, 1) * clamp((3.2 - t) / 0.35, 0, 1);
    const y = H * 0.30;
    g.save();
    g.globalAlpha = a * 0.55;
    g.fillStyle = 'rgba(8,6,16,1)';
    g.fillRect(0, y - 8, W, 40);
    g.fillStyle = rgba(b.color, 0.5);
    g.fillRect(0, y - 8, W, 1);
    g.fillRect(0, y + 31, W, 1);
    g.restore();
    text(g, b.title, W / 2, y, { size: 18, align: 'center', bold: true, color: b.color, alpha: a, outline: 'rgba(6,4,12,0.95)' });
    if (b.sub) text(g, b.sub, W / 2, y + 21, { size: 9, align: 'center', color: UI.textDim, alpha: a });
  }

  drawPrompt(g, game) {
    const pr = game.prompt;
    if (!pr) return;
    const { w: W, h: H } = this.view;
    const label = pr.label;
    const w = measure(label, 10, true) + 40;
    const x = (W - w) / 2, y = (this.beltTop ?? H - 45) - 22;
    panel(g, x, y, w, 20, { fill: 'rgba(12,10,22,0.92)', border: pr.color || UI.borderHi });
    g.fillStyle = pr.color || UI.accent;
    g.fillRect(x + 7, y + 5, 10, 10);
    text(g, pr.key || 'E', x + 12, y + 6, { size: 8, align: 'center', color: '#100c1c', bold: true });
    text(g, label, x + 23, y + 5, { size: 10, color: UI.text, bold: true });
  }
}

function buildMinimap(zone) {
  const c = document.createElement('canvas');
  c.width = zone.w; c.height = zone.h;
  const g = c.getContext('2d');
  const img = g.createImageData(zone.w, zone.h);
  const d = img.data;
  const COL = {
    [T.GROUND]: [58, 72, 52], [T.GROUND2]: [70, 62, 44], [T.PATH]: [104, 98, 82],
    [T.LIQUID]: [36, 68, 104], [T.WALL]: [30, 28, 40], [T.VOID]: [8, 7, 14],
  };
  if (zone.kind === 'dungeon') {
    COL[T.GROUND] = [58, 52, 76]; COL[T.GROUND2] = [48, 44, 66]; COL[T.PATH] = [72, 64, 92];
  } else if (zone.biomeId === 'frost') {
    COL[T.GROUND] = [130, 148, 172]; COL[T.GROUND2] = [86, 118, 148];
  } else if (zone.biomeId === 'ember') {
    COL[T.GROUND] = [58, 42, 42]; COL[T.LIQUID] = [180, 70, 24];
  } else if (zone.biomeId === 'swamp') {
    COL[T.GROUND] = [52, 60, 40]; COL[T.LIQUID] = [56, 92, 40];
  }
  for (let i = 0; i < zone.tiles.length; i++) {
    const col = COL[zone.tiles[i]] || COL[T.GROUND];
    d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2];
    d[i * 4 + 3] = zone.tiles[i] === T.VOID ? 0 : 235;
  }
  g.putImageData(img, 0, 0);
  return c;
}
