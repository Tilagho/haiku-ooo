// Round 15.6b (Tiago, t183u): where the shared board lives. haiku.ooo is static (GitHub Pages).
// Round 15.6c (Tiago, t186u/t187u): production = Firestore + anonymous auth in haiku.ooo's OWN Firebase project (fully
// separate from tiago.ooo; src/firebase-store.js, rules in firestore.rules). THIS IS THE ONLY PLACE TO PASTE IT:
// Firebase console -> Project settings -> Your apps -> Web app -> "SDK setup and configuration" -> Config, then
// replace `null` below with that object. A web config is public by design; what protects the data is firestore.rules.
// While FIREBASE is null the site stays the per-device board (exactly what is live today).
//   ?api=local       force the per-device board (LocalStore)          ?api=firebase   force Firestore
//   ?api=https://…   an HTTP backend instead (tools/api-server.mjs locally, worker/ = the unused Cloudflare reference)
export const FIREBASE = {
  apiKey: 'AIzaSyBrN6d4kqZDLL_0ErIzX7LcuzoFyXeidKE', authDomain: 'haiku-ooo.firebaseapp.com', projectId: 'haiku-ooo',
  storageBucket: 'haiku-ooo.firebasestorage.app', messagingSenderId: '700192647404', appId: '1:700192647404:web:5b31c73072834cc2b6ddc9',
};
// export const FIREBASE = {
//   apiKey: '…', authDomain: 'haiku-ooo.firebaseapp.com', projectId: 'haiku-ooo',
//   storageBucket: 'haiku-ooo.firebasestorage.app', messagingSenderId: '…', appId: '…',
// };
export const API_BASE = '';        // (used only when FIREBASE is null)
// how many poems make one "block" of the scroll: block b is the poems numbered b*BLOCK+1 .. (b+1)*BLOCK. Each block is
// composed as its own painting (src/feed.js), so older blocks can be added below without repainting newer ones.
export const BLOCK = 24;
export const POLL_MS = 45000;      // look for other people's new poems this often (only while the tab is visible)
