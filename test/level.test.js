// End-to-end checks against the real level data: the config is coherent and
// the level is actually winnable with a straightforward strategy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_1, TOWER_TYPES, ENEMY_TYPES } from '../src/config.js';
import { Game, PHASE } from '../src/game.js';
import { Path } from '../src/path.js';

test('level config is coherent', () => {
  assert.ok(LEVEL_1.path.length >= 2);
  assert.ok(LEVEL_1.buildSpots.length > 0);
  assert.ok(LEVEL_1.waves.length > 0);
  for (const wave of LEVEL_1.waves) {
    for (const entry of wave.entries) {
      assert.ok(ENEMY_TYPES[entry.type], `unknown enemy type: ${entry.type}`);
      assert.ok(entry.count > 0);
      assert.ok(entry.interval > 0);
    }
  }
  for (const type of Object.values(TOWER_TYPES)) {
    assert.ok(type.cost > 0 && type.damage > 0 && type.range > 0 && type.fireInterval > 0);
  }
});

test('every build spot can reach the path with at least one tower type', () => {
  const path = new Path(LEVEL_1.path);
  const maxRange = Math.max(...Object.values(TOWER_TYPES).map((t) => t.range));
  for (const spot of LEVEL_1.buildSpots) {
    let minDist = Infinity;
    for (let d = 0; d <= path.totalLength; d += 5) {
      const pos = path.positionAt(d);
      minDist = Math.min(minDist, Math.hypot(pos.x - spot.x, pos.y - spot.y));
    }
    assert.ok(
      minDist < maxRange,
      `build spot (${spot.x},${spot.y}) is out of range of the path (closest: ${minDist.toFixed(0)}px)`,
    );
  }
});

test('the starting gold affords at least one tower before wave 1', () => {
  const cheapest = Math.min(...Object.values(TOWER_TYPES).map((t) => t.cost));
  assert.ok(LEVEL_1.startingGold >= cheapest);
});

test('level 1 is winnable with a simple greedy strategy', () => {
  const game = new Game(LEVEL_1);

  // Strategy: whenever we can afford an archer tower, build it on the next
  // free spot. Start each wave as soon as the build phase begins.
  const step = 1 / 30;
  let elapsed = 0;
  while (game.phase !== PHASE.WON && game.phase !== PHASE.LOST && elapsed < 600) {
    const freeSpot = game.towers.indexOf(null);
    if (freeSpot !== -1 && game.gold >= TOWER_TYPES.archer.cost) {
      game.buildTower(freeSpot, 'archer');
    }
    if (game.phase === PHASE.BUILD) game.startNextWave();
    game.update(step);
    elapsed += step;
  }

  assert.equal(game.phase, PHASE.WON, `expected a win, got "${game.phase}" with ${game.lives} lives`);
  assert.ok(game.lives > 0);
});
