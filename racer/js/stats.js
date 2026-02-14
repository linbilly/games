const STORAGE_KEY = "mathRacerStats_v2";

export function loadStats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { facts: {}, total: { correct: 0, wrong: 0 } };
    const parsed = JSON.parse(raw);
    if (!parsed.facts) parsed.facts = {};
    if (!parsed.total) parsed.total = { correct: 0, wrong: 0 };
    return parsed;
  } catch {
    return { facts: {}, total: { correct: 0, wrong: 0 } };
  }
}

export function saveStats(stats) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
}

export function resetStats() {
  localStorage.removeItem(STORAGE_KEY);
}

export function recordAttempt(stats, factKey, isCorrect) {
  if (!stats.facts[factKey]) stats.facts[factKey] = { correct: 0, wrong: 0, lastTs: 0 };
  const f = stats.facts[factKey];
  if (isCorrect) { f.correct += 1; stats.total.correct += 1; }
  else { f.wrong += 1; stats.total.wrong += 1; }
  f.lastTs = Date.now();
}

export function computeWeakFacts(stats, limit = 12) {
  const rows = Object.entries(stats.facts).map(([key, v]) => {
    const attempts = v.correct + v.wrong;
    const acc = attempts === 0 ? 1 : v.correct / attempts;
    return { key, ...v, attempts, acc };
  });

  rows.sort((a, b) => {
    if (a.acc !== b.acc) return a.acc - b.acc;
    if (a.attempts !== b.attempts) return b.attempts - a.attempts;
    return b.lastTs - a.lastTs;
  });

  return rows.slice(0, limit);
}

export function getWeakKeys(stats, limit = 25) {
  return computeWeakFacts(stats, limit).map(r => r.key);
}

export function formatFactKey(key) {
  return key.replace("+", " + ").replace("-", " − ");
}
