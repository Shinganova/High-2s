/* Tests for AI personalities. Run: node test/personality.test.js */
const fs = require('fs');
const path = require('path');
global.window = {};
for (const f of ['cards.js', 'hands.js', 'ai.js', 'personalities.js', 'game.js']) {
  eval(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'));
}
const { cards, hands, ai, personalities: P, game: G } = window.Big2;

let pass = 0, fail = 0;
function ok(c, m) { c ? pass++ : (fail++, console.error('  FAIL:', m)); }

const SUIT = { D: 0, C: 1, H: 2, S: 3 };
const RVAL = { '3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,J:11,Q:12,K:13,A:14,'2':15 };
function c(label, s) { return cards.makeCard(RVAL[label], SUIT[s]); }
function hand(specs) { return cards.sortHand(specs.map(([l, s]) => c(l, s))); }
const deck = cards.buildDeck();
function unseen(myHand) {
  const mine = new Set(myHand.map(x => x.id));
  return deck.filter(d => !mine.has(d.id));
}

// 1) pickThree returns three DISTINCT personas
{
  let allDistinct = true;
  for (let i = 0; i < 200; i++) {
    const t = P.pickThree();
    if (t.length !== 3 || new Set(t.map(p => p.id)).size !== 3) allDistinct = false;
  }
  ok(allDistinct, 'pickThree always returns 3 distinct personas');
}

// 2) createGame seats three distinct named AI personalities
{
  const g = G.createGame(undefined, 'hard');
  ok(g.players[0].personality === null, 'human has no personality');
  const ids = g.players.slice(1).map(p => p.personality && p.personality.id);
  ok(ids.every(Boolean) && new Set(ids).size === 3, 'three distinct AI personalities seated');
  ok(g.players.slice(1).every(p => p.name === p.personality.name), 'AI names match their persona');
}

// 2b) pickExcluding never returns a seated persona (used to replace a bust)
{
  let bad = 0;
  for (let i = 0; i < 500; i++) {
    const seated = new Set(P.pickThree().map(p => p.id)); // 3 seated
    const repl = P.pickExcluding(seated);
    if (seated.has(repl.id)) bad++;
  }
  ok(bad === 0, 'pickExcluding avoids personas already seated');
}

// 3) personaMove never returns an illegal play (it may pass = null)
{
  const persona = P.byId('rae');
  let bad = 0, plays = 0;
  for (let n = 0; n < 3000; n++) {
    const d = cards.shuffle(cards.buildDeck());
    const h = cards.sortHand(d.slice(0, 13));
    const toBeat = Math.random() < 0.5 ? hands.evaluate([d[20]]) : null; // a single, or lead
    const move = ai.chooseMove(h, {
      toBeat, unseen: unseen(h), opponents: [{ count: 8 }, { count: 6 }, { count: 9 }],
      difficulty: 'hard', personality: persona
    });
    if (move === null) continue;
    plays++;
    const combo = hands.evaluate(move);
    if (!combo || !hands.beats(combo, toBeat)) bad++;
  }
  ok(bad === 0, `every non-pass persona move is legal (${plays} plays checked, ${bad} illegal)`);
}

// 4) patience matters: a patient persona hoards a premium card far more than an
//    impatient one when the only beating play is a premium single.
function passRate(persona, trials) {
  const h = hand([['A', 'S'], ['4', 'D'], ['6', 'C']]); // only the A beats a K
  const toBeat = hands.evaluate([c('K', 'D')]);
  let passes = 0;
  for (let i = 0; i < trials; i++) {
    const move = ai.chooseMove(h, {
      toBeat, unseen: unseen(h), opponents: [{ count: 9 }, { count: 8 }, { count: 10 }],
      difficulty: 'hard', personality: persona
    });
    if (move === null) passes++;
  }
  return passes / trials;
}
{
  const granny = passRate(P.byId('granny'), 600); // patience 0.92
  const hank = passRate(P.byId('hank'), 600);     // patience 0.10
  ok(granny > hank + 0.3, `patient Granny holds the Ace far more than Hank (${granny.toFixed(2)} vs ${hank.toFixed(2)})`);
  ok(hank < 0.3, `impatient Hank rarely holds the Ace (${hank.toFixed(2)})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
