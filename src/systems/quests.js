// Задания: сюжетная цепочка + бесконечные контракты после неё.

import { ENEMIES } from '../entities/enemies.js';
import { MATERIALS, makeItem, makeConsumable, makeMaterial } from './items.js';
import { BIOMES } from '../world/biomes.js';
import { makeRng } from '../core/rng.js';
import { t } from '../core/i18n.js';
import { audio } from '../core/audio.js';

export const QUEST_LINE = [
  {
    id: 'q1', title: 'Первая кровь', giver: 'captain', minLevel: 1,
    desc: 'Слизни расползлись по опушке Изумрудного леса. Проредите их — это твой вступительный взнос в гильдию.',
    type: 'kill', target: 'slime', count: 6,
    xp: 70, gold: 60, item: { kind: 'consumable', key: 'potionS', count: 3 },
  },
  {
    id: 'q2', title: 'Клыки для кузни', giver: 'smith', minLevel: 2,
    desc: 'Борину нужны волчьи клыки — говорит, из них выходит славная рукоять. Принеси четыре.',
    type: 'collect', target: 'fang', count: 4,
    xp: 120, gold: 90, item: { kind: 'weapon', tier: 1, rarity: 'uncommon' },
  },
  {
    id: 'q3', title: 'Зелёная угроза', giver: 'captain', minLevel: 3,
    desc: 'Гоблины обнаглели и ставят засады у тропы. Убей десятерых — пусть подумают дважды.',
    type: 'kill', target: 'goblin', count: 10,
    xp: 200, gold: 140,
  },
  {
    id: 'q4', title: 'Корень зла', giver: 'captain', minLevel: 5,
    desc: 'В глубине леса пробудился Древень Корнегрив. Пока он жив, лес не успокоится.',
    type: 'boss', target: 'treant', count: 1,
    xp: 420, gold: 320, item: { kind: 'armor', tier: 2, rarity: 'rare' },
  },
  {
    id: 'q5', title: 'Дорога в топь', giver: 'keeper', minLevel: 6,
    desc: 'Врата в Пепельную топь открыты. Ступи туда и вернись живым — уже достижение.',
    type: 'reach', target: 'swamp', count: 1,
    xp: 200, gold: 120, item: { kind: 'consumable', key: 'scroll', count: 2 },
  },
  {
    id: 'q6', title: 'Сердца топи', giver: 'alchemist', minLevel: 7,
    desc: 'Сельвину нужны сердца болотных тварей. Не спрашивай зачем. Шесть штук.',
    type: 'collect', target: 'bogHeart', count: 6,
    xp: 360, gold: 240, item: { kind: 'trinket', tier: 2, rarity: 'rare' },
  },
  {
    id: 'q7', title: 'Ниже уровня земли', giver: 'captain', minLevel: 8,
    desc: 'Спустись в Катакомбы Велории до пятого этажа. Там что-то шевелится, и это не крысы.',
    type: 'depth', target: 5, count: 1,
    xp: 500, gold: 350,
  },
  {
    id: 'q8', title: 'Карга не ждёт', giver: 'captain', minLevel: 10,
    desc: 'Тинная Карга варит что-то в глубине топи. Останови её, пока варево не дошло до города.',
    type: 'boss', target: 'hagBoss', count: 1,
    xp: 900, gold: 620, item: { kind: 'weapon', tier: 3, rarity: 'epic' },
  },
  {
    id: 'q9', title: 'Лич Морвэн', giver: 'captain', minLevel: 12,
    desc: 'На десятом этаже катакомб сидит лич. Он был человеком. Теперь — задача.',
    type: 'boss', target: 'lich', count: 1,
    xp: 1400, gold: 900, item: { kind: 'helm', tier: 3, rarity: 'epic' },
  },
  {
    id: 'q10', title: 'Мёрзлый кряж', giver: 'keeper', minLevel: 13,
    desc: 'Севернее — Мёрзлый кряж. Холод там убивает медленнее, чем его обитатели.',
    type: 'reach', target: 'frost', count: 1,
    xp: 700, gold: 400, item: { kind: 'consumable', key: 'potionM', count: 4 },
  },
  {
    id: 'q11', title: 'Осколки стужи', giver: 'armorer', minLevel: 14,
    desc: 'Мире нужны осколки льда для закалки доспехов. Восемь — и получишь один из них.',
    type: 'collect', target: 'iceShard', count: 8,
    xp: 1100, gold: 700, item: { kind: 'armor', tier: 4, rarity: 'epic' },
  },
  {
    id: 'q12', title: 'Хранитель Стужи', giver: 'captain', minLevel: 16,
    desc: 'Ледяной страж кряжа не пропускает никого дальше перевала. Значит, пойдём через него.',
    type: 'boss', target: 'frostWarden', count: 1,
    xp: 2200, gold: 1400, item: { kind: 'weapon', tier: 4, rarity: 'epic' },
  },
  // ── замер показал провал: между 16-м и 21-м уровнем не было ни одного
  // сюжетного задания — около 88 убийств, которые держали только контракты
  {
    id: 'q15', title: 'Трещины', giver: 'captain', minLevel: 17,
    desc: 'В кряже пошли трещины, и лезущие оттуда твари слишком уж разные. Пять таких голов — Дрейн хочет посмотреть на них сам.',
    type: 'elite', target: null, count: 5,
    xp: 2600, gold: 1500, item: { kind: 'trinket', tier: 4, rarity: 'epic' },
  },
  {
    id: 'q16', title: 'Что-то поднимается', giver: 'captain', minLevel: 19,
    desc: 'Спустись в катакомбы до двенадцатого этажа. Каменщики говорят: кладка там не наша. Значит, чья-то.',
    type: 'depth', target: 12, count: 1,
    xp: 3200, gold: 1800, item: { kind: 'consumable', key: 'potionL', count: 3 },
  },
  {
    id: 'q13', title: 'Тлеющая пустошь', giver: 'keeper', minLevel: 21,
    desc: 'Последние врата ведут в пепел и лаву. Обратной дороги никто не обещал.',
    type: 'reach', target: 'ember', count: 1,
    xp: 1800, gold: 900, item: { kind: 'consumable', key: 'potionL', count: 4 },
  },
  {
    id: 'q14', title: 'Расплавленный Колосс', giver: 'captain', minLevel: 24,
    desc: 'То, что ходит по пустоши, когда-то было горой. Свали её обратно.',
    type: 'boss', target: 'colossus', count: 1,
    xp: 5200, gold: 3600, item: { kind: 'weapon', tier: 6, rarity: 'legendary' },
  },

  // ── Акт II: сюжет обрывался на 24-м уровне, а кривая уровней уходит за 40-й,
  // и у Бездны не было ни строчки объяснения. Здесь и то и другое.
  {
    id: 'q17', title: 'Колосс был не последним', giver: 'captain', minLevel: 25,
    desc: 'Гора свалена, а трещины не закрылись. Дрейн просит спуститься на двадцатый этаж и посчитать, сколько их там.',
    type: 'depth', target: 20, count: 1,
    xp: 5200, gold: 3400, item: { kind: 'consumable', key: 'potionL', count: 4 },
  },
  {
    id: 'q18', title: 'Проба на пустоту', giver: 'alchemist', minLevel: 27,
    desc: 'Сельвин перестал шутить. Ему нужны пять осколков пустоты — говорит, они не отражают свет, и это не свойство камня.',
    type: 'collect', target: 'voidShard', count: 5,
    xp: 5800, gold: 3800, item: { kind: 'helm', tier: 6, rarity: 'epic' },
  },
  {
    id: 'q19', title: 'Хор внизу', giver: 'captain', minLevel: 29,
    desc: 'Тварей под аффиксами стало столько, что гильдия перестала считать. Восемь голов — просто чтобы выдохнуть.',
    type: 'elite', target: null, count: 8,
    xp: 6400, gold: 4200, item: { kind: 'armor', tier: 6, rarity: 'epic' },
  },
  {
    id: 'q20', title: 'Порог', giver: 'keeper', minLevel: 31,
    desc: 'Хранитель врат говорит: за двадцать пятым этажом воздух другой. Дойди до двадцать шестого и вернись — если сможешь.',
    type: 'depth', target: 26, count: 1,
    xp: 7200, gold: 4600, item: { kind: 'trinket', tier: 6, rarity: 'epic' },
  },
  {
    id: 'q21', title: 'Слёзы', giver: 'alchemist', minLevel: 33,
    desc: 'Пять Слёз Бездны. Сельвин называет их так не из красоты: в тепле они мокнут, и вода солёная.',
    type: 'collect', target: 'abyssTear', count: 5,
    xp: 7800, gold: 5000, item: { kind: 'weapon', tier: 6, rarity: 'legendary' },
  },
  {
    id: 'q22', title: 'Пасть Пустоты', giver: 'captain', minLevel: 35,
    desc: 'Первый из тех, кто сторожит глубину. Он не охраняет сокровище — он не пускает наверх.',
    type: 'boss', target: 'voidMaw', count: 1,
    xp: 9000, gold: 6000, item: { kind: 'armor', tier: 6, rarity: 'legendary' },
  },
  {
    id: 'q23', title: 'Полый Государь', giver: 'captain', minLevel: 37,
    desc: 'Второй страж разговаривает. Дрейн просил передать: не отвечай ему.',
    type: 'boss', target: 'hollowKing', count: 1,
    xp: 10000, gold: 6600, item: { kind: 'helm', tier: 6, rarity: 'legendary' },
  },
  {
    id: 'q24', title: 'Дно, которого нет', giver: 'captain', minLevel: 40,
    desc: 'Сорок пятый этаж. Дальше гильдия карт не рисует: Бездна оказалась не местом и не тварью, а направлением. Спускаться можно всегда — вопрос лишь в том, кто вернётся.',
    type: 'depth', target: 45, count: 1,
    xp: 13000, gold: 9000, item: { kind: 'trinket', tier: 6, rarity: 'legendary' },
  },

  // ── Акт III: Пролом.
  //
  // Бездна была направлением вниз; здесь она вышла наружу, и второй акт
  // кончался ровно на этом вопросе. Цепочка ведёт с 40-го по 52-й — и она
  // должна быть тяжелее всего, что было. Тяжесть набрана не числами в награде,
  // а тем, что каждое звено требует своего: щиты не пробить обычным ударом,
  // ловчие уклоняются, титаны держат отбрасывание, а сама земля отнимает
  // здоровье долей от максимума, пока стоишь. Поэтому и `minLevel` идут гуще,
  // чем во втором акте: игрок должен приходить сюда подготовленным, а не
  // добежать по инерции.
  {
    id: 'q25', title: 'Пролом', giver: 'captain', minLevel: 40,
    desc: 'Дрейн больше ничего не просит посчитать. Земля к востоку разошлась, и оттуда идут не твари, а свет. Дойди и посмотри сам.',
    type: 'reach', target: 'breach', count: 1,
    xp: 14000, gold: 9500, item: { kind: 'consumable', key: 'potionL', count: 6 },
  },
  {
    id: 'q26', title: 'Земля тоже кусается', giver: 'keeper', minLevel: 41,
    desc: 'Хранитель врат говорит коротко: у разломов не стой. Порождений там столько, что двадцать голов — это разведка, а не работа.',
    type: 'kill', target: 'voidling', count: 20,
    xp: 15500, gold: 10200, item: { kind: 'boots', tier: 6, rarity: 'epic' },
  },
  {
    id: 'q27', title: 'Бледный пепел', giver: 'alchemist', minLevel: 42,
    desc: 'Шесть горстей пепла из Пролома. Сельвин просит собирать не с земли, а с тварей: то, что лежит, уже мертво дважды.',
    type: 'collect', target: 'paleAsh', count: 6,
    xp: 17000, gold: 11000, item: { kind: 'trinket', tier: 6, rarity: 'epic' },
  },
  {
    id: 'q28', title: 'Ловчие', giver: 'captain', minLevel: 43,
    desc: 'Они уходят от удара чаще, чем попадают под него, и заходят со спины. Четырнадцать — и гильдия перестанет терять разведчиков.',
    type: 'kill', target: 'riftStalker', count: 14,
    xp: 18500, gold: 12000, item: { kind: 'weapon', tier: 6, rarity: 'epic' },
  },
  {
    id: 'q29', title: 'Щит без лица', giver: 'captain', minLevel: 45,
    desc: 'Бледные стражи держат щит спереди и не устают. Десять голов — но заходить придётся иначе, чем ты привык.',
    type: 'kill', target: 'paleWarden', count: 10,
    xp: 20000, gold: 13000, item: { kind: 'armor', tier: 6, rarity: 'legendary' },
  },
  {
    id: 'q30', title: 'Хор, который не поёт', giver: 'alchemist', minLevel: 46,
    desc: 'Полый хор бьёт по звуку и замедляет всё, до чего дотянется. Двенадцать — Сельвин хочет знать, замолчат ли остальные.',
    type: 'kill', target: 'hollowChoir', count: 12,
    xp: 21500, gold: 14000, item: { kind: 'helm', tier: 6, rarity: 'legendary' },
  },
  {
    id: 'q31', title: 'Стекло разлома', giver: 'alchemist', minLevel: 47,
    desc: 'Четыре куска стекла. Оно растёт только на тех, кто ковал в Проломе, и снимать его надо с них.',
    type: 'collect', target: 'riftGlass', count: 4,
    xp: 23000, gold: 15000, item: { kind: 'ring', tier: 6, rarity: 'legendary' },
  },
  {
    id: 'q32', title: 'Титаны', giver: 'captain', minLevel: 48,
    desc: 'Их не сдвинуть и не обойти. Гильдия просит троих — и просит вернуться, а не победить любой ценой.',
    type: 'kill', target: 'riftTitan', count: 3,
    xp: 25000, gold: 16500, item: { kind: 'weapon', tier: 6, rarity: 'legendary' },
  },
  {
    id: 'q33', title: 'Оттуда, где нет дна', giver: 'keeper', minLevel: 50,
    desc: 'Хранитель просит спуститься на пятьдесят пятый и посмотреть вверх. Он думает, что Пролом и Бездна — это одно и то же место с двух сторон.',
    type: 'depth', target: 55, count: 1,
    xp: 27000, gold: 18000, item: { kind: 'trinket', tier: 6, rarity: 'legendary' },
  },
  {
    id: 'q34', title: 'Сердце Пролома', giver: 'captain', minLevel: 52,
    desc: 'Оно не сторожит и не нападает первым — оно держит разлом открытым. Дрейн не говорит «убей». Дрейн говорит: закрой.',
    type: 'boss', target: 'breachHeart', count: 1,
    xp: 34000, gold: 24000, item: { kind: 'armor', tier: 6, rarity: 'legendary' },
  },
];

