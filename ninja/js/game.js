import { makeQuestion, makeChoices, makeHint, weightedPick } from './questions.js';

const MODE_INFO = {
  add10:    { name: 'Add ≤ 10', maxAnswer: 10,  baseTime: 7.0 },
  add20:    { name: 'Add ≤ 20', maxAnswer: 20,  baseTime: 6.2 },
  sub20:    { name: 'Subtract ≤ 20', maxAnswer: 20,  baseTime: 6.6 },
  mixed:    { name: 'Mixed ≤ 20', maxAnswer: 20,  baseTime: 6.0 },

  add100nr: { name: 'Add ≤ 100 (No Regroup)', maxAnswer: 100, baseTime: 7.2 },
  sub100nr: { name: 'Subtract ≤ 100 (No Regroup)', maxAnswer: 100, baseTime: 7.4 },

  add100r1: { name: 'Add ≤ 100 (2D + 1D Regroup)', maxAnswer: 100, baseTime: 7.8 },
  add100r2: { name: 'Add ≤ 100 (2D + 2D Regroup)', maxAnswer: 100, baseTime: 8.2 },
  sub100r1: { name: 'Subtract ≤ 100 (2D − 1D Regroup)', maxAnswer: 100, baseTime: 8.2 },
  sub100r2: { name: 'Subtract ≤ 100 (2D − 2D Regroup)', maxAnswer: 100, baseTime: 8.8 },
};

const MODE_ORDER = ['add10','add20','sub20','mixed','add100nr','sub100nr','add100r1','add100r2','sub100r1','sub100r2'];
const SPEED_PRESET = { turtle:0.20, slow:0.60, normal:1.00, falcon:2.00 };

const TOTAL_LEVELS = 10;
const STEPS_PER_LEVEL = 10; // 10 correct answers per level


const now = ()=> performance.now();

export class Game{
  constructor(canvas, ui){
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ui = ui;

    this.settings = { mode:'add20', sound:true, hints:true, adaptive:true, speed:'normal' };
    this.state = 'menu';

    this.score = 0;
    this.streak = 0;
    this.hearts = 3;
    this.correctSinceLevel = 0;

    this.baseSpeed = 1.0;
    this.questionSpeed = 1.0;

    this.player = { x:180, y:270 };
    this.enemy  = { x:780, y:270 };


    this.q = null;
    this.qStart = 0;
    this.timeLimit = 6;
    this.timeLeft = 6;
    this.locked = false;

    this.pauseAt = 0;
    this.pendingLevelUp = null;

    this.shakeUntil = 0;
    this.damageUntil = 0;

    this.progressKey = 'math_ninja_progress_stable_v1';
    this.progress = this.loadProgress();

    this.audio = this.initAudio();

    // Defeat handler: instead of ending, drop down a level and refill hearts
    this.onDefeat = () => {
      const curMode = this.settings.mode || 'add20';
      const curIdx = MODE_ORDER.indexOf(curMode);
      const downIdx = Math.max(0, curIdx - 1);
      const newMode = MODE_ORDER[downIdx] || MODE_ORDER[0];

      this.settings.mode = newMode;

      this.hearts = 3;
      this.streak = 0;
      this.correctSinceLevel = 0;
      this.locked = false;

      this.enemy.x = 780;
      this.questionSpeed = this.baseSpeed;

      const modeLabel = (MODE_INFO[newMode]?.name) || newMode;

      this.state = 'levelup';
      this.ui.lockChoices(true);
      this.ui.showLevelUp(true, `Defeated! Down a level → ${modeLabel}. Hearts refilled to 3.`);
    };
  }

  init(){
    this.resizeForDPR();
    window.addEventListener('resize', ()=> this.resizeForDPR());
    this.ui.updateProgressLine(this.getProgressSummary());
    this.loop();
  }

  resizeForDPR(){
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const cssW = 960, cssH = 540;
    this.canvas.width = Math.floor(cssW*dpr);
    this.canvas.height = Math.floor(cssH*dpr);
    this.canvas.style.width = cssW+'px';
    this.canvas.style.height = cssH+'px';
    this.ctx.setTransform(dpr,0,0,dpr,0,0);
  }

