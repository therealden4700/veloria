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
    if (e.hp <= 0) this.killEnemy(e, atk);
    return dmg;
  }

  killEnemy(e, by) {
    if (e.dead) return;
    e.dead = true; e.deadT = 0; e.hp = 0;
    const p = by || this.player;
    if (p) {
      p.kills = (p.kills || 0) + 1;
      if (e.boss && p.stats) p.stats.bossKills++;
      // Опыт начисляет сервер: до сих пор его считал клиент и присылал слепком.
      // Уровень — это доступ к биомам и множитель на всё, и верить в нём на
      // слово нельзя.
      if (p.gainXp) p.gainXp(e.xpValue || 0, this);
    }
    this.dropLoot(e, p);
    this.dirty = true;
    e._вернётся = this.time + (e.boss ? BOSS_RESPAWN : RESPAWN);
    e._крайний = this.time + RESPAWN_MAX_WAIT;   // дольше держать пусто не даём
    this.events.push({ t: 'kill', i: this.enemies.indexOf(e), by: p ? p.pid : null });
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
      const свежий = respawnOne(this.zone, this.seed, i, {});
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
   * Своё у каждого: вещь видит и поднимает тот, кто убил. Через минуту она
   * становится общей — иначе добыча ушедшего лежала бы вечно.
   */
  dropLoot(e, by) {
    const выпало = rollDrops(e, {
      zone: this.zone, corr: 0, ce: null,
      level: (by && by.level) || 1,
      seed: (e.x * 31 + e.y * 17 + this.time * 1000) | 0,
    });
    for (const д of выпало) {
      const a = Math.random() * Math.PI * 2;
      this.loot.push({
        lid: this.nextLid++, x: e.x + Math.cos(a) * 10, y: e.y + Math.sin(a) * 10,
        gold: д.gold || 0, item: д.item || null,
        owner: by ? by.pid : null, ничей: this.time + LOOT_MINE, until: this.time + LOOT_LIFE,
      });
    }
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
    if (l.owner !== null && l.owner !== pid && this.time < l.ничей) return;   // ещё чужая
    if ((p.x - l.x) ** 2 + (p.y - l.y) ** 2 > PICKUP_R * PICKUP_R) return;    // не дотянуться
    if (l.gold) {
      p.gold = (p.gold || 0) + l.gold;
    } else if (l.item) {
      if (!p.addItem(l.item)) return;      // рюкзак полон — вещь остаётся лежать
    }
    this.loot.splice(i, 1);
    this.dirty = true;
    this.events.push({ t: 'took', pid, lid: l.lid, gold: l.gold || 0, item: l.item || null });
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
    this.events.push({ t: 'react', i: this.enemies.indexOf(e), k: key, pid: p ? p.pid : null });
  }

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

  removePlayer(pid) { this.players.delete(pid); }

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

    // Игроков такт не двигает: они двигаются в `applyInput`, ровно теми шагами,
    // которые проиграл клиент. Здесь остаются только враги — у них своё время.

    for (const e of this.enemies) {
      if (e.dead) continue;
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
  snapshot() {
    return {
      players: [...this.players.values()].map((p) => ({
        pid: p.pid, name: p.name,
        // Десятая доля пикселя вместо целых: округление до целого само по себе
        // давало сверке до полутора пикселей ошибки на ровном месте — герой
        // подёргивался, стоя неподвижно. Лишний знак в снимке дешевле дрожи.
        x: +p.x.toFixed(1), y: +p.y.toFixed(1),
        vx: +p.vx.toFixed(1), vy: +p.vy.toFixed(1),
        f: +p.facing.toFixed(2), hp: Math.round(p.hp), mhp: p.maxHp,
        lvl: p.level, seq: p.seq, look: p.look,
      })),
      // Индекс врага — его место в общем списке, а не в отфильтрованном:
      // события ссылаются именно на него, и после первой же смерти нумерация
      // отфильтрованного списка разъехалась бы с ними.
      // Для тех, кого комната дописала по ходу игры — страж, засада, — несём
      // ещё и уровень: население зоны клиент восстанавливает по номеру общим
      // правилом, а этих по номеру не восстановить, они появились не из
      // описания зоны.
      enemies: this.enemies.map((e, i) => (e.dead ? null : (i < this.zone.spawns.length ? {
        i, k: e.key, x: Math.round(e.x), y: Math.round(e.y),
        hp: Math.round(e.hp), mx: Math.round(e.maxHp),
      } : {
        i, k: e.key, x: Math.round(e.x), y: Math.round(e.y),
        hp: Math.round(e.hp), mx: Math.round(e.maxHp), lv: e.level,
      }))).filter(Boolean),
      // Снаряды тоже общие: пока комната их не показывала, а урон уже считала,
      // игрок получал бы удары от невидимых стрел — в сетевой игре клиент
      // врагов не обновляет и снарядов не порождает.
      shots: this.projectiles.filter((pr) => !pr.dead).slice(0, 60).map((pr) => ({
        x: Math.round(pr.x), y: Math.round(pr.y),
        c: pr.color, c2: pr.color2, s: pr.size, g: pr.glow,
      })),
      // Добыча — часть общего мира: её видно всем, но поднять первую минуту
      // может только хозяин. Вещь целиком не шлём: до поднятия клиенту хватает
      // вида и редкости, а полное описание он получит вместе с ней.
      loot: this.loot.slice(0, 120).map((l) => ({
        i: l.lid, x: Math.round(l.x), y: Math.round(l.y),
        g: l.gold || 0,
        k: l.item ? l.item.kind : null, r: l.item ? l.item.rarity : null,
        o: l.owner, m: +(l.ничей - this.time).toFixed(1),
      })),
      ev: this.events.splice(0, this.events.length),
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
    return { павшие, лагеря, страж: this.bossSlot };
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
    if (сл.страж !== null && сл.страж !== undefined) this.bossSlot = сл.страж;
    for (const [x, y, номера, через] of сл.лагеря || []) {
      const ev = (this.zone.events || []).find((o) => o.kind === 'ambush' && Math.round(o.x) === x && Math.round(o.y) === y);
      if (!ev) continue;
      ev.done = true;
      ev._номера = номера;
      ev._взведётся = через ? this.time + через : 0;
      // Отряд лагеря в новой комнате ещё не рождался: держим места занятыми
      // мёртвыми, чтобы номера означали то же самое.
      for (const i of номера) if (!this.enemies[i]) { const b = makeAmbush(this.zone, ev)[номера.indexOf(i)]; if (b) { b.nid = i; b.dead = true; b.hp = 0; this.enemies[i] = b; } }
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
