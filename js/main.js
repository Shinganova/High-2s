/* main.js — wires engine, AI, economy, and UI; runs the lobby + turn loop. */
(function (global) {
  'use strict';

  const Big2 = global.Big2;
  const G = Big2.game;
  const C = Big2.cards;
  const H = Big2.hands;
  const Eco = Big2.economy;
  const Persona = Big2.personalities;

  const AI_DELAY = 750; // ms between AI moves, for readability

  let game, ui, selected, drag = null;
  let actionPress = null;     // 'play'/'pass' while the on-felt button is held
  let hoveredId = null;       // card under the cursor (mouse hover lift)
  let bankroll = 0;
  let currentTable = null;
  let bots = [];              // [{ persona, bankroll }] for seats 1..3
  let history = [];           // newest-first list of played hands / seat changes
  let handNo = 0;

  // account / persistence
  let profile = null;         // Google profile { uid, name, email, photo }; null = signed out
  let profileLoaded = false;  // has the Firestore profile (bankroll/stats) arrived yet?
  let stats = { handsPlayed: 0 };
  // The Dragon jackpots are SHARED across all players (one global Firestore
  // doc). These locals mirror the latest live snapshot for display + payout.
  let jackpotGolden = 0;     // Golden Dragon — won on a full-straight starting hand
  let jackpotEmerald = 0;    // Emerald Dragon — won on a full-straight-flush starting hand
  let jackpotsReady = false; // has the first live jackpot snapshot arrived?
  let jpUnsub = null;        // unsubscribe handle for the live jackpot subscription
  let saveTimer = null;       // debounce handle for cloud writes

  function jackpotSeeds() {
    return {
      jackpotGolden: Eco.GOLDEN_SEED,
      jackpotEmerald: Eco.EMERALD_SEED
    };
  }

  // Live snapshot of the shared pools → update locals + header.
  function onJackpots(data) {
    if (Number.isFinite(data.jackpotGolden)) jackpotGolden = data.jackpotGolden;
    if (Number.isFinite(data.jackpotEmerald)) jackpotEmerald = data.jackpotEmerald;
    jackpotsReady = true;
    updateJackpot();
  }

  function subscribeJackpots() {
    if (!global.Big2.auth || !global.Big2.auth.watchJackpots) return;
    if (jpUnsub) { jpUnsub(); jpUnsub = null; }
    // show "…" until the first live snapshot arrives — never flash the seed
    jackpotsReady = false;
    const s = jackpotSeeds();
    jackpotGolden = s.jackpotGolden; jackpotEmerald = s.jackpotEmerald; // payout fallback
    updateJackpot();
    Promise.resolve(global.Big2.auth.watchJackpots(s, onJackpots))
      .then(unsub => { jpUnsub = unsub; })
      .catch(e => console.error('Jackpot subscribe failed:', e));
  }

  function unsubscribeJackpots() {
    if (jpUnsub) { jpUnsub(); jpUnsub = null; }
    jackpotsReady = false;
    updateJackpot();
  }

  // Contribute to the shared pools (server-side atomic increment). The live
  // snapshot reflects the new totals; nothing to update locally here.
  function growJackpots(deltas) {
    if (global.Big2.auth && global.Big2.auth.growJackpots) {
      global.Big2.auth.growJackpots(deltas).catch(e => console.error('Jackpot grow failed:', e));
    }
  }

  // Claim a shared pool: the server resets it to its seed. Caller has already
  // added the winnings to the bankroll. Optimistically reset the local mirror.
  function claimJackpot(field, seed) {
    if (field === 'jackpotGolden') jackpotGolden = seed;
    else if (field === 'jackpotEmerald') jackpotEmerald = seed;
    updateJackpot();
    if (global.Big2.auth && global.Big2.auth.resetJackpot) {
      global.Big2.auth.resetJackpot(field).catch(e => console.error('Jackpot reset failed:', e));
    }
  }

  const els = {};

  function $(id) { return document.getElementById(id); }
  function setMessage(msg) { els.message.textContent = msg; }
  function money(n) { return Math.round(n).toLocaleString('en-US'); }

  function updateWallet() {
    els.bankroll.textContent = profileLoaded ? '$' + money(bankroll) : '…';
  }
  function updateJackpot() {
    els.jpGolden.textContent = jackpotsReady ? '$' + money(jackpotGolden) : '…';
    els.jpEmerald.textContent = jackpotsReady ? '$' + money(jackpotEmerald) : '…';
  }

  function closeJackpotDescs() {
    if (!els.jackpots || !els.jackpots.querySelectorAll) return;
    els.jackpots.querySelectorAll('.jp.open').forEach(p => p.classList.remove('open'));
  }

  // ============================ ACCOUNTS =====================================
  // Google login is REQUIRED. Signed-in players have their bankroll + stats
  // saved to Firestore (via Big2.auth). There is no guest mode — without a
  // configured Firebase project the login gate explains what's missing.

  function setupAuth() {
    const auth = global.Big2.auth;

    els.google.addEventListener('click', () => {
      if (!auth || !auth.configured) return;
      setAuthNote('Opening Google sign-in…');
      console.time('[auth] google popup');
      auth.signIn()
        .then(() => console.timeEnd('[auth] google popup'))
        .catch(err => { console.timeEnd('[auth] google popup'); setAuthNote(authError(err)); });
    });
    els.signout.addEventListener('click', onSignOut);

    if (!auth || !auth.configured) {
      els.google.disabled = true;
      setAuthNote('Google login isn’t configured yet — add your Firebase keys ' +
        'in js/firebase-config.js to enable sign-in.');
    }
    if (auth) auth.onChange(onAuthChange);
    showAuthGate();
  }

  // Fired by Big2.auth on sign-in (profile) and sign-out / signed-out (null).
  function onAuthChange(p) {
    if (p) {
      profile = p;
      profileLoaded = false;
      bankroll = Eco.START;          // provisional until the real value loads
      stats.handsPlayed = 0;
      // Reveal the app immediately — don't make the user wait on a Firestore
      // read. The lobby's "Sit down" buttons stay disabled until the real
      // bankroll arrives (loadProfileInBackground re-renders it).
      subscribeJackpots();           // shared pools, live across all players
      showProfile();
      hideAuthGate();
      showLobby();
      loadProfileInBackground();
    } else {                         // signed out (or never signed in) → gate
      profile = null;
      profileLoaded = false;
      unsubscribeJackpots();
      els.profile.hidden = true;
      // keep the "not configured" hint; only clear status once sign-in is live
      if (global.Big2.auth && global.Big2.auth.configured) setAuthNote('');
      showAuthGate();
    }
  }

  // Load the per-user profile (bankroll/stats) after the UI is already shown.
  async function loadProfileInBackground() {
    const signedInAs = profile;
    let data = null;
    console.time('[auth] profile load');
    try { data = await global.Big2.auth.loadProfile(); }
    catch (e) { console.error(e); }
    console.timeEnd('[auth] profile load');
    if (profile !== signedInAs) return;   // signed out / switched while loading
    if (data && Number.isFinite(data.bankroll)) {
      bankroll = data.bankroll;
      stats.handsPlayed = data.handsPlayed || 0;
    } else {                                // first sign-in → seed a fresh profile
      bankroll = Eco.START;
      stats.handsPlayed = 0;
      saveProfileNow();
    }
    profileLoaded = true;
    updateWallet();
    if (!game) renderLobby();               // enable "Sit down" with the real bankroll
  }

  function onSignOut() {
    if (global.Big2.auth) global.Big2.auth.signOut(); // onAuthChange(null) does the UI
  }

  function showProfile() {
    els.profile.hidden = false;
    els.pfName.textContent = (profile && (profile.name || profile.email)) || 'Player';
    if (profile && profile.photo) { els.pfAvatar.src = profile.photo; els.pfAvatar.hidden = false; }
    else els.pfAvatar.hidden = true;
  }

  function showAuthGate() {
    els.authGate.hidden = false;
    els.lobby.hidden = true;
    els.game.hidden = true;
    els.settlement.hidden = true;
  }
  function hideAuthGate() { els.authGate.hidden = true; }
  function setAuthNote(msg) { els.authNote.textContent = msg || ''; }

  function authError(err) {
    const code = err && err.code || '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request')
      return 'Sign-in cancelled.';
    if (code === 'auth/unauthorized-domain')
      return 'This domain isn’t authorized in Firebase (Authentication → Settings → Authorized domains).';
    return 'Sign-in failed: ' + (err && err.message || code || 'unknown error');
  }

  // Persist the bankroll + stats to Firestore (debounced so a burst of updates
  // becomes a single write).
  function persist() {
    if (!profile || !global.Big2.auth) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveProfileNow, 400);
  }
  function saveProfileNow() {
    if (!profile || !global.Big2.auth) return;
    global.Big2.auth.saveProfile({
      displayName: profile.name,
      email: profile.email,
      photoURL: profile.photo,
      bankroll: Math.round(bankroll),
      handsPlayed: stats.handsPlayed
    }).catch(e => console.error('Cloud save failed:', e));
  }

  // ============================ LOBBY ========================================

  function showLobby() {
    currentTable = null;
    game = null;
    els.game.hidden = true;
    els.lobby.hidden = false;
    els.settlement.hidden = true;
    renderLobby();
    updateWallet();
  }

  function renderLobby() {
    els.tableList.innerHTML = Eco.TABLES.map(t => {
      const maxPay = Eco.maxPayout(t.stake);
      const sit = Eco.minToSit(t.stake);
      const loading = !profileLoaded;        // bankroll not in yet → don't let them sit
      const locked = loading || bankroll < sit;
      const lo = Eco.cardValue({ rank: 3 }, t.stake);
      const hi = Eco.cardValue({ rank: 15 }, t.stake);
      const label = loading ? 'Loading…' : (locked ? 'Locked' : 'Sit down');
      return `
        <div class="table-card ${locked ? 'locked' : ''}">
          <span class="tc-tier tier-${t.difficulty}">${t.tier}</span>
          <div class="tc-name">${t.name}</div>
          <div class="tc-blurb">${t.blurb}</div>
          <dl>
            <dt>Card value</dt><dd>$${lo} – $${hi}</dd>
            <dt>Max payout</dt><dd>$${money(maxPay)}</dd>
            <dt>Min to sit</dt><dd>$${money(sit)}</dd>
          </dl>
          <button class="tc-sit primary" data-id="${t.id}" ${locked ? 'disabled' : ''}>
            ${label}
          </button>
          ${!loading && bankroll < sit ? `<p class="tc-lock">Need $${money(sit)} bankroll to sit</p>` : ''}
        </div>`;
    }).join('');
  }

  // A fresh opponent's starting stack: enough to sit, with random "wealth".
  function botStack(stake) {
    return Math.round(Eco.minToSit(stake) * (1.8 + Math.random() * 1.6));
  }

  function sitDown(tableId) {
    const table = Eco.tableById(tableId);
    if (!table) return;
    if (bankroll < Eco.minToSit(table.stake)) { renderLobby(); return; }
    currentTable = table;
    // seat three opponents, each with their own bankroll
    bots = Persona.pickThree().map(p => ({ persona: p, bankroll: botStack(table.stake) }));
    history = [];
    handNo = 0;
    ui.valueFn = card => Eco.cardValue(card, table.stake);
    els.lobby.hidden = true;
    els.game.hidden = false;
    els.bannerName.textContent = table.name + ' · ' + table.tier;
    els.bannerStakes.textContent = 'cards worth $' + Eco.cardValue({ rank: 3 }, table.stake) +
      '–$' + Eco.cardValue({ rank: 15 }, table.stake);
    renderHistory();
    startHand();
  }

  function renderHistory() {
    if (!history.length) {
      els.historyList.innerHTML = '<p class="hist-empty">No hands played yet.</p>';
      return;
    }
    els.historyList.innerHTML = history.map(h => {
      if (h.type === 'change') {
        return h.departures.map(d =>
          `<div class="hist-change">${d.left} busted out — ${d.joined} takes the seat.</div>`
        ).join('');
      }
      if (h.type === 'dragon') {
        return `<div class="hist-dragon">🐉 ${h.name} hit — you won $${money(h.won)}!</div>`;
      }
      const youCls = h.humanDelta >= 0 ? 'up' : 'down';
      const youTxt = h.humanDelta >= 0 ? '+$' + money(h.humanDelta) : '−$' + money(-h.humanDelta);
      return `<div class="hist-row">
        <div class="hist-head">
          <span class="hist-winner">${h.winnerName}</span>
          <span class="hist-pot">won $${money(h.pot)}</span>
        </div>
        <div class="hist-n">Hand ${h.n}</div>
        <div class="hist-you ${youCls}">You: ${youTxt}</div>
      </div>`;
    }).join('');
  }

  // ============================ A HAND =======================================

  function startHand() {
    els.settlement.hidden = true;
    handNo++;
    game = G.createGame(undefined, currentTable.difficulty, bots.map(b => b.persona));
    selected = new Set();
    drag = null;
    hoveredId = null; ui.hoveredId = null;
    render();

    const dragonMsg = checkStartingDragons();   // may pay a Dragon jackpot
    const starter = game.players[game.current];
    setMessage(dragonMsg || (starter.isHuman
      ? 'You hold the 3♦ — lead it to open the hand.'
      : starter.name + ' holds the 3♦ and opens.'));

    updateButtons();
    maybeAITurn();
  }

  // Pay a Dragon jackpot if the human's DEALT hand qualifies. Emerald (full
  // straight flush) outranks Golden (full straight). Returns an announcement
  // message, or null. The hand still plays out normally afterwards.
  function checkStartingDragons() {
    const hand = game.players[0].hand;
    let msg = null;
    if (Eco.isFullStraightFlush(hand)) {
      const won = jackpotEmerald;
      bankroll += won; claimJackpot('jackpotEmerald', Eco.EMERALD_SEED);
      recordDragon('Emerald Dragon', won);
      msg = '🐉💚 EMERALD DRAGON! A full straight flush dealt to you — you won the $' +
        money(won) + ' Emerald Dragon jackpot!';
    } else if (Eco.isFullStraight(hand)) {
      const won = jackpotGolden;
      bankroll += won; claimJackpot('jackpotGolden', Eco.GOLDEN_SEED);
      recordDragon('Golden Dragon', won);
      msg = '🐉👑 GOLDEN DRAGON! A full straight dealt to you — you won the $' +
        money(won) + ' Golden Dragon jackpot!';
    }
    if (msg) { updateWallet(); persist(); }
    return msg;
  }

  function recordDragon(name, won) {
    history.unshift({ type: 'dragon', name: name, won: won });
    renderHistory();
  }

  function render() {
    if (!game) return;
    // bankrolls by seat: 0 = human, 1..3 = bots
    ui.bankrolls = [
      '$' + money(bankroll),
      bots[0] && '$' + money(bots[0].bankroll),
      bots[1] && '$' + money(bots[1].bankroll),
      bots[2] && '$' + money(bots[2].bankroll)
    ];
    ui.action = actionState();
    ui.render(game, selected, drag === null ? undefined : drag);
    els.count.textContent = game.players[0].hand.length + ' cards';
    updateRisk();
  }

  // The on-felt action button mirrors the primary move available to the human:
  // Play when cards are selected, Pass when leading isn't required and nothing
  // is picked, otherwise a disabled Play. null hides the button (not your turn).
  function actionState() {
    const humanTurn = game && game.current === 0 && game.winner === null;
    if (!humanTurn) return null;
    if (selected.size > 0) return { label: 'Play', kind: 'play', enabled: true };
    if (game.lastPlay !== null) return { label: 'Pass', kind: 'pass', enabled: true };
    return { label: 'Play', kind: 'play', enabled: false };
  }

  function updateRisk() {
    const stake = currentTable.stake;
    const hand = game.players[0].hand;
    const val = Eco.handValue(hand, stake);
    let txt = 'At risk: $' + money(val);
    if (hand.length >= Eco.FULL_HAND) txt += '  (×3 = $' + money(val * 3) + ' if you never play!)';
    els.bannerRisk.textContent = txt;
  }

  function updateButtons() {
    const humanTurn = game && game.current === 0 && game.winner === null;
    els.play.disabled = !humanTurn || selected.size === 0;
    els.pass.disabled = !humanTurn || game.lastPlay === null; // can't pass while leading
    els.hint.disabled = !humanTurn;
  }

  // --- human input -----------------------------------------------------------
  // A press that stays put is a click (select a card to play). A press that
  // moves becomes a drag: dragging UP into the centre play zone plays the card
  // (or the whole selection it belongs to); dragging sideways in the hand
  // reorders it. Pointer events cover mouse + touch.

  const DRAG_THRESHOLD = 6;  // canvas-px of movement before a press becomes a drag
  const PLAY_ZONE_Y = 470;   // cursor above this (toward centre) = play intent

  function canvasPos(ev) {
    const rect = ui.canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left) * (ui.canvas.width / rect.width),
      y: (ev.clientY - rect.top) * (ui.canvas.height / rect.height)
    };
  }

  function toggleSelect(card) {
    if (selected.has(card.id)) selected.delete(card.id);
    else selected.add(card.id);
    render();
    updateButtons();
  }

  // Re-insert `card` at `insertIndex` (mirrors the UI's drop preview).
  function reorderHand(card, insertIndex) {
    const others = game.players[0].hand.filter(c => c.id !== card.id);
    others.splice(insertIndex, 0, card);
    game.players[0].hand = others;
  }

  function onPointerDown(ev) {
    if (!game || drag || game.winner !== null) return;
    const p = canvasPos(ev);
    // on-felt action button takes priority over card hits
    const act = ui.actionHitTest(p.x, p.y);
    if (act) {
      actionPress = act;
      ui.actionPressed = true;
      render();
      if (ui.canvas.setPointerCapture) {
        try { ui.canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      }
      return;
    }
    const card = ui.hitTest(p.x, p.y);
    if (!card) return;
    hoveredId = null; ui.hoveredId = null;                       // grabbing supersedes hover
    const rect = ui.handRects.find(r => r.card.id === card.id); // anchor the grab point
    drag = {
      card: card,
      startX: p.x, startY: p.y, curX: p.x, curY: p.y,
      offsetX: rect ? p.x - rect.x : null,
      offsetY: rect ? p.y - rect.y : null,
      moved: false,
      mode: 'reorder',
      playCount: 1,
      insertIndex: game.players[0].hand.findIndex(c => c.id === card.id)
    };
    if (ui.canvas.setPointerCapture) {
      try { ui.canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    }
  }

  // The cards a drag-to-play gesture would play: the whole selection if the
  // dragged card is part of it, otherwise just the dragged card.
  function dragPlayCards(d) {
    if (selected.has(d.card.id) && selected.size > 0) return selectedCards();
    return [d.card];
  }

  // Mouse hover (only when not dragging): lift the card under the cursor.
  function updateHover(ev) {
    if (!game) return;
    const card = drag ? null : ui.hitTest(canvasPos(ev).x, canvasPos(ev).y);
    const id = card ? card.id : null;
    if (id !== hoveredId) {
      hoveredId = id;
      ui.hoveredId = id;
      ui.canvas.style.cursor = id ? 'pointer' : 'default';
      render();
    }
  }

  function onPointerMove(ev) {
    if (actionPress) {
      const stillOver = ui.actionHitTest(canvasPos(ev).x, canvasPos(ev).y) === actionPress;
      if (ui.actionPressed !== stillOver) { ui.actionPressed = stillOver; render(); }
      return;
    }
    if (!drag) { updateHover(ev); return; }
    const p = canvasPos(ev);
    drag.curX = p.x; drag.curY = p.y;
    if (!drag.moved && Math.hypot(p.x - drag.startX, p.y - drag.startY) > DRAG_THRESHOLD) {
      drag.moved = true;
    }
    if (drag.moved) {
      const canPlay = game.current === 0 && game.winner === null;
      drag.mode = (canPlay && p.y < PLAY_ZONE_Y) ? 'play' : 'reorder';
      if (drag.mode === 'play') drag.playCount = dragPlayCards(drag).length;
      else drag.insertIndex = ui.computeInsertIndex(p.x);
      ui.render(game, selected, drag);
    }
  }

  function onPointerUp(ev) {
    if (actionPress) {
      const over = ui.actionHitTest(canvasPos(ev).x, canvasPos(ev).y) === actionPress;
      const kind = actionPress;
      actionPress = null;
      ui.actionPressed = false;
      if (ui.canvas.releasePointerCapture && ev.pointerId != null) {
        try { ui.canvas.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      }
      if (over) { (kind === 'play' ? onPlay : onPass)(); } else { render(); }
      return;
    }
    if (!drag) return;
    const d = drag;
    drag = null;
    if (ui.canvas.releasePointerCapture && ev.pointerId != null) {
      try { ui.canvas.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    }
    if (!d.moved) { toggleSelect(d.card); return; }   // a tap = select
    if (d.mode === 'play') { tryPlayByDrag(d); return; } // dragged into centre = play
    reorderHand(d.card, d.insertIndex);               // dragged in hand = reorder
    render();
  }

  function tryPlayByDrag(d) {
    if (game.current !== 0 || game.winner !== null) { render(); return; }
    const cards = dragPlayCards(d);
    const res = G.validatePlay(game, cards);
    if (!res.ok) { setMessage(res.reason); render(); return; } // snap back, explain
    G.applyPlay(game, cards);
    selected = new Set();
    afterMove();
  }

  function selectedCards() {
    return game.players[0].hand.filter(c => selected.has(c.id));
  }

  function onPlay() {
    if (!game || game.current !== 0) return;
    const cards = selectedCards();
    const res = G.validatePlay(game, cards);
    if (!res.ok) { setMessage(res.reason); return; }
    G.applyPlay(game, cards);
    selected = new Set();
    afterMove();
  }

  function onPass() {
    if (!game || game.current !== 0 || game.lastPlay === null) return;
    G.applyPass(game);
    selected = new Set();
    afterMove();
  }

  function onHint() {
    if (!game || game.current !== 0) return;
    const cards = Big2.ai.chooseMove(game.players[0].hand, hardContext());
    if (!cards) { setMessage('No legal play — you should pass.'); return; }
    selected = new Set(cards.map(c => c.id));
    setMessage('Hint: try the highlighted ' + H.evaluate(cards).label.toLowerCase() + '.');
    render();
    updateButtons();
  }

  // Always give the human the strongest advice, regardless of table difficulty.
  function hardContext() {
    const ctx = G.aiContext(game);
    ctx.difficulty = 'hard';
    return ctx;
  }

  // --- turn loop -------------------------------------------------------------

  function afterMove() {
    render();
    if (game.winner !== null) return endHand();
    setMessage(lastLogLine());
    updateButtons();
    maybeAITurn();
  }

  function lastLogLine() { return game.log[game.log.length - 1] || ''; }

  function maybeAITurn() {
    if (game.winner !== null) return;
    if (game.players[game.current].isHuman) { updateButtons(); return; }
    updateButtons();
    setTimeout(() => {
      if (!game || game.winner !== null) return;
      const current = game.players[game.current];
      if (current.isHuman) return;
      const cards = Big2.ai.chooseMove(current.hand, G.aiContext(game));
      if (cards) G.applyPlay(game, cards);
      else G.applyPass(game);
      render();
      if (game.winner !== null) return endHand();
      setMessage(lastLogLine());
      maybeAITurn();
    }, AI_DELAY);
  }

  // --- settlement ------------------------------------------------------------

  function endHand() {
    render();
    updateButtons();
    const result = Eco.settle(game, currentTable.stake);

    // JACKPOT RAKE: the Dragon pools are funded from each pot. Losers still pay
    // their full penalty; the winner collects the pot MINUS the rake, and the
    // rake (Golden + Emerald shares) feeds the shared jackpots.
    const rakeGolden = Eco.jackpotContribution(result.pot, Eco.GOLDEN_RATE);
    const rakeEmerald = Eco.jackpotContribution(result.pot, Eco.EMERALD_RATE);
    result.rake = rakeGolden + rakeEmerald;
    result.deltas[result.winnerSeat] -= result.rake;   // winner collects less
    result.humanDelta = result.deltas[0];

    // pay everyone: human (seat 0) and the three bots (seats 1..3)
    bankroll = Math.max(0, bankroll + result.deltas[0]);
    for (let s = 1; s <= 3; s++) {
      bots[s - 1].bankroll = Math.max(0, bots[s - 1].bankroll + result.deltas[s]);
    }
    stats.handsPlayed++;

    // the SHARED Dragon jackpots are fed by the rake taken from this pot (they
    // are HIT on the STARTING hand, checked in startHand).
    growJackpots({ jackpotGolden: rakeGolden, jackpotEmerald: rakeEmerald });

    persist();
    updateWallet();

    // record the hand (winner's take is net of the rake)
    history.unshift({
      n: handNo,
      winnerName: game.players[result.winnerSeat].name,
      pot: result.pot - result.rake,
      humanDelta: result.deltas[0]
    });

    // any bot that can no longer afford the table busts out; a new one sits down
    const departures = replaceBustedBots();
    if (departures.length) history.unshift({ type: 'change', departures });

    renderHistory();
    showSettlement(result, departures);
  }

  // Replace bots whose bankroll fell below the table minimum with fresh, named
  // opponents (different from everyone currently seated).
  function replaceBustedBots() {
    const minSit = Eco.minToSit(currentTable.stake);
    const departures = [];
    const seated = new Set(bots.map(b => b.persona.id));
    for (let i = 0; i < bots.length; i++) {
      if (bots[i].bankroll >= minSit) continue;
      const leaving = bots[i].persona;
      seated.delete(leaving.id);
      const replacement = Persona.pickExcluding(seated);
      seated.add(replacement.id);
      bots[i] = { persona: replacement, bankroll: botStack(currentTable.stake) };
      departures.push({ left: leaving.name, joined: replacement.name });
    }
    return departures;
  }

  function showSettlement(result, departures) {
    const winnerName = game.players[result.winnerSeat].name;
    els.settleTitle.textContent = result.winnerSeat === 0
      ? '🎉 You win the hand!' : winnerName + ' wins the hand';

    const changeRows = (departures || []).map(d =>
      `<tr><td colspan="3" class="r-change">↪ ${d.left} busted out — ${d.joined} sits down</td></tr>`
    ).join('');

    const collected = result.pot - (result.rake || 0);
    const rakeRow = result.rake
      ? `<tr><td colspan="3" class="r-rake">🐉 $${money(result.rake)} raked from the pot to the Dragon jackpots</td></tr>`
      : '';

    els.settleRows.innerHTML = result.rows.map(r => {
      const detail = r.winner
        ? '🏆 winner'
        : r.count + ' left' + (r.caughtAll ? ' — all 13, ×3!' : '');
      const amt = r.winner ? '+$' + money(collected) : '−$' + money(r.penalty);
      const amtClass = r.winner ? '' : 'pay';
      return `<tr class="${r.winner ? 'r-win' : ''}">
                <td class="r-name">${r.name}</td>
                <td>${detail}</td>
                <td class="r-amt ${amtClass}">${amt}</td>
              </tr>`;
    }).join('') + rakeRow + changeRows;

    const up = result.humanDelta >= 0;
    els.settleDelta.className = 'settle-delta ' + (up ? 'up' : 'down');
    els.settleDelta.textContent = up
      ? 'You collected +$' + money(result.humanDelta)
      : 'You paid $' + money(-result.humanDelta);

    // can the player afford another hand here?
    const canRebuy = bankroll >= Eco.minToSit(currentTable.stake);
    els.again.disabled = !canRebuy;
    els.again.textContent = canRebuy ? 'Play again' : 'Bankroll too low';

    els.settlement.hidden = false;
  }

  // ============================ BOOT =========================================

  function boot() {
    ui = new Big2.UI($('table'));

    els.lobby = $('lobby');
    els.game = $('game');
    els.tableList = $('table-list');
    els.bankroll = $('bankroll');
    els.bannerName = $('banner-name');
    els.bannerStakes = $('banner-stakes');
    els.bannerRisk = $('banner-risk');
    els.historyList = $('history-list');
    els.play = $('btn-play');
    els.pass = $('btn-pass');
    els.sort = $('btn-sort');
    els.hint = $('btn-hint');
    els.message = $('message');
    els.count = $('count');
    els.settlement = $('settlement');
    els.settleTitle = $('settle-title');
    els.settleRows = $('settle-rows');
    els.settleDelta = $('settle-delta');
    els.again = $('btn-again');
    els.jackpots = $('jackpots');
    els.jpGolden = $('jp-golden');
    els.jpEmerald = $('jp-emerald');
    els.authGate = $('auth-gate');
    els.google = $('btn-google');
    els.authNote = $('auth-note');
    els.profile = $('profile');
    els.pfName = $('pf-name');
    els.pfAvatar = $('pf-avatar');
    els.signout = $('btn-signout');

    ui.canvas.addEventListener('pointerdown', onPointerDown);
    ui.canvas.addEventListener('pointermove', onPointerMove);
    ui.canvas.addEventListener('pointerup', onPointerUp);
    ui.canvas.addEventListener('pointercancel', onPointerUp);
    ui.canvas.addEventListener('pointerleave', () => {
      if (hoveredId !== null) { hoveredId = null; ui.hoveredId = null; if (game) render(); }
    });

    els.play.addEventListener('click', onPlay);
    els.pass.addEventListener('click', onPass);
    els.hint.addEventListener('click', onHint);
    els.sort.addEventListener('click', () => {
      if (!game) return;
      C.sortHand(game.players[0].hand);
      render();
    });

    $('btn-leave').addEventListener('click', showLobby);
    $('btn-again').addEventListener('click', () => {
      if (bankroll >= Eco.minToSit(currentTable.stake)) startHand();
      else showLobby();
    });
    $('btn-tolobby').addEventListener('click', showLobby);
    $('btn-reset').addEventListener('click', () => {
      bankroll = Eco.START;
      persist();
      renderLobby();
      updateWallet();
    });
    els.tableList.addEventListener('click', ev => {
      const btn = ev.target.closest('.tc-sit');
      if (btn && !btn.disabled) sitDown(btn.dataset.id);
    });

    // Jackpot "how to win" popover: hover/focus handles desktop (CSS); tapping a
    // pill toggles it open on touch devices. Tapping elsewhere closes it.
    els.jackpots.addEventListener('click', ev => {
      const pill = ev.target.closest('.jp');
      if (!pill) return;
      const open = pill.classList.contains('open');
      closeJackpotDescs();
      if (!open) pill.classList.add('open');
      ev.stopPropagation();
    });
    document.addEventListener('click', closeJackpotDescs);

    setupAuth();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
