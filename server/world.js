// Мир комнаты: то, что сервер считает сам.
//
// Ключевая мысль всей затеи: здесь нет второго движка. Зона строится тем же
// генератором, что у клиента, враги — те же `Enemy`, столкновения — тот же
// `world/collide.js`. Разойтись правилам негде, потому что правило одно.
//
// Врагам от «игры» нужен объект с десятком полей и методов — тот самый, что был
// набросан заглушкой в проверке безголовой сборки. Здесь он доведён до
// настоящего. Эффектам (частицы, тряска, всплывающие числа) на сервере делать
// нечего: они пустышки, потому что никто не смотрит.

import { installHeadless } from '../src/core/headless.js';

installHeadless();

const { initProps } = await import('../src/art/props.js');
const { bakeAllMonsters } = await import('../src/art/sprites.js');
const { generateBiomeZone, zoneSeedFor } = await import('../src/world/zone.js');
const { populateZone, respawnOne, makeBoss, makeAmbush } = await import('../src/world/populate.js');
const { generateCity } = await import('../src/world/city.js');
const { generateDungeon } = await import('../src/world/dungeon.js');
const { Enemy } = await import('../src/entities/enemies.js');
const collide = await import('../src/world/collide.js');
const { Player } = await import('../src/entities/player.js');
const { reviveItem, WEAPON_PROFILE } = await import('../src/systems/items.js');
const { rollDrops } = await import('../src/systems/loot.js');
const { swingHits, resolveHit, aoeTargets, skillRoll } = await import('../src/systems/combat.js');
const { markDamageMult, tryShatter } = await import('../src/systems/reactions.js');
const { angle } = await import('../src/core/util.js');

let baked = false;
/** Запечь графику один раз: без неё генератор не знает габаритов реквизита. */
export function prepareArt() {
  if (baked) return;
  initProps();
  bakeAllMonsters();
  baked = true;
}

/**
 * Сколько игрового времени игрок может держать «про запас».
 *
 * Нужно, чтобы дрожание сети не резало движение: пакеты приходят неровно, и без
 * запаса герой спотыкался бы на каждой задержке. Больше четверти секунды копить
 * нельзя — иначе накопленное превращается в рывок вперёд.
 */
const BUDGET_CAP = 0.25;

const NOOP = () => {};
const NULL_FX = { add: NOOP, burst: NOOP, ring: NOOP, spawn: NOOP, update: NOOP };

// Возрождение.
//
// Срок выбран замером: один охотник кладёт 0,43 врага в секунду, значит за 45 с
// он «должен» комнате два десятка — половину биома. Меньше половины населения
// зона не проседает, пока охотник один. Стенды поднимают комнату с коротким
// сроком (`RESPAWN_SEC`), чтобы прогон не длился минутами.
//
// Рядом с живым игроком возрождение откладывается — но не бесконечно. Иначе
// достаточно встать в лагере у тела, чтобы держать кусок общего мира пустым для
// всех остальных. Ждём не дольше двух сроков.
// Виды оружия берём из самих правил, а не переписываем сюда: список в двух
// местах — это будущее расхождение.
const ВИДЫ_ОРУЖИЯ = new Set(Object.keys(WEAPON_PROFILE));
/** Число из чужих рук: только конечное и только в границах, иначе своё. */
const чис = (v, min, max, свой) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : свой;
};

const RESPAWN = Math.max(1, Number(process.env.RESPAWN_SEC) || 45);
const RESPAWN_NEAR = 120;
const RESPAWN_MAX_WAIT = RESPAWN * 2;
// Страж — событие, а не поголовье: возвращается вчетверо реже и только когда в
// арену снова вошли. Появиться в упор ему можно и нужно — за этим и идут.
const BOSS_RESPAWN = RESPAWN * 4;
// Добыча: сколько она своя, сколько лежит вообще и с какого расстояния берётся.
const LOOT_MINE = 60;
const LOOT_LIFE = 300;
const PICKUP_R = 26;
// Совместный бой.
//
// Замер до этой работы: двое били одного монстра, первый снял 52 из 78 здоровья
// — две трети работы, — второй добил тремя ударами. Весь опыт, весь ход задания
// и обе выпавшие вещи ушли добившему. Помогавший не получил ничего и при этом
// видел чужую добычу лежащей у себя под ногами.
//
// Это не перекос баланса, это устройство встречи: при таком правиле другой
// игрок в общем мире — конкурент, а не подмога, и весь смысл общего мира
// пропадает.
//
// Участие живёт полминуты: успел вернуться — доля твоя, ушёл надолго — нет.
// Порог в двадцатую долю здоровья отсекает «задел и побежал мимо».
const УЧАСТИЕ_ЖИВЁТ = 30;
const ДОЛЯ_УЧАСТИЯ = 0.05;
// А вот на вещи порог другой — доля от всего нанесённого, а не от здоровья.
//
// Со стражем это разница между наградой и печатным станком: с него гарантированно
// падает снаряжение, гарантированно руна и ещё две вещи сверх того. Двадцать
// учёток, каждая на 5% его здоровья, — это двадцать полных комплектов из одного
// босса за цикл возрождения. При доле в десятую получателей не больше десяти, и
// каждый из них сделал настоящую десятую часть работы.
const ДОЛЯ_ВЕЩЕЙ = 0.10;
// Что попадает в снимок игрока. Мир видно 480×270 — берём полтора экрана по
// диагонали, чтобы входящее в кадр появлялось заранее.
const ВИДНО = 420;
// Сколько игроков попадает в снимок. Больше на экране всё равно не разобрать,
// а вес растёт линейно с каждым.
const В_СНИМКЕ = 24;



export class World {
  constructor(opts = {}) {
    prepareArt();
    this.kind = opts.kind || 'city';
    this.biomeId = opts.id || null;
    this.floor = opts.floor || 1;
    this.seed = opts.seed >>> 0 || 1;

    // Сид считает общее правило `zoneSeedFor`: две формулы уже однажды дали две
    // разные зоны на одну комнату, и снимок начал ссылаться в пустоту.
    // Модификатор этажа — часть места: `generateDungeon` подмешивает его в сид,
    // и без него комната строила другое подземелье, чем клиент.
    this.modKey = opts.mod || 'none';
    this.zone = this.kind === 'city' ? generateCity(zoneSeedFor(this.seed, 'city'))
      : this.kind === 'dungeon' ? generateDungeon(this.floor, zoneSeedFor(this.seed, 'dungeon'), this.modKey)
      : generateBiomeZone(this.biomeId, zoneSeedFor(this.seed, 'biome', this.biomeId));

    this.time = 0;
    this.players = new Map();      // pid → сущность
    this.enemies = [];
    this.projectiles = [];
    // Опасности местности комната пока не считает, но список ей нужен: реакция
    // «пар» (systems/reactions.js) кладёт сюда облако, а метки оружия комната
    // вешает сама — значит «Пылающий ледяной» меч запускает пар прямо здесь.
    // Без поля это был `TypeError` посреди взмаха: часть целей урон получила,
    // остальные нет, а откат уже выставлен.
    this.hazards = [];
    this.loot = [];
    this.nextLid = 1;
    this.dirty = false;   // персонажей есть что записать
    // Что случилось за такт: попадания, промахи, смерти. Клиент по ним играет
    // зрелище — искры и числа, — а решает всё равно сервер.
    this.events = [];

    // пустышки для эффектов: врагам они нужны, серверу — нет
    this.particles = NULL_FX;
    this.floats = NULL_FX;
    this.shake = { add: NOOP, update: NOOP };

    // Заселяет общее правило. Раньше комната строила врагов коротко и не
    // давала элитам свойств: в общем мире страж «логова вожака» выходил
    // обыкновенным, хотя в одиночной игре он с щитом или яростью.
    // Номер врага — тот, под которым он родился, как и у клиента. Снимок
    // ссылается по нему; у стража и засадных он уже был, а у населения нет —
    // держалось на том, что место в списке и номер пока совпадают.
    for (const e of populateZone(this.zone, this.seed, this.населениеOpts())) {
      e.nid = this.enemies.length;
      this.enemies.push(e);
    }

    // `player` — то, на кого смотрит ИИ. Врагов писали под одного героя, и
    // читают они именно это поле. Перед ходом каждого врага сюда кладётся
    // ближайший к нему живой игрок: так старый ИИ работает с любым числом
    // игроков без единой правки. Заменить на честный выбор цели — отдельная
    // задача про правила коопа.
    this.player = null;
    this.bossSlot = null;     // место стража в списке; появляется при первом входе в арену
  }

