// Visual effects state: particles, floating texts, banners, and scheduled
// bursts (fireworks). No DOM or canvas access — the renderer draws this,
// tests drive it headless.
//
// Two particle layers: `groundParticles` render under enemies (scorch marks,
// dust) and `particles` render on top (sparks, smoke, debris).

import { ENEMY_TYPES } from './config.js';

function rand(min, max) {
  return min + Math.random() * (max - min);
}

export class Effects {
  constructor({ enemyTypes = ENEMY_TYPES } = {}) {
    this.enemyTypes = enemyTypes;
    this.particles = [];       // {x,y,vx,vy,life,maxLife,size,color,shape,gravity}
    this.groundParticles = []; // same shape, drawn beneath enemies
    this.texts = [];           // {x,y,text,color,life,maxLife}
    this.banner = null;        // {text,color,life,maxLife}
    this.scheduled = [];       // [{delay, x, y, kind}] future bursts
    this.bolts = [];           // [{points, life, maxLife}] lightning arcs
    this.dustTimer = 0;        // throttles ambient footstep dust
  }

  clear() {
    this.particles = [];
    this.groundParticles = [];
    this.texts = [];
    this.banner = null;
    this.scheduled = [];
    this.bolts = [];
  }

  // Turn gameplay events (from Game.drainEvents()) into visual effects.
  process(events) {
    for (const event of events) {
      switch (event.type) {
        case 'shot':
          this.spawnMuzzle(event);
          break;
        case 'hit':
          this.spawnImpact(event);
          break;
        case 'zap':
          this.spawnLightning(event);
          break;
        case 'enemy-died':
          this.spawnDeath(event);
          break;
        case 'enemy-spawned':
          this.spawnEmerge(event);
          break;
        case 'enemy-leaked':
          this.spawnLeak(event);
          break;
        case 'tower-built':
          this.spawnConstruction(event);
          break;
        case 'tower-sold':
          this.spawnSale(event);
          break;
        case 'tower-upgraded':
          this.spawnUpgrade(event);
          break;
        case 'boss-spawned':
          this.setBanner(event.name, '#ff6b6b');
          break;
        case 'wave-started':
          this.setBanner(event.final ? `Final Wave` : `Wave ${event.wave}`, event.final ? '#ff9f45' : '#f2e3b3');
          break;
        case 'game-won':
          this.setBanner('Victory!', '#ffd700');
          this.scheduleFireworks();
          break;
        case 'game-lost':
          this.setBanner('Defeat!', '#e25555');
          break;
      }
    }
  }

  // Continuous effects driven by live game state rather than events:
  // footstep dust under walkers and trails behind projectiles.
  ambient(game, dt) {
    this.dustTimer -= dt;
    if (this.dustTimer <= 0) {
      this.dustTimer = 0.09;
      for (const enemy of game.enemies) {
        if (!enemy.alive || Math.random() > 0.4) continue;
        const pos = game.path.positionAt(enemy.dist);
        this.addGroundParticle({
          x: pos.x + rand(-4, 4),
          y: pos.y + enemy.radius * 0.6,
          vx: rand(-8, 8),
          vy: rand(-14, -4),
          life: rand(0.3, 0.55),
          size: rand(1.5, 3),
          color: '#b8a67e',
          shape: 'smoke',
        });
      }
    }
    for (const enemy of game.enemies) {
      if (!enemy.alive) continue;
      if (enemy.burn && Math.random() < dt * 14) {
        const pos = game.path.positionAt(enemy.dist);
        this.addParticle({
          x: pos.x + rand(-enemy.radius * 0.6, enemy.radius * 0.6),
          y: pos.y - enemy.radius * 0.5,
          vx: rand(-10, 10),
          vy: rand(-55, -25),
          life: rand(0.3, 0.55),
          size: rand(1.5, 3),
          color: Math.random() < 0.5 ? '#ff9f45' : '#ffd97a',
        });
      }
      if (enemy.slow && Math.random() < dt * 8) {
        const pos = game.path.positionAt(enemy.dist);
        this.addParticle({
          x: pos.x + rand(-enemy.radius, enemy.radius),
          y: pos.y + rand(-enemy.radius, enemy.radius),
          vx: rand(-6, 6),
          vy: rand(-12, -2),
          life: rand(0.4, 0.7),
          size: rand(1, 2),
          color: '#dff3ff',
        });
      }
    }
    game.towers.forEach((tower, i) => {
      if (!tower || !tower.beamTargetId) return;
      const target = game.enemies.find((e) => e.id === tower.beamTargetId && e.alive);
      if (!target || Math.random() > dt * 30) return;
      const pos = game.path.positionAt(target.dist);
      const angle = rand(0, Math.PI * 2);
      this.addParticle({
        x: pos.x,
        y: pos.y,
        vx: Math.cos(angle) * rand(30, 90),
        vy: Math.sin(angle) * rand(30, 90) - 20,
        life: rand(0.15, 0.3),
        size: rand(1, 2.2),
        color: Math.random() < 0.5 ? '#ff4fd8' : '#ffffff',
      });
    });
    for (const proj of game.projectiles) {
      if (proj.towerType === 'frost' && Math.random() < dt * 30) {
        this.addParticle({
          x: proj.x + rand(-2, 2),
          y: proj.y + rand(-2, 2),
          vx: rand(-8, 8),
          vy: rand(-8, 8),
          life: rand(0.2, 0.35),
          size: rand(1, 2),
          color: '#dff3ff',
        });
      } else if (proj.towerType === 'mage' && Math.random() < dt * 40) {
        this.addParticle({
          x: proj.x + rand(-2, 2),
          y: proj.y + rand(-2, 2),
          vx: rand(-12, 12),
          vy: rand(-12, 12),
          life: rand(0.2, 0.35),
          size: rand(1, 2.2),
          color: Math.random() < 0.5 ? '#b9a7ff' : '#e6dcff',
        });
      } else if (proj.towerType === 'cannon' && Math.random() < dt * 25) {
        this.addParticle({
          x: proj.x,
          y: proj.y,
          vx: rand(-6, 6),
          vy: rand(-14, -4),
          life: rand(0.25, 0.45),
          size: rand(1.5, 3),
          color: '#8d949b',
          shape: 'smoke',
        });
      }
    }
  }

