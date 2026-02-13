import { makeQuestion, makeChoices, makeHint, weightedPick } from './questions.js';

function now(){ return performance.now(); }

const MODE_INFO = {
  add10: { name: 'Add ≤ 10', maxAnswer: 10, baseTime: 7.0 },
  add20: { name: 'Add ≤ 20', maxAnswer: 20, baseTime: 6.2 },
  sub20: { name: 'Subtract ≤ 20', maxAnswer: 20, baseTime: 6.6 },
  mixed: { name: 'Mixed Arena', maxAnswer: 20, baseTime: 6.0 },
};

export class Game{
  constructor(canvas, ui){
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ui = ui;

    this.state = 'menu'; // menu, playing, paused, over, boss
    this.settings = { mode:'add20', sound:true, hints:true, adaptive:true };

    this.score = 0;
    this.streak = 0;
    this.hearts = 3;
    this.qCount = 0;

    // enemy movement
    this.enemy = { x: 780, y: 360, speed: 55, wobble: 0 };
    this.player = { x: 180, y: 360 };

    // timing
    this.qStart = 0;
    this.timeLeft = 0;
    this.timeLimit = 6;

    // current question
    this.q = null;
    this.choices = [];
    this.locked = false;

    // progress/adaptive
    this.progressKey = 'math_ninja_progress_v1';
    this.progress = this.loadProgress();

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
    this.state = 'playing';
    this.score = 0;
    this.streak = 0;
    this.hearts = 3;
    this.qCount = 0;
    this.enemy.x = 780;
    this.enemy.wobble = 0;
    this.nextQuestion();
    this.ui.showToast('Fight!');
  }

  pause(p){
    if(p){
      if(this.state === 'playing' || this.state === 'boss') this.state = 'paused';
    }else{
      if(this.state === 'paused') this.state = 'playing';
      // restart timer for fairness
      this.qStart = now();
    }
  }

