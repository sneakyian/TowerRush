// The hero: a player-controlled champion that moves, fights, blocks, levels
// up, dies and returns, and has a special ability.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game.js';
import { HERO_TYPES, HERO_XP_LEVELS } from '../src/config.js';

const ENEMIES = {
  grunt: { id: 'grunt', name: 'Grunt', hp: 40, speed: 50, bounty: 30, radius: 8, armor: 0, magicResist: 0, color: '#4f9e4f' },
  brute: { id: 'brute', name: 'Brute', hp: 100000, speed: 30, bounty: 5, radius: 12, armor: 0, magicResist: 0, color: '#4f9e4f', attack: 200 },
  king: { id: 'king', name: 'King', hp: 100000, speed: 30, bounty: 5, radius: 20, boss: true },
};

function makeGame() {
  return new Game({
    width: 600, height: 300, startingGold: 100, startingLives: 20, sellRefund: 0.5, smoothPath: false,
    path: [{ x: 0, y: 100 }, { x: 600, y: 100 }], buildSpots: [{ x: 150, y: 30 }],
    waves: [{ entries: [{ type: 'grunt', count: 1, interval: 1 }] }],
  }, { enemyTypes: ENEMIES });
}

function run(game, seconds, step = 0.05) {
  for (let t = 0; t < seconds - 1e-9; t += step) game.update(step);
}

test('the hero starts by the castle gate and walks to a move order', () => {
  const game = makeGame();
  assert.ok(game.setHero('knight').ok);
  assert.ok(game.hero.x > 500, 'spawns near the end of the path');
  game.commandHero(300, 200);
  run(game, 1);
  assert.ok(game.hero.x < 500 && game.hero.x > 300, 'moving toward the order');
  run(game, 5);
  assert.equal(game.hero.x, 300);
  assert.equal(game.hero.y, 200);
  assert.equal(game.hero.targetX, null);
});

test('a melee hero blocks enemies that reach it and cuts them down', () => {
  const game = makeGame();
  game.setHero('knight');
  game.hero.x = 300; game.hero.y = 100; // standing on the road
  const enemy = game.spawnEnemy('grunt', 230);
  run(game, 1); // walks the 30px to the knight's reach, then stops
  const held = enemy.dist;
  assert.ok(held < 300 && held > 230, `walked up to the knight (${held})`);
  run(game, 0.3);
  assert.equal(enemy.dist, held, 'held in place');
  run(game, 3);
  assert.ok(!enemy.alive, 'killed by the knight');
  assert.equal(game.hero.xp, 30, 'hero earns the bounty as xp');
});

test('bosses are never blocked, and a hero that loses the fight dies and respawns', () => {
  const game = makeGame();
  game.setHero('knight');
  game.hero.x = 300; game.hero.y = 100;
  const boss = game.spawnEnemy('king', 280);
  run(game, 1);
  assert.ok(boss.dist > 300, 'boss walked straight through');
  const brute = game.spawnEnemy('brute', 290);
  game.hero.x = brute ? 320 : 320;
  run(game, 4);
  assert.ok(!game.hero.alive, 'knight falls to a 200-dps brute');
  assert.ok(game.events.some((e) => e.type === 'hero-died'));
  run(game, HERO_TYPES.knight.respawn + 0.5);
  assert.ok(game.hero.alive, 'back after the respawn timer');
  assert.equal(game.hero.hp, game.hero.maxHp);
  assert.ok(game.events.some((e) => e.type === 'hero-respawned'));
});

test('a ranged hero shoots from range and splashes burn (drake)', () => {
  const game = makeGame();
  game.setHero('dragon');
  game.hero.x = 300; game.hero.y = 180; // 80px off the road: in range, out of reach
  const a = game.spawnEnemy('grunt', 300);
  const b = game.spawnEnemy('grunt', 310);
  run(game, 0.1);
  assert.ok(a.hp < 40 && b.hp < 40, 'both hit by the splash');
  assert.ok(a.burn, 'and set alight');
  assert.ok(game.events.some((e) => e.type === 'hero-attack' && e.heroType === 'dragon'));
  assert.equal(game.hero.hp, game.hero.maxHp, 'nothing reached the drake');
});

test('the archmage frost nova slows everyone around her and goes on cooldown', () => {
  const game = makeGame();
  game.setHero('mage');
  game.hero.x = 300; game.hero.y = 160;
  const near = game.spawnEnemy('brute', 300);
  const far = game.spawnEnemy('brute', 50);
  const result = game.useHeroAbility();
  assert.ok(result.ok);
  assert.equal(result.struck, 1);
  assert.ok(near.slow && near.slow.factor === 0.3, 'chilled');
  assert.equal(far.slow, null);
  assert.ok(!game.useHeroAbility().ok, 'on cooldown');
  assert.ok(game.events.some((e) => e.type === 'hero-ability' && e.name === 'Frost Nova'));
});

test('stunned enemies stand still, then walk on', () => {
  const game = makeGame();
  game.setHero('knight');
  game.hero.x = 300; game.hero.y = 140;
  const enemy = game.spawnEnemy('brute', 290);
  game.useHeroAbility(); // whirlwind: 1.6s stun
  const at = enemy.dist;
  run(game, 1);
  assert.equal(enemy.dist, at, 'stunned');
  game.hero.x = 10; // walk away so it isn't blocked afterwards
  run(game, 2);
  assert.ok(enemy.dist > at, 'moving again');
});

test('heroes level up from kills and heal to a bigger health pool', () => {
  const game = makeGame();
  game.setHero('paladin');
  game.hero.hp = 100;
  game.grantHeroXp(HERO_XP_LEVELS[0]);
  assert.equal(game.hero.level, 1);
  assert.equal(game.hero.hp, game.hero.maxHp);
  assert.equal(game.hero.maxHp, Math.round(HERO_TYPES.paladin.hp * 1.25));
  assert.ok(game.events.some((e) => e.type === 'hero-levelup'));
  game.grantHeroXp(10000);
  assert.equal(game.hero.level, 3, 'capped');
});

test('every hero type is coherent', () => {
  for (const hero of Object.values(HERO_TYPES)) {
    assert.ok(hero.hp > 0 && hero.speed > 0 && hero.damage > 0 && hero.range > 0 && hero.respawn > 0, hero.id);
    assert.ok(['melee', 'ranged'].includes(hero.style));
    if (hero.style === 'melee') assert.ok(hero.block >= 1, `${hero.id} blocks`);
    assert.ok(hero.ability && hero.ability.cooldown > 0 && hero.ability.radius > 0, `${hero.id} ability`);
  }
});
