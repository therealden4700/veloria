// Кирпичики интерфейса: панели, полосы, кнопки, слоты предметов.

import { UI, RARITY, rgba, shade } from '../art/palette.js';
import { WEAPON_PROFILE } from '../systems/items.js';
import { pixelBlit } from './stage.js';
import { t } from '../core/i18n.js';
import { text, measure, textBlock, wrap, ellipsize } from './text.js';
import { clamp } from '../core/util.js';

export function panel(g, x, y, w, h, opts = {}) {
  x |= 0; y |= 0; w |= 0; h |= 0;
  g.fillStyle = opts.fill || UI.panel;
  g.fillRect(x, y, w, h);
  // двойная рамка — дешёвый способ придать «увесистость»
  g.fillStyle = opts.border || UI.border;
  g.fillRect(x, y, w, 1);
  g.fillRect(x, y + h - 1, w, 1);
  g.fillRect(x, y, 1, h);
  g.fillRect(x + w - 1, y, 1, h);
  g.fillStyle = opts.inner || 'rgba(255,255,255,0.07)';
  g.fillRect(x + 1, y + 1, w - 2, 1);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(x + 1, y + h - 2, w - 2, 1);
  if (opts.title) {
    const tw = measure(opts.title, 10, true) + 12;
    g.fillStyle = opts.fill || UI.panelSolid;
    g.fillRect(x + 8, y - 6, tw, 12);
    g.fillStyle = opts.border || UI.border;
    g.fillRect(x + 8, y - 6, tw, 1);
    g.fillRect(x + 8, y + 5, tw, 1);
    g.fillRect(x + 8, y - 6, 1, 12);
    g.fillRect(x + 8 + tw - 1, y - 6, 1, 12);
    text(g, opts.title, x + 14, y - 4, { size: 10, bold: true, color: opts.titleColor || UI.accent });
  }
}

/**
 * Градиенты полос — по одному на сочетание «цвет + место + высота».
 *
 * Полос на экране единицы, и лежат они на одних и тех же местах, так что кэш
 * заполняется за первый кадр и больше не растёт. Создавать градиент заново
 * каждый кадр было заметно: вместе с разбором цветов это поднимало кадр в
 * городе с 0,55 до 0,78 мс.
 */
const gradCache = new Map();

/**
 * Вертикальный градиент с кэшем. Ключ — место, высота и сами цвета: одинаковые
 * запросы приходят каждый кадр с одними и теми же числами, поэтому кэш
 * заполняется за первый кадр и больше не растёт.
 */
export function vgrad(g, y, h, stops) {
  const k = y + '|' + h + '|' + stops.join(',');
  let v = gradCache.get(k);
  if (v === undefined) {
    v = g.createLinearGradient(0, y, 0, y + h);
    for (let i = 0; i < stops.length; i += 2) v.addColorStop(stops[i], stops[i + 1]);
    if (gradCache.size > 200) gradCache.clear();
    gradCache.set(k, v);
  }
  return v;
}

function gradient(g, col, y, h, isFill) {
  return isFill
    ? vgrad(g, y, h, [0, shade(col, 0.42), 0.45, col, 1, shade(col, -0.32)])
    : vgrad(g, y, h, [0, shade(col, -0.35), 1, shade(col, 0.18)]);
}

/**
 * Полоса здоровья, маны, опыта.
 *
 * Приёмы те же, что у кнопок главного экрана, и по той же причине: плоский
 * прямоугольник с плоской заливкой читается как заготовка. Что здесь работает:
 *
 * - **градиент вместо плоского цвета** — вверху светлее, внизу темнее, отчего
 *   полоса выглядит выпуклой трубкой, а не наклейкой;
 * - **блик в верхней трети** — одна светлая полоска, которая и создаёт стекло;
 * - **светлый торец** у края заливки: без него граница выглядит обрывом, с ним
 *   — краем жидкости, и глаз сразу находит текущее значение;
 * - **насечки каждые 25%** — по ним доля читается без чтения цифр; на тонких
 *   полосах они не рисуются, там это был бы мусор;
 * - **рамка приглушённым золотом**, а не чёрным: она связывает полосы с
 *   кнопками титульного экрана и с рамкой уровня.
 */
