/* personalities.js — named AI opponents with distinct play styles.
 *
 * Traits (0..1) the AI reads at decision time:
 *   aggression — low: dribble out the minimum & hoard; high: dump big combos
 *                and seize control of tricks.
 *   patience   — high: sit back, pass, and hoard premium cards (K/A/2) for the
 *                perfect moment; low: spend them freely.
 *   skillMod   — nudges the table's base skill so two seats at the SAME table
 *                still differ (a sharper or looser version of that tier).
 *   chaosMod   — nudges how often they make a wild, unpredictable play.
 *
 * Three distinct personas are drawn per table sitting, so the seat line-up
 * varies from table to table and game to game.
 */
(function (global) {
  'use strict';

  const PERSONAS = [
    { id: 'eddie',  name: 'Steady Eddie',  tagline: 'Patient and tight — never wastes a card.',
      aggression: 0.25, patience: 0.80, skillMod: +0.04, chaosMod: -0.03 },
    { id: 'rae',    name: 'Reckless Rae',  tagline: 'Dumps big and pushes every edge.',
      aggression: 0.92, patience: 0.15, skillMod: -0.05, chaosMod: +0.08 },
    { id: 'bo',     name: 'Bluffer Bo',    tagline: 'Sits back, then pounces.',
      aggression: 0.50, patience: 0.88, skillMod: 0.00, chaosMod: +0.04 },
    { id: 'prof',   name: 'The Professor', tagline: 'Counts every card you play.',
      aggression: 0.50, patience: 0.60, skillMod: +0.06, chaosMod: -0.04 },
    { id: 'lou',    name: 'Lucky Lou',     tagline: 'Runs on pure instinct.',
      aggression: 0.65, patience: 0.30, skillMod: -0.08, chaosMod: +0.18 },
    { id: 'granny', name: 'Granny Smith',  tagline: 'Waits all day for the perfect moment.',
      aggression: 0.20, patience: 0.92, skillMod: +0.02, chaosMod: -0.05 },
    { id: 'hank',   name: 'Hot-Hand Hank', tagline: 'Always attacking, never folding.',
      aggression: 0.95, patience: 0.10, skillMod: -0.03, chaosMod: +0.05 },
    { id: 'kim',    name: 'Cool Hand Kim', tagline: 'Reads the table and strikes clean.',
      aggression: 0.60, patience: 0.55, skillMod: +0.05, chaosMod: -0.03 }
  ];

  // Three distinct personas, shuffled (Fisher-Yates on a copy).
  function pickThree() {
    const pool = PERSONAS.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    return pool.slice(0, 3);
  }

  function byId(id) { return PERSONAS.find(p => p.id === id) || null; }

  // A random persona whose id is not in `usedIds` (a Set). Used to seat a fresh
  // opponent when one busts out. Falls back to any persona if all are in use.
  function pickExcluding(usedIds) {
    const free = PERSONAS.filter(p => !usedIds.has(p.id));
    const pool = free.length ? free : PERSONAS;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  global.Big2 = global.Big2 || {};
  global.Big2.personalities = { PERSONAS, pickThree, byId, pickExcluding };
})(window);
