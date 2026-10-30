// Post storage behind one small interface so the backend can be swapped:
//
//   interface PostStore {
//     list({ beforeSeq?, afterSeq?, limit? }): Promise<{ posts: Post[] /* newest first */, nextBeforeSeq: number|null, maxSeq: number }>
//     create(text: string, { author?: string }): Promise<Post>   // throws { reason } if not a haiku / rejected
//     report(id: string, { reporter: string }): Promise<{ count, already, removed }>   // round 15.6 (src/moderation.js)
//     react(id, kind): Promise<{ mine: kind|null, counts }>   // round 15.11, one kind per person (src/react-data.js)
//     reactionCounts(ids): Promise<{ [id]: counts }>
//     myReaction(id): Promise<kind|null>
//   }
//   type Post = { id, seq /* its permanent number = the kanji seal */, text /* 3 lines joined by \n */, createdAt /* ms */,
//                 author? ('' = unsigned), sample? }
//   type Comment = { id, parentId, parentSeq, text, createdAt, author?, comment: true }
//                 A comment has no seq seal. list() returns it on `comments`, never inside `posts`.
//   list() never returns a poem that has been taken down (TAKEDOWN_REPORTS unique reporters); its number is simply skipped.
//   Paging is by seq (round 15.6b): newest first, `beforeSeq` walks back in time as the reader scrolls down,
//   `afterSeq` fetches poems newer than what is on screen (other people's posts, src/feed.js).
//
// LocalStore: localStorage + seeded samples (per-device prototype / offline fallback).
// FirestoreStore (src/firebase-store.js, round 15.6c): THE PRODUCTION shared board, Firestore + anonymous auth in the
//   haiku.ooo's own Firebase project. The Firebase SDK itself loads lazily (gstatic), only when Firestore is first used.
// RemoteStore: the shared board over HTTP (GET /posts?beforeSeq=&afterSeq=&limit=, POST /posts {text, author},
//   POST /posts/:id/report {reporter}). Servers: tools/api-server.mjs (local dev / e2e) and worker/ (Cloudflare
//   reference, not deployed). An HTTP server MUST re-run checkHaiku() itself; the client check is only live feedback.
import { checkHaiku } from './haiku.js';
import { SEED } from './seed.js';
import { tally, isRemoved, isReportable, deviceId } from './moderation.js';
import { applyCounts, emptyCounts, isKind, normalizeCounts } from './react-data.js';
import { API_BASE, FIREBASE } from './config.js';
import { FirestoreStore } from './firebase-store.js?v=15.14';

const KEY = 'haiku-board:posts:v1', REPORTS_KEY = 'haiku-board:reports:v1', RX_KEY = 'haiku-board:reactions:v1';
// ?api=local&demo=comments paints these under the newest sample (sample-01) so the board can be tried offline.
export const DEMO_COMMENTS = [
  { id: 'demo-comment-1', parentId: 'sample-01', author: 'ink', createdAt: Date.UTC(2026, 9, 27, 16, 0),
    text: 'a smaller voice sits\njust under the quiet pond\nstill counting ripples' },
  { id: 'demo-comment-2', parentId: 'sample-01', author: '', createdAt: Date.UTC(2026, 9, 27, 18, 30),
    text: 'tucked beside the brush\na small note learning to bow\nthen fades into mist' },
];
// one page of a newest-first list already numbered by seq
export function pageOf(all, { beforeSeq = Infinity, afterSeq = 0, limit = 24 } = {}) {
  limit = Math.max(1, Math.min(200, +limit || 24));
  const inRange = all.filter(p => p.seq < beforeSeq && p.seq > afterSeq);
  const posts = afterSeq > 0 ? inRange.slice(-limit) : inRange.slice(0, limit);     // afterSeq: the poems just after it
  const low = posts.at(-1)?.seq;
  return { posts, nextBeforeSeq: low != null && all.some(p => p.seq < low && p.seq > afterSeq) ? low : null, maxSeq: all[0]?.seq || 0 };
}

