/* Bubble Pop! Pre-K (v2)
   - Campaign mode: Level 1 numbers, Level 2 uppercase, Level 3 lowercase, etc.
   - Standalone modes: pick any skill directly.
   - 10 questions per level
   - Accuracy tracking + adaptive weak-spot weighting for targets
*/
(() => {
  'use strict';

  // ---------- Helpers ----------
  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const lerp = (a,b,t)=>a+(b-a)*t;
  const rand = (a,b)=>a+Math.random()*(b-a);
  const choice = (arr)=>arr[(Math.random()*arr.length)|0];
  function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=(Math.random()*(i+1))|0; [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }
  const nowMs = ()=>performance.now();
  const pct = (n,d)=> d<=0 ? 0 : Math.round((n/d)*100);

  // ---------- Data ----------
  const COLORS = [
    {name:'red',    fill:'#ff3b30'},
    {name:'blue',   fill:'#2d7dff'},
    {name:'yellow', fill:'#ffd60a'},
    {name:'green',  fill:'#2ecc71'},
    {name:'purple', fill:'#af52de'},
    {name:'orange', fill:'#ff9500'},
  ];

  const SHAPES = [
    {name:'circle'},
    {name:'square'},
    {name:'triangle'},
    {name:'star'},
    {name:'heart'},
    {name:'rectangle'},
  ];

  const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const LOWER = 'abcdefghijklmnopqrstuvwxyz'.split('');
  const DIGITS = '0123456789'.split('');

  // Kid-friendly phonics approximations (for TTS)
  const PHONICS = {
    a:'ah', b:'buh', c:'kuh', d:'duh', e:'eh', f:'fff', g:'guh', h:'huh', i:'ih', j:'juh',
    k:'kuh', l:'lll', m:'mmm', n:'nnn', o:'oh', p:'puh', q:'kwuh', r:'rrr', s:'sss', t:'tuh',
    u:'uh', v:'vuh', w:'wuh', x:'ks', y:'yuh', z:'zzz'
  };

  const MODES = [
    { id:'campaign',     title:'Campaign (Levels)',   desc:'Level 1 numbers → 2 uppercase → 3 lowercase…' },
    { id:'numbers',      title:'Numbers',             desc:'Find digits 0–9' },
    { id:'lettersUpper', title:'Uppercase Letters',   desc:'Find A, B, C…' },
    { id:'lettersLower', title:'Lowercase Letters',   desc:'Find a, b, c…' },
    { id:'phonics',      title:'Phonics',             desc:'“Find the letter that says /buh/”' },
    { id:'shapes',       title:'Shapes',              desc:'Find simple shapes' },
    { id:'colors',       title:'Colors',              desc:'Find bubble colors' },
    { id:'pattern',      title:'Pattern',             desc:'Which comes next?' },
    { id:'counting',     title:'Counting',            desc:'“Pop 3 bubbles!” (exactly)' },
    { id:'mixed',        title:'Mixed',               desc:'Letters + numbers + shapes + colors' },
  ];

  // Campaign plan: each level uses ONE consistent skill bucket.
  // Level number also controls difficulty (speed/bubbles), and determines which skill is used in campaign.
  const LEVEL_PLAN = [
    { mode:'numbers',      label:'Numbers' },
    { mode:'lettersUpper', label:'Uppercase Letters' },
    { mode:'lettersLower', label:'Lowercase Letters' },
    { mode:'shapes',       label:'Shapes' },
    { mode:'colors',       label:'Colors' },
    { mode:'phonics',      label:'Phonics' },
    { mode:'pattern',      label:'Pattern' },
    { mode:'counting',     label:'Counting' },
  ];

  // ---------- Canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  function resizeCanvas(){
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width  = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  window.addEventListener('resize', resizeCanvas, {passive:true});
  resizeCanvas();

  // ---------- UI ----------
  const overlay = document.getElementById('overlay');
  const modal = document.getElementById('modal');
  const banner = document.getElementById('banner');

  const btnMenu = document.getElementById('btnMenu');
  const btnStart = document.getElementById('btnStart');
  const btnResume = document.getElementById('btnResume');
  const btnQuit = document.getElementById('btnQuit');
  const btnReport = document.getElementById('btnReport');

  const optTTS = document.getElementById('optTTS');
  const optShowText = document.getElementById('optShowText');
  const optAssist = document.getElementById('optAssist');

  const modeGrid = document.getElementById('modeGrid');

  const hudMode = document.getElementById('hudMode');
  const hudLevel = document.getElementById('hudLevel');
  const hudQ = document.getElementById('hudQ');
  const hudScore = document.getElementById('hudScore');
  const hudAcc = document.getElementById('hudAcc');
  const promptText = document.getElementById('promptText');
  const subpromptText = document.getElementById('subpromptText');

  const countingUI = document.getElementById('countingUI');
  const countTarget = document.getElementById('countTarget');
  const countNeed = document.getElementById('countNeed');
  const countSoFar = document.getElementById('countSoFar');

  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  const modalClose = document.getElementById('modalClose');

  // ---------- Audio ----------
  function speak(text){
    if(!optTTS.checked) return;
    if(!('speechSynthesis' in window)) return;
    try{
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      u.pitch = 1.05;
      u.volume = 1.0;
      window.speechSynthesis.speak(u);
    }catch(_){}
  }

  let audioCtx = null;
  function beep(type='ok'){
    try{
      if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = audioCtx.currentTime;
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = (type==='ok') ? 880 : 220;
      g.gain.value = 0.0001;
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t0);
      g.gain.exponentialRampToValueAtTime(0.15, t0+0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0+0.18);
      o.stop(t0+0.2);
    }catch(_){}
  }

  // ---------- State ----------
  const state = {
    running:false,
    paused:true,

    mode:'campaign',
    level:1,

    // per-level
    qIndex:0,
    score:0,
    correct:0,
    attempts:0,

    // question
    bubbles:[],
    drops:[],
    questionStartMs:0,
    assistShown:false,

    // counting
    countingTarget:3,
    countingSoFar:0,
    countingActive:false,

    // pattern
    patternSeq:[],
    patternAnswer:null,

    // adaptive stats
    itemStats:new Map(), // key => {seen, correct}
    modeStats:new Map(), // mode => {seen, correct} (skill mode)
    history:[], // per-level summaries
  };

  function activeMode(){
    if(state.mode !== 'campaign') return state.mode;
    return LEVEL_PLAN[(state.level-1) % LEVEL_PLAN.length].mode;
  }
  function activeLabel(){
    if(state.mode !== 'campaign') {
      const m = MODES.find(x=>x.id===state.mode);
      return m ? m.title : state.mode;
    }
    return LEVEL_PLAN[(state.level-1) % LEVEL_PLAN.length].label;
  }

  function keyForItem(kind, value){ return `${kind}:${value}`; }

  function recordAttempt(kind, value, ok){
    state.attempts++;
    if(ok) state.correct++;

    const k = keyForItem(kind, value);
    const s = state.itemStats.get(k) || {seen:0, correct:0};
    s.seen++; if(ok) s.correct++;
    state.itemStats.set(k, s);

    const am = activeMode();
    const ms = state.modeStats.get(am) || {seen:0, correct:0};
    ms.seen++; if(ok) ms.correct++;
    state.modeStats.set(am, ms);

    hudAcc.textContent = `Acc: ${pct(state.correct, state.attempts)}%`;
  }

  function weakWeight(kind, value){
    const k = keyForItem(kind, value);
    const s = state.itemStats.get(k);
    if(!s) return 1.25; // new items slightly boosted
    const acc = s.correct / Math.max(1, s.seen);
    return clamp(2.8 - 2.2*acc + (s.seen<4 ? 0.4 : 0), 0.6, 3.0);
  }

  function weightedChoice(items, weightFn){
    let sum=0;
    const ws = items.map(it=>{ const w=Math.max(0.001, weightFn(it)); sum+=w; return w; });
    let r=Math.random()*sum;
    for(let i=0;i<items.length;i++){ r-=ws[i]; if(r<=0) return items[i]; }
    return items[items.length-1];
  }

  // ---------- Gameplay tuning ----------
  function bubblesForLevel(){
    return clamp(3 + Math.floor((state.level-1)/1.5), 3, 8);
  }
  function floatSpeedForLevel(){
    return 36 + (state.level-1)*8;
  }
  function bubbleRadius(){
    return clamp(54 - (bubblesForLevel()-3)*3, 36, 54);
  }

  // ---------- Entities ----------
  function makeBubble({x,y,r,vy,vx,wobblePhase,color,payload,isTarget=false,highlight=false}){
    return {x,y,r,vy,vx,wobblePhase,color,payload,isTarget,popped:false,highlight,born:nowMs()};
  }
  function makeDrop({x,y,payload,color}){
    return {x,y,vy:0,payload,color,rot:rand(-0.3,0.3),vr:rand(-1.8,1.8),born:nowMs()};
  }

  // ---------- Prompts ----------
  function setPrompt(main, sub=''){
    state.questionStartMs = nowMs();
    state.assistShown = false;
    promptText.textContent = optShowText.checked ? main : '';
    subpromptText.textContent = optShowText.checked ? sub : '';
  }

  // ---------- Question generation ----------
  function makeDistractors(kind, targetValue, count, lettersLower=false){
    if(count<=0) return [];
    let pool=[];
    if(kind==='letter'){
      const letters = lettersLower ? LOWER : UPPER;
      pool = letters.filter(x=>x!==targetValue);
      const idx = letters.indexOf(targetValue);
      const nearby=[];
      if(idx>=0){
        for(let d=1;d<=3;d++){
          if(letters[idx-d]) nearby.push(letters[idx-d]);
          if(letters[idx+d]) nearby.push(letters[idx+d]);
        }
      }
      const picked=[];
      shuffle(nearby);
      while(picked.length < Math.min(nearby.length, Math.ceil(count/2))) picked.push(nearby.shift());
      while(picked.length < count){
        const v = choice(pool);
        if(!picked.includes(v)) picked.push(v);
      }
      return picked;
    }
    if(kind==='number'){
      pool = DIGITS.filter(x=>x!==targetValue);
      const t = Number(targetValue);
      const near=[t-1,t+1,t-2,t+2].filter(n=>n>=0&&n<=9).map(String).filter(v=>v!==targetValue);
      const picked=[];
      shuffle(near);
      while(picked.length < Math.min(near.length, Math.ceil(count/2))) picked.push(near.shift());
      while(picked.length < count){
        const v=choice(pool);
        if(!picked.includes(v)) picked.push(v);
      }
      return picked;
    }
    if(kind==='shape'){
      pool = SHAPES.map(s=>s.name).filter(x=>x!==targetValue);
      return shuffle(pool).slice(0,count);
    }
    if(kind==='color'){
      pool = COLORS.map(c=>c.name).filter(x=>x!==targetValue);
      return shuffle(pool).slice(0,count);
    }
    return [];
  }

  function newQuestion(){
    state.bubbles.length=0;
    state.drops.length=0;

    const am = activeMode();
    const nB = bubblesForLevel();
    const r = bubbleRadius();
    const speed = floatSpeedForLevel();
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    const y0 = h + r + 10;

    // reset counting UI
    state.countingActive = false;
    countingUI.hidden = true;

    // x positions
    const margin=r+10;
    const xs=[];
    for(let i=0;i<nB;i++) xs.push(lerp(margin, w-margin, (i+0.5)/nB) + rand(-18,18));
    shuffle(xs);

    // Counting mode: keep bubbles consistent (numbers only), task is "pop N bubbles exactly"
    if(am==='counting'){
      const targetCount = clamp(2 + ((state.level-1)%4), 2, 5);
      state.countingTarget = targetCount;
      state.countingSoFar = 0;
      state.countingActive = true;

      countingUI.hidden = false;
      countTarget.textContent = String(targetCount);
      countNeed.textContent = String(targetCount);
      countSoFar.textContent = '0';

      setPrompt(`Pop ${targetCount} bubbles!`, `Pop exactly ${targetCount} before time runs out.`);
      speak(`Pop ${targetCount} bubbles!`);

      for(let i=0;i<nB;i++){
        const c=choice(COLORS);
        const payload={kind:'number', value: choice(DIGITS)};
        state.bubbles.push(makeBubble({
          x:xs[i], y:y0+rand(0,120), r,
          vy:-speed*rand(0.85,1.15), vx:rand(-12,12),
          wobblePhase:rand(0,Math.PI*2),
          color:c, payload, isTarget:false
        }));
      }
      return;
    }

    // Pattern mode: show pattern bar and bubbles are consistent choices (colors or shapes)
    if(am==='pattern'){
      const useColors = Math.random() < 0.6;
      const kind = useColors ? 'color' : 'shape';

      let A,B;
      if(kind==='color'){
        A=choice(COLORS).name; do{B=choice(COLORS).name;} while(B===A);
      }else{
        A=choice(SHAPES).name; do{B=choice(SHAPES).name;} while(B===A);
      }

      const patterns = [
        {seq:[A,B,A,B], next:A},
        {seq:[A,A,B,B], next:A},
        {seq:[A,B,B,A], next:B},
      ];
      const pat = choice(patterns);
      state.patternSeq = pat.seq.slice();
      state.patternAnswer = pat.next;

      const options=[state.patternAnswer];
      const pool = (kind==='color')
        ? COLORS.map(c=>c.name).filter(x=>x!==state.patternAnswer)
        : SHAPES.map(s=>s.name).filter(x=>x!==state.patternAnswer);
      shuffle(pool);
      while(options.length < Math.min(4,nB)) options.push(pool.shift());
      shuffle(options);

      setPrompt('Which comes next?', useColors ? 'Look at the colors.' : 'Look at the shapes.');
      speak('Which comes next?');

      for(let i=0;i<options.length;i++){
        const v=options[i];
        const payload={kind, value:v};
        const c = (kind==='color') ? (COLORS.find(x=>x.name===v) || choice(COLORS)) : choice(COLORS);
        state.bubbles.push(makeBubble({
          x:xs[i], y:y0+rand(0,110), r,
          vy:-speed*rand(0.85,1.15), vx:rand(-12,12),
          wobblePhase:rand(0,Math.PI*2),
          color:c, payload,
          isTarget:(v===state.patternAnswer)
        }));
      }
      // optional filler bubbles (shapes) but keep them non-click-essential; still clickable though.
      for(let i=options.length;i<nB;i++){
        const payload={kind:'shape', value: choice(SHAPES).name};
        state.bubbles.push(makeBubble({
          x:xs[i], y:y0+rand(40,140), r,
          vy:-speed*rand(0.85,1.15), vx:rand(-12,12),
          wobblePhase:rand(0,Math.PI*2),
          color:choice(COLORS), payload, isTarget:false
        }));
      }
      return;
    }

    // Standard target selection per mode
    let kind='letter';
    let targetValue='A';
    let lettersLower=false;

    const pickLetter = (lower)=> {
      const letters = lower ? LOWER : UPPER;
      return weightedChoice(letters, (v)=>weakWeight('letter', v));
    };
    const pickDigit = ()=> weightedChoice(DIGITS, (v)=>weakWeight('number', v));
    const pickShape = ()=> weightedChoice(SHAPES.map(s=>s.name), (v)=>weakWeight('shape', v));
    const pickColor = ()=> weightedChoice(COLORS.map(c=>c.name), (v)=>weakWeight('color', v));

    if(am==='numbers'){
      kind='number'; targetValue=pickDigit();
      setPrompt(`Where is the number ${targetValue}?`);
      speak(`Where is the number ${targetValue}?`);
    } else if(am==='lettersUpper'){
      kind='letter'; lettersLower=false; targetValue=pickLetter(false);
      setPrompt(`Where is the letter ${targetValue}?`);
      speak(`Where is the letter ${targetValue}?`);
    } else if(am==='lettersLower'){
      kind='letter'; lettersLower=true; targetValue=pickLetter(true);
      setPrompt(`Where is the letter ${targetValue}?`, '(lowercase)');
      speak(`Where is the letter ${targetValue}?`);
    } else if(am==='phonics'){
      kind='letter'; lettersLower=true; targetValue=pickLetter(true);
      const sound = PHONICS[targetValue] || targetValue;
      setPrompt(`Which letter says /${sound}/?`, `Find: ${targetValue}`);
      speak(`Find the letter that says ${sound}.`);
    } else if(am==='shapes'){
      kind='shape'; targetValue=pickShape();
      setPrompt(`Where is the ${targetValue}?`);
      speak(`Where is the ${targetValue}?`);
    } else if(am==='colors'){
      kind='color'; targetValue=pickColor();
      setPrompt(`Which bubble is ${targetValue}?`);
      speak(`Which bubble is ${targetValue}?`);
    } else { // mixed
      const kinds=['letter','number','shape','color'];
      kind = choice(kinds);
      if(kind==='letter'){
        lettersLower = Math.random()<0.5;
        targetValue = pickLetter(lettersLower);
        setPrompt(`Where is the letter ${targetValue}?`);
        speak(`Where is the letter ${targetValue}?`);
      } else if(kind==='number'){
        targetValue = pickDigit();
        setPrompt(`Where is the number ${targetValue}?`);
        speak(`Where is the number ${targetValue}?`);
      } else if(kind==='shape'){
        targetValue = pickShape();
        setPrompt(`Where is the ${targetValue}?`);
        speak(`Where is the ${targetValue}?`);
      } else {
        targetValue = pickColor();
        setPrompt(`Which bubble is ${targetValue}?`);
        speak(`Which bubble is ${targetValue}?`);
      }
    }

    // Build bubble payloads
    const distractCount = Math.max(0, nB-1);
    const distractVals = makeDistractors(kind, targetValue, distractCount, lettersLower);
    const payloads = [{kind, value: targetValue}].concat(distractVals.map(v=>({kind, value:v})));
    shuffle(payloads);

    for(let i=0;i<nB;i++){
      const payload = payloads[i];
      let c;
      if(kind==='color'){
        c = COLORS.find(x=>x.name===payload.value) || choice(COLORS);
      } else {
        c = choice(COLORS);
      }
      state.bubbles.push(makeBubble({
        x:xs[i], y:y0+rand(0,120), r,
        vy:-speed*rand(0.85,1.15), vx:rand(-12,12),
        wobblePhase:rand(0,Math.PI*2),
        color:c, payload,
        isTarget:(payload.kind===kind && payload.value===targetValue)
      }));
    }
  }

  // ---------- Drawing ----------
  function drawBackground(w,h){
    ctx.clearRect(0,0,w,h);
    const g = ctx.createLinearGradient(0,0,0,h);
    g.addColorStop(0,'#aee9ff');
    g.addColorStop(1,'#f7fcff');
    ctx.fillStyle=g;
    ctx.fillRect(0,0,w,h);

    ctx.globalAlpha=0.22;
    ctx.fillStyle='#fff';
    for(let i=0;i<7;i++){
      const cx=(w*(i+1)/8)+Math.sin((performance.now()/3000)+i)*40;
      const cy=h*0.15+(i%3)*32;
      cloud(cx,cy,32+(i%3)*6);
    }
    ctx.globalAlpha=1;
  }
  function cloud(x,y,r){
    ctx.beginPath();
    ctx.arc(x,y,r,0,Math.PI*2);
    ctx.arc(x+r*0.9,y+r*0.15,r*0.8,0,Math.PI*2);
    ctx.arc(x-r*0.9,y+r*0.2,r*0.75,0,Math.PI*2);
    ctx.arc(x+r*0.2,y-r*0.55,r*0.85,0,Math.PI*2);
    ctx.fill();
  }
  function drawGround(w,h){
    const gh=90;
    const g=ctx.createLinearGradient(0,h-gh,0,h);
    g.addColorStop(0,'#8be28f');
    g.addColorStop(1,'#3abf64');
    ctx.fillStyle=g;
    ctx.fillRect(0,h-gh,w,gh);
  }

  function roundRect(x,y,w,h,r,fill){
    ctx.beginPath();
    const rr=Math.min(r,w/2,h/2);
    ctx.moveTo(x+rr,y);
    ctx.arcTo(x+w,y,x+w,y+h,rr);
    ctx.arcTo(x+w,y+h,x,y+h,rr);
    ctx.arcTo(x,y+h,x,y,rr);
    ctx.arcTo(x,y,x+w,y,rr);
    ctx.closePath();
    ctx.fillStyle=fill;
    ctx.fill();
  }

  function drawPatternBar(w){
    if(activeMode()!=='pattern') return;
    const y=92;
    const box=54;
    const gap=14;
    const total=state.patternSeq.length*box+(state.patternSeq.length-1)*gap;
    const x0=(w-total)/2;
    roundRect(x0-14,y-38,total+28,92,20,'#ffffffcc');

    for(let i=0;i<state.patternSeq.length;i++){
      const v=state.patternSeq[i];
      const x=x0+i*(box+gap)+box/2;

      const asColor = COLORS.find(c=>c.name===v);
      if(asColor){
        ctx.beginPath();
        ctx.arc(x,y,box*0.35,0,Math.PI*2);
        ctx.fillStyle=asColor.fill; ctx.fill();
        ctx.lineWidth=6; ctx.strokeStyle='rgba(255,255,255,.85)'; ctx.stroke();
      } else {
        ctx.save();
        ctx.translate(x,y);
        ctx.scale(0.7,0.7);
        drawShape(v,0,0,box*0.9);
        ctx.restore();
      }
    }
    const qx=x0+state.patternSeq.length*(box+gap)+box/2;
    roundRect(qx-box/2,y-box/2,box,box,16,'#ffffffd9');
    ctx.fillStyle='rgba(23,50,74,.85)';
    ctx.font='1000 40px system-ui';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('?',qx,y+2);
  }

  function drawShape(name,x,y,s){
    ctx.save();
    ctx.translate(x,y);
    ctx.fillStyle='rgba(23,50,74,.92)';
    ctx.strokeStyle='rgba(255,255,255,.85)';
    ctx.lineWidth=7;
    ctx.beginPath();
    if(name==='circle'){
      ctx.arc(0,0,s*0.55,0,Math.PI*2);
    } else if(name==='square'){
      ctx.rect(-s*0.5,-s*0.5,s,s);
    } else if(name==='rectangle'){
      ctx.rect(-s*0.62,-s*0.38,s*1.24,s*0.76);
    } else if(name==='triangle'){
      ctx.moveTo(0,-s*0.6);
      ctx.lineTo(s*0.6,s*0.5);
      ctx.lineTo(-s*0.6,s*0.5);
      ctx.closePath();
    } else if(name==='star'){
      const spikes=5, outer=s*0.62, inner=s*0.28;
      let rot=Math.PI/2*3;
      ctx.moveTo(0,-outer);
      for(let i=0;i<spikes;i++){
        ctx.lineTo(Math.cos(rot)*outer,Math.sin(rot)*outer);
        rot+=Math.PI/spikes;
        ctx.lineTo(Math.cos(rot)*inner,Math.sin(rot)*inner);
        rot+=Math.PI/spikes;
      }
      ctx.closePath();
    } else if(name==='heart'){
      ctx.moveTo(0,s*0.45);
      ctx.bezierCurveTo(s*0.8,s*0.05,s*0.55,-s*0.55,0,-s*0.2);
      ctx.bezierCurveTo(-s*0.55,-s*0.55,-s*0.8,s*0.05,0,s*0.45);
      ctx.closePath();
    } else {
      ctx.arc(0,0,s*0.45,0,Math.PI*2);
    }
    ctx.stroke(); ctx.fill();
    ctx.restore();
  }

  function drawBubble(b){
    if(b.popped) return;
    const t=performance.now()/1000;
    const wob=Math.sin(t*2+b.wobblePhase)*6;
    ctx.save();
    ctx.translate(b.x+wob,b.y);
    ctx.beginPath();
    ctx.arc(0,0,b.r,0,Math.PI*2);

    const grad=ctx.createRadialGradient(-b.r*0.3,-b.r*0.35,b.r*0.2,0,0,b.r);
    grad.addColorStop(0,'#ffffffcc');
    grad.addColorStop(0.3,b.color.fill+'cc');
    grad.addColorStop(1,b.color.fill+'66');
    ctx.fillStyle=grad; ctx.fill();

    ctx.lineWidth=4;
    ctx.strokeStyle='rgba(255,255,255,.65)';
    ctx.stroke();

    if(b.highlight){
      ctx.lineWidth=6;
      ctx.strokeStyle='rgba(255,215,0,.85)';
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(-b.r*0.35,-b.r*0.25,b.r*0.23,0,Math.PI*2);
    ctx.fillStyle='rgba(255,255,255,.55)';
    ctx.fill();

    drawPayload(b.payload,0,0,b.r);
    ctx.restore();
  }

  function drawPayload(payload,x,y,r){
    if(!payload) return;
    if(payload.kind==='letter' || payload.kind==='number'){
      const txt=String(payload.value);
      ctx.textAlign='center';
      ctx.textBaseline='middle';
      ctx.font=`900 ${Math.floor(r*1.15)}px system-ui,-apple-system,Segoe UI,Roboto,Arial`;
      ctx.lineWidth=7;
      ctx.strokeStyle='rgba(255,255,255,.75)';
      ctx.fillStyle='rgba(23,50,74,.95)';
      ctx.strokeText(txt,x,y+2);
      ctx.fillText(txt,x,y+2);
      return;
    }
    if(payload.kind==='shape'){
      drawShape(payload.value,x,y,r*0.75);
      return;
    }
    // color payload: empty
  }

  function drawDrop(d,h){
    const groundY = h-90+10;
    if(d.y>groundY){ d.y=groundY; d.vy=0; }
    ctx.save();
    ctx.translate(d.x,d.y);
    ctx.rotate(d.rot);
    if(d.payload.kind==='letter' || d.payload.kind==='number'){
      const txt=String(d.payload.value);
      ctx.font='1000 54px system-ui';
      ctx.textAlign='center';
      ctx.textBaseline='middle';
      ctx.lineWidth=7;
      ctx.strokeStyle='rgba(255,255,255,.75)';
      ctx.fillStyle='rgba(23,50,74,.92)';
      ctx.strokeText(txt,0,0);
      ctx.fillText(txt,0,0);
    } else if(d.payload.kind==='shape'){
      drawShape(d.payload.value,0,0,64);
    } else {
      const c = COLORS.find(x=>x.name===d.payload.value) || d.color;
      ctx.beginPath(); ctx.arc(0,0,20,0,Math.PI*2);
      ctx.fillStyle=c.fill; ctx.fill();
      ctx.lineWidth=6; ctx.strokeStyle='rgba(255,255,255,.85)'; ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- Interaction ----------
  function canvasPoint(evt){
    const rect=canvas.getBoundingClientRect();
    return {x:evt.clientX-rect.left, y:evt.clientY-rect.top};
  }
  function hitBubble(x,y){
    for(let i=state.bubbles.length-1;i>=0;i--){
      const b=state.bubbles[i];
      if(b.popped) continue;
      const dx=x-b.x, dy=y-b.y;
      if(dx*dx+dy*dy <= b.r*b.r) return b;
    }
    return null;
  }

  function popBubble(b){
    if(!b || b.popped) return;
    const am = activeMode();

    if(am==='counting'){
      b.popped=true;
      beep('ok');
      state.score++; hudScore.textContent=`Score: ${state.score}`;
      state.countingSoFar++;
      countSoFar.textContent=String(state.countingSoFar);

      if(state.countingSoFar===state.countingTarget){
        recordAttempt('count', String(state.countingTarget), true);
        nextQuestionOrEndLevel();
      } else if(state.countingSoFar>state.countingTarget){
        recordAttempt('count', String(state.countingTarget), false);
        nextQuestionOrEndLevel();
      }
      return;
    }

    const payload=b.payload;
    const ok=!!b.isTarget;
    b.popped=true;

    if(ok){
      beep('ok');
      state.score++; hudScore.textContent=`Score: ${state.score}`;
      recordAttempt(payload.kind, payload.value, true);
      nextQuestionOrEndLevel();
    } else {
      beep('bad');
      recordAttempt(payload.kind, payload.value, false);
      state.drops.push(makeDrop({x:b.x,y:b.y,payload,color:b.color}));
      if(optAssist.checked){
        for(const bb of state.bubbles){
          if(bb.isTarget && !bb.popped) bb.highlight=true;
        }
      }
    }
  }

  canvas.addEventListener('pointerdown', (e)=>{
    if(!state.running || state.paused) return;
    const p=canvasPoint(e);
    const b=hitBubble(p.x,p.y);
    if(b) popBubble(b);
  });

  // ---------- Flow ----------
  function showBanner(text){
    banner.textContent=text;
    banner.classList.remove('hidden');
    banner.style.animation='none';
    // eslint-disable-next-line no-unused-expressions
    banner.offsetHeight;
    banner.style.animation='';
    setTimeout(()=>banner.classList.add('hidden'), 900);
  }

  function resetLevelStats(){
    state.qIndex=0;
    state.correct=0;
    state.attempts=0;
    hudQ.textContent='Q: 1/10';
    hudAcc.textContent='Acc: 0%';
  }

  function updateHudMode(){
    hudMode.textContent = (state.mode==='campaign')
      ? `Mode: Campaign — ${activeLabel()}`
      : `Mode: ${activeLabel()}`;
  }

  function startSession(){
    state.running=true;
    state.paused=false;
    state.score=0;
    hudScore.textContent='Score: 0';
    resetLevelStats();
    updateHudMode();
    hudLevel.textContent=`Level: ${state.level}`;
    newQuestion();
  }

  function nextQuestionOrEndLevel(){
    state.qIndex++;
    if(state.qIndex>=10){
      endLevel();
    } else {
      hudQ.textContent=`Q: ${state.qIndex+1}/10`;
      for(const b of state.bubbles) b.highlight=false;
      newQuestion();
    }
  }

  function renderWeakSpotsHTML(max=8){
    const rows=[];
    for(const [k,s] of state.itemStats.entries()){
      if(s.seen<2) continue;
      const acc=s.correct/Math.max(1,s.seen);
      rows.push({k,seen:s.seen,correct:s.correct,acc});
    }
    rows.sort((a,b)=>(a.acc-b.acc)||(b.seen-a.seen));
    const top=rows.slice(0,max);
    if(top.length===0) return `<div style="opacity:.8;">No weak spots yet — keep playing!</div>`;
    return `<ul style="margin:6px 0 0 18px;">` + top.map(r=>{
      const [kind, ...rest] = r.k.split(':');
      const val = rest.join(':');
      const label = (kind==='letter') ? `Letter <b>${val}</b>` :
                    (kind==='number') ? `Number <b>${val}</b>` :
                    (kind==='shape')  ? `Shape <b>${val}</b>` :
                    (kind==='color')  ? `Color <b>${val}</b>` :
                    (kind==='count')  ? `Counting <b>${val}</b>` :
                    `<b>${r.k}</b>`;
      return `<li>${label} — ${pct(r.correct,r.seen)}% (${r.correct}/${r.seen})</li>`;
    }).join('') + `</ul>`;
  }

  function showLevelReport(summary, delta){
    const modeLabel = (summary.sessionMode==='campaign')
      ? `Campaign — ${summary.skillLabel}`
      : summary.skillTitle;

    modalTitle.textContent='Level Report';
    modalBody.innerHTML = `
      <div style="font-weight:1000; font-size:18px; margin-bottom:6px;">${modeLabel} — Level ${summary.level}</div>
      <div>Questions: <b>10</b></div>
      <div>Accuracy: <b>${pct(summary.correct, summary.attempts)}%</b> (${summary.correct}/${summary.attempts})</div>
      <div>Score: <b>${summary.score}</b></div>
      <div style="margin-top:10px; padding:10px; border-radius:14px; background:#ffffffc8;">
        ${delta>0 ? '✅ Great job! Next level will be a bit harder.' :
          delta<0 ? '🧡 We will make it a bit easier and practice more.' :
          '👍 Keep going!'}
      </div>
      <div style="margin-top:10px;">
        <div style="font-weight:1000;">Practice focus (weak spots)</div>
        ${renderWeakSpotsHTML(6)}
      </div>
    `;
    modal.classList.remove('hidden');
  }

  function endLevel(){
    const levelAcc = state.attempts>0 ? (state.correct/state.attempts) : 0;

    const am = activeMode();
    const m = MODES.find(x=>x.id===am);
    const summary = {
      sessionMode: state.mode,
      skillMode: am,
      skillTitle: m ? m.title : am,
      skillLabel: activeLabel(),
      level: state.level,
      correct: state.correct,
      attempts: state.attempts,
      accuracy: levelAcc,
      score: state.score,
      when: new Date().toISOString(),
    };
    state.history.push(summary);

    // adaptive difficulty: up/down by level number
    let delta=0;
    if(levelAcc>=0.90) delta=+1;
    else if(levelAcc<=0.60) delta=-1;

    const prev=state.level;
    state.level = clamp(state.level + delta, 1, 50);

    if(state.level>prev) showBanner('LEVEL UP!');
    else if(state.level<prev) showBanner('LEVEL DOWN');

    hudLevel.textContent=`Level: ${state.level}`;
    updateHudMode();

    // pause and show modal
    state.paused=true;
    showLevelReport(summary, delta);

    resetLevelStats();
  }

  function showFullReport(){
    modalTitle.textContent='Game Report';

    const modeRows = MODES.filter(x=>x.id!=='campaign').map(m=>{
      const s = state.modeStats.get(m.id);
      if(!s) return '';
      return `<tr><td>${m.title}</td><td style="text-align:right;">${pct(s.correct,s.seen)}%</td><td style="text-align:right;">${s.correct}/${s.seen}</td></tr>`;
    }).join('');

    const levels = state.history.slice(-14).map(h=>{
      const label = (h.sessionMode==='campaign') ? `Campaign — ${h.skillLabel}` : h.skillTitle;
      return `<tr><td>${label}</td><td style="text-align:right;">${h.level}</td><td style="text-align:right;">${pct(h.correct,h.attempts)}%</td><td style="text-align:right;">${h.correct}/${h.attempts}</td></tr>`;
    }).join('');

    modalBody.innerHTML = `
      <div style="font-weight:1000; font-size:18px; margin-bottom:6px;">Summary</div>
      <div>Total score: <b>${state.score}</b></div>

      <div style="margin-top:12px; font-weight:1000;">By Skill Accuracy</div>
      <table style="width:100%; border-collapse:collapse; margin-top:6px;">
        <thead><tr style="opacity:.75;"><th style="text-align:left;">Skill</th><th style="text-align:right;">Acc</th><th style="text-align:right;">C/A</th></tr></thead>
        <tbody>${modeRows || '<tr><td colspan="3" style="opacity:.7;">No data yet</td></tr>'}</tbody>
      </table>

      <div style="margin-top:12px; font-weight:1000;">Recent Level Results</div>
      <table style="width:100%; border-collapse:collapse; margin-top:6px;">
        <thead><tr style="opacity:.75;"><th style="text-align:left;">Mode</th><th style="text-align:right;">Lvl</th><th style="text-align:right;">Acc</th><th style="text-align:right;">C/A</th></tr></thead>
        <tbody>${levels || '<tr><td colspan="4" style="opacity:.7;">No levels finished yet</td></tr>'}</tbody>
      </table>

      <div style="margin-top:12px; font-weight:1000;">Weak Spots</div>
      ${renderWeakSpotsHTML(10)}
    `;
    modal.classList.remove('hidden');
  }

  function openMenu(inGame){
    overlay.classList.remove('hidden');
    state.paused = true;
    btnResume.hidden = !inGame;
    btnStart.hidden = inGame;
  }
  function closeMenu(){
    overlay.classList.add('hidden');
    if(state.running){
      state.paused=false;
      speak(promptText.textContent || '');
    }
  }

  modalClose.addEventListener('click', ()=>{
    modal.classList.add('hidden');
    if(state.running && state.paused){
      // resume next question after level report
      state.paused=false;
      newQuestion();
    }
  });
  modal.addEventListener('pointerdown', (e)=>{ if(e.target===modal) modalClose.click(); });

  btnMenu.addEventListener('click', ()=> openMenu(state.running));
  btnResume.addEventListener('click', closeMenu);

  btnQuit.addEventListener('click', ()=>{
    overlay.classList.add('hidden');
    if(state.running){
      state.running=false;
      state.paused=true;
    }
    showFullReport();
  });

  btnReport.addEventListener('click', ()=>{
    overlay.classList.add('hidden');
    showFullReport();
  });

  overlay.addEventListener('pointerdown', (e)=>{ if(e.target===overlay && state.running) closeMenu(); });

  // ---------- Mode selection ----------
  let selectedMode = state.mode;

  function renderModeButtons(){
    modeGrid.innerHTML='';
    for(const m of MODES){
      const btn=document.createElement('button');
      btn.className='modeBtn' + (m.id===selectedMode ? ' selected':'');
      btn.innerHTML = `<div class="mTitle">${m.title}</div><div class="mDesc">${m.desc}</div>`;
      btn.addEventListener('click', ()=>{ selectedMode=m.id; renderModeButtons(); });
      modeGrid.appendChild(btn);
    }
  }
  renderModeButtons();

  btnStart.addEventListener('click', ()=>{
    state.mode = selectedMode;
    state.level = 1;
    state.itemStats.clear();
    state.modeStats.clear();
    state.history.length = 0;

    updateHudMode();
    hudLevel.textContent=`Level: ${state.level}`;
    overlay.classList.add('hidden');
    startSession();
  });

  // ---------- Update / Render loop ----------
  function update(dt){
    if(!state.running || state.paused) return;

    // assist highlight after 3s (non-counting)
    if(optAssist.checked && !state.assistShown && activeMode()!=='counting'){
      const elapsed = nowMs() - state.questionStartMs;
      if(elapsed > 3000){
        state.assistShown = true;
        for(const b of state.bubbles){
          if(b.isTarget && !b.popped) b.highlight=true;
        }
      }
    }

    const w=canvas.getBoundingClientRect().width;
    const h=canvas.getBoundingClientRect().height;

    for(const b of state.bubbles){
      if(b.popped) continue;
      b.y += b.vy*dt;
      b.x += b.vx*dt;
      if(b.x < b.r+6){ b.x=b.r+6; b.vx*=-1; }
      if(b.x > w-(b.r+6)){ b.x=w-(b.r+6); b.vx*=-1; }

      // float away
      if(b.y < -b.r-30){
        b.popped=true;
        // if target floats away, count as incorrect and advance question
        if(b.isTarget){
          recordAttempt(b.payload.kind, b.payload.value, false);
          nextQuestionOrEndLevel();
        }
      }
    }

    // counting timeout
    if(activeMode()==='counting' && state.countingActive){
      const alive = state.bubbles.some(b=>!b.popped);
      const elapsed = nowMs() - state.questionStartMs;
      if(!alive || elapsed > 6500){
        recordAttempt('count', String(state.countingTarget), state.countingSoFar===state.countingTarget);
        nextQuestionOrEndLevel();
      }
    }

    // drops
    for(const d of state.drops){
      d.vy += 1200*dt;
      d.y += d.vy*dt;
      d.rot += d.vr*dt*0.8;
    }
    state.drops = state.drops.filter(d => (nowMs()-d.born) < 2500);
  }

  function render(){
    const w=canvas.getBoundingClientRect().width;
    const h=canvas.getBoundingClientRect().height;
    drawBackground(w,h);
    drawGround(w,h);
    drawPatternBar(w);

    for(const d of state.drops) drawDrop(d,h);
    for(const b of state.bubbles) drawBubble(b);
  }

  let last=nowMs();
  function loop(){
    const t=nowMs();
    const dt=clamp((t-last)/1000, 0, 0.05);
    last=t;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---------- Start state ----------
  setPrompt('Tap Start!', 'Choose a mode.');
  openMenu(false);

  // keyboard escape toggles menu
  window.addEventListener('keydown', (e)=>{
    if(e.key==='Escape'){
      if(!overlay.classList.contains('hidden')) closeMenu();
      else if(state.running) openMenu(true);
    }
  });

})();
