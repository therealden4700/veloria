// Экраны: журнал (инвентарь/герой/задания/карта), лавка, диалог, пауза, смерть, титул.

import { UI, RARITY, RARITY_ORDER, rgba, RAMP } from '../art/palette.js';
import { pixelBlit } from './stage.js';
import { text, measure, textBlock, wrap, ellipsize } from './text.js';
import { panel, bar, button, hit, itemSlot, tooltip, scrollbar, slider, sliderFrac, plateButton, bevelPath, hudPlate, goldRule, recess, vgrad, listRow, segTabs, valueTab } from './widgets.js';
import { clamp, fmt, TAU } from '../core/util.js';
import { SLOTS, GEAR_SLOTS, RUNE_SLOTS, SLOT_NAMES } from '../entities/player.js';
import { STAT_LABEL, itemPower, runeGroups, fuseCost } from '../systems/items.js';
import { audio } from '../core/audio.js';
import { BIOMES, OVERWORLD } from '../world/biomes.js';
import { FLOOR_MODS, modReward } from '../systems/dungeon_mods.js';
import { CRAFT_CATS, WEAPON_SUBS, recipesFor, canAfford, matsText, matName,
         salvageYield, reforgeCost, sharpenChance, sharpenCost, sharpenFuel,
         SHARP_MAX, SHARP_GAIN, SHARP_MILESTONES, MILESTONE_LEVELS,
         nextMilestone, milestoneOpen, sharpFloor } from '../systems/craft.js';
import { SETS, SET_SLOTS } from '../systems/uniques.js';
import { MARKS, REACTIONS } from '../systems/reactions.js';
import { markIcon } from '../art/marks.js';
import { titleArt } from '../art/title.js';
import { corruptionName, corruptionLines, ABYSS_START, CORRUPTION_MAX } from '../systems/abyss.js';
import { LESSONS } from '../systems/lessons.js';
import { questDesc } from '../systems/quests.js';
import { t, getLang, setLang, LANGS } from '../core/i18n.js';
import { bestDepth } from '../core/save.js';
import { getWallet, isSignedIn, hasPhantom, shortAddress, signInWithPhantom,
         playAsGuest, signOut, PHANTOM_URL } from '../core/wallet.js';
import { net } from '../core/net.js';
import { TILE, T } from '../art/tiles.js';

const TABS = [
  { id: 'inventory', name: 'Инвентарь', key: 'I' },
  { id: 'character', name: 'Герой', key: 'C' },
  { id: 'quests', name: 'Задания', key: 'U' },
  { id: 'map', name: 'Карта', key: 'M' },
  { id: 'elements', name: 'Стихии', key: '' },
  { id: 'notes', name: 'Записи', key: '' },
];

// Звук и экран отсюда уехали в «Настройки»: две строки-переключателя занимали в
// паузе столько же места, сколько «Сохранить» и «Выйти», хотя трогают их
// заметно реже. Список вынесен в константу, потому что нумерация в `doPause`
// от него зависит — при правке на месте они разъезжались.
const PAUSE_ITEMS = ['Продолжить', 'Сохранить игру', 'Настройки', 'Выйти в меню'];

export class Menus {
  constructor(view, game) {
    this.view = view;
    this.game = game;
    this.mode = null;
    this.tab = 'inventory';
    this.confirm = null;   // диалог подтверждения поверх текущего экрана
    this.hover = null;
    this.hoverItem = null;
    this.compare = null;
    this.scroll = 0;
    this.shop = null;
    this.shopTab = 'buy';
    this.dialogue = null;
    this.selQuest = 0;
    this.pauseSel = 0;
    this.settingsFrom = 'title';
    this.settingsSel = 0;
    this.dragSlider = null;
    this.drag = null;        // что тащим: { item, from }
    this.invPage = 0;
    this._clickables = [];
    this.levelupT = 0;
    this.craftTab = 'forge';
    this.craftCat = 'weapon';
    this.craftSub = 'sword';
    this.sharpenArmed = 0;
  }

  get open() { return this.mode !== null; }
  get blocking() { return this.mode !== null && this.mode !== 'levelup'; }

  openMode(m, data) {
    this.mode = m;
    this.drag = null;
    this.scroll = 0;
    this.hoverItem = null;
    if (m === 'shop') { this.shop = data; this.shopTab = 'buy'; }
    if (m === 'dialogue') this.dialogue = data;
    if (m === 'altar') this.altar = data;
    audio.play('uiBig');
  }

  openJournal(tab) {
    this.drag = null;
    this.tab = tab || this.tab;
    this.mode = 'journal';
    this.scroll = 0;
    audio.play('uiBig');
  }

  close() {
    if (this.mode) audio.play('ui');
    this.sharpenArmed = 0;
    // Начатое перетаскивание разрешает только вкладка заточки. Esc посреди
    // него уходил сюда раньше, и предмет оставался «в руке»: иконка ехала за
    // курсором поверх мира, а карточки сравнения в инвентаре молча переставали
    // показываться — их условие проверяет как раз `drag`.
    this.drag = null;
    this.mode = null;
    this.shop = null;
    this.dialogue = null;
    this.hoverItem = null;
  }

  // ── ввод
  update(dt, input) {
    this.levelupT = Math.max(0, this.levelupT - dt);
    const g = this.game;
    const mx = input.mouse.x, my = input.mouse.y;
    this.mx = mx; this.my = my;
    this.hoverItem = null;
    this.compare = null;

    if (this.mode === 'settings') { this.handleSettings(input); return; }
    if (this.mode === 'title' || this.mode === 'death') { this.handleFullscreenMenu(input); return; }

    // подтверждение перекрывает всё: клик мимо него не должен уходить в меню
    if (this.confirm) { this.handleConfirm(input); return; }

    if (this.mode === 'descend') { this.processClicks(input); return; }
    if (input.consume('cancel')) {
      if (this.mode) this.close();
      else this.openMode('pause');
      return;
    }
    if (this.mode === 'pause') { this.handlePause(input); return; }

    if (!this.mode || this.mode === 'journal') {
      // карточка обучения уходит по Esc или клику, не блокируя ничего
      if (this.game.hud.lessons.length && input.consume('cancel')) { this.game.hud.dismissLesson(); return; }
      if (input.mouse.justDown && this.game.hud.lessons.length && !this.blocking) this.game.hud.dismissLesson();
      if (input.consume('inventory')) { this.mode === 'journal' && this.tab === 'inventory' ? this.close() : this.openJournal('inventory'); return; }
      if (input.consume('character')) { this.mode === 'journal' && this.tab === 'character' ? this.close() : this.openJournal('character'); return; }
      if (input.consume('quests')) { this.mode === 'journal' && this.tab === 'quests' ? this.close() : this.openJournal('quests'); return; }
      if (input.consume('map')) { this.mode === 'journal' && this.tab === 'map' ? this.close() : this.openJournal('map'); return; }
    }

    if (this.mode === 'journal' || this.mode === 'shop' || this.mode === 'fuse' || this.mode === 'dialogue' || this.mode === 'portal' || this.mode === 'altar' || this.mode === 'craft') {
      if (input.mouse.wheel) this.scroll = clamp(this.scroll + input.mouse.wheel * 2, 0, 400);
      this.processClicks(input);
    }
  }

  /**
   * Перетаскивание предметов между полосой инвентаря и слотами топлива.
   *
   * Один путь на два способа: нажал и отпустил на месте — это щелчок, вещь
   * едет в первый свободный слот; нажал, увёл курсор и отпустил над слотом —
   * это перетаскивание. Разделять их отдельными обработчиками не нужно и
   * вредно: игрок не решает заранее, что он делает, он просто берёт вещь.
   *
   * Возвращает true, если ввод съеден и обычную раздачу кликов делать не надо.
   */
  handleDrag(input) {
    const под = () => this._clickables.find((c) => (c.grab || c.drop !== undefined) &&
                                                   hit(this.mx, this.my, c.x, c.y, c.w, c.h));
    if (input.mouse.justDown) {
      const c = под();
      if (c && c.grab) {
        input.mouse.justDown = false;
        this.drag = { ...c.grab, x0: this.mx, y0: this.my };
        return true;
      }
    }
    if (!this.drag) return false;
    if (!input.mouse.justUp && input.mouse.down) return true;   // ещё тащим

    const d = this.drag;
    this.drag = null;
    if (!input.mouse.justUp) return true;
    const c = под();
    const сдвиг = Math.abs(this.mx - d.x0) + Math.abs(this.my - d.y0);
    const sel = this._fuelSel || [];

    if (c && c.drop !== undefined && d.from === 'inv') {        // положили в слот
      if (sel.length < 3 && !sel.includes(d.item)) { sel.push(d.item); audio.play('ui'); }
      return true;
    }
    if (сдвиг < 3) {                                            // щелчок на месте
      if (d.from === 'inv') {
        if (sel.length < 3 && !sel.includes(d.item)) { sel.push(d.item); audio.play('ui'); }
      } else {
        const i = sel.indexOf(d.item);
        if (i >= 0) { sel.splice(i, 1); audio.play('ui'); }
      }
      return true;
    }
    if (d.from === 'fuel') {                                    // вынесли из слота — снять
      const i = sel.indexOf(d.item);
      if (i >= 0) { sel.splice(i, 1); audio.play('ui'); }
    }
    return true;
  }

  /** Тащимый предмет рисуется поверх всего, под курсором. */
  drawDragged(g) {
    if (!this.drag) return;
    itemSlot(g, this.mx - 13, this.my - 13, 26, this.drag.item, { time: this.game.time, hot: true });
  }

  /** Снять вещь. `unequip` отказывает при полном рюкзаке — молчать об этом нельзя. */
  снять(p, слот, it) {
    if (p.unequip(слот)) this.game.toast('Снято: ' + it.name);
    else { audio.play('deny'); this.game.toast('Рюкзак полон', UI.danger); }
  }

  /** Съесть нажатие, чтобы оно не досталось миру тем же кадром. */
  гаситьНажатие(input, действие) {
    input.mouse.justDown = false;
    input.mouse.rightJustDown = false;
    input.down.delete(действие);
    input.justPressed.delete(действие);
    input.consume(действие);
  }

  processClicks(input) {
    if (this.mode === 'craft' && this.craftTab === 'sharpen' && this.handleDrag(input)) return;
    const click = input.mouse.justDown;
    const rclick = input.mouse.rightJustDown;
    for (const c of this._clickables) {
      if (hit(this.mx, this.my, c.x, c.y, c.w, c.h)) {
        this.hover = c;
        if (c.item) { this.hoverItem = c.item; this.compare = c.compare; this.hoverPrice = c.price; this.hoverPriceLabel = c.priceLabel; }
        // Гасим нажатие целиком, а не только его «только что». Мышь кладёт в
        // `down` ещё и действие 'attack' (клавиша та же), и если кнопка меню
        // закрыла окно, то в этом же кадре герой успевал махнуть мечом:
        // `paused` считается уже после `menus.update`. То же с пробелом — он
        // разложен и в «подтвердить», и в «удар».
        if (rclick && c.onRight) { this.гаситьНажатие(input, 'dash'); audio.play('uiBig'); c.onRight(); return; }
        if (click && c.action) { this.гаситьНажатие(input, 'attack'); audio.play('ui'); c.action(); return; }
      }
    }
    if (click) input.mouse.justDown = false;
  }

  /**
   * Выброс предмета. Именно уничтожение, а не бросок на землю: подбор магнитит
   * лут в радиусе 46 пикселей, и брошенное тут же вернулось бы в рюкзак.
   */
  askDrop(it) {
    const p = this.game.player;
    if (!p.inventory.includes(it)) return;
    const n = it.count || 1;
    const sell = Math.max(1, Math.floor((it.price || 5) * 0.35) * n);
    this.ask('ВЫБРОСИТЬ?', [
      'Предмет пропадёт насовсем.',
      `Торговец дал бы за него ${sell} зол.`,
    ], () => {
      p.removeItem(it, n);
      if (this.hoverItem === it) this.hoverItem = null;
      this.game.toast('Выброшено: ' + it.name, UI.textDim, 2);
      this.game.save();
    }, { item: it, yes: n > 1 ? `Выбросить ×${n}` : 'Выбросить' });
  }

  /** Спрашивает подтверждение. Пока диалог открыт, остальное меню заморожено. */
  ask(title, lines, onYes, o = {}) {
    this.confirm = { title, lines, onYes, item: o.item || null, yes: o.yes || 'Да', danger: o.danger !== false };
  }

  handleConfirm(input) {
    const c = this.confirm;
    // Enter намеренно не подтверждает: на необратимом действии клавиша,
    // которую жмут не глядя, — это способ потерять вещь
    if (input.consume('cancel')) { this.confirm = null; audio.play('ui'); return; }
    if (input.mouse.rightJustDown) { input.mouse.rightJustDown = false; this.confirm = null; audio.play('ui'); return; }
    if (!input.mouse.justDown) return;
    input.mouse.justDown = false;
    for (const b of this._confirmBtns || []) {
      if (!hit(this.mx, this.my, b.x, b.y, b.w, b.h)) continue;
      this.confirm = null;
      if (b.yes) { audio.play('uiBig'); c.onYes(); } else audio.play('ui');
      return;
    }
  }

  drawConfirm(g) {
    const c = this.confirm;
    if (!c) return;
    const { w: W, h: H } = this.view;
    this.dim(g, 0.55);
    const pw = 232, lines = c.lines || [];
    const ph = 66 + lines.length * 11 + (c.item ? 25 : 0);
    const px = (W - pw) >> 1, py = (H - ph) >> 1;
    panel(g, px, py, pw, ph, { border: c.danger ? UI.danger : UI.accent, fill: 'rgba(12,9,20,0.98)' });
    text(g, c.title, W / 2, py + 9, { size: 12, align: 'center', bold: true, color: c.danger ? '#ff9a90' : UI.accent });
    goldRule(g, px + 24, py + 22, pw - 48, 0.5);

    let ty = py + 28;
    if (c.item) {
      const rar = RARITY[c.item.rarity] || RARITY.common;
      listRow(g, px + 10, ty - 4, pw - 20, 24, { rarity: c.item.rarity });
      itemSlot(g, px + 13, ty - 2, 20, c.item, { time: this.game.time });
      text(g, ellipsize(c.item.name, pw - 52, 10, true), px + 38, ty + 1, { size: 10, bold: true, color: rar.color });
      ty += 25;
    }
    for (const ln of lines) { text(g, ln, W / 2, ty, { size: 9, align: 'center', color: UI.textDim }); ty += 11; }

    const bw = 96, gap = 10, by = py + ph - 26;
    const bx1 = (W - bw * 2 - gap) / 2, bx2 = bx1 + bw + gap;
    this._confirmBtns = [
      { x: bx1, y: by, w: bw, h: 18, yes: true },
      { x: bx2, y: by, w: bw, h: 18, yes: false },
    ];
    plateButton(g, bx1, by, bw, 18, c.yes, { hot: hit(this.mx, this.my, bx1, by, bw, 18), danger: c.danger });
    plateButton(g, bx2, by, bw, 18, 'Отмена', { hot: hit(this.mx, this.my, bx2, by, bw, 18) });
    text(g, 'Esc или ПКМ — отмена', W / 2, by + 21, { size: 8, align: 'center', color: UI.textFaint });
  }

