// Два языка: русский и английский.
//
// Ключ словаря — сама русская строка, а не выдуманный идентификатор. Причина
// простая: в коде остаётся живой текст, который видно при чтении, а не
// `t('menu.pause.save')`, ради которого пришлось бы каждый раз лезть в словарь,
// чтобы понять, что там написано. Плата — при правке русской строки нужно
// поправить и ключ; замер показал, что это дешевле: строк 846, а мест, где они
// встречаются, 901, то есть почти каждая используется ровно один раз.
//
// Перевод подставляется внутри `text()`, а не в местах вызова. Из 901 вхождения
// 833 — самостоятельные литералы, которые доходят до отрисовки нетронутыми;
// правка на уровне отрисовки покрывает их все разом. Оставшиеся 68 склеиваются
// с числами и именами — там `t()` стоит явно, вокруг русской половинки.
//
// Если перевода нет, возвращается русский оригинал: пропущенная строка портит
// один ярлык, а не роняет экран.

import { RU_EN } from './dict.js';

export const LANGS = [
  { id: 'ru', name: 'Русский' },
  { id: 'en', name: 'English' },
];

let lang = 'ru';
const listeners = new Set();

export function getLang() { return lang; }

export function setLang(id) {
  if (id !== 'ru' && id !== 'en') return;
  if (id === lang) return;
  lang = id;
  for (const fn of listeners) fn(lang);
}

/** Позвать, когда язык сменился: сбросить кэши запечённого текста. */
export function onLangChange(fn) { listeners.add(fn); }

/**
 * Разборщики для строк, которых нет в словаре целиком.
 *
 * Имя предмета склеивается при выпадении из базы и аффиксов — «Стальной меч
 * ярости» — и в таком виде уходит в сохранение. Записывать все сочетания в
 * словарь нельзя: их тысячи. Переделывать генерацию тоже не хочется — имя
 * читается в девяноста местах, и всюду пришлось бы звать сборщик.
 *
 * Поэтому промах по словарю отдаётся разборщикам: они узнают склейку, переводят
 * части и собирают обратно уже по правилам английского. Результат кладётся в
 * кэш — разбор случается один раз на каждое встреченное имя, а не каждый кадр.
 */
const resolvers = [];
let memo = new Map();

export function addResolver(fn) { resolvers.push(fn); memo.clear(); }

/** Приставки вида «Получено: » — общий случай «известное начало + хвост». */
let heads = null;
function headList() {
  if (!heads) heads = Object.keys(RU_EN).filter((k) => /[:—-]\s$|\s$/.test(k));
  return heads;
}

/**
 * Строки с подставленными числами: «ЭТАЖ 7», «+240 опыта», «Опыт 1.2к / 3к».
 * Их семьдесят штук, и записать каждое значение в словарь нельзя. Числа
 * заменяются на метки, по образцу ищется перевод, числа возвращаются на места.
 */
// хвост K/M — сокращение тысяч и миллионов из `fmt`, он часть числа
const NUM = /-?\d+(?:[.,]\d+)?[KMкм]?/g;
function byPattern(s) {
  if (!/\d/.test(s)) return null;
  const nums = [];
  const pat = s.replace(NUM, (m) => { nums.push(m); return '{' + (nums.length - 1) + '}'; });
  const tr = RU_EN[pat];
  if (tr === undefined) return null;
  return tr.replace(/\{(\d+)\}/g, (_, i) => nums[+i] ?? '');
}

function resolve(s) {
  const p = byPattern(s);
  if (p !== null) return p;
  for (const fn of resolvers) {
    const r = fn(s, t);
    if (r != null) return r;
  }
  for (const h of headList()) {
    if (s.length > h.length && s.startsWith(h)) return RU_EN[h] + t(s.slice(h.length));
  }
  return null;
}

/**
 * Перевести строку. На русском — тождество без единого поиска, поэтому родной
 * язык не платит за существование чужого.
 */
// Крючок для проверки покрытия: собирает то, что прошло через перевод. Нужен,
// чтобы прогнать все экраны и увидеть строки, оставшиеся русскими, — глазами
// такое не переберёшь, их под тысячу.
let audit = null;
export function setAudit(fn) { audit = fn; }

export function t(s) {
  if (lang === 'ru' || !s) return s;
  const v = RU_EN[s];
  if (v !== undefined) { if (audit) audit(s, v); return v; }
  let r = memo.get(s);
  if (r === undefined) {
    const x = resolve(s);
    r = x === null ? s : x;
    memo.set(s, r);
  }
  if (audit) audit(s, r);
  return r;
}

/** Есть ли перевод — нужно аудиту вёрстки, не игре. */
export function hasT(s) { return RU_EN[s] !== undefined || resolve(s) !== null; }
