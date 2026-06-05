/* economy.js — play-money model for High 2s.
 *
 * CARD VALUE   value(card) = card.rank (3..15) * table.stake
 *              → a 3 is worth 3·stake, a 2 (highest rank) is worth 15·stake.
 *
 * SETTLEMENT   When a game ends, every player still holding cards is "caught".
 *              A caught player pays the value of each card left in hand.
 *              CAUGHT WITH ALL 13 CARDS (never played one) → pay TRIPLE.
 *              The winner (empty hand) collects every loser's penalty.
 *
 * TABLE ECONOMY
 *              maxPayout(stake) = the worst a single player can lose
 *                               = 3 × value of the 13 highest cards in the deck.
 *              minToSit(stake)  = 3 × maxPayout  — the bankroll you must keep to
 *                                 sit (so you can always cover a bad night).
 *
 * Only the human keeps a persistent bankroll (saved in localStorage); the AIs
 * are the opposition. Settlement is computed from the human's perspective.
 */
(function (global) {
  'use strict';

  const C = global.Big2.cards;
  const FULL_HAND = 13;       // dealt size; holding this many = never played
  const TRIPLE = 3;           // "caught with everything" multiplier

  function cardValue(card, stake) { return card.rank * stake; }

  function handValue(hand, stake) {
    return hand.reduce((sum, c) => sum + cardValue(c, stake), 0);
  }

  // Sum of the 13 highest card values in a full deck (theoretical worst hand).
  function topHandValue(stake) {
    const ranks = C.buildDeck().map(c => c.rank).sort((a, b) => b - a).slice(0, FULL_HAND);
    return ranks.reduce((s, r) => s + r, 0) * stake; // = 180 * stake
  }

  function maxPayout(stake) { return TRIPLE * topHandValue(stake); }
  function minToSit(stake) { return TRIPLE * maxPayout(stake); }

  // What a caught player owes the winner.
  function penalty(hand, stake) {
    const base = handValue(hand, stake);
    return hand.length >= FULL_HAND ? base * TRIPLE : base;
  }

  // Settle a finished game for EVERY seat. The winner collects the pot (the sum
  // of all losers' penalties); each loser pays its own penalty.
  // Returns { winnerSeat, pot, deltas:[per-seat net], humanDelta, rows }.
  function settle(game, stake) {
    const rows = game.players.map(p => ({
      seat: p.seat,
      name: p.name,
      count: p.hand.length,
      caughtAll: p.hand.length >= FULL_HAND,
      winner: p.seat === game.winner,
      penalty: p.seat === game.winner ? 0 : penalty(p.hand, stake)
    }));

    const pot = rows.reduce((s, r) => s + r.penalty, 0);
    const deltas = rows.map(r => (r.winner ? pot : -r.penalty));
    rows.forEach((r, i) => { r.delta = deltas[i]; });

    return { winnerSeat: game.winner, pot, deltas, humanDelta: deltas[0], rows };
  }

  // ---- tables ---------------------------------------------------------------
  const TABLES = [
    {
      id: 'beginner', name: 'Sunny Pier', tier: 'Beginner',
      difficulty: 'easy', stake: 1,
      blurb: 'Friendly amateurs. They misplay and fold under pressure.'
    },
    {
      id: 'standard', name: 'Downtown Club', tier: 'Standard',
      difficulty: 'medium', stake: 5,
      blurb: 'Tight regulars who never waste a beating card.'
    },
    {
      id: 'highroller', name: 'Skyline Room', tier: 'High Roller',
      difficulty: 'hard', stake: 20,
      blurb: 'Sharks: they track every card and punish your mistakes.'
    }
  ];
  function tableById(id) { return TABLES.find(t => t.id === id) || null; }

  // ---- bankroll persistence -------------------------------------------------
  const KEY = 'big2_bankroll';
  const START = 3000;

  function loadBankroll() {
    try {
      const v = parseInt(global.localStorage.getItem(KEY), 10);
      return Number.isFinite(v) ? v : START;
    } catch (e) { return START; }
  }
  function saveBankroll(v) {
    try { global.localStorage.setItem(KEY, String(Math.round(v))); } catch (e) { /* ignore */ }
  }

  global.Big2 = global.Big2 || {};
  global.Big2.economy = {
    FULL_HAND, TRIPLE, cardValue, handValue, topHandValue, maxPayout, minToSit,
    penalty, settle, TABLES, tableById, START, loadBankroll, saveBankroll
  };
})(window);
