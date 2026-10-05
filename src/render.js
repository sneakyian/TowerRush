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

  drawParticleList(ctx, effects.groundParticles); // scorch and dust, under everything
  drawBuildSpots(ctx, game, ui, time);
  drawTowers(ctx, game, ui, time);
  drawEnemies(ctx, game);
  drawProjectiles(ctx, game);
  drawParticleList(ctx, effects.particles);
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

    // Shared stone platform: shadow, ring of pavers, top slab.
    ctx.fillStyle = 'rgba(20,40,15,0.2)';
    ctx.beginPath();
    ctx.ellipse(spot.x, spot.y + 6, 18, 7.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#878e95';
    ctx.strokeStyle = '#60666c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(spot.x, spot.y + 2, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(96,102,108,0.6)'; // paver joints
    ctx.lineWidth = 1;
    for (let a = 0; a < 6; a++) {
      const angle = (a / 6) * Math.PI * 2 + 0.3;
      ctx.beginPath();
      ctx.moveTo(spot.x + Math.cos(angle) * 9, spot.y + 2 + Math.sin(angle) * 9);
      ctx.lineTo(spot.x + Math.cos(angle) * 15, spot.y + 2 + Math.sin(angle) * 15);
      ctx.stroke();
    }
    ctx.fillStyle = '#a4abb2';
    ctx.beginPath();
    ctx.arc(spot.x, spot.y + 1, 9, 0, Math.PI * 2);
    ctx.fill();

    // Fire-flash: towers glow briefly at the moment they shoot.
    const justFired = tower.cooldown > type.fireInterval - 0.12;

    if (tower.typeId === 'archer') drawArcherTower(ctx, spot, time, justFired);
    else if (tower.typeId === 'mage') drawMageTower(ctx, spot, time, justFired);
    else drawCannonTower(ctx, spot, tower.angle ?? 0, tower.cooldown / type.fireInterval);
  }
}

function drawArcherTower(ctx, spot, time, justFired) {
  const x = spot.x;
  const y = spot.y;
  // Stilt legs.
  ctx.strokeStyle = '#5f4a26';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x - 8, y + 3);
  ctx.lineTo(x - 6, y - 10);
  ctx.moveTo(x + 8, y + 3);
  ctx.lineTo(x + 6, y - 10);
  ctx.moveTo(x - 7, y - 3);
  ctx.lineTo(x + 7, y - 3); // crossbeam
  ctx.stroke();
  // Platform with planks.
  ctx.fillStyle = '#8d6e3a';
  ctx.strokeStyle = '#5f4a26';
  ctx.lineWidth = 1.5;
  ctx.fillRect(x - 11, y - 14, 22, 5);
  ctx.strokeRect(x - 11, y - 14, 22, 5);
  // Railing posts.
  ctx.beginPath();
  for (const px of [-10, -5, 0, 5, 10]) {
    ctx.moveTo(x + px, y - 14);
    ctx.lineTo(x + px, y - 19);
  }
  ctx.moveTo(x - 10, y - 18);
  ctx.lineTo(x + 10, y - 18);
  ctx.stroke();
  // Archer silhouette with bow.
  ctx.fillStyle = '#4a3a22';
  ctx.beginPath();
  ctx.arc(x - 1, y - 21, 2.8, 0, Math.PI * 2); // head
  ctx.fill();
  ctx.fillRect(x - 3, y - 19, 4.5, 5); // torso
  ctx.strokeStyle = justFired ? '#f5e6c4' : '#d9c9a3';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); // bow arc
  ctx.arc(x + 4, y - 19, 4.5, -Math.PI / 2.4, Math.PI / 2.4);
  ctx.stroke();
  // Shingled roof on corner posts.
  ctx.strokeStyle = '#5f4a26';
  ctx.beginPath();
  ctx.moveTo(x - 9, y - 19);
  ctx.lineTo(x - 9, y - 26);
  ctx.moveTo(x + 9, y - 19);
  ctx.lineTo(x + 9, y - 26);
  ctx.stroke();
  ctx.fillStyle = '#b5443c';
  ctx.beginPath();
  ctx.moveTo(x - 13, y - 25);
  ctx.lineTo(x, y - 36);
  ctx.lineTo(x + 13, y - 25);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#8c332d'; // shingle lines
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 9, y - 28);
  ctx.lineTo(x + 9, y - 28);
  ctx.moveTo(x - 5, y - 32);
  ctx.lineTo(x + 5, y - 32);
  ctx.stroke();
  // Pennant.
  ctx.strokeStyle = '#5f4a26';
  ctx.beginPath();
  ctx.moveTo(x, y - 36);
  ctx.lineTo(x, y - 43);
  ctx.stroke();
  ctx.fillStyle = '#e8b73a';
  ctx.beginPath();
  ctx.moveTo(x, y - 43);
  ctx.lineTo(x + 8 + Math.sin(time * 4) * 1.5, y - 40.5);
  ctx.lineTo(x, y - 38);
  ctx.closePath();
  ctx.fill();
}

