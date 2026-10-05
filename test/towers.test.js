// Mechanics of the Radiant Defense-style towers: slow, burn, chain, beam.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { TOWER_TYPES } from '../src/config.js';

const ENEMIES = {
  grunt: { id: 'grunt', name: 'Grunt', hp: 1000, speed: 50, bounty: 7, radius: 8, armor: 0, magicResist: 0, color: '#4f9e4f' },
};

function makeGame() {
  return new Game({
    width: 400, height: 200, startingGold: 10000, startingLives: 20, sellRefund: 0.5,
    smoothPath: false,
    path: [{ x: 0, y: 0 }, { x: 600, y: 0 }],
    buildSpots: [{ x: 150, y: 30 }],
    waves: [{ entries: [{ type: 'grunt', count: 1, interval: 1 }] }],
  }, { enemyTypes: ENEMIES });
}

function park(game, id, dist, speed = 0) {
  const enemy = { id, typeId: 'grunt', hp: 1000, maxHp: 1000, speed, bounty: 7, radius: 8, dist, alive: true, flash: 0, slow: null, burn: null };
  game.enemies.push(enemy);
  return enemy;
}

function run(game, seconds, step = 0.05) {
  for (let t = 0; t < seconds - 1e-9; t += step) game.update(step);
}

// --- Frost Spire: slow ----------------------------------------------------------

test('frost shards chill the target, slowing it until the chill expires', () => {
  const game = makeGame();
  game.buildTower(0, 'frost');
  const enemy = park(game, 1, 150, 50);
  run(game, 0.2); // shard lands
  assert.ok(enemy.slow, 'enemy is chilled');
  assert.equal(enemy.slow.factor, TOWER_TYPES.frost.levels[0].slow.factor);

  // While chilled it covers roughly factor × normal distance.
  game.towers[0] = null; // stop re-applying
  const before = enemy.dist;
  run(game, 1);
  const covered = enemy.dist - before;
  assert.ok(Math.abs(covered - 50 * enemy.slow.factor) < 3, `covered ${covered.toFixed(1)}px while chilled`);

  run(game, 2.5); // chill wears off
  assert.equal(enemy.slow, null);
});

test('a weaker chill never overrides a stronger one', () => {
  const game = makeGame();
  const enemy = park(game, 1, 100);
  game.applySlow(enemy, { factor: 0.4, duration: 1 });
  game.applySlow(enemy, { factor: 0.7, duration: 3 });
  assert.equal(enemy.slow.factor, 0.4, 'stronger factor kept');
  assert.equal(enemy.slow.remaining, 3, 'but the longer duration is taken');
});

// --- Flamethrower: burn ----------------------------------------------------------

test('burning deals damage over time and then stops', () => {
  const game = makeGame();
  const enemy = park(game, 1, 400); // far from the (empty) spot
  game.applyBurn(enemy, { dps: 10, duration: 2 }, 'physical');
  run(game, 1);
  assert.ok(Math.abs(1000 - enemy.hp - 10) < 1.5, `lost ~10 hp in 1s (actual ${(1000 - enemy.hp).toFixed(1)})`);
  run(game, 2);
  assert.equal(enemy.burn, null, 'burn expired');
  assert.ok(Math.abs(1000 - enemy.hp - 20) < 1.5, 'total burn capped by duration');
});

test('the flamethrower hits instantly and sets its target burning', () => {
  const game = makeGame();
  game.buildTower(0, 'flame');
  const enemy = park(game, 1, 150); // 30px from the spot, inside 70 range
  game.update(0.05);
  assert.ok(enemy.hp < 1000, 'instant damage applied');
  assert.ok(enemy.burn && enemy.burn.dps === TOWER_TYPES.flame.levels[0].burn.dps, 'burning');
  assert.ok(game.events.some((e) => e.type === 'shot' && e.towerType === 'flame'));
  assert.ok(game.events.some((e) => e.type === 'hit' && e.towerType === 'flame'));
});

// --- Tesla Coil: chain lightning ---------------------------------------------------

