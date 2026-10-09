// Tower and enemy definitions shared by every level. Level data (paths,
// waves, themes) lives in levels.js.
//
// Damage model, Kingdom Rush style:
//   physical damage is reduced by the enemy's `armor` fraction
//   magic damage is reduced by the enemy's `magicResist` fraction
// Archers and cannons are physical; mages are magic.

export const TOWER_TYPES = {
  // --- Kingdom Rush trio: projectile towers defined by damage type ---------
  archer: {
    id: 'archer',
    name: 'Archer Tower',
    desc: 'Fast, cheap arrows. The backbone of any defense.',
    damageType: 'physical',
    attack: 'projectile',
    projectileSpeed: 320,
    color: '#8d6e3a',
    // levels[0] is the base tower; `cost` is what that tier costs to reach.
    levels: [
      { cost: 70, damage: 10, range: 90, fireInterval: 0.5, splashRadius: 0 },
      { cost: 110, damage: 19, range: 100, fireInterval: 0.45, splashRadius: 0 },
      { cost: 160, damage: 32, range: 110, fireInterval: 0.4, splashRadius: 0 },
      { cost: 240, damage: 52, range: 120, fireInterval: 0.35, splashRadius: 0 },
    ],
  },
  mage: {
    id: 'mage',
    element: 'arcane',
    name: 'Mage Tower',
    desc: 'Slow magic bolts that ignore armor.',
    damageType: 'magic',
    attack: 'projectile',
    projectileSpeed: 280,
    color: '#5a4fcf',
    levels: [
      { cost: 100, damage: 18, range: 105, fireInterval: 1.0, splashRadius: 0 },
      { cost: 160, damage: 36, range: 115, fireInterval: 0.95, splashRadius: 0 },
      { cost: 240, damage: 64, range: 125, fireInterval: 0.9, splashRadius: 0 },
      { cost: 360, damage: 105, range: 135, fireInterval: 0.85, splashRadius: 0 },
    ],
  },
  cannon: {
    id: 'cannon',
    name: 'Cannon Tower',
    desc: 'Splash damage for packed groups.',
    damageType: 'physical',
    attack: 'projectile',
    projectileSpeed: 220,
    color: '#555b61',
    levels: [
      { cost: 125, damage: 28, range: 80, fireInterval: 1.5, splashRadius: 40 },
      { cost: 220, damage: 52, range: 90, fireInterval: 1.4, splashRadius: 48 },
      { cost: 320, damage: 92, range: 100, fireInterval: 1.3, splashRadius: 56 },
      { cost: 460, damage: 150, range: 110, fireInterval: 1.2, splashRadius: 64 },
    ],
  },
  mortar: {
    id: 'mortar',
    name: 'Mortar',
    desc: 'Lobs shells across the map with a huge blast, but cannot hit anything close.',
    damageType: 'physical',
    attack: 'projectile',
    projectileSpeed: 180,
    color: '#7a6a4a',
    // minRange: enemies nearer than this cannot be targeted.
    levels: [
      { cost: 180, damage: 60, range: 170, minRange: 70, fireInterval: 2.6, splashRadius: 56 },
      { cost: 280, damage: 105, range: 185, minRange: 70, fireInterval: 2.5, splashRadius: 62 },
      { cost: 400, damage: 170, range: 200, minRange: 70, fireInterval: 2.4, splashRadius: 70 },
      { cost: 560, damage: 260, range: 215, minRange: 70, fireInterval: 2.3, splashRadius: 78 },
    ],
  },
  sniper: {
    id: 'sniper',
    name: 'Sniper Nest',
    desc: 'Slow, enormous shots that pierce armor and always pick the toughest enemy.',
    damageType: 'physical',
    attack: 'projectile',
    projectileSpeed: 700,
    color: '#4a6b3a',
    targeting: 'toughest',
    // armorPierce: fraction of the target's armor that is ignored.
    levels: [
      { cost: 150, damage: 55, range: 150, fireInterval: 2.0, splashRadius: 0, armorPierce: 0.5 },
      { cost: 240, damage: 100, range: 165, fireInterval: 1.9, splashRadius: 0, armorPierce: 0.6 },
      { cost: 350, damage: 170, range: 180, fireInterval: 1.8, splashRadius: 0, armorPierce: 0.7 },
      { cost: 480, damage: 270, range: 195, fireInterval: 1.7, splashRadius: 0, armorPierce: 0.8 },
    ],
  },

  // --- Radiant Defense set: towers defined by their mechanic -------------
  frost: {
    id: 'frost',
    element: 'ice',
    name: 'Frost Spire',
    desc: 'Ice shards that chill enemies, slowing them down.',
    damageType: 'magic',
    attack: 'projectile',
    projectileSpeed: 300,
    color: '#8fd3ff',
    // slow: enemy speed is multiplied by `factor` for `duration` seconds.
    levels: [
      { cost: 80, damage: 6, range: 95, fireInterval: 0.8, splashRadius: 0, slow: { factor: 0.55, duration: 2 } },
      { cost: 130, damage: 12, range: 105, fireInterval: 0.75, splashRadius: 0, slow: { factor: 0.45, duration: 2.2 } },
      { cost: 190, damage: 20, range: 115, fireInterval: 0.7, splashRadius: 0, slow: { factor: 0.35, duration: 2.5 } },
      { cost: 280, damage: 32, range: 125, fireInterval: 0.65, splashRadius: 0, slow: { factor: 0.28, duration: 2.8 } },
    ],
  },
  tesla: {
    id: 'tesla',
    element: 'storm',
    name: 'Tesla Coil',
    desc: 'Lightning that arcs from enemy to enemy.',
    damageType: 'magic',
    attack: 'chain',
    color: '#b9e0ff',
    // chain: hits the target, then jumps to the nearest enemy within
    // `chainRadius` up to `jumps` more times, losing `falloff` each jump.
    levels: [
      { cost: 140, damage: 22, range: 100, fireInterval: 1.2, jumps: 3, chainRadius: 70, falloff: 0.7 },
      { cost: 230, damage: 42, range: 110, fireInterval: 1.1, jumps: 4, chainRadius: 80, falloff: 0.72 },
      { cost: 330, damage: 70, range: 120, fireInterval: 1.0, jumps: 5, chainRadius: 90, falloff: 0.75 },
      { cost: 470, damage: 110, range: 130, fireInterval: 0.9, jumps: 6, chainRadius: 100, falloff: 0.78 },
    ],
  },
  flame: {
    id: 'flame',
    element: 'fire',
    name: 'Flamethrower',
    desc: 'Short-range fire that leaves enemies burning.',
    damageType: 'physical',
    attack: 'instant',
    color: '#ff8c33',
    // burn: `dps` damage per second for `duration` seconds after each hit.
    levels: [
      { cost: 110, damage: 4, range: 70, fireInterval: 0.15, burn: { dps: 6, duration: 3 } },
      { cost: 180, damage: 8, range: 78, fireInterval: 0.15, burn: { dps: 12, duration: 3 } },
      { cost: 260, damage: 14, range: 86, fireInterval: 0.15, burn: { dps: 20, duration: 3.5 } },
      { cost: 380, damage: 22, range: 94, fireInterval: 0.15, burn: { dps: 32, duration: 4 } },
    ],
  },
  venom: {
    id: 'venom',
    element: 'poison',
    name: 'Venom Spitter',
    desc: 'Poison that stacks with every hit; keep spitting and heavies melt.',
    damageType: 'magic',
    attack: 'projectile',
    projectileSpeed: 260,
    color: '#8fd33a',
    // poison: each hit adds a stack (up to maxStacks); the target takes
    // dpsPerStack × stacks per second for `duration` seconds after the last hit.
    levels: [
      { cost: 120, damage: 5, range: 95, fireInterval: 0.6, splashRadius: 0, poison: { dpsPerStack: 5, maxStacks: 5, duration: 4 } },
      { cost: 190, damage: 9, range: 105, fireInterval: 0.55, splashRadius: 0, poison: { dpsPerStack: 9, maxStacks: 5, duration: 4 } },
      { cost: 280, damage: 14, range: 115, fireInterval: 0.5, splashRadius: 0, poison: { dpsPerStack: 14, maxStacks: 6, duration: 4.5 } },
      { cost: 390, damage: 20, range: 125, fireInterval: 0.45, splashRadius: 0, poison: { dpsPerStack: 20, maxStacks: 6, duration: 5 } },
    ],
  },
  laser: {
    id: 'laser',
    element: 'arcane',
    name: 'Laser Lance',
    desc: 'A steady beam that burns hotter the longer it holds a target.',
    damageType: 'magic',
    attack: 'beam',
    color: '#ff4fd8',
    // beam: `dps` continuous damage, scaling up to `rampMultiplier` after
    // `rampTime` seconds on the same target.
    levels: [
      { cost: 160, dps: 20, range: 110, rampTime: 3, rampMultiplier: 2.5 },
      { cost: 260, dps: 40, range: 120, rampTime: 2.8, rampMultiplier: 2.7 },
      { cost: 380, dps: 70, range: 130, rampTime: 2.5, rampMultiplier: 3 },
      { cost: 540, dps: 110, range: 140, rampTime: 2.2, rampMultiplier: 3.2 },
    ],
  },
  beacon: {
    id: 'beacon',
    name: 'War Beacon',
    desc: 'Fires nothing itself, but every tower within its light hits harder.',
    damageType: 'none',
    attack: 'aura',
    color: '#ffd166',
    // boost: damage multiplier granted to towers within `range` of the beacon.
    // Boosts from several beacons do not stack; the strongest applies.
    // Build spots sit 100-240px apart, so a fresh beacon needs ~180 range
    // to reach its neighbours at all.
    levels: [
      { cost: 130, range: 180, boost: 1.2 },
      { cost: 220, range: 200, boost: 1.3 },
      { cost: 330, range: 220, boost: 1.4 },
      { cost: 460, range: 240, boost: 1.55 },
    ],
  },
};

