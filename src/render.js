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

  // Screen shake: a small decaying offset applied to everything but the HUD.
  ctx.save();
  if (effects.shake > 0) {
    ctx.translate(Math.sin(time * 47) * effects.shake, Math.cos(time * 31) * effects.shake * 0.7);
  }
  ctx.drawImage(scene.terrain, -8, -8, level.width + 16, level.height + 16);

  drawWaterAnimation(ctx, level, time);
  drawParticleList(ctx, effects.groundParticles);
  drawBuildSpots(ctx, game, ui, time);
  drawDecorations(ctx, scene.decor, level.theme, time);
  drawTowers(ctx, game, ui, time);
  drawEnemies(ctx, game, time);
  drawProjectiles(ctx, game);
  drawBeams(ctx, game, time);
  drawFlameJets(ctx, game, time);
  drawBolts(ctx, effects.bolts);
  drawCloudShadows(ctx, scene.clouds, level, time);
  drawBeaconAuras(ctx, game, time);
  drawParticleList(ctx, effects.particles, true);
  ctx.restore();
  drawVignette(ctx, scene.vignette, level);
  if (effects.flash) {
    ctx.globalAlpha = Math.max(0, Math.min(1, effects.flash.alpha));
    ctx.fillStyle = effects.flash.color;
    ctx.fillRect(0, 0, level.width, level.height);
    ctx.globalAlpha = 1;
  }
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
  // Soft, small mottles with blurred edges so the ground reads as texture
  // rather than a scatter of hard-edged blobs.
  for (let i = 0; i < 160; i++) {
    const x = rng() * level.width;
    const y = rng() * level.height;
    const r = 10 + rng() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = rng() > 0.5 ? theme.mottleLight : theme.mottleDark;
    g.addColorStop(0, c);
    g.addColorStop(1, transparentOf(c)); // same hue at alpha 0 avoids grey fringes
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.45 + rng() * 0.4), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  drawGroundTexture(ctx, level, rng);
  drawThemeGroundFeatures(ctx, game, rng);

  for (const w of level.water) drawWaterBase(ctx, w, theme);

  // Path: dark edge, fill, worn center line, then wear and tear.
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
  // Inner highlight on the sun side gives the road a little relief.
  ctx.save();
  ctx.translate(-1.5, -1.5);
  tracePath(ctx, game.path.waypoints);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 24;
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.setLineDash([2, 14]);
  tracePath(ctx, game.path.waypoints);
  ctx.strokeStyle = theme.pathLine;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
  drawPathDetail(ctx, game, theme, rng);
  for (const w of level.water) drawShoreDetail(ctx, w, theme, rng);

  drawThemeSetPieces(ctx, game, rng);
  drawCave(ctx, level, theme);
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

function drawCave(ctx, level, theme) {
  const p = level.path[0];
  const x = Math.max(16, Math.min(level.width - 16, p.x));
  const y = Math.max(16, Math.min(level.height - 16, p.y));
  // Rock rim: a few irregular boulders stacked around the mouth.
  const rim = ['#5a5248', '#4a4238', '#6a6258'];
  for (let i = 0; i < 9; i++) {
    const a = Math.PI + (i / 8) * Math.PI;
    const rx = x + Math.cos(a) * 26;
    const ry = y + Math.sin(a) * 22 + 2;
    ctx.fillStyle = rim[i % 3];
    ctx.strokeStyle = '#2f2a24';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(rx, ry, 8 + (i % 2) * 3, 6 + (i % 3), a, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = '#4a4238';
  ctx.beginPath();
  ctx.arc(x, y, 22, Math.PI, 0);
  ctx.fill();
  const g = ctx.createRadialGradient(x, y + 4, 2, x, y, 18);
  g.addColorStop(0, '#000000');
  g.addColorStop(1, '#17120d');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, 16, Math.PI, 0);
  ctx.fill();
  // Something is watching from inside.
  ctx.fillStyle = 'rgba(255,80,60,0.85)';
  ctx.beginPath();
  ctx.arc(x - 4, y - 5, 1.3, 0, Math.PI * 2);
  ctx.arc(x + 4, y - 5, 1.3, 0, Math.PI * 2);
  ctx.fill();
  // Moss / frost / ash on the rocks per theme.
  ctx.fillStyle = theme.lava ? 'rgba(255,120,40,0.25)' : theme.lilyPads ? 'rgba(90,140,60,0.45)' : 'rgba(255,255,255,0.12)';
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(x - 20 + i * 10, y - 16 + (i % 2) * 4, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCastle(ctx, level, theme) {
  const p = level.path[level.path.length - 1];
  const x = Math.max(34, Math.min(level.width - 34, p.x));
  const y = Math.max(64, Math.min(level.height - 20, p.y));
  const stone = theme.stone;
  const dark = theme.stoneDark;
  // Ground shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(x, y + 12, 40, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  // Curtain wall with brick courses.
  ctx.fillStyle = stone;
  ctx.fillRect(x - 28, y - 34, 56, 46);
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1;
  for (let row = 0; row < 6; row++) {
    const ry = y - 30 + row * 7;
    ctx.beginPath();
    ctx.moveTo(x - 28, ry);
    ctx.lineTo(x + 28, ry);
    ctx.stroke();
    for (let c = 0; c < 4; c++) {
      const cx = x - 28 + ((c + (row % 2) * 0.5) * 56) / 4;
      ctx.beginPath();
      ctx.moveTo(cx, ry);
      ctx.lineTo(cx, ry + 7);
      ctx.stroke();
    }
  }
  // Corner towers.
  for (const side of [-1, 1]) {
    const tx = x + side * 30;
    ctx.fillStyle = dark;
    ctx.fillRect(tx - 8, y - 48, 16, 60);
    ctx.fillStyle = stone;
    ctx.fillRect(tx - 7, y - 46, 14, 56);
    for (let i = 0; i < 3; i++) ctx.fillRect(tx - 8 + i * 6, y - 54, 4, 7);
    ctx.fillStyle = '#2b2520';
    ctx.fillRect(tx - 1.5, y - 36, 3, 8);
    // Conical roof with a glowing window beneath.
    ctx.fillStyle = '#7a3a3a';
    ctx.beginPath();
    ctx.moveTo(tx - 10, y - 54);
    ctx.lineTo(tx, y - 70);
    ctx.lineTo(tx + 10, y - 54);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,210,120,0.9)';
    ctx.fillRect(tx - 1.5, y - 18, 3, 5);
  }
  // Crenellations and string course.
  ctx.fillStyle = dark;
  for (let i = 0; i < 4; i++) ctx.fillRect(x - 20 + i * 12, y - 42, 7, 9);
  ctx.fillRect(x - 28, y - 14, 56, 2);
  // Gate with portcullis.
  ctx.fillStyle = '#5b4632';
  ctx.beginPath();
  ctx.arc(x, y + 10, 11, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(x - 11, y + 10, 22, 2);
  ctx.strokeStyle = '#2b2520';
  ctx.lineWidth = 1.2;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(x + i * 4, y + 10 - Math.sqrt(Math.max(0, 121 - (i * 4) ** 2)));
    ctx.lineTo(x + i * 4, y + 12);
    ctx.stroke();
  }
  // Arrow slits and a lit window.
  ctx.fillStyle = '#2b2520';
  ctx.fillRect(x - 17, y - 28, 3, 8);
  ctx.fillRect(x + 14, y - 28, 3, 8);
  ctx.fillStyle = 'rgba(255,210,120,0.9)';
  ctx.fillRect(x - 2, y - 30, 4, 6);
  // Banners on the towers and a flag over the gate.
  ctx.strokeStyle = dark;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - 42);
  ctx.lineTo(x, y - 62);
  ctx.stroke();
  ctx.fillStyle = '#c33c3c';
  ctx.beginPath();
  ctx.moveTo(x, y - 62);
  ctx.lineTo(x + 16, y - 57);
  ctx.lineTo(x, y - 52);
  ctx.fill();
  ctx.fillStyle = '#3f6fb5';
  for (const side of [-1, 1]) {
    ctx.fillRect(x + side * 30 - 3, y - 30, 6, 12);
    ctx.beginPath();
    ctx.moveTo(x + side * 30 - 3, y - 18);
    ctx.lineTo(x + side * 30, y - 14);
    ctx.lineTo(x + side * 30 + 3, y - 18);
    ctx.fill();
  }
}

// --- Ground texture, path wear, shorelines ------------------------------------------------

// 'rgba(r,g,b,a)' -> the same colour fully transparent, for clean gradient falloff.
function transparentOf(color) {
  const m = /rgba?\(([^)]+)\)/.exec(color);
  if (!m) return 'rgba(0,0,0,0)';
  const [r, g, b] = m[1].split(',').map((v) => v.trim());
  return `rgba(${r},${g},${b},0)`;
}