  handlePause(input) {
    const n = PAUSE_ITEMS.length;
    if (input.consume('up')) { this.pauseSel = (this.pauseSel + n - 1) % n; audio.play('ui'); }
    if (input.consume('down')) { this.pauseSel = (this.pauseSel + 1) % n; audio.play('ui'); }
    if (input.consume('confirm')) this.doPause(this.pauseSel);
    this.processClicks(input);
  }

  doPause(i) {
    const g = this.game;
    if (i === 0) this.close();
    else if (i === 1) { g.save(); g.toast('Игра сохранена', UI.good); }
    else if (i === 2) this.openSettings('pause');
    else if (i === 3) { g.save(); this.mode = 'title'; g.toTitle(); }
  }

  /** Настройки открываются с двух экранов и возвращают туда, откуда пришли. */
  openSettings(from) {
    audio.play('uiBig');
    this.settingsFrom = from;
    this.settingsSel = 0;
    this.mode = 'settings';
  }

  closeSettings() {
    audio.play('ui');
    this.dragSlider = null;
    this.mode = this.settingsFrom === 'pause' ? 'pause' : 'title';
  }

  handleFullscreenMenu(input) {
    this.processClicks(input);
    if (this.mode === 'death' && input.consume('confirm')) this.game.respawn();
  }

  // ── отрисовка
  draw(g) {
    this._clickables = [];
    const { w: W, h: H } = this.view;
    switch (this.mode) {
      case 'journal': this.drawJournal(g); break;
      case 'shop': this.drawShop(g); break;
      case 'fuse': this.drawFuse(g); break;
      case 'craft': this.drawCraft(g); break;
      case 'descend': this.drawDescend(g); break;
      case 'altar': this.drawAltar(g); break;
      case 'dialogue': this.drawDialogue(g); break;
      case 'portal': this.drawPortal(g); break;
      case 'pause': this.drawPause(g); break;
      case 'death': this.drawDeath(g); break;
      case 'title': this.drawTitle(g); break;
      case 'settings': this.drawSettings(g); break;
    }
    // Пока вещь в руке, всплывающая карточка мешает: она закрывает как раз те
    // слоты, куда её несут.
    if (this.hoverItem && !this.confirm && !this.drag) {
      const counts = {};
      for (const s of SET_SLOTS) { const it = this.game.player.equipment[s]; if (it && it.set) counts[it.set] = (counts[it.set] || 0) + 1; }
      tooltip(g, this.hoverItem, this.mx, this.my, W, H, {
        STAT_LABEL, compare: this.compare, price: this.hoverPrice,
        priceLabel: this.hoverPriceLabel, playerLevel: this.game.player.level,
        SETS, setCounts: counts,
      });
    }
    this.drawConfirm(g);
    this.drawDragged(g);
  }

  dim(g, a = 0.62) {
    g.fillStyle = `rgba(6,4,12,${a})`;
    g.fillRect(0, 0, this.view.w, this.view.h);
  }

  add(x, y, w, h, action, extra) {
    this._clickables.push({ x, y, w, h, action, ...extra });
  }

  // ─────────────────────────────── журнал
  drawJournal(g) {
    const { w: W, h: H } = this.view;
    this.dim(g);
    const pw = 428, ph = 238;
    const px = (W - pw) >> 1, py = (H - ph) >> 1;
    panel(g, px, py, pw, ph);

    // вкладки
    let tx = px + 8;
    for (const t of TABS) {
      const w = measure(t.name, 10, true) + 18;
      const active = this.tab === t.id;
      const hot = hit(this.mx, this.my, tx, py - 12, w, 14);
      g.fillStyle = active ? UI.panelAlt : hot ? '#241f38' : '#141220';
      g.fillRect(tx, py - 12, w, 14);
      g.fillStyle = active ? UI.accent : UI.border;
      g.fillRect(tx, py - 12, w, 1);
      g.fillRect(tx, py - 12, 1, 14); g.fillRect(tx + w - 1, py - 12, 1, 14);
      if (active) { g.fillStyle = UI.panel; g.fillRect(tx + 1, py - 1, w - 2, 2); }
      text(g, t.name, tx + w / 2, py - 10, { size: 10, align: 'center', bold: active, color: active ? UI.accent : UI.textDim });
      this.add(tx, py - 12, w, 14, () => { this.tab = t.id; this.scroll = 0; });
      tx += w + 3;
    }
    text(g, 'ESC — закрыть', px + pw - 6, py - 10, { size: 8, align: 'right', color: UI.textFaint });

    if (this.tab === 'inventory') this.drawInventory(g, px, py, pw, ph);
    else if (this.tab === 'character') this.drawCharacter(g, px, py, pw, ph);
    else if (this.tab === 'quests') this.drawQuests(g, px, py, pw, ph);
    else if (this.tab === 'map') this.drawMap(g, px, py, pw, ph);
    else if (this.tab === 'elements') this.drawElements(g, px, py, pw, ph);
    else if (this.tab === 'notes') this.drawNotes(g, px, py, pw, ph);
  }

  /**
   * Записи: всё, что игра успела объяснить. Карточка в бою живёт девять секунд —
   * без списка объяснение исчезало бы навсегда.
   */
  drawNotes(g, px, py, pw, ph) {
    const seen = this.game.seenLessons || {};
    const known = LESSONS.filter((l) => seen[l.key]);
    text(g, `ЗАПИСИ · ${known.length} из ${LESSONS.length}`, px + 12, py + 8, { size: 8, color: UI.accent, bold: true });
    text(g, 'Здесь остаётся всё, что игра успела объяснить.', px + 106, py + 8, { size: 8, color: UI.textFaint });

    if (!known.length) {
      text(g, 'Пока пусто. Записи появляются сами, когда встретишь новое.',
           px + 14, py + 34, { size: 10, color: UI.textDim });
      return;
    }

    const listTop = py + 22;
    const rowH = 34;
    const maxRows = Math.floor((py + ph - 16 - listTop) / rowH);
    const off = clamp(this.scroll, 0, Math.max(0, known.length - maxRows));
    this.scroll = off;

    for (let i = 0; i < Math.min(maxRows, known.length - off); i++) {
      const l = known[i + off];
      const y = listTop + i * rowH;
      listRow(g, px + 12, y, pw - 26, rowH - 3, { accent: l.tone });
      text(g, l.title, px + 20, y + 3, { size: 10, bold: true, color: l.tone });
      textBlock(g, l.body, px + 20, y + 15, pw - 46, { size: 8, color: UI.textDim, lineHeight: 9 });
    }
    scrollbar(g, px + pw - 10, listTop, maxRows * rowH, known.length * rowH, maxRows * rowH, off * rowH);
  }

  /** Схема меток и реакций: без неё систему невозможно открыть самому. */
  drawElements(g, px, py, pw, ph) {
    text(g, 'МЕТКИ', px + 12, py + 8, { size: 8, color: UI.accent, bold: true });
    text(g, 'Вешаются умениями и аффиксами снаряжения.', px + 62, py + 8, { size: 8, color: UI.textFaint });

    const shown = ['burn', 'slow', 'poison', 'shock'];
    let mx2 = px + 12;
    for (const k of shown) {
      const m = MARKS[k];
      pixelBlit(g, markIcon(k), mx2, py + 20);
      text(g, m.name, mx2 + 10, py + 21, { size: 9, color: m.color });
      mx2 += measure(m.name, 9) + 24;
    }

    // ── таблица реакций
    text(g, 'РЕАКЦИИ', px + 12, py + 38, { size: 8, color: UI.accent, bold: true });
    text(g, 'Вторая метка не копится поверх первой — они схлопываются в реакцию.',
         px + 62, py + 38, { size: 8, color: UI.textFaint });

    let ry = py + 50;
    for (const key of ['corrosion', 'conduction', 'steam', 'shatter']) {
      const r = REACTIONS[key];
      listRow(g, px + 12, ry, pw - 24, 30, { accent: r.color });

      // слагаемые
      let sx = px + 20;
      const [a1, b1] = r.pair;
      for (const part of [a1, '+', b1]) {
        if (part === '+') {
          text(g, '+', sx, ry + 9, { size: 10, color: UI.textDim });
          sx += 10;
        } else if (MARKS[part]) {
          pixelBlit(g, markIcon(part), sx, ry + 7);
          text(g, MARKS[part].name.toLowerCase(), sx + 9, ry + 8, { size: 8, color: MARKS[part].color });
          sx += measure(MARKS[part].name, 8) + 20;
        } else {
          // раскол запускается не меткой, а тяжёлым ударом
          text(g, 'тяжёлый удар', sx, ry + 8, { size: 8, color: '#dfe9ff' });
          sx += measure('тяжёлый удар', 8) + 12;
        }
      }
      text(g, '=', px + 168, ry + 8, { size: 10, color: UI.textDim });
      text(g, r.name, px + 180, ry + 7, { size: 10, bold: true, color: r.color });
      text(g, r.hint, px + 20, ry + 19, { size: 8, color: UI.textDim });
      ry += 33;
    }

    text(g, 'Разряд добавляет цели +22% получаемого урона, разъедание — ещё +30%.',
         px + 12, py + ph - 26, { size: 8, color: UI.textFaint });
    text(g, 'Руны Пирокинез, Ледяное сердце, Токсиколог, Катализатор и Резонанс читают эти метки.',
         px + 12, py + ph - 16, { size: 8, color: UI.textFaint });
  }

  /** Заголовок раздела с золотой нитью под ним — общий для обеих колонок. */
  sectionHead(g, x, y, w, label, right) {
    text(g, label, x, y, { size: 8, color: UI.accent, bold: true });
    if (right) right(y);
    goldRule(g, x, y + 10, w, 0.55);
  }

  drawInventory(g, px, py, pw, ph) {
    const p = this.game.player;
    const time = this.game.time;

    // ── левая колонка: снаряжение
    //
    // Раньше строка была голой: иконка, название, характеристики, название
    // слота — четыре текста подряд на пустом фоне. Теперь у каждой строки своя
    // плита с ребром по редкости слева. Ребро тут работает лучше цветного
    // названия: список читается по цветной кромке одним взглядом сверху вниз,
    // не вчитываясь в буквы.
    //
    // Название слота уехало вправо мелкими капителями и освободило третью
    // строку — за счёт этого строка ужалась с 29 до 27 пикселей, а руны внизу
    // получили место под клавиши.
    const eqX = px + 11, eqW = 172;
    this.sectionHead(g, eqX, py + 7, eqW, 'СНАРЯЖЕНИЕ');

    const ROW = 29, PLATE = 27, SL = 24;
    let eqY = py + 22;
    for (const s of GEAR_SLOTS) {
      const it = p.equipment[s];
      const hot = hit(this.mx, this.my, eqX, eqY, eqW, PLATE);
      const rar = it ? (RARITY[it.rarity] || RARITY.common) : null;

      listRow(g, eqX, eqY, eqW, PLATE, { rarity: it && it.rarity, hot });
      itemSlot(g, eqX + 5, eqY + 1.5, SL, it, { hot, time });

      const tx = eqX + 5 + SL + 6;
      const nameW = eqW - (tx - eqX) - 26;
      text(g, SLOT_NAMES[s], eqX + eqW - 6, eqY + 5, {
        size: 7, align: 'right', color: UI.textFaint, bold: true,
      });
      if (it) {
        text(g, ellipsize(it.name, nameW, 9), tx, eqY + 4, { size: 9, color: rar.color, bold: true });
        const sum = statSummary(it);
        if (sum) text(g, ellipsize(sum, eqW - (tx - eqX) - 6, 8), tx, eqY + 15, { size: 8, color: UI.textDim });
      } else {
        text(g, 'пусто', tx, eqY + 9, { size: 9, color: 'rgba(110,98,146,0.6)' });
      }
      this.add(eqX, eqY, eqW, PLATE, () => { if (it) this.снять(p, s, it); }, { item: it });
      eqY += ROW;
    }

    // ── руны умений: ниша под ячейки и клавиша на язычке, как на панели умений
    eqY += 6;
    this.sectionHead(g, eqX, eqY, eqW, 'РУНЫ УМЕНИЙ');
    eqY += 16;
    const keyHint = ['F', 'R', 'G', '—'];
    const RS = 28, RGAP = 8;
    recess(g, eqX - 4, eqY - 4, RUNE_SLOTS.length * (RS + RGAP) - RGAP + 8, RS + 19, { bevel: 4 });
    RUNE_SLOTS.forEach((s, i) => {
      const rx = eqX + i * (RS + RGAP);
      const it = p.equipment[s];
      const hot = hit(this.mx, this.my, rx, eqY, RS, RS);
      itemSlot(g, rx, eqY, RS, it, { hot, time, placeholder: it ? null : keyHint[i] });
      const lbl = i < 3 ? keyHint[i] : 'пасс.';
      const lw = measure(lbl, 7, true) + 8;
      bevelPath(g, rx + (RS - lw) / 2, eqY + RS + 1, lw, 9, 2);
      g.fillStyle = 'rgba(8,6,16,0.85)';
      g.fill();
      g.lineWidth = 1;
      g.strokeStyle = it ? 'rgba(232,194,116,0.45)' : 'rgba(120,104,72,0.28)';
      g.stroke();
      text(g, lbl, rx + RS / 2, eqY + RS + 1.5, {
        size: 7, align: 'center', bold: true, color: it ? UI.accent : UI.textFaint,
      });
      this.add(rx, eqY, RS, RS, () => { if (it) this.снять(p, s, it); }, { item: it });
    });

    // ── правая колонка: рюкзак
    //
    // Зазор между ячейками ужат с трёх пикселей до двух — ровно затем, чтобы
    // вокруг сетки хватило места на нишу и она не упёрлась в край панели.
    const cols = 8, size = 26, gap = 2;
    const gw = cols * (size + gap) - gap;
    const gx = px + pw - 11 - gw, gy = py + 25;
    const rows = Math.ceil(p.invSize / cols);
    const gh = rows * (size + gap) - gap;

    const full = p.inventory.length >= p.invSize;
    this.sectionHead(g, gx, py + 7, gw, 'РЮКЗАК', () => {
      text(g, `${p.inventory.length}/${p.invSize}`, gx + measure('РЮКЗАК', 8, true) + 8, py + 7,
           { size: 8, color: full ? UI.danger : UI.textFaint });
      text(g, `${fmt(p.gold)} зол.`, gx + gw, py + 6, { size: 10, align: 'right', color: UI.gold, bold: true });
    });

    recess(g, gx - 5, gy - 5, gw + 10, gh + 10, { bevel: 5 });
    for (let i = 0; i < p.invSize; i++) {
      const cx = gx + (i % cols) * (size + gap);
      const cy = gy + ((i / cols) | 0) * (size + gap);
      const it = p.inventory[i];
      const hot = hit(this.mx, this.my, cx, cy, size, size);
      itemSlot(g, cx, cy, size, it, { hot, time });
      if (it) {
        const slot = p.slotOf(it);
        this.add(cx, cy, size, size, () => this.useOrEquip(it), {
          item: it, compare: slot ? p.equipment[slot] : null,
          onRight: () => this.askDrop(it),
        });
      }
    }

    const helpY = gy + gh + 10;
    text(g, 'ЛКМ — надеть / выпить  ·  ПКМ — выбросить  ·  наведи для сравнения', gx, helpY, { size: 8, color: UI.textFaint });
    // Продажи здесь нет намеренно: она должна быть только у торговца, иначе
    // лавка теряет смысл — сдать хлам можно было бы прямо из подземелья.
    text(g, 'Продать — у торговца в Велории.', gx, helpY + 11, { size: 8, color: UI.textFaint });

    // ── итог по герою
    //
    // Сводка переехала из левой колонки сюда: строки снаряжения стали выше
    // (в них добавились характеристики), и внизу слева места не осталось —
    // при первой же примерке она вылезла за панель.
    //
    // Мощь вынесена на отдельный язычок справа от заголовка: это единственное
    // число, по которому сравнивают два комплекта целиком, и в общем столбике
    // оно терялось между «крит. шансом» и «сниж. урона».
    const sy = py + ph - 11 - 60;
    hudPlate(g, gx - 5, sy, gw + 10, 60, { bevel: 5 });
    text(g, 'ИТОГ', gx, sy + 5, { size: 8, color: UI.accent, bold: true });

    const pw2 = measure(`Мощь ${p.power}`, 9, true) + 14;
    bevelPath(g, gx + gw - pw2, sy + 3, pw2, 12, 3);
    g.fillStyle = vgrad(g, sy + 3, 12, [0, 'rgba(96,74,26,0.85)', 1, 'rgba(48,36,12,0.85)']);
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(232,194,116,0.55)';
    g.stroke();
    text(g, `Мощь ${p.power}`, gx + gw - pw2 / 2, sy + 4.5, {
      size: 9, align: 'center', color: '#ffe6a8', bold: true,
    });
    goldRule(g, gx, sy + 18, gw, 0.5);

    const cells = [
      ['Урон', Math.round(p.attack), '#ff9a86'],
      ['Защита', Math.round(p.defense), '#8fb6ff'],
      ['Крит. шанс', Math.round(p.critChance * 100) + '%', '#ffd57a'],
      ['Сниж. урона', Math.round(p.damageReduction * 100) + '%', '#9fe0b4'],
      ['Здоровье', `${Math.ceil(p.hp)} / ${p.maxHp}`, UI.hp],
      ['Мана', `${Math.floor(p.mp)} / ${p.maxMp}`, UI.mp],
    ];
    // два столбца: подписи короткие, в один столбец половина ширины простаивала бы
    const cw = gw / 2;
    cells.forEach(([k, val, col], i) => {
      const cxx = gx + (i % 2) * cw;
      const cyy = sy + 24 + ((i / 2) | 0) * 12;
      const kw = measure(k, 9, false), vw = measure(String(val), 9, true);
      text(g, k, cxx, cyy, { size: 9, color: UI.textFaint });
      // выносная точечная линия — глаз не теряет строку на пути к числу
      g.fillStyle = 'rgba(255,255,255,0.10)';
      for (let dx = cxx + kw + 3; dx < cxx + cw - 8 - vw - 2; dx += 3) g.fillRect(dx, cyy + 6, 1, 1);
      text(g, String(val), cxx + cw - 8, cyy, { size: 9, align: 'right', color: col, bold: true });
    });
  }

