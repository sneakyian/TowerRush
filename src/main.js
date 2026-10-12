// Browser entry point: wires the Game to the canvas and the HUD, handles
// level selection and saved progress.

import { TOWER_TYPES, MAX_TOWER_LEVEL, HERO_TYPES, unlockedTowers } from './config.js';
import { LEVELS } from './levels.js';
import { Game, PHASE, describeTraits } from './game.js';
import { Effects } from './effects.js';
import { render } from './render.js';
import { SoundSystem } from './audio.js';
import { STORY, storyText } from './story.js';

const PROGRESS_KEY = 'towerrush-progress';
const HERO_KEY = 'towerrush-hero';
const HERO_ICONS = { dragon: '🐉', knight: '🛡️', mage: '🔮', paladin: '💀' };

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// The world is 800x480 logical units, but the canvas fills the stage (up to
// 1280 CSS px) and its backing store is sized at display size x device pixel
// ratio. Everything is vector-drawn through one scale transform, so a bigger
// or sharper screen simply gets more resolution.
const MAX_BACKING_WIDTH = 4096; // keeps the backing store sane on huge HiDPI screens
const stageEl = document.getElementById('stage');

function fitCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const { width, height } = game.level;
  const cssWidth = Math.max(320, stageEl.clientWidth || width);
  const cssHeight = (cssWidth * height) / width;
  const scale = Math.min((cssWidth / width) * dpr, MAX_BACKING_WIDTH / width);
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  canvas.style.aspectRatio = `${width} / ${height}`;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return { cssWidth, cssHeight };
}

let levelIndex = 0;
let game = new Game(LEVELS[0]);
fitCanvas();
window.addEventListener('resize', fitCanvas);
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => fitCanvas()).observe(stageEl);
const effects = new Effects();
const sound = new SoundSystem();
const SOUND_KEY = 'towerrush-sound';
try { if (localStorage.getItem(SOUND_KEY) === 'off') sound.muted = true; } catch { /* default on */ }
// Browsers only allow audio after a user gesture: the first click or key unlocks it.
const unlockSound = () => { sound.unlock(); sound.setTheme(LEVELS[levelIndex].id); };
window.addEventListener('pointerdown', unlockSound, { capture: true });
window.addEventListener('keydown', unlockSound, { capture: true });
const ui = { selectedSpot: -1, heroSelected: false, marker: null };

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

function loadHeroChoice() {
  try {
    const id = localStorage.getItem(HERO_KEY);
    return HERO_TYPES[id] ? id : 'knight';
  } catch {
    return 'knight';
  }
}
let heroChoice = loadHeroChoice();
function saveHeroChoice(id) {
  heroChoice = id;
  try { localStorage.setItem(HERO_KEY, id); } catch { /* not remembered */ }
}

// --- HUD elements -------------------------------------------------------

const levelNameEl = document.getElementById('level-name');
const goldEl = document.getElementById('gold');
const livesEl = document.getElementById('lives');
const waveEl = document.getElementById('wave');
const statusEl = document.getElementById('status');
const wavePreviewEl = document.getElementById('wave-preview');

function updateWavePreview() {
  const next = game.phase === PHASE.BUILD ? game.nextWave() : null;
  wavePreviewEl.replaceChildren();
  if (!next) return;
  const who = next.entries.map((e) => `${e.count}× ${e.name}`).join(', ');
  const head = document.createElement('strong');
  head.textContent = `${next.final ? 'Final wave' : `Wave ${next.index + 1}`}: `;
  wavePreviewEl.append(head, who);
  for (const warning of next.warnings) {
    const span = document.createElement('span');
    span.className = 'warn';
    span.textContent = ` · ⚠ ${warning}`;
    wavePreviewEl.appendChild(span);
  }
}
const towerInfoEl = document.getElementById('tower-info');
const startWaveBtn = document.getElementById('start-wave');
const speedBtn = document.getElementById('speed');

