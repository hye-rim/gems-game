'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (arcade/public/tutorial.js 가 듣는다. 튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 보석 상인: 화면·입력·소리·온라인. 규칙과 컴퓨터는 logic.js (LOGIC_GEMS), 방·매칭·카드 섞기는 server.js
(() => {
const L = LOGIC_GEMS;
const $ = (id) => document.getElementById(id);
const T = { cpu: 800, over: 900 };                           // 시간(ms). 시험용으로 줄일 수 있다
const CH = ['루', '사', '에', '다', '오', '금'];

// ---------- 저장소 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
let wins = Number(store.get('gemsWins')) || 0;
const ONLINE_KEY = 'gemsOnline', SESSION_KEY = 'gemsSession';
const loadJson = (k) => { try { return JSON.parse(store.get(k)) || {}; } catch (_) { return {}; } };
function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (_) { return null; } }
function saveSession(s) { try { s ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESSION_KEY); } catch (_) {} }
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const myName = () => store.get('gemsName') || '';

// ---------- 소리 ----------
let audio = null;
let muted = store.get('gemsMuted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.09, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const seq = (notes, step, type = 'triangle', vol = 0.09) => notes.forEach((f, i) => setTimeout(() => tone(f, step * 0.0009, type, vol), i * step));
const sfx = {
  pick: () => tone(660, 0.05, 'triangle', 0.07),
  take: () => seq([784, 988], 60, 'triangle', 0.08),
  buy: () => seq([523, 659, 784], 80, 'triangle', 0.09),
  reserve: () => tone(440, 0.1, 'triangle', 0.08, 120),
  noble: () => seq([523, 659, 784, 1047, 1319], 90, 'triangle', 0.1),
  bad: () => tone(150, 0.1, 'square', 0.05),
  found: () => seq([392, 523], 90, 'triangle', 0.08),
  win: () => seq([523, 659, 784, 1047], 110, 'triangle', 0.1),
  lose: () => seq([392, 330, 262, 196], 150, 'sawtooth', 0.06),
};
function toggleMute() { muted = !muted; store.set('gemsMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// ---------- 상태 ----------
let mode = 'easy';                  // 'easy' · 'hard' (컴퓨터) · 'online'
let phase = 'title';                // title · play · over
let st = null;                      // 컴퓨터 대전 판 (나는 0번, 먼저)
let room = null, view = null, waitingNet = false, netDown = false, turnEnd = 0, recorded = '', seenMove = 0;
let cpuTimer = 0, overTimer = 0, thinking = false;
let pick = [];                      // 가져오려고 고른 보석 색
let openCard = null;                // 눌러서 연 카드 { id, where: 'market' | 'reserved', level, index }
let lastEv = null;                  // 방금 일어난 일 (화면 강조용)
const online = () => mode === 'online';

// 화면이 쓰는 모양으로 바꾼다 (컴퓨터 판과 온라인 판이 같은 모양)
function viewOf(s) {
  return {
    market: s.market, deckLeft: s.decks.map((d) => d.length), bank: s.bank, gold: s.gold, nobles: s.nobles,
    hands: s.players.map((p, i) => ({ tokens: p.tokens, gold: p.gold, cards: p.cards, nobles: p.nobles, reserved: p.reserved.map((r) => ({ id: i === 0 || r.open ? r.id : null, open: r.open })) })),
    turn: s.turn, phase: s.phase, pending: s.phase === 'noble' && s.turn === 0 ? s.pending : [], final: s.final,
    legal: s.turn === 0 && !s.over ? L.legal(s) : [],
  };
}
const viewFromRoom = (r) => ({ market: r.market, deckLeft: r.deckLeft, bank: r.bank, gold: r.gold, nobles: r.nobles, hands: r.hands, turn: r.turn, phase: r.phase, pending: r.pending, final: r.final, legal: r.legal || [] });
function model() {
  if (online()) {
    if (!room || !view) return null;
    return { v: view, you: room.you, turn: room.turn, state: room.state, winner: room.winner, reason: room.reason, last: room.lastMove,
      names: [0, 1].map((c) => (c === room.you ? '나' : ((room.players.find((p) => p.color === c) || {}).name || '상대'))) };
  }
  if (!st) return null;
  return { v: viewOf(st), you: 0, turn: st.turn, state: st.over ? 'over' : 'playing', winner: st.winner, reason: st.over ? 'done' : '', last: st.last, names: ['나', '컴퓨터'] };
}
const myTurn = (m) => !!m && m.state === 'playing' && m.turn === m.you && !netDown && !thinking;
const canAct = (m) => myTurn(m) && !waitingNet;
const pointsOf = (h) => h.cards.reduce((s, id) => s + L.CARDS[id].pts, 0) + h.nobles.reduce((s, id) => s + L.NOBLES[id].pts, 0);
const bonusOf = (h) => { const b = [0, 0, 0, 0, 0]; h.cards.forEach((id) => { b[L.CARDS[id].bonus]++; }); return b; };
const heldOf = (h) => h.tokens.reduce((s, n) => s + n, 0) + h.gold;
const same = (a, b) => a.type === b.type && a.level === b.level && a.index === b.index && a.color === b.color && a.id === b.id &&
  (a.colors ? !!b.colors && a.colors.length === b.colors.length && a.colors.every((c) => b.colors.includes(c)) : !b.colors);
const findLegal = (m, want) => (m.v.legal || []).find((a) => same(a, want));

// ---------- 그리기 ----------
const chip = (c, count, extra = '', attrs = '') => `<i class="chip c${c}${extra}" ${attrs} title="${L.NAMES[c]}"><s>${CH[c]}</s>${count === undefined ? '' : `<b>${count}</b>`}</i>`;
const bon = (c, n, extra = '') => `<i class="bon c${c}${n === 0 ? ' zero' : ''}${extra}" title="${L.NAMES[c]} 할인">${n}</i>`;

function costHtml(card, disc) {
  return card.cost.map((n, c) => {
    const need = Math.max(0, n - (disc ? disc[c] : 0));
    return need > 0 ? `<i class="cc c${c}">${need}</i>` : '';
  }).join('');
}
function cardHtml(id, opts = {}) {
  if (id === null || id === undefined) return `<div class="card empty"></div>`;
  const card = L.CARDS[id];
  const cls = ['card', opts.can ? 'can' : '', opts.res ? 'res' : '', opts.fresh ? 'new' : ''].filter(Boolean).join(' ');
  return `<div class="${cls}" data-id="${id}" data-where="${opts.where || ''}" data-level="${opts.level ?? ''}" data-index="${opts.index ?? ''}">
    <div class="top c${card.bonus}"><span class="pp${card.pts ? '' : ' z'}">${card.pts || 0}</span><span class="bg">${CH[card.bonus]}</span></div>
    <div class="cost">${costHtml(card, opts.disc)}</div></div>`;
}
function nobleHtml(id, cls = '') {
  const n = L.NOBLES[id];
  return `<div class="noble ${cls}" data-noble="${id}"><span class="np">${n.pts}</span><div class="nr">${n.need.map((k, c) => (k ? `<i class="bon c${c}">${k}</i>` : '')).join('')}</div></div>`;
}
function stockHtml(h, withTk) {
  const b = bonusOf(h);
  let html = '';
  for (let c = 0; c < 6; c++) html += chip(c, c === 5 ? h.gold : h.tokens[c], (c === 5 ? h.gold : h.tokens[c]) ? ' tk' : ' dim tk', withTk ? `data-tk="${c}"` : '');
  for (let c = 0; c < 6; c++) html += c < 5 ? bon(c, b[c]) : '<span></span>';
  return `<div class="stock">${html}</div>`;
}
function plHtml(m, p, label) {
  const h = m.v.hands[p], on = m.state === 'playing' && m.turn === p;
  const res = h.reserved.length;
  return `<div class="hd"><span class="nm">${on ? '▶ ' : ''}${esc(label)}</span><span class="sm">찜 ${res}/3 · 카드 ${h.cards.length}장${h.nobles.length ? ` · 귀족 ${h.nobles.length}` : ''}</span><span class="pt">⭐ ${pointsOf(h)}</span></div>${stockHtml(h, p === m.you)}`;
}

function render() {
  const m = model();
  if (!m) { renderHud(null); return; }
  const v = m.v, you = m.you, op = 1 - you;
  const mine = canAct(m);
  const mh = v.hands[you], oh = v.hands[op];
  const disc = bonusOf(mh);
  if (!mine || v.phase !== 'turn') pick = [];
  // 상대 · 나
  $('opp').className = `pl${m.state === 'playing' && m.turn === op ? ' on' : ''}`;
  $('opp').innerHTML = plHtml(m, op, m.names[op]);
  $('me').className = `pl me${m.state === 'playing' && m.turn === you ? ' on' : ''}`;
  $('me').innerHTML = plHtml(m, you, '나');
  // 귀족
  const choosing = mine && v.phase === 'noble';
  $('nobles').innerHTML = `<span class="nlabel">귀족<br>3점</span>` + v.nobles.map((id) => nobleHtml(id, choosing && v.pending.includes(id) ? 'pick' : '')).join('');
  // 시장 (3단계가 위, 1단계가 아래)
  let mk = '';
  for (let l = 2; l >= 0; l--) {
    const left = v.deckLeft[l];
    const slots = v.market[l].map((id, i) => cardHtml(id, { where: 'market', level: l, index: i, disc, can: id !== null && !!findLegal(m, { type: 'buy', level: l, index: i }) && mine, fresh: lastEv && lastEv.fresh && lastEv.level === l && lastEv.index === i })).join('');
    mk += `<div class="mrow"><div class="deck l${l + 1}${left ? '' : ' empty'}">Lv${l + 1}<b>${left}</b></div>${slots}</div>`;
  }
  $('market').innerHTML = mk;
  // 보석 더미
  let bank = '';
  for (let c = 0; c < 5; c++) bank += chip(c, v.bank[c] - pick.filter((x) => x === c).length, `${v.bank[c] <= 0 ? ' dim' : ''}${pick.includes(c) ? ' sel' : ''}`, `data-c="${c}"`);
  bank += chip(5, v.gold, ' gold');
  $('bank').innerHTML = bank;
  // 내 찜 카드
  $('mres').innerHTML = mh.reserved.length ? `<span class="lbl">내 찜</span>` + mh.reserved.map((r, i) => cardHtml(r.id, { where: 'reserved', index: i, res: true, disc, can: mine && !!findLegal(m, { type: 'buyReserved', index: i }) })).join('') : '';
  // 단추
  const need = heldOf(mh) - L.HAND_MAX;
  $('takeBtn').disabled = !(mine && v.phase === 'turn' && pickAction(m));
  $('takeBtn').textContent = pick.length ? `💎 가져오기 (${pick.length}개)` : '💎 가져오기';
  $('clearBtn').disabled = !pick.length;
  $('clearBtn').style.visibility = pick.length ? 'visible' : 'hidden';
  renderHud(m);
  // 안내 문구
  if (mine && v.phase === 'return') say(`보석이 ${heldOf(mh)}개예요. 내 보석을 눌러 ${need}개를 돌려놓으세요`);
  else if (mine && v.phase === 'noble') say('🎩 귀족이 여럿 찾아왔어요! 한 명을 골라요');
  if (openCard) renderSheet(m);
}
function renderHud(m = model()) {
  $('wins').textContent = wins.toLocaleString('ko-KR');
  let text = '보석 상인';
  if (m && phase === 'play' && m.state === 'playing') {
    const sec = Math.max(0, Math.ceil((turnEnd - performance.now()) / 1000));
    const last = m.v.final ? ' · 마지막 차례' : '';
    if (online() && netDown) text = '연결 다시 붙이는 중…';
    else if (m.turn === m.you) text = `내 차례${last}${online() ? ` · ${sec}초` : ''}`;
    else text = online() ? `${m.names[m.turn]} 차례${last} · ${sec}초` : `컴퓨터 차례${last}…`;
  }
  $('turn').textContent = text;
  $('resignBtn').style.display = online() && room && room.state === 'playing' ? '' : 'none';
}
function say(t) { $('msg').textContent = t; }

// ---------- 카드 창 ----------
function renderSheet(m) {
  const v = m.v, you = m.you, c = openCard;
  const card = L.CARDS[c.id], mh = v.hands[you], disc = bonusOf(mh);
  const mine = canAct(m) && v.phase === 'turn';
  const buy = mine && (c.where === 'market' ? findLegal(m, { type: 'buy', level: c.level, index: c.index }) : findLegal(m, { type: 'buyReserved', index: c.index }));
  const resv = c.where === 'market' && mine && findLegal(m, { type: 'reserve', level: c.level, index: c.index });
  const pay = L.payment({ tokens: mh.tokens, gold: mh.gold, cards: mh.cards }, c.id);
  const need = card.cost.map((n, k) => ({ k, n: Math.max(0, n - disc[k]) })).filter((x) => x.n > 0);
  const txt = need.length ? need.map((x) => `${L.NAMES[x.k]} ${x.n}`).join(' · ') : '공짜! (할인으로 다 채워졌어요)';
  const why = pay ? (pay.gold ? `<b>황금 ${pay.gold}개</b>를 써서 살 수 있어요` : '지금 살 수 있어요') : '보석이 모자라요';
  $('sheet').innerHTML = `<div class="box">
    <div class="big">${cardHtml(c.id, { disc })}</div>
    <div class="info">${L.NAMES[card.bonus]} 할인 +1${card.pts ? ` · <b>${card.pts}점</b>` : ''}<br>내야 할 보석: ${txt}<br>${why}</div>
    <div class="acts"><button id="buyBtn"${buy ? '' : ' disabled'}>💰 사기</button>${c.where === 'market' ? `<button id="reserveBtn"${resv ? '' : ' disabled'}>📌 찜하기</button>` : ''}<button class="sub" id="closeBtn">닫기</button></div></div>`;
  $('sheet').classList.remove('hidden');
}
function closeSheet() { openCard = null; $('sheet').classList.add('hidden'); }

// ---------- 창 ----------
const overlayOpen = () => !$('overlay').classList.contains('hidden');
function showOverlay(html) { $('overlay').innerHTML = html; $('overlay').classList.remove('hidden'); }
function hideOverlay() { $('overlay').classList.add('hidden'); }

// ---------- 입력 ----------
// 보석 고르기: 서로 다른 색 3개, 또는 같은 색을 한 번 더 눌러 2개 (더미에 4개 이상일 때)
function pickAction(m) {
  if (!pick.length) return null;
  if (pick.length === 2 && pick[0] === pick[1]) return findLegal(m, { type: 'take2', color: pick[0] });
  return findLegal(m, { type: 'take', colors: pick });
}
$('bank').addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.chip[data-c]');
  if (!el) return;
  e.preventDefault();
  const m = model(), c = Number(el.dataset.c);
  if (!canAct(m) || m.v.phase !== 'turn') { if (m && m.turn === m.you) sfx.bad(); return; }
  const bank = m.v.bank;
  if (pick.length === 2 && pick[0] === pick[1]) pick = pick[0] === c ? [] : (bank[c] > 0 ? [c] : pick);
  else if (pick.length === 1 && pick[0] === c) { if (bank[c] >= 4) pick = [c, c]; else pick = []; }
  else if (pick.includes(c)) pick = pick.filter((x) => x !== c);
  else if (bank[c] <= 0) { sfx.bad(); return; }
  else if (pick.length >= 3) { sfx.bad(); return; }
  else pick = pick.concat(c);
  sfx.pick(); render();
  tutorialSignal('pick');
});
$('takeBtn').onclick = (e) => { e.currentTarget.blur(); doTake(); };
$('clearBtn').onclick = (e) => { e.currentTarget.blur(); pick = []; render(); };
$('me').addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.chip[data-tk]');
  if (!el) return;
  const m = model();
  if (!canAct(m) || m.v.phase !== 'return') return;
  e.preventDefault();
  const a = findLegal(m, { type: 'return', color: Number(el.dataset.tk) });
  if (a) dispatch(a);
});
$('nobles').addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.noble.pick');
  if (!el) return;
  const m = model();
  if (!canAct(m) || m.v.phase !== 'noble') return;
  e.preventDefault();
  const a = findLegal(m, { type: 'noble', id: Number(el.dataset.noble) });
  if (a) dispatch(a);
});
function onCardTap(e) {
  const el = e.target.closest('.card[data-id]');
  if (!el || el.classList.contains('empty') || el.classList.contains('back')) return;
  e.preventDefault();
  const m = model();
  if (!m) return;
  openCard = { id: Number(el.dataset.id), where: el.dataset.where, level: Number(el.dataset.level), index: Number(el.dataset.index) };
  sfx.pick(); renderSheet(m);
  tutorialSignal('look');
}
$('market').addEventListener('pointerdown', onCardTap);
$('mres').addEventListener('pointerdown', onCardTap);
$('sheet').addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('button');
  if (!btn && e.target === $('sheet')) { closeSheet(); return; }
  if (!btn || btn.disabled) return;
  e.preventDefault();
  const m = model(), c = openCard;
  if (btn.id === 'closeBtn') { closeSheet(); return; }
  if (!m || !c) return;
  let a = null;
  if (btn.id === 'buyBtn') a = c.where === 'market' ? findLegal(m, { type: 'buy', level: c.level, index: c.index }) : findLegal(m, { type: 'buyReserved', index: c.index });
  if (btn.id === 'reserveBtn') a = findLegal(m, { type: 'reserve', level: c.level, index: c.index });
  closeSheet();
  if (a) dispatch(a);
});
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'Escape') closeSheet();
  if (e.code === 'Enter' && phase === 'play' && !overlayOpen() && !$('takeBtn').disabled) doTake();
});

