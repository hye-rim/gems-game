'use strict';

// 규칙 시험: 카드·귀족 구성, 보석 가져오기·찜·사기·귀족·끝내기, 무작위 판에서 보석·카드가 새지 않음, 어려움이 쉬움을 이김
// 실행: npm test  (Node 18 이상, 별도 설치 없이 node:test)
const test = require('node:test');
const assert = require('node:assert');
const L = require('../public/logic.js');

const play = (lv0, lv1, seed, onMove) => {
  const r = L.rng(seed), st = L.newGame(r);
  for (let n = 0; !st.over && n < 1000; n++) {
    const a = L.aiPick(st, st.turn === 0 ? lv0 : lv1, r);
    assert.ok(L.apply(st, a), 'ai move is legal');
    if (onMove) onMove(st);
  }
  assert.ok(st.over, 'game ends');
  return st;
};
// 보석 총량과 카드가 새지 않았는지
function conserved(st) {
  for (let c = 0; c < 5; c++) assert.strictEqual(st.bank[c] + st.players[0].tokens[c] + st.players[1].tokens[c], 4, `gem ${c}`);
  assert.strictEqual(st.gold + st.players[0].gold + st.players[1].gold, 5, 'gold');
  const ids = [];
  st.decks.forEach((d) => ids.push(...d));
  st.market.forEach((row) => row.forEach((id) => { if (id !== null) ids.push(id); }));
  st.players.forEach((p) => { ids.push(...p.cards); ids.push(...p.reserved.map((r) => r.id)); });
  assert.strictEqual(ids.length, 90, 'card count');
  assert.strictEqual(new Set(ids).size, 90, 'every card once');
  const nobles = [...st.nobles, ...st.players[0].nobles, ...st.players[1].nobles];
  assert.strictEqual(new Set(nobles).size, nobles.length, 'noble once');
  assert.strictEqual(nobles.length, 3, 'three nobles in play');
}
const fresh = (seed = 1) => L.newGame(L.rng(seed));
// 시험 판에서 카드 한 장을 어디서든 빼낸다 (더미·시장·손)
function pull(st, id) {
  st.decks = st.decks.map((d) => d.filter((x) => x !== id));
  st.market = st.market.map((row) => row.map((x) => (x === id ? st.decks[0].pop() : x)));
  st.players.forEach((p) => { p.cards = p.cards.filter((x) => x !== id); p.reserved = p.reserved.filter((r) => r.id !== id); });
}
// 사람 손에 카드를 직접 쥐여 준다 (보석 총량 시험은 하지 않는 시험용)
function give(st, who, ids) { ids.forEach((id) => { pull(st, id); st.players[who].cards.push(id); }); }
function place(st, level, index, id) { pull(st, id); st.market[level][index] = id; }

test('card set has 90 cards with fixed shape', () => {
  assert.strictEqual(L.CARDS.length, 90);
  for (let l = 0; l < 3; l++) {
    const cs = L.CARDS.filter((c) => c.level === l);
    assert.strictEqual(cs.length, L.LEVEL_COUNT[l]);
    for (let b = 0; b < 5; b++) assert.strictEqual(cs.filter((c) => c.bonus === b).length, L.LEVEL_COUNT[l] / 5, `level ${l} color ${b}`);
  }
  for (const c of L.CARDS) {
    assert.strictEqual(c.cost[c.bonus], 0, 'a card never costs its own color');
    const total = c.cost.reduce((s, n) => s + n, 0);
    assert.ok(total >= 3 && total <= 13, `cost ${total}`);
    assert.ok(c.cost.every((n) => n >= 0 && n <= 7));
  }
  assert.ok(Math.max(...L.CARDS.filter((c) => c.level === 0).map((c) => c.pts)) <= 1);
  assert.ok(Math.min(...L.CARDS.filter((c) => c.level === 2).map((c) => c.pts)) >= 3);
});

test('nobles need only bonuses and are worth 3', () => {
  assert.strictEqual(L.NOBLES.length, 10);
  for (const n of L.NOBLES) { assert.strictEqual(n.pts, 3); assert.ok(n.need.some((x) => x >= 3)); }
  assert.strictEqual(new Set(L.NOBLES.map((n) => n.need.join())).size, 10, 'all different');
});

test('new game setup for two players', () => {
  const st = fresh();
  assert.deepStrictEqual(st.decks.map((d) => d.length), [36, 26, 16]);
  assert.ok(st.market.every((row) => row.length === 4 && row.every((id) => id !== null)));
  assert.deepStrictEqual(st.bank, [4, 4, 4, 4, 4]);
  assert.strictEqual(st.gold, 5);
  assert.strictEqual(st.nobles.length, 3);
  assert.strictEqual(st.turn, 0);
  conserved(st);
});

