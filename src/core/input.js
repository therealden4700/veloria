// Клавиатура + мышь. Действия абстрагированы, чтобы раскладка не текла в игру.

const MAP = {
  up:      ['KeyW', 'ArrowUp', 'KeyЦ'],
  down:    ['KeyS', 'ArrowDown'],
  left:    ['KeyA', 'ArrowLeft'],
  right:   ['KeyD', 'ArrowRight'],
  attack:  ['Space', 'KeyJ'],
  skill1:  ['KeyF', 'Digit1'],
  skill2:  ['KeyR', 'Digit2'],
  skill3:  ['KeyG', 'Digit3'],
  dash:    ['ShiftLeft', 'ShiftRight', 'KeyL'],
  potion:  ['KeyQ'],
  interact:['KeyE', 'Enter'],
  inventory: ['KeyI', 'Tab'],
  character: ['KeyC'],
  quests:  ['KeyU'],
  map:     ['KeyM'],
  pause:   ['Escape'],
  say:     ['KeyT'],           // сказать вслух: реплика висит над головой
  profiler:['F3', 'Backquote'],   // профайлер кадра — F3 или тильда
  confirm: ['Enter', 'Space'],
  cancel:  ['Escape'],
};

const REVERSE = {};
for (const act in MAP) for (const code of MAP[act]) (REVERSE[code] ||= []).push(act);

class Input {
  constructor() {
    this.down = new Set();        // удерживаемые действия
    this.justPressed = new Set(); // нажатые в этом кадре
    this.justReleased = new Set();
    this.mouse = { x: 0, y: 0, wx: 0, wy: 0, down: false, justDown: false, justUp: false, wheel: 0, right: false, rightJustDown: false };
    this.anyKey = false;
    this._el = null;
    // Стик с касаний. Клавиатура даёт восемь направлений, палец — любое, и
    // сводить его обратно к восьми значит выбрасывать то, что человек уже
    // показал. Поэтому ось аналоговая, а `axis()` предпочитает её, когда палец
    // на экране.
    this.stick = { x: 0, y: 0, active: false };
    this.touch = false;          // хоть раз касались — значит, играют пальцем
    this.набор = null;           // строка, которую сейчас печатают
    this.onSay = null;
  }

  attach(canvas, view) {
    this._el = canvas;
    this.view = view;

    addEventListener('keydown', (e) => {
      // Набор строки. Пока он идёт, клавиши в игру не попадают вовсе: иначе
      // слово «дай» увело бы героя вниз и махнуло мечом.
      if (this.набор) {
        e.preventDefault();
        if (e.key === 'Enter') { const t = this.набор.text; this.набор = null; if (this.onSay) this.onSay(t); return; }
        if (e.key === 'Escape') { this.набор = null; return; }
        if (e.key === 'Backspace') { this.набор.text = this.набор.text.slice(0, -1); return; }
        if (e.key.length === 1 && this.набор.text.length < 120) this.набор.text += e.key;
        return;
      }
      if (e.repeat) return;
      const acts = REVERSE[e.code];
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash'].includes(e.code)) e.preventDefault();
      this.anyKey = true;
      if (!acts) return;
      for (const a of acts) { this.down.add(a); this.justPressed.add(a); }
    });

    addEventListener('keyup', (e) => {
      const acts = REVERSE[e.code];
      if (!acts) return;
      for (const a of acts) { this.down.delete(a); this.justReleased.add(a); }
    });

    addEventListener('blur', () => { this.down.clear(); if (this.mouse.down) this.mouse.justUp = true; this.mouse.down = false; });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('mousemove', (e) => this._pos(e));
    canvas.addEventListener('mousedown', (e) => {
      this._pos(e);
      this.anyKey = true;
      if (e.button === 0) {
        this.mouse.down = true; this.mouse.justDown = true;
        this.down.add('attack'); this.justPressed.add('attack');
      } else if (e.button === 2) {
        this.mouse.right = true; this.mouse.rightJustDown = true;
        this.down.add('dash'); this.justPressed.add('dash');
      }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.mouse.down = false; this.mouse.justUp = true; this.down.delete('attack'); }
      if (e.button === 2) { this.mouse.right = false; this.down.delete('dash'); }
    });
    canvas.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  }

  _pos(e) {
    const r = this._el.getBoundingClientRect();
    this.mouse.x = ((e.clientX - r.left) / r.width) * this.view.w;
    this.mouse.y = ((e.clientY - r.top) / r.height) * this.view.h;
  }

  held(a) { return this.down.has(a); }
  pressed(a) { return this.justPressed.has(a); }
  released(a) { return this.justReleased.has(a); }

  /** Считать нажатие один раз (чтобы одно и то же не сработало в двух местах). */
  consume(a) {
    if (this.justPressed.has(a)) { this.justPressed.delete(a); return true; }
    return false;
  }

  axis() {
    if (this.stick.active) return { x: this.stick.x, y: this.stick.y };
    let x = 0, y = 0;
    if (this.held('left')) x -= 1;
    if (this.held('right')) x += 1;
    if (this.held('up')) y -= 1;
    if (this.held('down')) y += 1;
    if (x && y) { const k = Math.SQRT1_2; x *= k; y *= k; }
    return { x, y };
  }

  /** Действие от экранной кнопки — тем же путём, что и от клавиши. */
  press(a) { this.down.add(a); this.justPressed.add(a); this.anyKey = true; }
  release(a) { if (this.down.delete(a)) this.justReleased.add(a); }

  endFrame() {
    this.justPressed.clear();
    this.justReleased.clear();
    this.mouse.justDown = false;
    this.mouse.justUp = false;
    this.mouse.rightJustDown = false;
    this.mouse.wheel = 0;
    this.anyKey = false;
  }
}

export const input = new Input();
