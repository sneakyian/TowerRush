// Canvas rendering. Pure drawing — reads game/effects state, never mutates it.
//
// Layers, back to front:
//   static terrain (prerendered once per level): ground, path, water base,
//     cave, castle
//   animated water (ripples, shimmer)
//   ground particles (dust, scorch)
//   build spots, decorations, towers, enemies (sorted by y), projectiles
//   cloud shadows
//   particles, floating text, boss bar, banner

let sceneCache = null; // { level, terrain: canvas, decor: [...], clouds: [...] }

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
  // The canvas may be scaled for high-DPI screens; terrain is prerendered at
  // the same scale so it stays crisp.
  const dpr = ctx.getTransform().a || 1;
  const scene = getScene(game, dpr);
  ctx.clearRect(0, 0, level.width, level.height);
  ctx.drawImage(scene.terrain, 0, 0, level.width, level.height);

  drawWaterAnimation(ctx, level, time);
  drawParticleList(ctx, effects.groundParticles);
  drawBuildSpots(ctx, game, ui, time);
  drawDecorations(ctx, scene.decor, level.theme, time);
  drawTowers(ctx, game, ui, time);
  drawEnemies(ctx, game, time);
  drawProjectiles(ctx, game);
  drawBeams(ctx, game, time);
  drawBolts(ctx, effects.bolts);
  drawCloudShadows(ctx, scene.clouds, level, time);
  drawParticleList(ctx, effects.particles, true);
  drawVignette(ctx, scene.vignette, level);
  drawTexts(ctx, effects);
  drawBossBar(ctx, game);
  drawBanner(ctx, effects, level);
}

// --- Scene setup (once per level) -----------------------------------------

function getScene(game, dpr) {
  if (sceneCache && sceneCache.level === game.level && sceneCache.dpr === dpr) return sceneCache;
  const { level } = game;
  const { theme } = level;
  const rng = mulberry32(42);

  const terrain = document.createElement('canvas');
  terrain.width = Math.round(level.width * dpr);
  terrain.height = Math.round(level.height * dpr);
  const ctx = terrain.getContext('2d');
  ctx.scale(dpr, dpr);

  // Ground with soft mottling.
  const ground = ctx.createLinearGradient(0, 0, 0, level.height);
  ground.addColorStop(0, theme.groundTop);
  ground.addColorStop(1, theme.groundBottom);
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, level.width, level.height);
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = rng() > 0.5 ? theme.mottleLight : theme.mottleDark;
    ctx.beginPath();
    ctx.ellipse(rng() * level.width, rng() * level.height, 15 + rng() * 45, 8 + rng() * 22, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const w of level.water) drawWaterBase(ctx, w, theme);

  // Path: dark edge, fill, worn center line.
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  tracePath(ctx, game.path.waypoints);
  ctx.strokeStyle = theme.pathEdge;
  ctx.lineWidth = 34;
  ctx.stroke();
  tracePath(ctx, game.path.waypoints);
  ctx.strokeStyle = theme.pathFill;
  ctx.lineWidth = 28;
  ctx.stroke();
  ctx.save();
  ctx.setLineDash([2, 14]);
  tracePath(ctx, game.path.waypoints);
  ctx.strokeStyle = theme.pathLine;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  drawCave(ctx, level);
  drawCastle(ctx, level, theme);

  const decor = placeDecorations(game, rng);
  const clouds = makeClouds(level, rng);
  const vignette = makeVignette(level, dpr);
  sceneCache = { level, dpr, terrain, decor, clouds, vignette };
  return sceneCache;
}

// Soft darkening toward the edges, prerendered once; gives the map depth.
function makeVignette(level, dpr) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(level.width * dpr);
  canvas.height = Math.round(level.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const g = ctx.createRadialGradient(level.width / 2, level.height / 2, level.height * 0.45, level.width / 2, level.height / 2, level.width * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(10,8,20,0.42)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, level.width, level.height);
  return canvas;
}

function drawVignette(ctx, vignette, level) {
  ctx.drawImage(vignette, 0, 0, level.width, level.height);
}

function tracePath(ctx, waypoints) {
  ctx.beginPath();
  waypoints.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
}

function drawWaterBase(ctx, w, theme) {
  // Shore ring, then deep-to-shallow radial fill.
  ctx.fillStyle = theme.lava ? 'rgba(20,10,8,0.6)' : 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  ctx.ellipse(w.x, w.y, w.rx + 6, w.ry + 5, 0, 0, Math.PI * 2);
  ctx.fill();
  const grad = ctx.createRadialGradient(w.x, w.y, 2, w.x, w.y, w.rx);
  grad.addColorStop(0, theme.waterDeep);
  grad.addColorStop(1, theme.waterShallow);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(w.x, w.y, w.rx, w.ry, 0, 0, Math.PI * 2);
  ctx.fill();
  if (theme.lilyPads) {
    const rng = mulberry32(w.x * 7 + w.y);
    for (let i = 0; i < 4; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * 0.7;
      const px = w.x + Math.cos(a) * w.rx * d;
      const py = w.y + Math.sin(a) * w.ry * d;
      ctx.fillStyle = '#6fae4a';
      ctx.beginPath();
      ctx.ellipse(px, py, 7, 5, 0, 0.4, Math.PI * 2 - 0.2);
      ctx.lineTo(px, py);
      ctx.fill();
    }
  }
}

