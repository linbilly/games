import { makeQuestion, makeChoices, makeHint, weightedPick } from './questions.js';

function now(){ return performance.now(); }

const MODE_INFO = {
  add10: { name: 'Add ≤ 10', maxAnswer: 10, baseTime: 7.0 },
  add20: { name: 'Add ≤ 20', maxAnswer: 20, baseTime: 6.2 },
  sub20: { name: 'Subtract ≤ 20', maxAnswer: 20, baseTime: 6.6 },
  mixed: { name: 'Mixed Arena', maxAnswer: 20, baseTime: 6.0 },
};

const SPEED_TIERS_UI = ['turtle','slow','normal','falcon'];
const SPEED_TIERS_AUTO = ['turtle','slow','normal'];

const SPEED_PRESET = {
  turtle: 0.20,
  slow: 0.60,
  normal: 1.00,
  falcon: 2.00,
};

export class Game{
  constructor(canvas, ui){
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ui = ui;

    this.state = 'menu'; // menu, playing, paused, over
    this.settings = { mode:'add20', sound:true, hints:true, adaptive:true, speed:'normal' };

    this.score = 0;
    this.streak = 0;
    this.hearts = 3;
    this.qCount = 0;

    this.enemy = { x: 780, y: 360, wobble: 0 };
    this.player = { x: 180, y: 360 };

    this.qStart = 0;
    this.timeLimit = 6;
    this.timeLeft = 6;

    // speed scaling
    this.baseSpeed = 1.0;      // selected in menu
    this.questionSpeed = 1.0;  // can drop to 50% after wrong answer (for rest of question)

    // auto leveling
    this.correctSinceLevel = 0;

    // question
    this.q = null;
    this.locked = false;

    // progress/adaptive
    this.progressKey = 'math_ninja_progress_v1';
    this.progress = this.loadProgress();

    // FX
    this.shakeStart = 0;
    this.shakeUntil = 0;
    this.shakeMag = 0;

    this.damageStart = 0;
    this.damageUntil = 0;

    // audio
    this.audio = this.makeAudio();
  }

  init(){
    this.resizeForDPR();
    window.addEventListener('resize', ()=> this.resizeForDPR());
    this.loop();
    this.ui.updateProgressLine(this.getProgressSummary());
  }

  resizeForDPR(){
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const cssW = 960, cssH = 540;
    this.canvas.width = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.ctx.setTransform(dpr,0,0,dpr,0,0);
  }

  start(settings){
    this.settings = settings;
    this.baseSpeed = SPEED_PRESET[this.settings.speed] ?? 1.0;

    this.state = 'playing';
    this.score = 0;
    this.streak = 0;
    this.hearts = 3;
    this.qCount = 0;
    this.enemy.x = 780;
    this.enemy.wobble = 0;


    this.correctSinceLevel = 0;

    this.nextQuestion();
    this.ui.showToast('Fight!');
  }

  pause(p){
    if(p){
      if(this.state === 'playing') this.state = 'paused';
    }else{
      if(this.state === 'paused') this.state = 'playing';
      // fairness
      this.qStart = now();
    }
  }

  resetProgress(){
    localStorage.removeItem(this.progressKey);
    this.progress = this.freshProgress();
    this.ui.updateProgressLine(this.getProgressSummary());
  }

  freshProgress(){
    return {
      totalAnswered: 0,
      totalCorrect: 0,
      totalTimeCorrectMs: 0,
      bestStreak: 0,
      weakMap: {},
    };
  }

  loadProgress(){
    try{
      const raw = localStorage.getItem(this.progressKey);
      return raw ? Object.assign(this.freshProgress(), JSON.parse(raw)) : this.freshProgress();
    }catch{
      return this.freshProgress();
    }
  }

  saveProgress(){
    localStorage.setItem(this.progressKey, JSON.stringify(this.progress));
  }

  getProgressSummary(){
    const p = this.progress;
    const total = p.totalAnswered || 0;
    const acc = total ? Math.round((p.totalCorrect/total)*100) : 0;
    const best = p.bestStreak || 0;
    const avgMs = p.totalCorrect ? Math.round(p.totalTimeCorrectMs / p.totalCorrect) : 0;
    const avgS = (avgMs/1000).toFixed(2);
    return `Progress: answered ${total} · accuracy ${acc}% · best streak ${best} · avg correct time ${avgS}s`;
  }