  spawnMuzzle(event) {
    if (event.towerType === 'cannon') {
      // Flash and smoke out of the barrel.
      for (let i = 0; i < 8; i++) {
        const spread = event.angle + rand(-0.45, 0.45);
        this.addParticle({
          x: event.x + Math.cos(event.angle) * 14,
          y: event.y - 10 + Math.sin(event.angle) * 14,
          vx: Math.cos(spread) * rand(50, 130),
          vy: Math.sin(spread) * rand(50, 130),
          life: rand(0.15, 0.3),
          size: rand(2, 4.5),
          color: i < 4 ? '#ffd97a' : '#9aa0a6',
          shape: i < 4 ? 'dot' : 'smoke',
        });
      }
    } else if (event.towerType === 'mage') {
      for (let i = 0; i < 5; i++) {
        this.addParticle({
          x: event.x,
          y: event.y - 26,
          vx: rand(-35, 35),
          vy: rand(-35, 35),
          life: rand(0.2, 0.4),
          size: rand(1.5, 3),
          color: '#b9a7ff',
        });
      }
    } else if (event.towerType === 'flame') {
      // A burst of fire along the nozzle direction.
      for (let i = 0; i < 4; i++) {
        const spread = event.angle + rand(-0.3, 0.3);
        const speed = rand(110, 180);
        this.addParticle({
          x: event.x + Math.cos(event.angle) * 16,
          y: event.y - 8 + Math.sin(event.angle) * 16,
          vx: Math.cos(spread) * speed,
          vy: Math.sin(spread) * speed,
          life: rand(0.18, 0.32),
          size: rand(3, 5.5),
          color: ['#ffd97a', '#ff9f45', '#ff6b35', '#ffe8b0'][i % 4],
          shape: 'smoke',
        });
      }
    } else if (event.towerType === 'tesla' || event.towerType === 'laser') {
      // Handled by the bolt / beam visuals.
    } else {
      // A tiny puff of dust off the bowstring.
      this.addParticle({
        x: event.x,
        y: event.y - 20,
        vx: Math.cos(event.angle) * 30,
        vy: Math.sin(event.angle) * 30,
        life: 0.15,
        size: 1.6,
        color: '#e8e2d4',
      });
    }
  }

