// Точка входа: подготовка графики, масштабирование канваса, игровой цикл.

import { input } from './core/input.js';
import { audio } from './core/audio.js';
import { initProps } from './art/props.js';
import { bakeAllMonsters } from './art/sprites.js';
import { load as loadTitleArt } from './art/title.js';
import { Game } from './game.js';
import { profiler } from './core/profiler.js';
import { attachScreen } from './core/screen.js';
import { attachStage } from './ui/stage.js';
import { restoreWallet } from './core/wallet.js';

const VIEW = { w: 480, h: 270 };

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;

const uiCanvas = document.getElementById('ui');
const uictx = attachStage(uiCanvas);

const boot = document.getElementById('boot');
const bootBar = boot.querySelector('.bar i');
const bootTip = boot.querySelector('.sub');

attachScreen(canvas);

input.attach(canvas, VIEW);

// первый клик/клавиша — разрешение на звук (политика браузеров)
const unlock = () => {
  audio.init();
  audio.resume();
  removeEventListener('pointerdown', unlock);
  removeEventListener('keydown', unlock);
};
addEventListener('pointerdown', unlock);
addEventListener('keydown', unlock);

// Шагов ровно столько, сколько настоящей работы. Раньше их было четыре, и два
// из них — «подбираем палитру» и «зажигаем факелы» — не делали ничего: пустая
// функция, но каждый шаг ждёт по два кадра, и на театр уходило 67 мс из 550.
// Прогресс от этого честнее не стал, а загрузка стала длиннее.
const STEPS = [
  ['высекаем камень и дерево', () => initProps()],
  ['вдыхаем жизнь в тварей', () => bakeAllMonsters()],
];

let game = null;

async function bootstrap() {
  // заставка грузится параллельно запеканию спрайтов — сеть ждёт, процессор
  // работает, и на общее время загрузки картинка не влияет
  const art = loadTitleArt();

  for (let i = 0; i < STEPS.length; i++) {
    const [label, fn] = STEPS[i];
    bootTip.textContent = label + '…';
    bootBar.style.width = Math.round(((i + 0.2) / STEPS.length) * 100) + '%';
    await frame();
    try { fn(); } catch (e) { fatal(e); return; }
    bootBar.style.width = Math.round(((i + 1) / STEPS.length) * 100) + '%';
    await frame();
  }

  // прошлый вход, если он был: перезагрузка страницы не должна
  // заставлять подписываться заново
  restoreWallet();

  game = new Game(ctx, VIEW, uictx);
  window.__veloria = game;

  bootTip.textContent = 'разворачиваем карту…';
  await art;

  bootBar.style.width = '100%';
  await frame();
  boot.classList.add('hide');
  setTimeout(() => boot.remove(), 600);

  requestAnimationFrame(loop);
}

const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

let last = performance.now();
let acc = 0;

function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;      // не даём «прыгать» после сворачивания вкладки

  try {
    // Профайлер только смотрит: границы ему сообщает настоящий цикл, сам он
    // ничего не запускает. Иначе замер начинает мерить себя — на этом я уже
    // дважды обжёгся.
    profiler.frameStart();
    game.update(dt);
    profiler.updateEnd();
    game.draw();
    profiler.frameEnd();
  } catch (e) {
    fatal(e);
    throw e;
  }
}

function fatal(e) {
  const el = document.getElementById('fatal');
  el.hidden = false;
  el.textContent = 'Сбой:\n' + (e && e.stack ? e.stack : e);
  console.error(e);
}

addEventListener('error', (e) => fatal(e.error || e.message));
addEventListener('unhandledrejection', (e) => fatal(e.reason));

bootstrap();
