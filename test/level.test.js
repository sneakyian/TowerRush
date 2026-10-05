// End-to-end checks against the real level data: every level is coherent,
// every build spot is useful, and every level is winnable by a sensible
// mixed strategy — while no single tower type carries the whole campaign.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels.js';
import { TOWER_TYPES, ENEMY_TYPES, MAX_TOWER_LEVEL } from '../src/config.js';
import { Game, PHASE } from '../src/game.js';
import { Path } from '../src/path.js';
import { playLevel } from './strategy.js';

test('there are five levels with unique ids and names', () => {
  assert.equal(LEVELS.length, 5);
  assert.equal(new Set(LEVELS.map((l) => l.id)).size, 5);
  assert.equal(new Set(LEVELS.map((l) => l.name)).size, 5);
});

test('every level config is coherent', () => {
  for (const level of LEVELS) {
    assert.ok(level.path.length >= 2, `${level.name}: path`);
    assert.ok(level.buildSpots.length >= 6, `${level.name}: build spots`);
    assert.ok(level.waves.length >= 6, `${level.name}: waves`);
    assert.ok(level.theme && level.theme.decor.length > 0, `${level.name}: theme`);
    for (const wave of level.waves) {
      for (const entry of wave.entries) {
        assert.ok(ENEMY_TYPES[entry.type], `${level.name}: unknown enemy type ${entry.type}`);
        assert.ok(entry.count > 0 && entry.interval > 0);
      }
    }
  }
  for (const type of Object.values(TOWER_TYPES)) {
    assert.equal(type.levels.length, MAX_TOWER_LEVEL);
    for (let i = 1; i < type.levels.length; i++) {
      assert.ok(type.levels[i].damage > type.levels[i - 1].damage, `${type.id} tier ${i + 1} should hit harder`);
      assert.ok(type.levels[i].cost > type.levels[i - 1].cost, `${type.id} tier ${i + 1} should cost more`);
    }
  }
  for (const enemy of Object.values(ENEMY_TYPES)) {
    assert.ok(enemy.hp > 0 && enemy.speed > 0 && enemy.bounty > 0 && enemy.radius > 0, enemy.id);
    assert.ok(enemy.armor >= 0 && enemy.armor < 1, `${enemy.id} armor`);
    assert.ok(enemy.magicResist >= 0 && enemy.magicResist < 1, `${enemy.id} magic resist`);
    assert.ok(enemy.look && enemy.look.body, `${enemy.id} look`);
  }
});

test('the final wave of every level contains exactly one boss', () => {
  for (const level of LEVELS) {
    const last = level.waves[level.waves.length - 1];
    const bosses = last.entries.filter((e) => ENEMY_TYPES[e.type].boss);
    assert.equal(bosses.length, 1, `${level.name}: boss entries`);
    assert.equal(bosses[0].count, 1, `${level.name}: boss count`);
    for (const wave of level.waves.slice(0, -1)) {
      assert.ok(!wave.entries.some((e) => ENEMY_TYPES[e.type].boss), `${level.name}: boss before final wave`);
    }
  }
});

test('every level fields enemies that no other level uses', () => {
  const seen = new Map();
  for (const level of LEVELS) {
    for (const wave of level.waves) {
      for (const entry of wave.entries) {
        if (!seen.has(entry.type)) seen.set(entry.type, level.id);
        assert.equal(seen.get(entry.type), level.id, `${entry.type} appears in more than one level`);
      }
    }
  }
});

test('every build spot sits close enough to the path for a basic archer', () => {
  const archerRange = TOWER_TYPES.archer.levels[0].range;
  for (const level of LEVELS) {
    const path = new Path(level.path);
    for (const spot of level.buildSpots) {
      let minDist = Infinity;
      for (let d = 0; d <= path.totalLength; d += 4) {
        const pos = path.positionAt(d);
        minDist = Math.min(minDist, Math.hypot(pos.x - spot.x, pos.y - spot.y));
      }
      assert.ok(
        minDist <= archerRange * 0.6,
        `${level.name}: spot (${spot.x},${spot.y}) is ${minDist.toFixed(0)}px from the path`,
      );
      assert.ok(minDist >= 30, `${level.name}: spot (${spot.x},${spot.y}) overlaps the path`);
    }
  }
});

test('build spots never sit in water', () => {
  for (const level of LEVELS) {
    for (const spot of level.buildSpots) {
      for (const w of level.water) {
        const inside = ((spot.x - w.x) / (w.rx + 16)) ** 2 + ((spot.y - w.y) / (w.ry + 16)) ** 2 < 1;
        assert.ok(!inside, `${level.name}: spot (${spot.x},${spot.y}) is in water`);
      }
    }
  }
});

test('a boss reaching the castle loses the game outright', () => {
  const level = LEVELS[0];
  const game = new Game({
    ...level,
    waves: [{ entries: [{ type: 'orcWarlord', count: 1, interval: 1 }] }],
  });
  game.startNextWave();
  for (let t = 0; t < 120 && game.phase === PHASE.WAVE; t += 0.05) game.update(0.05);
  assert.equal(game.phase, PHASE.LOST);
  assert.equal(game.lives, 0);
});

// --- Balance ------------------------------------------------------------------

for (const level of LEVELS) {
  test(`${level.name} is winnable with a mixed tower strategy`, () => {
    const result = playLevel(level, { strategy: 'mixed' });
    assert.equal(
      result.phase,
      PHASE.WON,
      `expected a win, got "${result.phase}" after ${result.wavesCleared}/${level.waves.length} waves ` +
        `(lives lost per wave: ${result.livesLostPerWave.join(',')}; towers: ${result.towers.join(',')})`,
    );
    assert.ok(result.lives >= 3, `${level.name}: won with only ${result.lives} lives — too tight`);
  });
}

test('no single tower type wins every level (armor and resistance matter)', () => {
  for (const strategy of ['archersOnly', 'magesOnly', 'cannonsOnly']) {
    const wins = LEVELS.filter((level) => playLevel(level, { strategy }).phase === PHASE.WON).length;
    assert.ok(wins < LEVELS.length, `${strategy} beat every level`);
  }
});

test('levels get harder: later levels need more total damage to clear', () => {
  const effectiveHp = (level) => level.waves.reduce((sum, wave) => {
    return sum + wave.entries.reduce((s, e) => s + e.count * ENEMY_TYPES[e.type].hp, 0);
  }, 0);
  for (let i = 1; i < LEVELS.length; i++) {
    assert.ok(effectiveHp(LEVELS[i]) > effectiveHp(LEVELS[i - 1]), `${LEVELS[i].name} should be tougher than ${LEVELS[i - 1].name}`);
  }
});
