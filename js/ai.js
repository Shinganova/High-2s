/* ai.js — a strategic Big Two opponent.
 *
 * It reasons about four things instead of just grabbing the lowest legal play:
 *
 *   1. PLAN        — it partitions its hand into the combos it intends to play
 *                    (pairs, triples, straights, …) so it stops shredding a pair
 *                    just to throw one card.
 *   2. CONTROL     — using the cards still unseen, it knows when a card/combo is
 *                    currently UNBEATABLE, and hoards those (especially 2s) to
 *                    seize the lead rather than wasting them early.
 *   3. SHEDDING    — when leading it dumps its weakest *whole* combo, keeping
 *                    control cards for last.
 *   4. ENDGAME     — when an opponent is down to 1–2 cards it stops playing
 *                    minimally and slams control cards to deny them the win.
 *
 * Context (built by game.aiContext):
 *   { toBeat, mustInclude, unseen:[cards], opponents:[{seat,count}] }
 *
 * `chooseMove` returns an array of cards to play, or null to pass.
 */
(function (global) {
  'use strict';

  const H = global.Big2.hands;

  // ---- combination generators ------------------------------------------------

  function kCombinations(arr, k) {
    const result = [];
    const combo = [];
    (function rec(start) {
      if (combo.length === k) { result.push(combo.slice()); return; }
      for (let i = start; i < arr.length; i++) {
        combo.push(arr[i]);
        rec(i + 1);
        combo.pop();
      }
    })(0);
    return result;
  }

  function groupByRank(cards) {
    const m = new Map();
    for (const c of cards) {
      if (!m.has(c.rank)) m.set(c.rank, []);
      m.get(c.rank).push(c);
    }
    return m;
  }

  // Every legal combo in a hand, as evaluated descriptors.
  function allCombos(hand) {
    const combos = [];
    for (const c of hand) combos.push(H.evaluate([c]));               // singles
    for (const group of groupByRank(hand).values()) {                 // pairs/triples
      if (group.length >= 2) for (const p of kCombinations(group, 2)) combos.push(H.evaluate(p));
      if (group.length >= 3) for (const t of kCombinations(group, 3)) combos.push(H.evaluate(t));
    }
    if (hand.length >= 5) {                                           // 5-card hands
      for (const five of kCombinations(hand, 5)) {
        const combo = H.evaluate(five);
        if (combo) combos.push(combo);
      }
    }
    return combos.filter(Boolean);
  }

  // All legal combos that beat `toBeat` (or every combo if leading).
  function legalPlays(hand, toBeat) {
    return allCombos(hand).filter(combo => H.beats(combo, toBeat));
  }

  // ---- hand planning ---------------------------------------------------------

  function makeGroup(cards) {
    const combo = cards.length === 4 ? null : H.evaluate(cards); // 4-of-a-kind isn't a play by itself
    let kind;
    if (cards.length === 4) kind = 'quad';
    else if (combo && combo.type === H.TYPE.FIVE) kind = 'five';
    else if (combo) kind = { 1: 'single', 2: 'pair', 3: 'triple' }[combo.type];
    else kind = 'single';
    return { cards, combo, kind, key: combo ? combo.key : 0, ids: new Set(cards.map(c => c.id)) };
  }

  // Greedily partition a hand into the combos we plan to play. Rank groups become
  // quads/triples/pairs; leftover singletons are merged into straights where
  // possible; the rest stay as singles. Good enough to drive shedding & to avoid
  // breaking combos — not a provably optimal cover.
  function planHand(hand) {
    const groups = [];
    const singles = [];
    for (const cs of groupByRank(hand).values()) {
      if (cs.length >= 2) groups.push(makeGroup(cs.slice()));
      else singles.push(cs[0]);
    }
    // assemble straights (5 distinct consecutive ranks) from the leftover singles
    let pool = singles.slice().sort((a, b) => a.rank - b.rank);
    while (pool.length >= 5) {
      let run = null;
      for (let s = 0; s <= pool.length - 5 && !run; s++) {
        const seq = [pool[s]];
        let last = pool[s].rank;
        for (let j = s + 1; j < pool.length && seq.length < 5; j++) {
          if (pool[j].rank === last + 1) { seq.push(pool[j]); last = pool[j].rank; }
          else if (pool[j].rank > last + 1) break;
        }
        if (seq.length === 5) run = seq;
      }
      if (!run) break;
      groups.push(makeGroup(run));
      const ids = new Set(run.map(c => c.id));
      pool = pool.filter(c => !ids.has(c.id));
    }
    for (const c of pool) groups.push(makeGroup([c]));
    return groups;
  }

  // How much would playing `cards` damage the plan? Breaking a multi-card group
  // (using some but not all of it) costs that group's size; clean plays cost 0.
  function breakCost(cards, plan) {
    const ids = new Set(cards.map(c => c.id));
    let cost = 0;
    for (const g of plan) {
      if (g.cards.length < 2) continue;
      let inG = 0;
      for (const id of ids) if (g.ids.has(id)) inG++;
      if (inG > 0 && inG < g.cards.length) cost += g.cards.length;
    }
    return cost;
  }

  // ---- control / "is this unbeatable right now?" -----------------------------

  function isUnbeatable(combo, unseen) {
    if (combo.type === H.TYPE.SINGLE) {
      return unseen.every(u => u.order < combo.key);
    }
    if (combo.type === H.TYPE.PAIR) {
      for (const cs of groupByRank(unseen).values()) {
        if (cs.length >= 2 && Math.max.apply(null, cs.map(c => c.order)) > combo.key) return false;
      }
      return true;
    }
    if (combo.type === H.TYPE.TRIPLE) {
      for (const [rank, cs] of groupByRank(unseen)) {
        if (cs.length >= 3 && rank > combo.key) return false; // triple key == rank
      }
      return true;
    }
    return false; // 5-card hands: treat as beatable (conservative)
  }

  // ---- decision making -------------------------------------------------------

  function minOpponentCount(ctx) {
    if (!ctx.opponents || !ctx.opponents.length) return Infinity;
    return Math.min.apply(null, ctx.opponents.map(o => o.count));
  }

  function leadMove(hand, ctx) {
    const plan = planHand(hand);

    // Opening play (or any required card): lead the cleanest, lowest combo that
    // contains the mandatory card.
    if (ctx.mustInclude) {
      const opts = legalPlays(hand, null)
        .filter(o => o.cards.some(c => c.order === ctx.mustInclude.order));
      if (opts.length) {
        opts.sort((a, b) => breakCost(a.cards, plan) - breakCost(b.cards, plan) || a.key - b.key);
        return opts[0].cards;
      }
    }

    const playable = plan.filter(g => g.combo); // quads can't be led alone
    if (!playable.length) {                     // pathological (e.g. bare quad) — dump lowest card
      const lo = hand.slice().sort((a, b) => a.order - b.order)[0];
      return [lo];
    }

    // One combo left → play it and win.
    if (playable.length === 1) return playable[0].cards;

    const threat = minOpponentCount(ctx);
    const unbeatable = playable.filter(g => isUnbeatable(g.combo, ctx.unseen));

    // An opponent is nearly out: if we hold an unbeatable combo, lead the
    // smallest one to keep the lead away from them.
    if (threat <= 2 && unbeatable.length) {
      unbeatable.sort((a, b) => a.key - b.key);
      return unbeatable[0].cards;
    }

    // Otherwise shed the weakest whole combo, but save a lone unbeatable control
    // card (e.g. the 2♠) for later if we have any alternative.
    const nonControl = playable.filter(g =>
      !(g.kind === 'single' && isUnbeatable(g.combo, ctx.unseen)));
    const pool = nonControl.length ? nonControl : playable;
    pool.sort((a, b) => a.key - b.key);
    return pool[0].cards;
  }

  function respondMove(hand, ctx) {
    let options = legalPlays(hand, ctx.toBeat);
    if (ctx.mustInclude) {
      options = options.filter(o => o.cards.some(c => c.order === ctx.mustInclude.order));
    }
    if (!options.length) return null; // forced to pass

    const plan = planHand(hand);
    const threat = minOpponentCount(ctx);

    // Endgame: an opponent can go out next turn. Take firm control.
    if (threat <= 1) {
      const unbeatable = options.filter(o => isUnbeatable(o, ctx.unseen));
      if (unbeatable.length) {                    // guarantee the lead
        unbeatable.sort((a, b) => a.key - b.key);
        return unbeatable[0].cards;
      }
      options.sort((a, b) => b.key - a.key);       // else play strongest to pressure
      return options[0].cards;
    }

    // Normal: the minimal beating play that damages the plan least, and avoids
    // wasting a control card when a cheaper one works (lowest key handles that).
    options.sort((a, b) =>
      breakCost(a.cards, plan) - breakCost(b.cards, plan) || a.key - b.key);
    return options[0].cards;
  }

  // ---- difficulty tiers ------------------------------------------------------

  function legalForContext(hand, ctx) {
    let opts = legalPlays(hand, ctx.toBeat);
    if (ctx.mustInclude) {
      opts = opts.filter(o => o.cards.some(c => c.order === ctx.mustInclude.order));
    }
    return opts;
  }

  // EASY — barely strategic: leads a random combo, often over-plays, and folds
  // (passes) about a third of the time even when it could beat the table.
  function easyMove(hand, ctx) {
    const opts = legalForContext(hand, ctx);
    if (!opts.length) return null;
    if (ctx.toBeat && Math.random() < 0.35) return null;       // timid fold
    return opts[Math.floor(Math.random() * opts.length)].cards;
  }

  // MEDIUM — the classic greedy player: leads its lowest single, otherwise makes
  // the minimal beating play. No card tracking or endgame awareness.
  function mediumMove(hand, ctx) {
    const opts = legalForContext(hand, ctx);
    if (!opts.length) return null;
    if (!ctx.toBeat) {
      const singles = opts.filter(o => o.type === H.TYPE.SINGLE);
      const pool = singles.length ? singles : opts;
      pool.sort((a, b) => a.key - b.key);
      return pool[0].cards;
    }
    opts.sort((a, b) => a.key - b.key);
    return opts[0].cards;
  }

  // HARD — the full strategic player (planning + control + endgame).
  function hardMove(hand, ctx) {
    return ctx.toBeat ? respondMove(hand, ctx) : leadMove(hand, ctx);
  }

  // ---- personality engine ----------------------------------------------------
  // A persona's traits flavour an otherwise-strategic core. Table difficulty
  // sets the base skill (how often it plays well vs. blunders); the persona's
  // aggression/patience shape the *style* of its good plays, so two seats at one
  // table still feel different.

  function randItem(a) { return a[Math.floor(Math.random() * a.length)]; }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  const SKILL_BASE = {
    easy:   { skill: 0.20, chaos: 0.60 },
    medium: { skill: 0.72, chaos: 0.18 },
    hard:   { skill: 0.96, chaos: 0.04 }
  };
  function baseFor(diff) { return SKILL_BASE[diff] || SKILL_BASE.hard; }

  function personaMove(hand, ctx) {
    const t = ctx.personality;
    const base = baseFor(ctx.difficulty);
    const skill = clamp01(base.skill + (t.skillMod || 0));
    const chaos = clamp01(base.chaos + (t.chaosMod || 0));
    const aggression = t.aggression != null ? t.aggression : 0.5;
    const patience = t.patience != null ? t.patience : 0.5;

    const opts = legalForContext(hand, ctx);
    if (!opts.length) return null;

    // blunder branch — weaker tables (low skill) misplay more often
    if (Math.random() > skill) {
      if (Math.random() < chaos) {                       // wild: random play / timid fold
        if (ctx.toBeat && Math.random() < 0.25 + patience * 0.25) return null;
        return randItem(opts).cards;
      }
      return mediumMove(hand, ctx);                      // mild: solid but unimaginative
    }

    // smart, personality-flavoured
    return ctx.toBeat
      ? personaRespond(hand, ctx, opts, aggression, patience)
      : personaLead(hand, ctx, aggression);
  }

  function personaRespond(hand, ctx, opts, aggression, patience) {
    const plan = planHand(hand);
    const threat = minOpponentCount(ctx);

    // someone is about to go out — everyone clamps down and takes firm control
    if (threat <= 1) {
      const unb = opts.filter(o => isUnbeatable(o, ctx.unseen));
      if (unb.length) { unb.sort((a, b) => a.key - b.key); return unb[0].cards; }
      opts.sort((a, b) => b.key - a.key);
      return opts[0].cards;
    }

    const smart = opts.slice().sort((a, b) =>
      breakCost(a.cards, plan) - breakCost(b.cards, plan) || a.key - b.key);
    const minimal = smart[0];

    // patient players hoard premium cards (K/A/2) rather than spend them now
    const usesPremium = minimal.cards.some(c => c.rank >= 13);
    if (usesPremium && Math.random() < patience * 0.8) return null;

    // aggressive players seize control instead of dribbling out the minimum
    if (aggression > 0.65 && Math.random() < aggression - 0.5) {
      const byKey = opts.slice().sort((a, b) => b.key - a.key);
      return byKey[0].cards;
    }
    return minimal.cards;
  }

  function personaLead(hand, ctx, aggression) {
    // opening / mandated card: play the cleanest low combo that contains it
    if (ctx.mustInclude) {
      const opts = legalForContext(hand, ctx);
      const plan = planHand(hand);
      opts.sort((a, b) => breakCost(a.cards, plan) - breakCost(b.cards, plan) || a.key - b.key);
      return opts[0].cards;
    }

    const plan = planHand(hand);
    const playable = plan.filter(g => g.combo);
    if (!playable.length) { return [hand.slice().sort((a, b) => a.order - b.order)[0]]; }
    if (playable.length === 1) return playable[0].cards;

    const threat = minOpponentCount(ctx);
    const unbeatable = playable.filter(g => isUnbeatable(g.combo, ctx.unseen));
    if (threat <= 2 && unbeatable.length) {
      unbeatable.sort((a, b) => a.key - b.key);
      return unbeatable[0].cards;
    }

    if (aggression >= 0.7) {
      // dump as many cards as possible: biggest low-ish combo first
      const big = playable.slice().sort((a, b) => b.cards.length - a.cards.length || a.key - b.key);
      return big[0].cards;
    }
    // disciplined shed: lowest combo, saving a lone unbeatable control card
    const nonControl = playable.filter(g =>
      !(g.kind === 'single' && isUnbeatable(g.combo, ctx.unseen)));
    const pool = nonControl.length ? nonControl : playable;
    pool.sort((a, b) => a.key - b.key);
    return pool[0].cards;
  }

  // hand: array of cards; ctx: see file header (+ optional ctx.difficulty and
  // ctx.personality). Returns cards to play or null to pass.
  function chooseMove(hand, ctx) {
    ctx = ctx || {};
    if (ctx.personality) return personaMove(hand, ctx);
    switch (ctx.difficulty) {
      case 'easy': return easyMove(hand, ctx);
      case 'medium': return mediumMove(hand, ctx);
      default: return hardMove(hand, ctx);
    }
  }

  global.Big2 = global.Big2 || {};
  global.Big2.ai = {
    chooseMove, legalPlays, allCombos, planHand, isUnbeatable,
    easyMove, mediumMove, hardMove, personaMove
  };
})(window);
