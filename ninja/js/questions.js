// Question generation + adaptive weighting
// Modes: add10, add20, sub20, mixed

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

export function makeQuestion(mode){
  // returns { a, b, op, answer, text, key }
  let a, b, op, ans;

  function add(maxSum){
    a = randInt(0, maxSum);
    b = randInt(0, maxSum - a);
    op = '+';
    ans = a + b;
  }

  function sub(maxVal){
    a = randInt(0, maxVal);
    b = randInt(0, a); // ensure non-negative
    op = '−';
    ans = a - b;
  }

  if(mode === 'add10') add(10);
  else if(mode === 'add20') add(20);
  else if(mode === 'sub20') sub(20);
  else { // mixed
    if(Math.random() < 0.5) add(20); else sub(20);
  }

  const text = `${a} ${op} ${b}`;
  const key = `${mode}:${a}${op}${b}`;

  return { a, b, op, answer: ans, text, key };
}

export function makeChoices(correct, opts){
  // opts: { min, max, count, avoid }
  const count = opts?.count ?? 4;
  const min = opts?.min ?? 0;
  const max = opts?.max ?? 20;

  const set = new Set([correct]);
  // generate distractors close-ish to correct
  while(set.size < count){
    const spread = Math.random() < 0.75 ? 3 : 7;
    const delta = randInt(-spread, spread);
    let v = correct + delta;
    if(Math.random() < 0.18) v = correct + randInt(-10, 10);
    v = clamp(v, min, max);
    if(v === correct) continue;
    set.add(v);
  }
  const arr = Array.from(set);
  shuffle(arr);
  return arr;
}

export function makeHint(q){
  // short, kid-friendly hints (not every time)
  const { a, b, op, answer } = q;
  if(op === '+'){
    // make 10 / doubles / near doubles
    if(a === b) return `Doubles! <strong>${a}+${a}=${answer}</strong>`;
    if(Math.abs(a-b) === 1){
      const d = Math.min(a,b);
      return `Near doubles: <strong>${d}+${d}</strong> then +1`;
    }
    if(a === 9 || b === 9){
      const other = a === 9 ? b : a;
      return `Make 10: <strong>9+${other}=(10+${other-1})</strong>`;
    }
    if(a === 8 || b === 8){
      const other = a === 8 ? b : a;
      if(other >= 2) return `Make 10: <strong>8+${other}=(10+${other-2})</strong>`;
    }
    return `Look for <strong>make 10</strong> or <strong>doubles</strong>.`;
  }else{
    // subtraction: count up / make 10
    if(a >= 10 && b <= 10 && b !== 0){
      const to10 = Math.max(0, 10 - b);
      if(to10 > 0 && a > 10){
        const rest = a - 10;
        return `Count up: <strong>${b}→10 (+${to10})</strong>, then <strong>10→${a} (+${rest})</strong>`;
      }
    }
    if(b === 9) return `Try: <strong>−9 is like −10 then +1</strong>.`;
    if(b === 8) return `Try: <strong>−8 is like −10 then +2</strong>.`;
    return `Try <strong>counting up</strong> (jump to 10, then to ${a}).`;
  }
}

export function normalizeWeights(map){
  // map key->weight
  let total = 0;
  for(const w of map.values()) total += w;
  if(total <= 0) return;
  for(const [k,w] of map.entries()) map.set(k, w/total);
}

export function weightedPick(items, weights){
  // items: array, weights: array same length; returns index
  let sum = 0;
  for(const w of weights) sum += w;
  if(sum <= 0) return Math.floor(Math.random()*items.length);
  let r = Math.random()*sum;
  for(let i=0;i<items.length;i++){
    r -= weights[i];
    if(r <= 0) return i;
  }
  return items.length-1;
}

export function randInt(a,b){
  return Math.floor(Math.random()*(b-a+1))+a;
}
export function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]] = [arr[j],arr[i]];
  }
}
