// Procedural audio. Every effect and all the music is synthesized with the
// Web Audio API, so the game ships no sound files. The module never touches
// the DOM, and the AudioContext is created lazily by the first user gesture
// (browsers refuse to play sound before one). Without an AudioContext every
// method is a safe no-op, so the simulation and tests run headless.

const NOTE = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

// Scales as semitone steps from the root, spanning one octave.
const SCALES = {
  majorPent: [0, 2, 4, 7, 9],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  phrygianDom: [0, 1, 4, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  minorPent: [0, 3, 5, 7, 10],
};

// One soundtrack per level: key, scale, a four-chord loop (scale degrees),
// tempos for the three intensities, and instrument timbres.
export const MUSIC_THEMES = {
  greenfields: { root: 62, scale: 'majorPent', chords: [0, 3, 4, 3], tempo: [84, 112, 132], pad: 'triangle', lead: 'triangle', bass: 'sine', bright: 0.5 },
  frostpeak: { root: 64, scale: 'lydian', chords: [0, 4, 1, 4], tempo: [76, 108, 128], pad: 'sine', lead: 'sine', bass: 'triangle', bright: 0.8 },
  sunscorch: { root: 57, scale: 'phrygianDom', chords: [0, 1, 0, 4], tempo: [90, 118, 138], pad: 'sawtooth', lead: 'square', bass: 'sawtooth', bright: 0.35 },
  murkwater: { root: 55, scale: 'dorian', chords: [0, 3, 0, 6], tempo: [80, 110, 130], pad: 'triangle', lead: 'triangle', bass: 'sine', bright: 0.3 },
  caldera: { root: 52, scale: 'harmonicMinor', chords: [0, 5, 3, 4], tempo: [92, 124, 148], pad: 'sawtooth', lead: 'sawtooth', bass: 'sawtooth', bright: 0.25 },
  boss: { root: 50, scale: 'minorPent', chords: [0, 2, 3, 4], tempo: [100, 130, 150], pad: 'sawtooth', lead: 'square', bass: 'sawtooth', bright: 0.4 },
};

// Minimum seconds between repeats of the same cue, so twelve archers do not
// become a wall of twangs.
const RATE_LIMITS = {
  archerShot: 0.05, mageShot: 0.08, cannonShot: 0.12, mortarShot: 0.25, sniperShot: 0.15, frostShot: 0.08,
  venomShot: 0.1, hit: 0.04, explosion: 0.08, zap: 0.1, death: 0.05, coin: 0.1, click: 0.03, frostHit: 0.08,
  venomHit: 0.08, heroSwing: 0.1, heroBreath: 0.15, heroBolt: 0.12, shieldBreak: 0.1, shatter: 0.15,
};
const MAX_VOICES = 28;

export class SoundSystem {
  constructor({ createContext } = {}) {
    this.createContext = createContext || (() => {
      const Ctor = typeof AudioContext !== 'undefined' ? AudioContext : typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null;
      return Ctor ? new Ctor() : null;
    });
    this.ctx = null;
    this.muted = false;
    this.volume = 0.8;
    this.musicVolume = 0.55;
    this.lastPlayed = new Map();
    this.voices = 0;
    this.played = []; // recent cue names, newest last (for debugging and tests)
    this.themeId = 'greenfields';
    this.intensity = 0; // 0 build, 1 wave, 2 boss
    this.music = null;
    this.flameActive = false;
    this.laserHeat = 0;
  }

  get ready() {
    return !!this.ctx;
  }

  // Create the context and graph. Call from a user gesture.
  unlock() {
    if (!this.ctx) {
      this.ctx = this.createContext();
      if (!this.ctx) return false;
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(ctx.destination);
      this.sfx = ctx.createGain();
      this.sfx.gain.value = 1;
      this.sfx.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = this.musicVolume;
      this.musicBus.connect(this.master);
      // A shared white-noise buffer for every noisy sound.
      const len = Math.floor(ctx.sampleRate * 1.5);
      this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.startMusic();
    }
    if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume();
    return true;
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.master && !this.muted) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
  }

  // --- Low-level voices -----------------------------------------------------------

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  panner(x) {
    if (!this.ctx || x === undefined || !this.ctx.createStereoPanner) return null;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-0.8, Math.min(0.8, (x / 800 - 0.5) * 1.4));
    return p;
  }

  // A tone with an envelope and optional pitch glide.
  tone({ type = 'sine', freq, freqEnd, t0, dur, gain = 0.2, attack = 0.005, release, x, bus, detune = 0 }) {
    if (!this.ctx || this.voices >= MAX_VOICES) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    if (detune && osc.detune) osc.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + (release || 0));
    osc.connect(g);
    const pan = this.panner(x);
    if (pan) { g.connect(pan); pan.connect(bus || this.sfx); } else g.connect(bus || this.sfx);
    osc.start(t0);
    osc.stop(t0 + dur + (release || 0) + 0.02);
    this.voices += 1;
    osc.onended = () => { this.voices -= 1; };
  }

  // A burst of filtered noise.
  noise({ t0, dur, gain = 0.2, filter = 'lowpass', freq = 1000, freqEnd, q = 0.8, attack = 0.003, x, bus }) {
    if (!this.ctx || this.voices >= MAX_VOICES) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t0);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    const pan = this.panner(x);
    if (pan) { g.connect(pan); pan.connect(bus || this.sfx); } else g.connect(bus || this.sfx);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
    this.voices += 1;
    src.onended = () => { this.voices -= 1; };
  }

  // --- Cues: named sounds the game asks for ------------------------------------------

  cue(name, opts = {}) {
    if (!this.ctx || this.muted) return false;
    const limit = RATE_LIMITS[name] || 0;
    const t = this.now();
    if (limit && t - (this.lastPlayed.get(name) ?? -1) < limit) return false;
    this.lastPlayed.set(name, t);
    this.played.push(name);
    if (this.played.length > 64) this.played.shift();
    const synth = CUES[name];
    if (synth) synth(this, t + 0.01, opts);
    return true;
  }

  // Map simulation events to cues.
  process(events) {
    for (const e of events) {
      switch (e.type) {
        case 'shot': this.cue(SHOT_CUES[e.towerType] || 'archerShot', { x: e.x, level: e.level }); break;
        case 'hit':
          if (e.towerType === 'cannon' || e.towerType === 'mortar') this.cue('explosion', { x: e.x, big: e.towerType === 'mortar' });
          else if (e.towerType === 'frost') this.cue('frostHit', { x: e.x });
          else if (e.towerType === 'venom') this.cue('venomHit', { x: e.x });
          else if (e.towerType !== 'flame') this.cue('hit', { x: e.x });
          break;
        case 'zap': this.cue('zap', { x: e.points[0].x, jumps: e.points.length }); break;
        case 'enemy-died': this.cue(e.boss ? 'bossDeath' : 'death', { x: e.x }); break;
        case 'enemy-leaked': this.cue('leak', { cost: e.cost }); break;
        case 'tower-built': this.cue('build', { x: e.x }); break;
        case 'tower-upgraded': this.cue('upgrade', { x: e.x }); break;
        case 'tower-sold': this.cue('coin', { x: e.x }); break;
        case 'wave-started': this.cue(e.final ? 'finalHorn' : 'horn'); break;
        case 'boss-spawned': this.cue('bossHorn'); break;
        case 'boss-summons': this.cue('summons'); break;
        case 'boss-enraged': this.cue('roar'); break;
        case 'shatter': this.cue('shatter', { x: e.x }); break;
        case 'shield-broken': this.cue('shieldBreak', { x: e.x }); break;
        case 'game-won': this.cue('victory'); break;
        case 'game-lost': this.cue('defeat'); break;
        case 'hero-attack':
          this.cue(e.heroType === 'dragon' ? 'heroBreath' : e.heroType === 'mage' ? 'heroBolt' : 'heroSwing', { x: e.x });
          break;
        case 'hero-ability': this.cue(`ability_${e.heroType}`, { x: e.x }); break;
        case 'hero-died': this.cue('heroDown'); break;
        case 'hero-respawned': this.cue('heroReturn', { x: e.x }); break;
        case 'hero-levelup': this.cue('levelUp', { x: e.x }); break;
        default: break;
      }
    }
  }

  // Continuous sounds and the music, driven by game state every frame.
  update(game, dt) {
    if (!this.ctx) return;
    const flame = game.towers.some((t) => t && t.typeId === 'flame' && t.cooldown > 0);
    let heat = 0;
    for (const t of game.towers) if (t && t.typeId === 'laser' && t.beamTargetId) heat = Math.max(heat, game.beamMultiplier(t));
    this.setFlame(flame);
    this.setLaser(heat);
    const intensity = game.phase === 'wave' ? (game.boss ? 2 : 1) : 0;
    this.setIntensity(intensity);
    this.tickMusic();
  }

  // Flamethrower roar: a looping low noise that fades in and out.
  setFlame(active) {
    if (!this.ctx || active === this.flameActive) return;
    this.flameActive = active;
    const ctx = this.ctx;
    if (active) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 900;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 9;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 300;
      lfo.connect(lfoGain);
      lfoGain.connect(f.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.15);
      src.connect(f);
      f.connect(g);
      g.connect(this.sfx);
      src.start();
      lfo.start();
      this.flameNodes = { src, lfo, g };
    } else if (this.flameNodes) {
      const { src, lfo, g } = this.flameNodes;
      g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08);
      src.stop(ctx.currentTime + 0.4);
      lfo.stop(ctx.currentTime + 0.4);
      this.flameNodes = null;
    }
  }

  // Laser hum: pitch and volume rise with the beam's heat.
  setLaser(heat) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (heat > 0 && !this.laserNodes) {
      const a = ctx.createOscillator();
      a.type = 'sawtooth';
      const b = ctx.createOscillator();
      b.type = 'sine';
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.1);
      a.connect(f);
      b.connect(f);
      f.connect(g);
      g.connect(this.sfx);
      a.start();
      b.start();
      this.laserNodes = { a, b, g, f };
    }
    if (this.laserNodes) {
      if (heat <= 0) {
        const { a, b, g } = this.laserNodes;
        g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05);
        a.stop(ctx.currentTime + 0.3);
        b.stop(ctx.currentTime + 0.3);
        this.laserNodes = null;
      } else {
        const k = Math.min(1, (heat - 1) / 3);
        this.laserNodes.a.frequency.setTargetAtTime(110 + k * 160, ctx.currentTime, 0.1);
        this.laserNodes.b.frequency.setTargetAtTime(220 + k * 440, ctx.currentTime, 0.1);
        this.laserNodes.g.gain.setTargetAtTime(0.05 + k * 0.08, ctx.currentTime, 0.1);
      }
    }
    this.laserHeat = heat;
  }

  // --- Music: a lookahead sequencer playing a generative loop ------------------------

  setTheme(id) {
    this.themeId = MUSIC_THEMES[id] ? id : 'greenfields';
    if (this.music) this.music.theme = MUSIC_THEMES[this.themeId];
  }

  setIntensity(level) {
    if (level === this.intensity) return;
    this.intensity = level;
    if (this.music) this.music.pendingIntensity = level; // switches at the next bar
  }

  startMusic() {
    this.music = {
      theme: MUSIC_THEMES[this.themeId],
      step: 0,
      nextTime: this.now() + 0.1,
      intensity: this.intensity,
      pendingIntensity: null,
      leadIndex: 7,
      lastLead: -1,
    };
  }

  tickMusic() {
    const m = this.music;
    if (!m || this.muted) return;
    const now = this.now();
    while (m.nextTime < now + 0.2) {
      if (m.step % 16 === 0 && m.pendingIntensity !== null) {
        m.intensity = m.pendingIntensity;
        m.pendingIntensity = null;
      }
      this.scheduleStep(m, m.nextTime);
      const theme = m.intensity === 2 ? MUSIC_THEMES.boss : m.theme;
      m.nextTime += 60 / theme.tempo[m.intensity] / 4;
      m.step = (m.step + 1) % 64;
    }
  }

  scheduleStep(m, t) {
    const theme = m.intensity === 2 ? MUSIC_THEMES.boss : m.theme;
    const scale = SCALES[theme.scale];
    const stepDur = 60 / theme.tempo[m.intensity] / 4;
    const bar = Math.floor(m.step / 16);
    const beat = m.step % 16;
    const degree = theme.chords[bar];
    const chordNote = (k) => theme.root + 12 * Math.floor((degree + k) / scale.length) + scale[(degree + k) % scale.length];
    const root = chordNote(0);
    const third = chordNote(2);
    const fifth = chordNote(4);
    // Pad: a chord held for the bar, three soft detuned voices.
    if (beat === 0) {
      const dur = stepDur * 16;
      for (const [note, det] of [[root, -6], [third, 4], [fifth, 0]]) {
        this.tone({ type: theme.pad, freq: NOTE(note), t0: t, dur: dur * 0.95, gain: 0.035 + theme.bright * 0.015, attack: dur * 0.3, release: 0.4, bus: this.musicBus, detune: det });
      }
    }
    // Bass: whole notes while building, on the beats in a wave, driving eighths against a boss.
    const bassOn = m.intensity === 0 ? beat === 0 : m.intensity === 1 ? beat % 4 === 0 : beat % 2 === 0;
    if (bassOn) {
      const n = m.intensity === 2 && beat % 4 === 2 ? fifth - 12 : root - 12;
      this.tone({ type: theme.bass, freq: NOTE(n), t0: t, dur: m.intensity === 0 ? stepDur * 14 : stepDur * 1.6, gain: 0.11, attack: 0.01, release: 0.1, bus: this.musicBus });
    }
    // Lead: a random walk through the scale, denser as the fight heats up.
    const density = [0.22, 0.42, 0.6][m.intensity];
    const onGrid = m.intensity === 0 ? beat % 2 === 0 : true;
    if (onGrid && (beat === 0 || Math.random() < density)) {
      const range = scale.length * 2;
      let idx = m.leadIndex + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.7 ? 1 : 2);
      if (beat === 0) idx = scale.length + [0, 2, 4][Math.floor(Math.random() * 3)] + degree; // chord tone on the downbeat
      idx = Math.max(0, Math.min(range - 1, idx));
      m.leadIndex = idx;
      const note = theme.root + 12 + 12 * Math.floor(idx / scale.length) + scale[idx % scale.length];
      const dur = stepDur * (beat === 0 ? 3 : Math.random() < 0.3 ? 2 : 1);
      this.tone({ type: theme.lead, freq: NOTE(note), t0: t, dur, gain: 0.05 + theme.bright * 0.03, attack: 0.01, release: 0.15, bus: this.musicBus });
    }
    // Drums from intensity 1: kick, snare, hats; boss adds toms.
    if (m.intensity >= 1) {
      if (beat % 4 === 0 || (m.intensity === 2 && beat === 14)) this.drum('kick', t);
      if (beat === 4 || beat === 12) this.drum('snare', t);
      if (beat % 2 === 1 || m.intensity === 2) this.drum('hat', t, beat % 4 === 3 ? 0.06 : 0.035);
      if (m.intensity === 2 && (beat === 7 || beat === 15)) this.drum('tom', t);
    }
  }

  drum(kind, t, gain) {
    if (kind === 'kick') {
      this.tone({ type: 'sine', freq: 150, freqEnd: 40, t0: t, dur: 0.22, gain: 0.3, attack: 0.002, bus: this.musicBus });
    } else if (kind === 'snare') {
      this.noise({ t0: t, dur: 0.14, gain: 0.14, filter: 'bandpass', freq: 1800, q: 0.6, bus: this.musicBus });
      this.tone({ type: 'triangle', freq: 190, freqEnd: 120, t0: t, dur: 0.08, gain: 0.12, attack: 0.002, bus: this.musicBus });
    } else if (kind === 'hat') {
      this.noise({ t0: t, dur: 0.04, gain: gain || 0.04, filter: 'highpass', freq: 7000, bus: this.musicBus });
    } else if (kind === 'tom') {
      this.tone({ type: 'sine', freq: 110, freqEnd: 70, t0: t, dur: 0.25, gain: 0.2, attack: 0.002, bus: this.musicBus });
    }
  }
}

