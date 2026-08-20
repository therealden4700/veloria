// Ядро игры: мир, бой, переходы между зонами, взаимодействия, сохранение.

import { input } from './core/input.js';
import { t, getLang, setLang } from './core/i18n.js';
import { beginUI } from './ui/stage.js';
import { uiText } from './ui/type.js';
import { audio, TRACKS } from './core/audio.js';
import { profiler } from './core/profiler.js';
import * as store from './core/save.js';
import { saveGame, loadGame, hasSave, wipeSave, recordDepth, loadOptions, saveOptions } from './core/save.js';
import { clamp, dist, dist2, angle, angDiff, damp, TAU, rectHit, inArc, fmt, dirFromVec } from './core/util.js';
import { makeRng } from './core/rng.js';

import { TILE, T, drawLiquidShimmer } from './art/tiles.js';
import { canBeAt, moveEntity, solidAt, hasLineOfSight, nearestEnemy } from './world/collide.js';
const shortenAddr = (a) => (a && a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : a || 'Странник');
import { net } from './core/net.js';
import { swingHits, resolveHit, aoeTargets, lineTargets, skillRoll, hazardTargets, hazardHitsPlayer, boltSpec } from './systems/combat.js';
import { getWallet, isSignedIn, getToken, isVerified, getCharacter, pushCharacter } from './core/wallet.js';
import { serverWsUrl } from './core/server-url.js';
import { bakeHero } from './art/sprites.js';
import { PROPS, itemIcon } from './art/props.js';
import { windAt } from './art/wind.js';
import { Particles, FloatText, Lighting, Weather, Shake, Bloom, vignette, grade, toneGrade, haze } from './art/fx.js';
import { text } from './art/text.js';
import { UI, RARITY, RARITY_ORDER, rgba, RAMP } from './art/palette.js';
import { glow, silhouette, makeCanvas } from './art/pixel.js';

import { Player, emptyBoon } from './entities/player.js';
import { Enemy, Projectile, ENEMIES } from './entities/enemies.js';

import { generateCity, NPC_DEFS } from './world/city.js';
import { generateBiomeZone, zoneSeedFor } from './world/zone.js';
import { populateZone, respawnOne } from './world/populate.js';
import { buildPacks } from './systems/packs.js';
import { generateDungeon, isBossFloor } from './world/dungeon.js';
import { BIOMES, OVERWORLD } from './world/biomes.js';

import { makeItem, makeConsumable, makeMaterial, makeRune, rollRune, rollShopStock, rollRarity, dropRarity, capRarity, raiseRarity, fuseCost, runeGroups, MATERIALS, CONSUMABLES, reviveItem } from './systems/items.js';
import { SKILLS, PASSIVES, skillDamage } from './systems/skills.js';
import { Quests } from './systems/quests.js';
import { runReaction, tryShatter, markDamageMult, MARKS, REACTIONS } from './systems/reactions.js';
import { corruptionOf, corruptionEffects, corruptionName, ABYSS_START } from './systems/abyss.js';
import { nextLesson, LESSON_BY_KEY, LESSONS, LESSON_GAP } from './systems/lessons.js';
import { toggleFullscreen, isFullscreen } from './core/screen.js';
import { abyssUniquesFor, breachUniquesFor } from './systems/uniques.js';
import { rollDrops } from './systems/loot.js';
import { canAfford, craftItem, salvageYield, reforgeCost, sharpenChance, sharpenCost,
         sharpenFuel, applySharpen, matName, SHARP_MAX,
         sharpFloor, revertToMilestone } from './systems/craft.js';
import { UNIQUES, SETS } from './systems/uniques.js';
import { FLOOR_MODS, ALTARS, rollDoors } from './systems/dungeon_mods.js';

import { Hud } from './ui/hud.js';
import { Menus } from './ui/menus.js';

// направление «солнца»: наклон, сжатие и плотность тени
// Замер показал, почему мир выглядел плоским: направленная тень задевала всего
// 4,1% кадра и темнила его на 6%. Тень была, но её не было видно. Здесь она
// длиннее, плотнее и с мягким краем — предметы наконец стоят на земле, а не
// лежат на ней наклейками.
const SUN_OUT = { sk: -0.62, sq: 0.46, a: 0.40 };
const SUN_DUN = { sk: -0.12, sq: 0.24, a: 0.30 };