const BOUNTY_TARGETS = [
  ['forest', ['goblin', 'wolf', 'slime', 'goblinArcher']],
  ['swamp', ['bogling', 'spitter', 'swampWolf', 'leech']],
  ['frost', ['frostWolf', 'iceWraith', 'frostArcher', 'yeti']],
  ['ember', ['imp', 'ashRaven', 'cinderKnight', 'skeleton']],
  ['breach', ['voidling', 'riftStalker', 'paleWarden', 'hollowChoir', 'riftMaw', 'paleSmith']],
];

const BIOME_BOSS = [
  ['forest', 'treant'], ['swamp', 'hagBoss'], ['frost', 'frostWarden'], ['ember', 'colossus'],
  ['breach', 'breachHeart'],
];

const SUPPLY_MATS = [
  ['fang', 'forest'], ['hide', 'forest'], ['slimeGel', 'forest'], ['ironOre', 'forest'],
  ['bogHeart', 'swamp'], ['herbBundle', 'swamp'],
  ['iceShard', 'frost'], ['silverOre', 'frost'],
  ['ember', 'ember'], ['dragonScale', 'ember'], ['boneDust', 'ember'],
  ['paleAsh', 'breach'], ['riftGlass', 'breach'],
];

const unlocked = (biome, player) => (BIOMES[biome].unlockLevel || 1) <= player.level;

