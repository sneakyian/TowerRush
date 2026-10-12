// Headless "AI player" used to balance levels and to assert they are
// winnable. It plays a greedy, reasonable strategy: fill the spots closest
// to the path first, keep a mix of tower types, upgrade when flush, and
// start each wave as soon as the build phase begins.

import { Game, PHASE } from '../src/game.js';
import { Path } from '../src/path.js';

// Spot indices ordered by how close each sits to the path (closest first).
export function spotsByPathDistance(level) {
  const path = Path.fromLevel(level);
  const dist = (spot) => {
    let min = Infinity;
    for (let d = 0; d <= path.totalLength; d += 6) {
      const p = path.positionAt(d);
      min = Math.min(min, Math.hypot(p.x - spot.x, p.y - spot.y));
    }
    return min;
  };
  return level.buildSpots
    .map((spot, index) => ({ index, d: dist(spot) }))
    .sort((a, b) => a.d - b.d)
    .map((s) => s.index);
}

export const STRATEGIES = {
  // Archer-heavy opening with a mage and a cannon mixed in, like a typical
  // Kingdom Rush build: archer → mage → archer → cannon → ...
  mixed: ['archer', 'mage', 'archer', 'cannon'],
  // Kingdom Rush and Radiant Defense towers together.
  hybrid: ['archer', 'frost', 'mage', 'tesla', 'sniper', 'flame', 'venom', 'mortar', 'laser', 'beacon', 'cannon'],
  // Only the Radiant Defense set.
  radiant: ['frost', 'tesla', 'flame', 'venom', 'laser'],
  // A player who reads the enemy roster and builds counters: fire against
  // the frozen, frost against the burning, lightning against shields and
  // golems, poison against storm wisps, and damage-over-time against anything
  // that regenerates.
  elemental: (level) => ({
    greenfields: ['archer', 'flame', 'mage', 'archer', 'cannon', 'tesla'],
    frostpeak: ['flame', 'archer', 'mage', 'flame', 'tesla', 'archer'],
    sunscorch: ['tesla', 'archer', 'mage', 'tesla', 'frost', 'archer'],
    murkwater: ['archer', 'flame', 'mage', 'venom', 'tesla', 'flame'],
    caldera: ['archer', 'frost', 'tesla', 'archer', 'venom', 'archer', 'frost', 'laser'],
    // Part II: gravity wells unlock at the gate, missiles after it.
    dis: ['frost', 'archer', 'gravity', 'tesla', 'mage', 'frost', 'sniper', 'laser', 'archer', 'venom'],
    neon: ['venom', 'tesla', 'missile', 'gravity', 'venom', 'mage', 'tesla', 'archer', 'laser', 'missile'],
    pit: ['frost', 'missile', 'frost', 'gravity', 'mage', 'archer', 'tesla', 'missile', 'laser', 'frost', 'sniper'],
  })[level.id] || ['archer', 'flame', 'frost', 'tesla', 'venom', 'mage'],
  archersOnly: ['archer'],
  magesOnly: ['mage'],
  cannonsOnly: ['cannon'],
  mortarsOnly: ['mortar'],
  snipersOnly: ['sniper'],
  frostOnly: ['frost'],
  teslaOnly: ['tesla'],
  flameOnly: ['flame'],
  venomOnly: ['venom'],
  laserOnly: ['laser'],
  beaconsOnly: ['beacon'],
};

// Perform one round of purchases: build on the next free spot if affordable,
// otherwise upgrade the cheapest-to-upgrade tower if affordable.
function spend(game, order, rotation, state) {
  let acted = true;
  while (acted) {
    acted = false;
    const free = order.find((i) => game.towers[i] === null);
    if (free !== undefined) {
      // Prefer the rotation's next type; fall back to the cheapest type in
      // the rotation we can afford rather than sitting on gold.
      const preferred = rotation[state.builds % rotation.length];
      const affordable = [preferred, ...rotation]
        .filter((t) => game.towerTypes[t].levels[0].cost <= game.gold)
        .sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : game.towerTypes[a].levels[0].cost - game.towerTypes[b].levels[0].cost));
      if (affordable.length && game.buildTower(free, affordable[0]).ok) {
        state.builds += 1;
        acted = true;
        continue;
      }
    }
    // Upgrade the lowest-level tower whose upgrade we can afford.
    let best = -1;
    let bestLevel = Infinity;
    game.towers.forEach((tower, i) => {
      if (!tower) return;
      const cost = game.upgradeCost(tower);
      if (cost !== null && cost <= game.gold && tower.level < bestLevel) {
        best = i;
        bestLevel = tower.level;
      }
    });
    if (best >= 0 && game.upgradeTower(best).ok) acted = true;
  }
}

// Play a level to completion. Returns a summary.
// Dodges and a few effects roll dice; a seeded generator keeps every run
// of the harness identical.
function seededRandom(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function playLevel(level, { strategy = 'mixed', step = 1 / 30, maxSeconds = 1200, seed = 7 } = {}) {
  const realRandom = Math.random;
  Math.random = seededRandom(seed);
  try {
    return playLevelInner(level, { strategy, step, maxSeconds });
  } finally {
    Math.random = realRandom;
  }
}

function playLevelInner(level, { strategy, step, maxSeconds }) {
  const game = new Game(level);
  const order = spotsByPathDistance(level);
  const chosen = STRATEGIES[strategy];
  const rotation = typeof chosen === 'function' ? chosen(level) : chosen;
  const state = { builds: 0 };
  let elapsed = 0;
  let sinceAct = 1;
  const livesLostPerWave = []; // index = wave number - 1
  let livesAtWaveStart = game.lives;

  while (game.phase !== PHASE.WON && game.phase !== PHASE.LOST && elapsed < maxSeconds) {
    sinceAct += step;
    if (sinceAct >= 0.5) {
      sinceAct = 0;
      spend(game, order, rotation, state);
    }
    if (game.phase === PHASE.BUILD) {
      if (game.waveIndex >= 0) livesLostPerWave[game.waveIndex] = livesAtWaveStart - game.lives;
      livesAtWaveStart = game.lives;
      game.startNextWave();
    }
    game.update(step);
    elapsed += step;
  }
  if (game.waveIndex >= 0) livesLostPerWave[game.waveIndex] = livesAtWaveStart - game.lives;

  return {
    phase: game.phase,
    lives: game.lives,
    wavesCleared: game.phase === PHASE.WON ? game.waveCount : game.waveIndex,
    elapsed,
    towers: game.towers.filter(Boolean).map((t) => `${t.typeId}${t.level + 1}`),
    livesLostPerWave,
  };
}
