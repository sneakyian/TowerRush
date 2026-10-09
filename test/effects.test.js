// Tests for the gameplay event queue and the effects system that consumes it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, PHASE } from '../src/game.js';
import { Effects } from '../src/effects.js';

const TOWERS = {
  basic: {
    id: 'basic', name: 'Basic', damageType: 'physical', projectileSpeed: 1000,
    levels: [{ cost: 50, damage: 10, range: 100, fireInterval: 1.0, splashRadius: 0 }],
  },
};
const ENEMIES = {
  grunt: { id: 'grunt', name: 'Grunt', hp: 10, speed: 50, bounty: 7, radius: 8, color: '#4f9e4f' },
};

function makeGame(overrides = {}) {
  const level = {
    width: 400, height: 200, startingGold: 100, startingLives: 1, sellRefund: 0.5,
    smoothPath: false, // mechanics tests use the raw straight path
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
    { type: 'hit', x: 0, y: 0, towerType: 'cannon', splash: 40 },
    { type: 'game-won' },
  ]);
  effects.clear();
  assert.equal(effects.particles.length, 0);
  assert.equal(effects.groundParticles.length, 0);
  assert.equal(effects.texts.length, 0);
  assert.equal(effects.banner, null);
  assert.equal(effects.scheduled.length, 0);
});

// --- Build/sell/spawn events and the effects they drive --------------------

test('building and selling a tower emit events with the spot position', () => {
  const game = makeGame();
  game.buildTower(0, 'basic');
  const built = game.events.find((e) => e.type === 'tower-built');
  assert.deepEqual(built, { type: 'tower-built', x: 150, y: 30, towerType: 'basic' });
  game.sellTower(0);
  const sold = game.events.find((e) => e.type === 'tower-sold');
  assert.deepEqual(sold, { type: 'tower-sold', x: 150, y: 30, refund: 25 });
});

test('spawning an enemy emits enemy-spawned at the path start', () => {
  const game = makeGame();
  game.startNextWave();
  game.update(0.01);
  const spawned = game.events.find((e) => e.type === 'enemy-spawned');
  assert.deepEqual(spawned, { type: 'enemy-spawned', x: 0, y: 0, enemyType: 'grunt' });
});

test('taking damage sets a hit flash that decays over time', () => {
  const game = makeGame();
  game.buildTower(0, 'basic');
  // A durable enemy parked in range so one 10-damage arrow leaves it alive.
  const enemy = { id: 1, typeId: 'grunt', hp: 100, maxHp: 100, speed: 0, bounty: 7, radius: 8, dist: 150, alive: true, flash: 0 };
  game.enemies.push(enemy);
  game.update(0.05); // tower fires at t=0 and the 1000px/s arrow lands this tick
  assert.ok(enemy.hp < enemy.maxHp, 'enemy was hit');
  const flashAfterHit = enemy.flash;
  assert.ok(flashAfterHit > 0, 'flash set on hit');
  game.update(0.05);
  assert.ok(enemy.flash < flashAfterHit, 'flash decays');
  run(game, 0.3);
  assert.equal(enemy.flash, 0);
});

test('tower construction and sale spawn particles and refund text', () => {
  const effects = new Effects({ enemyTypes: ENEMIES });
  effects.process([{ type: 'tower-built', x: 10, y: 10, towerType: 'basic' }]);
  assert.ok(effects.particles.length >= 10);
  effects.process([{ type: 'tower-sold', x: 10, y: 10, refund: 25 }]);
  assert.ok(effects.texts.some((t) => t.text === '+25g'));
});

test('a cannon hit leaves a long-lived scorch mark on the ground layer', () => {
  const effects = new Effects({ enemyTypes: ENEMIES });
  effects.process([{ type: 'hit', x: 50, y: 60, towerType: 'cannon', splash: 40 }]);
  const scorch = effects.groundParticles.find((p) => p.shape === 'scorch');
  assert.ok(scorch, 'scorch mark added');
  for (let i = 0; i < 40; i++) effects.update(0.05); // 2s: scorch outlives the blast
  assert.equal(effects.particles.length, 0);
  assert.ok(effects.groundParticles.some((p) => p.shape === 'scorch'));
  for (let i = 0; i < 80; i++) effects.update(0.05); // another 4s: gone
  assert.equal(effects.groundParticles.length, 0);
});

