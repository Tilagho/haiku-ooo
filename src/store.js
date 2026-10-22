// Post storage behind one small interface so the backend can be swapped:
//
//   interface PostStore {
//     list({ before?: number, limit?: number }): Promise<{ posts: Post[], nextBefore: number|null }>
//     create(text: string): Promise<Post>           // throws { reason } if not a haiku / rejected
//   }
//   type Post = { id, text /* 3 lines joined by \n */, createdAt /* ms */, author?, sample? }
//
// LocalStore: localStorage + seeded samples (prototype).
// RemoteStore: same contract over HTTP (GET /api/posts?before=&limit=, POST /api/posts {text}).
// The server MUST re-run checkHaiku() itself; the client check is only for live feedback.
import { checkHaiku } from './haiku.js';
import { SEED } from './seed.js';

const KEY = 'haiku-board:posts:v1';

export class LocalStore {
  constructor() { this.mine = this._load(); }
  _load() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } }
  _save() { try { localStorage.setItem(KEY, JSON.stringify(this.mine.slice(0, 500))); } catch {} }
  _all() { return [...this.mine, ...SEED].sort((a, b) => b.createdAt - a.createdAt); }
  async list({ before = Infinity, limit = 20 } = {}) {
    const posts = this._all().filter(p => p.createdAt < before).slice(0, limit);
    const more = this._all().some(p => p.createdAt < (posts.at(-1)?.createdAt ?? -1));
    return { posts, nextBefore: more ? posts.at(-1).createdAt : null };
  }
  async create(text) {
    const r = checkHaiku(text);
    if (!r.ok) throw Object.assign(new Error(r.reason), { reason: r.reason, check: r });
    if (this._all().some(p => p.text.toLowerCase() === r.normalized.toLowerCase())) throw Object.assign(new Error('already posted'), { reason: 'that haiku is already on the scroll' });
    const post = { id: 'local-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: r.normalized, createdAt: Date.now(), author: 'you' };
    this.mine.unshift(post); this._save(); return post;
  }
  async count() { return this._all().length; }
}

export class RemoteStore {
  constructor(base = '/api') { this.base = base; }
  async list({ before, limit = 20 } = {}) {
    const q = new URLSearchParams({ limit }); if (before) q.set('before', before);
    const r = await fetch(`${this.base}/posts?${q}`); if (!r.ok) throw new Error('load failed'); return r.json();
  }
  async create(text) {
    const r = await fetch(`${this.base}/posts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(body.reason || 'rejected'), { reason: body.reason || 'rejected' });
    return body;
  }
  async count() { const r = await fetch(`${this.base}/count`); return r.ok ? (await r.json()).count : null; }
}

export function createStore() {
  const api = new URLSearchParams(location.search).get('api');   // ?api=https://... to try a real backend
  return api ? new RemoteStore(api) : new LocalStore();
}
