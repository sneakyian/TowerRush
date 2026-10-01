// All game data in one place: the level, towers, enemies, and waves.

export const TOWER_TYPES = {
  archer: {
    id: 'archer',
    name: 'Archer Tower',
    cost: 70,
    range: 90,
    damage: 10,
    fireInterval: 0.5, // seconds between shots
    projectileSpeed: 320,
    splashRadius: 0,
    color: '#8d6e3a',
  },
  cannon: {
    id: 'cannon',
    name: 'Cannon Tower',
    cost: 120,
    range: 80,
    damage: 26,
    fireInterval: 1.5,
    projectileSpeed: 220,
    splashRadius: 40,
    color: '#555b61',
  },
  mage: {
    id: 'mage',
    name: 'Mage Tower',
    cost: 100,
    range: 105,
    damage: 18,
    fireInterval: 1.0,
    projectileSpeed: 280,
    splashRadius: 0,
    color: '#5a4fcf',
  },
};

export const ENEMY_TYPES = {
  goblin: { id: 'goblin', name: 'Goblin', hp: 40, speed: 60, bounty: 5, radius: 9, color: '#4f9e4f' },
  wolf:   { id: 'wolf',   name: 'Wolf',   hp: 26, speed: 110, bounty: 4, radius: 8, color: '#9e9e9e' },
  orc:    { id: 'orc',    name: 'Orc',    hp: 130, speed: 40, bounty: 12, radius: 12, color: '#3e7d3e' },
};

// A single level. Path waypoints run from spawn (first) to exit (last).
export const LEVEL_1 = {
  width: 800,
  height: 480,
  startingGold: 200,
  startingLives: 20,
  sellRefund: 0.5, // fraction of cost returned when selling
  path: [
    { x: -20, y: 120 },
    { x: 180, y: 120 },
    { x: 240, y: 200 },
    { x: 180, y: 300 },
    { x: 300, y: 380 },
    { x: 520, y: 380 },
    { x: 600, y: 300 },
    { x: 540, y: 190 },
    { x: 640, y: 110 },
    { x: 820, y: 110 },
  ],
  buildSpots: [
    { x: 120, y: 190 },
    { x: 280, y: 130 },
    { x: 130, y: 360 },
    { x: 310, y: 300 },
    { x: 470, y: 310 },
    { x: 480, y: 440 },
    { x: 620, y: 220 },
    { x: 700, y: 180 },
  ],
  waves: [
    { entries: [{ type: 'goblin', count: 6, interval: 1.2 }] },
    { entries: [{ type: 'goblin', count: 8, interval: 1.0 }, { type: 'wolf', count: 3, interval: 0.8 }] },
    { entries: [{ type: 'wolf', count: 8, interval: 0.7 }, { type: 'goblin', count: 5, interval: 1.0 }] },
    { entries: [{ type: 'orc', count: 4, interval: 2.0 }, { type: 'goblin', count: 8, interval: 0.8 }] },
    { entries: [{ type: 'orc', count: 6, interval: 1.5 }, { type: 'wolf', count: 10, interval: 0.6 }] },
  ],
};
