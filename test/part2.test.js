// Part 2 mechanics: gravity wells, missile salvos, curses, spawners, unlocks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { TOWER_TYPES, ENEMY_TYPES, unlockedTowers } from '../src/config.js';

const ENEMIES = {
  grunt: { id: 'grunt', name: 'Grunt', hp: 5000, speed: 50, bounty: 5, radius: 8, armor: 0, magicResist: 0, color: '#4f9e4f' },
  bat: { id: 'bat', name: 'Bat', hp: 5000, speed: 50, bounty: 5, radius: 8, flying: true },
  witch: { id: 'witch', name: 'Witch', hp: 5000, speed: 0, bounty: 5, radius: 8, curse: { every: 4, duration: 2 } },
  mother: { id: 'mother', name: 'Mother', hp: 5000, speed: 0, bounty: 5, radius: 12, spawner: { type: 'grunt', every: 1, count: 2 } },
};

function makeGame() {
  return new Game({
    width: 600, height: 300, startingGold: 100000, startingLives: 20, sellRefund: 0.5, smoothPath: false,
    path: [{ x: 0, y: 100 }, { x: 600, y: 100 }], buildSpots: [{ x: 300, y: 140 }, { x: 100, y: 140 }],
    waves: [{ entries: [{ type: 'grunt', count: 1, interval: 1 }] }],
  }, { enemyTypes: ENEMIES });
}
function run(game, seconds, step = 0.05) {
  for (let t = 0; t < seconds - 1e-9; t += step) game.update(step);
}

test('a gravity well drags everything in its field without freezing a chill', () => {
  const game = makeGame();
  game.buildTower(0, 'gravity');
  const inside = game.spawnEnemy('grunt', 280);
  const outside = game.spawnEnemy('grunt', 50);
  run(game, 1);
  assert.ok(inside.dist - 280 < 50 * 0.65, `dragged: moved ${inside.dist - 280}`);
  assert.ok(outside.dist - 50 > 49, 'untouched outside the field');
  assert.equal(inside.slow, null, 'gravity is not a chill');
  assert.equal(inside.hp, 5000, 'tier 1 does no damage');
  for (let k = 0; k < 3; k++) game.upgradeTower(0);
  const fresh = game.spawnEnemy('grunt', 290);
  run(game, 1);
  assert.ok(fresh.hp < 5000, 'tier 4 pulses true damage');
});

test('missile batteries fire salvos of homing rockets that hit fliers and splash', () => {
  const game = makeGame();
  game.buildTower(0, 'missile');
  const a = game.spawnEnemy('bat', 300);
  const b = game.spawnEnemy('grunt', 310);
  a.speed = b.speed = 0;
  run(game, 0.05);
  assert.equal(game.events.filter((e) => e.type === 'shot').length, 1, 'first rocket away');
  run(game, 0.5);
  assert.equal(game.events.filter((e) => e.type === 'shot').length, TOWER_TYPES.missile.levels[0].salvo, 'the rest of the salvo follows, then the launcher reloads');
  run(game, 2);
  assert.ok(a.hp < 5000, 'rockets reach the flier');
  assert.ok(b.hp < 5000, 'and splash its neighbour');
});

test('cursed towers fall silent for the duration and recover', () => {
  const game = makeGame();
  game.buildTower(0, 'archer');
  const witch = game.spawnEnemy('witch', 300);
  run(game, 2.6); // the first hex comes at 60% of the interval
  const cursed = game.events.find((e) => e.type === 'tower-cursed');
  assert.ok(cursed, 'hex landed');
  assert.ok(game.towers[0].cursed > 0);
  const hpAtCurse = witch.hp;
  run(game, 0.5);
  assert.equal(witch.hp, hpAtCurse, 'no arrows while hexed');
  run(game, 2);
  assert.ok(witch.hp < hpAtCurse, 'firing again');
});

test('spawners keep birthing brood while they live', () => {
  const game = makeGame();
  const mother = game.spawnEnemy('mother', 200);
  run(game, 2.1);
  assert.equal(game.enemies.filter((e) => e.typeId === 'grunt').length, 4);
  assert.ok(game.events.some((e) => e.type === 'spawned-brood'));
  mother.alive = false;
  run(game, 2);
  assert.equal(game.enemies.filter((e) => e.typeId === 'grunt' && e.alive).length, 4, 'no more once dead');
});

test('towers unlock as chapters are beaten', () => {
  const base = unlockedTowers(0);
  assert.ok(base.includes('archer') && !base.includes('gravity') && !base.includes('missile'));
  const afterPartOne = unlockedTowers(5);
  assert.ok(afterPartOne.includes('gravity') && !afterPartOne.includes('missile'));
  assert.ok(unlockedTowers(6).includes('missile'));
  assert.equal(unlockedTowers(99).length, Object.keys(TOWER_TYPES).length);
});

test('the underworld roster is coherent', () => {
  for (const id of ['baal', 'nyx', 'moloch']) {
    const boss = ENEMY_TYPES[id];
    assert.ok(boss.boss && boss.summons && ENEMY_TYPES[boss.summons.type], id);
    assert.ok(boss.hp > ENEMY_TYPES.dragon.hp * 0.9, `${id} is a Part 2 boss`);
  }
  for (const e of Object.values(ENEMY_TYPES)) {
    if (e.curse) assert.ok(e.curse.every > 0 && e.curse.duration > 0, e.id);
    if (e.spawner) assert.ok(ENEMY_TYPES[e.spawner.type] && e.spawner.every > 0, e.id);
  }
});
