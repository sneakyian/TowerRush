// Visual effects state: particles, ground decals, floating texts, banners,
// lightning bolts, tracers, screen shake, full-screen flashes, and scheduled
// bursts. No DOM or canvas access — the renderer draws this, tests drive it
// headless.
//
// Particle shapes (drawn by render.js):
//   dot     shrinking filled circle            spark   streak along its velocity
//   ember   glowing dot with a soft halo        shard   spinning triangle
//   star    spinning four-point star            smoke   growing soft puff
//   ring    expanding ring                      flash   short bright burst
//   drop    falling droplet                     tracer  fading line (x,y)->(x2,y2)
//   scorch / crater / frostpatch / puddle       ground decals (groundParticles)
//   leaf / snow / ash / sand / firefly / pollen ambient weather

import { ENEMY_TYPES } from './config.js';

const MAX_PARTICLES = 900;
const MAX_GROUND = 160;

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export class Effects {
  constructor({ enemyTypes = ENEMY_TYPES } = {}) {
    this.enemyTypes = enemyTypes;
    this.particles = [];       // drawn above enemies
    this.groundParticles = []; // drawn beneath enemies (decals, dust)
    this.texts = [];           // {x,y,text,color,life,maxLife,scale}
    this.banner = null;        // {text,color,life,maxLife,sub}
    this.scheduled = [];       // [{delay, x, y, kind, ...}] future bursts
    this.bolts = [];           // [{points, life, maxLife}] lightning arcs
    this.shake = 0;            // current screen-shake amplitude (px)
    this.flash = null;         // {color, alpha} full-screen flash
    this.dustTimer = 0;        // throttles ambient footstep dust
    this.weatherTimer = 0;     // throttles ambient weather
    this.time = 0;
  }

  clear() {
    this.particles = [];
    this.groundParticles = [];
    this.texts = [];
    this.banner = null;
    this.scheduled = [];
    this.bolts = [];
    this.shake = 0;
    this.flash = null;
  }

  // --- Event intake -------------------------------------------------------------

  process(events) {
    for (const event of events) {
      switch (event.type) {
        case 'shot': this.spawnMuzzle(event); break;
        case 'hit': this.spawnImpact(event); break;
        case 'zap': this.spawnLightning(event); break;
        case 'enemy-died': event.boss ? this.spawnBossDeath(event) : this.spawnDeath(event); break;
        case 'enemy-spawned': this.spawnEmerge(event); break;
        case 'boss-spawned': this.spawnBossArrival(event); break;
        case 'enemy-leaked': this.spawnLeak(event); break;
        case 'tower-built': this.spawnConstruction(event); break;
        case 'tower-sold': this.spawnSale(event); break;
        case 'tower-upgraded': this.spawnUpgrade(event); break;
        case 'wave-started':
          this.setBanner(event.final ? 'Final Wave' : `Wave ${event.wave}`, event.final ? '#ff9f45' : '#f2e3b3');
          break;
        case 'game-won':
          this.setBanner('Victory!', '#ffd700', 'The realm is safe');
          this.scheduleFireworks();
          this.addFlash('#ffffff', 0.5);
          break;
        case 'game-lost':
          this.setBanner('Defeat!', '#e25555', 'The castle has fallen');
          this.addFlash('#5a0000', 0.55);
          this.shake = Math.max(this.shake, 10);
          break;
      }
    }
  }

  // --- Ambient: driven by live game state every frame ----------------------------

  ambient(game, dt) {
    this.time += dt;
    this.ambientWeather(game.level, dt);

    // Footstep dust under walkers.
    this.dustTimer -= dt;
    if (this.dustTimer <= 0) {
      this.dustTimer = 0.09;
      for (const enemy of game.enemies) {
        if (!enemy.alive || Math.random() > 0.4) continue;
        const pos = game.path.positionAt(enemy.dist);
        this.addGroundParticle({
          x: pos.x + rand(-4, 4), y: pos.y + enemy.radius * 0.6,
          vx: rand(-8, 8), vy: rand(-14, -4),
          life: rand(0.3, 0.55), size: rand(1.5, 3), color: '#b8a67e', shape: 'smoke',
        });
      }
    }

    // Status effects on enemies: embers, chill sparkles, poison bubbles.
    for (const enemy of game.enemies) {
      if (!enemy.alive) continue;
      const pos = game.path.positionAt(enemy.dist);
      if (enemy.burn && Math.random() < dt * 16) {
        const fire = Math.random() < 0.35;
        this.addParticle({
          x: pos.x + rand(-enemy.radius * 0.6, enemy.radius * 0.6), y: pos.y - enemy.radius * 0.5,
          vx: rand(-10, 10), vy: fire ? rand(-40, -18) : rand(-60, -28),
          life: fire ? rand(0.25, 0.45) : rand(0.3, 0.6), size: fire ? rand(2.5, 4) : rand(1.5, 3),
          color: pick(['#ff9f45', '#ffd97a', '#ff6b35']), shape: fire ? 'fire' : 'ember', drag: fire ? 1.5 : 0,
        });
      }
      if (enemy.slow && Math.random() < dt * 9) {
        this.addParticle({
          x: pos.x + rand(-enemy.radius, enemy.radius), y: pos.y + rand(-enemy.radius, enemy.radius),
          vx: rand(-6, 6), vy: rand(-14, -3),
          life: rand(0.5, 0.9), size: rand(1.2, 2.4), color: '#dff3ff', shape: 'star', spin: rand(-3, 3),
        });
      }
      if (enemy.poison && Math.random() < dt * (6 + enemy.poison.stacks * 3)) {
        this.addParticle({
          x: pos.x + rand(-enemy.radius * 0.7, enemy.radius * 0.7), y: pos.y - enemy.radius * 0.3,
          vx: rand(-5, 5), vy: rand(-26, -12),
          life: rand(0.5, 0.9), size: rand(1.5, 3), color: pick(['#8fd33a', '#c6ff6b']), shape: 'dot', drag: 1.5,
        });
      }
    }

    // Towers: beam impact sparks, beacon motes, frost mist, venom drips.
    game.towers.forEach((tower, i) => {
      if (!tower) return;
      const spot = game.level.buildSpots[i];
      if (tower.beamTargetId) {
        const target = game.enemies.find((e) => e.id === tower.beamTargetId && e.alive);
        if (target && Math.random() < dt * 34) {
          const pos = game.path.positionAt(target.dist);
          const angle = rand(0, Math.PI * 2);
          this.addParticle({
            x: pos.x, y: pos.y,
            vx: Math.cos(angle) * rand(40, 110), vy: Math.sin(angle) * rand(40, 110) - 25,
            life: rand(0.15, 0.32), size: rand(1, 2.4), color: pick(['#ff4fd8', '#ffffff', '#ffb3ec']), shape: 'spark',
          });
        }
      }
      if (tower.typeId === 'beacon' && Math.random() < dt * 10) {
        const a = rand(0, Math.PI * 2);
        this.addParticle({
          x: spot.x + Math.cos(a) * rand(4, 16), y: spot.y - 10 + Math.sin(a) * rand(2, 6),
          vx: rand(-4, 4), vy: rand(-34, -16),
          life: rand(0.8, 1.4), size: rand(1.2, 2.4), color: pick(['#ffd166', '#fff1b8']), shape: 'ember', drag: 0.6,
        });
      }
      if (tower.typeId === 'frost' && Math.random() < dt * 5) {
        this.addGroundParticle({
          x: spot.x + rand(-12, 12), y: spot.y + rand(0, 8),
          vx: rand(-6, 6), vy: rand(-4, -1),
          life: rand(0.9, 1.6), size: rand(4, 7), color: 'rgba(191,233,255,0.35)', shape: 'smoke',
        });
      }
      if (tower.typeId === 'venom' && Math.random() < dt * 4) {
        this.addParticle({
          x: spot.x + rand(-6, 6), y: spot.y - 14,
          vx: 0, vy: 20,
          life: 0.5, size: 2, color: '#8fd33a', shape: 'drop', gravity: 180,
        });
      }
    });

    // Projectile trails.
    for (const proj of game.projectiles) {
      const t = proj.towerType;
      if (t === 'frost' && Math.random() < dt * 34) {
        this.addParticle({ x: proj.x + rand(-2, 2), y: proj.y + rand(-2, 2), vx: rand(-8, 8), vy: rand(-8, 8), life: rand(0.2, 0.4), size: rand(1, 2), color: '#dff3ff', shape: 'star', spin: 4 });
      } else if (t === 'mage' && Math.random() < dt * 44) {
        this.addParticle({ x: proj.x + rand(-2, 2), y: proj.y + rand(-2, 2), vx: rand(-12, 12), vy: rand(-12, 12), life: rand(0.2, 0.36), size: rand(1, 2.2), color: pick(['#b9a7ff', '#e6dcff']), shape: 'ember' });
      } else if (t === 'cannon' && Math.random() < dt * 28) {
        this.addParticle({ x: proj.x, y: proj.y - 10, vx: rand(-6, 6), vy: rand(-14, -4), life: rand(0.25, 0.5), size: rand(1.5, 3), color: '#8d949b', shape: 'smoke' });
      } else if (t === 'mortar' && Math.random() < dt * 60) {
        this.addParticle({ x: proj.x, y: proj.y - 14, vx: rand(-10, 10), vy: rand(-10, 10), life: rand(0.2, 0.4), size: rand(1.5, 3), color: pick(['#ffb347', '#ff6b35', '#9aa0a6']), shape: Math.random() < 0.6 ? 'ember' : 'smoke' });
      } else if (t === 'venom' && Math.random() < dt * 20) {
        this.addParticle({ x: proj.x, y: proj.y, vx: rand(-3, 3), vy: 10, life: 0.4, size: 1.6, color: '#8fd33a', shape: 'drop', gravity: 160 });
      } else if (t === 'archer' && Math.random() < dt * 20) {
        this.addParticle({ x: proj.x, y: proj.y, vx: 0, vy: 0, life: 0.14, size: 1, color: 'rgba(255,255,255,0.5)', shape: 'dot' });
      }
    }
  }

  // Theme weather: each level has its own drifting atmosphere.
  ambientWeather(level, dt) {
    const { width = 800, height = 480, theme } = level;
    this.weatherTimer -= dt;
    if (this.weatherTimer > 0) return;
    this.weatherTimer = 0.05;
    const kind = (theme && theme.weather) || 'none';
    const roll = Math.random();
    if (kind === 'leaves' && roll < 0.35) {
      this.addParticle({
        x: rand(-20, width), y: rand(-10, height * 0.3), vx: rand(18, 40), vy: rand(10, 24),
        life: rand(5, 8), size: rand(2, 3.2), color: pick(['#7fb24a', '#a9c94f', '#d9a441']),
        shape: 'leaf', spin: rand(1, 4), wobble: 40, drag: 0,
      });
      if (Math.random() < 0.3) {
        this.addParticle({ x: rand(0, width), y: rand(0, height), vx: rand(-6, 6), vy: rand(-8, -2), life: rand(2, 4), size: rand(0.8, 1.6), color: 'rgba(255,255,220,0.8)', shape: 'pollen', wobble: 20 });
      }
    } else if (kind === 'snow' && roll < 0.9) {
      for (let i = 0; i < 2; i++) {
        this.addParticle({
          x: rand(-20, width), y: -6, vx: rand(-8, 14), vy: rand(22, 48),
          life: rand(9, 13), size: rand(1.2, 2.8), color: 'rgba(255,255,255,0.9)', shape: 'snow', wobble: 30,
        });
      }
    } else if (kind === 'sand' && roll < 0.5) {
      this.addParticle({
        x: -10, y: rand(0, height), vx: rand(160, 260), vy: rand(-10, 10),
        life: rand(3.5, 5.5), size: rand(0.8, 1.6), color: 'rgba(255,235,180,0.55)', shape: 'sand',
      });
    } else if (kind === 'fireflies') {
      if (roll < 0.25) {
        this.addParticle({
          x: rand(0, width), y: rand(height * 0.2, height), vx: rand(-8, 8), vy: rand(-8, 8),
          life: rand(3, 6), size: rand(1.2, 2.2), color: '#c6ff8a', shape: 'firefly', wobble: 30,
        });
      }
      if (roll > 0.85) {
        this.addGroundParticle({
          x: rand(0, width), y: rand(0, height), vx: rand(4, 12), vy: rand(-3, 3),
          life: rand(4, 7), size: rand(14, 26), color: 'rgba(200,230,200,0.12)', shape: 'smoke',
        });
      }
    } else if (kind === 'embers') {
      if (roll < 0.5) {
        this.addParticle({
          x: rand(0, width), y: height + 6, vx: rand(-14, 14), vy: rand(-60, -30),
          life: rand(4, 7), size: rand(1, 2.4), color: pick(['#ff9f45', '#ffd97a', '#ff6b35']), shape: 'ember', wobble: 36, drag: 0.3,
        });
      }
      if (roll > 0.55) {
        this.addParticle({
          x: rand(-20, width), y: -6, vx: rand(-10, 10), vy: rand(14, 30),
          life: rand(9, 14), size: rand(1, 2.2), color: 'rgba(120,110,110,0.7)', shape: 'ash', wobble: 25,
        });
      }
    }
  }

  // --- Spawners -------------------------------------------------------------------

  spawnMuzzle(event) {
    const t = event.towerType;
    if (t === 'cannon' || t === 'mortar') {
      const n = t === 'mortar' ? 12 : 8;
      for (let i = 0; i < n; i++) {
        const spread = event.angle + rand(-0.5, 0.5);
        this.addParticle({
          x: event.x + Math.cos(event.angle) * 14, y: event.y - 10 + Math.sin(event.angle) * 14,
          vx: Math.cos(spread) * rand(60, 150), vy: Math.sin(spread) * rand(60, 150) - 20,
          life: rand(0.15, 0.35), size: rand(2, 4.5), color: i % 2 ? '#ffd97a' : '#9aa0a6',
          shape: i % 2 ? 'spark' : 'smoke',
        });
      }
      this.addParticle({ x: event.x + Math.cos(event.angle) * 16, y: event.y - 10 + Math.sin(event.angle) * 16, vx: 0, vy: 0, life: 0.1, size: t === 'mortar' ? 16 : 11, color: '#fff1b8', shape: 'flash' });
      if (t === 'mortar') this.shake = Math.max(this.shake, 2);
    } else if (t === 'sniper') {
      // Tracer line from nest to target plus a sharp muzzle flash.
      if (event.targetX !== undefined) {
        this.addParticle({ x: event.x, y: event.y - 30, x2: event.targetX, y2: event.targetY, vx: 0, vy: 0, life: 0.14, size: 2, color: '#f2ffd0', shape: 'tracer' });
      }
      this.addParticle({ x: event.x + Math.cos(event.angle) * 18, y: event.y - 30 + Math.sin(event.angle) * 18, vx: 0, vy: 0, life: 0.09, size: 9, color: '#ffffff', shape: 'flash' });
    } else if (t === 'mage') {
      for (let i = 0; i < 6; i++) {
        this.addParticle({ x: event.x, y: event.y - 26, vx: rand(-40, 40), vy: rand(-40, 40), life: rand(0.2, 0.42), size: rand(1.4, 3), color: pick(['#b9a7ff', '#e6dcff']), shape: 'ember' });
      }
    } else if (t === 'flame') {
      // Fire tongues ride the jet, sooty smoke curls off its end, embers stray.
      const level = event.level || 0;
      const len = 15 + level * 1.5;
      const ox = event.x + Math.cos(event.angle) * len;
      const oy = event.y - 12 + Math.sin(event.angle) * len;
      const reach = event.targetX !== undefined ? Math.hypot(event.targetX - ox, event.targetY - oy) : 60;
      for (let i = 0; i < 4; i++) {
        const spread = event.angle + rand(-0.2, 0.2);
        const speed = rand(150, 260);
        this.addParticle({
          x: ox, y: oy, vx: Math.cos(spread) * speed, vy: Math.sin(spread) * speed - 8,
          life: rand(0.22, 0.4), size: rand(2.5, 4.5) + level * 0.5,
          color: pick(['#ff9a3a', '#ff7a2a', '#ffc45a', '#ff5a1f', '#e8401a']), shape: 'fire', drag: 2.2, grow: 1.6,
        });
      }
      const ex = ox + Math.cos(event.angle) * reach;
      const ey = oy + Math.sin(event.angle) * reach;
      this.addParticle({
        x: ex + rand(-6, 6), y: ey + rand(-6, 6),
        vx: Math.cos(event.angle) * rand(20, 50) + rand(-10, 10), vy: rand(-45, -20),
        life: rand(0.6, 1.1), size: rand(3, 5), color: pick(['rgba(70,60,60,0.55)', 'rgba(40,35,35,0.5)']),
        shape: 'smoke', grow: 2.2, drag: 1.2,
      });
      if (Math.random() < 0.7) {
        this.addParticle({ x: ex, y: ey, vx: rand(-40, 40), vy: rand(-80, -30), life: rand(0.4, 0.8), size: rand(1.2, 2), color: pick(['#ffd97a', '#ff9f45']), shape: 'ember', gravity: 40, drag: 0.8 });
      }
    } else if (t === 'venom') {
      for (let i = 0; i < 3; i++) {
        this.addParticle({ x: event.x, y: event.y - 14, vx: Math.cos(event.angle) * rand(20, 50) + rand(-15, 15), vy: Math.sin(event.angle) * rand(20, 50), life: 0.3, size: 1.6, color: '#8fd33a', shape: 'drop', gravity: 200 });
      }
    } else if (t === 'archer') {
      this.addParticle({ x: event.x, y: event.y - 20, vx: Math.cos(event.angle) * 30, vy: Math.sin(event.angle) * 30, life: 0.15, size: 1.6, color: '#e8e2d4', shape: 'dot' });
    }
  }

  spawnImpact(event) {
    const t = event.towerType;
    if (t === 'cannon' || t === 'mortar') {
      this.spawnExplosion(event.x, event.y, t === 'mortar' ? 1.6 : 1, Math.max(20, event.splash));
    } else if (t === 'frost') {
      for (let i = 0; i < 9; i++) {
        const angle = rand(0, Math.PI * 2);
        const speed = rand(30, 110);
        this.addParticle({ x: event.x, y: event.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 20, life: rand(0.3, 0.55), size: rand(2, 3.5), color: i % 2 ? '#8fd3ff' : '#ffffff', shape: 'shard', spin: rand(-8, 8), gravity: 120 });
      }
      this.addParticle({ x: event.x, y: event.y, vx: 0, vy: 0, life: 0.28, size: 16, color: '#bfe9ff', shape: 'ring' });
      this.addGroundParticle({ x: event.x, y: event.y, vx: 0, vy: 0, life: 2.5, size: rand(9, 13), color: 'rgba(191,233,255,0.45)', shape: 'frostpatch' });
    } else if (t === 'venom') {
      for (let i = 0; i < 7; i++) {
        this.addParticle({ x: event.x, y: event.y, vx: rand(-60, 60), vy: rand(-70, -10), life: rand(0.3, 0.5), size: rand(1.5, 2.6), color: pick(['#8fd33a', '#c6ff6b']), shape: 'drop', gravity: 220 });
      }
      this.addGroundParticle({ x: event.x, y: event.y, vx: 0, vy: 0, life: 3, size: rand(8, 12), color: 'rgba(120,200,40,0.4)', shape: 'puddle' });
    } else if (t === 'sniper') {
      for (let i = 0; i < 8; i++) {
        const angle = rand(0, Math.PI * 2);
        this.addParticle({ x: event.x, y: event.y, vx: Math.cos(angle) * rand(60, 160), vy: Math.sin(angle) * rand(60, 160), life: rand(0.15, 0.3), size: rand(1, 2), color: '#ffffff', shape: 'spark' });
      }
      this.addParticle({ x: event.x, y: event.y, vx: 0, vy: 0, life: 0.12, size: 12, color: '#f2ffd0', shape: 'flash' });
    } else if (t === 'flame') {
      // Fire splashes up the target, embers pop off, and the ground scorches.
      for (let i = 0; i < 3; i++) {
        this.addParticle({ x: event.x + rand(-6, 6), y: event.y + rand(-5, 5), vx: rand(-25, 25), vy: rand(-65, -25), life: rand(0.25, 0.45), size: rand(2, 3.5), color: pick(['#ff9f45', '#ff7a2a', '#ff6b35', '#e8401a']), shape: 'fire', drag: 1.5 });
      }
      this.addParticle({ x: event.x + rand(-4, 4), y: event.y + rand(-4, 4), vx: rand(-30, 30), vy: rand(-70, -30), life: rand(0.3, 0.6), size: rand(1.4, 2.4), color: '#ffd97a', shape: 'ember', gravity: 50 });
      if (Math.random() < 0.2) {
        this.addGroundParticle({ x: event.x + rand(-4, 4), y: event.y + rand(2, 8), vx: 0, vy: 0, life: rand(2, 4), size: rand(4, 7), color: 'rgba(30,20,15,0.45)', shape: 'scorch' });
      }
    } else if (t === 'mage') {
      for (let i = 0; i < 12; i++) {
        const angle = rand(0, Math.PI * 2);
        const speed = rand(30, 110);
        this.addParticle({ x: event.x, y: event.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: rand(0.25, 0.5), size: rand(1.4, 3.2), color: i % 2 ? '#8f7bff' : '#e6dcff', shape: i % 3 ? 'ember' : 'star', spin: rand(-6, 6) });
      }
      this.addParticle({ x: event.x, y: event.y, vx: 0, vy: 0, life: 0.2, size: 12, color: '#b9a7ff', shape: 'ring' });
    } else {
      for (let i = 0; i < 5; i++) {
        this.addParticle({ x: event.x, y: event.y, vx: rand(-60, 60), vy: rand(-60, 10), life: rand(0.15, 0.3), size: rand(1.2, 2.2), color: i % 2 ? '#e8e2d4' : '#c9a86a', shape: 'spark', gravity: 120 });
      }
    }
  }

  // Multi-stage explosion: flash, fireball, sparks, debris, smoke, ring, decal, shake.
  spawnExplosion(x, y, scale, splash) {
    this.addParticle({ x, y, vx: 0, vy: 0, life: 0.12, size: 22 * scale, color: '#fff1b8', shape: 'flash' });
    for (let i = 0; i < 4; i++) {
      this.addParticle({ x: x + rand(-6, 6) * scale, y: y + rand(-6, 6) * scale, vx: rand(-20, 20), vy: rand(-40, -10), life: rand(0.25, 0.4), size: rand(8, 13) * scale, color: pick(['#ff9f45', '#ff6b35', '#ffd97a']), shape: 'smoke', grow: 1.2 });
    }
    for (let i = 0; i < Math.round(18 * scale); i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(60, 220) * scale;
      this.addParticle({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 30, life: rand(0.3, 0.65), size: rand(1.5, 3.5), color: pick(['#ffd97a', '#ff9f45', '#ff6b35', '#ffffff']), shape: 'spark', gravity: 200, drag: 1.2 });
    }
    for (let i = 0; i < Math.round(7 * scale); i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(50, 150) * scale;
      this.addParticle({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 60, life: rand(0.4, 0.8), size: rand(2, 4), color: pick(['#3b3b3b', '#6b5a4a', '#8a7a6a']), shape: 'shard', spin: rand(-12, 12), gravity: 300 });
    }
    for (let i = 0; i < Math.round(6 * scale); i++) {
      this.addParticle({ x: x + rand(-9, 9), y: y + rand(-9, 9), vx: rand(-18, 18), vy: rand(-55, -20), life: rand(0.6, 1.2), size: rand(5, 10) * scale, color: '#7d848a', shape: 'smoke', grow: 1.6 });
    }
    this.addParticle({ x, y, vx: 0, vy: 0, life: 0.35, size: splash * scale, color: '#ffb347', shape: 'ring' });
    this.addGroundParticle({ x, y, vx: 0, vy: 0, life: 5, size: rand(10, 14) * scale, color: 'rgba(40,32,22,0.55)', shape: scale > 1.2 ? 'crater' : 'scorch' });
    this.shake = Math.max(this.shake, 1.5 * scale);
  }

  spawnLightning(event) {
    this.bolts.push({ points: event.points, life: 0.18, maxLife: 0.18 });
    for (const p of event.points.slice(1)) {
      this.addParticle({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0.1, size: 9, color: '#dff3ff', shape: 'flash' });
      for (let i = 0; i < 6; i++) {
        const angle = rand(0, Math.PI * 2);
        const speed = rand(40, 130);
        this.addParticle({ x: p.x, y: p.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: rand(0.15, 0.32), size: rand(1, 2.2), color: i % 2 ? '#dff3ff' : '#7ec8ff', shape: 'spark' });
      }
    }
  }

  spawnDeath(event) {
    const type = this.enemyTypes[event.enemyType];
    const color = type?.color ?? '#888';
    const r = type?.radius ?? 9;
    // Shards of the body, a spark burst, a rising soul wisp, and a coin.
    for (let i = 0; i < 8; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(30, 110);
      this.addParticle({ x: event.x, y: event.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 50, life: rand(0.35, 0.65), size: rand(2, 3.5) * (r / 9), color, shape: 'shard', spin: rand(-10, 10), gravity: 260 });
    }
    for (let i = 0; i < 6; i++) {
      const angle = rand(0, Math.PI * 2);
      this.addParticle({ x: event.x, y: event.y, vx: Math.cos(angle) * rand(40, 120), vy: Math.sin(angle) * rand(40, 120), life: rand(0.2, 0.4), size: rand(1, 2), color: '#ffffff', shape: 'spark' });
    }
    this.addParticle({ x: event.x, y: event.y - 4, vx: 0, vy: -28, life: 0.9, size: r * 0.7, color: 'rgba(230,240,255,0.5)', shape: 'smoke', grow: 0.6 });
    this.addParticle({ x: event.x, y: event.y, vx: rand(-15, 15), vy: -95, life: 0.65, size: 3, color: '#ffd700', shape: 'star', spin: 9, gravity: 280 });
    this.addText(event.x, event.y - 12, `+${event.bounty}g`, '#ffd700');
  }

  spawnBossDeath(event) {
    const type = this.enemyTypes[event.enemyType];
    const color = type?.color ?? '#888';
    this.addFlash('#ffffff', 0.7);
    this.shake = Math.max(this.shake, 12);
    this.spawnExplosion(event.x, event.y, 2.2, 60);
    for (let i = 0; i < 24; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(60, 220);
      this.addParticle({ x: event.x, y: event.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 80, life: rand(0.6, 1.2), size: rand(3, 6), color, shape: 'shard', spin: rand(-12, 12), gravity: 240 });
    }
    // Aftershocks spread out over the next second.
    for (let i = 1; i <= 6; i++) {
      this.scheduled.push({ delay: i * 0.16, x: event.x + rand(-40, 40), y: event.y + rand(-30, 30), kind: 'blast', scale: 0.9 });
    }
    this.scheduled.push({ delay: 0.3, x: event.x, y: event.y, kind: 'firework' });
    this.scheduled.push({ delay: 0.7, x: event.x - 60, y: event.y - 40, kind: 'firework' });
    this.scheduled.push({ delay: 1.1, x: event.x + 60, y: event.y - 40, kind: 'firework' });
    this.setBanner(`${type?.name ?? 'Boss'} slain!`, '#ffd700', `+${event.bounty} gold`);
    this.addText(event.x, event.y - 20, `+${event.bounty}g`, '#ffd700', 1.6);
  }

  spawnBossArrival(event) {
    this.setBanner(event.name, '#ff6b6b', 'approaches');
    this.shake = Math.max(this.shake, 5);
    this.addFlash('#3a0000', 0.35);
  }

  spawnEmerge(event) {
    for (let i = 0; i < 5; i++) {
      this.addParticle({ x: event.x + rand(-6, 10), y: event.y + rand(-6, 6), vx: rand(5, 34), vy: rand(-20, -4), life: rand(0.3, 0.55), size: rand(2, 4.5), color: '#b8a67e', shape: 'smoke', grow: 1.4 });
    }
  }

  spawnLeak(event) {
    const cost = event.cost || 1;
    this.addText(event.x, event.y, cost === 1 ? '-1 life' : `-${cost} lives`, '#e25555', 1 + cost * 0.12);
    this.addParticle({ x: event.x, y: event.y, vx: 0, vy: 0, life: 0.4 + cost * 0.05, size: 22 + cost * 6, color: '#e25555', shape: 'ring' });
    this.addFlash('#5a0000', Math.min(0.45, 0.12 + cost * 0.06));
    this.shake = Math.max(this.shake, 1 + cost);
  }

  spawnConstruction(event) {
    for (let i = 0; i < 12; i++) {
      const angle = rand(0, Math.PI * 2);
      this.addParticle({
        x: event.x + Math.cos(angle) * rand(4, 14), y: event.y + Math.sin(angle) * rand(2, 8),
        vx: Math.cos(angle) * rand(20, 70), vy: rand(-80, -20),
        life: rand(0.3, 0.65), size: rand(2, 4), color: i % 3 === 0 ? '#9aa1a8' : '#c2b391',
        gravity: 240, shape: i % 2 ? 'shard' : 'smoke', spin: rand(-8, 8), grow: 1.3,
      });
    }
    this.addParticle({ x: event.x, y: event.y, vx: 0, vy: 0, life: 0.3, size: 24, color: '#ffffff', shape: 'ring' });
  }

  spawnSale(event) {
    for (let i = 0; i < 8; i++) {
      this.addParticle({ x: event.x + rand(-8, 8), y: event.y + rand(-10, 0), vx: rand(-25, 25), vy: rand(-90, -40), life: rand(0.4, 0.7), size: rand(2, 3), color: '#ffd700', shape: 'star', spin: rand(-8, 8), gravity: 220 });
    }
    this.addText(event.x, event.y - 16, `+${event.refund}g`, '#ffd700');
  }

  spawnUpgrade(event) {
    this.addParticle({ x: event.x, y: event.y - 8, vx: 0, vy: 0, life: 0.45, size: 28, color: '#ffd700', shape: 'ring' });
    this.addParticle({ x: event.x, y: event.y - 14, vx: 0, vy: 0, life: 0.18, size: 20, color: '#fff1b8', shape: 'flash' });
    for (let i = 0; i < 16; i++) {
      const angle = rand(0, Math.PI * 2);
      this.addParticle({
        x: event.x + Math.cos(angle) * rand(2, 12), y: event.y + Math.sin(angle) * rand(1, 6),
        vx: rand(-18, 18), vy: rand(-120, -50),
        life: rand(0.5, 0.9), size: rand(1.5, 3), color: i % 3 === 0 ? '#ffffff' : '#ffd700',
        shape: i % 2 ? 'star' : 'ember', spin: rand(-8, 8), gravity: 90, drag: 0.8,
      });
    }
    this.addText(event.x, event.y - 30, `Level ${event.level}`, '#ffd700', 1.2);
  }

  scheduleFireworks() {
    for (let i = 0; i < 7; i++) {
      this.scheduled.push({ delay: 0.3 + i * 0.4, x: rand(120, 680), y: rand(60, 220), kind: 'firework' });
    }
  }

  spawnFirework(x, y) {
    const hue = pick(['#ffd700', '#7bd47b', '#7badff', '#ff8fb3', '#c9a1ff', '#ffffff']);
    this.addParticle({ x, y, vx: 0, vy: 0, life: 0.15, size: 18, color: '#ffffff', shape: 'flash' });
    for (let i = 0; i < 26; i++) {
      const angle = (i / 26) * Math.PI * 2;
      const speed = rand(60, 130);
      this.addParticle({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: rand(0.6, 1.0), size: rand(1.5, 3), color: i % 4 === 0 ? '#ffffff' : hue, shape: 'spark', gravity: 70, drag: 1.0 });
    }
    for (let i = 0; i < 10; i++) {
      this.addParticle({ x, y, vx: rand(-50, 50), vy: rand(-60, 20), life: rand(1, 1.6), size: rand(1.5, 2.6), color: hue, shape: 'star', spin: rand(-8, 8), gravity: 60, drag: 1.2 });
    }
  }

  // --- Primitives -------------------------------------------------------------------

  addParticle({ x, y, vx, vy, life, size, color, shape = 'dot', gravity = 0, spin = 0, drag = 0, grow = 1, wobble = 0, x2, y2 }) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push({ x, y, vx, vy, life, maxLife: life, size, color, shape, gravity, spin, rot: Math.random() * Math.PI * 2, drag, grow, wobble, x2, y2 });
  }

  addGroundParticle({ x, y, vx, vy, life, size, color, shape = 'dot', gravity = 0 }) {
    if (this.groundParticles.length >= MAX_GROUND) this.groundParticles.shift();
    this.groundParticles.push({ x, y, vx, vy, life, maxLife: life, size, color, shape, gravity, spin: 0, rot: 0, drag: 0, grow: 1, wobble: 0 });
  }

  addText(x, y, text, color, scale = 1) {
    this.texts.push({ x, y, text, color, life: 0.9 + scale * 0.2, maxLife: 0.9 + scale * 0.2, scale });
  }

  setBanner(text, color, sub = '') {
    this.banner = { text, color, sub, life: 2.2, maxLife: 2.2 };
  }

  addFlash(color, alpha) {
    if (!this.flash || alpha > this.flash.alpha) this.flash = { color, alpha };
  }

  // --- Integration ------------------------------------------------------------------

  update(dt) {
    for (const list of [this.particles, this.groundParticles]) {
      for (const p of list) {
        p.life -= dt;
        p.vy += p.gravity * dt;
        if (p.drag) {
          const k = Math.max(0, 1 - p.drag * dt);
          p.vx *= k;
          p.vy *= k;
        }
        if (p.wobble) p.vx += (Math.random() - 0.5) * p.wobble * dt * 10;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.spin * dt;
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    this.groundParticles = this.groundParticles.filter((p) => p.life > 0);

    for (const t of this.texts) {
      t.life -= dt;
      t.y -= 28 * dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);

    if (this.banner) {
      this.banner.life -= dt;
      if (this.banner.life <= 0) this.banner = null;
    }

    for (const b of this.bolts) b.life -= dt;
    this.bolts = this.bolts.filter((b) => b.life > 0);

    for (const s of this.scheduled) {
      s.delay -= dt;
      if (s.delay <= 0) {
        if (s.kind === 'firework') this.spawnFirework(s.x, s.y);
        else if (s.kind === 'blast') this.spawnExplosion(s.x, s.y, s.scale || 1, 30);
      }
    }
    this.scheduled = this.scheduled.filter((s) => s.delay > 0);

    this.shake = Math.max(0, this.shake - dt * 18);
    if (this.flash) {
      this.flash.alpha -= dt * 1.6;
      if (this.flash.alpha <= 0) this.flash = null;
    }
  }
}
