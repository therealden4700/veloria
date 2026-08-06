// Управление с касаний: стик слева, пояс справа.
//
// Игра раздаётся ссылкой, а ссылку на браузерную игру чаще всего открывают с
// телефона. До этого файла там не работало ничего: в раскладке ноль
// обработчиков касаний, и человек видел красивую заставку, которая не
// шевелится.
//
// Два решения определяют здесь всё остальное.
//
// **Кнопки не рисуются отдельно.** Пояс умений внизу экрана уже нарисован — с
// гнёздами, откатами, счётчиком зелий и подписями клавиш. Второй слой поверх
// него был бы и лишней работой, и лишним шумом. Вместо этого HUD при отрисовке
// складывает прямоугольники своих гнёзд в `hud.touchSlots`, а мы по ним
// попадаем. Вёрстка пояса меняется — попадания едут за ней сами, потому что это
// одни и те же числа, а не две копии.
//
// **Меню мы не трогаем.** Браузер сам делает из короткого касания щелчок мышью,
// и весь интерфейс — инвентарь, кузня, лавка, титул — уже работает пальцем без
// единой правки. Перехватывать касания там значило бы сломать то, что и так
// работает. Поэтому пока открыто меню, слой молчит и ничего не отменяет.

const DEAD = 6;        // мёртвая зона стика в единицах раскладки
const RANGE = 26;      // отклонение, дающее полную скорость
const LEFT = 0.46;     // доля ширины экрана под стик

/** Играют ли пальцем. Спрашиваем у устройства, а не у строки браузера. */
export function isCoarsePointer() {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

export function attachTouch(canvas, input, game) {
  if (!('ontouchstart' in window) && !isCoarsePointer()) return false;

  let стик = null;                     // { id, x0, y0 }
  const кнопки = new Map();            // id касания → действие

  const вРаскладку = (t) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((t.clientX - r.left) / r.width) * input.view.w,
      y: ((t.clientY - r.top) / r.height) * input.view.h,
    };
  };

  // Пока открыто меню, касания идут своим ходом: браузер превратит их в щелчки,
  // и меню отработает мышью, как на настольном.
  const вМеню = () => !!(game.menus && game.menus.mode);

  const попал = (p) => {
    for (const s of (game.hud && game.hud.touchSlots) || []) {
      // Гнездо 28 единиц — это меньше пальца. Расширяем зону попадания, не
      // трогая рисунок: промах по кнопке в бою читается как «игра не слушается».
      const m = 5;
      if (p.x >= s.x - m && p.x <= s.x + s.w + m && p.y >= s.y - m && p.y <= s.y + s.h + m) return s.action;
    }
    return null;
  };

  const отпустить = (id) => {
    const a = кнопки.get(id);
    if (a) { input.release(a); кнопки.delete(id); }
  };

  canvas.addEventListener('touchstart', (e) => {
    input.touch = true;
    if (вМеню()) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      const p = вРаскладку(t);
      const a = попал(p);
      if (a) { кнопки.set(t.identifier, a); input.press(a); continue; }
      // Стик появляется там, где палец опустился, а не в отведённом углу:
      // держать телефон можно как угодно, и заранее назначенное место всегда
      // оказывается не там, где большой палец.
      if (!стик && p.x < input.view.w * LEFT) {
        стик = { id: t.identifier, x0: p.x, y0: p.y };
        input.stick.ox = p.x; input.stick.oy = p.y;
      }
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    if (вМеню()) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (!стик || t.identifier !== стик.id) continue;
      const p = вРаскладку(t);
      let dx = p.x - стик.x0, dy = p.y - стик.y0;
      const d = Math.hypot(dx, dy);
      if (d < DEAD) { input.stick.active = false; input.stick.x = 0; input.stick.y = 0; continue; }
      const k = Math.min(1, (d - DEAD) / (RANGE - DEAD)) / d;
      input.stick.x = dx * k; input.stick.y = dy * k;
      input.stick.active = true;
      // Стик тянут дальше края — переносим начало за пальцем, иначе он упирается
      // в невидимую стену и герой перестаёт слушаться на полпути.
      if (d > RANGE * 1.6) {
        стик.x0 = p.x - dx / d * RANGE; стик.y0 = p.y - dy / d * RANGE;
        input.stick.ox = стик.x0; input.stick.oy = стик.y0;
      }
    }
  }, { passive: false });

  const конец = (e) => {
    for (const t of e.changedTouches) {
      отпустить(t.identifier);
      if (стик && t.identifier === стик.id) {
        стик = null;
        input.stick.active = false; input.stick.x = 0; input.stick.y = 0;
      }
    }
  };
  canvas.addEventListener('touchend', конец);
  canvas.addEventListener('touchcancel', конец);

  // Палец ушёл со страницы вместе с вкладкой — иначе герой убежит навсегда.
  addEventListener('blur', () => {
    for (const id of [...кнопки.keys()]) отпустить(id);
    стик = null;
    input.stick.active = false; input.stick.x = 0; input.stick.y = 0;
  });

  return true;
}

/** Где сейчас стик — HUD рисует по этому кольцо. */
export function stickRing(input) {
  return input.stick.active ? { x: input.stick.x, y: input.stick.y } : null;
}