  // ── то, чем пользуется ИИ врагов
  solidAt(x, y) { return collide.solidAt(this.zone, x, y); }
  hasLineOfSight(a, b) { return collide.hasLineOfSight(this.zone, a, b); }
  nearestEnemy(x, y, r, skip) { return collide.nearestEnemy(this.enemies, x, y, r, skip); }
  moveEntity(e, dt, c = true) { collide.moveEntity(this.zone, e, dt, c); }
  canBeAt(x, y, w, h, fly) { return collide.canBeAt(this.zone, x, y, w, h, fly); }
  /**
   * Урон по врагу — теперь по-настоящему, и по тем же правилам.
   *
   * Здесь нет второй боевой системы: сколько дойдёт до цели, считает
   * `resolveHit` из `systems/combat.js` — та же функция, что у клиента и у
   * стендов. Расходятся не правила, расходятся копии; копии здесь нет.
   *
   * Осталось только последствие: здоровье, ярость, отбрасывание, смерть.
   * Зрелище — числа, искры, звук — на сервере некому смотреть, и его нет.
   */
  damageEnemy(e, amount, opts = {}) {
    if (!e || e.dead) return 0;
    const atk = opts.by || this.player;
    const hit = resolveHit(atk, e, amount, opts, Math.random, markDamageMult);
    if (hit.dodged) { this.events.push({ t: 'dodge', i: this.enemies.indexOf(e) }); return 0; }
    if (hit.blocked) { e.blockT = 0.22; opts.knock = (opts.knock || 0) * 0.15; }

    const dmg = hit.dmg;
    e.hp -= dmg;
    e.hurtT = 0.16;
    if (!e.aggro) { e.aggro = true; e.wakePack(this); }
    if (atk && atk.stats) atk.stats.dmgDealt += dmg;
    this.записатьВклад(e, atk, dmg, opts);

    if (opts.knock && opts.from) {
      const a = angle(opts.from.x, opts.from.y, e.x, e.y);
      e.vx += Math.cos(a) * opts.knock * (e.knockRes || 1);
      e.vy += Math.sin(a) * opts.knock * (e.knockRes || 1);
    }

    // Оружейные метки и вампиризм — тоже правила, а не украшение: от них
    // зависит, сколько врагу жить. Считаем их здесь же.
    if (atk && !opts.silent) {
      const g = atk.gear || {};
      const ls = atk.lifesteal || 0;
      if (ls) { const h = dmg * ls / 100; if (h >= 0.5) atk.heal(h); }
      if (g.burn) e.applyEffect('burn', 3, g.burn * 0.5, this);
      if (g.poison) e.applyEffect('poison', 4, g.poison * 0.5, this);
      if (g.slow) e.applyEffect('slow', 2.5, 1, this);
    }

    this.events.push({ t: 'hit', i: this.enemies.indexOf(e), d: dmg, c: !!opts.crit, b: hit.blocked });
    // Добившим считается только тот, кто правда ударил.
    //
    // `atk` — это `opts.by || this.player`, а `this.player` перед ходом каждого
    // врага становится **ближайшим** игроком, безо всякого предела по
    // расстоянию. Одиночка в биоме ближайший ко всем сорока врагам сразу — и
    // любая смерть, пришедшая не от удара (тик горения, самоподрыв смертника,
    // его же осколки по своим), назначала добившим его. Оговорка в
    // `записатьВклад` закрывала только карту вклада, а этот путь шёл мимо неё.
    const бивший = opts.by || ((opts.dot || opts.silent) ? null : this.player);
    if (e.hp <= 0) this.killEnemy(e, бивший);
    return dmg;
  }

  /**
   * Запомнить, кто сколько нанёс.
   *
   * Урон «по следу» — метки, реакции, шипы — участия не создаёт, только
   * продолжает своё. Наносит-то его не тот, кто бил, а тот, кто в этот момент
   * ближе всех: DoT тикает внутри `e.update`, а туда перед ходом кладётся
   * ближайший игрок. Без этой оговорки прохожий, оказавшийся рядом с чужим
   * горящим врагом, становился бы участником, не ударив ни разу.
   */
  записатьВклад(e, atk, dmg, opts = {}) {
    if (!atk || atk.pid === undefined || atk.pid === null || !(dmg > 0)) return;
    const м = e._вклад || (e._вклад = new Map());
    const з = м.get(atk.pid);
    if (!з && (opts.dot || opts.silent)) return;
    if (з) { з.урон += dmg; з.когда = this.time; }
    else м.set(atk.pid, { урон: dmg, когда: this.time });
  }

  /**
   * Кто дрался с этим врагом — и с какой долей.
   *
   * Добивший в списке всегда: последний удар мог быть первым и единственным, и
   * остаться без награды за собственное убийство он не должен. Ушедшие из
   * комнаты не в счёт — начислять некому.
   */
  участники(e, добивший) {
    const порог = Math.max(1, (e.maxHp || 1) * ДОЛЯ_УЧАСТИЯ);
    const вклад = e._вклад;
    const бойцы = [];
    for (const [pid, з] of вклад || []) {
      const p = this.players.get(pid);
      if (!p) continue;                                     // вышел из комнаты
      if (this.time - з.когда > УЧАСТИЕ_ЖИВЁТ) continue;    // это было давно
      // Быть при этом. Иначе довольно задеть на пороге биома и уйти за экран:
      // добыча всё равно упадёт у трупа, до которого не дойти, а опыт и ход
      // задания начислятся ни за что. Радиус тот же, что у снимка: дальше него
      // игрок этого боя уже не видит.
      if ((p.x - e.x) ** 2 + (p.y - e.y) ** 2 > ВИДНО * ВИДНО) continue;
      // Добивший проходит и с малой долей: последний удар мог быть первым и
      // единственным, а порог считается от здоровья врага.
      if (з.урон < порог && p !== добивший) continue;
      бойцы.push({ p, урон: з.урон });
    }
    // Добившего дописываем, только если он правда бил.
    //
    // Безусловная приписка была дырой: `добивший` — это `by || this.player`, а
    // урон «по следу» (горение, яд, реакция) приходит вообще без `by`, и тогда
    // `this.player` — просто ближайший к трупу. Прохожий, оказавшийся рядом с
    // чужим горящим врагом в миг его смерти, получал полную награду, не ударив
    // ни разу. Настоящему бойцу приписка и не нужна: его удар записан в
    // `_вклад` прямо перед этим, в том же `damageEnemy`.
    if (добивший && добивший.pid !== undefined && вклад && вклад.has(добивший.pid)
        && !бойцы.some((б) => б.p === добивший)
        && (добивший.x - e.x) ** 2 + (добивший.y - e.y) ** 2 <= ВИДНО * ВИДНО) {
      бойцы.push({ p: добивший, урон: вклад.get(добивший.pid).урон });
    }
    return бойцы;
  }