  updateHUD(){
    const info = MODE_INFO[this.settings.mode] || MODE_INFO.add20;
    const speedKey = this.settings.speed || 'normal';
    const speedLabel = (speedKey==='turtle')?'🐢20%':(speedKey==='slow')?'🕰️60%':(speedKey==='normal')?'⚡100%':'🦅200%';
    this.ui.setHUD({
      modeName: `${info.name} · ${speedLabel}`,
      score: this.score,
      streak: this.streak,
      hearts: this.hearts,
    });
  }

  pickQuestion(){
    if(!this.settings.adaptive) return makeQuestion(this.settings.mode);

    const candidates = [];
    for(let i=0;i<10;i++) candidates.push(makeQuestion(this.settings.mode));

    const wm = this.progress.weakMap || {};
    const weights = candidates.map(q => 1 + (wm[q.key] || 0) * 1.4);
    const idx = weightedPick(candidates, weights);
    return candidates[idx];
  }

  nextQuestion(){
    this.locked = false;
    this.qCount += 1;

    // speed for this question starts at base speed
    this.questionSpeed = this.baseSpeed;

    // generate question
    this.q = this.pickQuestion();
    const modeInfo = MODE_INFO[this.settings.mode] || MODE_INFO.add20;

    // time limit scales inversely with speed (turtle = more time, falcon = less)
    this.timeLimit = modeInfo.baseTime / Math.max(0.1, this.baseSpeed);
    this.qStart = now();
    this.timeLeft = this.timeLimit;

    // choices
    const choices = makeChoices(this.q.answer, { min:0, max:modeInfo.maxAnswer, count:4 });

    this.ui.setQuestion(this.q.text);
    this.ui.renderChoices(choices, (val, btn)=> this.pickAnswer(val, btn));
    this.ui.lockChoices(false);

    const showHint = this.settings.hints && Math.random() < 0.65;
    this.ui.setHint(showHint ? makeHint(this.q) : '');

    this.updateHUD();
  }

  pickAnswer(value, btn){
    if(this.state !== 'playing') return;
    if(this.locked) return;

    const ok = (value === this.q.answer);

    if(ok){
      this.locked = true;
      this.ui.lockChoices(true);
      this.ui.markChoice(btn, true);

      const t = now() - this.qStart;

      // progress
      this.progress.totalAnswered += 1;
      this.progress.totalCorrect += 1;
      this.progress.totalTimeCorrectMs += t;
      this.progress.bestStreak = Math.max(this.progress.bestStreak, this.streak + 1);
      this.saveProgress();

      // scoring
      const mult = this.speedMultiplier(t);
      this.score += Math.round(100 * mult + this.streak * 3);
      this.streak += 1;

      // auto leveling: every 10 correct answers, speed up + refill hearts
      this.correctSinceLevel += 1;
      this.levelUpIfNeeded();

      this.playSfx('hit', mult);

      // feel-good knockback
      this.enemy.x = Math.min(820, this.enemy.x + 30 + 10 * mult);

      this.updateHUD();
      setTimeout(()=> this.nextQuestion(), 420);
      return;
    }

    // WRONG: stay on question, but punish + gray out choice
    this.ui.markChoice(btn, false);
    this.playSfx('miss', 1);

    btn.disabled = true;
    btn.style.opacity = "0.35";
    btn.style.cursor = "not-allowed";

    // adaptive
    this.progress.totalAnswered += 1;
    this.progress.weakMap[this.q.key] = (this.progress.weakMap[this.q.key] || 0) + 1;
    this.saveProgress();

    // damage
    this.streak = 0;
    this.hearts -= 1;

    // slow down 50% for rest of question
    this.questionSpeed = this.baseSpeed * 0.5;

    // FX
    this.shakeStart = now();
    this.shakeUntil = this.shakeStart + 220;
    this.shakeMag = 10;

    this.damageStart = now();
    this.damageUntil = this.damageStart + 320;

    this.updateHUD();

    if(this.hearts <= 0){
      this.gameOver();
      return;
    }

    this.ui.showToast('Try again!');
  }