// Fast-forward: the simulation and effects run 1, 2 or 3 steps per frame.
const SPEEDS = [1, 2, 3];
let speed = 1;
function setSpeed(value) {
  speed = SPEEDS.includes(value) ? value : 1;
  speedBtn.textContent = `Speed ${speed}×`;
  speedBtn.classList.toggle('active', speed > 1);
}
speedBtn.addEventListener('click', () => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]));
const soundBtn = document.getElementById('sound');
function refreshSoundButton() {
  soundBtn.textContent = sound.muted ? '🔇 Muted' : '🔊 Sound';
  soundBtn.classList.toggle('muted', sound.muted);
}
soundBtn.addEventListener('click', () => {
  sound.toggleMute();
  try { localStorage.setItem(SOUND_KEY, sound.muted ? 'off' : 'on'); } catch { /* not remembered */ }
  refreshSoundButton();
});
refreshSoundButton();
// Every button gives a soft click.
document.addEventListener('click', (e) => { if (e.target.closest('button') && e.target.id !== 'sound') sound.cue('click'); });
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === 'f' || e.key === 'F') { speedBtn.click(); e.preventDefault(); }
  else if (e.key === 'm' || e.key === 'M') soundBtn.click();
  else if (e.key === '1' || e.key === '2' || e.key === '3') setSpeed(Number(e.key));
});
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
  btn.innerHTML = `<span class="tower-name">${type.name}</span><span class="tower-cost">${type.levels[0].cost}g</span>`;
  btn.title = type.desc;
  btn.style.setProperty('--tower', type.color);
  // Light tower colors need dark text.
  const n = parseInt(type.color.slice(1), 16);
  const luma = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  btn.style.setProperty('--tower-fg', luma > 150 ? '#1b1f2a' : '#ffffff');
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
  const x = (event.clientX - rect.left) * (game.level.width / rect.width);
  const y = (event.clientY - rect.top) * (game.level.height / rect.height);

  // Hero first: click it to select, then click the ground to send it there.
  const hero = game.hero;
  if (hero && hero.alive && Math.hypot(hero.x - x, hero.y - y) <= 20) {
    ui.heroSelected = !ui.heroSelected;
    ui.selectedSpot = -1;
    updateHud();
    return;
  }
  let spot = -1;
  game.level.buildSpots.forEach((s, i) => {
    if (Math.hypot(s.x - x, s.y - y) <= 22) spot = i;
  });
  if (spot < 0 && ui.heroSelected && hero && hero.alive) {
    game.commandHero(x, y);
    ui.marker = { x, y, life: 0.8 };
    return;
  }
  ui.selectedSpot = spot;
  ui.heroSelected = false;
  updateHud();
});

// Hero ability: button or Q.
const heroPanel = document.getElementById('hero-panel');
const heroPortraitEl = document.getElementById('hero-portrait');
const heroNameEl = document.getElementById('hero-name');
const heroHpFill = document.getElementById('hero-hp-fill');
const heroLevelEl = document.getElementById('hero-level');
const heroAbilityBtn = document.getElementById('hero-ability');
heroAbilityBtn.addEventListener('click', () => { game.useHeroAbility(); updateHeroPanel(); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'q' || e.key === 'Q') { game.useHeroAbility(); updateHeroPanel(); }
});

function updateHeroPanel() {
  const hero = game.hero;
  heroPanel.hidden = !hero;
  if (!hero) return;
  const type = HERO_TYPES[hero.typeId];
  heroPortraitEl.textContent = HERO_ICONS[hero.typeId] || '⭐';
  heroNameEl.textContent = hero.alive ? type.name : `${type.name} returns in ${Math.ceil(hero.respawn)}s`;
  heroHpFill.style.width = `${Math.round((hero.hp / hero.maxHp) * 100)}%`;
  heroLevelEl.textContent = `Lv ${hero.level + 1}`;
  const cd = hero.abilityCooldown;
  heroAbilityBtn.disabled = !hero.alive || cd > 0;
  heroAbilityBtn.textContent = cd > 0 ? `${type.ability.name} (${Math.ceil(cd)}s)` : `${type.ability.name} (Q)`;
  heroAbilityBtn.title = type.ability.desc;
}

// --- Level flow -----------------------------------------------------------

function loadLevel(index) {
  levelIndex = Math.min(Math.max(index, 0), LEVELS.length - 1);
  game = new Game(LEVELS[levelIndex]);
  game.setHero(heroChoice);
  sound.setTheme(LEVELS[levelIndex].id);
  fitCanvas();
  effects.clear();
  ui.selectedSpot = -1;
  ui.heroSelected = false;
  ui.marker = null;
  levelSelect.hidden = true;
  updateHud();
  updateHeroPanel();
  const chapter = STORY.levels[LEVELS[levelIndex].id];
  const briefing = () => { if (chapter) showStory({ title: chapter.title, lines: chapter.lines }, 'To battle'); };
  let seenPrologue = false;
  try { seenPrologue = localStorage.getItem(SEEN_PROLOGUE_KEY) === '1'; } catch { /* fine */ }
  if (levelIndex === 0 && !seenPrologue) {
    try { localStorage.setItem(SEEN_PROLOGUE_KEY, '1'); } catch { /* fine */ }
    showStory(STORY.prologue, 'Continue', briefing);
  } else {
    briefing();
  }
}

