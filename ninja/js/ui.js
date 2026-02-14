export class UI{
  constructor(){
    this.overlay = document.getElementById('overlay');

    this.btnPause = document.getElementById('btnPause');
    this.btnMenu = document.getElementById('btnMenu');
    this.btnStart = document.getElementById('btnStart');
    this.btnHow = document.getElementById('btnHow');
    this.btnReset = document.getElementById('btnReset');
    this.btnQuit = document.getElementById('btnQuit');

    this.progressLine = document.getElementById('progressLine');
    this.progressLabel = document.getElementById('progressLabel');
    this.progressPct = document.getElementById('progressPct');
    this.progressBar = document.getElementById('progressBar');

    this.hudMode = document.getElementById('hudMode');
    this.hudScore = document.getElementById('hudScore');
    this.hudStreak = document.getElementById('hudStreak');
    this.hudHearts = document.getElementById('hudHearts');

    this.question = document.getElementById('question');
    this.timerPill = document.getElementById('timerPill');
    this.timerText = document.getElementById('timerText');
    this.choices = document.getElementById('choices');
    this.hint = document.getElementById('hint');
    this.toast = document.getElementById('toast');

    this.chkSound = document.getElementById('chkSound');
    this.chkHints = document.getElementById('chkHints');
    this.chkAdaptive = document.getElementById('chkAdaptive');
    this.selSpeed = document.getElementById('selSpeed');

    this.levelUpModal = document.getElementById('levelUpModal');
    this.levelUpText = document.getElementById('levelUpText');
    this.btnContinue = document.getElementById('btnContinue');
    this.btnEndGame = document.getElementById('btnEndGame');


    this.howModal = document.getElementById('howModal');
    this.btnCloseHow = document.getElementById('btnCloseHow');

    this.modeButtons = Array.from(document.querySelectorAll('.modeBtn'));
    this.selectedMode = 'add20';
    this.setModeActive('add20');

    this._toastTimer = null;
    this.game = null;
  }

  bindGame(game){
    this.game = game;

    // Pause / Resume
    if(this.btnPause){
      this.btnPause.addEventListener('click', ()=>{
        if(!this.game) return;
        if(this.game.state === 'playing') this.game.pause();
        else if(this.game.state === 'paused') this.game.resume();
        this.updateHeaderButtons();
      });
    }

    // Menu
    this.btnMenu.addEventListener('click', ()=>{
      if(this.game && this.game.state === 'playing'){
        this.game.pause();
      }
      this.showMenu(true);
      this.updateHeaderButtons();
    });

    // Start / Resume / Continue
    this.btnStart.addEventListener('click', ()=>{

      if(this.game && this.game.state === 'paused'){
        this.showMenu(false);
        this.game.resume();
        this.updateHeaderButtons();
        return;
      }

      if(this.game && this.game.state === 'levelup'){
        this.showLevelUp(false);
        this.game.resumeFromLevelUp();
        this.updateHeaderButtons();
        return;
      }

      const settings = {
        mode: this.selectedMode,
        sound: this.chkSound.checked,
        hints: this.chkHints.checked,
        adaptive: this.chkAdaptive.checked,
        speed: this.selSpeed ? this.selSpeed.value : 'normal'
      };

      this.showMenu(false);
      this.game.start(settings);
      this.updateHeaderButtons();
    });

    this.btnContinue.addEventListener('click', ()=>{
      this.showLevelUp(false);
      if(this.game) this.game.resumeFromLevelUp();
      this.updateHeaderButtons();
    });

    this.btnQuit.addEventListener('click', ()=>{
      if(this.game) this.game.quit();
      this.showMenu(true);
      this.updateHeaderButtons();
    });

    this.btnEndGame.addEventListener('click', ()=>{
      // Close the popup and end the run
      this.showLevelUp(false);
      if(this.game) this.game.quit();   // returns to menu
      this.showMenu(true);
      this.updateHeaderButtons();
    });
        

    this.btnReset.addEventListener('click', ()=>{
      if(this.game) this.game.resetProgress();
      this.showToast('Progress reset');
      this.updateHeaderButtons();
    });

    this.btnHow.addEventListener('click', ()=> this.showHow(true));
    this.btnCloseHow.addEventListener('click', ()=> this.showHow(false));

    this.modeButtons.forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const m = btn.getAttribute('data-mode');
        this.selectedMode = m;
        this.setModeActive(m);
      });
    });

    this.updateHeaderButtons();
  }

  setModeActive(mode){
    this.modeButtons.forEach(b=>{
      b.classList.toggle('active', b.getAttribute('data-mode') === mode);
    });
  }

  updateHeaderButtons(){
    if(this.btnPause){
      const state = this.game ? this.game.state : 'menu';
      this.btnPause.textContent =
        (state === 'paused' || state === 'levelup') ? '▶' : '⏸';
    }

    if(this.overlay.getAttribute('aria-hidden') === 'false'){
      const paused = this.game && this.game.state === 'paused';
      const levelup = this.game && this.game.state === 'levelup';
      this.btnStart.textContent =
        levelup ? 'Continue' :
        paused ? 'Resume' :
        'Start';
    }
  }

  showMenu(show){
    this.overlay.classList.remove('levelup');
    this.overlay.setAttribute('aria-hidden', show ? 'false' : 'true');
    if(show){
      const paused = this.game && this.game.state === 'paused';
      this.btnStart.textContent = paused ? 'Resume' : 'Start';
    }
  }

  showHow(show){
    this.howModal.setAttribute('aria-hidden', show ? 'false' : 'true');
  }

  showLevelUp(show, text=''){
    this.overlay.setAttribute('aria-hidden', show ? 'false' : 'true');
    this.overlay.classList.toggle('levelup', !!show);
    this.levelUpModal.setAttribute('aria-hidden', show ? 'false' : 'true');
    if(text) this.levelUpText.textContent = text;
    this.updateHeaderButtons();
  }

  setProgress(percent, labelText=''){
    const p = Math.max(0, Math.min(100, percent));
    if(this.progressBar) this.progressBar.style.width = p + '%';
    if(this.progressPct) this.progressPct.textContent = Math.round(p) + '%';
    if(this.progressLabel && labelText) this.progressLabel.textContent = labelText;
  }

  setHUD({modeName, score, streak, hearts}){
    this.hudMode.textContent = modeName;
    this.hudScore.textContent = score;
    this.hudStreak.textContent = streak;
    this.hudHearts.textContent = '❤'.repeat(Math.max(0, hearts));
  }

  setQuestion(text){
    this.question.textContent = text;
  }

  setTimer(seconds, urgent){
    this.timerText.textContent = seconds.toFixed(1) + 's';
    this.timerPill.style.borderColor =
      urgent ? 'rgba(255,95,95,0.45)' :
               'rgba(255,255,255,0.12)';
  }

  setHint(html){
    this.hint.innerHTML = html || '';
  }

  renderChoices(values, onPick){
    this.choices.innerHTML = '';
    values.forEach(v=>{
      const b = document.createElement('button');
      b.className = 'choiceBtn';
      b.textContent = v;
      b.addEventListener('click', ()=> onPick(v, b));
      this.choices.appendChild(b);
    });
  }

  lockChoices(lock){
    this.choices.querySelectorAll('button')
      .forEach(b=> b.disabled = !!lock);
  }

  markChoice(btn, correct){
    if(correct){
      btn.style.background = 'rgba(95,255,168,0.22)';
      btn.style.borderColor = 'rgba(95,255,168,0.45)';
    } else {
      btn.style.background = 'rgba(255,95,95,0.16)';
      btn.style.borderColor = 'rgba(255,95,95,0.35)';
    }
  }

  showToast(text){
    this.toast.textContent = text;
    this.toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(()=>{
      this.toast.classList.remove('show');
    }, 950);
  }

  updateProgressLine(text){
    this.progressLine.textContent = text;
  }
}