  /**
   * Смерть врага — и делёж между всеми, кто его бил.
   *
   * Правило делится надвое, и граница проходит по тому, что уже измерено.
   *
   * **Опыт и ход задания — полные каждому.** Делёж наказывал бы за игру вместе:
   * двое качались бы вдвое медленнее, чем поодиночке. И зафиксированный замер
   * темпа («8–19 убийств на уровень», README) от этого не съезжает ни на
   * сколько: совместное убийство — это по одному убийству каждому.
   *
   * **Золото — по доле вклада.** Кран мира остаётся ровно таким, каким его
   * подобрал сквозной замер экономики с 5-го по 40-й уровень: с одного врага
   * выходит один враг золота, сколько бы человек его ни били. Полный кошелёк
   * каждому был бы печатным станком, линейным по числу участников.
   *
   * **Вещи — свой бросок каждому, кто сделал десятую часть работы.** Это и есть
   * плата за то, чтобы драться вместе, и общей кучи, за которую дерутся, здесь
   * не возникает: добыча именная. Порог нужен против толпы, набежавшей на
   * готовое: без него достаточно тычка на пять процентов, чтобы получить полный
   * комплект со стража.
   */
  killEnemy(e, by) {
    if (e.dead) return;
    e.dead = true; e.deadT = 0; e.hp = 0;

    // Никакого «а если некому — возьмём ближайшего»: не ударил — не добивал.
    const добивший = by || null;
    const бойцы = this.участники(e, добивший);
    const всего = бойцы.reduce((s, б) => s + б.урон, 0) || 1;
    const былПлеер = this.player;

    for (const { p, урон } of бойцы) {
      // `gainXp` зовёт `onLevelUp`, а тот смотрит в `this.player`: без подмены
      // о взятом уровне узнал бы не тот, кто его взял.
      this.player = p;
      p.kills = (p.kills || 0) + 1;
      if (e.boss && p.stats) p.stats.bossKills++;
      // Ход задания — от настоящего убийства, а не от слова клиента. Крючки те
      // же, что зовёт одиночная игра; журнал ведёт комната.
      if (this.book) {
        if (e.elite && !e.boss) this.book.событие(p, 'onEliteKill');
        this.book.событие(p, 'onKill', e.key);
      }
      // Опыт начисляет сервер: до сих пор его считал клиент и присылал слепком.
      // Уровень — это доступ к биомам и множитель на всё, и верить в нём на
      // слово нельзя.
      if (p.gainXp) p.gainXp(e.xpValue || 0, this);
      const доля = урон / всего;
      this.dropLoot(e, p, доля, доля >= ДОЛЯ_ВЕЩЕЙ);
    }
    this.player = былПлеер;

    e._вклад = null;
    this.dirty = true;
    e._вернётся = this.time + (e.boss ? BOSS_RESPAWN : RESPAWN);
    e._крайний = this.time + RESPAWN_MAX_WAIT;   // дольше держать пусто не даём
    // `by` — кто добил, `w` — все, кому засчитано. Клиент по второму понимает,
    // что награда его, даже если последний удар был чужим.
    this.events.push({
      t: 'kill', i: this.enemies.indexOf(e),
      by: добивший && добивший.pid !== undefined ? добивший.pid : null,
      w: бойцы.map((б) => б.p.pid),
    });
  }

