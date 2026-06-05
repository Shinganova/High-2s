/* Quick node test for the rules engine. Run: node test/engine.test.js
 * Shims `window` so the browser modules load under node. */
const fs = require('fs');
const path = require('path');
global.window = {};
for (const f of ['cards.js', 'hands.js', 'ai.js', 'personalities.js', 'game.js']) {
  eval(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'));
}
const { cards, hands } = window.Big2;

let pass = 0, fail = 0;
function ok(cond, msg) { cond ? pass++ : (fail++, console.error('  FAIL:', msg)); }

// build a card by rank-value + suit code
const SUIT_IDX = { D: 0, C: 1, H: 2, S: 3 };
const RVAL = { '3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,J:11,Q:12,K:13,A:14,'2':15 };
function c(label, suit) { return cards.makeCard(RVAL[label], SUIT_IDX[suit]); }
function combo(list) { return hands.evaluate(list.map(([l, s]) => c(l, s))); }

// ---- singles ----
ok(combo([['2','S']]).key > combo([['2','D']]).key, '2♠ beats 2♦');
ok(combo([['2','D']]).key > combo([['A','S']]).key, '2♦ beats A♠ (2 is highest rank)');
ok(combo([['3','D']]).key < combo([['3','S']]).key, '3♦ weakest of the 3s');
ok(hands.beats(combo([['2','S']]), combo([['A','S']])), 'single 2♠ beats single A♠');

// ---- pairs / triples ----
const pairAce = combo([['A','S'],['A','H']]);
const pairTwo = combo([['2','C'],['2','D']]);
ok(pairTwo.type === hands.TYPE.PAIR, 'two 2s form a pair');
ok(pairTwo.key > pairAce.key, 'pair of 2s beats pair of aces');
ok(combo([['A','S'],['K','S']]) === null, 'mismatched ranks are not a pair');
ok(combo([['7','S'],['7','H'],['7','C']]).type === hands.TYPE.TRIPLE, 'triple detected');

// ---- five-card categories ----
const straight = combo([['3','D'],['4','S'],['5','H'],['6','C'],['7','D']]);
const flush    = combo([['3','H'],['7','H'],['9','H'],['J','H'],['K','H']]);
const fullhouse= combo([['8','S'],['8','H'],['8','C'],['4','D'],['4','S']]);
const quads    = combo([['5','S'],['5','H'],['5','C'],['5','D'],['9','S']]);
const stflush  = combo([['9','S'],['10','S'],['J','S'],['Q','S'],['K','S']]);

ok(straight && straight.cat === hands.CAT.STRAIGHT, 'straight detected');
ok(flush && flush.cat === hands.CAT.FLUSH, 'flush detected');
ok(fullhouse && fullhouse.cat === hands.CAT.FULL_HOUSE, 'full house detected');
ok(quads && quads.cat === hands.CAT.FOUR_OF_A_KIND, 'four of a kind detected');
ok(stflush && stflush.cat === hands.CAT.STRAIGHT_FLUSH, 'straight flush detected');

ok(flush.key > straight.key, 'flush beats straight');
ok(fullhouse.key > flush.key, 'full house beats flush');
ok(quads.key > fullhouse.key, 'quads beat full house');
ok(stflush.key > quads.key, 'straight flush beats quads');

// highest straight J-Q-K-A-2 should be valid and beat a low straight
const highStraight = combo([['J','D'],['Q','S'],['K','H'],['A','C'],['2','D']]);
ok(highStraight && highStraight.cat === hands.CAT.STRAIGHT, 'J-Q-K-A-2 is a straight');
ok(highStraight.key > straight.key, 'high straight beats low straight');

// A-2-3-4-5 should NOT be a straight in this build
ok(combo([['A','S'],['2','S'],['3','S'],['4','S'],['5','S']]) === null
   || combo([['A','S'],['2','S'],['3','S'],['4','S'],['5','S']]).cat !== hands.CAT.STRAIGHT,
   'A-2-3-4-5 is not a straight (documented ruleset) — though A-2-3-4-5 same suit is also not consecutive');

// ---- type matching ----
ok(!hands.beats(combo([['2','S'],['2','H']]), combo([['3','D']])), 'pair cannot beat a single');
ok(!hands.beats(quads, pairTwo), '5-card hand cannot beat a pair (size mismatch)');

// ---- deck integrity ----
const deck = cards.buildDeck();
ok(deck.length === 52, 'deck has 52 cards');
ok(new Set(deck.map(d => d.id)).size === 52, 'all cards unique');

// ---- game: 3♦ holder opens ----
const g = window.Big2.game.createGame();
const opener = g.players[g.current];
ok(opener.hand.some(cards.isThreeOfDiamonds), 'opening player holds the 3♦');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
