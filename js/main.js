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
  let hoveredId = null;       // card under the cursor (mouse hover lift)
  let bankroll = 0;
  let currentTable = null;
  let bots = [];              // [{ persona, bankroll }] for seats 1..3
  let history = [];           // newest-first list of played hands / seat changes
  let handNo = 0;

  const els = {};

  function $(id) { return document.getElementById(id); }
  function setMessage(msg) { els.message.textContent = msg; }
  function money(n) { return Math.round(n).toLocaleString('en-US'); }

  function updateWallet() { els.bankroll.textContent = '$' + money(bankroll); }

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
      const locked = bankroll < sit;
      const lo = Eco.cardValue({ rank: 3 }, t.stake);
      const hi = Eco.cardValue({ rank: 15 }, t.stake);
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
            ${locked ? 'Locked' : 'Sit down'}
          </button>
          ${locked ? `<p class="tc-lock">Need $${money(sit)} bankroll to sit</p>` : ''}
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

  function renderRoster() {
    els.roster.innerHTML = bots.map(b => `
      <div class="persona-chip">
        <div class="pc-top">
          <span class="pc-name">${b.persona.name}</span>
          <span class="pc-bank">$${money(b.bankroll)}</span>
        </div>
        <div class="pc-tag">${b.persona.tagline}</div>
      </div>`).join('');
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
    renderRoster();
    render();

    const starter = game.players[game.current];
    setMessage(starter.isHuman
      ? 'You hold the 3♦ — lead it to open the hand.'
      : starter.name + ' holds the 3♦ and opens.');

    updateButtons();
    maybeAITurn();
  }

  function render() {
    if (!game) return;
    ui.render(game, selected, drag === null ? undefined : drag);
    els.count.textContent = game.players[0].hand.length + ' cards';
    updateRisk();
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

    // pay everyone: human (seat 0) and the three bots (seats 1..3)
    bankroll = Math.max(0, bankroll + result.deltas[0]);
    for (let s = 1; s <= 3; s++) {
      bots[s - 1].bankroll = Math.max(0, bots[s - 1].bankroll + result.deltas[s]);
    }
    Eco.saveBankroll(bankroll);
    updateWallet();

    // record the hand
    history.unshift({
      n: handNo,
      winnerName: game.players[result.winnerSeat].name,
      pot: result.pot,
      humanDelta: result.deltas[0]
    });

    // any bot that can no longer afford the table busts out; a new one sits down
    const departures = replaceBustedBots();
    if (departures.length) history.unshift({ type: 'change', departures });

    renderRoster();
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

    els.settleRows.innerHTML = result.rows.map(r => {
      const detail = r.winner
        ? '🏆 winner'
        : r.count + ' left' + (r.caughtAll ? ' — all 13, ×3!' : '');
      const amt = r.winner ? '+$' + money(result.pot) : '−$' + money(r.penalty);
      const amtClass = r.winner ? '' : 'pay';
      return `<tr class="${r.winner ? 'r-win' : ''}">
                <td class="r-name">${r.name}</td>
                <td>${detail}</td>
                <td class="r-amt ${amtClass}">${amt}</td>
              </tr>`;
    }).join('') + changeRows;

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
    els.roster = $('roster');
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
      Eco.saveBankroll(bankroll);
      renderLobby();
      updateWallet();
    });
    els.tableList.addEventListener('click', ev => {
      const btn = ev.target.closest('.tc-sit');
      if (btn && !btn.disabled) sitDown(btn.dataset.id);
    });

    bankroll = Eco.loadBankroll();
    showLobby();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