export function bar(g, x, y, w, h, frac, colFill, colBack, opts = {}) {
  x |= 0; y |= 0; w |= 0; h |= 0;
  frac = clamp(frac, 0, 1);
  const thin = h < 5;

  // подложка и рамка
  g.fillStyle = 'rgba(4,3,10,0.92)';
  g.fillRect(x - 1, y - 1, w + 2, h + 2);

  // ложе: тоже с градиентом, иначе пустая часть выглядит дырой
  g.fillStyle = gradient(g, colBack, y, h, false);
  g.fillRect(x, y, w, h);

  const fw = Math.round(w * frac);
  if (fw > 0) {
    g.fillStyle = gradient(g, colFill, y, h, true);
    g.fillRect(x, y, fw, h);

    // блик
    g.fillStyle = 'rgba(255,255,255,0.30)';
    g.fillRect(x, y + 1, fw, Math.max(1, Math.round(h * 0.22)));

    // светлый торец — только когда полоса не полна, иначе он лезет на рамку
    if (fw < w) {
      g.fillStyle = shade(colFill, 0.75);
      g.fillRect(x + fw - 1, y, 1, h);
    }
  }

  // «призрак» недавнего урона — догоняющая светлая часть
  if (opts.ghost !== undefined && opts.ghost > frac) {
    const gw = Math.round(w * (opts.ghost - frac));
    g.fillStyle = 'rgba(255,236,214,0.30)';
    g.fillRect(x + fw, y, gw, h);
    g.fillStyle = 'rgba(255,255,255,0.42)';
    g.fillRect(x + fw + gw - 1, y, 1, h);
  }

  if (!thin) {
    // насечки
    g.fillStyle = 'rgba(0,0,0,0.30)';
    for (let i = 1; i < 4; i++) g.fillRect(x + Math.round(w * i / 4), y, 1, h);
    // рамка
    g.fillStyle = 'rgba(198,170,112,0.42)';
    g.fillRect(x, y, w, 1); g.fillRect(x, y + h - 1, w, 1);
    g.fillRect(x, y, 1, h); g.fillRect(x + w - 1, y, 1, h);
  } else {
    g.fillStyle = 'rgba(198,170,112,0.28)';
    g.fillRect(x, y, w, 1);
  }
  if (opts.label) {
    // Подпись центруется по высоте полосы, а не по «минус один на глазок».
    // Поправка была рукописной, под пиксельный шрифт, и после перехода на
    // вектор давала 1,13 единицы вверх — четыре с половиной настоящих пикселя
    // при 1080p. На полосе маны, которая на две единицы ниже полосы здоровья,
    // ошибка была той же: коробка строки считалась от кегля 8 независимо от
    // высоты полосы.
    const size = opts.labelSize || 8;
    text(g, opts.label, x + w / 2, y + (h - size) / 2, {
      size, align: 'center', bold: true, color: '#ffffff', outline: 'rgba(0,0,0,0.85)',
    });
  }
}

export function button(g, x, y, w, h, label, state = {}) {
  const hot = state.hot, active = state.active, disabled = state.disabled;
  // danger — необратимое действие: кнопка красная, чтобы её не жали не глядя
  const dg = state.danger;
  x |= 0; y |= 0;
  g.fillStyle = disabled ? '#191627' : active ? '#3f3560'
    : dg ? (hot ? '#5c1d26' : '#39141c') : hot ? '#2e2748' : UI.panelAlt;
  g.fillRect(x, y, w, h);
  g.fillStyle = disabled ? '#2c2a3a' : dg ? (hot ? '#ff8a90' : UI.danger) : hot ? UI.borderHi : UI.border;
  g.fillRect(x, y, w, 1); g.fillRect(x, y + h - 1, w, 1);
  g.fillRect(x, y, 1, h); g.fillRect(x + w - 1, y, 1, h);
  // Подпись режется по ширине кнопки. Кнопки здесь фиксированной ширины, а
  // длина подписи зависит от языка: «Выйти из полного экрана» короче своего
  // английского двойника, и на другом языке текст вылезал бы за рамку. Дешевле
  // обрезать здесь один раз, чем подгонять ширины по каждому языку отдельно.
  text(g, ellipsize(label, w - 8, 10, !!hot), x + w / 2, y + (h - 10) / 2, {
    size: 10, align: 'center',
    color: disabled ? UI.textFaint : dg ? '#ffd8d8' : hot ? '#ffffff' : UI.text,
    bold: hot, shadow: true,
  });
  return hot;
}

export function hit(mx, my, x, y, w, h) {
  return mx >= x && my >= y && mx < x + w && my < y + h;
}

/**
 * Восьмиугольник со срезанными углами — общая заготовка для кнопок главного
 * экрана и слотов умений. Прямой угол читается как «нарисовано наспех», скос —
 * как «выточено», и повторение одной и той же фаски связывает разные части
 * интерфейса в одно целое.
 */
export function bevelPath(g, x, y, w, h, c) {
  g.beginPath();
  g.moveTo(x + c, y);
  g.lineTo(x + w - c, y);
  g.lineTo(x + w, y + c);
  g.lineTo(x + w, y + h - c);
  g.lineTo(x + w - c, y + h);
  g.lineTo(x + c, y + h);
  g.lineTo(x, y + h - c);
  g.lineTo(x, y + c);
  g.closePath();
}

/**
 * Подложка панелей HUD: трекер заданий, полоса босса, карточка обучения.
 *
 * То же, что под панелью умений, вынесенное отдельно. Панели HUD лежат прямо на
 * мире, а не на затемнённом фоне, поэтому им нужна и тень: без неё панель
 * кажется дырой в картинке, а не предметом поверх неё.
 */