function drawCave(ctx, level) {
  const p = level.path[0];
  const x = Math.max(16, Math.min(level.width - 16, p.x));
  const y = Math.max(16, Math.min(level.height - 16, p.y));
  ctx.fillStyle = '#4a4238';
  ctx.beginPath();
  ctx.arc(x, y, 24, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#17120d';
  ctx.beginPath();
  ctx.arc(x, y, 16, Math.PI, 0);
  ctx.fill();
}

function drawCastle(ctx, level, theme) {
  const p = level.path[level.path.length - 1];
  const x = Math.max(30, Math.min(level.width - 30, p.x));
  const y = Math.max(60, Math.min(level.height - 20, p.y));
  ctx.fillStyle = theme.stone;
  ctx.fillRect(x - 26, y - 34, 52, 44);
  ctx.fillStyle = theme.stoneDark;
  for (let i = 0; i < 4; i++) ctx.fillRect(x - 26 + i * 14, y - 42, 9, 10); // crenellations
  ctx.fillRect(x - 26, y - 14, 52, 2); // string course
  ctx.fillStyle = '#5b4632';
  ctx.beginPath(); // gate
  ctx.arc(x, y + 10, 11, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(x - 11, y + 10, 22, 1);
  ctx.fillStyle = '#2b2520'; // arrow slits
  ctx.fillRect(x - 16, y - 28, 3, 8);
  ctx.fillRect(x + 13, y - 28, 3, 8);
  ctx.strokeStyle = theme.stoneDark; // flag pole
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

function placeDecorations(game, rng) {
  const { level } = game;
  const kinds = level.theme.decor;
  const placed = [];
  let attempts = 0;
  while (placed.length < 26 && attempts++ < 400) {
    const x = 14 + rng() * (level.width - 28);
    const y = 14 + rng() * (level.height - 28);
    if (distToPath(game, x, y) < 36) continue;
    if (level.buildSpots.some((s) => Math.hypot(s.x - x, s.y - y) < 34)) continue;
    if (level.water.some((w) => ((x - w.x) / (w.rx + 14)) ** 2 + ((y - w.y) / (w.ry + 14)) ** 2 < 1)) continue;
    if (placed.some((d) => Math.hypot(d.x - x, d.y - y) < 28)) continue;
    placed.push({ x, y, kind: kinds[Math.floor(rng() * kinds.length)], seed: rng() * 10 });
  }
  // Draw order by y so taller things overlap naturally.
  return placed.sort((a, b) => a.y - b.y);
}

function distToPath(game, x, y) {
  let min = Infinity;
  for (let d = 0; d <= game.path.totalLength; d += 8) {
    const p = game.path.positionAt(d);
    min = Math.min(min, Math.hypot(p.x - x, p.y - y));
  }
  return min;
}

function makeClouds(level, rng) {
  const clouds = [];
  for (let i = 0; i < 3; i++) {
    const puffs = [];
    for (let j = 0; j < 5; j++) {
      puffs.push({ dx: (rng() - 0.5) * 220, dy: (rng() - 0.5) * 90, rx: 70 + rng() * 70, ry: 40 + rng() * 35 });
    }
    clouds.push({ x0: rng() * (level.width + 500), y: rng() * level.height, speed: 14 + rng() * 10, puffs });
  }
  return clouds;
}

// --- Animated environment -------------------------------------------------

function drawWaterAnimation(ctx, level, time) {
  const { theme } = level;
  for (const w of level.water) {
    const rng = mulberry32(Math.floor(w.x + w.y * 3));
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(w.x, w.y, w.rx, w.ry, 0, 0, Math.PI * 2);
    ctx.clip();

    ctx.globalCompositeOperation = 'lighter';
    if (theme.lava) {
      // Slow brightness pulse over the whole pool.
      ctx.fillStyle = `rgba(255,200,80,${0.08 + Math.sin(time * 1.3 + w.x) * 0.06})`;
      ctx.fillRect(w.x - w.rx, w.y - w.ry, w.rx * 2, w.ry * 2);
    }

    // Expanding ripple rings at fixed points in each pool.
    for (let k = 0; k < 4; k++) {
      const ox = (rng() - 0.5) * 1.3;
      const oy = (rng() - 0.5) * 1.3;
      const speed = theme.lava ? 0.18 : 0.32;
      const phase = (time * speed + k * 0.27 + rng()) % 1;
      const cx = w.x + ox * w.rx;
      const cy = w.y + oy * w.ry;
      ctx.strokeStyle = theme.waterGlow;
      ctx.globalAlpha = (1 - phase) * 0.9;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 3 + phase * w.rx * 0.45, (3 + phase * w.rx * 0.45) * (w.ry / w.rx), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Drifting shimmer dashes.
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = theme.waterGlow;
    ctx.lineWidth = 1.2;
    for (let k = 0; k < 6; k++) {
      const sy = w.y + (rng() - 0.5) * w.ry * 1.4;
      const drift = ((time * 12 + k * 37 + rng() * 100) % (w.rx * 2.2)) - w.rx * 1.1;
      const sx = w.x + drift;
      ctx.beginPath();
      ctx.moveTo(sx - 5, sy);
      ctx.lineTo(sx + 5, sy);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}

function drawCloudShadows(ctx, clouds, level, time) {
  ctx.fillStyle = `rgba(10,12,40,${level.theme.cloudAlpha})`;
  const span = level.width + 500;
  for (const c of clouds) {
    const x = ((c.x0 + time * c.speed) % span) - 250;
    for (const p of c.puffs) {
      ctx.beginPath();
      ctx.ellipse(x + p.dx, c.y + p.dy, p.rx, p.ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawDecorations(ctx, decor, theme, time) {
  for (const d of decor) {
    const sway = Math.sin(time * 1.4 + d.seed * 2.1 + d.x * 0.02) * 2.5;
    switch (d.kind) {
      case 'tree': drawTree(ctx, d.x, d.y, sway); break;
      case 'pine': drawPine(ctx, d.x, d.y, sway, true); break;
      case 'palm': drawPalm(ctx, d.x, d.y, sway, time); break;
      case 'willow': drawWillow(ctx, d.x, d.y, sway, time); break;
      case 'deadtree': drawDeadTree(ctx, d.x, d.y, sway); break;
      case 'cactus': drawCactus(ctx, d.x, d.y); break;
      case 'bush': drawBush(ctx, d.x, d.y, '#4c8c40'); break;
      case 'deadbush': drawBush(ctx, d.x, d.y, '#8a7a5a'); break;
      case 'reeds': drawReeds(ctx, d.x, d.y, sway); break;
      case 'rock': drawRock(ctx, d.x, d.y, '#8f9296', '#a8abaf'); break;
      case 'snowrock': drawRock(ctx, d.x, d.y, '#9aa6b0', '#eef3f7'); break;
      case 'sandrock': drawRock(ctx, d.x, d.y, '#b08b55', '#d6b27e'); break;
      case 'obsidian': drawRock(ctx, d.x, d.y, '#1f1b24', '#4a3f55'); break;
      case 'flower': drawFlowers(ctx, d.x, d.y, d.seed, ['#e8e26e', '#e2918f', '#e8e8e8']); break;
      case 'ember': drawFlowers(ctx, d.x, d.y, d.seed, ['#ff9f45', '#ffd97a', '#ff6b35'], time); break;
      case 'mushroom': drawMushroom(ctx, d.x, d.y); break;
      case 'iceshard': drawIceShard(ctx, d.x, d.y, time); break;
      case 'bones': drawBones(ctx, d.x, d.y); break;
      case 'vent': drawVent(ctx, d.x, d.y, time, d.seed); break;
    }
  }
}

function shadow(ctx, x, y, rx, ry) {
  ctx.fillStyle = 'rgba(20,30,15,0.2)';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawTree(ctx, x, y, sway) {
  shadow(ctx, x, y + 10, 10, 4);
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(x - 2, y, 4, 10);
  ctx.fillStyle = '#3f7a35';
  ctx.beginPath();
  ctx.moveTo(x + sway, y - 22);
  ctx.lineTo(x + 10, y + 2);
  ctx.lineTo(x - 10, y + 2);
  ctx.fill();
  ctx.fillStyle = '#4c8c40';
  ctx.beginPath();
  ctx.moveTo(x + sway * 0.6, y - 14);
  ctx.lineTo(x + 8, y + 4);
  ctx.lineTo(x - 8, y + 4);
  ctx.fill();
}

function drawPine(ctx, x, y, sway, snowy) {
  shadow(ctx, x, y + 10, 9, 4);
  ctx.fillStyle = '#5a3f2a';
  ctx.fillRect(x - 2, y + 2, 4, 9);
  const tiers = [[y + 4, 11, y - 10], [y - 6, 9, y - 19], [y - 14, 7, y - 27]];
  for (const [base, half, top] of tiers) {
    const s = sway * ((y - top) / 30);
    ctx.fillStyle = '#2f6b45';
    ctx.beginPath();
    ctx.moveTo(x + s, top);
    ctx.lineTo(x + half, base);
    ctx.lineTo(x - half, base);
    ctx.fill();
    if (snowy) {
      ctx.fillStyle = '#eef3f7';
      ctx.beginPath();
      ctx.moveTo(x + s, top);
      ctx.lineTo(x + half * 0.55, base - 4);
      ctx.lineTo(x - half * 0.55, base - 4);
      ctx.fill();
    }
  }
}

function drawPalm(ctx, x, y, sway, time) {
  shadow(ctx, x, y + 8, 12, 4);
  ctx.strokeStyle = '#8a6a3a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, y + 8);
  ctx.quadraticCurveTo(x + 4, y - 10, x + sway, y - 24);
  ctx.stroke();
  ctx.strokeStyle = '#3f8a3a';
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + time * 0.3;
    const flap = Math.sin(time * 2 + i) * 1.5;
    ctx.beginPath();
    ctx.moveTo(x + sway, y - 24);
    ctx.quadraticCurveTo(x + sway + Math.cos(a) * 9, y - 28 + Math.sin(a) * 4 + flap, x + sway + Math.cos(a) * 15, y - 20 + Math.sin(a) * 6 + flap);
    ctx.stroke();
  }
}

function drawWillow(ctx, x, y, sway, time) {
  shadow(ctx, x, y + 10, 12, 4);
  ctx.fillStyle = '#4a3a28';
  ctx.fillRect(x - 3, y - 6, 6, 16);
  ctx.fillStyle = '#5c8a3a';
  ctx.beginPath();
  ctx.arc(x + sway * 0.4, y - 14, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#4e7a30';
  ctx.lineWidth = 1.5;
  for (let i = -3; i <= 3; i++) {
    const s = sway * (1 + Math.abs(i) * 0.2) + Math.sin(time * 2 + i) * 1.2;
    ctx.beginPath();
    ctx.moveTo(x + i * 4, y - 10);
    ctx.quadraticCurveTo(x + i * 4 + s * 0.5, y, x + i * 4.5 + s, y + 8);
    ctx.stroke();
  }
}

function drawDeadTree(ctx, x, y, sway) {
  shadow(ctx, x, y + 10, 8, 3);
  ctx.strokeStyle = '#3a2e26';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, y + 10);
  ctx.lineTo(x + sway * 0.4, y - 14);
  ctx.lineTo(x + sway - 7, y - 24);
  ctx.moveTo(x + sway * 0.3, y - 8);
  ctx.lineTo(x + sway + 8, y - 18);
  ctx.moveTo(x + sway * 0.4, y - 14);
  ctx.lineTo(x + sway + 2, y - 26);
  ctx.stroke();
}

function drawCactus(ctx, x, y) {
  shadow(ctx, x, y + 10, 7, 3);
  ctx.fillStyle = '#4f8f4a';
  ctx.strokeStyle = '#2f6b2f';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x - 4, y - 18, 8, 28, 4);
  roundRect(ctx, x - 13, y - 10, 6, 12, 3);
  ctx.fillRect(x - 10, y - 2, 7, 4);
  roundRect(ctx, x + 7, y - 14, 6, 12, 3);
  ctx.fillRect(x + 3, y - 6, 7, 4);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawBush(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x - 4, y, 5, 0, Math.PI * 2);
  ctx.arc(x + 3, y - 1, 6, 0, Math.PI * 2);
  ctx.arc(x, y + 3, 5, 0, Math.PI * 2);
  ctx.fill();
}

function drawReeds(ctx, x, y, sway) {
  ctx.strokeStyle = '#6f9a3a';
  ctx.lineWidth = 1.5;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(x + i * 3, y + 6);
    ctx.quadraticCurveTo(x + i * 3 + sway * 0.5, y - 6, x + i * 3 + sway * (1 + Math.abs(i) * 0.3), y - 16 - Math.abs(i) * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#6b4a2b';
  ctx.beginPath();
  ctx.ellipse(x + sway, y - 15, 1.8, 4, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawRock(ctx, x, y, dark, light) {
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(x - 7, y + 4);
  ctx.lineTo(x - 4, y - 4);
  ctx.lineTo(x + 3, y - 5);
  ctx.lineTo(x + 7, y + 2);
  ctx.lineTo(x + 4, y + 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.moveTo(x - 4, y - 4);
  ctx.lineTo(x + 3, y - 5);
  ctx.lineTo(x + 2, y);
  ctx.closePath();
  ctx.fill();
}

function drawFlowers(ctx, x, y, seed, colors, time) {
  const rng = mulberry32(Math.floor(seed * 1000));
  for (let i = 0; i < 3; i++) {
    const fx = x + (rng() - 0.5) * 14;
    const fy = y + (rng() - 0.5) * 10;
    const glow = time === undefined ? 1 : 0.6 + Math.sin(time * 3 + i + seed) * 0.4;
    ctx.globalAlpha = glow;
    ctx.fillStyle = colors[i % colors.length];
    ctx.beginPath();
    ctx.arc(fx, fy, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawMushroom(ctx, x, y) {
  ctx.fillStyle = '#e6d9b8';
  ctx.fillRect(x - 2, y - 4, 4, 8);
  ctx.fillStyle = '#b8403a';
  ctx.beginPath();
  ctx.arc(x, y - 4, 7, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#f2e9d8';
  ctx.beginPath();
  ctx.arc(x - 2, y - 7, 1.5, 0, Math.PI * 2);
  ctx.arc(x + 3, y - 6, 1.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawIceShard(ctx, x, y, time) {
  ctx.fillStyle = `rgba(190,230,255,${0.75 + Math.sin(time * 2 + x) * 0.15})`;
  ctx.strokeStyle = '#7fb8d8';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 6, y + 4);
  ctx.lineTo(x - 3, y - 16);
  ctx.lineTo(x + 1, y + 4);
  ctx.moveTo(x + 1, y + 4);
  ctx.lineTo(x + 5, y - 9);
  ctx.lineTo(x + 8, y + 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawBones(ctx, x, y) {
  ctx.strokeStyle = '#efe6d0';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 8, y - 3);
  ctx.lineTo(x + 8, y + 3);
  ctx.moveTo(x - 7, y + 5);
  ctx.lineTo(x + 7, y - 5);
  ctx.stroke();
  ctx.fillStyle = '#efe6d0';
  ctx.beginPath();
  ctx.arc(x + 12, y - 1, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3a2e26';
  ctx.beginPath();
  ctx.arc(x + 11, y - 2, 1, 0, Math.PI * 2);
  ctx.arc(x + 14, y - 2, 1, 0, Math.PI * 2);
  ctx.fill();
}

function drawVent(ctx, x, y, time, seed) {
  ctx.fillStyle = '#2a2224';
  ctx.beginPath();
  ctx.ellipse(x, y, 9, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  const glow = 0.5 + Math.sin(time * 4 + seed) * 0.4;
  ctx.fillStyle = `rgba(255,120,40,${glow})`;
  ctx.beginPath();
  ctx.ellipse(x, y, 5, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // Puff of smoke that rises and fades on a loop.
  const phase = (time * 0.5 + seed) % 1;
  ctx.fillStyle = `rgba(120,110,110,${(1 - phase) * 0.5})`;
  ctx.beginPath();
  ctx.arc(x + Math.sin(phase * 6) * 3, y - 4 - phase * 22, 3 + phase * 5, 0, Math.PI * 2);
  ctx.fill();
}

// --- Build spots and towers -------------------------------------------------

function drawBuildSpots(ctx, game, ui, time) {
  const { theme } = game.level;
  for (let i = 0; i < game.level.buildSpots.length; i++) {
    if (game.towers[i]) continue;
    const spot = game.level.buildSpots[i];
    const selected = i === ui.selectedSpot;
    const pulse = selected ? 2 + Math.sin(time * 5) * 1.5 : 0;

    ctx.fillStyle = 'rgba(20,40,15,0.18)';
    ctx.beginPath();
    ctx.ellipse(spot.x, spot.y + 3, 15, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = selected ? '#ece0b4' : theme.stone;
    ctx.strokeStyle = theme.stoneDark;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(spot.x, spot.y, 13 + pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(60,50,40,0.7)';
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
    const stats = game.towerStats(tower);
    if (i === ui.selectedSpot) drawRange(ctx, spot, stats.range);

    drawPlatform(ctx, spot, tower.level);
    const age = tower.age ?? 1;
    const pop = age < 0.45 ? 1 + 0.35 * Math.sin((age / 0.45) * Math.PI) * (1 - age / 0.45) : 1;
    ctx.save();
    ctx.translate(spot.x, spot.y + 2);
    ctx.scale(pop, pop);
    ctx.translate(-spot.x, -(spot.y + 2));
    const justFired = stats.fireInterval ? tower.cooldown > stats.fireInterval - 0.12 : !!tower.beamTargetId;
    if (tower.typeId === 'archer') drawArcherTower(ctx, spot, time, justFired, tower.level);
    else if (tower.typeId === 'mage') drawMageTower(ctx, spot, time, justFired, tower.level);
    else if (tower.typeId === 'cannon') drawCannonTower(ctx, spot, tower.angle ?? 0, tower.cooldown / stats.fireInterval, tower.level);
    else if (tower.typeId === 'frost') drawFrostTower(ctx, spot, time, justFired, tower.level);
    else if (tower.typeId === 'tesla') drawTeslaTower(ctx, spot, time, justFired, tower.level);
    else if (tower.typeId === 'flame') drawFlameTower(ctx, spot, time, tower.angle ?? 0, justFired, tower.level);
    else if (tower.typeId === 'laser') drawLaserTower(ctx, spot, time, tower.angle ?? 0, tower.beamTargetId ? game.beamMultiplier(tower) : 0, tower.level);
    ctx.restore();

    // Level pips.
    ctx.fillStyle = '#ffd700';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    for (let p = 0; p <= tower.level; p++) {
      ctx.beginPath();
      ctx.arc(spot.x - tower.level * 4 + p * 8, spot.y + 15, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

function drawPlatform(ctx, spot, level) {
  const r = 16 + level * 1.5;
  ctx.fillStyle = 'rgba(20,40,15,0.2)';
  ctx.beginPath();
  ctx.ellipse(spot.x, spot.y + 6, r + 2, 7.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#878e95';
  ctx.strokeStyle = '#60666c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(spot.x, spot.y + 2, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(96,102,108,0.6)'; // paver joints
  ctx.lineWidth = 1;
  for (let a = 0; a < 6; a++) {
    const angle = (a / 6) * Math.PI * 2 + 0.3;
    ctx.beginPath();
    ctx.moveTo(spot.x + Math.cos(angle) * 9, spot.y + 2 + Math.sin(angle) * 9);
    ctx.lineTo(spot.x + Math.cos(angle) * (r - 1), spot.y + 2 + Math.sin(angle) * (r - 1));
    ctx.stroke();
  }
  ctx.fillStyle = '#a4abb2';
  ctx.beginPath();
  ctx.arc(spot.x, spot.y + 1, 9, 0, Math.PI * 2);
  ctx.fill();
}

function drawArcherTower(ctx, spot, time, justFired, level) {
  const x = spot.x;
  const y = spot.y - level * 3; // taller with each tier
  const roofColor = ['#b5443c', '#3f6fb5', '#b58a2a'][level];
  if (level >= 2) {
    // Stone lower storey on the top tier.
    ctx.fillStyle = '#9aa1a8';
    ctx.strokeStyle = '#6b7178';
    ctx.lineWidth = 1.5;
    ctx.fillRect(x - 10, spot.y - 8, 20, 12);
    ctx.strokeRect(x - 10, spot.y - 8, 20, 12);
    ctx.fillStyle = '#5b4632';
    ctx.fillRect(x - 2.5, spot.y - 4, 5, 8);
  }
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
  const pw = 22 + level * 3;
  ctx.fillRect(x - pw / 2, y - 14, pw, 5);
  ctx.strokeRect(x - pw / 2, y - 14, pw, 5);
  // Railing posts.
  ctx.beginPath();
  for (let px = -pw / 2 + 1; px <= pw / 2; px += 5) {
    ctx.moveTo(x + px, y - 14);
    ctx.lineTo(x + px, y - 19);
  }
  ctx.moveTo(x - pw / 2 + 1, y - 18);
  ctx.lineTo(x + pw / 2 - 1, y - 18);
  ctx.stroke();
  // Archers: one per tier.
  for (let a = 0; a <= level; a++) {
    const ax = x + (a - level / 2) * 7;
    ctx.fillStyle = '#4a3a22';
    ctx.beginPath();
    ctx.arc(ax - 1, y - 21, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(ax - 3, y - 19, 4.5, 5);
    ctx.strokeStyle = justFired ? '#f5e6c4' : '#d9c9a3';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ax + 4, y - 19, 4.5, -Math.PI / 2.4, Math.PI / 2.4);
    ctx.stroke();
  }
  // Roof on corner posts.
  ctx.strokeStyle = '#5f4a26';
  ctx.beginPath();
  ctx.moveTo(x - pw / 2 + 2, y - 19);
  ctx.lineTo(x - pw / 2 + 2, y - 26);
  ctx.moveTo(x + pw / 2 - 2, y - 19);
  ctx.lineTo(x + pw / 2 - 2, y - 26);
  ctx.stroke();
  ctx.fillStyle = roofColor;
  ctx.beginPath();
  ctx.moveTo(x - pw / 2 - 2, y - 25);
  ctx.lineTo(x, y - 36 - level * 2);
  ctx.lineTo(x + pw / 2 + 2, y - 25);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 9, y - 28);
  ctx.lineTo(x + 9, y - 28);
  ctx.moveTo(x - 5, y - 32);
  ctx.lineTo(x + 5, y - 32);
  ctx.stroke();
  // Pennant.
  const top = y - 36 - level * 2;
  ctx.strokeStyle = '#5f4a26';
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, top - 7);
  ctx.stroke();
  ctx.fillStyle = ['#e8b73a', '#e8b73a', '#ffffff'][level];
  ctx.beginPath();
  ctx.moveTo(x, top - 7);
  ctx.lineTo(x + 8 + Math.sin(time * 4) * 1.5, top - 4.5);
  ctx.lineTo(x, top - 2);
  ctx.closePath();
  ctx.fill();
}

function drawMageTower(ctx, spot, time, justFired, level) {
  const x = spot.x;
  const y = spot.y;
  const h = 18 + level * 5;
  // Stone body with brick courses.
  ctx.fillStyle = ['#8d93b8', '#7f86b8', '#6f78b8'][level];
  ctx.strokeStyle = '#5c6186';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 9 - level, y + 4);
  ctx.lineTo(x - 7, y - h);
  ctx.lineTo(x + 7, y - h);
  ctx.lineTo(x + 9 + level, y + 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(92,97,134,0.7)';
  ctx.lineWidth = 1;
  for (let c = -4; c > -h + 4; c -= 7) {
    ctx.beginPath();
    ctx.moveTo(x - 8, y + c);
    ctx.lineTo(x + 8, y + c);
    ctx.stroke();
  }
  // Arched window with inner glow.
  ctx.fillStyle = justFired ? '#cdbfff' : '#2b2650';
  ctx.beginPath();
  ctx.arc(x, y - 9, 2.6, Math.PI, 0);
  ctx.fillRect(x - 2.6, y - 9, 5.2, 4);
  ctx.fill();
  if (level >= 1) {
    ctx.beginPath();
    ctx.arc(x, y - 20, 2.2, Math.PI, 0);
    ctx.fillRect(x - 2.2, y - 20, 4.4, 3.5);
    ctx.fill();
  }
  // Conical roof.
  ctx.fillStyle = '#5a4fcf';
  ctx.beginPath();
  ctx.moveTo(x - 10 - level, y - h + 1);
  ctx.lineTo(x, y - h - 12 - level * 2);
  ctx.lineTo(x + 10 + level, y - h + 1);
  ctx.closePath();
  ctx.fill();
  if (level >= 2) {
    // Crystal spikes ringing the roof on the top tier.
    ctx.fillStyle = '#c9bfff';
    ctx.strokeStyle = '#8f7bff';
    ctx.lineWidth = 1;
    for (const sx of [-12, -6, 6, 12]) {
      ctx.beginPath();
      ctx.moveTo(x + sx - 2, y - h + 3);
      ctx.lineTo(x + sx, y - h - 6);
      ctx.lineTo(x + sx + 2, y - h + 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
  // Floating orb: pulsing glow plus orbiting sparks.
  const bob = Math.sin(time * 3) * 2;
  const oy = y - h - 18 - level * 2 + bob;
  const size = 1 + level * 0.25;
  const pulse = (1 + Math.sin(time * 6) * 0.25 + (justFired ? 0.6 : 0)) * size;
  if (level >= 2) {
    ctx.fillStyle = 'rgba(143,123,255,0.15)';
    ctx.beginPath();
    ctx.arc(x, oy, 16 * pulse, 0, Math.PI * 2);
    ctx.fill();
  }
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
  ctx.arc(x, oy, 3.5 * size, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c9bfff';
  const sparks = 2 + level;
  for (let s = 0; s < sparks; s++) {
    const a = time * 2.4 + (s / sparks) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * (9 + level * 2), oy + Math.sin(a) * 3.5, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCannonTower(ctx, spot, angle, cooldownFrac, level) {
  const x = spot.x;
  const cy = spot.y - 10 - level;
  const recoil = Math.max(0, (cooldownFrac - 0.75) / 0.25) * 4;
  const bx = x - Math.cos(angle) * recoil;
  const by = cy - Math.sin(angle) * recoil;
  const len = 16 + level * 3;
  const width = 7 + level;
  // Barrels: one, or twin barrels on the top tier.
  const offsets = level >= 2 ? [-3.5, 3.5] : [0];
  for (const off of offsets) {
    const ox = -Math.sin(angle) * off;
    const oy = Math.cos(angle) * off;
    ctx.strokeStyle = '#2f3338';
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bx + ox, by + oy);
    ctx.lineTo(bx + ox + Math.cos(angle) * len, by + oy + Math.sin(angle) * len);
    ctx.stroke();
    ctx.strokeStyle = '#1f2327';
    ctx.lineWidth = width + 2;
    ctx.beginPath();
    const mx = bx + ox + Math.cos(angle) * (len - 2);
    const my = by + oy + Math.sin(angle) * (len - 2);
    ctx.moveTo(mx, my);
    ctx.lineTo(mx + Math.cos(angle) * 2, my + Math.sin(angle) * 2);
    ctx.stroke();
  }
  // Turret dome with rivets and hatch.
  const r = 11 + level * 1.5;
  ctx.fillStyle = ['#555b61', '#4f5a66', '#5a4f4a'][level];
  ctx.strokeStyle = '#33373c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#3b4046';
  const rivets = 6 + level * 2;
  for (let i = 0; i < rivets; i++) {
    const a = (i / rivets) * Math.PI * 2 + 0.5;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * (r - 3), cy + Math.sin(a) * (r - 3), 1.1, 0, Math.PI * 2);
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
  if (level >= 1) {
    // Stacked cannonballs beside the turret.
    ctx.fillStyle = '#2f3338';
    for (const [dx, dy] of [[-14, 6], [-10, 6], [-12, 2]]) {
      ctx.beginPath();
      ctx.arc(x + dx, spot.y + dy - 4, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawFrostTower(ctx, spot, time, justFired, level) {
  const x = spot.x;
  const y = spot.y;
  const h = 30 + level * 5;
  // Icy base ring.
  ctx.fillStyle = 'rgba(191,233,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(x, y + 2, 13 + level, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // Crystal obelisk with inner glow.
  const glow = 0.55 + Math.sin(time * 3) * 0.15 + (justFired ? 0.3 : 0);
  ctx.fillStyle = `rgba(143,211,255,${glow})`;
  ctx.strokeStyle = '#5fa8d8';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.lineTo(x + 8 + level, y - 10);
  ctx.lineTo(x + 4, y + 3);
  ctx.lineTo(x - 4, y + 3);
  ctx.lineTo(x - 8 - level, y - 10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; // facet highlight
  ctx.beginPath();
  ctx.moveTo(x - 1, y - h + 4);
  ctx.lineTo(x - 5 - level * 0.5, y - 10);
  ctx.lineTo(x - 2, y - 2);
  ctx.closePath();
  ctx.fill();
  // Smaller side crystals on higher tiers.
  for (let c = 0; c < level; c++) {
    const side = c === 0 ? -1 : 1;
    ctx.fillStyle = `rgba(191,233,255,${glow})`;
    ctx.beginPath();
    ctx.moveTo(x + side * 11, y - 16 - c * 2);
    ctx.lineTo(x + side * 15, y - 2);
    ctx.lineTo(x + side * 7, y - 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // Drifting ice motes.
  ctx.fillStyle = '#ffffff';
  for (let m = 0; m < 2 + level; m++) {
    const a = time * 1.6 + (m / (2 + level)) * Math.PI * 2;
    ctx.globalAlpha = 0.6 + Math.sin(time * 4 + m) * 0.3;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * (12 + level * 2), y - 14 + Math.sin(a) * 6, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawTeslaTower(ctx, spot, time, justFired, level) {
  const x = spot.x;
  const y = spot.y;
  const h = 28 + level * 5;
  // Dark iron base block.
  ctx.fillStyle = '#3b4046';
  ctx.strokeStyle = '#1f2327';
  ctx.lineWidth = 1.5;
  ctx.fillRect(x - 9, y - 8, 18, 12);
  ctx.strokeRect(x - 9, y - 8, 18, 12);
  // Central rod with copper rings.
  ctx.strokeStyle = '#6d747b';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x, y - 8);
  ctx.lineTo(x, y - h);
  ctx.stroke();
  ctx.strokeStyle = '#c47a3a';
  ctx.lineWidth = 3;
  for (let r = 0; r < 2 + level; r++) {
    const ry = y - 12 - r * ((h - 14) / (2 + level));
    ctx.beginPath();
    ctx.ellipse(x, ry, 7 + (level - r) * 0.5, 2.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Charged sphere with flickering arcs.
  const charge = 0.5 + Math.sin(time * 9) * 0.2 + (justFired ? 0.4 : 0);
  ctx.fillStyle = `rgba(126,200,255,${charge * 0.4})`;
  ctx.beginPath();
  ctx.arc(x, y - h - 4, 11 + level, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#9aa1a8';
  ctx.strokeStyle = '#5c6186';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y - h - 4, 6 + level * 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = `rgba(223,243,255,${charge})`;
  ctx.lineWidth = 1.2;
  for (let a = 0; a < 2 + level; a++) {
    const ang = time * 7 + a * 2.1;
    const len = 8 + Math.sin(time * 23 + a) * 3;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(ang) * 5, y - h - 4 + Math.sin(ang) * 5);
    ctx.lineTo(x + Math.cos(ang + 0.4) * (5 + len * 0.5), y - h - 4 + Math.sin(ang + 0.4) * (5 + len * 0.5));
    ctx.lineTo(x + Math.cos(ang) * (5 + len), y - h - 4 + Math.sin(ang) * (5 + len));
    ctx.stroke();
  }
}

function drawFlameTower(ctx, spot, time, angle, justFired, level) {
  const x = spot.x;
  const y = spot.y - 8;
  // Brass fuel tank.
  ctx.fillStyle = ['#b8863a', '#c4903a', '#d09a3a'][level];
  ctx.strokeStyle = '#6e4e1e';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x - 11 - level, y - 12 - level, 22 + level * 2, 18 + level, 6);
  ctx.strokeStyle = 'rgba(110,78,30,0.6)'; // tank bands
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 10, y - 5);
  ctx.lineTo(x + 10, y - 5);
  ctx.moveTo(x - 10, y + 1);
  ctx.lineTo(x + 10, y + 1);
  ctx.stroke();
  // Pressure gauge.
  ctx.fillStyle = '#eee6c8';
  ctx.beginPath();
  ctx.arc(x - 5, y - 6, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#b8403a';
  ctx.beginPath();
  ctx.moveTo(x - 5, y - 6);
  ctx.lineTo(x - 5 + Math.cos(time * 2) * 2, y - 6 + Math.sin(time * 2) * 2);
  ctx.stroke();
  // Nozzle aimed at the target.
  const nx = x + Math.cos(angle) * 14;
  const ny = y - 2 + Math.sin(angle) * 14;
  ctx.strokeStyle = '#3b4046';
  ctx.lineWidth = 5 + level;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y - 2);
  ctx.lineTo(nx, ny);
  ctx.stroke();
  // Pilot flame at the nozzle, bigger while firing.
  const f = (justFired ? 7 : 3) + Math.sin(time * 25) * 1.2;
  ctx.fillStyle = '#ff9f45';
  ctx.beginPath();
  ctx.arc(nx + Math.cos(angle) * 3, ny + Math.sin(angle) * 3, f, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffe08a';
  ctx.beginPath();
  ctx.arc(nx + Math.cos(angle) * 3, ny + Math.sin(angle) * 3, f * 0.5, 0, Math.PI * 2);
  ctx.fill();
  if (level >= 2) {
    // Twin side tanks on the top tier.
    ctx.fillStyle = '#9b7030';
    ctx.strokeStyle = '#6e4e1e';
    ctx.lineWidth = 1;
    roundRect(ctx, x - 17, y - 8, 5, 12, 2.5);
    roundRect(ctx, x + 12, y - 8, 5, 12, 2.5);
  }
}

function drawLaserTower(ctx, spot, time, angle, multiplier, level) {
  const x = spot.x;
  const y = spot.y;
  const h = 26 + level * 5;
  // Sleek dark pillar with a pink seam.
  ctx.fillStyle = '#2b2634';
  ctx.strokeStyle = '#15121b';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 8 - level, y + 4);
  ctx.lineTo(x - 5, y - h);
  ctx.lineTo(x + 5, y - h);
  ctx.lineTo(x + 8 + level, y + 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const hot = multiplier > 0 ? 0.5 + (multiplier - 1) / 4 : 0.25 + Math.sin(time * 2) * 0.1;
  ctx.strokeStyle = `rgba(255,79,216,${hot})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y + 2);
  ctx.lineTo(x, y - h + 4);
  ctx.stroke();
  // Emitter head swivels toward the target.
  const hy = y - h - 4;
  ctx.fillStyle = '#4a4458';
  ctx.strokeStyle = '#15121b';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, hy, 7 + level, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#8a7fa0';
  ctx.lineWidth = 4 + level;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, hy);
  ctx.lineTo(x + Math.cos(angle) * (10 + level), hy + Math.sin(angle) * (10 + level));
  ctx.stroke();
  // Lens glow scales with how hot the beam is running.
  ctx.fillStyle = `rgba(255,79,216,${Math.min(1, hot + 0.2)})`;
  ctx.beginPath();
  ctx.arc(x + Math.cos(angle) * (11 + level), hy + Math.sin(angle) * (11 + level), 2.5 + hot * 2, 0, Math.PI * 2);
  ctx.fill();
  if (level >= 1) {
    // Cooling fins.
    ctx.strokeStyle = '#5c5570';
    ctx.lineWidth = 1.5;
    for (const fy of [-10, -16, -22]) {
      ctx.beginPath();
      ctx.moveTo(x - 9 - level, y + fy);
      ctx.lineTo(x - 5, y + fy);
      ctx.moveTo(x + 5, y + fy);
      ctx.lineTo(x + 9 + level, y + fy);
      ctx.stroke();
    }
  }
}

function drawBeams(ctx, game, time) {
  ctx.globalCompositeOperation = 'lighter';
  game.towers.forEach((tower, i) => {
    if (!tower || !tower.beamTargetId) return;
    const target = game.enemies.find((e) => e.id === tower.beamTargetId && e.alive);
    if (!target) return;
    const spot = game.level.buildSpots[i];
    const pos = game.path.positionAt(target.dist);
    const h = 26 + tower.level * 5 + 4;
    const mult = game.beamMultiplier(tower);
    const stats = game.towerStats(tower);
    const heat = (mult - 1) / (stats.rampMultiplier - 1);
    const sx = spot.x + Math.cos(tower.angle) * (11 + tower.level);
    const sy = spot.y - h + Math.sin(tower.angle) * (11 + tower.level);
    ctx.lineCap = 'round';
    ctx.strokeStyle = `rgba(255,79,216,${0.25 + heat * 0.25})`;
    ctx.lineWidth = 6 + heat * 6 + Math.sin(time * 30) * 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    ctx.strokeStyle = heat > 0.8 ? '#ffffff' : '#ffb3ec';
    ctx.lineWidth = 1.5 + heat * 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    ctx.fillStyle = `rgba(255,255,255,${0.5 + heat * 0.4})`;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 3 + heat * 4 + Math.sin(time * 40) * 1, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalCompositeOperation = 'source-over';
}

function drawBolts(ctx, bolts) {
  ctx.globalCompositeOperation = 'lighter';
  for (const bolt of bolts) {
    const frac = Math.max(0, bolt.life / bolt.maxLife);
    for (let i = 0; i < bolt.points.length - 1; i++) {
      const a = bolt.points[i];
      const b = bolt.points[i + 1];
      const segs = 6;
      const jag = [];
      for (let s2 = 0; s2 <= segs; s2++) {
        const t = s2 / segs;
        const jitter = s2 === 0 || s2 === segs ? 0 : (Math.random() - 0.5) * 12;
        const nx = -(b.y - a.y);
        const ny = b.x - a.x;
        const len = Math.hypot(nx, ny) || 1;
        jag.push({ x: a.x + (b.x - a.x) * t + (nx / len) * jitter, y: a.y + (b.y - a.y) * t + (ny / len) * jitter });
      }
      ctx.globalAlpha = frac;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#7ec8ff';
      ctx.lineWidth = 5;
      ctx.beginPath();
      jag.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      jag.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

// --- Enemies: sprite composer ------------------------------------------------

function drawEnemies(ctx, game, time) {
  const sorted = [...game.enemies].sort((a, b) => {
    return game.path.positionAt(a.dist).y - game.path.positionAt(b.dist).y;
  });
  for (const enemy of sorted) {
    const pos = game.path.positionAt(enemy.dist);
    const ahead = game.path.positionAt(enemy.dist + 2);
    const facing = ahead.x >= pos.x ? 1 : -1;
    const type = game.enemyTypes[enemy.typeId];
    const look = type.look || { body: 'round', features: [] };
    const has = (f) => look.features.includes(f);
    const stride = Math.sin(enemy.dist * 0.25);
    const floating = look.body === 'wisp';
    const bob = floating ? Math.sin(time * 4 + enemy.id) * 3 + 6 : Math.abs(stride) * 2.5;
    const x = pos.x;
    const y = pos.y - bob;
    const r = enemy.radius;
    const grow = Math.min(1, (enemy.age ?? 1) / 0.3);
    const spawnScale = 0.4 + 0.6 * (1 - (1 - grow) * (1 - grow)); // ease-out
    ctx.save();
    ctx.translate(x, pos.y);
    ctx.scale(spawnScale, spawnScale);
    ctx.translate(-x, -pos.y);

    ctx.fillStyle = 'rgba(20,40,15,0.25)';
    ctx.beginPath();
    ctx.ellipse(x, pos.y + r * 0.7, r * (floating ? 0.6 : 0.9), r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    if (!floating) {
      // Stepping feet, alternating with the stride.
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.ellipse(x - r * 0.4 + stride * r * 0.35 * facing, pos.y + r * 0.55, r * 0.28, r * 0.18, 0, 0, Math.PI * 2);
      ctx.ellipse(x + r * 0.4 - stride * r * 0.35 * facing, pos.y + r * 0.55, r * 0.28, r * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    if (has('glow')) {
      ctx.fillStyle = hexToRgba(type.color, 0.25 + Math.sin(time * 5 + enemy.id) * 0.1);
      ctx.beginPath();
      ctx.arc(x, y, r * 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
    if (has('wings')) drawWings(ctx, x, y, r, time, enemy.id, type.color);

    // Body.
    if (look.body === 'long') drawLongBody(ctx, type.color, x, y, r, facing);
    else if (look.body === 'wisp') drawWispBody(ctx, type.color, x, y, r, time, enemy.id);
    else drawBody(ctx, type.color, x, y, r, look.body === 'big');

    // Features behind the face.
    if (has('shell')) drawShell(ctx, x, y, r);
    if (has('pads')) drawPads(ctx, x, y, r);
    if (has('scarf')) drawScarf(ctx, x, y, r, facing, time);
    if (has('ears')) drawEars(ctx, type.color, x, y, r);
    if (has('horns')) drawHorns(ctx, x, y, r);
    if (has('helmet')) drawHelmet(ctx, x, y, r);
    if (has('spikes')) drawSpikes(ctx, x, y, r);
    if (has('crown')) drawCrown(ctx, x, y, r);
    if (has('hat')) drawHat(ctx, x, y, r, facing);
    if (has('flame')) drawFlame(ctx, x, y, r, time, enemy.id);

    // Face.
    if (has('wolf')) drawWolfFace(ctx, type.color, x, y, r, facing);
    else if (has('frog')) drawFrogFace(ctx, x, y, r, facing);
    else drawEyes(ctx, x, y, r, facing, !floating);

    if (has('tusks')) drawTusks(ctx, x, y, r);
    if (has('tooth')) drawTooth(ctx, x, y, r, facing);
    if (has('club')) drawClub(ctx, x, y, r, facing);
    if (has('stinger')) drawStinger(ctx, x, y, r, facing, time);

    // Status tints: icy blue while chilled, orange while burning.
    if (enemy.slow) {
      ctx.fillStyle = 'rgba(143,211,255,0.4)';
      ctx.beginPath();
      ctx.arc(x, y, r * 1.02, 0, Math.PI * 2);
      ctx.fill();
    }
    if (enemy.burn) {
      ctx.fillStyle = `rgba(255,120,40,${0.25 + Math.sin(time * 20 + enemy.id) * 0.1})`;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.02, 0, Math.PI * 2);
      ctx.fill();
    }

    // White hit-flash overlay while enemy.flash runs down.
    if (enemy.flash > 0) {
      ctx.globalAlpha = (enemy.flash / 0.12) * 0.65;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, r * 1.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Health bar (only once hurt). Bosses use the top bar instead.
    if (enemy.hp < enemy.maxHp && !enemy.boss) {
      const w = 22;
      const frac = Math.max(0, enemy.hp / enemy.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - w / 2 - 1, y - r - 10, w + 2, 5);
      ctx.fillStyle = frac > 0.5 ? '#6fd64a' : frac > 0.25 ? '#e8c33a' : '#d64545';
      ctx.fillRect(x - w / 2, y - r - 9, w * frac, 3);
    }
    ctx.restore();
  }
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function drawBody(ctx, color, x, y, r, heavy) {
  ctx.fillStyle = color;
  ctx.strokeStyle = heavy ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.35)';
  ctx.lineWidth = heavy ? 2.5 : 1.5;
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

function drawLongBody(ctx, color, x, y, r, facing) {
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(x, y, r * 1.25, r * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.3, r * 1.05, r * 0.5, 0, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.6 * facing, y + r * 0.1, r * 0.45, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawWispBody(ctx, color, x, y, r, time, id) {
  const flicker = 0.75 + Math.sin(time * 9 + id) * 0.15;
  ctx.globalAlpha = flicker;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // Trailing wisps of body behind.
  for (let i = 1; i <= 3; i++) {
    ctx.globalAlpha = flicker * (0.5 - i * 0.12);
    ctx.beginPath();
    ctx.arc(x, y + r * 0.5 * i, r * (1 - i * 0.22), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.arc(x - r * 0.25, y - r * 0.3, r * 0.4, 0, Math.PI * 2);
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

function drawWolfFace(ctx, color, x, y, r, facing) {
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); // snout
  ctx.ellipse(x + r * 1.25 * facing, y - r * 0.05, r * 0.55, r * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#1c1c1c';
  ctx.beginPath();
  ctx.arc(x + r * 1.7 * facing, y - r * 0.1, r * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color; // ears
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
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.moveTo(x + r * 0.33 * facing, y - r * 0.68);
  ctx.lineTo(x + r * 0.47 * facing, y - r * 1.2);
  ctx.lineTo(x + r * 0.62 * facing, y - r * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = color; // tail
  ctx.beginPath();
  ctx.ellipse(x - r * 1.35 * facing, y - r * 0.35, r * 0.5, r * 0.26, facing * 0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffd34d'; // eye
  ctx.beginPath();
  ctx.arc(x + r * 0.75 * facing, y - r * 0.3, r * 0.17, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1c1c1c';
  ctx.beginPath();
  ctx.arc(x + r * 0.8 * facing, y - r * 0.3, r * 0.08, 0, Math.PI * 2);
  ctx.fill();
}

function drawFrogFace(ctx, x, y, r, facing) {
  for (const side of [-0.45, 0.45]) {
    ctx.fillStyle = '#e8f0b0';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x + side * r, y - r * 0.85, r * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1c1c1c';
    ctx.beginPath();
    ctx.arc(x + side * r + r * 0.1 * facing, y - r * 0.85, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); // wide mouth
  ctx.arc(x + r * 0.15 * facing, y + r * 0.1, r * 0.55, 0.2, Math.PI - 0.2);
  ctx.stroke();
}

function drawEars(ctx, color, x, y, r) {
  ctx.fillStyle = color;
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
}

function drawTooth(ctx, x, y, r, facing) {
  ctx.fillStyle = '#e8e2d4';
  ctx.beginPath();
  ctx.moveTo(x + r * 0.15 * facing, y + r * 0.45);
  ctx.lineTo(x + r * 0.3 * facing, y + r * 0.75);
  ctx.lineTo(x + r * 0.45 * facing, y + r * 0.45);
  ctx.fill();
}

function drawClub(ctx, x, y, r, facing) {
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

function drawHelmet(ctx, x, y, r) {
  ctx.fillStyle = '#6b7178';
  ctx.strokeStyle = '#4a4f55';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y - r * 0.45, r * 0.72, Math.PI, 0);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#4a4f55'; // nose guard
  ctx.fillRect(x - 1, y - r * 0.5, 2, r * 0.35);
}

function drawHorns(ctx, x, y, r) {
  ctx.fillStyle = '#e8e2d4';
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + side * r * 0.6, y - r * 0.75);
    ctx.lineTo(x + side * r * 1.1, y - r * 1.3);
    ctx.lineTo(x + side * r * 0.35, y - r * 0.95);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawPads(ctx, x, y, r) {
  ctx.fillStyle = '#6b7178';
  ctx.strokeStyle = '#4a4f55';
  ctx.lineWidth = 1;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(x + side * r * 0.85, y + r * 0.05, r * 0.42, r * 0.3, side * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.strokeStyle = '#4a3a22'; // chest strap
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.7, y - r * 0.15);
  ctx.lineTo(x + r * 0.7, y + r * 0.45);
  ctx.stroke();
}

function drawTusks(ctx, x, y, r) {
  ctx.fillStyle = '#e8e2d4';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + side * r * 0.45, y + r * 0.5);
    ctx.lineTo(x + side * r * 0.6, y - r * 0.05);
    ctx.lineTo(x + side * r * 0.2, y + r * 0.3);
    ctx.closePath();
    ctx.fill();
  }
}

function drawShell(ctx, x, y, r) {
  // Segmented carapace plates across the back.
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1.5;
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.arc(x, y + i * r * 0.35, r * 0.95, Math.PI + 0.4, Math.PI * 2 - 0.4);
    ctx.stroke();
  }
}

function drawSpikes(ctx, x, y, r) {
  ctx.fillStyle = '#d8d2c4';
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const a = Math.PI + (i / 4) * Math.PI;
    const bx = x + Math.cos(a) * r * 0.85;
    const by = y + Math.sin(a) * r * 0.85;
    ctx.beginPath();
    ctx.moveTo(bx + Math.sin(a) * 2.5, by - Math.cos(a) * 2.5);
    ctx.lineTo(x + Math.cos(a) * r * 1.4, y + Math.sin(a) * r * 1.4);
    ctx.lineTo(bx - Math.sin(a) * 2.5, by + Math.cos(a) * 2.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawCrown(ctx, x, y, r) {
  const top = y - r * 1.05;
  ctx.fillStyle = '#ffd700';
  ctx.strokeStyle = '#a3780a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.5, top);
  ctx.lineTo(x - r * 0.5, top - r * 0.4);
  ctx.lineTo(x - r * 0.25, top - r * 0.15);
  ctx.lineTo(x, top - r * 0.5);
  ctx.lineTo(x + r * 0.25, top - r * 0.15);
  ctx.lineTo(x + r * 0.5, top - r * 0.4);
  ctx.lineTo(x + r * 0.5, top);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#e03a3a';
  ctx.beginPath();
  ctx.arc(x, top - r * 0.12, r * 0.1, 0, Math.PI * 2);
  ctx.fill();
}

function drawHat(ctx, x, y, r, facing) {
  ctx.fillStyle = '#2b2234';
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath(); // brim
  ctx.ellipse(x, y - r * 0.6, r * 1.1, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath(); // crooked cone
  ctx.moveTo(x - r * 0.6, y - r * 0.65);
  ctx.lineTo(x + r * 0.3 * facing, y - r * 1.7);
  ctx.lineTo(x + r * 0.6, y - r * 0.65);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#c9a53a'; // buckle band
  ctx.fillRect(x - r * 0.45, y - r * 0.85, r * 0.9, r * 0.14);
}

function drawScarf(ctx, x, y, r, facing, time) {
  ctx.strokeStyle = '#b8403a';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y + r * 0.15, r * 0.75, 0.2, Math.PI - 0.2);
  ctx.stroke();
  const flap = Math.sin(time * 6) * 2;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.7 * facing, y + r * 0.3);
  ctx.lineTo(x - r * 1.4 * facing, y + r * 0.1 + flap);
  ctx.stroke();
}

function drawWings(ctx, x, y, r, time, id, color) {
  const flap = Math.sin(time * 18 + id) * 0.5;
  ctx.fillStyle = hexToRgba(color, 0.45);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(x + side * r * 1.1, y - r * 0.3 - flap * r, r * 0.9, r * 0.4 + flap * r * 0.3, side * (0.5 + flap), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawFlame(ctx, x, y, r, time, id) {
  const h = r * (0.9 + Math.sin(time * 12 + id) * 0.25);
  const lean = Math.sin(time * 7 + id) * r * 0.2;
  ctx.fillStyle = '#ff9f45';
  ctx.beginPath();
  ctx.moveTo(x - r * 0.4, y - r * 0.8);
  ctx.quadraticCurveTo(x + lean, y - r * 0.8 - h, x + r * 0.4, y - r * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffe08a';
  ctx.beginPath();
  ctx.moveTo(x - r * 0.2, y - r * 0.8);
  ctx.quadraticCurveTo(x + lean * 0.6, y - r * 0.8 - h * 0.55, x + r * 0.2, y - r * 0.8);
  ctx.closePath();
  ctx.fill();
}

function drawStinger(ctx, x, y, r, facing, time) {
  const curl = Math.sin(time * 4) * 0.15;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - r * 1.0 * facing, y);
  ctx.quadraticCurveTo(x - r * 1.9 * facing, y - r * (0.3 + curl), x - r * 1.5 * facing, y - r * 1.2);
  ctx.stroke();
  ctx.fillStyle = '#2b2b2b';
  ctx.beginPath();
  ctx.moveTo(x - r * 1.5 * facing, y - r * 1.2);
  ctx.lineTo(x - r * 1.2 * facing, y - r * 1.55);
  ctx.lineTo(x - r * 1.7 * facing, y - r * 1.45);
  ctx.closePath();
  ctx.fill();
}

// --- Projectiles, particles, HUD overlays -----------------------------------

function drawProjectiles(ctx, game) {
  for (const proj of game.projectiles) {
    const scale = 1 + (proj.towerLevel || 0) * 0.25;
    if (proj.towerType === 'archer') {
      const len = 10 * scale;
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
    } else if (proj.towerType === 'frost') {
      // A spinning ice shard: diamond along the flight direction.
      const l = 7 * scale;
      const w = 3 * scale;
      ctx.fillStyle = 'rgba(191,233,255,0.9)';
      ctx.strokeStyle = '#5fa8d8';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(proj.x + proj.dirX * l, proj.y + proj.dirY * l);
      ctx.lineTo(proj.x - proj.dirY * w, proj.y + proj.dirX * w);
      ctx.lineTo(proj.x - proj.dirX * l, proj.y - proj.dirY * l);
      ctx.lineTo(proj.x + proj.dirY * w, proj.y - proj.dirX * w);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (proj.towerType === 'mage') {
      ctx.strokeStyle = 'rgba(143,123,255,0.5)'; // trail
      ctx.lineWidth = 4 * scale;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(proj.prevX, proj.prevY);
      ctx.lineTo(proj.x, proj.y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(143,123,255,0.35)';
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, 7 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e6dcff';
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, 3.5 * scale, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Lob: lift the ball along a sine arc between launch and target,
      // keeping a shadow on the ground beneath it.
      const traveled = Math.hypot(proj.x - (proj.startX ?? proj.x), proj.y - (proj.startY ?? proj.y));
      const remaining = Math.hypot(proj.lastTarget.x - proj.x, proj.lastTarget.y - proj.y);
      const total = traveled + remaining || 1;
      const lift = Math.sin((traveled / total) * Math.PI) * Math.min(42, total * 0.3);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(proj.x, proj.y + 3, 4 * scale, 2 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2f3338';
      ctx.beginPath();
      ctx.arc(proj.x, proj.y - lift, 4.5 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#596067';
      ctx.beginPath();
      ctx.arc(proj.x - 1.3, proj.y - lift - 1.3, 1.6 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawParticleList(ctx, particles, glow = false) {
  for (const p of particles) {
    const frac = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = frac;
    // Sparks and rings add light; smoke and scorch stay opaque.
    ctx.globalCompositeOperation = glow && p.shape !== 'smoke' && p.shape !== 'scorch' ? 'lighter' : 'source-over';
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
  ctx.globalCompositeOperation = 'source-over';
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

function drawBossBar(ctx, game) {
  const boss = game.boss;
  if (!boss) return;
  const type = game.enemyTypes[boss.typeId];
  const w = 320;
  const x = (game.level.width - w) / 2;
  const y = 14;
  const frac = Math.max(0, boss.hp / boss.maxHp);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x - 2, y - 2, w + 4, 16);
  ctx.fillStyle = '#4a1010';
  ctx.fillRect(x, y, w, 12);
  ctx.fillStyle = frac > 0.5 ? '#d64545' : '#ff7a45';
  ctx.fillRect(x, y, w * frac, 12);
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 3;
  ctx.strokeText(type.name, game.level.width / 2, y + 10);
  ctx.fillText(type.name, game.level.width / 2, y + 10);
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