function doTake() {
  const m = model();
  if (!canAct(m)) return;
  const a = pickAction(m);
  if (!a) return;
  pick = [];
  dispatch(a);
}
// 내 동작 하나를 낸다 (컴퓨터 판은 바로 적용, 온라인은 서버로)
function dispatch(a) {
  const m = model();
  if (!canAct(m)) return;
  if (online()) { waitingNet = true; net.send('act', { action: a }); render(); return; }
  const ev = L.apply(st, a);
  if (!ev) return;
  afterMine(ev);
}
function afterMine(ev) {
  announce(ev);
  if (ev.type === 'take') tutorialSignal('take');
  else if (ev.type === 'buy') tutorialSignal('buy');
  else if (ev.type === 'reserve') tutorialSignal('reserve');
  else if (ev.type === 'return') tutorialSignal('return');
  render();
  if (st.over) { overTimer = setTimeout(showOver, T.over); return; }
  if (st.turn === 1) scheduleCpu();
}
function announce(ev) {
  const m = model();
  if (!m) return;
  const mine = ev.who === m.you;
  const who = mine ? '내가' : `${m.names[ev.who]}${/[가-힣]$/.test(m.names[ev.who]) && ((m.names[ev.who].charCodeAt(m.names[ev.who].length - 1) - 0xAC00) % 28 === 0) ? '가' : '이'}`;
  lastEv = null;
  let t = '';
  if (ev.type === 'take') { sfx.take(); t = `${who} ${ev.colors.map((c) => L.NAMES[c]).join('·')} 보석을 가져갔어요`; }
  else if (ev.type === 'take2') { sfx.take(); t = `${who} ${L.NAMES[ev.colors[0]]} 2개를 가져갔어요`; }
  else if (ev.type === 'reserve') { sfx.reserve(); t = `${who} ${ev.open ? '카드를' : `${ev.level + 1}단계 더미의 카드를`} 찜했어요${ev.gold ? ' (황금 +1)' : ''}`; }
  else if (ev.type === 'buy') {
    sfx.buy();
    const card = L.CARDS[ev.id];
    t = `${who} ${L.NAMES[card.bonus]} 카드를 샀어요${card.pts ? ` (+${card.pts}점)` : ''}`;
    if (ev.noble !== undefined) { sfx.noble(); t += `\n🎩 귀족이 ${mine ? '나' : '상대'}에게 왔어요! +3점`; }
  }
  else if (ev.type === 'return') t = `${who} 보석을 돌려놓았어요`;
  else if (ev.type === 'noble') { sfx.noble(); t = `🎩 귀족이 ${mine ? '나' : '상대'}에게 왔어요! +3점`; }
  else if (ev.type === 'pass') t = `${who} 할 수 있는 게 없어 넘겼어요`;
  say(t);
}