export function hudPlate(g, x, y, w, h, opts = {}) {
  const c = opts.bevel ?? 5;
  x = Math.round(x); y = Math.round(y);

  // тень — сдвинутый вниз силуэт
  bevelPath(g, x, y + 2, w, h, c);
  g.fillStyle = 'rgba(0,0,0,0.30)';
  g.fill();

  bevelPath(g, x, y, w, h, c);
  g.fillStyle = vgrad(g, y, h, [0, opts.top || 'rgba(28,23,46,0.86)', 1, opts.bottom || 'rgba(10,8,20,0.90)']);
  g.fill();

  g.save();
  bevelPath(g, x, y, w, h, c); g.clip();
  g.fillStyle = 'rgba(255,232,170,0.12)';
  g.fillRect(x, y, w, 1);
  g.restore();

  bevelPath(g, x, y, w, h, c);
  g.lineWidth = 1;
  g.strokeStyle = opts.border || 'rgba(150,126,80,0.42)';
  g.stroke();
}

/**
 * Ниша — обратная сторона `hudPlate`. У плиты свет по верхней кромке, и она
 * выступает вперёд; у ниши тень сверху и свет по нижнему краю, и она уходит
 * вглубь. Разница в две полоски, а читается сразу: сетка рюкзака в нише
 * выглядит вставленной в панель, а не наклеенной на неё.
 */
export function recess(g, x, y, w, h, opts = {}) {
  const c = opts.bevel ?? 5;
  x = Math.round(x); y = Math.round(y);
  bevelPath(g, x, y, w, h, c);
  g.fillStyle = vgrad(g, y, h, [0, 'rgba(5,4,11,0.62)', 1, 'rgba(18,15,32,0.38)']);
  g.fill();

  g.save();
  bevelPath(g, x, y, w, h, c);
  g.clip();
  g.fillStyle = 'rgba(0,0,0,0.42)';
  g.fillRect(x, y, w, 2);
  g.fillStyle = 'rgba(255,232,170,0.10)';
  g.fillRect(x, y + h - 1, w, 1);
  g.restore();

  bevelPath(g, x, y, w, h, c);
  g.lineWidth = 1;
  g.strokeStyle = opts.border || 'rgba(150,126,80,0.30)';
  g.stroke();
}

/**
 * Золотая нить с растворяющимися концами. Обычная сплошная линия читается как
 * разделитель в таблице; эта — как отделка.
 */
export function goldRule(g, x, y, w, alpha = 0.75) {
  const gr = g.createLinearGradient(x, 0, x + w, 0);
  gr.addColorStop(0, 'rgba(232,194,116,0)');
  gr.addColorStop(0.5, `rgba(232,194,116,${alpha})`);
  gr.addColorStop(1, 'rgba(232,194,116,0)');
  g.fillStyle = gr;
  g.fillRect(x, y, w, 1);
}

/**
 * Кнопка главного экрана — «плашка».
 *
 * Обычная `button` намеренно простая: её штампуют десятками в списках лавки и
 * кузни, и всякое украшательство там превращается в шум. На титульном экране
 * кнопок ровно три, они лежат на дорогой картинке, и простой прямоугольник с
 * волосяной рамкой рядом с ней выглядит заготовкой.
 *
 * Отсюда и приёмы: срезанные углы (прямой угол читается как «нарисовано
 * наспех», скос — как «выточено»), заливка градиентом сверху вниз вместо
 * плоской, золотая рамка вполсилы и золотая подчёркивающая нить под подписью
 * при наведении. Всё рисуется дешёвыми примитивами — ни одной картинки.
 */