  useOrEquip(it) {
    const p = this.game.player;
    if (it.kind === 'potion') { this.game.usePotion(it); return; }
    if (it.kind === 'scroll') { this.game.useScroll(it); return; }
    if (it.kind === 'material') { this.game.toast('Материал — нужен для заданий', UI.textDim); return; }
    if (it.reqLevel && p.level < it.reqLevel) {
      audio.play('deny');
      this.game.toast(`Нужен уровень ${it.reqLevel}`, UI.danger);
      return;
    }
    p.equip(it);
    this.game.toast('Надето: ' + it.name, (RARITY[it.rarity] || RARITY.common).color);
  }

  drawCharacter(g, px, py, pw, ph) {
    const p = this.game.player;
    const col1 = px + 16;
    text(g, 'ХАРАКТЕРИСТИКИ', col1, py + 10, { size: 9, color: UI.accent, bold: true });

    const stats = [
      ['str', 'Сила', 'урон оружием', '#ff8a6a'],
      ['vit', 'Выносливость', 'здоровье и защита', '#6fdc8c'],
      ['agi', 'Ловкость', 'скорость и крит', '#7fd8ff'],
      ['int', 'Разум', 'мана и магия', '#c99cff'],
    ];
    // Летопись переехала в левую колонку под опыт.
    //
    // Раньше правая колонка несла всё: бой, комплекты и летопись подряд. С
    // двумя активными комплектами она уезжала за низ панели на двадцать один
    // пиксель — то есть и за край экрана. Заметить это было трудно: комплекты
    // собираются не раньше середины игры. Заодно левая колонка простаивала
    // снизу на полсотни пикселей.
    const LW = 196;
    let y = py + 26;
    for (const [k, name, desc, col] of stats) {
      listRow(g, col1 - 6, y - 3, LW, 22, { accent: col });
      text(g, name, col1, y, { size: 10, color: UI.text, bold: true });
      text(g, desc, col1, y + 10, { size: 8, color: UI.textFaint });
      text(g, String(p[k] + p.gear[k]), col1 + 150, y + 2, { size: 12, align: 'right', color: col, bold: true });
      if (p.gear[k]) text(g, `(+${p.gear[k]})`, col1 + 154, y + 5, { size: 8, color: UI.good });

      if (p.statPoints > 0) {
        const bx2 = col1 + 172, by2 = y + 1;
        button(g, bx2, by2, 16, 16, '+', { hot: hit(this.mx, this.my, bx2, by2, 16, 16) });
        this.add(bx2, by2, 16, 16, () => { this.game.вложитьОчко(k); this.game.toast(`${name} +1`, col); });
      }
      y += 25;
    }

    if (p.statPoints > 0) {
      text(g, `Свободных очков развития: ${p.statPoints}`, col1, y + 3, { size: 9, color: UI.good, bold: true });
      text(g, 'Нажимай «+», чтобы вложить', col1, y + 14, { size: 8, color: UI.textFaint });
    } else {
      text(g, 'Очки развития дают новые уровни', col1, y + 3, { size: 8, color: UI.textFaint });
    }

    // опыт — сразу под характеристиками, а не в подвале
    const bx = col1, bw = LW - 6;
    const by = y + 26;
    text(g, `Опыт ${fmt(p.xp)} / ${fmt(p.xpNext)}`, bx, by - 11, { size: 9, color: UI.textDim });
    bar(g, bx, by, bw, 8, p.xp / p.xpNext, UI.xp, UI.xpDark, { label: `уровень ${p.level}` });

    // летопись
    let ly = by + 22;
    text(g, 'ЛЕТОПИСЬ', col1, ly, { size: 9, color: UI.accent, bold: true });
    ly += 14;
    const log = [
      ['Убито врагов', p.kills],
      ['Глубина катакомб', p.deepest + ' эт.'],
      ['Боссов повержено', p.stats.bossKills],
      ['Нанесено урона', fmt(p.stats.dmgDealt)],
    ];
    for (const [a, b] of log) {
      text(g, a, col1, ly, { size: 9, color: UI.textDim });
      text(g, String(b), col1 + bw, ly, { size: 9, align: 'right', color: UI.text });
      ly += 11;
    }

    // ── правая колонка: бой и комплекты
    const col2 = px + 226;
    const rx = px + pw - 16;
    text(g, 'В БОЮ', col2, py + 10, { size: 9, color: UI.accent, bold: true });
    const gg = p.gear;
    const rows = [
      ['Здоровье', `${Math.ceil(p.hp)} / ${p.maxHp}`],
      ['Мана', `${Math.floor(p.mp)} / ${p.maxMp}`],
      ['Урон', `${Math.round(p.attack)}`],
      ['Сила магии', `${Math.round(p.magicPower)}`],
      ['Защита', `${Math.round(p.defense)}  (−${Math.round(p.damageReduction * 100)}% урона)`],
      ['Крит. шанс', `${Math.round(p.critChance * 100)}%`],
      ['Крит. урон', `${Math.round(p.critMult * 100)}%`],
      ['Скорость', `${Math.round(p.moveSpeed)}`],
      ['Скор. атаки', `${(1 / p.attackRate).toFixed(2)}/сек`],
      ['Вампиризм', `${gg.lifesteal || 0}%`],
    ];
    let ry = py + 26;
    for (const [a, b] of rows) {
      text(g, a, col2, ry, { size: 9, color: UI.textDim });
      text(g, b, rx, ry, { size: 9, align: 'right', color: UI.text });
      ry += 11;
    }

    // активные комплекты: теперь помещаются все, а не первые два
    const act = p.sets.active;
    if (act.length) {
      ry += 8;
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(col2, ry - 4, rx - col2, 1);
      text(g, 'КОМПЛЕКТЫ', col2, ry, { size: 9, color: UI.accent, bold: true });
      ry += 13;
      for (const a2 of act) {
        text(g, ellipsize(a2.name, rx - col2 - 26, 9), col2, ry, { size: 9, color: a2.count >= 2 ? UI.good : UI.textDim });
        text(g, a2.count + '/4', rx, ry, { size: 9, align: 'right', color: a2.count >= 4 ? UI.good : UI.textDim });
        ry += 11;
      }
    }
  }

  drawQuests(g, px, py, pw, ph) {
    const q = this.game.quests;
    const p = this.game.player;
    const list = [...q.active, ...q.available, ...q.finished.slice(-6)];
    text(g, 'ЖУРНАЛ ЗАДАНИЙ', px + 12, py + 8, { size: 8, color: UI.accent, bold: true });

    const lx = px + 12, ly = py + 22, lw = 168;
    if (!list.length) {
      text(g, 'Заданий нет. Поговори с капитаном Дрейном в гильдии.', lx, ly + 10, { size: 9, color: UI.textDim });
      return;
    }
    this.selQuest = clamp(this.selQuest, 0, list.length - 1);

    // Прокрутка. Её тут не было, а список обрезался по низу панели: сюжетных
    // заданий двадцать четыре плюс контракты, и всё, что не влезло, было не
    // просто не видно — выбрать его было нельзя вовсе, потому что выбор идёт
    // кликом по строке. Строка при этом ужалась с 24 до 21: векторный шрифт
    // занимает меньше высоты, и на экран стало помещаться на две больше.
    const ROW = 21, listH = py + ph - 26 - ly;
    const maxRows = Math.max(1, Math.floor(listH / ROW));
    const off = clamp(this.scroll, 0, Math.max(0, list.length - maxRows));
    this.scroll = off;

    let y = ly;
    for (let i = off; i < Math.min(list.length, off + maxRows); i++) {
      const qq = list[i];
      const sel = i === this.selQuest;
      const hot = hit(this.mx, this.my, lx, y, lw, ROW - 2);
      const done = q.canComplete(qq, p);
      const col = qq.state === 'done' ? UI.textFaint : done ? UI.good : qq.state === 'available' ? UI.accent : UI.text;
      listRow(g, lx, y, lw, ROW - 2, { accent: col, hot, active: sel });
      const status = qq.state === 'done' ? 'сдано' : qq.state === 'available' ? 'доступно' : q.progressText(qq, p);
      const sw = measure(status, 8) + 8;
      text(g, ellipsize(qq.title, lw - 13 - sw, 9, sel), lx + 7, y + 2, { size: 9, color: col, bold: sel });
      text(g, status, lx + lw - 6, y + 10, { size: 8, align: 'right', color: done ? UI.good : UI.textFaint });
      this.add(lx, y, lw, ROW - 2, () => { this.selQuest = i; });
      y += ROW;
    }
    if (list.length > maxRows) scrollbar(g, lx + lw + 3, ly, maxRows * ROW - 3, list.length, maxRows, off);

    // деталь
    const dx = px + 192, dw = pw - 204;
    const qq = list[this.selQuest];
    if (!qq) return;
    text(g, qq.title, dx, py + 22, { size: 11, bold: true, color: UI.accent });
    text(g, `${t("Уровень {0}  ·  ").replace("{0}", qq.minLevel)}${t(q.targetName(qq))}`, dx, py + 36, { size: 8, color: UI.textFaint });
    let ty = py + 50;
    ty += textBlock(g, questDesc(qq), dx, ty, dw, { size: 9, color: UI.text, lineHeight: 12 });
    ty += 6;
    text(g, 'Прогресс: ' + q.progressText(qq, p), dx, ty, { size: 9, color: UI.textDim });
    ty += 16;
    text(g, 'НАГРАДА', dx, ty, { size: 8, color: UI.accent, bold: true });
    ty += 13;
    text(g, `${qq.xp} опыта`, dx, ty, { size: 9, color: UI.xp }); ty += 12;
    text(g, `${qq.gold} золота`, dx, ty, { size: 9, color: UI.gold }); ty += 12;
    if (qq.item) {
      const label = qq.item.kind === 'consumable' ? `предмет ×${qq.item.count || 1}` :
        `${(RARITY[qq.item.rarity] || RARITY.common).name.toLowerCase()} ${({ weapon: 'оружие', armor: 'доспех', helm: 'шлем', trinket: 'украшение' })[qq.item.kind] || 'предмет'}`;
      text(g, label, dx, ty, { size: 9, color: (RARITY[qq.item.rarity] || RARITY.common).color });
      ty += 12;
    }

    const by = py + ph - 26;
    if (qq.state === 'available') {
      button(g, dx, by, 110, 18, 'Принять', { hot: hit(this.mx, this.my, dx, by, 110, 18) });
      this.add(dx, by, 110, 18, () => this.game.acceptQuest(qq));
    } else if (qq.state === 'active' && q.canComplete(qq, p)) {
      button(g, dx, by, 110, 18, 'Сдать задание', { hot: hit(this.mx, this.my, dx, by, 110, 18) });
      this.add(dx, by, 110, 18, () => this.game.completeQuest(qq));
    } else if (qq.state === 'active') {
      text(g, 'Задание в работе', dx, by + 5, { size: 9, color: UI.textDim });
    }
  }

