// The black of the compose flow: one full-screen ink field on the same 4px grid as Inky.
//   flood(x)    a geyser from the button, then a sloshing surface (1-D wave equation) that climbs the whole
//               screen. When it clears the top the screen is solid ink and STAYS that way (the sheet background).
//   suck(x, y)  the whole black drains back into one point (the board's Inky): a wobbly receding iris plus
//               drips left behind on the edge that stretch and get slurped in after it.
import { clock } from './clock.js';
const P = 4, INK = [26, 24, 28], WASH = [62, 58, 70];
// round 14.8: the canvas is OVERSIZE. It reaches MARGIN x the viewport past every edge (top, bottom, left, right), so the black
// still covers the strip under iOS Safari's dynamic toolbar, the safe-area insets and the keyboard gap, however innerHeight /
// visualViewport jump (+-100px, keyboard away). It never shrinks. The simulation (wave, iris, drips) still runs in VIEWPORT cells
// (so the look and timing are unchanged); only the render maps them onto the bigger canvas (mx, my cells of margin).
export const MARGIN = .6;

export class InkField {
  constructor({ z = 20 } = {}) {
    this.cv = document.createElement('canvas'); this.cv.className = 'ink-field'; this.cv.style.zIndex = z; this.cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.cv); this.ctx = this.cv.getContext('2d');
    this.state = 'off'; this.drops = [];
    this.resize(); addEventListener('resize', () => this.resize()); globalThis.visualViewport?.addEventListener('resize', () => this.resize());
    clock.onTick(dt => this.step(dt));
  }
  resize() {
    const vv = globalThis.visualViewport, coarse = globalThis.matchMedia?.('(pointer: coarse)').matches;
    // the largest the viewport can be (Safari's bars collapsed, keyboard down): the device's own height counts on a phone
    const W = Math.max(innerWidth, vv ? vv.width : 0, this.W || 0), H = Math.max(innerHeight, vv ? vv.height + vv.offsetTop : 0, coarse ? screen.height || 0 : 0, this.H || 0);
    this.W = W; this.H = H;
    this.vcw = Math.ceil(innerWidth / P); this.vch = Math.ceil(innerHeight / P);
    const mx = Math.max(this.mx || 0, Math.ceil(W * MARGIN / P)), my = Math.max(this.my || 0, Math.ceil(H * MARGIN / P));
    const cw = Math.max(this.vcw, Math.ceil(W / P)) + 2 * mx, ch = Math.max(this.vch, Math.ceil(H / P)) + 2 * my;
    if (this.img && mx === this.mx && my === this.my && cw === this.cw && ch === this.ch) return;      // grow only
    this.mx = mx; this.my = my; this.cw = cw; this.ch = ch;
    this.cv.width = cw; this.cv.height = ch; this.cv.style.width = cw * P + 'px'; this.cv.style.height = ch * P + 'px';
    this.cv.style.left = -mx * P + 'px'; this.cv.style.top = -my * P + 'px';
    this.img = this.ctx.createImageData(cw, ch); this.dirty = true;
  }
  flood(xcss, { speed = 1 } = {}) {
    this.resize(); const vch = this.vch;
    const n = this.vcw + 1, h = new Float32Array(n).fill(vch + 4), v = new Float32Array(n), ix = Math.round(xcss / P);
    for (let i = 0; i < n; i++) v[i] = -330 * Math.exp(-(((i - ix) / 6) ** 2));
    this.F = { h, v, level: vch + 4, rate: 0, speed };
    for (let k = 0; k < 34; k++) { const a = -Math.PI / 2 + (Math.random() - .5) * 1.4, sp = 90 + Math.random() * 170; this.drops.push({ x: ix + (Math.random() - .5) * 6, y: vch - 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 1.2 + Math.random() * 2.4 }); }
    this.state = 'flood';
    return new Promise(res => this.onFull = res);
  }
  full() { this.state = 'full'; this.F = null; this.drops = []; this.dirty = true; }
  suck(xcss, ycss, { dur = 1.5, endR = 6 } = {}) {
    this.resize(); const tx = xcss / P, ty = ycss / P, vw = this.vcw, vh = this.vch;
    const far = (x0, y0, x1, y1) => Math.max(Math.hypot(x0 - tx, y0 - ty), Math.hypot(x1 - tx, y0 - ty), Math.hypot(x0 - tx, y1 - ty), Math.hypot(x1 - tx, y1 - ty)) + 8;
    const R0 = far(0, 0, vw, vh);                                                  // reaches the viewport's far corner (the timing the iris always had)
    const R0c = far(-this.mx, -this.my, vw + this.mx, vh + this.my);                // ...and starts big enough to cover the whole oversize canvas
    this.S = { tx, ty, R0, R0c, R: R0c, endR, t: 0, dur, ph: [Math.random() * 6, Math.random() * 6, Math.random() * 6], drips: [] };
    this.state = 'suck';
    return new Promise(res => this.S.res = res);
  }
  off() { this.state = 'off'; this.F = this.S = null; this.drops = []; this.dirty = true; }
  rOf(th) { const S = this.S, a = (1 - S.t / S.dur); return S.R * (1 + a * (.09 * Math.sin(5 * th + S.ph[0] + S.t * 4) + .06 * Math.sin(3 * th - S.ph[1] - S.t * 6) + .04 * Math.sin(9 * th + S.ph[2]))); }
  step(dt) {
    if (this.state === 'flood') {
      const F = this.F, n = F.h.length;
      F.rate += 420 * dt * F.speed; F.level -= F.rate * dt;
      for (let sub = 0, h2 = dt / 3; sub < 3; sub++) {
        for (let i = 0; i < n; i++) { const l = F.h[i - 1] ?? F.h[i], rr = F.h[i + 1] ?? F.h[i]; F.v[i] += ((l + rr - 2 * F.h[i]) * 900 + (F.level - F.h[i]) * 60 - F.v[i] * 2.4) * h2; }
        for (let i = 0; i < n; i++) F.h[i] += F.v[i] * h2;
      }
      for (const d of this.drops) { d.vy += 260 * dt; d.x += d.vx * dt; d.y += d.vy * dt; }
      this.drops = this.drops.filter(d => d.y < (F.h[Math.max(0, Math.min(n - 1, Math.round(d.x)))] ?? this.vch) + 2 && d.y > -30);
      let mxh = -1e9; for (const v of F.h) mxh = Math.max(mxh, v);
      if (mxh < -3) { this.full(); this.onFull?.(); }
    } else if (this.state === 'suck') {
      const S = this.S; S.t += dt; const u = Math.min(1, S.t / S.dur);
      const e = u * u * (3 - 2 * u) * .35 + Math.pow(u, 2.6) * .65;                  // slow start, hard slurp at the end
      S.R = S.endR + (S.R0 - S.endR) * (1 - e) + (S.R0c - S.R0) * Math.pow(1 - Math.min(1, u / .25), 2);   // the extra reach melts away in the first quarter
      if (u < .8 && Math.random() < dt * 26) {                                       // a drip left on the receding edge
        const th = Math.random() * Math.PI * 2, r = this.rOf(th) * (1.02 + Math.random() * .06);
        S.drips.push({ x: S.tx + Math.cos(th) * r, y: S.ty + Math.sin(th) * r, vx: 0, vy: 0, r: 1.6 + Math.random() * 2.6 });
      }
      for (const d of S.drips) {
        const dx = S.tx - d.x, dy = S.ty - d.y, L = Math.hypot(dx, dy) || 1, k = 40 + 900 * u * u;
        d.vx += (dx / L * k - d.vx * 1.5) * dt; d.vy += (dy / L * k - d.vy * 1.5) * dt; d.x += d.vx * dt; d.y += d.vy * dt;
        if (L < Math.max(S.R * .9, 2)) d.dead = true;
      }
      S.drips = S.drips.filter(d => !d.dead);
      if (u >= 1 && !S.drips.length) { const r = S.res; this.off(); r(); }
      else if (u >= 1) S.t = S.dur;
    }
    this.render(); this.drawn = this.state;                                       // (the test reads this: the state the canvas actually shows)
  }
  render() {                                                                    // (this.refRender = true: the plain per-pixel maths everywhere, for the test that proves the fast paths identical)
    const { cw, ch, img, ctx, mx, my } = this;
    if (this.state === 'off') { if (this.dirty) { ctx.clearRect(0, 0, cw, ch); this.dirty = false; } return; }
    if (this.state === 'full') { if (this.dirty) { ctx.fillStyle = `rgb(${INK})`; ctx.fillRect(0, 0, cw, ch); this.dirty = false; } return; }
    const D = img.data; D.fill(0); const D32 = new Uint32Array(D.buffer);
    const INK32 = ((255 << 24) | (INK[2] << 16) | (INK[1] << 8) | INK[0]) >>> 0;       // (little endian RGBA)
    const put = (i, c) => { D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; D[i + 3] = 255; };
    // round 14.8: the canvas is 5x bigger than the viewport, so the sure-black and sure-clear stretches are filled in bulk and only the thin
    // edge band (surface / iris rim / drips) goes through the per-pixel maths below
    if (this.state === 'flood') {
      const F = this.F, balls = this.drops, n1 = F.h.length - 1; let hMax = -1e9, hMin = 1e9; for (const v of F.h) { if (v > hMax) hMax = v; if (v < hMin) hMin = v; }
      for (let y = 0; y < ch; y++) {
        const vy = y - my, yc = vy + .5;
        if (!this.refRender && yc >= hMax) { D32.fill(INK32, y * cw, y * cw + cw); continue; }                       // everything below the highest surface point is ink
        if (!this.refRender && yc < hMin - 14 && !balls.some(b => Math.abs(yc - b.y) < b.r * 2.7 + 1)) continue;       // clear air above the lowest surface point
        for (let x = 0; x < cw; x++) {
          const vx = x - mx;                                                                     // viewport cells (negative / past the end = the margin)
          const t = yc - F.h[vx < 0 ? 0 : vx > n1 ? n1 : vx]; let f = t >= 0 ? 2 : 1 / (1 + (t / 2.2) ** 2) * .9;
          if (f < 1) for (const b of balls) { const dx = vx + .5 - b.x, dy = yc - b.y, d2 = dx * dx + dy * dy, r2 = b.r * b.r; if (d2 < r2 * 7) f += r2 / (d2 + .01); }
          const i = (y * cw + x) * 4;
          if (f >= 1) put(i, INK); else if (f >= .82 && (x + y) % 2 === 0) put(i, WASH);
        }
      }
    } else {
      const S = this.S, drips = S.drips, need = this.need && this.need.length === cw ? this.need : (this.need = new Uint8Array(cw));
      const Rin = this.refRender ? -1 : S.R * .78, Rout = this.refRender ? 1e9 : S.R * 1.4;                                                  // the wobble is at most +-19% of R: inside Rin is always ink, outside Rout always clear
      const dd = drips.map(b => { const sp = Math.hypot(b.vx, b.vy) || 1, el = Math.min(3, sp / 40); return { b, ux: b.vx / sp, uy: b.vy / sp, el, r2: b.r * b.r, rb: b.r * 2.7 * (1 + el) + 2 }; });
      const mark = (a, b) => { a = Math.max(0, Math.floor(a) + mx - 1); b = Math.min(cw - 1, Math.ceil(b) + mx + 1); for (let x = a; x <= b; x++) need[x] = 1; };
      for (let y = 0; y < ch; y++) {
        const vy = y - my, yc = vy + .5, dy = yc - S.ty; need.fill(0); let any = false;
        if (Math.abs(dy) < Rout) {
          const hwo = Math.sqrt(Rout * Rout - dy * dy);
          if (Math.abs(dy) < Rin) {
            const hw = Math.sqrt(Rin * Rin - dy * dy), xs = Math.max(0, Math.ceil(S.tx - hw - .5) + mx), xe = Math.min(cw - 1, Math.floor(S.tx + hw - .5) + mx);
            if (xe >= xs) D32.fill(INK32, y * cw + xs, y * cw + xe + 1);
            mark(S.tx - hwo - .5, S.tx - hw - .5); mark(S.tx + hw - .5, S.tx + hwo - .5);
          } else mark(S.tx - hwo - .5, S.tx + hwo - .5);
          any = true;
        }
        for (const q of dd) if (Math.abs(yc - q.b.y) < q.rb) { mark(q.b.x - q.rb - .5, q.b.x + q.rb - .5); any = true; }
        if (!any) continue;
        for (let x = 0; x < cw; x++) {
          if (!need[x]) continue;
          const vx = x - mx, dx = vx + .5 - S.tx, d2 = dx * dx + dy * dy, r = this.rOf(Math.atan2(dy, dx));
          let f = (r * r) / (d2 + .01); f = f >= 1 ? f : f * f * f;       // sharpen the iris edge so it stays crisp
          for (const q of dd) {
            const b = q.b, ex = vx + .5 - b.x, ey = yc - b.y, al = ex * q.ux + ey * q.uy, pr = -ex * q.uy + ey * q.ux;   // stretch drips along their flight
            const qq = (al / (1 + q.el)) ** 2 + pr * pr; if (qq < q.r2 * 7) f += q.r2 / (qq + .01);
          }
          const i = (y * cw + x) * 4;
          if (f >= 1) put(i, INK); else if (f >= .8 && (x + y) % 2 === 0) put(i, WASH);
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }
}
