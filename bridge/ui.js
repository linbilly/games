export function createUI() {
  const movesEl = document.getElementById("moves");
  const msgEl = document.getElementById("msg");

  return {
    setMoves(n) { movesEl.textContent = String(n); },
    setMsg(s) { msgEl.textContent = s; },
    clearMsg() { msgEl.textContent = ""; },
    onReset(cb) { document.getElementById("reset").addEventListener("click", cb); },
    onNew(cb) { document.getElementById("new").addEventListener("click", cb); },
    onCheck(cb) { document.getElementById("check").addEventListener("click", cb); },
  };
}
