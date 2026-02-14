export function makeMathEngine() {
  const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  function pickQuestion(level) {
    switch (level.type) {
      case "number_id": {
        const n = randInt(level.min, level.max);
        return { answer: n, text: `What number is this?`, key: `ID:${n}`, meta: { kind: "id", n } };
      }
      case "add": {
        const maxSum = level.maxSum ?? 10;
        const a = randInt(0, maxSum);
        const b = randInt(0, maxSum - a);
        return { answer: a + b, text: `${a} + ${b} = ?`, key: `${a}+${b}`, meta: { kind: "add", a, b } };
      }
      case "sub": {
        const maxA = level.maxA ?? 20;
        const a = randInt(0, maxA);
        const b = randInt(0, a);
        return { answer: a - b, text: `${a} − ${b} = ?`, key: `${a}-${b}`, meta: { kind: "sub", a, b } };
      }
      case "make_n": {
        const n = level.n ?? 10;
        const a = randInt(0, n);
        return { answer: n - a, text: `${n} = ${a} + ?`, key: `M${n}:${a}+?`, meta: { kind: "make", n, a } };
      }
      case "add2": {
        const regroup = !!level.regroup;
        let a1 = randInt(1, 9), a0 = randInt(0, 9);
        let b1 = randInt(1, 9), b0 = randInt(0, 9);
        if (!regroup) b0 = randInt(0, 9 - a0);
        else if (a0 + b0 < 10) b0 = randInt(10 - a0, 9);
        const A = a1 * 10 + a0;
        const B = b1 * 10 + b0;
        return { answer: A + B, text: `${A} + ${B} = ?`, key: `${A}+${B}`, meta: { kind: "add2", A, B } };
      }
      case "sub2": {
        const regroup = !!level.regroup;
        let a1 = randInt(1, 9), a0 = randInt(0, 9);
        let b1 = randInt(1, 9), b0 = randInt(0, 9);
        if (!regroup) { if (b0 > a0) b0 = randInt(0, a0); }
        else { if (b0 <= a0) b0 = randInt(a0 + 1, 9); }
        let A = a1 * 10 + a0;
        let B = b1 * 10 + b0;
        if (B > A) [A, B] = [B, A];
        return { answer: A - B, text: `${A} − ${B} = ?`, key: `${A}-${B}`, meta: { kind: "sub2", A, B } };
      }
      case "mul": {
        const facts = level.facts ?? [2,5,10];
        const a = facts[randInt(0, facts.length - 1)];
        const b = randInt(0, 10);
        return { answer: a * b, text: `${a} × ${b} = ?`, key: `${a}x${b}`, meta: { kind: "mul", a, b } };
      }
      case "div": {
        const facts = level.facts ?? [2,3,4,5,6,7,8,9,10];
        const b = facts[randInt(0, facts.length - 1)];
        const a = randInt(0, 10);
        const product = a * b;
        return { answer: a, text: `${product} ÷ ${b} = ?`, key: `${product}÷${b}`, meta: { kind: "div", product, b } };
      }
      default: {
        const a = randInt(0, 10), b = randInt(0, 10);
        return { answer: a + b, text: `${a} + ${b} = ?`, key: `${a}+${b}`, meta: { kind: "add", a, b } };
      }
    }
  }

  const clampInt = (n) => Math.max(0, Math.round(Number.isFinite(n) ? n : 0));
  const uniq = (arr) => [...new Set(arr)];

  function makeChoices3(q) {
    const correct = q.answer;
    const m = q.meta || {};
    const wrongs = [];

    // nearby + off-by-one
    wrongs.push(correct + 1, Math.max(0, correct - 1));
    wrongs.push(correct + 2, Math.max(0, correct - 2));

    // common-error patterns
    if (m.kind === "add") {
      wrongs.push(m.a, m.b);
    } else if (m.kind === "sub") {
      wrongs.push(Math.abs(m.b - m.a));
    } else if (m.kind === "make") {
      wrongs.push(m.a);
    } else if (m.kind === "add2") {
      const A = m.A, B = m.B;
      const ones = (A % 10) + (B % 10);
      const tens = Math.floor(A / 10) + Math.floor(B / 10);
      const noCarry = tens * 10 + (ones % 10);
      wrongs.push(noCarry);
    } else if (m.kind === "sub2") {
      wrongs.push(correct + 10); // borrow confusion
    } else if (m.kind === "mul") {
      wrongs.push(m.a * Math.max(0, m.b - 1));
      wrongs.push(m.a * (m.b + 1));
    } else if (m.kind === "div") {
      wrongs.push(m.b);
      wrongs.push(correct + 1);
    }

    const candidates = uniq(wrongs.map(clampInt)).filter(v => v !== correct);
    candidates.sort((x, y) => Math.abs(x - correct) - Math.abs(y - correct));

    const w1 = candidates[0] ?? (correct + 3);
    const w2 = candidates[1] ?? (correct + 5);

    const lanes = ["left", "mid", "right"];
    const correctLane = lanes[randInt(0, 2)];
    const values = { left: null, mid: null, right: null };
    values[correctLane] = correct;
    const rem = lanes.filter(l => l !== correctLane);
    values[rem[0]] = w1;
    values[rem[1]] = w2;
    return { ...values, correctLane };
  }

  function questionFromKey(key) {
    try {
      if (key.startsWith("ID:")) {
        const n = parseInt(key.slice(3), 10);
        if (Number.isFinite(n)) return { answer: n, text: `What number is this?`, key, meta: { kind: "id", n } };
      }
      if (key.startsWith("M")) {
        const m = key.match(/^M(\d+):(\d+)\+\?$/);
        if (!m) return null;
        const n = parseInt(m[1], 10);
        const a = parseInt(m[2], 10);
        return { answer: n - a, text: `${n} = ${a} + ?`, key, meta: { kind: "make", n, a } };
      }
      if (key.includes("+")) {
        const [A, B] = key.split("+").map(x => parseInt(x, 10));
        if (!Number.isFinite(A) || !Number.isFinite(B)) return null;
        return { answer: A + B, text: `${A} + ${B} = ?`, key, meta: { kind: (A >= 10 || B >= 10) ? "add2" : "add", a: A, b: B, A, B } };
      }
      if (key.includes("-") && !key.startsWith("ID:") && !key.startsWith("M")) {
        const [A, B] = key.split("-").map(x => parseInt(x, 10));
        if (!Number.isFinite(A) || !Number.isFinite(B)) return null;
        return { answer: A - B, text: `${A} − ${B} = ?`, key, meta: { kind: (A >= 10 || B >= 10) ? "sub2" : "sub", a: A, b: B, A, B } };
      }
      if (key.includes("x")) {
        const [A, B] = key.split("x").map(x => parseInt(x, 10));
        if (!Number.isFinite(A) || !Number.isFinite(B)) return null;
        return { answer: A * B, text: `${A} × ${B} = ?`, key, meta: { kind: "mul", a: A, b: B } };
      }
      if (key.includes("÷")) {
        const [P, B] = key.split("÷").map(x => parseInt(x, 10));
        if (!Number.isFinite(P) || !Number.isFinite(B) || B === 0) return null;
        return { answer: P / B, text: `${P} ÷ ${B} = ?`, key, meta: { kind: "div", product: P, b: B } };
      }
      return null;
    } catch { return null; }
  }

  function isKeyCompatibleWithLevel(level, key) {
    if (level.type === "number_id") return key.startsWith("ID:");
    if (level.type === "make_n") return key.startsWith(`M${level.n}:`);
    if (level.type === "add") return key.includes("+");
    if (level.type === "sub") return key.includes("-");
    if (level.type === "add2") return key.includes("+");
    if (level.type === "sub2") return key.includes("-");
    if (level.type === "mul") return key.includes("x");
    if (level.type === "div") return key.includes("÷");
    return false;
  }

  return { pickQuestion, makeChoices3, questionFromKey, isKeyCompatibleWithLevel };
}