  levelUpIfNeeded(){
    if(this.correctSinceLevel < 10) return;

    // reward: full hearts
    this.hearts = 3;

    // ----- Mode progression -----
    const MODE_ORDER = ['add10','add20','sub20','mixed'];
    const curMode = this.settings.mode || 'add20';
    const curModeIdx = MODE_ORDER.indexOf(curMode);
    const nextModeIdx = (curModeIdx >= 0) ? Math.min(MODE_ORDER.length - 1, curModeIdx + 1) : 1;
    const nextMode = MODE_ORDER[nextModeIdx];

    const modeChanged = (nextMode !== curMode);
    this.settings.mode = nextMode;

    // ----- Speed progression (AUTO caps at 100% / normal) -----
    // If user manually selected Falcon (200%), we won't change it automatically.
    let speedChanged = false;
    const curSpeedKey = this.settings.speed || 'normal';
    const curSpeedVal = SPEED_PRESET[curSpeedKey] ?? 1.0;

    if(curSpeedVal <= 1.0){
      const idx = SPEED_TIERS_AUTO.indexOf(curSpeedKey);
      const nextIdx = (idx >= 0) ? Math.min(SPEED_TIERS_AUTO.length - 1, idx + 1) : 2;
      const nextKey = SPEED_TIERS_AUTO[nextIdx];
      if(nextKey !== curSpeedKey){
        this.settings.speed = nextKey;
        speedChanged = true;
      }
    }

    // apply baseSpeed from (possibly updated) settings.speed
    this.baseSpeed = SPEED_PRESET[this.settings.speed] ?? this.baseSpeed;
    this.questionSpeed = this.baseSpeed;

    // reset counter
    this.correctSinceLevel = 0;

    // toast
    const modeLabel = (nextMode === 'add10') ? 'Add ≤ 10' :
                      (nextMode === 'add20') ? 'Add ≤ 20' :
                      (nextMode === 'sub20') ? 'Subtract ≤ 20' : 'Mixed Arena';

    const speedKey2 = this.settings.speed || 'normal';
    const speedLabel = (speedKey2 === 'turtle') ? '🐢 Turtle (20%)' :
                       (speedKey2 === 'slow') ? '🕰️ Slow (60%)' :
                       (speedKey2 === 'normal') ? '⚡ Normal (100%)' : '🦅 Falcon (200%)';

    if(modeChanged || speedChanged){
      this.ui.showToast(`Level up! → ${modeLabel} · ${speedLabel} · Hearts refilled`);
    }else{
      this.ui.showToast('Nice! Hearts refilled');
    }

    this.updateHUD();

    // immediately start a fresh question in the new mode/speed (feels snappy)
    this.nextQuestion();
  }

  speedMultiplier(ms){
    const s = ms/1000;
    if(s <= 2) return 3;
    if(s <= 4) return 2;
    return 1;
  }

  gameOver(){
    this.state = 'over';
    this.ui.showToast(`Game Over — score ${this.score}`);
    setTimeout(()=>{
      this.ui.showMenu(true);
      this.ui.updateProgressLine(this.getProgressSummary());
    }, 900);
  }

  update(){
    if(this.state !== 'playing'){
      // still show timer pill as 0
      this.ui.setTimer(0, false);
      return;
    }

    // elapsed is slowed down by questionSpeed (after wrong answers)
    const rawElapsed = (now() - this.qStart) / 1000;
    const elapsed = Math.max(0, rawElapsed * this.questionSpeed);

    this.timeLeft = Math.max(0, this.timeLimit - elapsed);
    const urgency = this.timeLeft < 1.6;
    this.ui.setTimer(this.timeLeft, urgency);

    // enemy approaches
    const progress = Math.min(1, elapsed / this.timeLimit);
    const targetX = 330;
    const startX = 780;
    this.enemy.x = startX - (startX - targetX) * progress;

    // wobble
    this.enemy.wobble += 0.06;

    // timeout = wrong + move on
    if(this.timeLeft <= 0 && !this.locked){
      this.locked = true;
      this.ui.lockChoices(true);
      this.streak = 0;
      this.hearts -= 1;
      this.playSfx('miss', 1);
      this.updateHUD();

      if(this.hearts <= 0){
        this.gameOver();
      }else{
        setTimeout(()=> this.nextQuestion(), 650);
      }
    }
  }

  loop(){
    requestAnimationFrame(()=> this.loop());
    this.update();
    this.draw();
  }