// ---------- 컴퓨터 대전 ----------
function startCpu(level) {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = level; st = L.newGame(); phase = 'play'; pick = []; thinking = false; turnEnd = 0; lastEv = null;
  closeSheet(); hideOverlay(); render();
  say('보석 3개를 가져오거나 카드를 눌러 사 보세요!\n먼저 15점을 만들면 이겨요');
}
function scheduleCpu() { thinking = true; render(); cpuTimer = setTimeout(cpuTurn, T.cpu); }
function cpuTurn() {
  if (phase !== 'play' || !st || online() || st.over || st.turn !== 1) { thinking = false; render(); return; }
  const a = L.aiPick(st, mode === 'hard' ? 'hard' : 'easy');
  const ev = L.apply(st, a);
  if (!ev) { thinking = false; render(); return; }
  announce(ev);
  if (st.over) { thinking = false; render(); overTimer = setTimeout(showOver, T.over); return; }
  if (st.turn === 1) { render(); cpuTimer = setTimeout(cpuTurn, T.cpu); return; }   // 보석 버리기·귀족 고르기가 이어지면 계속
  thinking = false;
  render();
}
const scoreLine = (h) => `${pointsOf(h)}점 · 카드 ${h.cards.length}장${h.nobles.length ? ` · 귀족 ${h.nobles.length}` : ''}`;
function showOver() {
  phase = 'over';
  const v = viewOf(st), a = v.hands[0], b = v.hands[1];
  const youWon = st.winner === 0, draw = st.winner === 2;
  if (youWon) { wins++; store.set('gemsWins', String(wins)); sfx.win(); } else if (draw) sfx.found(); else sfx.lose();
  showOverlay(`
    <h2>${draw ? '비겼어요! 🤝' : youWon ? '이겼어요! 🎉' : '아쉬워요! 😵'}</h2>
    <dl class="stats card2"><dt>나</dt><dd>${scoreLine(a)}</dd><dt>컴퓨터</dt><dd>${scoreLine(b)}</dd></dl>
    <p>점수가 같으면 <b>산 카드가 적은 쪽</b>이 이겨요<br>컴퓨터 상대 승리 <b>${wins}</b>번</p>
    <div class="col"><button data-act="again">다시 하기</button><button class="sub" data-act="view">판 보기</button><button class="sub" data-act="home">처음으로</button></div>`);
  render();
}
function showTitle() {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = 'easy'; phase = 'title'; st = L.newGame(); pick = []; thinking = false; lastEv = null; closeSheet();
  say(''); render();
  const on = loadJson(ONLINE_KEY);
  showOverlay(`
    <h1>보석 상인</h1>
    <p>보석을 모아 <b>카드</b>를 사고, 먼저 <b>15점</b>을 만들어요!</p>
    <div class="card2" style="font-size:13px">한 차례에 <b>하나만</b>: 보석 3개 가져오기 · 같은 색 2개 · 카드 찜하기 · 카드 사기<br>산 카드는 <b>영원한 할인</b>이 돼요. 할인이 쌓이면 비싼 카드도 공짜!<br>할인이 조건에 맞으면 <b>귀족</b>이 찾아와 3점을 줘요<br>보석은 <b>10개</b>까지만 들 수 있어요</div>
    <div class="col"><button data-act="cpu" data-lv="easy">🤖 컴퓨터랑 · 쉬움</button><button class="sub" data-act="cpu" data-lv="hard">🤖 컴퓨터랑 · 어려움</button><button class="sub" data-act="online">🌐 온라인 대전${on.w || on.l ? ` · ${on.w || 0}승 ${on.l || 0}패` : ''}</button></div>`);
}