  resetProgress(){
    localStorage.removeItem(this.progressKey);
    this.progress = this.loadProgress();
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

  loadProgress(){
    try{
      const raw = localStorage.getItem(this.progressKey);
      if(!raw) return this.freshProgress();
      const obj = JSON.parse(raw);
      return Object.assign(this.freshProgress(), obj);
    }catch{
      return this.freshProgress();
    }
  }

  freshProgress(){
    return {
      totalAnswered: 0,
      totalCorrect: 0,
      totalTimeCorrectMs: 0,
      bestStreak: 0,
      // weakMap: key -> missCount
      weakMap: {},
    };
  }

  saveProgress(){
    localStorage.setItem(this.progressKey, JSON.stringify(this.progress));
  }

  nextQuestion(){
    this.locked = false;
    this.qCount++;

    // boss every 20 in mixed mode
    if(this.settings.mode === 'mixed' && this.qCount % 20 === 0){
      this.startBoss();
      return;
    }

    this.q = this.pickQuestion();
    const modeInfo = MODE_INFO[this.settings.mode] || MODE_INFO.add20;

    // time limit adapts slightly with streak
    const streakFactor = Math.min(1.6, 1 + this.streak*0.03);
    this.timeLimit = modeInfo.baseTime / streakFactor;
    this.timeLeft = this.timeLimit;
    this.qStart = now();

    this.choices = makeChoices(this.q.answer, { min:0, max:modeInfo.maxAnswer, count:4 });
    this.ui.setQuestion(this.q.text);
    this.ui.renderChoices(this.choices, (val, btn)=> this.pickAnswer(val, btn));
    this.ui.lockChoices(false);

    const showHint = this.settings.hints && Math.random() < 0.65;
    this.ui.setHint(showHint ? makeHint(this.q) : '');

    this.updateHUD();
  }

  pickQuestion(){
    if(!this.settings.adaptive) return makeQuestion(this.settings.mode);

    // Adaptive: generate a small candidate set and pick with weights from weakMap
    const candidates = [];
    for(let i=0;i<10;i++) candidates.push(makeQuestion(this.settings.mode));

    const wm = this.progress.weakMap || {};
    const weights = candidates.map(q=>{
      const miss = wm[q.key] || 0;
      // emphasize missed facts, but keep variety
      return 1 + miss * 1.4;
    });

    const idx = weightedPick(candidates, weights);
    return candidates[idx];
  }

  pickAnswer(value, btn){
  if(this.state === 'paused' || this.state === 'over') return;

  const ok = (value === this.q.answer);

  // Prevent double-click on same button
  btn.disabled = true;

  if(ok){
    if(this.locked) return;
    this.locked = true;
    this.ui.lockChoices(true);

    const t = performance.now() - this.qStart;

    // Progress tracking
    this.progress.totalAnswered += 1;
    this.progress.totalCorrect += 1;
    this.progress.totalTimeCorrectMs += t;
    this.progress.bestStreak = Math.max(this.progress.bestStreak, this.streak + 1);
    this.saveProgress();

    this.ui.markChoice(btn, true);

    const mult = this.speedMultiplier(t);
    const pts = Math.round(100 * mult + (this.streak * 3));
    this.score += pts;
    this.streak += 1;

    this.playSfx('hit', mult);

    // knock enemy back
    this.enemy.x = Math.min(820, this.enemy.x + 35 + 10 * mult);

    this.updateHUD();

    setTimeout(()=> this.nextQuestion(), 450);

  } else {

    // ❌ Wrong answer behavior changed
    this.ui.markChoice(btn, false);
    this.playSfx('miss', 1);

      this.streak = 0;
      this.hearts -= 1;
      this.ui.showToast('Ouch!');
      if(this.hearts <= 0){
        this.gameOver();
      }
    // Gray out the wrong answer
    btn.style.opacity = "0.4";
    btn.style.cursor = "not-allowed";

    // Increase weak count for adaptive system
    this.progress.weakMap[this.q.key] =
      (this.progress.weakMap[this.q.key] || 0) + 1;

    this.progress.totalAnswered += 1;
    this.saveProgress();

    
  }
}


  speedMultiplier(ms){
    // <2s => 3x, 2-4 => 2x, >4 => 1x (smooth)
    const s = ms/1000;
    if(s <= 2) return 3;
    if(s <= 4) return 2;
    return 1;
  }

  startBoss(){
    // 10 questions / 20 seconds
    this.state = 'boss';
    this.boss = {
      remaining: 10,
      correct: 0,
      timeTotal: 20.0,
      started: now(),
    };
    this.ui.showToast('👺 Boss Battle!');
    this.enemy.x = 760;
    this.enemy.speed = 70;
    this.nextBossQuestion();
  }

  nextBossQuestion(){
    if(this.state !== 'boss') return;
    if(this.boss.remaining <= 0){
      this.finishBoss();
      return;
    }
    this.q = this.pickQuestion();
    this.choices = makeChoices(this.q.answer, { min:0, max:20, count:4 });
    this.qStart = now();
    this.locked = false;

    this.ui.setQuestion(this.q.text);
    this.ui.renderChoices(this.choices, (val, btn)=> this.pickBossAnswer(val, btn));
    this.ui.lockChoices(false);
    this.ui.setHint(this.settings.hints ? 'Boss round: go fast!' : '');
    this.updateHUD();
  }

  pickBossAnswer(value, btn){
    if(this.locked || this.state !== 'boss') return;
    this.locked = true;
    this.ui.lockChoices(true);

    const ok = (value === this.q.answer);
    this.ui.markChoice(btn, ok);

    this.progress.totalAnswered += 1;
    if(ok){
      this.progress.totalCorrect += 1;
      this.progress.totalTimeCorrectMs += (now() - this.qStart);
    }else{
      this.progress.weakMap[this.q.key] = (this.progress.weakMap[this.q.key] || 0) + 1;
    }
    this.saveProgress();

    if(ok){
      this.boss.correct += 1;
      this.score += 150;
      this.playSfx('hit', 2.2);
    }else{
      this.playSfx('miss', 1);
    }

    this.boss.remaining -= 1;
    setTimeout(()=> this.nextBossQuestion(), 220);
  }

  finishBoss(){
    const need = 8;
    if(this.boss.correct >= need){
      this.ui.showToast('Boss defeated! +500');
      this.score += 500;
      this.streak += 3;
      this.enemy.x = 820;
    }else{
      this.ui.showToast('Boss escaped… -1 heart');
      this.hearts -= 1;
      this.streak = 0;
      if(this.hearts <= 0){
        this.gameOver();
        return;
      }
    }
    this.state = 'playing';
    this.enemy.speed = 55;
    setTimeout(()=> this.nextQuestion(), 500);
  }

  gameOver(){
    this.state = 'over';
    this.ui.showToast(`Game Over — score ${this.score}`);
    // Show menu automatically after a moment
    setTimeout(()=>{
      this.ui.showMenu(true);
      this.ui.updateProgressLine(this.getProgressSummary());
    }, 900);
  }

  updateHUD(){
    const info = MODE_INFO[this.settings.mode] || MODE_INFO.add20;
    this.ui.setHUD({
      modeName: this.state === 'boss' ? 'Boss Battle' : info.name,
      score: this.score,
      streak: this.streak,
      hearts: this.hearts,
    });
  }

  loop(){
    requestAnimationFrame(()=> this.loop());
    this.update();
    this.draw();
  }

  update(){
    if(this.state === 'playing'){
      const dt = 1/60;
      this.enemy.wobble += dt * 3.2;
      // enemy approaches as time runs out
      const elapsed = (now() - this.qStart)/1000;
      this.timeLeft = Math.max(0, this.timeLimit - elapsed);
      const urgency = this.timeLeft < 1.6;
      this.ui.setTimer(this.timeLeft, urgency);

      // move enemy closer as time elapses
      const progress = Math.min(1, elapsed / this.timeLimit);
      const targetX = 330; // “danger line”
      const startX = 780;
      this.enemy.x = startX - (startX - targetX) * progress;

      if(this.timeLeft <= 0 && !this.locked){
        // timeout counts as wrong
        this.locked = true;
        this.ui.lockChoices(true);
        this.streak = 0;
        this.hearts -= 1;
        this.playSfx('miss', 1);
        this.ui.showToast('Too slow!');
        this.updateHUD();
        if(this.hearts <= 0) this.gameOver();
        else setTimeout(()=> this.nextQuestion(), 650);
      }
    }else if(this.state === 'boss'){
      const elapsed = (now() - this.boss.started)/1000;
      const left = Math.max(0, this.boss.timeTotal - elapsed);
      this.ui.setTimer(left, left < 5);
      // simple pressure: if time ends, fail boss
      if(left <= 0){
        this.boss.remaining = 0;
        this.finishBoss();
      }
      // enemy “menacing” bounce
      this.enemy.wobble += 0.08;
      this.enemy.x = 700 + Math.sin(this.enemy.wobble)*10;
    }else{
      // paused/menu/over
      this.ui.setTimer(0, false);
    }
  }

  draw(){
    const ctx = this.ctx;
    const w = 960, h = 540;
    ctx.clearRect(0,0,w,h);

    // dojo background
    drawDojo(ctx, w, h);

    // floor shadow
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.ellipse(this.player.x, this.player.y+70, 90, 18, 0, 0, Math.PI*2);
    ctx.fillStyle = 'black';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(this.enemy.x, this.enemy.y+70, 90, 18, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // player
    drawNinja(ctx, this.player.x, this.player.y, { color:'#6ee7ff', headband:'#b6f3ff', facing: 1, angry:false });
    // enemy
    const angry = this.state === 'boss' || (this.state === 'playing' && this.timeLeft < 1.5);
    drawNinja(ctx, this.enemy.x, this.enemy.y, { color:'#ff7c7c', headband:'#ffd1d1', facing: -1, angry });

    // UI on canvas: danger line
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
    if(this.streak >= 5 && (this.state === 'playing' || this.state==='boss')){
      ctx.save();
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.arc(this.player.x, this.player.y-10, 120, 0, Math.PI*2);
      ctx.fillStyle = '#ffd76e';
      ctx.fill();
      ctx.restore();
    }

    // small text
    ctx.save();
    ctx.font = '700 13px ui-sans-serif, system-ui';
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    const msg = (this.state==='paused') ? 'Paused' : (this.state==='over' ? 'Game Over' : '');
    if(msg) ctx.fillText(msg, 18, 28);
    ctx.restore();
  }

  makeAudio(){
    // tiny WebAudio synth (no external files)
    const ctx = (window.AudioContext || window.webkitAudioContext) ? new (window.AudioContext || window.webkitAudioContext)() : null;
    return { ctx, enabled:true };
  }

  playSfx(type, intensity=1){
    if(!this.settings.sound) return;
    const a = this.audio;
    if(!a.ctx) return;

    // Resume on user gesture
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
  // sky glow
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

  // sword (enemy only by color check)
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
