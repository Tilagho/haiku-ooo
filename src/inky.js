// INKY — the little ink-drop mascot. A pixel soft body rendered as a metaball field on a chunky grid:
// a core ball plus a ring of rim balls on springs (they lag behind accelerations, so he squishes, wobbles and
// stretches), a pointed top, and free droplets that merge back gooily. The same field renders the compose
// "ink flood" (a sloshing 1-D water surface + flung droplets) that gathers into Inky.
import { clock } from './clock.js';

const P = 4;                                         // css px per ink pixel
const INK = [26, 24, 28], WASH = [74, 70, 82], PAPER = [255, 250, 240], RED = [217, 67, 47], PINK = [232, 137, 166], GOLD = [226, 167, 46], BLUE = [120, 170, 230];
const G = 260;                                       // gravity, ink px / s^2
const NR = 10;                                       // rim balls

export class Inky {
  constructor({ R = 7 } = {}) {
    this.cv = document.createElement('canvas'); this.cv.className = 'inky-canvas'; this.cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.cv); this.ctx = this.cv.getContext('2d');
    this.R = R; this.baseR = R;
    this.x = 40; this.fy = 100; this.vx = 0; this.vy = 0; this.floor = null; this.grounded = false;
    this.s = 0; this.sv = 0;                         // squash spring (+ = squashed flat)
    this.rim = Array.from({ length: NR }, (_, i) => ({ a: (i / NR) * Math.PI * 2, ox: 0, oy: 0, vx: 0, vy: 0 }));
    this.drops = []; this.puddles = []; this.sparks = [];
    this.mood = 'happy'; this.look = 0; this.blink = 0; this.nextBlink = 2; this.t = 0; this.spin = 0; this.shiver = 0;
    this.visible = true; this.mode = 'roam'; this.dock = null; this.hanko = false; this.flood = null; this.gather = null;
    this.roamT = 1.5; this.targetX = null; this.bodyAlpha = 1;
    this.resize(); addEventListener('resize', () => this.resize());
    let lastY = scrollY; addEventListener('scroll', () => { const d = scrollY - lastY; lastY = scrollY; this.onScroll(d); }, { passive: true });
    addEventListener('pointerdown', e => this.onPointer(e), true);
    clock.onTick(dt => this.step(dt));
  }
  resize() {
    this.cw = Math.ceil(innerWidth / P); this.ch = Math.ceil(innerHeight / P);
    this.cv.width = this.cw; this.cv.height = this.ch; this.cv.style.width = this.cw * P + 'px'; this.cv.style.height = this.ch * P + 'px'; this.img = this.ctx.createImageData(this.cw, this.ch);
    if (this.mode === 'roam') this.floor = this.pageFloor();
  }
  pageFloor() { return (innerHeight - 78) / P; }
  // ---------- public API (css px) ----------
  get pos() { return { x: this.x * P, y: (this.fy - this.R * 1.1) * P, top: (this.fy - this.R * 2.6) * P, foot: this.fy * P }; }
  setMood(m) { if (this.mood !== m) { this.mood = m; if (m === 'cheer') this.jump(1.1); if (m === 'worry') this.shiver = .6; if (m === 'happy') this.wobble(.25); } }
  placeAt(xcss, footCss) { this.x = xcss / P; this.fy = footCss / P; this.vx = this.vy = 0; }
  wobble(k = .4) { this.sv += 9 * k; this.rim.forEach((r, i) => { r.vx += Math.cos(r.a * 2 + this.t) * 18 * k; r.vy += Math.sin(r.a * 3) * 18 * k; }); }
  jump(k = 1, vx = 0) { if (!this.grounded && this.floor != null) return; this.vy = -95 * k; this.vx = vx; this.grounded = false; this.s = -.25; this.sv = -4; }
  hopTo(xcss, footCss, T = .5, height = 22) {   // ballistic hop that lands at a css point after ~T s
    const x1 = xcss / P, y1 = footCss / P; this.vx = (x1 - this.x) / T;
    this.vy = ((y1 - this.fy) - .5 * G * T * T) / T; if (this.fy + this.vy * T * .5 + .125 * G * T * T > Math.min(this.fy, y1) - height) this.vy = Math.min(this.vy, -Math.sqrt(2 * G * height));
    this.grounded = false; this.floor = y1; this.landX = x1; this.s = -.2;
    return clock.wait(T * 1000);
  }
  splat(n = 10, power = 1, color = INK, x = this.x, y = this.fy - this.R) {
    for (let k = 0; k < n; k++) {
      const a = -Math.PI * (0.05 + Math.random() * 0.9), sp = (40 + Math.random() * 70) * power;
      this.drops.push({ x, y, vx: Math.cos(a) * sp * (Math.random() < .5 ? -1 : 1), vy: Math.sin(a) * sp, r: 1 + Math.random() * 1.6, life: 2.5, color, floor: this.floor ?? this.ch - 2 });
    }
  }
  sparkle(n = 12, x = this.x, y = this.fy - this.R * 1.5) {
    for (let k = 0; k < n; k++) { const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 60; this.sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, life: .9 + Math.random() * .5, color: [GOLD, RED, PINK, BLUE][k % 4] }); }
  }
  onScroll(d) {
    if (this.mode !== 'roam' || !this.visible) return;
    const k = Math.max(-1, Math.min(1, d / 60));
    this.rim.forEach(r => r.vy += -k * 40 * (Math.sin(r.a) < 0 ? 1.4 : .6));
    if (this.grounded && Math.abs(d) > 40) { this.jump(Math.min(1, Math.abs(d) / 160)); this.setMood('happy'); }
    this.look = Math.max(-1, Math.min(1, -k));
  }
  onPointer(e) {
    if (!this.visible) return;
    const dx = e.clientX / P - this.x, dy = e.clientY / P - (this.fy - this.R);
    if (dx * dx + dy * dy < (this.R * 1.8) ** 2) {
      this.s = .45; this.sv = 0; this.wobble(.8); this.splat(6, .7);
      if (this.mode === 'roam') { setTimeout(() => this.jump(1.2, (Math.random() - .5) * 60), 90); this.giggle = 1.2; }
      this.onTap?.();
    }
  }
  // ---------- ink flood (compose open): rises, sloshes, then gathers into a ball at (gx,gy) css ----------
  startFlood(xcss, levelCss) {
    const n = this.cw + 1, h = new Float32Array(n).fill(this.ch + 4), v = new Float32Array(n);
    const ix = Math.round(xcss / P);
    for (let i = 0; i < n; i++) v[i] = -260 * Math.exp(-(((i - ix) / 7) ** 2));   // geyser at the button
    this.flood = { h, v, level: this.ch + 4, target: levelCss / P, rate: 0, t: 0, drain: false };
    this.splat(26, 2.1, INK, ix, this.ch - 4); this.drops.forEach(d => d.floor = this.ch + 20);
  }
  gatherTo(xcss, ycss, R) {
    this.gather = { x: xcss / P, y: ycss / P, r: 3, R, balls: [], t: 0 };
    if (this.flood) this.flood.drain = true;
  }
  // ---------- simulation ----------
  step(dt) {
    this.t += dt; const R = this.R;
    // horizontal roaming on the page
    if (this.mode === 'roam' && this.grounded) {
      this.roamT -= dt;
      if (this.roamT <= 0) {
        this.roamT = 1.6 + Math.random() * 2.6; const r = Math.random();
        if (r < .45) { const tx = Math.max(10, Math.min(this.cw - 10, this.x + (Math.random() - .5) * 50)); this.jump(.55 + Math.random() * .3, (tx - this.x) * 1.4); }
        else if (r < .6) this.splat(3, .5);                       // a little drip
        else if (r < .75) { this.look = Math.random() < .5 ? -1 : 1; }
        else if (r < .85) this.wobble(.5);
        else this.jump(.9);
      }
    }
    if (this.mode === 'coach' && this.dock) {                    // follow the dock (the sheet can move)
      const d = this.dock(); if (d) { this.floor = d.foot / P; if (this.grounded) { this.x += (d.x / P - this.x) * Math.min(1, dt * 8); this.fy = this.floor; } }
      if (this.grounded && this.mood === 'cheer' && Math.random() < dt * 1.5) this.jump(.8);
    }
    // body ballistics
    const ax0 = this.vx, ay0 = this.vy;
    if (!this.grounded && this.floor != null) {
      this.vy += G * dt; this.x += this.vx * dt; this.fy += this.vy * dt;
      if (this.fy >= this.floor && this.vy > 0) {
        const impact = this.vy; this.fy = this.floor; this.vy = 0; this.vx = 0; this.grounded = true;
        this.s = Math.min(.55, impact / 260); this.sv = 0; if (impact > 70) this.splat(Math.round(impact / 25), impact / 160);
        this.onLand?.(impact);
      }
      this.x = Math.max(6, Math.min(this.cw - 6, this.x));
    }
    const axc = (this.vx - ax0) / Math.max(dt, 1e-3), ayc = (this.vy - ay0) / Math.max(dt, 1e-3);
    // squash spring + breathing
    this.sv += (-320 * this.s - 11 * this.sv) * dt; this.s += this.sv * dt;
    const breathe = this.grounded ? Math.sin(this.t * 3.1) * .04 : 0;
    const stretch = this.grounded ? 0 : Math.max(-.25, Math.min(.3, -this.vy / 300));
    const sx = 1 + this.s + breathe - stretch * .6, sy = 1 - this.s - breathe + stretch;
    if (this.shiver > 0) this.shiver -= dt;
    if (this.mood === 'cheer' || this.spin > 0) this.spin = Math.max(0, this.spin - dt);
    // rim balls: springs toward the (squashed) rest shape, lagging behind body acceleration
    for (const r of this.rim) {
      const tx = Math.cos(r.a) * R * .55 * sx, ty = Math.sin(r.a) * R * .55 * sy;
      r.vx += ((tx - r.ox) * 220 - r.vx * 9 - axc * .02) * dt; r.vy += ((ty - r.oy) * 220 - r.vy * 9 - ayc * .02) * dt;
      r.ox += r.vx * dt; r.oy += r.vy * dt;
    }
    this.sx = sx; this.sy = sy;
    // blink / look
    this.nextBlink -= dt; if (this.nextBlink < 0) { this.blink = .14; this.nextBlink = 1.8 + Math.random() * 3.5; }
    if (this.blink > 0) this.blink -= dt;
    if (this.giggle > 0) this.giggle -= dt;
    // drops: ballistic, merge back into the body, or splat on the floor into fading puddles
    for (const d of this.drops) {
      d.vy += G * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.life -= dt;
      if (d.y > d.floor && d.vy > 0) { d.life = 0; if (d.floor < this.ch) this.puddles.push({ x: d.x, y: d.floor, w: Math.round(d.r * .8), life: 1.1, color: d.color }); }
    }
    this.drops = this.drops.filter(d => d.life > 0 && d.y < this.ch + 30);
    this.puddles.forEach(p => p.life -= dt); this.puddles = this.puddles.filter(p => p.life > 0);
    this.sparks.forEach(s => { s.vy += G * .4 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; }); this.sparks = this.sparks.filter(s => s.life > 0);
    // flood surface: 1-D wave equation + rising/draining base level
    const F = this.flood;
    if (F) {
      F.t += dt; const n = F.h.length;
      if (!F.drain) F.level += (F.target - F.level) * Math.min(1, dt * 9);
      else F.level += 150 * dt;
      for (let sub = 0, h2 = dt / 3; sub < 3; sub++) {
        for (let i = 0; i < n; i++) { const l = F.h[i - 1] ?? F.h[i], rr = F.h[i + 1] ?? F.h[i]; F.v[i] += ((l + rr - 2 * F.h[i]) * 900 + (F.level - F.h[i]) * 70 - F.v[i] * 2.6) * h2; }
        for (let i = 0; i < n; i++) F.h[i] += F.v[i] * h2;
      }
      if (F.drain && this.gather) {                             // surface sheds balls that fly to the gather point
        for (let k = 0; k < 3; k++) { const i = Math.floor(Math.random() * n); if (F.h[i] < this.ch) this.gather.balls.push({ x: i, y: F.h[i] + 2, vx: (Math.random() - .5) * 30, vy: -60 - Math.random() * 60, r: 2 + Math.random() * 2.5 }); }
      }
      if (F.drain && F.level > this.ch + 40) this.flood = null;
    }
    const Gt = this.gather;
    if (Gt) {
      Gt.t += dt;
      for (const b of Gt.balls) { b.vx += ((Gt.x - b.x) * 60 - b.vx * 7) * dt; b.vy += ((Gt.y - b.y) * 60 - b.vy * 7) * dt; b.x += b.vx * dt; b.y += b.vy * dt; const d = Math.hypot(Gt.x - b.x, Gt.y - b.y); if (d < Gt.r * .6) { b.dead = true; Gt.r = Math.min(Gt.R * 1.05, Gt.r + .3); } }
      Gt.balls = Gt.balls.filter(b => !b.dead);
    }
    this.render();
  }
  // ---------- rendering on the pixel grid ----------
  render() {
    const { cw, ch, img } = this, D = img.data; D.fill(0);
    const put = (x, y, c, a = 255) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= cw || y >= ch) return; const i = (y * cw + x) * 4; D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; D[i + 3] = a; };
    // metaball sources
    const balls = [];
    const R = this.R, cx = this.x + (this.shiver > 0 ? Math.sin(this.t * 70) * .8 : 0), cy = this.fy - R * .92 * this.sy;
    const showBody = this.visible && this.bodyAlpha > 0;
    if (showBody) {
      balls.push([cx, cy, R * .62]);
      const sp = this.spin > 0 ? this.spin * 14 : 0;
      for (const r of this.rim) { const c = Math.cos(sp), s = Math.sin(sp); balls.push([cx + r.ox * c - r.oy * s, cy + r.ox * s + r.oy * c, R * .42]); }
      // pointed top of the drop, leaning against horizontal motion
      const lean = Math.max(-1.5, Math.min(1.5, -this.vx / 40));
      balls.push([cx + lean * .5, cy - R * .7 * this.sy, R * .4], [cx + lean, cy - R * 1.12 * this.sy, R * .24], [cx + lean * 1.4, cy - R * 1.42 * this.sy, R * .12]);
    }
    for (const d of this.drops) balls.push([d.x, d.y, d.r, d.color]);
    if (this.gather) { balls.push([this.gather.x, this.gather.y, this.gather.r]); for (const b of this.gather.balls) balls.push([b.x, b.y, b.r]); }
    const F = this.flood;
    // evaluate field in the union of ball boxes (and the flood region)
    let x0 = cw, y0 = ch, x1 = 0, y1 = 0;
    for (const [x, y, r] of balls) { x0 = Math.min(x0, x - r * 2.6); y0 = Math.min(y0, y - r * 2.6); x1 = Math.max(x1, x + r * 2.6); y1 = Math.max(y1, y + r * 2.6); }
    if (F) { let mn = ch; for (const v of F.h) mn = Math.min(mn, v); x0 = 0; x1 = cw; y0 = Math.min(y0, mn - 6); y1 = ch; }
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(cw - 1, Math.ceil(x1)); y1 = Math.min(ch - 1, Math.ceil(y1));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      let f = 0, red = 0;
      for (const b of balls) { const dx = x + .5 - b[0], dy = y + .5 - b[1], d2 = dx * dx + dy * dy, r2 = b[2] * b[2]; if (d2 < r2 * 7) { const v = r2 / (d2 + .01); f += v; if (b[3] === RED) red += v; } }
      if (F) { const t = y + .5 - F.h[x]; f += t >= 0 ? 2 : 1 / (1 + (t / 2.2) ** 2) * .9; }
      if (f >= 1) put(x, y, red > f * .5 ? RED : INK);
      else if (F && f >= .85 && (x + y) % 2 === 0) put(x, y, WASH);    // dithered wet edge on the flood
    }
    for (const p of this.puddles) for (let k = -p.w; k <= p.w; k++) if (p.life > .5 || (k + Math.round(p.x)) % 2 === 0) put(p.x + k, p.y, p.color);
    if (showBody) this.face(cx, cy, put);
    if (showBody && this.hanko) this.drawHanko(cx, cy - R * 1.3 * this.sy, put);
    for (const s of this.sparks) { put(s.x, s.y, s.color); if (s.life > .5) { put(s.x + 1, s.y, s.color); put(s.x - 1, s.y, s.color); put(s.x, s.y + 1, s.color); put(s.x, s.y - 1, s.color); } }
    this.ctx.putImageData(img, 0, 0);
  }
  face(cx, cy, put) {
    const R = this.R, m = this.mood, sx = this.sx, sy = this.sy, k = R / 7;
    const lx = Math.round(this.look * k), ey = Math.round(cy - R * .12 * sy);
    const ex = [Math.round(cx - 2.6 * k * sx), Math.round(cx + 1.6 * k * sx)];
    const W = PAPER;
    // highlight
    put(cx - R * .5, cy - R * .45, WASH); put(cx - R * .5, cy - R * .3, WASH);
    for (const e of ex) {
      if (this.blink > 0 || m === 'sleep') { put(e, ey + 1, W); put(e + 1, ey + 1, W); continue; }
      if (m === 'cheer' || (this.giggle > 0)) { put(e, ey + 1, W); put(e + 1, ey, W); put(e + 2, ey + 1, W); continue; }   // ^ ^
      if (m === 'shout' || m === 'angry') { put(e, ey - 1, W); put(e + 1, ey, W); put(e, ey + 1, W); put(e + 1, ey + 1, W); continue; }
      const eh = k >= 1.2 ? 4 : 3;
      for (let j = 0; j < eh; j++) { put(e, ey + j, W); put(e + 1, ey + j, W); }
      put(e + (lx > 0 ? 1 : 0), ey + eh - 1, INK);
      if (m === 'worry' || m === 'sad') { put(e - (e === ex[0] ? 0 : -1), ey - 2, W); }   // raised brows
    }
    const my = Math.round(cy + R * .32 * sy), mx = Math.round(cx - .5 + lx * .5);
    if (m === 'happy' || m === 'cheer' || this.giggle > 0) { put(mx - 1, my, W); put(mx, my + 1, W); put(mx + 1, my + 1, W); put(mx + 2, my, W); put(ex[0] - 2, my - 1, PINK); put(ex[1] + 3, my - 1, PINK); }
    else if (m === 'shout') { for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) put(mx + i - 1, my + j - 1, j === 0 ? W : RED); }
    else if (m === 'worry') { put(mx - 1, my + 1, W); put(mx, my, W); put(mx + 1, my + 1, W); put(mx + 2, my, W); put(cx + R * .9, cy - R * .5, BLUE); put(cx + R * .9, cy - R * .5 + 1, BLUE); put(cx + R * .9 + 1, cy - R * .5 + 1, BLUE); }
    else if (m === 'sad' || m === 'angry') { put(mx - 1, my + 1, W); put(mx, my, W); put(mx + 1, my, W); put(mx + 2, my + 1, W); }
    else if (m === 'think') { put(mx, my, W); put(mx + 1, my, W); put(mx + 2, my - 1, W); }
    else { put(mx, my, W); put(mx + 1, my, W); }
  }
  drawHanko(cx, top, put) {
    const x0 = Math.round(cx - 3), y0 = Math.round(top - 8);
    for (let j = 0; j < 4; j++) for (let i = 1; i < 5; i++) put(x0 + i, y0 + j, [92, 60, 40]);        // wooden handle
    for (let j = 4; j < 8; j++) for (let i = -1; i < 7; i++) put(x0 + i, y0 + j, j === 7 ? [150, 30, 24] : RED);
    put(cx - this.R * .9, top + 4, INK); put(cx + this.R * .9, top + 4, INK);                        // little arms gripping it
  }
}