  draw(){
    const ctx = this.ctx;
    const w = 960, h = 540;
    ctx.clearRect(0,0,w,h);

    // Screen shake
    let shakeX = 0, shakeY = 0;
    if(now() < this.shakeUntil){
      const p = 1 - ((now() - this.shakeStart) / Math.max(1, (this.shakeUntil - this.shakeStart)));
      const mag = this.shakeMag * Math.max(0, p);
      shakeX = (Math.random() - 0.5) * mag;
      shakeY = (Math.random() - 0.5) * mag;
    }

    ctx.save();
    ctx.translate(shakeX, shakeY);

    // background
    drawDojo(ctx, w, h);

    // shadows
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.ellipse(this.player.x, this.player.y+70, 90, 18, 0, 0, Math.PI*2);
    ctx.fillStyle = 'black';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(this.enemy.x, this.enemy.y+70, 90, 18, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Player with damage shake/flash and "-1"
    let pX = this.player.x, pY = this.player.y;
    const damaged = (this.state === 'playing' && now() < this.damageUntil);
    if(damaged){
      pX += (Math.random() - 0.5) * 8;
      pY += (Math.random() - 0.5) * 6;
    }
    drawNinja(ctx, pX, pY, { color:'#6ee7ff', headband:'#b6f3ff', facing: 1, angry:false });

    if(damaged){
      const t = (now() - this.damageStart) / Math.max(1, (this.damageUntil - this.damageStart));
      const a = Math.max(0, 1 - t);

      // red flash on player
      ctx.save();
      ctx.globalAlpha = 0.25 * a;
      ctx.beginPath();
      ctx.arc(pX, pY-6, 70, 0, Math.PI*2);
      ctx.fillStyle = '#ff2d2d';
      ctx.fill();
      ctx.restore();

      // floating -1
      const rise = 24 * t;
      ctx.save();
      ctx.globalAlpha = 0.95 * a;
      ctx.font = '900 28px ui-sans-serif, system-ui';
      ctx.fillStyle = '#ff5a5a';
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 5;
      const tx = pX - 10;
      const ty = (pY - 92) - rise;
      ctx.strokeText('-1', tx, ty);
      ctx.fillText('-1', tx, ty);
      ctx.restore();
    }

    // Slowdown aura around enemy when slowed (for rest of question)
    if(this.state === 'playing' && this.questionSpeed < this.baseSpeed){
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.beginPath();
      ctx.arc(this.enemy.x, this.enemy.y-8, 88, 0, Math.PI*2);
      ctx.fillStyle = '#6ee7ff';
      ctx.fill();
      ctx.globalAlpha = 0.16;
      ctx.beginPath();
      ctx.arc(this.enemy.x, this.enemy.y-8, 128, 0, Math.PI*2);
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = 'rgba(110,231,255,0.55)';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 10]);
      ctx.beginPath();
      ctx.arc(this.enemy.x, this.enemy.y-8, 110, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }

    // Enemy
    const angry = (this.state === 'playing' && this.timeLeft < 1.5);
    drawNinja(ctx, this.enemy.x, this.enemy.y, { color:'#ff7c7c', headband:'#ffd1d1', facing: -1, angry });

    // danger line
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = '#ffdf6e';
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(330, 90);
    ctx.lineTo(330, 500);
    ctx.stroke();
    ctx.restore();

    // fire mode glow
    if(this.streak >= 5 && this.state === 'playing'){
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.arc(this.player.x, this.player.y-10, 120, 0, Math.PI*2);
      ctx.fillStyle = '#ffd76e';
      ctx.fill();
      ctx.restore();
    }

    ctx.restore(); // end shake transform
  }

  makeAudio(){
    const ctx = (window.AudioContext || window.webkitAudioContext)
      ? new (window.AudioContext || window.webkitAudioContext)()
      : null;
    return { ctx };
  }

  playSfx(type, intensity=1){
    if(!this.settings.sound) return;
    const a = this.audio;
    if(!a.ctx) return;

    if(a.ctx.state === 'suspended'){
      a.ctx.resume().catch(()=>{});
    }

    const t0 = a.ctx.currentTime;
    const o = a.ctx.createOscillator();
    const g = a.ctx.createGain();
    o.connect(g); g.connect(a.ctx.destination);

    if(type === 'hit'){
      o.type = 'triangle';
      o.frequency.setValueAtTime(420 + 60*intensity, t0);
      o.frequency.exponentialRampToValueAtTime(780 + 90*intensity, t0+0.08);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.18, t0+0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0+0.12);
      o.start(t0); o.stop(t0+0.13);
    }else{
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(220, t0);
      o.frequency.exponentialRampToValueAtTime(120, t0+0.10);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.14, t0+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0+0.14);
      o.start(t0); o.stop(t0+0.15);
    }
  }
}

