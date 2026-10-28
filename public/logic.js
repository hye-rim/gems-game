'use strict';

// 보석 상인: 규칙과 컴퓨터만 모아 둔 파일 (그리기·입력 없음). 브라우저·서버·테스트(Node)가 같이 쓴다.
//
// - 보석 5가지(루비·사파이어·에메랄드·다이아·오닉스)와 만능 황금. 2명이 번갈아 한다 (먼저 하는 쪽이 0번)
// - 한 차례에 **하나만**: ① 다른 색 보석 3개 가져오기 ② 같은 색 보석 2개 가져오기(더미에 4개 이상일 때)
//   ③ 카드 한 장 찜하기(황금 1개를 덤으로, 찜은 3장까지) ④ 카드 한 장 사기(보이는 카드 또는 찜한 카드)
// - 산 카드는 영원히 쓰는 보석(할인) 하나를 준다. 카드 값에서 내 할인만큼 빼고 낸다. 모자란 만큼은 황금으로 채운다
// - 보석은 10개까지만 들고 있는다 (넘으면 버린다)
// - 차례를 마쳤을 때 내 카드 할인이 귀족의 조건을 채우면 귀족이 찾아온다(3점). 둘 이상이면 하나를 고른다
// - 누가 15점에 닿으면 그 라운드를 마저 하고(두 사람이 같은 횟수) 끝낸다. 점수가 높은 쪽 승, 같으면 산 카드가 적은 쪽 승
// - 카드 90장은 이 게임에서 만든 것이다 (아래 buildCards, 고정 난수라 브라우저·서버가 똑같다)
const LOGIC_GEMS = (() => {
const COLORS = 5, GOLD = 5, HAND_MAX = 10, WIN_POINTS = 15, MAX_PLIES = 120, MARKET = 4, RESERVE_MAX = 3;
const NAMES = ['루비', '사파이어', '에메랄드', '다이아', '오닉스', '황금'];
const LEVEL_COUNT = [40, 30, 20];

function rng(seed) {                   // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- 카드 ----------
// 단계마다 색깔별 같은 장수(8·6·4장). 점수와 값이 클수록 비싸다. 값에는 자기 색 보석을 거의 안 쓴다
const LEVEL_POINTS = [[0, 0, 0, 0, 0, 0, 0, 1], [1, 1, 2, 2, 2, 3], [3, 4, 4, 5]];
const COST_BASE = [3, 4, 6], COST_JIT = [3, 3, 3], COST_PER_POINT = [1, 1, 1], MAX_EACH = [3, 5, 7], KINDS = [[2, 3], [2, 3], [2, 4]];
function buildCards() {
  const cards = [];
  for (let level = 0; level < 3; level++) {
    const rand = rng(777 + level * 31);
    for (let b = 0; b < COLORS; b++) {
      for (const pts of LEVEL_POINTS[level]) {
        const total = COST_BASE[level] + pts * COST_PER_POINT[level] + Math.floor(rand() * COST_JIT[level]);
        const others = shuffle([0, 1, 2, 3, 4].filter((c) => c !== b), rand);
        const k = Math.min(others.length, KINDS[level][0] + Math.floor(rand() * (KINDS[level][1] - KINDS[level][0] + 1)));
        const use = others.slice(0, k), cost = [0, 0, 0, 0, 0];
        use.forEach((c) => { cost[c] = 1; });
        for (let left = total - k; left > 0;) {            // 남은 만큼 가진 색에 고르게 얹는다 (한 색 최대 MAX_EACH)
          const c = use[Math.floor(rand() * use.length)];
          if (cost[c] < MAX_EACH[level]) { cost[c]++; left--; } else if (use.every((u) => cost[u] >= MAX_EACH[level])) break;
        }
        cards.push({ level, bonus: b, pts, cost });
      }
    }
  }
  cards.forEach((c, i) => { c.id = i; });
  return cards;
}
const CARDS = buildCards();
const byLevel = (level) => CARDS.filter((c) => c.level === level).map((c) => c.id);

// ---------- 귀족 ----------
// 4+4 짜리 다섯, 3+3+3 짜리 다섯. 모두 3점
const NOBLES = (() => {
  const out = [];
  for (let i = 0; i < 5; i++) out.push({ id: out.length, pts: 3, need: [0, 0, 0, 0, 0].map((_, c) => (c === i || c === (i + 1) % 5 ? 4 : 0)) });
  for (let i = 0; i < 5; i++) out.push({ id: out.length, pts: 3, need: [0, 0, 0, 0, 0].map((_, c) => ([i, (i + 1) % 5, (i + 2) % 5].includes(c) ? 3 : 0)) });
  return out;
})();

// ---------- 판 ----------
function newGame(rand = Math.random) {
  const decks = [0, 1, 2].map((l) => shuffle(byLevel(l), rand));
  const market = decks.map((d) => { const row = []; for (let i = 0; i < MARKET; i++) row.push(d.pop()); return row; });
  return {
    decks, market,
    bank: [4, 4, 4, 4, 4], gold: 5,
    nobles: shuffle(NOBLES.map((n) => n.id), rand).slice(0, 3),
    players: [0, 1].map(() => ({ tokens: [0, 0, 0, 0, 0], gold: 0, cards: [], reserved: [], nobles: [] })),
    turn: 0, phase: 'turn', pending: [],
    final: false, plies: 0, winner: -1, over: false,
    last: null,                  // 방금 한 일: { who, type, ... } (화면이 알려 주는 용도)
  };
}
const clone = (st) => JSON.parse(JSON.stringify(st));

const bonusOf = (p) => { const b = [0, 0, 0, 0, 0]; for (const id of p.cards) b[CARDS[id].bonus]++; return b; };
const pointsOf = (p) => p.cards.reduce((s, id) => s + CARDS[id].pts, 0) + p.nobles.reduce((s, id) => s + NOBLES[id].pts, 0);
const heldOf = (p) => p.tokens.reduce((s, n) => s + n, 0) + p.gold;

// 카드를 살 때 내야 할 것: { pay: 색별 보석, gold } 또는 못 사면 null
function payment(p, cardId) {
  const card = CARDS[cardId], bonus = bonusOf(p);
  const pay = [0, 0, 0, 0, 0];
  let lack = 0;
  for (let c = 0; c < COLORS; c++) {
    const need = Math.max(0, card.cost[c] - bonus[c]);
    pay[c] = Math.min(need, p.tokens[c]);
    lack += need - pay[c];
  }
  return lack <= p.gold ? { pay, gold: lack } : null;
}

// 지금 할 수 있는 동작 모두. { type, ... }
function legal(st) {
  if (st.over) return [];
  const p = st.players[st.turn], out = [];
  if (st.phase === 'noble') return st.pending.map((id) => ({ type: 'noble', id }));
  if (st.phase === 'return') {
    for (let c = 0; c < COLORS; c++) if (p.tokens[c] > 0) out.push({ type: 'return', color: c });
    if (p.gold > 0) out.push({ type: 'return', color: GOLD });
    return out;
  }
  // 보석 가져오기: 가져올 수 있는 색이 3가지 미만이면 있는 만큼만
  const avail = [0, 1, 2, 3, 4].filter((c) => st.bank[c] > 0);
  const k = Math.min(3, avail.length);
  if (k === 3) {
    for (let a = 0; a < avail.length; a++) for (let b = a + 1; b < avail.length; b++) for (let c = b + 1; c < avail.length; c++) out.push({ type: 'take', colors: [avail[a], avail[b], avail[c]] });
  } else if (k > 0) out.push({ type: 'take', colors: avail.slice() });
  for (let c = 0; c < COLORS; c++) if (st.bank[c] >= 4) out.push({ type: 'take2', color: c });
  // 찜하기
  if (p.reserved.length < RESERVE_MAX) {
    for (let l = 0; l < 3; l++) {
      st.market[l].forEach((id, i) => { if (id !== null) out.push({ type: 'reserve', level: l, index: i }); });
      if (st.decks[l].length) out.push({ type: 'reserve', level: l, index: -1 });
    }
  }
  // 사기
  for (let l = 0; l < 3; l++) st.market[l].forEach((id, i) => { if (id !== null && payment(p, id)) out.push({ type: 'buy', level: l, index: i }); });
  p.reserved.forEach((r, i) => { if (payment(p, r.id)) out.push({ type: 'buyReserved', index: i }); });
  if (!out.length) out.push({ type: 'pass' });
  return out;
}

const same = (a, b) => a.type === b.type && a.level === b.level && a.index === b.index && a.color === b.color && a.id === b.id &&
  (a.colors ? !!b.colors && a.colors.length === b.colors.length && a.colors.every((c) => b.colors.includes(c)) : !b.colors);

// 동작을 적용한다. 규칙에 어긋나면 null (상태는 그대로), 되면 st.last 에 일어난 일을 적고 그것을 돌려준다
function apply(st, action) {
  if (!action || typeof action !== 'object') return null;
  const act = legal(st).find((a) => same(a, action));
  if (!act) return null;
  const who = st.turn, p = st.players[who];
  let ev = { who, type: act.type };
  if (act.type === 'take') {
    act.colors.forEach((c) => { st.bank[c]--; p.tokens[c]++; });
    ev.colors = act.colors.slice();
  } else if (act.type === 'take2') {
    st.bank[act.color] -= 2; p.tokens[act.color] += 2;
    ev.colors = [act.color, act.color];
  } else if (act.type === 'reserve') {
    let id, open = true;
    if (act.index >= 0) { id = st.market[act.level][act.index]; refill(st, act.level, act.index); }
    else { id = st.decks[act.level].pop(); open = false; }
    p.reserved.push({ id, open });
    const gold = st.gold > 0;
    if (gold) { st.gold--; p.gold++; }
    ev = { who, type: 'reserve', id, open, level: act.level, gold };
  } else if (act.type === 'buy' || act.type === 'buyReserved') {
    let id;
    if (act.type === 'buy') id = st.market[act.level][act.index];
    else id = p.reserved[act.index].id;
    const pay = payment(p, id);
    pay.pay.forEach((n, c) => { p.tokens[c] -= n; st.bank[c] += n; });
    p.gold -= pay.gold; st.gold += pay.gold;
    if (act.type === 'buy') refill(st, act.level, act.index); else p.reserved.splice(act.index, 1);
    p.cards.push(id);
    ev = { who, type: 'buy', id, from: act.type === 'buy' ? 'market' : 'reserved', level: CARDS[id].level, pay: pay.pay, gold: pay.gold };
  } else if (act.type === 'return') {
    if (act.color === GOLD) { p.gold--; st.gold++; } else { p.tokens[act.color]--; st.bank[act.color]++; }
    ev = { who, type: 'return', color: act.color };
    st.last = ev;
    if (heldOf(p) <= HAND_MAX) finishTurn(st);
    return ev;
  } else if (act.type === 'noble') {
    takeNoble(st, p, act.id);
    ev = { who, type: 'noble', id: act.id };
    st.last = ev;
    endOfTurn(st);
    return ev;
  }
  // 'pass'
  st.last = ev;
  if (heldOf(p) > HAND_MAX) { st.phase = 'return'; return ev; }
  finishTurn(st);
  return ev;
}

function refill(st, level, i) {
  st.market[level][i] = st.decks[level].length ? st.decks[level].pop() : null;
}
function takeNoble(st, p, id) {
  st.nobles = st.nobles.filter((n) => n !== id);
  p.nobles.push(id);
  st.phase = 'turn'; st.pending = [];
}
// 보석을 다 줄였으면 귀족 확인으로
function finishTurn(st) {
  const p = st.players[st.turn], bonus = bonusOf(p);
  const ok = st.nobles.filter((id) => NOBLES[id].need.every((n, c) => bonus[c] >= n));
  if (ok.length === 1) { takeNoble(st, p, ok[0]); st.last = Object.assign({}, st.last, { noble: ok[0] }); endOfTurn(st); }
  else if (ok.length > 1) { st.phase = 'noble'; st.pending = ok; }
  else endOfTurn(st);
}
function endOfTurn(st) {
  const p = st.players[st.turn];
  st.phase = 'turn';
  st.plies++;
  if (pointsOf(p) >= WIN_POINTS) st.final = true;
  if ((st.final && st.turn === 1) || st.plies >= MAX_PLIES) {
    st.over = true;
    st.winner = decide(st);
    return;
  }
  st.turn = 1 - st.turn;
}
function decide(st) {
  const a = pointsOf(st.players[0]), b = pointsOf(st.players[1]);
  if (a !== b) return a > b ? 0 : 1;
  const ca = st.players[0].cards.length, cb = st.players[1].cards.length;
  if (ca !== cb) return ca < cb ? 0 : 1;
  return 2;
}

// ---------- 컴퓨터 ----------
const HARD_SLIP = 0.2;       // 어려움이 다섯 번에 한 번은 쉬움처럼 둔다 (사람이 이길 만하게)
const cardOf = (id) => CARDS[id];

// 카드 하나를 살 수 있을 때까지 더 모아야 할 보석 수 (황금 포함해서 센다)
function remaining(p, bonus, id) {
  const card = CARDS[id];
  let lack = 0;
  for (let c = 0; c < COLORS; c++) lack += Math.max(0, card.cost[c] - bonus[c] - p.tokens[c]);
  return Math.max(0, lack - p.gold);
}
// 겨냥할 만한 카드(보이는 카드 + 내가 찜한 카드)
function targets(st, p) {
  const ids = [];
  for (let l = 0; l < 3; l++) for (const id of st.market[l]) if (id !== null) ids.push(id);
  for (const r of p.reserved) ids.push(r.id);
  return ids;
}
// 카드를 얼마나 갖고 싶은가: 점수가 크고 가까울수록
function want(st, p, bonus, id) {
  const card = CARDS[id], r = remaining(p, bonus, id);
  return (card.pts * 2 + 1.2) / Math.pow(r + 1, 1.35);
}
// 귀족에 얼마나 가까워졌나 (할인 하나가 늘면 얼마나 이득인지)
function nobleGain(st, p, color) {
  const bonus = bonusOf(p);
  let g = 0;
  for (const id of st.nobles) {
    const need = NOBLES[id].need[color];
    if (need > bonus[color]) g += 0.5 + (bonus[color] + 1) / need;
  }
  return g;
}
function easyPick(st, rand) {
  const acts = legal(st);
  if (st.phase !== 'turn') {                                   // 버리기·귀족 고르기는 아무거나
    return acts[Math.floor(rand() * acts.length)];
  }
  const buys = acts.filter((a) => a.type === 'buy' || a.type === 'buyReserved');
  if (buys.length && rand() < 0.75) return buys[Math.floor(rand() * buys.length)];
  const takes = acts.filter((a) => a.type === 'take' || a.type === 'take2');
  if (takes.length && rand() < 0.85) return takes[Math.floor(rand() * takes.length)];
  return acts[Math.floor(rand() * acts.length)];
}
// 겨냥한 카드들을 얼마나 갖고 싶은 순서대로 늘어놓고, 첫째에 가장 크게 건다 (이것저것 찔끔 모으지 않게)
const RANK_W = [1, 0.35, 0.12];
function potential(st, p, bonus, exclude) {
  const ws = targets(st, p).filter((id) => id !== exclude).map((id) => want(st, p, bonus, id)).sort((a, b) => b - a);
  return RANK_W.reduce((s, w, i) => s + w * (ws[i] || 0), 0);
}
function hardPick(st, rand) {
  const who = st.turn, p = st.players[who], q = st.players[1 - who];
  const acts = legal(st);
  if (acts.length === 1) return acts[0];
  const bonus = bonusOf(p), qBonus = bonusOf(q);
  const myPts = pointsOf(p), opPts = pointsOf(q);
  if (st.phase === 'noble') return acts.slice().sort((a, b) => NOBLES[b.id].need.reduce((s, n) => s + n, 0) - NOBLES[a.id].need.reduce((s, n) => s + n, 0))[0];
  const base = potential(st, p, bonus);
  let best = null, bestV = -Infinity;
  const total = heldOf(p);
  for (const a of acts) {
    let v = 0;
    if (a.type === 'return') {
      // 가장 덜 쓸모 있는 보석부터 버린다 (황금은 마지막)
      if (a.color === GOLD) v = -50;
      else {
        const hold = p.tokens.slice(); hold[a.color]--;
        v = potential(st, Object.assign({}, p, { tokens: hold }), bonus) - base;
      }
    } else if (a.type === 'buy' || a.type === 'buyReserved') {
      const id = a.type === 'buy' ? st.market[a.level][a.index] : p.reserved[a.index].id;
      const card = CARDS[id], pay = payment(p, id);
      const newBonus = bonus.slice(); newBonus[card.bonus]++;
      const pp = Object.assign({}, p, { tokens: p.tokens.map((n, c) => n - pay.pay[c]), gold: p.gold - pay.gold });
      const gain = potential(st, pp, newBonus, id) - potential(st, p, bonus, id);
      v = 30 + card.pts * 14 + nobleGain(st, p, card.bonus) * 6 + gain * 5 - pay.gold * 1.5;
      if (myPts + card.pts >= WIN_POINTS) v += 1000;
      if (opPts >= 11 && card.pts > 0) v += card.pts * 4;
    } else if (a.type === 'take' || a.type === 'take2') {
      const cols = a.colors || [a.color, a.color];
      const t2 = p.tokens.slice();
      for (const c of cols) t2[c]++;
      const over = Math.max(0, total + cols.length - HAND_MAX);
      v = (potential(st, Object.assign({}, p, { tokens: t2 }), bonus) - base) * 12 - over * 2.2 + (cols.length >= 2 ? 1 : -3);
    } else if (a.type === 'reserve') {
      const id = a.index >= 0 ? st.market[a.level][a.index] : null;
      v = -4 + (st.gold > 0 && total < HAND_MAX ? 3.5 : -2);
      if (id !== null) {
        const card = CARDS[id], rem = remaining(p, bonus, id);
        if (card.pts >= 3 && rem <= 3) v += 6 + card.pts;
        if (payment(q, id) && card.pts >= 2) v += 5 + card.pts;     // 상대가 곧바로 살 비싼 카드를 가로챈다
      }
      if (p.reserved.length >= 2) v -= 5;
    } else v = -99;               // 'pass'
    v += rand() * 0.02;
    if (v > bestV) { bestV = v; best = a; }
  }
  return best;
}
function aiPick(st, level, rand = Math.random) {
  if (level === 'hard' && rand() >= HARD_SLIP) return hardPick(st, rand);
  if (level === 'hard1') return hardPick(st, rand);
  return easyPick(st, rand);
}

return { COLORS, GOLD, HAND_MAX, WIN_POINTS, MAX_PLIES, MARKET, RESERVE_MAX, NAMES, LEVEL_COUNT, HARD_SLIP, CARDS, NOBLES, rng, shuffle, newGame, clone, bonusOf, pointsOf, heldOf, payment, legal, apply, decide, aiPick };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_GEMS;
