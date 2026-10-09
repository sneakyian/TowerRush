// The sound system maps game events to synthesized cues and keeps a
// generative soundtrack in step with the fight. It runs against a tiny fake
// AudioContext here; without any context every call is a harmless no-op.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SoundSystem, MUSIC_THEMES } from '../src/audio.js';
import { LEVELS } from '../src/levels.js';

// A fake Web Audio context that records what gets scheduled.
function fakeContext() {
  const log = { oscillators: 0, noises: 0, starts: [] };
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, linearRampToValueAtTime() {} });
  const node = (extra = {}) => ({ connect() {}, disconnect() {}, gain: param(), frequency: param(), detune: param(), Q: param(), pan: param(), ...extra });
  const ctx = {
    currentTime: 0,
    sampleRate: 8000,
    state: 'running',
    destination: {},
    log,
    createGain: () => node(),
    createBiquadFilter: () => node({ type: 'lowpass' }),
    createStereoPanner: () => node(),
    createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
    createOscillator: () => { log.oscillators += 1; return node({ type: 'sine', start(t) { log.starts.push(t); }, stop() {} }); },
    createBufferSource: () => { log.noises += 1; return node({ start(t) { log.starts.push(t); }, stop() {}, loop: false }); },
  };
  return ctx;
}

function makeSound() {
  const ctx = fakeContext();
  const sound = new SoundSystem({ createContext: () => ctx });
  sound.unlock();
  return { sound, ctx };
}

test('without an AudioContext every call is a safe no-op', () => {
  const sound = new SoundSystem({ createContext: () => null });
  assert.equal(sound.unlock(), false);
  assert.equal(sound.ready, false);
  assert.equal(sound.cue('explosion', { x: 10 }), false);
  sound.process([{ type: 'shot', towerType: 'archer', x: 1, y: 1 }]);
  sound.update({ towers: [], phase: 'wave', boss: null }, 0.05);
  assert.deepEqual(sound.played, []);
});

test('game events map to cues and schedule voices', () => {
  const { sound, ctx } = makeSound();
  const before = ctx.log.oscillators + ctx.log.noises;
  sound.process([
    { type: 'shot', towerType: 'cannon', x: 100, y: 50 },
    { type: 'hit', towerType: 'cannon', x: 150, y: 50, splash: 40 },
    { type: 'zap', points: [{ x: 10, y: 10 }, { x: 40, y: 10 }], towerType: 'tesla' },
    { type: 'enemy-died', x: 1, y: 1, bounty: 5, enemyType: 'goblin' },
    { type: 'wave-started', wave: 1 },
    { type: 'hero-ability', heroType: 'mage', name: 'Frost Nova', x: 5, y: 5 },
  ]);
  assert.deepEqual(sound.played, ['cannonShot', 'explosion', 'zap', 'death', 'horn', 'ability_mage']);
  assert.ok(ctx.log.oscillators + ctx.log.noises > before + 6, 'voices were created');
});

test('identical cues are rate limited and muting silences everything', () => {
  const { sound, ctx } = makeSound();
  ctx.currentTime = 1;
  assert.equal(sound.cue('archerShot', { x: 1 }), true);
  assert.equal(sound.cue('archerShot', { x: 1 }), false, 'too soon');
  ctx.currentTime = 1.1;
  assert.equal(sound.cue('archerShot', { x: 1 }), true);
  sound.setMuted(true);
  ctx.currentTime = 2;
  assert.equal(sound.cue('archerShot', { x: 1 }), false);
  assert.equal(sound.toggleMute(), false);
});

test('music intensity follows the fight and switches theme per level', () => {
  const { sound, ctx } = makeSound();
  for (const level of LEVELS) assert.ok(MUSIC_THEMES[level.id], `${level.id} has a soundtrack`);
  sound.setTheme('caldera');
  assert.equal(sound.music.theme, MUSIC_THEMES.caldera);
  const game = { towers: [], phase: 'build', boss: null, beamMultiplier: () => 1 };
  sound.update(game, 0.05);
  assert.equal(sound.intensity, 0);
  game.phase = 'wave';
  sound.update(game, 0.05);
  assert.equal(sound.intensity, 1);
  game.boss = { id: 1 };
  sound.update(game, 0.05);
  assert.equal(sound.intensity, 2);
  // The sequencer schedules ahead of the clock as time advances.
  const starts = ctx.log.starts.length;
  ctx.currentTime = 2;
  sound.update(game, 0.05);
  assert.ok(ctx.log.starts.length > starts, 'notes scheduled');
  assert.ok(sound.music.nextTime >= 2, 'lookahead kept up with the clock');
});

test('continuous flame and laser sounds start and stop with the towers', () => {
  const { sound } = makeSound();
  const game = { towers: [{ typeId: 'flame', cooldown: 0.1 }, { typeId: 'laser', beamTargetId: 3 }], phase: 'wave', boss: null, beamMultiplier: () => 2.5 };
  sound.update(game, 0.05);
  assert.ok(sound.flameNodes, 'flame roaring');
  assert.ok(sound.laserNodes, 'laser humming');
  game.towers[0].cooldown = 0;
  game.towers[1].beamTargetId = null;
  game.beamMultiplier = () => 1;
  sound.update(game, 0.05);
  assert.equal(sound.flameNodes, null);
  assert.equal(sound.laserNodes, null);
});