export class LocalStore {
  constructor() {
    this.mine = this._load(); this.reports = {}; this.rx = {};
    try { this.reports = JSON.parse(localStorage.getItem(REPORTS_KEY)) || {}; } catch {}
    try { this.rx = JSON.parse(localStorage.getItem(RX_KEY)) || {}; } catch {}
  }
  get shared() { return false; }
  _load() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } }
  _save() { try { localStorage.setItem(KEY, JSON.stringify(this.mine.slice(0, 500))); } catch {} }
  // top-level poems only, numbered oldest = 1. Comments live in `mine` too but never take a seal.
  _tops() {
    const all = [...this.mine.filter(p => !p.parentId), ...SEED].sort((a, b) => a.createdAt - b.createdAt).map((p, i) => ({ ...p, seq: i + 1 }));
    return all.filter(p => !isRemoved(this.reports, p.id)).reverse();
  }
  _all() { return this._tops(); }
  _comments() {
    const seqOf = new Map();
    [...this.mine.filter(p => !p.parentId), ...SEED].sort((a, b) => a.createdAt - b.createdAt).forEach((p, i) => seqOf.set(p.id, i + 1));
    return this.mine.filter(p => p.parentId && seqOf.has(p.parentId) && !isRemoved(this.reports, p.parentId) && !isRemoved(this.reports, p.id))
      .map(p => ({ ...p, parentSeq: seqOf.get(p.parentId), comment: true }));
  }
  seedDemo(list = DEMO_COMMENTS) {
    let n = 0;
    for (const c of list) if (c?.parentId && !this.mine.some(p => p.id === c.id)) { this.mine.push({ ...c, comment: true }); n++; }
    if (n) this._save();
    return n;
  }
  // on this per-device store the reports live on this device only (so one device = at most one report: nothing is ever
  // taken down locally); the shared count lives on the server (RemoteStore)
  async report(id, { reporter } = {}) {
    const post = this._tops().find(p => p.id === id) || this._comments().find(p => p.id === id);
    if (!isReportable(post)) throw Object.assign(new Error('not reportable'), { reason: 'that haiku cannot be reported' });
    const r = tally(this.reports, id, [reporter]);
    try { localStorage.setItem(REPORTS_KEY, JSON.stringify(this.reports)); } catch {}
    return r;
  }
  _saveRx() { try { localStorage.setItem(RX_KEY, JSON.stringify(this.rx)); } catch {} }
  // this device only (the shared totals live on Firestore). One kind at a time; tapping it again clears it.
  async react(id, kind) {
    if (!isKind(kind) || typeof id !== 'string' || !id) throw Object.assign(new Error('bad reaction'), { reason: 'could not react, try again' });
    const who = deviceId(), slot = this.rx[id] || (this.rx[id] = { by: {}, counts: emptyCounts() });
    const prev = isKind(slot.by[who]) ? slot.by[who] : null, next = prev === kind ? null : kind;
    slot.counts = applyCounts(slot.counts, prev, next);
    if (next) slot.by[who] = next; else delete slot.by[who];
    this._saveRx();
    return { mine: next, counts: { ...slot.counts } };
  }
  async reactionCounts(ids) { const out = {}; for (const id of ids || []) out[id] = normalizeCounts(this.rx[id]?.counts); return out; }
  async myReaction(id) { const k = this.rx[id]?.by?.[deviceId()]; return isKind(k) ? k : null; }
  async list(o = {}) {
    const page = pageOf(this._tops(), o);
    const ids = new Set(page.posts.map(p => p.id));
    return { ...page, comments: this._comments().filter(c => ids.has(c.parentId)) };
  }
  async listComments(parentIds) {
    const ids = new Set(parentIds || []);
    return this._comments().filter(c => ids.has(c.parentId));
  }
  async create(text, { author = '', parentId = null } = {}) {
    const r = checkHaiku(text);
    if (!r.ok) throw Object.assign(new Error(r.reason), { reason: r.reason, check: r });
    const norm = r.normalized;
    if ([...this._tops(), ...this._comments()].some(p => p.text.toLowerCase() === norm.toLowerCase())) throw Object.assign(new Error('already posted'), { reason: 'that haiku is already on the scroll' });
    author = String(author || '').trim().slice(0, 12);
    if (parentId) {
      const parent = this._tops().find(p => p.id === parentId);
      if (!parent || parent.parentId) throw Object.assign(new Error('no parent'), { reason: 'that haiku is not on the scroll' });
      const post = { id: 'local-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), parentId, parentSeq: parent.seq, text: norm, createdAt: Date.now(), author, comment: true };
      this.mine.unshift(post); this._save(); return { ...post };
    }
    const post = { id: 'local-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: norm, createdAt: Date.now(), author };
    this.mine.unshift(post); this._save(); return this._tops().find(p => p.id === post.id);
  }
  async count() { return this._tops().length; }
}

export class RemoteStore {
  constructor(base = '/api') { this.base = base.replace(/\/+$/, ''); }
  get shared() { return true; }
  async _json(path, init, fail) {
    let r; try { r = await fetch(this.base + path, init); } catch { throw Object.assign(new Error('offline'), { reason: 'the scroll is out of reach, try again', offline: true }); }
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(body.reason || fail), { reason: body.reason || fail, status: r.status });
    return body;
  }
  async list({ beforeSeq, afterSeq, limit = 24 } = {}) {
    const q = new URLSearchParams({ limit }); if (beforeSeq && isFinite(beforeSeq)) q.set('beforeSeq', beforeSeq); if (afterSeq) q.set('afterSeq', afterSeq);
    return this._json(`/posts?${q}`, { cache: 'no-store' }, 'load failed');
  }
  async create(text, { author = '', parentId = null } = {}) {
    if (parentId) throw Object.assign(new Error('no comments'), { reason: 'comments need this phone (?api=local) or Firebase' });
    return this._json('/posts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, author }) }, 'rejected');
  }
  async listComments() { return []; }
  async report(id, { reporter } = {}) {
    return this._json(`/posts/${encodeURIComponent(id)}/report`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reporter }) }, 'could not report, try again');
  }
  async react() { throw Object.assign(new Error('no reactions'), { reason: 'could not react, try again' }); }
  async reactionCounts(ids) { const out = {}; for (const id of ids || []) out[id] = emptyCounts(); return out; }
  async myReaction() { return null; }
  async count() { try { return (await this._json('/count', {}, '')).count; } catch { return null; } }
}