  drawMap(g, px, py, pw, ph) {
    const z = this.game.zone;
    const p = this.game.player;
    // переводим до подъёма регистра: держать в словаре ещё и версию капсом ни к чему
    text(g, t(z.name || 'Карта').toUpperCase(), px + 12, py + 8, { size: 8, color: UI.accent, bold: true });

    // Карта выросла: 268×186 → 296×208. Легенда с векторным шрифтом занимает
    // на четверть меньше ширины, и высвободившееся ушло карте. Масштаб зоны
    // считается по меньшей из сторон, поэтому и высота важна не меньше ширины:
    // на лесной карте 90×66 масштаб поднялся с 2,8 до 3,15 пикселя на клетку.
    // Рамка садится по самой карте, а не наоборот.
    //
    // Раньше место под карту было прямоугольником 296×208, а зона в него
    // вписывалась по меньшей стороне — и по бокам оставались чёрные поля в
    // полтора десятка пикселей. Теперь считается, сколько карта займёт на
    // самом деле, и оправа рисуется ровно по ней: полей нет ни при какой форме
    // зоны, а масштаб не изменился.
    const AVW = 296, AVH = 208;
    const avx = px + 12, avy = py + 22;
    const scale = Math.min(AVW / z.w, AVH / z.h);
    const mw = Math.round(z.w * scale), mh = Math.round(z.h * scale);
    const mx = Math.round(avx + (AVW - mw) / 2), my = Math.round(avy + (AVH - mh) / 2);
    const ox = mx, oy = my;
    const BEV = 5;

    hudPlate(g, mx - 3, my - 3, mw + 6, mh + 6, { bevel: BEV + 2 });

    g.save();
    bevelPath(g, mx, my, mw, mh, BEV); g.clip();
    g.fillStyle = '#0b0916';
    g.fillRect(mx, my, mw, mh);

    // тайлы
    for (let y = 0; y < z.h; y++) {
      for (let x = 0; x < z.w; x++) {
        const t = z.tiles[y * z.w + x];
        if (t === T.VOID) continue;
        g.fillStyle = t === T.WALL ? '#221f30' : t === T.LIQUID ? '#1d4266'
          : t === T.PATH ? '#5f5872' : t === T.GROUND2 ? '#3a4230' : '#2e3a2c';
        g.fillRect(ox + x * scale, oy + y * scale, Math.ceil(scale), Math.ceil(scale));
      }
    }

    // виньетка — карта гаснет к оправе, а не обрывается по ней ножом
    if (!this._mapVig || this._mapVig.k !== mw + 'x' + mh + 'x' + mx) {
      const r = g.createRadialGradient(mx + mw / 2, my + mh / 2, Math.min(mw, mh) * 0.34,
                                       mx + mw / 2, my + mh / 2, Math.max(mw, mh) * 0.62);
      r.addColorStop(0, 'rgba(6,4,12,0)');
      r.addColorStop(1, 'rgba(6,4,12,0.55)');
      this._mapVig = { k: mw + 'x' + mh + 'x' + mx, grad: r };
    }
    g.fillStyle = this._mapVig.grad;
    g.fillRect(mx, my, mw, mh);

    const pip = (cx, cy, r2, col) => {
      g.save(); g.translate(cx, cy); g.rotate(Math.PI / 4);
      g.fillStyle = 'rgba(4,3,10,0.85)'; g.fillRect(-r2 - 0.8, -r2 - 0.8, r2 * 2 + 1.6, r2 * 2 + 1.6);
      g.fillStyle = col; g.fillRect(-r2, -r2, r2 * 2, r2 * 2);
      g.restore();
    };
    for (const e of z.exits) {
      pip(ox + (e.x / TILE) * scale, oy + (e.y / TILE) * scale, 2.2,
          e.dest.kind === 'city' ? '#f0c05a' : e.dest.kind === 'dungeon' ? '#a86fff' : '#6fdc8c');
    }
    for (const c of z.chests) {
      if (c.opened) continue;
      pip(ox + (c.x / TILE) * scale, oy + (c.y / TILE) * scale, 1.7, '#ffd970');
    }
    for (const e of this.game.enemies) {
      if (e.dead) continue;
      const ex = ox + (e.x / TILE) * scale, ey = oy + (e.y / TILE) * scale;
      if (e.boss) {
        const pu = 3 + Math.sin(this.game.time * 4) * 1;
        g.fillStyle = 'rgba(255,74,74,0.28)';
        g.beginPath(); g.arc(ex, ey, pu + 2, 0, TAU); g.fill();
        pip(ex, ey, 2.4, '#ff4a4a');
      } else {
        g.fillStyle = 'rgba(4,3,10,0.8)';
        g.fillRect(ex - 1.6, ey - 1.6, 3.2, 3.2);
        g.fillStyle = e.elite ? '#ffa63a' : '#e0646a';
        g.fillRect(ex - 1, ey - 1, 2, 2);
      }
    }

    // герой — стрелка по взгляду, как на миникарте: один и тот же знак в двух
    // местах не заставляет учить два
    const hx = ox + (p.x / TILE) * scale, hy = oy + (p.y / TILE) * scale;
    g.save();
    g.translate(hx, hy);
    g.fillStyle = 'rgba(255,246,214,0.20)';
    g.beginPath(); g.arc(0, 0, 6, 0, TAU); g.fill();
    g.rotate(p.facing || 0);
    g.beginPath();
    g.moveTo(5.4, 0); g.lineTo(-3.4, 4); g.lineTo(-1.4, 0); g.lineTo(-3.4, -4);
    g.closePath();
    g.lineWidth = 2.2; g.lineJoin = 'round'; g.strokeStyle = 'rgba(4,3,10,0.9)';
    g.stroke();
    g.fillStyle = '#fff6d6';
    g.fill();
    g.restore();
    g.restore();

    // оправа и уголки — чертёжная рамка читается как карта, а не как картинка
    bevelPath(g, mx, my, mw, mh, BEV);
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(198,170,112,0.50)';
    g.stroke();
    g.fillStyle = 'rgba(198,170,112,0.55)';
    for (const [cx2, cy2, dx, dy] of [[mx, my, 1, 1], [mx + mw, my, -1, 1],
                                      [mx, my + mh, 1, -1], [mx + mw, my + mh, -1, -1]]) {
      g.fillRect(cx2 + (dx < 0 ? -7 : 0) + dx * BEV, cy2 + (dy < 0 ? -1 : 0), 7, 1);
      g.fillRect(cx2 + (dx < 0 ? -1 : 0), cy2 + (dy < 0 ? -7 : 0) + dy * BEV, 1, 7);
    }

    // ── легенда
    const lx = px + 316, lw = pw - 316 - 12;
    text(g, 'ЛЕГЕНДА', lx, py + 22, { size: 8, color: UI.accent, bold: true });
    goldRule(g, lx, py + 33, lw, 0.5);
    const leg = [['#ffffff', 'ты'], ['#f0c05a', 'портал в город'], ['#6fdc8c', 'переход'],
                 ['#a86fff', 'спуск'], ['#ffd970', 'сундук'], ['#ff4a4a', 'босс'], ['#e0646a', 'враг']];
    let ly = py + 39;
    for (const [c, n] of leg) {
      pip(lx + 3, ly + 4, 2.2, c);
      text(g, n, lx + 11, ly, { size: 9, color: UI.textDim });
      ly += 13;
    }

    ly += 6;
    text(g, 'ЗОНА', lx, ly, { size: 8, color: UI.accent, bold: true });
    goldRule(g, lx, ly + 11, lw, 0.5);
    ly += 17;
    const b = BIOMES[z.biomeId];
    text(g, b.name, lx, ly, { size: 10, color: UI.text, bold: true }); ly += 13;
    const info = [['Уровень мобов', '~' + z.level]];
    if (z.floor) info.push(['Этаж', String(z.floor)]);
    info.push(['Врагов', String(this.game.enemies.filter((e) => !e.dead).length)]);
    for (const [k, val] of info) {
      text(g, k, lx, ly, { size: 9, color: UI.textFaint });
      text(g, val, lx + lw, ly, { size: 9, align: 'right', color: UI.text });
      ly += 12;
    }
  }

  // ─────────────────────────────── лавка
  drawShop(g) {
    const { w: W, h: H } = this.view;
    const p = this.game.player;
    const shop = this.shop;
    this.dim(g, 0.55);
    // Панель подросла, а строка ужалась с 26 до 22: векторный шрифт занимает
    // меньше высоты, и на страницу стало помещаться восемь товаров вместо
    // шести. Пролистывать лавку на треть меньше — это и есть то место, ради
    // которого всё затевалось.
    const pw = 420, ph = 244;
    const px = (W - pw) >> 1, py = (H - ph) >> 1;
    panel(g, px, py, pw, ph, { title: t(shop.title).toUpperCase() });

    // Золото — на язычке, а не строчкой справки: в лавке это то число, на
    // которое смотрят перед каждой покупкой, и в общем ряду текста оно терялось.
    valueTab(g, px + pw - 12, py + 5, `${fmt(p.gold)} зол.`, { align: 'right', size: 10, h: 14 });

    const tabs = segTabs(g, px + 12, py + 8, 15,
      [{ id: 'buy', label: 'Купить' }, { id: 'sell', label: 'Продать' }], this.shopTab,
      { hot: (x, y, w, h) => hit(this.mx, this.my, x, y, w, h) });
    for (const tb of tabs) this.add(tb.x, tb.y, tb.w, tb.h, () => { this.shopTab = tb.id; this.scroll = 0; });
    text(g, 'ESC — уйти', px + 12, py + ph - 14, { size: 8, color: UI.textFaint });

    const listX = px + 12, listY = py + 32, listW = pw - 24;
    const items = this.shopTab === 'buy' ? shop.stock : p.inventory;   // раньше здесь стоял фильтр-тавтология
    const rowH = 24;
    const maxRows = Math.floor((py + ph - 20 - listY) / rowH);
    const off = clamp(this.scroll, 0, Math.max(0, items.length - maxRows));
    this.scroll = off;

    recess(g, listX - 4, listY - 4, listW + 8, maxRows * rowH + 6, { bevel: 4 });
    for (let i = 0; i < Math.min(maxRows, items.length - off); i++) {
      const it = items[i + off];
      const y = listY + i * rowH;
      const hot = hit(this.mx, this.my, listX, y, listW, rowH - 2);
      const rar = RARITY[it.rarity] || RARITY.common;
      // Продаётся стопка целиком (`sellItem` снимает `it.count`), значит и
      // цена должна быть за стопку. Оценивали поштучно, а забирали пачкой:
      // пятьдесят чешуек уходили за 52 золотых вместо 2600.
      const шт = it.count || 1;
      const price = this.shopTab === 'buy' ? it.price : Math.max(1, Math.floor(it.price * 0.35)) * шт;
      const afford = this.shopTab === 'sell' || p.gold >= price;

      listRow(g, listX, y, listW, rowH - 2, { rarity: it.rarity, hot });
      itemSlot(g, listX + 4, y + 1, 20, it, { time: this.game.time, hot });

      const bw = 52, bx = listX + listW - bw - 4;
      const priceW = valueTab(g, bx - 6, y + 5, price + 'з', { align: 'right', danger: !afford });
      const nameW = listW - 30 - bw - priceW - 16;
      text(g, ellipsize(it.name, nameW, 9, hot), listX + 29, y + 3, { size: 9, color: rar.color, bold: true });
      const sub = it.kind === 'potion' || it.kind === 'material' ? (it.desc || '') : `${statSummary(it)}`;
      text(g, ellipsize(sub, nameW, 8), listX + 29, y + 13, { size: 8, color: UI.textDim });

      button(g, bx, y + 3, bw, 16, this.shopTab === 'buy' ? 'Купить' : 'Продать', {
        hot: hit(this.mx, this.my, bx, y + 3, bw, 16), disabled: !afford,
      });
      const slot = p.slotOf(it);
      this.add(listX, y, listW - bw - 8, rowH - 2, null, { item: it, compare: slot ? p.equipment[slot] : null, price, priceLabel: this.shopTab === 'buy' ? 'Цена:' : 'Продать за:' });
      this.add(bx, y + 3, bw, 16, () => {
        if (this.shopTab === 'buy') this.game.buyItem(shop, it, price);
        else this.game.sellItem(it, price);
      });
    }
    scrollbar(g, px + pw - 8, listY, maxRows * rowH, items.length * rowH, maxRows * rowH, off * rowH);
    if (!items.length) {
      this.emptyState(g, listX, listY, listW, maxRows * rowH,
        this.shopTab === 'buy' ? 'Товар закончился.' : 'Нечего продавать.',
        this.shopTab === 'buy' ? 'Загляни позже — запас пополнится.' : 'Хлам из подземелья продают здесь.');
    }
  }

  /**
   * Пустой список. Одна серая строчка посреди пустоты выглядит недоделкой;
   * ромб, заголовок и подсказка «что делать» — намеренным состоянием.
   */
  emptyState(g, x, y, w, h, title, hint) {
    const cx = x + w / 2, cy = y + h / 2 - 12;
    g.save();
    g.translate(cx, cy);
    g.rotate(Math.PI / 4);
    g.strokeStyle = 'rgba(150,126,80,0.45)';
    g.lineWidth = 1;
    g.strokeRect(-5, -5, 10, 10);
    g.restore();
    text(g, title, cx, cy + 12, { size: 10, align: 'center', color: UI.textDim, bold: true });
    if (hint) text(g, hint, cx, cy + 25, { size: 8, align: 'center', color: UI.textFaint });
  }

