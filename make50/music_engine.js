(function(){
'use strict';

// --- Audio System (Web Audio API) ---
// Lightweight generative music + SFX for a calm, playful educational puzzle vibe.
// Drop-in replacement for playComboSound / playUndoSound / playWinSound.

class MusicEngine {
  constructor(ctx) {
    this.ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();

    // User toggle
    this.enabled = true;

    // ---- Session variety ----
    this.seed = (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
    

    // FIX: xorshift breaks if the seed is exactly 0. 
    if (this.seed === 0) this.seed = 1;

    this._rngState = this.seed;

    // Scales (calm / bright)
    this.SCALES = {
      major: [0, 2, 4, 5, 7, 9, 11],
      dorian: [0, 2, 3, 5, 7, 9, 10],
      lydian: [0, 2, 4, 6, 7, 9, 11],
      pentatonic: [0, 2, 4, 7, 9],
    };

    const scaleNames = Object.keys(this.SCALES);
    this.scaleName = scaleNames[this._randi(0, scaleNames.length - 1)];
    this.scale = this.SCALES[this.scaleName];

    // Root between C2..G2-ish (keeps it warm / not shrill)
    this.rootMidi = 48 + this._randi(0, 7);

    // Tempo: calm but not sleepy
    this.tempo = 90 + this._randi(0, 18); // 90..108 BPM
    this.stepsPerBar = 16; // 16th notes
    this.swing = 0.06 + this._rand() * 0.05; // subtle groove

    // ---- State ----
    this.comboLevel = 0;
    this._started = false;
    this._timer = null;
    this._nextNoteTime = 0;
    this._step = 0;

    // Chord movement across bars (degrees in scale)
    this._bar = 0;
    this._progression = this._pickProgression();
    this._progIdx = 0;

    this._lastMelodyDeg = null;

    // ---- Audio graph ----
    // FIX: Changed ctx. to this.ctx. on all creation methods
    this.master = this.ctx.createGain();
    this.music = this.ctx.createGain();
    this.sfx = this.ctx.createGain();

    // Keep it gentle by default
    this.master.gain.value = 0.9;
    this.music.gain.value = 0.22;
    this.sfx.gain.value = 0.55;

    // Tiny delay for depth
    this.delay = this.ctx.createDelay(0.25);
    this.delay.delayTime.value = 0.13;

    this.delayFb = this.ctx.createGain();
    this.delayFb.gain.value = 0.18;

    this.delayMix = this.ctx.createGain();
    this.delayMix.gain.value = 0.14;

    this.delay.connect(this.delayFb);
    this.delayFb.connect(this.delay);

    // Route
    this.music.connect(this.master);
    this.sfx.connect(this.master);
    this.delay.connect(this.delayMix);
    this.delayMix.connect(this.music);

    // FIX: Changed ctx.destination to this.ctx.destination
    this.master.connect(this.ctx.destination);
  }

  // -------- Public API --------


  setEnabled(v) {
    this.enabled = !!v;
    if (!this.enabled) {
      this.stop();
    }
  }

  start() {
    this._started = true;
    this._nextNoteTime = this.ctx.currentTime + 0.05;
    this._step = 0;
    this._bar = 0;
    this._progIdx = 0;

    // Scheduler (lookahead)
    const lookaheadMs = 25;
    const scheduleAheadSec = 0.12;
    this._timer = setInterval(() => {
      const now = this.ctx.currentTime;
      while (this._nextNoteTime < now + scheduleAheadSec) {
        this._scheduleStep(this._step, this._nextNoteTime);
        this._advanceTime();
      }
    }, lookaheadMs);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this._started = false;
  }

  setCombo(level) {
    this.comboLevel = Math.max(0, level | 0);
  }

// Replace these 4 functions entirely in music_engine.js
  resume() {
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  onCombo(level) {
    this.resume();
    this.setCombo(level);
    this._playComboAccent(level);
  }

  onUndo() {
    this.resume();
    this._playUndoBlip();
  }

  onWin() {
    this.resume();
    this._playWinArp();
  }

  // -------- Scheduling --------
  _advanceTime() {
    const secondsPerBeat = 60.0 / this.tempo;
    const secondsPerStep = secondsPerBeat / 4; // 16th notes

    // Subtle swing on off-steps
    const isOff = (this._step % 2) === 1;
    const swingOffset = isOff ? secondsPerStep * this.swing : 0;

    this._nextNoteTime += secondsPerStep + swingOffset;
    this._step++;

    if (this._step % this.stepsPerBar === 0) {
      this._bar++;
      if (this._bar % 2 === 0) {
        // Every 2 bars, maybe move chord
        if (this._rand() < 0.85) this._progIdx = (this._progIdx + 1) % this._progression.length;
      }
      // Occasionally refresh progression to keep sessions evolving
      if (this._bar % 16 === 0 && this._rand() < 0.5) {
        this._progression = this._pickProgression();
        this._progIdx = 0;
      }
    }
  }

  _scheduleStep(step, t) {
    const c = this.comboLevel;

    // 1. BASE HARMONY (Pad): Always on.
    if (step % this.stepsPerBar === 0) {
      this._playPadChord(t, 2.0);
      
      // LAYER UP (Combo 4+): Play an extra, higher chord to massively thicken the sound!
      if (c >= 4) {
          this._playPadChord(t, 1.0); 
      }
    }

    // 2. BASS: Unlocks instantly at Combo 1.
    if (c >= 1 && (step % 8 === 0)) {
      this._playBass(t);
      
      // LAYER UP (Combo 5+): Double the bass hits to drive the rhythm!
      if (c >= 5 && (step % 4 === 0)) {
          this._playBass(t);
      }
    }

    // 3. MELODY: Plays more often as combo grows.
    const melodyChance = c === 0 ? 0.55 : c <= 2 ? 0.75 : 0.95;
    
    if (this._rand() < melodyChance && (step % 2 === 0)) {
      this._playMelody(t, c);
      
      // LAYER UP (Combo 2+): Instantly play a second, higher note with the melody (Harmony!)
      if (c >= 2 && this._rand() < 0.8) {
          this._playSparkle(t); // Reusing the sparkle instrument as a bright harmony pluck
      }
    }

    // 4. COUNTER-MELODY (Arpeggios): Unlocks at Combo 3.
    if (c >= 3 && (step % 4 === 0)) {
      this._playSparkle(t);
    }
    
    // 5. INTENSE ARPEGGIO MADNESS: Unlocks at Combo 5+.
    if (c >= 5 && (step % 2 === 1)) {
      // Fire rapid-fire sparkles on every single off-beat to build frantic tension!
      this._playSparkle(t);
    }
  }

  // -------- Music building blocks --------
  _currentChordDegrees() {
    // chord degree is progression root within scale
    const degRoot = this._progression[this._progIdx];
    // Build a triad in-scale: root, 3rd, 5th (scale degrees)
    return [degRoot, degRoot + 2, degRoot + 4];
  }

  _degToMidi(deg, octaveOffset = 0) {
    const s = this.scale;
    const scaleLen = s.length;

    // Wrap degrees across octaves
    let d = deg;
    let oct = 0;
    while (d < 0) { d += scaleLen; oct -= 1; }
    while (d >= scaleLen) { d -= scaleLen; oct += 1; }

    const semis = s[d] + 12 * oct;
    return this.rootMidi + semis + 12 * octaveOffset;
  }

  _midiToFreq(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  _playMelody(t, combo) {
    // Bias toward chord tones for cohesion
    const chord = this._currentChordDegrees();
    const useChordTone = this._rand() < (combo >= 5 ? 0.65 : 0.52);

    let deg;
    if (useChordTone) {
      deg = chord[this._randi(0, chord.length - 1)];
    } else {
      deg = this._randi(0, this.scale.length - 1);
    }

    // Gentle repetition to feel intentional
    if (this._lastMelodyDeg !== null && this._rand() < 0.33) deg = this._lastMelodyDeg;
    this._lastMelodyDeg = deg;

    // Register rises slightly with combo, but stays comfortable
    const oct = combo >= 8 ? 2 : combo >= 4 ? 1 : 1;
    const midi = this._degToMidi(deg, oct);
    const freq = this._midiToFreq(midi);

    this._playPluck(freq, t, 0.22 + this._rand() * 0.10, 0.09);
  }

  _playBass(t) {
    const chord = this._currentChordDegrees();
    const deg = chord[0];
    const midi = this._degToMidi(deg, 0); // low register
    const freq = this._midiToFreq(midi);
    this._playBassNote(freq, t, 0.18);
  }

  _playPadChord(t, dur) {
    const chord = this._currentChordDegrees();

    // Occasionally invert / spread
    const inversion = this._rand() < 0.35 ? 1 : 0;
    const octs = inversion ? [1, 2, 2] : [1, 1, 2];

    for (let i = 0; i < chord.length; i++) {
      const midi = this._degToMidi(chord[i], octs[i]);
      const freq = this._midiToFreq(midi);
      this._playPad(freq, t, dur, 0.035);
    }
  }

  _playShaker(t) {
    // Short filtered noise burst (soft)
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, 2205, ctx.sampleRate);
    const ch = buffer.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = (this._rand() * 2 - 1) * (1 - i / ch.length);

    src.buffer = buffer;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(2500, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0, t);
    gain.gain.linearRampToValueAtTime(0.04, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

    src.connect(hp);
    hp.connect(gain);
    gain.connect(this.music);

    src.start(t);
    src.stop(t + 0.07);
  }

  _playSparkle(t) {
    const deg = this._randi(0, this.scale.length - 1);
    const midi = this._degToMidi(deg, 3);
    const freq = this._midiToFreq(midi);
    this._playPluck(freq, t, 0.16, 0.06, true);
  }

  // -------- SFX accents --------
  _playComboAccent(level) {
    // Short bright pluck on correct solve; pitch rises with combo
    const deg = (level * 2) % this.scale.length;
    const midi = this._degToMidi(deg, level >= 6 ? 2 : 1);
    const freq = this._midiToFreq(midi);
    this._playPluck(freq, this.ctx.currentTime, 0.18, 0.10, true);
  }

  _playUndoBlip() {
    const t = this.ctx.currentTime;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.12);

    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

    osc.connect(gain);
    gain.connect(this.sfx);
    osc.start(t);
    osc.stop(t + 0.13);
  }

  _playWinArp() {
    const t0 = this.ctx.currentTime;

    // Sparkly ascending arpeggio (in-scale, centered around root chord)
    const chord = this._currentChordDegrees();
    const pattern = [chord[0], chord[1], chord[2], chord[1], chord[2], chord[2] + 2];

    for (let i = 0; i < pattern.length; i++) {
      const midi = this._degToMidi(pattern[i], 2);
      const freq = this._midiToFreq(midi);
      this._playPluck(freq, t0 + i * 0.09, 0.22, 0.10, true);
    }

    // Gentle pad swell under it
    this._playPadChord(t0 + 0.05, 1.6);
  }

  // -------- Instrument primitives --------
  _playPluck(freq, t, dur, amp, extraDelay = false) {
    const ctx = this.ctx;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);

    // Soft tone shaping
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(amp, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    // Tiny stereo motion
    const pan = (ctx.createStereoPanner ? ctx.createStereoPanner() : null);
    if (pan) pan.pan.setValueAtTime((this._rand() * 2 - 1) * 0.18, t);

    osc.connect(lp);
    lp.connect(gain);

    if (pan) {
      gain.connect(pan);
      pan.connect(this.music);
      if (extraDelay) pan.connect(this.delay);
    } else {
      gain.connect(this.music);
      if (extraDelay) gain.connect(this.delay);
    }

    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _playPad(freq, t, dur, amp) {
    const ctx = this.ctx;

    // Two detuned saws -> warm pad; filtered and quiet
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2.type = 'sawtooth';
    osc1.frequency.setValueAtTime(freq, t);
    osc2.frequency.setValueAtTime(freq * (1 + (this._rand() * 0.004 - 0.002)), t);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.Q.setValueAtTime(0.7, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(amp, t + 0.25);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc1.connect(lp);
    osc2.connect(lp);
    lp.connect(gain);

    gain.connect(this.music);
    gain.connect(this.delay);

    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + dur + 0.05);
    osc2.stop(t + dur + 0.05);
  }

  _playBassNote(freq, t, amp) {
    const ctx = this.ctx;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(amp, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, t);

    osc.connect(lp);
    lp.connect(gain);
    gain.connect(this.music);

    osc.start(t);
    osc.stop(t + 0.22);
  }

  // -------- Utilities --------
  _pickProgression() {
    // Degrees within the scale: I, IV, V, vi-ish variants, biased to "happy/calm"
    const options = [
      [0, 3, 4, 3], // I-IV-V-IV
      [0, 4, 3, 4], // I-V-IV-V
      [0, 3, 0, 4], // I-IV-I-V
      [0, 5, 3, 4], // I-vi-IV-V (in-scale)
    ];
    return options[this._randi(0, options.length - 1)].slice();
  }

  _rand() {
    // xorshift32
    let x = this._rngState | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    
    // >>> 0 guarantees a positive unsigned integer. 
    this._rngState = x >>> 0; 
    
    // FIX: Removed the bitwise AND so it never turns negative!
    return this._rngState / 0x100000000; 
  }

  _randi(a, b) {
    return a + Math.floor(this._rand() * (b - a + 1));
  }
}

// Expose globally for non-module games
window.MusicEngine = MusicEngine;
})();
