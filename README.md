# High 2s — Big Two

A browser card game of **Big Two** (a.k.a. High 2s): you vs. three AI opponents.
Pure HTML / CSS / Canvas / vanilla JavaScript — **no build step, no dependencies.**

## Play

Double-click **`index.html`** (or open it in any modern browser).

> If your browser blocks something over `file://`, run a tiny local server instead:
> `python -m http.server` then visit <http://localhost:8000>.

1. In the **lobby**, pick a table (each has a difficulty and stakes). A table is
   locked until your bankroll clears its "min to sit" requirement.
2. At the table:
   - **Click a card** to select it (selected cards lift up).
   - **Drag a card** sideways to rearrange your hand into your own groups (mouse or touch).
   - **Play** the selected combo, or **Pass**.
   - **Sort** re-orders by strength; **Hint** highlights a strong move; **← Lobby** leaves.
3. When the hand ends you settle up, your bankroll updates, and you can **Play
   again** or go **Back to lobby**.

Your bankroll is saved in `localStorage` between sessions. Broke? Use **Reset
bankroll** in the lobby.

## Tables, difficulty & money

Three tables, each with its own AI strength and stakes:

| Table | Difficulty | Stake | Card values | Max payout | Min bankroll to sit |
|-------|-----------|-------|-------------|-----------|---------------------|
| Sunny Pier    | **Easy** — misplays, folds randomly | 1  | $3–$15   | $540    | $1,620  |
| Downtown Club | **Medium** — minimal, no card tracking | 5  | $15–$75  | $2,700  | $8,100  |
| Skyline Room  | **Hard** — full strategic AI | 20 | $60–$300 | $10,800 | $32,400 |

Money rules:

- **Each card is worth `rank × stake`** (a `3` is cheapest, a `2` the dearest).
- At hand's end, every player still holding cards pays the **winner** the value
  of each card left in hand.
- **Caught holding all 13 cards** (you never played one) → you pay **triple**.
- **Max payout** = the worst one player can lose = `3 × (value of the 13 highest cards)`.
- **Min to sit** = `3 × max payout` — the reserve you must keep to take a seat.

### Dragon jackpots

Two **progressive jackpots** are fed by a **rake from every hand's pot** and are
shown in the header on every screen (lobby and table). They are **shared across
every player** — one global pool that everyone contributes to and any player can
hit. The header updates **live** as other people play.

| Jackpot | Won when… | Rake | Default seed |
|---------|-----------|------|--------------|
| 🐉 **Golden Dragon** | your **starting hand** is a full 13-rank straight (one of every rank) | 4% of pot | $3,000 |
| 🐉 **Emerald Dragon** | your **starting hand** is a full single-suit straight flush (the whole suit) | 3% of pot | $10,000 |

**The rake** comes out of the pot: losers pay their full penalty, the **winner
collects the pot minus the rake**, and the rake feeds the two pools. Each jackpot
is checked on the **dealt hand** at the start of each hand; the whole shared pool
is added to your bankroll and reseeds for everyone. A full straight flush is also
a full straight, so **Emerald takes precedence** over Golden (they never both pay
for one deal). Rates, seeds, and the winning conditions all live in
`js/economy.js`.

The pools live in a single Firestore document, `jackpots/global`. Clients **read**
it live (`onSnapshot`) but **cannot write** it — the security rules deny client
writes. All growth and payouts go through **Cloud Functions** (`functions/`):

- `contributeJackpots({jackpotGolden, jackpotEmerald})` — adds the per-hand rake
  inside a transaction, **clamped** to a per-field cap and floored at the seed.
- `claimJackpot({field})` — resets a pool to its seed and reports the winnings.

This makes the shared pool **tamper-proof**: one player can't set it to arbitrary
values for everyone. Bankroll and stats remain **per-user** (client-written; only
affect that player). See `functions/index.js`. Deploying the functions requires
the Firebase **Blaze** plan (see setup below).

(All of this lives in `js/economy.js` — stakes, starting bankroll, jackpots, and
the multipliers are one-line tweaks.)

## Rules implemented

- **Card order (high→low):** `2 A K Q J 10 9 8 7 6 5 4 3`
- **Suit order (high→low):** `♠ Spades > ♥ Hearts > ♣ Clubs > ♦ Diamonds` (Classic / Spades-high)
- The holder of the **3♦ leads first** and must include it in the opening play.
- On your turn, beat the table with a **stronger combo of the same shape**, or pass:
  - single · pair · triple · 5-card hand
- **5-card hands (low→high):** straight < flush < full house < four-of-a-kind+1 < straight flush
- When all other active players pass, the last player to play **leads a new trick** with anything.
- **Win:** first to empty their hand.

### Straight ruleset (a deliberate choice)

Straights are five **consecutive rank values**. Since `2` is the highest rank, the
lowest straight is `3-4-5-6-7` and the highest is `J-Q-K-A-2`. Wheel straights
(`A-2-3-4-5`, `2-3-4-5-6`) are **not** used. To change this, edit only
`detectStraight()` in `js/hands.js`.

## Accounts & cloud save (Firebase)

**Google sign-in is required to play.** Your bankroll, profile, and hands-played
are saved to your account (Firestore) and follow you across devices. There is no
guest mode — the app must be wired to a Firebase project before anyone can play.

Setup (free, one time):

1. Create a project at <https://console.firebase.google.com>.
2. Add a **Web App** (the `</>` icon) and copy its config into
   `js/firebase-config.js` (replacing the `REPLACE_WITH_…` placeholders).
3. **Authentication → Sign-in method →** enable **Google**.
4. **Firestore Database →** create a database.
5. **Authentication → Settings → Authorized domains:** add `localhost` and your
   deploy domain (e.g. `your-site.netlify.app`).
