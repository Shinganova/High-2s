/* cards.js — Big Two deck model
 *
 * Rank values (single-card strength), 2 is the highest single:
 *   3,4,5,6,7,8,9,10,J,Q,K,A,2  ->  3,4,5,6,7,8,9,10,11,12,13,14,15
 *
 * Suit values (Classic / Spades-high):
 *   Diamonds < Clubs < Hearts < Spades  ->  0,1,2,3
 *
 * Every card has a unique "order" value = rank*4 + suit, so 3 of Diamonds
 * is the weakest card (12) and 2 of Spades is the strongest (63).
 */
(function (global) {
  'use strict';

  const SUITS = ['D', 'C', 'H', 'S'];                 // index = suit value
  const SUIT_SYMBOL = { D: '♦', C: '♣', H: '♥', S: '♠' };
  const SUIT_NAME = { D: 'Diamonds', C: 'Clubs', H: 'Hearts', S: 'Spades' };
  const RED_SUITS = { D: true, H: true };

  // rank value -> display label
  const RANK_LABEL = {
    3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
    10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2'
  };

  function makeCard(rank, suit) {
    // suit is an index 0..3
    return {
      rank: rank,                 // 3..15
      suit: suit,                 // 0..3
      suitCode: SUITS[suit],      // 'D'|'C'|'H'|'S'
      order: rank * 4 + suit,     // unique comparable strength
      label: RANK_LABEL[rank],
      symbol: SUIT_SYMBOL[SUITS[suit]],
      red: !!RED_SUITS[SUITS[suit]],
      id: RANK_LABEL[rank] + SUITS[suit]
    };
  }

  function buildDeck() {
    const deck = [];
    for (let rank = 3; rank <= 15; rank++) {
      for (let suit = 0; suit <= 3; suit++) {
        deck.push(makeCard(rank, suit));
      }
    }
    return deck; // 52 cards
  }

  // Fisher-Yates shuffle (in place)
  function shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }
    return deck;
  }

  // Deal 13 cards to each of 4 hands
  function deal(deck) {
    const hands = [[], [], [], []];
    for (let i = 0; i < deck.length; i++) {
      hands[i % 4].push(deck[i]);
    }
    hands.forEach(sortHand);
    return hands;
  }

  // Sort a hand low -> high by overall strength
  function sortHand(hand) {
    hand.sort((a, b) => a.order - b.order);
    return hand;
  }

  function isThreeOfDiamonds(card) {
    return card.rank === 3 && card.suitCode === 'D';
  }

  global.Big2 = global.Big2 || {};
  global.Big2.cards = {
    SUITS, SUIT_SYMBOL, SUIT_NAME, RANK_LABEL,
    makeCard, buildDeck, shuffle, deal, sortHand, isThreeOfDiamonds
  };
})(window);
