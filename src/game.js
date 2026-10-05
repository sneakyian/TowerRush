// Core game logic. No DOM or canvas access here, so it runs in Node for tests.

import { Path } from './path.js';
import { TOWER_TYPES, ENEMY_TYPES, MAX_TOWER_LEVEL } from './config.js';

export const PHASE = {
  BUILD: 'build', // between waves; player can build and start the next wave
  WAVE: 'wave',   // enemies spawning/walking
  WON: 'won',
  LOST: 'lost',
};

// Physical damage is cut by armor, magic damage by magic resistance.
export function effectiveDamage(amount, damageType, enemyType) {
  const reduction = damageType === 'magic' ? enemyType.magicResist || 0 : enemyType.armor || 0;
  return amount * (1 - reduction);
}

export class Game {
  constructor(level, { towerTypes = TOWER_TYPES, enemyTypes = ENEMY_TYPES } = {}) {
    this.level = level;
    this.towerTypes = towerTypes;
    this.enemyTypes = enemyTypes;
    this.path = Path.fromLevel(level);

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
    this.events = []; // gameplay events since the last drainEvents(), for effects/UI
  }

  get waveCount() {
    return this.level.waves.length;
  }

  // The live boss enemy, if one is on the field.
  get boss() {
    return this.enemies.find((e) => e.alive && e.boss) || null;
  }

  // Record a gameplay event. The queue is capped so a headless simulation
  // that never drains it cannot grow without bound.
  pushEvent(event) {
    this.events.push(event);
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
  }

  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  // --- Tower stats -------------------------------------------------------

  // Stats for a tower's current tier: { cost, damage, range, fireInterval, splashRadius }.
  towerStats(tower) {
    return this.towerTypes[tower.typeId].levels[tower.level];
  }

  // Cost to take a tower to its next tier, or null at max level.
  upgradeCost(tower) {
    const levels = this.towerTypes[tower.typeId].levels;
    if (tower.level + 1 >= levels.length) return null;
    return levels[tower.level + 1].cost;
  }

  sellValue(tower) {
    return Math.floor(tower.invested * this.level.sellRefund);
  }

  // --- Player actions ---------------------------------------------------

  buildTower(spotIndex, typeId) {
    if (spotIndex < 0 || spotIndex >= this.towers.length) {
      return { ok: false, reason: 'invalid-spot' };
    }
    if (this.towers[spotIndex]) return { ok: false, reason: 'occupied' };
    const type = this.towerTypes[typeId];
    if (!type) return { ok: false, reason: 'unknown-type' };
    const cost = type.levels[0].cost;
    if (this.gold < cost) return { ok: false, reason: 'not-enough-gold' };
    if (this.phase === PHASE.WON || this.phase === PHASE.LOST) {
      return { ok: false, reason: 'game-over' };
    }

    this.gold -= cost;
    this.towers[spotIndex] = { typeId, level: 0, cooldown: 0, invested: cost, age: 0 };
    const spot = this.level.buildSpots[spotIndex];
    this.pushEvent({ type: 'tower-built', x: spot.x, y: spot.y, towerType: typeId });
    return { ok: true };
  }

  upgradeTower(spotIndex) {
    const tower = this.towers[spotIndex];
    if (!tower) return { ok: false, reason: 'empty' };
    const cost = this.upgradeCost(tower);
    if (cost === null) return { ok: false, reason: 'max-level' };
    if (this.gold < cost) return { ok: false, reason: 'not-enough-gold' };
    if (this.phase === PHASE.WON || this.phase === PHASE.LOST) {
      return { ok: false, reason: 'game-over' };
    }

    this.gold -= cost;
    tower.level += 1;
    tower.invested += cost;
    tower.age = 0;
    const spot = this.level.buildSpots[spotIndex];
    this.pushEvent({ type: 'tower-upgraded', x: spot.x, y: spot.y, towerType: tower.typeId, level: tower.level + 1 });
    return { ok: true, level: tower.level + 1 };
  }

