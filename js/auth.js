/* auth.js — Google sign-in + Firestore persistence for High 2s.
 *
 * Exposes window.Big2.auth, a small async facade over Firebase. The Firebase
 * SDK is loaded lazily (dynamic import) and ONLY when a real config is present.
 * When the config is still the placeholder, `configured` is false and the app's
 * login gate reports that sign-in isn't set up (login is required to play).
 *
 *   Big2.auth.configured        -> boolean (is Firebase wired up?)
 *   Big2.auth.user()            -> { uid, name, email, photo } | null
 *   Big2.auth.onChange(fn)      -> subscribe to sign-in/out (fires current state)
 *   Big2.auth.signIn()          -> Promise (Google popup)
 *   Big2.auth.signOut()         -> Promise
 *   Big2.auth.loadProfile()     -> Promise<docData | null>
 *   Big2.auth.saveProfile(data) -> Promise (merges into users/{uid})
 *   Big2.auth.watchJackpots(seeds, cb) -> live shared-pool subscription
 *   Big2.auth.growJackpots(deltas)     -> contribute rake (Cloud Function)
 *   Big2.auth.resetJackpot(field)      -> claim/reset a pool (Cloud Function)
 *
 * The shared jackpot pool (jackpots/global) is written ONLY by Cloud Functions
 * (see functions/index.js); clients read it live but cannot write it.
 */
(function (global) {
  'use strict';

  const VER = '10.12.2';
  const SDK = 'https://www.gstatic.com/firebasejs/' + VER + '/';

  const cfg = global.FIREBASE_CONFIG;
  const configured = !!(cfg && cfg.apiKey && !/REPLACE|YOUR_/i.test(cfg.apiKey));

  const listeners = [];
  let current = null;   // { uid, name, email, photo } | null
  let fb = null;        // resolved Firebase handles, once loaded

  function notify() {
    listeners.forEach(fn => { try { fn(current); } catch (e) { console.error(e); } });
  }

  // Load the Firebase SDK + initialise app/auth/firestore/functions exactly once.
  async function ensure() {
    if (fb) return fb;
    const [app, A, F, FN] = await Promise.all([
      import(SDK + 'firebase-app.js'),
      import(SDK + 'firebase-auth.js'),
      import(SDK + 'firebase-firestore.js'),
      import(SDK + 'firebase-functions.js')
    ]);
    const fbApp = app.initializeApp(cfg);
    const auth = A.getAuth(fbApp);
    const db = F.getFirestore(fbApp);
    const functions = FN.getFunctions(fbApp); // default region us-central1
    fb = { A, F, FN, auth, db, functions, provider: new A.GoogleAuthProvider() };
    A.onAuthStateChanged(auth, u => {
      current = u
        ? { uid: u.uid, name: u.displayName, email: u.email, photo: u.photoURL }
        : null;
      notify();
    });
    return fb;
  }

  // Begin watching auth state right away when configured, so a returning user
  // is recognised without clicking anything.
  if (configured) ensure().catch(e => console.error('Firebase init failed:', e));

  global.Big2 = global.Big2 || {};
  global.Big2.auth = {
    configured: configured,

    user: function () { return current; },

    onChange: function (fn) {
      listeners.push(fn);
      Promise.resolve().then(() => fn(current)); // deliver current state async
    },

    signIn: async function () {
      const x = await ensure();
      await x.A.signInWithPopup(x.auth, x.provider);
    },

    signOut: async function () {
      if (!fb) return;
      await fb.A.signOut(fb.auth);
    },

    loadProfile: async function () {
      if (!fb || !current) return null;
      const ref = fb.F.doc(fb.db, 'users', current.uid);
      const snap = await fb.F.getDoc(ref);
      return snap.exists() ? snap.data() : null;
    },

    saveProfile: async function (data) {
      if (!fb || !current) return;
      const ref = fb.F.doc(fb.db, 'users', current.uid);
      const payload = Object.assign({}, data, { updatedAt: fb.F.serverTimestamp() });
      await fb.F.setDoc(ref, payload, { merge: true });
    },

    // --- shared progressive jackpots (one global doc, jackpots/global) -------

    // Live-subscribe to the global jackpot pools (read-only for clients). On
    // connect we ask the server to initialise/floor the doc, then stream it via
    // onSnapshot. Returns an unsubscribe fn.
    watchJackpots: async function (_seeds, cb) {
      const x = await ensure();
      try {
        // contribute 0/0 → server creates the doc and applies the seed floor
        await x.FN.httpsCallable(x.functions, 'contributeJackpots')(
          { jackpotGolden: 0, jackpotEmerald: 0 });
      } catch (e) { console.error('Jackpot init failed:', e); }
      const ref = x.F.doc(x.db, 'jackpots', 'global');
      return x.F.onSnapshot(ref, s => { if (s.exists()) cb(s.data()); },
        e => console.error('Jackpot watch failed:', e));
    },

    // Contribute the per-hand rake to the shared pools, via the Cloud Function
    // (the only writer of the pool). deltas = { jackpotGolden, jackpotEmerald }.
    growJackpots: async function (deltas) {
      const x = await ensure();
      await x.FN.httpsCallable(x.functions, 'contributeJackpots')({
        jackpotGolden: deltas.jackpotGolden || 0,
        jackpotEmerald: deltas.jackpotEmerald || 0
      });
    },

    // Claim a pool (won): the server resets it to its seed. Returns { won }.
    resetJackpot: async function (field) {
      const x = await ensure();
      const res = await x.FN.httpsCallable(x.functions, 'claimJackpot')({ field: field });
      return res && res.data;
    }
  };
})(window);