// ---------- 온라인: 연결 ----------
const net = {
  ws: null, pulse: null, outbox: [], retry: 0,
  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}${location.pathname}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.raw('hello', { name: myName() });
      const s = loadSession();
      if (s) this.raw('resume', s);
      for (const [t, p] of this.outbox.splice(0)) this.raw(t, p);
      clearInterval(this.pulse);
      this.pulse = setInterval(() => this.raw('pulse'), 10000);
    };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onNet(m); };
    ws.onclose = () => {
      clearInterval(this.pulse);
      if (this.ws !== ws) return;
      this.ws = null;
      if (!online()) return;
      if (room || loadSession()) {
        netDown = true; waitingNet = false; render();
        setTimeout(() => { if (online()) this.connect(); }, Math.min(4000, 500 * 2 ** this.retry++));
      } else showOnline('서버와 연결이 끊겼어요. 다시 시도해 주세요.');
    };
  },
  send(t, p = {}) {
    if (this.ws && this.ws.readyState === 1) this.raw(t, p);
    else { this.outbox.push([t, p]); this.connect(); }
  },
  raw(t, p = {}) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t, ...p })); },
  close() {
    const ws = this.ws;
    this.ws = null; this.outbox = [];
    clearInterval(this.pulse);
    if (ws) ws.close();
  },
};

