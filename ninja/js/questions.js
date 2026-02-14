// Modes: add10, add20, sub20, mixed, add100nr, sub100nr, add100r1, add100r2, sub100r1, sub100r2

export function randInt(min, max){
  return Math.floor(Math.random()*(max-min+1)) + min;
}

export function weightedPick(items, weights){
  const total = weights.reduce((a,b)=>a+b,0);
  let r = Math.random()*total;
  for(let i=0;i<items.length;i++){
    r -= weights[i];
    if(r <= 0) return i;
  }
  return items.length-1;
}

export function makeQuestion(mode){
  let a,b,op,ans;

  function addMaxSum(maxSum){
    a = randInt(0, maxSum);
    b = randInt(0, maxSum - a);
    op = '+';
    ans = a + b;
  }

  function subMaxVal(maxVal){
    a = randInt(0, maxVal);
    b = randInt(0, a);
    op = '−';
    ans = a - b;
  }

  function add2dNoRegroup(){
    a = randInt(10, 99);
    const aO = a % 10;
    const bOMax = 9 - aO;
    let bT = randInt(1, 9);
    const bO = randInt(0, bOMax);
    b = bT*10 + bO;
    if(a+b>100){
      const over = (a+b)-100;
      const reduce = Math.ceil(over/10);
      bT = Math.max(0, bT - reduce);
      b = bT*10 + bO;
    }
    op = '+'; ans = a+b;
  }

  function sub2dNoRegroup(){
    a = randInt(10, 99);
    const aO = a % 10;
    const aT = Math.floor(a/10);
    const bO = randInt(0, aO);
    const bT = randInt(0, aT);
    b = bT*10 + bO;
    op = '−'; ans = a-b;
  }

  function add2dPlus1dRegroup(){
    a = randInt(10, 99);
    const aO = a % 10;
    b = randInt(Math.max(2, 10-aO), 9);
    op = '+'; ans = a+b;
    if(ans>100){
      a = randInt(10, 90);
      const ao = a%10;
      b = randInt(Math.max(2, 10-ao), 9);
      ans = a+b;
    }
  }

  function add2dPlus2dRegroup(){
    a = randInt(10, 99);
    const aO = a % 10;
    const bOMin = Math.max(0, 10-aO);
    const bO = randInt(bOMin, 9);
    let bT = randInt(1, 9);
    b = bT*10 + bO;
    op='+'; ans = a+b;
    if(ans>100){
      const over = ans-100;
      const reduce = Math.ceil(over/10);
      bT = Math.max(0, bT-reduce);
      b = bT*10 + bO;
      ans = a+b;
    }
    if((a%10)+(b%10) < 10){
      const bump = 10 - ((a%10)+(b%10));
      b = Math.min(99, b + bump);
      ans = a+b;
    }
  }

  function sub2dMinus1dRegroup(){
    a = randInt(10, 99);
    const aO = a % 10;
    b = randInt(Math.max(2, aO+1), 9);
    op='−'; ans = a-b;
    if(ans < 0){
      a = randInt(20, 99);
      const ao=a%10;
      b = randInt(Math.max(2, ao+1), 9);
      ans = a-b;
    }
  }

  function sub2dMinus2dRegroup(){
    // ensure regroup in ones place (a ones < b ones), and a >= b, result >= 0
    a = randInt(20, 99);
    const aO = a % 10;
    const aT = Math.floor(a/10);

    // choose b ones larger than a ones to force borrowing
    const bO = randInt(Math.min(9, aO+1), 9);

    // choose b tens <= a tens -1 to keep b <= a after borrowing
    const bTmax = Math.max(0, aT-1);
    const bT = randInt(0, bTmax);

    b = bT*10 + bO;
    op = '−';
    ans = a - b;

    // safety: if went negative, retry a few times
    let tries=0;
    while(ans < 0 && tries < 20){
      a = randInt(20, 99);
      const ao = a % 10;
      const at = Math.floor(a/10);
      const bo = randInt(Math.min(9, ao+1), 9);
      const bt = randInt(0, Math.max(0, at-1));
      b = bt*10 + bo;
      ans = a-b;
      tries++;
    }
  }


  if(mode==='add10') addMaxSum(10);
  else if(mode==='add20') addMaxSum(20);
  else if(mode==='sub20') subMaxVal(20);
  else if(mode==='mixed'){ (Math.random()<0.5) ? addMaxSum(20) : subMaxVal(20); }
  else if(mode==='add100nr') add2dNoRegroup();
  else if(mode==='sub100nr') sub2dNoRegroup();
  else if(mode==='add100r1') add2dPlus1dRegroup();
  else if(mode==='add100r2') add2dPlus2dRegroup();
  else if(mode==='sub100r1') sub2dMinus1dRegroup();
  else if(mode==='sub100r2') sub2dMinus2dRegroup();
  else addMaxSum(20);

  const text = `${a} ${op} ${b}`;
  const key = `${mode}:${a}${op}${b}`;
  return { a,b,op,answer:ans,text,key };
}

export function makeChoices(answer, {min=0, max=20, count=4} = {}){
  const set = new Set([answer]);
  while(set.size < count){
    const r = randInt(min, max);
    set.add(r);
  }
  const arr = Array.from(set);
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
  return arr;
}

export function makeHint(q){
  const {a,b,op} = q;
  if(a>=10 || b>=10){
    const aT=Math.floor(a/10), aO=a%10;
    const bT=Math.floor(b/10), bO=b%10;
    if(op==='+'){
      if(aO+bO>=10) return `Regroup! Ones: <strong>${aO}+${bO}=${aO+bO}</strong> → make a ten.`;
      return `Split: <strong>${aT} tens</strong> + <strong>${aO} ones</strong>.`;
    }else{
      if(aO<bO) return `Borrow: trade 1 ten for <strong>10 ones</strong>.`;
      return `Subtract tens, then ones.`;
    }
  }
  if(op==='+'){
    if(a===b) return 'Doubles!';
    if(a+b===10) return 'Make 10!';
    return 'Count on from the bigger number.';
  }
  return 'Count up: from the smaller to the bigger.';
}
