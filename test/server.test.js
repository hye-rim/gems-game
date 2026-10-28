'use strict';

// 서버 시험: 보안·안정성 회귀 + 보석 상인 온라인 대국 흐름
// 실행: npm test  (Node 18 이상, 별도 설치 없이 node:test)
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { WebSocket } = require('ws');
const L = require('../public/logic.js');

// 운영체제가 지금 비어 있는 포트를 골라 준다 (고정 포트·범위 난수는 다른 서버와 겹쳐 가끔 실패한다)
const freePort = () => Number(require('child_process').execFileSync(process.execPath, ['-e', "const s = require('net').createServer().listen(0, '127.0.0.1', () => { console.log(s.address().port); s.close(); })"]));
const PORT = freePort();
const get = (p) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'GET' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', reject); req.end();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), TURN_MS: '2500' }, stdio: 'ignore' });
child.unref();
process.on('exit', () => child.kill());
const ready = (async () => {
  for (let i = 0; i < 80; i++) { try { await get('/'); return; } catch { await sleep(100); } }
  throw new Error('server did not start');
})();

const open = () => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  const c = { ws, msgs: [], room: null, queued: false, errors: [], closed: null };
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d); } catch { return; }
    c.msgs.push(m);
    if (m.t === 'room') c.room = m;
    if (m.t === 'queued') c.queued = true;
    if (m.t === 'error') c.errors.push(m.msg);
  });
  ws.on('close', (code) => { c.closed = code; });
  ws.on('error', () => {});
  ws.on('open', () => resolve(c));
  setTimeout(() => reject(new Error('websocket connect failed')), 3000);
});
const send = (c, t, p = {}) => c.ws.send(JSON.stringify({ t, ...p }));
const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(10); } return false; };

// 두 손님을 빠른 대전으로 맺어 준다
async function pair() {
  const a = await open(), b = await open();
  send(a, 'hello', { name: '가' }); send(b, 'hello', { name: '나' });
  send(a, 'quick'); await until(() => a.queued);
  send(b, 'quick');
  assert.ok(await until(() => a.room && b.room && a.room.state === 'playing' && b.room.state === 'playing'), 'both players enter a playing room');
  return [a, b];
}
const mover = (a, b) => (a.room.turn === a.room.you ? a : b);
const closeAll = (...cs) => cs.forEach((c) => c.ws.close());
const act = (c, action) => send(c, 'act', { action });
const stamp = (room) => JSON.stringify([room.bank, room.hands, room.turn, room.phase, room.market]);
const pointsOfHand = (h) => h.cards.reduce((s, id) => s + L.CARDS[id].pts, 0) + h.nobles.reduce((s, id) => s + L.NOBLES[id].pts, 0);
// 컴퓨터 한 동작: 서버가 알려 준 legal 목록에서 (사기 > 가져오기 > 아무거나) 골라 보내고 반영될 때까지 기다린다
async function oneAction(a, b, pick) {
  const m = mover(a, b);
  const before = stamp(m.room);
  const acts = m.room.legal;
  const buys = acts.filter((x) => x.type === 'buy' || x.type === 'buyReserved');
  const takes = acts.filter((x) => x.type === 'take' || x.type === 'take2');
  const pool = buys.length ? buys : takes.length ? takes : acts;
  act(m, pool[Math.floor(Math.random() * pool.length)]);
  await until(() => a.room.state === 'over' || stamp(a.room) !== before, 3000);
}

test('malformed URLs get 400 and the server stays up', async () => {
  await ready;
  assert.strictEqual(await get('/%'), 400);
  assert.strictEqual(await get('/%00'), 400);
  assert.strictEqual(await get('/'), 200);
  assert.strictEqual(await get('/logic.js'), 200);
});

test('dotfiles and paths outside the public dir are not served', async () => {
  await ready;
  assert.strictEqual(await get('/.git/config'), 403);
  assert.ok([403, 404].includes(await get('/../server.js')));
});

test('oversized websocket message closes the connection (1009)', async () => {
  await ready;
  const c = await open();
  c.ws.send('x'.repeat(2 * 1024 * 1024));
  await sleep(500);
  assert.strictEqual(c.closed, 1009);
  assert.strictEqual(await get('/'), 200);
});