function onNet(m) {
  if (m.t === 'queued') showQueued();
  else if (m.t === 'room') applyRoom(m);
  else if (m.t === 'rejected') { waitingNet = false; render(); }
  else if (m.t === 'error') { room = null; saveSession(null); showOnline(m.msg); }
  else if (m.t === 'resumeFailed') {
    saveSession(null);
    if (room) { room = null; showOnline('대국이 끝나서 이어갈 수 없어요.'); }
    netDown = false; render();
  }
}

function leaveOnline() {
  if (!online()) return;
  net.send('leave'); net.close();
  saveSession(null);
  room = null; view = null; netDown = false; waitingNet = false; mode = 'easy'; phase = 'title'; closeSheet();
}

// ---------- 온라인: 대국 ----------
function applyRoom(r) {
  const prev = room;
  const fresh = !prev || prev.code !== r.code;
  const newGame = fresh || prev.games !== r.games;
  room = r;
  view = viewFromRoom(r);
  netDown = false; waitingNet = false;
  saveSession({ code: r.code, token: r.token });
  turnEnd = performance.now() + r.remain;
  if (newGame) { seenMove = r.lastMove ? r.lastMove.seq : 0; pick = []; closeSheet(); lastEv = null; say(''); }
  if (r.state === 'waiting') { phase = 'title'; showWaiting(); render(); return; }
  phase = r.state === 'playing' ? 'play' : 'over';
  if (newGame && r.state === 'playing') { sfx.found(); say(r.turn === r.you ? '내가 먼저예요! 보석을 가져오거나 카드를 사요' : '상대가 먼저 해요'); }
  if (!($('overlay').dataset.screen === 'confirm') && r.state !== 'over') hideOverlay();
  const lm = r.lastMove;
  if (lm && lm.seq > seenMove && !newGame) {
    seenMove = lm.seq;
    announce(lm);
  }
  if (r.turn !== r.you || r.phase === 'turn') { /* 안내 문구는 아래 render 가 필요할 때 덮어쓴다 */ }
  render();
  if (r.state === 'over') afterOver();
}
function afterOver() {
  const r = room;
  const key = `${r.code}:${r.games}:${r.reason}:${r.winner}`;
  if (recorded !== key) {
    recorded = key;
    const rec = loadJson(ONLINE_KEY);
    if (r.winner === r.you) { rec.w = (rec.w || 0) + 1; sfx.win(); } else if (r.winner === 2) sfx.found(); else { rec.l = (rec.l || 0) + 1; sfx.lose(); }
    store.set(ONLINE_KEY, JSON.stringify(rec));
    setTimeout(() => { if (room && room.state === 'over') showResult(); }, T.over);
  } else if (overlayOpen()) showResult();
}