test('a leak draws a red shockwave ring', () => {
  const effects = new Effects({ enemyTypes: ENEMIES });
  effects.process([{ type: 'enemy-leaked', x: 300, y: 0 }]);
  assert.ok(effects.particles.some((p) => p.shape === 'ring'));
  assert.ok(effects.texts.some((t) => t.text === '-1 life'));
});

test('victory schedules fireworks that burst over time', () => {
  const effects = new Effects({ enemyTypes: ENEMIES });
  effects.process([{ type: 'game-won' }]);
  assert.ok(effects.scheduled.length > 0, 'fireworks scheduled');
  assert.equal(effects.particles.length, 0, 'none burst yet');
  for (let i = 0; i < 20; i++) effects.update(0.05); // 1s: first bursts go off
  assert.ok(effects.particles.length > 0, 'fireworks burst');
  for (let i = 0; i < 80; i++) effects.update(0.05); // 4s more: all fired
  assert.equal(effects.scheduled.length, 0);
});

test('ambient effects kick up dust under walking enemies', () => {
  const game = makeGame();
  game.startNextWave();
  game.update(0.01);
  const effects = new Effects({ enemyTypes: ENEMIES });
  for (let i = 0; i < 40; i++) effects.ambient(game, 0.05); // 2s of walking
  assert.ok(effects.groundParticles.length > 0, 'footstep dust spawned');
});

test('ambient effects trail sparkles behind mage bolts', () => {
  const game = makeGame();
  game.projectiles.push({ x: 10, y: 10, prevX: 10, prevY: 10, towerType: 'mage', dirX: 1, dirY: 0 });
  const effects = new Effects({ enemyTypes: ENEMIES });
  for (let i = 0; i < 40; i++) effects.ambient(game, 0.05);
  assert.ok(effects.particles.length > 0, 'trail sparkles spawned');
});

test('a flamethrower shot spawns fire and smoke along the jet, and hits leave fire', () => {
  const effects = new Effects({ enemyTypes: ENEMIES });
  effects.process([{ type: 'shot', x: 100, y: 100, angle: 0, towerType: 'flame', level: 1, targetX: 160, targetY: 100 }]);
  assert.ok(effects.particles.some((p) => p.shape === 'fire'), 'fire tongues spawned');
  assert.ok(effects.particles.some((p) => p.shape === 'smoke'), 'sooty smoke spawned');
  // Every fire particle heads toward the target (positive x velocity).
  assert.ok(effects.particles.filter((p) => p.shape === 'fire').every((p) => p.vx > 0));
  effects.process([{ type: 'hit', x: 160, y: 100, towerType: 'flame', level: 1, splash: 0 }]);
  assert.ok(effects.particles.filter((p) => p.shape === 'fire').length >= 3);
});

test('each tower family has its own muzzle and impact effects', () => {
  const effects = new Effects({ enemyTypes: ENEMIES });
  effects.process([{ type: 'shot', x: 100, y: 100, angle: 0, towerType: 'mage', level: 0, targetX: 160, targetY: 100 }]);
  assert.ok(effects.particles.some((p) => p.shape === 'ring'), 'mage shot bursts a rune ring');
  effects.clear();
  effects.process([{ type: 'hit', x: 100, y: 100, towerType: 'frost', level: 0, splash: 0 }]);
  assert.ok(effects.particles.some((p) => p.shape === 'flake'), 'frost hit scatters snowflakes');
  assert.ok(effects.groundParticles.some((p) => p.shape === 'frostpatch'));
  effects.clear();
  effects.process([{ type: 'hit', x: 100, y: 100, towerType: 'archer', level: 0, splash: 0 }]);
  assert.ok(effects.particles.some((p) => p.shape === 'splinter'), 'arrow hit throws splinters');
  effects.clear();
  effects.process([{ type: 'shot', x: 100, y: 100, angle: 0, towerType: 'sniper', level: 1, targetX: 300, targetY: 100 }]);
  assert.ok(effects.particles.some((p) => p.shape === 'casing'), 'sniper ejects a casing');
  assert.ok(effects.particles.some((p) => p.shape === 'tracer'));
  effects.clear();
  effects.process([{ type: 'zap', points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 80, y: 10 }], towerType: 'tesla', level: 0 }]);
  assert.equal(effects.bolts.length, 1);
  assert.ok(effects.particles.some((p) => p.shape === 'bolt'), 'lightning crackles at each strike');
  effects.clear();
  effects.process([{ type: 'hit', x: 100, y: 100, towerType: 'venom', level: 0, splash: 0 }]);
  assert.ok(effects.particles.some((p) => p.shape === 'bubble'), 'acid bubbles');
});
