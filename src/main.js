// Browser entry point: wires the Game to the canvas and the HUD.

import { LEVEL_1, TOWER_TYPES } from './config.js';
import { Game, PHASE } from './game.js';
import { Effects } from './effects.js';
import { render } from './render.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let game = new Game(LEVEL_1);
const effects = new Effects();
const ui = { selectedSpot: -1 };

// --- HUD elements -------------------------------------------------------

const goldEl = document.getElementById('gold');
const livesEl = document.getElementById('lives');
const waveEl = document.getElementById('wave');
const statusEl = document.getElementById('status');
const startWaveBtn = document.getElementById('start-wave');
const restartBtn = document.getElementById('restart');
const towerMenu = document.getElementById('tower-menu');
const sellBtn = document.getElementById('sell-tower');

for (const type of Object.values(TOWER_TYPES)) {
  const btn = document.createElement('button');
  btn.dataset.type = type.id;
  btn.textContent = `${type.name} (${type.cost}g)`;
  btn.addEventListener('click', () => {
    if (ui.selectedSpot < 0) return;
    const result = game.buildTower(ui.selectedSpot, type.id);
    if (!result.ok && result.reason === 'not-enough-gold') {
      flashStatus('Not enough gold!');
    }
    ui.selectedSpot = -1;
    updateHud();
  });
  towerMenu.insertBefore(btn, sellBtn);
}

sellBtn.addEventListener('click', () => {
  if (ui.selectedSpot >= 0) game.sellTower(ui.selectedSpot);
  ui.selectedSpot = -1;
  updateHud();
});

startWaveBtn.addEventListener('click', () => {
  game.startNextWave();
  updateHud();
});

restartBtn.addEventListener('click', () => {
  game = new Game(LEVEL_1);
  effects.clear();
  ui.selectedSpot = -1;
  updateHud();
});

canvas.addEventListener('click', (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (canvas.width / rect.width);
  const y = (event.clientY - rect.top) * (canvas.height / rect.height);

  ui.selectedSpot = -1;
  game.level.buildSpots.forEach((spot, i) => {
    if (Math.hypot(spot.x - x, spot.y - y) <= 20) ui.selectedSpot = i;
  });
  updateHud();
});

let statusTimer = null;
function flashStatus(text) {
  statusEl.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(updateHud, 1500);
}

function updateHud() {
  goldEl.textContent = game.gold;
  livesEl.textContent = game.lives;
  waveEl.textContent = `${Math.max(0, game.waveIndex + 1)} / ${game.waveCount}`;

  startWaveBtn.disabled = game.phase !== PHASE.BUILD;
  restartBtn.hidden = game.phase !== PHASE.WON && game.phase !== PHASE.LOST;

  const spotSelected = ui.selectedSpot >= 0;
  const hasTower = spotSelected && !!game.towers[ui.selectedSpot];
  towerMenu.hidden = !spotSelected;
  sellBtn.hidden = !hasTower;
  for (const btn of towerMenu.querySelectorAll('button[data-type]')) {
    btn.hidden = hasTower;
    btn.disabled = game.gold < TOWER_TYPES[btn.dataset.type].cost;
  }

  if (game.phase === PHASE.WON) statusEl.textContent = 'Victory! The kingdom is safe.';
  else if (game.phase === PHASE.LOST) statusEl.textContent = 'Defeat! The enemies broke through.';
  else if (game.phase === PHASE.WAVE) statusEl.textContent = `Wave ${game.waveIndex + 1} incoming...`;
  else statusEl.textContent = spotSelected ? 'Choose a tower to build.' : 'Click a spot to build, then start the wave.';
}

// --- Game loop ----------------------------------------------------------

let lastTime = performance.now();
function frame(now) {
  // Clamp dt so a background tab doesn't fast-forward the simulation.
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  const phaseBefore = game.phase;
  const goldBefore = game.gold;
  const livesBefore = game.lives;
  game.update(dt);
  if (game.phase !== phaseBefore || game.gold !== goldBefore || game.lives !== livesBefore) {
    updateHud();
  }

  effects.process(game.drainEvents());
  effects.ambient(game, dt);
  effects.update(dt);
  render(ctx, game, effects, ui, now / 1000);
  requestAnimationFrame(frame);
}

updateHud();
requestAnimationFrame(frame);
