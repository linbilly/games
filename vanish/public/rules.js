/* rules.js */
(() => {
  'use strict';

  function inBounds(r, c) { return r >= 0 && r < size && c >= 0 && c < size; }

  // Now accepts a specific board array 'b' to protect global state
  function lineCountAt(r, c, dr, dc, player, b) {
    let count = 1;
    let rr = r + dr, cc = c + dc;
    while (inBounds(rr, cc) && b[idx(rr, cc)] === player) { count++; rr += dr; cc += dc; }
    rr = r - dr; cc = c - dc;
    while (inBounds(rr, cc) && b[idx(rr, cc)] === player) { count++; rr -= dr; cc -= dc; }
    return count;
  }

  function isOverlineAt(r, c, player, b) {
    const dirs = [{dr:0, dc:1}, {dr:1, dc:0}, {dr:1, dc:1}, {dr:1, dc:-1}];
    for (const {dr, dc} of dirs) {
      if (lineCountAt(r, c, dr, dc, player, b) >= 6) return true;
    }
    return false;
  }

  function isExactFiveAt(r, c, player, b) {
    const dirs = [{dr:0, dc:1}, {dr:1, dc:0}, {dr:1, dc:1}, {dr:1, dc:-1}];
    for (const {dr, dc} of dirs) {
      if (lineCountAt(r, c, dr, dc, player, b) === 5) return true;
    }
    return false;
  }

  function hasFourThreat(r, c, dr, dc, b) {
    for (let t = -4; t <= 4; t++) {
      const rr = r + dr * t, cc = c + dc * t;
      if (inBounds(rr, cc) && b[idx(rr, cc)] === 0) {
        b[idx(rr, cc)] = 1; 
        const isFive = (lineCountAt(rr, cc, dr, dc, 1, b) === 5);
        b[idx(rr, cc)] = 0;
        if (isFive) return true;
      }
    }
    return false;
  }

  function countFoursAfterMove(r, c, b) {
    let fours = 0;
    const dirs = [{dr:0, dc:1}, {dr:1, dc:0}, {dr:1, dc:1}, {dr:1, dc:-1}];
    for (const {dr, dc} of dirs) {
      if (hasFourThreat(r, c, dr, dc, b)) fours++;
    }
    return fours;
  }

  function isOpenFour(r, c, dr, dc, b) {
    let winPoints = 0;
    for (let t = -4; t <= 4; t++) {
      const rr = r + dr * t, cc = c + dc * t;
      if (inBounds(rr, cc) && b[idx(rr, cc)] === 0) {
        b[idx(rr, cc)] = 1;
        if (lineCountAt(rr, cc, dr, dc, 1, b) === 5) winPoints++;
        b[idx(rr, cc)] = 0;
      }
    }
    return winPoints >= 2;
  }

  function isFreeThreeInDirection(r, c, dr, dc, b) {
    for (let t = -4; t <= 4; t++) {
      const rr = r + dr * t, cc = c + dc * t;
      if (!inBounds(rr, cc) || (rr === r && cc === c) || b[idx(rr, cc)] !== 0) continue;

      b[idx(rr, cc)] = 1;
      const createsOpenFour = isOpenFour(rr, cc, dr, dc, b);
      if (createsOpenFour) {
        const over = isOverlineAt(rr, cc, 1, b);
        const fours = countFoursAfterMove(rr, cc, b);
        b[idx(rr, cc)] = 0;
        if (!over && fours < 2) return true;
      } else {
        b[idx(rr, cc)] = 0;
      }
    }
    return false;
  }

  // Pass 'b' down to enforce safe simulation
  window.violatesRenju = function(r, c, player = currentPlayer, b = state) {
    if (player !== 1) return { isValid: true };

    if (isOverlineAt(r, c, 1, b)) return { isValid: false, reason: "Forbidden Overline (6+ stones)" };
    if (isExactFiveAt(r, c, 1, b)) return { isValid: true };

    const fours = countFoursAfterMove(r, c, b);
    
    let freeThrees = 0;
    const dirs = [{dr:0, dc:1}, {dr:1, dc:0}, {dr:1, dc:1}, {dr:1, dc:-1}];
    for (const d of dirs) { 
        if (isFreeThreeInDirection(r, c, d.dr, d.dc, b)) freeThrees++; 
    }

    if (fours >= 2) return { isValid: false, reason: "Forbidden 4x4 Fork" };
    if (freeThrees >= 2) return { isValid: false, reason: "Forbidden 3x3 Fork" };

    return { isValid: true };
  };
})();