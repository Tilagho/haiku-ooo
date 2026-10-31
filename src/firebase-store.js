// Round 15.6c (Tiago chose Firebase; t186u/t187u: its OWN project, nothing shared with tiago.ooo): THE SHARED SCROLL ON
// FIRESTORE (web config in src/config.js). Implements the PostStore interface of src/store.js
// (list / create / report / count, seq paging newest first) straight from the browser: no server of our own.
//
// Auth: Firebase Anonymous Auth. Every phone silently gets a uid on its first visit, so
// there is still no sign-up / log-in anywhere. Reading needs no auth; posting and reporting wait for the uid.
//
// Collections (rules: firestore.rules; anything else in the project is denied):
//   haikus/{id}                 { seq, text, author, uid, createdAt (server time), reports: 0, removed: false, hash }
//   haikus/{id}/reports/{uid}   { at }                    one report per signed-in device per poem (the doc id IS the uid)
//   poemRx/{poemId}             { cry, eyes, heart, star, flushed, relieved, poop, fire }   totals, public. heart = broken heart
//   poemRx/{poemId}/by/{uid}    { kind, at }              that device's one reaction (round 15.11). Samples use id sample-01…
//   haikuMeta/counter           { seq, last }             the last permanent number handed out, and to which poem
//   haikuTexts/{sha256}         { post, uid }             duplicate lock: one poem per normalized (lower-cased) text
//   haikuPosters/{uid}          { last, windowStart, n }  rate limit: MIN_GAP_S between posts, PER_HOUR per uid per hour
//   comments/{id}              { parentId, parentSeq, text, author, uid, createdAt, reports, removed, hash, comment: true }
//                               NO seq. The parent's seal is unchanged. Flat only: parentId is a haiku or sample-XX.
//   comments/{id}/reports/{uid}  one report per anonymous uid
//   commentTexts/{sha256}      duplicate lock for comment text (separate from haikuTexts so the paste-in rules stay new)
//   commentPosters/{uid}       the same 20s / 12-per-hour limit, counted on its own so poem rules can stay as they are
//   Rules to paste: firestore.comments.rules (haiku-ooo only).
//
// Numbers: poems #1..SEED.length are the built-in samples (src/seed.js, shown on every phone, never stored, never
// reportable); the counter starts at SEED.length and each create is ONE transaction that bumps it and writes the poem with
// that seq, so numbers are permanent and gap-free at birth. A taken-down poem keeps its number (the gap shows).
// Takedown: a report = create haikus/{id}/reports/{uid} + reports+1 in one transaction; at TAKEDOWN_REPORTS the same
// write sets removed: true, and the rules then refuse to serve it to anyone (lists query `removed == false`).
// The 5-7-5 check cannot run inside Firestore rules: the client runs checkHaiku() (src/haiku.js) and the rules enforce
// the shape (exactly 3 non-empty lines, <= 80 chars each, <= 220 total) + field types/sizes. See docs in
// shots/round15_6-firebase-deploy.md for the limits of that.
import { checkHaiku } from './haiku.js';
import { SEED } from './seed.js';
import { TAKEDOWN_REPORTS, isReportable } from './moderation.js';
import { emptyCounts, isKind, normalizeCounts } from './react-data.js?v=15.14';

export const SDK_VERSION = '10.14.1';        // Firebase JS SDK, official gstatic ESM build
export const MIN_GAP_S = 20, PER_HOUR = 12;   // keep in sync with firestore.rules (tests/round15_6c.test.js checks)
export const FIRST_SEQ = SEED.length + 1;     // the first user poem's number (keep in sync with firestore.rules)
const OFFLINE = { reason: 'the scroll is out of reach, try again', offline: true };
const err = (msg, o) => Object.assign(new Error(msg), o);

// built-in samples numbered 1..N oldest first, newest first (same numbering LocalStore gives them on an empty phone)
export const SAMPLES = [...SEED].sort((a, b) => a.createdAt - b.createdAt).map((p, i) => ({ ...p, seq: i + 1 })).reverse();

