import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, PHASE } from '../src/game.js';

// Small deterministic fixture level: a straight 300px path.
const TOWERS = {
  basic: {
    id: 'basic', name: 'Basic', damageType: 'physical', projectileSpeed: 1000,
    levels: [
      { cost: 50, damage: 10, range: 100, fireInterval: 1.0, splashRadius: 0 },
      { cost: 60, damage: 20, range: 110, fireInterval: 0.8, splashRadius: 0 },
    ],
  },
  bomb: {
    id: 'bomb', name: 'Bomb', damageType: 'physical', projectileSpeed: 1000,
    levels: [{ cost: 80, damage: 10, range: 100, fireInterval: 1.0, splashRadius: 60 }],
  },
};

const ENEMIES = {
  grunt: { id: 'grunt', name: 'Grunt', hp: 20, speed: 50, bounty: 7, radius: 8 },
  tank:  { id: 'tank',  name: 'Tank',  hp: 1000, speed: 10, bounty: 50, radius: 10 },
};

function makeLevel(overrides = {}) {
  return {
    width: 400,
    height: 200,
    startingGold: 100,
    startingLives: 3,
    sellRefund: 0.5,
    path: [{ x: 0, y: 0 }, { x: 300, y: 0 }],
    buildSpots: [{ x: 150, y: 30 }, { x: 150, y: 190 }], // spot 1 is far from the path
    waves: [
      { entries: [{ type: 'grunt', count: 2, interval: 1.0 }] },
      { entries: [{ type: 'grunt', count: 1, interval: 1.0 }] },
    ],
    ...overrides,
  };
}

function makeGame(overrides) {
  return new Game(makeLevel(overrides), { towerTypes: TOWERS, enemyTypes: ENEMIES });
}

// Run the simulation for `seconds` in small fixed steps.
function run(game, seconds, step = 0.05) {
  for (let t = 0; t < seconds; t += step) game.update(step);
}

// --- Building and economy -----------------------------------------------

test('building a tower spends gold and occupies the spot', () => {
  const game = makeGame();
  const result = game.buildTower(0, 'basic');
  assert.equal(result.ok, true);
  assert.equal(game.gold, 50);
  assert.equal(game.towers[0].typeId, 'basic');
});

test('cannot build on an occupied spot', () => {
  const game = makeGame();
  game.buildTower(0, 'basic');
  assert.deepEqual(game.buildTower(0, 'basic'), { ok: false, reason: 'occupied' });
  assert.equal(game.gold, 50);
});

test('cannot build without enough gold', () => {
  const game = makeGame({ startingGold: 40 });
  assert.deepEqual(game.buildTower(0, 'basic'), { ok: false, reason: 'not-enough-gold' });
  assert.equal(game.towers[0], null);
  assert.equal(game.gold, 40);
});

test('cannot build on an invalid spot or with an unknown type', () => {
  const game = makeGame();
  assert.equal(game.buildTower(99, 'basic').ok, false);
  assert.equal(game.buildTower(-1, 'basic').ok, false);
  assert.equal(game.buildTower(0, 'nope').ok, false);
  assert.equal(game.gold, 100);
});

test('selling a tower refunds half its cost and frees the spot', () => {
  const game = makeGame();
  game.buildTower(0, 'basic'); // gold: 50
  const result = game.sellTower(0);
  assert.deepEqual(result, { ok: true, refund: 25 });
  assert.equal(game.gold, 75);
  assert.equal(game.towers[0], null);
});

test('selling an empty spot fails', () => {
  const game = makeGame();
  assert.deepEqual(game.sellTower(0), { ok: false, reason: 'empty' });
});

// --- Waves and spawning --------------------------------------------------

test('starting a wave spawns its enemies over time', () => {
  const game = makeGame();
  assert.equal(game.startNextWave().ok, true);
  assert.equal(game.phase, PHASE.WAVE);

  game.update(0.01); // first enemy spawns at t=0
  assert.equal(game.enemies.length, 1);
  run(game, 1.1); // second spawns at t=1
  assert.equal(game.enemies.length, 2);
});

test('cannot start a wave while one is in progress', () => {
  const game = makeGame();
  game.startNextWave();
  assert.deepEqual(game.startNextWave(), { ok: false, reason: 'wave-in-progress' });
});

// --- Movement, leaking, and losing ---------------------------------------

test('an enemy that reaches the end costs a life and is removed', () => {
  const game = makeGame({ waves: [{ entries: [{ type: 'grunt', count: 1, interval: 1 }] }] });
  game.startNextWave();
  run(game, 7); // 300px at 50px/s = 6s to walk the path
  assert.equal(game.lives, 2);
  assert.equal(game.enemies.length, 0);
});

