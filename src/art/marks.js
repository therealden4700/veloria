// Иконки стихийных меток над врагом.
//
// Метка должна читаться за долю секунды и с любого фона, поэтому иконка — не
// буква и не цветное пятно, а силуэт 5×5 с тёмной обводкой. Обводка рисуется
// один раз при запекании: дилатация на лету стоила бы сотен fillRect за кадр.

import { MARKS } from '../systems/reactions.js';

const GLYPH = {
  flame: ['..#..', '.##..', '.###.', '#####', '.###.'],
  flake: ['#.#.#', '.###.', '##.##', '.###.', '#.#.#'],
  drop:  ['..#..', '..#..', '.#.#.', '#...#', '.###.'],
  bolt:  ['...##', '..##.', '.####', '..##.', '.##..'],
  skull: ['.###.', '#####', '#.#.#', '#####', '.#.#.'],
  cloud: ['..##.', '.####', '#####', '.###.', '..#..'],
};

const cache = new Map();

/** Канвас 7×7: силуэт метки с обводкой. Запекается при первом обращении. */
export function markIcon(key) {
  let c = cache.get(key);
  if (c) return c;
  const m = MARKS[key];
  const rows = GLYPH[m && m.icon] || GLYPH.flame;
  c = document.createElement('canvas');
  c.width = 7; c.height = 7;
  const g = c.getContext('2d');

  // обводка: те же пиксели, сдвинутые во все восемь сторон
  g.fillStyle = 'rgba(6,4,12,0.92)';
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) if (rows[y][x] === '#') g.fillRect(x + 1 + dx, y + 1 + dy, 1, 1);
      }
    }
  }
  // сам силуэт: светлая верхняя половина, основной цвет ниже — объём за 2 тона
  for (let y = 0; y < 5; y++) {
    g.fillStyle = y < 2 ? m.color2 : m.color;
    for (let x = 0; x < 5; x++) if (rows[y][x] === '#') g.fillRect(x + 1, y + 1, 1, 1);
  }
  cache.set(key, c);
  return c;
}