  spawnImpact(event) {
    if (event.towerType === 'cannon') {
      // Explosion: fireball debris, rising smoke, shockwave ring, scorch mark.
      for (let i = 0; i < 18; i++) {
        const angle = rand(0, Math.PI * 2);
        const speed = rand(50, 190);
        this.addParticle({
          x: event.x,
          y: event.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: rand(0.3, 0.65),
          size: rand(2, 5),
          color: ['#ffd97a', '#ff9f45', '#ff6b35', '#ffe8b0'][i % 4],
          gravity: 170,
        });
      }
      for (let i = 0; i < 6; i++) {
        this.addParticle({
          x: event.x + rand(-9, 9),
          y: event.y + rand(-9, 9),
          vx: rand(-18, 18),
          vy: rand(-50, -18),
          life: rand(0.5, 1.0),
          size: rand(5, 10),
          color: '#7d848a',
          shape: 'smoke',
        });
      }
      this.addParticle({
        x: event.x,
        y: event.y,
        vx: 0,
        vy: 0,
        life: 0.35,
        size: Math.max(20, event.splash),
        color: '#ffb347',
        shape: 'ring',
      });
      this.addGroundParticle({
        x: event.x,
        y: event.y,
        vx: 0,
        vy: 0,
        life: 4,
        size: rand(10, 14),
        color: 'rgba(40,32,22,0.55)',
        shape: 'scorch',
      });
    } else if (event.towerType === 'frost') {
      for (let i = 0; i < 7; i++) {
        const angle = rand(0, Math.PI * 2);
        const speed = rand(30, 90);
        this.addParticle({
          x: event.x,
          y: event.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: rand(0.25, 0.45),
          size: rand(1.5, 3),
          color: i % 2 ? '#8fd3ff' : '#ffffff',
          gravity: 90,
        });
      }
      this.addParticle({ x: event.x, y: event.y, vx: 0, vy: 0, life: 0.25, size: 14, color: '#bfe9ff', shape: 'ring' });
    } else if (event.towerType === 'flame') {
      for (let i = 0; i < 2; i++) {
        this.addParticle({
          x: event.x + rand(-4, 4),
          y: event.y + rand(-4, 4),
          vx: rand(-20, 20),
          vy: rand(-50, -20),
          life: rand(0.2, 0.4),
          size: rand(1.5, 2.5),
          color: '#ffd97a',
        });
      }
    } else if (event.towerType === 'mage') {
      for (let i = 0; i < 10; i++) {
        const angle = rand(0, Math.PI * 2);
        const speed = rand(30, 100);
        this.addParticle({
          x: event.x,
          y: event.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: rand(0.25, 0.5),
          size: rand(1.5, 3.5),
          color: i % 2 ? '#8f7bff' : '#e6dcff',
        });
      }
      this.addParticle({
        x: event.x,
        y: event.y,
        vx: 0,
        vy: 0,
        life: 0.2,
        size: 12,
        color: '#b9a7ff',
        shape: 'ring',
      });
    } else {
      for (let i = 0; i < 4; i++) {
        this.addParticle({
          x: event.x,
          y: event.y,
          vx: rand(-50, 50),
          vy: rand(-50, 10),
          life: rand(0.15, 0.3),
          size: rand(1.5, 2.5),
          color: i % 2 ? '#e8e2d4' : '#c9a86a',
          gravity: 120,
        });
      }
    }
  }

  spawnLightning(event) {
    this.bolts.push({ points: event.points, life: 0.18, maxLife: 0.18 });
    for (const p of event.points.slice(1)) {
      for (let i = 0; i < 5; i++) {
        const angle = rand(0, Math.PI * 2);
        const speed = rand(40, 110);
        this.addParticle({
          x: p.x,
          y: p.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: rand(0.15, 0.3),
          size: rand(1, 2.2),
          color: i % 2 ? '#dff3ff' : '#7ec8ff',
        });
      }
    }
  }

  spawnDeath(event) {
    const color = this.enemyTypes[event.enemyType]?.color ?? '#888';
    for (let i = 0; i < 10; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(25, 95);
      this.addParticle({
        x: event.x,
        y: event.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 35,
        life: rand(0.3, 0.6),
        size: rand(2, 4),
        color: i % 3 === 0 ? '#ddd6c5' : color,
        gravity: 130,
      });
    }
    // A coin that pops up and falls with the bounty text.
    this.addParticle({
      x: event.x,
      y: event.y,
      vx: rand(-15, 15),
      vy: -90,
      life: 0.6,
      size: 3,
      color: '#ffd700',
      gravity: 260,
    });
    this.addText(event.x, event.y - 12, `+${event.bounty}g`, '#ffd700');
  }