export const MAX_TOWER_LEVEL = 4;

// `lives` is what an enemy costs if it reaches the castle (default 1):
// heavy brutes cost 2, bosses cost 5.
// Traits:
//   regen     hp per second, stopped while burning or poisoned
//   shield    energy shield hp; absorbs hits (magic x1.5, physical x0.5),
//             blocks every status while up, recharges after 3s untouched
//   element   fire | ice | poison | storm, shown on the sprite
//   immune    statuses that never land: 'burn' | 'slow' | 'poison'
//   weakTo    tower element that deals 1.5x: fire | ice | poison | storm | arcane
//   summons   boss calls { count } of { type } when its hp drops to { at }
//   enrage    boss speeds up (and hardens) below 30% hp
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
    id: 'orc', name: 'Orc', hp: 110, speed: 40, bounty: 22, radius: 12, lives: 2,
    armor: 0.3, magicResist: 0, color: '#3e7d3e',
    look: { body: 'round', features: ['helmet', 'pads', 'tusks'] },
  },
  orcWarlord: {
    id: 'orcWarlord', name: 'Orc Warlord', hp: 650, speed: 32, bounty: 150, radius: 19, lives: 5,
    armor: 0.35, magicResist: 0.1, color: '#2f6b2f', boss: true,
    look: { body: 'big', features: ['helmet', 'pads', 'tusks', 'crown'] },
    regen: 4, weakTo: 'arcane', enrage: true,
    summons: { at: 0.5, type: 'orc', count: 4 },
  },

  // --- Level 2: Frostpeak ---
  snowWolf: {
    id: 'snowWolf', name: 'Snow Wolf', hp: 40, speed: 120, bounty: 8, radius: 8,
    armor: 0, magicResist: 0.1, color: '#e4ecf2',
    look: { body: 'long', features: ['wolf'] },
  },
  iceSprite: {
    id: 'iceSprite', name: 'Ice Sprite', hp: 45, speed: 85, bounty: 14, radius: 8,
    armor: 0, magicResist: 0.7, color: '#8fd3ff',
    look: { body: 'wisp', features: ['glow', 'wings'] },
    shield: 15, element: 'ice', immune: ['slow'], weakTo: 'fire',
  },
  yeti: {
    id: 'yeti', name: 'Yeti', hp: 200, speed: 42, bounty: 28, radius: 13, lives: 2,
    armor: 0.25, magicResist: 0, color: '#d8dde3',
    look: { body: 'round', features: ['horns', 'tooth'] },
    element: 'ice', immune: ['slow'], weakTo: 'fire',
  },
  frostTroll: {
    id: 'frostTroll', name: 'Frost Troll', hp: 380, speed: 34, bounty: 52, radius: 14, lives: 2,
    armor: 0.45, magicResist: 0, color: '#6f9fbf',
    look: { body: 'round', features: ['pads', 'tusks', 'club'] },
    regen: 5, element: 'ice', immune: ['slow'], weakTo: 'fire',
  },
  frostGiant: {
    id: 'frostGiant', name: 'Frost Giant', hp: 2500, speed: 28, bounty: 300, radius: 21, lives: 5,
    armor: 0.4, magicResist: 0.25, color: '#5d8fb3', boss: true,
    look: { body: 'big', features: ['horns', 'pads', 'club', 'crown', 'scarf'] },
    regen: 10, element: 'ice', immune: ['slow'], weakTo: 'fire', enrage: true,
    summons: { at: 0.5, type: 'snowWolf', count: 6 },
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
    id: 'duneWasp', name: 'Dune Wasp', hp: 45, speed: 130, bounty: 13, radius: 7,
    armor: 0, magicResist: 0.4, color: '#e8c33a',
    look: { body: 'wisp', features: ['wings', 'stinger'] },
    shield: 15,
  },
  sandGolem: {
    id: 'sandGolem', name: 'Sand Golem', hp: 400, speed: 30, bounty: 64, radius: 15, lives: 2,
    armor: 0.6, magicResist: 0, color: '#d9b36c',
    look: { body: 'round', features: ['shell', 'spikes'] },
    regen: 4, weakTo: 'storm',
  },
  sandWyrm: {
    id: 'sandWyrm', name: 'Sand Wyrm', hp: 2200, speed: 34, bounty: 450, radius: 22, lives: 5,
    armor: 0.5, magicResist: 0.2, color: '#c9953f', boss: true,
    look: { body: 'big', features: ['shell', 'spikes', 'tusks', 'crown'] },
    regen: 12, weakTo: 'storm', enrage: true,
    summons: { at: 0.5, type: 'scorpion', count: 8 },
  },

  // --- Level 4: Murkwater Swamp ---
  bogFrog: {
    id: 'bogFrog', name: 'Bog Frog', hp: 60, speed: 100, bounty: 12, radius: 9,
    armor: 0, magicResist: 0.2, color: '#5fae3a',
    look: { body: 'round', features: ['frog'] },
    element: 'poison', immune: ['poison'],
  },
  willOWisp: {
    id: 'willOWisp', name: 'Will-o-Wisp', hp: 45, speed: 115, bounty: 16, radius: 7,
    armor: 0, magicResist: 0.9, color: '#a8ffc8',
    look: { body: 'wisp', features: ['glow', 'flame'] },
    shield: 15, element: 'storm', weakTo: 'poison',
  },
  swampWitch: {
    id: 'swampWitch', name: 'Swamp Witch', hp: 130, speed: 55, bounty: 34, radius: 10,
    armor: 0.1, magicResist: 0.7, color: '#7a5c9e',
    look: { body: 'round', features: ['hat', 'glow'] },
    shield: 30, element: 'poison', immune: ['poison'], weakTo: 'fire',
  },
  bogTroll: {
    id: 'bogTroll', name: 'Bog Troll', hp: 540, speed: 32, bounty: 78, radius: 15, lives: 2,
    armor: 0.4, magicResist: 0.2, color: '#4f6b3a',
    look: { body: 'round', features: ['tusks', 'club', 'pads'] },
    regen: 8, weakTo: 'fire',
  },
  hydra: {
    id: 'hydra', name: 'Hydra', hp: 4200, speed: 30, bounty: 700, radius: 23, lives: 5,
    armor: 0.35, magicResist: 0.4, color: '#3f8a5a', boss: true,
    look: { body: 'big', features: ['horns', 'spikes', 'tusks', 'crown', 'glow'] },
    regen: 35, element: 'poison', immune: ['poison'], weakTo: 'fire',
    summons: { at: 0.5, type: 'bogFrog', count: 10 },
  },

  // --- Level 5: Ember Caldera ---
  fireImp: {
    id: 'fireImp', name: 'Fire Imp', hp: 70, speed: 115, bounty: 17, radius: 8,
    armor: 0, magicResist: 0.6, color: '#e8552f',
    look: { body: 'round', features: ['horns', 'flame', 'tooth'] },
    element: 'fire', immune: ['burn'], weakTo: 'ice',
  },
  lavaHound: {
    id: 'lavaHound', name: 'Lava Hound', hp: 150, speed: 75, bounty: 30, radius: 10,
    armor: 0.35, magicResist: 0.3, color: '#8a2f1f',
    look: { body: 'long', features: ['wolf', 'flame'] },
    element: 'fire', immune: ['burn'], weakTo: 'ice',
  },
  ashWraith: {
    id: 'ashWraith', name: 'Ash Wraith', hp: 150, speed: 75, bounty: 40, radius: 9,
    armor: 0, magicResist: 0.85, color: '#6c6c7a',
    look: { body: 'wisp', features: ['glow', 'hat'] },
    shield: 45, element: 'storm', weakTo: 'poison',
  },
  obsidianGolem: {
    id: 'obsidianGolem', name: 'Obsidian Golem', hp: 720, speed: 28, bounty: 115, radius: 16, lives: 2,
    armor: 0.7, magicResist: 0.2, color: '#2c2c34',
    look: { body: 'round', features: ['shell', 'spikes', 'glow'] },
    regen: 5, weakTo: 'storm',
  },
  dragon: {
    id: 'dragon', name: 'Ember Dragon', hp: 8000, speed: 30, bounty: 1200, radius: 24, lives: 5,
    armor: 0.45, magicResist: 0.45, color: '#b8321f', boss: true,
    look: { body: 'big', features: ['wings', 'horns', 'spikes', 'flame', 'crown'] },
    shield: 900, element: 'fire', immune: ['burn'], weakTo: 'ice', regen: 20, enrage: true,
    summons: { at: 0.5, type: 'fireImp', count: 10 },
  },
};
