/* ui.js — Canvas rendering and input for Big Two.
 *
 * Renders the table: three AI opponents (card backs + counts), the central
 * "table" showing the last play, and the human's fanned hand at the bottom.
 * Exposes hit-testing so main.js can translate clicks into card selections.
 */
(function (global) {
  'use strict';

  const CARD_W = 72, CARD_H = 100, CORNER = 8;   // default / centre-pile card size
  const HAND_W = 96, HAND_H = 134;                // larger cards in the player's hand
  const HAND_Y = 536, HAND_OVERLAP = 58, SELECT_LIFT = 28, HOVER_LIFT = 15;
  const BACK_W = 40, BACK_H = 58;

  function UI(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = canvas.width;
    this.H = canvas.height;
    this.handRects = [];   // [{card, x, y, w, h}] for hit testing (human hand)
  }

  UI.prototype.clear = function () {
    const ctx = this.ctx, W = this.W, H = this.H;

    // backdrop
    ctx.fillStyle = '#07120c';
    ctx.fillRect(0, 0, W, H);

    // wooden rail
    const rail = 8;
    const wood = ctx.createLinearGradient(0, rail, 0, H - rail);
    wood.addColorStop(0, '#6e4a27');
    wood.addColorStop(0.5, '#4c3018');
    wood.addColorStop(1, '#34210f');
    roundRect(ctx, rail, rail, W - 2 * rail, H - 2 * rail, 26);
    ctx.fillStyle = wood;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 214, 130, 0.22)'; // thin gold trim
    roundRect(ctx, rail, rail, W - 2 * rail, H - 2 * rail, 26);
    ctx.stroke();

    // felt
    const fm = 22;
    const g = ctx.createRadialGradient(W / 2, 300, 70, W / 2, 330, 640);
    g.addColorStop(0, '#218150');
    g.addColorStop(0.62, '#156540');
    g.addColorStop(1, '#0b452c');
    roundRect(ctx, fm, fm, W - 2 * fm, H - 2 * fm, 18);
    ctx.fillStyle = g;
    ctx.fill();

    // soft inner vignette + discard ring, clipped to the felt
    ctx.save();
    roundRect(ctx, fm, fm, W - 2 * fm, H - 2 * fm, 18);
    ctx.clip();
    ctx.lineWidth = 30;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)';
    roundRect(ctx, fm, fm, W - 2 * fm, H - 2 * fm, 18);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.beginPath();
    ctx.ellipse(W / 2, 300, 250, 152, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };

  // --- low level card drawing ------------------------------------------------

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  UI.prototype.drawCard = function (card, x, y, opts) {
    const ctx = this.ctx;
    opts = opts || {};
    const w = opts.w || CARD_W, h = opts.h || CARD_H;

    ctx.save();
    if (opts.dim) ctx.globalAlpha = 0.55;
    // shadow (lifted higher while being dragged)
    ctx.shadowColor = opts.dragging ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = opts.dragging ? 14 : 6;
    ctx.shadowOffsetY = opts.dragging ? 9 : 3;
    roundRect(ctx, x, y, w, h, CORNER);
    ctx.fillStyle = '#fdfdfd';
    ctx.fill();
    ctx.shadowColor = 'transparent';

    // selection / highlight border (green when poised to play)
    if (opts.playReady) { ctx.lineWidth = 3; ctx.strokeStyle = '#6ee7a0'; }
    else if (opts.selected) { ctx.lineWidth = 3; ctx.strokeStyle = '#ffd54a'; }
    else { ctx.lineWidth = 1; ctx.strokeStyle = '#b9b9b9'; }
    roundRect(ctx, x, y, w, h, CORNER);
    ctx.stroke();

    const color = card.red ? '#d12b2b' : '#1a1a1a';
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';

    // top-left rank + suit
    const scale = w / CARD_W;
    ctx.textAlign = 'left';
    ctx.font = (700 * 1) + ' ' + Math.round(18 * scale) + 'px Georgia, serif';
    ctx.font = 'bold ' + Math.round(18 * scale) + 'px Georgia, serif';
    ctx.fillText(card.label, x + 6 * scale, y + 5 * scale);
    ctx.font = Math.round(15 * scale) + 'px Georgia, serif';
    ctx.fillText(card.symbol, x + 6 * scale, y + 24 * scale);

    // big centre suit
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = Math.round(40 * scale) + 'px Georgia, serif';
    ctx.fillText(card.symbol, x + w / 2, y + h / 2 + 4 * scale);

    // bottom-right rank (rotated-ish, just mirrored placement)
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.font = 'bold ' + Math.round(18 * scale) + 'px Georgia, serif';
    ctx.fillText(card.label, x + w - 6 * scale, y + h - 5 * scale);

    // cash value (bottom-left), shown on the human's cards
    if (opts.value != null) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.font = 'bold ' + Math.round(11 * scale) + 'px system-ui, sans-serif';
      ctx.fillStyle = '#15803d';
      ctx.fillText('$' + opts.value, x + 6 * scale, y + h - 5 * scale);
    }

    ctx.restore();
  };

  UI.prototype.drawBack = function (x, y, w, h) {
    const ctx = this.ctx;
    w = w || BACK_W; h = h || BACK_H;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, '#33508f');
    grad.addColorStop(1, '#1c2f59');
    roundRect(ctx, x, y, w, h, 6);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    roundRect(ctx, x + 3.5, y + 3.5, w - 7, h - 7, 4);
    ctx.strokeStyle = 'rgba(140, 170, 225, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // centre diamond motif
    ctx.fillStyle = 'rgba(150, 178, 230, 0.5)';
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y + h / 2 - 7);
    ctx.lineTo(x + w / 2 + 5, y + h / 2);
    ctx.lineTo(x + w / 2, y + h / 2 + 7);
    ctx.lineTo(x + w / 2 - 5, y + h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  // --- name panels -----------------------------------------------------------

  function initials(name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // deterministic, pleasant avatar colour from the name
  function avatarColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return 'hsl(' + h + ', 48%, 42%)';
  }

  // --- opponents -------------------------------------------------------------

  UI.prototype.drawOpponent = function (player, anchor, isTurn, bankroll) {
    const count = player.hand.length;

    // fan of card backs (anchor.fx/fy is the fan centre)
    if (!player.finished && count > 0) {
      const shown = Math.min(count, 13);
      if (anchor.dir === 'h') {
        const spread = 16;
        const startX = anchor.fx - (shown - 1) * spread / 2 - BACK_W / 2;
        for (let i = 0; i < shown; i++) this.drawBack(startX + i * spread, anchor.fy - BACK_H / 2, BACK_W, BACK_H);
      } else {
        const spread = 12;
        const startY = anchor.fy - (shown - 1) * spread / 2 - BACK_H / 2;
        for (let i = 0; i < shown; i++) this.drawBack(anchor.fx - BACK_W / 2, startY + i * spread, BACK_W, BACK_H);
      }
    }

    this.drawPlayerPanel(player.name, count, anchor.px, anchor.py, isTurn, player.finished,
      { bankroll: bankroll });
  };

  // A solid player panel: avatar + name + a count chip, with a gold glow when
  // it's that player's turn. opts.bankroll (a preformatted "$1,234" string)
  // adds the player's bankroll in gold beside the name — used for the human.
  UI.prototype.drawPlayerPanel = function (name, count, cx, cy, isTurn, finished, opts) {
    const ctx = this.ctx;
    opts = opts || {};
    const bankText = opts.bankroll || null;
    ctx.save();

    const AV = 30, padL = 9, gap = 9, chipW = 28, padR = 9, panelH = 44;
    ctx.font = 'bold 15px system-ui, sans-serif';
    const nameW = Math.ceil(ctx.measureText(name).width);
    let bankW = 0;
    if (bankText) {
      ctx.font = 'bold 13px system-ui, sans-serif';
      bankW = gap + Math.ceil(ctx.measureText(bankText).width);
    }
    const panelW = padL + AV + gap + nameW + bankW + gap + chipW + padR;

    const margin = 26;
    const x = Math.max(margin, Math.min(this.W - margin - panelW, cx - panelW / 2));
    const y = cy - panelH / 2;
    const midY = y + panelH / 2;

    // plate (with active glow)
    if (isTurn) { ctx.shadowColor = 'rgba(255, 213, 74, 0.7)'; ctx.shadowBlur = 20; }
    const grad = ctx.createLinearGradient(0, y, 0, y + panelH);
    grad.addColorStop(0, isTurn ? '#41391f' : '#1d2c23');
    grad.addColorStop(1, isTurn ? '#2c2512' : '#11201a');
    roundRect(ctx, x, y, panelW, panelH, 13);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = isTurn ? 2 : 1;
    ctx.strokeStyle = isTurn ? '#ffd54a' : 'rgba(255, 255, 255, 0.16)';
    roundRect(ctx, x, y, panelW, panelH, 13);
    ctx.stroke();

    // avatar
    const ax = x + padL + AV / 2;
    ctx.beginPath();
    ctx.arc(ax, midY, AV / 2, 0, Math.PI * 2);
    ctx.fillStyle = avatarColor(name);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText(initials(name), ax, midY + 0.5);

    // name
    ctx.textAlign = 'left';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillStyle = isTurn ? '#fff' : '#e8f3ec';
    const nameX = x + padL + AV + gap;
    ctx.fillText(name, nameX, midY + 0.5);

    // bankroll (gold), shown for the human player
    if (bankText) {
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.fillStyle = '#ffd54a';
      ctx.fillText(bankText, nameX + nameW + gap, midY + 0.5);
    }

    // count chip
    const chipX = x + panelW - padR - chipW, chipH = 26;
    roundRect(ctx, chipX, midY - chipH / 2, chipW, chipH, 9);
    ctx.fillStyle = finished ? '#6ee7a0' : isTurn ? '#ffd54a' : 'rgba(255, 255, 255, 0.12)';
    ctx.fill();
    ctx.fillStyle = (finished || isTurn) ? '#14271d' : '#fff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText(finished ? '✓' : String(count), chipX + chipW / 2, midY + 0.5);

    ctx.restore();
  };

  // --- table (last play) -----------------------------------------------------

  // a small centred caption pill
  UI.prototype.drawCaption = function (text, cx, y, accent) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = 'bold 13px system-ui, sans-serif';
    const w = Math.ceil(ctx.measureText(text).width) + 24;
    roundRect(ctx, cx - w / 2, y - 13, w, 26, 13);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = accent || 'rgba(255, 255, 255, 0.9)';
    ctx.fillText(text, cx, y + 0.5);
    ctx.restore();
  };

  UI.prototype.drawTable = function (game) {
    const cx = this.W / 2, cy = 300;

    if (!game.lastPlay) {
      if (game.winner === null) this.drawCaption('Lead the trick — play anything', cx, cy);
      return;
    }

    const lp = game.lastPlay;
    const cards = lp.combo.cards;
    const spread = 50;
    const startX = cx - (cards.length - 1) * spread / 2 - CARD_W / 2;
    for (let i = 0; i < cards.length; i++) {
      this.drawCard(cards[i], startX + i * spread, cy - 50, {});
    }
    this.drawCaption(game.players[lp.seat].name + ' played', cx, cy - 70);
  };

  // --- human hand ------------------------------------------------------------

  // Slot positions for an n-card fanned hand. Stable for a given n, so dragging
  // (which keeps n constant) doesn't make the fan jitter.
  UI.prototype.handLayout = function (n) {
    const overlap = n > 1 ? Math.min(HAND_OVERLAP, (this.W - 110 - HAND_W) / (n - 1)) : 0;
    const totalW = HAND_W + (n - 1) * overlap;
    const startX = (this.W - totalW) / 2;
    const slots = [];
    for (let i = 0; i < n; i++) slots.push(startX + i * overlap);
    return { slots, overlap, y: HAND_Y, w: HAND_W, h: HAND_H };
  };

  // Which final index (0..n-1) a card dropped at x would occupy. Counts how many
  // slot centres sit left of the cursor.
  UI.prototype.computeInsertIndex = function (x) {
    const lay = this._lay;
    if (!lay) return 0;
    const n = lay.slots.length;
    let idx = 0;
    for (let i = 0; i < n; i++) {
      if (x > lay.slots[i] + lay.w / 2) idx = i + 1;
    }
    return Math.max(0, Math.min(n - 1, idx));
  };

  // dashed outline marking where the dragged card will land
  UI.prototype.drawDropGhost = function (x, y, w, h) {
    const ctx = this.ctx;
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 213, 74, 0.9)';
    roundRect(ctx, x, y, w, h, CORNER);
    ctx.stroke();
    ctx.restore();
  };

  // `drag`, when present: { card, curX, curY, insertIndex, offsetX, offsetY }
  UI.prototype.drawHand = function (hand, selectedIds, drag) {
    this.handRects = [];
    const n = hand.length;
    this._lay = null;
    if (n === 0) return;
    const lay = this.handLayout(n);
    this._lay = lay;

    // main sets `valueFn` to show a $ value on each card (avoid the name
    // `valueOf`, which every object inherits from Object.prototype).
    const valueFn = this.valueFn || null;

    if (!drag) {
      for (let i = 0; i < n; i++) {
        const card = hand[i];
        const selected = selectedIds.has(card.id);
        const lift = selected ? SELECT_LIFT : (card.id === this.hoveredId ? HOVER_LIFT : 0);
        const y = lay.y - lift;
        this.drawCard(card, lay.slots[i], y, { selected, value: valueFn && valueFn(card), w: lay.w, h: lay.h });
        // hit region spans from the lifted top down to the resting bottom, so a
        // hovered/selected card stays reliably under the cursor (no flicker)
        this.handRects.push({ card, x: lay.slots[i], y, w: lay.w, h: lay.h + lift });
      }
      return;
    }

    // --- PLAY drag: the cards that will be played travel with the cursor as a
    // little fan; everything else stays put with gaps where the travellers were.
    if (drag.mode === 'play') {
      const group = travelGroup(hand, drag, selectedIds);
      const moving = new Set(group.map(c => c.id));
      for (let i = 0; i < n; i++) {
        const card = hand[i];
        if (moving.has(card.id)) continue; // leave a gap
        const selected = selectedIds.has(card.id);
        const y = lay.y - (selected ? SELECT_LIFT : 0);
        this.drawCard(card, lay.slots[i], y, { selected, value: valueFn && valueFn(card), w: lay.w, h: lay.h });
      }
      this.drawTravelFan(group, drag, valueFn);
      return;
    }

    // --- REORDER drag: one card reflows; others fill the slots with a gap at insertIndex
    const others = hand.filter(c => c.id !== drag.card.id);
    let oi = 0;
    for (let i = 0; i < n; i++) {
      if (i === drag.insertIndex) {
        this.drawDropGhost(lay.slots[i], lay.y, lay.w, lay.h);
        continue;
      }
      const card = others[oi++];
      const selected = selectedIds.has(card.id);
      const y = lay.y - (selected ? SELECT_LIFT : 0);
      this.drawCard(card, lay.slots[i], y, { selected, value: valueFn && valueFn(card), w: lay.w, h: lay.h });
    }
    const dx = drag.curX - (drag.offsetX != null ? drag.offsetX : lay.w / 2);
    const dy = drag.curY - (drag.offsetY != null ? drag.offsetY : lay.h / 2);
    this.drawCard(drag.card, dx, dy, {
      selected: selectedIds.has(drag.card.id), dragging: true,
      value: valueFn && valueFn(drag.card), w: lay.w, h: lay.h
    });
  };

  // Cards that travel with the cursor in play mode: the whole selection if the
  // grabbed card belongs to it, otherwise just the grabbed card. Kept in hand
  // order so the fan reads left-to-right like the hand.
  function travelGroup(hand, drag, selectedIds) {
    if (selectedIds.has(drag.card.id)) {
      const sel = hand.filter(c => selectedIds.has(c.id));
      if (sel.length > 1) return sel;
    }
    return [drag.card];
  }

  // Draw the travelling cards. The grabbed card stays pinned under the pointer
  // (at its grab offset) and the rest of the group fans out beside it.
  UI.prototype.drawTravelFan = function (group, drag, valueFn) {
    const cw = (this._lay && this._lay.w) || HAND_W;
    const ch = (this._lay && this._lay.h) || HAND_H;
    const baseX = drag.curX - (drag.offsetX != null ? drag.offsetX : cw / 2);
    const baseY = drag.curY - (drag.offsetY != null ? drag.offsetY : ch / 2);
    const opts = card => ({ selected: true, dragging: true, playReady: true,
      value: valueFn && valueFn(card), w: cw, h: ch });

    if (group.length === 1) { this.drawCard(group[0], baseX, baseY, opts(group[0])); return; }

    const overlap = 44; // tighter than the hand so the group reads as one unit
    const gi = group.findIndex(c => c.id === drag.card.id); // grabbed card's slot
    // others first, so the grabbed card sits on top and clearly under the pointer
    for (let i = 0; i < group.length; i++) {
      if (i === gi) continue;
      const rel = i - gi;                 // negative = left of grab, positive = right
      this.drawCard(group[i], baseX + rel * overlap, baseY + Math.abs(rel) * 8, opts(group[i]));
    }
    this.drawCard(group[gi], baseX, baseY, opts(group[gi]));
  };

  // glowing centre target shown while a card is dragged up to be played
  UI.prototype.drawPlayTarget = function (count) {
    const ctx = this.ctx;
    const cx = this.W / 2, cy = 300, w = 380, h = 176;
    ctx.save();
    ctx.setLineDash([10, 7]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(110, 231, 160, 0.95)';
    ctx.fillStyle = 'rgba(110, 231, 160, 0.12)';
    roundRect(ctx, cx - w / 2, cy - h / 2, w, h, 16);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#dffbe9';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillText('Release to play', cx, cy - 14);
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText(count + (count === 1 ? ' card' : ' cards'), cx, cy + 14);
    ctx.restore();
  };

  // --- on-felt action button -------------------------------------------------

  // A large primary action button sitting on the felt directly below the
  // human's panel/bankroll, so the main action is always reachable (especially
  // on touch). `state` is { label, kind, enabled } or null to hide it. Records
  // `this.actionRect` for hit testing.
  UI.prototype.drawActionButton = function (state) {
    this.actionRect = null;
    if (!state) return;

    const ctx = this.ctx;
    const w = 180, h = 46;
    const cx = this.W / 2;                 // centred under the player panel
    const cy = HAND_Y - 56;                // between the panel and the fanned hand
    const x = cx - w / 2, y = cy - h / 2;
    const enabled = state.enabled;
    const pressed = enabled && this.actionPressed;

    ctx.save();
    if (enabled && !pressed) { ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4; }
    roundRect(ctx, x, y + (pressed ? 1.5 : 0), w, h, 14);
    if (!enabled) ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    else if (pressed) ctx.fillStyle = '#e6bd2f';
    else ctx.fillStyle = '#ffd54a';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = enabled ? '#e6bd2f' : 'rgba(255, 255, 255, 0.18)';
    roundRect(ctx, x, y + (pressed ? 1.5 : 0), w, h, 14);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillStyle = enabled ? '#14271d' : 'rgba(255, 255, 255, 0.45)';
    ctx.fillText(state.label, cx, cy + (pressed ? 1.5 : 0) + 0.5);
    ctx.restore();

    this.actionRect = { x, y, w, h, kind: state.kind, enabled };
  };

  // Returns the action kind ('play'/'pass') if (px,py) is over the enabled
  // action button, else null.
  UI.prototype.actionHitTest = function (px, py) {
    const r = this.actionRect;
    if (!r || !r.enabled) return null;
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return r.kind;
    return null;
  };

  // Return the topmost card under (px,py), or null.
  UI.prototype.hitTest = function (px, py) {
    for (let i = this.handRects.length - 1; i >= 0; i--) {
      const r = this.handRects[i];
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return r.card;
    }
    return null;
  };

  // --- full render -----------------------------------------------------------

  UI.prototype.render = function (game, selectedIds, drag) {
    this.clear();

    // opponent anchors: 1 = left, 2 = top, 3 = right.
    // px/py = name-panel centre; fx/fy = card-back fan centre.
    const anchors = {
      1: { px: 122, py: 150, fx: 122, fy: 312, dir: 'v' },
      2: { px: this.W / 2, py: 48, fx: this.W / 2, fy: 102, dir: 'h' },
      3: { px: this.W - 122, py: 150, fx: this.W - 122, fy: 312, dir: 'v' }
    };
    const banks = this.bankrolls || [];
    [1, 2, 3].forEach(seat => {
      this.drawOpponent(game.players[seat], anchors[seat],
        game.current === seat && game.winner === null, banks[seat]);
    });

    this.drawTable(game);
    if (drag && drag.mode === 'play') this.drawPlayTarget(drag.playCount || 1);

    // human's own panel — drawn before the hand so dragged cards float over it.
    // Raised to leave room for the action button stacked beneath it.
    const yourTurn = game.current === 0 && game.winner === null;
    this.drawPlayerPanel(game.players[0].name, game.players[0].hand.length,
      this.W / 2, HAND_Y - 106, yourTurn, game.players[0].finished,
      { bankroll: banks[0] });

    // on-felt action button, centred just below the panel (hidden mid play-drag)
    this.drawActionButton(drag && drag.mode === 'play' ? null : this.action);

    this.drawHand(game.players[0].hand, selectedIds, drag);
  };

  global.Big2 = global.Big2 || {};
  global.Big2.UI = UI;
})(window);