/**
 * Виды контрактов. Раньше генератор умел ровно одну форму — «убей N штук», —
 * и весь конец игры сводился к ней. Каждый вид теперь завязан на систему,
 * которую мы построили: элита с аффиксами, стихийные реакции, глубина, кузня.
 *
 * `can` — открыт ли вид игроку. Контракт про реакции бессмыслен тому, кто ещё
 * ни одной не видел, поэтому виды открываются по мере знакомства с системами.
 */
const CONTRACTS = [
  {
    id: 'hunt', weight: 3,
    can: () => true,
    make(rng, player) {
      const pool = BOUNTY_TARGETS.filter(([b]) => unlocked(b, player));
      const [biome, list] = rng.pick(pool.length ? pool : BOUNTY_TARGETS);
      const target = rng.pick(list);
      const count = rng.int(8, 16);
      return {
        title: 'Охота: ' + ENEMIES[target].name,
        dk: 'hunt', biome,
        type: 'kill', target, count, mult: 1,
      };
    },
  },
  {
    id: 'elite', weight: 2,
    can: (player) => player.level >= 8,
    make(rng, player) {
      const count = rng.int(3, 6);
      return {
        title: 'Ловчий', dk: 'elite',
        type: 'elite', target: null, count, mult: 1.9,
      };
    },
  },
  {
    id: 'reaction', weight: 2,
    can: (player) => (player.stats.reactions || 0) > 0,
    make(rng, player) {
      const [key, name] = rng.pick([
        ['corrosion', 'Разъедание'], ['conduction', 'Проводимость'],
        ['steam', 'Пар'], ['shatter', 'Раскол'],
      ]);
      const count = rng.int(6, 12);
      return {
        title: 'Стихийник: ' + name,
        dk: 'reaction', reaction: name,
        type: 'reaction', target: key, count, mult: 1.6,
      };
    },
  },
  {
    id: 'depth', weight: 2,
    can: (player) => (player.deepest || 0) >= 1,
    make(rng, player) {
      const floor = Math.max(5, (player.deepest || 1) + rng.int(2, 5));
      return {
        title: 'Глубина: этаж ' + floor, dk: 'depth',
        type: 'depth', target: floor, count: 1, mult: 1.4 + floor * 0.03,
      };
    },
  },
  {
    id: 'head', weight: 1,
    can: (player) => player.level >= 6,
    make(rng, player) {
      const pool = BIOME_BOSS.filter(([b]) => unlocked(b, player));
      const [biome, key] = rng.pick(pool.length ? pool : BIOME_BOSS);
      return {
        title: 'Голова: ' + ENEMIES[key].name,
        dk: 'head', biome,
        type: 'boss', target: key, count: 1, mult: 2.6,
      };
    },
  },
  {
    id: 'forge', weight: 1,
    can: (player) => player.level >= 6,
    make(rng, player) {
      const count = rng.int(2, 4);
      return {
        title: 'Заказ кузни', dk: 'forge',
        type: 'craft', target: null, count, mult: 1.3,
      };
    },
  },
  {
    id: 'supply', weight: 2,
    can: () => true,
    make(rng, player) {
      const pool = SUPPLY_MATS.filter(([, b]) => unlocked(b, player));
      const [key] = rng.pick(pool.length ? pool : SUPPLY_MATS);
      const count = rng.int(5, 12);
      return {
        title: 'Поставка: ' + ((MATERIALS[key] || {}).name || key),
        dk: 'supply',
        type: 'collect', target: key, count, mult: 0.9,
      };
    },
  },
];