export function plateButton(g, x, y, w, h, label, state = {}) {
  // disabled и danger приехали сюда, когда плашки заменили простые кнопки в
  // диалогах, на алтаре и в окнах подтверждения: там есть и недоступные ответы,
  // и необратимые действия, а без этих двух состояний плашка о них молчала.
  const dis = state.disabled;
  const hot = state.hot && !dis;
  const dg = state.danger;
  x = Math.round(x); y = Math.round(y);
  const c = 4;                       // срез угла

  const path = () => bevelPath(g, x, y, w, h, c);

  const grd = g.createLinearGradient(0, y, 0, y + h);
  if (dis) {
    grd.addColorStop(0, 'rgba(26,23,38,0.80)');
    grd.addColorStop(1, 'rgba(14,12,24,0.84)');
  } else if (dg) {
    grd.addColorStop(0, hot ? 'rgba(122,34,40,0.96)' : 'rgba(74,20,26,0.92)');
    grd.addColorStop(1, hot ? 'rgba(62,16,22,0.96)' : 'rgba(32,10,14,0.92)');
  } else if (hot) {
    grd.addColorStop(0, 'rgba(70,58,104,0.96)');
    grd.addColorStop(1, 'rgba(34,27,58,0.96)');
  } else {
    grd.addColorStop(0, 'rgba(34,29,54,0.88)');
    grd.addColorStop(1, 'rgba(16,13,30,0.92)');
  }
  path();
  g.fillStyle = grd;
  g.fill();

  // блик по верхней грани — он и создаёт ощущение объёма
  g.save();
  path(); g.clip();
  g.fillStyle = hot ? 'rgba(255,232,170,0.20)' : 'rgba(255,255,255,0.07)';
  g.fillRect(x, y, w, 1);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(x, y + h - 1, w, 1);
  g.restore();

  path();
  g.lineWidth = 1;
  g.strokeStyle = dis ? 'rgba(96,86,122,0.34)'
    : dg ? (hot ? '#ff9a90' : '#8a3a3e') : hot ? '#e8c274' : '#6d5c3a';
  g.stroke();

  const ty = y + (h - 10) / 2;
  text(g, ellipsize(label, w - 18, 10, hot), x + w / 2, ty, {
    size: 10, align: 'center', bold: hot,
    color: dis ? UI.textFaint : dg ? (hot ? '#ffe0d8' : '#ffb0a8') : hot ? '#fff4d8' : UI.text,
    shadow: 'rgba(4,3,10,0.85)',
  });

  // золотая нить под подписью — только при наведении, иначе три кнопки
  // превращаются в полосатый забор
  if (hot) {
    const tw = Math.min(w - 22, measure(label, 10, true) + 10);
    const gx = x + (w - tw) / 2, gy = y + h - 5;
    const line = g.createLinearGradient(gx, 0, gx + tw, 0);
    line.addColorStop(0, 'rgba(232,194,116,0)');
    line.addColorStop(0.5, 'rgba(232,194,116,0.9)');
    line.addColorStop(1, 'rgba(232,194,116,0)');
    g.fillStyle = line;
    g.fillRect(gx, gy, tw, 1);
  }
  return hot;
}

/**
 * Ползунок. Рисует дорожку, заполненную часть и ручку.
 *
 * Ручка шириной 5 не помещается в дорожку целиком, поэтому её ход короче
 * дорожки на её же ширину: иначе на нуле и на единице она наполовину вылезала
 * бы за края. Отсюда же и `sliderFrac` — обратное преобразование для мыши, оно
 * обязано быть парным этому, иначе ручка убегает из-под курсора.
 */
export const SLIDER_KNOB = 5;

export function slider(g, x, y, w, h, frac, opts = {}) {
  const hot = opts.hot, drag = opts.drag;
  x |= 0; y |= 0;
  const f = Math.max(0, Math.min(1, frac));
  g.fillStyle = '#14111f';
  g.fillRect(x, y, w, h);
  g.fillStyle = hot || drag ? UI.borderHi : UI.border;
  g.fillRect(x, y, w, 1); g.fillRect(x, y + h - 1, w, 1);
  g.fillRect(x, y, 1, h); g.fillRect(x + w - 1, y, 1, h);

  const run = w - 2 - SLIDER_KNOB;
  const fill = Math.round(run * f);
  if (fill > 0) {
    g.fillStyle = opts.color || '#5a8ad0';
    g.fillRect(x + 1, y + 1, fill + Math.round(SLIDER_KNOB / 2), h - 2);
  }
  const kx = x + 1 + fill;
  g.fillStyle = drag ? '#ffffff' : hot ? '#e8ecff' : '#c2c8e0';
  g.fillRect(kx, y - 1, SLIDER_KNOB, h + 2);
  g.fillStyle = '#0a0812';
  g.fillRect(kx, y - 1, 1, h + 2); g.fillRect(kx + SLIDER_KNOB - 1, y - 1, 1, h + 2);
  return f;
}

/** Доля 0..1 по положению курсора. Парная к отрисовке: ход тот же. */
export function sliderFrac(mx, x, w) {
  const run = w - 2 - SLIDER_KNOB;
  if (run <= 0) return 0;
  return Math.max(0, Math.min(1, (mx - x - 1 - SLIDER_KNOB / 2) / run));
}

/**
 * Строка списка: лавка, кузня, разбор, переплавка, слияние рун, снаряжение в
 * инвентаре.
 *
 * Раньше каждый список рисовал фон сам: `fillRect` на три процента белого и
 * полоска редкости слева. Двенадцать мест с одинаковым кодом и чуть разными
 * числами — и, что хуже, с чуть разным видом. Здесь одна заготовка: фаска,
 * встречный градиент, ребро по редкости и золотая рамка при наведении.
 *
 * Ребро работает лучше цветного названия: список читается по кромке сверху
 * вниз, не вчитываясь в буквы.
 */