  freshProgress(){
    return { totalAnswered:0, totalCorrect:0, totalTimeCorrectMs:0, bestStreak:0, weakMap:{} };
  }
  loadProgress(){
    try{
      const raw = localStorage.getItem(this.progressKey);
      return raw ? Object.assign(this.freshProgress(), JSON.parse(raw)) : this.freshProgress();
    }catch{ return this.freshProgress(); }
  }
  saveProgress(){ try{ localStorage.setItem(this.progressKey, JSON.stringify(this.progress)); }catch{} }
  resetProgress(){ try{ localStorage.removeItem(this.progressKey); }catch{} this.progress=this.freshProgress(); this.ui.updateProgressLine(this.getProgressSummary()); }

  getProgressSummary(){
    const p=this.progress;
    const total=p.totalAnswered||0;
    const acc= total ? Math.round((p.totalCorrect/total)*100) : 0;
    const best=p.bestStreak||0;
    const avgMs = p.totalCorrect ? Math.round(p.totalTimeCorrectMs/p.totalCorrect) : 0;
    return `Progress: answered ${total} · accuracy ${acc}% · best streak ${best} · avg correct time ${(avgMs/1000).toFixed(2)}s`;
  }

  start(settings){
    this.settings = settings;
    this.baseSpeed = SPEED_PRESET[this.settings.speed] ?? 1.0;
    this.questionSpeed = this.baseSpeed;

    this.state='playing';
    this.score=0; this.streak=0; this.hearts=3; this.correctSinceLevel=0;
    this.enemy.x=780;
    this.nextQuestion();
    this.ui.showToast('Fight!');
  }


  pause(){
    if(this.state !== 'playing') return;
    this.state = 'paused';
    this.pauseAt = now();
    this.ui.lockChoices(true);
    this.ui.showToast('Paused');
  }

  resume(){
    if(this.state !== 'paused') return;
    const delta = now() - this.pauseAt;
    // shift start time so timer/enemy don't jump
    this.qStart += delta;
    this.state = 'playing';
    this.ui.lockChoices(this.locked);
    this.ui.showToast('Resume');
  }

  resumeFromLevelUp(){
    if(this.state !== 'levelup') return;
    // update HUD to new mode/speed and continue
    this.state = 'playing';
    this.locked = false;
    this.ui.lockChoices(false);
    this.nextQuestion();
  }

  pickQuestion(){
    if(!this.settings.adaptive) return makeQuestion(this.settings.mode);
    const candidates = [];
    for(let i=0;i<10;i++) candidates.push(makeQuestion(this.settings.mode));
    const wm=this.progress.weakMap||{};
    const weights = candidates.map(q => 1 + (wm[q.key]||0)*1.4);
    return candidates[ weightedPick(candidates, weights) ];
  }

  updateHUD(){
    const info = MODE_INFO[this.settings.mode] || MODE_INFO.add20;
    const s=this.settings.speed||'normal';
    const speedLabel = (s==='turtle')?'🐢20%':(s==='slow')?'🕰️60%':(s==='normal')?'⚡100%':'🦅200%';
    this.ui.setHUD({ modeName:`${info.name} · ${speedLabel}`, score:this.score, streak:this.streak, hearts:this.hearts });

    // Progress: each level = 10%, each correct in level = 1%
    const levelIdx = Math.max(0, MODE_ORDER.indexOf(this.settings.mode));
    const pct = Math.max(0, Math.min(100, levelIdx*10 + Math.min(STEPS_PER_LEVEL, this.correctSinceLevel)));
    this.ui.setProgress(pct, `Level ${Math.min(TOTAL_LEVELS, levelIdx+1)} / ${TOTAL_LEVELS}`);

    this.ui.updateProgressLine(this.getProgressSummary());
  }

  levelUpIfNeeded(){
    if(this.correctSinceLevel < 10) return;
    this.hearts = 3;

    const curMode=this.settings.mode||'add20';
    const curIdx=MODE_ORDER.indexOf(curMode);
    const nextIdx=(curIdx>=0)?Math.min(MODE_ORDER.length-1,curIdx+1):0;
    const nextMode=MODE_ORDER[nextIdx];
    this.settings.mode = nextMode;

    const AUTO=['turtle','slow','normal'];
    const curSpeed=this.settings.speed||'normal';
    const curVal=SPEED_PRESET[curSpeed]??1.0;
    if(curVal<=1.0){
      const si=AUTO.indexOf(curSpeed);
      const sn=(si>=0)?Math.min(AUTO.length-1,si+1):2;
      this.settings.speed = AUTO[sn];
    }
    this.baseSpeed = SPEED_PRESET[this.settings.speed] ?? this.baseSpeed;
    this.questionSpeed = this.baseSpeed;

    this.correctSinceLevel = 0;

    this.ui.showToast(`Level up!`);
    const info = MODE_INFO[this.settings.mode] || MODE_INFO.add20;
    const s=this.settings.speed||'normal';
    const speedLabel = (s==='turtle')?'Turtle (20%)':(s==='slow')?'Slow (60%)':(s==='normal')?'Normal (100%)':'Falcon (200%)';
    const msg = 'Well done!\n' +
  `• Score: ${this.score}\n` +
  `• Streak: ${this.streak}\n\n` +`Next challenge: ${info.name} · Speed = ${speedLabel}. Hearts refilled to 3.`;
    this.state = 'levelup';
    this.ui.lockChoices(true);
    this.ui.showLevelUp(true, msg);
  }