test('taking gems: three different, or two of a color with four in the pile', () => {
  const st = fresh();
  assert.ok(L.apply(st, { type: 'take', colors: [0, 1, 2] }));
  assert.deepStrictEqual(st.players[0].tokens, [1, 1, 1, 0, 0]);
  assert.strictEqual(st.turn, 1);
  assert.strictEqual(L.apply(st, { type: 'take', colors: [0, 0, 1] }), null, 'same color twice in a three-take');
  assert.strictEqual(L.apply(st, { type: 'take', colors: [3, 4] }), null, 'two colors while three are available');
  assert.ok(L.apply(st, { type: 'take2', color: 3 }));
  assert.deepStrictEqual(st.players[1].tokens, [0, 0, 0, 2, 0]);
  assert.strictEqual(st.bank[3], 2);
  assert.strictEqual(L.apply(st, { type: 'take2', color: 3 }), null, 'only two left in the pile');
  conserved(st);
});

test('with fewer than three colors left you take what is there', () => {
  const st = fresh();
  st.bank = [0, 0, 1, 2, 0]; st.players[0].tokens = [4, 4, 0, 0, 0]; st.players[1].tokens = [0, 0, 3, 2, 4];
  const acts = L.legal(st).filter((a) => a.type === 'take');
  assert.strictEqual(acts.length, 1);
  assert.deepStrictEqual(acts[0].colors.slice().sort(), [2, 3]);
  assert.ok(L.apply(st, { type: 'take', colors: [3, 2] }));
});

test('holding more than ten gems forces returning down to ten', () => {
  const st = fresh();
  st.players[0].tokens = [3, 3, 3, 0, 0]; st.bank = [1, 1, 1, 4, 4]; st.players[1].tokens = [0, 0, 0, 0, 0];
  assert.ok(L.apply(st, { type: 'take', colors: [3, 4, 0] }));
  assert.strictEqual(st.phase, 'return');
  assert.strictEqual(st.turn, 0, 'still my turn until I return');
  assert.ok(L.legal(st).every((a) => a.type === 'return'));
  assert.strictEqual(L.apply(st, { type: 'return', color: 2 }).type, 'return');
  assert.strictEqual(st.turn, 0, 'eleven is still too many');
  assert.strictEqual(L.apply(st, { type: 'return', color: 1 }).type, 'return');
  assert.strictEqual(L.heldOf(st.players[0]), 10);
  assert.strictEqual(st.turn, 1, 'back to ten, the turn passes');
  assert.strictEqual(st.phase, 'turn');
});

test('reserving gives a gold gem, three at most, and a deck card stays hidden', () => {
  const st = fresh();
  const id = st.market[1][2];
  assert.ok(L.apply(st, { type: 'reserve', level: 1, index: 2 }));
  assert.deepStrictEqual(st.players[0].reserved, [{ id, open: true }]);
  assert.strictEqual(st.players[0].gold, 1);
  assert.strictEqual(st.gold, 4);
  assert.notStrictEqual(st.market[1][2], id, 'slot is refilled');
  assert.strictEqual(st.decks[1].length, 25);
  L.apply(st, { type: 'take', colors: [0, 1, 2] });
  assert.ok(L.apply(st, { type: 'reserve', level: 2, index: -1 }));
  assert.strictEqual(st.players[0].reserved[1].open, false);
  assert.strictEqual(st.decks[2].length, 15);
  L.apply(st, { type: 'take', colors: [0, 1, 2] });
  assert.ok(L.apply(st, { type: 'reserve', level: 0, index: 0 }));
  L.apply(st, { type: 'take', colors: [3, 4, 0] });
  assert.strictEqual(L.apply(st, { type: 'reserve', level: 0, index: 1 }), null, 'a fourth reserve is refused');
  assert.ok(L.legal(st).every((a) => a.type !== 'reserve'));
  conserved(st);
});

test('reserving with no gold left still works but gives nothing', () => {
  const st = fresh();
  st.gold = 0; st.players[1].gold = 5;
  const r = L.apply(st, { type: 'reserve', level: 0, index: 0 });
  assert.ok(r);
  assert.strictEqual(r.gold, false);
  assert.strictEqual(st.players[0].gold, 0);
});

