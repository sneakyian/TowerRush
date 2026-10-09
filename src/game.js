// Core game logic. No DOM or canvas access here, so it runs in Node for tests.

import { Path } from './path.js';
import { TOWER_TYPES, ENEMY_TYPES, MAX_TOWER_LEVEL, HERO_TYPES, HERO_MAX_LEVEL, HERO_XP_LEVELS } from './config.js';

export const PHASE = {
  BUILD: 'build', // between waves; player can build and start the next wave
  WAVE: 'wave',   // enemies spawning/walking
  WON: 'won',
  LOST: 'lost',
};

// Physical damage is cut by armor, magic damage by magic resistance.
export function effectiveDamage(amount, damageType, enemyType, armorPierce = 0) {
  if (damageType === 'true') return amount; // ignores armor and resistance
  const reduction = damageType === 'magic'
    ? enemyType.magicResist || 0
    : (enemyType.armor || 0) * (1 - armorPierce);
  return amount * (1 - reduction);
}

// Elemental traits. An enemy `weakTo` an element takes WEAKNESS_MULTIPLIER
// from towers of that element, ignoring its armor and magic resistance;
// `immune` lists the status effects it shrugs off. Energy shields absorb hits before health: magic tears through them,
// physical barely scratches them, and no burn or poison lands while one is up.
export const WEAKNESS_MULTIPLIER = 1.75;
export const SHIELD_DAMAGE = { magic: 1.5, physical: 0.75, true: 1 };
export const SHIELD_RECHARGE_DELAY = 4; // seconds without a hit before recharging
export const SHIELD_RECHARGE_RATE = 0.25; // fraction of max shield per second
// Thermal shock: fire on a chilled enemy (or frost on a burning one) shatters
// both effects for a burst of true damage.
export const SHATTER_FRACTION = 0.08;
export const SHATTER_CAP = { normal: 150, boss: 220 };
export const ENRAGE_THRESHOLD = 0.3;
export const ENRAGE_SPEED = 1.5;
export const ENRAGE_ARMOR = 0.1;

// Short, player-facing summary of an enemy type's traits.
export function describeTraits(type) {
  const out = [];
  if (type.armor >= 0.3) out.push('Armored');
  if (type.magicResist >= 0.5) out.push('Spell-warded');
  if (type.regen) out.push('Regenerates');
  if (type.shield) out.push('Shielded');
  if (type.element) out.push(`${type.element[0].toUpperCase()}${type.element.slice(1)}`);
  if (type.weakTo) out.push(`Weak to ${type.weakTo}`);
  if (type.summons) out.push('Summons');
  if (type.enrage) out.push('Enrages');
  return out;
}

export class Game {
  constructor(level, { towerTypes = TOWER_TYPES, enemyTypes = ENEMY_TYPES, heroTypes = HERO_TYPES } = {}) {
    this.level = level;
    this.towerTypes = towerTypes;
    this.enemyTypes = enemyTypes;
    this.heroTypes = heroTypes;
    this.hero = null; // set with setHero()
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
    this.updateHero(dt);
    this.moveEnemies(dt);
    this.updateTowers(dt);
    this.updateProjectiles(dt);
    this.cleanupAndCheckEnd();
  }

  spawnEnemies() {
    while (this.spawnQueue.length > 0 && this.spawnQueue[0].at <= this.waveTime) {
      const { typeId } = this.spawnQueue.shift();
      this.spawnEnemy(typeId, 0);
    }
  }

