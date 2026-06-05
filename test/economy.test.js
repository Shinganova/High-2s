/* Tests for the play-money economy. Run: node test/economy.test.js */
const fs = require('fs');
const path = require('path');
global.window = {};
for (const f of ['cards.js', 'hands.js', 'ai.js', 'personalities.js', 'game.js', 'economy.js']) {
  eval(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'));
}
const { cards, economy: E } = window.Big2;

let pass = 0, fail = 0;
function ok(c, m) { c ? pass++ : (fail++, console.error('  FAIL:', m)); }

const SUIT = { D: 0, C: 1, H: 2, S: 3 };
const RVAL = { '3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,J:11,Q:12,K:13,A:14,'2':15 };
function c(label, s) { return cards.makeCard(RVAL[label], SUIT[s]); }

// ---- card / table values ----
ok(E.cardValue(c('3', 'D'), 1) === 3, '3 is worth 3 at stake 1');
ok(E.cardValue(c('2', 'S'), 1) === 15, '2 is worth 15 at stake 1');
ok(E.cardValue(c('2', 'S'), 5) === 75, 'stake multiplies value (2 @ stake 5 = 75)');
ok(E.topHandValue(1) === 180, 'top-13 value is 180 at stake 1');
ok(E.maxPayout(1) === 540, 'maxPayout = 3 × 180 = 540 at stake 1');
ok(E.minToSit(1) === 1620, 'minToSit = 3 × maxPayout = 1620 at stake 1');
ok(E.maxPayout(20) === 10800 && E.minToSit(20) === 32400, 'high-roller (stake 20) economy scales');

// ---- penalty: normal vs caught-with-everything ----
const small = [c('3', 'D'), c('4', 'S')];                 // 2 cards, value 7
ok(E.penalty(small, 1) === 7, 'small hand pays face value (7)');

const all13 = [];
for (let r = 3; r <= 15; r++) all13.push(c(RVAL_label(r), 'D')); // 13 cards, value 3+..+15 = 117
function RVAL_label(r) { return cards.RANK_LABEL[r]; }
ok(E.handValue(all13, 1) === 117, '13-card hand base value = 117');
ok(E.penalty(all13, 1) === 351, 'caught with ALL 13 cards pays triple (351)');

// ---- settlement from the human's perspective ----
function fakeGame(hands, winner) {
  return { winner, players: hands.map((h, i) => ({ seat: i, name: 'P' + i, hand: h })) };
}

// human wins: collects every loser's penalty
{
  const g = fakeGame([[], [c('5', 'D')], [c('6', 'D'), c('7', 'D')], [c('2', 'S')]], 0);
  const r = E.settle(g, 1);
  ok(r.humanDelta === 5 + 13 + 15, 'winner collects 5+13+15 = 33');
  ok(r.rows[0].winner && r.rows[0].penalty === 0, 'winner owes nothing');
  ok(r.pot === 33, 'pot equals the sum of penalties');
  // per-seat deltas: winner +pot, each loser pays its own penalty
  ok(r.deltas[0] === 33 && r.deltas[1] === -5 && r.deltas[2] === -13 && r.deltas[3] === -15,
     'per-seat deltas: +33 / -5 / -13 / -15');
  ok(r.deltas.reduce((s, d) => s + d, 0) === 0, 'deltas are zero-sum');
}

// human loses: pays only its own penalty
{
  const g = fakeGame([[c('K', 'D'), c('2', 'S')], [], [c('4', 'D')], [c('5', 'D')]], 1);
  const r = E.settle(g, 1);
  ok(r.humanDelta === -(13 + 15), 'human pays its own 13+15 = 28');
}

// human loses caught with all 13 → triple
{
  const g = fakeGame([all13, [], [c('4', 'D')], [c('5', 'D')]], 1);
  const r = E.settle(g, 1);
  ok(r.humanDelta === -351, 'human caught with all 13 pays triple (351)');
  ok(r.rows[0].caughtAll === true, 'caughtAll flag set');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
