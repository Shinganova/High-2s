/* Tests for hand drag-reorder math. Run: node test/drag.test.js
 * Stubs a canvas so the UI layout helpers run under node. */
const fs = require('fs');
const path = require('path');
global.window = {};
for (const f of ['cards.js', 'hands.js', 'ui.js']) {
  eval(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'));
}
const { cards, UI } = window.Big2;

const ctx = new Proxy({}, { get: () => () => {} }); // all draw calls become no-ops
const ui = new UI({ width: 960, height: 680, getContext: () => ctx });

const hand = [3, 4, 5, 6, 7, 8].map(r => cards.makeCard(r, 0)); // 3..8 of Diamonds
ui.drawHand(hand, new Set(), null); // populates ui._lay with 6 slots
const lay = ui._lay, n = hand.length, w = lay.w;

let pass = 0, fail = 0;
function ok(c, m) { c ? pass++ : (fail++, console.error('  FAIL:', m)); }

// reorder mirrors exactly what drawHand previews during a drag
function reorder(card, insertIndex) {
  const others = hand.filter(c => c.id !== card.id);
  others.splice(insertIndex, 0, card);
  return others.map(c => c.label).join('');
}

// --- cursor -> insert index --------------------------------------------------
ok(ui.computeInsertIndex(lay.slots[0] - 100) === 0, 'far-left cursor -> first slot');
ok(ui.computeInsertIndex(lay.slots[n - 1] + 100) === n - 1, 'far-right cursor -> last slot');
ok(ui.computeInsertIndex(lay.slots[3] + w / 2 - 1) === 3, 'left of a card centre -> insert before it');
ok(ui.computeInsertIndex(lay.slots[3] + w / 2 + 1) === 4, 'right of a card centre -> insert after it');

// --- reorder result matches the preview --------------------------------------
ok(reorder(hand[0], ui.computeInsertIndex(lay.slots[n - 1] + 100)) === '456783', 'drag 3 to end => 456783');
ok(reorder(hand[5], ui.computeInsertIndex(lay.slots[0] - 100)) === '834567', 'drag 8 to start => 834567');
ok(reorder(hand[2], 2) === '345678', 'dropping a card where it was leaves order unchanged');

// --- rendering paths don't throw when per-card values are shown ---------------
// (regression: `valueOf` collides with Object.prototype, and the drag path is a
// separate code path from the static path.)
ui.valueFn = card => card.rank * 5;
let threw = null;
try {
  ui.drawHand(hand, new Set([hand[0].id]), null);          // static path
  ui.drawHand(hand, new Set([hand[0].id]), {               // reorder drag path
    card: hand[0], curX: 400, curY: 500, mode: 'reorder', insertIndex: 3, offsetX: 10, offsetY: 10
  });
  ui.drawHand(hand, new Set([hand[0].id]), {               // play drag, single card
    card: hand[0], curX: 480, curY: 300, mode: 'play', insertIndex: 0, offsetX: 10, offsetY: 10
  });
  const groupSel = new Set([hand[1].id, hand[2].id, hand[3].id]); // a 3-card selection
  ui.drawHand(hand, groupSel, {                            // play drag, whole group fans
    card: hand[2], curX: 480, curY: 300, mode: 'play', insertIndex: 0, offsetX: 10, offsetY: 10
  });
} catch (e) { threw = e; }
ok(threw === null, 'drawHand renders all paths (static / reorder / single-play / group-fan) without throwing'
   + (threw ? ' — ' + threw.message : ''));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