6. **Deploy the rules + Cloud Functions** (the functions own the shared jackpot
   pool). This step needs the **Blaze** plan — see below.

Until these keys are filled in, the login gate shows a "not configured" message
and the game can't be entered.

### Cloud Functions (shared jackpots)

The shared jackpot pool is written only by Cloud Functions, so clients can't
tamper with it. Deploying functions requires the Firebase **Blaze** (pay-as-you-go)
plan — it has a large free tier, so this app should cost ~$0, but a billing
account is required.

```sh
npm install -g firebase-tools      # once
firebase login                     # once
cd functions && npm install && cd ..
firebase deploy --only functions,firestore:rules
```

`firebase.json` and `.firebaserc` (project `high2s`) are included. The deploy
publishes `firestore.rules` and the two callables (`contributeJackpots`,
`claimJackpot`) to the default region **us-central1** (the client expects that
region — keep it unless you also change `getFunctions` in `js/auth.js`).

> Want to avoid Blaze? You can instead make the jackpots client-written again
> (revert `js/auth.js` to direct Firestore writes and allow `write` on
> `jackpots/{id}` in `firestore.rules`) — simpler, but the shared pool is then
> tamperable.

Data model — a per-user profile plus one shared jackpot document:

```
users/{uid}     { displayName, email, photoURL, bankroll, handsPlayed, updatedAt }
jackpots/global { jackpotGolden, jackpotEmerald }   // shared by all players
```

The SDK loads lazily from Google's CDN, only once a real config is present.
Sign-in uses a popup, so test over `http://localhost` (a server, not `file://`)
— see **Play** above.

## Project layout

```
index.html           lobby + game markup, script load order
css/styles.css        table / lobby / settlement styling
js/cards.js            deck model: ranks, suits, shuffle, deal
js/hands.js            rules engine: detect & compare combinations
js/ai.js               AI: easy / medium / hard tiers + personality engine
js/personalities.js    named opponents with play-style traits
js/game.js             state machine: turns, tricks, passing, win, AI context
js/economy.js          card values, payouts, settlement, bankroll persistence
js/ui.js               Canvas rendering + click / drag-reorder + card values
js/firebase-config.js  YOUR Firebase web-app keys (placeholder by default)
js/auth.js             Google sign-in + Firestore facade (window.Big2.auth)
js/main.js             lobby flow, bankroll, turn loop, settlement, input
functions/index.js     Cloud Functions: server-owned shared jackpot pool
functions/package.json Cloud Functions dependencies (firebase-admin/functions)
firebase.json          Firebase deploy config (firestore rules + functions)
.firebaserc            Firebase project alias (high2s)
firestore.rules        security rules: per-user docs + read-only shared jackpots
test/engine.test.js    rules-engine tests
test/ai.test.js        AI behaviour tests
test/drag.test.js      hand drag-reorder math tests
test/economy.test.js   card-value, payout & settlement tests
test/personality.test.js  persona selection & trait-driven behaviour tests
```

## Tests

```
node test/engine.test.js     # rules engine
node test/ai.test.js          # AI behaviour
node test/drag.test.js        # hand drag-reorder math
node test/economy.test.js     # card values, payouts, settlement
```

## Opponents & personalities

Each table seats **three named personalities** (`js/personalities.js`), drawn at
random per sitting so the line-up varies — Steady Eddie, Reckless Rae, Bluffer
Bo, The Professor, Lucky Lou, Granny Smith, Hot-Hand Hank, Cool Hand Kim. Their
names are shown on each seat's panel at the table.

Personalities aren't cosmetic — their traits change how they play on top of the
table's skill tier:

- **aggression** — low players dribble out the minimum and hoard; high players
  dump big combos and seize control of tricks.
- **patience** — patient players sit back, pass, and hoard premium cards (K/A/2)
  for the perfect moment; impatient ones spend them freely.
- **skill / chaos nudges** — make two seats at the *same* table feel different
  (a sharper or looser version of that tier).

So at one Hard table, patient **Granny Smith** clings to her aces while
**Hot-Hand Hank** blasts them immediately — measurably different behaviour, not
just different labels.

### Bot bankrolls & bust-outs

Each opponent sits down with **their own bankroll** (shown on their seat panel at
the table). Settlement is full and zero-sum: the winner collects from every
loser, so bots gain and lose money hand to hand. When a bot's bankroll falls
**below the table's minimum buy-in, they bust out and leave**, and a fresh
opponent with a different name takes the empty seat. The **Table history** side
box logs every hand (winner + pot + your result) and every seat change.

## The AI

Underneath the personalities, the opponents (`js/ai.js`) reason about four
things rather than grabbing the lowest legal play:

1. **Plan** — partition the hand into the combos it intends to play, so it won't
   shred a pair or straight just to throw one card.
2. **Control** — using the cards still unseen, it knows when a card/combo is
   currently *unbeatable* and hoards those (especially 2s) to seize the lead.
3. **Shedding** — when leading it dumps its weakest *whole* combo and keeps
   control cards for last.
4. **Endgame** — when an opponent is down to 1–2 cards it stops playing
   minimally and slams control cards to deny them the win.

In a head-to-head benchmark this wins **~35%** of games against three copies of
a naive greedy AI (a fair game is 25%).

## Ideas for next versions

- Even stronger AI (search/look-ahead, modelling opponents' likely holdings)
- Scoring across rounds (penalty per card left in hand)
- Configurable variants (Hearts-high, wheel straights, 2-player rules)
- Online multiplayer
- Card play animations & sound
```