/**
 * Описание контракта собирается при показе, а не при выдаче.
 *
 * Раньше строка склеивалась в `make()` и в готовом виде уходила в сохранение —
 * после смены языка принятый контракт остался бы на прежнем. Теперь в сейве
 * лежит ключ шаблона `dk` и уже имевшиеся поля (цель, биом, счёт), а текст
 * собирается каждый раз заново. Старые сохранения переживают это спокойно:
 * если `dk` нет, показывается сохранённый `desc`.
 */
const DESC = {
  hunt: (q) => t('Гильдия платит за головы. Цель — {a} ({b}), {n} шт.')
    .replace('{a}', t(ENEMIES[q.target].name))
    .replace('{b}', t(BIOMES[q.biome] ? BIOMES[q.biome].name : ''))
    .replace('{n}', q.count),
  elite: (q) => t('Вожаки и элита ходят под аффиксами и бьют иначе. Гильдии нужно {n} таких голов — где возьмёшь, дело твоё.')
    .replace('{n}', q.count),
  reaction: (q) => t('Алхимики гильдии платят за наблюдения. Вызови реакцию «{a}» {n} раз.')
    .replace('{a}', t(q.reaction || '')).replace('{n}', q.count),
  depth: (q) => t('В катакомбах пропала разведка. Спустись до {n}-го этажа и вернись — этого хватит.')
    .replace('{n}', q.target),
  head: (q) => t('{a} снова поднялся в {b}. Гильдия закрывает вопрос.')
    .replace('{a}', t(ENEMIES[q.target].name))
    .replace('{b}', t(BIOMES[q.biome] ? BIOMES[q.biome].name : '').toLowerCase()),
  forge: (q) => t('Борину нужны руки. Выкуй {n} вещи любого вида — гильдия оплатит материалы сверху.')
    .replace('{n}', q.count),
  supply: (q) => t('Склад гильдии пуст. Принеси {n} ед. — «{a}».')
    .replace('{n}', q.count)
    .replace('{a}', t((MATERIALS[q.target] || {}).name || q.target)),
};

