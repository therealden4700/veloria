// Слой интерфейса: отдельный канвас поверх мира, в настоящем разрешении экрана.
//
// Мир остаётся пиксельным — 480×270, растянутые ×4 без сглаживания. Это не
// «маленькое окно», а способ получить ровный пиксель: каждая точка спрайта
// становится квадратом 4×4. Интерфейсу такая грубость не нужна и вредна: шрифт
// в 10 пикселей приходилось резать по порогу альфы, отчего `%` слипался с
// цифрой и «−9%» в листе героя читалось как «−94».
//
// Координаты интерфейса намеренно остались прежними — 480×270. Переписывать
// четыре сотни вызовов отрисовки на новые числа значило бы переверстать всё
// заново с риском сломать то, что работает; вместо этого слой растягивается
// преобразованием, а буфер под ним равен настоящим пикселям экрана. Место же
// берётся не из новых координат, а из шрифта: текст рисуется вектором и
// занимает вдвое меньшую долю, чем занимал пиксельный (см. type.js).

/** Пространство раскладки интерфейса — то же, что у мира. */
export const UI_W = 480;
export const UI_H = 270;

let canvas = null;
let ctx = null;
let scale = 4;          // пикселей буфера на единицу раскладки

export function attachStage(el) {
  canvas = el;
  ctx = canvas.getContext('2d');
  return ctx;
}

export function uiCtx() { return ctx; }
/** Во сколько раз слой крупнее раскладки — нужно для толщины волосяных линий. */
export function uiScale() { return scale; }

/**
 * Подогнать буфер под размер на экране.
 *
 * Буфер меряется в настоящих пикселях устройства: на обычном мониторе это
 * ширина в CSS-пикселях, на плотном экране — вдвое больше. Выше ×4 не берём:
 * это и есть 1920 по ширине, дальше рисовать больше точек, чем задумано, —
 * расход без выигрыша.
 */
export function resizeStage(cssW, cssH) {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(UI_W, Math.round(Math.min(cssW * dpr, UI_W * 4)));
  const h = Math.round(w * (UI_H / UI_W));
  canvas.style.width = Math.round(cssW) + 'px';
  canvas.style.height = Math.round(cssH) + 'px';
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  scale = w / UI_W;
}

/** Очистить слой и выставить преобразование. Звать раз в кадр до отрисовки. */
export function beginUI() {
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = true;
  return ctx;
}

/**
 * Мировые спрайты внутри интерфейса — иконки предметов, портреты, миникарта.
 * Их сглаживать нельзя: выйдет мыло вместо пикселей. Обёртка гасит сглаживание
 * на время вставки и возвращает как было.
 */
export function pixelBlit(g, img, x, y, w, h) {
  const was = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = false;
  if (w === undefined) g.drawImage(img, x, y);
  else g.drawImage(img, x, y, w, h);
  g.imageSmoothingEnabled = was;
}