  /**
   * Возрождение.
   *
   * Мир один на всех, и без этого первый прошедший вычищает биом навсегда:
   * замер — биом пустеет за 1,5–3,5 минуты, а населения в нём около сорока.
   * Срок выбран по этому же замеру: один охотник кладёт 0,43 врага в секунду,
   * значит за 45 с он «должен» комнате два десятка — половину биома. Меньше
   * половины населения зона не проседает, пока охотник один.
   *
   * На глазах никто не воскресает: если рядом живой игрок, срок отодвигается.
   * Враг рождается тем же правилом, что и при заселении, и на своём месте —
   * иначе номер в снимке начал бы означать другое существо.
   */
  respawnDue() {
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e || !e.dead || !e._вернётся || this.time < e._вернётся) continue;
      if (e.boss) continue;                       // стража ведёт `bossTrigger`
      if (e.pack === 'ambush') continue;          // засаду ведёт `ambushTrigger`
      if (this.time < (e._крайний || 0)) {
        let рядом = false;
        for (const p of this.players.values()) {
          if (p.dead) continue;
          if ((p.x - e.x) ** 2 + (p.y - e.y) ** 2 < RESPAWN_NEAR ** 2) { рядом = true; break; }
        }
        if (рядом) { e._вернётся = this.time + 2; continue; }
      }
      // Довод тот же, что при заселении: без него вернувшийся выходит обычным.
      // Замер: на «Укреплении» броня 0,4 → 0, а платит игрок за порчу полной
      // ценой. Соседние два места в этом же файле передавали его правильно —
      // забыли ровно здесь.
      const свежий = respawnOne(this.zone, this.seed, i, this.населениеOpts());
      if (!свежий) { e._вернётся = 0; continue; }
      свежий.nid = i;
      this.enemies[i] = свежий;
      this.events.push({ t: 'spawn', i });
    }
  }

  summonAdds() {}
  shockwave() {}

  /**
   * Урон по площади — общими правилами, а не пустышкой.
   *
   * Зовут его легендарки на крючке `hurt` («Ледяное сердце»), а `hurt` комната
   * действительно проигрывает. Метода не было вовсе, и такт падал целиком при
   * каждом ударе по герою в такой броне. Пустышкой закрывать нельзя: это
   * правило боя, и у клиента оно уже есть — вышло бы расхождение урона.
   */
  aoeDamage(x, y, r, dmg, opts = {}) {
    const hit = aoeTargets(this.enemies, x, y, r);
    for (const e of hit) this.applySkillHit(e, dmg, opts, x, y);
    return hit.length;
  }

  applySkillHit(e, dmg, opts, sx, sy) {
    const { crit, amount } = skillRoll(this.player, e, dmg, opts, Math.random);
    this.damageEnemy(e, amount, { crit, heavy: opts.heavy, knock: opts.knock, from: { x: sx, y: sy } });
    if (opts.effect) e.applyEffect(opts.effect[0], opts.effect[1], opts.effect[2], this);
    if (opts.stun) e.stun = Math.max(e.stun || 0, opts.stun * (e.boss ? 0.35 : 1));
    tryShatter(this, e, amount, opts.heavy);
  }

  /**
   * Срабатывания легендарок.
   *
   * Комната этого не умела вовсе, и первый же удар монстра по игроку ронял
   * такт целиком: `takeDamage` зовёт `game.proc`, а его не было. Найдено в
   * логе сервера, а не стендом — стенд видел только «мир не восстановился».
   *
   * Это правила, а не украшение: свойства лечат, бьют и снимают откаты. Кого
   * задело — тот и в `this.player`: перед ходом каждого врага туда кладётся
   * ближайший игрок, и бьёт враг именно его.
   */
  proc(hook, ctx) {
    const p = this.player;
    if (!p || !p.uniques) return;
    for (const u of p.uniques(hook)) if (u.run) u.run(this, ctx || {});
  }

  /**
   * Смерть игрока в общем мире.
   *
   * Плата та же, что и в одиночной игре — двенадцатая часть золота, — а вот
   * экрана смерти здесь нет: мир общий и живёт дальше. Герой поднимается на
   * точке входа через пять секунд.
   */
  onPlayerDeath() {
    const p = this.player;
    if (!p) return;
    const плата = Math.floor((p.gold || 0) * 0.12);
    p.gold = Math.max(0, (p.gold || 0) - плата);
    p._встанет = this.time + 5;
    this.events.push({ t: 'pdeath', pid: p.pid, gold: плата });
  }

  /**
   * Страж места.
   *
   * До сих пор его рождал клиент: в общем мире это значило, что у каждого свой
   * босс, которого сервер не видит, не считает и не проверяет — а с него падают
   * лучшие вещи в биоме. Теперь рождает комната, по тому же порогу входа в
   * арену, и он один на всех, кто там стоит.
   */
  bossTrigger() {
    const z = this.zone;
    if (!z.boss) return;
    const e = this.bossSlot !== null && this.bossSlot !== undefined ? this.enemies[this.bossSlot] : null;
    if (e && !e.dead) return;                       // уже стоит
    if (e && this.time < (e._вернётся || 0)) return;  // ещё не срок
    const r = z.bossArena ? z.bossArena.r : 130;
    let вошли = false;
    for (const p of this.players.values()) {
      if (p.dead) continue;
      if ((p.x - z.boss.x) ** 2 + (p.y - z.boss.y) ** 2 <= r * r) { вошли = true; break; }
    }
    if (!вошли) return;
    const b = makeBoss(z);
    if (!b) return;
    if (e) { b.nid = this.bossSlot; this.enemies[this.bossSlot] = b; }
    else { this.bossSlot = this.enemies.length; b.nid = this.bossSlot; this.enemies.push(b); }
    this.events.push({ t: 'boss', i: b.nid });
  }

  /**
   * Засады из лагерей.
   *
   * Их тоже рождал клиент — и это было хуже, чем «у каждого свои»: комната о
   * таком отряде не знает, в снимке его нет, а клиент хоронит всё, чего в
   * снимке нет, — с добычей и опытом. Подошёл к лагерю в общем мире и получил
   * награду за отряд, которого никто не видел.
   */
  ambushTrigger() {
    for (const ev of this.zone.events || []) {
      if (ev.kind !== 'ambush') continue;

      // Лагерь взводится заново: иначе первый прошедший забирает его у всех
      // навсегда — та же беда, что была с населением. Считаем срок от гибели
      // последнего и только после этого снова ждём гостей.
      if (ev.done) {
        const свои = (ev._номера || []).map((i) => this.enemies[i]);
        if (!свои.length || свои.some((e) => e && !e.dead)) continue;
        if (!ev._взведётся) { ev._взведётся = this.time + RESPAWN; continue; }
        if (this.time < ev._взведётся) continue;
        ev.done = false; ev._взведётся = 0;
      }

      let вошли = false;
      for (const p of this.players.values()) {
        if (p.dead) continue;
        if ((p.x - ev.x) ** 2 + (p.y - ev.y) ** 2 <= ev.r * ev.r) { вошли = true; break; }
      }
      if (!вошли) continue;
      ev.done = true;
      const отряд = makeAmbush(this.zone, ev);
      // Места в списке у лагеря свои и постоянные: занимать новые на каждый
      // налёт значило бы растить список вечно, а номер — это то, чем снимок
      // ссылается на существо.
      if (!ev._номера) {
        ev._номера = [];
        for (const e of отряд) { e.nid = this.enemies.length; this.enemies.push(e); ev._номера.push(e.nid); }
      } else {
        отряд.forEach((e, k) => {
          const i = ev._номера[k];
          if (i === undefined) { e.nid = this.enemies.length; this.enemies.push(e); ev._номера.push(e.nid); }
          else { e.nid = i; this.enemies[i] = e; }
        });
      }
      this.events.push({ t: 'ambush', x: Math.round(ev.x), y: Math.round(ev.y), n: отряд.length });
    }
  }

  /**
   * Уронить добычу с убитого — по общему правилу и с хозяином.
   *
   * До сих пор комната не роняла ничего: добычу решал клиент, а рюкзак
   * присылал он же. Измерено: настоящая учётка попросила легендарку с атакой
   * 9999 и девять миллионов золота — сервер положил это в базу и вернул при
   * входе. Теперь падает здесь, лежит здесь и попадает в рюкзак только через
   * `pickup`.
   *
   * Своё у каждого: вещь видит и поднимает только тот, кому она выпала, и так
   * до самого её исчезновения.
   *
   * Раньше через минуту добыча становилась общей — «иначе добыча ушедшего
   * лежала бы вечно». С именной добычей у этого правила не осталось смысла, а
   * вред появился: при N участниках у одного трупа лежит N кучек, и достаточно
   * подождать минуту, чтобы собрать чужие. Невзятое просто истлевает (`until`),
   * и это честнее.
   *
   * Зовут это по разу на каждого участника боя, а не один раз на убитого. Сид
   * броска поэтому включает и того, кому катим: без этого все участники в один
   * такт получали бы одно и то же — не свой бросок, а копию чужого.
   *
   * @param {number} [доляЗолота=1] — сколько золота из броска оставить: доля
   *   вклада. Кран мира от этого не зависит от числа бьющих.
   * @param {boolean} [сВещами=true] — класть ли вещи. Ложь для тех, чья доля
   *   ниже `ДОЛЯ_ВЕЩЕЙ`: золото им причитается, комплект со стража — нет.
   */
  dropLoot(e, by, доляЗолота = 1, сВещами = true) {
    const выпало = rollDrops(e, {
      zone: this.zone, corr: 0, ce: null,
      level: (by && by.level) || 1,
      seed: (e.x * 31 + e.y * 17 + this.time * 1000 + (by && by.pid ? by.pid * 7919 : 0)) | 0,
    });
    const доля = Number.isFinite(доляЗолота) ? Math.max(0, Math.min(1, доляЗолота)) : 1;
    for (const д of выпало) {
      const золото = д.gold ? Math.max(1, Math.round(д.gold * доля)) : 0;
      const вещь = сВещами ? (д.item || null) : null;
      if (!золото && !вещь) continue;
      const a = Math.random() * Math.PI * 2;
      this.loot.push({
        lid: this.nextLid++, x: e.x + Math.cos(a) * 10, y: e.y + Math.sin(a) * 10,
        gold: золото, item: вещь,
        owner: by && by.pid !== undefined ? by.pid : null,
        until: this.time + LOOT_LIFE,
      });
    }
  }

  /**
   * Положить вещь на землю.
   *
   * Нужен наградам, которым не хватило места в рюкзаке: в одиночной игре они
   * падают под ноги, и в общем мире должно быть так же — иначе сюжетная вещь
   * пропадёт навсегда.
   *
   * Хозяина называют явно, а не берут из `this.player`. Во-первых, внутри
   * `killEnemy` это поле по очереди становится каждым участником. Во-вторых,
   * журнал заданий разговаривает с комнатой через `Object.create(world)`, и
   * `this.nextLid++` на таком объекте читает число по прототипу, а записывает
   * своё собственное поле: счётчик комнаты не двигался, и две награды подряд
   * получали один и тот же номер. Вторую после этого не поднять — `pickup`
   * находит по номеру первую.
   *
   * @param {object} [кому] — чья вещь. Без него — ничья, её возьмёт любой.
   */
  spawnLoot(x, y, data, кому) {
    const a = Math.random() * Math.PI * 2;
    const хозяин = кому || this.player;
    this.loot.push({
      lid: this.nextLid++, x: x + Math.cos(a) * 8, y: y + Math.sin(a) * 8,
      gold: data.gold || 0, item: data.item || null,
      owner: (хозяин && хозяин.pid) ?? null,
      until: this.time + LOOT_LIFE,
    });
  }

  /**
   * Поднять лежащее. Проверяем всё, о чём клиент мог соврать: что вещь есть,
   * что она рядом и что она его.
   */
  pickup(pid, lid) {
    const p = this.players.get(pid);
    if (!p || p.dead) return;
    const i = this.loot.findIndex((l) => l.lid === (lid | 0));
    if (i < 0) return;
    const l = this.loot[i];
    if (l.owner !== null && l.owner !== pid) return;                          // чужая
    if ((p.x - l.x) ** 2 + (p.y - l.y) ** 2 > PICKUP_R * PICKUP_R) return;    // не дотянуться
    if (l.gold) {
      p.gold = (p.gold || 0) + l.gold;
    } else if (l.item) {
      if (!p.addItem(l.item)) return;      // рюкзак полон — вещь остаётся лежать
    }
    this.loot.splice(i, 1);
    this.dirty = true;
    this.bagChanged = true;      // комната пришлёт хозяину свежий рюкзак
    // Иконка — нарисованный холст с круговой ссылкой на свой контекст.
    // `JSON.stringify` на таком бросает, и падает не одно сообщение, а вся
    // рассылка такта: снимка не получает никто в комнате. Клиент рисует иконку
    // сам — по виду, рангу и редкости.
    const вещь = l.item ? { ...l.item, icon: undefined } : null;
    this.events.push({ t: 'took', pid, lid: l.lid, gold: l.gold || 0, item: вещь });
  }

  /**
   * Взятый уровень.
   *
   * Опыт теперь считает комната, а значит и уровень берётся здесь — и `gainXp`
   * зовёт `onLevelUp`, которого у комнаты не было. Нашлось не в лесу, а в
   * Проломе: там страж даёт столько опыта, что уровень берут прямо с него, и
   * такт падал ровно на убийстве босса. Тот же случай, что и с `proc`.
   *
   * Правило — очки развития и полное здоровье — уже отработал сам `gainXp`.
   * Здесь остаётся сказать об этом клиенту: зрелище играет он.
   */
  onLevelUp(n) {
    const p = this.player;
    if (!p) return;
    this.events.push({ t: 'level', pid: p.pid, lvl: p.level, n });
  }

  /**
   * Реакции стихий.
   *
   * Комната сама вешает метки оружия в `damageEnemy`, а вторая метка на цели
   * запускает реакцию — и та зовёт `bolt` с `onReaction`, которых у комнаты не
   * было. Значит, герою с двумя стихиями на оружии хватило бы одного боя,
   * чтобы уронить такт. Нашёл это не бой и не браузер, а список: стенд
   * `room-surface-check` сверяет всё, что сущности просят у «игры», с тем, что
   * комната умеет.
   *
   * Урон и метки реакция уже нанесла сама, общими правилами. Здесь остаётся
   * счётчик и слово клиенту — вспышку и звук играет он.
   */
  bolt() { /* молния между целями — зрелище, смотреть некому */ }

  onReaction(e, key) {
    const p = this.player;
    if (p && p.stats) p.stats.reactions = (p.stats.reactions || 0) + 1;
    if (p && this.book) this.book.событие(p, 'onReaction', key);
    this.events.push({ t: 'react', i: this.enemies.indexOf(e), k: key, pid: p ? p.pid : null });
  }

  /**
   * Задание сдано.
   *
   * Зрелище — баннер и звук — играет клиент по ответу комнаты. Здесь метод
   * нужен затем же, зачем `proc` и `onLevelUp`: журнал зовёт его на сдаче, и
   * без него падал бы весь путь. Третий раз одна и та же дыра.
   */
  onQuestComplete() {}

  /**
   * Строка игроку. На сервере смотреть некому, но метод обязан быть: журнал
   * зовёт его на каждом шаге задания. Тому, кто ведёт журнал, `toast` подменяют
   * на сбор строк — а этот остаётся для всех остальных случаев.
   */
  toast() {}

  /** Поднять павших: мир общий, лежать в нём некому и незачем. */
  raiseDead() {
    const sp = this.zone.spawnPoint || { x: 100, y: 100 };
    for (const p of this.players.values()) {
      if (!p.dead || this.time < (p._встанет || 0)) continue;
      p.dead = false; p.deadT = 0; p.pose = 'idle';
      p.hp = p.maxHp; p.mp = p.maxMp;
      p.x = sp.x; p.y = sp.y; p.vx = 0; p.vy = 0;
      p.iframe = 2;
      this.events.push({ t: 'praise', pid: p.pid, x: sp.x, y: sp.y });
    }
  }

  // ── игроки
  /**
   * Игрок в комнате — настоящий `Player`, а не выдуманная запись.
   *
   * Раньше здесь лежала заглушка с зашитой скоростью 64.25 и сотней здоровья.
   * Для героя 35-го уровня в сапогах на ловкость это уже неправда, и сверка
   * предсказания срабатывала на трети вводов: клиент двигал героя своей
   * физикой, сервер — выдуманной. Теперь сервер собирает того же самого героя
   * из сохранения тем же классом и тем же `fromJSON`, что и клиент.
   */
  addPlayer({ pid, name, address, look, character }) {
    const sp = this.zone.spawnPoint || { x: 100, y: 100 };
    const p = new Player(sp.x, sp.y);
    if (character && character.player) {
      try { p.fromJSON(character.player, reviveItem); } catch { /* битое сохранение — играем новым */ }
    }
    p.x = sp.x; p.y = sp.y; p.vx = 0; p.vy = 0;
    p.dead = false;
    p.hp = Math.max(1, Math.min(p.hp || p.maxHp, p.maxHp));

    p.pid = pid; p.name = name; p.address = address;
    p.input = { mx: 0, my: 0, f: 0 };
    p.seq = 0;              // номер последнего учтённого ввода — для сверки
    // Внешность объявляет клиент. «Косметическая, врать ей нечем» — неправда:
    // она уходит в каждый снимок каждому игроку двадцать раз в секунду, и
    // непроверенное поле превращает одно сообщение при входе в постоянный
    // поток. Берём только известные поля и только в границах.
    const свой = {
      armorTier: p.equipment.armor ? p.equipment.armor.tier : 0,
      weaponTier: p.weaponLook ? p.weaponLook() : 0,
      weaponType: p.equipment.weapon ? p.equipment.weapon.sub : 'sword',
      cape: p.level >= 10,
    };
    p.look = look && typeof look === 'object' ? {
      armorTier: чис(look.armorTier, 0, 7, свой.armorTier),
      weaponTier: чис(look.weaponTier, 0, 7, свой.weaponTier),
      weaponType: ВИДЫ_ОРУЖИЯ.has(look.weaponType) ? look.weaponType : свой.weaponType,
      cape: !!look.cape,
    } : свой;
    this.players.set(pid, p);
    return p;
  }

  removePlayer(pid) {
    this.players.delete(pid);
    // Вклад ушедшего убираем сразу. `участники` его и так отсеет — игрока нет в
    // комнате, — но карта висела бы на враге до самой его смерти, а врага могут
    // и не убить за всё время жизни комнаты.
    for (const e of this.enemies) if (e && e._вклад) e._вклад.delete(pid);
  }

  /**
   * Ввод — намерение, а не положение. Клиент говорит «иду туда», сервер решает,
   * дошёл ли. Именно поэтому здесь принимается вектор от −1 до 1, а не x и y:
   * иначе игрок мог бы просто прислать координату посреди стены.
   */
  /**
   * Ввод — список сделанных шагов, а не «где я сейчас».
   *
   * Клиент присылает ровно те шаги, которые проиграл сам, с их dt; сервер их
   * повторяет. Так предсказание сходится точно: обе стороны считают одну и ту
   * же последовательность, а не одну и ту же формулу с разным шагом.
   *
   * Шаги ограничены и по длине, и по суммарному времени за такт: иначе прислать
   * «я шёл десять секунд» можно было бы каждые пятьдесят миллисекунд, и это
   * готовый ускоритель. Сервер соглашается отыграть не больше, чем прошло на
   * его собственных часах, с небольшим запасом на дрожание сети.
   */
  applyInput(pid, msg) {
    const p = this.players.get(pid);
    if (!p || p.dead) return;
    if (Number.isFinite(msg.f)) p.input.f = msg.f;
    if (Number.isFinite(msg.seq)) p.seq = msg.seq;

    const steps = Array.isArray(msg.s) ? msg.s : null;
    if (!steps || !steps.length) return;

    // ── ведро времени
    //
    // Первая версия давала надбавку на каждое сообщение: «сколько прошло, плюс
    // пятьдесят миллисекунд про запас». Проверка показала, что так проходит
    // ускоритель в два с половиной раза — достаточно слать сообщения почаще, и
    // надбавка набегает быстрее реального времени. За секунду поддельный клиент
    // прошёл 153 пикселя вместо 64.
    //
    // Правильно — копить бюджет по настоящим часам и тратить из него. Сколько
    // времени прошло, столько игры и можно отыграть; запас ограничен сверху,
    // чтобы дрожание сети не резало движение, но и не копилось часами.
    const now = Date.now();
    const elapsed = Math.max(0, (now - (p.lastInputAt || now)) / 1000);
    p.lastInputAt = now;
    p.budget = Math.min(BUDGET_CAP, (p.budget || 0) + elapsed);

    for (const st of steps.slice(0, 60)) {
      // `|| 0` не отсеивает Infinity — а JSON.parse честно даёт его из 1e400.
      // Дальше stepMove делит Infinity на Infinity, координаты становятся NaN
      // и не чинятся уже никогда: damp(NaN) = NaN на каждом честном шаге. В
      // комнате это замораживает всех врагов — ближайшего игрока не выбрать,
      // сравнение с NaN всегда ложно.
      const mx = Number(st[0]), my = Number(st[1]);
      let dt = Number(st[2]);
      if (!Number.isFinite(mx) || !Number.isFinite(my) || !Number.isFinite(dt)) continue;
      if (!(dt > 0)) continue;
      dt = Math.min(dt, 1 / 20);          // один шаг не длиннее пятидесяти миллисекунд
      if (p.budget <= 0) { p.throttled = (p.throttled || 0) + 1; break; }
      dt = Math.min(dt, p.budget);
      p.budget -= dt;
      collide.stepMove(this.zone, p, mx, my, p.moveSpeed, dt);
    }
    // Последний рубеж: в снимок и в расчёты не должно уйти нечисло, откуда бы
    // оно ни взялось — из ввода, из скорости или из слепка персонажа.
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      const sp = this.zone.spawnPoint || { x: 100, y: 100 };
      p.x = sp.x; p.y = sp.y; p.vx = 0; p.vy = 0;
    }
    p.facing = p.input.f;
  }

  step(dt) {
    this.time += dt;
    this.respawnDue();
    this.bossTrigger();
    this.ambushTrigger();
    this.raiseDead();
    // Лежалое убираем: иначе список растёт всё время жизни комнаты.
    for (let i = this.loot.length - 1; i >= 0; i--) if (this.time > this.loot[i].until) this.loot.splice(i, 1);

    // Опасности местности — облака пара от реакций и лужи от правил оружия.
    // Комната их проигрывает, а срок им не вычитал никто: список только
    // пополнялся и не убывал никогда. У клиента это делает отрисовка, которой
    // здесь нет, — значит делать надо тут.
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      if (!h) { this.hazards.splice(i, 1); continue; }
      h.life = (h.life ?? 0) - dt;
      if (h.life <= 0) this.hazards.splice(i, 1);
    }

    // Игроков такт не двигает: они двигаются в `applyInput`, ровно теми шагами,
    // которые проиграл клиент. Здесь остаются только враги — у них своё время.

    for (const e of this.enemies) {
      // `!e` — не перестраховка: `восстановить` записывает бойцов лагеря по их
      // прежним номерам, и если номер больше длины списка, между концом и им
      // остаётся дырка. Такая дырка роняла весь такт комнаты на первом же ходу.
      if (!e || e.dead) continue;
      this.player = this.nearestPlayerTo(e);
      if (!this.player) continue;      // некому — враг стоит
      e.update(dt, this);
    }

    // Снаряды. Их клали в список и не трогали больше никогда: список рос всё
    // время жизни комнаты (у городской — вечно), а стрелки и заклинатели в
    // общем мире не наносили урона вовсе — снаряд висел в точке рождения.
    // Урон снаряд наносит ровно в своём `update`, значит без него правило боя
    // расходилось с одиночной игрой.
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      // Снаряд бьёт `game.player` — здесь это тот, к кому он ближе всего.
      this.player = pr.friendly ? this.player : this.nearestPlayerTo(pr);
      if (!this.player) { this.projectiles.splice(i, 1); continue; }
      pr.update(dt, this);
      if (pr.dead) this.projectiles.splice(i, 1);
    }
  }

  nearestPlayerTo(e) {
    let best = null, bd = Infinity;
    for (const p of this.players.values()) {
      if (p.dead) continue;
      const d = (p.x - e.x) ** 2 + (p.y - e.y) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /**
   * Взмах игрока. Клиент присылает намерение, попадания считает сервер.
   *
   * До сих пор клиент решал сам, кого задело и на сколько, а серверу присылал
   * готовый слепок героя. Это и значило «сейф, а не источник правды»: подделать
   * можно было всё — урон, добычу, уровень. Теперь клиент говорит только
   * «махнул, вот куда смотрю и какой это удар в связке», а `swingHits` —
   * та же функция, что рисует дугу у клиента, — отвечает, кого достало.
   *
   * Откат проверяем здесь же: без него связку можно слать хоть каждый кадр.
   */
  swing(pid, msg) {
    const p = this.players.get(pid);
    if (!p || p.dead) return;
    if (this.time < (p._swingUntil || 0)) return;       // ещё не отмахнулся
    p._swingUntil = this.time + Math.max(0.08, p.attackRate * 0.92);

    if (Number.isFinite(msg.f)) p.facing = msg.f;
    const combo = Math.max(0, Math.min(2, msg.combo | 0));
    this.player = p;                                    // ИИ и правила смотрят сюда
    const hits = swingHits(p, this.enemies, { combo, time: this.time });
    for (const h of hits) {
      this.damageEnemy(h.enemy, h.dmg, {
        crit: h.crit, knock: h.knock, from: p, heavy: h.heavy, by: p,
      });
    }
    this.events.push({ t: 'swing', pid, combo, f: +p.facing.toFixed(2), n: hits.length });
  }

  /** Снимок для рассылки. Пока JSON и целиком — ужмём, когда станет тесно. */
  /**
   * Снимок мира — для конкретного игрока.
   *
   * Раньше он был один на комнату и уходил всем целиком. Замер показал, во что
   * это обходится: при пятидесяти в городе снимок весит 8756 байт, наружу
   * уходит 67 Мбит/с, а на каждого — 172 КБ/с, то есть десять мегабайт в
   * минуту на телефон. И растёт это квадратом: каждый новый игрок попадает в
   * снимок каждого.
   *
   * Поэтому шлём только то, что рядом. Мир видно 480×270; берём с запасом на
   * полтора экрана, чтобы входящее в кадр появлялось заранее, а не выпрыгивало
   * из края.
   *
   * @param {object} [кому] — игрок, которому шлём. Без него — весь мир: так
   *   удобно стендам, и так же строится слепок для проверок.
   */
  /**
   * Что со стражем места.
   *
   * Спуск на боссовом этаже заперт до его смерти, а замок снимает только
   * событие убийства. Пришёл на этаж, где страж уже убит и ждёт возвращения, —
   * и спуск заперт стражем, которого на этаже нет. Клиенту надо это спросить, а
   * спросить было нечего.
   */
  стражСостояние() {
    if (!this.zone.boss) return { есть: false, побеждён: false, через: 0 };
    const e = this.bossSlot !== null && this.bossSlot !== undefined ? this.enemies[this.bossSlot] : null;
    if (!e) return { есть: true, побеждён: false, через: 0 };      // ещё не будили
    if (!e.dead) return { есть: true, побеждён: false, через: 0 }; // стоит
    return { есть: true, побеждён: true, через: Math.max(0, Math.round((e._вернётся || 0) - this.time)) };
  }

  /** Имя и внешность игрока: то, что не меняется и шлётся один раз. */
  кто(pid) {
    const p = this.players.get(pid);
    return p ? { pid: p.pid, name: p.name, lvl: p.level, look: p.look } : null;
  }

  /**
   * Забрать события такта.
   *
   * Отдельно от снимка нарочно: снимков теперь по одному на игрока, и если
   * выгребать очередь внутри, первый же заберёт всё, а остальные не увидят
   * ни своего попадания, ни своей смерти.
   */
  takeEvents() {
    return this.events.splice(0, this.events.length);
  }

  snapshot(кому) {
    const рядом = кому
      ? (x, y) => (x - кому.x) ** 2 + (y - кому.y) ** 2 <= ВИДНО * ВИДНО
      : () => true;
    return {
      // Имя и внешность в снимок не кладём: они не меняются, а уезжали
      // двадцать раз в секунду. Замер: из 8878 байт при полусотне игроков
      // `look` занимал 3550, имя — ещё 940. Половина рассылки на то, что можно
      // сказать один раз. Кто есть кто, комната говорит отдельно (`кто`).
      //
      // Толпу режем по числу: ближайших столько, сколько имеет смысл рисовать.
      // Полсотни человек на площади в снимке у каждого — это квадрат от числа
      // игроков, и никакие области интереса тут не помогут: город меньше
      // полутора экранов.
      players: [...this.players.values()]
        .filter((p) => p === кому || рядом(p.x, p.y))
        // Без адресата порядок и число не трогаем: `snapshot()` без довода —
        // это весь мир, им пользуются стенды. Сортировка по расстоянию до
        // `кому` в этом случае лезла в undefined и роняла снимок целиком.
        .sort((a, b) => (!кому ? 0 : a === кому ? -1 : b === кому ? 1 :
          ((a.x - кому.x) ** 2 + (a.y - кому.y) ** 2) - ((b.x - кому.x) ** 2 + (b.y - кому.y) ** 2)))
        .slice(0, кому ? В_СНИМКЕ : Infinity)
        .map((p) => ({
          pid: p.pid,
          // Десятая доля пикселя вместо целых: округление до целого само по
          // себе давало сверке до полутора пикселей ошибки на ровном месте —
          // герой подёргивался, стоя неподвижно. Лишний знак дешевле дрожи.
          x: +p.x.toFixed(1), y: +p.y.toFixed(1),
          vx: +p.vx.toFixed(1), vy: +p.vy.toFixed(1),
          f: +p.facing.toFixed(2), hp: Math.round(p.hp), mhp: p.maxHp,
          lvl: p.level,
          ...(p === кому ? { seq: p.seq } : null),
        })),
      // Индекс врага — его место в общем списке, а не в отфильтрованном:
      // события ссылаются именно на него, и после первой же смерти нумерация
      // отфильтрованного списка разъехалась бы с ними.
      // Для тех, кого комната дописала по ходу игры — страж, засада, — несём
      // ещё и уровень: население зоны клиент восстанавливает по номеру общим
      // правилом, а этих по номеру не восстановить, они появились не из
      // описания зоны.
      enemies: this.enemies.map((e, i) => (!e || e.dead || !рядом(e.x, e.y) ? null : (i < this.zone.spawns.length ? {
        i, k: e.key, x: Math.round(e.x), y: Math.round(e.y),
        hp: Math.round(e.hp), mx: Math.round(e.maxHp),
      } : {
        i, k: e.key, x: Math.round(e.x), y: Math.round(e.y),
        hp: Math.round(e.hp), mx: Math.round(e.maxHp), lv: e.level,
      }))).filter(Boolean),
      // Снаряды тоже общие: пока комната их не показывала, а урон уже считала,
      // игрок получал бы удары от невидимых стрел — в сетевой игре клиент
      // врагов не обновляет и снарядов не порождает.
      shots: this.projectiles.filter((pr) => !pr.dead && рядом(pr.x, pr.y)).slice(0, 60).map((pr) => ({
        x: Math.round(pr.x), y: Math.round(pr.y),
        c: pr.color, c2: pr.color2, s: pr.size, g: pr.glow,
      })),
      // Добыча именная: видно ровно то, что можно поднять.
      //
      // Раньше видно было всё, а поднять первую минуту мог только хозяин — и
      // помогавший смотрел, как под ногами лежат две вещи с убитого им же
      // монстра, которые нельзя взять. Правило видимости теперь буквально то
      // же, что в `pickup`: своё или ничьё. Заодно и легче: чужие вещи в снимок
      // не попадают вовсе.
      //
      // Вещь целиком не шлём: до поднятия клиенту хватает вида и редкости, а
      // полное описание он получит вместе с ней.
      loot: this.loot
        .filter((l) => рядом(l.x, l.y) && (!кому || l.owner === null || l.owner === кому.pid))
        .slice(0, 120).map((l) => ({
          i: l.lid, x: Math.round(l.x), y: Math.round(l.y),
          g: l.gold || 0,
          k: l.item ? l.item.kind : null, r: l.item ? l.item.rarity : null,
          o: l.owner,
        })),

    };
  }

  /**
   * Чем заселять зону. У подземелья это порча этажа — тот же довод, что
   * клиент кладёт в `this._население`.
   */
  населениеOpts() {
    return this.kind === 'dungeon' ? { mod: this.zone.mod || null } : {};
  }

  /**
   * Слепок возрождения — чтобы мир не начинался заново, когда все вышли.
   *
   * Комната пустеет и сносится (зона занимает около мегабайта), а вместе с ней
   * пропадали сроки павших, срок стража и взведённость лагерей. Одному игроку
   * хватало выйти в город и вернуться, чтобы получить полный биом и живого
   * стража сразу. Слепок весит байты и переживает снос.
   *
   * Времена храним как «сколько осталось», а не как момент: у новой комнаты
   * свои часы, они начинаются с нуля.
   */
  слепокВозрождения() {
    const павшие = [];
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e || !e.dead || !e._вернётся) continue;
      павшие.push([i, Math.max(0, e._вернётся - this.time), Math.max(0, (e._крайний || 0) - this.time)]);
    }
    const лагеря = (this.zone.events || [])
      .filter((ev) => ev.kind === 'ambush' && ev.done)
      .map((ev) => [Math.round(ev.x), Math.round(ev.y), ev._номера || [], Math.max(0, (ev._взведётся || 0) - this.time)]);
    // Срок стража — отдельным числом, а не строкой в `павшие`.
    //
    // В `павшие` он и попадал, но по своему номеру, а номер у него всегда за
    // концом населения зоны: страж дописывается в список при первом входе в
    // арену. В новой комнате такого места ещё нет, `восстановить` не находил
    // врага и молча проходил мимо. Итог: выйти в город и вернуться — и страж
    // стоит снова, сколько бы времени ни прошло. Лучшие вещи биома падали по
    // требованию.
    const б = this.bossSlot !== null && this.bossSlot !== undefined ? this.enemies[this.bossSlot] : null;
    const страж = б && б.dead && б._вернётся ? Math.max(0, б._вернётся - this.time) : 0;
    return { павшие, лагеря, страж: this.bossSlot, стражЧерез: страж };
  }

  /** Принять слепок возрождения от прошлой жизни этой же комнаты. */
  восстановить(сл) {
    if (!сл) return;
    for (const [i, через, крайний] of сл.павшие || []) {
      const e = this.enemies[i];
      if (!e) continue;
      e.dead = true; e.hp = 0; e.deadT = 0;
      e._вернётся = this.time + через;
      e._крайний = this.time + крайний;
    }
    for (const [x, y, номера, через] of сл.лагеря || []) {
      const ev = (this.zone.events || []).find((o) => o.kind === 'ambush' && Math.round(o.x) === x && Math.round(o.y) === y);
      if (!ev) continue;
      ev.done = true;
      ev._номера = номера;
      ev._взведётся = через ? this.time + через : 0;
      // Отряд лагеря в новой комнате ещё не рождался: держим места занятыми
      // мёртвыми, чтобы номера означали то же самое.
      const свежие = makeAmbush(this.zone, ev);
      номера.forEach((i, k) => {
        if (this.enemies[i]) return;
        const b = свежие[k];
        if (!b) return;
        b.nid = i; b.dead = true; b.hp = 0;
        this.enemies[i] = b;
      });
    }
    // Страж: своё место в списке и свой срок.
    //
    // Место занимаем мёртвым — иначе `bossTrigger` увидит пустоту, решит, что
    // стража не было вовсе, и поднимет его при первом же входе в арену.
    if (сл.страж !== null && сл.страж !== undefined) {
      this.bossSlot = сл.страж;
      if (!this.enemies[this.bossSlot] && this.zone.boss) {
        const b = makeBoss(this.zone);
        if (b) {
          b.nid = this.bossSlot; b.dead = true; b.hp = 0; b.deadT = 0;
          b._вернётся = this.time + (сл.стражЧерез || 0);
          this.enemies[this.bossSlot] = b;
        }
      }
    }
    // Дырки в списке — та самая беда, из-за которой такт падал целиком: номера
    // лагерей и стража идут за концом населения, и между концом и ними
    // оставались пустые места. Затыкаем настоящим существом, а не пустышкой:
    // по списку ходят и правила боя, и ИИ, и им нужен обычный `Enemy`. Оно
    // мёртвое и без срока возвращения, значит не оживёт и никого не тронет.
    for (let i = 0; i < this.enemies.length; i++) {
      if (this.enemies[i]) continue;
      const b = respawnOne(this.zone, this.seed, 0, this.населениеOpts());
      if (!b) continue;
      b.nid = i; b.dead = true; b.hp = 0; b.deadT = 0; b._вернётся = 0; b._крайний = 0;
      this.enemies[i] = b;
    }
  }

  /** Что клиент должен знать, чтобы построить ту же зону у себя. */
  describe() {
    return { kind: this.kind, id: this.biomeId, floor: this.floor, seed: this.seed,
             name: this.zone.name, w: this.zone.w, h: this.zone.h,
             spawn: this.zone.spawnPoint, enemies: this.enemies.length,
             respawn: RESPAWN, respawnNear: RESPAWN_NEAR, respawnMax: RESPAWN_MAX_WAIT };
  }
}