test('quick match starts with the fresh table and never sends the deck', async () => {
  await ready;
  const [a, b] = await pair();
  assert.notStrictEqual(a.room.you, b.room.you);
  assert.strictEqual(a.room.turn, 0);
  assert.deepStrictEqual(a.room.bank, [4, 4, 4, 4, 4]);
  assert.strictEqual(a.room.gold, 5);
  assert.deepStrictEqual(a.room.deckLeft, [36, 26, 16]);
  assert.ok(a.room.market.every((row) => row.length === 4 && row.every((id) => Number.isInteger(id))));
  assert.strictEqual(a.room.nobles.length, 3);
  assert.deepStrictEqual(a.room.market, b.room.market, 'both see the same table');
  for (const c of [a, b]) {
    const raw = JSON.stringify(c.room);
    assert.ok(!('decks' in c.room), 'no deck field');
    assert.ok(!raw.includes('"decks"'));
  }
  assert.ok(mover(a, b).room.legal.length > 0, 'the mover gets the legal moves');
  assert.deepStrictEqual((mover(a, b) === a ? b : a).room.legal, [], 'the other side gets none');
  closeAll(a, b);
});

test('out-of-turn and garbage actions are ignored', async () => {
  await ready;
  const [a, b] = await pair();
  const first = mover(a, b), second = first === a ? b : a;
  const before = stamp(a.room);
  act(second, { type: 'take', colors: [0, 1, 2] });                 // 내 차례가 아님
  const junk = [{}, { type: 'take' }, { type: 'take', colors: [0, 0, 1] }, { type: 'take', colors: 'abc' }, { type: 'take', colors: [0, 1, 2, 3] },
    { type: 'take', colors: ['a', 1, 2] }, { type: 'take2', color: 'x' }, { type: 'take2', color: 1.5 }, { type: 'buy', level: 9, index: 0 },
    { type: 'buy', level: 0, index: 0 }, { type: 'buyReserved', index: 0 }, { type: 'reserve', level: 0, index: 99 }, { type: 'return', color: 0 },
    { type: 'noble', id: 3 }, { type: ['take'] }, { type: null }, [], 'take', 5, null];
  for (const action of junk) act(first, action);
  send(first, 'act');
  send(first, 'act', { action: 'x' });
  await sleep(300);
  assert.strictEqual(stamp(a.room), before, 'nothing happened');
  assert.strictEqual(a.room.turn, 0);
  assert.strictEqual(await get('/'), 200, 'the server survived');
  closeAll(a, b);
});

test('taking gems updates both views, passes the turn and reports the last move', async () => {
  await ready;
  const [a, b] = await pair();
  const first = mover(a, b), second = first === a ? b : a;
  act(first, { type: 'take', colors: [0, 2, 4] });
  assert.ok(await until(() => a.room.turn === 1 && b.room.turn === 1));
  assert.deepStrictEqual(a.room.bank, [3, 4, 3, 4, 3]);
  assert.deepStrictEqual(b.room.hands[0].tokens, [1, 0, 1, 0, 1]);
  assert.strictEqual(a.room.lastMove.seq, 1);
  assert.strictEqual(a.room.lastMove.type, 'take');
  assert.deepStrictEqual(a.room.lastMove.colors, [0, 2, 4]);
  act(first, { type: 'take', colors: [1, 3, 0] });                  // 이제 상대 차례
  await sleep(200);
  assert.strictEqual(a.room.turn, 1);
  act(second, { type: 'take2', color: 1 });
  assert.ok(await until(() => a.room.turn === 0));
  assert.deepStrictEqual(a.room.hands[1].tokens, [0, 2, 0, 0, 0]);
  closeAll(a, b);
});

test('a card reserved from the deck is hidden from the other player, one from the table is not', async () => {
  await ready;
  const [a, b] = await pair();
  const first = mover(a, b), second = first === a ? b : a;
  act(first, { type: 'reserve', level: 2, index: -1 });
  assert.ok(await until(() => a.room.turn === 1 && b.room.turn === 1));
  const mine = first.room.hands[0].reserved[0], theirs = second.room.hands[0].reserved[0];
  assert.strictEqual(mine.open, false);
  assert.ok(Number.isInteger(mine.id), 'I see my own card');
  assert.strictEqual(theirs.id, null, 'the other player does not');
  assert.strictEqual(first.room.hands[0].gold, 1);
  assert.deepStrictEqual(a.room.deckLeft, [36, 26, 15]);
  const open = second.room.market[0][1];
  act(second, { type: 'reserve', level: 0, index: 1 });
  assert.ok(await until(() => a.room.turn === 0));
  assert.strictEqual(first.room.hands[1].reserved[0].id, open, 'an open card stays known');
  assert.notStrictEqual(first.room.market[0][1], open, 'the slot is refilled');
  closeAll(a, b);
});

