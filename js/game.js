/* game.js — Big Two game state machine.
 *
 * Players are seated 0..3. Seat 0 is the human; 1,2,3 are AI.
 * Turn order advances 0 -> 1 -> 2 -> 3 -> 0 (skipping finished players).
 *
 * Trick logic: a player either plays a higher combo of the SAME type/size, or
 * passes. When every other active player has passed, the last player to play
 * wins the trick and leads a fresh one with any combo.
 *
 * Win condition (v1): the first player to empty their hand wins.
 */
(function (global) {
  'use strict';

  const C = global.Big2.cards;
  const H = global.Big2.hands;
  const P = global.Big2.personalities;

  // personas: optional array of 3 personality objects for AI seats 1..3
  // (defaults to a fresh random trio).
  function createGame(playerNames, difficulty, personas) {
    const humanName = (playerNames && playerNames[0]) || 'You';
    const roster = personas || P.pickThree();
    const deck = C.shuffle(C.buildDeck());
    const hands = C.deal(deck);

    const players = hands.map((hand, i) => ({
      seat: i,
      name: i === 0 ? humanName : roster[i - 1].name,
      isHuman: i === 0,
      personality: i === 0 ? null : roster[i - 1],
      hand: hand,
      finished: false
    }));

    // The holder of 3♦ leads the opening trick and must include it.
    let starter = 0;
    for (let i = 0; i < players.length; i++) {
      if (players[i].hand.some(C.isThreeOfDiamonds)) { starter = i; break; }
    }

    return {
      players,
      current: starter,        // whose turn it is
      lastPlay: null,          // { seat, combo } currently on the table to beat
      passCount: 0,            // consecutive passes since last play
      openingMove: true,       // first play of the game (must include 3♦)
      winner: null,
      winningCombo: null,      // the combo the winner went out on (for jackpot)
      played: [],              // every card played so far (for AI card-tracking)
      difficulty: difficulty || 'hard',
      log: []
    };
  }

  // Build the situational context an AI (or hint) needs for the current player:
  // what to beat, the mandatory opening card, the cards still unseen by this
  // player (own hand + played pile removed from the full deck), and live
  // opponents' hand sizes.
  function aiContext(game) {
    const seat = game.current;
    const me = game.players[seat];
    const seen = new Set(me.hand.map(c => c.id));
    for (const c of game.played) seen.add(c.id);
    const unseen = C.buildDeck().filter(c => !seen.has(c.id));
    const opponents = game.players
      .filter(p => p.seat !== seat && !p.finished)
      .map(p => ({ seat: p.seat, count: p.hand.length }));
    return {
      toBeat: game.lastPlay ? game.lastPlay.combo : null,
      mustInclude: game.openingMove ? threeOfDiamonds(game) : null,
      unseen,
      opponents,
      difficulty: game.difficulty,
      personality: me.personality
    };
  }

  function activeCount(game) {
    return game.players.filter(p => !p.finished).length;
  }

  function nextSeat(game, from) {
    let s = from;
    do { s = (s + 1) % 4; } while (game.players[s].finished);
    return s;
  }

  function threeOfDiamonds(game) {
    for (const p of game.players) {
      const card = p.hand.find(C.isThreeOfDiamonds);
      if (card) return card;
    }
    return null;
  }

  // Validate (but don't apply) a proposed play by the current player.
  // Returns { ok:true, combo } or { ok:false, reason }.
  function validatePlay(game, cards) {
    const combo = H.evaluate(cards);
    if (!combo) return { ok: false, reason: 'That is not a legal combination.' };

    if (!H.beats(combo, game.lastPlay ? game.lastPlay.combo : null)) {
      if (game.lastPlay && combo.type !== game.lastPlay.combo.type) {
        return { ok: false, reason: 'Must match the play type (and size) on the table.' };
      }
      return { ok: false, reason: 'That play does not beat the table.' };
    }

    if (game.openingMove) {
      const has3d = cards.some(C.isThreeOfDiamonds);
      if (!has3d) return { ok: false, reason: 'The opening play must include the 3♦.' };
    }

    return { ok: true, combo };
  }

  // Apply a validated play for the current player. Returns the combo played.
  function applyPlay(game, cards) {
    const seat = game.current;
    const player = game.players[seat];
    const combo = H.evaluate(cards);

    // remove the played cards from the hand and record them on the played pile
    const ids = new Set(cards.map(c => c.id));
    player.hand = player.hand.filter(c => !ids.has(c.id));
    for (const c of cards) game.played.push(c);

    game.lastPlay = { seat, combo };
    game.passCount = 0;
    game.openingMove = false;
    game.log.push(`${player.name} played ${describe(combo)}.`);

    if (player.hand.length === 0) {
      player.finished = true;
      game.winner = seat;
      game.winningCombo = combo;
      game.log.push(`${player.name} went out and wins! 🎉`);
      return combo;
    }

    game.current = nextSeat(game, seat);
    return combo;
  }

  // Current player passes. Returns true if the pass ended the trick.
  function applyPass(game) {
    const seat = game.current;
    game.log.push(`${game.players[seat].name} passed.`);
    game.passCount++;

    // Everyone else (active - 1) has passed -> trick winner leads anew.
    if (game.lastPlay && game.passCount >= activeCount(game) - 1) {
      const winnerSeat = game.lastPlay.seat;
      game.lastPlay = null;
      game.passCount = 0;
      // The trick winner leads; if they already finished, pass to next active.
      game.current = game.players[winnerSeat].finished
        ? nextSeat(game, winnerSeat)
        : winnerSeat;
      game.log.push(`${game.players[game.current].name} leads the next trick.`);
      return true;
    }

    game.current = nextSeat(game, seat);
    return false;
  }

  function describe(combo) {
    if (combo.type === H.TYPE.FIVE) return combo.label;
    return combo.label + ' (' + combo.cards.map(c => c.label + c.symbol).join(' ') + ')';
  }

  global.Big2 = global.Big2 || {};
  global.Big2.game = {
    createGame, validatePlay, applyPlay, applyPass,
    threeOfDiamonds, describe, nextSeat, aiContext
  };
})(window);
