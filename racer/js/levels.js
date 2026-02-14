export const LEVELS = [
  { id: "K1", name: "K1: Number ID 0–5", type: "number_id", min: 0, max: 5, targetTime: 3.0 },
  { id: "K2", name: "K2: Add within 5", type: "add", maxSum: 5, targetTime: 3.0 },
  { id: "K3", name: "K3: Make 5 (decompose)", type: "make_n", n: 5, targetTime: 3.0 },
  { id: "K4", name: "K4: Add within 10", type: "add", maxSum: 10, targetTime: 3.0 },
  { id: "K5", name: "K5: Sub within 10", type: "sub", maxA: 10, targetTime: 3.0 },

  { id: "G1-1", name: "G1: Make 10", type: "make_n", n: 10, targetTime: 2.5 },
  { id: "G1-2", name: "G1: Add within 20", type: "add", maxSum: 20, targetTime: 2.5 },
  { id: "G1-3", name: "G1: Sub within 20", type: "sub", maxA: 20, targetTime: 2.5 },

  { id: "G2-1", name: "G2: Add ≤100 (no regroup)", type: "add2", regroup: false, targetTime: 2.2 },
  { id: "G2-2", name: "G2: Add ≤100 (with regroup)", type: "add2", regroup: true, targetTime: 2.2 },
  { id: "G2-3", name: "G2: Sub ≤100 (no regroup)", type: "sub2", regroup: false, targetTime: 2.2 },
  { id: "G2-4", name: "G2: Sub ≤100 (with regroup)", type: "sub2", regroup: true, targetTime: 2.2 },

  { id: "G3-1", name: "G3: × facts (2,5,10)", type: "mul", facts: [2,5,10], targetTime: 2.0 },
  { id: "G3-2", name: "G3: × facts (3,4,6)", type: "mul", facts: [3,4,6], targetTime: 2.0 },
  { id: "G3-3", name: "G3: × facts (7,8,9)", type: "mul", facts: [7,8,9], targetTime: 2.0 },
  { id: "G3-4", name: "G3: ÷ inverse facts", type: "div", facts: [2,3,4,5,6,7,8,9,10], targetTime: 2.0 },
];

export function getLevelIndexById(id) {
  const idx = LEVELS.findIndex(l => l.id === id);
  return Math.max(0, idx);
}
