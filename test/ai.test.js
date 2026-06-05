/* Behavioural tests for the smarter AI. Run: node test/ai.test.js */
const fs = require('fs');
const path = require('path');
global.window = {};
for (const f of ['cards.js', 'hands.js', 'ai.js', 'personalities.js', 'game.js']) {
  eval(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'));
}
const { cards, hands, ai } = window.Big2;

let pass = 0, fail = 0;
function ok(cond, msg) { cond ? pass++ : (fail++, console.error('  FAIL:', msg)); }

const SUIT = { D: 0, C: 1, H: 2, S: 3 };
const RVAL = { '3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,J:11,Q:12,K:13,A:14,'2':15 };
function c(label, s) { return cards.makeCard(RVAL[label], SUIT[s]); }
function hand(specs) { return cards.sortHand(specs.map(([l, s]) => c(l, s))); }
const deck = cards.buildDeck();
function unseenExcluding(myHand) {
  const mine = new Set(myHand.map(x => x.id));
  return deck.filter(d => !mine.has(d.id));
}
function ids(list) { return list.map(x => x.id).sort().join(','); }

// 1) Responding to a single, the AI does NOT break a pair when it has a spare single.
{
  const h = hand([['5','S'],['9','C'],['9','H']]); // 9s are a pair; 5♠ is a spare beater
  const toBeat = hands.evaluate([c('4', 'D')]);     // a low single
  const move = ai.chooseMove(h, { toBeat, unseen: unseenExcluding(h), opponents: [{ count: 13 }] });
  ok(move.length === 1 && move[0].rank === 5, 'plays the spare 5 instead of breaking the pair of 9s');
}

// 2) Responding minimally — uses the lowest beating single, hoarding the 2.
{
  const h = hand([['7','D'],['K','S'],['2','S']]);
  const toBeat = hands.evaluate([c('5', 'S')]);
  const move = ai.chooseMove(h, { toBeat, unseen: unseenExcluding(h), opponents: [{ count: 13 }] });
  ok(move.length === 1 && move[0].rank === 7, 'beats a 5 with the 7, not the K or 2');
}

// 3) Leading, the AI saves its unbeatable 2♠ and sheds low instead.
{
  const h = hand([['3','C'],['4','D'],['2','S']]);
  const move = ai.chooseMove(h, { toBeat: null, unseen: unseenExcluding(h), opponents: [{ count: 13 }] });
  ok(move.length === 1 && move[0].rank !== 15, 'does not lead away the 2♠ early (led the ' + move[0].label + ')');
}

// 4) Endgame: opponent on 1 card — AI takes guaranteed control with the 2♠.
{
  const h = hand([['6','D'],['9','C'],['2','S']]);
  const toBeat = hands.evaluate([c('4', 'S')]);
  const unseen = unseenExcluding(h);            // 2♠ is unbeatable (nothing higher exists)
  const move = ai.chooseMove(h, { toBeat, unseen, opponents: [{ count: 1 }] });
  ok(move.length === 1 && move[0].rank === 15 && move[0].suitCode === 'S',
     'slams the unbeatable 2♠ to deny an opponent on 1 card');
}

// 5) Normal play (opponent healthy) with the same hand stays frugal.
{
  const h = hand([['6','D'],['9','C'],['2','S']]);
  const toBeat = hands.evaluate([c('4', 'S')]);
  const move = ai.chooseMove(h, { toBeat, unseen: unseenExcluding(h), opponents: [{ count: 10 }] });
  ok(move.length === 1 && move[0].rank === 6, 'with no threat, beats a 4 with the 6 (saves the 2)');
}

// 6) isUnbeatable: 2♠ always; a plain 2 only once the spades-2 is gone.
{
  ok(ai.isUnbeatable(hands.evaluate([c('2', 'S')]), deck.filter(d => d.id !== '2S')),
     '2♠ is unbeatable');
  const twoHearts = c('2', 'H');
  const withSpadeTwoOut = deck.filter(d => d.id !== '2H' && d.id !== '2S'); // 2♠ already played
  ok(ai.isUnbeatable(hands.evaluate([twoHearts]), withSpadeTwoOut),
     '2♥ is unbeatable once the 2♠ has been played');
}

// 7) planHand keeps a straight together rather than as five singles.
{
  const h = hand([['3','D'],['4','S'],['5','H'],['6','C'],['7','D'],['K','S']]);
  const plan = ai.planHand(h);
  const straight = plan.find(g => g.kind === 'five');
  ok(straight && straight.cards.length === 5, 'plans the 3-4-5-6-7 as one straight');
  ok(plan.length === 2, 'plan = one straight + the lone K (2 plays)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
