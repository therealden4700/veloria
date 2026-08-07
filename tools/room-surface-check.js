// Комната обязана уметь всё, что от «игры» просят герой и враги.
//
//   node tools/room-surface-check.js
//
// Дважды подряд комната падала на одном и том же: сущность звала метод, которого
// у неё нет. Сперва `proc` — первый же удар монстра по игроку ронял такт
// целиком. Потом `onLevelUp` — и это нашлось только в Проломе, где страж даёт
// столько опыта, что уровень берут прямо с него; в лесу тот же код проходил
// насквозь. Оба раза стенд говорил не то: «мир не восстановился», «страж
// сломался».
//
// Ловить такое случайным попаданием нельзя. Здесь список составляется из самого
// кода — все обращения вида `game.что-то(` в сущностях — и сверяется с тем, что
// комната умеет.
//
// ЧЕГО ЭТОТ СТЕНД НЕ МЕРЯЕТ. Он проверяет наличие, а не поведение: метод может
// быть на месте и делать не то. За поведением следят остальные стенды.
// Обращения через переменную (`const g = game; g.что-то()`) он тоже не увидит —
// в коде сущностей таких нет, и появиться им незачем.

import { readFileSync, readdirSync } from 'node:fs';
import { World, prepareArt } from '../server/world.js';

const problems = [];
const note = (s) => problems.push(s);
const log = (s) => console.log(s);

prepareArt();

// ── что просят у «игры»
// Реакции сюда входят наравне с сущностями: их считает та же `damageEnemy`,
// а зовутся они из боя, который комната ведёт сама.
const ФАЙЛЫ = [
  'src/entities/player.js',
  'src/entities/enemies.js',
  'src/systems/reactions.js',
];
const просят = new Map();          // метод → где просят
for (const f of ФАЙЛЫ) {
  let текст;
  try { текст = readFileSync(new URL('../' + f, import.meta.url), 'utf8'); }
  catch { note(`не нашёлся ${f} — список обращений неполон, стенд врёт`); continue; }
  for (const m of текст.matchAll(/\bgame\.([a-zA-Z_$][\w$]*)\s*\(/g)) {
    if (!просят.has(m[1])) просят.set(m[1], []);
    просят.get(m[1]).push(f.split('/').pop());
  }
}
if (!просят.size) { note('в сущностях не нашлось ни одного обращения к игре — стенд смотрит не туда'); }

// Эти зовёт только ввод героя, а ввод в комнате проигрывает клиент: сама она
// `Player.update` не вызывает — двигает шагами через `applyInput`. Пишем их
// сюда явно, чтобы список не молчал о том, чего в нём нет.
const НЕ_НУЖНЫ = new Set(['playerSwing', 'quickPotion', 'useSkill']);

const w = new World({ kind: 'biome', id: 'forest', seed: 20260805 });
log(`комната: ${w.zone.name}, населения ${w.enemies.length}`);
log('');

const нет = [];
for (const [метод, где] of [...просят].sort()) {
  const есть = typeof w[метод] === 'function';
  const нужен = !НЕ_НУЖНЫ.has(метод);
  log(`  ${есть ? '✓' : нужен ? '✗' : '·'} game.${метод}()  ← ${[...new Set(где)].join(', ')}${нужен ? '' : '  (только ввод героя)'}`);
  if (!есть && нужен) нет.push(метод);
}
if (нет.length) {
  note(`комната не умеет: ${нет.map((m) => m + '()').join(', ')} — сущность позовёт, и такт упадёт целиком`);
}

// ── и поля, без которых враги не ходят
const ПОЛЯ = ['zone', 'enemies', 'players', 'particles', 'floats', 'shake', 'projectiles'];
const нетПолей = ПОЛЯ.filter((k) => w[k] === undefined || w[k] === null);
log('');
log(`поля: ${ПОЛЯ.map((k) => (нетПолей.includes(k) ? '✗' : '✓') + k).join(' ')}`);
if (нетПолей.length) note(`у комнаты нет полей: ${нетПолей.join(', ')}`);

// ── а теперь по-настоящему: пусть монстр ударит, а игрок возьмёт уровень
const p = w.addPlayer({ pid: 1, name: 'Подопытный', look: {}, character: null });
p.level = 1; p.hp = p.maxHp;
const враг = w.enemies.find((e) => !e.dead);
try {
  враг.x = p.x + 4; враг.y = p.y;
  враг.aggro = true;
  for (let t = 0; t < 6; t += 1 / 20) w.step(1 / 20);
  log('');
  log(`монстр рядом шесть секунд: у героя ${Math.round(p.hp)}/${Math.round(p.maxHp)} hp`);
  if (p.hp >= p.maxHp && !p.dead) note('монстр вплотную за шесть секунд не тронул героя — такт мог упасть молча');
} catch (e) {
  note('такт упал, пока монстр бил героя: ' + e.message);
}
try {
  const было = p.level;
  p.gainXp(100000, w);
  log(`выдали опыта: уровень ${было} → ${p.level}`);
  if (p.level <= было) note('уровень не вырос — опыт в комнате не работает');
} catch (e) {
  note('падение при взятии уровня: ' + e.message);
}
try {
  p.hp = 1;
  p.iframe = 0;          // иначе удар уйдёт в неуязвимость от прошлого боя,
  p.dead = false;        // герой не умрёт, и «поднялся» окажется правдой даром
  w.player = p;
  p.takeDamage(9999, w, враг);
  const умер = p.dead;
  log(`добили: умер — ${умер}`);
  if (!умер) note('герой не умер от 9999 урона — проверка подъёма ничего не значит');
  for (let t = 0; t < 7; t += 1 / 20) w.step(1 / 20);
  log(`подъём через семь секунд: жив — ${!p.dead}, ${Math.round(p.hp)}/${Math.round(p.maxHp)} hp`);
  if (умер && p.dead) note('герой не поднялся через семь секунд — в общем мире лежать некому и незачем');
  if (умер && !p.dead && p.hp < p.maxHp) note('поднялся раненым — подъём должен возвращать полное здоровье');
} catch (e) {
  note('падение при смерти героя: ' + e.message);
}

console.log('');
if (problems.length) {
  console.log(`найдено: ${problems.length}`);
  for (const s of problems) console.log('  ' + s);
  process.exit(1);
}
console.log('ПРОБЛЕМ НЕ НАЙДЕНО');