  // ─────────────────────────────── выбор двери при спуске
  drawDescend(g) {
    const { w: W, h: H } = this.view;
    const d = this.game.pendingDescend;
    if (!d) { this.close(); return; }
    this.dim(g, 0.72);
    // порча считается от этажа, куда спускаешься, — её видно до выбора двери
    const corr = Math.max(0, Math.min(CORRUPTION_MAX, d.floor - (ABYSS_START - 1)));
    const cname = corruptionName(corr);
    const deep = this.game.player.deepest || 0;
    text(g, corr ? `БЕЗДНА · ЭТАЖ ${d.floor}` : `СПУСК НА ЭТАЖ ${d.floor}`, W / 2, 22,
         { size: 15, align: 'center', bold: true, color: corr ? '#d06ad0' : '#b08aff', outline: 'rgba(0,0,0,0.9)' });
    text(g, `рекорд глубины: ${deep}`, W / 2, 39, { size: 8, align: 'center', color: UI.textFaint });

    const cw = 176, ch = 128;
    const gap = 24;
    const total = cw * 2 + gap;
    const top = corr ? 96 : 74;

    if (corr) {
      // порча — не выбор, а условие: показываем до дверей и отдельным блоком
      const bw = total, bx = (W - bw) / 2, by = 48;
      listRow(g, bx, by, bw, 40, { accent: '#d06ad0', bevel: 4 });
      text(g, t(cname).toUpperCase() + ' · ' + corr, bx + 10, by + 5, { size: 10, bold: true, color: '#ff9ae0' });
      let lx = bx + 10;
      for (const [label, val, good] of corruptionLines(corr)) {
        text(g, label, lx, by + 19, { size: 8, color: UI.textFaint });
        text(g, val, lx, by + 28, { size: 9, color: good ? UI.good : '#ff8a90' });
        lx += Math.max(measure(label, 8), measure(val, 9)) + 14;
      }
    } else {
      text(g, 'Выбери дверь — условия этажа изменить будет нельзя', W / 2, 50, { size: 9, align: 'center', color: UI.textDim });
    }

    d.doors.forEach((key, i) => {
      const m = FLOOR_MODS[key];
      const x = (W - total) / 2 + i * (cw + gap), y = top;
      const hot = hit(this.mx, this.my, x, y, cw, ch);
      const reward = modReward(key);
      const col = reward > 40 ? '#ff8a5e' : reward > 0 ? UI.accent : UI.good;

      // Карточка двери — плита с фаской и цветной оправой по цене риска.
      // Раньше это была обычная панель с прямым углом: выбор, от которого
      // зависит весь этаж, выглядел строкой меню.
      hudPlate(g, x, y, cw, ch, {
        bevel: 6,
        top: hot ? 'rgba(44,36,72,0.94)' : 'rgba(24,19,42,0.90)',
        bottom: hot ? 'rgba(18,14,32,0.94)' : 'rgba(9,7,18,0.92)',
        border: rgba(col, hot ? 0.9 : 0.45),
      });
      // «дверь» — арка в нише
      const dx = x + cw / 2 - 22, dy = y + 10;
      recess(g, dx, dy, 44, 34, { bevel: 5, border: rgba(col, 0.5) });
      g.save();
      bevelPath(g, dx, dy, 44, 34, 5); g.clip();
      g.fillStyle = rgba(col, hot ? 0.26 : 0.14);
      g.fillRect(dx, dy, 44, 34);
      g.restore();
      text(g, String(i + 1), x + cw / 2, y + 22, { size: 14, align: 'center', bold: true, color: col });

      text(g, m.name, x + cw / 2, y + 52, { size: 12, align: 'center', bold: true, color: col });
      goldRule(g, x + 20, y + 66, cw - 40, 0.45);
      textBlock(g, m.desc, x + 12, y + 71, cw - 24, { size: 9, color: UI.text, lineHeight: 12 });
      valueTab(g, x + cw / 2, y + ch - 22,
               reward > 0 ? `награда +${reward}%` : reward < 0 ? `награда ${reward}%` : 'награда без изменений',
               { align: 'center', danger: reward < 0 });

      this.add(x, y, cw, ch, () => this.game.chooseDoor(key));
    });
    text(g, corr
      ? 'Модификатор — на этаж. Порча растёт с глубиной и не снимается.'
      : 'Модификатор действует только на этом этаже',
      W / 2, H - 20, { size: 9, align: 'center', color: UI.textFaint });
  }

  // ─────────────────────────────── проклятый алтарь
  drawAltar(g) {
    const { w: W, h: H } = this.view;
    const d = this.altar;
    if (!d) { this.close(); return; }
    this.dim(g, 0.66);
    const pw = 280, ph = 150;
    const px = (W - pw) >> 1, py = (H - ph) >> 1;
    panel(g, px, py, pw, ph, { border: '#c05fd0', title: t(d.def.name).toUpperCase(), titleColor: '#ff8ac0' });

    textBlock(g, d.def.offer, px + 14, py + 14, pw - 28, { size: 10, color: UI.text, lineHeight: 13 });
    // Сделка — две чаши весов, и выглядеть они должны одинаково по весу:
    // раньше «получишь» и «отдашь» были просто двумя строчками подряд.
    let y = py + 52;
    for (const [head, line, col] of [['ПОЛУЧИШЬ', d.def.gain, UI.good], ['ОТДАШЬ', d.def.cost, UI.danger]]) {
      listRow(g, px + 14, y, pw - 28, 28, { accent: col, bevel: 3 });
      text(g, head, px + 22, y + 3, { size: 8, color: col, bold: true });
      text(g, line, px + 22, y + 14, { size: 10, color: col });
      y += 32;
    }

    const by = py + ph - 26;
    const bw = 110;
    plateButton(g, px + 14, by, bw, 18, 'Принять', { hot: hit(this.mx, this.my, px + 14, by, bw, 18) });
    this.add(px + 14, by, bw, 18, () => this.game.acceptAltar(d.altar, d.def));
    plateButton(g, px + pw - bw - 14, by, bw, 18, 'Отказаться', { hot: hit(this.mx, this.my, px + pw - bw - 14, by, bw, 18) });
    this.add(px + pw - bw - 14, by, bw, 18, () => this.close());
  }

  // ─────────────────────────────── кузня
  drawCraft(g) {
    const { w: W, h: H } = this.view;
    const p = this.game.player;
    this.dim(g);
    const pw = 430, ph = 240;
    const px = (W - pw) >> 1, py = (H - ph) >> 1;
    panel(g, px, py, pw, ph, { title: 'КУЗНЯ БОРИНА' });
    valueTab(g, px + pw - 12, py + 3, `${fmt(p.gold)} зол.`, { align: 'right', size: 10, h: 14 });

    const tabs = segTabs(g, px + 12, py + 8, 15,
      [{ id: 'forge', label: 'Ковка' }, { id: 'sharpen', label: 'Заточка' },
       { id: 'reforge', label: 'Переплавка' }, { id: 'salvage', label: 'Разбор' }], this.craftTab,
      { hot: (x, y, w, h) => hit(this.mx, this.my, x, y, w, h) });
    for (const tb of tabs) this.add(tb.x, tb.y, tb.w, tb.h, () => { this.craftTab = tb.id; this.scroll = 0; this.drag = null; });
    text(g, 'ESC — уйти', px + 12, py + ph - 13, { size: 8, color: UI.textFaint });
    if (this.craftTab === 'forge') {
      // Вкладка Пролома — единственное исключение из общего правила, и старая
      // подсказка на ней прямо врала. Врущая подсказка хуже отсутствующей:
      // игрок верит ей и не открывает вкладку.
      text(g, this.craftCat === 'breach'
             ? 'Ковка Пролома даёт свойство, которое выберешь. Стекло разлома снимают с тех, кто ковал.'
             : 'Ковка не даёт уникальных свойств — их находят или берут заточкой на +7.',
           px + pw - 12, py + ph - 13, { size: 8, align: 'right', color: UI.textFaint });
    }

    if (this.craftTab === 'sharpen') this.drawSharpen(g, px, py, pw, ph);
    else if (this.craftTab === 'salvage') this.drawItemPick(g, px, py, pw, ph, 'salvage');
    else if (this.craftTab === 'reforge') this.drawItemPick(g, px, py, pw, ph, 'reforge');
    else this.drawForge(g, px, py, pw, ph);
  }

  drawForge(g, px, py, pw, ph) {
    const p = this.game.player;
    const cats = segTabs(g, px + 12, py + 28, 14,
      CRAFT_CATS.map((c) => ({ id: c.id, label: c.name })), this.craftCat,
      { pad: 8, hot: (x, y, w, h) => hit(this.mx, this.my, x, y, w, h) });
    for (const c of cats) this.add(c.x, c.y, c.w, c.h, () => { this.craftCat = c.id; this.scroll = 0; });
    // выбор типа оружия
    let listTop = py + 50;
    if (this.craftCat === 'weapon') {
      const subs = segTabs(g, px + 12, listTop - 2, 13,
        WEAPON_SUBS.map((s) => ({ id: s.id, label: s.name })), this.craftSub,
        { pad: 7, hot: (x, y, w, h) => hit(this.mx, this.my, x, y, w, h) });
      for (const sb of subs) this.add(sb.x, sb.y, sb.w, sb.h, () => { this.craftSub = sb.id; });
      listTop += 19;
    }

    const all = recipesFor(this.craftCat, this.craftSub);
    // Помечаем каждый рецепт его местом в общем списке: в общем мире куёт
    // комната, и назвать рецепт она должна тем же способом, что и мы.
    all.forEach((r, i) => { r.cat = this.craftCat; r.sub = this.craftSub; r.idx = i; });
    const list = all.filter((r) => r.lvl <= p.level + 4);
    const rowH = 22;
    const maxRows = Math.floor((py + ph - 22 - listTop) / rowH);
    const off = clamp(this.scroll, 0, Math.max(0, list.length - maxRows));
    this.scroll = off;

    if (!list.length) {
      this.emptyState(g, px + 12, listTop, pw - 24, maxRows * rowH,
                      'Пока нечего ковать.', 'Рецепты открываются с уровнем героя.');
    }

    for (let i = 0; i < Math.min(maxRows, list.length - off); i++) {
      const r = list[i + off];
      const y = listTop + i * rowH;
      const locked = p.level < r.lvl;
      const ok = !locked && canAfford(p, r);
      const hot = hit(this.mx, this.my, px + 12, y, pw - 24, rowH - 3);
      listRow(g, px + 12, y, pw - 24, rowH - 3, { hot });
      // ребро тут не о редкости, а о доступности: серое — рано, зелёное —
      // хватает всего, красное — чего-то не хватает
      g.fillStyle = locked ? 'rgba(90,80,120,0.5)' : ok ? rgba(UI.good, 0.85) : rgba(UI.danger, 0.85);
      g.fillRect(px + 12, y + 2, 2, rowH - 7);

      text(g, r.name, px + 20, y + 2, { size: 10, color: locked ? UI.textFaint : UI.text, bold: true });
      // У ковки Пролома платят за свойство, а не за числа: без описания игрок
      // видит пять одинаковых строк по 7200 золота и не понимает, что берёт.
      if (r.desc) {
        text(g, t(r.desc), px + 20 + measure(t(r.name), 10) + 10, y + 3,
             { size: 8, color: UI.textFaint });
      }
      // материалы построчно
      const parts = matsText(r.mats, p);
      let mx2 = px + 20;
      for (const m of parts) {
        // «×3» вместо «53/3»: нужное количество читается сразу, наличие — только когда его мало
        const s2 = `${t(m.name)} ×${m.need}` + (m.ok ? '' : t(' (есть {0})').replace('{0}', m.have));
        text(g, s2, mx2, y + 14, { size: 8, color: m.ok ? UI.textDim : UI.danger });
        mx2 += measure(s2, 8) + 10;
      }
      valueTab(g, px + pw - 76, y + 4, locked ? t('ур. {0}').replace('{0}', r.lvl) : r.gold + 'з',
               { align: 'right', danger: locked || p.gold < r.gold });

      const bw = 54, bx = px + pw - bw - 16;
      button(g, bx, y + 4, bw, 16, 'Ковать', { hot: hit(this.mx, this.my, bx, y + 4, bw, 16), disabled: !ok });
      if (ok) this.add(bx, y + 4, bw, 16, () => this.game.craft(r));
    }
    scrollbar(g, px + pw - 8, listTop, maxRows * rowH, list.length * rowH, maxRows * rowH, off * rowH);
  }

  /**
   * Топливо заточки: что игрок выбрал руками.
   *
   * Раньше три ствола подбирались сами — три слабейших той же редкости, — и
   * слоты показывали «?». Работало это правильно, но игрок не видел, что
   * именно сгорит, и не мог решить сам: «слабейшее по силе» и «ненужное» — не
   * одно и то же, легендарка с плохими числами может быть дорога свойством.
   * Теперь выбор его, а `sharpenFuel` осталась кнопкой «Авто».
   *
   * Держим ссылки на сами предметы, а не индексы: инвентарь между кадрами
   * может перестроиться (продажа, подбор), и индекс начал бы указывать в
   * чужую вещь. Перед каждым показом список чистится от того, чего уже нет.
   */
  sharpenFuelList(p, base) {
    if (!this._fuelSel || this._fuelBase !== base) { this._fuelSel = []; this._fuelBase = base; }
    this._fuelSel = this._fuelSel.filter((i) => i && p.inventory.includes(i) && this.fuelOk(i, base));
    return this._fuelSel;
  }

  /** Годится ли вещь в топливо: то же правило, что и было у автоподбора. */
  fuelOk(it, base) {
    return !!it && it.kind === 'weapon' && it.rarity === base.rarity && it !== base;
  }