export function listRow(g, x, y, w, h, opts = {}) {
  x = Math.round(x); y = Math.round(y);
  const rar = opts.rarity ? RARITY[opts.rarity] || RARITY.common : null;
  const hot = opts.hot, active = opts.active;
  const bev = opts.bevel ?? 3;

  bevelPath(g, x, y, w, h, bev);
  g.fillStyle = active
    ? vgrad(g, y, h, [0, 'rgba(72,58,26,0.80)', 1, 'rgba(32,26,14,0.80)'])
    : hot
      ? vgrad(g, y, h, [0, 'rgba(56,47,90,0.92)', 1, 'rgba(26,21,46,0.92)'])
      : vgrad(g, y, h, [0, 'rgba(31,26,52,0.62)', 1, 'rgba(15,12,27,0.62)']);
  g.fill();

  if (hot || active) {
    bevelPath(g, x, y, w, h, bev);
    g.lineWidth = 1;
    g.strokeStyle = active ? 'rgba(232,194,116,0.60)'
      : rgba(rar ? rar.color : UI.accent, 0.55);
    g.stroke();
  }
  // Ребро: цвет редкости, либо свой — в списках, где важна не редкость, а
  // состояние (доступно / рано / стихия реакции / ветка задания).
  const rib = opts.accent || (rar && rar.color);
  g.fillStyle = rib ? rgba(rib, hot || active ? 1 : 0.78)
    : hot ? 'rgba(150,132,196,0.7)' : 'rgba(88,76,118,0.42)';
  g.fillRect(x, y + 2, 2, h - 4);
}

/**
 * Переключатель разделов внутри панели: сегменты в общей нише.
 *
 * Раньше вкладки лавки и кузни были обычными кнопками в ряд — теми же, что
 * «Купить» и «Продать» в строках товара. Из-за этого не читалось, что одно
 * переключает страницу, а другое тратит золото. Сегменты в утопленной дорожке
 * ни с чем не спутать: активный поднят и подсвечен золотом, остальные лежат.
 *
 * Возвращает разложенные прямоугольники — по ним экран сам вешает нажатия.
 */
export function segTabs(g, x, y, h, items, activeId, opts = {}) {
  const PAD = opts.pad ?? 11;
  const ws = items.map((it) => Math.round(measure(it.label, 9, true)) + PAD * 2);
  const total = ws.reduce((a, b) => a + b, 0);
  recess(g, x, y, total + 4, h + 4, { bevel: 3 });

  const out = [];
  let cx = x + 2;
  for (let i = 0; i < items.length; i++) {
    const w = ws[i], active = items[i].id === activeId;
    const hot = opts.hot ? opts.hot(cx, y + 2, w, h) : false;
    if (active) {
      bevelPath(g, cx, y + 2, w, h, 3);
      g.fillStyle = vgrad(g, y + 2, h, [0, 'rgba(96,74,26,0.88)', 1, 'rgba(48,36,12,0.88)']);
      g.fill();
      g.lineWidth = 1;
      g.strokeStyle = 'rgba(232,194,116,0.60)';
      g.stroke();
    } else if (hot) {
      bevelPath(g, cx, y + 2, w, h, 3);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fill();
    }
    text(g, items[i].label, cx + w / 2, y + 2 + (h - 9) / 2, {
      size: 9, align: 'center', bold: active,
      color: active ? '#ffe6a8' : hot ? UI.text : UI.textDim,
    });
    out.push({ id: items[i].id, x: cx, y: y + 2, w, h });
    cx += w;
  }
  return out;
}

/**
 * Язычок под число: золото в лавке, мощь в инвентаре, стоимость в кузне.
 * Число на плашке читается как итог, а не как ещё одна строчка справки.
 */
export function valueTab(g, x, y, label, opts = {}) {
  const size = opts.size ?? 9;
  const w = Math.round(measure(label, size, true)) + 14;
  const h = opts.h ?? 12;
  const rx = opts.align === 'right' ? x - w : opts.align === 'center' ? x - w / 2 : x;
  bevelPath(g, rx, y, w, h, 3);
  g.fillStyle = opts.danger
    ? vgrad(g, y, h, [0, 'rgba(104,30,34,0.88)', 1, 'rgba(52,14,18,0.88)'])
    : vgrad(g, y, h, [0, 'rgba(96,74,26,0.88)', 1, 'rgba(48,36,12,0.88)']);
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = opts.danger ? 'rgba(232,140,128,0.55)' : 'rgba(232,194,116,0.55)';
  g.stroke();
  text(g, label, rx + w / 2, y + (h - size) / 2, {
    size, align: 'center', bold: true, color: opts.danger ? '#ffc0b4' : '#ffe6a8',
  });
  return w;
}

/**
 * Свечение редкости внутри гнезда. Градиент строится в своих координатах от
 * нуля, а ставится переносом холста — иначе на каждую из тридцати ячеек рюкзака
 * пришлось бы делать отдельный градиент, потому что у каждой свой x и y.
 */
const slotGlowCache = new Map();
function slotGlow(g, size, col) {
  const k = col + '|' + size;
  let gr = slotGlowCache.get(k);
  if (!gr) {
    gr = g.createRadialGradient(size / 2, size * 0.44, 1, size / 2, size * 0.5, size * 0.74);
    gr.addColorStop(0, rgba(col, 0.34));
    gr.addColorStop(1, rgba(col, 0.02));
    slotGlowCache.set(k, gr);
  }
  return gr;
}

