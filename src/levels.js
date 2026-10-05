// The five levels. Each has its own path, build spots, water bodies, theme,
// decoration set, and waves. The last wave of every level carries its boss.
//
// theme.decor names map to drawing routines in render.js.

const SIZE = { width: 800, height: 480 };

export const LEVELS = [
  {
    ...SIZE,
    id: 'greenfields',
    name: 'Greenfields',
    subtitle: 'Goblins raid the farmland. Hold the road to the castle.',
    startingGold: 200,
    startingLives: 20,
    sellRefund: 0.5,
    path: [
      { x: -20, y: 120 }, { x: 180, y: 120 }, { x: 240, y: 200 }, { x: 180, y: 300 },
      { x: 300, y: 380 }, { x: 520, y: 380 }, { x: 600, y: 300 }, { x: 540, y: 190 },
      { x: 640, y: 110 }, { x: 820, y: 110 },
    ],
    buildSpots: [
      { x: 120, y: 168 }, { x: 259, y: 146 }, { x: 150, y: 337 }, { x: 296, y: 320 },
      { x: 470, y: 332 }, { x: 480, y: 428 }, { x: 613, y: 224 }, { x: 700, y: 158 },
    ],
    water: [{ x: 700, y: 400, rx: 65, ry: 36 }],
    theme: {
      groundTop: '#74a855', groundBottom: '#5f9448',
      mottleLight: 'rgba(255,255,230,0.05)', mottleDark: 'rgba(30,60,20,0.06)',
      pathEdge: '#8a7347', pathFill: '#c9b178', pathLine: 'rgba(138,115,71,0.5)',
      waterShallow: '#5aa0d8', waterDeep: '#2f6aa8', waterGlow: 'rgba(255,255,255,0.35)',
      stone: '#9aa1a8', stoneDark: '#7d848c', cloudAlpha: 0.13,
      decor: ['tree', 'tree', 'bush', 'rock', 'flower'],
    },
    waves: [
      { entries: [{ type: 'goblin', count: 6, interval: 1.2 }] },
      { entries: [{ type: 'goblin', count: 8, interval: 1.0 }, { type: 'wolf', count: 3, interval: 0.8 }] },
      { entries: [{ type: 'wolf', count: 8, interval: 0.7 }, { type: 'goblin', count: 5, interval: 1.0 }] },
      { entries: [{ type: 'orc', count: 4, interval: 2.0 }, { type: 'goblin', count: 8, interval: 0.8 }] },
      { entries: [{ type: 'orc', count: 6, interval: 1.5 }, { type: 'wolf', count: 10, interval: 0.6 }] },
      { entries: [{ type: 'goblin', count: 6, interval: 0.8 }, { type: 'orcWarlord', count: 1, interval: 3 }, { type: 'orc', count: 4, interval: 1.5 }] },
    ],
  },

  {
    ...SIZE,
    id: 'frostpeak',
    name: 'Frostpeak Pass',
    subtitle: 'Yetis and ice sprites pour down the mountain switchbacks.',
    startingGold: 320,
    startingLives: 20,
    sellRefund: 0.5,
    path: [
      { x: -20, y: 80 }, { x: 140, y: 80 }, { x: 140, y: 240 }, { x: 330, y: 240 },
      { x: 330, y: 110 }, { x: 520, y: 110 }, { x: 520, y: 330 }, { x: 700, y: 330 },
      { x: 700, y: 200 }, { x: 820, y: 200 },
    ],
    buildSpots: [
      { x: 92, y: 160 }, { x: 230, y: 192 }, { x: 230, y: 288 }, { x: 420, y: 158 },
      { x: 472, y: 300 }, { x: 568, y: 220 }, { x: 470, y: 62 }, { x: 748, y: 280 },
    ],
    water: [{ x: 600, y: 430, rx: 95, ry: 38 }, { x: 80, y: 400, rx: 55, ry: 30 }],
    theme: {
      groundTop: '#eef3f7', groundBottom: '#cfdce6',
      mottleLight: 'rgba(255,255,255,0.35)', mottleDark: 'rgba(120,150,175,0.12)',
      pathEdge: '#8fa3b2', pathFill: '#d4e0e8', pathLine: 'rgba(120,145,160,0.45)',
      waterShallow: '#a9dcf2', waterDeep: '#6fb4d9', waterGlow: 'rgba(255,255,255,0.6)',
      stone: '#8c95a0', stoneDark: '#6a737e', cloudAlpha: 0.1,
      decor: ['pine', 'pine', 'snowrock', 'deadbush', 'iceshard'],
    },
    waves: [
      { entries: [{ type: 'snowWolf', count: 8, interval: 0.9 }] },
      { entries: [{ type: 'yeti', count: 3, interval: 2.0 }, { type: 'snowWolf', count: 6, interval: 0.7 }] },
      { entries: [{ type: 'iceSprite', count: 8, interval: 0.8 }, { type: 'yeti', count: 3, interval: 1.5 }] },
      { entries: [{ type: 'frostTroll', count: 2, interval: 3 }, { type: 'snowWolf', count: 10, interval: 0.5 }] },
      { entries: [{ type: 'iceSprite', count: 10, interval: 0.6 }, { type: 'yeti', count: 5, interval: 1.2 }] },
      { entries: [{ type: 'frostTroll', count: 4, interval: 2 }, { type: 'iceSprite', count: 8, interval: 0.6 }] },
      { entries: [{ type: 'yeti', count: 6, interval: 1.0 }, { type: 'frostGiant', count: 1, interval: 3 }, { type: 'snowWolf', count: 8, interval: 0.5 }] },
    ],
  },

  {
    ...SIZE,
    id: 'sunscorch',
    name: 'Sunscorch Desert',
    subtitle: 'Armored scorpions and sand golems march through the dunes.',
    startingGold: 400,
    startingLives: 20,
    sellRefund: 0.5,
    path: [
      { x: -20, y: 400 }, { x: 120, y: 400 }, { x: 200, y: 300 }, { x: 120, y: 180 },
      { x: 200, y: 80 }, { x: 380, y: 80 }, { x: 450, y: 200 }, { x: 380, y: 330 },
      { x: 450, y: 420 }, { x: 640, y: 420 }, { x: 700, y: 300 }, { x: 640, y: 180 },
      { x: 820, y: 100 },
    ],
    buildSpots: [
      { x: 60, y: 352 }, { x: 215, y: 237 }, { x: 300, y: 128 }, { x: 462, y: 125 },
      { x: 353, y: 278 }, { x: 560, y: 372 }, { x: 745, y: 186 }, { x: 619, y: 137 },
    ],
    water: [{ x: 560, y: 230, rx: 48, ry: 28 }],
    theme: {
      groundTop: '#e6c57e', groundBottom: '#d0a95f',
      mottleLight: 'rgba(255,245,200,0.25)', mottleDark: 'rgba(140,90,30,0.08)',
      pathEdge: '#a87b3a', pathFill: '#d9b98a', pathLine: 'rgba(150,110,60,0.45)',
      waterShallow: '#5fb8cf', waterDeep: '#2b7a94', waterGlow: 'rgba(255,255,255,0.45)',
      stone: '#c9a97a', stoneDark: '#a3855a', cloudAlpha: 0.16,
      decor: ['cactus', 'cactus', 'palm', 'sandrock', 'bones'],
    },
    waves: [
      { entries: [{ type: 'bandit', count: 8, interval: 1.0 }] },
      { entries: [{ type: 'scorpion', count: 8, interval: 0.8 }, { type: 'bandit', count: 4, interval: 1.0 }] },
      { entries: [{ type: 'duneWasp', count: 10, interval: 0.6 }, { type: 'scorpion', count: 6, interval: 0.8 }] },
      { entries: [{ type: 'sandGolem', count: 2, interval: 3 }, { type: 'bandit', count: 10, interval: 0.7 }] },
      { entries: [{ type: 'scorpion', count: 12, interval: 0.6 }, { type: 'duneWasp', count: 8, interval: 0.6 }] },
      { entries: [{ type: 'sandGolem', count: 4, interval: 2.5 }, { type: 'bandit', count: 10, interval: 0.6 }] },
      { entries: [{ type: 'duneWasp', count: 14, interval: 0.5 }, { type: 'sandGolem', count: 3, interval: 2 }] },
      { entries: [{ type: 'scorpion', count: 10, interval: 0.6 }, { type: 'sandWyrm', count: 1, interval: 3 }, { type: 'sandGolem', count: 3, interval: 2 }] },
    ],
  },

  {
    ...SIZE,
    id: 'murkwater',
    name: 'Murkwater Swamp',
    subtitle: 'Witches and wisps shrug off arrows in the misty bog.',
    startingGold: 480,
    startingLives: 20,
    sellRefund: 0.5,
    path: [
      { x: -20, y: 240 }, { x: 130, y: 240 }, { x: 200, y: 140 }, { x: 330, y: 140 },
      { x: 400, y: 260 }, { x: 330, y: 380 }, { x: 520, y: 380 }, { x: 600, y: 260 },
      { x: 700, y: 340 }, { x: 820, y: 340 },
    ],
    buildSpots: [
      { x: 120, y: 170 }, { x: 260, y: 188 }, { x: 260, y: 92 }, { x: 429, y: 214 },
      { x: 470, y: 332 }, { x: 667, y: 375 }, { x: 629, y: 222 }, { x: 760, y: 292 },
    ],
    water: [
      { x: 90, y: 100, rx: 70, ry: 40 }, { x: 230, y: 440, rx: 75, ry: 28 },
      { x: 600, y: 110, rx: 110, ry: 52 }, { x: 740, y: 210, rx: 50, ry: 32 },
      { x: 110, y: 400, rx: 60, ry: 30 }, { x: 420, y: 450, rx: 60, ry: 22 },
    ],
    theme: {
      groundTop: '#5e7c3c', groundBottom: '#44602b',
      mottleLight: 'rgba(200,230,140,0.08)', mottleDark: 'rgba(10,40,10,0.14)',
      pathEdge: '#3f3222', pathFill: '#7a6646', pathLine: 'rgba(60,45,25,0.5)',
      waterShallow: '#4f7f6c', waterDeep: '#2b4d44', waterGlow: 'rgba(200,255,220,0.25)',
      stone: '#7e8a7a', stoneDark: '#5e695c', cloudAlpha: 0.18,
      decor: ['willow', 'reeds', 'reeds', 'mushroom', 'deadtree'],
      lilyPads: true,
    },
    waves: [
      { entries: [{ type: 'bogFrog', count: 10, interval: 0.8 }] },
      { entries: [{ type: 'swampWitch', count: 4, interval: 1.5 }, { type: 'bogFrog', count: 8, interval: 0.7 }] },
      { entries: [{ type: 'willOWisp', count: 10, interval: 0.6 }, { type: 'swampWitch', count: 4, interval: 1.2 }] },
      { entries: [{ type: 'bogTroll', count: 2, interval: 3 }, { type: 'bogFrog', count: 12, interval: 0.6 }] },
      { entries: [{ type: 'swampWitch', count: 8, interval: 1.0 }, { type: 'willOWisp', count: 10, interval: 0.5 }] },
      { entries: [{ type: 'bogTroll', count: 4, interval: 2.5 }, { type: 'bogFrog', count: 12, interval: 0.5 }] },
      { entries: [{ type: 'willOWisp', count: 16, interval: 0.45 }, { type: 'swampWitch', count: 6, interval: 1.0 }] },
      { entries: [{ type: 'bogTroll', count: 5, interval: 2 }, { type: 'swampWitch', count: 8, interval: 0.8 }] },
      { entries: [{ type: 'bogFrog', count: 12, interval: 0.5 }, { type: 'hydra', count: 1, interval: 3 }, { type: 'bogTroll', count: 4, interval: 2 }] },
    ],
  },

  {
    ...SIZE,
    id: 'caldera',
    name: 'Ember Caldera',
    subtitle: 'The dragon\'s brood swarms out of the volcano.',
    startingGold: 650,
    startingLives: 20,
    sellRefund: 0.5,
    path: [
      { x: 400, y: -20 }, { x: 400, y: 90 }, { x: 160, y: 90 }, { x: 160, y: 390 },
      { x: 640, y: 390 }, { x: 640, y: 160 }, { x: 820, y: 160 },
    ],
    buildSpots: [
      { x: 250, y: 138 }, { x: 112, y: 240 }, { x: 250, y: 342 }, { x: 470, y: 342 },
      { x: 592, y: 220 }, { x: 688, y: 250 }, { x: 448, y: 40 }, { x: 300, y: 40 },
    ],
    water: [
      { x: 330, y: 240, rx: 105, ry: 58 }, { x: 740, y: 60, rx: 55, ry: 32 },
      { x: 760, y: 410, rx: 48, ry: 28 }, { x: 60, y: 60, rx: 45, ry: 26 },
    ],
    theme: {
      groundTop: '#4e3e3c', groundBottom: '#2e2524',
      mottleLight: 'rgba(255,150,80,0.07)', mottleDark: 'rgba(0,0,0,0.2)',
      pathEdge: '#2a211f', pathFill: '#6f5a52', pathLine: 'rgba(40,30,28,0.6)',
      waterShallow: '#ff8c33', waterDeep: '#c2401a', waterGlow: 'rgba(255,230,150,0.55)',
      stone: '#5d5a66', stoneDark: '#3f3d47', cloudAlpha: 0.2,
      decor: ['deadtree', 'obsidian', 'obsidian', 'vent', 'ember'],
      lava: true,
    },
    waves: [
      { entries: [{ type: 'fireImp', count: 10, interval: 0.8 }] },
      { entries: [{ type: 'lavaHound', count: 3, interval: 1.5 }, { type: 'fireImp', count: 6, interval: 0.7 }] },
      { entries: [{ type: 'ashWraith', count: 4, interval: 1.4 }, { type: 'fireImp', count: 8, interval: 0.7 }] },
      { entries: [{ type: 'obsidianGolem', count: 2, interval: 3 }, { type: 'lavaHound', count: 5, interval: 1.0 }] },
      { entries: [{ type: 'ashWraith', count: 8, interval: 0.9 }, { type: 'fireImp', count: 12, interval: 0.55 }] },
      { entries: [{ type: 'obsidianGolem', count: 3, interval: 2.5 }, { type: 'lavaHound', count: 8, interval: 0.8 }] },
      { entries: [{ type: 'fireImp', count: 16, interval: 0.45 }, { type: 'ashWraith', count: 6, interval: 0.9 }] },
      { entries: [{ type: 'obsidianGolem', count: 5, interval: 2 }, { type: 'ashWraith', count: 10, interval: 0.7 }] },
      { entries: [{ type: 'lavaHound', count: 14, interval: 0.6 }, { type: 'obsidianGolem', count: 4, interval: 2 }] },
      { entries: [{ type: 'fireImp', count: 12, interval: 0.5 }, { type: 'dragon', count: 1, interval: 3 }, { type: 'obsidianGolem', count: 4, interval: 2 }, { type: 'lavaHound', count: 8, interval: 0.6 }] },
    ],
  },
];

// Kept for backwards compatibility with existing imports and tests.
export const LEVEL_1 = LEVELS[0];
