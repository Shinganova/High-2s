/* Cloud Functions for High 2s — the ONLY writer of the shared jackpot pool.
 *
 * Clients can read `jackpots/global` directly (live via onSnapshot) but cannot
 * write it (see firestore.rules). All growth + payouts go through these callable
 * functions, which run with admin privileges and validate every input. This
 * stops one player from corrupting the shared pool for everyone.
 *
 * NOTE: SEEDS must match the client's seeds in js/economy.js.
 *
 * Deploy:  firebase deploy --only functions,firestore:rules   (requires Blaze)
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

const JP_PATH = "jackpots/global";
const SEEDS = { jackpotGolden: 3000, jackpotEmerald: 10000 }; // floor / reseed value
const MAX_CONTRIB = 2000;   // hard cap per field per hand (anti-griefing)

function clampContrib(v) {
  v = Math.round(Number(v));
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.min(v, MAX_CONTRIB);
}
function withFloor(v, seed) {
  return Number.isFinite(v) && v >= seed ? v : seed;
}

// Add bounded contributions (the per-hand rake) to the shared pools, and
// guarantee each pool is at least its seed. Pass 0/0 to just initialise/floor.
exports.contributeJackpots = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const d = request.data || {};
  const addG = clampContrib(d.jackpotGolden);
  const addE = clampContrib(d.jackpotEmerald);
  const ref = db.doc(JP_PATH);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? snap.data() : {};
    const next = {
      jackpotGolden: withFloor(cur.jackpotGolden, SEEDS.jackpotGolden) + addG,
      jackpotEmerald: withFloor(cur.jackpotEmerald, SEEDS.jackpotEmerald) + addE,
    };
    tx.set(ref, next, { merge: true });
    return next;
  });
});

// Reset one pool to its seed and report the amount that was in it (the winnings).
exports.claimJackpot = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const field = request.data && request.data.field;
  if (field !== "jackpotGolden" && field !== "jackpotEmerald") {
    throw new HttpsError("invalid-argument", "Unknown jackpot field.");
  }
  const ref = db.doc(JP_PATH);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? snap.data() : {};
    const won = withFloor(cur[field], SEEDS[field]);
    tx.set(ref, { [field]: SEEDS[field] }, { merge: true });
    return { field, won };
  });
});