export function questDesc(q) {
  const f = q && q.dk && DESC[q.dk];
  if (f) { try { return f(q); } catch { /* повреждённый контракт не должен рушить журнал */ } }
  return (q && q.desc) || '';
}

export class Quests {
  constructor() {
    this.all = QUEST_LINE.map((q) => ({ ...q, progress: 0, state: 'locked' }));
    this.bountySeed = 1;
    this.completedIds = [];
  }

  get active() { return this.all.filter((q) => q.state === 'active'); }
  get available() { return this.all.filter((q) => q.state === 'available'); }
  get finished() { return this.all.filter((q) => q.state === 'done'); }

  /** Открывает задания, доступные по уровню; выдаёт по одной цепочке. */
  refresh(player) {
    for (const q of this.all) {
      if (q.state === 'locked' && player.level >= q.minLevel) q.state = 'available';
    }
    if (player.level < 4) return;
    // Доска растёт по уровню, а не прыгает от одного к трём в момент конца
    // сюжета: раньше приход золота на 25-м уровне утраивался за один шаг.
    const want = player.level >= 26 ? 3 : player.level >= 14 ? 2 : 1;
    let guard = 0;
    while (this.all.filter((q) => q.bounty && (q.state === 'available' || q.state === 'active')).length < want
           && guard++ < 6) {
      this.addBounty(player);
    }
  }