function drawDojo(ctx, w, h){
  const g = ctx.createLinearGradient(0,0,0,h);
  g.addColorStop(0, 'rgba(110,231,255,0.10)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.03)');
  g.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = g;
  ctx.fillRect(0,0,w,h);

  // back wall
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(0,70,w,260);
  ctx.restore();

  // window panels
  ctx.save();
  ctx.globalAlpha = 0.18;
  for(let i=0;i<10;i++){
    const x = 60 + i*86;
    ctx.fillStyle = i%2===0 ? 'rgba(110,231,255,0.20)' : 'rgba(255,215,110,0.16)';
    ctx.fillRect(x, 95, 58, 110);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x, 95, 58, 110);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.strokeRect(x, 95, 58, 110);
  }
  ctx.restore();

  // floor
  ctx.save();
  const f = ctx.createLinearGradient(0,330,0,h);
  f.addColorStop(0, 'rgba(255,255,255,0.06)');
  f.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = f;
  ctx.fillRect(0,330,w,h-330);

  // floor boards
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  for(let y=340;y<h;y+=26){
    ctx.beginPath();
    ctx.moveTo(0,y);
    ctx.lineTo(w,y);
    ctx.stroke();
  }
  ctx.restore();

  // hanging lantern
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = 'rgba(255,215,110,0.10)';
  ctx.beginPath();
  ctx.arc(480, 58, 44, 0, Math.PI*2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,215,110,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(480, 0); ctx.lineTo(480, 26); ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(450, 26, 60, 60, 14);
  ctx.fillStyle = 'rgba(255,215,110,0.15)';
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawNinja(ctx, x, y, opts){
  const facing = opts.facing || 1;
  ctx.save();
  ctx.translate(x,y);
  ctx.scale(facing,1);

  const body = opts.color || '#6ee7ff';
  const headband = opts.headband || '#b6f3ff';
  const angry = !!opts.angry;

  // body
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.roundRect(-40, 30, 80, 68, 22);
  ctx.fill();

  ctx.fillStyle = body;
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  ctx.roundRect(-40, 30, 80, 68, 22);
  ctx.fill();
  ctx.globalAlpha = 1;

  // head
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.arc(0, 0, 42, 0, Math.PI*2);
  ctx.fill();

  // headband
  ctx.fillStyle = headband;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.roundRect(-44, -16, 88, 18, 9);
  ctx.fill();
  ctx.globalAlpha = 1;

  // eyes slit
  ctx.fillStyle = 'rgba(255,255,255,0.90)';
  ctx.beginPath();
  ctx.roundRect(-26, -2, 52, 14, 7);
  ctx.fill();

  // pupils
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  const pupY = angry ? 5 : 6;
  ctx.beginPath(); ctx.arc(-10, pupY, 4, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(10, pupY, 4, 0, Math.PI*2); ctx.fill();

  // angry brows
  if(angry){
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-24, -6); ctx.lineTo(-2, 2);
    ctx.moveTo(24, -6); ctx.lineTo(2, 2);
    ctx.stroke();
  }

  // arms
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.roundRect(-62, 40, 28, 16, 8); ctx.fill();
  ctx.beginPath(); ctx.roundRect(34, 40, 28, 16, 8); ctx.fill();

  // sword
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(54, 62);
  ctx.lineTo(92, 28);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath();
  ctx.roundRect(48, 66, 16, 10, 4);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

// Safari fallback for roundRect
if(!CanvasRenderingContext2D.prototype.roundRect){
  CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r){
    r = Math.min(r, w/2, h/2);
    this.beginPath();
    this.moveTo(x+r, y);
    this.arcTo(x+w, y, x+w, y+h, r);
    this.arcTo(x+w, y+h, x, y+h, r);
    this.arcTo(x, y+h, x, y, r);
    this.arcTo(x, y, x+w, y, r);
    this.closePath();
    return this;
  }
}