  nextQuestion(){
    this.locked=false;
    this.timedOut = false;

    this.questionSpeed = this.baseSpeed;

    this.q = this.pickQuestion();
    const info = MODE_INFO[this.settings.mode] || MODE_INFO.add20;

    this.timeLimit = info.baseTime / Math.max(0.1, this.baseSpeed);
    this.qStart = now();
    this.timeLeft = this.timeLimit;

    const choices = makeChoices(this.q.answer, {min:0, max:info.maxAnswer, count:4});
    this.ui.setQuestion(this.q.text);
    this.ui.renderChoices(choices, (v,btn)=> this.pickAnswer(v,btn));
    this.ui.lockChoices(false);

    const showHint = this.settings.hints && Math.random()<0.65;
    this.ui.setHint(showHint ? makeHint(this.q) : '');
    this.updateHUD();
  }

  pickAnswer(value, btn){
    if(this.state!=='playing' || this.locked) return;

    const ok = (value === this.q.answer);

    if(ok){
      this.locked=true;
      this.ui.lockChoices(true);
      this.ui.markChoice(btn,true);

      const t=now()-this.qStart;
      this.progress.totalAnswered++;
      this.progress.totalCorrect++;
      this.progress.totalTimeCorrectMs += t;
      this.progress.bestStreak = Math.max(this.progress.bestStreak, this.streak+1);
      this.saveProgress();

      this.score += 100 + this.streak*3;
      this.streak += 1;
      this.correctSinceLevel += 1;

      this.enemy.x = Math.min(820, this.enemy.x + 26);
      this.playSfx('hit');

      this.updateHUD();

      setTimeout(()=>{
        if(this.correctSinceLevel >= 10){
          this.levelUpIfNeeded();
          return;
        }
        this.nextQuestion();
      }, 420);
      return;
    }

    // Wrong: keep same question
    this.ui.markChoice(btn,false);
    btn.disabled=true;
    btn.style.opacity="0.35";
    btn.style.cursor="not-allowed";

    this.progress.totalAnswered++;
    this.progress.weakMap[this.q.key] = (this.progress.weakMap[this.q.key]||0) + 1;
    this.saveProgress();

    this.streak=0;
    this.hearts -= 1;

    // slow down for rest of question
    this.questionSpeed = this.baseSpeed * 0.5;

    this.shakeUntil = now()+220;
    this.damageUntil = now()+320;

    this.playSfx('miss');
    this.updateHUD();

    if(this.hearts<=0) this.onDefeat();
    else this.ui.showToast('Try again!');
  }

    onDefeat(){
    const defeatedScore = this.score;
    const defeatedStreak = this.streak;

    // Drop down a level instead of ending the run
    const curMode = this.settings.mode || 'add20';
    const curIdx = MODE_ORDER.indexOf(curMode);
    const downIdx = Math.max(0, curIdx - 1);
    const newMode = MODE_ORDER[downIdx] || MODE_ORDER[0];

    this.settings.mode = newMode;

    // Reset player state
    this.hearts = 3;
    this.streak = 0;
    this.correctSinceLevel = 0;
    this.locked = false;

    // Reset enemy position and timing
    this.enemy.x = 780;
    this.questionSpeed = this.baseSpeed;

    const modeLabel = (MODE_INFO[newMode]?.name) || newMode;

    // Pause + show message (same style as level up)
    this.state = 'levelup';
    this.ui.lockChoices(true);
    this.ui.showLevelUp(
      true,
      `Defeated!\n` +
      `• Score: ${defeatedScore}\n` +
      `• Streak: ${defeatedStreak}\n\n` +
      `Down a level → ${modeLabel}\n\n` +
      `Hearts refilled to 3.`
    );

  }


  gameOver(){
    this.state='over';
    this.ui.showToast(`Game Over — score ${this.score} - streak ${this.streak}`);
    setTimeout(()=> this.ui.showMenu(true), 900);
  }

