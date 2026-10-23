// The c3 scroll: chunky, worn pixel-art parchment drawn on a canvas at 6 css px per pixel (twice the board's 3).
// Thick rolled rods with wooden end caps top and bottom, aged parchment with dithered tonal blotches and coffee-ring
// stains, torn jagged left/right edges with a few nicks, and a small red ribbon tied on the bottom rod.
// The open height is a live spring: the bottom rod rolls (its wrap marks turn), and the rows just above it flutter
// sideways with the roll speed, so the torn edges wobble as the paper is revealed.
import { clock } from './clock.js';

export const SP = 6;                     // css px per scroll pixel
export const RH = 8;                     // rod height in scroll px
const C = {
  hi: [252, 246, 230], p1: [244, 234, 210], p2: [233, 218, 186], p3: [216, 195, 152], p4: [190, 163, 118], edge: [152, 122, 82], dark: [98, 72, 46], ink: [26, 24, 28],
  woodL: [184, 128, 80], wood: [128, 82, 50], woodD: [72, 44, 26], red: [214, 58, 40], redD: [146, 32, 22], redL: [240, 116, 94],
};
const OL = [8, 7, 10];
const T = { hi: [240, 214, 178], mid: [214, 176, 136], lo: [176, 134, 98] };   // the write button's TAN_HI / TAN / TAN_LO (scroll-button.js)
const ROLL_X0 = 1;                       // the roll runs from art px 1 to W-2: a one-cell (6 css px) margin from the screen edge
const LEVELS = [C.hi, C.p1, C.p2, C.p3, C.p4, C.edge];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + .5) / 16);
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export class ScrollArt {
  constructor(canvas, { maxRows = 92, seed = 575, outline = 0, ribbon = true } = {}) {   // ribbon: false = paper only, no red bow (the credits scroll, round 14.6)   // outline: extra px of black rim round paper + rods (c4: 2)
    this.ribbon = ribbon; this.outline = outline; this.cv = canvas; this.ctx = canvas.getContext('2d'); this.maxRows = maxRows; this.seed = seed;
    this.open = 0; this.vel = 0; this.target = 0; this.k = 140; this.c = 15; this.mode = 'spring'; this.phase = 0; this.t = 0; this.flut = 0;
    this.resize(); clock.onTick(dt => this.step(dt));
  }
  resize() {
    this.W = Math.max(40, Math.min(76, Math.floor(Math.min(innerWidth, 456) / SP)));
    this.H = RH * 2 + this.maxRows + 14;
    this.cv.width = this.W; this.cv.height = this.H;
    this.cv.style.width = this.W * SP + 'px'; this.cv.style.height = this.H * SP + 'px';
    this.img = this.ctx.createImageData(this.W, this.H); this.gen(); this.draw();
  }
  get cssWidth() { return this.W * SP; }
  get openCss() { return this.open * SP; }
  // ---------- parchment generation (deterministic) ----------
  gen() {
    const W = this.W, H = this.maxRows, R = rng(this.seed), x0 = 3, x1 = W - 4;   // paper spans x0..x1 inclusive (round 14.6: one cell wider each side, the knobs are gone)
    this.px0 = x0; this.px1 = x1;
    const edge = () => {                                   // torn edge: chunky random walk + a few V nicks
      const e = new Int8Array(H); let v = 1, run = 0;
      for (let y = 0; y < H; y++) { if (run-- <= 0) { v = Math.max(0, Math.min(3, v + (R() < .5 ? -1 : 1) * (R() < .7 ? 1 : 2))); run = 1 + Math.floor(R() * 5); } e[y] = v; }
      for (let k = 0; k < 3; k++) { const y = 6 + Math.floor(R() * (H - 12)), d = 4 + Math.floor(R() * 2); [d - 2, d, d - 1, d - 3].forEach((dd, i) => { if (y + i < H) e[y + i] = Math.max(e[y + i], dd); }); }
      return e;
    };
    this.L = edge(); this.Rt = edge();
    // value noise
    const G = 7, gw = Math.ceil(W / G) + 2, gh = Math.ceil(H / G) + 2, grid = Array.from({ length: gw * gh }, () => R());
    const sm = t => t * t * (3 - 2 * t);
    const noise = (x, y) => { const gx = x / G, gy = y / G, ix = Math.floor(gx), iy = Math.floor(gy), fx = sm(gx - ix), fy = sm(gy - iy), g = (i, j) => grid[(j % gh) * gw + (i % gw)];
      return (g(ix, iy) * (1 - fx) + g(ix + 1, iy) * fx) * (1 - fy) + (g(ix, iy + 1) * (1 - fx) + g(ix + 1, iy + 1) * fx) * fy; };
    const blots = Array.from({ length: 7 }, () => ({ x: x0 + R() * (x1 - x0), y: R() * H, r: 3 + R() * 7, a: .1 + R() * .16 }));
    const rings = Array.from({ length: 2 }, () => ({ x: x0 + 6 + R() * (x1 - x0 - 12), y: 10 + R() * (H - 20), r: 3.5 + R() * 2.5 }));
    const tone = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = x0; x <= x1; x++) {
      const dl = x - (x0 + this.L[y]), dr = (x1 - this.Rt[y]) - x, d = Math.min(dl, dr);
      let t = .13 + .24 * noise(x, y) + .08 * noise(x * 2.3 + 40, y * 2.3);
      for (const b of blots) { const q = ((x - b.x) ** 2 + (y - b.y) ** 2) / (b.r * b.r); if (q < 2.5) t += b.a * Math.exp(-q * 1.6); }
      for (const g of rings) { const q = Math.abs(Math.hypot(x - g.x, y - g.y) - g.r); if (q < 1) t += .16 * (1 - q); }
      t += .42 * Math.exp(-Math.max(0, d) / 1.7) + .3 * Math.exp(-y / 1.4);
      tone[y * W + x] = t;
    }
    this.tone = tone;
  }
  // ---------- motion ----------
  setTarget(rows, { k = 140, c = 15, mode = 'spring' } = {}) {
    this.target = Math.max(0, Math.min(this.maxRows, rows)); this.k = k; this.c = c; this.mode = mode;
    return new Promise(res => { this.settle = res; });
  }
  jump(rows) { this.open = this.target = rows; this.vel = 0; this.draw(); }
  step(dt) {
    this.t += dt;
    const before = this.open;
    if (this.mode === 'spring') { this.vel += (-(this.open - this.target) * this.k - this.vel * this.c) * dt; this.open += this.vel * dt; }
    else { this.vel = Math.min(0, this.vel) - 260 * dt; this.open = Math.max(this.target, this.open + this.vel * dt); if (this.open === this.target) this.vel = 0; }  // roll-up: accelerates shut
    this.open = Math.max(0, Math.min(this.maxRows + 3, this.open));
    const sp = (this.open - before) / Math.max(dt, 1e-3);
    this.phase += (this.open - before);
    this.flut = Math.max(this.flut * Math.exp(-dt * 5), Math.min(1.6, Math.abs(sp) / 45));
    if (this.settle && Math.abs(this.open - this.target) < .25 && Math.abs(this.vel) < 1.5) { this.open = this.target; this.vel = 0; const s = this.settle; this.settle = null; s(); }
    if (Math.abs(sp) > .01 || this.flut > .02 || this.dirty !== false) { this.draw(); this.dirty = this.flut > .02; }
    else if (this.ribbon && Math.floor(this.t * 3) !== this.lastT) { this.lastT = Math.floor(this.t * 3); this.draw(); }   // slow ribbon sway
  }
  // ---------- drawing ----------
  draw() {
    const { W, H, img } = this, D = img.data; D.fill(0);
    const put = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; D[i + 3] = 255; };
    const o = Math.round(this.open), top = 2, py0 = top + RH, by = top + RH + o;
    // paper rows
    for (let y = 0; y < o; y++) {
      const fromBot = o - y, f = fromBot <= 8 ? this.flut * (1 - (fromBot - 1) / 8) : 0;
      const sh = Math.round(f * Math.sin(this.t * 19 + y * .8));
      const jl = fromBot <= 4 && this.flut > .3 ? Math.round(Math.sin(this.t * 31 + y * 2.1) * this.flut * .7) : 0;
      const l = this.px0 + this.L[y] + Math.max(0, jl), r = this.px1 - this.Rt[y] - Math.max(0, -jl);
      for (let x = l; x <= r; x++) {
        let t = this.tone[y * W + x] ?? .3;
        if (fromBot <= 2) t += .28 / fromBot;                               // curl shadow just above the bottom rod
        let c;
        if (x === l || x === r) c = this.outline ? C.ink : (this.L[y] >= 4 && x === l) || (this.Rt[y] >= 4 && x === r) ? C.dark : C.edge;
        else if (this.outline && (y === 0 || fromBot === 1)) c = C.ink;                // doubled ink line where the paper meets each rod
        else if (this.outline && (x === l + 1 || x === r - 1)) c = (this.L[y] >= 4 && x === l + 1) || (this.Rt[y] >= 4 && x === r - 1) ? C.dark : C.edge;   // torn edge line, darker in nicks
        else { const v = Math.max(0, Math.min(5, t * 5)), b = Math.floor(v); c = LEVELS[Math.min(5, b + ((v - b) > BAYER[(y & 3) * 4 + (x & 3)] ? 1 : 0))]; }
        put(x + sh, py0 + y, c);
      }
      // loose fibres past the tear
      if ((y * 7 + this.seed) % 11 === 0) put(l - 1 + sh, py0 + y, C.p3);
      if ((y * 5 + this.seed) % 13 === 0) put(r + 1 + sh, py0 + y, C.p3);
    }
    this.drawRod(top, 0);
    this.drawRod(by, this.phase, true);
    if (this.outline) {                                   // black rim: grow the silhouette (paper, torn edges, rods, knobs) outward
      for (let k = 0; k < this.outline - 1; k++) {
        const A = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) A[i] = D[i * 4 + 3];
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (A[y * W + x]) continue;
          if ((x > 0 && A[y * W + x - 1]) || (x < W - 1 && A[y * W + x + 1]) || (y > 0 && A[(y - 1) * W + x]) || (y < H - 1 && A[(y + 1) * W + x])) put(x, y, OL); }
      }
    }
    if (this.ribbon) this.drawRibbon(by);                                  // the blowing red bow goes on last, over the rim
    this.ctx.putImageData(img, 0, 0);
    this._put = put;
  }
  // round 14.6: just paper unfurled. The roll is a thick roll of PARCHMENT in the write button's tan (src/scroll-button.js: dark outline,
  // TAN_HI highlight, TAN belly, TAN_LO shade, a spiral at each end), rounded at the ends and as wide as the sheet: NO dowel stubs, NO
  // dark wooden end knobs (they used to stick out 6 px beyond each end).
  drawRod(y0, phase, bottom = false) {
    const { W } = this, D = this.img.data;
    const put = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= this.H) return; const i = (y * W + x) * 4; D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; D[i + 3] = 255; };
    const rows = [C.ink, T.hi, T.hi, T.mid, T.mid, T.lo, T.lo, C.ink], cx0 = ROLL_X0, cx1 = W - 1 - ROLL_X0;
    for (let j = 0; j < RH; j++) for (let x = cx0; x <= cx1; x++) {
      if ((x === cx0 || x === cx1) && (j === 0 || j === RH - 1)) continue;                  // rounded caps
      let c = rows[j];
      if (x === cx0 || x === cx1) c = C.ink;                                                 // the end outline
      else if (j > 0 && j < RH - 1 && ((x - j * 2 + Math.round(phase)) % 10 + 10) % 10 === 0) c = j < 4 ? T.mid : T.lo;   // wrap marks turn as it rolls
      else if (j === 3 && ((x + y0) & 3) === 0) c = T.hi;
      else if (j === 5 && ((x + y0) & 3) === 2) c = T.mid;
      put(x, y0 + j, c);
    }
    for (const [ex, dir] of [[cx0, 1], [cx1, -1]]) {                                         // the spiral end: a shaded column, a lighter one, one ink dot
      for (let j = 1; j < RH - 1; j++) { put(ex + dir, y0 + j, T.lo); put(ex + 2 * dir, y0 + j, j === 1 || j === RH - 2 ? T.lo : T.mid); }
      put(ex + dir, y0 + (RH >> 1), C.ink); put(ex + 2 * dir, y0 + (RH >> 1) - 1, T.lo);
    }
  }
  drawRibbon(y0) {                                              // red ribbon tied round the bottom rod: band, bow, swaying tails
    const { W } = this, D = this.img.data;
    const put = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= this.H) return; const i = (y * W + x) * 4; D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; D[i + 3] = 255; };
    {
      const bx = W - 12;
      for (let j = 0; j < RH; j++) for (let i = 0; i < 3; i++) put(bx - 1 + i, y0 + j, j === 0 || j === RH - 1 ? C.redD : i === 0 && j < 4 ? C.redL : i === 2 ? C.redD : C.red);
      const BOW = ['DD.....DD', 'RRD...DRR', 'RrRDKDRrR', '.RRKKKRR.', '...RKR...', '..RR.RR..', '..RR..RR.', '.RR...RR.', '.RR....RR', '.R......R'];
      const sw = Math.sin(this.t * 3.1) * .5 + this.flut * Math.sin(this.t * 17) * 1.4;
      const pc = { R: C.red, r: C.redL, D: C.redD, K: C.redD };
      BOW.forEach((row, j) => [...row].forEach((ch, i) => {
        if (ch === '.') return;
        const off = j >= 5 ? Math.round((sw + Math.sin(this.t * 2.3 + (i < 4 ? 0 : 1.7)) * .4) * (j - 4) / 3) : 0;
        put(bx - 4 + i + off, y0 + RH - 2 + j, pc[ch]);
      }));
    }
  }
}

// small red wax seal (the post button), drawn once per state into a canvas: irregular blob, darker embossed ring
export function drawWax(cv, { ready = true, n = 11, seed = 9 } = {}) {
  cv.width = n; cv.height = n; const ctx = cv.getContext('2d'), img = ctx.createImageData(n, n), D = img.data, R = rng(seed), c0 = (n - 1) / 2;
  const bumps = Array.from({ length: 8 }, () => R() * .7);
  const pal = ready ? { b: C.red, d: C.redD, l: C.redL, o: [96, 20, 14] } : { b: [222, 196, 180], d: [196, 160, 140], l: [240, 226, 214], o: [176, 140, 118] };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = x - c0, dy = y - c0, a = Math.atan2(dy, dx), r = Math.hypot(dx, dy), lim = c0 + .2 - bumps[Math.floor(((a + Math.PI) / (2 * Math.PI)) * 8) % 8];
    if (r > lim) continue;
    let c = r > lim - 1 ? pal.o : Math.abs(r - (c0 - 1.9)) < .55 ? pal.d : pal.b;
    if (dx + dy < -c0 * .9 && r > lim - 2 && r <= lim - 1) c = pal.l;
    const i = (y * n + x) * 4; D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; D[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