  // Put one enemy on the path at `dist`. Used by the wave spawner and by
  // bosses that call reinforcements.
  spawnEnemy(typeId, dist = 0) {
    const type = this.enemyTypes[typeId];
    const enemy = {
      id: this.nextEnemyId++,
      typeId,
      hp: type.hp,
      maxHp: type.hp,
      speed: type.speed,
      bounty: type.bounty,
      radius: type.radius,
      boss: !!type.boss,
      livesCost: type.lives || 1,
      dist,
      alive: true,
      flash: 0, // seconds of white hit-flash left, for rendering
      slow: null, // { factor, remaining } while chilled
      burn: null, // { dps, remaining, damageType, element } while burning
      poison: null, // { stacks, dpsPerStack, remaining } while poisoned
      age: 0, // seconds since spawning, for the renderer
      // Traits.
      regen: type.regen || 0, // hp per second, suppressed while burning or poisoned
      shield: type.shield ? { hp: type.shield, max: type.shield, sinceHit: 0 } : null,
      element: type.element || null,
      immune: type.immune || [],
      weakTo: type.weakTo || null,
      enraged: false,
      summoned: false,
      stun: 0, // seconds frozen in place by a hero ability
      blocked: false, // held in melee by the hero this tick
    };
    this.enemies.push(enemy);
    const pos = this.path.positionAt(dist);
    this.pushEvent({ type: 'enemy-spawned', x: pos.x, y: pos.y, enemyType: typeId });
    if (type.boss) this.pushEvent({ type: 'boss-spawned', name: type.name, enemyType: typeId, traits: describeTraits(type) });
    return enemy;
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
        this.damageEnemy(enemy, enemy.burn.dps * dt, enemy.burn.damageType, { flash: false, element: enemy.burn.element });
        enemy.burn.remaining -= dt;
        if (enemy.burn.remaining <= 0) enemy.burn = null;
        if (!enemy.alive) continue;
      }
      if (enemy.poison) {
        this.damageEnemy(enemy, enemy.poison.dpsPerStack * enemy.poison.stacks * dt, 'magic', { flash: false, element: 'poison' });
        enemy.poison.remaining -= dt;
        if (enemy.poison.remaining <= 0) enemy.poison = null;
        if (!enemy.alive) continue;
      }
      // Regeneration, unless a damage-over-time effect is eating at it.
      if (enemy.regen > 0 && !enemy.burn && !enemy.poison && enemy.hp < enemy.maxHp) {
        enemy.hp = Math.min(enemy.maxHp, enemy.hp + enemy.regen * dt);
      }
      // Shields recharge once they have been left alone for a moment.
      if (enemy.shield) {
        enemy.shield.sinceHit += dt;
        if (enemy.shield.hp < enemy.shield.max && enemy.shield.sinceHit >= SHIELD_RECHARGE_DELAY) {
          const wasDown = enemy.shield.hp <= 0;
          enemy.shield.hp = Math.min(enemy.shield.max, enemy.shield.hp + enemy.shield.max * SHIELD_RECHARGE_RATE * dt);
          if (wasDown) {
            const pos = this.path.positionAt(enemy.dist);
            this.pushEvent({ type: 'shield-restored', x: pos.x, y: pos.y, enemyType: enemy.typeId });
          }
        }
      }
      if (enemy.stun > 0) {
        enemy.stun = Math.max(0, enemy.stun - dt);
        continue;
      }
      if (enemy.blocked) continue; // held in melee by the hero
      enemy.dist += enemy.speed * (enemy.slow ? enemy.slow.factor : 1) * dt;
      if (enemy.dist >= this.path.totalLength) {
        enemy.alive = false;
        enemy.leaked = true;
        const cost = enemy.livesCost || 1;
        this.lives = Math.max(0, this.lives - cost);
        const pos = this.path.positionAt(this.path.totalLength - 1);
        this.pushEvent({ type: 'enemy-leaked', x: pos.x, y: pos.y, boss: enemy.boss, cost });
      }
    }
  }

  // Damage multiplier a tower receives from the strongest beacon covering it.
  applyBeaconBoosts() {
    for (const tower of this.towers) if (tower) tower.boost = 1;
    this.towers.forEach((beacon, b) => {
      if (!beacon || (this.towerTypes[beacon.typeId].attack || 'projectile') !== 'aura') return;
      const stats = this.towerStats(beacon);
      const from = this.level.buildSpots[b];
      this.towers.forEach((tower, i) => {
        if (!tower || i === b) return;
        const spot = this.level.buildSpots[i];
        if (Math.hypot(spot.x - from.x, spot.y - from.y) <= stats.range) {
          tower.boost = Math.max(tower.boost, stats.boost);
        }
      });
    });
  }

  updateTowers(dt) {
    this.applyBeaconBoosts();
    for (let i = 0; i < this.towers.length; i++) {
      const tower = this.towers[i];
      if (!tower) continue;
      const type = this.towerTypes[tower.typeId];
      const stats = this.towerStats(tower);
      const spot = this.level.buildSpots[i];
      const attack = type.attack || 'projectile';
      tower.age = (tower.age || 0) + dt; // seconds since built/upgraded, for the renderer
      const boost = tower.boost || 1;

      if (attack === 'aura') continue;
      if (attack === 'beam') {
        this.updateBeam(tower, type, stats, spot, dt, boost);
        continue;
      }

      tower.cooldown = Math.max(0, tower.cooldown - dt);
      if (tower.cooldown > 0) continue;
      const target = this.findTarget(spot, stats.range, { minRange: stats.minRange, mode: type.targeting });
      if (!target) continue;

      const pos = this.path.positionAt(target.dist);
      tower.angle = Math.atan2(pos.y - spot.y, pos.x - spot.x);
      tower.targetX = pos.x; // where the shot went, for continuous effects like the flame jet
      tower.targetY = pos.y;
      tower.cooldown = stats.fireInterval;
      this.pushEvent({ type: 'shot', x: spot.x, y: spot.y, angle: tower.angle, towerType: tower.typeId, level: tower.level, targetX: pos.x, targetY: pos.y });

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
          damage: stats.damage * boost,
          damageType: type.damageType,
          armorPierce: stats.armorPierce || 0,
          splashRadius: stats.splashRadius,
          slow: stats.slow || null,
          poison: stats.poison || null,
          color: type.color,
          element: type.element || null,
          towerType: tower.typeId,
          towerLevel: tower.level,
          dirX: 0,
          dirY: 0,
        });
      } else if (attack === 'instant') {
        this.damageEnemy(target, stats.damage * boost, type.damageType, { element: type.element });
        if (stats.burn) this.applyBurn(target, { dps: stats.burn.dps * boost, duration: stats.burn.duration }, type.damageType, type.element);
        this.pushEvent({ type: 'hit', x: pos.x, y: pos.y, towerType: tower.typeId, level: tower.level, splash: 0 });
      } else if (attack === 'chain') {
        this.chainLightning(spot, target, stats, type, tower, boost);
      }
    }
  }

  // Lightning hits the target, then arcs to the nearest untouched enemy
  // within chainRadius, losing damage with every jump.
  chainLightning(spot, target, stats, type, tower, boost = 1) {
    const points = [{ x: spot.x, y: spot.y - 35 - tower.level * 5 }]; // the coil's sphere
    const struck = new Set();
    let current = target;
    let damage = stats.damage * boost;
    for (let jump = 0; jump <= stats.jumps && current; jump++) {
      const pos = this.path.positionAt(current.dist);
      points.push(pos);
      struck.add(current.id);
      this.damageEnemy(current, damage, type.damageType, { element: type.element });
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
  updateBeam(tower, type, stats, spot, dt, boost = 1) {
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
    this.damageEnemy(target, stats.dps * multiplier * boost * dt, type.damageType, { flash: false, element: type.element });
  }

  // Current damage multiplier of a beam tower, for the HUD and renderer.
  beamMultiplier(tower) {
    const stats = this.towerStats(tower);
    if (!tower.beamTargetId || !stats.rampTime) return 1;
    return 1 + (stats.rampMultiplier - 1) * Math.min(1, (tower.beamTime || 0) / stats.rampTime);
  }

  applySlow(enemy, slow) {
    if (!this.canAfflict(enemy, 'slow')) return;
    if (enemy.burn) return this.shatter(enemy);
    // A stronger or fresher chill replaces a weaker one; never stacks.
    if (!enemy.slow || slow.factor <= enemy.slow.factor) {
      enemy.slow = { factor: slow.factor, remaining: slow.duration };
    } else {
      enemy.slow.remaining = Math.max(enemy.slow.remaining, slow.duration);
    }
  }

  applyPoison(enemy, poison) {
    if (!this.canAfflict(enemy, 'poison')) return;
    if (!enemy.poison) {
      enemy.poison = { stacks: 1, dpsPerStack: poison.dpsPerStack, remaining: poison.duration };
    } else {
      enemy.poison.stacks = Math.min(poison.maxStacks, enemy.poison.stacks + 1);
      enemy.poison.dpsPerStack = Math.max(enemy.poison.dpsPerStack, poison.dpsPerStack);
      enemy.poison.remaining = poison.duration;
    }
  }

  applyBurn(enemy, burn, damageType, element = 'fire') {
    if (!this.canAfflict(enemy, 'burn')) return;
    if (enemy.slow) return this.shatter(enemy);
    if (!enemy.burn || burn.dps >= enemy.burn.dps) {
      enemy.burn = { dps: burn.dps, remaining: burn.duration, damageType, element };
    } else {
      enemy.burn.remaining = Math.max(enemy.burn.remaining, burn.duration);
    }
  }

  // Kingdom Rush convention: shoot the enemy furthest along the path in range.
  // `mode: 'toughest'` instead picks the highest-HP enemy; `minRange` skips
  // enemies that are too close (mortars).
  findTarget(from, range, { minRange = 0, mode = 'furthest' } = {}) {
    let best = null;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const pos = this.path.positionAt(enemy.dist);
      const d = Math.hypot(pos.x - from.x, pos.y - from.y);
      if (d > range || d < minRange) continue;
      const better = mode === 'toughest'
        ? !best || enemy.hp > best.hp || (enemy.hp === best.hp && enemy.dist > best.dist)
        : !best || enemy.dist > best.dist;
      if (better) best = enemy;
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
          this.damageEnemy(enemy, proj.damage, proj.damageType, { armorPierce: proj.armorPierce, element: proj.element });
          if (proj.slow) this.applySlow(enemy, proj.slow);
          if (proj.poison) this.applyPoison(enemy, proj.poison);
        }
      }
    } else if (directTarget) {
      this.damageEnemy(directTarget, proj.damage, proj.damageType, { armorPierce: proj.armorPierce, element: proj.element });
      if (proj.slow) this.applySlow(directTarget, proj.slow);
      if (proj.poison) this.applyPoison(directTarget, proj.poison);
    }
  }

  damageEnemy(enemy, amount, damageType = 'physical', { flash = true, armorPierce = 0, element = null, source = null } = {}) {
    if (!enemy.alive) return;
    const type = this.enemyTypes[enemy.typeId];
    const weak = element && enemy.weakTo === element ? WEAKNESS_MULTIPLIER : 1;
    if (flash) enemy.flash = 0.12;
    // An energy shield takes the hit instead of the body.
    if (enemy.shield && enemy.shield.hp > 0) {
      enemy.shield.sinceHit = 0;
      enemy.shield.hp -= amount * (SHIELD_DAMAGE[damageType] ?? 1) * weak;
      if (enemy.shield.hp <= 0) {
        enemy.shield.hp = 0;
        const pos = this.path.positionAt(enemy.dist);
        this.pushEvent({ type: 'shield-broken', x: pos.x, y: pos.y, enemyType: enemy.typeId, boss: enemy.boss });
      }
      return;
    }
    const stats = enemy.enraged ? { ...type, armor: (type.armor || 0) + ENRAGE_ARMOR } : type;
    // A weakness cuts straight through armor and wards as well as hitting harder.
    enemy.hp -= weak > 1 ? amount * weak : effectiveDamage(amount, damageType, stats, armorPierce);
    if (enemy.alive && enemy.hp > 0) this.checkBossPhases(enemy, type);
    if (enemy.hp <= 0 && enemy.alive) {
      enemy.alive = false;
      this.gold += enemy.bounty;
      if (source === 'hero') this.grantHeroXp(enemy.bounty);
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

  // Bosses hit back as they weaken: a summoning call at one threshold and a
  // rage below another.
  checkBossPhases(enemy, type) {
    const frac = enemy.hp / enemy.maxHp;
    if (type.summons && !enemy.summoned && frac <= type.summons.at) {
      enemy.summoned = true;
      for (let i = 0; i < type.summons.count; i++) {
        this.spawnEnemy(type.summons.type, Math.max(0, enemy.dist - 14 - i * 12));
      }
      const pos = this.path.positionAt(enemy.dist);
      this.pushEvent({ type: 'boss-summons', x: pos.x, y: pos.y, name: type.name, count: type.summons.count, enemyType: type.summons.type });
    }
    if (type.enrage && !enemy.enraged && frac <= ENRAGE_THRESHOLD) {
      enemy.enraged = true;
      enemy.speed = type.speed * ENRAGE_SPEED;
      const pos = this.path.positionAt(enemy.dist);
      this.pushEvent({ type: 'boss-enraged', x: pos.x, y: pos.y, name: type.name });
    }
  }

  // Can this status land? Shields keep burn and poison off the body (chill
  // still bites through); elements grant outright immunities.
  canAfflict(enemy, status) {
    if (status !== 'slow' && enemy.shield && enemy.shield.hp > 0) return false;
    return !(enemy.immune || []).includes(status);
  }

  // Fire meets ice: both effects are consumed in a burst of true damage.
  shatter(enemy) {
    const burst = Math.min(enemy.maxHp * SHATTER_FRACTION, enemy.boss ? SHATTER_CAP.boss : SHATTER_CAP.normal);
    enemy.slow = null;
    enemy.burn = null;
    const pos = this.path.positionAt(enemy.dist);
    this.pushEvent({ type: 'shatter', x: pos.x, y: pos.y, damage: Math.round(burst), enemyType: enemy.typeId });
    this.damageEnemy(enemy, burst, 'true');
  }

  // --- Hero -------------------------------------------------------------------

  // Put the chosen hero on the field by the castle gate.
  setHero(typeId) {
    const type = this.heroTypes[typeId];
    if (!type) return { ok: false, reason: 'unknown hero' };
    const gate = this.path.positionAt(Math.max(0, this.path.totalLength - 46));
    this.hero = {
      typeId,
      x: gate.x,
      y: gate.y,
      hp: type.hp,
      maxHp: type.hp,
      level: 0,
      xp: 0,
      alive: true,
      targetX: null, // move order
      targetY: null,
      cooldown: 0,
      abilityCooldown: 0,
      respawn: 0,
      facing: 1,
      swing: 0, // seconds of attack animation left, for the renderer
      engaged: 0, // enemies currently fighting it
    };
    return { ok: true };
  }

  heroStats(hero = this.hero) {
    const type = this.heroTypes[hero.typeId];
    const growth = 1 + hero.level * 0.25;
    return { ...type, hp: Math.round(type.hp * growth), damage: type.damage * growth, abilityDamage: type.ability.damage * growth };
  }

  commandHero(x, y) {
    const hero = this.hero;
    if (!hero || !hero.alive) return { ok: false };
    hero.targetX = Math.min(Math.max(x, 8), this.level.width - 8);
    hero.targetY = Math.min(Math.max(y, 8), this.level.height - 8);
    return { ok: true };
  }

  grantHeroXp(amount) {
    const hero = this.hero;
    if (!hero) return;
    hero.xp += amount;
    while (hero.level < HERO_MAX_LEVEL && hero.xp >= HERO_XP_LEVELS[hero.level]) {
      hero.level += 1;
      const stats = this.heroStats(hero);
      hero.maxHp = stats.hp;
      hero.hp = stats.hp; // levelling fully heals
      this.pushEvent({ type: 'hero-levelup', x: hero.x, y: hero.y, level: hero.level + 1, heroType: hero.typeId });
    }
  }

  // Enemy melee strength against the hero, per second.
  enemyAttack(enemy) {
    const type = this.enemyTypes[enemy.typeId];
    return (type.attack ?? Math.max(3, Math.round(type.hp * 0.035))) * (enemy.enraged ? 1.5 : 1);
  }

  updateHero(dt) {
    const hero = this.hero;
    if (!hero) return;
    for (const enemy of this.enemies) enemy.blocked = false;
    hero.cooldown = Math.max(0, hero.cooldown - dt);
    hero.abilityCooldown = Math.max(0, hero.abilityCooldown - dt);
    hero.swing = Math.max(0, hero.swing - dt);
    if (!hero.alive) {
      hero.respawn -= dt;
      if (hero.respawn <= 0) {
        const gate = this.path.positionAt(Math.max(0, this.path.totalLength - 46));
        Object.assign(hero, { alive: true, hp: hero.maxHp, x: gate.x, y: gate.y, targetX: null, targetY: null, engaged: 0 });
        this.pushEvent({ type: 'hero-respawned', x: hero.x, y: hero.y, heroType: hero.typeId });
      }
      return;
    }
    const stats = this.heroStats(hero);
    // Walk toward the move order.
    if (hero.targetX !== null) {
      const dx = hero.targetX - hero.x;
      const dy = hero.targetY - hero.y;
      const dist = Math.hypot(dx, dy);
      const step = stats.speed * dt;
      if (dist <= step) {
        hero.x = hero.targetX;
        hero.y = hero.targetY;
        hero.targetX = hero.targetY = null;
      } else {
        hero.x += (dx / dist) * step;
        hero.y += (dy / dist) * step;
        if (Math.abs(dx) > 1) hero.facing = dx > 0 ? 1 : -1;
      }
    }
    // Who is close enough to fight?
    const moving = hero.targetX !== null;
    const near = [];
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const pos = this.path.positionAt(enemy.dist);
      near.push({ enemy, pos, d: Math.hypot(pos.x - hero.x, pos.y - hero.y) });
    }
    near.sort((a, b) => b.enemy.dist - a.enemy.dist); // furthest along first
    // Melee heroes hold enemies that reach them (bosses shove through) and
    // take their blows; enemies brushing past a ranged hero hit it too.
    let engaged = 0;
    const reach = stats.style === 'melee' ? stats.range + 6 : 20;
    for (const n of near) {
      if (n.d > reach + n.enemy.radius) continue;
      if (stats.style === 'melee' && !moving && !n.enemy.boss && engaged < stats.block) n.enemy.blocked = true;
      engaged += 1;
      hero.hp -= this.enemyAttack(n.enemy) * (1 - (stats.armor || 0)) * dt;
    }
    hero.engaged = engaged;
    if (hero.hp <= 0) {
      hero.hp = 0;
      hero.alive = false;
      hero.respawn = stats.respawn;
      for (const enemy of this.enemies) enemy.blocked = false;
      this.pushEvent({ type: 'hero-died', x: hero.x, y: hero.y, heroType: hero.typeId, respawn: stats.respawn });
      return;
    }
    // Attack.
    if (hero.cooldown > 0 || moving) return;
    const attackReach = stats.style === 'melee' ? reach : stats.range; // melee swings at whatever it holds
    const inRange = near.filter((n) => n.d <= attackReach + n.enemy.radius);
    if (!inRange.length) return;
    const target = inRange[0];
    hero.cooldown = stats.attackInterval;
    hero.swing = 0.25;
    if (Math.abs(target.pos.x - hero.x) > 1) hero.facing = target.pos.x > hero.x ? 1 : -1;
    this.pushEvent({ type: 'hero-attack', heroType: hero.typeId, x: hero.x, y: hero.y, targetX: target.pos.x, targetY: target.pos.y });
    const hits = stats.splash
      ? inRange.filter((n) => Math.hypot(n.pos.x - target.pos.x, n.pos.y - target.pos.y) <= stats.splash)
      : inRange.slice(0, stats.cleave || 1);
    for (const n of hits) {
      const before = n.enemy.hp;
      this.damageEnemy(n.enemy, stats.damage, stats.damageType, { element: stats.element || null, source: 'hero' });
      if (stats.burn) this.applyBurn(n.enemy, stats.burn, stats.damageType, stats.element);
      if (stats.lifesteal) hero.hp = Math.min(hero.maxHp, hero.hp + Math.max(0, before - Math.max(0, n.enemy.hp)) * stats.lifesteal);
    }
  }

  // The hero's special, centred on the hero.
  useHeroAbility() {
    const hero = this.hero;
    if (!hero || !hero.alive) return { ok: false, reason: 'no hero' };
    if (hero.abilityCooldown > 0) return { ok: false, reason: 'cooling down' };
    const stats = this.heroStats(hero);
    const ability = stats.ability;
    hero.abilityCooldown = ability.cooldown;
    hero.swing = 0.4;
    let struck = 0;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const pos = this.path.positionAt(enemy.dist);
      if (Math.hypot(pos.x - hero.x, pos.y - hero.y) > ability.radius + enemy.radius) continue;
      struck += 1;
      this.damageEnemy(enemy, stats.abilityDamage, ability.damageType || stats.damageType, { element: ability.element || null, source: 'hero' });
      if (!enemy.alive) continue;
      if (ability.burn) this.applyBurn(enemy, ability.burn, stats.damageType, ability.element);
      if (ability.slow) this.applySlow(enemy, ability.slow);
      if (ability.stun) enemy.stun = Math.max(enemy.stun, enemy.boss ? ability.stun * 0.5 : ability.stun);
    }
    if (ability.heal) hero.hp = Math.min(hero.maxHp, hero.hp + hero.maxHp * ability.heal);
    this.pushEvent({ type: 'hero-ability', heroType: hero.typeId, name: ability.name, x: hero.x, y: hero.y, radius: ability.radius, struck });
    return { ok: true, struck };
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
