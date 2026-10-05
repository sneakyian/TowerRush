// Tower and enemy definitions shared by every level. Level data (paths,
// waves, themes) lives in levels.js.
//
// Damage model, Kingdom Rush style:
//   physical damage is reduced by the enemy's `armor` fraction
//   magic damage is reduced by the enemy's `magicResist` fraction
// Archers and cannons are physical; mages are magic.

export const TOWER_TYPES = {
  archer: {
    id: 'archer',
    name: 'Archer Tower',
    damageType: 'physical',
    projectileSpeed: 320,
    color: '#8d6e3a',
    // levels[0] is the base tower; `cost` is what that tier costs to reach.
    levels: [
      { cost: 70, damage: 10, range: 90, fireInterval: 0.5, splashRadius: 0 },
      { cost: 110, damage: 19, range: 100, fireInterval: 0.45, splashRadius: 0 },
      { cost: 160, damage: 32, range: 110, fireInterval: 0.4, splashRadius: 0 },
    ],
  },
  mage: {
    id: 'mage',
    name: 'Mage Tower',
    damageType: 'magic',
    projectileSpeed: 280,
    color: '#5a4fcf',
    levels: [
      { cost: 100, damage: 18, range: 105, fireInterval: 1.0, splashRadius: 0 },
      { cost: 160, damage: 36, range: 115, fireInterval: 0.95, splashRadius: 0 },
      { cost: 240, damage: 64, range: 125, fireInterval: 0.9, splashRadius: 0 },
    ],
  },
  cannon: {
    id: 'cannon',
    name: 'Cannon Tower',
    damageType: 'physical',
    projectileSpeed: 220,
    color: '#555b61',
    levels: [
      { cost: 125, damage: 28, range: 80, fireInterval: 1.5, splashRadius: 40 },
      { cost: 220, damage: 52, range: 90, fireInterval: 1.4, splashRadius: 48 },
      { cost: 320, damage: 92, range: 100, fireInterval: 1.3, splashRadius: 56 },
    ],
  },
};

export const MAX_TOWER_LEVEL = 3;

