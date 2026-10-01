// Canvas rendering. Pure drawing — reads game state, never mutates it.

export function render(ctx, game, ui) {
  const { level } = game;
  ctx.clearRect(0, 0, level.width, level.height);

  // Ground
  ctx.fillStyle = '#6da14e';
  ctx.fillRect(0, 0, level.width, level.height);

  // Path
  ctx.strokeStyle = '#c9b178';
  ctx.lineWidth = 28;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  level.path.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();

  // Build spots and towers
  for (let i = 0; i < level.buildSpots.length; i++) {
    const spot = level.buildSpots[i];
    const tower = game.towers[i];

    if (tower) {
      const type = game.towerTypes[tower.typeId];
      if (i === ui.selectedSpot) drawRange(ctx, spot, type.range);
      ctx.fillStyle = type.color;
      ctx.fillRect(spot.x - 14, spot.y - 14, 28, 28);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(type.name[0].toUpperCase(), spot.x, spot.y + 4);
    } else {
      ctx.fillStyle = i === ui.selectedSpot ? '#e8dca8' : '#b5a46f';
      ctx.beginPath();
      ctx.arc(spot.x, spot.y, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#7d7049';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // Enemies with HP bars
  for (const enemy of game.enemies) {
    const pos = game.path.positionAt(enemy.dist);
    const type = game.enemyTypes[enemy.typeId];
    ctx.fillStyle = type.color;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, enemy.radius, 0, Math.PI * 2);
    ctx.fill();

    const w = 22;
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(pos.x - w / 2, pos.y - enemy.radius - 9, w, 4);
    ctx.fillStyle = '#d64545';
    ctx.fillRect(pos.x - w / 2, pos.y - enemy.radius - 9, w * (enemy.hp / enemy.maxHp), 4);
  }

  // Projectiles
  for (const proj of game.projectiles) {
    ctx.fillStyle = proj.color || '#222';
    ctx.beginPath();
    ctx.arc(proj.x, proj.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRange(ctx, spot, range) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(spot.x, spot.y, range, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