  sellTower(spotIndex) {
    const tower = this.towers[spotIndex];
    if (!tower) return { ok: false, reason: 'empty' };
    const refund = this.sellValue(tower);
    this.gold += refund;
    this.towers[spotIndex] = null;
    const spot = this.level.buildSpots[spotIndex];
    this.pushEvent({ type: 'tower-sold', x: spot.x, y: spot.y, refund });
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
    this.pushEvent({ type: 'wave-started', wave: this.waveIndex + 1, final: this.waveIndex + 1 === this.waveCount });
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
        boss: !!type.boss,
        dist: 0,
        alive: true,
        flash: 0, // seconds of white hit-flash left, for rendering
        slow: null, // { factor, remaining } while chilled
        burn: null, // { dps, remaining, damageType } while burning
        age: 0, // seconds since spawning, for the renderer
      });
      const pos = this.path.positionAt(0);
      this.pushEvent({ type: 'enemy-spawned', x: pos.x, y: pos.y, enemyType: typeId });
      if (type.boss) this.pushEvent({ type: 'boss-spawned', name: type.name, enemyType: typeId });
    }
  }

  moveEnemies(dt) {
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      enemy.flash = Math.max(0, (enemy.flash || 0) - dt);
      enemy.age = (enemy.age || 0) + dt;
      if (enemy.slow) {
        enemy.slow.remaining -= dt;
        if (enemy.slow.remaining <= 0) enemy.slow = null;
      }
      if (enemy.burn) {
        this.damageEnemy(enemy, enemy.burn.dps * dt, enemy.burn.damageType, { flash: false });
        enemy.burn.remaining -= dt;
        if (enemy.burn.remaining <= 0) enemy.burn = null;
        if (!enemy.alive) continue;
      }
      enemy.dist += enemy.speed * (enemy.slow ? enemy.slow.factor : 1) * dt;
      if (enemy.dist >= this.path.totalLength) {
        enemy.alive = false;
        enemy.leaked = true;
        // A boss reaching the castle is a loss outright.
        this.lives = enemy.boss ? 0 : Math.max(0, this.lives - 1);
        const pos = this.path.positionAt(this.path.totalLength - 1);
        this.pushEvent({ type: 'enemy-leaked', x: pos.x, y: pos.y, boss: enemy.boss });
      }
    }
  }

  updateTowers(dt) {
    for (let i = 0; i < this.towers.length; i++) {
      const tower = this.towers[i];
      if (!tower) continue;
      const type = this.towerTypes[tower.typeId];
      const stats = this.towerStats(tower);
      const spot = this.level.buildSpots[i];
      const attack = type.attack || 'projectile';
      tower.age = (tower.age || 0) + dt; // seconds since built/upgraded, for the renderer

      if (attack === 'beam') {
        this.updateBeam(tower, type, stats, spot, dt);
        continue;
      }

      tower.cooldown = Math.max(0, tower.cooldown - dt);
      if (tower.cooldown > 0) continue;
      const target = this.findTarget(spot, stats.range);
      if (!target) continue;

      const pos = this.path.positionAt(target.dist);
      tower.angle = Math.atan2(pos.y - spot.y, pos.x - spot.x);
      tower.cooldown = stats.fireInterval;
      this.pushEvent({ type: 'shot', x: spot.x, y: spot.y, angle: tower.angle, towerType: tower.typeId, level: tower.level });

      if (attack === 'projectile') {
        this.projectiles.push({
          x: spot.x,
          y: spot.y,
          startX: spot.x,
          startY: spot.y,
          prevX: spot.x,
          prevY: spot.y,
          targetId: target.id,
          lastTarget: pos,
          speed: type.projectileSpeed,
          damage: stats.damage,
          damageType: type.damageType,
          splashRadius: stats.splashRadius,
          slow: stats.slow || null,
          color: type.color,
          towerType: tower.typeId,
          towerLevel: tower.level,
          dirX: 0,
          dirY: 0,
        });
      } else if (attack === 'instant') {
        this.damageEnemy(target, stats.damage, type.damageType);
        if (stats.burn) this.applyBurn(target, stats.burn, type.damageType);
        this.pushEvent({ type: 'hit', x: pos.x, y: pos.y, towerType: tower.typeId, level: tower.level, splash: 0 });
      } else if (attack === 'chain') {
        this.chainLightning(spot, target, stats, type, tower);
      }
    }
  }

  // Lightning hits the target, then arcs to the nearest untouched enemy
  // within chainRadius, losing damage with every jump.
  chainLightning(spot, target, stats, type, tower) {
    const points = [{ x: spot.x, y: spot.y - 26 }];
    const struck = new Set();
    let current = target;
    let damage = stats.damage;
    for (let jump = 0; jump <= stats.jumps && current; jump++) {
      const pos = this.path.positionAt(current.dist);
      points.push(pos);
      struck.add(current.id);
      this.damageEnemy(current, damage, type.damageType);
      damage *= stats.falloff;
      let next = null;
      let best = Infinity;
      for (const enemy of this.enemies) {
        if (!enemy.alive || struck.has(enemy.id)) continue;
        const p = this.path.positionAt(enemy.dist);
        const d = Math.hypot(p.x - pos.x, p.y - pos.y);
        if (d <= stats.chainRadius && d < best) {
          best = d;
          next = enemy;
        }
      }
      current = next;
    }
    this.pushEvent({ type: 'zap', points, towerType: tower.typeId, level: tower.level });
  }

  // A beam stays on its target while it can and ramps up the longer it holds.
  updateBeam(tower, type, stats, spot, dt) {
    let target = this.enemies.find((e) => e.id === tower.beamTargetId && e.alive) || null;
    if (target) {
      const pos = this.path.positionAt(target.dist);
      if (Math.hypot(pos.x - spot.x, pos.y - spot.y) > stats.range) target = null;
    }
    if (!target) {
      target = this.findTarget(spot, stats.range);
      tower.beamTargetId = target ? target.id : null;
      tower.beamTime = 0;
    }
    if (!target) return;

    tower.beamTime += dt;
    const ramp = Math.min(1, tower.beamTime / stats.rampTime);
    const multiplier = 1 + (stats.rampMultiplier - 1) * ramp;
    const pos = this.path.positionAt(target.dist);
    tower.angle = Math.atan2(pos.y - spot.y, pos.x - spot.x);
    this.damageEnemy(target, stats.dps * multiplier * dt, type.damageType, { flash: false });
  }

  // Current damage multiplier of a beam tower, for the HUD and renderer.
  beamMultiplier(tower) {
    const stats = this.towerStats(tower);
    if (!tower.beamTargetId || !stats.rampTime) return 1;
    return 1 + (stats.rampMultiplier - 1) * Math.min(1, (tower.beamTime || 0) / stats.rampTime);
  }

  applySlow(enemy, slow) {
    // A stronger or fresher chill replaces a weaker one; never stacks.
    if (!enemy.slow || slow.factor <= enemy.slow.factor) {
      enemy.slow = { factor: slow.factor, remaining: slow.duration };
    } else {
      enemy.slow.remaining = Math.max(enemy.slow.remaining, slow.duration);
    }
  }

  applyBurn(enemy, burn, damageType) {
    if (!enemy.burn || burn.dps >= enemy.burn.dps) {
      enemy.burn = { dps: burn.dps, remaining: burn.duration, damageType };
    } else {
      enemy.burn.remaining = Math.max(enemy.burn.remaining, burn.duration);
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
      proj.prevX = proj.x;
      proj.prevY = proj.y;
      if (distToDest > 0) {
        proj.dirX = dx / distToDest;
        proj.dirY = dy / distToDest;
      }

      if (distToDest <= step) {
        proj.x = dest.x;
        proj.y = dest.y;
        proj.done = true;
        this.applyHit(proj, target);
        this.pushEvent({
          type: 'hit',
          x: proj.x,
          y: proj.y,
          towerType: proj.towerType,
          level: proj.towerLevel,
          splash: proj.splashRadius,
        });
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
          this.damageEnemy(enemy, proj.damage, proj.damageType);
          if (proj.slow) this.applySlow(enemy, proj.slow);
        }
      }
    } else if (directTarget) {
      this.damageEnemy(directTarget, proj.damage, proj.damageType);
      if (proj.slow) this.applySlow(directTarget, proj.slow);
    }
  }

  damageEnemy(enemy, amount, damageType = 'physical', { flash = true } = {}) {
    if (!enemy.alive) return;
    const type = this.enemyTypes[enemy.typeId];
    enemy.hp -= effectiveDamage(amount, damageType, type);
    if (flash) enemy.flash = 0.12;
    if (enemy.hp <= 0 && enemy.alive) {
      enemy.alive = false;
      this.gold += enemy.bounty;
      const pos = this.path.positionAt(enemy.dist);
      this.pushEvent({
        type: 'enemy-died',
        x: pos.x,
        y: pos.y,
        bounty: enemy.bounty,
        enemyType: enemy.typeId,
        boss: enemy.boss,
      });
    }
  }

  cleanupAndCheckEnd() {
    this.enemies = this.enemies.filter((e) => e.alive);

    if (this.lives <= 0) {
      this.phase = PHASE.LOST;
      this.pushEvent({ type: 'game-lost' });
      return;
    }
    const waveCleared =
      this.phase === PHASE.WAVE && this.spawnQueue.length === 0 && this.enemies.length === 0;
    if (waveCleared) {
      this.phase = this.waveIndex + 1 >= this.waveCount ? PHASE.WON : PHASE.BUILD;
      this.pushEvent({ type: this.phase === PHASE.WON ? 'game-won' : 'wave-cleared' });
    }
  }
}

export { MAX_TOWER_LEVEL };
