/* firebase-config.js — paste YOUR Firebase web-app config here.
 *
 * Setup (one time, free):
 *   1. Create a project at https://console.firebase.google.com
 *   2. Add a Web App (the </> icon) and copy its `firebaseConfig` values below.
 *   3. Build → Authentication → Sign-in method → enable **Google**.
 *   4. Build → Firestore Database → Create database. Publish the rules in
 *      ../firestore.rules so each user can only touch their own document.
 *   5. Authentication → Settings → Authorized domains: add the domain you
 *      deploy to (e.g. your-site.netlify.app) and localhost for testing.
 *
 * Google sign-in is REQUIRED to play. Until real values are filled in, the
 * login gate stays locked with a "not configured" message.
 */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAa8lDyenvrICAwGU4eoyKbnONZh2Qrwi4",
  authDomain: "high2s.firebaseapp.com",
  projectId: "high2s",
  storageBucket: "high2s.firebasestorage.app",
  messagingSenderId: "866989327918",
  appId: "1:866989327918:web:e5f7caa9be9c1bd567c1bf",
  measurementId: "G-VNJSTTEWCN"
};
