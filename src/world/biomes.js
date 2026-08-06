// Описание биомов: палитра земли, погода, свет, набор мобов и уровень опасности.

import { RAMP } from '../art/palette.js';

export const BIOMES = {
  city: {
    id: 'city',
    bloom: 0.5,  tone: ['#8fbcff', '#ffd6a0', 0.10], vignette: '6,6,16',
    name: 'Велория',
    subtitle: 'вольный город',
    safe: true,
    level: 1,
    music: 'city',
    wind: 0.7,   // город прикрыт стенами
    maxRarity: 'rare',       // город — не место для находок
    dapple: 0.55, // деревьев в городе немного, и стоят они особняком
    haze: ['rgba(214,220,234,1)', 0.09],  // над крышами воздух чище
    weather: null,
    ambient: '#dcd8e8',
    grade: null,
    portal: 'portalCity',
    tiles: {
      seed: 3,
      ramp: ['#24421f', '#345c2c', '#48793c', '#63a04f'],
      ramp2: ['#3a2c18', '#4f3d22', '#665030', '#83683f'],
      path: ['#3a3a48', '#50505f', '#6b6b7c', '#8b8b9c'],
      liquid: ['#123a5c', '#1c5a86', '#2a7fb0', '#7fc8e8'],
      wall: ['#3c3a44', '#4f4d5a', '#66647a', '#8a8899'],
      shore: '#7a6a44',
      blades: 7, speck: 3,
      pathStyle: 'cobble',
      flowers: ['#e8d45a', '#e07a9a', '#f0f0e0'],
      wallStyle: 'brick',
    },
  },

  forest: {
    id: 'forest',
    bloom: 0.6,  tone: ['#7fb4ff', '#ffd08a', 0.13], vignette: '6,12,16',
    name: 'Изумрудный лес',
    subtitle: 'опасность: низкая',
    order: 0,
    unlockLevel: 1,
    levelRange: [1, 6],
    music: 'forest',
    wind: 1.0,   // открытый лес — мера для остальных
    maxRarity: 'rare',       // первый биом: легендарки здесь не падают
    dapple: 1.0,  // густая крона — мера для остальных
    haze: ['rgba(206,226,214,1)', 0.13],  // зелёная взвесь под пологом
    weather: 'leaves',
    ambient: '#d6dcea',
    grade: { color: '#6fd98a', alpha: 0.07 },
    portal: 'portalForest',
    trees: ['treeOak', 'treeOakBig', 'treePine'],
    rocks: ['rock', 'rockBig'],
    bushes: ['bush'],
    enemies: [['slime', 26], ['goblin', 22], ['wolf', 18], ['wisp', 10], ['goblinArcher', 12], ['goblinShield', 14]],
    elite: 'bigslime',
    boss: 'treant',
    bossName: 'Древень Корнегрив',
    tiles: {
      seed: 11,
      ramp: ['#1c3a1e', '#2c5a2a', '#3f7a38', '#5fa14b'],
      ramp2: ['#3a2a18', '#4f3a22', '#67502f', '#84683f'],
      path: ['#4a4232', '#615743', '#7d7157', '#9b8d70'],
      liquid: ['#123a5c', '#1c5a86', '#2a7fb0', '#7fc8e8'],
      wall: ['#232c22', '#37432f', '#4d5c40', '#697a56'],
      shore: '#8a7a52',
      blades: 9, speck: 4,
      flowers: ['#e8d45a', '#d86a8a', '#e8e8f0', '#8a6ad8'],
    },
  },

  swamp: {
    id: 'swamp',
    bloom: 0.65, tone: ['#9fe07a', '#4a2a70', 0.15], vignette: '10,14,8',
    name: 'Пепельная топь',
    subtitle: 'опасность: средняя',
    order: 1,
    unlockLevel: 6,
    levelRange: [6, 13],
    music: 'swamp',
    wind: 0.45,  // в топи воздух стоит
    maxRarity: 'epic',       // топь уже может удивить
    dapple: 0.7,  // сквозь болотную листву свет идёт мутно
    haze: ['rgba(186,200,168,1)', 0.18],  // над топью всегда висит муть
    weather: 'spore',
    ambient: '#a8a2c0',
    grade: { color: '#7a9c4a', alpha: 0.12 },
    portal: 'portalSwamp',
    trees: ['treeSwamp', 'treeDead', 'treeMushroom'],
    rocks: ['rock', 'crystal'],
    bushes: ['bushSwamp'],
    enemies: [['bogling', 22], ['spitter', 16], ['swampWolf', 16], ['leech', 12], ['mireWitch', 12], ['bloater', 12], ['mireShaman', 10]],
    elite: 'mireWitch',
    boss: 'hagBoss',
    bossName: 'Тинная Карга',
    tiles: {
      seed: 23,
      ramp: ['#22261a', '#2f3a22', '#3f4a2a', '#54603a'],
      ramp2: ['#221a14', '#2f251a', '#3d3122', '#4d3f2c'],
      path: ['#2c2a20', '#3d3a2c', '#524d3c', '#6b6450'],
      liquid: ['#1a2c14', '#2a4a1c', '#3f6b28', '#7fb84a'],
      wall: ['#1e1a24', '#2c2632', '#3d3644', '#514758'],
      shore: '#40402a',
      blades: 5, speck: 6, speckColor: '#4a5a2a',
      flowers: ['#7fb84a', '#9a7ad8', '#4a6a2a'],
      liquidGlow: '#5fb83a',
    },
  },

  frost: {
    id: 'frost',
    bloom: 0.8,  tone: ['#b8e0ff', '#2f4f8a', 0.16], vignette: '12,20,34',
    name: 'Мёрзлый кряж',
    subtitle: 'опасность: высокая',
    order: 2,
    unlockLevel: 13,
    levelRange: [13, 21],
    music: 'frost',
    wind: 1.35,  // на кряже дует сильнее всего
    maxRarity: 'epic',       // на кряже эпика — обычное дело
    dapple: 0.5,  // кроны голые, пробивать нечего
    haze: ['rgba(214,232,248,1)', 0.20],  // морозная дымка — самая плотная
    weather: 'snow',
    ambient: '#a8bcd8',
    grade: { color: '#7fc0ff', alpha: 0.14 },
    portal: 'portalFrost',
    trees: ['treeFrost', 'treePine', 'treeDead'],
    rocks: ['rockIce', 'rockBig'],
    bushes: ['bushFrost'],
    enemies: [['frostWolf', 22], ['iceWraith', 18], ['frostArcher', 16], ['yeti', 12], ['bat', 12], ['frostGuard', 14]],
    elite: 'yeti',
    boss: 'frostWarden',
    bossName: 'Хранитель Стужи',
    tiles: {
      seed: 37,
      ramp: ['#5a6f8c', '#7d94b0', '#a3bcd4', '#d8e9f7'],
      ramp2: ['#2c4a68', '#3d6b90', '#5a94ba', '#8fc8e0'],
      path: ['#4a5568', '#5f6b80', '#78849b', '#96a2b8'],
      liquid: ['#123048', '#1c4a6b', '#2a6f96', '#8fd8f0'],
      wall: ['#3a4458', '#4d5a72', '#66748c', '#8a99b0'],
      shore: '#9fb8cc',
      blades: 0, speck: 5, speckColor: '#eef7ff',
    },
  },

  ember: {
    id: 'ember',
    bloom: 1.0,  tone: ['#ff9a4a', '#2a0e0e', 0.17], vignette: '22,6,4',
    name: 'Тлеющая пустошь',
    subtitle: 'опасность: смертельная',
    order: 3,
    unlockLevel: 21,
    levelRange: [21, 32],
    music: 'ember',
    wind: 0.9,   // по пустоши идут горячие порывы
    maxRarity: 'legendary',  // пустошь: сюда идут за легендарками
    dapple: 0.3,  // обугленные деревья почти не держат свет
    haze: ['rgba(224,160,116,1)', 0.17],  // марево над горячей землёй
    weather: 'ember',
    ambient: '#8a6a68',
    grade: { color: '#ff7a3a', alpha: 0.16 },
    portal: 'portalEmber',
    trees: ['treeCharred', 'treeDead'],
    rocks: ['rockEmber', 'rockBig'],
    bushes: [],
    enemies: [['imp', 22], ['ashRaven', 16], ['cinderKnight', 18], ['magmaGolem', 12], ['skeleton', 16], ['emberBomber', 14]],
    elite: 'magmaGolem',
    boss: 'colossus',
    bossName: 'Расплавленный Колосс',
    tiles: {
      seed: 53,
      ramp: ['#1e1518', '#2c2024', '#3d2c2c', '#4f3a36'],
      ramp2: ['#3a1c14', '#4f281a', '#663520', '#7d4526'],
      path: ['#2a1e1c', '#3d2c26', '#523c32', '#6b5040'],
      liquid: ['#5c1207', '#a83512', '#e8721a', '#ffc44a'],
      wall: ['#1a1214', '#291a1c', '#3a2624', '#4d332c'],
      shore: '#5a3a26',
      blades: 0, speck: 7, speckColor: '#5a2a1a',
      liquidGlow: '#ff6a1a',
    },
  },

  // ── Третий акт: место, где Бездна вышла наружу
  //
  // Прежние акты кончались спуском вглубь. Этот — тем, что глубина поднялась
  // сама. Отсюда и облик: не выжженная земля и не мёрзлая, а **выбеленная**, с
  // фиолетовыми разломами вместо рек. Цвет нарочно холоднее подземелья, чтобы
  // два фиолетовых места не слиплись в одно.
  breach: {
    id: 'breach',
    bloom: 0.9,  tone: ['#c9a8ff', '#100a1a', 0.18], vignette: '10,6,20',
    name: 'Пролом',
    subtitle: 'опасность: за гранью',
    order: 4,
    unlockLevel: 40,
    levelRange: [40, 52],
    music: 'breach',
    wind: 1.5,   // воздух здесь рвётся вместе с землёй
    maxRarity: 'legendary',
    dapple: 0.15, // кронам почти нечего держать
    haze: ['rgba(180,150,220,1)', 0.19],
    weather: 'rift',
    // Земля здесь сама по себе враг: у разломов дышат выбросы пустоты. Урон
    // невелик — 4 в полсекунды, — но он идёт всё время, пока стоишь, и лечится
    // только уходом. Это меняет бой: отступать теперь тоже надо думая.
    hazard: { count: 16, r: 26, pct: 0.035, dps: 8, effect: ['slow', 1.2, 1] },
    ambient: '#9a90b8',
    grade: { color: '#7a4fd0', alpha: 0.13 },
    portal: 'portalBreach',
    trees: ['treePale', 'treeRift', 'treeDead'],
    rocks: ['rockPale', 'shardVoid'],
    bushes: [],
    enemies: [['voidling', 26], ['riftStalker', 18], ['paleWarden', 16], ['hollowChoir', 14], ['riftMaw', 14], ['paleSmith', 14]],
    elite: 'riftTitan',
    boss: 'breachHeart',
    bossName: 'Сердце Пролома',
    tiles: {
      seed: 89,
      ramp: ['#2e2b36', '#454150', '#5f5a6d', '#7e7890'],
      ramp2: ['#241a33', '#382948', '#4d3a60', '#63507a'],
      path: ['#3a3644', '#524d60', '#6c6580', '#8a83a0'],
      liquid: ['#0f0a1a', '#1f1533', '#3a2560', '#8b5fd0'],
      wall: ['#1c1926', '#2b2738', '#3e394e', '#544d68'],
      shore: '#5a5270',
      blades: 0, speck: 6, speckColor: '#6a5f80',
      liquidGlow: '#a06ae8',
    },
  },

  dungeon: {
    id: 'dungeon',
    bloom: 1.0,  tone: ['#8a7aff', '#160e22', 0.15], vignette: '4,3,14',
    name: 'Катакомбы Велории',
    subtitle: 'глубина решает всё',
    music: 'dungeon',
    wind: 0,     // под землёй ветра нет
    maxRarity: 'legendary',  // у подземелья свой потолок, по глубине
    dapple: 0,    // под землёй солнца нет
    haze: null,  // под землёй далей нет
    weather: null,
    ambient: '#2a2440',
    grade: { color: '#6a4fd0', alpha: 0.1 },
    portal: 'portalDungeon',
    enemies: [['skeleton', 22], ['bat', 16], ['cultist', 14], ['shade', 14], ['boneShield', 14], ['cultShaman', 10], ['boneGolem', 8]],
    elite: 'boneGolem',
    boss: 'lich',
    bossName: 'Лич Морвэн',
    tiles: {
      seed: 71,
      ramp: ['#221e2c', '#2f2a3d', '#3d3750', '#4f4766'],
      ramp2: ['#1c1a26', '#282433', '#332f42', '#443e55'],
      path: ['#2c2838', '#3a3549', '#4a445c', '#5c5470'],
      liquid: ['#0e1c30', '#173050', '#22486f', '#3d7aa8'],
      wall: ['#171420', '#241f2e', '#332c40', '#443a52'],
      shore: '#2c2838',
      blades: 0, speck: 5, speckColor: '#171420',
      pathStyle: 'cobble', ground2Style: 'cobble',
      wallStyle: 'brick',
      void: '#05040a',
    },
  },
};

export const OVERWORLD = ['forest', 'swamp', 'frost', 'ember', 'breach'];

export function biomeOf(id) { return BIOMES[id] || BIOMES.forest; }

/** Уровень мобов в зоне: середина диапазона + разброс. */
export function zoneLevel(biome, sub = 0) {
  if (!biome.levelRange) return 1;
  const [a, b] = biome.levelRange;
  return Math.round(a + (b - a) * 0.35) + sub;
}