  addBounty(player) {
    const rng = makeRng(this.bountySeed++ * 7717 + player.level * 31);
    // не предлагаем один и тот же вид дважды подряд — иначе доска выглядит одинаково
    const openKinds = new Set(this.all.filter((q) => q.bounty && (q.state === 'available' || q.state === 'active')).map((q) => q.kind));
    let pool = CONTRACTS.filter((c) => c.can(player) && !openKinds.has(c.id));
    if (!pool.length) pool = CONTRACTS.filter((c) => c.can(player));

    // взвешенный выбор: охота встречается чаще, голова босса — реже
    const total = pool.reduce((s2, c) => s2 + c.weight, 0);
    let r = rng() * total, def = pool[pool.length - 1];
    for (const c of pool) { r -= c.weight; if (r <= 0) { def = c; break; } }

    const body = def.make(rng, player);
    const id = 'b' + this.bountySeed;
    const mult = body.mult || 1;
    this.all.push({
      id, giver: 'captain', minLevel: player.level, kind: def.id,
      ...body,
      // Замер показал перекос: контракты давали 47–72% всего опыта и по 37
      // мобов золота за штуку — основной цикл (бить врагов) становился
      // второстепенным. Контракт должен быть добавкой, а не заменой игры:
      // примерно 0,4 уровня опыта и 12–15 мобов золота.
      xp: Math.round((30 * player.level * 0.9 + 80) * mult),
      gold: Math.round((22 * player.level * 0.9 + 50) * mult),
      // чем сложнее контракт, тем чаще он платит вещью и тем она лучше
      item: rng() < 0.3 + mult * 0.18
        ? { kind: rng.pick(['weapon', 'armor', 'helm', 'trinket']),
            rarity: rng() < 0.12 * mult ? 'legendary' : rng() < 0.28 * mult ? 'epic' : 'rare' }
        : null,
      bounty: true, progress: 0, state: 'available',
    });
  }

