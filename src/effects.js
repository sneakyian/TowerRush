// Visual effects state: particles, floating texts, and banners.
// No DOM or canvas access — the renderer draws this, tests drive it headless.

import { ENEMY_TYPES } from './config.js';

function rand(min, max) {
  return min + Math.random() * (max - min);
}

export class Effects {
  constructor({ enemyTypes = ENEMY_TYPES } = {}) {
    this.enemyTypes = enemyTypes;
    this.particles = []; // {x,y,vx,vy,life,maxLife,size,color,shape,gravity}
    this.texts = [];     // {x,y,text,color,life,maxLife}
    this.banner = null;  // {text,color,life,maxLife}
  }

  clear() {
    this.particles = [];
    this.texts = [];
    this.banner = null;
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
        case 'enemy-died':
          this.spawnDeath(event);
          break;
        case 'enemy-leaked':
          this.addText(event.x, event.y, '-1 life', '#e25555');
          break;
        case 'wave-started':
          this.setBanner(`Wave ${event.wave}`, '#f2e3b3');
          break;
        case 'game-won':
          this.setBanner('Victory!', '#ffd700');
          break;
        case 'game-lost':
          this.setBanner('Defeat!', '#e25555');
          break;
      }
    }
  }

  spawnMuzzle(event) {
    if (event.towerType === 'cannon') {
      // Flash and smoke out of the barrel.
      for (let i = 0; i < 6; i++) {
        const spread = event.angle + rand(-0.4, 0.4);
        this.addParticle({
          x: event.x + Math.cos(event.angle) * 14,
          y: event.y - 10 + Math.sin(event.angle) * 14,
          vx: Math.cos(spread) * rand(40, 110),
          vy: Math.sin(spread) * rand(40, 110),
          life: rand(0.15, 0.3),
          size: rand(2, 4),
          color: i < 3 ? '#ffd97a' : '#9aa0a6',
        });
      }
    } else if (event.towerType === 'mage') {
      for (let i = 0; i < 4; i++) {
        this.addParticle({
          x: event.x,
          y: event.y - 26,
          vx: rand(-30, 30),
          vy: rand(-30, 30),
          life: rand(0.2, 0.4),
          size: rand(1.5, 3),
          color: '#b9a7ff',
        });
      }
    }
  }

  spawnImpact(event) {
    if (event.towerType === 'cannon') {
      // Explosion: fireball debris, rising smoke, and a shockwave ring.
      for (let i = 0; i < 14; i++) {
        const angle = rand(0, Math.PI * 2);
        const speed = rand(50, 170);
        this.addParticle({
          x: event.x,
          y: event.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: rand(0.3, 0.6),
          size: rand(2, 5),
          color: ['#ffd97a', '#ff9f45', '#ff6b35'][i % 3],
          gravity: 160,
        });
      }
      for (let i = 0; i < 5; i++) {
        this.addParticle({
          x: event.x + rand(-8, 8),
          y: event.y + rand(-8, 8),
          vx: rand(-15, 15),
          vy: rand(-45, -15),
          life: rand(0.5, 0.9),
          size: rand(5, 9),
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
    } else if (event.towerType === 'mage') {
      for (let i = 0; i < 8; i++) {
        const angle = rand(0, Math.PI * 2);
        const speed = rand(30, 90);
        this.addParticle({
          x: event.x,
          y: event.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: rand(0.25, 0.45),
          size: rand(1.5, 3.5),
          color: i % 2 ? '#8f7bff' : '#e6dcff',
        });
      }
    } else {
      for (let i = 0; i < 3; i++) {
        this.addParticle({
          x: event.x,
          y: event.y,
          vx: rand(-40, 40),
          vy: rand(-40, 40),
          life: rand(0.15, 0.25),
          size: rand(1.5, 2.5),
          color: '#e8e2d4',
        });
      }
    }
  }

  spawnDeath(event) {
    const color = this.enemyTypes[event.enemyType]?.color ?? '#888';
    for (let i = 0; i < 8; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(25, 85);
      this.addParticle({
        x: event.x,
        y: event.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,
        life: rand(0.3, 0.55),
        size: rand(2, 4),
        color: i % 3 === 0 ? '#ddd6c5' : color,
        gravity: 120,
      });
    }
    this.addText(event.x, event.y - 12, `+${event.bounty}g`, '#ffd700');
  }

  addParticle({ x, y, vx, vy, life, size, color, shape = 'dot', gravity = 0 }) {
    this.particles.push({ x, y, vx, vy, life, maxLife: life, size, color, shape, gravity });
  }

  addText(x, y, text, color) {
    this.texts.push({ x, y, text, color, life: 0.9, maxLife: 0.9 });
  }

  setBanner(text, color) {
    this.banner = { text, color, life: 2.0, maxLife: 2.0 };
  }

  update(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    for (const t of this.texts) {
      t.life -= dt;
      t.y -= 28 * dt;
    }
    this.texts = this.texts.filter((t) => t.life > 0);

    if (this.banner) {
      this.banner.life -= dt;
      if (this.banner.life <= 0) this.banner = null;
    }
  }
}
