import { LEVELS } from "./levels.js";

export function makeDifficultyManager() {
  const WINDOW = 10;
  let history = [];
  let confidence = 0;

  function resetSession() { history = []; confidence = 0; }

  function pushResult({ correct, timeSec }) {
    history.push({ correct, time: timeSec });
    if (history.length > WINDOW) history.shift();
  }

  function stats() {
    const n = history.length;
    if (n === 0) return { n: 0, accuracy: 0, avgTime: 999 };
    const correct = history.filter(h => h.correct).length;
    const accuracy = correct / n;
    const avgTime = history.reduce((a,b) => a + b.time, 0) / n;
    return { n, accuracy, avgTime };
  }

  function shouldLevelUp(level) {
    const s = stats();
    if (s.n < WINDOW) return false;
    return (s.accuracy >= 0.90 && s.avgTime <= level.targetTime);
  }

  function shouldLevelDown() {
    const s = stats();
    if (s.n < WINDOW) return false;
    if (s.accuracy <= 0.65) return true;
    const last3 = history.slice(-3);
    if (last3.length === 3 && last3.every(x => !x.correct)) return true;
    return false;
  }

  function maybeAdjustLevel({ levelIndex }) {
    const level = LEVELS[levelIndex];

    if (shouldLevelUp(level)) {
      confidence += 1;
      if (confidence >= 2 && levelIndex < LEVELS.length - 1) {
        confidence = 0;
        return { newIndex: levelIndex + 1, reason: "up" };
      }
      return { newIndex: levelIndex, reason: null };
    }

    if (shouldLevelDown()) {
      confidence -= 1;
      if (confidence <= -2 && levelIndex > 0) {
        confidence = 0;
        return { newIndex: levelIndex - 1, reason: "down" };
      }
      return { newIndex: levelIndex, reason: null };
    }

    if (confidence > 0) confidence -= 0.25;
    if (confidence < 0) confidence += 0.25;
    confidence = Math.max(-2, Math.min(2, confidence));
    return { newIndex: levelIndex, reason: null };
  }

  return { resetSession, pushResult, stats, maybeAdjustLevel };
}
