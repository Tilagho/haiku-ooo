// DOM renderer for the composed scroll. The background is the engine's single art-resolution ink buffer, painted
// lazily into low-res chunk canvases (130 x 256 art px each) that the browser upscales nearest-neighbour, so every
// background pixel on screen is the same size. Poems are small <canvas> bitmaps on top. Everything sits in one
// 390-unit-wide layer scaled to the phone width and positioned with CSS `bottom`, so new posts grow the scroll
// upward without touching older nodes.
import { ScrollComposer, SCROLL_W, U, AW, PX, paintRows } from './scroll-engine2.js';
import { drawLine, drawSeal, sealDims, SEAL_PX, ditherBacking, font, rng, hash } from './brush-text.js';
import { clock } from './clock.js';
import { prefersReducedMotion } from './spring.js';

const CH = 256;                    // art rows per background chunk canvas (768 units)
export class ScrollView {
  constructor(host, { seed = 575, lib, onTapPoem } = {}) {
    this.host = host; this.composer = new ScrollComposer({ seed, lib }); this.onTapPoem = onTapPoem;
    this.layer = document.createElement('div'); this.layer.className = 'art-layer';
    this.grain = document.createElement('div'); this.grain.className = 'grain';
    this.fade = document.createElement('div'); this.fade.className = 'top-fade';
    host.append(this.layer, this.grain, this.fade);
    this.chunks = []; this.visible = new Set();
    this.io = new IntersectionObserver(es => {
      for (const e of es) { const c = e.target.chunk; if (e.isIntersecting) { this.visible.add(c); this.paintChunk(c); } else this.visible.delete(c); }
    }, { rootMargin: '1600px 0px' });                       // paint a couple of screens ahead of the reader
    new ResizeObserver(() => this.fit()).observe(host);
    // tapping a poem never highlights it (the scroll is one seamless painting): it hands the poem to onTapPoem,
    // which copies it. Keyboard users get the same with Enter / Space on the (ring-less) focused poem.
    this.layer.addEventListener('click', e => { const p = e.target.closest('.poem'); if (p) this.onTapPoem?.(this.byEl.get(p), p, e); });
    this.layer.addEventListener('keydown', e => { const p = e.target.closest?.('.poem'); if (p && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); const r = p.getBoundingClientRect(); this.onTapPoem?.(this.byEl.get(p), p, { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }); } });
    this.byEl = new WeakMap();   // poem element -> { poem, post, cv, ... }
    this.pix = [];   // pixel-art nodes sized in font px: [el, fontW, fontH, box, pad]
  }
  get art() { return this.composer.art; }
  // CSS px (= scroll units) per font pixel, chosen so one font pixel is an integer number of DEVICE pixels
  // (crisp, no smoothing) and never larger than the U the layout reserved.
  fontScale(u = U) {
    const s = this.host.clientWidth / SCROLL_W || 1, dpr = devicePixelRatio || 1, dev = dpr * s;
    let k = Math.max(1, Math.round(u * dev)); while (k > 1 && k / dev > u + 1e-6) k--;
    return k / dev;
  }
  fit() {
    const s = this.host.clientWidth / SCROLL_W, H = this.composer.height;
    this.layer.style.transform = `scale(${s})`; this.layer.style.height = H + 'px';
    this.host.style.height = Math.ceil(H * s) + 'px';
    const key = this.host.clientWidth + 'x' + devicePixelRatio; if (key !== this.fitKey) { this.fitKey = key; this.pix.forEach(a => this.sizePix(...a)); }
  }
  // place a font-px bitmap node anchored to the top-left of its reserved box (box = {x,y,h} in units)
  sizePix(el, fw, fh, box, pad = 0, u = U) {
    const c = this.fontScale(u);
    Object.assign(el.style, { left: box.x - pad * c + 'px', bottom: box.y + box.h - (fh - pad) * c + 'px', width: fw * c + 'px', height: fh * c + 'px' });
  }
  // background chunks: created as the scroll grows, painted only when near the viewport; a chunk that reaches
  // above the last final art row is repainted once newer regions have been generated over it
  syncArt() {
    const A = this.art, rows = Math.ceil(this.composer.height / PX), need = Math.ceil(rows / CH);
    for (const c of this.chunks) if (c.painted && c.top < A.top && (c.i + 1) * CH > c.top) { c.painted = false; if (this.visible.has(c)) this.paintChunk(c); }
    while (this.chunks.length < need) {
      const i = this.chunks.length, cv = document.createElement('canvas'); cv.width = AW; cv.height = CH; cv.className = 'bg6';
      Object.assign(cv.style, { bottom: i * CH * PX + 'px', height: CH * PX + 'px' });
      const c = { i, cv, painted: false, top: 0 }; cv.chunk = c; this.chunks.push(c);
      this.layer.prepend(cv); this.io.observe(cv);
    }
    return [];
  }
  paintAll() { this.chunks.forEach(c => this.paintChunk(c)); }        // captures / print
  paintChunk(c) {
    if (c.painted) return;
    const ctx = c.cv.getContext('2d'), img = ctx.createImageData(AW, CH);
    paintRows(this.art, c.i * CH, CH, img.data); ctx.putImageData(img, 0, 0);
    c.painted = true; c.top = this.art.top;
  }
  add(post, { animate = false } = {}) {
    const before = this.composer.height;
    const { poem } = this.composer.addPost(post);
    const fresh = this.syncArt(), pn = this.poemNode(poem);
    this.fit();
    const played = animate && !prefersReducedMotion() ? this.animateIn(fresh, pn) : Promise.resolve();
    return { poem, node: pn, played };
  }
  // Paint a poem bitmap: its three lines (optionally only the first `chars` characters, for typing in), the signature,
  // the dithered paper backing, and (unless seal = false) its kanji number seal.
  paintPoem(rec, { chars = Infinity, sig = true, seal = true } = {}) {
    const { poem: p, cv, W, H, pad } = rec, { layout: L, post, n } = p, F = font('main'), S = font('small');
    const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), buf = { w: W, h: H, data: img.data };
    const R = rng(hash(post.id, n));
    let left = chars;
    for (const l of L.lines) { if (left <= 0) break; const t = [...l.t].slice(0, left).join(''); left -= [...l.t].length; drawLine(buf, t, l.x + pad, l.y + pad, F, R); }
    if (sig) drawLine(buf, L.sig.t, L.sig.x + pad, L.sig.y + pad, S, R, { color: [86, 80, 88] });
    ditherBacking(buf, { solid: 1, fade: 4.5 });               // dithered paper behind the letters (art may peek in)
    if (seal) drawSeal(buf, n, L.seal.x + pad, L.seal.y + pad, R);
    ctx.putImageData(img, 0, 0);
  }
  poemNode(p) {
    const { layout: L, post, n } = p;
    const pad = 6, W = L.w + pad * 2, H = L.h + pad * 2;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.className = 'pc';
    const wrap = document.createElement('figure'); wrap.className = 'poem poem-' + L.kind; wrap.dataset.n = n; wrap.dataset.id = post.id;
    wrap.tabIndex = 0; wrap.setAttribute('role', 'button');
    wrap.setAttribute('aria-label', `haiku ${n}: ${post.text.replace(/\n/g, ' / ')}. tap to copy`);
    const rec = { poem: p, post, cv, W, H, pad, el: wrap };
    this.byEl.set(wrap, rec); this.paintPoem(rec);
    this.pix.push([wrap, W, H, p, pad, L.u]); this.sizePix(wrap, W, H, p, pad, L.u);
    wrap.appendChild(cv); this.layer.appendChild(wrap);
    return wrap;
  }
  newest() { return [...this.layer.querySelectorAll('.poem')].reduce((a, b) => (!a || +b.dataset.n > +a.dataset.n ? b : a), null); }
  recOf(el) { if (typeof el === 'string') el = this.layer.querySelector(`.poem[data-id="${CSS.escape(el)}"]`); else if (typeof el === 'number') el = this.layer.querySelector(`.poem[data-n="${el}"]`); return el && this.byEl.get(el); }

  // Old-school RPG text: the poem types itself in one letter at a time, line by line, the dithered paper growing
  // under the letters; the signature appears at the end. The seal is left off for stampSeal() to slam on.
  async typePoem(el, { cps = 24, linePause = 260 } = {}) {
    const rec = this.recOf(el); if (!rec) return;
    if (prefersReducedMotion()) { this.paintPoem(rec, { seal: false }); return; }
    const lens = rec.poem.layout.lines.map(l => [...l.t].length), total = lens.reduce((a, b) => a + b, 0);
    const ends = new Set(lens.map((_, i) => lens.slice(0, i + 1).reduce((a, b) => a + b, 0)));
    rec.el.classList.add('typing');
    this.paintPoem(rec, { chars: 0, sig: false, seal: false });
    for (let k = 1; k <= total; k++) {
      await clock.wait(1000 / cps);
      this.paintPoem(rec, { chars: k, sig: false, seal: false });
      if (ends.has(k)) await clock.wait(linePause);
    }
    await clock.wait(180);
    this.paintPoem(rec, { seal: false });
    rec.el.classList.remove('typing');
  }

  // THE SEAL-STAMP HOOK. The red kanji number seal slams onto the paper: it drops in big, hits, squashes,
  // bleeds a little ink and throws a few specks, the scroll bumps, then it settles perfectly straight and is
  // baked back into the poem bitmap. Resolves when settled; also fires `haiku:sealed` on window.
  async stampSeal(el, { bump = true, specks = 9 } = {}) {
    const rec = this.recOf(el); if (!rec) return;
    const { poem: p, W, H, pad } = rec, L = p.layout, n = p.n, [sw, sh] = sealDims(n);
    const done = () => { this.paintPoem(rec); window.dispatchEvent(new CustomEvent('haiku:sealed', { detail: { n, id: rec.post.id, el: rec.el } })); };
    if (prefersReducedMotion()) return done();
    this.paintPoem(rec, { seal: false });
    const sx = L.seal.x + pad, sy = L.seal.y + pad, pct = (v, of) => (v / of * 100) + '%';
    const box = (cls, x, y, w, h) => { const d = document.createElement('canvas'); d.className = cls; d.width = w; d.height = h;
      Object.assign(d.style, { left: pct(x, W), top: pct(y, H), width: pct(w, W), height: pct(h, H) }); rec.el.appendChild(d); return d; };
    // the seal itself, on its own canvas
    const fly = box('seal-fly', sx, sy, sw, sh), fctx = fly.getContext('2d'), fim = fctx.createImageData(sw, sh);
    drawSeal({ w: sw, h: sh, data: fim.data }, n, 0, 0, rng(hash(rec.post.id, n, 'fly'))); fctx.putImageData(fim, 0, 0);
    // wet ink that soaks out from under it on impact: the seal's shape grown by 2 px, dithered, fading away
    const B = SEAL_PX, bleed = box('seal-bleed', sx - B, sy - B, sw + 2 * B, sh + 2 * B), bctx = bleed.getContext('2d'), bim = bctx.createImageData(sw + 2 * B, sh + 2 * B);
    for (let j = 0; j < sh + 2 * B; j++) for (let i = 0; i < sw + 2 * B; i++) {
      const SX = i - B, SY = j - B; if (SX >= 0 && SY >= 0 && SX < sw && SY < sh && fim.data[(SY * sw + SX) * 4 + 3]) continue;   // only around the seal, never over it
      let near = false; for (let dj = -B; dj <= B && !near; dj++) for (let di = -B; di <= B && !near; di++) { const X = i - B + di, Y = j - B + dj; if (X >= 0 && Y >= 0 && X < sw && Y < sh && fim.data[(Y * sw + X) * 4 + 3] && di * di + dj * dj <= B * B + 1) near = true; }
      if (near && (((i / B | 0) ^ (j / B | 0)) & 1)) bim.data.set([214, 52, 40, 150], (j * (sw + 2 * B) + i) * 4);
    }
    bctx.putImageData(bim, 0, 0); bleed.style.opacity = 0;
    const T = 560, hit = .34;
    const a = fly.animate([
      { transform: 'translateY(-38%) scale(3.4)', opacity: 0, offset: 0 },
      { transform: 'translateY(-14%) scale(2.1)', opacity: .9, offset: .2 },
      { transform: 'translateY(0) scale(.86, 1.0)', opacity: 1, offset: hit, easing: 'ease-out' },
      { transform: 'translateY(4%) scale(1.22, .76)', opacity: 1, offset: .46 },
      { transform: 'translateY(-3%) scale(.92, 1.1)', offset: .64 },
      { transform: 'translateY(0) scale(1.04, .97)', offset: .82 },
      { transform: 'translateY(0) scale(1, 1)', opacity: 1 },
    ], { duration: T, easing: 'cubic-bezier(.5,0,.9,.5)', fill: 'both' });
    await clock.wait(T * hit);
    // impact: ink soaks out, specks fly, the paper bumps
    bleed.animate([{ opacity: 0 }, { opacity: 1, offset: .12 }, { opacity: .7, offset: .5 }, { opacity: 0 }], { duration: 760, easing: 'steps(6)', fill: 'both' });
    const c = this.fontScale(L.u), R = rng(hash(rec.post.id, n, 'specks'));
    for (let k = 0; k < specks; k++) {
      const d = document.createElement('i'); d.className = 'seal-speck'; const s = (1 + Math.floor(R() * 2.4)) * c;
      const cx = sx + sw / 2, cy = sy + sh / 2, ang = (k / specks) * Math.PI * 2 + R() * .6, rx = sw / 2 + 1, ry = sh / 2 + 1;
      Object.assign(d.style, { left: pct(cx + Math.cos(ang) * rx, W), top: pct(cy + Math.sin(ang) * ry, H), width: s + 'px', height: s + 'px' });
      rec.el.appendChild(d);
      const dist = (3 + R() * 7) * c, dx = Math.round(Math.cos(ang) * dist / c) * c, dy = Math.round(Math.sin(ang) * dist / c) * c;
      d.animate([{ transform: 'translate(0,0)', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px)`, opacity: 1, offset: .55 }, { transform: `translate(${dx}px, ${dy + c}px)`, opacity: 0 }],
        { duration: 520 + R() * 260, easing: 'steps(7)', fill: 'both' }).finished.then(() => d.remove(), () => d.remove());
    }
    if (bump) this.host.animate([0, 3, -2, 1, 0].map(v => ({ transform: `translateY(${v}px)` })), { duration: 240, easing: 'steps(5)' });
    await Promise.race([a.finished.catch(() => {}), clock.wait(T * (1 - hit) + 40)]);
    done(); fly.remove();
    await clock.wait(800); bleed.remove();
  }
  // a freshly posted poem: the art is revealed, the poem types in, then the seal is stamped
  async animateIn(nodes, poem) {
    nodes.forEach((n, i) => n.animate([{ clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0 0 0 0)' }],
      { duration: 900, delay: i * 120, easing: 'steps(12)', fill: 'backwards' }));
    const rec = this.byEl.get(poem); this.paintPoem(rec, { chars: 0, sig: false, seal: false });
    await clock.wait(500);
    await this.typePoem(poem); await this.stampSeal(poem);
  }
  scrollToPoem(el, behavior = 'smooth') { const r = el.getBoundingClientRect(); scrollTo({ top: scrollY + r.top - innerHeight * 0.3, behavior }); }
  scenes() { return this.art.regions.map(r => ({ level: r.level, y: r.y0 * PX, h: (r.y1 - r.y0) * PX })); }
}
