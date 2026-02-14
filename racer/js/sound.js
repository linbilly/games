export function makeSound() {
  let ctx = null;
  let master = null;

  let engineOsc = null;
  let engineGain = null;
  let lfo = null;
  let lfoGain = null;

  function ensure() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.75;
    master.connect(ctx.destination);
  }

  async function resume() {
    ensure();
    if (ctx.state === "suspended") await ctx.resume();
  }

  function startEngine() {
    ensure();
    if (engineOsc) return;

    engineOsc = ctx.createOscillator();
    engineOsc.type = "sawtooth";
    engineGain = ctx.createGain();
    engineGain.gain.value = 0.0001;

    lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 6;
    lfoGain = ctx.createGain();
    lfoGain.gain.value = 8;
    lfo.connect(lfoGain);
    lfoGain.connect(engineOsc.frequency);

    engineOsc.frequency.value = 90;
    engineOsc.connect(engineGain);
    engineGain.connect(master);

    const t = ctx.currentTime;
    engineGain.gain.setValueAtTime(0.0001, t);
    engineGain.gain.exponentialRampToValueAtTime(0.10, t + 0.25);

    engineOsc.start();
    lfo.start();
  }

  function stopEngine() {
    if (!ctx || !engineOsc) return;
    const t = ctx.currentTime;
    engineGain.gain.cancelScheduledValues(t);
    engineGain.gain.setValueAtTime(engineGain.gain.value, t);
    engineGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);

    setTimeout(() => {
      try { engineOsc.stop(); } catch {}
      try { lfo.stop(); } catch {}
      try { engineOsc.disconnect(); engineGain.disconnect(); } catch {}
      try { lfo.disconnect(); lfoGain.disconnect(); } catch {}
      engineOsc = null; engineGain = null; lfo = null; lfoGain = null;
    }, 180);
  }

  function setEngineBySpeed(speed01) {
    if (!ctx || !engineOsc) return;
    const t = ctx.currentTime;
    const f = 90 + 220 * Math.max(0, Math.min(1, speed01));
    engineOsc.frequency.setTargetAtTime(f, t, 0.03);
    const g = 0.07 + 0.06 * speed01;
    engineGain.gain.setTargetAtTime(g, t, 0.05);
  }

  function beep(freq, duration, gain=0.25, type="sine") {
    ensure();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = 0.0001;
    o.connect(g); g.connect(master);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    o.start(t); o.stop(t + duration + 0.02);
  }

  function correctChime() {
    beep(880, 0.14, 0.22, "sine");
    beep(1320, 0.16, 0.18, "triangle");
  }

  function coneHit() {
    ensure();
    const bufferSize = 2 * ctx.sampleRate;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i=0;i<bufferSize;i++) data[i] = (Math.random()*2 - 1);

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1200;

    const g = ctx.createGain();
    g.gain.value = 0.12;

    noise.connect(filter);
    filter.connect(g);
    g.connect(master);

    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);

    noise.start(t);
    noise.stop(t + 0.2);

    beep(90, 0.10, 0.25, "sine");
  }

  return { resume, startEngine, stopEngine, setEngineBySpeed, correctChime, coneHit };
}
