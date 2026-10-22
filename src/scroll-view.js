// DOM renderer for the composed scroll. The background is the engine's single art-resolution ink buffer, painted
// lazily into low-res chunk canvases (130 x 256 art px each) that the browser upscales nearest-neighbour, so every
// background pixel on screen is the same size. Poems are small <canvas> bitmaps on top. Everything sits in one
// 390-unit-wide layer scaled to the phone width and positioned with CSS `bottom`, so new posts grow the scroll
// upward without touching older nodes.
import { ScrollComposer, SCROLL_W, U, AW, PX, paintRows } from './scroll-engine2.js';
import { drawLine, drawSeal, ditherBacking, font, rng, hash } from './brush-text.js';
import { clock } from './clock.js';
import { springAnimate, SPRINGS, JELLY, prefersReducedMotion } from './spring.js';

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
    this.layer.addEventListener('click', e => {
      const st = e.target.closest('.gag'); if (st) { e.stopPropagation(); this.onTapStamp?.(st); springAnimate(st, JELLY, SPRINGS.pop, { fill: 'none' }); return; }
      const p = e.target.closest('.poem'); if (p) this.highlight(p);
    });
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
    if (animate && !prefersReducedMotion()) this.animateIn(fresh, pn);
    return { poem, node: pn };
  }
  poemNode(p) {
    const { layout: L, post, n } = p, F = font('main'), S = font('small');
    const pad = 6, W = L.w + pad * 2, H = L.h + pad * 2;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), buf = { w: W, h: H, data: img.data };
    const R = rng(hash(post.id, n));
    L.lines.forEach(l => drawLine(buf, l.t, l.x + pad, l.y + pad, F, R));
    drawLine(buf, L.sig.t, L.sig.x + pad, L.sig.y + pad, S, R, { color: [86, 80, 88] });
    ditherBacking(buf, { solid: 1, fade: 4.5 });               // dithered paper behind the letters (art may peek in)
    drawSeal(buf, n, L.seal.x + pad, L.seal.y + pad, R);
    ctx.putImageData(img, 0, 0);
    const wrap = document.createElement('figure'); wrap.className = 'poem poem-' + L.kind; wrap.dataset.n = n; wrap.dataset.id = post.id;
    wrap.tabIndex = 0; wrap.setAttribute('role', 'button'); wrap.setAttribute('aria-label', `haiku ${n}: ${post.text.replace(/\n/g, ' / ')}`);
    this.pix.push([wrap, W, H, p, pad, L.u]); this.sizePix(wrap, W, H, p, pad, L.u);
    wrap.appendChild(cv); this.layer.appendChild(wrap);
    if (p.stamp) this.stampNode(p.stamp, n);
    return wrap;
  }
  stampNode(st, n) {
    const img = new Image(); img.src = `assets/stamps/${st.id}.png`; img.alt = `${st.jp} (${st.en})`; img.draggable = false;
    img.className = 'gag'; img.dataset.jp = st.jp; img.dataset.en = st.en; img.dataset.n = n; img.tabIndex = 0; img.setAttribute('role', 'button');
    this.pix.push([img, st.fw, st.fh, st, 0, st.u || U]); this.sizePix(img, st.fw, st.fh, st, 0, st.u || U);
    this.layer.appendChild(img); return img;
  }
  highlight(el) {
    const was = el.classList.contains('lit');
    this.layer.querySelectorAll('.poem.lit').forEach(x => x.classList.remove('lit'));
    if (!was) { el.classList.add('lit'); springAnimate(el, JELLY, SPRINGS.pop, { fill: 'none' }); this.onTapPoem?.(el); }
  }
  animateIn(nodes, poem) {
    nodes.forEach((n, i) => n.animate([{ clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0 0 0 0)' }],
      { duration: 900, delay: i * 120, easing: 'steps(12)', fill: 'backwards' }));
    poem.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: 1400, delay: 400, easing: 'steps(22)', fill: 'backwards' });
    const seal = document.createElement('i'); seal.className = 'seal-pop'; poem.appendChild(seal);
    springAnimate(poem, [{ transform: 'scale(1)' }, { transform: 'scale(1.08,.94)', offset: .5 }, { transform: 'scale(1)' }], SPRINGS.drop, { delay: 1800, fill: 'none' });
    clock.wait(3000).then(() => seal.remove());
  }
  scrollToPoem(el, behavior = 'smooth') { const r = el.getBoundingClientRect(); scrollTo({ top: scrollY + r.top - innerHeight * 0.3, behavior }); }
  scenes() { return this.art.regions.map(r => ({ level: r.level, y: r.y0 * PX, h: (r.y1 - r.y0) * PX })); }
}