function showResult() {
  const r = room;
  const won = r.winner === r.you, draw = r.winner === 2;
  const a = r.hands[r.you], b = r.hands[1 - r.you];
  const why = {
    done: draw ? '점수도 카드 수도 같아요' : won ? '내 점수가 더 높아요!' : '상대 점수가 더 높아요',
    resign: won ? '상대가 기권했어요' : '기권했어요',
    timeout: won ? '상대가 시간을 넘겼어요' : '시간을 넘겼어요',
    left: won ? '상대가 나갔어요' : '연결이 끊겨 패배했어요',
  }[r.reason] || '';
  const rec = loadJson(ONLINE_KEY);
  const opp = r.players.find((p) => p.color !== r.you);
  const iVoted = r.rematch.includes(r.you), theyVoted = opp && r.rematch.includes(opp.color);
  let again;
  if (!opp) again = '<p>상대가 방을 나갔어요</p>';
  else if (iVoted) again = '<p>상대를 기다리는 중…</p>';
  else again = `${theyVoted ? '<p>상대가 한 판 더 하고 싶어해요!</p>' : ''}<button data-act="rematch">한 판 더</button>`;
  showOverlay(`
    <h2>${draw ? '🤝 무승부' : won ? '🎉 승리!' : '😵 패배'}</h2>
    ${why ? `<p>${esc(why)}</p>` : ''}
    ${r.reason === 'done' ? `<dl class="stats card2"><dt>나</dt><dd>${scoreLine(a)}</dd><dt>${esc((opp && opp.name) || '상대')}</dt><dd>${scoreLine(b)}</dd></dl>` : ''}
    <span class="tag">온라인 ${rec.w || 0}승 ${rec.l || 0}패</span>
    <div class="col">${again}
      <div class="row"><button class="sub" data-act="view">판 보기</button><button class="sub" data-act="leave">나가기</button></div>
    </div>`);
}