function drawMageTower(ctx, spot, time, justFired) {
  const x = spot.x;
  const y = spot.y;
  // Stone body with brick courses.
  ctx.fillStyle = '#8d93b8';
  ctx.strokeStyle = '#5c6186';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 9, y + 4);
  ctx.lineTo(x - 7, y - 18);
  ctx.lineTo(x + 7, y - 18);
  ctx.lineTo(x + 9, y + 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(92,97,134,0.7)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 8.3, y - 4);
  ctx.lineTo(x + 8.3, y - 4);
  ctx.moveTo(x - 7.6, y - 11);
  ctx.lineTo(x + 7.6, y - 11);
  ctx.stroke();
  // Arched window with inner glow.
  ctx.fillStyle = justFired ? '#cdbfff' : '#2b2650';
  ctx.beginPath();
  ctx.arc(x, y - 9, 2.6, Math.PI, 0);
  ctx.fillRect(x - 2.6, y - 9, 5.2, 4);
  ctx.fill();
  // Conical roof.
  ctx.fillStyle = '#5a4fcf';
  ctx.beginPath();
  ctx.moveTo(x - 10, y - 17);
  ctx.lineTo(x, y - 30);
  ctx.lineTo(x + 10, y - 17);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#3a3390';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 6, y - 22);
  ctx.lineTo(x + 6, y - 22);
  ctx.stroke();
  // Floating orb: pulsing glow plus two orbiting sparks.
  const bob = Math.sin(time * 3) * 2;
  const oy = y - 36 + bob;
  const pulse = 1 + Math.sin(time * 6) * 0.25 + (justFired ? 0.6 : 0);
  ctx.fillStyle = 'rgba(143,123,255,0.3)';
  ctx.beginPath();
  ctx.arc(x, oy, 8 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(185,167,255,0.5)';
  ctx.beginPath();
  ctx.arc(x, oy, 5.5 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e6dcff';
  ctx.beginPath();
  ctx.arc(x, oy, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c9bfff';
  for (const phase of [0, Math.PI]) {
    const a = time * 2.4 + phase;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * 9, oy + Math.sin(a) * 3.5, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCannonTower(ctx, spot, angle, cooldownFrac) {
  const x = spot.x;
  const cy = spot.y - 10;
  // Recoil: the barrel kicks back right after firing and eases forward.
  const recoil = Math.max(0, (cooldownFrac - 0.75) / 0.25) * 4;
  const bx = x - Math.cos(angle) * recoil;
  const by = cy - Math.sin(angle) * recoil;
  // Barrel with muzzle ring.
  ctx.strokeStyle = '#2f3338';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx + Math.cos(angle) * 16, by + Math.sin(angle) * 16);
  ctx.stroke();
  ctx.strokeStyle = '#1f2327';
  ctx.lineWidth = 9;
  ctx.beginPath();
  const mx = bx + Math.cos(angle) * 14;
  const my = by + Math.sin(angle) * 14;
  ctx.moveTo(mx, my);
  ctx.lineTo(mx + Math.cos(angle) * 2, my + Math.sin(angle) * 2);
  ctx.stroke();
  // Turret dome with rivets and hatch.
  ctx.fillStyle = '#555b61';
  ctx.strokeStyle = '#33373c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, cy, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#3b4046';
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.5;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * 8, cy + Math.sin(a) * 8, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#6d747b'; // highlight
  ctx.beginPath();
  ctx.arc(x - 3.5, cy - 3.5, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#33373c'; // hatch seam
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, cy, 5.5, -0.6, 1.8);
  ctx.stroke();
}

function drawEnemies(ctx, game) {
  const sorted = [...game.enemies].sort((a, b) => {
    return game.path.positionAt(a.dist).y - game.path.positionAt(b.dist).y;
  });
  for (const enemy of sorted) {
    const pos = game.path.positionAt(enemy.dist);
    const ahead = game.path.positionAt(enemy.dist + 2);
    const facing = ahead.x >= pos.x ? 1 : -1;
    const stride = Math.sin(enemy.dist * 0.25);
    const bob = Math.abs(stride) * 2.5;
    const x = pos.x;
    const y = pos.y - bob;
    const r = enemy.radius;
    const type = game.enemyTypes[enemy.typeId];

    ctx.fillStyle = 'rgba(20,40,15,0.25)';
    ctx.beginPath();
    ctx.ellipse(x, pos.y + r * 0.7, r * 0.9, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    // Stepping feet, alternating with the stride.
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.4 + stride * r * 0.35 * facing, pos.y + r * 0.55, r * 0.28, r * 0.18, 0, 0, Math.PI * 2);
    ctx.ellipse(x + r * 0.4 - stride * r * 0.35 * facing, pos.y + r * 0.55, r * 0.28, r * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();

    if (enemy.typeId === 'wolf') drawWolf(ctx, enemy, type, x, y, r, facing);
    else if (enemy.typeId === 'orc') drawOrc(ctx, enemy, type, x, y, r, facing);
    else drawGoblin(ctx, enemy, type, x, y, r, facing);

    // White hit-flash overlay while enemy.flash runs down.
    if (enemy.flash > 0) {
      ctx.globalAlpha = (enemy.flash / 0.12) * 0.65;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, r * 1.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

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

// Shared body: base circle, darker belly, top highlight, outline.
function drawBody(ctx, color, x, y, r) {
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.beginPath();
  ctx.arc(x, y + r * 0.25, r * 0.85, 0.3, Math.PI - 0.3);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawEyes(ctx, x, y, r, facing, angry) {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x + r * 0.35 * facing, y - r * 0.2, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1c1c1c';
  ctx.beginPath();
  ctx.arc(x + r * 0.45 * facing, y - r * 0.2, r * 0.14, 0, Math.PI * 2);
  ctx.fill();
  if (angry) {
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + r * 0.1 * facing, y - r * 0.55);
    ctx.lineTo(x + r * 0.6 * facing, y - r * 0.38);
    ctx.stroke();
  }
}

function drawGoblin(ctx, enemy, type, x, y, r, facing) {
  drawBody(ctx, type.color, x, y, r);
  ctx.fillStyle = type.color; // pointy ears
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.8, y - r * 0.4);
  ctx.lineTo(x - r * 1.5, y - r * 1.1);
  ctx.lineTo(x - r * 0.3, y - r * 0.9);
  ctx.closePath();
  ctx.moveTo(x + r * 0.8, y - r * 0.4);
  ctx.lineTo(x + r * 1.5, y - r * 1.1);
  ctx.lineTo(x + r * 0.3, y - r * 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  drawEyes(ctx, x, y, r, facing, true);
  ctx.fillStyle = '#e8e2d4'; // snaggletooth
  ctx.beginPath();
  ctx.moveTo(x + r * 0.15 * facing, y + r * 0.45);
  ctx.lineTo(x + r * 0.3 * facing, y + r * 0.75);
  ctx.lineTo(x + r * 0.45 * facing, y + r * 0.45);
  ctx.fill();
  // A little wooden club over the shoulder.
  ctx.strokeStyle = '#6b4a2b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.7 * facing, y + r * 0.3);
  ctx.lineTo(x - r * 1.3 * facing, y - r * 0.6);
  ctx.stroke();
  ctx.fillStyle = '#5a3d20';
  ctx.beginPath();
  ctx.arc(x - r * 1.35 * facing, y - r * 0.7, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
}

function drawWolf(ctx, enemy, type, x, y, r, facing) {
  // Elongated body with tail and snout.
  ctx.fillStyle = type.color;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(x, y, r * 1.25, r * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.14)'; // belly shading
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.3, r * 1.05, r * 0.5, 0, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = '#c4c4c4'; // lighter chest toward the front
  ctx.beginPath();
  ctx.ellipse(x + r * 0.6 * facing, y + r * 0.1, r * 0.45, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  // Snout with nose.
  ctx.fillStyle = type.color;
  ctx.beginPath();
  ctx.ellipse(x + r * 1.25 * facing, y - r * 0.05, r * 0.55, r * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#1c1c1c';
  ctx.beginPath();
  ctx.arc(x + r * 1.7 * facing, y - r * 0.1, r * 0.14, 0, Math.PI * 2);
  ctx.fill();
  // Upright ears.
  ctx.fillStyle = type.color;
  ctx.beginPath();
  ctx.moveTo(x + r * 0.2 * facing, y - r * 0.6);
  ctx.lineTo(x + r * 0.45 * facing, y - r * 1.45);
  ctx.lineTo(x + r * 0.75 * facing, y - r * 0.65);
  ctx.closePath();
  ctx.moveTo(x - r * 0.25 * facing, y - r * 0.65);
  ctx.lineTo(x - r * 0.05 * facing, y - r * 1.35);
  ctx.lineTo(x + r * 0.3 * facing, y - r * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; // inner ear
  ctx.beginPath();
  ctx.moveTo(x + r * 0.33 * facing, y - r * 0.68);
  ctx.lineTo(x + r * 0.47 * facing, y - r * 1.2);
  ctx.lineTo(x + r * 0.62 * facing, y - r * 0.7);
  ctx.closePath();
  ctx.fill();
  // Bushy tail.
  ctx.fillStyle = type.color;
  ctx.beginPath();
  ctx.ellipse(x - r * 1.35 * facing, y - r * 0.35, r * 0.5, r * 0.26, facing * 0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Eye.
  ctx.fillStyle = '#ffd34d';
  ctx.beginPath();
  ctx.arc(x + r * 0.75 * facing, y - r * 0.3, r * 0.17, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1c1c1c';
  ctx.beginPath();
  ctx.arc(x + r * 0.8 * facing, y - r * 0.3, r * 0.08, 0, Math.PI * 2);
  ctx.fill();
}

function drawOrc(ctx, enemy, type, x, y, r, facing) {
  drawBody(ctx, type.color, x, y, r);
  // Shoulder armor plates.
  ctx.fillStyle = '#6b7178';
  ctx.strokeStyle = '#4a4f55';
  ctx.lineWidth = 1;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(x + side * r * 0.85, y + r * 0.05, r * 0.42, r * 0.3, side * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // Horned helmet.
  ctx.fillStyle = '#6b7178';
  ctx.beginPath();
  ctx.arc(x, y - r * 0.45, r * 0.72, Math.PI, 0);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#e8e2d4';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + side * r * 0.6, y - r * 0.75);
    ctx.lineTo(x + side * r * 1.1, y - r * 1.25);
    ctx.lineTo(x + side * r * 0.35, y - r * 0.95);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  drawEyes(ctx, x, y, r, facing, true);
  // Both tusks.
  ctx.fillStyle = '#e8e2d4';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + side * r * 0.45, y + r * 0.5);
    ctx.lineTo(x + side * r * 0.6, y - r * 0.05);
    ctx.lineTo(x + side * r * 0.2, y + r * 0.3);
    ctx.closePath();
    ctx.fill();
  }
  // Belt strap across the chest.
  ctx.strokeStyle = '#4a3a22';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.7, y - r * 0.15);
  ctx.lineTo(x + r * 0.7, y + r * 0.45);
  ctx.stroke();
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
      ctx.strokeStyle = '#d9c9a3'; // fletching
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(proj.x - proj.dirX * len - proj.dirY * 2.5, proj.y - proj.dirY * len + proj.dirX * 2.5);
      ctx.lineTo(proj.x - proj.dirX * (len - 3), proj.y - proj.dirY * (len - 3));
      ctx.lineTo(proj.x - proj.dirX * len + proj.dirY * 2.5, proj.y - proj.dirY * len - proj.dirX * 2.5);
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

function drawParticleList(ctx, particles) {
  for (const p of particles) {
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
    } else if (p.shape === 'scorch') {
      ctx.globalAlpha = Math.min(0.8, frac * 1.5);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.size, p.size * 0.55, 0, 0, Math.PI * 2);
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