  drawSharpen(g, px, py, pw, ph) {
    const p = this.game.player;
    const base = p.equipment.weapon;
    const y0 = py + 26;
    if (!base) {
      text(g, 'Надень оружие — точить будем его.', px + 14, y0 + 20, { size: 10, color: UI.textDim });
      return;
    }
    const rar = RARITY[base.rarity] || RARITY.common;
    const fuel = this.sharpenFuelList(p, base);
    const cost = sharpenCost(base);
    const chance = sharpenChance(base);
    const maxed = (base.sharp || 0) >= SHARP_MAX;

    // ── затачиваемое
    itemSlot(g, px + 14, y0, 26, base, { time: this.game.time });
    text(g, base.name, px + 46, y0 + 1, { size: 11, bold: true, color: rar.color });
    text(g, `${t(rar.name).toLowerCase()} · ${t("заточка +{0} из {1}").replace("{0}", base.sharp || 0).replace("{1}", SHARP_MAX)}`, px + 46, y0 + 14, { size: 9, color: UI.textDim });
    this.add(px + 14, y0, 26, 26, null, { item: base });

    // ── своё оружие: источник, из которого тянут
    //
    // Показываем только годное. Показывать всё и гасить негодное мы пробовали
    // мысленно и отказались: у игрока к сороковому уровню рюкзак на сотню
    // вещей, и полоса из серых иконок не объясняет правило, а прячет его.
    // Вместо этого правило написано словами прямо над полосой.
    const iw = 5, ih = 2;                       // сетка справа: 5 × 2
    const ix = px + 264, iy = y0 + 14;
    const годные = p.inventory.filter((i) => this.fuelOk(i, base) && !fuel.includes(i));
    const страниц = Math.max(1, Math.ceil(годные.length / (iw * ih)));
    this.invPage = clamp(this.invPage || 0, 0, страниц - 1);
    text(g, 'ТВОЁ ОРУЖИЕ', ix, y0, { size: 8, color: UI.accent, bold: true });
    // Стрелки и счётчик жмутся к правому краю сетки, а подпись про редкость
    // ушла под неё. Сначала они стояли в одну строку, и на английском
    // «“legendary” only» съезжало прямо на «1/2»: русская подпись короче, и
    // на ней это не было видно.
    if (страниц > 1) {
      const ax = ix + iw * 30 - 30;
      for (const [dx, dir, lab] of [[0, -1, '‹'], [18, 1, '›']]) {
        const can = dir < 0 ? this.invPage > 0 : this.invPage < страниц - 1;
        text(g, lab, ax + dx, y0 - 2, { size: 11, bold: true, color: can ? UI.text : UI.textFaint });
        if (can) this.add(ax + dx - 4, y0 - 3, 14, 13, () => { this.invPage += dir; });
      }
      text(g, `${this.invPage + 1}/${страниц}`, ax - 18, y0, { size: 8, color: UI.textFaint });
    }
    const off = this.invPage * iw * ih;
    for (let i = 0; i < iw * ih; i++) {
      const it = годные[off + i];
      const sx = ix + (i % iw) * 30, sy = iy + Math.floor(i / iw) * 30;
      const hot = hit(this.mx, this.my, sx, sy, 26, 26);
      itemSlot(g, sx, sy, 26, it, { time: this.game.time, hot: hot && it });
      if (it) {
        this.add(sx, sy, 26, 26, null, { item: it, grab: { item: it, from: 'inv' } });
      }
    }
    text(g, t("годится только редкость «{a}»").replace("{a}", t(rar.name).toLowerCase()),
         ix, iy + ih * 30 + 3, { size: 8, color: UI.textFaint });
    if (!годные.length && fuel.length < 3) {
      text(g, 'Нет подходящего оружия.', ix, iy + 8, { size: 9, color: UI.danger });
    }

    // ── три слота топлива: сюда кладут
    const fy = y0 + 44;
    text(g, 'ТОПЛИВО ×3', px + 14, fy, { size: 8, color: UI.accent, bold: true });
    text(g, fuel.length + '/3', px + 76, fy, { size: 9, bold: true, color: fuel.length >= 3 ? UI.good : UI.danger });
    // «Авто» никуда не делась: ручной выбор не должен превращать привычное
    // действие в три лишних клика
    const abw = 34, abx = px + 100;
    const может = годные.length + fuel.length >= 3 && fuel.length < 3;
    button(g, abx, fy - 3, abw, 13, 'Авто', { hot: hit(this.mx, this.my, abx, fy - 3, abw, 13), disabled: !может });
    if (может) {
      this.add(abx, fy - 3, abw, 13, () => {
        for (const it of sharpenFuel(p, base)) {
          if (this._fuelSel.length >= 3) break;
          if (!this._fuelSel.includes(it)) this._fuelSel.push(it);
        }
      });
    }
    const sy0 = fy + 12;
    for (let i = 0; i < 3; i++) {
      const it = fuel[i];
      const sx = px + 14 + i * 30;
      const цель = this.drag && !it;             // куда можно бросить то, что тащим
      const hot = hit(this.mx, this.my, sx, sy0, 26, 26);
      itemSlot(g, sx, sy0, 26, it, { time: this.game.time, placeholder: цель ? '+' : '?', hot: hot && (it || цель) });
      if (цель) {                                // подсветка приёмника
        g.strokeStyle = hot ? UI.good : 'rgba(110,220,140,0.45)';
        g.lineWidth = 1;
        g.strokeRect(sx + 0.5, sy0 + 0.5, 25, 25);
      }
      this.add(sx, sy0, 26, 26, null, it ? { item: it, grab: { item: it, from: 'fuel' } } : { drop: i });
    }
    text(g, 'Тащи сюда или щёлкни — вещь сгорит.', px + 14, sy0 + 30, { size: 8, color: UI.textFaint });

    // ── шанс
    const cxr = px + 150;
    text(g, 'ШАНС УСПЕХА', cxr, fy, { size: 8, color: UI.accent, bold: true });
    const pct = Math.round(chance * 100);
    text(g, pct + '%', cxr, fy + 10, { size: 20, bold: true, color: pct >= 45 ? UI.good : pct >= 22 ? UI.accent : UI.danger });
    bar(g, cxr, fy + 34, 96, 6, chance, pct >= 45 ? UI.good : pct >= 22 ? UI.accent : UI.hp, '#2a1420');
    text(g, `при удаче: +${Math.round(SHARP_GAIN * 100)}% к характеристикам`, cxr, fy + 44, { size: 8, color: UI.textDim });

    // ── цена
    const py2 = y0 + 96;
    text(g, 'ЦЕНА', px + 14, py2, { size: 8, color: UI.accent, bold: true });
    text(g, cost.gold + ' зол.', px + 44, py2, { size: 9, color: p.gold >= cost.gold ? UI.gold : UI.danger });
    let mx2 = px + 44 + measure(cost.gold + ' зол.', 9) + 12;
    for (const m of matsText(cost.mats, p)) {
      const s2 = `${t(m.name)} ×${m.need}` + (m.ok ? '' : t(' (есть {0})').replace('{0}', m.have));
      text(g, s2, mx2, py2, { size: 9, color: m.ok ? UI.textDim : UI.danger });
      mx2 += measure(s2, 9) + 12;
    }

    // ── дорожка вех — то, ради чего оружие держат дольше двух уровней
    const ty0 = y0 + 112;
    text(g, 'ВЕХИ ЗАТОЧКИ', px + 14, ty0, { size: 8, color: UI.accent, bold: true });
    const lvl = base.sharp || 0;
    const nm = nextMilestone(base);
    const floor = sharpFloor(base);
    for (let i = 1; i <= SHARP_MAX; i++) {
      const bx2 = px + 14 + (i - 1) * 30;
      const isMil = !!SHARP_MILESTONES[i];
      const open = milestoneOpen(base, i);
      const done = lvl >= i;
      const nextUp = i === lvl + 1;
      g.fillStyle = done ? (isMil && open ? '#ffd54a' : UI.good)
                  : isMil && open ? 'rgba(255,213,74,0.18)' : 'rgba(255,255,255,0.06)';
      g.fillRect(bx2, ty0 + 12, 26, isMil ? 13 : 9);
      if (nextUp) {
        g.fillStyle = UI.accent;
        g.fillRect(bx2, ty0 + 12, 26, 1);
        g.fillRect(bx2, ty0 + 12 + (isMil ? 12 : 8), 26, 1);
      }
      if (i === floor) {  // точка отката — сюда вернёшься при провале
        g.fillStyle = UI.good;
        g.fillRect(bx2 + 11, ty0 + 8, 4, 3);
      }
      text(g, '+' + i, bx2 + 13, ty0 + 14, {
        size: 8, align: 'center', bold: isMil,
        color: done ? '#140f22' : isMil && open ? '#ffd54a' : UI.textFaint,
      });
      if (isMil) {
        text(g, open ? ['аффикс', 'закалка', 'свойство'][MILESTONE_LEVELS.indexOf(i)] : 'с редкого',
             bx2 + 13, ty0 + 27,
             { size: 8, align: 'center', color: !open ? '#6a6280' : done ? '#ffd54a' : UI.textFaint });
      }
    }
    const upcoming = MILESTONE_LEVELS.find((m) => m > lvl && milestoneOpen(base, m));
    textBlock(g, maxed ? 'Все вехи взяты.'
         : nm ? t("Следующая заточка — веха: {a}.").replace("{a}", t(nm.label))
         : upcoming ? `До ближайшей вехи ещё ${upcoming - lvl} уровня заточки.`
                    : 'Веха +7 открыта только редкому оружию и выше.',
         px + 264, ty0 + 14, 150, { size: 9, color: nm ? '#ffd54a' : UI.textDim });

    // ── предупреждение и кнопка
    const wy = py + ph - 62;
    g.fillStyle = floor ? 'rgba(120,90,20,0.24)' : 'rgba(120,20,30,0.28)';
    g.fillRect(px + 12, wy, pw - 24, 26);
    g.fillStyle = floor ? '#e0a03d' : UI.danger;
    g.fillRect(px + 12, wy, 2, 26);
    if (floor) {
      text(g, 'Топливо сгорает в любом случае.', px + 20, wy + 3, { size: 9, color: '#ffc98a' });
      text(g, `Оружие уцелеет: при неудаче откатится к вехе +${floor}.`, px + 20, wy + 14, { size: 9, color: UI.good, bold: true });
    } else {
      text(g, 'При неудаче сгорает всё: и топливо, и само оружие.', px + 20, wy + 3, { size: 9, color: '#ff9a90' });
      text(g, `Вехи ещё нет — откатываться некуда. С +${MILESTONE_LEVELS[0]} оружие уже не гибнет.`, px + 20, wy + 14, { size: 9, color: UI.danger, bold: true });
    }

    const ready = fuel.length >= 3 && !maxed && p.gold >= cost.gold &&
      matsText(cost.mats, p).every((m) => m.ok);
    const bw = 150, bx = px + (pw - bw) / 2, by = py + ph - 30;
    const armed = this.sharpenArmed && this.sharpenArmed > this.game.time;
    button(g, bx, by, bw, 19, maxed ? 'Дальше некуда' : (!floor && armed) ? 'ТОЧНО? ЖМИ ЕЩЁ РАЗ' : 'Заточить',
           { hot: hit(this.mx, this.my, bx, by, bw, 19) || armed, disabled: !ready });
    if (ready) {
      this.add(bx, by, bw, 19, () => {
        if (floor || armed) { this.sharpenArmed = 0; this.game.sharpen(fuel.slice(0, 3)); }
        else { this.sharpenArmed = this.game.time + 4; audio.play('deny'); }
      });
    }
  }

  /** Общий список предметов для разбора и переплавки. */
  drawItemPick(g, px, py, pw, ph, mode) {
    const p = this.game.player;
    const listTop = py + 26;
    const items = p.inventory.filter((i) => ['weapon', 'armor', 'helm', 'trinket'].includes(i.kind));
    text(g, mode === 'salvage'
      ? 'Разбор превращает вещь в материалы. Вещь пропадает.'
      : 'Переплавка бросает аффиксы заново. Ранг и редкость сохраняются.',
      px + 14, listTop, { size: 9, color: UI.textDim });

    const rowH = 26;
    const top = listTop + 14;
    const maxRows = Math.floor((py + ph - 22 - top) / rowH);
    const off = clamp(this.scroll, 0, Math.max(0, items.length - maxRows));
    this.scroll = off;
    if (!items.length) {
      this.emptyState(g, px + 12, top, pw - 24, maxRows * rowH, 'В рюкзаке нет снаряжения.',
                      mode === 'salvage' ? 'Разбирают лишние вещи — сначала их надо найти.'
                                         : 'Переплавляют уже найденное — сходи в подземелье.');
    }

    for (let i = 0; i < Math.min(maxRows, items.length - off); i++) {
      const it = items[i + off];
      const y = top + i * rowH;
      const rar = RARITY[it.rarity] || RARITY.common;
      const hot = hit(this.mx, this.my, px + 12, y, pw - 24, rowH - 3);
      listRow(g, px + 12, y, pw - 24, rowH - 3, { rarity: it.rarity, hot });
      itemSlot(g, px + 17, y + 2, 22, it, { time: this.game.time, hot });
      text(g, ellipsize(it.name, 150, 9), px + 44, y + 3, { size: 9, color: rar.color, bold: true });

      if (mode === 'salvage') {
        const y2 = salvageYield(it);
        const txt = Object.keys(y2.mats).map((k) => t(matName(k)) + '×' + y2.mats[k]).join(', ');
        text(g, ellipsize(txt || '—', 190, 8), px + 44, y + 14, { size: 8, color: UI.good });
        const bw = 54, bx = px + pw - bw - 16;
        button(g, bx, y + 4, bw, 16, 'Разобрать', { hot: hit(this.mx, this.my, bx, y + 4, bw, 16) });
        this.add(bx, y + 4, bw, 16, () => this.game.salvage(it));
      } else {
        const c = reforgeCost(it);
        const parts = matsText(c.mats, p);
        text(g, parts.map((m) => `${t(m.name)} ×${m.need}` + (m.ok ? '' : t(' (есть {0})').replace('{0}', m.have))).join(', '), px + 44, y + 14,
             { size: 8, color: parts.every((m) => m.ok) ? UI.textDim : UI.danger });
        valueTab(g, px + pw - 76, y + 5, c.gold + 'з', { align: 'right', danger: p.gold < c.gold });
        const ok = p.gold >= c.gold && parts.every((m) => m.ok);
        const bw = 54, bx = px + pw - bw - 16;
        button(g, bx, y + 4, bw, 16, 'Переплавить', { hot: hit(this.mx, this.my, bx, y + 4, bw, 16), disabled: !ok });
        if (ok) this.add(bx, y + 4, bw, 16, () => this.game.reforge(it));
      }
      this.add(px + 12, y, pw - 90, rowH - 3, null, { item: it });
    }
    scrollbar(g, px + pw - 8, top, maxRows * rowH, items.length * rowH, maxRows * rowH, off * rowH);
  }

  // ─────────────────────────────── слияние рун
  drawFuse(g) {
    const { w: W, h: H } = this.view;
    const p = this.game.player;
    this.dim(g);
    const pw = 360, ph = 214;
    const px = (W - pw) >> 1, py = (H - ph) >> 1;
    panel(g, px, py, pw, ph, { title: 'СЛИЯНИЕ РУН' });
    text(g, 'Три одинаковые руны → одна рангом выше', px + 12, py + 9, { size: 9, color: UI.textDim });
    valueTab(g, px + pw - 12, py + 6, `${fmt(p.gold)} зол.`, { align: 'right', size: 10, h: 14 });

    const groups = runeGroups(p);

    const rowH = 28;
    const maxRows = Math.floor((ph - 54) / rowH);
    const off = clamp(this.scroll, 0, Math.max(0, groups.length - maxRows));
    this.scroll = off;

    for (let i = 0; i < Math.min(maxRows, groups.length - off); i++) {
      const gr = groups[i + off];
      const y = py + 26 + i * rowH;
      const sample = gr.items[0];
      const rar = RARITY[gr.rarity] || RARITY.common;
      const nextR = RARITY[RARITY_ORDER[RARITY_ORDER.indexOf(gr.rarity) + 1]];
      const ready = gr.items.length >= 3;
      const cost = fuseCost(gr.rarity, p.level);
      const hot = hit(this.mx, this.my, px + 12, y, pw - 24, rowH - 3);

      listRow(g, px + 12, y, pw - 24, rowH - 3, { rarity: gr.rarity, hot });
      itemSlot(g, px + 17, y + 2, 22, sample, { time: this.game.time, hot });
      text(g, sample.name, px + 44, y + 3, { size: 9, color: rar.color, bold: true });
      text(g, `${t(rar.name).toLowerCase()} · ${gr.items.length}/3`, px + 44, y + 14, {
        size: 8, color: ready ? UI.good : UI.textFaint,
      });
      if (nextR) text(g, '→ ' + t(nextR.name).toLowerCase(), px + pw - 132, y + 9, { size: 9, align: 'right', color: nextR.color });
      valueTab(g, px + pw - 74, y + 6, cost + 'з', { align: 'right', danger: p.gold < cost });

      const bw = 56, bx = px + pw - bw - 16;
      button(g, bx, y + 4, bw, 17, 'Слить', {
        hot: hit(this.mx, this.my, bx, y + 4, bw, 17), disabled: !ready || p.gold < cost,
      });
      this.add(px + 12, y, pw - bw - 34, rowH - 3, null, { item: sample });
      if (ready && p.gold >= cost) this.add(bx, y + 4, bw, 17, () => this.game.fuseRunes(gr));
    }
    scrollbar(g, px + pw - 8, py + 26, maxRows * rowH, groups.length * rowH, maxRows * rowH, off * rowH);
    if (!groups.length) {
      this.emptyState(g, px + 12, py + 26, pw - 24, maxRows * rowH, 'Одинаковых рун пока нет.',
                      'Дубликаты падают с элиты и боссов — не продавай их.');
    }
    text(g, 'ESC — уйти', px + 12, py + ph - 14, { size: 8, color: UI.textFaint });
  }