function showOnline(error = '') {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = 'online'; phase = 'title'; room = null; view = null; st = null; waitingNet = false; pick = []; thinking = false; closeSheet();
  say(''); render();
  showOverlay(`
    <h2>🌐 온라인 대전</h2>
    <input id="nameInput" maxlength="10" placeholder="내 이름 (최대 10자)" value="${esc(myName())}" autocomplete="off">
    <div class="col">
      <button data-act="quick">⚡ 빠른 대전</button>
      <button class="sub" data-act="create">방 만들기</button>
      <div class="row join"><input id="codeInput" maxlength="4" placeholder="방 코드" autocomplete="off" autocapitalize="characters"><button class="sub" data-act="join">들어가기</button></div>
    </div>
    <span class="error">${esc(error)}</span>
    <button class="back" data-act="home">← 처음으로</button>
    <p style="font-size:12.5px">한 번 고를 때마다 90초 · 카드는 서버가 섞어요 · 먼저 하는 쪽은 한 판마다 바뀌어요</p>`);
}
function showQueued() {
  showOverlay(`
    <h2>상대를 찾는 중…</h2>
    <div class="dots"><span></span><span></span><span></span></div>
    <p>누군가 빠른 대전을 누르면 바로 시작해요</p>
    <button class="sub" data-act="cancel">취소</button>`);
}
const inviteUrl = () => `${location.origin}${location.pathname}?room=${room.code}`;
function showWaiting() {
  showOverlay(`
    <h2>친구를 기다리는 중…</h2>
    <p>방 코드</p>
    <div class="code">${esc(room.code)}</div>
    <p>친구가 <b>온라인 대전 → 들어가기</b>에<br>이 코드를 넣으면 시작해요</p>
    <button data-act="copy">🔗 초대 링크 복사</button>
    <button class="sub" data-act="cancel">취소</button>`);
}
function saveName() {
  const input = $('nameInput');
  if (!input) return;
  const name = input.value.trim().slice(0, 10);
  store.set('gemsName', name);
  net.send('hello', { name });
}
function confirmResign() {
  showOverlay(`<h2>기권할까요?</h2><p>이번 판은 패배로 기록돼요</p>
    <div class="row"><button data-act="close">계속하기</button><button class="sub" data-act="resign">🏳 기권</button></div>`);
  $('overlay').dataset.screen = 'confirm';
}