// `look` drives the sprite composer in render.js:
//   body: 'round' | 'long' | 'big' | 'wisp'
//   features: any of ears, club, tooth, wolf, helmet, pads, tusks, shell,
//             stinger, hat, wings, flame, spikes, crown, glow, scarf, horns, frog
export const ENEMY_TYPES = {
  // --- Level 1: Greenfields ---
  goblin: {
    id: 'goblin', name: 'Goblin', hp: 40, speed: 60, bounty: 8, radius: 9,
    armor: 0, magicResist: 0, color: '#4f9e4f',
    look: { body: 'round', features: ['ears', 'tooth', 'club'] },
  },
  wolf: {
    id: 'wolf', name: 'Wolf', hp: 26, speed: 110, bounty: 6, radius: 8,
    armor: 0, magicResist: 0, color: '#9e9e9e',
    look: { body: 'long', features: ['wolf'] },
  },
  orc: {
    id: 'orc', name: 'Orc', hp: 110, speed: 40, bounty: 18, radius: 12,
    armor: 0.3, magicResist: 0, color: '#3e7d3e',
    look: { body: 'round', features: ['helmet', 'pads', 'tusks'] },
  },
  orcWarlord: {
    id: 'orcWarlord', name: 'Orc Warlord', hp: 380, speed: 32, bounty: 150, radius: 19,
    armor: 0.35, magicResist: 0.1, color: '#2f6b2f', boss: true,
    look: { body: 'big', features: ['helmet', 'pads', 'tusks', 'crown'] },
  },

  // --- Level 2: Frostpeak ---
  snowWolf: {
    id: 'snowWolf', name: 'Snow Wolf', hp: 40, speed: 120, bounty: 8, radius: 8,
    armor: 0, magicResist: 0.1, color: '#e4ecf2',
    look: { body: 'long', features: ['wolf'] },
  },
  iceSprite: {
    id: 'iceSprite', name: 'Ice Sprite', hp: 45, speed: 85, bounty: 10, radius: 8,
    armor: 0, magicResist: 0.7, color: '#8fd3ff',
    look: { body: 'wisp', features: ['glow', 'wings'] },
  },
  yeti: {
    id: 'yeti', name: 'Yeti', hp: 200, speed: 42, bounty: 24, radius: 13,
    armor: 0.25, magicResist: 0, color: '#d8dde3',
    look: { body: 'round', features: ['horns', 'tooth'] },
  },
  frostTroll: {
    id: 'frostTroll', name: 'Frost Troll', hp: 420, speed: 34, bounty: 40, radius: 14,
    armor: 0.45, magicResist: 0, color: '#6f9fbf',
    look: { body: 'round', features: ['pads', 'tusks', 'club'] },
  },
  frostGiant: {
    id: 'frostGiant', name: 'Frost Giant', hp: 650, speed: 28, bounty: 300, radius: 21,
    armor: 0.4, magicResist: 0.25, color: '#5d8fb3', boss: true,
    look: { body: 'big', features: ['horns', 'pads', 'club', 'crown', 'scarf'] },
  },

  // --- Level 3: Sunscorch Desert ---
  scorpion: {
    id: 'scorpion', name: 'Scorpion', hp: 50, speed: 95, bounty: 10, radius: 9,
    armor: 0.4, magicResist: 0, color: '#b8742e',
    look: { body: 'long', features: ['stinger', 'shell'] },
  },
  bandit: {
    id: 'bandit', name: 'Bandit', hp: 70, speed: 70, bounty: 12, radius: 10,
    armor: 0.1, magicResist: 0.2, color: '#c99a5a',
    look: { body: 'round', features: ['hat', 'scarf'] },
  },
  duneWasp: {
    id: 'duneWasp', name: 'Dune Wasp', hp: 45, speed: 130, bounty: 10, radius: 7,
    armor: 0, magicResist: 0.4, color: '#e8c33a',
    look: { body: 'wisp', features: ['wings', 'stinger'] },
  },
  sandGolem: {
    id: 'sandGolem', name: 'Sand Golem', hp: 450, speed: 30, bounty: 50, radius: 15,
    armor: 0.6, magicResist: 0, color: '#d9b36c',
    look: { body: 'round', features: ['shell', 'spikes'] },
  },
  sandWyrm: {
    id: 'sandWyrm', name: 'Sand Wyrm', hp: 1000, speed: 34, bounty: 450, radius: 22,
    armor: 0.5, magicResist: 0.2, color: '#c9953f', boss: true,
    look: { body: 'big', features: ['shell', 'spikes', 'tusks', 'crown'] },
  },

  // --- Level 4: Murkwater Swamp ---
  bogFrog: {
    id: 'bogFrog', name: 'Bog Frog', hp: 60, speed: 100, bounty: 10, radius: 9,
    armor: 0, magicResist: 0.2, color: '#5fae3a',
    look: { body: 'round', features: ['frog'] },
  },
  willOWisp: {
    id: 'willOWisp', name: 'Will-o-Wisp', hp: 45, speed: 115, bounty: 12, radius: 7,
    armor: 0, magicResist: 0.9, color: '#a8ffc8',
    look: { body: 'wisp', features: ['glow', 'flame'] },
  },
  swampWitch: {
    id: 'swampWitch', name: 'Swamp Witch', hp: 130, speed: 55, bounty: 26, radius: 10,
    armor: 0.1, magicResist: 0.7, color: '#7a5c9e',
    look: { body: 'round', features: ['hat', 'glow'] },
  },
  bogTroll: {
    id: 'bogTroll', name: 'Bog Troll', hp: 650, speed: 32, bounty: 60, radius: 15,
    armor: 0.4, magicResist: 0.2, color: '#4f6b3a',
    look: { body: 'round', features: ['tusks', 'club', 'pads'] },
  },
  hydra: {
    id: 'hydra', name: 'Hydra', hp: 2000, speed: 30, bounty: 700, radius: 23,
    armor: 0.35, magicResist: 0.4, color: '#3f8a5a', boss: true,
    look: { body: 'big', features: ['horns', 'spikes', 'tusks', 'crown', 'glow'] },
  },

  // --- Level 5: Ember Caldera ---
  fireImp: {
    id: 'fireImp', name: 'Fire Imp', hp: 70, speed: 115, bounty: 14, radius: 8,
    armor: 0, magicResist: 0.6, color: '#e8552f',
    look: { body: 'round', features: ['horns', 'flame', 'tooth'] },
  },
  lavaHound: {
    id: 'lavaHound', name: 'Lava Hound', hp: 150, speed: 75, bounty: 24, radius: 10,
    armor: 0.35, magicResist: 0.3, color: '#8a2f1f',
    look: { body: 'long', features: ['wolf', 'flame'] },
  },
  ashWraith: {
    id: 'ashWraith', name: 'Ash Wraith', hp: 150, speed: 75, bounty: 30, radius: 9,
    armor: 0, magicResist: 0.85, color: '#6c6c7a',
    look: { body: 'wisp', features: ['glow', 'hat'] },
  },
  obsidianGolem: {
    id: 'obsidianGolem', name: 'Obsidian Golem', hp: 900, speed: 28, bounty: 90, radius: 16,
    armor: 0.7, magicResist: 0.2, color: '#2c2c34',
    look: { body: 'round', features: ['shell', 'spikes', 'glow'] },
  },
  dragon: {
    id: 'dragon', name: 'Ember Dragon', hp: 2400, speed: 30, bounty: 1200, radius: 24,
    armor: 0.45, magicResist: 0.45, color: '#b8321f', boss: true,
    look: { body: 'big', features: ['wings', 'horns', 'spikes', 'flame', 'crown'] },
  },
};