// ?api=… wins (local = the per-device board, firebase = Firestore, else a URL or a path like /api), then the baked
// FIREBASE config (src/config.js, production), then API_BASE, then the per-device LocalStore
export function createStore({ search = globalThis.location?.search || '', base = API_BASE, firebase = FIREBASE, firebaseOpts = {} } = {}) {
  const q = new URLSearchParams(search).get('api');
  if (q === 'local') {
    const s = new LocalStore();
    if (new URLSearchParams(search).get('demo') === 'comments') s.seedDemo();
    return s;
  }
  // local testing only: ?fbemu=8180 (&authemu=9199) = the Firebase emulators (demo project), never on a real host
  const emu = new URLSearchParams(search).get('fbemu'), host = globalThis.location?.hostname || '';
  if (emu && /^(localhost|127\.0\.0\.1)$/.test(host)) return new FirestoreStore({ apiKey: 'demo-key', authDomain: 'demo-haiku.firebaseapp.com', projectId: 'demo-haiku', appId: '1:1:web:1' },
    { emulator: { host: '127.0.0.1', firestorePort: +emu, authPort: +(new URLSearchParams(search).get('authemu') || 9199) }, longPolling: true });
  if (q === 'firebase') return firebase ? new FirestoreStore(firebase, firebaseOpts) : new LocalStore();
  if (q) return new RemoteStore(q);
  if (firebase) return new FirestoreStore(firebase, firebaseOpts);
  return base ? new RemoteStore(base) : new LocalStore();
}