/**
 * Ячейка предмета — гнездо, а не квадрат.
 *
 * Плоская заливка с рамкой в один пиксель читается как ячейка таблицы: вещи в
 * ней лежат «на бумаге». Здесь ячейка утоплена — тёмная кромка сверху, светлая
 * снизу, — и предмет оказывается внутри гнезда. Под иконкой контактная тень:
 * без неё предмет висит в воздухе, и никакая оправа этого не исправит.
 *
 * Редкость несёт три знака сразу: цвет оправы, свечение изнутри и уголки у
 * эпических и легендарных. Один цвет рамки на тёмном фоне различается плохо —
 * синее от фиолетового на просвет не отличить, а вот «есть уголки / нет» видно
 * боковым зрением, не вчитываясь.
 */
export function itemSlot(g, x, y, size, item, opts = {}) {
  x |= 0; y |= 0;
  const rar = item ? RARITY[item.rarity] || RARITY.common : null;
  const hot = opts.hot;
  const bev = size >= 24 ? 4 : 3;

  bevelPath(g, x, y + 1, size, size, bev);
  g.fillStyle = 'rgba(0,0,0,0.34)';
  g.fill();

  bevelPath(g, x, y, size, size, bev);
  g.fillStyle = hot ? vgrad(g, y, size, [0, '#241e3c', 1, '#141126'])
                    : vgrad(g, y, size, [0, '#0e0c1a', 1, '#1a1630']);
  g.fill();

  g.save();
  bevelPath(g, x, y, size, size, bev);
  g.clip();
  if (rar) {
    g.save();
    g.translate(x, y);
    g.fillStyle = slotGlow(g, size, rar.color);
    g.fillRect(0, 0, size, size);
    g.restore();
  }
  // фаска утопленного гнезда
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(x, y, size, 1);
  g.fillStyle = 'rgba(255,255,255,0.06)';
  g.fillRect(x, y + size - 1, size, 1);
  g.restore();

  if (item) {
    const ic = item.icon;
    if (ic) {
      // В мелких ячейках (лавка, кузня, окно подтверждения) иконка ужимается до
      // трёх четвертей. Доля не на глаз: слой интерфейса вчетверо крупнее
      // раскладки, и 15 единиц от двадцати — это ровно 60 настоящих пикселей,
      // по три на пиксель иконки. При любом другом размере пиксели вышли бы
      // разной ширины, и аккуратная огранка превратилась бы в кашу.
      const d = size >= 24 ? ic.width : Math.round(ic.width * 0.75);
      // контактная тень — предмет лежит в гнезде, а не парит над ним
      g.save();
      g.globalAlpha = 0.38;
      g.fillStyle = '#000000';
      g.beginPath();
      g.ellipse(x + size / 2, y + size - 4.5, d * 0.34, 1.8, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
      pixelBlit(g, ic, x + ((size - d) >> 1), y + ((size - d) >> 1) - (size >= 24 ? 1 : 0), d, d);
    }
  } else if (opts.placeholder) {
    text(g, opts.placeholder, x + size / 2, y + (size - 9) / 2, {
      size: 9, align: 'center', color: 'rgba(140,124,180,0.42)', bold: true,
    });
  }

  // оправа
  bevelPath(g, x, y, size, size, bev);
  g.lineWidth = 1;
  g.strokeStyle = rar ? rgba(rar.color, hot ? 0.98 : 0.7)
                : hot ? 'rgba(214,188,132,0.62)' : 'rgba(118,102,72,0.30)';
  g.stroke();

  if (item) {
    // уголки — знак дорогой вещи, видимый боковым зрением
    if (item.rarity === 'epic' || item.rarity === 'legendary') {
      const L = size >= 24 ? 5 : 4;
      g.fillStyle = rgba(rar.color, 0.85);
      for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const cx = sx > 0 ? x + bev - 1 : x + size - bev;
        const cy = sy > 0 ? y + 1 : y + size - 2;
        g.fillRect(sx > 0 ? cx : cx - L + 1, cy, L, 1);
        const vx = sx > 0 ? x : x + size - 1;
        const vy = sy > 0 ? y + bev - 1 : y + size - bev - L + 1;
        g.fillRect(vx, vy, 1, L);
      }
    }
    if (item.rarity === 'legendary') {
      g.save();
      g.globalAlpha = 0.30 + Math.sin((opts.time || 0) * 2.2) * 0.16;
      bevelPath(g, x + 2, y + 2, size - 4, size - 4, Math.max(1, bev - 1));
      g.lineWidth = 1;
      g.strokeStyle = rar.color;
      g.stroke();
      g.restore();
    }

    const badge = (label, col) => {
      const bw = measure(label, 8, true) + 5;
      const bx = x + size - bw - 1, by = y + size - 10;
      bevelPath(g, bx, by, bw, 9, 2);
      g.fillStyle = 'rgba(6,4,12,0.88)';
      g.fill();
      g.lineWidth = 1;
      g.strokeStyle = rgba(col, 0.55);
      g.stroke();
      text(g, label, bx + bw / 2, by, { size: 8, align: 'center', color: col, bold: true });
    };
    if (item.count > 1) badge(String(item.count), '#e8ecfa');
    else if (item.sharp) badge('+' + item.sharp, '#ffd54a');

    // метки: комплект — слева внизу, уникум — справа вверху, надето — слева вверху
    const pip = (cx, cy, col) => {
      g.save();
      g.translate(cx, cy);
      g.rotate(Math.PI / 4);
      g.fillStyle = 'rgba(4,3,10,0.9)';
      g.fillRect(-2.6, -2.6, 5.2, 5.2);
      g.fillStyle = col;
      g.fillRect(-1.7, -1.7, 3.4, 3.4);
      g.restore();
    };
    if (item.set) pip(x + 4.5, y + size - 4.5, '#68d47c');
    if (item.unique) pip(x + size - 4.5, y + 4.5, '#ffab3d');
    if (opts.equipped) pip(x + 4.5, y + 4.5, UI.accent);
  }
}