test('lightning arcs to nearby enemies with damage falloff and skips distant ones', () => {
  const game = makeGame();
  game.buildTower(0, 'tesla');
  const stats = TOWER_TYPES.tesla.levels[0];
  const a = park(game, 1, 150);        // primary target (furthest in range)
  const b = park(game, 2, 110);        // 40px behind: within chainRadius
  const c = park(game, 3, 70);         // 40px behind b
  const far = park(game, 4, 450);      // out of tower range and chain radius
  game.update(0.05);

  const dmg = stats.damage;
  assert.ok(Math.abs(1000 - a.hp - dmg) < 1e-6, 'primary takes full damage');
  assert.ok(Math.abs(1000 - b.hp - dmg * stats.falloff) < 1e-6, 'first jump takes falloff damage');
  assert.ok(Math.abs(1000 - c.hp - dmg * stats.falloff ** 2) < 1e-6, 'second jump falls off again');
  assert.equal(far.hp, 1000, 'distant enemy untouched');

  const zap = game.events.find((e) => e.type === 'zap');
  assert.ok(zap, 'zap event emitted');
  assert.equal(zap.points.length, 4, 'tower + three struck enemies');
});

test('lightning never strikes the same enemy twice in one bolt', () => {
  const game = makeGame();
  game.buildTower(0, 'tesla');
  const a = park(game, 1, 150);
  const b = park(game, 2, 140);
  game.update(0.05);
  const dmg = TOWER_TYPES.tesla.levels[0].damage;
  assert.ok(Math.abs(1000 - a.hp - dmg) < 1e-6);
  assert.ok(Math.abs(1000 - b.hp - dmg * 0.7) < 1e-6, 'b hit exactly once');
});

// --- Laser Lance: ramping beam --------------------------------------------------------

test('the beam ramps up damage while it holds one target', () => {
  const game = makeGame();
  game.buildTower(0, 'laser');
  const stats = TOWER_TYPES.laser.levels[0];
  const enemy = park(game, 1, 150);

  const hp0 = enemy.hp;
  run(game, 0.5);
  const early = hp0 - enemy.hp;
  run(game, stats.rampTime); // fully ramped
  const hp1 = enemy.hp;
  run(game, 0.5);
  const late = hp1 - enemy.hp;

  assert.ok(early > 0, 'beam deals damage immediately');
  assert.ok(late > early * 2, `ramped damage (${late.toFixed(1)}) well above initial (${early.toFixed(1)})`);
  assert.ok(Math.abs(game.beamMultiplier(game.towers[0]) - stats.rampMultiplier) < 1e-6, 'multiplier at maximum');
  assert.ok(Math.abs(late - stats.dps * stats.rampMultiplier * 0.5) < 1.5, 'late damage matches dps × multiplier');
});

test('switching targets resets the beam ramp', () => {
  const game = makeGame();
  game.buildTower(0, 'laser');
  const a = park(game, 1, 150);
  run(game, 3);
  assert.ok(game.beamMultiplier(game.towers[0]) > 2, 'ramped on a');
  a.alive = false; // a dies; the beam must find b and start over
  park(game, 2, 140);
  game.update(0.05);
  assert.equal(game.towers[0].beamTargetId, 2);
  assert.ok(game.beamMultiplier(game.towers[0]) < 1.1, 'ramp reset');
});

test('the beam lets go when its target leaves range', () => {
  const game = makeGame();
  game.buildTower(0, 'laser');
  const enemy = park(game, 1, 150, 200); // sprints out of range
  game.update(0.05);
  assert.equal(game.towers[0].beamTargetId, 1);
  run(game, 1.5);
  assert.equal(game.towers[0].beamTargetId, null);
  assert.ok(enemy.hp < 1000);
});

test('damage over time does not strobe the hit flash', () => {
  const game = makeGame();
  const enemy = park(game, 1, 400);
  game.applyBurn(enemy, { dps: 10, duration: 2 }, 'physical');
  run(game, 0.5);
  assert.equal(enemy.flash, 0);
});

// --- Mortar: minimum range -----------------------------------------------------------------

