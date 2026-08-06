// Масштаб канваса под окно и полноэкранный режим.
//
// Вынесено из main.js отдельным модулем, потому что переключатель нужен и точке
// входа, и меню паузы: импорт game.js → main.js замкнул бы цикл.

import { resizeStage } from '../ui/stage.js';

const VIEW = { w: 480, h: 270 };

let canvasEl = null;

export function attachScreen(canvas) {
  canvasEl = canvas;
  addEventListener('resize', applyScale);
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) {
    document.addEventListener(ev, applyScale);
  }
  applyScale();
}

/**
 * Раньше масштаб округлялся вниз до целого — ради ровных пикселей, но ценой
 * окна: на 1366×768 помещалось ×2,84, а бралось ×2, и треть экрана уходила в
 * чёрные поля. Теперь берём столько, сколько влезает, и подтягиваем к целому
 * только когда оно рядом: на 1920×1080 это ровно ×4, пиксель в пиксель.
 */
export function applyScale() {
  if (!canvasEl) return;
  let scale = Math.min(innerWidth / VIEW.w, innerHeight / VIEW.h);
  const near = Math.round(scale);
  if (near >= 1 && Math.abs(scale - near) < 0.06) scale = near;
  scale = Math.max(0.5, scale);
  const w = Math.round(VIEW.w * scale), h = Math.round(VIEW.h * scale);
  canvasEl.style.width = w + 'px';
  canvasEl.style.height = h + 'px';
  // слой интерфейса обязан совпадать с миром пиксель в пиксель, иначе кнопки
  // разъедутся с местами, по которым считаются попадания
  resizeStage(w, h);
  document.body.classList.toggle('fs', isFullscreen());
}

function fullscreenEl() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

export function isFullscreen() { return !!fullscreenEl(); }

/**
 * Браузер пускает в полный экран только из обработчика жеста пользователя, а
 * встроенные панели (webview, iframe без allow="fullscreen") отказывают всегда.
 * Возвращаем обещание с результатом, чтобы отказ можно было показать игроку:
 * молча проглоченный отказ выглядит как сломанная кнопка.
 */
export function toggleFullscreen() {
  if (fullscreenEl()) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) { try { exit.call(document); } catch { } }
    return Promise.resolve(true);
  }
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) return Promise.resolve(false);
  try {
    const r = req.call(el);
    return (r && r.then) ? r.then(() => true, () => false) : Promise.resolve(!!fullscreenEl());
  } catch {
    return Promise.resolve(false);
  }
}