// --- Story cards ---------------------------------------------------------
const storyEl = document.getElementById('story');
const storyTitleEl = document.getElementById('story-title');
const storyLinesEl = document.getElementById('story-lines');
const storyNextBtn = document.getElementById('story-next');
let storyDone = null;
const SEEN_PROLOGUE_KEY = 'towerrush-prologue';

function heroName() {
  return HERO_TYPES[heroChoice] ? HERO_TYPES[heroChoice].name : 'your hero';
}

// Show one card; `onDone` runs when the player continues.
function showStory(card, buttonText, onDone) {
  storyTitleEl.textContent = storyText(card.title, heroName());
  storyLinesEl.replaceChildren();
  for (const line of card.lines) {
    const p = document.createElement('p');
    const who = document.createElement('strong');
    who.textContent = `${storyText(line.speaker, heroName())}:`;
    p.append(who, storyText(line.text, heroName()));
    storyLinesEl.appendChild(p);
  }
  storyNextBtn.textContent = buttonText;
  storyDone = onDone;
  storyEl.hidden = false;
}
storyNextBtn.addEventListener('click', () => {
  storyEl.hidden = true;
  const done = storyDone;
  storyDone = null;
  if (done) done();
});

const heroList = document.getElementById('hero-list');
function renderHeroPicker() {
  heroList.replaceChildren();
  for (const hero of Object.values(HERO_TYPES)) {
    const btn = document.createElement('button');
    btn.className = `hero-btn${hero.id === heroChoice ? ' selected' : ''}`;
    btn.style.setProperty('--hero', hero.color);
    btn.title = `${hero.desc} Ability: ${hero.ability.name} — ${hero.ability.desc}`;
    btn.innerHTML = `<span class="hero-icon">${HERO_ICONS[hero.id] || '⭐'}</span><strong>${hero.name}</strong><small>${hero.title}</small><small>${hero.ability.name}</small>`;
    btn.addEventListener('click', () => { saveHeroChoice(hero.id); renderHeroPicker(); });
    heroList.appendChild(btn);
  }
}

function showLevelSelect() {
  const unlocked = loadUnlocked();
  renderHeroPicker();
  levelList.replaceChildren();
  let lastPart = 0;
  LEVELS.forEach((level, i) => {
    if (level.part !== lastPart) {
      lastPart = level.part;
      const head = document.createElement('div');
      head.className = `part-head part-${level.part}`;
      head.textContent = level.part === 1 ? 'Part I — The Marches of Aldermere' : 'Part II — The Underworld';
      levelList.appendChild(head);
    }
    const btn = document.createElement('button');
    btn.className = `level-btn${level.part === 2 ? ' underworld' : ''}`;
    btn.disabled = i > unlocked;
    btn.style.setProperty('--neon', level.theme.neon || '#8fd3ff');
    btn.innerHTML = `<span><strong>${i + 1}. ${level.name}</strong><br><small>${level.subtitle}</small></span><span>${i > unlocked ? '🔒' : `${level.waves.length} waves`}</span>`;
    btn.addEventListener('click', () => loadLevel(i));
    levelList.appendChild(btn);
  });
  levelSelect.hidden = false;
}

// One line of stats for the tower info panel, per attack style.
function describeStats(type, stats) {
  const parts = [];
  if (type.attack === 'aura') {
    parts.push(`towers within ${stats.range} deal ×${stats.boost} damage`);
    return parts.join(' · ');
  }
  if (type.attack === 'field') {
    parts.push(`enemies within ${stats.range} move at ${Math.round(stats.slow * 100)}% speed`);
    if (stats.pulse) parts.push(`${stats.pulse} true dmg/s to everything inside`);
    parts.push('reaches fliers');
    return parts.join(' · ');
  }
  if (stats.salvo) parts.push(`salvo of ${stats.salvo}`);
  if (type.attack === 'beam') {
    parts.push(`${stats.dps} ${type.damageType} dps, up to ×${stats.rampMultiplier} when held`);
  } else {
    parts.push(`${stats.damage} ${type.damageType} dmg`, `${(1 / stats.fireInterval).toFixed(1)}/s`);
  }
  parts.push(stats.minRange ? `${stats.minRange}–${stats.range} range` : `${stats.range} range`);
  if (stats.splashRadius) parts.push(`${stats.splashRadius} splash`);
  if (stats.armorPierce) parts.push(`pierces ${Math.round(stats.armorPierce * 100)}% armor`);
  if (type.targeting === 'toughest') parts.push('targets the toughest');
  if (type.targets === 'ground') parts.push('ground targets only');
  if (stats.slow) parts.push(`slows ${Math.round((1 - stats.slow.factor) * 100)}% for ${stats.slow.duration}s`);
  if (stats.burn) parts.push(`burns ${stats.burn.dps}/s for ${stats.burn.duration}s`);
  if (stats.poison) parts.push(`poison ${stats.poison.dpsPerStack}/s per stack, up to ${stats.poison.maxStacks}`);
  if (stats.jumps) parts.push(`arcs to ${stats.jumps} more`);
  return parts.join(' · ');
}