const SHOT_CUES = {
  archer: 'archerShot', mage: 'mageShot', cannon: 'cannonShot', mortar: 'mortarShot', sniper: 'sniperShot',
  frost: 'frostShot', tesla: null, flame: null, venom: 'venomShot', laser: null, beacon: null,
};

// A touch of pitch variation keeps repeated sounds from feeling mechanical.
const vary = (f, amount = 0.08) => f * (1 + (Math.random() * 2 - 1) * amount);

const CUES = {
  // Towers.
  archerShot: (s, t, o) => {
    s.noise({ t0: t, dur: 0.05, gain: 0.12, filter: 'bandpass', freq: vary(2600), q: 1.2, x: o.x });
    s.tone({ type: 'triangle', freq: vary(520), freqEnd: 260, t0: t, dur: 0.07, gain: 0.07, x: o.x });
  },
  mageShot: (s, t, o) => {
    s.tone({ type: 'sine', freq: vary(600), freqEnd: 1500, t0: t, dur: 0.22, gain: 0.08, attack: 0.02, release: 0.1, x: o.x });
    s.tone({ type: 'triangle', freq: vary(1200), freqEnd: 2400, t0: t + 0.05, dur: 0.15, gain: 0.04, x: o.x });
  },
  cannonShot: (s, t, o) => {
    s.tone({ type: 'sine', freq: 110, freqEnd: 35, t0: t, dur: 0.25, gain: 0.35, attack: 0.003, x: o.x });
    s.noise({ t0: t, dur: 0.18, gain: 0.22, filter: 'lowpass', freq: 1400, freqEnd: 200, x: o.x });
  },
  mortarShot: (s, t, o) => {
    s.tone({ type: 'sine', freq: 90, freqEnd: 30, t0: t, dur: 0.35, gain: 0.4, attack: 0.003, x: o.x });
    s.noise({ t0: t, dur: 0.3, gain: 0.25, filter: 'lowpass', freq: 900, freqEnd: 120, x: o.x });
  },
  sniperShot: (s, t, o) => {
    s.noise({ t0: t, dur: 0.06, gain: 0.3, filter: 'highpass', freq: 1200, x: o.x });
    s.noise({ t0: t + 0.03, dur: 0.35, gain: 0.1, filter: 'lowpass', freq: 2500, freqEnd: 300, x: o.x });
    s.tone({ type: 'sine', freq: 180, freqEnd: 60, t0: t, dur: 0.12, gain: 0.15, x: o.x });
  },
  frostShot: (s, t, o) => {
    s.tone({ type: 'triangle', freq: vary(1400), freqEnd: 2200, t0: t, dur: 0.18, gain: 0.05, attack: 0.01, release: 0.12, x: o.x });
    s.tone({ type: 'sine', freq: vary(2800), t0: t + 0.04, dur: 0.1, gain: 0.03, x: o.x });
  },
  venomShot: (s, t, o) => {
    s.noise({ t0: t, dur: 0.12, gain: 0.12, filter: 'lowpass', freq: 1800, freqEnd: 400, x: o.x });
    s.tone({ type: 'sine', freq: vary(300), freqEnd: 120, t0: t, dur: 0.14, gain: 0.07, x: o.x });
  },
  hit: (s, t, o) => {
    s.noise({ t0: t, dur: 0.05, gain: 0.08, filter: 'bandpass', freq: vary(1800), q: 1, x: o.x });
  },
  explosion: (s, t, o) => {
    const k = o.big ? 1.5 : 1;
    s.tone({ type: 'sine', freq: 90 * k, freqEnd: 28, t0: t, dur: 0.4 * k, gain: 0.4, attack: 0.003, x: o.x });
    s.noise({ t0: t, dur: 0.45 * k, gain: 0.3, filter: 'lowpass', freq: 3000, freqEnd: 150, x: o.x });
    s.noise({ t0: t, dur: 0.08, gain: 0.15, filter: 'highpass', freq: 3000, x: o.x });
  },
  frostHit: (s, t, o) => {
    for (let i = 0; i < 3; i++) s.tone({ type: 'sine', freq: vary(2400 + i * 500, 0.15), t0: t + i * 0.03, dur: 0.12, gain: 0.04, x: o.x });
    s.noise({ t0: t, dur: 0.1, gain: 0.06, filter: 'highpass', freq: 5000, x: o.x });
  },
  venomHit: (s, t, o) => {
    s.noise({ t0: t, dur: 0.16, gain: 0.12, filter: 'lowpass', freq: 1200, freqEnd: 250, x: o.x });
    s.tone({ type: 'sine', freq: vary(220), freqEnd: 90, t0: t, dur: 0.12, gain: 0.05, x: o.x });
  },
  zap: (s, t, o) => {
    const n = Math.min(6, o.jumps || 2);
    for (let i = 0; i < n; i++) {
      s.tone({ type: 'sawtooth', freq: vary(900, 0.3), freqEnd: vary(300, 0.3), t0: t + i * 0.035, dur: 0.06, gain: 0.09, x: o.x });
      s.noise({ t0: t + i * 0.035, dur: 0.05, gain: 0.08, filter: 'highpass', freq: 2500, x: o.x });
    }
  },
  shatter: (s, t, o) => {
    s.noise({ t0: t, dur: 0.25, gain: 0.2, filter: 'highpass', freq: 3500, x: o.x });
    for (let i = 0; i < 5; i++) s.tone({ type: 'sine', freq: vary(3000, 0.3), freqEnd: vary(1800, 0.2), t0: t + i * 0.03, dur: 0.12, gain: 0.05, x: o.x });
    s.tone({ type: 'sine', freq: 120, freqEnd: 50, t0: t, dur: 0.2, gain: 0.2, x: o.x });
  },
  shieldBreak: (s, t, o) => {
    s.tone({ type: 'triangle', freq: 1800, freqEnd: 500, t0: t, dur: 0.22, gain: 0.1, x: o.x });
    s.noise({ t0: t, dur: 0.2, gain: 0.12, filter: 'bandpass', freq: 4000, q: 1.5, x: o.x });
  },
  // Enemies and the castle.
  death: (s, t, o) => {
    s.tone({ type: 'triangle', freq: vary(380, 0.2), freqEnd: 90, t0: t, dur: 0.16, gain: 0.1, x: o.x });
    s.noise({ t0: t, dur: 0.1, gain: 0.07, filter: 'lowpass', freq: 1500, freqEnd: 300, x: o.x });
  },
  bossDeath: (s, t, o) => {
    s.tone({ type: 'sawtooth', freq: 160, freqEnd: 30, t0: t, dur: 1.2, gain: 0.25, attack: 0.01, x: o.x });
    s.noise({ t0: t, dur: 1.0, gain: 0.3, filter: 'lowpass', freq: 2500, freqEnd: 100, x: o.x });
    for (let i = 0; i < 4; i++) s.tone({ type: 'sine', freq: 100 * (i + 1), freqEnd: 30, t0: t + i * 0.12, dur: 0.4, gain: 0.2, x: o.x });
  },
  leak: (s, t, o) => {
    const k = Math.min(3, o.cost || 1);
    s.tone({ type: 'square', freq: 440, freqEnd: 330, t0: t, dur: 0.14, gain: 0.07 + k * 0.02 });
    s.tone({ type: 'square', freq: 330, freqEnd: 220, t0: t + 0.16, dur: 0.22, gain: 0.08 + k * 0.02 });
    if (k > 1) s.tone({ type: 'sine', freq: 90, freqEnd: 40, t0: t, dur: 0.4, gain: 0.25 });
  },
  build: (s, t, o) => {
    for (let i = 0; i < 3; i++) {
      s.noise({ t0: t + i * 0.09, dur: 0.04, gain: 0.14, filter: 'bandpass', freq: vary(2200), q: 2, x: o.x });
      s.tone({ type: 'triangle', freq: vary(700), freqEnd: 400, t0: t + i * 0.09, dur: 0.05, gain: 0.06, x: o.x });
    }
  },
  upgrade: (s, t, o) => {
    [523, 659, 784, 1047].forEach((f, i) => s.tone({ type: 'triangle', freq: f, t0: t + i * 0.07, dur: 0.16, gain: 0.08, release: 0.1, x: o.x }));
    s.noise({ t0: t, dur: 0.04, gain: 0.1, filter: 'bandpass', freq: 2200, q: 2, x: o.x });
  },
  coin: (s, t, o) => {
    s.tone({ type: 'sine', freq: 1568, t0: t, dur: 0.08, gain: 0.08, x: o.x });
    s.tone({ type: 'sine', freq: 2093, t0: t + 0.07, dur: 0.18, gain: 0.08, release: 0.1, x: o.x });
  },
  click: (s, t) => {
    s.tone({ type: 'sine', freq: 900, freqEnd: 600, t0: t, dur: 0.04, gain: 0.05 });
  },
  horn: (s, t) => {
    for (const f of [220, 277, 330]) s.tone({ type: 'sawtooth', freq: f, t0: t, dur: 0.6, gain: 0.07, attack: 0.08, release: 0.3 });
    s.tone({ type: 'sawtooth', freq: 440, t0: t + 0.35, dur: 0.5, gain: 0.07, attack: 0.05, release: 0.3 });
  },
  finalHorn: (s, t) => {
    for (const f of [110, 165, 220, 277]) s.tone({ type: 'sawtooth', freq: f, t0: t, dur: 1.0, gain: 0.08, attack: 0.1, release: 0.5 });
    s.tone({ type: 'sine', freq: 70, freqEnd: 50, t0: t, dur: 0.8, gain: 0.25, attack: 0.02 });
  },
  bossHorn: (s, t) => {
    for (let i = 0; i < 8; i++) s.tone({ type: 'sine', freq: 95, freqEnd: 50, t0: t + i * 0.11, dur: 0.1, gain: 0.25, attack: 0.002 });
    for (const f of [82, 123, 147]) s.tone({ type: 'sawtooth', freq: f, t0: t + 0.5, dur: 1.4, gain: 0.09, attack: 0.15, release: 0.6 });
  },
  summons: (s, t) => {
    for (const f of [130, 155, 185, 233]) s.tone({ type: 'triangle', freq: f, freqEnd: f * 0.94, t0: t, dur: 0.9, gain: 0.08, attack: 0.05, release: 0.4 });
    s.noise({ t0: t, dur: 0.6, gain: 0.08, filter: 'lowpass', freq: 600, freqEnd: 150 });
  },
  roar: (s, t) => {
    s.tone({ type: 'sawtooth', freq: 90, freqEnd: 140, t0: t, dur: 0.5, gain: 0.18, attack: 0.03, release: 0.3 });
    s.tone({ type: 'sawtooth', freq: 135, freqEnd: 200, t0: t, dur: 0.5, gain: 0.1, attack: 0.03, release: 0.3 });
    s.noise({ t0: t, dur: 0.6, gain: 0.2, filter: 'bandpass', freq: 500, freqEnd: 900, q: 0.7 });
  },
  victory: (s, t) => {
    [523, 659, 784, 1047, 1319].forEach((f, i) => s.tone({ type: 'triangle', freq: f, t0: t + i * 0.12, dur: 0.3, gain: 0.1, release: 0.3 }));
    for (const f of [262, 330, 392]) s.tone({ type: 'sawtooth', freq: f, t0: t + 0.6, dur: 1.4, gain: 0.06, attack: 0.1, release: 0.6 });
  },
  defeat: (s, t) => {
    [392, 349, 311, 262].forEach((f, i) => s.tone({ type: 'sawtooth', freq: f, t0: t + i * 0.3, dur: 0.45, gain: 0.09, attack: 0.03, release: 0.3 }));
    s.tone({ type: 'sine', freq: 65, freqEnd: 40, t0: t + 1.0, dur: 1.2, gain: 0.2 });
  },
  // Heroes.
  heroSwing: (s, t, o) => {
    s.noise({ t0: t, dur: 0.08, gain: 0.12, filter: 'bandpass', freq: vary(3200), q: 3, x: o.x });
    s.tone({ type: 'triangle', freq: vary(2400), freqEnd: 1200, t0: t, dur: 0.12, gain: 0.05, x: o.x });
  },
  heroBreath: (s, t, o) => {
    s.noise({ t0: t, dur: 0.35, gain: 0.16, filter: 'lowpass', freq: 600, freqEnd: 1800, x: o.x });
  },
  heroBolt: (s, t, o) => {
    s.tone({ type: 'sine', freq: vary(900), freqEnd: 2200, t0: t, dur: 0.18, gain: 0.07, x: o.x });
  },
  ability_dragon: (s, t, o) => {
    s.noise({ t0: t, dur: 1.2, gain: 0.25, filter: 'lowpass', freq: 400, freqEnd: 2500, x: o.x });
    s.tone({ type: 'sine', freq: 70, freqEnd: 40, t0: t + 0.2, dur: 0.8, gain: 0.3, x: o.x });
  },
  ability_knight: (s, t, o) => {
    for (let i = 0; i < 4; i++) s.noise({ t0: t + i * 0.08, dur: 0.1, gain: 0.14, filter: 'bandpass', freq: vary(3000), q: 3, x: o.x });
    s.tone({ type: 'sawtooth', freq: 200, freqEnd: 600, t0: t, dur: 0.35, gain: 0.08, x: o.x });
  },
  ability_mage: (s, t, o) => {
    s.tone({ type: 'sine', freq: 2600, freqEnd: 600, t0: t, dur: 0.7, gain: 0.1, attack: 0.02, release: 0.3, x: o.x });
    s.noise({ t0: t, dur: 0.6, gain: 0.12, filter: 'highpass', freq: 4000, x: o.x });
    for (let i = 0; i < 5; i++) s.tone({ type: 'sine', freq: vary(2000 + i * 300, 0.1), t0: t + 0.1 + i * 0.06, dur: 0.2, gain: 0.04, x: o.x });
  },
  ability_paladin: (s, t, o) => {
    for (const f of [196, 247, 294, 392]) s.tone({ type: 'triangle', freq: f, t0: t, dur: 1.0, gain: 0.07, attack: 0.08, release: 0.5, x: o.x });
    s.noise({ t0: t, dur: 0.5, gain: 0.1, filter: 'lowpass', freq: 800, freqEnd: 200, x: o.x });
  },
  heroDown: (s, t) => {
    [330, 262, 196].forEach((f, i) => s.tone({ type: 'triangle', freq: f, t0: t + i * 0.18, dur: 0.3, gain: 0.1, release: 0.2 }));
  },
  heroReturn: (s, t, o) => {
    [392, 523, 659].forEach((f, i) => s.tone({ type: 'triangle', freq: f, t0: t + i * 0.1, dur: 0.25, gain: 0.08, release: 0.2, x: o.x }));
  },
  levelUp: (s, t, o) => {
    [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => s.tone({ type: 'sine', freq: f, t0: t + i * 0.06, dur: 0.2, gain: 0.08, release: 0.2, x: o.x }));
  },
};
