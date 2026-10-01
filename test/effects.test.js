// Tests for the gameplay event queue and the effects system that consumes it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, PHASE } from '../src/game.js';
import { Effects } from '../src/effects.js';

const TOWERS = {
  basic: {
    id: 'basic', name: 'Basic', cost: 50, range: 100, damage: 10,
    fireInterval: 1.0, projectileSpeed: 1000, splashRadius: 0,
  },
};
const ENEMIES = {
  grunt: { id: 'grunt', name: 'Grunt', hp: 10, speed: 50, bounty: 7, radius: 8, color: '#4f9e4f' },
};

function makeGame(overrides = {}) {
  const level = {
    width: 400, height: 200, startingGold: 100, startingLives: 1, sellRefund: 0.5,
    path: [{ x: 0, y: 0 }, { x: 300, y: 0 }],
    buildSpots: [{ x: 150, y: 30 }],
    waves: [{ entries: [{ type: 'grunt', count: 1, interval: 1 }] }],
    ...overrides,
  };
  return new Game(level, { towerTypes: TOWERS, enemyTypes: ENEMIES });
}

function run(game, seconds, step = 0.05) {
  for (let t = 0; t < seconds; t += step) game.update(step);
}

// --- Game event queue -----------------------------------------------------

test('starting a wave emits wave-started', () => {
  const game = makeGame();
  game.startNextWave();
  assert.ok(game.events.some((e) => e.type === 'wave-started' && e.wave === 1));
});

test('a kill emits shot, hit, and enemy-died events with positions', () => {
  const game = makeGame();
  game.buildTower(0, 'basic');
  game.startNextWave();
  run(game, 6);

  const died = game.events.find((e) => e.type === 'enemy-died');
  assert.ok(died, 'expected an enemy-died event');
  assert.equal(died.bounty, 7);
  assert.equal(died.enemyType, 'grunt');
  assert.equal(typeof died.x, 'number');
  assert.equal(typeof died.y, 'number');
  assert.ok(game.events.some((e) => e.type === 'shot' && e.towerType === 'basic'));
  assert.ok(game.events.some((e) => e.type === 'hit'));
  assert.ok(game.events.some((e) => e.type === 'game-won'));
});

test('a leak emits enemy-leaked and losing emits game-lost', () => {
  const game = makeGame(); // 1 life, no tower
  game.startNextWave();
  run(game, 7);
  assert.equal(game.phase, PHASE.LOST);
  assert.ok(game.events.some((e) => e.type === 'enemy-leaked'));
  assert.ok(game.events.some((e) => e.type === 'game-lost'));
});

test('drainEvents returns and clears the queue', () => {
  const game = makeGame();
  game.startNextWave();
  const drained = game.drainEvents();
  assert.ok(drained.length > 0);
  assert.equal(game.events.length, 0);
  assert.deepEqual(game.drainEvents(), []);
});

test('the event queue is capped when never drained', () => {
  const game = makeGame();
  for (let i = 0; i < 1000; i++) game.pushEvent({ type: 'hit', x: 0, y: 0 });
  assert.ok(game.events.length <= 500);
});

// --- Effects ---------------------------------------------------------------

test('an enemy death spawns particles and a bounty text', () => {
  const effects = new Effects({ enemyTypes: ENEMIES });
  effects.process([{ type: 'enemy-died', x: 50, y: 60, bounty: 7, enemyType: 'grunt' }]);
  assert.ok(effects.particles.length > 0);
  assert.equal(effects.texts.length, 1);
  assert.equal(effects.texts[0].text, '+7g');
});

test('a cannon hit spawns an explosion with a shockwave ring', () => {
  const effects = new Effects({ enemyTypes: ENEMIES });
  effects.process([{ type: 'hit', x: 50, y: 60, towerType: 'cannon', splash: 40 }]);
  assert.ok(effects.particles.length > 10);
  assert.ok(effects.particles.some((p) => p.shape === 'ring'));
  assert.ok(effects.particles.some((p) => p.shape === 'smoke'));
});

test('wave-started and game-won set a banner', () => {
  const effects = new Effects({ enemyTypes: ENEMIES });
  effects.process([{ type: 'wave-started', wave: 3 }]);
  assert.equal(effects.banner.text, 'Wave 3');
  effects.process([{ type: 'game-won' }]);
  assert.equal(effects.banner.text, 'Victory!');
});

test('particles, texts, and banners expire over time', () => {
  const effects = new Effects({ enemyTypes: ENEMIES });
  effects.process([
    { type: 'enemy-died', x: 0, y: 0, bounty: 5, enemyType: 'grunt' },
    { type: 'wave-started', wave: 1 },
  ]);
  for (let i = 0; i < 100; i++) effects.update(0.05); // 5 seconds
  assert.equal(effects.particles.length, 0);
  assert.equal(effects.texts.length, 0);
  assert.equal(effects.banner, null);
});

test('particles move and respond to gravity', () => {
  const effects = new Effects({ enemyTypes: ENEMIES });
  effects.addParticle({ x: 0, y: 0, vx: 100, vy: 0, life: 1, size: 3, color: '#fff', gravity: 100 });
  effects.update(0.1);
  const p = effects.particles[0];
  assert.ok(p.x > 0, 'particle moved horizontally');
  assert.ok(p.vy > 0, 'gravity accelerated the particle');
});

test('clear removes everything', () => {
  const effects = new Effects({ enemyTypes: ENEMIES });
  effects.process([
    { type: 'enemy-died', x: 0, y: 0, bounty: 5, enemyType: 'grunt' },
    { type: 'game-lost' },
  ]);
  effects.clear();
  assert.equal(effects.particles.length, 0);
  assert.equal(effects.texts.length, 0);
  assert.equal(effects.banner, null);
});