test('two players play a full game through the server', async () => {
  await ready;
  const [a, b] = await pair();
  for (let i = 0; i < 400 && a.room.state === 'playing'; i++) await oneAction(a, b);
  assert.ok(await until(() => a.room.state === 'over' && b.room.state === 'over', 3000), 'the game ends');
  assert.strictEqual(a.room.reason, 'done');
  const x = pointsOfHand(a.room.hands[0]), y = pointsOfHand(a.room.hands[1]);
  const ca = a.room.hands[0].cards.length, cb = a.room.hands[1].cards.length;
  const expect = x !== y ? (x > y ? 0 : 1) : ca !== cb ? (ca < cb ? 0 : 1) : 2;
  assert.strictEqual(a.room.winner, expect);
  assert.strictEqual(b.room.winner, expect);
  closeAll(a, b);
});

test('resigning ends the game and rematch swaps sides', async () => {
  await ready;
  const [a, b] = await pair();
  const sideA = a.room.you;
  send(a, 'resign');
  assert.ok(await until(() => b.room.state === 'over'));
  assert.strictEqual(b.room.reason, 'resign');
  assert.strictEqual(b.room.winner, b.room.you);
  send(a, 'rematch'); send(b, 'rematch');
  assert.ok(await until(() => a.room.state === 'playing' && a.room.games === 2));
  assert.notStrictEqual(a.room.you, sideA, 'sides swap on a rematch');
  assert.ok(a.room.hands.every((h) => h.cards.length === 0 && h.tokens.every((n) => n === 0)));
  assert.deepStrictEqual(a.room.bank, [4, 4, 4, 4, 4]);
  closeAll(a, b);
});

test('running out of time loses the game for the one on move', async () => {
  await ready;
  const [a, b] = await pair();
  const first = mover(a, b);
  assert.ok(await until(() => a.room.state === 'over', 5000), 'the timer fires');
  assert.strictEqual(a.room.reason, 'timeout');
  assert.strictEqual(a.room.winner, 1 - first.room.you);
  closeAll(a, b);
});

test('private rooms: create, join by code, and a third player is turned away', async () => {
  await ready;
  const a = await open(), b = await open(), c = await open();
  send(a, 'create');
  assert.ok(await until(() => a.room && a.room.code));
  assert.strictEqual(a.room.state, 'waiting');
  send(b, 'join', { code: a.room.code.toLowerCase() });
  assert.ok(await until(() => a.room.state === 'playing' && b.room && b.room.state === 'playing'));
  send(c, 'join', { code: a.room.code });
  assert.ok(await until(() => c.errors.length > 0));
  assert.match(c.errors[0], /이미 두 사람/);
  a.ws.close(); b.ws.close(); c.ws.close();
});

test('a dropped player can resume the same seat with the token', async () => {
  await ready;
  const [a, b] = await pair();
  const token = a.room.token, code = a.room.code, you = a.room.you;
  a.ws.close();
  assert.ok(await until(() => b.room.players.some((p) => !p.online)), 'the other side sees the drop');
  const a2 = await open();
  send(a2, 'resume', { code, token });
  assert.ok(await until(() => a2.room && a2.room.you === you && a2.room.state === 'playing'));
  assert.ok(await until(() => b.room.players.every((p) => p.online)));
  a2.ws.close(); b.ws.close();
});

// 같은 주소에서 코드를 일부러 많이 틀리므로 이 시험은 맨 뒤에 둔다 (뒤의 시험이 막히지 않게)
test('repeated wrong room codes get temporarily blocked', async () => {
  await ready;
  const c = await open();
  for (let i = 0; i < 10; i++) c.ws.send(JSON.stringify({ t: 'join', code: 'ZZZ' + 'ABCDEFGH'[i] }));
  await sleep(500);
  assert.ok(c.errors.some((x) => /그런 방이 없어요/.test(x)), 'first attempts are answered with room-not-found');
  assert.ok(c.errors.some((x) => /너무 많이 틀렸어요/.test(x)), 'many wrong codes get blocked');
  c.ws.close();
});

test('shutdown', () => { child.kill(); });
