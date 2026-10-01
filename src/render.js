// Canvas rendering. Pure drawing — reads game/effects state, never mutates it.
// The static terrain (grass, path, castle, decorations) is prerendered once
// per level onto an offscreen canvas so each frame only draws moving things.

let terrainCache = null; // { level, canvas }

// Small deterministic PRNG so decorations stay put between frames and loads.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function render(ctx, game, effects, ui, time) {
  const { level } = game;
  ctx.clearRect(0, 0, level.width, level.height);
  ctx.drawImage(getTerrain(game), 0, 0);

  drawBuildSpots(ctx, game, ui, time);
  drawTowers(ctx, game, ui, time);
  drawEnemies(ctx, game);
  drawProjectiles(ctx, game);
  drawParticles(ctx, effects);
  drawTexts(ctx, effects);
  drawBanner(ctx, effects, level);
}

// --- Static terrain layer -----------------------------------------------

function getTerrain(game) {
  if (terrainCache && terrainCache.level === game.level) return terrainCache.canvas;
  const { level } = game;
  const canvas = document.createElement('canvas');
  canvas.width = level.width;
  canvas.height = level.height;
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(42);

  // Grass with soft mottling.
  const sky = ctx.createLinearGradient(0, 0, 0, level.height);
  sky.addColorStop(0, '#74a855');
  sky.addColorStop(1, '#5f9448');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, level.width, level.height);
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = rng() > 0.5 ? 'rgba(255,255,230,0.05)' : 'rgba(30,60,20,0.06)';
    ctx.beginPath();
    ctx.ellipse(rng() * level.width, rng() * level.height, 15 + rng() * 45, 8 + rng() * 22, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // Path: dark edge, dirt fill, worn center line.
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  tracePath(ctx, level.path);
  ctx.strokeStyle = '#8a7347';
  ctx.lineWidth = 34;
  ctx.stroke();
  tracePath(ctx, level.path);
  ctx.strokeStyle = '#c9b178';
  ctx.lineWidth = 28;
  ctx.stroke();
  ctx.save();
  ctx.setLineDash([2, 14]);
  tracePath(ctx, level.path);
  ctx.strokeStyle = 'rgba(138,115,71,0.5)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  drawCave(ctx, level);
  drawCastle(ctx, level);
  drawDecorations(ctx, game, rng);

  terrainCache = { level, canvas };
  return canvas;
}

function tracePath(ctx, waypoints) {
  ctx.beginPath();
  waypoints.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
}

