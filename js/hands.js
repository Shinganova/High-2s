/* hands.js — Big Two combination detection & comparison (the rules engine)
 *
 * Supported plays:
 *   SINGLE  (1 card)
 *   PAIR    (2 cards, same rank)
 *   TRIPLE  (3 cards, same rank)
 *   FIVE    (5-card poker hand)
 *
 * Five-card categories, weakest -> strongest:
 *   STRAIGHT < FLUSH < FULL_HOUSE < FOUR_OF_A_KIND(+1) < STRAIGHT_FLUSH
 *
 * STRAIGHT RULESET (documented choice):
 *   A straight is five cards whose single-card rank values are consecutive
 *   (no wrap-around). Because 2 is the highest rank value, the lowest straight
 *   is 3-4-5-6-7 and the highest is J-Q-K-A-2. A-2-3-4-5 / 2-3-4-5-6 are NOT
 *   straights here. This keeps ordering fully self-consistent. To allow
 *   "wheel" straights later, only `detectStraight` below needs changing.
 */
(function (global) {
  'use strict';

  const TYPE = { SINGLE: 1, PAIR: 2, TRIPLE: 3, FIVE: 5 };
  const CAT = {
    STRAIGHT: 0, FLUSH: 1, FULL_HOUSE: 2, FOUR_OF_A_KIND: 3, STRAIGHT_FLUSH: 4
  };
  const CAT_NAME = ['Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];

  function countByRank(cards) {
    const m = new Map();
    for (const c of cards) m.set(c.rank, (m.get(c.rank) || 0) + 1);
    return m;
  }

  function maxOrder(cards) {
    return cards.reduce((m, c) => Math.max(m, c.order), -1);
  }

  function detectStraight(cards) {
    // returns true if the 5 ranks are 5 distinct consecutive values
    const ranks = cards.map(c => c.rank).sort((a, b) => a - b);
    for (let i = 1; i < ranks.length; i++) {
      if (ranks[i] === ranks[i - 1]) return false;        // duplicate rank
      if (ranks[i] !== ranks[i - 1] + 1) return false;     // not consecutive
    }
    return true;
  }

  function detectFlush(cards) {
    return cards.every(c => c.suit === cards[0].suit);
  }

  // Evaluate an array of cards into a combo descriptor, or null if not a legal play.
  // Combo: { type, size, cat?, key, label, cards }
  // `key` is a single number: higher key beats lower key (same type only).
  function evaluate(cards) {
    if (!cards || cards.length === 0) return null;
    const n = cards.length;

    if (n === 1) {
      const c = cards[0];
      return { type: TYPE.SINGLE, size: 1, key: c.order, label: 'Single', cards };
    }

    if (n === 2) {
      if (cards[0].rank !== cards[1].rank) return null;
      return { type: TYPE.PAIR, size: 2, key: maxOrder(cards), label: 'Pair', cards };
    }

    if (n === 3) {
      if (cards[0].rank !== cards[1].rank || cards[1].rank !== cards[2].rank) return null;
      // suit is irrelevant for triples (rank is unique enough); key by rank.
      return { type: TYPE.TRIPLE, size: 3, key: cards[0].rank, label: 'Triple', cards };
    }

    if (n === 5) {
      const isFlush = detectFlush(cards);
      const isStraight = detectStraight(cards);
      const counts = countByRank(cards);
      const countVals = Array.from(counts.values()).sort((a, b) => b - a); // e.g. [3,2]

      let cat = null;
      let tiebreak = 0;

      if (isStraight && isFlush) {
        cat = CAT.STRAIGHT_FLUSH;
        tiebreak = maxOrder(cards);                       // top card decides
      } else if (countVals[0] === 4) {
        cat = CAT.FOUR_OF_A_KIND;
        tiebreak = rankWithCount(counts, 4);              // the quad rank
      } else if (countVals[0] === 3 && countVals[1] === 2) {
        cat = CAT.FULL_HOUSE;
        tiebreak = rankWithCount(counts, 3);              // the triple rank
      } else if (isFlush) {
        cat = CAT.FLUSH;
        // flushes: compare by suit first, then highest rank
        tiebreak = cards[0].suit * 100 + topRank(cards);
      } else if (isStraight) {
        cat = CAT.STRAIGHT;
        tiebreak = maxOrder(cards);                       // top card decides
      } else {
        return null;                                      // 5 cards but not a valid hand
      }

      const key = cat * 100000 + tiebreak;                // category dominates
      return { type: TYPE.FIVE, size: 5, cat, key, label: CAT_NAME[cat], cards };
    }

    return null; // 4 cards or other counts are not legal plays
  }

  function rankWithCount(counts, want) {
    for (const [rank, c] of counts) if (c === want) return rank;
    return 0;
  }

  function topRank(cards) {
    return cards.reduce((m, c) => Math.max(m, c.rank), 0);
  }

  // Can `candidate` legally be played on top of `current`?
  // If current is null (player leads), any legal combo is allowed.
  function beats(candidate, current) {
    if (!candidate) return false;
    if (!current) return true;                  // leading
    if (candidate.type !== current.type) return false;   // must match type & size
    if (candidate.size !== current.size) return false;
    return candidate.key > current.key;
  }

  global.Big2 = global.Big2 || {};
  global.Big2.hands = { TYPE, CAT, CAT_NAME, evaluate, beats };
})(window);
