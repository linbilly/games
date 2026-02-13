export class UI{
  constructor(){
    this.overlay = document.getElementById('overlay');
    this.howModal = document.getElementById('howModal');
    this.btnStart = document.getElementById('btnStart');
    this.btnHow = document.getElementById('btnHow');
    this.btnCloseHow = document.getElementById('btnCloseHow');
    this.btnReset = document.getElementById('btnReset');
    this.btnMenu = document.getElementById('btnMenu');

    this.hudMode = document.getElementById('hudMode');
    this.hudScore = document.getElementById('hudScore');
    this.hudStreak = document.getElementById('hudStreak');
    this.hudHearts = document.getElementById('hudHearts');

    this.question = document.getElementById('question');
    this.timerText = document.getElementById('timerText');
    this.timerPill = document.getElementById('timerPill');
    this.choices = document.getElementById('choices');
    this.hint = document.getElementById('hint');

    this.chkSound = document.getElementById('chkSound');
    this.chkHints = document.getElementById('chkHints');
    this.chkAdaptive = document.getElementById('chkAdaptive');

    this.selSpeed = document.getElementById('selSpeed');

    this.toast = document.getElementById('toast');
    this.progressLine = document.getElementById('progressLine');

    this.modeButtons = Array.from(document.querySelectorAll('.modeBtn'));
    this.selectedMode = 'add20';
    this.modeButtons.forEach(btn=>{
      btn.addEventListener('click', ()=>{
        this.modeButtons.forEach(b=>b.classList.remove('selected'));
        btn.classList.add('selected');
        this.selectedMode = btn.dataset.mode;
      });
    });
    // default selection
    const def = this.modeButtons.find(b=>b.dataset.mode===this.selectedMode);
    if(def) def.classList.add('selected');
  }

  bind(game){
    this.btnStart.addEventListener('click', ()=>{
      const settings = {
        mode: this.selectedMode,
        sound: this.chkSound.checked,
        hints: this.chkHints.checked,
        adaptive: this.chkAdaptive.checked,
        speed: this.selSpeed ? this.selSpeed.value : 'normal',
      };
      game.start(settings);
      this.showMenu(false);
    });

    this.btnHow.addEventListener('click', ()=> this.showHow(true));
    this.btnCloseHow.addEventListener('click', ()=> this.showHow(false));

    this.btnReset.addEventListener('click', ()=>{
      if(confirm('Reset progress and stats?')){
        game.resetProgress();
        this.showToast('Progress reset.');
        this.updateProgressLine(game.getProgressSummary());
      }
    });

    this.btnMenu.addEventListener('click', ()=>{
      this.showMenu(true);
      game.pause(true);
      this.updateProgressLine(game.getProgressSummary());
    });

    window.addEventListener('keydown', (e)=>{
      if(e.key === 'Escape'){
        const isMenuOpen = !this.overlay.classList.contains('hidden');
        this.showMenu(!isMenuOpen);
        game.pause(!isMenuOpen);
      }
    });
  }

  showMenu(show){
    this.overlay.classList.toggle('hidden', !show);
    this.overlay.setAttribute('aria-hidden', String(!show));
    if(show) this.showHow(false);
  }

  showHow(show){
    this.howModal.setAttribute('aria-hidden', String(!show));
  }

  setHUD({modeName, score, streak, hearts}){
    this.hudMode.textContent = modeName;
    this.hudScore.textContent = String(score);
    this.hudStreak.textContent = String(streak);
    this.hudHearts.textContent = '❤'.repeat(hearts);
  }

  setQuestion(text){
    this.question.textContent = text;
  }

  setTimer(seconds, urgency=false){
    this.timerText.textContent = `${seconds.toFixed(1)}s`;
    if(urgency){
      this.timerPill.style.borderColor = 'rgba(255,215,110,0.7)';
      this.timerPill.style.background = 'rgba(255,215,110,0.12)';
    }else{
      this.timerPill.style.borderColor = 'rgba(255,255,255,0.12)';
      this.timerPill.style.background = 'rgba(255,255,255,0.08)';
    }
  }

  setHint(html){
    this.hint.innerHTML = html || '';
  }

  renderChoices(values, onPick){
    this.choices.innerHTML = '';
    values.forEach((v, idx)=>{
      const btn = document.createElement('button');
      btn.className = 'choiceBtn';
      btn.textContent = String(v);
      btn.setAttribute('data-idx', String(idx));
      btn.addEventListener('click', ()=> onPick(v, btn));
      this.choices.appendChild(btn);
    });

    // keyboard shortcut 1-4
    const handler = (e)=>{
      const k = e.key;
      if(k === '1' || k === '2' || k === '3' || k === '4'){
        const i = Number(k) - 1;
        const btn = this.choices.querySelector(`.choiceBtn[data-idx="${i}"]`);
        if(btn){
          btn.click();
          e.preventDefault();
        }
      }
    };
    window.addEventListener('keydown', handler, { once:true });
  }

  markChoice(btn, ok){
    btn.classList.add(ok ? 'good' : 'bad');
  }

  lockChoices(lock=true){
    this.choices.querySelectorAll('.choiceBtn').forEach(b=>{
      b.disabled = lock;
      b.style.cursor = lock ? 'not-allowed' : 'pointer';
      b.style.opacity = lock ? '0.75' : '1';
    });
  }

  showToast(msg){
    this.toast.textContent = msg;
    this.toast.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(()=> this.toast.classList.remove('show'), 1200);
  }

  updateProgressLine(text){
    this.progressLine.textContent = text;
  }
}