  accept(q, game) {
    if (q.state !== 'available') return false;
    q.state = 'active';
    audio.play('quest');
    game.toast(`Задание принято: ${q.title}`, '#f0c05a');
    return true;
  }

  onKill(key, game) {
    for (const q of this.active) {
      if ((q.type === 'kill' && q.target === key) || (q.type === 'boss' && q.target === key)) {
        q.progress++;
        if (q.progress >= q.count) this.markReady(q, game);
        else game.toast(`${t(q.title)}: ${q.progress}/${q.count}`, '#9fd8ff', 1.2);
      }
    }
  }

  /** Элита с аффиксом — отдельная добыча, а не просто моб потолще. */
  onEliteKill(game) {
    for (const q of this.active) {
      if (q.type !== 'elite') continue;
      q.progress++;
      if (q.progress >= q.count) this.markReady(q, game);
      else game.toast(`${t(q.title)}: ${q.progress}/${q.count}`, '#f0a03a', 1.2);
    }
  }

  onReaction(key, game) {
    for (const q of this.active) {
      if (q.type !== 'reaction' || q.target !== key) continue;
      q.progress++;
      if (q.progress >= q.count) this.markReady(q, game);
      else game.toast(`${t(q.title)}: ${q.progress}/${q.count}`, '#b8e04a', 1.2);
    }
  }

  onCraft(game) {
    for (const q of this.active) {
      if (q.type !== 'craft') continue;
      q.progress++;
      if (q.progress >= q.count) this.markReady(q, game);
      else game.toast(`${t(q.title)}: ${q.progress}/${q.count}`, '#ffb35e', 1.4);
    }
  }

  onCollect(key, game, player) {
    for (const q of this.active) {
      if (q.type === 'collect' && q.target === key) {
        q.progress = Math.min(q.count, player.countMaterial(key));
        if (q.progress >= q.count) this.markReady(q, game);
      }
    }
  }

  syncCollect(player) {
    for (const q of this.active) {
      if (q.type === 'collect') q.progress = Math.min(q.count, player.countMaterial(q.target));
    }
  }