  // ─────────────────────────────── диалог
  drawDialogue(g) {
    const { w: W, h: H } = this.view;
    const d = this.dialogue;
    const bh = 86;
    const by = H - bh - 8;
    // Разговор — единственный экран, который лежит прямо на мире, а не на
    // затемнении. Поэтому ему, как панелям HUD, нужна тень: без неё окно
    // читается дырой в картинке, а не листом поверх неё.
    // Плита почти непрозрачная: разговор ложится поверх пояса и трекера
    // заданий, и сквозь обычные для HUD 0,86 они просвечивали насквозь.
    hudPlate(g, 12, by, W - 24, bh, {
      bevel: 6, top: 'rgba(27,22,45,0.985)', bottom: 'rgba(9,7,18,0.99)',
    });

    // портрет в нише с золотой оправой
    if (d.npc && d.npc.spr) {
      const c = d.npc.spr.frames[Math.floor(this.game.time * 5) % d.npc.spr.frames.length];
      recess(g, 20, by + 8, 34, 40, { bevel: 4 });
      g.save();
      bevelPath(g, 20, by + 8, 34, 40, 4); g.clip();
      pixelBlit(g, c, 25, by + 12, c.width, c.height);
      g.restore();
    }

    text(g, d.name, 62, by + 7, { size: 11, bold: true, color: UI.accent });
    if (d.title) text(g, d.title, 62 + measure(d.name, 11, true) + 8, by + 9, { size: 8, color: UI.textFaint });
    goldRule(g, 62, by + 19, W - 100, 0.5);
    textBlock(g, d.line, 62, by + 24, W - 100, { size: 9, color: UI.text, lineHeight: 12 });

    // варианты
    let bx = 62;
    const oy = by + bh - 25;
    for (const opt of d.options) {
      const w = measure(opt.label, 10, true) + 26;
      const hot = hit(this.mx, this.my, bx, oy, w, 18);
      plateButton(g, bx, oy, w, 18, opt.label, { hot, disabled: opt.disabled });
      if (!opt.disabled) this.add(bx, oy, w, 18, opt.action);
      bx += w + 6;
    }
  }

  // ─────────────────────────────── портал / быстрое перемещение
  drawPortal(g) {
    const { w: W, h: H } = this.view;
    this.dim(g);
    const pw = 300, ph = 190;
    const px = (W - pw) >> 1, py = (H - ph) >> 1;
    panel(g, px, py, pw, ph, { title: 'ВРАТА ВЕЛОРИИ' });
    text(g, 'Открытые дороги', px + 12, py + 10, { size: 9, color: UI.textDim });

    const p = this.game.player;
    let y = py + 28;
    const dests = [...OVERWORLD.map((id) => ({ id, kind: 'biome' })), { id: 'dungeon', kind: 'dungeon' }];
    for (const d of dests) {
      const b = BIOMES[d.id];
      const need = d.id === 'dungeon' ? 3 : (b.unlockLevel || 1);
      const ok = p.level >= need;
      const hot = hit(this.mx, this.my, px + 12, y, pw - 24, 26);
      listRow(g, px + 12, y, pw - 24, 26, { accent: ok ? UI.accent : '#4a4468', hot: hot && ok });
      text(g, b.name, px + 20, y + 3, { size: 10, color: ok ? UI.text : UI.textFaint, bold: true });
      text(g, ok ? (b.subtitle || '') : `требуется уровень ${need}`, px + 20, y + 14, {
        size: 8, color: ok ? UI.textDim : UI.danger,
      });
      if (b.levelRange) {
        text(g, `ур. ${b.levelRange[0]}–${b.levelRange[1]}`, px + pw - 20, y + 8, { size: 9, align: 'right', color: UI.textDim });
      } else if (d.id === 'dungeon') {
        text(g, `рекорд: ${p.deepest} эт.`, px + pw - 20, y + 8, { size: 9, align: 'right', color: UI.textDim });
      }
      if (ok) {
        this.add(px + 12, y, pw - 24, 26, () => {
          this.close();
          this.game.travel(d.kind === 'dungeon' ? { kind: 'dungeon', floor: 1 } : { kind: 'biome', id: d.id });
        });
      }
      y += 29;
    }
    text(g, 'ESC — закрыть', px + pw / 2, py + ph - 14, { size: 8, align: 'center', color: UI.textFaint });
  }

  // ─────────────────────────────── пауза
  drawPause(g) {
    const { w: W, h: H } = this.view;
    this.dim(g, 0.7);
    const items = PAUSE_ITEMS;
    const pw = 220, ph = 46 + items.length * 24;
    const px = (W - pw) >> 1, py = (H - ph) >> 1;
    panel(g, px, py, pw, ph);
    text(g, 'ПАУЗА', W / 2, py + 10, { size: 14, align: 'center', bold: true, color: UI.accent });
    let y = py + 34;
    items.forEach((it, i) => {
      const hot = hit(this.mx, this.my, px + 20, y, pw - 40, 20);
      if (hot) this.pauseSel = i;
      button(g, px + 20, y, pw - 40, 20, it, { hot: hot || this.pauseSel === i });
      this.add(px + 20, y, pw - 40, 20, () => this.doPause(i));
      y += 24;
    });
    text(g, 'Управление: WASD · ЛКМ удар · ПКМ рывок · F умение · Q зелье · E действие',
         W / 2, py + ph + 8, { size: 8, align: 'center', color: UI.textFaint });
  }

  // ─────────────────────────────── смерть
  drawDeath(g) {
    const { w: W, h: H } = this.view;
    g.fillStyle = 'rgba(40,4,10,0.55)';
    g.fillRect(0, 0, W, H);
    this.dim(g, 0.4);
    const p = this.game.player;
    const lost = this.game.deathPenalty || 0;
    // Полоса во всю ширину вместо текста в пустоте: смерть — событие, и экран
    // должен выглядеть как надгробная плита, а не как сообщение об ошибке.
    const sy = H / 2 - 58, sh = 116;
    g.fillStyle = 'rgba(6,4,12,0.72)';
    g.fillRect(0, sy, W, sh);
    g.fillStyle = 'rgba(224,72,79,0.55)';
    g.fillRect(0, sy, W, 1); g.fillRect(0, sy + sh - 1, W, 1);
    text(g, 'ТЫ ПАЛ', W / 2, H / 2 - 46, { size: 26, align: 'center', bold: true, color: '#e0484f', outline: 'rgba(0,0,0,0.9)' });
    goldRule(g, W / 2 - 90, H / 2 - 22, 180, 0.5);
    text(g, `Уровень ${p.level}  ·  убито врагов: ${p.kills}`, W / 2, H / 2 - 16, { size: 10, align: 'center', color: UI.textDim });
    if (lost) text(g, `Потеряно золота: ${lost}`, W / 2, H / 2 - 2, { size: 10, align: 'center', color: UI.gold });
    const bx = (W - 200) / 2, by = H / 2 + 20;
    plateButton(g, bx, by, 200, 22, 'Возродиться в Велории', { hot: hit(this.mx, this.my, bx, by, 200, 22) });
    this.add(bx, by, 200, 22, () => this.game.respawn());
    text(g, 'ENTER', W / 2, by + 28, { size: 8, align: 'center', color: UI.textFaint });
  }

  // ─────────────────────────────── титул
  drawTitle(g) {
    const { w: W, h: H } = this.view;
    const t = this.game.time;

    const art = titleArt();
    if (art) {
      // заставка ровно во внутреннем разрешении — рисуется один к одному
      pixelBlit(g, art, 0, 0, W, H);
    } else {
      this.drawTitleFallback(g, W, H, t);
    }

    // Меню живёт в нижней полосе — там, где на заставке река. Логотип с мечом
    // занимает 118..218 по высоте, и накрывать его кнопками нельзя: заставка и
    // есть главное, что должен увидеть игрок. Затемнение снизу вводится плавно,
    // чтобы кнопки читались, а край орнамента не обрубался ступенькой.
    const MENU_TOP = 216;
    if (art) {
      const scrim = g.createLinearGradient(0, MENU_TOP - 22, 0, H);
      scrim.addColorStop(0, 'rgba(6,5,14,0)');
      scrim.addColorStop(0.55, 'rgba(6,5,14,0.72)');
      scrim.addColorStop(1, 'rgba(6,5,14,0.92)');
      g.fillStyle = scrim;
      g.fillRect(0, MENU_TOP - 22, W, H - MENU_TOP + 22);
    }

    // рекорд глубины — то, ради чего в Бездну возвращаются. На заставке для
    // него свободен только верхний левый угол: в центре арка с героями.
    const rec = bestDepth();
    if (rec > 0) {
      const label = rec >= ABYSS_START ? `БЕЗДНА · ${rec}` : `ГЛУБИНА · ${rec}`;
      const w = measure(label, 10, true) + 20;
      const bx = 8, by = 8;
      g.fillStyle = 'rgba(12,8,22,0.78)';
      g.fillRect(bx, by, w, 14);
      g.fillStyle = rec >= ABYSS_START ? '#d06ad0' : UI.border;
      g.fillRect(bx, by, w, 1); g.fillRect(bx, by + 13, w, 1);
      text(g, label, bx + w / 2, by + 3, { size: 10, align: 'center', bold: true,
           color: rec >= ABYSS_START ? '#ff9ae0' : UI.textDim });
    }

    // ── вход
    //
    // До входа игру не начать: дальше будет общий мир, и герой должен кому-то
    // принадлежать. Гостевой вход оставлен намеренно — без него игра
    // перестала бы запускаться у всех, у кого нет расширения, а это половина
    // тех, кто открыл ссылку в первый раз.
    const w = getWallet();
    const signedIn = isSignedIn();

    if (signedIn) {
      // плашка с адресом и выходом — справа сверху, там свободно
      const label = w.status === 'guest' ? 'Гость' : shortAddress(w.address);
      const lw = measure(label, 9, true) + 16;
      const bx = W - lw - 8 - 44, by = 8;
      bevelPath(g, bx, by, lw, 14, 3);
      g.fillStyle = 'rgba(12,8,22,0.82)';
      g.fill();
      g.lineWidth = 1;
      g.strokeStyle = w.status === 'guest' ? 'rgba(140,124,180,0.5)' : 'rgba(168,111,255,0.6)';
      g.stroke();
      text(g, label, bx + lw / 2, by + 3, {
        size: 9, align: 'center', bold: true,
        color: w.status === 'guest' ? UI.textDim : '#c9a6ff',
      });
      const ox = W - 40 - 8;
      const ohot = hit(this.mx, this.my, ox, by, 40, 14);
      bevelPath(g, ox, by, 40, 14, 3);
      g.fillStyle = ohot ? 'rgba(60,40,80,0.9)' : 'rgba(12,8,22,0.82)';
      g.fill();
      g.strokeStyle = 'rgba(140,124,180,0.45)';
      g.stroke();
      text(g, 'Выйти', ox + 20, by + 3, { size: 9, align: 'center', color: ohot ? UI.text : UI.textDim });
      this.add(ox, by, 40, 14, () => { signOut(); });
    }

    const hasSave = this.game.hasSave;
    const opts = [];
    if (!signedIn) {
      if (hasPhantom()) {
        opts.push(['Войти через Phantom', () => {
          signInWithPhantom().then(() => this.game.adoptServerCharacter());
        }]);
      } else {
        opts.push(['Установить Phantom', () => {
          try { window.open(PHANTOM_URL, '_blank', 'noopener,noreferrer'); } catch { /* заблокировали всплывающие окна */ }
        }]);
      }
      opts.push(['Играть гостем', () => { playAsGuest().catch(() => {}); }]);
    } else {
      if (hasSave) opts.push(['Продолжить', () => this.game.continueGame()]);
      opts.push([hasSave ? 'Новая игра' : 'Начать путь', () => this.game.newGame()]);
      // Кнопки общего города нет там, где нет комнаты.
      //
      // Игру можно раздать как чистую статику — и она честно работает
      // одиночной: клиент это предусматривает. Но токен в таком случае не
      // выдаёт никто, а без токена в комнату не войти. Раньше кнопка всё равно
      // стояла и на нажатие отвечала ошибкой — для человека, пришедшего по
      // ссылке, это выглядит как сломанная игра, а не как её устройство.
      // Отсутствие токена у вошедшего гостя и есть признак «сервера за этой
      // страницей нет».
      if (getWallet().token) {
        opts.push([net.online ? 'В общем городе' : 'В общий город', () => {
          if (net.online) this.game.goOffline();
          // Причину отказа держим у себя, а не отдаём в HUD.
          //
          // `toast` рисует HUD, а на титульном экране HUD не рисуется вовсе:
          // игрок жал кнопку, вход не удавался — и на экране не появлялось
          // ровно ничего. Строка состояния под кнопками здесь уже есть, ей и
          // говорим.
          else {
            this.мирОтвет = 'связываемся с общим миром…';
            this.game.goOnline().then((r) => { this.мирОтвет = r === 'online' ? null : String(r); });
          }
        }]);
      }
      opts.push(['Настройки', () => this.openSettings('title')]);
    }

    // Кнопки в строку, а не столбцом: столбец из четырёх занял бы сотню
    // пикселей по высоте и залез бы на логотип.
    //
    // Ширина считается по самой длинной подписи, а не берётся числом. Прежние
    // 120 были подобраны под пиксельный шрифт; вектор вдвое уже, и кнопки
    // раздувались в пустые плиты — на 1080p каждая выходила почти в полтысячи
    // настоящих пикселей ради одного слова.
    const gap = 14, padX = 26, bh = 24;
    const need = opts.reduce((m, [label]) => Math.max(m, measure(label, 10, true)), 0) + padX * 2;
    const bw = Math.round(clamp(need, 84, (W - 24 - gap * (opts.length - 1)) / opts.length));
    let x = Math.round((W - (bw * opts.length + gap * (opts.length - 1))) / 2);
    for (const [label, action] of opts) {
      const hot = hit(this.mx, this.my, x, MENU_TOP, bw, bh);
      plateButton(g, x, MENU_TOP, bw, bh, label, { hot });
      this.add(x, MENU_TOP, bw, bh, action);
      x += bw + gap;
    }
    // Строка состояния — ПОД кнопками, а не над ними. Над ними её и хотелось
    // поставить, но там кончается логотип: заставка отдана меню только ниже
    // 216-й строки, и подпись ложилась прямо на меч.
    if (!signedIn) {
      const busy = w.status === 'connecting' || w.status === 'signing';
      const line = w.status === 'connecting' ? 'Подключаем кошелёк…'
        : w.status === 'signing' ? 'Подтверди вход в окне Phantom'
        : w.error ? w.error
        : hasPhantom() ? 'Подпись подтверждает вход и не переводит средства'
        : 'Кошелька Phantom не видно — можно играть гостем';
      text(g, line, W / 2, H - 26, {
        size: 9, align: 'center', bold: busy,
        color: w.error ? UI.danger : busy ? UI.accent : '#9a94b8',
      });
    }

    // Что ответил общий мир. Своя строка, а не HUD: HUD на титуле не рисуется.
    if (this.мирОтвет) {
      text(g, this.мирОтвет, W / 2, H - 38, {
        size: 9, align: 'center', bold: true,
        color: this.мирОтвет.endsWith('…') ? UI.accent : UI.danger,
      });
    }

    text(g, signedIn
      ? 'WASD — движение · ЛКМ — удар · ПКМ — рывок · F — умение · E — действие'
      : 'Игра никогда не спросит seed-фразу и не попросит подтвердить перевод',
      W / 2, H - 14, { size: 8, align: 'center', color: art ? '#8b86a8' : '#5c5680' });

    // Что о вас хранит общий мир — прямо на входе, а не в мелком шрифте где-то
    // ещё. Адрес кошелька это чужие данные, и человек должен узнать о них до
    // того, как войдёт, а не после.
    if (!signedIn) {
      text(g, 'Общий мир хранит адрес кошелька, время входов и героя. Удалиться — в настройках',
        W / 2, H - 5, { size: 7, align: 'center', color: art ? '#6f6a8a' : '#4a4568' });
    }
  }