test('the mortar ignores enemies inside its minimum range but hits distant ones', () => {
  const game = makeGame();
  game.buildTower(0, 'mortar');
  const close = park(game, 1, 150);  // 30px from the spot: inside minRange 70
  const far = park(game, 2, 280);    // ~133px away: in range
  run(game, 1.2);                     // shell travels ~180px/s
  assert.equal(close.hp, 1000, 'close enemy untouched');
  assert.ok(far.hp < 1000, 'distant enemy shelled');
});

// --- Sniper: toughest-first targeting and armor pierce ---------------------------------------

test('the sniper picks the toughest enemy in range and pierces armor', () => {
  const game = makeGame();
  game.enemyTypes = { ...ENEMIES, tank: { ...ENEMIES.grunt, id: 'tank', armor: 0.6 } };
  game.buildTower(0, 'sniper');
  const weakAhead = park(game, 1, 160);
  weakAhead.hp = 300;
  const tank = { id: 2, typeId: 'tank', hp: 1000, maxHp: 1000, speed: 0, bounty: 7, radius: 12, dist: 140, alive: true, flash: 0, slow: null, burn: null };
  game.enemies.push(tank);
  game.update(0.05);
  const stats = TOWER_TYPES.sniper.levels[0];
  assert.equal(weakAhead.hp, 300, 'furthest-along enemy skipped in favor of the toughest');
  const expected = stats.damage * (1 - 0.6 * (1 - stats.armorPierce));
  assert.ok(Math.abs(1000 - tank.hp - expected) < 1e-6, `pierced damage ${(1000 - tank.hp).toFixed(1)} vs expected ${expected.toFixed(1)}`);
});

// --- Venom: stacking poison --------------------------------------------------------------------

test('poison stacks with each hit up to the cap and refreshes its timer', () => {
  const game = makeGame();
  const enemy = park(game, 1, 400);
  const poison = TOWER_TYPES.venom.levels[0].poison;
  for (let i = 0; i < poison.maxStacks + 3; i++) game.applyPoison(enemy, poison);
  assert.equal(enemy.poison.stacks, poison.maxStacks, 'stacks capped');
  assert.equal(enemy.poison.remaining, poison.duration, 'timer refreshed');
  run(game, 1);
  const lost = 1000 - enemy.hp;
  assert.ok(Math.abs(lost - poison.dpsPerStack * poison.maxStacks) < 2, `full stacks tick ${lost.toFixed(1)}/s`);
});

test('the venom spitter builds stacks on a target over time', () => {
  const game = makeGame();
  game.buildTower(0, 'venom');
  const enemy = park(game, 1, 150);
  run(game, 2);
  assert.ok(enemy.poison && enemy.poison.stacks >= 3, `stacks after 2s: ${enemy.poison?.stacks}`);
});

// --- Beacon: damage aura ----------------------------------------------------------------------

test('a war beacon boosts the damage of towers in its aura and nothing else', () => {
  const level = {
    width: 400, height: 200, startingGold: 10000, startingLives: 20, sellRefund: 0.5, smoothPath: false,
    path: [{ x: 0, y: 0 }, { x: 600, y: 0 }],
    buildSpots: [{ x: 150, y: 30 }, { x: 180, y: 60 }, { x: 500, y: 60 }],
    waves: [{ entries: [{ type: 'grunt', count: 1, interval: 1 }] }],
  };
  const game = new Game(level, { enemyTypes: ENEMIES });
  game.buildTower(0, 'archer');
  game.buildTower(2, 'archer'); // far from the beacon
  game.buildTower(1, 'beacon');
  game.update(0.001); // beacon auras are recomputed every update
  const boost = TOWER_TYPES.beacon.levels[0].boost;
  assert.equal(game.towers[0].boost, boost, 'nearby archer boosted');
  assert.equal(game.towers[2].boost, 1, 'distant archer not boosted');
  assert.equal(game.towers[1].boost, 1, 'the beacon does not boost itself');

  // Boosted shots carry the multiplied damage.
  park(game, 1, 150);
  game.update(0.05);
  const shot = game.projectiles.find((pr) => pr.towerType === 'archer');
  assert.ok(shot && Math.abs(shot.damage - TOWER_TYPES.archer.levels[0].damage * boost) < 1e-6);
});