export class Game {
  constructor(ctx, view, uictx) {
    this.ctx = ctx;
    // Интерфейс рисуется вторым слоем, в настоящем разрешении экрана. Мир
    // остаётся пиксельным: смешивать их в одном канвасе нельзя — либо текст
    // грубый, либо спрайты мыльные.
    this.uictx = uictx || ctx;
    this.view = view;
    this.input = input;
    this.time = 0;
    this.state = 'title';

    this.player = new Player();
    this.quests = new Quests();
    this.particles = new Particles();
    this.floats = new FloatText();
    this.lighting = new Lighting(view.w, view.h);
    this.bloom = new Bloom(view.w, view.h);
    this.weather = new Weather();
    this.shake = new Shake();
    this.hud = new Hud(view);
    this.menus = new Menus(view, this);

    this.enemies = [];
    this.projectiles = [];
    this.loot = [];
    this.decals = [];
    this.slashes = [];
    this.hazards = [];

    this.cam = { x: 0, y: 0, w: view.w, h: view.h };
    this.zone = null;
    this.zoneCache = new Map();
    this.prompt = null;
    this.aimByMouse = false;
    this.transition = null;
    // настройки читаются до первого звука: контекст ещё не создан, но audio
    // запомнит значения и применит их в init()
    const opt = loadOptions();
    this.audioMuted = !!opt.muted;
    audio.setMuted(this.audioMuted);
    audio.setVolume(typeof opt.volume === 'number' ? opt.volume : 1);
    if (typeof opt.music === 'number') audio.setMusicVolume(opt.music);
    if (typeof opt.sfx === 'number') audio.setSfxVolume(opt.sfx);
    if (opt.lang) setLang(opt.lang);

    this.hasSave = hasSave();
    this.seenLessons = {};
    this.corruption = 0;
    this.worldSeed = (Math.random() * 1e9) | 0;
    this.deathPenalty = 0;
    this.autosaveT = 0;
    this.shopSeed = 1;

    this.menus.mode = 'title';

    // мышь двигалась — целимся мышью
    addEventListener('mousemove', () => { this.aimByMouse = true; });
    addEventListener('keydown', (e) => {
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) this.aimByMouse = false;
    });
  }

  // ════════════════════════════ жизненный цикл

  newGame() {
    wipeSave();
    this.player = new Player();
    this.quests = new Quests();
    this.seenLessons = {};   // обучение начинается заново вместе с персонажем
    this.hud.lessons.length = 0;
    this.worldSeed = (Math.random() * 1e9) | 0;
    this.zoneCache.clear();
    // стартовый набор
    this.player.equip(makeItem({ kind: 'weapon', sub: 'sword', tier: 0, rarity: 'common', level: 1 }));
    this.player.equip(makeRune('whirl', 'common', 1));
    this.player.addItem(makeRune('bolts', 'common', 1));
    this.player.addItem(makeConsumable('potionS', 3));
    this.player.gold = 60;
    this.обновитьЖурнал();
    this.state = 'play';
    this.menus.close();
    this.enterZone(this.getCity(), null);
    this.hud.showBanner('ВЕЛОРИЯ', 'вольный город · безопасная зона');
    this.toast('Поговори с капитаном Дрейном — он даст первое задание', UI.accent, 5);
    audio.init(); audio.resume();
    this.save({ fresh: true });   // единственный случай, когда уровень вправе упасть
  }

  continueGame() {
    const d = loadGame();
    if (!d) { this.newGame(); return; }
    this.player = new Player();
    this.player.fromJSON(d.player, reviveItem);
    this.seenLessons = d.seenLessons || {};
    this.quests = new Quests();
    this.quests.fromJSON(d.quests);
    this.worldSeed = d.worldSeed || this.worldSeed;
    this.zoneCache.clear();
    this.state = 'play';
    this.menus.close();
    this.обновитьЖурнал();
    this.enterZone(this.getCity(), null);
    this.hud.showBanner('ВЕЛОРИЯ', 'с возвращением, искатель');
    // Если основной слот не прочитался и герой пришёл из резервной копии —
    // сказать об этом прямо. Молча подсунуть получасовой давности состояние
    // хуже, чем признаться: игрок хотя бы поймёт, почему пропала добыча.
    const src = store.lastLoadSource;
    if (src && src.откуда !== 'основной') {
      const мин = Math.round((src.возраст || 0) / 60000);
      this.toast(`Основное сохранение не прочиталось — взята ${src.откуда}` + (мин ? `, ей ${мин} мин` : ''), UI.danger, 6);
    }
    audio.init(); audio.resume();
  }

  /**
   * Войти в общую комнату.
   *
   * Сеть включается только в городе и только после входа. Всё остальное —
   * бой, торговцы, подземелья, инвентарь — пока целиком локальное: в городе
   * врагов нет, конфликтовать нечему, и это честный маленький кусок, а не
   * полумера.
   *
   * Сид города берём серверный. Иначе у каждого свой город, и «общий холл»
   * оказался бы холлом на одного. Терять при этом нечего: в городе нет ни
   * врагов, ни сундуков — только дома и торговцы.
   */
  async goOnline() {
    if (net.online || net.state === 'connecting') return net.state;
    if (!isSignedIn()) return 'нужен вход';
    const w = getWallet();
    const p = this.player;
    const look = {
      armorTier: p.equipment.armor ? p.equipment.armor.tier : 0,
      weaponTier: p.weaponLook(),
      weaponType: p.equipment.weapon ? (p.equipment.weapon.sub === 'dagger' ? 'sword' : p.equipment.weapon.sub) : 'sword',
      cape: p.level >= 10,
    };
    // Комната стоит там, где сказано, а не там, откуда пришла страница. Живая
    // ссылка — статика на GitHub Pages, вебсокетов она не отдаёт; адрес комнаты
    // называет мета-тег в index.html или довод `?server=` в ссылке.
    const url = serverWsUrl();
    // В комнату входят по токену, а не по имени: токен выдают только против
    // проверенной подписи, поэтому чужим адресом назваться нельзя.
    const token = getToken();
    if (!token) return 'нет сессии — войди заново';
    // Своего героя — на полку, прежде чем входить.
    //
    // Герой общего мира и герой одиночной игры — разные герои: первого ведёт
    // комната и хранит у себя, второго ведёт клиент и хранит в браузере. А
    // живут они в одном объекте, и вход в мир подменяет рюкзак, снаряжение,
    // золото и опыт присланным. Замер: офлайн-герой 30-го уровня с легендаркой
    // и пятью тысячами золота после одного захода и одного автосейва
    // превращался в слоте в сорок золота и пустой рюкзак — навсегда, вместе с
    // резервными копиями.
    this.наПолке = {
      player: this.player.toJSON(),
      quests: this.quests.toJSON(),
      worldSeed: this.worldSeed,
    };
    const m = await net.connect(url, {
      name: w.status === 'guest' ? 'Гость' : (w.address ? w.address.slice(0, 4) + '…' + w.address.slice(-4) : 'Странник'),
      token, look,
    });
    // Не вошли — полка не нужна: герой остался своим, и снимать его с себя
    // потом было бы нечего восстанавливать поверх.
    if (!m) { this.наПолке = null; return net.error || 'не подключиться'; }
    if (m.world && m.world.seed !== undefined && m.world.seed !== this.worldSeed) {
      // Мир должен быть один и тот же у всех. Сид комнаты старше нашего:
      // зоны строятся общим правилом от него, и построенные своим надо
      // выбросить целиком, а не только город — иначе первый же биом окажется
      // чужим, и снимок будет ссылаться в другой список врагов.
      this.worldSeed = m.world.seed;
      this.zoneCache.clear();
      if (this.zone) this.enterZone(this.zone.kind === 'city' ? this.getCity() : this.getBiome(this.zone.biomeId));
    }
    // Комната шлёт `welcome` и при переезде — тем же путём принимаем её сид.
    net.onDrop = (почему) => this.потерялиСвязь(почему);
    net.onBag = (m) => this.applyBag(m);
    net.onSay = (m) => this.услышал(m);
    net.onQuests = (m) => this.applyQuests(m);
    net.onQuest = (m) => this.дошлоЗадание(m);
    net.onDeal = (m) => this.дошлаСделка(m);
    net.onShop = (m) => { if (this.menus.shop && this.menus.shop.npcId === m.npc) this.menus.shop.stock = (m.stock || []).map(reviveItem).filter(Boolean); };
    net.onWelcome = (msg) => {
      this.применитьСтража(msg);
      if (!msg.world || msg.world.seed === undefined || msg.world.seed === this.worldSeed) return;
      this.worldSeed = msg.world.seed;
      this.zoneCache.clear();
    };
    this.hud.toast('Ты в общей Велории', '#c9a6ff');
    return 'online';
  }

  /**
   * Считает ли бой комната.
   *
   * Только в общем мире и только там, где есть с кем драться. В городе врагов
   * нет по устройству, и переключать там нечего.
   */
  get serverRunsCombat() {
    return net.online && !!this.zone && this.zone.kind !== 'city';
  }

  /**
   * Подтянуть врагов к тому, что видит комната.
   *
   * Индекс в снимке — это место врага в общем списке зоны, включая убитых:
   * сервер шлёт его именно так, потому что после первой же смерти нумерация
   * «только живых» разъехалась бы с событиями. Положение подтягиваем не
   * рывком, а притиркой — снимки приходят двадцать раз в секунду, а кадров
   * шестьдесят, и присвоение в лоб дало бы шаг втрое реже кадра.
   */
  /** Враг по номеру из снимка. Карта пересобирается, когда список поменялся. */
  enemyByNid(nid) {
    if (!this._byNid || this._byNidLen !== this.enemies.length) {
      this._byNid = new Map();
      for (const e of this.enemies) if (e.nid !== undefined) this._byNid.set(e.nid, e);
      this._byNidLen = this.enemies.length;
    }
    return this._byNid.get(nid);
  }

  /**
   * Сверить свои числа с тем, что насчитал мир.
   *
   * Золото, опыт и уровень теперь ведёт комната — клиент их только показывает.
   * Без сверки они разойдутся: клиент прибавляет по событиям, комната считает
   * по-настоящему, и первая же потеря сообщения оставит игрока с враньём на
   * экране.
   */
  applyMe() {
    const m = net.me;
    // Не `serverRunsCombat`: город в него не входит, а торгуют именно там —
    // и золото у клиента расходилось с миром на всю покупку.
    if (!m || !net.online) return;
    const p = this.player;
    if (Number.isFinite(m.gold)) p.gold = m.gold;
    if (Number.isFinite(m.xp)) p.xp = m.xp;
    if (Number.isFinite(m.pts)) p.statPoints = m.pts;
    if (Number.isFinite(m.lvl) && m.lvl > p.level) { p.level = m.lvl; p.refreshSprites(); }
  }

  /**
   * Здоровье своего героя — из снимка комнаты.
   *
   * Найдено проверкой готовности к релизу, и это было самое заметное враньё на
   * экране: урон в общем мире считает комната и шлёт `hp` в снимке, а клиент
   * применял из своего состояния только золото, опыт, очки и уровень. Полоса
   * стояла на ста процентах всё время боя, и первая смерть приходила при полной
   * шкале — без единого признака опасности до неё.
   *
   * Отступать некуда: своё здоровье в общем мире клиент не считает вовсе, и
   * притирать тут нечего — что прислали, то и правда.
   */
  applyMyHealth() {
    if (!net.online) return;
    const s = net.myServerState();
    if (!s) return;
    const p = this.player;
    if (Number.isFinite(s.mhp) && s.mhp > 0) p.maxHp = s.mhp;
    if (!Number.isFinite(s.hp)) return;
    p.hp = Math.max(0, Math.min(s.hp, p.maxHp));
    // Смерть объявляет комната событием `pdeath`: там и плата за неё, и
    // подъём. Здесь только шкала — иначе плату сняли бы дважды, и второй раз
    // уже с того золота, которое комната успела вернуть.
    if (p.hp > 0 && p.dead && !this.deathPending) { p.dead = false; p.pose = 'idle'; }
  }

  /**
   * Принять рюкзак от мира.
   *
   * В общем мире вещи считает комната: она их роняет, отдаёт, кует и точит.
   * Свой список клиент здесь не ведёт, а показывает присланный — иначе они
   * разойдутся на первой же покупке.
   */
  applyBag(m) {
    if (!net.online || !m) return;
    const p = this.player;
    p.inventory = (m.inv || []).map(reviveItem).filter(Boolean);
    for (const слот in m.eq || {}) p.equipment[слот] = reviveItem(m.eq[слот]);
    p._setsKey = null;
    p.refreshSprites();
  }

  applyEnemySnapshot() {
    const snap = net.snaps[net.snaps.length - 1];
    if (!snap) return;
    this._снаряды = snap.shots || [];
    this.loot = snap.loot || [];
    const живые = new Set();
    for (const s of snap.enemies || []) {
      let e = this.enemyByNid(s.i);
      живые.add(s.i);
      // Комната возрождает павших — иначе общий мир вычищался бы навсегда. У
      // нас этот номер уже похоронен и убран из списка; строим врага заново
      // тем же правилом, что и при заселении, чтобы вернулся тот же самый.
      if (!e || e.dead) {
        // Население зоны восстанавливаем по номеру общим правилом — так
        // возвращается ровно тот, кто здесь стоял. А кого комната дописала по
        // ходу игры (страж, засада), по номеру не восстановить: он появился не
        // из описания зоны. Для таких снимок несёт уровень.
        const свежий = s.lv !== undefined
          ? new Enemy(s.k, s.lv, s.x, s.y)
          : respawnOne(this.zone, this.worldSeed, s.i, this._население || {});
        if (!свежий) continue;
        свежий.nid = s.i;
        свежий.aggro = true;
        if (свежий.boss) { if (this.zone.boss) this.zone.boss.spawned = true; this.bossEntrance(свежий); }
        if (e) this.enemies[this.enemies.indexOf(e)] = свежий;
        else this.enemies.push(свежий);
        this._byNidLen = -1;
        e = свежий;
      }
      const k = 0.35;
      e.x += (s.x - e.x) * k; e.y += (s.y - e.y) * k;
      e.hp = s.hp; e.maxHp = s.mx;
      if (!e.aggro && s.hp < s.mx) e.aggro = true;   // по нему уже били
    }
    // Кого в снимке нет — тот убит. Ведём через `killEnemy`, а не гасим флаг:
    // там висят добыча, опыт и задания, и обойти их значило бы получить мир,
    // где враги умирают, но ничего не происходит.
    this.playServerEvents();   // сначала события: там сказано, кто чей убийца
    for (const e of this.enemies) {
      if (!e || e.dead || живые.has(e.nid)) continue;
      // Хороним только то, о смерти чего сказала комната.
      //
      // «Нет в снимке» смертью не считается: снимок обрезан по расстоянию (420
      // px), и отойти от живого стража значило объявить его поверженным —
      // с баннером, сменой музыки и открытым спуском. События `kill` приходят
      // всем в комнате независимо от расстояния, так что пропустить своё
      // убийство таким образом нельзя.
      if (!this._убийцы || !this._убийцы.has(e.nid)) continue;
      // Награду даёт только слово комнаты. Просто «пропал из снимка» её не
      // даёт: пока клиент рождал засады сам, всё, чего комната не знала,
      // хоронилось здесь же — с полной добычей и опытом за отряд, которого
      // никто не видел.
      // «Своё» — это участие, а не последний удар. Комната считает вклад и
      // присылает в `w` всех, кому засчитала: помогавший получает опыт, ход
      // задания и свою добычу, даже если добил кто-то другой.
      const уб = this._убийцы && this._убийцы.get(e.nid);
      const моё = !!уб && (уб.by === net.pid || (уб.w || []).includes(net.pid));
      this.killEnemy(e, { чужой: !моё });
      if (this._убийцы) this._убийцы.delete(e.nid);
    }
  }

  /**
   * Зрелище по событиям комнаты.
   *
   * Правило посчитал сервер — искры, числа и звук остаются клиенту. Это то же
   * разделение, что и во всей игре: без него пришлось бы либо гонять урон по
   * проводу вместе с картинкой, либо считать его дважды.
   */
  playServerEvents() {
    for (const ev of net.takeEvents()) {
      // Событие `kill` приходит раньше снимка, где враг уже исчез. Запоминаем
      // событие целиком: снимок сам по себе не знает ни кто добил, ни кому
      // комната засчитала участие.
      if (ev.t === 'kill') { (this._убийцы || (this._убийцы = new Map())).set(ev.i, ev); continue; }
      const e = ev.i !== undefined ? this.enemyByNid(ev.i) : null;
      if (ev.t === 'hit' && e) {
        e.hurtT = 0.16;
        this.floats.add(e.x + (Math.random() - 0.5) * 8, e.y - e.spr.h * 0.7, String(ev.d), {
          color: ev.c ? '#ffd54a' : '#ffffff', size: ev.c ? 13 : 10, crit: ev.c, bold: ev.c,
        });
        this.particles.burst(e.x, e.y - e.r * 0.7, ev.c ? 12 : 7, {
          color: '#ff5a5a', color2: '#ffd0a0', speed: 70, life: 0.35, size: 2, g: 200, vz: 55,
        });
        audio.play(ev.c ? 'crit' : 'hit', 0.8);
      } else if (ev.t === 'dodge' && e) {
        this.floats.add(e.x, e.y - e.spr.h * 0.7, 'мимо', { color: '#c99cff', size: 9 });
      } else if (ev.t === 'react' && e) {
        // Реакцию посчитала комната — здесь только вспышка, звук и зачёт
        // задания, и зачёт только за свою.
        const r = REACTIONS[ev.k];
        if (r) this.onReaction(e, ev.k, r, ev.pid === net.pid);
      } else if (ev.t === 'took' && ev.pid === net.pid) {
        // Вещь пришла от комнаты: она её уронила, она её и отдала. Здесь
        // остаётся положить в рюкзак и показать — считать было нечего.
        const p = this.player;
        if (ev.gold) { p.gold += ev.gold; this.floats.add(p.x, p.y - 30, '+' + ev.gold, { color: '#ffd76a', size: 10 }); }
        if (ev.item) {
          const it = reviveItem(ev.item);
          if (it) { p.addItem(it); this.hud.pickupNote ? this.hud.pickupNote(it) : this.toast(t(it.name), (RARITY[it.rarity] || RARITY.common).color); }
        }
        audio.play('pickup', 0.8);
        if (this._прошено) this._прошено.delete(ev.lid);
      } else if (ev.t === 'level' && ev.pid === net.pid) {
        this.onLevelUp(ev.n || 1);
      } else if (ev.t === 'pdeath' && ev.pid === net.pid) {
        // Смерть в общем мире считает комната: она снимает золото и пять
        // секунд не принимает ввод. Клиент об этом не узнавал вовсе — вёл
        // своё здоровье сам, экрана смерти не показывал, и единственным, что
        // видел игрок, был рывок героя через полкарты, когда сверка не
        // выдерживала расхождения.
        const p = this.player;
        p.hp = 0; p.dead = true; p.deadT = 0; p.pose = 'dead';
        this.deathPenalty = ev.gold || 0;
        p.gold = Math.max(0, p.gold - this.deathPenalty);
        audio.play('die');
        this.shake.add(10, 0.7);
        this.menus.mode = 'death';
      } else if (ev.t === 'praise' && ev.pid === net.pid) {
        // Комната подняла: мир общий, лежать в нём некому и незачем.
        const p = this.player;
        p.dead = false; p.deadT = 0; p.pose = 'idle';
        p.hp = p.maxHp; p.mp = p.maxMp;
        p.x = ev.x; p.y = ev.y; p.vx = 0; p.vy = 0;
        p.iframe = 2;
        if (this.menus.mode === 'death') this.menus.close();
        this.updateCamera(0, false);
        this.toast('Ты снова на ногах', UI.good);
      } else if (ev.t === 'swing' && ev.pid !== net.pid) {
        // чужой взмах: своя отдача уже отыграна при нажатии
        const o = (this._others || []).find((x) => x.pid === ev.pid);
        if (o) this.slashes.push({ x: o.x, y: o.y - 12, a: ev.f, t: 0, dur: 0.18, combo: ev.combo });
      }
    }
  }

  /**
   * Выйти из общего мира — и вернуть себе своего героя.
   *
   * Раньше здесь рвалась только связь. Герой при этом оставался комнатным:
   * пустой рюкзак, сорок золота, — и первый же автосейв вне сети записывал его
   * в одиночный слот. То есть прогресс погибал и в обратном порядке, а не
   * только при входе.
   *
   * Снимаем с полки то, что положили в `goOnline`. Если полки нет — значит в
   * общий мир и не входили, и трогать героя не за чем.
   */
  goOffline() {
    net.disconnect();
    this._others = [];
    this.сНолки();
  }

  /**
   * Снять с полки своего героя.
   *
   * Зовут отсюда двое: сознательный выход и обрыв связи. Второе важнее: при
   * обрыве `goOffline` никто не зовёт, а герой остаётся комнатным — и первый же
   * автосейв записывает его в одиночный слот, потому что `save()` больше не
   * видит сети. То есть беда, закрытая на входе и выходе, возвращалась через
   * оборванный провод.
   */
  сНолки() {
    const п = this.наПолке;
    this.наПолке = null;
    if (!п) return;
    try {
      this.player.fromJSON(п.player, reviveItem);
      this.quests.fromJSON(п.quests);
      if (п.worldSeed !== undefined) this.worldSeed = п.worldSeed;
      this.player.refreshSprites();
    } catch (e) {
      // Своего героя не собрать — это хуже, чем чужой на экране: молчать нельзя.
      this.toast('Не удалось вернуть офлайн-героя: ' + e.message, UI.danger, 6);
    }
  }

  /**
   * Связь с общим миром оборвалась.
   *
   * Молчать об этом нельзя. Раньше `onclose` только менял состояние, и мир
   * незаметно становился одиночным: соседи исчезали, бой шёл, опыт капал — и
   * ничего из этого в общий мир не попадало. Человек узнавал об этом, потеряв
   * полчаса.
   */
  потерялиСвязь(почему) {
    this._others = [];
    this.связьПотеряна = почему || 'связь с комнатой прервалась';
    this.сНолки();
    this.toast('Общий мир отключился: ' + this.связьПотеряна, UI.danger, 8);
  }

  /** Спрайты чужого героя по объявленной внешности — с запоминанием. */
  otherSprites(look) {
    const key = look ? `${look.armorTier}|${look.weaponTier}|${look.weaponType}|${look.cape ? 1 : 0}` : 'def';
    this._otherSpr = this._otherSpr || new Map();
    let s = this._otherSpr.get(key);
    if (!s) {
      s = bakeHero({
        armorTier: (look && look.armorTier) || 0,
        weaponTier: (look && look.weaponTier) || 0,
        weaponType: (look && look.weaponType) || 'sword',
        cape: look && look.cape ? ['#3a1020', '#7a1f34', '#b83a4e'] : null,
      });
      this._otherSpr.set(key, s);
    }
    return s;
  }

  /**
   * Выгрузить героя файлом.
   *
   * Это единственная защита от того, чего игра сделать не может: браузер
   * вычищает своё хранилище (инкогнито, «удалить данные сайта», нехватка
   * места), и никакие внутренние копии там не помогут. Файл лежит у человека.
   */
  exportSaveFile() {
    const text = store.exportSave();
    if (!text) { this.toast('Сохранять нечего', UI.textDim, 2); return; }
    const info = store.saveInfo();
    const день = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.href = url;
    a.download = `veloria-ур${info.уровень || '?'}-${день}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast('Герой выгружен файлом', UI.good, 3);
  }

  /** Принять героя из файла. Прежний уходит в резерв, а не в никуда. */
  importSaveFile() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json,.json';
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        const res = store.importSave(String(r.result));
        if (!res.ok) { this.toast('Файл не принят: ' + res.reason, UI.danger, 5); return; }
        this.hasSave = true;
        this.menus.closeSettings();
        this.continueGame();
        this.toast(`Принят герой ${res.level} уровня`, UI.good, 4);
      };
      r.onerror = () => this.toast('Файл не читается', UI.danger, 4);
      r.readAsText(f);
    };
    inp.click();
  }

  /** Что показать в настройках про сохранения. */
  saveState() { return store.saveInfo(); }

  toTitle() {
    this.state = 'title';
    this.menus.mode = 'title';
    this.hasSave = hasSave();
    audio.stopMusic();
  }

  save({ fresh = false } = {}) {
    // В общем мире одиночный слот не трогаем вовсе.
    //
    // Там играют другим героем: его ведёт комната и хранит у себя. А пишется он
    // в тот же объект, что и свой, — и `save()`, ничего не знавший про сеть,
    // складывал чужого героя в свой слот автосейвом каждые сорок пять секунд.
    // Замер: тридцатый уровень с легендаркой и пятью тысячами золота
    // превращался в сорок золота и пустой рюкзак, вместе с резервными копиями и
    // серверной. Это единственная беда из найденных перед релизом, которую
    // игрок не смог бы себе вернуть.
    //
    // Возвращаем `true`: это не отказ записи, а её отсутствие по устройству, и
    // пугать игрока «не удалось сохранить» здесь не за что.
    if (net.online) return true;
    const data = {
      player: this.player.toJSON(),
      quests: this.quests.toJSON(),
      worldSeed: this.worldSeed,
      seenLessons: this.seenLessons,
    };
    const ok = saveGame(data, { fresh: !!fresh });
    // Отказ в сохранении нельзя проглатывать: игрок обязан узнать, что его
    // прогресс перестал записываться, — иначе он выяснит это, потеряв вечер.
    // Ругаемся не чаще раза в полминуты: автосейв частый, а беда одна и та же.
    if (!ok && this.time - (this._saveWarnT || -99) > 30) {
      this._saveWarnT = this.time;
      this.toast('Не удалось сохранить: ' + (store.lastSaveProblem || 'неизвестно'), UI.danger, 5);
    }
    this.hasSave = true;
    // Копия уходит на сервер, если вход проверен. Местное сохранение при этом
    // остаётся: игра обязана работать и без сети, а чистка кэша браузера
    // больше не означает потерю персонажа.
    // `ok` здесь обязателен. Местная защита отказывает, когда пишут не того
    // героя (упавший уровень, непройденная проверка), а на сервере такой
    // защиты нет и копий там нет тоже: запись затирается целиком. Отправлять
    // наверх то, что не приняли у себя, — значит подменить единственный
    // серверный экземпляр испорченным.
    if (ok && isVerified()) {
      pushCharacter(data, getWallet().address ? shortenAddr(getWallet().address) : 'Странник')
        .catch(() => { /* нет связи — переживём, местная копия есть */ });
    }
    return ok;
  }

  /**
   * Персонаж с сервера, если он там есть и новее местного.
   *
   * Правило простое: сервер главнее. Он видел все устройства, а localStorage —
   * только это. Если серверного персонажа нет вовсе, играем местным и при
   * первом же сохранении он уедет наверх.
   */
  adoptServerCharacter() {
    const ch = getCharacter();
    if (!ch || !ch.player) return false;
    const localLvl = this.player ? this.player.level : 0;
    const remoteLvl = ch.player.level || 0;
    if (remoteLvl < localLvl) return false;
    saveGame(ch);
    this.hasSave = true;
    this.continueGame();
    return true;
  }

  toggleAudio() {
    this.audioMuted = !this.audioMuted;
    audio.setMuted(this.audioMuted);
    this.saveOptions();
  }

  /** Громкость с ползунка. Сдвиг с нуля сам снимает глушение — иначе игрок
   *  тянет ползунок, ничего не слышит и решает, что звук сломан. */
  setVolume(v) {
    audio.setVolume(v);
    if (audio.volume > 0 && this.audioMuted) { this.audioMuted = false; audio.setMuted(false); }
    this.saveOptions();
  }
  get volume() { return audio.volume; }

  setMusicVolume(v) { audio.setMusicVolume(v); this.saveOptions(); }
  setSfxVolume(v) { audio.setSfxVolume(v); this.saveOptions(); }
  get musicVolume() { return audio.musicVol; }
  get sfxVolume() { return audio.sfxVol; }

  /**
   * Язык применяется на месте, без перезагрузки: весь текст переводится в
   * момент отрисовки, поэтому достаточно переключить флаг — следующий же кадр
   * выйдет на новом языке.
   */
  setLanguage(id) {
    if (id === getLang()) return;
    setLang(id);
    this.saveOptions();
  }
  get language() { return getLang(); }

  saveOptions() {
    saveOptions({ volume: audio.volume, music: audio.musicVol, sfx: audio.sfxVol, muted: this.audioMuted, lang: getLang() });
  }

  toggleFullscreen() {
    const wasOn = isFullscreen();
    toggleFullscreen().then((ok) => {
      if (!ok && !wasOn) this.toast('Браузер не пустил в полный экран — попробуй F11', UI.textDim, 3.5);
    });
  }
  get isFullscreen() { return isFullscreen(); }

  // ════════════════════════════ зоны

  getCity() {
    let z = this.zoneCache.get('city');
    if (!z) { z = generateCity(zoneSeedFor(this.worldSeed, 'city')); this.zoneCache.set('city', z); }
    return z;
  }

  getBiome(id) {
    const key = 'biome:' + id;
    let z = this.zoneCache.get(key);
    if (!z) {
      z = generateBiomeZone(id, zoneSeedFor(this.worldSeed, 'biome', id));
      this.zoneCache.set(key, z);
    }
    return z;
  }

  getDungeon(floor, modKey = 'none') {
    // этажи не кэшируем глубже одного — иначе память растёт
    const key = 'dun:' + floor + ':' + modKey;
    let z = this.zoneCache.get(key);
    if (!z) {
      z = generateDungeon(floor, zoneSeedFor(this.worldSeed, 'dungeon'), modKey);
      for (const k of [...this.zoneCache.keys()]) if (k.startsWith('dun:') && k !== key) this.zoneCache.delete(k);
      this.zoneCache.set(key, z);
    }
    return z;
  }

  travel(dest, fromExit) {
    if (this.transition) return;
    const need = fromExit && fromExit.requireLevel;
    if (need && this.player.level < need) {
      audio.play('deny');
      this.toast(`Врата не пускают: нужен уровень ${need}`, UI.danger);
      return;
    }
    if (fromExit && fromExit.locked) {
      audio.play('deny');
      this.toast('Спуск закрыт, пока жив страж этажа', UI.danger);
      return;
    }
    audio.play('portal');
    this.transition = { t: 0, phase: 'out', dest };
  }

  doTravel(dest) {
    // В общем мире переход по вратам — это ещё и переезд между комнатами:
    // иначе герой ушёл бы в лес у себя, а для комнаты остался бы в городе.
    if (net.online) net.travel(dest);

    let z, spawnAt = null;
    if (dest.kind === 'city') {
      z = this.getCity();
    } else if (dest.kind === 'biome') {
      z = this.getBiome(dest.id);
      if (!net.online) this.quests.onEnterBiome(dest.id, this);
    } else if (dest.kind === 'dungeon') {
      z = this.getDungeon(dest.floor, dest.mod || 'none');
      if (dest.floor > this.player.deepest) {
        this.player.deepest = dest.floor;
        if (dest.floor % 5 === 0) this.toast('Новый рекорд глубины: ' + dest.floor, UI.accent, 3);
      }
      // рекорд ладдера переживает смену персонажа
      if (recordDepth(dest.floor) && dest.floor >= ABYSS_START) {
        this.toast('Бездна пройдена глубже: ' + dest.floor, '#ff9ae0', 4);
      }
      if (!net.online) this.quests.onDepth(dest.floor, this);
    }
    this.enterZone(z, spawnAt);
    this.save();
  }

  enterZone(zone, spawnAt) {
    this.zone = zone;
    this.enemies = [];
    this.projectiles = [];
    this.loot = [];
    this.decals = [];
    this.slashes = [];
    this.hazards = [];
    // Выбросы пустоты живут вечно: это часть зоны, а не след от умения. `life`
    // держим бесконечной — вычитание dt её не трогает, и вылет по времени не
    // сработает никогда.
    for (const hs of zone.hazardSpots || []) {
      this.hazards.push({
        x: hs.x, y: hs.y, r: hs.r, dps: hs.dps, effect: hs.effect,
        life: Infinity, tick: Math.random() * 0.5, hostile: true, cloud: true,
        color: '#a882e0', color2: '#5c3a86',
      });
    }
    this.particles.clear();
    this.floats.clear();
    this.hud._mini = null;

    const mod = zone.mod || null;
    // порча этажа: считаем один раз на вход и вешаем на героя, чтобы геттеры
    // характеристик не лезли в зону каждый кадр
    const corr = corruptionOf(zone);
    this.corruption = corr;
    this.player._corr = corruptionEffects(corr);
    // «Полое сердце»: половина отнятого здоровья возвращается
    if (corr && this.player.hasUnique('hollowHeart')) {
      this.player._corr = { ...this.player._corr, hpMul: 1 - (1 - this.player._corr.hpMul) * 0.5 };
    }
    this.player._devour = 0;   // накопленный «Ненасытный» сгорает при смене этажа
    const ce = this.player._corr;
    this.player.hp = Math.min(this.player.hp, this.player.maxHp);

    this._население = { mod, corr: corr ? ce : null };
    for (const e of populateZone(zone, this.worldSeed, this._население)) this.enemies.push(e);
    // Стабильный номер врага — тот, под которым он родился. Комната шлёт в
    // снимке именно его: её список не редеет, а наш вычищает трупы, и после
    // первой же смерти позиции разъезжаются. Раз номер стоит в сообщении,
    // пусть он и живёт на враге, а не выводится из длины массива.
    this.enemies.forEach((e, i) => { e.nid = i; });
    this._nextNid = this.enemies.length;
    this._byNid = null;
    // Карта «кто кого убил» — про номера ЭТОЙ зоны. В каждой зоне номера
    // начинаются с нуля, поэтому запись из прошлой означала бы здесь другое
    // существо — и выдала бы за него добычу и опыт как за своё убийство.
    this._убийцы = null;
    this._снаряды = [];
    // Лагеря засад живут на объекте зоны, а зона лежит в кэше. Без сброса
    // отряд не рождался заново, а награда становилась недостижимой: условие
    // «все мертвы» проверялось по шести живым сущностям прошлого посещения.
    for (const ev of zone.events || []) {
      if (ev.kind !== 'ambush') continue;
      ev.done = false; ev.rewarded = false; ev.enemies = [];
    }
    if (zone.boss) zone.boss.spawned = false;

    const sp = spawnAt || zone.spawnPoint;
    this.player.x = sp.x; this.player.y = sp.y;
    this.player.vx = this.player.vy = 0;
    // Прицел тот же, что в updateCamera (герой чуть ниже центра): раньше здесь
    // считали по player.y, и на первом же кадре после входа камера прыгала на 10 px.
    this._peekX = 0; this._peekY = 0;
    this.cam.x = clamp(this.player.x - this.view.w / 2, 0, Math.max(0, zone.pxW - this.view.w));
    this.cam.y = clamp(this.player.y - 10 - this.view.h / 2, 0, Math.max(0, zone.pxH - this.view.h));

    this.weather.set(zone.weather, this.view.w, this.view.h);
    audio.setTrack(TRACKS[zone.music] || TRACKS.city);

    if (zone.kind !== 'dungeon' && this.player.boon) {
      this.player.boon = emptyBoon();
      this.player.hp = Math.min(this.player.hp, this.player.maxHp);
    }

    const b = BIOMES[zone.biomeId];
    // параметры постобработки берём из описания биома
    zone.bloom = b.bloom ?? 0.6;
    zone.tone = b.tone || null;
    zone.vignette = b.vignette || '4,3,12';
    zone.sun = zone.kind === 'dungeon' ? SUN_DUN : SUN_OUT;

    if (zone.kind === 'dungeon') {
      this.hud.showBanner(`ЭТАЖ ${zone.floor}`, zone.isBossFloor ? 'здесь кто-то ждёт' : b.subtitle, zone.isBossFloor ? '#ff7a6a' : '#b08aff');
    } else if (zone.kind === 'biome') {
      this.hud.showBanner(t(b.name).toUpperCase(), `${t(b.subtitle)} · ${t("уровень мобов ~{0}").replace("{0}", zone.level)}`, '#8fe0a0');
    } else {
      this.hud.showBanner('ВЕЛОРИЯ', 'безопасная зона');
    }
    if (zone.safe) this.обновитьЖурнал();
    if (!net.online) this.quests.syncCollect(this.player);
  }

  // ════════════════════════════ физика и запросы

  // Столкновения переехали в `world/collide.js` — их теперь считает и комната
  // на сервере. Правила «где можно стоять» обязаны совпадать у клиента и
  // сервера до пикселя: разойдись они на единицу, и героя будет дёргать назад.
  // Здесь остались обёртки, чтобы четыре сотни мест вызова не переписывать.
  canBeAt(x, y, w, h, fly) { return canBeAt(this.zone, x, y, w, h, fly); }

  moveEntity(e, dt, collide = true) { moveEntity(this.zone, e, dt, collide); }

  solidAt(x, y) { return solidAt(this.zone, x, y); }

  hasLineOfSight(a, b) { return hasLineOfSight(this.zone, a, b); }

  nearestEnemy(x, y, r, skip) { return nearestEnemy(this.enemies, x, y, r, skip); }

  // ════════════════════════════ бой

  playerSwing(combo) {
    const p = this.player;
    if (p.weaponSub === 'bow') { this.shootArrow(); return; }
    if (p.weaponSub === 'staff') { this.castBolt(); return; }

    const range = p.attackRange + (combo === 2 ? 8 : 0);
    const spread = (combo === 2 ? 1.5 : 1.05);
    const mult = combo === 2 ? 1.5 : 1;
    const ox = p.x + Math.cos(p.facing) * 6;
    const oy = p.y - 11 + Math.sin(p.facing) * 4;

    this.slashes.push({
      x: ox, y: oy, a: p.facing, r: range, spread, t: 0,
      dur: 0.2, color: combo === 2 ? '#ffd98a' : '#dfe9ff',
    });
    // искры вдоль дуги — след клинка
    for (let i = 0; i < 5; i++) {
      const a = p.facing - spread * 0.6 + (i / 4) * spread * 1.2;
      this.particles.spawn({
        x: ox + Math.cos(a) * range * 0.8, y: oy + Math.sin(a) * range * 0.8,
        vx: Math.cos(a) * 40, vy: Math.sin(a) * 40,
        color: combo === 2 ? '#ffe6a0' : '#e8f0ff', life: 0.16, size: 1.6, drag: 6, glow: 5,
      });
    }
    audio.play('swing', combo === 2 ? 1 : 0.75);

    // ── в общем мире попадания считает комната
    //
    // Клиент шлёт намерение и на этом останавливается. Посчитать здесь ещё раз
    // значило бы получить два ответа на один вопрос: свой урон на экране и
    // серверный в снимке, — а расходиться они начнут на первом же промахе по
    // сдвинувшейся цели. Зрелище придёт событиями `ev`, там же и числа.
    //
    // Замах, свист и искры остаются: они уже отыграны выше и не ждут ответа —
    // ждать круга до сервера, чтобы махнуть мечом, нельзя.
    if (this.serverRunsCombat) { net.sendSwing(combo, p.facing || 0); return; }

    // Кого задело и на сколько — считает общий модуль `systems/combat.js`: тем
    // же кодом это должна уметь и комната на сервере. Здесь остаётся то, чего
    // серверу не нужно, — вспышка «ФОКУС», эффекты попадания и отдача.
    const hits = swingHits(p, this.enemies, { combo, time: this.time });
    for (const h of hits) {
      const e = h.enemy;
      if (h.focused) {
        p._focusCd = this.time + 7;
        this.floats.add(e.x, e.y - e.spr.h, 'ФОКУС', { color: '#ffd54a', size: 10, bold: true });
      }
      // третий удар связки — тяжёлый: пробивает щиты и броню
      this.damageEnemy(e, h.dmg, { crit: h.crit, knock: h.knock, from: p, heavy: h.heavy });
      tryShatter(this, e, h.dmg, h.heavy);
      this.proc('hit', { enemy: e, crit: h.crit, dmg: h.dmg });
    }
    const hitAny = hits.length > 0;
    if (hitAny) {
      this.shake.add(combo === 2 ? 3.4 : 1.8, 0.16);
      this.hitStop = combo === 2 ? 0.055 : 0.03;
    }
  }

  shootArrow() {
    const p = this.player;
    const crit = Math.random() < p.critChance;
    this.projectiles.push(new Projectile({
      x: p.x + Math.cos(p.facing) * 8, y: p.y - 12 + Math.sin(p.facing) * 4,
      vx: Math.cos(p.facing) * 260, vy: Math.sin(p.facing) * 260,
      damage: p.attack * (crit ? p.critMult : 1), crit,
      friendly: true, color: '#d8c48a', color2: '#fff0c0', size: 2, glow: 6, life: 1.4,
    }));
    audio.play('swing', 0.6);
  }

  castBolt() {
    const p = this.player;
    const crit = Math.random() < p.critChance;
    this.projectiles.push(new Projectile({
      x: p.x + Math.cos(p.facing) * 8, y: p.y - 13 + Math.sin(p.facing) * 4,
      vx: Math.cos(p.facing) * 210, vy: Math.sin(p.facing) * 210,
      damage: p.magicPower * (crit ? p.critMult : 1), crit,
      friendly: true, color: '#8b4fd8', color2: '#dcb0ff', size: 3, glow: 11, life: 1.6, homing: 1.4,
    }));
    audio.play('cast', 0.55);
  }

  damageEnemy(e, amount, opts = {}) {
    if (e.dead) return;
    // Сколько дойдёт до цели — считает `resolveHit` в systems/combat.js. Это
    // одно правило на игру и на стенд, который её проверяет: раньше стенду
    // пришлось бы держать свою копию, а копия уже однажды разошлась с игрой по
    // каждому пункту. Здесь остаётся только зрелище и последствия.
    const hit = resolveHit(this.player, e, amount, opts, Math.random, markDamageMult);
    if (hit.dodged) {
      this.floats.add(e.x, e.y - e.spr.h * 0.7, 'мимо', { color: '#c99cff', size: 9 });
      return;
    }
    if (hit.blocked) {
      e.blockT = 0.22;
      this.floats.add(e.x, e.y - e.spr.h * 0.75, 'БЛОК', { color: '#9fc4e8', size: 9, bold: true });
      this.particles.burst(e.x + Math.cos(hit.incoming) * e.r, e.y - e.r * 0.6 + Math.sin(hit.incoming) * e.r, 8, {
        color: '#dfe9ff', color2: '#ffffff', speed: 90, life: 0.25, size: 2, glow: 5,
      });
      audio.play('ui', 1.4);
      opts.knock = (opts.knock || 0) * 0.15;
    }

    const dmg = hit.dmg;
    e.hp -= dmg;
    e.hurtT = 0.16;
    if (!e.aggro) { e.aggro = true; e.wakePack(this); }
    this.player.stats.dmgDealt += dmg;

    if (!opts.silent) {
      this.floats.add(e.x + (Math.random() - 0.5) * 8, e.y - e.spr.h * 0.7, String(dmg), {
        color: opts.crit ? '#ffd54a' : opts.dot ? (opts.color || '#a8ee5a') : '#ffffff',
        size: opts.crit ? 13 : 10, crit: opts.crit, bold: opts.crit,
      });
      audio.play(opts.crit ? 'crit' : 'hit', 0.8);
      this.particles.burst(e.x, e.y - e.r * 0.7, opts.crit ? 12 : 7, {
        color: '#ff5a5a', color2: '#ffd0a0', speed: 70, life: 0.35, size: 2, g: 200, vz: 55,
      });
    } else if (opts.dot) {
      this.floats.add(e.x, e.y - e.spr.h * 0.7, String(dmg), { color: opts.color || '#a8ee5a', size: 8 });
    }

    if (opts.knock && opts.from) {
      const a = angle(opts.from.x, opts.from.y, e.x, e.y);
      e.vx += Math.cos(a) * opts.knock * (e.knockRes || 1);
      e.vy += Math.sin(a) * opts.knock * (e.knockRes || 1);
    }

    // вампиризм и эффекты оружия
    const g = this.player.gear;
    const ls = this.player.lifesteal;
    if (!opts.silent && ls) {
      const h = dmg * ls / 100;
      if (h >= 0.5) { this.player.heal(h); this.floats.add(this.player.x, this.player.y - 30, '+' + Math.round(h), { color: '#6fdc8c', size: 8 }); }
    }
    if (!opts.silent && g.burn) e.applyEffect('burn', 3, g.burn * 0.5, this);
    if (!opts.silent && g.poison) e.applyEffect('poison', 4, g.poison * 0.5, this);
    if (!opts.silent && g.slow) e.applyEffect('slow', 2.5, 1, this);

    if (e.hp <= 0) this.killEnemy(e);
  }

  /**
   * @param {object} e
   * @param {{чужой?: boolean}} [opts] — убили без нас: тело падает, но добыча,
   *   опыт, счётчики заданий и пассивки на убийство достаются участникам боя.
   *   Без этого в общем мире каждый получал бы награду за всех.
   *
   *   «Без нас» — значит мы не били, а не «добил другой». Участие считает
   *   комната и присылает списком в событии `kill`: помогавшему полагается
   *   ровно то же, что добившему, иначе драться вместе невыгодно.
   */
  killEnemy(e, opts = {}) {
    e.dead = true;
    e.deadT = 0;
    e.hp = 0;
    const p = this.player;
    if (opts.чужой) {
      // Стража могли положить и без нас — но мир меняется для всех: музыка
      // возвращается, спуск открывается. Своей остаётся только награда.
      if (e.boss) {
        this.hud.showBanner('ПОВЕРЖЕН', e.name, '#ffd06a');
        if (this.zone.downExit) { this.zone.downExit.locked = false; }
        audio.setTrack(TRACKS[BIOMES[this.zone.biomeId].music] || TRACKS.dungeon, { fadeOut: 1.0, fadeIn: 1.6 });
      }
      audio.play('die', e.boss ? 0.6 : 0.35);
      this.particles.burst(e.x, e.y - e.r * 0.6, e.boss ? 40 : 12, {
        color: e.spr.c1 || '#c05a5a', color2: '#ffd0a0', speed: 90, life: 0.5, size: 2, g: 190, vz: 60,
      });
      return;
    }
    p.kills++;
    if (e.boss) p.stats.bossKills++;

    // пассивки, срабатывающие на убийство
    const mom = p.passive('momentum');
    if (mom) p.buffs.momentum = 3;
    const flow = p.passive('arcaneFlow');
    if (flow) p.restoreMp(flow);

    // Ход задания в общем мире считает комната: она видит настоящее
    // убийство. Считать его ещё и здесь значит спорить с ней между её
    // сообщениями — и показывать игроку число, которое сейчас поменяется.
    if (!net.online && e.elite && !e.boss) this.quests.onEliteKill(this);
    this.proc('kill', { enemy: e });
    audio.play('die', e.boss ? 1 : 0.6);
    this.shake.add(e.boss ? 9 : e.elite ? 4 : 2, e.boss ? 0.6 : 0.2);
    this.particles.burst(e.x, e.y - e.r * 0.6, e.boss ? 60 : 18, {
      color: '#c02a34', color2: '#ff9a7a', speed: e.boss ? 150 : 90, life: 0.6, size: 2, g: 210, vz: 70,
    });
    this.decals.push({ x: e.x, y: e.y, r: e.r * 0.9, a: 0.5, life: 24 });

    // опыт и добыча
    //
    // В общем мире опыт начисляет комната и присылает в `me`. Считать его ещё и
    // здесь — значит спорить с ней между её сообщениями: `applyMe` уровень
    // только поднимает и никогда не опускает, так что расхождение осталось бы
    // на экране до конца сеанса. Число над врагом — зрелище, оно остаётся.
    if (!net.online) p.gainXp(e.xpValue, this);
    this.floats.add(e.x, e.y - e.spr.h - 4, `+${e.xpValue} опыта`, { color: '#8ff0b0', size: 8, vy: -18 });
    this.dropLoot(e);
    if (!net.online) this.quests.onKill(e.key, this);

    if (e.boss) {
      this.hud.showBanner('ПОВЕРЖЕН', e.name, '#ffd06a');
      if (this.zone.downExit) { this.zone.downExit.locked = false; this.toast('Спуск глубже открыт', UI.good); }
      // Обратно — не спеша: бой кончился, мир возвращается, а не включается.
      audio.setTrack(TRACKS[BIOMES[this.zone.biomeId].music] || TRACKS.dungeon, { fadeOut: 1.0, fadeIn: 1.6 });
      this.save();
    }
  }

  /**
   * Добыча с убитого.
   *
   * Состав решает общее правило `rollDrops` — то же, которым роняет комната.
   * Здесь остаётся только разбросать выпавшее по земле.
   *
   * В общем мире этот путь не работает вовсе: там роняет комната и она же
   * знает, чья добыча. Иначе клиент сам решал бы, что ему выпало, — а свой
   * рюкзак он же и присылает на сервер.
   */
  dropLoot(e) {
    if (this.serverRunsCombat) return;
    const выпало = rollDrops(e, {
      zone: this.zone, corr: this.corruption || 0, ce: this.player._corr,
      level: this.player.level, seed: (e.x * 31 + e.y * 17 + this.time * 1000) | 0,
    });
    for (const д of выпало) this.spawnLoot(e.x, e.y, д);
  }

  /**
   * Добыча общего мира: список приходит снимком, поднятие идёт через комнату.
   *
   * Просить дважды одно и то же не нужно — но и полагаться на то, что комната
   * ответит мгновенно, нельзя: пока ответа нет, вещь остаётся лежать. Держим
   * недавно спрошенные, чтобы не слать одно и то же двадцать раз в секунду.
   */
  updateSharedLoot(dt) {
    const p = this.player;
    const прошено = this._прошено || (this._прошено = new Map());
    for (const [lid, t] of прошено) if (this.time - t > 1.5) прошено.delete(lid);
    if (p.dead) return;
    for (const l of this.loot) {
      if (l.o !== null && l.o !== net.pid) continue;              // чужая
      if (dist(l.x, l.y, p.x, p.y - 4) > 22) continue;
      if (прошено.has(l.i)) continue;
      прошено.set(l.i, this.time);
      net.pickup(l.i);
    }
  }

  spawnLoot(x, y, data) {
    const a = Math.random() * TAU;
    this.loot.push({
      x, y, z: 6, vx: Math.cos(a) * 32, vy: Math.sin(a) * 22, vz: 55,
      ...data, life: 90, t: 0, magnet: false,
    });
  }

  shockwave(x, y, r, dmg, color) {
    this.particles.spawn({ x, y, color: color || '#ffd06a', shape: 'ring', size: r / 5, life: 0.5, shrink: false });
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TAU;
      this.particles.spawn({
        x, y, vx: Math.cos(a) * r * 2.2, vy: Math.sin(a) * r * 1.1,
        color: color || '#ffd06a', life: 0.4, size: 2, drag: 3, glow: 6,
      });
    }
    const p = this.player;
    if (!p.dead && dist(x, y, p.x, p.y - 6) < r) p.takeDamage(dmg, this, { x, y });
  }

  summonAdds(boss, key, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, r = 44 + Math.random() * 34;
      const x = clamp(boss.x + Math.cos(a) * r, 20, this.zone.pxW - 20);
      const y = clamp(boss.y + Math.sin(a) * r, 20, this.zone.pxH - 20);
      const e = new Enemy(key, Math.max(1, boss.level - 2), x, y);
      e.aggro = true;
      e.nid = this._nextNid++;
      this.enemies.push(e);
      this.particles.burst(x, y - 8, 16, { color: '#9a5fe0', color2: '#e0b8ff', speed: 70, life: 0.5, size: 2, glow: 8 });
    }
    this.toast(t("{a} призывает подмогу!").replace("{a}", t(boss.name)), '#ff9a6a', 2);
  }

  // ════════════════════════════ умения и расходники

  /** Активные умения берутся из рун; слот пустой — умения нет. */
  useSkill(idx) {
    const p = this.player;
    const rune = p.equipment['skill' + (idx + 1)];
    if (p.boon.lockSkill === idx) { audio.play('deny'); this.toast('Слот запечатан алтарём', UI.danger, 1.4); return; }
    if (!rune) { audio.play('deny'); this.toast('Слот умения пуст — вставь руну', UI.textDim, 1.4); return; }
    const def = SKILLS[rune.sub];
    if (!def) return;
    if (p.skillCd[idx] > 0) { audio.play('deny'); return; }
    if (p.mp < rune.cost) { audio.play('deny'); this.toast('Не хватает маны', UI.danger, 1.2); return; }

    const storm = p.hasUnique('stormCrown');
    p.mp -= Math.round(rune.cost * (storm ? 1.25 : 1));
    const echo = p.hasUnique('echoRing') && Math.random() < 0.22;
    p.skillCd[idx] = echo ? 0 : rune.cd * p.cdMult;
    if (echo) this.floats.add(p.x, p.y - 34, 'ЭХО', { color: '#c99cff', size: 10, bold: true });
    p.skillCdMax = p.skillCdMax || [0, 0, 0];
    p.skillCdMax[idx] = p.skillCd[idx];
    p.castT = 0.3;
    audio.play('cast');
    const mul = rune.power * (storm ? 1.3 : 1);
    def.run(this, { power: mul, dmg: skillDamage(p, rune.sub, rune.power) * (storm ? 1.3 : 1), rune });
  }

  // ── универсальные формы урона, которыми пользуются умения

  /** Урон по кругу. opts: knock, crit (шанс сверху), heavy, stun, effect. */
  aoeDamage(x, y, r, dmg, opts = {}) {
    const hit = aoeTargets(this.enemies, x, y, r);
    for (const e of hit) this.applySkillHit(e, dmg, opts, x, y);
    return hit.length;
  }

  /** Урон вдоль луча заданной ширины. */
  lineDamage(x, y, ang, len, halfW, dmg, opts = {}) {
    for (const e of lineTargets(this.enemies, x, y, ang, len, halfW)) {
      this.applySkillHit(e, dmg, opts, x, y);
    }
  }

  applySkillHit(e, dmg, opts, sx, sy) {
    // Прицеливание и бросок крита — в systems/combat.js, одни на игру и стенд.
    const { crit, amount } = skillRoll(this.player, e, dmg, opts, Math.random);
    this.damageEnemy(e, amount, {
      crit, heavy: opts.heavy, knock: opts.knock, from: { x: sx, y: sy },
    });
    if (opts.effect) e.applyEffect(opts.effect[0], opts.effect[1], opts.effect[2], this);
    if (opts.stun) e.stun = Math.max(e.stun || 0, opts.stun * (e.boss ? 0.35 : 1));
    tryShatter(this, e, amount, opts.heavy);
  }

  /** Всплеск реакции: имя, цвет, частицы, звук. Без этого система невидима. */
  /**
   * @param {boolean} [моя=true] — в общем мире реакции случаются и у соседей:
   *   вспышку видно всем, а счётчик и зачёт задания идут тому, кто её вызвал.
   */
  onReaction(e, key, r, моя = true) {
    this.floats.add(e.x, e.y - (e.spr ? e.spr.h * 0.85 : 30), r.name, {
      color: r.color, size: 11, bold: true, crit: true,
    });
    this.particles.burst(e.x, e.y - e.r * 0.7, key === 'steam' ? 34 : 22, {
      color: r.color, color2: '#ffffff', speed: key === 'conduction' ? 150 : 100,
      life: key === 'steam' ? 1.2 : 0.55, size: 2, glow: 10,
      vz: key === 'steam' ? 40 : 60, g: key === 'steam' ? -20 : 120, drag: 1.6,
    });
    this.shake.add(key === 'shatter' ? 6 : 3, 0.22);
    // У каждой реакции свой голос: раньше пять реакций делили три чужих звука.
    audio.play({ conduction: 'bolt', shatter: 'crit', corrosion: 'acid', corrode: 'acid', steam: 'steam' }[key] || 'cast', 0.9);
    if (!моя) return;
    this.player.stats.reactions = (this.player.stats.reactions || 0) + 1;
    if (!net.online) this.quests.onReaction(key, this);
  }

  /** Снаряд от героя в заданном направлении. */
  spawnBolt(ang, dmg, o = {}) {
    this.projectiles.push(new Projectile(boltSpec(this.player, ang, dmg, o)));
  }

  /** Мгновенная молния между двумя точками. */
  bolt(x1, y1, x2, y2, color) {
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.particles.spawn({
        x: x1 + (x2 - x1) * t + (Math.random() - 0.5) * 7,
        y: y1 + (y2 - y1) * t + (Math.random() - 0.5) * 7,
        color, life: 0.22, size: 2, glow: 7,
      });
    }
  }

  potionCount() {
    let n = 0;
    for (const it of this.player.inventory) if (it.kind === 'potion' && it.heal) n += it.count || 1;
    return n;
  }

  quickPotion() {
    const p = this.player;
    const pot = p.inventory.filter((i) => i.kind === 'potion' && i.heal).sort((a, b) => a.heal - b.heal)
      .find((i) => p.maxHp - p.hp >= i.heal * 0.6) ||
      p.inventory.find((i) => i.kind === 'potion' && i.heal);
    if (!pot) { audio.play('deny'); this.toast('Нет зелий', UI.danger, 1.2); return; }
    this.usePotion(pot);
  }

  usePotion(it) {
    const p = this.player;
    // В общем мире пьёт комната: здоровье её, рюкзак её. Клиент до этой правки
    // лечил несуществующее здоровье и вычёркивал вещь из своего списка — а
    // зелье возвращалось на пояс с ближайшим присланным рюкзаком.
    if (net.online) { net.торг({ t: 'potion', id: it.id }); return; }
    if (this.zone.mod && this.zone.mod.noPotions) {
      audio.play('deny');
      this.toast('На этом этаже зелья мертвы', UI.danger, 1.6);
      return;
    }
    if (it.heal) {
      if (p.hp >= p.maxHp) { audio.play('deny'); this.toast('Здоровье полное', UI.textDim, 1); return; }
      p.heal(it.heal);
      this.floats.add(p.x, p.y - 30, '+' + it.heal, { color: '#6fdc8c', size: 11, bold: true });
    } else if (it.mana) {
      if (p.mp >= p.maxMp) { audio.play('deny'); return; }
      p.restoreMp(it.mana);
      this.floats.add(p.x, p.y - 30, '+' + it.mana + ' MP', { color: '#7fb0ff', size: 10 });
    } else if (it.buff) {
      p.buffs[it.buff] = it.dur;
      this.toast(it.name + ' действует', '#f0c05a');
    }
    this.particles.burst(p.x, p.y - 12, 14, { color: it.mana ? '#5fa0ff' : '#6fdc8c', speed: 46, life: 0.5, size: 2, glow: 6, vz: 30, g: 90 });
    audio.play('potion');
    p.removeItem(it, 1);
  }

  useScroll(it) {
    if (this.zone.kind === 'city') { audio.play('deny'); this.toast('Ты и так в городе', UI.textDim); return; }
    this.player.removeItem(it, 1);
    this.toast('Свиток вспыхивает…', '#c99cff');
    this.travel({ kind: 'city' });
  }

  /** Обелиск руин: разовое благословение на 90 секунд. */
  touchObelisk(o) {
    const p = this.player;
    o.used = true;
    o.frames = [o.frames[0]];
    o.anim = false;
    const kind = Math.random() < 0.5 ? 'rage' : 'stone';
    p.buffs[kind] = 90;
    audio.play('level');
    this.hud.showBanner('БЛАГОСЛОВЕНИЕ ДРЕВНИХ', kind === 'rage' ? '+35% урона на 90 сек' : '−35% получаемого урона на 90 сек', '#c99cff');
    this.particles.burst(o.x, o.y - 20, 30, { color: '#c99cff', color2: '#ffffff', speed: 70, life: 0.9, size: 2, glow: 8, vz: 50, g: 60 });
    this.save();
  }

  /** Засады: подходишь к лагерю — из палаток лезут разбойники. */
  updateEvents(dt) {
    const p = this.player;
    for (const ev of this.zone.events || []) {
      if (ev.kind !== 'ambush') continue;
      if (!ev.done) {
        if (dist(p.x, p.y, ev.x, ev.y) > ev.r) continue;
        ev.done = true;
        // В общем мире отряд поднимает комната — здесь остаётся только
        // зрелище. Рождать своих значило бы драться с призраками: комната о
        // них не знает, в снимке их нет, а всё, чего в снимке нет, хоронится.
        if (this.serverRunsCombat) {
          audio.play('boss', 0.5);
          this.shake.add(4, 0.3);
          this.hud.showBanner('ЗАСАДА!', 'лагерь ожил', '#ff7a5e');
          continue;
        }
        const table = BIOMES[this.zone.biomeId].enemies;
        const rng = makeRng((ev.x * 31 + ev.y * 17) | 0);
        for (const s of buildPacks([{ x: ev.x, y: ev.y }, { x: ev.x + 40, y: ev.y + 26 }], table, ev.level, rng)) {
          const e = new Enemy(s.key, s.level, s.x, s.y);
          e.pack = 'ambush'; e.aggro = true;
          e.nid = this._nextNid++;
          this.enemies.push(e);
          ev.enemies.push(e);
          this.particles.burst(e.x, e.y - 8, 12, { color: '#ffb06a', speed: 60, life: 0.5, size: 2, glow: 6 });
        }
        audio.play('boss', 0.5);
        this.shake.add(4, 0.3);
        this.hud.showBanner('ЗАСАДА!', 'лагерь ожил', '#ff7a5e');
      } else if (!ev.rewarded && !this.serverRunsCombat && ev.enemies.every((e) => e.dead)) {
        ev.rewarded = true;
        const rng = makeRng((ev.x * 13 + ev.y * 7) | 0);
        this.spawnLoot(ev.x, ev.y, { item: rollRune(rng, this.zone.level + 2) });
        this.spawnLoot(ev.x + 12, ev.y, { gold: Math.round(60 + this.zone.level * 24) });
        this.toast('Лагерь зачищен — награда твоя', UI.good, 3);
      }
    }
  }

  // ════════════════════════════ подземелье как забег

  /** Перед спуском предлагаем две двери с разными условиями этажа. */
  openDescendChoice(floor) {
    const rng = makeRng((this.worldSeed ^ (floor * 7717)) >>> 0);
    this.pendingDescend = { floor, doors: rollDoors(rng, floor) };
    this.menus.openMode('descend');
  }

  chooseDoor(modKey) {
    const d = this.pendingDescend;
    if (!d) return;
    this.pendingDescend = null;
    this.menus.close();
    this.travel({ kind: 'dungeon', floor: d.floor, mod: modKey });
  }

  /** Алтарь: одна сделка, обратного хода нет. */
  useAltar(altar) {
    const def = ALTARS[altar.altarKey];
    if (!def || altar.used) return;
    this.menus.openMode('altar', { altar, def });
  }

  acceptAltar(altar, def) {
    // Порядок здесь важнее, чем кажется. Раньше первой строкой стояло
    // `altar.used = true`, а следом — обращение к кадрам спрайта; на алтаре без
    // кадров это падало уже после того, как сделка засчиталась. Игрок терял
    // единственную попытку и не получал ничего.
    //
    // Теперь сначала проверка, потом применение, и только в конце — пометка
    // «использован».
    if (!altar || !def || altar.used || typeof def.apply !== 'function') return;
    try {
      def.apply(this);
    } catch (e) {
      this.toast('Алтарь не откликнулся', UI.danger);
      return;
    }
    altar.used = true;
    if (Array.isArray(altar.frames) && altar.frames.length) altar.frames = [altar.frames[0]];
    altar.anim = false;
    this.player.hp = Math.min(this.player.hp, this.player.maxHp);
    this.menus.close();
    audio.play('portal');
    this.hud.showBanner(t(def.name).toUpperCase(), def.gain + ' · ' + def.cost, '#ff8ac0');
    this.particles.burst(altar.x, altar.y - 14, 34, {
      color: '#c05fd0', color2: '#ffb0d0', speed: 90, life: 0.9, size: 2, glow: 9, vz: 50, g: 70,
    });
  }

  grantAltarRune(rarity) {
    const rng = makeRng((this.time * 1000) | 0);
    const it = rollRune(rng, this.player.level, rarity, this.zone.maxRarity);
    if (this.player.addItem(it)) this.toast('Получено: ' + it.name, RARITY[rarity].color, 3);
    else this.spawnLoot(this.player.x, this.player.y, { item: it });
  }

  grantAltarItem() {
    const rng = makeRng(((this.time * 1000) | 0) ^ 0x51ed);
    const rarity = capRarity(rng() < 0.35 ? 'epic' : 'rare', this.zone.maxRarity);
    const it = makeItem({ kind: rng.pick(['weapon', 'armor', 'helm', 'trinket']), level: this.player.level + 3, rarity, rng, luck: 4 });
    if (this.player.addItem(it)) this.toast('Получено: ' + it.name, RARITY[rarity].color, 3);
    else this.spawnLoot(this.player.x, this.player.y, { item: it });
  }

  // ── срабатывания легендарных свойств
  proc(hook, ctx) {
    for (const u of this.player.uniques(hook)) {
      if (u.run) u.run(this, ctx || {});
    }
  }

  // ════════════════════════════ кузня

  spendRecipe(recipe) {
    const p = this.player;
    p.gold -= recipe.gold;
    for (const k in recipe.mats) if (recipe.mats[k]) p.consumeMaterial(k, recipe.mats[k]);
  }

  craft(recipe) {
    const p = this.player;
    if (net.online) { net.торг({ t: 'craft', cat: recipe.cat, sub: recipe.sub || null, idx: recipe.idx }); return; }
    if (!canAfford(p, recipe)) { audio.play('deny'); this.toast('Не хватает материалов', UI.danger); return; }
    if (p.level < recipe.lvl) { audio.play('deny'); this.toast(`Нужен уровень ${recipe.lvl}`, UI.danger); return; }
    if (p.inventory.length >= p.invSize) { audio.play('deny'); this.toast('Рюкзак полон', UI.danger); return; }
    this.spendRecipe(recipe);
    const it = craftItem(p, recipe);
    p.addItem(it);
    audio.play('forge');
    const rar = RARITY[it.rarity] || RARITY.common;
    this.hud.showBanner('ВЫКОВАНО', it.name, rar.color);
    this.particles.burst(p.x, p.y - 12, 20, { color: '#ffd66a', color2: '#fff6c8', speed: 60, life: 0.6, size: 2, glow: 7 });
    this.quests.onCraft(this);
    this.save();
  }

  /** Разбор: предмет в материалы. Единственный способ добыть руду пачками. */
  salvage(item) {
    const p = this.player;
    if (net.online) { net.торг({ t: 'salvage', id: item.id }); return; }
    const y = salvageYield(item);
    p.removeItem(item, item.count || 1);
    p.gold += y.gold;
    const got = [];
    for (const k in y.mats) { p.addItem(makeMaterial(k, y.mats[k])); got.push(matName(k) + '×' + y.mats[k]); }
    audio.play('salvage');
    this.toast('Разобрано: ' + (got.join(', ') || 'пусто') + (y.gold ? `, +${y.gold} зол.` : ''), UI.good, 3);
  }

  /** Переплавка: та же вещь, но аффиксы бросаются заново. */
  reforge(item) {
    const p = this.player;
    if (net.online) { net.торг({ t: 'reforge', id: item.id }); return; }
    const cost = reforgeCost(item);
    if (p.gold < cost.gold) { audio.play('deny'); this.toast('Не хватает золота', UI.danger); return; }
    for (const k in cost.mats) if (p.countMaterial(k) < cost.mats[k]) { audio.play('deny'); this.toast('Не хватает материалов', UI.danger); return; }
    this.spendRecipe(cost);
    // уникум передаём внутрь, иначе легендарка получит имя чужого свойства
    const fresh = makeItem({ kind: item.kind, sub: item.sub, tier: item.tier,
                             level: item.level, rarity: item.rarity, unique: item.unique });
    const slot = p.slotOf(item);
    const wasEquipped = slot && p.equipment[slot] === item;
    // заточка переносится: её оплачивали риском, терять её при переплавке нечестно.
    // Уникальное свойство сохраняется — иначе переплавкой можно было бы
    // за бесценок перебирать легендарные свойства, ради которых и точат до +7.
    // Для нелегендарок (свойство пришло вехой +7) makeItem его не ставит — копируем.
    if (item.unique && !fresh.unique) { fresh.unique = item.unique; fresh.desc = item.desc; }
    for (let i = 0; i < (item.sharp || 0); i++) applySharpen(fresh);
    if (wasEquipped) { p.equipment[slot] = fresh; p.refreshSprites(); }
    else { p.removeItem(item, 1); p.addItem(fresh); }
    p._setsKey = null;
    audio.play('forge');
    this.hud.showBanner('ПЕРЕПЛАВЛЕНО', fresh.name, (RARITY[fresh.rarity] || RARITY.common).color);
    this.save();
  }

  /**
   * Заточка. Основное оружие + три оружия той же редкости сгорают всегда;
   * при неудаче вместе с ними сгорает и само оружие.
   */
  /**
   * Заточка. `picked` — топливо, выбранное игроком в кузне.
   *
   * Раньше топливо подбиралось прямо здесь, и выбора не было вовсе. Теперь
   * выбор пришёл из интерфейса, но доверять ему нельзя: между выбором и
   * нажатием игрок мог вещь продать, надеть или разобрать. Поэтому каждую
   * проверяем заново по тому же правилу, а если не осталось трёх годных —
   * молча не докладываем из автоподбора, а отказываем: сжечь не то, что
   * человек видел в слотах, хуже, чем не сжечь ничего.
   */
  sharpen(picked) {
    const p = this.player;
    const base = p.equipment.weapon;
    if (net.online) {
      // Топливо называем номерами: годность каждого проверит комната — у неё
      // настоящий рюкзак. И бросок «удалось или нет» тоже её: иначе удачу
      // объявлял бы тот, кому она выгодна.
      const fuel = (picked || sharpenFuel(p, base) || []).slice(0, 3).map((i) => i.id);
      net.торг({ t: 'sharpen', fuel });
      return;
    }
    if (!base) { audio.play('deny'); this.toast('Надень оружие', UI.danger); return; }
    if ((base.sharp || 0) >= SHARP_MAX) { audio.play('deny'); this.toast('Дальше точить некуда', UI.textDim); return; }
    const годно = (i) => i && i.kind === 'weapon' && i.rarity === base.rarity && i !== base && p.inventory.includes(i);
    const fuel = picked ? picked.filter(годно) : sharpenFuel(p, base);
    if (picked && fuel.length < picked.length) { audio.play('deny'); this.toast('Топливо изменилось — выбери заново', UI.danger, 2); return; }
    if (fuel.length < 3) { audio.play('deny'); this.toast('Нужно три оружия той же редкости', UI.danger, 2); return; }
    const cost = sharpenCost(base);
    if (p.gold < cost.gold) { audio.play('deny'); this.toast('Не хватает золота', UI.danger); return; }
    for (const k in cost.mats) if (cost.mats[k] && p.countMaterial(k) < cost.mats[k]) { audio.play('deny'); this.toast('Не хватает материалов', UI.danger); return; }

    const chance = sharpenChance(base);
    this.spendRecipe(cost);
    for (const f of fuel) p.removeItem(f, 1);

    if (Math.random() < chance) {
      const gained = applySharpen(base);
      p.refreshSprites();
      audio.play('sharpen');
      this.hud.showBanner('ЗАТОЧКА УДАЛАСЬ', base.name, '#ffd54a');
      this.particles.burst(p.x, p.y - 14, 40, { color: '#ffd54a', color2: '#ffffff', speed: 110, life: 1, size: 2, glow: 9, vz: 60, g: 90 });
      this.shake.add(4, 0.3);
      if (gained.length) {
        audio.play('quest');
        this.toast('Веха: ' + gained.join(', '), '#ffd54a', 4);
        this.particles.burst(p.x, p.y - 14, 50, { color: '#ffffff', color2: '#ff9d3a', speed: 150, life: 1.4, size: 3, glow: 14, vz: 90, g: 60 });
      }
    } else if (revertToMilestone(base)) {
      // ниже первой вехи оружие гибнет, выше — откатывается к ней: закалка уже оплачена
      p.refreshSprites();
      audio.play('sharpenFail');
      this.hud.showBanner('ЗАТОЧКА СОРВАЛАСЬ', 'откат к вехе +' + base.sharp, '#e0a03d');
      this.particles.burst(p.x, p.y - 14, 30, { color: '#e0a03d', color2: '#6a5a3a', speed: 90, life: 0.9, size: 2, g: 160, vz: 60 });
      this.shake.add(5, 0.35);
    } else {
      p.equipment.weapon = null;
      p.refreshSprites();
      audio.play('shatterItem');
      this.hud.showBanner('МЕТАЛЛ НЕ ВЫДЕРЖАЛ', 'оружие рассыпалось', '#e0484f');
      this.particles.burst(p.x, p.y - 14, 40, { color: '#8a8a9a', color2: '#3a3a4a', speed: 90, life: 1.1, size: 2, g: 200, vz: 70 });
      this.shake.add(8, 0.5);
    }
    p._setsKey = null;
    this.save();
  }

  /** Три одинаковые руны + золото → одна руна следующего ранга. */
  fuseRunes(group) {
    const p = this.player;
    if (net.online) { net.торг({ t: 'fuse', ids: group.items.slice(0, 3).map((i) => i.id) }); return; }
    if (group.items.length < 3) { audio.play('deny'); return; }
    const next = RARITY_ORDER[RARITY_ORDER.indexOf(group.rarity) + 1];
    if (!next) { audio.play('deny'); return; }
    const cost = fuseCost(group.rarity, p.level);
    if (p.gold < cost) { audio.play('deny'); this.toast('Не хватает золота', UI.danger); return; }

    p.gold -= cost;
    const lvl = Math.max(...group.items.map((i) => i.level || 1));
    for (let i = 0; i < 3; i++) p.removeItem(group.items[i], 1);
    const made = makeRune(group.sub, next, lvl);
    p.addItem(made);
    audio.play('fuse');
    this.hud.showBanner('СЛИЯНИЕ', made.name + ' · ' + (RARITY[next] || {}).name, (RARITY[next] || {}).color);
    this.save();
  }

  /**
   * Взять задание. В общем мире решает комната: она же ведёт ход и выдаёт
   * награду. Клиент раньше выдавал её сам, и сверка с миром стирала её через
   * три кадра — 120 золота обратно в 40.
   */
  acceptQuest(q) {
    if (net.online) { net.торг({ t: 'quest', do: 'accept', id: q.id }); return; }
    this.quests.accept(q, this);
  }

  /** Сдать задание — там же, где его вели. */
  completeQuest(q) {
    if (net.online) { net.торг({ t: 'quest', do: 'complete', id: q.id }); return; }
    this.quests.complete(q, this);
  }

  /**
   * Сказанное вслух.
   *
   * Реплика вешается на говорящего и гаснет сама. Своя — на себя: без этого
   * непонятно, ушло ли сказанное вообще.
   */
  услышал(m) {
    if (!m.ok) { audio.play('deny'); this.toast(m.why || 'не сказалось', UI.textDim, 1.5); return; }
    const до = this.time + 5;
    if (m.pid === net.pid) { this.свояРеплика = { text: m.text, до }; }
    else {
      const о = (this._others || []).find((x) => x.pid === m.pid);
      (this._реплики ||= new Map()).set(m.pid, { text: m.text, до });
      if (о) { о.реплика = m.text; о.репликаДо = до; }
    }
    audio.play('ui', 0.7);
  }

  /** Журнал, каким его ведёт мир. Свой ход клиент в общем мире не считает. */
  /**
   * Обновить журнал — если он вообще наш.
   *
   * В общем мире журнал ведёт комната: она открывает задания по уровню, она же
   * добирает контракты, и она присылает готовое. Клиенту здесь делать нечего.
   *
   * Правило стоит одно на все случаи нарочно. Сначала оно было расставлено по
   * местам вызова, и двух из пяти не хватило: у капитана и на взятом уровне
   * клиент открывал задания сам. Игрок видел «доступно» и получал красный отказ
   * «нет такого задания» на «Принять». Пять охран в пяти местах — это четыре
   * шанса забыть про пятое.
   */
  обновитьЖурнал(p = this.player) {
    if (net.online) return;
    this.quests.refresh(p);
  }

  /**
   * Вложить очко развития.
   *
   * В общем мире стат ведёт комната: очки даёт уровень, а уровень даёт она.
   * Клиент до этой правки поднимал стат у себя, и через миг `applyMe` возвращал
   * очки на место — игрок жал «+» снова и снова, видя рост, которого нет.
   *
   * Правило одно на все места вызова: одна охрана вместо охраны у каждой
   * кнопки. С журналом заданий этот урок уже был — там из пяти мест не хватило
   * двух.
   */
  вложитьОчко(k) {
    if (net.online) { net.торг({ t: 'stat', k }); return true; }
    return this.player.spendStat(k);
  }

  /**
   * Открыть спуск, если страж уже повержен.
   *
   * Лестница вниз на боссовом этаже заперта до его смерти, а замок снимало
   * только событие убийства — то есть лишь у того, кто при этом был. Пришёл на
   * этаж, где стража уже положили и он ждёт возвращения, — и спуск заперт
   * стражем, которого на этаже нет. Комната теперь говорит это при входе.
   */
  применитьСтража(msg) {
    const с = msg && msg.страж;
    if (!с || !с.побеждён) return;
    if (this.zone && this.zone.downExit) this.zone.downExit.locked = false;
  }

  applyQuests(m) {
    if (!net.online || !m || !m.quests) return;
    this.quests.fromJSON(m.quests);
  }

  /** Ответ мира на «взять» или «сдать». */
  дошлоЗадание(m) {
    if (!m.ok) { audio.play('deny'); this.toast(m.why || 'не вышло', UI.danger, 2.5); return; }
    if (m.act === 'accept') { audio.play('quest'); this.toast('Задание принято: ' + t(m.name), '#f0c05a'); return; }
    audio.play('level');
    this.hud.showBanner('ЗАДАНИЕ ВЫПОЛНЕНО', t(m.name), '#f0c05a');
    if (m.gold || m.xp) this.toast(`+${m.xp || 0} опыта, +${m.gold || 0} золота`, UI.gold, 3);
    for (const в of m.вести || []) if (в.startsWith('на земле')) this.toast(в, UI.danger, 3);
  }

  /**
   * Ответ мира на намерение из лавки или кузни.
   *
   * Само действие уже случилось (или не случилось) на сервере — здесь только
   * то, что видит и слышит игрок. Отказ обязателен: без причины игрок не
   * поймёт, чего не хватило.
   */
  дошлаСделка(m) {
    if (!m.ok) { audio.play('deny'); this.toast(m.why || 'не вышло', UI.danger, 2.5); return; }
    const p = this.player;
    const цвет = (RARITY[m.rarity] || RARITY.common).color;
    switch (m.act) {
      case 'buy': audio.play('buy'); this.toast('Куплено: ' + t(m.name), цвет); break;
      case 'sell': audio.play('coin'); this.toast('+' + m.gold + ' золота', UI.gold); break;
      case 'salvage': audio.play('salvage'); this.toast('Разобрано: ' + t(m.name) + (m.gold ? `, +${m.gold} зол.` : ''), UI.good, 3); break;
      case 'craft':
        audio.play('forge');
        this.hud.showBanner('ВЫКОВАНО', t(m.name), цвет);
        this.particles.burst(p.x, p.y - 12, 20, { color: '#ffd66a', color2: '#fff6c8', speed: 60, life: 0.6, size: 2, glow: 7 });
        // Ход задания «выковать» комната отметила у себя и пришлёт журналом.
        break;
      case 'reforge': audio.play('forge'); this.hud.showBanner('ПЕРЕПЛАВЛЕНО', t(m.name), цвет); break;
      case 'fuse': audio.play('fuse'); this.hud.showBanner('СЛИЯНИЕ', t(m.name), цвет); break;
      case 'sharpen':
        if (m.what === 'заточено') {
          audio.play('sharpen');
          this.hud.showBanner('ЗАТОЧКА УДАЛАСЬ', t(m.name), '#ffd54a');
          this.particles.burst(p.x, p.y - 14, 40, { color: '#ffd54a', color2: '#ffffff', speed: 110, life: 1, size: 2, glow: 9, vz: 60, g: 90 });
          this.shake.add(4, 0.3);
          if (m.gained && m.gained.length) { audio.play('quest'); this.toast('Веха: ' + m.gained.join(', '), '#ffd54a', 4); }
        } else if (m.what === 'откат') {
          audio.play('sharpenFail');
          this.hud.showBanner('ЗАТОЧКА СОРВАЛАСЬ', 'откат к вехе +' + (m.sharp || 0), '#e0a03d');
          this.shake.add(5, 0.35);
        } else {
          audio.play('shatterItem');
          this.hud.showBanner('МЕТАЛЛ НЕ ВЫДЕРЖАЛ', 'оружие рассыпалось', '#e0484f');
          this.shake.add(8, 0.5);
        }
        break;
      default: break;
    }
  }

  buyItem(shop, it, price) {
    const p = this.player;
    // В общем мире торгует комната: у неё ассортимент, золото и рюкзак.
    // Клиент называет только прилавок и место в нём — цену он мог бы и
    // придумать.
    if (net.online) { net.торг({ t: 'buy', npc: shop.npcId, slot: it.slot }); return; }
    if (p.gold < price) { audio.play('deny'); this.toast('Не хватает золота', UI.danger); return; }
    if (p.inventory.length >= p.invSize && !it.stack) { audio.play('deny'); this.toast('Рюкзак полон', UI.danger); return; }
    p.gold -= price;
    const copy = it.stack ? makeConsumable(it.key, 1) : it;
    p.addItem(copy);
    if (!it.stack) shop.stock.splice(shop.stock.indexOf(it), 1);
    audio.play('buy');
    this.toast('Куплено: ' + it.name, (RARITY[it.rarity] || RARITY.common).color);
    this.save();
  }

  sellItem(it, price) {
    const p = this.player;
    if (net.online) { net.торг({ t: 'sell', id: it.id }); return; }
    p.gold += price;
    p.removeItem(it, it.count || 1);
    audio.play('coin');
    this.toast('+' + price + ' золота', UI.gold);
  }

  // ════════════════════════════ события

  onLevelUp(n) {
    const p = this.player;
    this.hud.showBanner('УРОВЕНЬ ' + p.level, `+${n * 3} очков развития (клавиша C)`, '#6fdc8c');
    this.floats.add(p.x, p.y - 34, 'УРОВЕНЬ ' + p.level, { color: '#8ff0b0', size: 13, bold: true, vy: -30, life: 1.6 });
    this.particles.burst(p.x, p.y - 12, 46, {
      color: '#8ff0b0', color2: '#ffffff', speed: 90, life: 0.9, size: 2, glow: 8, vz: 70, g: 120,
    });
    this.shake.add(3, 0.3);
    this.обновитьЖурнал(p);
    this.save();
  }

  onQuestComplete(q, item) {
    this.hud.showBanner('ЗАДАНИЕ ВЫПОЛНЕНО', q.title, '#f0c05a');
    this.toast(`+${q.xp} опыта, +${q.gold} золота`, UI.gold, 3);
    if (item) this.toast('Награда: ' + item.name, (RARITY[item.rarity] || RARITY.common).color, 3.4);
    this.save();
  }

  onPlayerDeath() {
    const p = this.player;
    this.deathPenalty = Math.floor(p.gold * 0.12);
    p.gold -= this.deathPenalty;
    this.shake.add(10, 0.7);
    setTimeout(() => { if (p.dead) this.menus.mode = 'death'; }, 1100);
  }

  respawn() {
    const p = this.player;
    p.dead = false;
    p.hp = p.maxHp;
    p.mp = p.maxMp;
    p.effects = {};
    p.pose = 'idle';
    p.iframe = 1.4;
    this.menus.close();
    this.transition = { t: 0, phase: 'out', dest: { kind: 'city' } };
  }

  toast(msg, color, dur) { this.hud.toast(msg, color, dur); }

  // ════════════════════════════ взаимодействия

  updateInteractions() {
    const p = this.player;
    this.prompt = null;
    if (p.dead || this.menus.blocking) return;
    let best = null, bd = 44 * 44;

    // NPC
    for (const n of this.zone.npcs) {
      const d = dist2(p.x, p.y, n.x, n.y);
      if (d < bd) { bd = d; best = { kind: 'npc', npc: n, label: `${n.name}`, color: UI.accent }; }
    }
    // сундуки
    for (const c of this.zone.chests) {
      if (c.opened) continue;
      const d = dist2(p.x, p.y, c.x, c.y);
      if (d < bd) { bd = d; best = { kind: 'chest', chest: c, label: 'Открыть сундук', color: '#ffd970' }; }
    }
    // обелиск руин
    for (const o of this.zone.obelisks || []) {
      if (o.used) continue;
      const d = dist2(p.x, p.y, o.x, o.y);
      if (d < bd) { bd = d; best = { kind: 'obelisk', obelisk: o, label: 'Коснуться обелиска', color: '#c99cff' }; }
    }
    // алтарь
    for (const a of this.zone.altars || []) {
      if (a.used) continue;
      const d = dist2(p.x, p.y, a.x, a.y);
      if (d < bd) { bd = d; best = { kind: 'altar', altar: a, label: ALTARS[a.altarKey].name, color: '#ff8ac0' }; }
    }
    // костёр
    if (this.zone.campfire) {
      const d = dist2(p.x, p.y, this.zone.campfire.x, this.zone.campfire.y);
      if (d < bd) { bd = d; best = { kind: 'campfire', label: 'Передохнуть у костра', color: '#ffa64a' }; }
    }
    // переходы
    for (const e of this.zone.exits) {
      if (!rectHit(p.x - 5, p.y - 8, 10, 8, e.x, e.y, e.w, e.h)) continue;
      const locked = (e.requireLevel && p.level < e.requireLevel) || e.locked;
      best = {
        kind: 'exit', exit: e,
        label: locked ? (e.locked ? 'Закрыто: страж ещё жив' : `Нужен уровень ${e.requireLevel}`) : e.label,
        color: locked ? UI.danger : '#9fe0ff',
      };
      bd = 0;
    }

    if (best) {
      this.prompt = { label: best.label, key: 'E', color: best.color };
      if (input.consume('interact')) this.interact(best);
    }
  }

  interact(target) {
    const p = this.player;
    if (target.kind === 'exit') {
      // спуск изнутри катакомб — сначала выбор двери
      const dst = target.exit.dest;
      if (dst.kind === 'dungeon' && this.zone.kind === 'dungeon' && !target.exit.locked) {
        this.openDescendChoice(dst.floor);
      } else this.travel(dst, target.exit);
    } else if (target.kind === 'obelisk') {
      this.touchObelisk(target.obelisk);
    } else if (target.kind === 'altar') {
      this.useAltar(target.altar);
    } else if (target.kind === 'chest') {
      this.openChest(target.chest);
    } else if (target.kind === 'campfire') {
      p.hp = p.maxHp; p.mp = p.maxMp;
      p.effects = {};
      this.particles.burst(p.x, p.y - 10, 26, { color: '#ffc46a', speed: 44, life: 0.8, size: 2, glow: 8, vz: 40, g: 60 });
      audio.play('level');
      this.toast('Силы восстановлены', UI.good);
      this.save();
    } else if (target.kind === 'npc') {
      this.talkTo(target.npc);
    }
  }

  openChest(c) {
    c.opened = true;
    c.frames = [PROPS.chestOpen];
    audio.play('chest');
    this.particles.burst(c.x, c.y - 10, 30, { color: '#ffd970', color2: '#fff6c0', speed: 60, life: 0.8, size: 2, glow: 9, vz: 60, g: 110 });
    const rng = makeRng((c.x * 7 + c.y * 13 + this.worldSeed) | 0);
    const lvl = Math.max(1, this.zone.level);
    this.spawnLoot(c.x, c.y - 4, { gold: Math.round((22 + lvl * 9) * (0.8 + rng())) });
    const n = (c.rich ? 2 : 1) + (rng() < 0.45 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      this.spawnLoot(c.x, c.y - 4, {
        item: makeItem({ kind: rng.pick(['weapon', 'armor', 'helm', 'trinket']), level: lvl + rng.int(0, 2), rng, luck: 4,
                        rarity: capRarity(rollRarity(rng, 3), this.zone.maxRarity) }),
      });
    }
    if (rng() < 0.6) this.spawnLoot(c.x, c.y - 4, { item: makeConsumable(rng.pick(['potionS', 'potionM', 'manaS']), 1) });
    if (rng() < (c.rich ? 0.9 : 0.22)) this.spawnLoot(c.x, c.y - 4, { item: rollRune(rng, lvl, c.rich ? 'epic' : null) });
    this.toast('Сундук открыт', '#ffd970');
  }

  talkTo(npc) {
    // Из игры сюда попадают только через `interact`, где собеседник уже найден
    // по близости. Но функция не должна падать от пустого довода: обезьяний
    // прогон звал её в зонах без жителей и валил игру на первом же шаге.
    if (!npc || !npc.lines || !npc.lines.length) return;
    const p = this.player;
    const line = npc.lines[(Math.random() * npc.lines.length) | 0];
    const options = [];

    if (npc.shop === 'runes') {
      options.push({ label: 'Слияние рун', action: () => this.menus.openMode('fuse') });
    }
    if (npc.smith) {
      options.push({ label: 'Кузня', action: () => this.menus.openMode('craft') });
    }
    if (npc.shop) {
      options.push({
        label: 'Торговля', action: () => {
          // заголовок хранится как есть: переводить надо до подъёма регистра,
          // иначе в словаре пришлось бы держать ещё и версию капсом
          //
          // В общем мире ассортимент — состояние комнаты: там купленное
          // исчезает с прилавка, и второй раз то же самое не купить. Открываем
          // пустую лавку и просим список; он придёт сообщением `shop`.
          if (net.online) {
            this.menus.openMode('shop', { title: npc.name, stock: [], npc, npcId: npc.shop });
            net.торг({ t: 'shop', npc: npc.shop });
            return;
          }
          const stock = rollShopStock(npc.shop, p.level, (this.shopSeed + p.level * 31 + npc.id.length) | 0);
          this.menus.openMode('shop', { title: npc.name, stock, npc, npcId: npc.shop });
        },
      });
    }
    if (npc.trainer) {
      options.push({
        label: p.statPoints > 0 ? `Развитие (${p.statPoints})` : 'Развитие',
        action: () => { this.menus.openJournal('character'); },
      });
      options.push({
        label: 'Сбросить очки (200з)',
        disabled: p.gold < 200 || (p.str + p.vit + p.agi + p.int) <= 20,
        action: () => this.respec(),
      });
    }
    if (npc.quests) {
      options.push({ label: 'Задания', action: () => { this.обновитьЖурнал(p); this.menus.openJournal('quests'); } });
    }
    if (npc.portalMaster) {
      options.push({ label: 'Открыть врата', action: () => this.menus.openMode('portal') });
    }
    options.push({ label: 'Уйти', action: () => this.menus.close() });

    this.menus.openMode('dialogue', { name: npc.name, title: npc.title, line, options, npc });
  }

  respec() {
    const p = this.player;
    if (p.gold < 200) { audio.play('deny'); return; }
    p.gold -= 200;
    const total = p.str + p.vit + p.agi + p.int - 20;
    p.str = p.vit = p.agi = p.int = 5;
    p.statPoints += total;
    p.hp = Math.min(p.hp, p.maxHp);
    audio.play('level');
    this.toast(`Очки сброшены: ${total} доступно`, UI.good);
    this.menus.openJournal('character');
  }

  // ════════════════════════════ обновление

  update(dt) {
    this.time += dt;
    audio.update(dt);
    if (input.consume('profiler')) {
      const on = profiler.toggle();
      this.toast(on ? 'Профайлер включён' : 'Профайлер выключен', UI.textDim, 1.4);
    }
    // Музыка слышит бой: считаем не всех врагов в зоне, а тех, кто уже заметил
    // героя и стоит достаточно близко, чтобы это был бой, а не пейзаж.
    // Босс один тянет напряжение на максимум — он и есть событие.
    if (this.state === 'play' && this.zone) {
      let жар = 0;
      for (const e of this.enemies) {
        if (e.dead || !e.aggro) continue;
        const d = dist(e.x, e.y, this.player.x, this.player.y);
        if (d > 190) continue;
        жар += e.boss ? 1 : e.elite ? 0.34 : 0.16;
      }
      audio.setIntensity(this.player.dead ? 0 : Math.min(1, жар));
    }
    this.menus.update(dt, input);
    this.hud.update(dt, this);

    if (this.state === 'title') { input.endFrame(); return; }

    // обучение: проверяем не каждый кадр — условия дешёвые, но их два десятка
    this._lessonT = (this._lessonT || 0) - dt;
    this._lessonGap = Math.max(0, (this._lessonGap || 0) - dt);
    if (this._lessonT <= 0) {
      this._lessonT = 0.5;
      // ── тишина между карточками
      //
      // Условие «нет карточки на экране» пропускало следующую через полсекунды
      // после ухода прежней, то есть подсказки шли встык. Замер входа показал,
      // чем это оборачивается для новичка: три карточки за девятнадцать секунд —
      // руны, связка ударов, редкость, — и всё это в первом же бою, где он и так
      // занят. Первую не дочитывают: её сменяет вторая.
      //
      // Пауза считается от ухода карточки, а не от её появления. Иначе игрок,
      // закрывший подсказку раньше времени, получал бы следующую мгновенно —
      // нетерпеливого наказывать очередью не за что.
      if (!this.hud.lessons.length && this._lessonGap <= 0) {
        const l = nextLesson(this, this.seenLessons);
        if (l) {
          this.seenLessons[l.key] = 1;
          // Текст карточки может зависеть от того, чем играют: на телефоне
          // рассказывать про WASD незачем. Разрешаем его здесь, чтобы дальше по
          // дороге — в отрисовку, в перевод, в журнал — уходила обычная строка.
          this.hud.showLesson({ ...l, body: typeof l.body === 'function' ? l.body(this) : l.body });
          this._lessonGap = LESSON_GAP + this.hud.lessons[0].life;
          audio.play('ui', 1.2);
          this.save();
        }
      }
    }

    // переход между зонами
    if (this.transition) {
      const tr = this.transition;
      tr.t += dt;
      if (tr.phase === 'out' && tr.t >= 0.32) { this.doTravel(tr.dest); tr.phase = 'in'; tr.t = 0; }
      else if (tr.phase === 'in' && tr.t >= 0.4) this.transition = null;
    }

    if (this.hitStop > 0) { this.hitStop -= dt; dt *= 0.18; }

    const paused = this.menus.blocking;
    const p = this.player;

    // Свои числа сверяем с миром всегда, пока мы в нём: и в городе — торгуют
    // именно там, а бой комната считает только вне города, — и при открытом
    // окне. Под паузой сверка замирала ровно тогда, когда числа тратят: в
    // лавке клиент показывал 80 золота, мир знал про 44.
    this.applyMe();

    // Разговор: «T» начинает строку, Enter отправляет, Esc бросает. Пока
    // печатают, клавиши в игру не идут — это делает сам `input`.
    if (net.online && !paused && !input.набор && input.consume('say')) {
      input.набор = { text: '' };
      input.onSay = (текст) => { if (текст && текст.trim()) net.say(текст); };
    }

    // ── сеть: ввод туда, сверка обратно
    //
    // Своего героя двигает по-прежнему клиент — иначе каждое нажатие ждало бы
    // круга до сервера. Сюда уходит намерение, а `reconcile` подтягивает героя
    // к тому, где его видит комната, переигрывая неучтённые шаги.
    //
    // Не под паузой. Раньше блок стоял внутри неё, и открытое окно означало
    // молчание: комната отключает молчунов через пятнадцать секунд, то есть
    // достаточно было задержаться в лавке или в журнале, чтобы вылететь из
    // мира. Под паузой герой стоит — значит и шаг уходит нулевой.
    if (net.online && this.zone) {
      const ax = paused ? { x: 0, y: 0 } : input.axis();
      net.sendInput(dt, ax.x, ax.y, p.facing || 0);
      net.reconcile(this.zone, p, p.moveSpeed);
      // Здоровье приходит тем же снимком, что и положение. Считает его комната,
      // и до этой правки клиент его просто не читал: полоса стояла полной, пока
      // героя убивали.
      this.applyMyHealth();
      this._others = net.others();
      // Реплики живут своей жизнью: список соседей пересобирается каждый кадр,
      // а сказанное должно висеть пять секунд.
      if (this._реплики) {
        for (const о of this._others) {
          const р = this._реплики.get(о.pid);
          if (р && this.time < р.до) { о.реплика = р.text; о.репликаДо = р.до; }
          else if (р) this._реплики.delete(о.pid);
        }
      }
    } else if (this._others && this._others.length) {
      this._others = [];
    }

    if (!paused && !this.transition) {
      p.update(dt, this);


      // ── враги: свои или комнатные
      //
      // В общем мире врагов считает комната, и клиенту незачем водить их ИИ
      // второй раз — иначе на экране будет один враг, а бить придётся другого.
      // Зато сами `Enemy` остаются: зона у клиента построена тем же
      // генератором и тем же сидом, порядок в списке совпадает, и снимок
      // ссылается ровно на этот индекс. Поэтому мы не выдумываем новые
      // сущности, а подтягиваем положение и здоровье к тому, что видит сервер:
      // спрайты, сортировка по глубине и вся отрисовка работают как прежде.
      if (this.serverRunsCombat) {
        this.applyEnemySnapshot();
        // `deadT` копит только `Enemy.update`, которого здесь нет, — и труп
        // навсегда оставался с нулём: непрозрачный, в полный рост, от живого
        // не отличить, а ударить нельзя. Стоял до самого возрождения номера.
        for (const e of this.enemies) if (e.dead) e.deadT += dt;
      } else {
        for (const e of this.enemies) e.update(dt, this);
      }
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        if (e.dead && e.deadT > 1.2) this.enemies.splice(i, 1);
      }
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const pr = this.projectiles[i];
        pr.update(dt, this);
        if (pr.dead) this.projectiles.splice(i, 1);
      }
      this.updateHazards(dt);
      this.updateEvents(dt);
      this.updateLoot(dt);
      this.updateBossTrigger();
      this.updateInteractions();
      this.updateShaftDust(dt);

      this.autosaveT += dt;
      if (this.autosaveT > 45) { this.autosaveT = 0; this.save(); }
    }

    // визуальные системы идут всегда
    this.particles.update(dt);
    this.floats.update(dt);
    this.weather.update(dt, this.view.w, this.view.h);
    this.shake.update(dt);
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      this.slashes[i].t += dt;
      if (this.slashes[i].t > this.slashes[i].dur) this.slashes.splice(i, 1);
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      this.decals[i].life -= dt;
      if (this.decals[i].life <= 0) this.decals.splice(i, 1);
    }

    this.updateCamera(dt, paused);
    input.endFrame();
  }

  updateCamera(dt, paused) {
    const p = this.player;
    const z = this.zone;

    // Подглядывание за курсором сглаживаем отдельно и округляем до целого:
    // именно оно должно плыть, а не камера относительно героя.
    let wantX = 0, wantY = 0;
    if (!paused && this.aimByMouse) {
      wantX = (input.mouse.x - this.view.w / 2) * 0.16;
      wantY = (input.mouse.y - this.view.h / 2) * 0.16;
    }
    this._peekX = damp(this._peekX || 0, wantX, 6, dt);
    this._peekY = damp(this._peekY || 0, wantY, 6, dt);

    // Камера держит героя без отставания. Пружина давала расхождение в доли
    // пикселя между спрайтом и фоном: округлялись они независимо, и при ровной
    // ходьбе герой дёргался относительно земли на ±1 пиксель — экран «трясло».
    // Отставание оставлено только для дальних скачков (вход в зону, телепорт).
    const cx = p.x - this.view.w / 2 + Math.round(this._peekX);
    const cy = p.y - 10 - this.view.h / 2 + Math.round(this._peekY);
    // Пружины тут нет вовсе. Порог «догонять, если далеко» был бы хуже самой
    // проблемы: на границе камера прыгала бы разом на полсотни пикселей.
    // Дальние переносы и так ставят камеру напрямую — в enterZone.
    this.cam.x = cx;
    this.cam.y = cy;
    this.cam.x = clamp(this.cam.x, 0, Math.max(0, z.pxW - this.view.w));
    this.cam.y = clamp(this.cam.y, 0, Math.max(0, z.pxH - this.view.h));
  }

  /** Длящиеся зоны на земле от умений: огонь, яд. Бьют только врагов. */
  updateHazards(dt) {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.life -= dt;
      if (h.life <= 0) { this.hazards.splice(i, 1); continue; }
      h.tick -= dt;
      if (h.tick <= 0) {
        h.tick = 0.5;
        // Враждебные опасности бьют героя, а не врагов: это местность Пролома,
        // а не наша лужа кислоты. Мобы по ней ходят свободно — разлом их родня.
        if (h.hostile) {
          const p = this.player;
          // Рывок проносит сквозь: игра уже научила, что рывок — это уход
          // от урона, и здесь это честный приём, а не дыра. Полсекунды между
          // тиками как раз хватает, чтобы пересечь выброс на рывке без потерь.
          if (p.dashT > 0) { /* проскочил */ }
          else if ((h.calm || 0) > this.time) { /* «Осколок Сердца» погасил */ }
          else if (hazardHitsPlayer(h, p)) {
            // Урон ведём как горение, а не через `takeDamage`: тот выдаёт
            // 0.42 с неуязвимости, и постоянный выброс стал бы укрытием —
            // стоишь в кислоте пустоты и наполовину не получаешь по морде от
            // мобов. Плюс он отбрасывает от источника, то есть выталкивал бы
            // из зоны сам: решение «уйти или потерпеть» перестало бы быть
            // решением игрока.
            // Доля от максимума, а не плоское число. Плоский урон меряется
            // против брони и здоровья, а их герой добирает снаряжением: 8 в
            // секунду — это 3% здоровья на 8-м уровне и 0.8% на 46-м, то есть
            // к третьему акту опасность исчезает ровно там, где она задумана.
            // Пустоте всё равно, что на тебе надето.
            // «Пустотная кожа» — единственный ответ на опасность местности,
            // и он честный: она не отменяет урон, а делает его терпимым.
            const skin = p.hasUnique('voidSkin') ? 0.5 : 1;
            const d = Math.max(1, Math.round((h.pct ? p.maxHp * h.pct : h.dps) * skin));
            p.hp -= d;
            p.stats.dmgTaken += d;
            p.hurtT = 0.12;
            this.floats.add(p.x, p.y - 22, '-' + d, { color: '#c9a6ff', size: 8 });
            this.particles.burst(p.x, p.y - 10, 3, { color: '#a882e0', color2: '#e2d0ff', speed: 26, life: 0.35, size: 1, vz: 22, g: 60 });
            if (h.effect) p.applyEffect(h.effect[0], h.effect[1], h.effect[2]);
            if (p.hp <= 0 && !p.dead) { p.hp = 0; p.dead = true; p.pose = 'dead'; this.onPlayerDeath(); }
          }
        } else for (const e of hazardTargets(this.enemies, h)) {
          if (h.dps) this.damageEnemy(e, h.dps, { silent: true, dot: true, color: h.color2 });
          if (h.blind) e.blind = Math.max(e.blind || 0, 0.9);
          if (h.effect) e.applyEffect(h.effect[0], h.effect[1], h.effect[2], this);
        }
      }
      if (Math.random() < 0.6) {
        const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * h.r;
        this.particles.spawn({
          x: h.x + Math.cos(a) * rr, y: h.y + Math.sin(a) * rr * 0.7,
          vx: (Math.random() - 0.5) * 8, vy: h.cloud ? -4 - Math.random() * 6 : -14 - Math.random() * 16,
          color: h.color, color2: h.color2, life: h.cloud ? 1.1 : 0.5, size: 2, glow: 5, drag: 1.4,
        });
      }
    }
  }

  /**
   * Чужой герой: тот же спрайт, что у своего, плюс имя над головой.
   *
   * Кадр походки берётся от времени и признака «движется» из снимка: чужие
   * вводы нам не приходят, а ноги переставлять надо.
   */
  drawOther(g, view, o, camX, camY, sun) {
    const sp = this.otherSprites(o.look);
    // набор кадров устроен как у своего героя: поза → сторона → кадры.
    // Чужих вводов нам не шлют, поэтому поза выводится из скорости в снимке,
    // а сторона — из угла взгляда.
    const set = o.moving ? sp.walk : sp.idle;
    const frames = set[dirFromVec(Math.cos(o.facing), Math.sin(o.facing))] || set[0];
    if (!frames || !frames.length) return;
    const c = frames[o.moving ? Math.floor(this.time * 7) % frames.length : 0];
    this.drawReflection(g, c, o.x, o.y, camX, camY, sp.ground, 0);
    this.castShadow(g, c, o.x, o.y, camX, camY, sp.ground, sun, 0);
    const x = Math.round(o.x - view.x - sp.w / 2);
    const y = Math.round(o.y - view.y - sp.ground);
    g.drawImage(c, x, y);
    const cx = Math.round(o.x - view.x);

    // Полоса здоровья соседа: без неё непонятно, идёт он в бой или уходит из
    // него. Показываем только раненых — над полным здоровьем полоска только
    // мусорит.
    if (o.hp !== undefined && o.mhp && o.hp < o.mhp) {
      const w = 20, доля = Math.max(0, Math.min(1, o.hp / o.mhp));
      g.fillStyle = 'rgba(4,3,10,0.75)';
      g.fillRect(cx - w / 2 - 1, y - 15, w + 2, 4);
      g.fillStyle = доля > 0.5 ? '#6fdc8c' : доля > 0.25 ? '#f0c05a' : '#e0484f';
      g.fillRect(cx - w / 2, y - 14, Math.round(w * доля), 2);
    }

    // Имя и уровень: в общем мире надо понимать, кто перед тобой и стоит ли
    // звать его в Пролом.
    const подпись = o.lvl ? `${o.name || '?'} · ${o.lvl}` : (o.name || '');
    text(g, подпись, cx, y - 8,
         { size: 7, align: 'center', color: '#c9a6ff', outline: 'rgba(4,3,10,0.9)' });

    // Сказанное висит над головой: отдельного окна разговора нет, и это
    // нарочно — мир маленький, а реплика на месте видна тому, кому она.
    if (o.реплика && this.time < o.репликаДо) {
      const w = Math.max(28, o.реплика.length * 4.2);
      g.fillStyle = 'rgba(8,6,18,0.82)';
      g.fillRect(cx - w / 2, y - 30, w, 11);
      g.fillStyle = 'rgba(201,166,255,0.35)';
      g.fillRect(cx - w / 2, y - 30, w, 1);
      text(g, o.реплика, cx, y - 22, { size: 7, align: 'center', color: '#e8e0ff' });
    }
  }

  drawHazards(g, view) {
    for (const h of this.hazards) {
      const x = h.x - view.x, y = h.y - view.y;
      if (x < -60 || y < -60 || x > view.w + 60 || y > view.h + 60) continue;
      const calm = (h.calm || 0) > this.time;
      const fade = Math.min(1, h.life / 0.8) * (calm ? 0.35 : 1);
      g.save();
      g.globalCompositeOperation = 'lighter';
      // У постоянной опасности заливка тише: замер показал, что внутри она
      // была ярче собственного края (226 против 190 по яркости), и зона
      // читалась как пятно без границы — то есть ровно не то, что нужно.
      g.globalAlpha = (h.hostile ? 0.12 : h.cloud ? 0.22 : 0.32) * fade * (0.8 + Math.sin(this.time * 6 + h.x) * 0.2);
      const grd = g.createRadialGradient(x, y, 0, x, y, h.r);
      grd.addColorStop(0, h.color2);
      grd.addColorStop(0.5, h.color);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - h.r, y - h.r * 0.8, h.r * 2, h.r * 1.6);
      g.restore();
      // У постоянной опасности нужен читаемый край. Облако без границы —
      // это «где-то тут плохо»; игрок узнаёт радиус, только потеряв здоровье.
      // Кольцо говорит, где именно кончается зона, и его видно на любом фоне.
      if (h.hostile) {
        g.save();
        const pu = 0.5 + Math.sin(this.time * 2.2 + h.x * 0.05) * 0.5;
        // Тёмный контур снаружи, светлый внутри: на светлом грунте видно
        // первый, на тёмном — второй. Одной линии не хватает, потому что
        // земля Пролома идёт пятнами от почти чёрного до бледно-лилового.
        g.strokeStyle = 'rgba(22,10,40,0.75)';
        g.lineWidth = 1;
        g.beginPath();
        g.ellipse(x, y, h.r + 1, h.r * 0.6 + 0.6, 0, 0, TAU);
        g.stroke();
        g.strokeStyle = 'rgba(214,182,255,' + (0.58 + pu * 0.30).toFixed(3) + ')';
        g.beginPath();
        g.ellipse(x, y, h.r, h.r * 0.6, 0, 0, TAU);
        g.stroke();
        g.restore();
      }
    }
  }

  updateLoot(dt) {
    const p = this.player;
    // В общем мире добыча лежит в комнате: там её уронили, там она числится за
    // хозяином и оттуда попадает в рюкзак. Клиент только показывает её и
    // просит поднять — решает всё равно комната.
    if (this.serverRunsCombat) { this.updateSharedLoot(dt); return; }
    for (let i = this.loot.length - 1; i >= 0; i--) {
      const l = this.loot[i];
      l.t += dt;
      l.life -= dt;
      l.z += l.vz * dt;
      l.vz -= 300 * dt;
      if (l.z < 0) { l.z = 0; l.vz *= -0.4; l.vx *= 0.5; l.vy *= 0.5; }
      l.x += l.vx * dt; l.y += l.vy * dt;
      l.vx *= Math.exp(-4 * dt); l.vy *= Math.exp(-4 * dt);

      const d = dist(l.x, l.y, p.x, p.y - 4);
      if (l.t > 0.4 && d < 46) l.magnet = true;
      if (l.magnet && !p.dead) {
        const a = angle(l.x, l.y, p.x, p.y - 4);
        const sp = clamp(300 - d * 2, 90, 300);
        l.x += Math.cos(a) * sp * dt;
        l.y += Math.sin(a) * sp * dt;
      }
      if (d < 9 && l.t > 0.35) {
        this.pickup(l);
        this.loot.splice(i, 1);
        continue;
      }
      if (l.life <= 0) this.loot.splice(i, 1);
    }
  }

  pickup(l) {
    const p = this.player;
    if (l.gold) {
      p.gold += l.gold;
      audio.play('coin', 0.7);
      this.floats.add(p.x, p.y - 26, '+' + l.gold, { color: UI.gold, size: 9 });
      return;
    }
    if (l.item) {
      if (!p.addItem(l.item)) {
        this.toast('Рюкзак полон!', UI.danger, 1.5);
        l.life = 30; l.t = 0; l.magnet = false;
        this.loot.push(l);
        return;
      }
      audio.play('pickup', 0.8);
      const rar = RARITY[l.item.rarity] || RARITY.common;
      this.floats.add(p.x, p.y - 30, l.item.name, { color: rar.color, size: 9, vy: -22, life: 1.3 });
      if (l.item.kind === 'material') this.quests.onCollect(l.item.key, this, p);
      if (l.item.rarity === 'legendary' || l.item.rarity === 'epic') {
        this.hud.showBanner(t(rar.name).toUpperCase(), l.item.name, rar.color);
      }
    }
  }

  updateBossTrigger() {
    const z = this.zone;
    // В общем мире порог арены сторожит комната: страж там один на всех, и
    // рождать своего значило бы драться с призраком, которого сервер не видит.
    if (this.serverRunsCombat) return;
    if (!z.boss || z.boss.spawned) return;
    const p = this.player;
    if (dist(p.x, p.y, z.boss.x, z.boss.y) > (z.bossArena ? z.bossArena.r : 130)) return;
    z.boss.spawned = true;
    const e = new Enemy(z.boss.key, z.boss.level, z.boss.x, z.boss.y);
    e.aggro = true;
    e.nid = this._nextNid++;
    this.enemies.push(e);
    this.bossEntrance(e);
  }

  /** Зрелище выхода стража — то же самое, кем бы он ни был рождён. */
  bossEntrance(e) {
    this.hud.showBanner(t(e.name).toUpperCase(), 'ур. ' + e.level + ' · берегись', '#ff7a6a');
    audio.play('boss');
    // Босс обрывает тему биома быстро — он и должен перебивать, — а свою
    // поднимает медленно: вход на полной громкости звучит как переключение
    // радио, а не как надвигающаяся угроза. Полторы секунды нарастания идут
    // ровно под рёв `boss` и тряску экрана.
    audio.setTrack(TRACKS.boss, { fadeOut: 0.3, fadeIn: 1.5 });
    this.shake.add(8, 0.9);
    this.particles.burst(e.x, e.y - 14, 60, { color: '#a05fe0', color2: '#ffd0a0', speed: 130, life: 1, size: 3, glow: 10 });
  }

  // ════════════════════════════ отрисовка

  draw() {
    const g = this.ctx;
    const { w: W, h: H } = this.view;
    g.imageSmoothingEnabled = false;

    if (this.state === 'title') {
      // мира нет — гасим его слой, чтобы под заставкой не остался прошлый кадр
      g.fillStyle = '#05040a';
      g.fillRect(0, 0, W, H);
      const u = beginUI() || g;
      this.menus.draw(u);
      return;
    }

    const z = this.zone;
    const cam = this.cam;
    const camX = Math.round(cam.x + this.shake.x);
    const camY = Math.round(cam.y + this.shake.y);
    const view = { x: camX, y: camY, w: W, h: H };

    g.fillStyle = '#05040a';
    g.fillRect(0, 0, W, H);

    // ── земля
    profiler.mark('земля');
    g.drawImage(z.ground, camX, camY, W, H, 0, 0, W, H);

    // блики жидкости
    if (z.tileset) drawLiquidShimmer(g, z, view, z.tileset, this.time);

    // солнечные пятна сквозь крону — на землю, до всего остального
    this.drawDapple(g, view);

    profiler.mark('земля');

    // ── декали (кровь)
    for (const d of this.decals) {
      g.save();
      g.globalAlpha = clamp(d.life / 6, 0, 1) * d.a;
      g.fillStyle = '#4a0a12';
      g.beginPath();
      g.ellipse(d.x - camX, d.y - camY, d.r, d.r * 0.5, 0, 0, TAU);
      g.fill();
      g.restore();
    }

    // ── сортируемый слой
    profiler.mark('объекты');
    const draws = [];
    for (const p of z.props) {
      if (p.x + 60 < camX || p.x - 60 > camX + W || p.y + 20 < camY || p.y - p.h - 20 > camY + H) continue;
      draws.push({ y: p.sortY, kind: 'prop', o: p });
    }
    for (const e of this.enemies) {
      if (e.x + 60 < camX || e.x - 60 > camX + W || e.y + 60 < camY || e.y - 80 > camY + H) continue;
      draws.push({ y: e.y, kind: 'enemy', o: e });
    }
    for (const n of z.npcs) draws.push({ y: n.y, kind: 'npc', o: n });
    for (const l of this.loot) draws.push({ y: l.y, kind: 'loot', o: l });
    if (!this.player.dead || this.player.deadT < 30) draws.push({ y: this.player.y, kind: 'player', o: this.player });
    // чужие герои идут в тот же сортируемый слой, что и всё остальное: иначе
    // они рисовались бы поверх домов или под травой
    for (const o of this._others || []) draws.push({ y: o.y, kind: 'other', o });
    draws.sort((a, b) => a.y - b.y);

    // ── тени от направленного света, потом сами спрайты
    const sun = z.sun || SUN_OUT;
    for (const d of draws) {
      if (d.kind === 'prop') this.drawProp(g, d.o, camX, camY, sun);
      else if (d.kind === 'enemy') {
        const c = d.o.frame();
        this.drawReflection(g, c, d.o.x, d.o.y, camX, camY, d.o.spr.h - 3, 0);
        this.castShadow(g, c, d.o.x, d.o.y, camX, camY, d.o.spr.h - 3, sun, 0);
        d.o.draw(g, view, this.time);
      } else if (d.kind === 'npc') this.drawNpc(g, d.o, camX, camY, sun);
      else if (d.kind === 'loot') this.drawLoot(g, d.o, camX, camY);
      else if (d.kind === 'player') {
        const p = this.player;
        const c = p.frame();
        this.drawReflection(g, c, p.x, p.y, camX, camY, p.sprites.ground, 0);
        this.castShadow(g, c, p.x, p.y, camX, camY, p.sprites.ground, sun, 0);
        p.draw(g, view);
      } else if (d.kind === 'other') this.drawOther(g, view, d.o, camX, camY, sun);
    }

    profiler.mark('объекты');

    // полосы здоровья мобов
    for (const e of this.enemies) { e.drawBar(g, view); e.drawMarks(g, view); }

    // ── эффекты ударов и лучи света
    profiler.mark('эффекты');
    this.drawHazards(g, view);
    this.drawShafts(g, view);
    this.drawSlashes(g, view);
    // Своя реплика — над своим героем: без неё непонятно, ушло ли сказанное.
    if (this.свояРеплика && this.time < this.свояРеплика.до) {
      const p = this.player;
      const cx = Math.round(p.x - view.x), cy = Math.round(p.y - view.y);
      const т = this.свояРеплика.text;
      const w = Math.max(28, т.length * 4.2);
      g.fillStyle = 'rgba(8,6,18,0.82)';
      g.fillRect(cx - w / 2, cy - 52, w, 11);
      g.fillStyle = 'rgba(255,214,106,0.4)';
      g.fillRect(cx - w / 2, cy - 52, w, 1);
      text(g, т, cx, cy - 44, { size: 7, align: 'center', color: '#ffe9b0' });
    }

    for (const pr of this.projectiles) pr.draw(g, view);
    // Чужие снаряды в общем мире считает комната — своих врагов клиент не
    // обновляет и стрел не порождает. Рисуем прямо по снимку: без этого игрок
    // получал бы урон от невидимых стрел.
    for (const sh of this._снаряды || []) {
      const x = Math.round(sh.x - view.x), y = Math.round(sh.y - view.y);
      if (x < -10 || y < -10 || x > view.w + 10 || y > view.h + 10) continue;
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = sh.c2 || sh.c || '#ffd08a';
      g.beginPath(); g.arc(x, y, Math.max(1, (sh.s || 3) * 0.6), 0, TAU); g.fill();
      g.fillStyle = sh.c || '#ff8a3a';
      g.beginPath(); g.arc(x, y, Math.max(1, sh.s || 3), 0, TAU); g.fill();
      g.restore();
    }
    this.particles.draw(g, view, 0);
    this.floats.draw(g, view);

    profiler.mark('эффекты');

    // ── свет
    profiler.mark('свет');
    this.collectLights(view);
    this.lighting.render(g, z.ambient || '#ffffff', this.time);

    // ── свечение ярких мест (факелы, лава, магия, легендарный лут)
    this.bloom.render(g, g.canvas, z.bloom ?? 0.7);

    profiler.mark('свет');

    // ── погода и цветокоррекция
    this.weather.draw(g);
    if (z.grade) grade(g, W, H, z.grade.color, z.grade.alpha, 'overlay');
    if (z.tone) toneGrade(g, W, H, z.tone[0], z.tone[1], z.tone[2]);
    // Воздушная дымка идёт до виньетки: дымка про даль, виньетка про кадр.
    if (z.haze) haze(g, W, H, z.haze[0], z.haze[1]);
    vignette(g, W, H, z.kind === 'dungeon' ? 0.68 : 0.48, z.vignette || '4,3,12');

    // ── HUD и меню: свой слой, в разрешении экрана
    profiler.mark('интерфейс');
    const u = beginUI() || g;
    if (!this.menus.blocking || this.menus.mode === 'dialogue') this.hud.draw(u, this);
    this.menus.draw(u);

    // Строка разговора: пока её печатают, она внизу экрана. Рисуем на слое
    // интерфейса — здесь настоящее разрешение, и текст читается.
    if (input.набор) {
      const W = u.canvas.width, H = u.canvas.height;
      const h = Math.round(H * 0.045), y = H - h - Math.round(H * 0.06);
      u.fillStyle = 'rgba(8,6,18,0.86)';
      u.fillRect(0, y, W, h);
      u.fillStyle = 'rgba(201,166,255,0.5)';
      u.fillRect(0, y, W, 2);
      text(u, 'Сказать: ' + input.набор.text + (Math.floor(this.time * 2) % 2 ? '|' : ''),
           Math.round(W * 0.02), y + h * 0.66,
           { size: Math.round(h * 0.5), color: '#e8e0ff' });
      text(u, 'Enter — сказать, Esc — отменить', W - Math.round(W * 0.02), y + h * 0.66,
           { size: Math.round(h * 0.36), align: 'right', color: 'rgba(201,166,255,0.6)' });
    }

    // ── затемнение перехода
    if (this.transition) {
      const tr = this.transition;
      const a = tr.phase === 'out' ? clamp(tr.t / 0.32, 0, 1) : clamp(1 - tr.t / 0.4, 0, 1);
      u.fillStyle = `rgba(4,3,9,${a})`;
      u.fillRect(0, 0, W, H);
      if (a > 0.7) {
        uiText(u, 'загрузка…', W / 2, H / 2 - 5, { size: 10, align: 'center', color: '#6a6488' });
      }
    }

    profiler.mark('интерфейс');
    this.drawProfiler(u, W, H);
  }

  /**
   * Панель профайлера. Рисуется последней и поверх всего — её дело показывать
   * правду о кадре, а не вписываться в интерфейс.
   *
   * Цифры отсюда — те же, что я весь день добывал вручную, только теперь их не
   * надо добывать и в них некуда закрасться ошибке измерения.
   */
  drawProfiler(u, W, H) {
    if (!profiler.on) return;
    const s = profiler.snapshot();
    if (!s.кадров) return;
    const мс = (v) => v.toFixed(2).replace('.', ',');
    const строки = [
      ['кадр', s.кадр],
      ['· update', s.update],
      ['· draw', s.draw],
      ['пауза между', s.пауза],
    ];
    const pw = 132, ph = 26 + строки.length * 11 + s.участки.length * 9 + 12;
    const px = W - pw - 6, py = 6;
    u.save();
    u.fillStyle = 'rgba(6,5,14,0.86)';
    u.fillRect(px, py, pw, ph);
    u.strokeStyle = 'rgba(160,150,220,0.35)';
    u.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);

    // Доля бюджета — главное число: миллисекунды сами по себе ни о чём не
    // говорят, а «40% от кадра» говорит сразу.
    const доля = s.бюджет;
    const цвет = доля > 0.8 ? '#ff6a6a' : доля > 0.5 ? '#ffc24a' : '#7fe0a0';
    uiText(u, 'КАДР ' + Math.round(доля * 100) + '% бюджета', px + 7, py + 6,
           { size: 9, bold: true, color: цвет });
    uiText(u, s.кадров + ' кадров', px + pw - 7, py + 6, { size: 8, align: 'right', color: '#6a6488' });

    let y = py + 20;
    uiText(u, 'мед', px + 66, y, { size: 7, align: 'right', color: '#6a6488' });
    uiText(u, 'p95', px + 94, y, { size: 7, align: 'right', color: '#6a6488' });
    uiText(u, 'макс', px + pw - 7, y, { size: 7, align: 'right', color: '#6a6488' });
    y += 8;
    for (const [имя, v] of строки) {
      uiText(u, имя, px + 7, y, { size: 8, color: имя.startsWith('·') ? '#8a84a8' : '#cfc8e8' });
      uiText(u, мс(v.мед), px + 66, y, { size: 8, align: 'right', color: '#cfc8e8' });
      uiText(u, мс(v.p95), px + 94, y, { size: 8, align: 'right', color: '#a8a0c8' });
      uiText(u, мс(v.макс), px + pw - 7, y, { size: 8, align: 'right', color: '#8a84a8' });
      y += 11;
    }
    for (const у of s.участки) {
      uiText(u, '  ' + у.имя, px + 7, y, { size: 8, color: '#8a84a8' });
      uiText(u, мс(у.мс), px + 66, y, { size: 8, align: 'right', color: '#a8a0c8' });
      y += 9;
    }
    uiText(u, 'F3 — убрать', px + 7, y + 2, { size: 7, color: '#5a5478' });
    u.restore();
  }

  /**
   * Высота водной глади прямо под объектом (0 — воды нет).
   * По ней решается, рисовать ли отражение и на какую глубину его обрезать.
   */
  waterBelow(x, y) {
    const z = this.zone;
    const tx = Math.floor(x / TILE);
    const ty0 = Math.floor((y + 3) / TILE);
    if (tx < 0 || tx >= z.w || ty0 < 0 || ty0 >= z.h) return 0;
    if (z.tiles[ty0 * z.w + tx] !== T.LIQUID) return 0;
    let d = 0;
    while (d < 5 && ty0 + d < z.h && z.tiles[(ty0 + d) * z.w + tx] === T.LIQUID) d++;
    return (ty0 + d) * TILE - y;
  }

  /**
   * Отражение в воде: перевёрнутая копия спрайта, нарезанная горизонтальными
   * полосами со смещением по синусу — получается рябь. Обрезается по глубине
   * водной полосы, чтобы не выползать на берег.
   */
  drawReflection(g, c, wx, wy, camX, camY, groundOff, sway) {
    const depth = this.waterBelow(wx, wy);
    if (depth < 6) return;
    const bx = Math.round(wx - camX), by = Math.round(wy - camY);
    const w = c.width, h = groundOff;
    g.save();
    g.beginPath();
    g.rect(bx - w, by + 1, w * 2, Math.min(depth, h * 0.8));
    g.clip();
    g.globalAlpha = 0.34;
    const strips = 9;
    for (let i = 0; i < strips; i++) {
      const sy = (i / strips) * h;                 // строка в исходном спрайте (снизу вверх)
      const sh = Math.ceil(h / strips);
      const wob = Math.sin(this.time * 2.2 + i * 0.9 + wx * 0.05) * (0.8 + i * 0.28);
      g.drawImage(
        c, 0, Math.max(0, h - sy - sh), w, sh,
        Math.round(bx - w / 2 + wob + sway * sy * 0.5), Math.round(by + 1 + sy * 0.72),
        w, Math.ceil(sh * 0.72),
      );
    }
    g.restore();
  }

  /** Тень, отброшенная направленным светом: силуэт со сдвигом и сжатием. */
  castShadow(g, c, wx, wy, camX, camY, groundOff, sun, sway) {
    if (!c || !sun || sun.a <= 0) return;
    const sil = silhouette(c);
    const x = Math.round(wx - camX), y = Math.round(wy - camY);
    // Два прохода вместо одного. Первый — шире и бледнее, он даёт мягкий край:
    // резко обрезанная тень читается как вырезанная из бумаги, а размытие в
    // канвасе стоит дорого. Второй — сама тень.
    g.save();
    g.translate(x, y);
    g.transform(1, 0, sun.sk + sway * 0.8, sun.sq * 1.18, 0, 0);
    g.globalAlpha = sun.a * 0.42;
    g.drawImage(sil, -(c.width >> 1) - 1, -groundOff, c.width + 2, c.height);
    g.restore();

    g.save();
    g.translate(x, y);
    g.transform(1, 0, sun.sk + sway * 0.8, sun.sq, 0, 0);
    g.globalAlpha = sun.a;
    g.drawImage(sil, -(c.width >> 1), -groundOff);
    g.restore();
  }

  /**
   * Пятно затенения под кроной.
   *
   * У спрайтов есть своя запечённая тень, но она крошечная: у дерева шириной 66
   * пикселей это мазок в 18 пикселей. Для травинки в самый раз, для кроны —
   * нет. Здесь под крупные объекты подкладывается мягкое пятно по их footprint:
   * ровно то, чего не хватало, чтобы дерево выглядело растущим, а не
   * приставленным.
   */
  groundBlob(g, wx, wy, camX, camY, width, alpha) {
    if (!this._blob) {
      // печём один раз: мягкий эллипс в низком разрешении, дальше растягиваем
      const b = makeCanvas(32, 16);
      const grd = b.createRadialGradient(16, 8, 1, 16, 8, 15);
      grd.addColorStop(0, 'rgba(0,0,0,0.85)');
      grd.addColorStop(0.55, 'rgba(0,0,0,0.42)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      b.fillStyle = grd;
      b.fillRect(0, 0, 32, 16);
      this._blob = b.canvas;
    }
    const w = Math.max(10, width * 0.9), h = Math.max(5, width * 0.34);
    g.save();
    g.globalAlpha = alpha;
    g.drawImage(this._blob, Math.round(wx - camX - w / 2), Math.round(wy - camY - h * 0.55), Math.round(w), Math.round(h));
    g.restore();
  }

  // ── Солнечные пятна сквозь крону
  //
  // Первая попытка была замощением шумом поверх всего экрана — и провалилась:
  // плитка в 128 пикселей укладывается по ширине четыре раза, глаз мгновенно
  // ловит решётку, а прибавка к разбросу яркости вышла всего 5%. Здесь пятна
  // привязаны к самим деревьям и живут в мировых координатах — повторяться
  // нечему, потому что нет ни плитки, ни экранной сетки.

  /**
   * Разложить пятна по кронам. Считается один раз на зону.
   *
   * Первым заходом пятна клались точно в тень кроны — физически верно: свет
   * идёт сбоку, и всё пробившееся сквозь листву падает туда же, куда легла
   * тень. Замер показал, что это не работает: 1,8% кадра, разброс яркости
   * 37,06 → 36,99, то есть ничего. В этой камере тень кроны закрыта самими
   * спрайтами деревьев, и пятно попадало под них. Игрок видит землю **между**
   * кронами и перед ними — свет должен ложиться туда.
   *
   * Поэтому разброс широкий (почти во всю крону) и смещён вниз по экрану, к
   * камере: там земля открыта. Уклон в сторону тени остался, но слабый.
   *
   * Разброс берётся не из `Math.random`, а из хэша: зона живёт в кэше и
   * перерисовывается тысячи раз, пятна при этом не должны прыгать.
   */
  buildDapple(z, sun) {
    const hash = (n) => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };
    const out = [];
    let seed = 1;
    for (const p of z.props) {
      // крона, а не валун: у листвы есть покачивание, у камня его нет
      if (p.flat || p.h < 30 || !p.sway) continue;
      const cx = p.x + sun.sk * p.h * 0.22;
      const cy = p.y + p.h * 0.06;
      const n = 3 + ((hash(seed++) * 3) | 0);
      for (let i = 0; i < n; i++) {
        const x = cx + (hash(seed++) * 2 - 1) * p.w * 0.78;
        const y = cy + (hash(seed++) * 2 - 1) * p.h * 0.30;
        const r = 3 + hash(seed++) * 5;
        const a = 0.22 + hash(seed++) * 0.22;
        const ph = hash(seed++) * TAU;
        // Пятно ложится только на землю. У воды свои блики
        // (`drawLiquidShimmer`), и тёплая клякса поверх синевы читается сбоем;
        // в стене свету взяться неоткуда. На зону таких набиралось около 9%.
        const t = z.at(Math.floor(x / TILE), Math.floor(y / TILE));
        if (t === T.LIQUID || t === T.WALL || t === T.VOID) continue;
        out.push({ x, y, r, a, ph });
      }
    }
    return out;
  }

  drawDapple(g, view) {
    const z = this.zone;
    const s = z.dappleStrength ?? 0;
    if (!s) return;
    if (!z.dapple) z.dapple = this.buildDapple(z, z.sun || SUN_OUT);
    if (!this._dap) {
      const S = 24, b = makeCanvas(S, S);
      // Ядро держится почти до края и только потом падает. Мягкий колокол
      // читался размывом — «где-то посветлее», — а пятно света должно иметь
      // край: солнце сквозь листву даёт кляксу, а не туман.
      const grd = b.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      grd.addColorStop(0, 'rgba(255,247,216,1)');
      grd.addColorStop(0.55, 'rgba(255,244,206,0.78)');
      grd.addColorStop(0.82, 'rgba(255,240,198,0.20)');
      grd.addColorStop(1, 'rgba(255,238,196,0)');
      b.fillStyle = grd;
      b.fillRect(0, 0, S, S);
      this._dap = b.canvas;
    }
    // Пятна ползают вместе с кроной: щели в листве двигает тот же ветер, что
    // качает саму крону, — иначе свет стоит, а дерево ходит.
    const wind = z.wind ?? 1;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const d of z.dapple) {
      const x = d.x - view.x, y = d.y - view.y;
      if (x < -24 || x > view.w + 24 || y < -24 || y > view.h + 24) continue;
      const w = windAt(d.x, d.y, this.time, d.ph, 0.9);
      const rx = d.r * (1 + w * 0.10), ry = rx * 0.62;
      g.globalAlpha = d.a * s * (0.70 + 0.30 * (w * 0.5 + 0.5));
      g.drawImage(this._dap, x - rx + w * 2.6 * wind, y - ry + w * 1.2 * wind, rx * 2, ry * 2);
    }
    g.restore();
  }

  drawProp(g, p, camX, camY, sun) {
    const c = p.anim ? p.frames[Math.floor(this.time * p.fps + p.phase) % p.frames.length] : p.frames[0];
    const bx = Math.round(p.x - camX), by = Math.round(p.y - camY);
    // покачивание: сдвиг растёт к верхушке, основание стоит на месте.
    // Отклонение берётся из общего поля ветра, а не из личного синуса: соседние
    // кроны должны клониться в одну сторону. `z.wind` глушит ветер там, где его
    // быть не должно, — под землёй.
    const w = this.zone.wind ?? 1;
    const k = p.sway && w ? windAt(p.x, p.y, this.time, p.phase, p.swaySpeed) * p.sway * w : 0;
    if (!p.flat) {
      this.drawReflection(g, c, p.x, p.y, camX, camY, c.height, k);
      // затенение под кроной — только у крупного: у мелочи своя запечённая тень
      if (c.height > 26) this.groundBlob(g, p.x, p.y, camX, camY, c.width, 0.34);
      this.castShadow(g, c, p.x, p.y, camX, camY, c.height, sun, k);
    }

    // высокий объект, за которым стоит герой, становится полупрозрачным
    let alpha = 1;
    if (!p.flat && c.height > 22) {
      const pl = this.player;
      if (pl.y < p.y && pl.y > p.y - c.height - 6 && Math.abs(pl.x - p.x) < c.width * 0.45) alpha = 0.42;
    }
    if (alpha < 1) { g.save(); g.globalAlpha = alpha; }
    if (k) {
      g.save();
      g.translate(bx, by);
      g.transform(1, 0, k, 1, 0, 0);
      g.drawImage(c, -(c.width >> 1), -c.height);
      g.restore();
    } else {
      g.drawImage(c, bx - (c.width >> 1), by - c.height);
    }
    if (alpha < 1) g.restore();
  }

  drawNpc(g, n, camX, camY, sun) {
    const c = n.spr.frames[Math.floor(this.time * 4 + n.x) % n.spr.frames.length];
    this.castShadow(g, c, n.x, n.y, camX, camY, c.height - 2, sun, 0);
    const x = Math.round(n.x - c.width / 2 - camX);
    const y = Math.round(n.y - c.height - camY);
    g.drawImage(c, x, y);
    // маркер
    const near = dist2(this.player.x, this.player.y, n.x, n.y) < 44 * 44;
    const bob = Math.sin(this.time * 3 + n.x) * 1.5;
    const hasQuest = n.quests && this.quests.available.length > 0;
    const col = hasQuest ? '#ffd54a' : near ? '#9fe0ff' : 'rgba(180,200,255,0.6)';
    g.fillStyle = col;
    if (hasQuest) {
      g.fillRect(x + c.width / 2 - 1, y - 10 + bob, 2, 5);
      g.fillRect(x + c.width / 2 - 1, y - 4 + bob, 2, 2);
    } else {
      g.fillRect(x + c.width / 2 - 2, y - 8 + bob, 4, 2);
      g.fillRect(x + c.width / 2 - 1, y - 6 + bob, 2, 2);
    }
  }

  drawLoot(g, l, camX, camY) {
    // Добыча общего мира приходит снимком в коротком виде: у неё нет ни высоты
    // подскока, ни собранной вещи — только место, вид и редкость. Приводим к
    // одному виду здесь, чтобы рисование не знало, откуда взялась запись.
    if (l.i !== undefined && l.k !== undefined) {
      l = {
        x: l.x, y: l.y, z: 0, gold: l.g,
        item: l.k ? (l._и || (l._и = { kind: l.k, rarity: l.r || 'common', icon: itemIcon(l.k, null, 0, l.r || 'common') })) : null,
        чужая: l.o !== null && l.o !== net.pid,
      };
    }
    const x = Math.round(l.x - camX), y = Math.round(l.y - l.z - camY);
    if (l.чужая) g.globalAlpha = 0.45;   // не твоя — видно, но пока не взять
    const bob = Math.sin(this.time * 4 + l.x) * 1.2;
    g.save();
    g.globalAlpha = 0.3;
    g.fillStyle = '#000';
    g.beginPath(); g.ellipse(x, l.y - camY, 4, 2, 0, 0, TAU); g.fill();
    g.restore();
    if (l.gold) {
      glow(g, x, y + bob, 9, 'rgba(255,200,90,0.45)', 0.9);
      g.fillStyle = RAMP.gold[1];
      g.fillRect(x - 3, y - 3 + bob, 6, 6);
      g.fillStyle = RAMP.gold[2];
      g.fillRect(x - 2, y - 3 + bob, 4, 4);
      g.fillStyle = RAMP.gold[3];
      g.fillRect(x - 2, y - 3 + bob, 2, 2);
    } else if (l.item) {
      const rar = RARITY[l.item.rarity] || RARITY.common;
      if (l.item.rarity !== 'common') glow(g, x, y + bob, 13, rgba(rar.color, 0.5), 0.9);
      const ic = l.item.icon;
      g.drawImage(ic, x - ic.width / 2, y - ic.height / 2 + bob);
      // луч для редкого
      if (l.item.rarity === 'epic' || l.item.rarity === 'legendary') {
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.25 + Math.sin(this.time * 4) * 0.12;
        const grd = g.createLinearGradient(x, y - 34, x, y + 6);
        grd.addColorStop(0, 'rgba(0,0,0,0)');
        grd.addColorStop(1, rar.color);
        g.fillStyle = grd;
        g.fillRect(x - 4, y - 34, 8, 40);
        g.restore();
      }
    }
    g.globalAlpha = 1;
  }

  /**
   * Лучи из потолочных решёток. Рисуются полосами с промежутками — тень
   * прутьев читается сразу и без отдельного слоя затемнения.
   */
  drawShafts(g, view) {
    const z = this.zone;
    if (!z.shafts || !z.shafts.length) return;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const s of z.shafts) {
      const x = s.x - view.x, y = s.y - view.y;
      if (x < -140 || x > view.w + 140 || y < -160 || y > view.h + 160) continue;
      const flick = 0.86 + Math.sin(this.time * 0.8 + s.p) * 0.14;
      const grd = g.createLinearGradient(x, y - s.len, x + s.skew, y + s.len * 0.25);
      grd.addColorStop(0, s.color.replace('1)', '0.5)'));
      grd.addColorStop(0.55, s.color.replace('1)', '0.22)'));
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.globalAlpha = flick;
      const bars = 4;
      for (let i = 0; i < bars; i++) {
        const k0 = i / bars + 0.07, k1 = (i + 1) / bars - 0.07;
        const xa = -s.w / 2 + k0 * s.w, xb = -s.w / 2 + k1 * s.w;
        g.beginPath();
        g.moveTo(x + xa * 0.45, y - s.len);
        g.lineTo(x + xb * 0.45, y - s.len);
        g.lineTo(x + s.skew + xb * 1.25, y + s.len * 0.22);
        g.lineTo(x + s.skew + xa * 1.25, y + s.len * 0.22);
        g.closePath();
        g.fill();
      }
      // яркое пятно там, где луч упирается в пол
      const pr = s.w * 1.05;
      const rg = g.createRadialGradient(x + s.skew * 0.7, y, 0, x + s.skew * 0.7, y, pr);
      rg.addColorStop(0, s.color.replace('1)', '0.3)'));
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg;
      g.fillRect(x + s.skew * 0.7 - pr, y - pr * 0.6, pr * 2, pr * 1.2);
    }
    g.restore();
  }

  /** Пылинки, кружащие в лучах. */
  updateShaftDust(dt) {
    const z = this.zone;
    if (!z.shafts || !z.shafts.length) return;
    this.dustT = (this.dustT || 0) - dt;
    if (this.dustT > 0) return;
    this.dustT = 0.09;
    for (const s of z.shafts) {
      if (Math.abs(s.x - this.player.x) > 240 || Math.abs(s.y - this.player.y) > 180) continue;
      const k = Math.random();
      this.particles.spawn({
        x: s.x + s.skew * (1 - k) + (Math.random() - 0.5) * s.w * (0.5 + k * 0.7),
        y: s.y - s.len * (1 - k) * 0.8 + (Math.random() - 0.5) * 6,
        vx: 4 + Math.random() * 6, vy: 5 + Math.random() * 7,
        color: '#e8f0ff', life: 1.6 + Math.random(), size: 1, shrink: false, drag: 0.4,
      });
    }
  }

  drawSlashes(g, view) {
    for (const s of this.slashes) {
      const t = s.t / s.dur;
      const x = s.x - view.x, y = s.y - view.y;
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = (1 - t) * 0.85;
      g.strokeStyle = s.color;
      if (s.ring) {
        g.lineWidth = 3 - t * 2;
        g.beginPath();
        g.arc(x, y, s.r * (0.3 + t * 0.9), 0, TAU);
        g.stroke();
      } else {
        // серп: несколько дуг разного радиуса, ярче и тоньше к внешнему краю
        const spread = s.spread;
        const a0 = s.a - spread * (1 - t * 0.35);
        const a1 = s.a + spread * (0.15 + t * 0.85);
        for (let i = 0; i < 4; i++) {
          const k = i / 3;
          const r = s.r * (0.5 + t * 0.5) * (0.68 + k * 0.4);
          g.globalAlpha = (1 - t) * (0.12 + k * 0.55);
          g.lineWidth = (1 - k) * 3.5 + 0.8;
          g.strokeStyle = k > 0.7 ? '#ffffff' : s.color;
          g.beginPath();
          g.arc(x, y, r, a0 + k * 0.14, a1 - k * 0.06);
          g.stroke();
        }
      }
      g.restore();
    }
  }

  collectLights(view) {
    const z = this.zone;
    const L = this.lighting;
    if ((z.ambient || '#ffffff') === '#ffffff') { L.lights.length = 0; return; }
    for (const l of z.lights) {
      const x = l.x - view.x, y = l.y - view.y;
      if (x < -120 || y < -120 || x > view.w + 120 || y > view.h + 120) continue;
      const f = l.flicker ? 1 + Math.sin(this.time * 9 + l.x * 0.3) * l.flicker * 0.5 + Math.sin(this.time * 23 + l.y) * l.flicker * 0.3 : 1;
      L.add(x, y, l.r * f, l.color, 1);
    }
    // свет героя
    const p = this.player;
    const pr = z.playerLight || (z.kind === 'dungeon' ? 90 : 72);
    L.add(p.x - view.x, p.y - 12 - view.y, pr, 'rgba(255,236,200,0.72)', 1);
    // снаряды светятся
    for (const pj of this.projectiles) {
      L.add(pj.x - view.x, pj.y - view.y, 26, rgba(pj.color2 || pj.color, 0.6), 1);
    }
    for (const l of this.loot) {
      if (l.gold) L.add(l.x - view.x, l.y - l.z - view.y, 16, 'rgba(255,200,90,0.5)', 1);
      else if (l.item && l.item.rarity !== 'common') L.add(l.x - view.x, l.y - l.z - view.y, 22, rgba((RARITY[l.item.rarity] || RARITY.common).color, 0.55), 1);
    }
  }
}