export async function sha256hex(s) {
  const d = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// the browser default: the official ESM builds from gstatic (no bundler on haiku.ooo)
export async function loadSdk(v = SDK_VERSION) {
  const B = `https://www.gstatic.com/firebasejs/${v}/`;
  const [app, auth, firestore] = await Promise.all(['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'].map(f => import(/* @vite-ignore */ B + f)));
  return { app, auth, firestore };
}
const withTimeout = (p, ms) => ms > 0 ? Promise.race([p, new Promise((_, no) => setTimeout(() => no(err('timeout', OFFLINE)), ms))]) : p;

// pure: merge one page of remote poems (newest first) with the built-in samples, the same contract as pageOf()
export function mergePage(remote, { beforeSeq = Infinity, afterSeq = 0, limit = 24, maxSeq = 0, samples = SAMPLES } = {}) {
  const seeds = samples.filter(p => p.seq < beforeSeq && p.seq > afterSeq);
  let posts = [...remote, ...seeds].sort((a, b) => b.seq - a.seq);
  posts = afterSeq > 0 ? posts.slice(-limit) : posts.slice(0, limit);
  const low = posts.at(-1)?.seq;
  // anything older than `low`? the samples (never taken down) are 1..N, so any low > 1 has something under it,
  // as long as it is above afterSeq
  const nextBeforeSeq = low != null && low > 1 && low - 1 > afterSeq && (samples.length || remote.length >= limit) ? low : null;
  return { posts, nextBeforeSeq, maxSeq: Math.max(maxSeq, samples[0]?.seq || 0, posts[0]?.seq || 0) };
}

export class FirestoreStore {
  // config: the Firebase web config (src/config.js). sdk: { app, auth, firestore } modules (default: gstatic).
  // emulator: { host, firestorePort, authPort } for tests. timeoutMs: give up on a read this long (=> offline fallback).
  constructor(config, { sdk = null, emulator = null, timeoutMs = 9000, appName = 'haiku-ooo', longPolling = false } = {}) {
    Object.assign(this, { config, sdkIn: sdk, emulator, timeoutMs, appName, longPolling });
    this.ready = null; this.signedIn = null;
  }
  get shared() { return true; }
  _init() {
    return this.ready ||= (async () => {
      const sdk = this.sdkIn || await loadSdk(); const { app: A, auth: U, firestore: F } = sdk;
      const app = A.getApps().find(a => a.name === this.appName) || A.initializeApp(this.config, this.appName);
      // (longPolling: tests only; Playwright's Linux WebKit cannot hold Firestore's streaming channel. Real browsers use
      // the SDK default, which auto-detects long polling when a proxy/network needs it.)
      let db; try { db = this.longPolling ? F.initializeFirestore(app, { experimentalForceLongPolling: true }) : F.getFirestore(app); } catch { db = F.getFirestore(app); }
      const auth = U.getAuth(app);
      if (this.emulator && !this._emu) {
        this._emu = true; const { host = '127.0.0.1', firestorePort = 8080, authPort = 9099 } = this.emulator;
        F.connectFirestoreEmulator(db, host, firestorePort); U.connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
      }
      return { F, U, db, auth };
    })().catch(e => { this.ready = null; throw err('firebase sdk failed to load', { ...OFFLINE, cause: e }); });
  }
  // anonymous sign-in: once, in the background (app.js calls warm() after the board is up); posting/reporting await it
  uid() {
    return this.signedIn ||= (async () => {
      const { U, auth } = await this._init();
      if (auth.authStateReady) await auth.authStateReady();
      if (!auth.currentUser) await U.signInAnonymously(auth);
      return auth.currentUser.uid;
    })().catch(e => { this.signedIn = null; throw err('sign-in failed', { ...OFFLINE, cause: e }); });
  }
  warm() { return this.uid().catch(() => null); }
  _post(d) {
    const x = d.data(), t = x.createdAt;
    return { id: d.id, seq: x.seq, text: x.text, author: x.author || '', createdAt: t?.toMillis ? t.toMillis() : (+t || Date.now()), parentId: x.parentId || null };
  }
  _comment(d) {
    const x = d.data(), t = x.createdAt;
    return { id: d.id, parentId: x.parentId, parentSeq: x.parentSeq | 0, text: x.text, author: x.author || '', comment: true,
      createdAt: t?.toMillis ? t.toMillis() : (+t || Date.now()) };
  }
  async _maxSeq() {
    const { F, db } = await this._init();
    const c = await F.getDoc(F.doc(db, 'haikuMeta', 'counter'));
    return c.exists() ? c.data().seq || 0 : 0;
  }
  async list({ beforeSeq = Infinity, afterSeq = 0, limit = 24 } = {}) {
    limit = Math.max(1, Math.min(200, +limit || 24)); beforeSeq = +beforeSeq || Infinity; afterSeq = +afterSeq || 0;
    return withTimeout((async () => {
      const { F, db } = await this._init();
      let remote = [];
      if (beforeSeq > FIRST_SEQ) {
        const w = [F.where('removed', '==', false)];
        if (afterSeq >= FIRST_SEQ) w.push(F.where('seq', '>', afterSeq));
        if (isFinite(beforeSeq)) w.push(F.where('seq', '<', beforeSeq));
        const q = F.query(F.collection(db, 'haikus'), ...w, F.orderBy('seq', afterSeq > 0 ? 'asc' : 'desc'), F.limit(limit));
        remote = (await F.getDocs(q)).docs.map(d => this._post(d));
      }
      const maxSeq = await this._maxSeq();
      const page = mergePage(remote, { beforeSeq, afterSeq, limit, maxSeq });
      let comments = [];
      try { comments = await this.listComments(page.posts.map(p => p.id)); } catch (e) { console.warn('comments', e); }
      return { ...page, comments };
    })(), this.timeoutMs).catch(e => { throw e.reason ? e : err('load failed', { reason: 'the scroll is out of reach, try again', offline: true, cause: e }); });
  }
  async listComments(parentIds) {
    const ids = [...new Set((parentIds || []).filter(id => typeof id === 'string' && id.length > 0 && id.length <= 128))];
    if (!ids.length) return [];
    const { F, db } = await this._init();
    const out = [];
    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30);
      const q = F.query(F.collection(db, 'comments'), F.where('removed', '==', false), F.where('parentId', 'in', chunk));
      const snap = await F.getDocs(q);
      snap.forEach(d => out.push(this._comment(d)));
    }
    return out;
  }
  async create(text, { author = '', parentId = null, parentSeq = null } = {}) {
    const r = checkHaiku(text);
    if (!r.ok) throw err(r.reason, { reason: r.reason, check: r });
    author = String(author || '').trim().slice(0, 12);
    if (parentId) return this._createComment(r.normalized, author, parentId, parentSeq);
    const uid = await this.uid(), { F, db } = await this._init();
    const norm = r.normalized, hash = await sha256hex(norm.toLowerCase());
    if (SEED.some(p => p.text.toLowerCase() === norm.toLowerCase())) throw err('already posted', { reason: 'that haiku is already on the scroll' });
    const ref = F.doc(F.collection(db, 'haikus')), counter = F.doc(db, 'haikuMeta', 'counter');
    const lock = F.doc(db, 'haikuTexts', hash), poster = F.doc(db, 'haikuPosters', uid);
    let seq;
    // two phones posting at the same moment race for the same number: the loser's commit is refused by the rules (its
    // counter read is stale) rather than retried by the SDK, so try again (fresh read) a few times before giving up
    for (let attempt = 0; ; attempt++) try {
      await F.runTransaction(db, async tx => {
        const [c, l, p] = [await tx.get(counter), await tx.get(lock), await tx.get(poster)];
        if (l.exists()) throw err('already posted', { reason: 'that haiku is already on the scroll', mine: true });
        const now = Date.now(), pd = p.exists() ? p.data() : null, ms = t => t?.toMillis ? t.toMillis() : 0;
        if (pd && now - ms(pd.last) < MIN_GAP_S * 1000) throw err('slow down', { reason: 'let the ink dry a moment, then try again', mine: true });
        const fresh = !pd || now - ms(pd.windowStart) >= 3600e3;
        if (!fresh && (pd.n || 0) >= PER_HOUR) throw err('rate', { reason: 'that is a lot of haiku. rest the brush a while', mine: true });
        seq = c.exists() ? c.data().seq + 1 : FIRST_SEQ;
        const T = F.serverTimestamp();
        tx.set(counter, { seq, last: ref.id });
        tx.set(ref, { seq, text: norm, author, uid, createdAt: T, reports: 0, removed: false, hash });
        tx.set(lock, { post: ref.id, uid });
        tx.set(poster, fresh ? { last: T, windowStart: T, n: 1 } : { last: T, windowStart: pd.windowStart, n: (pd.n || 0) + 1 });
      });
      break;
    } catch (e) {
      if (e.mine) throw e;
      if ((e.code === 'permission-denied' || e.code === 'aborted') && attempt < 5) { await new Promise(r => setTimeout(r, 120 + Math.random() * 280 * (attempt + 1))); continue; }
      if (e.code === 'permission-denied') throw err('rejected', { reason: 'the scroll would not take that one. try again in a bit', cause: e });
      throw err('offline', { ...OFFLINE, cause: e });
    }
    return { id: ref.id, seq, text: norm, author, createdAt: Date.now() };
  }
  // A reply does not touch haikuMeta/counter. Its own text lock and rate limit live beside the poem ones.
  async _createComment(norm, author, parentId, parentSeq) {
    if (typeof parentId !== 'string' || !parentId || parentId.length > 128 || parentId.startsWith('local-')) throw err('no parent', { reason: 'that haiku is not on the scroll' });
    const seq = +parentSeq;
    if (!Number.isInteger(seq) || seq < 1) throw err('no parent', { reason: 'that haiku is not on the scroll' });
    const uid = await this.uid(), { F, db } = await this._init();
    const hash = await sha256hex(norm.toLowerCase());
    if (SEED.some(p => p.text.toLowerCase() === norm.toLowerCase())) throw err('already posted', { reason: 'that haiku is already on the scroll' });
    try {
      const poemLock = await F.getDoc(F.doc(db, 'haikuTexts', hash));
      if (poemLock.exists()) throw err('already posted', { reason: 'that haiku is already on the scroll', mine: true });
    } catch (e) { if (e.mine) throw e; }
    const ref = F.doc(F.collection(db, 'comments')), lock = F.doc(db, 'commentTexts', hash), poster = F.doc(db, 'commentPosters', uid);
    for (let attempt = 0; ; attempt++) try {
      await F.runTransaction(db, async tx => {
        const [l, p] = [await tx.get(lock), await tx.get(poster)];
        if (l.exists()) throw err('already posted', { reason: 'that haiku is already on the scroll', mine: true });
        const now = Date.now(), pd = p.exists() ? p.data() : null, ms = t => t?.toMillis ? t.toMillis() : 0;
        if (pd && now - ms(pd.last) < MIN_GAP_S * 1000) throw err('slow down', { reason: 'let the ink dry a moment, then try again', mine: true });
        const fresh = !pd || now - ms(pd.windowStart) >= 3600e3;
        if (!fresh && (pd.n || 0) >= PER_HOUR) throw err('rate', { reason: 'that is a lot of haiku. rest the brush a while', mine: true });
        const T = F.serverTimestamp();
        tx.set(ref, { parentId, parentSeq: seq, text: norm, author, uid, createdAt: T, reports: 0, removed: false, hash, comment: true });
        tx.set(lock, { post: ref.id, uid });
        tx.set(poster, fresh ? { last: T, windowStart: T, n: 1 } : { last: T, windowStart: pd.windowStart, n: (pd.n || 0) + 1 });
      });
      break;
    } catch (e) {
      if (e.mine) throw e;
      if ((e.code === 'permission-denied' || e.code === 'aborted') && attempt < 5) { await new Promise(r => setTimeout(r, 120 + Math.random() * 280 * (attempt + 1))); continue; }
      if (e.code === 'permission-denied') throw err('rejected', { reason: 'the scroll would not take that one. try again in a bit', cause: e });
      throw err('offline', { ...OFFLINE, cause: e });
    }
    return { id: ref.id, parentId, parentSeq: seq, text: norm, author, createdAt: Date.now(), comment: true };
  }
  async report(id, { reporter, comment = false } = {}) {      // (reporter = the device id the UI passes; here the anonymous uid counts instead)
    if (comment) return this._reportIn('comments', id);
    return this._reportIn('haikus', id);
  }
  async _reportIn(col, id) {
    if (!isReportable({ id }) || SEED.some(p => p.id === id)) throw err('not reportable', { reason: 'that haiku cannot be reported' });
    const uid = await this.uid(), { F, db } = await this._init();
    const ref = F.doc(db, col, id), mine = F.doc(db, col, id, 'reports', uid);
    try {
      return await F.runTransaction(db, async tx => {
        const m = await tx.get(mine);
        let p; try { p = await tx.get(ref); } catch (e) { if (e.code === 'permission-denied') throw err('gone', { reason: 'that haiku is already gone', mine: true, gone: true }); throw e; }
        if (!p.exists()) throw err('gone', { reason: 'that haiku is already gone', mine: true, gone: true });
        const n = p.data().reports || 0;
        if (m.exists()) return { count: n, already: true, removed: n >= TAKEDOWN_REPORTS };
        const count = n + 1, removed = count >= TAKEDOWN_REPORTS;
        tx.set(mine, { at: F.serverTimestamp() });
        tx.update(ref, { reports: count, removed });
        return { count, already: false, removed };
      });
    } catch (e) {
      if (e.mine) throw e;
      throw err('report failed', { reason: 'could not report, try again', cause: e });
    }
  }
  // one reaction per anonymous uid. Tapping the kind you already have clears it; any other kind replaces it.
  // The totals doc and the per-uid doc move in one transaction so firestore.reactions.rules can check the delta.
  async react(id, kind) {
    if (!isKind(kind) || !/^[A-Za-z0-9_-]{1,128}$/.test(id || '')) throw err('bad reaction', { reason: 'could not react, try again' });
    const uid = await this.uid(), { F, db } = await this._init();
    const parent = F.doc(db, 'poemRx', id), mine = F.doc(db, 'poemRx', id, 'by', uid);
    try {
      return await F.runTransaction(db, async tx => {
        const p = await tx.get(parent), m = await tx.get(mine);
        const counts = normalizeCounts(p.exists() ? p.data() : null);
        const prev = m.exists() && isKind(m.data().kind) ? m.data().kind : null;
        const next = prev === kind ? null : kind;
        if (prev) counts[prev] = Math.max(0, counts[prev] - 1);
        if (next) counts[next]++;
        if (next) tx.set(mine, { kind: next, at: F.serverTimestamp() });
        else if (m.exists()) tx.delete(mine);
        tx.set(parent, counts);
        return { mine: next, counts };
      });
    } catch (e) {
      if (e.reason) throw e;
      throw err('react failed', { reason: 'could not react, try again', cause: e });
    }
  }
  async reactionCounts(ids) {
    const want = [...new Set((ids || []).filter(id => /^[A-Za-z0-9_-]{1,128}$/.test(id || '')))];
    const out = {};
    if (!want.length) return out;
    const { F, db } = await this._init();
    for (let i = 0; i < want.length; i += 30) {
      const chunk = want.slice(i, i + 30);
      const q = F.query(F.collection(db, 'poemRx'), F.where(F.documentId(), 'in', chunk));
      const snap = await F.getDocs(q);
      snap.forEach(d => { out[d.id] = normalizeCounts(d.data()); });
    }
    for (const id of want) if (!out[id]) out[id] = emptyCounts();
    return out;
  }
  async myReaction(id) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id || '')) return null;
    const uid = await this.uid(), { F, db } = await this._init();
    const s = await F.getDoc(F.doc(db, 'poemRx', id, 'by', uid));
    return s.exists() && isKind(s.data().kind) ? s.data().kind : null;
  }
  async count() {
    try {
      const { F, db } = await this._init();
      const s = await withTimeout(F.getCountFromServer(F.query(F.collection(db, 'haikus'), F.where('removed', '==', false))), this.timeoutMs);
      return s.data().count + SAMPLES.length;
    } catch { return null; }
  }
}