const STAT_ORDER = ['atk', 'dps', 'def', 'hp', 'mp', 'str', 'vit', 'agi', 'int', 'crit', 'cdmg', 'spd', 'lifesteal', 'regen', 'magic', 'burn', 'poison', 'slow'];

/** Всплывающая карточка предмета. */
export function tooltip(g, item, mx, my, viewW, viewH, opts = {}) {
  if (!item) return;
  const { STAT_LABEL } = opts;
  const rar = RARITY[item.rarity] || RARITY.common;
  const lines = [];
  const stats = item.stats || {};
  for (const k of STAT_ORDER) {
    if (stats[k] === undefined || stats[k] === 0) continue;
    const cmp = opts.compare && opts.compare.stats ? (opts.compare.stats[k] || 0) : null;
    lines.push({ k, v: stats[k], diff: cmp === null ? null : stats[k] - cmp });
  }
  // ── урон в секунду: единственное число, которым оружие сравнивают честно
  //
  // Раньше темп лежал на вещи статом `spd`, и он же второй раз делил скорость
  // атаки — скорость считалась дважды. Дублирование убрали, но вместе с ним с
  // карточки ушёл и последний признак того, что кинжал бьёт чаще: игрок видел
  // «атака 52» против «атака 101» у топора и читал кинжал как строго худший.
  //
  // Показываем то, что на самом деле решает. Множитель профиля теперь масштабирует
  // всю атаку целиком, поэтому `атака × темп` сравнимо между видами напрямую —
  // до этой починки такое число врало бы.
  const dpsOf = (it) => {
    if (!it || it.kind !== 'weapon') return 0;
    const pr = WEAPON_PROFILE[it.sub] || WEAPON_PROFILE.sword;
    return Math.round(((it.stats || {}).atk || 0) * pr.spd);
  };
  if (item.kind === 'weapon') {
    const mine = dpsOf(item), theirs = opts.compare ? dpsOf(opts.compare) : 0;
    lines.push({ k: 'dps', v: mine, diff: opts.compare ? mine - theirs : null });
  }
  if (opts.compare) {
    for (const k of STAT_ORDER) {
      if (stats[k] !== undefined && stats[k] !== 0) continue;
      const cv = opts.compare.stats ? opts.compare.stats[k] : 0;
      if (cv) lines.push({ k, v: 0, diff: -cv });
    }
  }

  // Ширина считается по содержимому, а не задана числом.
  //
  // Раньше стояло 172 — под пиксельный шрифт, где строка «Слизистый сгусток»
  // занимала полторы сотни пикселей. Векторный текст той же высоты уже вдвое
  // уже, и жёсткая ширина превращала карточку в полупустое полотно на пол-экрана.
  // Заодно это снимает вопрос с языками: английские строки другой длины, и
  // подбирать под них второе число не придётся.
  const RH = 8;              // строка характеристики
  const NH = 10;             // строка имени
  const isRune = item.kind === 'rune';
  const runeRows = isRune && item.runeType === 'active' ? 2 : 0;
  const setDef = item.set && opts.SETS ? opts.SETS[item.set] : null;
  const setRows = setDef ? 3 : 0;

  const statW = lines.reduce((m, l) => Math.max(m,
    measure(STAT_LABEL[l.k] || l.k, 9) + 42 + (l.diff ? 22 : 0)), 0);
  const wantW = Math.max(
    measure(item.name, 10, true) + 14,
    statW + 14,
    item.desc ? 108 : 0,
    setDef ? 118 : 0,
    92);
  const w = Math.round(clamp(wantW, 92, 196));

  const descLines = item.desc ? wrap(item.desc, w - 14, 9) : [];
  // закалка — то, что дали вехи заточки; в имени это не отражается
  const temperLines = item.temper && item.temper.length
    ? wrap('Закалка: ' + item.temper.join(', '), w - 14, 9) : [];
  const hintLines = item.hint ? wrap(item.hint, w - 14, 9) : [];
  // длинное имя переносится — без этого высота считалась по одной строке и низ обрезался
  const nameRows = wrap(item.name, w - 14, 10, true).length;
  const h = 14 + nameRows * NH + lines.length * RH + runeRows * RH + descLines.length * RH +
            temperLines.length * RH + hintLines.length * RH +
            setRows * RH + (item.reqLevel ? RH + 2 : 0) + (opts.price ? RH + 3 : 0) + 6;
  let x = clamp(mx + 12, 2, viewW - w - 2);
  let y = clamp(my - 6, 2, viewH - h - 2);

  // карточка полупрозрачная: сквозь неё видно, что она закрывает — на 480×270
  // она перекрывает заметную часть экрана, и глухая заливка съедала контекст
  panel(g, x, y, w, h, { border: rar.color, fill: 'rgba(12,10,22,0.82)' });
  let ty = y + 6;
  ty += textBlock(g, item.name, x + 7, ty, w - 14, { size: 10, bold: true, color: rar.color, lineHeight: NH });
  const kindName = {
    weapon: 'оружие', armor: 'доспех', helm: 'шлем', trinket: 'украшение',
    potion: 'зелье', material: 'материал', scroll: 'свиток',
    rune: item.runeType === 'passive' ? 'пассивная руна' : 'руна умения',
  }[item.kind] || '';
  text(g, `${t(rar.name)} · ${t(kindName)}${item.level ? t(' · ур. ') + item.level : ''}`, x + 7, ty, { size: 9, color: UI.textDim });
  ty += NH;

  for (const l of lines) {
    const label = STAT_LABEL[l.k] || l.k;
    const v = l.v;
    text(g, label, x + 7, ty, { size: 9, color: UI.textDim });
    let str = (v > 0 ? '+' : '') + (Math.round(v * 10) / 10);
    text(g, str, x + w - (l.diff ? 30 : 8), ty, { size: 9, color: v >= 0 ? UI.text : UI.danger, align: 'right' });
    if (l.diff !== null && l.diff !== 0) {
      const d = Math.round(l.diff * 10) / 10;
      text(g, (d > 0 ? '▲+' : '▼') + d, x + w - 8, ty, {
        size: 9, align: 'right', color: d > 0 ? UI.good : UI.danger,
      });
    }
    ty += RH;
  }
  if (runeRows) {
    text(g, 'Мана', x + 7, ty, { size: 9, color: UI.textDim });
    text(g, String(item.cost), x + w - 8, ty, { size: 9, align: 'right', color: UI.mp });
    ty += RH;
    text(g, 'Откат', x + 7, ty, { size: 9, color: UI.textDim });
    text(g, item.cd.toFixed(1) + ' с', x + w - 8, ty, { size: 9, align: 'right', color: UI.text });
    ty += RH;
  }
  for (const d of descLines) { text(g, d, x + 7, ty, { size: 9, color: item.unique ? '#ffab3d' : UI.textDim }); ty += RH; }
  for (const t of temperLines) { text(g, t, x + 7, ty, { size: 9, color: '#ffd54a' }); ty += RH; }
  if (setDef) {
    const worn = (opts.setCounts && opts.setCounts[item.set]) || 0;
    text(g, t(setDef.name) + ` (${worn}/4)`, x + 7, ty, { size: 9, color: '#68d47c', bold: true });
    ty += RH;
    text(g, '2 части: ' + setDef.two.label, x + 7, ty, { size: 8, color: worn >= 2 ? UI.good : UI.textFaint });
    ty += RH;
    text(g, '4 части: ' + setDef.four.label, x + 7, ty, { size: 8, color: worn >= 4 ? UI.good : UI.textFaint });
    ty += RH;
  }
  for (const hnt of hintLines) { text(g, hnt, x + 7, ty, { size: 9, color: '#9a8ad0' }); ty += RH; }
  if (item.reqLevel) {
    const ok = !opts.playerLevel || opts.playerLevel >= item.reqLevel;
    text(g, 'Требуется уровень ' + item.reqLevel, x + 7, ty, { size: 9, color: ok ? UI.textFaint : UI.danger });
    ty += RH + 2;
  }
  if (opts.price) {
    text(g, opts.priceLabel || 'Цена:', x + 7, ty, { size: 9, color: UI.textDim });
    text(g, opts.price + ' зол.', x + w - 8, ty, { size: 9, align: 'right', color: UI.gold, bold: true });
  }
}

/** Тонкая прокручиваемая область — возвращает смещение. */
export function scrollbar(g, x, y, h, total, view, offset) {
  if (total <= view) return;
  g.fillStyle = '#171426';
  g.fillRect(x, y, 3, h);
  const th = Math.max(10, (h * view) / total);
  const ty = y + (h - th) * (offset / Math.max(1, total - view));
  g.fillStyle = UI.border;
  g.fillRect(x, ty, 3, th);
}
