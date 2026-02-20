/* rules.js */
(() => {
  'use strict';

  function inBounds(r, c) { return r >= 0 && r < size && c >= 0 && c < size; }

  function lineCountAt(r, c, dr, dc, player) {
    let count = 1;
    let rr = r + dr, cc = c + dc;
    while (inBounds(rr, cc) && state[idx(rr, cc)] === player) { count++; rr += dr; cc += dc; }
    rr = r - dr; cc = c - dc;
    while (inBounds(rr, cc) && state[idx(rr, cc)] === player) { count++; rr -= dr; cc -= dc; }
    return count;
  }

  function isOverlineAt(r, c, player) {
    const dirs = [{dr:0, dc:1}, {dr:1, dc:0}, {dr:1, dc:1}, {dr:1, dc:-1}];
    for (const {dr, dc} of dirs) {
      if (lineCountAt(r, c, dr, dc, player) >= 6) return true;
    }
    return false;
  }

  function isExactFiveAt(r, c, player) {
    const dirs = [{dr:0, dc:1}, {dr:1, dc:0}, {dr:1, dc:1}, {dr:1, dc:-1}];
    for (const {dr, dc} of dirs) {
      if (lineCountAt(r, c, dr, dc, player) === 5) return true;
    }
    return false;
  }

  function hasFourThreat(r, c, dr, dc) {
    for (let t = -4; t <= 4; t++) {
      const rr = r + dr * t, cc = c + dc * t;
      if (inBounds(rr, cc) && state[idx(rr, cc)] === 0) {
        state[idx(rr, cc)] = 1; 
        const isFive = (lineCountAt(rr, cc, dr, dc, 1) === 5);
        state[idx(rr, cc)] = 0;
        if (isFive) return true;
      }
    }
    return false;
  }

  function countFoursAfterMove(r, c) {
    let fours = 0;
    const dirs = [{dr:0, dc:1}, {dr:1, dc:0}, {dr:1, dc:1}, {dr:1, dc:-1}];
    for (const {dr, dc} of dirs) {
      if (hasFourThreat(r, c, dr, dc)) fours++;
    }
    return fours;
  }

  function isOpenFour(r, c, dr, dc) {
    let winPoints = 0;
    for (let t = -4; t <= 4; t++) {
      const rr = r + dr * t, cc = c + dc * t;
      if (inBounds(rr, cc) && state[idx(rr, cc)] === 0) {
        state[idx(rr, cc)] = 1;
        if (lineCountAt(rr, cc, dr, dc, 1) === 5) winPoints++;
        state[idx(rr, cc)] = 0;
      }
    }
    return winPoints >= 2;
  }

  function isFreeThreeInDirection(r, c, dr, dc) {
    for (let t = -4; t <= 4; t++) {
      const rr = r + dr * t, cc = c + dc * t;
      if (!inBounds(rr, cc) || (rr === r && cc === c) || state[idx(rr, cc)] !== 0) continue;

      state[idx(rr, cc)] = 1;
      const createsOpenFour = isOpenFour(rr, cc, dr, dc);
      if (createsOpenFour) {
        const over = isOverlineAt(rr, cc, 1);
        const fours = countFoursAfterMove(rr, cc);
        state[idx(rr, cc)] = 0;
        if (!over && fours < 2) return true;
      } else {
        state[idx(rr, cc)] = 0;
      }
    }
    return false;
  }

  // Accepts 'player' parameter so AI can test restrictions while it is White's turn
  window.violatesRenju = function(r, c, player = currentPlayer) {
    if (player !== 1) return { isValid: true };

    if (isOverlineAt(r, c, 1)) return { isValid: false, reason: "Forbidden Overline (6+ stones)" };
    if (isExactFiveAt(r, c, 1)) return { isValid: true };

    const fours = countFoursAfterMove(r, c);
    
    let freeThrees = 0;
    const dirs = [{dr:0, dc:1}, {dr:1, dc:0}, {dr:1, dc:1}, {dr:1, dc:-1}];
    for (const d of dirs) { 
        if (isFreeThreeInDirection(r, c, d.dr, d.dc)) freeThrees++; 
    }

    if (fours >= 2) return { isValid: false, reason: "Forbidden 4x4 Fork" };
    if (freeThrees >= 2) return { isValid: false, reason: "Forbidden 3x3 Fork" };

    return { isValid: true };
  };
})();