let lastCpu = 'easy';
$('overlay').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  btn.blur();
  $('overlay').dataset.screen = '';
  const act = btn.dataset.act;
  if (act === 'cpu') { lastCpu = btn.dataset.lv; startCpu(lastCpu); }
  else if (act === 'again') startCpu(lastCpu);
  else if (act === 'home') showTitle();
  else if (act === 'online') showOnline();
  else if (act === 'quick') { saveName(); net.send('quick'); }
  else if (act === 'create') { saveName(); net.send('create'); }
  else if (act === 'join') {
    const code = ($('codeInput').value || '').trim().toUpperCase();
    if (code.length !== 4) { $('overlay').querySelector('.error').textContent = '방 코드 4자리를 넣어 주세요.'; return; }
    saveName();
    net.send('join', { code });
  } else if (act === 'cancel') { net.send('cancel'); showOnline(); }
  else if (act === 'copy') {
    const url = inviteUrl();
    const done = () => { btn.textContent = '✅ 복사했어요'; setTimeout(() => { btn.textContent = '🔗 초대 링크 복사'; }, 1500); };
    if (navigator.share && matchMedia('(pointer: coarse)').matches) navigator.share({ title: '보석 상인 한 판 해요!', url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('링크를 복사하세요', url));
    else prompt('링크를 복사하세요', url);
  } else if (act === 'rematch') { net.send('rematch'); }
  else if (act === 'view') hideOverlay();
  else if (act === 'leave') showOnline();
  else if (act === 'resign') { net.send('resign'); hideOverlay(); }
  else if (act === 'close') hideOverlay();
});
$('overlay').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'codeInput') $('overlay').querySelector('[data-act="join"]').click();
  if (e.target.id === 'nameInput') $('overlay').querySelector('[data-act="quick"]').click();
  e.stopPropagation();
});
$('resignBtn').onclick = (e) => { e.currentTarget.blur(); if (online() && room && room.state === 'playing') confirmResign(); };
setInterval(() => { if (online() && room && room.state === 'playing' && !netDown) renderHud(); }, 500);

// ---------- 시작 ----------
const invite = new URLSearchParams(location.search).get('room');
if (invite) { try { window.history.replaceState(null, '', location.pathname); } catch (_) {} }
function joinInvite(code) { showOnline(); net.send('join', { code: code.toUpperCase() }); }
if (loadSession()) {
  mode = 'online';
  view = null; render();
  showOverlay('<h2>대국으로 돌아가는 중…</h2>');
  net.connect();
  const until = setInterval(() => {
    if (room || !loadSession()) { clearInterval(until); if (!room) invite ? joinInvite(invite) : showOnline(); }
  }, 100);
} else if (invite) joinInvite(invite);
else showTitle();

/* @test-hooks:start */
window.__gm = { get st() { return st; }, get mode() { return mode; }, get phase() { return phase; }, get room() { return room; }, get pick() { return pick; }, get thinking() { return thinking; }, T, dispatch, startCpu, render, model };
/* @test-hooks:end */
})();

