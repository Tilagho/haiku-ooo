// The black of the compose flow: one full-screen ink field on the same 4px grid as Inky.
//   flood(x)    a geyser from the button, then a sloshing surface (1-D wave equation) that climbs the whole
//               screen. When it clears the top the screen is solid ink and STAYS that way (the sheet background).
//   suck(x, y)  the whole black drains back into one point (the board's Inky): a wobbly receding iris plus
//               drips left behind on the edge that stretch and get slurped in after it.
import { clock } from './clock.js';
const P = 4, INK = [26, 24, 28], WASH = [62, 58, 70];

export class InkField {
  constructor({ z = 20 } = {}) {
    this.cv = document.createElement('canvas'); this.cv.className = 'ink-field'; this.cv.style.zIndex = z; this.cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.cv); this.ctx = this.cv.getContext('2d');
    this.state = 'off'; this.drops = [];
    this.resize(); addEventListener('resize', () => this.resize());
    clock.onTick(dt => this.step(dt));
  }
  resize() {
    this.cw = Math.ceil(innerWidth / P); this.ch = Math.ceil(innerHeight / P);
    this.cv.width = this.cw; this.cv.height = this.ch; this.cv.style.width = this.cw * P + 'px'; this.cv.style.height = this.ch * P + 'px';
    this.img = this.ctx.createImageData(this.cw, this.ch); this.dirty = true;
  }
  flood(xcss, { speed = 1 } = {}) {
    const n = this.cw + 1, h = new Float32Array(n).fill(this.ch + 4), v = new Float32Array(n), ix = Math.round(xcss / P);
    for (let i = 0; i < n; i++) v[i] = -330 * Math.exp(-(((i - ix) / 6) ** 2));
    this.F = { h, v, level: this.ch + 4, rate: 0, speed };
    for (let k = 0; k < 34; k++) { const a = -Math.PI / 2 + (Math.random() - .5) * 1.4, sp = 90 + Math.random() * 170; this.drops.push({ x: ix + (Math.random() - .5) * 6, y: this.ch - 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 1.2 + Math.random() * 2.4 }); }
    this.state = 'flood';
    return new Promise(res => this.onFull = res);
  }
  full() { this.state = 'full'; this.F = null; this.drops = []; this.dirty = true; }
  suck(xcss, ycss, { dur = 1.5, endR = 6 } = {}) {
    const tx = xcss / P, ty = ycss / P;
    const R0 = Math.max(Math.hypot(tx, ty), Math.hypot(this.cw - tx, ty), Math.hypot(tx, this.ch - ty), Math.hypot(this.cw - tx, this.ch - ty)) + 8;
    this.S = { tx, ty, R0, R: R0, endR, t: 0, dur, ph: [Math.random() * 6, Math.random() * 6, Math.random() * 6], drips: [] };
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
      this.drops = this.drops.filter(d => d.y < (F.h[Math.max(0, Math.min(n - 1, Math.round(d.x)))] ?? this.ch) + 2 && d.y > -30);
      let mx = -1e9; for (const v of F.h) mx = Math.max(mx, v);
      if (mx < -3) { this.full(); this.onFull?.(); }
    } else if (this.state === 'suck') {
      const S = this.S; S.t += dt; const u = Math.min(1, S.t / S.dur);
      const e = u * u * (3 - 2 * u) * .35 + Math.pow(u, 2.6) * .65;                  // slow start, hard slurp at the end
      S.R = S.endR + (S.R0 - S.endR) * (1 - e);
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
    this.render();
  }
  render() {
    const { cw, ch, img, ctx } = this;
    if (this.state === 'off') { if (this.dirty) { ctx.clearRect(0, 0, cw, ch); this.dirty = false; } return; }
    if (this.state === 'full') { if (this.dirty) { ctx.fillStyle = `rgb(${INK})`; ctx.fillRect(0, 0, cw, ch); this.dirty = false; } return; }
    const D = img.data; D.fill(0);
    const put = (i, c) => { D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; D[i + 3] = 255; };
    if (this.state === 'flood') {
      const F = this.F, balls = this.drops;
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const t = y + .5 - F.h[x]; let f = t >= 0 ? 2 : 1 / (1 + (t / 2.2) ** 2) * .9;
        if (f < 1) for (const b of balls) { const dx = x + .5 - b.x, dy = y + .5 - b.y, d2 = dx * dx + dy * dy, r2 = b.r * b.r; if (d2 < r2 * 7) f += r2 / (d2 + .01); }
        const i = (y * cw + x) * 4;
        if (f >= 1) put(i, INK); else if (f >= .82 && (x + y) % 2 === 0) put(i, WASH);
      }
    } else {
      const S = this.S, drips = S.drips;
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const dx = x + .5 - S.tx, dy = y + .5 - S.ty, d2 = dx * dx + dy * dy, r = this.rOf(Math.atan2(dy, dx));
        let f = (r * r) / (d2 + .01); f = f >= 1 ? f : f * f * f;       // sharpen the iris edge so it stays crisp
        for (const b of drips) {
          const vx = b.vx, vy = b.vy, sp = Math.hypot(vx, vy) || 1, ux = vx / sp, uy = vy / sp, el = Math.min(3, sp / 40);
          const ex = x + .5 - b.x, ey = y + .5 - b.y, al = ex * ux + ey * uy, pr = -ex * uy + ey * ux;   // stretch drips along their flight
          const q = (al / (1 + el)) ** 2 + pr * pr, r2 = b.r * b.r; if (q < r2 * 7) f += r2 / (q + .01);
        }
        const i = (y * cw + x) * 4;
        if (f >= 1) put(i, INK); else if (f >= .8 && (x + y) % 2 === 0) put(i, WASH);
      }
    }
    ctx.putImageData(img, 0, 0);
  }
}
