// Палитры. Каждый материал — рампа из 4-5 оттенков (тень → блик).
// Одна общая гамма держит всю игру визуально цельной.

export const INK = '#100c1c';
export const INK_SOFT = 'rgba(16,12,28,0.55)';

export const RAMP = {
  skin:    ['#8c4a37', '#c9765a', '#efa47e', '#ffd0ad'],
  skinPale:['#6a4a5e', '#9a7a8c', '#c5aab6', '#e8dbe2'],
  hair:    ['#2a1a12', '#4d2f1c', '#77492a', '#a5713f'],
  cloth:   ['#2c2450', '#453a7a', '#6355a8', '#8b7bd0'],
  leather: ['#33200f', '#5a3a1d', '#845733', '#b07f4f'],
  bronze:  ['#4a2c14', '#8a5423', '#c78a3e', '#f0bd6e'],
  iron:    ['#2b3040', '#4a5468', '#727e96', '#a3b0c6'],
  steel:   ['#33405e', '#5a6d94', '#8ea0c4', '#c6d6ef'],
  gold:    ['#5c3a0d', '#9d6b16', '#e0aa2e', '#ffe07a'],
  arcane:  ['#2b1350', '#552a94', '#8b4fd8', '#c99cff'],
  crimson: ['#4a0f1c', '#8c1f2e', '#cc3a41', '#f57a6b'],
  emerald: ['#0e3a25', '#1c6b41', '#2fa163', '#6fd996'],
  bone:    ['#4a4436', '#8a8067', '#c4bb9c', '#efe7cf'],
  shadowy: ['#120e22', '#241c3f', '#3b2f63', '#5c4a91'],
  // Пролом: выбеленная кость земли и фиолетовая пустота разломов. Нарочно
  // холоднее «arcane» и светлее «shadowy» — иначе биом сливался бы с
  // подземельем, где уже правит фиолетовый.
  voidRift:['#170f26', '#2e1c47', '#5c3a86', '#a882e0'],
  pale:    ['#3a3742', '#5e5a68', '#8f8a99', '#cfc9d8'],
  blood:   ['#3d0810', '#7a1420', '#b52a2e'],
  ice:     ['#1d3f63', '#356f9e', '#63a8d4', '#b0e4fb'],
  fire:    ['#5c1207', '#a83512', '#e8721a', '#ffc44a'],
  poison:  ['#20401a', '#3f7a2a', '#6fb83c', '#b6ee6a'],
  stone:   ['#242434', '#3c3c50', '#5a5a72', '#818199'],
  wood:    ['#2c1a10', '#4a2c19', '#6d452a', '#96633c'],
  slime:   ['#134a3c', '#1f8a63', '#37c98c', '#8ff5c6'],
};

export const RARITY = {
  common:    { name: 'Обычное',      color: '#c3cbd9', glow: 'rgba(195,203,217,0.0)', mult: 1.00, affixes: 0 },
  uncommon:  { name: 'Необычное',    color: '#68d47c', glow: 'rgba(104,212,124,0.35)', mult: 1.16, affixes: 1 },
  rare:      { name: 'Редкое',       color: '#57a6ff', glow: 'rgba(87,166,255,0.45)', mult: 1.36, affixes: 2 },
  epic:      { name: 'Эпическое',    color: '#c07df0', glow: 'rgba(192,125,240,0.5)',  mult: 1.62, affixes: 3 },
  legendary: { name: 'Легендарное',  color: '#ffab3d', glow: 'rgba(255,171,61,0.6)',   mult: 2.00, affixes: 4 },
};

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

/** Цвет уровня снаряжения (0..6) — по нему красятся доспех и оружие героя. */
export const TIER_RAMP = [
  RAMP.leather, RAMP.bronze, RAMP.iron, RAMP.steel, RAMP.gold, RAMP.arcane, RAMP.crimson,
];

export const UI = {
  panel:      'rgba(16,13,28,0.93)',
  panelSolid: '#14111f',
  panelAlt:   '#1c1830',
  border:     '#5b4a7c',
  borderHi:   '#8f7ab8',
  text:       '#dfe3f0',
  textDim:    '#8e93ab',
  textFaint:  '#5c6079',
  accent:     '#f0c05a',
  hp:         '#d8434b',
  hpDark:     '#5a1420',
  mp:         '#4a86e0',
  mpDark:     '#152548',
  xp:         '#5fd18a',
  xpDark:     '#153a26',
  gold:       '#f0c05a',
  danger:     '#ff6b5e',
  good:       '#6fdc8c',
};

/** Смешать два hex-цвета. */
export function mix(a, b, t) {
  const pa = hex2rgb(a), pb = hex2rgb(b);
  return `rgb(${Math.round(pa[0] + (pb[0] - pa[0]) * t)},${Math.round(pa[1] + (pb[1] - pa[1]) * t)},${Math.round(pa[2] + (pb[2] - pa[2]) * t)})`;
}

export function hex2rgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hexColor, a) {
  const [r, g, b] = hex2rgb(hexColor);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * Осветлить/затемнить hex. amt > 0 — светлее.
 *
 * Результат кэшируется: функция чистая, а зовут её из отрисовки полос по пять
 * раз на полосу каждый кадр. Разбор hex и склейка строки на таком потоке стоили
 * заметно — кадр в городе поднимался с 0,55 до 0,78 мс. Пар «цвет + сдвиг» в
 * игре пара десятков, так что кэш не растёт.
 */
const shadeCache = new Map();

export function shade(hexColor, amt) {
  const k = hexColor + '|' + amt;
  let v = shadeCache.get(k);
  if (v === undefined) {
    const [r, g, b] = hex2rgb(hexColor);
    const f = (c) => Math.max(0, Math.min(255, Math.round(amt > 0 ? c + (255 - c) * amt : c * (1 + amt))));
    v = `rgb(${f(r)},${f(g)},${f(b)})`;
    shadeCache.set(k, v);
  }
  return v;
}
