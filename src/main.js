// Browser entry point: wires the Game to the canvas and the HUD, handles
// level selection and saved progress.

import { TOWER_TYPES, MAX_TOWER_LEVEL } from './config.js';
import { LEVELS } from './levels.js';
import { Game, PHASE } from './game.js';
import { Effects } from './effects.js';
import { render } from './render.js';

const PROGRESS_KEY = 'towerrush-progress';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let levelIndex = 0;
let game = new Game(LEVELS[0]);
const effects = new Effects();
const ui = { selectedSpot: -1 };

// --- Saved progress (best effort; storage may be unavailable) -----------

function loadUnlocked() {
  try {
    const n = Number(localStorage.getItem(PROGRESS_KEY));
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), LEVELS.length - 1) : 0;
  } catch {
    return 0;
  }
}

function saveUnlocked(n) {
  try {
    localStorage.setItem(PROGRESS_KEY, String(Math.max(n, loadUnlocked())));
  } catch {
    /* storage unavailable: progress just isn't remembered */
  }
}

// --- HUD elements -------------------------------------------------------

const levelNameEl = document.getElementById('level-name');
const goldEl = document.getElementById('gold');
const livesEl = document.getElementById('lives');
const waveEl = document.getElementById('wave');
const statusEl = document.getElementById('status');
const towerInfoEl = document.getElementById('tower-info');
const startWaveBtn = document.getElementById('start-wave');
const nextLevelBtn = document.getElementById('next-level');
const restartBtn = document.getElementById('restart');
const chooseLevelBtn = document.getElementById('choose-level');
const towerMenu = document.getElementById('tower-menu');
const upgradeBtn = document.getElementById('upgrade-tower');
const sellBtn = document.getElementById('sell-tower');
const levelSelect = document.getElementById('level-select');
const levelList = document.getElementById('level-list');

for (const type of Object.values(TOWER_TYPES)) {
  const btn = document.createElement('button');
  btn.dataset.type = type.id;
  btn.textContent = `${type.name} (${type.levels[0].cost}g)`;
  btn.addEventListener('click', () => {
    if (ui.selectedSpot < 0) return;
    const result = game.buildTower(ui.selectedSpot, type.id);
    if (!result.ok && result.reason === 'not-enough-gold') flashStatus('Not enough gold!');
    updateHud();
  });
  towerMenu.insertBefore(btn, upgradeBtn);
}

upgradeBtn.addEventListener('click', () => {
  if (ui.selectedSpot < 0) return;
  const result = game.upgradeTower(ui.selectedSpot);
  if (!result.ok && result.reason === 'not-enough-gold') flashStatus('Not enough gold!');
  updateHud();
});

sellBtn.addEventListener('click', () => {
  if (ui.selectedSpot >= 0) game.sellTower(ui.selectedSpot);
  ui.selectedSpot = -1;
  updateHud();
});

startWaveBtn.addEventListener('click', () => {
  game.startNextWave();
  updateHud();
});

restartBtn.addEventListener('click', () => loadLevel(levelIndex));
nextLevelBtn.addEventListener('click', () => loadLevel(levelIndex + 1));
chooseLevelBtn.addEventListener('click', () => showLevelSelect());

canvas.addEventListener('click', (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) * (canvas.width / rect.width);
  const y = (event.clientY - rect.top) * (canvas.height / rect.height);

  ui.selectedSpot = -1;
  game.level.buildSpots.forEach((spot, i) => {
    if (Math.hypot(spot.x - x, spot.y - y) <= 22) ui.selectedSpot = i;
  });
  updateHud();
});

// --- Level flow -----------------------------------------------------------

function loadLevel(index) {
  levelIndex = Math.min(Math.max(index, 0), LEVELS.length - 1);
  game = new Game(LEVELS[levelIndex]);
  effects.clear();
  ui.selectedSpot = -1;
  levelSelect.hidden = true;
  updateHud();
}

function showLevelSelect() {
  const unlocked = loadUnlocked();
  levelList.replaceChildren();
  LEVELS.forEach((level, i) => {
    const btn = document.createElement('button');
    btn.className = 'level-btn';
    btn.disabled = i > unlocked;
    btn.innerHTML = `<span><strong>${i + 1}. ${level.name}</strong><br><small>${level.subtitle}</small></span><span>${i > unlocked ? '🔒' : `${level.waves.length} waves`}</span>`;
    btn.addEventListener('click', () => loadLevel(i));
    levelList.appendChild(btn);
  });
  levelSelect.hidden = false;
}

let statusTimer = null;
function flashStatus(text) {
  statusEl.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(updateHud, 1500);
}

function updateHud() {
  levelNameEl.textContent = `${levelIndex + 1}. ${game.level.name}`;
  goldEl.textContent = game.gold;
  livesEl.textContent = game.lives;
  waveEl.textContent = `${Math.max(0, game.waveIndex + 1)} / ${game.waveCount}`;

  const over = game.phase === PHASE.WON || game.phase === PHASE.LOST;
  startWaveBtn.disabled = game.phase !== PHASE.BUILD;
  restartBtn.hidden = !over;
  nextLevelBtn.hidden = !(game.phase === PHASE.WON && levelIndex + 1 < LEVELS.length);

  const spotSelected = ui.selectedSpot >= 0;
  const tower = spotSelected ? game.towers[ui.selectedSpot] : null;
  towerMenu.hidden = !spotSelected || over;
  upgradeBtn.hidden = !tower;
  sellBtn.hidden = !tower;
  for (const btn of towerMenu.querySelectorAll('button[data-type]')) {
    btn.hidden = !!tower;
    btn.disabled = game.gold < TOWER_TYPES[btn.dataset.type].levels[0].cost;
  }

  if (tower) {
    const type = TOWER_TYPES[tower.typeId];
    const stats = game.towerStats(tower);
    const upgradeCost = game.upgradeCost(tower);
    towerInfoEl.textContent = `${type.name} — Level ${tower.level + 1}/${MAX_TOWER_LEVEL} · ${stats.damage} ${type.damageType} dmg · ${stats.range} range · ${(1 / stats.fireInterval).toFixed(1)}/s`;
    upgradeBtn.textContent = upgradeCost === null ? 'Max level' : `Upgrade (${upgradeCost}g)`;
    upgradeBtn.disabled = upgradeCost === null || game.gold < upgradeCost;
    sellBtn.textContent = `Sell (+${game.sellValue(tower)}g)`;
  } else {
    towerInfoEl.textContent = '';
  }

  if (game.phase === PHASE.WON) {
    saveUnlocked(levelIndex + 1);
    statusEl.textContent = levelIndex + 1 < LEVELS.length ? 'Victory! The next level is unlocked.' : 'Victory! You have beaten every level.';
  } else if (game.phase === PHASE.LOST) {
    statusEl.textContent = 'Defeat! The enemies broke through.';
  } else if (game.phase === PHASE.WAVE) {
    const boss = game.boss;
    statusEl.textContent = boss ? `${game.enemyTypes[boss.typeId].name} approaches!` : `Wave ${game.waveIndex + 1} incoming...`;
  } else if (spotSelected && !tower) {
    statusEl.textContent = 'Choose a tower to build.';
  } else if (tower) {
    statusEl.textContent = 'Upgrade or sell this tower.';
  } else {
    statusEl.textContent = 'Click a spot to build, then start the wave.';
  }
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
showLevelSelect();
requestAnimationFrame(frame);