let statusTimer = null;
function flashStatus(text) {
  statusEl.textContent = text;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(updateHud, 1500);
}

function updateHud() {
  updateWavePreview();
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
  const unlocked = new Set(unlockedTowers(loadUnlocked()));
  for (const btn of towerMenu.querySelectorAll('button[data-type]')) {
    const type = TOWER_TYPES[btn.dataset.type];
    const locked = !unlocked.has(type.id);
    btn.hidden = locked && type.unlockAfter > loadUnlocked() + 1; // far-off towers stay out of the way
    btn.classList.toggle('locked', locked);
    if (locked) {
      btn.title = `${type.name}: unlocks after chapter ${type.unlockAfter + 1}`;
      btn.querySelector('.tower-cost').textContent = `🔒 Ch. ${type.unlockAfter + 1}`;
    } else {
      btn.title = type.desc;
      btn.querySelector('.tower-cost').textContent = `${type.levels[0].cost}g`;
    }
    btn.hidden = !!tower;
    btn.disabled = locked || game.gold < TOWER_TYPES[btn.dataset.type].levels[0].cost;
  }

  if (tower) {
    const type = TOWER_TYPES[tower.typeId];
    const stats = game.towerStats(tower);
    const upgradeCost = game.upgradeCost(tower);
    towerInfoEl.textContent = `${type.name} — Level ${tower.level + 1}/${MAX_TOWER_LEVEL} · ${describeStats(type, stats)}`;
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
    if (boss) {
      const traits = describeTraits(game.enemyTypes[boss.typeId]);
      statusEl.textContent = `${game.enemyTypes[boss.typeId].name} approaches!${traits.length ? ` (${traits.join(', ')})` : ''}`;
    } else {
      statusEl.textContent = `Wave ${game.waveIndex + 1} incoming...`;
    }
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
let heroPanelTimer = 0;
function frame(now) {
  // Clamp dt so a background tab doesn't fast-forward the simulation.
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  const phaseBefore = game.phase;
  const goldBefore = game.gold;
  const livesBefore = game.lives;
  // Fast-forward runs extra fixed steps rather than one big one, so towers,
  // projectiles and status effects behave identically at every speed.
  for (let step = 0; step < speed; step++) {
    game.update(dt);
    const events = game.drainEvents();
    for (const e of events) {
      if (e.type === 'boss-spawned') {
        const chapter = STORY.levels[LEVELS[levelIndex].id];
        if (chapter && chapter.taunt) e.taunt = chapter.taunt;
      }
    }
    effects.process(events);
    sound.process(events);
    effects.ambient(game, dt);
    effects.update(dt);
  }
  sound.update(game, dt);
  if (game.phase !== phaseBefore || game.gold !== goldBefore || game.lives !== livesBefore) {
    updateHud();
  }
  if (game.phase === PHASE.WON && phaseBefore !== PHASE.WON) {
    // Let the fireworks play, then tell the next part of the story.
    const chapter = STORY.levels[LEVELS[levelIndex].id];
    const last = levelIndex + 1 >= LEVELS.length;
    const endOfPart = !last && LEVELS[levelIndex + 1].part !== LEVELS[levelIndex].part;
    setTimeout(() => {
      if (game.phase !== PHASE.WON) return;
      const after = last ? () => showStory(STORY.epilogue, 'The end') : endOfPart ? () => showStory(STORY.interlude, 'Onward to Part II') : null;
      if (chapter && chapter.victory) showStory({ title: chapter.title, lines: chapter.victory }, last ? 'Continue' : 'Onward', after);
      else if (after) after();
    }, 2600);
  }
  if (ui.marker) {
    ui.marker.life -= dt;
    if (ui.marker.life <= 0) ui.marker = null;
  }
  heroPanelTimer += dt;
  if (heroPanelTimer > 0.1) {
    heroPanelTimer = 0;
    updateHeroPanel();
  }
  render(ctx, game, effects, ui, now / 1000);
  requestAnimationFrame(frame);
}

updateHud();
showLevelSelect();
requestAnimationFrame(frame);