function drawCave(ctx, level) {
  const p = level.path[0];
  const x = Math.max(16, Math.min(level.width - 16, p.x));
  ctx.fillStyle = '#4a4238';
  ctx.beginPath();
  ctx.arc(x, p.y, 24, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#17120d';
  ctx.beginPath();
  ctx.arc(x, p.y, 16, Math.PI, 0);
  ctx.fill();
}

function drawCastle(ctx, level) {
  const p = level.path[level.path.length - 1];
  const x = Math.max(30, Math.min(level.width - 30, p.x));
  const y = p.y;
  ctx.fillStyle = '#9aa1a8';
  ctx.fillRect(x - 26, y - 34, 52, 44);
  ctx.fillStyle = '#7d848c';
  for (let i = 0; i < 4; i++) ctx.fillRect(x - 26 + i * 14, y - 42, 9, 10); // crenellations
  ctx.fillStyle = '#5b4632';
  ctx.beginPath(); // gate
  ctx.arc(x, y + 10, 11, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(x - 11, y + 10, 22, 1);
  ctx.strokeStyle = '#6b7178'; // flag pole
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 20, y - 42);
  ctx.lineTo(x + 20, y - 58);
  ctx.stroke();
  ctx.fillStyle = '#c33c3c';
  ctx.beginPath();
  ctx.moveTo(x + 20, y - 58);
  ctx.lineTo(x + 34, y - 53);
  ctx.lineTo(x + 20, y - 48);
  ctx.fill();
}

function drawDecorations(ctx, game, rng) {
  const { level } = game;
  const placed = [];
  let attempts = 0;
  while (placed.length < 22 && attempts++ < 300) {
    const x = 14 + rng() * (level.width - 28);
    const y = 14 + rng() * (level.height - 28);
    if (distToPath(game, x, y) < 34) continue;
    if (level.buildSpots.some((s) => Math.hypot(s.x - x, s.y - y) < 32)) continue;
    if (placed.some((d) => Math.hypot(d.x - x, d.y - y) < 26)) continue;
    placed.push({ x, y, kind: rng() });
  }
  for (const d of placed) {
    if (d.kind < 0.4) drawTree(ctx, d.x, d.y);
    else if (d.kind < 0.7) drawBush(ctx, d.x, d.y);
    else if (d.kind < 0.88) drawRock(ctx, d.x, d.y);
    else drawFlowers(ctx, d.x, d.y, rng);
  }
}

function distToPath(game, x, y) {
  let min = Infinity;
  for (let d = 0; d <= game.path.totalLength; d += 8) {
    const p = game.path.positionAt(d);
    min = Math.min(min, Math.hypot(p.x - x, p.y - y));
  }
  return min;
}

function drawTree(ctx, x, y) {
  ctx.fillStyle = 'rgba(20,40,15,0.2)';
  ctx.beginPath();
  ctx.ellipse(x, y + 10, 10, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(x - 2, y, 4, 10);
  ctx.fillStyle = '#3f7a35';
  ctx.beginPath();
  ctx.moveTo(x, y - 22);
  ctx.lineTo(x + 10, y + 2);
  ctx.lineTo(x - 10, y + 2);
  ctx.fill();
  ctx.fillStyle = '#4c8c40';
  ctx.beginPath();
  ctx.moveTo(x, y - 14);
  ctx.lineTo(x + 8, y + 4);
  ctx.lineTo(x - 8, y + 4);
  ctx.fill();
}

function drawBush(ctx, x, y) {
  ctx.fillStyle = '#4c8c40';
  ctx.beginPath();
  ctx.arc(x - 4, y, 5, 0, Math.PI * 2);
  ctx.arc(x + 3, y - 1, 6, 0, Math.PI * 2);
  ctx.arc(x, y + 3, 5, 0, Math.PI * 2);
  ctx.fill();
}

function drawRock(ctx, x, y) {
  ctx.fillStyle = '#8f9296';
  ctx.beginPath();
  ctx.moveTo(x - 7, y + 4);
  ctx.lineTo(x - 4, y - 4);
  ctx.lineTo(x + 3, y - 5);
  ctx.lineTo(x + 7, y + 2);
  ctx.lineTo(x + 4, y + 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#a8abaf';
  ctx.beginPath();
  ctx.moveTo(x - 4, y - 4);
  ctx.lineTo(x + 3, y - 5);
  ctx.lineTo(x + 2, y);
  ctx.closePath();
  ctx.fill();
}

function drawFlowers(ctx, x, y, rng) {
  for (let i = 0; i < 3; i++) {
    const fx = x + (rng() - 0.5) * 14;
    const fy = y + (rng() - 0.5) * 10;
    ctx.fillStyle = ['#e8e26e', '#e2918f', '#e8e8e8'][i % 3];
    ctx.beginPath();
    ctx.arc(fx, fy, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// --- Dynamic layers -------------------------------------------------------

function drawBuildSpots(ctx, game, ui, time) {
  for (let i = 0; i < game.level.buildSpots.length; i++) {
    if (game.towers[i]) continue;
    const spot = game.level.buildSpots[i];
    const selected = i === ui.selectedSpot;
    const pulse = selected ? 2 + Math.sin(time * 5) * 1.5 : 0;

    ctx.fillStyle = 'rgba(20,40,15,0.18)';
    ctx.beginPath();
    ctx.ellipse(spot.x, spot.y + 3, 15, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = selected ? '#ece0b4' : '#c5b588';
    ctx.strokeStyle = '#857450';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(spot.x, spot.y, 13 + pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(133,116,80,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath(); // "+" hint
    ctx.moveTo(spot.x - 5, spot.y);
    ctx.lineTo(spot.x + 5, spot.y);
    ctx.moveTo(spot.x, spot.y - 5);
    ctx.lineTo(spot.x, spot.y + 5);
    ctx.stroke();
  }
}

function drawTowers(ctx, game, ui, time) {
  for (let i = 0; i < game.towers.length; i++) {
    const tower = game.towers[i];
    if (!tower) continue;
    const spot = game.level.buildSpots[i];
    const type = game.towerTypes[tower.typeId];
    if (i === ui.selectedSpot) drawRange(ctx, spot, type.range);

    // Stone base shared by all towers.
    ctx.fillStyle = 'rgba(20,40,15,0.2)';
    ctx.beginPath();
    ctx.ellipse(spot.x, spot.y + 6, 17, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9aa1a8';
    ctx.strokeStyle = '#6b7178';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(spot.x, spot.y + 2, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (tower.typeId === 'archer') drawArcherTower(ctx, spot);
    else if (tower.typeId === 'mage') drawMageTower(ctx, spot, time);
    else drawCannonTower(ctx, spot, tower.angle ?? 0);
  }
}

function drawArcherTower(ctx, spot) {
  ctx.fillStyle = '#8d6e3a';
  ctx.strokeStyle = '#5f4a26';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); // tapered wooden body
  ctx.moveTo(spot.x - 10, spot.y + 4);
  ctx.lineTo(spot.x - 7, spot.y - 18);
  ctx.lineTo(spot.x + 7, spot.y - 18);
  ctx.lineTo(spot.x + 10, spot.y + 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath(); // plank lines
  ctx.moveTo(spot.x - 8, spot.y - 4);
  ctx.lineTo(spot.x + 8, spot.y - 4);
  ctx.moveTo(spot.x - 7.5, spot.y - 11);
  ctx.lineTo(spot.x + 7.5, spot.y - 11);
  ctx.stroke();
  ctx.fillStyle = '#b5443c';
  ctx.beginPath(); // roof
  ctx.moveTo(spot.x - 11, spot.y - 17);
  ctx.lineTo(spot.x, spot.y - 28);
  ctx.lineTo(spot.x + 11, spot.y - 17);
  ctx.closePath();
  ctx.fill();
}

function drawMageTower(ctx, spot, time) {
  ctx.fillStyle = '#5a4fcf';
  ctx.strokeStyle = '#3a3390';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); // spire
  ctx.moveTo(spot.x - 9, spot.y + 4);
  ctx.lineTo(spot.x - 5, spot.y - 20);
  ctx.lineTo(spot.x + 5, spot.y - 20);
  ctx.lineTo(spot.x + 9, spot.y + 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const bob = Math.sin(time * 3) * 2;
  const oy = spot.y - 26 + bob;
  ctx.fillStyle = 'rgba(143,123,255,0.35)'; // orb glow
  ctx.beginPath();
  ctx.arc(spot.x, oy, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c9bfff';
  ctx.beginPath();
  ctx.arc(spot.x, oy, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawCannonTower(ctx, spot, angle) {
  const cy = spot.y - 10;
  ctx.strokeStyle = '#2f3338'; // barrel aims at the last target
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(spot.x, cy);
  ctx.lineTo(spot.x + Math.cos(angle) * 15, cy + Math.sin(angle) * 15);
  ctx.stroke();
  ctx.fillStyle = '#555b61';
  ctx.strokeStyle = '#33373c';
  ctx.lineWidth = 2;
  ctx.beginPath(); // turret dome
  ctx.arc(spot.x, cy, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#6d747b';
  ctx.beginPath();
  ctx.arc(spot.x - 3, cy - 3, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawEnemies(ctx, game) {
  const sorted = [...game.enemies].sort((a, b) => {
    return game.path.positionAt(a.dist).y - game.path.positionAt(b.dist).y;
  });
  for (const enemy of sorted) {
    const pos = game.path.positionAt(enemy.dist);
    const ahead = game.path.positionAt(enemy.dist + 2);
    const facing = ahead.x >= pos.x ? 1 : -1;
    const bob = Math.abs(Math.sin(enemy.dist * 0.15)) * 2.5;
    const x = pos.x;
    const y = pos.y - bob;
    const r = enemy.radius;
    const type = game.enemyTypes[enemy.typeId];

    ctx.fillStyle = 'rgba(20,40,15,0.25)';
    ctx.beginPath();
    ctx.ellipse(x, pos.y + r * 0.7, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = type.color;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (enemy.typeId === 'goblin') {
      ctx.fillStyle = type.color; // pointy ears
      ctx.beginPath();
      ctx.moveTo(x - r * 0.8, y - r * 0.4);
      ctx.lineTo(x - r * 1.5, y - r * 1.1);
      ctx.lineTo(x - r * 0.3, y - r * 0.9);
      ctx.moveTo(x + r * 0.8, y - r * 0.4);
      ctx.lineTo(x + r * 1.5, y - r * 1.1);
      ctx.lineTo(x + r * 0.3, y - r * 0.9);
      ctx.fill();
    } else if (enemy.typeId === 'wolf') {
      ctx.fillStyle = type.color; // upright ears
      ctx.beginPath();
      ctx.moveTo(x - r * 0.6, y - r * 0.6);
      ctx.lineTo(x - r * 0.4, y - r * 1.5);
      ctx.lineTo(x, y - r * 0.8);
      ctx.moveTo(x + r * 0.6, y - r * 0.6);
      ctx.lineTo(x + r * 0.4, y - r * 1.5);
      ctx.lineTo(x, y - r * 0.8);
      ctx.fill();
    } else if (enemy.typeId === 'orc') {
      ctx.fillStyle = '#e8e2d4'; // tusks
      ctx.beginPath();
      ctx.moveTo(x - r * 0.45 * facing, y + r * 0.5);
      ctx.lineTo(x - r * 0.6 * facing, y - r * 0.05);
      ctx.lineTo(x - r * 0.2 * facing, y + r * 0.3);
      ctx.fill();
    }

    // Eyes face the walking direction.
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x + r * 0.35 * facing, y - r * 0.2, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1c1c1c';
    ctx.beginPath();
    ctx.arc(x + r * 0.45 * facing, y - r * 0.2, r * 0.14, 0, Math.PI * 2);
    ctx.fill();

    // Health bar (only once hurt).
    if (enemy.hp < enemy.maxHp) {
      const w = 22;
      const frac = Math.max(0, enemy.hp / enemy.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - w / 2 - 1, y - r - 10, w + 2, 5);
      ctx.fillStyle = frac > 0.5 ? '#6fd64a' : frac > 0.25 ? '#e8c33a' : '#d64545';
      ctx.fillRect(x - w / 2, y - r - 9, w * frac, 3);
    }
  }
}

function drawProjectiles(ctx, game) {
  for (const proj of game.projectiles) {
    if (proj.towerType === 'archer') {
      const len = 10;
      ctx.strokeStyle = '#4a3a22';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(proj.x - proj.dirX * len, proj.y - proj.dirY * len);
      ctx.lineTo(proj.x, proj.y);
      ctx.stroke();
      ctx.fillStyle = '#e8e2d4'; // arrowhead
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    } else if (proj.towerType === 'mage') {
      ctx.strokeStyle = 'rgba(143,123,255,0.5)'; // trail
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(proj.prevX, proj.prevY);
      ctx.lineTo(proj.x, proj.y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(143,123,255,0.35)';
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e6dcff';
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#2f3338';
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#596067';
      ctx.beginPath();
      ctx.arc(proj.x - 1.3, proj.y - 1.3, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawParticles(ctx, effects) {
  for (const p of effects.particles) {
    const frac = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = frac;
    if (p.shape === 'ring') {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 3 * frac;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 - frac) + 6, 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.shape === 'smoke') {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1.6 - frac * 0.6), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * frac, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawTexts(ctx, effects) {
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  for (const t of effects.texts) {
    ctx.globalAlpha = Math.max(0, t.life / t.maxLife);
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 3;
    ctx.strokeText(t.text, t.x, t.y);
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
}

function drawBanner(ctx, effects, level) {
  const banner = effects.banner;
  if (!banner) return;
  const age = banner.maxLife - banner.life;
  const alpha = Math.min(1, age * 4, banner.life * 2);
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.font = 'bold 42px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 6;
  ctx.strokeText(banner.text, level.width / 2, level.height / 2 - 40);
  ctx.fillStyle = banner.color;
  ctx.fillText(banner.text, level.width / 2, level.height / 2 - 40);
  ctx.globalAlpha = 1;
}

function drawRange(ctx, spot, range) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(spot.x, spot.y, range, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
