// ui.js
export function createUI() {
  const movesEl = document.getElementById("moves");
  const msgEl = document.getElementById("msg");

  const btnReset = document.getElementById("reset");
  const btnNew = document.getElementById("new");
  const btnCheck = document.getElementById("check");

  return {
    setMoves(n) { if (movesEl) movesEl.textContent = String(n); },
    setMsg(s) { if (msgEl) msgEl.textContent = s; },
    clearMsg() { if (msgEl) msgEl.textContent = ""; },

    onReset(cb) { if (btnReset) btnReset.addEventListener("click", cb); },
    onNew(cb) { if (btnNew) btnNew.addEventListener("click", cb); },
    onCheck(cb) { if (btnCheck) btnCheck.addEventListener("click", cb); },
  };
}