function drawGroundTexture(ctx, level, rng) {
  const { theme } = level;
  const w = level.width;
  const h = level.height;
  if (theme.weather === 'leaves' || theme.lilyPads) {
    // Grass blades: thousands of short strokes in nearby greens.
    const greens = theme.lilyPads ? ['#6f8f45', '#52703a', '#7f9d4e', '#415f2c'] : ['#83b85e', '#6aa14e', '#95c468', '#5d9444'];
    ctx.lineWidth = 1;
    for (let i = 0; i < 2600; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const len = 2 + rng() * 3;
      const lean = (rng() - 0.5) * 1.6;
      ctx.strokeStyle = greens[Math.floor(rng() * greens.length)];
      ctx.globalAlpha = 0.35 + rng() * 0.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + lean, y - len);
      ctx.stroke();
    }
  } else if (theme.weather === 'snow') {
    // Snow sparkle and faint wind-blown drifts.
    for (let i = 0; i < 1400; i++) {
      ctx.globalAlpha = 0.3 + rng() * 0.6;
      ctx.fillStyle = rng() > 0.5 ? '#ffffff' : '#dbe8f1';
      ctx.fillRect(rng() * w, rng() * h, 1.2, 1.2);
    }
    ctx.lineWidth = 1;
    for (let i = 0; i < 120; i++) {
      const x = rng() * w;
      const y = rng() * h;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 15, y - 3, x + 30 + rng() * 20, y);
      ctx.stroke();
    }
  } else if (theme.weather === 'sand') {
    // Sand grain and wind ripples.
    for (let i = 0; i < 2200; i++) {
      ctx.globalAlpha = 0.2 + rng() * 0.4;
      ctx.fillStyle = rng() > 0.5 ? '#f3dca0' : '#b98f4e';
      ctx.fillRect(rng() * w, rng() * h, 1.3, 1.3);
    }
    ctx.lineWidth = 1;
    for (let i = 0; i < 160; i++) {
      const x = rng() * w;
      const y = rng() * h;
      ctx.strokeStyle = 'rgba(160,120,60,0.22)';
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 10, y + 3, x + 24 + rng() * 16, y);
      ctx.stroke();
    }
  } else if (theme.lava) {
    // Ash speckle and faint cooling-crust cracks.
    for (let i = 0; i < 2000; i++) {
      ctx.globalAlpha = 0.25 + rng() * 0.45;
      ctx.fillStyle = rng() > 0.7 ? '#6a5a58' : '#241c1c';
      ctx.fillRect(rng() * w, rng() * h, 1.4, 1.4);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.globalAlpha = 1;
    for (let i = 0; i < 90; i++) {
      let x = rng() * w;
      let y = rng() * h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (rng() - 0.5) * 24;
        y += (rng() - 0.5) * 24;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// Perpendicular unit normal of the path at distance d.
function pathNormal(game, d) {
  const a = game.path.positionAt(Math.max(0, d - 2));
  const b = game.path.positionAt(d + 2);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
}

function drawPathDetail(ctx, game, theme, rng) {
  const total = game.path.totalLength;
  // Wheel ruts: two faint lines either side of the center.
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    for (let d = 0; d <= total; d += 6) {
      const p = game.path.positionAt(d);
      const n = pathNormal(game, d);
      const x = p.x + n.x * 6 * side;
      const y = p.y + n.y * 6 * side;
      if (d === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Pebbles and footprints scattered on the road.
  for (let d = 10; d < total; d += 9) {
    if (rng() > 0.55) continue;
    const p = game.path.positionAt(d);
    const n = pathNormal(game, d);
    const off = (rng() - 0.5) * 22;
    const x = p.x + n.x * off;
    const y = p.y + n.y * off;
    ctx.fillStyle = rng() > 0.5 ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.ellipse(x, y, 1 + rng() * 1.6, 0.8 + rng() * 1.2, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  // Grass tufts and edge wear where the road meets the ground.
  const tuft = theme.lava ? 'rgba(90,70,60,0.6)' : theme.weather === 'snow' ? 'rgba(255,255,255,0.7)' : theme.weather === 'sand' ? 'rgba(110,80,40,0.5)' : 'rgba(70,120,45,0.8)';
  ctx.strokeStyle = tuft;
  ctx.lineWidth = 1.2;
  for (let d = 4; d < total; d += 7) {
    if (rng() > 0.6) continue;
    const p = game.path.positionAt(d);
    const n = pathNormal(game, d);
    const side = rng() > 0.5 ? 1 : -1;
    const x = p.x + n.x * (15 + rng() * 4) * side;
    const y = p.y + n.y * (15 + rng() * 4) * side;
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + k * 1.6 + n.x * side * 2, y - 3 - Math.abs(k) + n.y * side * 2);
      ctx.stroke();
    }
  }
}

function drawShoreDetail(ctx, w, theme, rng) {
  // Foam / frost / ash line hugging the water's edge, plus a few rim stones.
  ctx.strokeStyle = theme.lava ? 'rgba(255,170,80,0.35)' : 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.ellipse(w.x, w.y, w.rx - 3, w.ry - 3, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  for (let i = 0; i < 10; i++) {
    const a = rng() * Math.PI * 2;
    const x = w.x + Math.cos(a) * (w.rx + 6 + rng() * 6);
    const y = w.y + Math.sin(a) * (w.ry + 5 + rng() * 5);
    ctx.fillStyle = theme.lava ? '#3a2a28' : rng() > 0.5 ? '#8f9296' : '#a8abaf';
    ctx.beginPath();
    ctx.ellipse(x, y, 2 + rng() * 2, 1.5 + rng(), a, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Find a spot clear of the road, build spots, and water.
function findClearSpot(game, rng, clearance, waterPad = 14) {
  const { level } = game;
  for (let attempt = 0; attempt < 60; attempt++) {
    const x = clearance + rng() * (level.width - clearance * 2);
    const y = clearance + rng() * (level.height - clearance * 2);
    if (distToPath(game, x, y) < 20 + clearance) continue;
    if (level.buildSpots.some((s) => Math.hypot(s.x - x, s.y - y) < 26 + clearance)) continue;
    if (level.water.some((w) => ((x - w.x) / (w.rx + waterPad + clearance)) ** 2 + ((y - w.y) / (w.ry + waterPad + clearance)) ** 2 < 1)) continue;
    return { x, y };
  }
  return null;
}

// --- Theme set pieces: large static features that give each map a place -------------------

// Drawn under the road and water: broad ground shapes (fields, dunes, drifts, moss, lava cracks).
function drawThemeGroundFeatures(ctx, game, rng) {
  const { theme } = game.level;
  if (theme.weather === 'leaves') {
    for (let i = 0; i < 3; i++) {
      const spot = findClearSpot(game, rng, 34);
      if (spot) drawCropField(ctx, spot.x, spot.y, 70 + rng() * 40, 44 + rng() * 24, rng);
    }
    for (let i = 0; i < 4; i++) {
      const spot = findClearSpot(game, rng, 14);
      if (spot) drawFlowerMeadow(ctx, spot.x, spot.y, rng);
    }
  } else if (theme.weather === 'snow') {
    for (let i = 0; i < 9; i++) {
      const spot = findClearSpot(game, rng, 18);
      if (spot) drawSnowDrift(ctx, spot.x, spot.y, 26 + rng() * 30, rng);
    }
    for (let i = 0; i < 4; i++) {
      const spot = findClearSpot(game, rng, 16);
      if (spot) drawIceCrack(ctx, spot.x, spot.y, rng);
    }
  } else if (theme.weather === 'sand') {
    for (let i = 0; i < 7; i++) {
      const spot = findClearSpot(game, rng, 20);
      if (spot) drawDune(ctx, spot.x, spot.y, 50 + rng() * 60, rng);
    }
    for (let i = 0; i < 4; i++) {
      const spot = findClearSpot(game, rng, 16);
      if (spot) drawCrackedEarth(ctx, spot.x, spot.y, rng);
    }
  } else if (theme.lilyPads) {
    for (let i = 0; i < 9; i++) {
      const spot = findClearSpot(game, rng, 12, 4);
      if (spot) drawMossPatch(ctx, spot.x, spot.y, 14 + rng() * 18, rng);
    }
  } else if (theme.lava) {
    for (let i = 0; i < 9; i++) {
      const spot = findClearSpot(game, rng, 14);
      if (spot) drawLavaCrack(ctx, spot.x, spot.y, rng);
    }
    for (let i = 0; i < 5; i++) {
      const spot = findClearSpot(game, rng, 18);
      if (spot) drawAshDune(ctx, spot.x, spot.y, 26 + rng() * 26, rng);
    }
  }
}

// Drawn over the road layer: objects with height (fences, hay, logs, boulders, ruins, huts).
function drawThemeSetPieces(ctx, game, rng) {
  const { theme } = game.level;
  const place = (n, clearance, fn) => {
    for (let i = 0; i < n; i++) {
      const spot = findClearSpot(game, rng, clearance);
      if (spot) fn(spot.x, spot.y);
    }
  };
  if (theme.weather === 'leaves') {
    place(4, 10, (x, y) => drawHaystack(ctx, x, y));
    place(3, 12, (x, y) => drawLog(ctx, x, y, rng, '#6b4a2b'));
    place(3, 22, (x, y) => drawFence(ctx, x, y, 3 + Math.floor(rng() * 3), rng() > 0.5));
    place(3, 10, (x, y) => drawStump(ctx, x, y));
    place(1, 30, (x, y) => drawFarmhouse(ctx, x, y));
    place(2, 12, (x, y) => drawStonePile(ctx, x, y, rng, '#8f9296', '#a8abaf'));
  } else if (theme.weather === 'snow') {
    place(6, 12, (x, y) => drawSnowBoulder(ctx, x, y, rng));
    place(3, 14, (x, y) => drawLog(ctx, x, y, rng, '#5a3f2a', true));
    place(1, 30, (x, y) => drawCabin(ctx, x, y));
    place(2, 20, (x, y) => drawFence(ctx, x, y, 3, true, true));
  } else if (theme.weather === 'sand') {
    place(2, 26, (x, y) => drawRuins(ctx, x, y, rng));
    place(1, 26, (x, y) => drawTent(ctx, x, y));
    place(3, 12, (x, y) => drawStonePile(ctx, x, y, rng, '#b08b55', '#d6b27e'));
    place(2, 12, (x, y) => drawSkull(ctx, x, y));
  } else if (theme.lilyPads) {
    place(6, 12, (x, y) => drawMangroveRoots(ctx, x, y, rng));
    place(4, 12, (x, y) => drawLog(ctx, x, y, rng, '#3f3024', false, true));
    place(3, 10, (x, y) => drawMushroomRing(ctx, x, y, rng));
    place(1, 30, (x, y) => drawStiltHut(ctx, x, y));
  } else if (theme.lava) {
    place(5, 14, (x, y) => drawBasaltColumns(ctx, x, y, rng));
    place(3, 16, (x, y) => drawFissure(ctx, x, y, rng));
    place(3, 10, (x, y) => drawSkull(ctx, x, y, true));
    place(2, 20, (x, y) => drawObsidianSpire(ctx, x, y, rng));
  }
}

function drawCropField(ctx, x, y, w, h, rng) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rng() - 0.5) * 0.3);
  ctx.fillStyle = '#9a8a4a';
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = '#6f6230';
  ctx.lineWidth = 2;
  for (let r = -h / 2 + 5; r < h / 2; r += 7) {
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 3, r);
    ctx.lineTo(w / 2 - 3, r);
    ctx.stroke();
  }
  ctx.fillStyle = '#b8a84f';
  for (let r = -h / 2 + 5; r < h / 2; r += 7) {
    for (let c = -w / 2 + 6; c < w / 2 - 3; c += 6) {
      ctx.beginPath();
      ctx.arc(c + (rng() - 0.5) * 2, r - 2, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = '#5f4a26'; // fence around the field
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6);
  ctx.fillStyle = '#5f4a26';
  for (let c = -w / 2 - 3; c <= w / 2 + 3; c += 12) {
    ctx.fillRect(c - 1, -h / 2 - 7, 2, 6);
    ctx.fillRect(c - 1, h / 2 - 1, 2, 6);
  }
  ctx.restore();
}

function drawFlowerMeadow(ctx, x, y, rng) {
  const colors = ['#e8e26e', '#e2918f', '#e8e8e8', '#c9a1ff', '#ffb347'];
  for (let i = 0; i < 18; i++) {
    const a = rng() * Math.PI * 2;
    const d = rng() * 22;
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.6, 1.6 + rng(), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHaystack(ctx, x, y) {
  shadow(ctx, x, y + 7, 12, 4);
  ctx.fillStyle = '#d9b84f';
  ctx.strokeStyle = '#a3842a';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x - 12, y + 6);
  ctx.quadraticCurveTo(x - 12, y - 10, x, y - 14);
  ctx.quadraticCurveTo(x + 12, y - 10, x + 12, y + 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(x - 8 + i * 3, y + 4);
    ctx.lineTo(x - 6 + i * 3, y - 6 + (i % 2) * 2);
    ctx.stroke();
  }
}

function drawLog(ctx, x, y, rng, color, snowy = false, mossy = false) {
  const a = (rng() - 0.5) * 1.2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  shadow(ctx, 0, 4, 16, 4);
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(-16, -4, 32, 8, 3) : ctx.rect(-16, -4, 32, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#c9a86a';
  ctx.beginPath();
  ctx.ellipse(16, 0, 2.5, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#8a6a3a';
  ctx.beginPath();
  ctx.ellipse(16, 0, 1.2, 2, 0, 0, Math.PI * 2);
  ctx.stroke();
  if (snowy) {
    ctx.fillStyle = '#eef3f7';
    ctx.fillRect(-15, -5, 30, 3);
  }
  if (mossy) {
    ctx.fillStyle = 'rgba(110,160,70,0.8)';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(-10 + i * 7, -3, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawFence(ctx, x, y, posts, horizontal, snowy = false) {
  ctx.strokeStyle = '#5f4a26';
  ctx.fillStyle = '#6b4a2b';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < posts; i++) {
    const px = horizontal ? x - ((posts - 1) * 14) / 2 + i * 14 : x;
    const py = horizontal ? y : y - ((posts - 1) * 12) / 2 + i * 12;
    ctx.fillRect(px - 1.5, py - 10, 3, 12);
    if (snowy) {
      ctx.fillStyle = '#eef3f7';
      ctx.fillRect(px - 2, py - 11, 4, 2);
      ctx.fillStyle = '#6b4a2b';
    }
  }
  const x0 = horizontal ? x - ((posts - 1) * 14) / 2 : x;
  const x1 = horizontal ? x + ((posts - 1) * 14) / 2 : x;
  const y0 = horizontal ? y : y - ((posts - 1) * 12) / 2;
  const y1 = horizontal ? y : y + ((posts - 1) * 12) / 2;
  for (const dy of [-7, -3]) {
    ctx.beginPath();
    ctx.moveTo(x0, y0 + dy);
    ctx.lineTo(x1, y1 + dy);
    ctx.stroke();
  }
}

function drawStump(ctx, x, y) {
  shadow(ctx, x, y + 4, 7, 3);
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(x - 5, y - 4, 10, 8);
  ctx.fillStyle = '#c9a86a';
  ctx.beginPath();
  ctx.ellipse(x, y - 4, 5, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#8a6a3a';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(x, y - 4, 2.5, 1.2, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function drawStonePile(ctx, x, y, rng, dark, light) {
  for (let i = 0; i < 5; i++) {
    drawRock(ctx, x + (rng() - 0.5) * 16, y + (rng() - 0.5) * 8, dark, light);
  }
}

function drawFarmhouse(ctx, x, y) {
  shadow(ctx, x, y + 14, 24, 6);
  ctx.fillStyle = '#d9c9a3';
  ctx.strokeStyle = '#8a7a5a';
  ctx.lineWidth = 1.2;
  ctx.fillRect(x - 18, y - 8, 36, 20);
  ctx.strokeRect(x - 18, y - 8, 36, 20);
  ctx.fillStyle = '#5b4632'; // door and windows
  ctx.fillRect(x - 4, y, 8, 12);
  ctx.fillStyle = 'rgba(255,210,120,0.9)';
  ctx.fillRect(x - 14, y - 3, 6, 6);
  ctx.fillRect(x + 8, y - 3, 6, 6);
  ctx.fillStyle = '#9a4a3a'; // roof
  ctx.beginPath();
  ctx.moveTo(x - 21, y - 8);
  ctx.lineTo(x, y - 24);
  ctx.lineTo(x + 21, y - 8);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#6e3328';
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(x - 21 + i * 5, y - 8 - i * 3.8);
    ctx.lineTo(x + 21 - i * 5, y - 8 - i * 3.8);
    ctx.stroke();
  }
  ctx.fillStyle = '#7d848c'; // chimney
  ctx.fillRect(x + 9, y - 22, 5, 9);
}

function drawSnowDrift(ctx, x, y, r, rng) {
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.2, 2, x, y, r);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * (0.4 + rng() * 0.2), (rng() - 0.5) * 0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(160,190,210,0.35)'; // shaded lee side
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(x, y + 2, r * 0.9, r * 0.4, 0, 0.2, Math.PI - 0.2);
  ctx.stroke();
}

function drawIceCrack(ctx, x, y, rng) {
  ctx.strokeStyle = 'rgba(120,170,210,0.55)';
  ctx.lineWidth = 1.2;
  let cx = x;
  let cy = y;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  for (let k = 0; k < 6; k++) {
    cx += (rng() - 0.3) * 18;
    cy += (rng() - 0.5) * 14;
    ctx.lineTo(cx, cy);
    if (rng() > 0.6) {
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + (rng() - 0.5) * 12, cy + (rng() - 0.5) * 12);
      ctx.moveTo(cx, cy);
    }
  }
  ctx.stroke();
}

function drawSnowBoulder(ctx, x, y, rng) {
  const r = 7 + rng() * 6;
  shadow(ctx, x, y + r * 0.6, r * 1.1, r * 0.4);
  ctx.fillStyle = '#9aa6b0';
  ctx.strokeStyle = '#6b7680';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - r, y + r * 0.5);
  ctx.lineTo(x - r * 0.6, y - r * 0.6);
  ctx.lineTo(x + r * 0.4, y - r * 0.8);
  ctx.lineTo(x + r, y + r * 0.2);
  ctx.lineTo(x + r * 0.6, y + r * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#eef3f7';
  ctx.beginPath();
  ctx.moveTo(x - r * 0.6, y - r * 0.6);
  ctx.lineTo(x + r * 0.4, y - r * 0.8);
  ctx.lineTo(x + r * 0.7, y - r * 0.3);
  ctx.lineTo(x - r * 0.2, y - r * 0.15);
  ctx.closePath();
  ctx.fill();
}

function drawCabin(ctx, x, y) {
  shadow(ctx, x, y + 14, 22, 6);
  ctx.fillStyle = '#6b4a2b';
  ctx.strokeStyle = '#3f2e1a';
  ctx.lineWidth = 1;
  ctx.fillRect(x - 16, y - 6, 32, 18);
  for (let r = -4; r < 12; r += 4) {
    ctx.beginPath();
    ctx.moveTo(x - 16, y + r);
    ctx.lineTo(x + 16, y + r);
    ctx.stroke();
  }
  ctx.fillStyle = '#3f2e1a';
  ctx.fillRect(x - 3, y + 2, 6, 10);
  ctx.fillStyle = 'rgba(255,210,120,0.9)';
  ctx.fillRect(x + 7, y - 2, 5, 5);
  ctx.fillStyle = '#eef3f7'; // snowy roof
  ctx.beginPath();
  ctx.moveTo(x - 19, y - 6);
  ctx.lineTo(x, y - 20);
  ctx.lineTo(x + 19, y - 6);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#5a5a60';
  ctx.fillRect(x + 7, y - 19, 4, 8);
}

function drawDune(ctx, x, y, r, rng) {
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 2, x, y, r);
  g.addColorStop(0, 'rgba(255,235,180,0.55)');
  g.addColorStop(1, 'rgba(255,235,180,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.35, (rng() - 0.5) * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(150,100,40,0.18)'; // shadow on the lee side
  ctx.beginPath();
  ctx.ellipse(x + r * 0.1, y + r * 0.12, r * 0.95, r * 0.22, 0, 0, Math.PI);
  ctx.fill();
}

function drawCrackedEarth(ctx, x, y, rng) {
  ctx.strokeStyle = 'rgba(120,80,30,0.45)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    let cx = x + (rng() - 0.5) * 10;
    let cy = y + (rng() - 0.5) * 10;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (let k = 0; k < 4; k++) {
      cx += (rng() - 0.5) * 16;
      cy += (rng() - 0.5) * 12;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }
}

function drawRuins(ctx, x, y, rng) {
  shadow(ctx, x, y + 8, 26, 6);
  ctx.fillStyle = '#d6b27e';
  ctx.strokeStyle = '#a3855a';
  ctx.lineWidth = 1;
  ctx.fillRect(x - 24, y, 48, 6); // fallen plinth
  ctx.strokeRect(x - 24, y, 48, 6);
  for (let i = 0; i < 3; i++) {
    const cx = x - 16 + i * 16;
    const h = 10 + rng() * 18;
    ctx.fillRect(cx - 4, y - h, 8, h);
    ctx.strokeRect(cx - 4, y - h, 8, h);
    ctx.fillRect(cx - 6, y - h - 3, 12, 3); // capital
  }
  ctx.fillStyle = '#c9a86a';
  ctx.beginPath(); // broken drum lying beside
  ctx.ellipse(x + 30, y + 4, 7, 4, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawTent(ctx, x, y) {
  shadow(ctx, x, y + 8, 20, 5);
  ctx.fillStyle = '#b8403a';
  ctx.strokeStyle = '#6e2a26';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 20, y + 8);
  ctx.lineTo(x, y - 16);
  ctx.lineTo(x + 20, y + 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#e8c33a';
  ctx.beginPath();
  ctx.moveTo(x - 20, y + 8);
  ctx.lineTo(x - 8, y + 8);
  ctx.lineTo(x, y - 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#2b1a14';
  ctx.beginPath();
  ctx.moveTo(x - 5, y + 8);
  ctx.lineTo(x, y - 2);
  ctx.lineTo(x + 5, y + 8);
  ctx.closePath();
  ctx.fill();
}

function drawSkull(ctx, x, y, charred = false) {
  ctx.fillStyle = charred ? '#9a9088' : '#efe6d0';
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - 3, y + 2, 6, 3);
  ctx.fillStyle = '#2b2520';
  ctx.beginPath();
  ctx.arc(x - 2, y - 1, 1.3, 0, Math.PI * 2);
  ctx.arc(x + 2, y - 1, 1.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = charred ? '#9a9088' : '#efe6d0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 7, y + 3);
  ctx.lineTo(x + 18, y + 6);
  ctx.moveTo(x + 8, y + 6);
  ctx.lineTo(x + 17, y + 2);
  ctx.stroke();
}

function drawMossPatch(ctx, x, y, r, rng) {
  ctx.fillStyle = 'rgba(120,170,70,0.35)';
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.55, (rng() - 0.5) * 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(150,200,90,0.35)';
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(x + (rng() - 0.5) * r * 1.4, y + (rng() - 0.5) * r * 0.7, 2 + rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMangroveRoots(ctx, x, y, rng) {
  ctx.strokeStyle = '#4a3a28';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i - 2) * 0.45;
    ctx.beginPath();
    ctx.moveTo(x, y - 12);
    ctx.quadraticCurveTo(x + Math.cos(a) * 10, y - 4, x + Math.cos(a) * 16 + (rng() - 0.5) * 4, y + 6);
    ctx.stroke();
  }
  ctx.fillStyle = '#5c4a35';
  ctx.fillRect(x - 3, y - 26, 6, 16);
  ctx.fillStyle = '#4e7a30';
  ctx.beginPath();
  ctx.arc(x, y - 28, 9, 0, Math.PI * 2);
  ctx.fill();
}

function drawMushroomRing(ctx, x, y, rng) {
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    drawMushroom(ctx, x + Math.cos(a) * 11, y + Math.sin(a) * 6);
  }
}

function drawStiltHut(ctx, x, y) {
  shadow(ctx, x, y + 14, 20, 5);
  ctx.strokeStyle = '#4a3a28';
  ctx.lineWidth = 2.5;
  for (const sx of [-12, -4, 4, 12]) {
    ctx.beginPath();
    ctx.moveTo(x + sx, y + 12);
    ctx.lineTo(x + sx, y - 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#7a6a4a';
  ctx.strokeStyle = '#4a3a28';
  ctx.lineWidth = 1;
  ctx.fillRect(x - 16, y - 12, 32, 12);
  ctx.strokeRect(x - 16, y - 12, 32, 12);
  ctx.fillStyle = '#2b2a1a';
  ctx.fillRect(x - 3, y - 9, 6, 9);
  ctx.fillStyle = '#6f8a3a'; // thatched roof
  ctx.beginPath();
  ctx.moveTo(x - 20, y - 12);
  ctx.lineTo(x, y - 26);
  ctx.lineTo(x + 20, y - 12);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#4e6a28';
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(x - 20 + i * 5, y - 12 - i * 3.5);
    ctx.lineTo(x + 20 - i * 5, y - 12 - i * 3.5);
    ctx.stroke();
  }
}

function drawLavaCrack(ctx, x, y, rng) {
  let cx = x;
  let cy = y;
  const pts = [{ x: cx, y: cy }];
  for (let k = 0; k < 6; k++) {
    cx += (rng() - 0.5) * 26;
    cy += (rng() - 0.5) * 20;
    pts.push({ x: cx, y: cy });
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,110,40,0.35)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
  ctx.strokeStyle = '#ff8c33';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = '#ffd97a';
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

function drawAshDune(ctx, x, y, r, rng) {
  const g = ctx.createRadialGradient(x, y, 2, x, y, r);
  g.addColorStop(0, 'rgba(120,110,110,0.5)');
  g.addColorStop(1, 'rgba(120,110,110,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.4, (rng() - 0.5) * 0.6, 0, Math.PI * 2);
  ctx.fill();
}

function drawBasaltColumns(ctx, x, y, rng) {
  for (let i = 0; i < 4; i++) {
    const cx = x - 12 + i * 8;
    const h = 8 + rng() * 14;
    ctx.fillStyle = '#2a2530';
    ctx.strokeStyle = '#15121b';
    ctx.lineWidth = 1;
    ctx.fillRect(cx - 4, y - h, 8, h + 4);
    ctx.strokeRect(cx - 4, y - h, 8, h + 4);
    ctx.fillStyle = '#4a4455';
    ctx.beginPath();
    ctx.moveTo(cx - 4, y - h);
    ctx.lineTo(cx, y - h - 3);
    ctx.lineTo(cx + 4, y - h);
    ctx.lineTo(cx, y - h + 2);
    ctx.closePath();
    ctx.fill();
  }
}

function drawFissure(ctx, x, y, rng) {
  ctx.fillStyle = '#0d0a0c';
  ctx.beginPath();
  ctx.ellipse(x, y, 16 + rng() * 10, 4, (rng() - 0.5) * 1.2, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(x, y, 1, x, y, 14);
  g.addColorStop(0, 'rgba(255,140,50,0.8)');
  g.addColorStop(1, 'rgba(255,140,50,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, 12, 3, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawObsidianSpire(ctx, x, y, rng) {
  const h = 22 + rng() * 14;
  shadow(ctx, x, y + 5, 9, 3);
  ctx.fillStyle = '#1f1b24';
  ctx.strokeStyle = '#4a3f55';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 8, y + 4);
  ctx.lineTo(x - 2, y - h);
  ctx.lineTo(x + 3, y - h * 0.7);
  ctx.lineTo(x + 8, y + 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(200,120,255,0.35)';
  ctx.beginPath();
  ctx.moveTo(x - 2, y - h);
  ctx.lineTo(x - 5, y - 2);
  ctx.lineTo(x - 1, y - 4);
  ctx.closePath();
  ctx.fill();
}

function placeDecorations(game, rng) {
  const { level } = game;
  const kinds = level.theme.decor;
  const placed = [];
  let attempts = 0;
  while (placed.length < 44 && attempts++ < 700) {
    const x = 14 + rng() * (level.width - 28);
    const y = 14 + rng() * (level.height - 28);
    if (distToPath(game, x, y) < 34) continue;
    if (level.buildSpots.some((s) => Math.hypot(s.x - x, s.y - y) < 32)) continue;
    if (level.water.some((w) => ((x - w.x) / (w.rx + 14)) ** 2 + ((y - w.y) / (w.ry + 14)) ** 2 < 1)) continue;
    if (placed.some((d) => Math.hypot(d.x - x, d.y - y) < 22)) continue;
    // Trees cluster toward the map edges, like a treeline.
    const kind = kinds[Math.floor(rng() * kinds.length)];
    const edge = Math.min(x, y, level.width - x, level.height - y);
    if (['tree', 'pine', 'palm', 'willow', 'deadtree'].includes(kind) && edge > 120 && rng() < 0.5) continue;
    placed.push({ x, y, kind, seed: rng() * 10, scale: 0.75 + rng() * 0.6 });
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
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.scale(d.scale || 1, d.scale || 1);
    ctx.translate(-d.x, -d.y);
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
    ctx.restore();
  }
}

function shadow(ctx, x, y, rx, ry) {
  ctx.fillStyle = 'rgba(20,30,15,0.2)';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawTree(ctx, x, y, sway) {
  shadow(ctx, x, y + 10, 11, 4);
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(x - 2.5, y - 2, 5, 12);
  ctx.fillStyle = '#4a3220';
  ctx.fillRect(x + 0.5, y - 2, 2, 12);
  // Round deciduous canopy in three tones, swaying at the top.
  ctx.fillStyle = '#2f6b35';
  ctx.beginPath();
  ctx.arc(x + sway * 0.5, y - 12, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3f7a35';
  ctx.beginPath();
  ctx.arc(x - 4 + sway * 0.7, y - 15, 8, 0, Math.PI * 2);
  ctx.arc(x + 5 + sway * 0.7, y - 14, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5a9c48';
  ctx.beginPath();
  ctx.arc(x - 3 + sway, y - 19, 5, 0, Math.PI * 2);
  ctx.arc(x + 3 + sway, y - 18, 4, 0, Math.PI * 2);
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
    else if (tower.typeId === 'flame') drawFlameTower(ctx, spot, time, tower.angle ?? 0, tower.cooldown > 0, tower.level);
    else if (tower.typeId === 'laser') drawLaserTower(ctx, spot, time, tower.angle ?? 0, tower.beamTargetId ? game.beamMultiplier(tower) : 0, tower.level);
    else if (tower.typeId === 'mortar') drawMortarTower(ctx, spot, time, tower.angle ?? -Math.PI / 2, tower.cooldown / stats.fireInterval, tower.level);
    else if (tower.typeId === 'sniper') drawSniperTower(ctx, spot, time, tower.angle ?? 0, justFired, tower.level);
    else if (tower.typeId === 'venom') drawVenomTower(ctx, spot, time, tower.angle ?? 0, justFired, tower.level);
    else if (tower.typeId === 'beacon') drawBeaconTower(ctx, spot, time, tower.level);
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
  const roofColor = ['#b5443c', '#3f6fb5', '#b58a2a', '#8a3fb5'][level];
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
  ctx.fillStyle = ['#e8b73a', '#e8b73a', '#ffffff', '#ffd700'][level];
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
  ctx.fillStyle = ['#8d93b8', '#7f86b8', '#6f78b8', '#5f6ab8'][level];
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
  ctx.fillStyle = ['#555b61', '#4f5a66', '#5a4f4a', '#3a3f4a'][level];
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

// Flamethrower: riveted brass boiler on an iron skid, pressure gauge, valve
// wheel, fuel hose and a swivel-mounted nozzle that glows while firing.
const FLAME_NOZZLE_LEN = (level) => 15 + level * 1.5;

function drawFlameTower(ctx, spot, time, angle, firing, level) {
  const x = spot.x;
  const y = spot.y - 8;
  const flick = Math.sin(time * 23) * 0.5 + Math.sin(time * 37 + 1) * 0.5;

  // Ground shadow and iron skid.
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(x, y + 10, 16 + level, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3a3b40';
  ctx.strokeStyle = '#1f2024';
  ctx.lineWidth = 1;
  roundRect(ctx, x - 14 - level, y + 3, 28 + level * 2, 6, 2);
  ctx.fillStyle = '#26272b';
  ctx.fillRect(x - 12 - level, y + 8, 4, 3);
  ctx.fillRect(x + 8 + level, y + 8, 4, 3);

  // Side fuel tanks from tier 2, with a vertical brass gradient.
  if (level >= 1) {
    for (const sx of [x - 19 - level, x + 14 + level]) {
      const g = ctx.createLinearGradient(sx, 0, sx + 6, 0);
      g.addColorStop(0, '#6b4616');
      g.addColorStop(0.4, '#e2b25a');
      g.addColorStop(1, '#8a5e22');
      ctx.fillStyle = g;
      ctx.strokeStyle = '#4a3010';
      ctx.lineWidth = 1;
      roundRect(ctx, sx, y - 7, 6, 13, 3);
      ctx.fillStyle = '#3a3b40';
      ctx.fillRect(sx + 1.5, y - 9, 3, 2.5); // cap
    }
  }

  // Main drum: cylindrical shading, end bands, rivets, specular streak.
  const w = 24 + level * 2;
  const h = 17 + level;
  const left = x - w / 2;
  const top = y - 11 - level;
  const brass = ctx.createLinearGradient(0, top, 0, top + h);
  brass.addColorStop(0, '#7a5520');
  brass.addColorStop(0.22, '#e4b45a');
  brass.addColorStop(0.42, '#f7dc92');
  brass.addColorStop(0.7, '#c98f36');
  brass.addColorStop(1, '#5e3c12');
  ctx.fillStyle = brass;
  ctx.strokeStyle = '#4a3010';
  ctx.lineWidth = 1.5;
  roundRect(ctx, left, top, w, h, 7);
  ctx.strokeStyle = 'rgba(70,45,15,0.75)';
  ctx.lineWidth = 2;
  for (const bx of [left + 6, left + w - 6]) {
    ctx.beginPath();
    ctx.moveTo(bx, top + 1);
    ctx.lineTo(bx, top + h - 1);
    ctx.stroke();
    for (const ry of [top + 4, top + h / 2, top + h - 4]) {
      ctx.fillStyle = '#4a3010';
      ctx.beginPath();
      ctx.arc(bx, ry, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffe9b0';
      ctx.beginPath();
      ctx.arc(bx - 0.4, ry - 0.4, 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = 'rgba(255,245,210,0.55)';
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(left + 9, top + 4);
  ctx.lineTo(left + w - 9, top + 4);
  ctx.stroke();
  // Soot staining toward the nozzle side.
  const soot = ctx.createLinearGradient(x, 0, x + w / 2, 0);
  soot.addColorStop(0, 'rgba(0,0,0,0)');
  soot.addColorStop(1, 'rgba(30,20,10,0.35)');
  ctx.fillStyle = soot;
  roundRectFill(ctx, left, top, w, h, 7);

  // Pressure gauge: bezel, dial, red zone, needle, glass highlight.
  const gx = left + w * 0.32;
  const gy = top + h * 0.56;
  ctx.fillStyle = '#2b2b30';
  ctx.beginPath();
  ctx.arc(gx, gy, 4.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f3ecd6';
  ctx.beginPath();
  ctx.arc(gx, gy, 3.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#d9413a';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(gx, gy, 2.6, -0.4, 0.8);
  ctx.stroke();
  const needle = firing ? 0.3 + flick * 0.3 : -2.2 + Math.sin(time * 2) * 0.15;
  ctx.strokeStyle = '#1e1e22';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(gx, gy);
  ctx.lineTo(gx + Math.cos(needle) * 2.9, gy + Math.sin(needle) * 2.9);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.arc(gx - 1.1, gy - 1.3, 1.1, 0, Math.PI * 2);
  ctx.fill();

  // Valve wheel on top, spinning while fuel flows.
  const vx = left + w * 0.72;
  const vy = top - 3.5;
  ctx.strokeStyle = '#3b3b40';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(vx, top + 1);
  ctx.lineTo(vx, vy);
  ctx.stroke();
  ctx.strokeStyle = '#9b2626';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(vx, vy, 3.4, 0, Math.PI * 2);
  ctx.stroke();
  const spin = time * (firing ? 5 : 0.6);
  for (let k = 0; k < 3; k++) {
    const a = spin + (k * Math.PI * 2) / 3;
    ctx.beginPath();
    ctx.moveTo(vx, vy);
    ctx.lineTo(vx + Math.cos(a) * 3.4, vy + Math.sin(a) * 3.4);
    ctx.stroke();
  }

  // Fuel hose: a short loop from the valve down to the swivel.
  const sx = x;
  const sy = y - 4;
  ctx.strokeStyle = '#3a3330';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(vx, top + 1);
  ctx.bezierCurveTo(vx + 7, top - 3 + Math.sin(time * 3) * 0.4, sx + 9, sy - 7, sx + 4, sy - 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(vx, top + 0.5);
  ctx.bezierCurveTo(vx + 7, top - 3.5 + Math.sin(time * 3) * 0.4, sx + 9, sy - 7.5, sx + 4, sy - 2.5);
  ctx.stroke();
  ctx.fillStyle = '#8a8d96';
  ctx.beginPath();
  ctx.arc(sx + 4, sy - 2, 1.1, 0, Math.PI * 2);
  ctx.fill();

  // Swivel mount.
  ctx.fillStyle = '#4b4d55';
  ctx.strokeStyle = '#202126';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(sx, sy + 1, 7.5 + level * 0.5, 4.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#6f737d';
  ctx.beginPath();
  ctx.ellipse(sx, sy, 5.5 + level * 0.5, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Nozzle barrels: twin barrels from tier 3.
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const px = -sin;
  const py = cos;
  const len = FLAME_NOZZLE_LEN(level);
  const barrels = level >= 2 ? [-2.4, 2.4] : [0];
  for (const off of barrels) {
    const bx0 = sx + px * off;
    const by0 = sy + py * off;
    const tx = bx0 + cos * len;
    const ty = by0 + sin * len;
    ctx.strokeStyle = '#2e3136';
    ctx.lineWidth = 5 + level * 0.5;
    ctx.beginPath();
    ctx.moveTo(bx0, by0);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    // Heat bands along the barrel.
    ctx.strokeStyle = firing ? 'rgba(255,120,40,0.7)' : 'rgba(110,115,125,0.9)';
    ctx.lineWidth = 1;
    for (const t of [0.45, 0.65, 0.85]) {
      const cx = bx0 + cos * len * t;
      const cy = by0 + sin * len * t;
      ctx.beginPath();
      ctx.moveTo(cx + px * 2.6, cy + py * 2.6);
      ctx.lineTo(cx - px * 2.6, cy - py * 2.6);
      ctx.stroke();
    }
    // Top highlight.
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(bx0 + cos * 3 - px * 1.4, by0 + sin * 3 - py * 1.4);
    ctx.lineTo(bx0 + cos * (len - 3) - px * 1.4, by0 + sin * (len - 3) - py * 1.4);
    ctx.stroke();
    // Bell mouth, glowing when hot.
    ctx.fillStyle = firing ? '#ff8a3a' : '#4a4e55';
    ctx.strokeStyle = '#1f2024';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(tx, ty, 3.4 + level * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = firing ? '#fff1c8' : '#1b1c20';
    ctx.beginPath();
    ctx.arc(tx, ty, 1.6 + level * 0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    if (firing) {
      const g = ctx.createRadialGradient(tx, ty, 0, tx, ty, 11 + level);
      g.addColorStop(0, `rgba(255,170,70,${0.55 + flick * 0.15})`);
      g.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(tx, ty, 11 + level, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Pilot light: a small layered tongue licking off the mouth.
      drawFlameTongue(ctx, tx + cos * 2, ty + sin * 2, angle, 6 + flick * 1.2, 3.6, time, off);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // Tier 4: cooling fins and a glowing burner vent on the drum.
  if (level >= 3) {
    ctx.strokeStyle = '#2e3136';
    ctx.lineWidth = 1.2;
    for (let k = 0; k < 4; k++) {
      const fx = left + w * 0.48 + k * 2.6;
      ctx.beginPath();
      ctx.moveTo(fx, top - 1);
      ctx.lineTo(fx, top - 5);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,120,40,${0.5 + flick * 0.2})`;
    ctx.beginPath();
    ctx.ellipse(left + w * 0.52, top + h * 0.78, 4, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
}

// Fill-only rounded rect (no stroke) for overlays like soot.
function roundRectFill(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

// A layered flame tongue pointing along `angle`: red sheath, orange body,
// yellow core, white heart, each shorter than the last and flickering.
function drawFlameTongue(ctx, x, y, angle, length, width, time, seed) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const layers = [
    [1.0, 1.0, 'rgba(255,70,20,0.55)'],
    [0.8, 0.8, 'rgba(255,140,40,0.8)'],
    [0.6, 0.6, 'rgba(255,215,110,0.9)'],
    [0.35, 0.4, 'rgba(255,250,225,0.95)'],
  ];
  for (const [ls, ws, color] of layers) {
    const L = length * ls * (1 + Math.sin(time * 21 + seed * 3) * 0.15);
    const W = width * ws;
    const wob = Math.sin(time * 15 + seed) * W * 0.4;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -W);
    ctx.quadraticCurveTo(L * 0.6, -W * 0.9 + wob, L, wob * 0.5);
    ctx.quadraticCurveTo(L * 0.6, W * 0.9 + wob, 0, W);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// Continuous fire jet from each flamethrower to its target while it fires:
// four additive layers from a translucent red sheath to a white-hot core,
// with turbulence rolling along the stream and a heat bloom at the impact.
function drawFlameJets(ctx, game, time) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  game.towers.forEach((tower, i) => {
    if (!tower || tower.typeId !== 'flame' || !(tower.cooldown > 0) || tower.targetX === undefined) return;
    const spot = game.level.buildSpots[i];
    const level = tower.level;
    const angle = tower.angle ?? 0;
    const len = FLAME_NOZZLE_LEN(level);
    const ox = spot.x + Math.cos(angle) * len;
    const oy = spot.y - 12 + Math.sin(angle) * len;
    const dist = Math.hypot(tower.targetX - ox, tower.targetY - oy);
    const reach = Math.min(dist + 12, 120);
    const seed = i * 1.37;
    const baseW = 10 + level * 2.5;
    const layers = [
      [1.0, 1.0, 'rgba(255,45,10,0.22)'],
      [0.8, 0.96, 'rgba(255,110,25,0.36)'],
      [0.56, 0.86, 'rgba(255,185,60,0.42)'],
      [0.24, 0.55, 'rgba(255,240,200,0.5)'],
    ];
    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(angle);
    const segs = 8;
    for (const [ws, ls, color] of layers) {
      const L = reach * ls;
      const upper = [];
      const lower = [];
      for (let k = 0; k <= segs; k++) {
        const t = k / segs;
        const sx = L * t;
        // The stream widens with distance and ripples as fuel pulses through.
        const w = (2.5 + baseW * Math.pow(t, 0.7) * (1 + Math.sin(time * 19 - t * 11 + seed) * 0.28)) * ws;
        const drift = Math.sin(time * 13 - t * 8 + seed) * 3.2 * t + Math.sin(time * 29 + t * 17) * 0.8 * t;
        upper.push([sx, -w + drift]);
        lower.push([sx, w + drift]);
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      tracePolyline(ctx, upper, true);
      tracePolyline(ctx, lower.reverse(), false);
      ctx.closePath();
      ctx.fill();
    }
    // Hot sparks riding the stream.
    ctx.fillStyle = 'rgba(255,240,200,0.9)';
    for (let k = 0; k < 3 + level; k++) {
      const t = ((time * 2.2 + k * 0.31 + seed) % 1);
      const sx = reach * t;
      const sy = Math.sin(time * 13 - t * 8 + seed) * 3 * t + Math.sin(k * 7.3 + time * 9) * baseW * 0.5 * t;
      ctx.globalAlpha = 1 - t;
      ctx.beginPath();
      ctx.arc(sx, sy, 1.1 + level * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // Heat bloom where the stream lands and a warm ground light along it.
    const ex = ox + Math.cos(angle) * Math.min(dist, reach);
    const ey = oy + Math.sin(angle) * Math.min(dist, reach);
    const bloom = ctx.createRadialGradient(ex, ey, 0, ex, ey, 18 + level * 3);
    bloom.addColorStop(0, `rgba(255,170,80,${0.3 + Math.sin(time * 27 + seed) * 0.08})`);
    bloom.addColorStop(1, 'rgba(255,100,20,0)');
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(ex, ey, 18 + level * 3, 0, Math.PI * 2);
    ctx.fill();
    const light = ctx.createRadialGradient(ox, oy, 0, ox, oy, reach);
    light.addColorStop(0, 'rgba(255,150,60,0.12)');
    light.addColorStop(1, 'rgba(255,100,20,0)');
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.arc(ox, oy, reach, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

// Smooth midpoint-curve through a point list, continuing the current path.
function tracePolyline(ctx, pts, start) {
  if (start) ctx.moveTo(pts[0][0], pts[0][1]);
  else ctx.lineTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < pts.length - 1; k++) {
    const mx = (pts[k][0] + pts[k + 1][0]) / 2;
    const my = (pts[k][1] + pts[k + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[k][0], pts[k][1], mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
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

function drawMortarTower(ctx, spot, time, angle, cooldownFrac, level) {
  const x = spot.x;
  const y = spot.y;
  // Sandbag ring.
  ctx.fillStyle = '#b8a070';
  ctx.strokeStyle = '#7a6a4a';
  ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(a) * (13 + level), y + 3 + Math.sin(a) * (6 + level * 0.5), 5, 3, a, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // Base plate and a short, fat tube angled up toward the target.
  ctx.fillStyle = '#4a4f55';
  ctx.beginPath();
  ctx.ellipse(x, y, 9 + level, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  const recoil = Math.max(0, (cooldownFrac - 0.8) / 0.2) * 3;
  const len = 18 + level * 2 - recoil;
  const dx = Math.cos(angle) * 0.55;
  const dy = -0.85; // mostly upward: a lobbing tube
  ctx.strokeStyle = '#2f3338';
  ctx.lineWidth = 9 + level;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y - 2);
  ctx.lineTo(x + dx * len, y - 2 + dy * len);
  ctx.stroke();
  ctx.strokeStyle = '#1f2327';
  ctx.lineWidth = 11 + level;
  ctx.beginPath();
  ctx.moveTo(x + dx * (len - 3), y - 2 + dy * (len - 3));
  ctx.lineTo(x + dx * len, y - 2 + dy * len);
  ctx.stroke();
  // Muzzle smoke lingers after a shot.
  if (cooldownFrac > 0.6) {
    ctx.fillStyle = `rgba(150,150,150,${(cooldownFrac - 0.6) * 0.8})`;
    ctx.beginPath();
    ctx.arc(x + dx * (len + 6), y - 2 + dy * (len + 6) - (1 - cooldownFrac) * 20, 5 + (1 - cooldownFrac) * 12, 0, Math.PI * 2);
    ctx.fill();
  }
  // Shell crate.
  ctx.fillStyle = '#6b4a2b';
  ctx.strokeStyle = '#3f2e1a';
  ctx.lineWidth = 1;
  ctx.fillRect(x + 9, y - 2, 9, 7);
  ctx.strokeRect(x + 9, y - 2, 9, 7);
  ctx.fillStyle = '#2f3338';
  for (const sx of [11.5, 14.5]) {
    ctx.beginPath();
    ctx.arc(x + sx, y - 4, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSniperTower(ctx, spot, time, angle, justFired, level) {
  const x = spot.x;
  const y = spot.y;
  const h = 40 + level * 5;
  // Tall thin stilts with cross bracing.
  ctx.strokeStyle = '#5f4a26';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x - 9, y + 3);
  ctx.lineTo(x - 5, y - h + 8);
  ctx.moveTo(x + 9, y + 3);
  ctx.lineTo(x + 5, y - h + 8);
  for (let b = 0; b < 3; b++) {
    const by = y - 6 - b * ((h - 14) / 3);
    const w = 8 - b * 1.2;
    ctx.moveTo(x - w, by);
    ctx.lineTo(x + w, by - 8);
    ctx.moveTo(x + w, by);
    ctx.lineTo(x - w, by - 8);
  }
  ctx.stroke();
  // Crow's nest.
  ctx.fillStyle = '#8d6e3a';
  ctx.strokeStyle = '#5f4a26';
  ctx.lineWidth = 1.5;
  ctx.fillRect(x - 10, y - h + 4, 20, 6);
  ctx.strokeRect(x - 10, y - h + 4, 20, 6);
  ctx.beginPath();
  for (const px of [-9, -4.5, 0, 4.5, 9]) {
    ctx.moveTo(x + px, y - h + 4);
    ctx.lineTo(x + px, y - h - 2);
  }
  ctx.moveTo(x - 9, y - h - 1);
  ctx.lineTo(x + 9, y - h - 1);
  ctx.stroke();
  // Marksman and a long rifle swung toward the target.
  ctx.fillStyle = '#2e4a2a';
  ctx.beginPath();
  ctx.arc(x, y - h - 5, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - 2.5, y - h - 3, 5, 6);
  ctx.strokeStyle = '#1f2327';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(x, y - h - 4);
  ctx.lineTo(x + Math.cos(angle) * (18 + level * 2), y - h - 4 + Math.sin(angle) * (18 + level * 2));
  ctx.stroke();
  // Scope glint.
  const glint = 0.4 + Math.sin(time * 5) * 0.3 + (justFired ? 0.4 : 0);
  ctx.fillStyle = `rgba(200,255,220,${glint})`;
  ctx.beginPath();
  ctx.arc(x + Math.cos(angle) * 7, y - h - 6 + Math.sin(angle) * 7, 1.6, 0, Math.PI * 2);
  ctx.fill();
  // Canopy and pennant.
  ctx.fillStyle = ['#4a6b3a', '#3f7a3a', '#2e8a4a', '#1f9a5a'][level];
  ctx.beginPath();
  ctx.moveTo(x - 13, y - h - 8);
  ctx.lineTo(x, y - h - 18);
  ctx.lineTo(x + 13, y - h - 8);
  ctx.closePath();
  ctx.fill();
}

function drawVenomTower(ctx, spot, time, angle, justFired, level) {
  const x = spot.x;
  const y = spot.y;
  const r = 12 + level * 1.5;
  // Bulbous pod with veins, pulsing as it builds pressure.
  const pulse = 1 + Math.sin(time * 4) * 0.04 + (justFired ? 0.08 : 0);
  ctx.fillStyle = ['#6fae3a', '#63a634', '#58a02e', '#4c9a28'][level];
  ctx.strokeStyle = '#2f5a1a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(x, y - r * 0.6, r * pulse, r * 0.85 * pulse, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(47,90,26,0.6)';
  ctx.lineWidth = 1;
  for (let v = 0; v < 3 + level; v++) {
    const a = (v / (3 + level)) * Math.PI * 2 + 0.4;
    ctx.beginPath();
    ctx.moveTo(x, y - r * 0.6);
    ctx.quadraticCurveTo(x + Math.cos(a) * r * 0.6, y - r * 0.6 + Math.sin(a) * r * 0.9, x + Math.cos(a) * r * 0.95, y - r * 0.6 + Math.sin(a) * r * 0.75);
    ctx.stroke();
  }
  // Glowing sac.
  ctx.fillStyle = `rgba(198,255,107,${0.45 + Math.sin(time * 6) * 0.15})`;
  ctx.beginPath();
  ctx.arc(x - r * 0.25, y - r * 0.8, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
  // Spitting maw aimed at the target.
  const mx = x + Math.cos(angle) * r * 0.8;
  const my = y - r * 0.6 + Math.sin(angle) * r * 0.6;
  ctx.fillStyle = '#2f5a1a';
  ctx.beginPath();
  ctx.ellipse(mx, my, 4 + level * 0.5, 3, angle, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8fd33a';
  ctx.beginPath();
  ctx.ellipse(mx, my, 2.5, 1.6, angle, 0, Math.PI * 2);
  ctx.fill();
  // Thorny leaves at the base.
  ctx.fillStyle = '#3f7a35';
  for (let lf = 0; lf < 4 + level; lf++) {
    const a = (lf / (4 + level)) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y + 2);
    ctx.lineTo(x + Math.cos(a) * (14 + level) - Math.sin(a) * 3, y + 2 + Math.sin(a) * 6 - Math.cos(a) * 1.5);
    ctx.lineTo(x + Math.cos(a) * (16 + level), y + 2 + Math.sin(a) * 7);
    ctx.lineTo(x + Math.cos(a) * (14 + level) + Math.sin(a) * 3, y + 2 + Math.sin(a) * 6 + Math.cos(a) * 1.5);
    ctx.closePath();
    ctx.fill();
  }
}

function drawBeaconTower(ctx, spot, time, level) {
  const x = spot.x;
  const y = spot.y;
  const h = 18 + level * 3;
  // Stone brazier on a pedestal.
  ctx.fillStyle = '#7d848c';
  ctx.strokeStyle = '#4a4f55';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 6, y + 3);
  ctx.lineTo(x - 4, y - h + 10);
  ctx.lineTo(x + 4, y - h + 10);
  ctx.lineTo(x + 6, y + 3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#5d5a66';
  ctx.beginPath();
  ctx.moveTo(x - 11 - level, y - h + 10);
  ctx.lineTo(x + 11 + level, y - h + 10);
  ctx.lineTo(x + 8 + level, y - h);
  ctx.lineTo(x - 8 - level, y - h);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Flames, additive.
  ctx.globalCompositeOperation = 'lighter';
  for (let f = 0; f < 3 + level; f++) {
    const fh = (12 + level * 3) * (0.8 + Math.sin(time * 9 + f * 1.7) * 0.25);
    const lean = Math.sin(time * 5 + f) * 3;
    const fx = x + (f - (2 + level) / 2) * 3.5;
    ctx.fillStyle = f % 2 ? 'rgba(255,209,102,0.85)' : 'rgba(255,140,51,0.8)';
    ctx.beginPath();
    ctx.moveTo(fx - 4, y - h);
    ctx.quadraticCurveTo(fx + lean, y - h - fh, fx + 4, y - h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = `rgba(255,209,102,${0.18 + Math.sin(time * 3) * 0.06})`;
  ctx.beginPath();
  ctx.arc(x, y - h - 6, 18 + level * 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

// Beacon auras: a soft pulsing circle around each beacon and warm links to
// every tower it empowers.
function drawBeaconAuras(ctx, game, time) {
  ctx.globalCompositeOperation = 'lighter';
  game.towers.forEach((beacon, b) => {
    if (!beacon || beacon.typeId !== 'beacon') return;
    const stats = game.towerStats(beacon);
    const from = game.level.buildSpots[b];
    const pulse = ((time * 0.6 + b * 0.3) % 1);
    ctx.strokeStyle = `rgba(255,209,102,${0.35 * (1 - pulse)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(from.x, from.y, stats.range * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,209,102,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(from.x, from.y, stats.range, 0, Math.PI * 2);
    ctx.stroke();
    game.towers.forEach((tower, i) => {
      if (!tower || i === b || (tower.boost || 1) <= 1) return;
      const to = game.level.buildSpots[i];
      if (Math.hypot(to.x - from.x, to.y - from.y) > stats.range) return;
      ctx.strokeStyle = `rgba(255,209,102,${0.18 + Math.sin(time * 4 + i) * 0.08})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 6]);
      ctx.lineDashOffset = -time * 30;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y - 20);
      ctx.lineTo(to.x, to.y - 10);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  });
  ctx.globalCompositeOperation = 'source-over';
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
    if (enemy.poison) {
      ctx.fillStyle = `rgba(143,211,58,${0.18 + enemy.poison.stacks * 0.05})`;
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
  // Three tongues of different heights, additive, with a soft glow beneath.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y - r * 0.6, 0, x, y - r * 0.6, r * 1.6);
  g.addColorStop(0, 'rgba(255,150,60,0.35)');
  g.addColorStop(1, 'rgba(255,90,20,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y - r * 0.6, r * 1.6, 0, Math.PI * 2);
  ctx.fill();
  for (let k = -1; k <= 1; k++) {
    const h = r * (k === 0 ? 1.3 : 0.8) * (0.9 + Math.sin(time * 12 + id + k * 2) * 0.25);
    const lean = Math.sin(time * 7 + id + k) * r * 0.25;
    drawFlameTongue(ctx, x + k * r * 0.45, y - r * 0.7, -Math.PI / 2 + lean / r * 0.6, h, r * 0.32, time, id + k);
  }
  ctx.restore();
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
    } else if (proj.towerType === 'sniper') {
      // A bright tiny round with a short streak; the tracer effect does the rest.
      ctx.strokeStyle = 'rgba(242,255,208,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(proj.x - proj.dirX * 14, proj.y - proj.dirY * 14);
      ctx.lineTo(proj.x, proj.y);
      ctx.stroke();
    } else if (proj.towerType === 'venom') {
      ctx.fillStyle = '#6fae3a';
      ctx.beginPath();
      ctx.ellipse(proj.x, proj.y, 5 * scale, 3.6 * scale, Math.atan2(proj.dirY, proj.dirX), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(198,255,107,0.9)';
      ctx.beginPath();
      ctx.arc(proj.x - 1.2, proj.y - 1.2, 1.6 * scale, 0, Math.PI * 2);
      ctx.fill();
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
      // keeping a shadow on the ground beneath it. Mortar shells fly higher.
      const mortar = proj.towerType === 'mortar';
      const traveled = Math.hypot(proj.x - (proj.startX ?? proj.x), proj.y - (proj.startY ?? proj.y));
      const remaining = Math.hypot(proj.lastTarget.x - proj.x, proj.lastTarget.y - proj.y);
      const total = traveled + remaining || 1;
      const lift = Math.sin((traveled / total) * Math.PI) * Math.min(mortar ? 110 : 42, total * (mortar ? 0.55 : 0.3));
      if (mortar) {
        ctx.fillStyle = 'rgba(255,140,51,0.35)';
        ctx.beginPath();
        ctx.arc(proj.x, proj.y - lift, 8 * scale, 0, Math.PI * 2);
        ctx.fill();
      }
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
  const opaque = new Set(['smoke', 'scorch', 'crater', 'frostpatch', 'puddle', 'leaf', 'snow', 'ash', 'shard', 'drop']);
  for (const p of particles) {
    const frac = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = frac;
    ctx.globalCompositeOperation = glow && !opaque.has(p.shape) ? 'lighter' : 'source-over';
    switch (p.shape) {
      case 'ring':
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3 * frac;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - frac) + 6, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'flash': {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * (1.4 - frac * 0.4));
        g.addColorStop(0, p.color);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.4 - frac * 0.4), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'fire': {
        const r = p.size * (0.7 + (1 - frac) * (p.grow || 1) * 0.6);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, frac > 0.75 ? '#fff0c8' : p.color);
        g.addColorStop(0.4, p.color);
        g.addColorStop(1, 'rgba(255,60,10,0)');
        ctx.globalAlpha = Math.min(0.85, frac * 1.1);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'smoke':
        ctx.globalAlpha = frac * 0.9;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 + (1 - frac) * (p.grow || 1) * 0.8), 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'spark': {
        const speed = Math.hypot(p.vx, p.vy) || 1;
        const len = Math.min(16, 3 + speed * 0.05);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(0.6, p.size * frac);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x - (p.vx / speed) * len, p.y - (p.vy / speed) * len);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        break;
      }
      case 'ember':
        ctx.fillStyle = p.color;
        ctx.globalAlpha = frac * 0.35;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = frac;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.5 + frac * 0.5), 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'shard': {
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        const sz = p.size * (0.6 + frac * 0.4);
        ctx.beginPath();
        ctx.moveTo(0, -sz);
        ctx.lineTo(sz * 0.9, sz * 0.7);
        ctx.lineTo(-sz * 0.9, sz * 0.7);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'star': {
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        const sz = p.size * (0.5 + frac * 0.5) * 1.6;
        ctx.beginPath();
        for (let k = 0; k < 8; k++) {
          const rad = k % 2 ? sz * 0.4 : sz;
          const a = (k / 8) * Math.PI * 2;
          ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;
      }
      case 'drop':
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.size * 0.7, p.size * 1.3, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'tracer':
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size * frac * 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x2, p.y2);
        ctx.stroke();
        break;
      case 'scorch':
      case 'crater':
        ctx.globalAlpha = Math.min(0.8, frac * 1.5);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.size, p.size * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        if (p.shape === 'crater') {
          ctx.strokeStyle = 'rgba(0,0,0,0.35)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.size * 0.7, p.size * 0.38, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      case 'frostpatch':
      case 'puddle':
        ctx.globalAlpha = Math.min(0.9, frac * 1.3);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.size, p.size * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'leaf':
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * 1.6, p.size * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      case 'snow':
      case 'ash':
      case 'pollen':
        ctx.globalAlpha = Math.min(1, frac * 3) * 0.9;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'sand':
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x - 14, p.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        break;
      case 'firefly': {
        const blink = 0.3 + Math.max(0, Math.sin(p.rot * 0.5 + p.x * 0.05 + p.life * 6)) * 0.7;
        ctx.globalAlpha = Math.min(1, frac * 3) * blink;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = Math.min(1, frac * 3);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.7, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      default:
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
  ctx.textAlign = 'center';
  for (const t of effects.texts) {
    ctx.font = `bold ${Math.round(13 * (t.scale || 1))}px sans-serif`;
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
  const pop = age < 0.3 ? 1.25 - 0.25 * (age / 0.3) : 1; // settles in from slightly large
  const cx = level.width / 2;
  const cy = level.height / 2 - 40;
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(pop, pop);
  ctx.textAlign = 'center';
  ctx.font = 'bold 44px Georgia, serif';
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = banner.color;
  ctx.globalAlpha = Math.max(0, alpha) * 0.35;
  ctx.fillText(banner.text, 0, 2); // glow pass
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineWidth = 7;
  ctx.strokeText(banner.text, 0, 0);
  ctx.fillStyle = banner.color;
  ctx.fillText(banner.text, 0, 0);
  if (banner.sub) {
    ctx.font = 'italic 16px Georgia, serif';
    ctx.lineWidth = 4;
    ctx.strokeText(banner.sub, 0, 24);
    ctx.fillStyle = '#f2e3b3';
    ctx.fillText(banner.sub, 0, 24);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawRange(ctx, spot, range) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.beginPath();
  ctx.arc(spot.x, spot.y, range, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.lineDashOffset = -performance.now() / 40;
  ctx.stroke();
  ctx.setLineDash([]);
}