test('game is lost when lives reach zero', () => {
  const game = makeGame({
    startingLives: 1,
    waves: [{ entries: [{ type: 'grunt', count: 1, interval: 1 }] }],
  });
  game.startNextWave();
  run(game, 7);
  assert.equal(game.phase, PHASE.LOST);
  // No actions allowed after losing.
  assert.equal(game.buildTower(0, 'basic').ok, false);
  assert.equal(game.startNextWave().ok, false);
});

// --- Combat ----------------------------------------------------------------

test('tower targets the enemy furthest along the path within range', () => {
  const game = makeGame();
  // Two live enemies at different progress, both within range of spot 0 (150,30).
  game.enemies.push(
    { id: 1, typeId: 'grunt', hp: 20, maxHp: 20, speed: 0, bounty: 7, radius: 8, dist: 120, alive: true },
    { id: 2, typeId: 'grunt', hp: 20, maxHp: 20, speed: 0, bounty: 7, radius: 8, dist: 180, alive: true },
  );
  const target = game.findTarget(game.level.buildSpots[0], 100);
  assert.equal(target.id, 2);
});

test('tower ignores enemies out of range', () => {
  const game = makeGame();
  game.enemies.push(
    { id: 1, typeId: 'grunt', hp: 20, maxHp: 20, speed: 0, bounty: 7, radius: 8, dist: 290, alive: true },
  );
  // Spot 1 is at (150,190), ~190px from the path — out of its 100 range.
  assert.equal(game.findTarget(game.level.buildSpots[1], 100), null);
});

test('a tower kills an enemy and awards its bounty', () => {
  const game = makeGame({ waves: [{ entries: [{ type: 'grunt', count: 1, interval: 1 }] }] });
  game.buildTower(0, 'basic'); // gold: 50; 10 dmg/s vs 20hp
  game.startNextWave();
  run(game, 6);
  assert.equal(game.enemies.length, 0);
  assert.equal(game.lives, 3); // nothing leaked
  assert.equal(game.gold, 50 + 7); // bounty collected
});

test('splash damage hits all enemies near the impact', () => {
  const game = makeGame();
  game.buildTower(0, 'bomb');
  // Two enemies walking close together past the tower.
  game.enemies.push(
    { id: 1, typeId: 'grunt', hp: 20, maxHp: 20, speed: 0, bounty: 7, radius: 8, dist: 150, alive: true },
    { id: 2, typeId: 'grunt', hp: 20, maxHp: 20, speed: 0, bounty: 7, radius: 8, dist: 160, alive: true },
  );
  run(game, 0.5);
  // One bomb (10 dmg, 60 splash) should have damaged both 20hp enemies.
  for (const enemy of game.enemies) {
    assert.equal(enemy.hp, 10);
  }
});

test('projectile still lands where a dead target was (no crash)', () => {
  const game = makeGame();
  game.buildTower(0, 'basic');
  game.enemies.push(
    { id: 1, typeId: 'tank', hp: 1000, maxHp: 1000, speed: 0, bounty: 50, radius: 10, dist: 150, alive: true },
  );
  game.update(0.01); // tower fires
  assert.equal(game.projectiles.length, 1);
  game.enemies[0].hp = 0;
  game.enemies[0].alive = false;
  run(game, 1); // projectile flies to the last known position and expires
  assert.equal(game.projectiles.length, 0);
});

// --- Full game flow -----------------------------------------------------

test('clearing a non-final wave returns to the build phase', () => {
  const game = makeGame();
  game.buildTower(0, 'basic');
  game.startNextWave();
  run(game, 12);
  assert.equal(game.phase, PHASE.BUILD);
  assert.equal(game.waveIndex, 0);
});

test('clearing the final wave wins the game', () => {
  const game = makeGame();
  game.buildTower(0, 'basic');
  game.startNextWave();
  run(game, 12);
  game.startNextWave();
  run(game, 12);
  assert.equal(game.phase, PHASE.WON);
  assert.ok(game.lives > 0);
});

test('no extra waves can start after the last one', () => {
  const game = makeGame({ waves: [{ entries: [{ type: 'grunt', count: 1, interval: 1 }] }] });
  game.buildTower(0, 'basic');
  game.startNextWave();
  run(game, 8);
  assert.equal(game.phase, PHASE.WON);
  assert.deepEqual(game.startNextWave(), { ok: false, reason: 'no-more-waves' });
});