  onDepth(floor, game) {
    for (const q of this.active) {
      if (q.type === 'depth' && floor >= q.target) { q.progress = 1; this.markReady(q, game); }
    }
  }

  onEnterBiome(id, game) {
    for (const q of this.active) {
      if (q.type === 'reach' && q.target === id) { q.progress = 1; this.markReady(q, game); }
    }
  }

  markReady(q, game) {
    q.progress = q.count;
    q.ready = true;
    audio.play('quest');
    game.toast(`Готово к сдаче: ${q.title}`, '#6fdc8c', 2.4);
  }

  canComplete(q, player) {
    if (q.state !== 'active') return false;
    if (q.type === 'collect') return player.countMaterial(q.target) >= q.count;
    return q.progress >= q.count;
  }

  complete(q, game) {
    const player = game.player;
    if (!this.canComplete(q, player)) return false;
    if (q.type === 'collect') player.consumeMaterial(q.target, q.count);
    q.state = 'done';
    this.completedIds.push(q.id);
    player.gold += q.gold;
    player.gainXp(q.xp, game);
    let rewardItem = null;
    if (q.item) {
      // При полном рюкзаке `addItem` возвращает false и выбрасывает вещь. А
      // задание к этому моменту уже помечено сданным, материалы съедены, и
      // игроку показано «Награда: …». Сюжетные задания не повторяются — вещь
      // терялась навсегда. Рядом это давно сделано правильно: алтарь роняет
      // отказанное на землю. Делаем так же.
      const вручить = (it) => { if (!player.addItem(it) && game && game.spawnLoot) game.spawnLoot(player.x, player.y, { item: it }); };
      if (q.item.kind === 'consumable') {
        for (let i = 0; i < (q.item.count || 1); i++) вручить(makeConsumable(q.item.key, 1));
        rewardItem = { name: makeConsumable(q.item.key, 1).name, rarity: 'common' };
      } else {
        const it = makeItem({
          kind: q.item.kind, tier: q.item.tier, rarity: q.item.rarity,
          level: Math.max(1, player.level), luck: 3,
        });
        вручить(it);
        rewardItem = it;
      }
    }
    audio.play('level');
    game.onQuestComplete(q, rewardItem);
    this.refresh(player);
    return true;
  }

  progressText(q, player) {
    if (q.type === 'collect') return `${Math.min(q.count, player.countMaterial(q.target))}/${q.count}`;
    if (q.type === 'reach') return q.progress ? 'выполнено' : 'не посещено';
    if (q.type === 'depth') return `${player.deepest}/${q.target} этаж`;
    return `${Math.min(q.progress, q.count)}/${q.count}`;
  }

  targetName(q) {
    if (q.type === 'kill' || q.type === 'boss') return ENEMIES[q.target] ? ENEMIES[q.target].name : q.target;
    if (q.type === 'collect') return MATERIALS[q.target] ? MATERIALS[q.target].name : q.target;
    if (q.type === 'reach') return BIOMES[q.target] ? BIOMES[q.target].name : q.target;
    if (q.type === 'depth') return 'этаж ' + q.target;
    return '';
  }

  toJSON() {
    return {
      bountySeed: this.bountySeed,
      completedIds: this.completedIds,
      list: this.all.map((q) => ({ id: q.id, state: q.state, progress: q.progress, ready: q.ready, bounty: q.bounty, data: q.bounty ? q : null })),
    };
  }

  fromJSON(d) {
    if (!d) return;
    this.bountySeed = d.bountySeed || 1;
    this.completedIds = d.completedIds || [];
    for (const rec of d.list || []) {
      let q = this.all.find((x) => x.id === rec.id);
      if (!q && rec.data) { q = { ...rec.data }; this.all.push(q); }
      if (!q) continue;
      q.state = rec.state;
      q.progress = rec.progress || 0;
      q.ready = rec.ready;
    }
  }
}