  quit(){
    this.state = 'menu';
    this.ui.showToast('Quit');
    this.ui.showMenu(true);
  }

  update(){
    if(this.state==='paused' || this.state==='levelup'){
      // freeze gameplay visuals/timer while paused
      this.ui.setTimer(this.timeLeft, false);
      return;
    }
    if(this.state!=='playing'){
      this.ui.setTimer(0,false);
      return;
    }

    const rawElapsed = (now()-this.qStart)/1000;
    let elapsed = rawElapsed * this.questionSpeed;

    // After timeout, freeze elapsed so the enemy stops at the player and timer stays at 0
    if(this.timedOut) elapsed = this.timeLimit;


    this.timeLeft = Math.max(0, this.timeLimit - elapsed);
    this.ui.setTimer(this.timeLeft, this.timeLeft < 1.6);

    const p = Math.min(1, elapsed/this.timeLimit);
    const startX=780, targetX=330;
    this.enemy.x = startX - (startX-targetX)*p;

    // If time runs out: do NOT advance question. Apply damage once, then allow unlimited time.
    if(this.timeLeft <= 0 && !this.timedOut){
      this.timedOut = true;

      // Apply penalty once
      this.streak = 0;
      this.hearts -= 1;
      this.playSfx('miss');
      this.updateHUD();

      if(this.hearts <= 0){
        this.onDefeat();
        return;
      }

      // Let the player keep trying on the same question
      this.ui.showToast("Time's up! -1 heart. Try again.");
      // Keep choices enabled (do NOT lock)
      this.ui.lockChoices(false);
    }

  }

  loop(){
    requestAnimationFrame(()=> this.loop());
    this.update();
    this.draw();
  }

  draw(){
    const ctx=this.ctx;
    const w=960,h=540;
    ctx.clearRect(0,0,w,h);

    drawBackground(ctx,w,h,this.settings.mode);

    // shake
    let sx=0,sy=0;
    if(now() < this.shakeUntil){
      sx=(Math.random()-0.5)*10;
      sy=(Math.random()-0.5)*8;
    }
    ctx.save();
    ctx.translate(sx,sy);

    // ground shadows
    ctx.globalAlpha=0.35;
    ctx.fillStyle='black';
    ellipse(ctx,this.player.x,this.player.y+85,90,18);
    ellipse(ctx,this.enemy.x,this.enemy.y+85,90,18);

    ctx.globalAlpha=1;

    // damage flash
    const damaged = now() < this.damageUntil;
    drawNinja(ctx,this.player.x,this.player.y,{team:'player', damaged});
    drawSlowAura(ctx,this.enemy.x,this.enemy.y, this.questionSpeed < this.baseSpeed);

    drawNinja(ctx,this.enemy.x,this.enemy.y,{team:'enemy', angry:this.timeLeft<1.5});

    // danger line
    ctx.save();
    ctx.globalAlpha=0.22;
    ctx.strokeStyle='#ffdf6e';
    ctx.lineWidth=4;
    ctx.setLineDash([10,10]);
    ctx.beginPath(); ctx.moveTo(330,90); ctx.lineTo(330,500); ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  initAudio(){
    const ctx = (window.AudioContext||window.webkitAudioContext) ? new (window.AudioContext||window.webkitAudioContext)() : null;
    return { ctx };
  }
  playSfx(type){
    if(!this.settings.sound) return;
    const a=this.audio;
    if(!a.ctx) return;
    if(a.ctx.state==='suspended'){ a.ctx.resume().catch(()=>{}); }
    const t0=a.ctx.currentTime;
    const o=a.ctx.createOscillator();
    const g=a.ctx.createGain();
    o.connect(g); g.connect(a.ctx.destination);
    if(type==='hit'){
      o.type='triangle';
      o.frequency.setValueAtTime(420,t0);
      o.frequency.exponentialRampToValueAtTime(760,t0+0.08);
      g.gain.setValueAtTime(0.0001,t0);
      g.gain.exponentialRampToValueAtTime(0.18,t0+0.01);
      g.gain.exponentialRampToValueAtTime(0.0001,t0+0.12);
      o.start(t0); o.stop(t0+0.13);
    }else{
      o.type='sawtooth';
      o.frequency.setValueAtTime(220,t0);
      o.frequency.exponentialRampToValueAtTime(120,t0+0.10);
      g.gain.setValueAtTime(0.0001,t0);
      g.gain.exponentialRampToValueAtTime(0.14,t0+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001,t0+0.14);
      o.start(t0); o.stop(t0+0.15);
    }
  }

}

function ellipse(ctx,cx,cy,rx,ry){
  ctx.beginPath();
  ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);
  ctx.fill();
}