test('buying uses discounts first, then gems, then gold, and returns payment to the pile', () => {
  const st = fresh();
  const target = L.CARDS.find((c) => c.level === 1 && c.cost.filter((n) => n > 0).length === 3);
  place(st, 1, 0, target.id);
  const p = st.players[0];
  const colors = target.cost.map((n, c) => (n > 0 ? c : -1)).filter((c) => c >= 0);
  const disc = L.CARDS.find((c) => c.level === 0 && c.bonus === colors[0] && c.id !== target.id);
  give(st, 0, [disc.id]);
  // 할인 한 장을 빼고도 한 알이 모자란 보석을 쥐고, 모자란 한 알은 황금으로
  const need = target.cost.map((n, c) => Math.max(0, n - (c === colors[0] ? 1 : 0)));
  p.tokens = need.slice();
  const short = colors[1];
  p.tokens[short] = Math.max(0, p.tokens[short] - 1);
  p.gold = 1;
  st.bank = [0, 1, 2, 3, 4].map((c) => 4 - p.tokens[c]);
  st.gold = 4;
  const pay = L.payment(p, target.id);
  assert.ok(pay, 'affordable');
  assert.strictEqual(pay.gold, 1);
  const paidGems = pay.pay.reduce((s, n) => s + n, 0);
  const heldBefore = L.heldOf(p);
  assert.ok(L.apply(st, { type: 'buy', level: 1, index: 0 }));
  assert.ok(p.cards.includes(target.id));
  assert.strictEqual(p.gold, 0);
  assert.strictEqual(L.heldOf(p), heldBefore - paidGems - 1, 'spent exactly the payment');
  assert.strictEqual(st.gold, 5, 'gold returned to the pile');
});

test('you cannot buy what you cannot pay for, and nonsense is refused without changing anything', () => {
  const st = fresh();
  const before = JSON.stringify(st);
  assert.strictEqual(L.apply(st, { type: 'buy', level: 2, index: 0 }), null);
  assert.strictEqual(L.apply(st, { type: 'buyReserved', index: 0 }), null);
  assert.strictEqual(L.apply(st, { type: 'nope' }), null);
  assert.strictEqual(L.apply(st, null), null);
  assert.strictEqual(L.apply(st, { type: 'take', colors: [0, 1, 7] }), null);
  assert.strictEqual(L.apply(st, { type: 'take2', color: 9 }), null);
  assert.strictEqual(JSON.stringify(st), before, 'nothing changed');
});

test('a reserved card can be bought later', () => {
  const st = fresh();
  const id = st.market[0][0];
  L.apply(st, { type: 'reserve', level: 0, index: 0 });
  L.apply(st, { type: 'take', colors: [0, 1, 2] });
  const p = st.players[0];
  p.tokens = L.CARDS[id].cost.slice();
  st.bank = [0, 1, 2, 3, 4].map((c) => 4 - p.tokens[c] - st.players[1].tokens[c]);
  assert.ok(L.apply(st, { type: 'buyReserved', index: 0 }));
  assert.ok(p.cards.includes(id));
  assert.strictEqual(p.reserved.length, 0);
});

test('a noble visits after a turn that meets his condition', () => {
  const st = fresh();
  const noble = L.NOBLES[0];                                  // 루비 4 + 사파이어 4
  st.nobles = [0, 7, 9];
  const need = (c) => L.CARDS.filter((x) => x.bonus === c && x.level === 0);
  give(st, 0, [...need(0).slice(0, 4).map((x) => x.id), ...need(1).slice(0, 3).map((x) => x.id)]);
  const last = need(1)[3];
  place(st, 0, 0, last.id);
  const p = st.players[0];
  p.tokens = last.cost.slice();
  st.bank = [0, 1, 2, 3, 4].map((c) => 4 - p.tokens[c]);
  assert.ok(L.apply(st, { type: 'buy', level: 0, index: 0 }));
  assert.deepStrictEqual(p.nobles, [noble.id], 'the noble came by himself');
  assert.ok(!st.nobles.includes(noble.id));
  assert.strictEqual(L.pointsOf(p), p.cards.reduce((s, id) => s + L.CARDS[id].pts, 0) + 3);
  assert.strictEqual(st.turn, 1);
});

test('two nobles at once: the player chooses', () => {
  const st = fresh();
  for (let c = 0; c < 5; c++) give(st, 0, L.CARDS.filter((x) => x.bonus === c && x.level === 0).slice(0, 4).map((x) => x.id));
  st.nobles = [0, 5, 7];
  assert.ok(L.apply(st, { type: 'take', colors: [0, 1, 2] }));
  assert.strictEqual(st.phase, 'noble');
  assert.deepStrictEqual(L.legal(st).map((a) => a.id).sort((a, b) => a - b), [0, 5, 7]);
  assert.strictEqual(st.turn, 0);
  assert.strictEqual(L.apply(st, { type: 'noble', id: 1 }), null, 'not on offer');
  assert.ok(L.apply(st, { type: 'noble', id: 5 }));
  assert.deepStrictEqual(st.players[0].nobles, [5]);
  assert.strictEqual(st.turn, 1);
  assert.strictEqual(st.phase, 'turn');
});

