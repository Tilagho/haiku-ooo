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
import { FirestoreStore } from './firebase-store.js?v=15.11';

const KEY = 'haiku-board:posts:v1', REPORTS_KEY = 'haiku-board:reports:v1', RX_KEY = 'haiku-board:reactions:v1';
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
  // every post (taken down or not) numbered oldest = 1, then the taken-down ones dropped, newest first
  _all() {
    const all = [...this.mine, ...SEED].sort((a, b) => a.createdAt - b.createdAt).map((p, i) => ({ ...p, seq: i + 1 }));
    return all.filter(p => !isRemoved(this.reports, p.id)).reverse();
  }
  // on this per-device store the reports live on this device only (so one device = at most one report: nothing is ever
  // taken down locally); the shared count lives on the server (RemoteStore)
  async report(id, { reporter } = {}) {
    const post = this._all().find(p => p.id === id);
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
  async list(o = {}) { return pageOf(this._all(), o); }
  async create(text, { author = '' } = {}) {
    const r = checkHaiku(text);
    if (!r.ok) throw Object.assign(new Error(r.reason), { reason: r.reason, check: r });
    if (this._all().some(p => p.text.toLowerCase() === r.normalized.toLowerCase())) throw Object.assign(new Error('already posted'), { reason: 'that haiku is already on the scroll' });
    const post = { id: 'local-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: r.normalized, createdAt: Date.now(), author: String(author || '').trim().slice(0, 12) };
    this.mine.unshift(post); this._save(); return this._all().find(p => p.id === post.id);
  }
  async count() { return this._all().length; }
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
  async create(text, { author = '' } = {}) {
    return this._json('/posts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, author }) }, 'rejected');
  }
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
  if (q === 'local') return new LocalStore();
  // local testing only: ?fbemu=8180 (&authemu=9199) = the Firebase emulators (demo project), never on a real host
  const emu = new URLSearchParams(search).get('fbemu'), host = globalThis.location?.hostname || '';
  if (emu && /^(localhost|127\.0\.0\.1)$/.test(host)) return new FirestoreStore({ apiKey: 'demo-key', authDomain: 'demo-haiku.firebaseapp.com', projectId: 'demo-haiku', appId: '1:1:web:1' },
    { emulator: { host: '127.0.0.1', firestorePort: +emu, authPort: +(new URLSearchParams(search).get('authemu') || 9199) }, longPolling: true });
  if (q === 'firebase') return firebase ? new FirestoreStore(firebase, firebaseOpts) : new LocalStore();
  if (q) return new RemoteStore(q);
  if (firebase) return new FirestoreStore(firebase, firebaseOpts);
  return base ? new RemoteStore(base) : new LocalStore();
}
