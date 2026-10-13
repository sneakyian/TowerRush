// Enemy abilities and the hero's guard-post behaviour.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { TOWER_TYPES, ENEMY_TYPES, HERO_TYPES } from '../src/config.js';

const ENEMIES = {
  grunt: { id: 'grunt', name: 'Grunt', hp: 100, speed: 40, bounty: 5, radius: 8, armor: 0, magicResist: 0, color: '#4f9e4f' },
  bat: { id: 'bat', name: 'Bat', hp: 100, speed: 40, bounty: 5, radius: 8, flying: true },
  rogue: { id: 'rogue', name: 'Rogue', hp: 100, speed: 40, bounty: 5, radius: 8, dodge: 1 },
  shaman: { id: 'shaman', name: 'Shaman', hp: 100, speed: 0, bounty: 5, radius: 8, heal: { radius: 60, hps: 20 } },
  boar: { id: 'boar', name: 'Boar', hp: 100, speed: 40, bounty: 5, radius: 8, charge: 2 },
  golem: { id: 'golem', name: 'Golem', hp: 10, speed: 20, bounty: 5, radius: 12, split: { type: 'grunt', count: 2 } },
  imp: { id: 'imp', name: 'Imp', hp: 10, speed: 40, bounty: 5, radius: 8, explode: { damage: 50, radius: 40 } },
  wisp: { id: 'wisp', name: 'Wisp', hp: 100, speed: 0, bounty: 5, radius: 8, blink: { distance: 50, cooldown: 1 } },
};
const TOWERS = {
  cannon: { ...TOWER_TYPES.cannon },
  archer: { ...TOWER_TYPES.archer },
};

function makeGame() {
  return new Game({
    width: 600, height: 300, startingGold: 10000, startingLives: 20, sellRefund: 0.5, smoothPath: false,
    path: [{ x: 0, y: 100 }, { x: 600, y: 100 }], buildSpots: [{ x: 300, y: 140 }],
    waves: [{ entries: [{ type: 'grunt', count: 1, interval: 1 }] }],
  }, { enemyTypes: ENEMIES, towerTypes: TOWERS });
}
function run(game, seconds, step = 0.05) {
  for (let t = 0; t < seconds - 1e-9; t += step) game.update(step);
}

test('flying enemies are ignored by ground towers and cannot be blocked by melee heroes', () => {
  const game = makeGame();
  game.buildTower(0, 'cannon');
  const bat = game.spawnEnemy('bat', 290);
  const grunt = game.spawnEnemy('grunt', 280);
  run(game, 1.5);
  assert.equal(bat.hp, 100, 'cannon never fires at the flier');
  assert.ok(grunt.hp < 100, 'but shells the walker');
  const g2 = makeGame();
  g2.setHero('knight');
  g2.hero.x = 300; g2.hero.y = 100; g2.hero.post = { x: 300, y: 100 };
  const flier = g2.spawnEnemy('bat', 270);
  run(g2, 1.5);
  assert.ok(flier.dist > 300, 'flew straight past the knight');
  assert.equal(flier.hp, 100);
});

test('evasive enemies dodge physical hits but not magic', () => {
  const game = makeGame();
  const rogue = game.spawnEnemy('rogue', 100);
  game.damageEnemy(rogue, 30, 'physical');
  assert.equal(rogue.hp, 100);
  assert.ok(game.events.some((e) => e.type === 'dodge'));
  game.damageEnemy(rogue, 30, 'magic');
  assert.equal(rogue.hp, 70);
});

test('healers mend nearby allies, never themselves', () => {
  const game = makeGame();
  const shaman = game.spawnEnemy('shaman', 100);
  const ally = game.spawnEnemy('grunt', 110);
  const far = game.spawnEnemy('grunt', 400);
  shaman.hp = ally.hp = far.hp = 50;
  ally.speed = far.speed = 0;
  run(game, 1);
  assert.ok(ally.hp > 65, `ally healed to ${ally.hp}`);
  assert.equal(far.hp, 50);
  assert.equal(shaman.hp, 50);
});

test('charging brutes speed up once below half health', () => {
  const game = makeGame();
  const boar = game.spawnEnemy('boar', 100);
  game.damageEnemy(boar, 60, 'true');
  game.update(0.05);
  assert.ok(boar.charged);
  assert.equal(boar.speed, 80);
  assert.ok(game.events.some((e) => e.type === 'charge'));
});

test('golems split into smaller enemies when they die', () => {
  const game = makeGame();
  const golem = game.spawnEnemy('golem', 200);
  game.damageEnemy(golem, 50, 'true');
  const shards = game.enemies.filter((e) => e.typeId === 'grunt' && e.alive);
  assert.equal(shards.length, 2);
  assert.ok(shards.every((e) => Math.abs(e.dist - 200) < 20));
  assert.ok(game.events.some((e) => e.type === 'split'));
});

test('imps explode on death and burn a hero standing close', () => {
  const game = makeGame();
  game.setHero('knight');
  game.hero.x = 200; game.hero.y = 100;
  const imp = game.spawnEnemy('imp', 200);
  game.damageEnemy(imp, 50, 'true');
  assert.equal(game.hero.hp, HERO_TYPES.knight.hp - 50);
  assert.ok(game.events.some((e) => e.type === 'explode'));
});

test('wisps blink along the road on a cooldown', () => {
  const game = makeGame();
  const wisp = game.spawnEnemy('wisp', 100);
  run(game, 0.5);
  assert.equal(wisp.dist, 100);
  run(game, 0.6);
  assert.equal(wisp.dist, 150);
  assert.ok(game.events.some((e) => e.type === 'blink'));
});

test('a posted hero chases enemies that come near its post and returns afterwards', () => {
  const game = makeGame();
  game.setHero('knight');
  game.commandHero(300, 160); // post 60px off the road
  run(game, 6);
  assert.equal(game.hero.x, 300);
  assert.equal(game.hero.y, 160);
  const grunt = game.spawnEnemy('grunt', 300);
  grunt.speed = 0;
  run(game, 2);
  assert.ok(game.hero.y < 140, `walked up to meet it (y=${game.hero.y})`);
  assert.ok(grunt.hp < 100, 'and attacked');
  grunt.alive = false;
  run(game, 4);
  assert.ok(Math.abs(game.hero.x - 300) < 2 && Math.abs(game.hero.y - 160) < 2, 'back on post');
});

test('the real roster uses the abilities consistently', () => {
  for (const enemy of Object.values(ENEMY_TYPES)) {
    if (enemy.split) assert.ok(ENEMY_TYPES[enemy.split.type], `${enemy.id} splits into a real type`);
    if (enemy.heal) assert.ok(enemy.heal.radius > 0 && enemy.heal.hps > 0, enemy.id);
    if (enemy.blink) assert.ok(enemy.blink.distance > 0 && enemy.blink.cooldown > 0, enemy.id);
    if (enemy.dodge) assert.ok(enemy.dodge > 0 && enemy.dodge < 1, enemy.id);
    assert.ok(!(enemy.boss && enemy.flying), `${enemy.id}: bosses stay on the ground`);
  }
  assert.ok(Object.values(ENEMY_TYPES).some((e) => e.flying), 'some enemies fly');
  for (const id of ['cannon', 'mortar', 'flame']) assert.equal(TOWER_TYPES[id].targets, 'ground');
});