test('reaching 15 ends the game after the round and the higher score wins', () => {
  const st = fresh();
  give(st, 0, L.CARDS.filter((c) => c.pts >= 3).slice(0, 5).map((c) => c.id));
  assert.ok(L.pointsOf(st.players[0]) >= 15);
  L.apply(st, { type: 'take', colors: [0, 1, 2] });
  assert.strictEqual(st.final, true);
  assert.strictEqual(st.over, false, 'the second player still has a turn');
  L.apply(st, { type: 'take', colors: [0, 1, 2] });
  assert.strictEqual(st.over, true);
  assert.strictEqual(st.winner, 0);
  assert.deepStrictEqual(L.legal(st), []);
  assert.strictEqual(L.apply(st, { type: 'take', colors: [0, 1, 2] }), null, 'nothing after the end');
});

test('second player passing 15 in the last turn can win', () => {
  const st = fresh();
  give(st, 0, L.CARDS.filter((c) => c.pts >= 3).slice(0, 5).map((c) => c.id));
  give(st, 1, L.CARDS.filter((c) => c.pts >= 3).slice(5, 11).map((c) => c.id));
  assert.ok(L.pointsOf(st.players[1]) > L.pointsOf(st.players[0]));
  L.apply(st, { type: 'take', colors: [0, 1, 2] });
  L.apply(st, { type: 'take', colors: [0, 1, 2] });
  assert.strictEqual(st.over, true);
  assert.strictEqual(st.winner, 1);
});

test('ties go to the player with fewer cards, then it is a draw', () => {
  const st = fresh();
  const by = (pts, skip = []) => L.CARDS.find((c) => c.pts === pts && !skip.includes(c.id)).id;
  st.players[0].cards = [by(3), by(4)];
  st.players[1].cards = [by(5), by(2)];
  assert.strictEqual(L.pointsOf(st.players[0]), 7);
  assert.strictEqual(L.pointsOf(st.players[1]), 7);
  st.players[0].cards.push(by(0));
  assert.strictEqual(L.decide(st), 1, 'fewer cards wins the tie');
  st.players[1].cards.push(by(0, st.players[0].cards));
  assert.strictEqual(L.decide(st), 2, 'same points and cards is a draw');
});

test('random games: moves are legal, gems and cards never leak, the game ends', () => {
  for (let i = 0; i < 120; i++) {
    const st = play(i % 2 ? 'easy' : 'hard', i % 3 ? 'easy' : 'hard', 900 + i, (s) => { if (s.plies % 7 === 0) conserved(s); });
    conserved(st);
    assert.ok(st.plies <= L.MAX_PLIES);
    assert.ok([0, 1, 2].includes(st.winner));
    for (const p of st.players) assert.ok(L.heldOf(p) <= L.HAND_MAX, 'ends with at most ten gems');
  }
});

test('hard beats easy in most games (seats alternate)', () => {
  let hardWins = 0, games = 0;
  for (let i = 0; i < 300; i++) {
    const hardFirst = i % 2 === 0;
    const st = play(hardFirst ? 'hard' : 'easy', hardFirst ? 'easy' : 'hard', 5000 + i);
    games++;
    if (st.winner === (hardFirst ? 0 : 1)) hardWins++;
  }
  assert.ok(hardWins / games > 0.8, `hard won ${hardWins}/${games}`);
});

test('hard takes the buy that wins the game', () => {
  const st = fresh();
  const p = st.players[0];
  const fives = L.CARDS.filter((c) => c.pts === 5);
  give(st, 0, L.CARDS.filter((c) => c.pts === 4).slice(0, 3).map((c) => c.id));   // 12점
  const big = fives[0];
  place(st, 2, 0, big.id);
  assert.ok(L.pointsOf(p) + big.pts >= 15);
  p.tokens = big.cost.slice();
  st.bank = [0, 1, 2, 3, 4].map((c) => 4 - p.tokens[c]);
  const a = L.aiPick(st, 'hard1', () => 0.5);
  assert.strictEqual(a.type, 'buy');
  assert.strictEqual(st.market[a.level][a.index], big.id);
});