function drawBackground(ctx,w,h,mode){
  const world = (mode==='add100nr'||mode==='sub100nr')?1:(mode.startsWith('add100')||mode.startsWith('sub100'))?2:0;
  const g=ctx.createLinearGradient(0,0,0,h);
  if(world===0){
    g.addColorStop(0,'rgba(110,231,255,0.10)');
    g.addColorStop(1,'rgba(0,0,0,0.25)');
  }else if(world===1){
    g.addColorStop(0,'rgba(20,40,70,0.55)');
    g.addColorStop(1,'rgba(0,0,0,0.25)');
  }else{
    g.addColorStop(0,'rgba(55,25,75,0.45)');
    g.addColorStop(1,'rgba(0,0,0,0.28)');
  }
  ctx.fillStyle=g;
  ctx.fillRect(0,0,w,h);

  // floor
  ctx.save();
  ctx.fillStyle='rgba(255,255,255,0.05)';
  ctx.fillRect(0,320,w,h-320);
  ctx.globalAlpha=0.14;
  ctx.strokeStyle='rgba(255,255,255,0.25)';
  for(let y=330;y<h;y+=30){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
  ctx.restore();
}

function drawSlowAura(ctx,x,y,on){
  if(!on) return;
  ctx.save();
  ctx.globalAlpha=0.28;
  ctx.fillStyle='#6ee7ff';
  ctx.beginPath(); ctx.arc(x,y-8,88,0,Math.PI*2); ctx.fill();
  ctx.globalAlpha=0.16;
  ctx.beginPath(); ctx.arc(x,y-8,128,0,Math.PI*2); ctx.fill();
  ctx.globalAlpha=0.55;
  ctx.strokeStyle='rgba(110,231,255,0.55)';
  ctx.lineWidth=3;
  ctx.setLineDash([8,10]);
  ctx.beginPath(); ctx.arc(x,y-8,110,0,Math.PI*2); ctx.stroke();
  ctx.restore();
}

function drawNinja(ctx,x,y,{team,angry=false,damaged=false}){
  ctx.save();
  ctx.translate(x,y);

  // damage flash
  if(damaged){
    ctx.save();
    ctx.globalAlpha=0.20;
    ctx.fillStyle='#ff2d2d';
    ctx.beginPath(); ctx.arc(0,-6,70,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }

  const body = (team==='player') ? '#6ee7ff' : '#ff7c7c';
  const band = (team==='player') ? '#b6f3ff' : '#ffd1d1';

  // body
  ctx.fillStyle='rgba(0,0,0,0.35)';
  roundRect(ctx,-40,30,80,68,22); ctx.fill();
  ctx.globalAlpha=0.18; ctx.fillStyle=body; roundRect(ctx,-40,30,80,68,22); ctx.fill(); ctx.globalAlpha=1;

  // head
  ctx.fillStyle='rgba(0,0,0,0.55)';
  ctx.beginPath(); ctx.arc(0,0,42,0,Math.PI*2); ctx.fill();

  // headband
  ctx.fillStyle=band;
  ctx.globalAlpha=0.55;
  roundRect(ctx,-44,-16,88,18,9); ctx.fill();
  ctx.globalAlpha=1;

  // eyes
  ctx.fillStyle='rgba(255,255,255,0.90)';
  roundRect(ctx,-26,-2,52,14,7); ctx.fill();
  ctx.fillStyle='rgba(0,0,0,0.65)';
  const py=angry?5:6;
  ctx.beginPath(); ctx.arc(-10,py,4,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(10,py,4,0,Math.PI*2); ctx.fill();

  if(angry){
    ctx.strokeStyle='rgba(0,0,0,0.55)';
    ctx.lineWidth=4;
    ctx.beginPath();
    ctx.moveTo(-24,-6); ctx.lineTo(-2,2);
    ctx.moveTo(24,-6); ctx.lineTo(2,2);
    ctx.stroke();
  }

  // sword
  ctx.save();
  ctx.globalAlpha=0.85;
  ctx.strokeStyle='rgba(255,255,255,0.55)';
  ctx.lineWidth=5;
  ctx.beginPath(); ctx.moveTo(54,62); ctx.lineTo(92,28); ctx.stroke();
  ctx.restore();

  ctx.restore();
}

function roundRect(ctx,x,y,w,h,r){
  r=Math.min(r,w/2,h/2);
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}