  /**
   * Настройки. Открываются с титульного экрана и рисуются поверх заставки:
   * ради двух строк уводить игрока на отдельный чёрный экран незачем.
   */
  drawSettings(g) {
    const { w: W, h: H } = this.view;
    // из паузы мир уже нарисован под нами — его и затемняем; с титульного
    // экрана рисовать нечего, кладём заставку
    if (this.settingsFrom === 'pause') {
      this.dim(g, 0.7);
    } else {
      const art = titleArt();
      if (art) pixelBlit(g, art, 0, 0, W, H);
      else this.drawTitleFallback(g, W, H, this.game.time);
      this.dim(g, 0.66);
    }

    // Панель подросла под раздел «Сохранение»: выгрузка героя файлом — это
    // не украшение, а единственная защита от чистки браузерного хранилища.
    // Панель уплотнена: три ползунка вместо одного не влезали, а высота макета
    // всего 270. Кнопки ужаты с 20 до 18, глушение — до 16; секции сдвинуты.
    const pw = 232, ph = 250;
    const px = Math.round((W - pw) / 2), py = Math.round((H - ph) / 2);
    panel(g, px, py, pw, ph, { title: 'НАСТРОЙКИ' });

    const sx = px + 16, sw = pw - 32;
    const sel = this.settingsSel;
    const muted = this.game.audioMuted;

    // ── звук: общая, музыка, эффекты
    text(g, 'Звук', sx, py + 14, { size: 10, bold: true, color: UI.text });
    if (muted) text(g, 'выкл', sx + sw, py + 14, { size: 10, align: 'right', color: UI.textFaint });

    // Раздельные ручки, потому что правильного баланса тут нет: замер показал
    // эффекты вдевятеро громче музыки в бою, но кому-то нужен звон попаданий, а
    // кому-то музыка. Пусть решает тот, кто слушает.
    const РУЧКИ = [
      ['Общая',    () => this.game.volume,      (v) => this.game.setVolume(v),      'volume'],
      ['Музыка',   () => this.game.musicVolume, (v) => this.game.setMusicVolume(v), 'music'],
      ['Эффекты',  () => this.game.sfxVolume,   (v) => this.game.setSfxVolume(v),   'sfx'],
    ];
    const lw = 46, vw = 30;
    РУЧКИ.forEach(([name, get, , key], i) => {
      const y = py + 27 + i * 13;
      const tx = sx + lw, tw = sw - lw - vw;
      text(g, name, sx, y - 2, { size: 9, color: UI.textDim });
      const grab = { x: tx, y: y - 5, w: tw, h: 12 };
      const hot = hit(this.mx, this.my, grab.x, grab.y, grab.w, grab.h);
      if (hot) this.settingsSel = i;
      const val = get();
      slider(g, tx, y, tw, 6, muted && i === 0 ? 0 : val, {
        hot: hot || sel === i,
        drag: this.dragSlider === key,
        color: muted && i === 0 ? '#4a4560' : i === 1 ? '#7a6ad0' : i === 2 ? '#5a8ad0' : '#5a8ad0',
      });
      text(g, Math.round(val * 100) + '%', sx + sw, y - 2, { size: 9, align: 'right', color: UI.textDim });
      this.add(grab.x, grab.y, grab.w, grab.h, null, { slider: key, sel: i });
    });

    const my1 = py + 68, mw = 100;
    const hotMute = hit(this.mx, this.my, sx, my1, mw, 16);
    if (hotMute) this.settingsSel = 3;
    button(g, sx, my1, mw, 16, muted ? 'Включить звук' : 'Заглушить', { hot: hotMute || sel === 3 });
    this.add(sx, my1, mw, 16, () => this.game.toggleAudio(), { sel: 3 });

    // ── экран
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.fillRect(sx, py + 92, sw, 1);
    text(g, 'Экран', sx, py + 98, { size: 10, bold: true, color: UI.text });
    const fy = py + 110;
    const on = this.game.isFullscreen;
    const hotFs = hit(this.mx, this.my, sx, fy, sw, 18);
    if (hotFs) this.settingsSel = 4;
    button(g, sx, fy, sw, 18, on ? 'Выйти из полного экрана' : 'Во весь экран',
           { hot: hotFs || sel === 4, active: on });
    this.add(sx, fy, sw, 18, () => this.game.toggleFullscreen(), { sel: 4 });

    // ── язык: два ярлыка рядом, каждый подписан на своём языке, чтобы человек
    // нашёл нужный, не понимая текущего
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.fillRect(sx, py + 136, sw, 1);
    text(g, 'Язык', sx, py + 142, { size: 10, bold: true, color: UI.text });
    const ly = py + 154, lgw = Math.floor((sw - 6) / LANGS.length);
    LANGS.forEach((L, i) => {
      const lx = sx + i * (lgw + 6);
      const hotL = hit(this.mx, this.my, lx, ly, lgw, 18);
      if (hotL) this.settingsSel = 5 + i;
      button(g, lx, ly, lgw, 18, L.name,
             { hot: hotL || sel === 5 + i, active: getLang() === L.id });
      this.add(lx, ly, lgw, 18, () => this.game.setLanguage(L.id), { sel: 5 + i });
    });

    // ── сохранение
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.fillRect(sx, py + 180, sw, 1);
    text(g, 'Сохранение', sx, py + 186, { size: 10, bold: true, color: UI.text });

    const st = this.game.saveState();
    const сводка = st.есть
      ? `ур. ${st.уровень} · копий ${st.копий} · ${Math.max(1, Math.round(st.байт / 1024))} КБ`
      : 'героя нет';
    text(g, сводка, sx + sw, py + 186, { size: 9, align: 'right', color: UI.textDim });

    const ey = py + 198, ew = Math.floor((sw - 6) / 2);
    const exp = 5 + LANGS.length, imp = exp + 1;
    const hotExp = hit(this.mx, this.my, sx, ey, ew, 18);
    if (hotExp) this.settingsSel = exp;
    button(g, sx, ey, ew, 18, 'Выгрузить', { hot: hotExp || sel === exp, disabled: !st.есть });
    if (st.есть) this.add(sx, ey, ew, 18, () => this.game.exportSaveFile(), { sel: exp });

    const ix = sx + ew + 6;
    const hotImp = hit(this.mx, this.my, ix, ey, ew, 18);
    if (hotImp) this.settingsSel = imp;
    button(g, ix, ey, ew, 18, 'Загрузить', { hot: hotImp || sel === imp });
    this.add(ix, ey, ew, 18, () => this.game.importSaveFile(), { sel: imp });

    text(g, 'файл переживёт чистку браузера', sx, py + 220, { size: 8, color: UI.textFaint });

    // ── назад
    const back = 7 + LANGS.length;
    const bw = 84, bx = px + pw - 16 - bw, by = py + ph - 26;
    const hotBack = hit(this.mx, this.my, bx, by, bw, 18);
    if (hotBack) this.settingsSel = back;
    button(g, bx, by, bw, 18, 'Назад', { hot: hotBack || sel === back });
    this.add(bx, by, bw, 18, () => this.closeSettings(), { sel: back });
    text(g, sel < 3 ? '← → — громкость' : 'Esc — назад', px + 16, by + 5,
         { size: 8, color: UI.textFaint });
  }

  /**
   * Настройки — единственное место, где нужна не «нажали», а «тянут»: ползунок
   * обязан ехать за курсором, даже когда тот вышел за дорожку.
   */
  handleSettings(input) {
    if (input.consume('cancel')) { this.closeSettings(); return; }

    // клавиши
    // 0 общая, 1 музыка, 2 эффекты, 3 глушение, 4 экран, языки, выгрузка,
    // загрузка, назад
    const N = 8 + LANGS.length;
    if (input.consume('up')) { this.settingsSel = (this.settingsSel + N - 1) % N; audio.play('ui'); }
    if (input.consume('down')) { this.settingsSel = (this.settingsSel + 1) % N; audio.play('ui'); }
    const РУЧКА = [
      [() => this.game.volume, (v) => this.game.setVolume(v)],
      [() => this.game.musicVolume, (v) => this.game.setMusicVolume(v)],
      [() => this.game.sfxVolume, (v) => this.game.setSfxVolume(v)],
    ][this.settingsSel];
    if (РУЧКА) {
      // шаг 5% — мельче не нужно, крупнее не даёт попасть в привычное значение
      if (input.consume('left')) { РУЧКА[1](РУЧКА[0]() - 0.05); audio.play('ui'); }
      if (input.consume('right')) { РУЧКА[1](РУЧКА[0]() + 0.05); audio.play('ui'); }
    } else if (input.consume('confirm')) {
      const c = this._clickables.find((o) => o.sel === this.settingsSel && o.action);
      if (c) { audio.play('ui'); c.action(); return; }
    }

    // мышь
    const поставить = (key, v) => {
      if (key === 'music') this.game.setMusicVolume(v);
      else if (key === 'sfx') this.game.setSfxVolume(v);
      else this.game.setVolume(v);
    };

    if (!input.mouse.down) this.dragSlider = null;
    else if (this.dragSlider) {
      const s = this._sliderRect;
      if (s) поставить(this.dragSlider, sliderFrac(this.mx, s.x, s.w));
      return;                        // тянем — клики по кнопкам не считаем
    }

    for (const c of this._clickables) {
      if (!c.slider || !hit(this.mx, this.my, c.x, c.y, c.w, c.h)) continue;
      if (input.mouse.justDown) {
        input.mouse.justDown = false;
        this.dragSlider = c.slider;
        this._sliderRect = { x: c.x, w: c.w };
        поставить(c.slider, sliderFrac(this.mx, c.x, c.w));
        audio.play('ui');
      }
      return;
    }
    this.processClicks(input);
  }

  /** Фон титульного экрана, если заставка не загрузилась. */
  drawTitleFallback(g, W, H, t) {
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#0d0a1c');
    grd.addColorStop(0.55, '#191233');
    grd.addColorStop(1, '#2a1a3a');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) {
      const x = (i * 97) % W, y = (i * 53) % (H * 0.6);
      g.globalAlpha = 0.25 + Math.abs(Math.sin(t * 0.8 + i)) * 0.5;
      g.fillStyle = i % 7 === 0 ? '#ffe6a0' : '#cfd8ff';
      g.fillRect(x, y, 1, 1);
    }
    g.globalAlpha = 1;

    g.fillStyle = '#0a0714';
    for (let i = 0; i < 26; i++) {
      const bw = 14 + ((i * 37) % 26);
      const bh = 24 + ((i * 53) % 58);
      const bx = i * 19 - 10;
      g.fillRect(bx, H - bh - 26, bw, bh);
      if ((i * 31) % 5 === 0) {
        g.fillStyle = '#3a2a1a';
        g.fillRect(bx + bw / 2 - 4, H - bh - 40, 8, 16);
        g.fillStyle = '#0a0714';
      }
    }
    g.fillStyle = '#07050e';
    g.fillRect(0, H - 26, W, 26);

    const ly = 52;
    const title = 'VELORIA';
    text(g, title, W / 2 + 1, ly + 1, { size: 42, align: 'center', bold: true, color: 'rgba(0,0,0,0.7)' });
    text(g, title, W / 2, ly, { size: 42, align: 'center', bold: true, color: '#f3d98d' });
    text(g, 'к л и н о к   и   г л у б и н а', W / 2, ly + 46, { size: 9, align: 'center', color: '#9a90c0' });
  }
}

/**
 * Короткая сводка «что даёт вещь»: «урон 12  защита 5  крит 6%».
 *
 * Каждый кусок переводится отдельно, а не вся строка целиком. Целиком её в
 * словаре быть не может — сочетаний столько же, сколько предметов; а общий
 * разбор «известное начало + хвост» тут спотыкается, потому что кусков в строке
 * несколько, и он переводил только первый: «def 68  +180 HP  крит 6%».
 */
function statSummary(it) {
  const s = it.stats || {};
  const parts = [];
  if (s.atk) parts.push(t('урон ') + s.atk);
  if (s.def) parts.push(t('защита ') + s.def);
  if (s.hp) parts.push('+' + s.hp + ' HP');
  if (s.mp) parts.push('+' + s.mp + ' MP');
  if (s.crit) parts.push(t('крит ') + s.crit + '%');
  return parts.slice(0, 3).join('  ');
}
