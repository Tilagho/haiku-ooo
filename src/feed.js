// Round 15.6b (Tiago, t183u): THE SHARED SCROLL. Everyone's poems, newest at the top; the further you swipe down, the
// further back in time you go, and older poems are fetched as you get near the end (infinite scroll).
//
// Why blocks: a scroll's painting is composed bottom-up (art row 0 = its oldest poem, src/scroll-engine2.js), so poems
// can only ever be added on TOP of a painting. To add OLDER poems underneath without repainting what is on screen, the
// scroll is cut into fixed blocks by poem number (block b = poems b*BLOCK+1 .. (b+1)*BLOCK, src/config.js). Every block
// is its own painting (its own ScrollView, seeded by its block number, so a block looks the same on every phone and on
// every visit). The newest block is the main view (Inky, birds, the stamp, new posts); older blocks are stacked below it
// as you swipe. A poem's kanji seal is its permanent number (seq); a taken-down poem's number is simply skipped.
import { BLOCK, POLL_MS } from './config.js';

const cssId = id => (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(id) : String(id).replace(/"/g, '');

export const blockOf = (seq, K = BLOCK) => Math.floor((Math.max(1, seq) - 1) / K);
export const blockSeed = (base, b) => b === 0 ? base : (Math.imul(base + 1, 2654435761) ^ Math.imul(b + 7, 40503)) >>> 0 & 0x7fffffff;
export const isComment = p => !!p?.parentId;
// Oldest-first top-level posts, with each poem's replies painted just before it (so they sit underneath,
// newest reply closest to the parent). Replies of poems not in `posts` are left out.
export function withComments(posts, comments) {
  const by = new Map();
  for (const c of comments || []) {
    if (!isComment(c)) continue;
    const a = by.get(c.parentId) || [];
    a.push(c); by.set(c.parentId, a);
  }
  for (const a of by.values()) a.sort((x, y) => (x.createdAt - y.createdAt) || String(x.id).localeCompare(String(y.id)));
  const out = [];
  for (const p of posts) {
    if (!p || isComment(p)) continue;
    for (const c of by.get(p.id) || []) out.push(c);
    out.push(p);
  }
  return out;
}
// pure: which loaded posts can be painted now. posts: newest first. `low` = lowest seq fetched so far, `done` = nothing
// older exists. Block b is complete once everything down to its first number has been fetched (or nothing is older).
export function readyBlocks(posts, { low, done, K = BLOCK, skip = new Set() } = {}) {
  const by = new Map();
  for (const p of posts) { const b = blockOf(p.seq, K); if (!skip.has(b)) (by.get(b) || by.set(b, []).get(b)).push(p); }
  return [...by.keys()].sort((a, b) => b - a).filter(b => done || low <= b * K + 1).map(b => ({ b, posts: by.get(b).sort((x, y) => x.seq - y.seq) }));
}

export class Feed {
  // main: the ScrollView already mounted in #scroll (it becomes the newest block). makeSegment(b, seed) -> a new ScrollView
  // mounted below the others. onIncoming(post): someone else's poem appeared at the top (polling).
  constructor({ main, store, seed = 31, K = BLOCK, makeSegment, onIncoming = () => {}, onPainted = () => {}, busy = () => false, sentinel = null, pollMs = POLL_MS }) {
    Object.assign(this, { main, store, seed, K, makeSegment, onIncoming, onPainted, busy, sentinel, pollMs });
    const add = main.add.bind(main); main.add = (p, o) => { this.noteAdded(p); return add(p, o); };   // every poem put on the main view (compose too)
    this.segments = [];            // [{ b, view }] newest first; segments[0].view === main
    this.pending = []; this.low = Infinity; this.done = false; this.loading = null; this.maxSeq = 0; this.ids = new Set();
    this.comments = []; this.commentIds = new Set();
    this.painted = new Set();      // block numbers already on screen
  }
  get views() { return this.segments.map(s => s.view); }
  recOf(el) { for (const v of this.views) { const r = v.byEl.get(el); if (r) return r; } return null; }
  viewOf(el) { return this.views.find(v => v.byEl.has(el)) || null; }
  get count() { return this.ids.size; }

  async boot() {
    const page = await this.store.list({ limit: this.K * 2 });
    this.maxSeq = page.maxSeq || page.posts[0]?.seq || 0;
    const top = blockOf(this.maxSeq || 1, this.K);
    this.main.reseed(blockSeed(this.seed, top));
    this.segments.push({ b: top, view: this.main });
    this.take(page); this.flush(top);
    // a nearly empty newest block: paint the next one straight away so the first screen is full
    if (this.main.composer.poems.length < 6 && !this.done) await this.more();
    this.watch();
    return this;
  }
  take(page) {
    for (const p of page.posts || []) {
      if (isComment(p)) { this.rememberComment(p); continue; }   // a reply must not join the seq pages
      if (!this.ids.has(p.id)) { this.ids.add(p.id); this.pending.push(p); this.low = Math.min(this.low, p.seq); }
    }
    for (const c of page.comments || []) this.rememberComment(c);
    if (!page.posts.length || page.nextBeforeSeq == null) this.done = true;
  }
  rememberComment(c) {
    if (!isComment(c) || !c.id || this.commentIds.has(c.id)) return false;
    this.commentIds.add(c.id); this.comments.push(c); return true;
  }
  // paint every block that is complete: the newest one into the main view, older ones as new segments below
  flush(top = this.segments[0].b) {
    let made = 0;
    for (const { b, posts } of readyBlocks(this.pending, { low: this.low, done: this.done, K: this.K, skip: this.painted })) {
      if (b > top) continue;                              // (newer than the main block: only via add())
      const view = b === top ? this.main : this.makeSegment(b, blockSeed(this.seed, b));
      if (b !== top) this.segments.push({ b, view });
      this.paintInto(view, posts);
      this.painted.add(b); made++;
      const keep = new Set(posts.map(p => p.id)); this.pending = this.pending.filter(p => !keep.has(p.id));
    }
    if (this.done && !this.pending.length) this.sentinel?.classList.add('end');
    if (made) this.onPainted(made);
    return made;
  }
  // fetch older poems until at least one more block is painted (or the scroll's very first poem is reached)
  more() {
    if (this.loading || this.done) return this.loading || Promise.resolve(0);
    this.loading = (async () => {
      let made = 0;
      try { while (!made && !this.done) { this.take(await this.store.list({ beforeSeq: this.low, limit: this.K * 2 })); made = this.flush(); } }
      catch (e) { console.warn('feed: could not load older poems', e); setTimeout(() => { if (this.near()) this.more(); }, 5000); }   // (try again while the reader is still near the end)
      finally { this.loading = null; }
      if (made) this.watch();
      return made;
    })();
    return this.loading;
  }
  watch() {
    if (!this.sentinel || typeof IntersectionObserver === 'undefined') return;
    this.io ||= new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) this.more().then(n => { if (n && this.near()) this.more(); }); }, { rootMargin: '0px 0px 2400px 0px' });
    this.io.disconnect(); this.io.observe(this.sentinel);
  }
  near() { const r = this.sentinel?.getBoundingClientRect(); return !!r && r.top < innerHeight + 2400; }
  paintInto(view, posts) {
    const ids = new Set(posts.map(p => p.id));
    for (const post of withComments(posts, this.comments.filter(c => ids.has(c.parentId)))) {
      view.add(post);
      if (!isComment(post)) view.tuckUnder?.(post.id);
    }
  }
  segmentOf(parentId) {
    return this.segments.find(s => s.view.composer.poems.some(p => p.post?.id === parentId && !isComment(p.post)));
  }
  // Compose the block again so the reply sits under its parent. Same seed keeps the poems below it put.
  repaint(seg, animateId = null) {
    const tops = seg.view.composer.poems.map(p => p.post).filter(p => p && !isComment(p));
    tops.sort((a, b) => a.seq - b.seq);
    const ids = new Set(tops.map(p => p.id));
    const anchor = seg.view.layer.querySelector('.poem:not([data-comment])');
    const before = anchor?.getBoundingClientRect().top;
    const y0 = typeof scrollY === 'number' ? scrollY : 0;
    const res = seg.view.rebuild(withComments(tops, this.comments.filter(c => ids.has(c.parentId))), { animateId });
    if (before != null && anchor) {
      const again = seg.view.layer.querySelector(`.poem[data-id="${cssId(anchor.dataset.id)}"]`);
      const after = again?.getBoundingClientRect().top;
      if (after != null && Math.abs(after - before) > 1) scrollTo({ top: y0 + (after - before), behavior: 'instant' });
    }
    this.onPainted?.(1);
    return res;
  }
  insertComment(comment, { animate = false } = {}) {
    if (!isComment(comment)) return null;
    this.rememberComment(comment);
    const seg = this.segmentOf(comment.parentId);
    if (!seg) return null;   // the parent is still pending; flush will paint the reply with it
    return this.repaint(seg, animate ? comment.id : null);
  }
  // my own new poem (or one polled in): remember it so polling does not add it twice. Replies never take a seq.
  noteAdded(post) {
    if (!post?.id) return;
    if (isComment(post)) { this.commentIds.add(post.id); return; }
    this.ids.add(post.id); if (post.seq > this.maxSeq) this.maxSeq = post.seq;
  }
  // other people's new poems: ask for anything newer than the newest we know about
  async poll() {
    if (!this.store.shared || (typeof document !== 'undefined' && document.hidden) || this.busy()) return 0;
    let got = 0;
    try {
      for (let i = 0; i < 4; i++) {
        const page = await this.store.list({ afterSeq: this.maxSeq, limit: this.K });
        const posts = (page.posts || []).filter(p => !isComment(p));
        const fresh = posts.filter(p => !this.ids.has(p.id)).sort((a, b) => a.seq - b.seq);
        for (const p of fresh) { this.noteAdded(p); this.onIncoming(p); got++; }
        posts.forEach(p => { if (p.seq > this.maxSeq) this.maxSeq = p.seq; });
        if (posts.length < this.K) break;
      }
      got += await this.pollComments();
    } catch {}
    return got;
  }
  async pollComments() {
    if (!this.store.listComments) return 0;
    const ids = [];
    for (const s of this.segments) for (const p of s.view.composer.poems) if (p.post && !isComment(p.post)) ids.push(p.post.id);
    if (!ids.length) return 0;
    let fresh = [];
    try { fresh = await this.store.listComments(ids); } catch { return 0; }
    const neu = (fresh || []).filter(c => isComment(c) && c.id && !this.commentIds.has(c.id));
    if (!neu.length) return 0;
    const segs = new Set();
    for (const c of neu) { this.rememberComment(c); const seg = this.segmentOf(c.parentId); if (seg) segs.add(seg); }
    for (const seg of segs) this.repaint(seg, null);
    return neu.length;
  }
  startPolling() { if (!this.store.shared || this.timer) return; this.timer = setInterval(() => this.poll(), this.pollMs);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.poll(); }); }
}
