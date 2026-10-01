// Core game logic. No DOM or canvas access here, so it runs in Node for tests.

import { Path } from './path.js';
import { TOWER_TYPES, ENEMY_TYPES } from './config.js';

export const PHASE = {
  BUILD: 'build', // between waves; player can build and start the next wave
  WAVE: 'wave',   // enemies spawning/walking
  WON: 'won',
  LOST: 'lost',
};

export class Game {
  constructor(level, { towerTypes = TOWER_TYPES, enemyTypes = ENEMY_TYPES } = {}) {
    this.level = level;
    this.towerTypes = towerTypes;
    this.enemyTypes = enemyTypes;
    this.path = new Path(level.path);

    this.gold = level.startingGold;
    this.lives = level.startingLives;
    this.phase = PHASE.BUILD;
    this.waveIndex = -1; // index of the wave in progress (or last completed)

    this.enemies = [];
    this.towers = []; // one slot per build spot; null = empty
    for (let i = 0; i < level.buildSpots.length; i++) this.towers.push(null);
    this.projectiles = [];
    this.spawnQueue = []; // [{ typeId, at }] sorted by time; `at` is wave-relative seconds
    this.waveTime = 0;
    this.nextEnemyId = 1;
  }

  get waveCount() {
    return this.level.waves.length;
  }

  // --- Player actions ---------------------------------------------------

  buildTower(spotIndex, typeId) {
    if (spotIndex < 0 || spotIndex >= this.towers.length) {
      return { ok: false, reason: 'invalid-spot' };
    }
    if (this.towers[spotIndex]) return { ok: false, reason: 'occupied' };
    const type = this.towerTypes[typeId];
    if (!type) return { ok: false, reason: 'unknown-type' };
    if (this.gold < type.cost) return { ok: false, reason: 'not-enough-gold' };
    if (this.phase === PHASE.WON || this.phase === PHASE.LOST) {
      return { ok: false, reason: 'game-over' };
    }

    this.gold -= type.cost;
    this.towers[spotIndex] = { typeId, cooldown: 0 };
    return { ok: true };
  }

  sellTower(spotIndex) {
    const tower = this.towers[spotIndex];
    if (!tower) return { ok: false, reason: 'empty' };
    const refund = Math.floor(this.towerTypes[tower.typeId].cost * this.level.sellRefund);
    this.gold += refund;
    this.towers[spotIndex] = null;
    return { ok: true, refund };
  }

  startNextWave() {
    if (this.waveIndex + 1 >= this.waveCount) return { ok: false, reason: 'no-more-waves' };
    if (this.phase !== PHASE.BUILD) return { ok: false, reason: 'wave-in-progress' };

    this.waveIndex += 1;
    this.phase = PHASE.WAVE;
    this.waveTime = 0;
    this.spawnQueue = [];

    // Entries within a wave spawn in sequence: all of entry 0, then entry 1, ...
    let t = 0;
    for (const entry of this.level.waves[this.waveIndex].entries) {
      for (let i = 0; i < entry.count; i++) {
        this.spawnQueue.push({ typeId: entry.type, at: t });
        t += entry.interval;
      }
    }
    return { ok: true, wave: this.waveIndex + 1 };
  }

  // --- Simulation --------------------------------------------------------

  update(dt) {
    if (this.phase === PHASE.WON || this.phase === PHASE.LOST) return;
    if (this.phase === PHASE.WAVE) this.waveTime += dt;

    this.spawnEnemies();
    this.moveEnemies(dt);
    this.updateTowers(dt);
    this.updateProjectiles(dt);
    this.cleanupAndCheckEnd();
  }

  spawnEnemies() {
    while (this.spawnQueue.length > 0 && this.spawnQueue[0].at <= this.waveTime) {
      const { typeId } = this.spawnQueue.shift();
      const type = this.enemyTypes[typeId];
      this.enemies.push({
        id: this.nextEnemyId++,
        typeId,
        hp: type.hp,
        maxHp: type.hp,
        speed: type.speed,
        bounty: type.bounty,
        radius: type.radius,
        dist: 0,
        alive: true,
      });
    }
  }

  moveEnemies(dt) {
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      enemy.dist += enemy.speed * dt;
      if (enemy.dist >= this.path.totalLength) {
        enemy.alive = false;
        enemy.leaked = true;
        this.lives = Math.max(0, this.lives - 1);
      }
    }
  }

  updateTowers(dt) {
    for (let i = 0; i < this.towers.length; i++) {
      const tower = this.towers[i];
      if (!tower) continue;
      tower.cooldown = Math.max(0, tower.cooldown - dt);
      if (tower.cooldown > 0) continue;

      const type = this.towerTypes[tower.typeId];
      const spot = this.level.buildSpots[i];
      const target = this.findTarget(spot, type.range);
      if (!target) continue;

      const pos = this.path.positionAt(target.dist);
      this.projectiles.push({
        x: spot.x,
        y: spot.y,
        targetId: target.id,
        lastTarget: pos,
        speed: type.projectileSpeed,
        damage: type.damage,
        splashRadius: type.splashRadius,
        color: type.color,
      });
      tower.cooldown = type.fireInterval;
    }
  }

  // Kingdom Rush convention: shoot the enemy furthest along the path in range.
  findTarget(from, range) {
    let best = null;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const pos = this.path.positionAt(enemy.dist);
      if (Math.hypot(pos.x - from.x, pos.y - from.y) > range) continue;
      if (!best || enemy.dist > best.dist) best = enemy;
    }
    return best;
  }

  updateProjectiles(dt) {
    for (const proj of this.projectiles) {
      const target = this.enemies.find((e) => e.id === proj.targetId && e.alive);
      // Fly toward the live target, or the target's last known spot if it died.
      const dest = target ? this.path.positionAt(target.dist) : proj.lastTarget;
      if (target) proj.lastTarget = dest;

      const dx = dest.x - proj.x;
      const dy = dest.y - proj.y;
      const distToDest = Math.hypot(dx, dy);
      const step = proj.speed * dt;

      if (distToDest <= step) {
        proj.x = dest.x;
        proj.y = dest.y;
        proj.done = true;
        this.applyHit(proj, target);
      } else {
        proj.x += (dx / distToDest) * step;
        proj.y += (dy / distToDest) * step;
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.done);
  }

  applyHit(proj, directTarget) {
    if (proj.splashRadius > 0) {
      for (const enemy of this.enemies) {
        if (!enemy.alive) continue;
        const pos = this.path.positionAt(enemy.dist);
        if (Math.hypot(pos.x - proj.x, pos.y - proj.y) <= proj.splashRadius + enemy.radius) {
          this.damageEnemy(enemy, proj.damage);
        }
      }
    } else if (directTarget) {
      this.damageEnemy(directTarget, proj.damage);
    }
  }

  damageEnemy(enemy, amount) {
    enemy.hp -= amount;
    if (enemy.hp <= 0 && enemy.alive) {
      enemy.alive = false;
      this.gold += enemy.bounty;
    }
  }

  cleanupAndCheckEnd() {
    this.enemies = this.enemies.filter((e) => e.alive);

    if (this.lives <= 0) {
      this.phase = PHASE.LOST;
      return;
    }
    const waveCleared =
      this.phase === PHASE.WAVE && this.spawnQueue.length === 0 && this.enemies.length === 0;
    if (waveCleared) {
      this.phase = this.waveIndex + 1 >= this.waveCount ? PHASE.WON : PHASE.BUILD;
    }
  }
}
