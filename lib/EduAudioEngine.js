/* EduAudioEngine (tiny reusable audio for your educational game suite)
   - Drop this file into your shared /lib/ (or similar).
   - Put sfx wav files in /audio/sfx (relative to the page) OR pass baseUrl.
   - Works with ES modules OR classic script.
   - Uses WebAudio if available; falls back to HTMLAudio.
*/
export class EduAudioEngine {
  constructor(opts = {}) {
    this.enabled = opts.enabled ?? true;
    this.volume = clamp01(opts.volume ?? 0.8);
    this.sfxVolume = clamp01(opts.sfxVolume ?? 1.0);
    this.musicVolume = clamp01(opts.musicVolume ?? 0.7);
    this.baseUrl = opts.baseUrl ?? "./audio/"; // should contain sfx/
    this.map = { ...(opts.map ?? DEFAULT_SFX_MAP) };

    this._ctx = null;
    this._master = null;
    this._sfxBus = null;
    this._musicBus = null;

    this._buffers = new Map();    // name -> AudioBuffer
    this._htmlAudio = new Map();  // name -> HTMLAudioElement
    this._active = new Set();     // playing nodes (for stopAll)
  }

  async init() {
    // call once from a user gesture (click/tap) to unlock audio on iOS
    if (!this.enabled) return;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      this._ctx = new AudioContext();

      // buses
      this._master = this._ctx.createGain();
      this._sfxBus = this._ctx.createGain();
      this._musicBus = this._ctx.createGain();

      this._master.gain.value = this.volume;
      this._sfxBus.gain.value = this.sfxVolume;
      this._musicBus.gain.value = this.musicVolume;

      this._sfxBus.connect(this._master);
      this._musicBus.connect(this._master);
      this._master.connect(this._ctx.destination);

      // some browsers require resume
      if (this._ctx.state === "suspended") {
        try { await this._ctx.resume(); } catch(_) {}
      }
    }
  }

  setEnabled(v){ this.enabled = !!v; }
  setVolume(v){ this.volume = clamp01(v); if(this._master) this._master.gain.value = this.volume; }
  setSfxVolume(v){ this.sfxVolume = clamp01(v); if(this._sfxBus) this._sfxBus.gain.value = this.sfxVolume; }
  setMusicVolume(v){ this.musicVolume = clamp01(v); if(this._musicBus) this._musicBus.gain.value = this.musicVolume; }

  async preloadAll() {
    const names = Object.keys(this.map);
    await Promise.all(names.map(n => this.preload(n)));
  }

  async preload(name) {
    const file = this.map[name];
    if (!file) return;

    if (this._ctx) {
      if (this._buffers.has(name)) return;
      const url = this.baseUrl + "sfx/" + file;
      const res = await fetch(url);
      const arr = await res.arrayBuffer();
      const buf = await this._ctx.decodeAudioData(arr);
      this._buffers.set(name, buf);
      return;
    }

    // fallback
    if (this._htmlAudio.has(name)) return;
    const a = new Audio(this.baseUrl + "sfx/" + file);
    a.preload = "auto";
    this._htmlAudio.set(name, a);
  }

  async play(name, opts = {}) {
    if (!this.enabled) return;

    const rate = opts.rate ?? 1.0;
    const gain = clamp01(opts.gain ?? 1.0);
    const pan = clamp11(opts.pan ?? 0.0);
    const overlap = opts.overlap ?? true; // if false, restart same sound

    const file = this.map[name];
    if (!file) return;

    // WebAudio path
    if (this._ctx) {
      if (!this._buffers.has(name)) {
        try { await this.preload(name); } catch(_) { return; }
      }
      const buf = this._buffers.get(name);
      if (!buf) return;

      const src = this._ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;

      const g = this._ctx.createGain();
      g.gain.value = gain;

      // Optional panner
      let out = g;
      if (this._ctx.createStereoPanner) {
        const p = this._ctx.createStereoPanner();
        p.pan.value = pan;
        src.connect(g);
        g.connect(p);
        out = p;
      } else {
        src.connect(g);
      }

      out.connect(this._sfxBus);

      const token = { stop: () => { try { src.stop(); } catch(_) {} } };
      this._active.add(token);

      src.onended = () => this._active.delete(token);
      src.start(0);
      return token;
    }

    // HTMLAudio fallback
    const a0 = this._htmlAudio.get(name) || new Audio(this.baseUrl + "sfx/" + file);
    if (!overlap) { a0.pause(); a0.currentTime = 0; }
    const a = overlap ? a0.cloneNode(true) : a0;
    a.volume = this.volume * this.sfxVolume * gain;
    a.playbackRate = rate;
    try { await a.play(); } catch(_) {}
    return { stop: () => { try { a.pause(); } catch(_) {} } };
  }

  stopAll() {
    // WebAudio nodes
    for (const t of this._active) {
      try { t.stop(); } catch(_) {}
    }
    this._active.clear();

    // HTMLAudio fallback
    for (const a of this._htmlAudio.values()) {
      try { a.pause(); a.currentTime = 0; } catch(_) {}
    }
  }
}

export const DEFAULT_SFX_MAP = {
  shoot_player: "shoot_player.wav",
  shoot_alien: "shoot_alien.wav",
  hit_alien: "hit_alien.wav",
  hit_player: "hit_player.wav",
  explosion: "explosion.wav",
  level_up: "level_up.wav",
  ui_click: "ui_click.wav",
};

function clamp01(v){ return Math.max(0, Math.min(1, v)); }
function clamp11(v){ return Math.max(-1, Math.min(1, v)); }