  spawnEmerge(event) {
    // Dust kicked up as an enemy steps out of the cave.
    for (let i = 0; i < 4; i++) {
      this.addParticle({
        x: event.x + rand(-6, 10),
        y: event.y + rand(-6, 6),
        vx: rand(5, 30),
        vy: rand(-18, -4),
        life: rand(0.3, 0.5),
        size: rand(2, 4),
        color: '#b8a67e',
        shape: 'smoke',
      });
    }
  }

  spawnLeak(event) {
    this.addText(event.x, event.y, '-1 life', '#e25555');
    this.addParticle({
      x: event.x,
      y: event.y,
      vx: 0,
      vy: 0,
      life: 0.4,
      size: 22,
      color: '#e25555',
      shape: 'ring',
    });
  }

  spawnConstruction(event) {
    // Dust and stone chips around a freshly built tower.
    for (let i = 0; i < 10; i++) {
      const angle = rand(0, Math.PI * 2);
      this.addParticle({
        x: event.x + Math.cos(angle) * rand(4, 14),
        y: event.y + Math.sin(angle) * rand(2, 8),
        vx: Math.cos(angle) * rand(20, 60),
        vy: rand(-70, -20),
        life: rand(0.3, 0.6),
        size: rand(2, 4),
        color: i % 3 === 0 ? '#9aa1a8' : '#c2b391',
        gravity: 220,
        shape: i % 2 ? 'dot' : 'smoke',
      });
    }
  }

  spawnSale(event) {
    for (let i = 0; i < 6; i++) {
      this.addParticle({
        x: event.x + rand(-8, 8),
        y: event.y + rand(-10, 0),
        vx: rand(-20, 20),
        vy: rand(-80, -40),
        life: rand(0.4, 0.6),
        size: rand(2, 3),
        color: '#ffd700',
        gravity: 200,
      });
    }
    this.addText(event.x, event.y - 16, `+${event.refund}g`, '#ffd700');
  }

  spawnUpgrade(event) {
    // A golden ring and rising sparks as the tower is rebuilt bigger.
    this.addParticle({ x: event.x, y: event.y - 8, vx: 0, vy: 0, life: 0.45, size: 26, color: '#ffd700', shape: 'ring' });
    for (let i = 0; i < 12; i++) {
      const angle = rand(0, Math.PI * 2);
      this.addParticle({
        x: event.x + Math.cos(angle) * rand(2, 12),
        y: event.y + Math.sin(angle) * rand(1, 6),
        vx: rand(-15, 15),
        vy: rand(-110, -50),
        life: rand(0.4, 0.8),
        size: rand(1.5, 3),
        color: i % 3 === 0 ? '#ffffff' : '#ffd700',
        gravity: 80,
      });
    }
    this.addText(event.x, event.y - 30, `Level ${event.level}`, '#ffd700');
  }

  scheduleFireworks() {
    // A short celebratory volley across the upper half of the map.
    for (let i = 0; i < 6; i++) {
      this.scheduled.push({
        delay: 0.3 + i * 0.45,
        x: rand(120, 680),
        y: rand(60, 220),
        kind: 'firework',
      });
    }
  }

  spawnFirework(x, y) {
    const hue = ['#ffd700', '#7bd47b', '#7badff', '#ff8fb3', '#c9a1ff'][Math.floor(rand(0, 5))];
    for (let i = 0; i < 22; i++) {
      const angle = (i / 22) * Math.PI * 2;
      const speed = rand(60, 120);
      this.addParticle({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: rand(0.5, 0.9),
        size: rand(1.5, 3),
        color: i % 4 === 0 ? '#ffffff' : hue,
        gravity: 60,
      });
    }
  }

  addParticle({ x, y, vx, vy, life, size, color, shape = 'dot', gravity = 0 }) {
    this.particles.push({ x, y, vx, vy, life, maxLife: life, size, color, shape, gravity });
  }

  addGroundParticle({ x, y, vx, vy, life, size, color, shape = 'dot', gravity = 0 }) {
    this.groundParticles.push({ x, y, vx, vy, life, maxLife: life, size, color, shape, gravity });
  }

  addText(x, y, text, color) {
    this.texts.push({ x, y, text, color, life: 0.9, maxLife: 0.9 });
  }

  setBanner(text, color) {
    this.banner = { text, color, life: 2.0, maxLife: 2.0 };
  }

  update(dt) {
    for (const list of [this.particles, this.groundParticles]) {
      for (const p of list) {
        p.life -= dt;
        p.vy += p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
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
      if (s.delay <= 0 && s.kind === 'firework') this.spawnFirework(s.x, s.y);
    }
    this.scheduled = this.scheduled.filter((s) => s.delay > 0);
  }
}
