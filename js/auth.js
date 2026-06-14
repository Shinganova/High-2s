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

  // Load the Firebase SDK + initialise app/auth/firestore exactly once.
  async function ensure() {
    if (fb) return fb;
    const [app, A, F] = await Promise.all([
      import(SDK + 'firebase-app.js'),
      import(SDK + 'firebase-auth.js'),
      import(SDK + 'firebase-firestore.js')
    ]);
    const fbApp = app.initializeApp(cfg);
    const auth = A.getAuth(fbApp);
    const db = F.getFirestore(fbApp);
    fb = { A, F, auth, db, provider: new A.GoogleAuthProvider() };
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
    }
  };
})(window);
