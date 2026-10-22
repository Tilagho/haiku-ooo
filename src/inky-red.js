// RED INKY: the compose-flow coach. Same soft body as the board's Inky (metaball core + springy rim balls +
// pointed top, on a chunky 4px ink grid), recoloured vermilion for the black compose sheet, plus the new
// moves the c2 flow needs:
//   washIn()  red ink streams in from the screen edges, swirls and gathers into one drop
//   whip()    a fast swoop along a curve, body stretched along its velocity with a gooey ribbon trail
//   runOff()  crouch, then whip off screen leaving red droplets that sink into the black
//   moods     happy / cheer / think / worry / bored (half-lid eyes, foot tapping) / shout / angry
import { clock } from './clock.js';

const P = 4;
const BODY = [214, 58, 40], EDGE = [150, 34, 24], HI = [246, 136, 110], PAPER = [255, 250, 240], INK = [26, 24, 28];
const CHEEK = [255, 182, 190], GOLD = [226, 167, 46], BLUE = [120, 170, 230], WHITE = [255, 250, 240];
const G = 260, NR = 10;
const ease = u => u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
function catmull(pts, u) {                     // centripetal-ish Catmull-Rom through pts at u in [0,1]
  const n = pts.length - 1, f = Math.min(n - 1e-6, Math.max(0, u * n)), i = Math.floor(f), t = f - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
  const c = (a, b, c2, d) => .5 * ((2 * b) + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t * t + (-a + 3 * b - 3 * c2 + d) * t * t * t);
  return [c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])];
}

export class RedInky {
  // c2's "red ink birth" (rivers from the edges gathering into Inky, washIn below) is cut from c3 but kept here:
  // pages check RedInky.BIRTH (c3: ?birth) before using it.
  static BIRTH = false;
  constructor({ R = 9, z = 60, bigEyes = false, fury = false, chunky = false, worried = false } = {}) {
    this.bigEyes = bigEyes; this.fury = fury; this.chunky = chunky; this.worried = worried;   // round 14.1: a chunkier body; worried brows by default   // c4: larger open eyes; a fuller angry face (brows, 💢 vein, steam, gritted teeth)
    this.cv = document.createElement('canvas'); this.cv.className = 'inky-canvas red'; this.cv.style.zIndex = z; this.cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.cv); this.ctx = this.cv.getContext('2d');
    this.R = R; this.x = 40; this.fy = 100; this.vx = 0; this.vy = 0; this.floor = null; this.grounded = false;
    this.s = 0; this.sv = 0;
    this.rim = Array.from({ length: NR }, (_, i) => ({ a: (i / NR) * Math.PI * 2, ox: 0, oy: 0, vx: 0, vy: 0 }));
    this.drops = []; this.puddles = []; this.sparks = []; this.trail = [];
    this.mood = 'happy'; this.look = 0; this.lookY = 0; this.blink = 0; this.nextBlink = 2; this.t = 0; this.spin = 0; this.shiver = 0;
    this.visible = false; this.mode = 'idle'; this.dock = null; this.hanko = false; this.wash = null; this.whipS = null; this.tapping = false;
    this.resize(); addEventListener('resize', () => this.resize()); globalThis.visualViewport?.addEventListener('resize', () => this.resize());
    clock.onTick(dt => this.step(dt));
  }
  resize() {
    // round 14.1: the canvas covers the largest the viewport can be (keyboard down, Safari's bars collapsed), so a
    // keyboard opening or closing never leaves him drawn past a stale, shorter canvas (clipped under the roller)
    const vv = globalThis.visualViewport, H = Math.max(innerHeight, vv ? vv.height + vv.offsetTop : 0, document.documentElement.clientHeight || 0, globalThis.screen?.height || 0);
    const cw = Math.ceil(innerWidth / P), ch = Math.ceil(H / P); if (cw === this.cw && ch === this.ch && this.img) return;
    this.cw = cw; this.ch = ch;
    this.cv.width = this.cw; this.cv.height = this.ch; this.cv.style.width = this.cw * P + 'px'; this.cv.style.height = this.ch * P + 'px';
    this.img = this.ctx.createImageData(this.cw, this.ch);
  }
  // where his mouth is (css px), plus his body circle, for aiming bubble tails; tracks squash (sx, sy) and look
  get mouth() { const R = this.R, cy = this.fy - R * .92 * this.sy, lx = Math.round(this.look * R / 7);
    return { x: (this.x + lx * .5 + .5) * P, y: (cy + R * .32 * this.sy + .5) * P, cx: this.x * P, cy: cy * P, r: R * P * 1.2 * Math.max(1, this.sx) }; }
  // what he actually drew last frame (css px): body extent near his own column, and how far a ray from a point
  // travels before leaving his pixels. Lets a bubble keep a real gap in any pose (squash, splash, spin).
  _op(x, y) { x = Math.floor(x); y = Math.floor(y); return x >= 0 && y >= 0 && x < this.cw && y < this.ch && this.img.data[(y * this.cw + x) * 4 + 3] > 0; }
  bodySpan() { const R = this.R, x0 = Math.floor(this.x - 2.2 * R), x1 = Math.ceil(this.x + 2.2 * R); let l = Infinity, r = -Infinity, t = Infinity;
    for (let y = Math.floor(this.fy - 2.8 * R); y <= Math.ceil(this.fy + 1); y++) for (let x = x0; x <= x1; x++) if (this._op(x, y)) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; }
    return l > r ? null : { l: l * P, r: (r + 1) * P, t: t * P }; }
  rayExit(x, y, dx, dy, max = 120) { let last = 0; for (let d = 0; d <= max && d - last <= 8; d += 2) if (this._op((x + dx * d) / P, (y + dy * d) / P)) last = d; return last; }   // stops at the first real gap (ignores loose drops)
  get pos() { return { x: this.x * P, y: (this.fy - this.R * 1.1) * P, top: (this.fy - this.R * 2.6) * P, foot: this.fy * P }; }
  setMood(m) {
    if (this.mood === m) return; this.mood = m;
    if (m !== 'bored') this.tapping = false;
    if (m === 'cheer') this.jump(1.1); if (m === 'worry') this.shiver = .6; if (m === 'happy') this.wobble(.25);
  }
  placeAt(xcss, footCss) { this.x = xcss / P; this.fy = footCss / P; this.vx = this.vy = 0; }
  wobble(k = .4) { this.sv += 9 * k; this.rim.forEach(r => { r.vx += Math.cos(r.a * 2 + this.t) * 18 * k; r.vy += Math.sin(r.a * 3) * 18 * k; }); }
  jump(k = 1, vx = 0) { if (!this.grounded || this.floor == null) return; this.g = 0; this.vy = -95 * k; this.vx = vx; this.grounded = false; this.s = -.25; this.sv = -4; }
  // ballistic hop that always lands on the way DOWN at (x, foot) css after ~T s: the apex sits `height` ink px above
  // the higher end, and gravity is scaled for this hop so the flight takes T (snappy, never a moonshot)
  hopTo(xcss, footCss, T = .5, height = 22) {
    const x1 = xcss / P, y1 = footCss / P, apex = Math.min(this.fy, y1) - height;
    const up = Math.sqrt(2 * (this.fy - apex)), down = Math.sqrt(2 * (y1 - apex));
    this.g = Math.max(G * .6, ((up + down) / T) ** 2);
    const Tf = (up + down) / Math.sqrt(this.g);
    this.vy = -up * Math.sqrt(this.g); this.vx = (x1 - this.x) / Tf;
    this.grounded = false; this.floor = y1; this.s = -.2;
    return clock.wait(Tf * 1000 + 5);
  }
  splat(n = 10, power = 1, color = BODY, x = this.x, y = this.fy - this.R, floor = this.floor ?? this.ch - 2) {
    for (let k = 0; k < n; k++) {
      const a = -Math.PI * (0.05 + Math.random() * 0.9), sp = (40 + Math.random() * 70) * power;
      this.drops.push({ x, y, vx: Math.cos(a) * sp * (Math.random() < .5 ? -1 : 1), vy: Math.sin(a) * sp, r: 1 + Math.random() * 1.6, life: 2.5, color, floor });
    }
  }
  sparkle(n = 12, x = this.x, y = this.fy - this.R * 1.5) {
    for (let k = 0; k < n; k++) { const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 60; this.sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, life: .9 + Math.random() * .5, color: [GOLD, WHITE, CHEEK, BLUE][k % 4] }); }
  }
  // ---------- red ink washes in from the edges and gathers into a drop at (x,y) css ----------
  washIn(xcss, ycss, { R = this.R, dur = 1.0 } = {}) {
    const gx = xcss / P, gy = ycss / P;
    // four rivers: from the left, right, lower-left and upper-right edges, each with its own swirl
    const src = [[-4, gy + 30, 1], [this.cw + 4, gy - 40, 1], [gx - 30, this.ch + 4, 1], [this.cw * .8, -4, 1]];
    this.wash = { x: gx, y: gy, r: 1.5, R, t: 0, dur, balls: [], src, done: false };
    return new Promise(res => this.wash.res = res);
  }
  // ---------- whip: swoop through css points in T seconds, then land (feet at the last point) ----------
  whip(points, T = .7, { land = true, splash = 8 } = {}) {
    const pts = points.map(([x, y]) => [x / P, y / P]);
    this.mode = 'whip'; this.grounded = false; this.floor = null; this.vx = this.vy = 0;
    this.whipS = { pts, T, t: 0, land, splash };
    return new Promise(res => this.whipS.res = res);
  }
  async runOff(dir = 1) {
    this.setMood('cheer'); this.look = dir; this.s = .5; this.sv = 0; this.wobble(.6);
    await clock.wait(260);
    const p = this.pos, ex = dir > 0 ? innerWidth + 140 : -140;
    this.splat(10, 1.3, BODY, this.x, this.fy - this.R, this.ch + 20);
    await this.whip([[p.x, p.foot], [p.x - dir * 60, p.foot - 90], [p.x - dir * 170, p.foot - 260], [p.x - dir * 60, p.foot - 400], [p.x + dir * 20, p.foot - 300], [ex, p.foot - 360]], .95, { land: false });
    this.visible = false; this.trail = [];
  }
  // cancelled: slumps, two heavy little hops, then drips off the side in a droopy streak
  async sadRunOff(dir = -1, { pace = 1 } = {}) {         // pace < 1 = quicker (c4 uses .7); c2/c3 call it with the default
    this.setMood('sad'); this.slump = .18; this.wobble(.3);
    await clock.wait(380 * pace);
    for (const k of [1, .8]) { const p = this.pos; await this.hopTo(p.x + dir * 34 * k, p.foot, .42 * Math.sqrt(pace), 6); this.splat(2, .4); await clock.wait(160 * pace); }
    const p = this.pos, ex = dir > 0 ? innerWidth + 120 : -120;
    this.splat(6, .6, BODY, this.x, this.fy - this.R, this.ch + 20);
    await this.whip([[p.x, p.foot], [p.x + dir * 20, p.foot + 10], [p.x + dir * 70, p.foot - 30], [ex, p.foot + 30]], .8 * pace, { land: false });
    this.visible = false; this.trail = []; this.slump = 0;
  }
  // ---------- simulation ----------
  step(dt) {
    this.t += dt; const R = this.R;
    if (this.mode === 'coach' && this.dock) {
      const d = this.dock(); if (d) { this.floor = d.foot / P; if (this.grounded) { this.x += (d.x / P - this.x) * Math.min(1, dt * 8); this.fy = this.floor; } }
      if (this.grounded && this.mood === 'cheer' && Math.random() < dt * 1.5) this.jump(.8);
    }
    // impatient foot tap: tiny periodic bob
    if (this.tapping && this.grounded) { const ph = (this.t * 4.2) % 1; if (ph < dt * 4.2) { this.s = .12; this.sv = 0; } }
    let speed = 0, ux = 0, uy = 0;
    const W = this.whipS;
    if (W) {                                        // scripted swoop (positions are the centre of the feet)
      W.t += dt; const u = Math.min(1, W.t / W.T), e = ease(u);
      const [nx, ny] = catmull(W.pts, e), ddx = nx - this.x, ddy = ny - this.fy;
      speed = Math.hypot(ddx, ddy) / Math.max(dt, 1e-3); if (speed > 1) { ux = ddx / Math.hypot(ddx, ddy); uy = ddy / Math.hypot(ddx, ddy); }
      this.vx = ddx / Math.max(dt, 1e-3); this.vy = ddy / Math.max(dt, 1e-3);
      this.x = nx; this.fy = ny;
      { const lp = this.trail.at(-1), px = this.x, py = this.fy - R * .9;            // fill gaps so the ribbon is continuous
        const n = lp ? Math.min(40, Math.floor(Math.hypot(px - lp.x, py - lp.y) / 2.2)) : 0;
        for (let k = 1; k <= n; k++) this.trail.push({ x: lp.x + (px - lp.x) * k / (n + 1), y: lp.y + (py - lp.y) * k / (n + 1), life: 1 });
        this.trail.push({ x: px, y: py, life: 1 }); }
      if (Math.random() < dt * 14) this.drops.push({ x: this.x, y: this.fy - R, vx: -this.vx * .1 + (Math.random() - .5) * 30, vy: -this.vy * .1, r: .8 + Math.random(), life: 1.6, color: BODY, floor: this.ch + 20 });
      if (u >= 1) {
        this.whipS = null; this.vx = this.vy = 0;
        if (W.land) { this.grounded = true; this.floor = this.fy; this.s = .55; this.sv = 0; this.wobble(1.3); if (W.splash) this.splat(W.splash, 1.1); }
        W.res();
      }
    }
    this.lastSpeed = speed; this.dir = [ux, uy];
    const ax0 = this.vx, ay0 = this.vy;
    if (!W && !this.grounded && this.floor != null) {
      this.vy += (this.g || G) * dt; this.x += this.vx * dt; this.fy += this.vy * dt;
      if (this.fy >= this.floor && this.vy > 0) {
        const impact = this.vy * Math.sqrt(G / (this.g || G)); this.g = 0; this.fy = this.floor; this.vy = 0; this.vx = 0; this.grounded = true;
        this.s = Math.min(.55, impact / 260); this.sv = 0; if (impact > 70) this.splat(Math.round(impact / 25), impact / 160);
        this.onLand?.(impact);
      }
      this.x = Math.max(6, Math.min(this.cw - 6, this.x));
    }
    const axc = W ? 0 : (this.vx - ax0) / Math.max(dt, 1e-3), ayc = W ? 0 : (this.vy - ay0) / Math.max(dt, 1e-3);
    this.sv += (-320 * (this.s - (this.slump || 0)) - 11 * this.sv) * dt; this.s += this.sv * dt;
    const breathe = this.grounded ? Math.sin(this.t * 3.1) * .04 : 0;
    const stretch = this.grounded || W ? 0 : Math.max(-.25, Math.min(.3, -this.vy / 300));
    const sx = 1 + this.s + breathe - stretch * .6, sy = 1 - this.s - breathe + stretch;
    const el = Math.min(.75, speed / 260);           // elongation along the swoop direction
    if (this.shiver > 0) this.shiver -= dt;
    if (this.spin > 0) this.spin = Math.max(0, this.spin - dt);
    for (const r of this.rim) {
      let tx = Math.cos(r.a) * R * .55 * sx, ty = Math.sin(r.a) * R * .55 * sy;
      if (el > 0) { const al = tx * ux + ty * uy, pr = -tx * uy + ty * ux, a2 = al * (1 + el), p2 = pr * (1 - el * .45); tx = a2 * ux - p2 * uy; ty = a2 * uy + p2 * ux; }
      r.vx += ((tx - r.ox) * 220 - r.vx * 9 - axc * .02) * dt; r.vy += ((ty - r.oy) * 220 - r.vy * 9 - ayc * .02) * dt;
      r.ox += r.vx * dt; r.oy += r.vy * dt;
    }
    this.sx = sx; this.sy = sy;
    this.nextBlink -= dt; if (this.nextBlink < 0) { this.blink = .14; this.nextBlink = 1.8 + Math.random() * 3.5; }
    if (this.blink > 0) this.blink -= dt;
    // ribbon trail: points shrink and get pulled back into the body (gooey retraction)
    const cxp = this.x, cyp = this.fy - R * .9;
    for (const p of this.trail) { p.life -= dt / .32; if (!W) { p.x += (cxp - p.x) * Math.min(1, dt * 7); p.y += (cyp - p.y) * Math.min(1, dt * 7); } }
    this.trail = this.trail.filter(p => p.life > 0);
    for (const d of this.drops) {
      d.vy += G * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.life -= dt;
      if (d.y > d.floor && d.vy > 0) { d.life = 0; if (d.floor < this.ch) this.puddles.push({ x: d.x, y: d.floor, w: Math.round(d.r * .8), life: 1.1, color: d.color }); }
    }
    this.drops = this.drops.filter(d => d.life > 0 && d.y < this.ch + 30);
    this.puddles.forEach(p => p.life -= dt); this.puddles = this.puddles.filter(p => p.life > 0);
    this.sparks.forEach(s => { s.vy += G * .4 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; }); this.sparks = this.sparks.filter(s => s.life > 0);
    // wash-in rivers
    const Wa = this.wash;
    if (Wa) {
      Wa.t += dt;
      if (Wa.t < Wa.dur) for (const [sx0, sy0] of Wa.src) for (let k = 0; k < 2; k++) {
        const dx = Wa.x - sx0, dy = Wa.y - sy0, L = Math.hypot(dx, dy) || 1, jit = (Math.random() - .5) * 6;
        Wa.balls.push({ x: sx0 - dy / L * jit, y: sy0 + dx / L * jit, vx: dx / L * 120 - dy / L * 70, vy: dy / L * 120 + dx / L * 70, r: 1.6 + Math.random() * 1.8 });
      }
      for (const b of Wa.balls) {                     // spring pull toward the drop (stiffening) + a little swirl + drag
        const dx = Wa.x - b.x, dy = Wa.y - b.y, L = Math.hypot(dx, dy) || 1, k = 22 + 70 * Math.min(1, Wa.t / Wa.dur);
        b.vx += (dx * k - dy / L * 30 - b.vx * 5.5) * dt; b.vy += (dy * k + dx / L * 30 - b.vy * 5.5) * dt;
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (L < Wa.r * .8 + 1) { b.dead = true; Wa.r = Math.min(Wa.R * 1.05, Wa.r + b.r * .09); }
      }
      Wa.balls = Wa.balls.filter(b => !b.dead);
      if (!Wa.done && Wa.t > Wa.dur && Wa.balls.length < 6) { Wa.done = true; Wa.res(); }
    }
    this.render();
  }
  // ---------- rendering ----------
  render() {
    const { cw, ch, img } = this, D = img.data; D.fill(0);
    const put = (x, y, c, a = 255) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= cw || y >= ch) return; const i = (y * cw + x) * 4; D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; D[i + 3] = a; };
    const balls = [];
    const R = this.R, cx = this.x + (this.shiver > 0 ? Math.sin(this.t * 70) * .8 : 0), cy = this.fy - R * .92 * this.sy;
    const showBody = this.visible;
    if (showBody) {
      const ch = this.chunky ? 1.12 : 1;                                    // chunky: fatter core + rim balls (a rounder, sturdier blob)
      balls.push([cx, cy, R * .62 * ch]);
      const sp = this.spin > 0 ? this.spin * 14 : 0, c = Math.cos(sp), s = Math.sin(sp);
      for (const r of this.rim) balls.push([cx + r.ox * c - r.oy * s, cy + r.ox * s + r.oy * c, R * .42 * ch]);
      const lean = Math.max(-1.5, Math.min(1.5, -this.vx / 40)) * (this.whipS ? 2 : 1);
      balls.push([cx + lean * .5, cy - R * .7 * this.sy, R * .4], [cx + lean, cy - R * 1.12 * this.sy, R * .24], [cx + lean * 1.4, cy - R * 1.42 * this.sy, R * .12]);
      for (const p of this.trail) balls.push([p.x, p.y, R * .5 * Math.pow(p.life, .8)]);
    }
    for (const d of this.drops) balls.push([d.x, d.y, d.r]);
    if (this.wash) { if (!this.wash.done || !showBody) balls.push([this.wash.x, this.wash.y, this.wash.r]); for (const b of this.wash.balls) balls.push([b.x, b.y, b.r]); }
    let x0 = cw, y0 = ch, x1 = 0, y1 = 0;
    for (const [x, y, r] of balls) { x0 = Math.min(x0, x - r * 2.6); y0 = Math.min(y0, y - r * 2.6); x1 = Math.max(x1, x + r * 2.6); y1 = Math.max(y1, y + r * 2.6); }
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(cw - 1, Math.ceil(x1)); y1 = Math.min(ch - 1, Math.ceil(y1));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      let f = 0;
      for (const b of balls) { const dx = x + .5 - b[0], dy = y + .5 - b[1], d2 = dx * dx + dy * dy, r2 = b[2] * b[2]; if (d2 < r2 * 7) f += r2 / (d2 + .01); }
      if (f >= 1) put(x, y, BODY);
      else if (f >= .82 && (x + y) % 2 === 0) put(x, y, EDGE);            // dithered wet edge
    }
    for (const p of this.puddles) for (let k = -p.w; k <= p.w; k++) if (p.life > .5 || (k + Math.round(p.x)) % 2 === 0) put(p.x + k, p.y, p.color);
    if (showBody) this.face(cx, cy, put);
    if (showBody && this.tapping && this.grounded) this.foot(cx, put);
    if (showBody && this.hanko) this.drawHanko(cx, cy - R * 1.3 * this.sy, put);
    for (const s of this.sparks) { put(s.x, s.y, s.color); if (s.life > .5) { put(s.x + 1, s.y, s.color); put(s.x - 1, s.y, s.color); put(s.x, s.y + 1, s.color); put(s.x, s.y - 1, s.color); } }
    this.ctx.putImageData(img, 0, 0);
  }
  foot(cx, put) {                                    // a little stub foot tapping beside him + dust ticks
    const ph = (this.t * 4.2) % 1, up = ph > .5 ? 1 : 0, fx = Math.round(cx + this.R * 1.05), fy = Math.round(this.fy) - 1 - up;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) put(fx + i, fy + j, BODY);
    if (!up && ph < .18) { put(fx + 4, fy, WHITE); put(fx + 5, fy - 1, WHITE); put(fx - 1, fy - 1, WHITE); }
  }
  face(cx, cy, put) {
    const R = this.R, m = this.mood, sx = this.sx, sy = this.sy, k = R / 7;
    const lx = Math.round(this.look * k), ey = Math.round(cy - R * .12 * sy + (this.lookY || 0));
    const ex = [Math.round(cx - 2.6 * k * sx + lx * .6), Math.round(cx + 1.6 * k * sx + lx * .6)];
    if (!this.bigEyes && this.worried && ex[1] - ex[0] < 4) { ex[0] = Math.round(cx - 2.5 + lx * .6) - 1; ex[1] = ex[0] + 4; }   // small R: two 2 px eyes, 2 px apart
    if (this.bigEyes && ex[1] - ex[0] < 5) { const c0 = Math.round((ex[0] + ex[1]) / 2); ex[0] = c0 - 3; ex[1] = c0 + 2; }   // round 14.1: small R, still two separate 3 px eyes (2 px apart)
    const W = PAPER;
    put(cx - R * .5, cy - R * .45, HI); put(cx - R * .5, cy - R * .3, HI); put(cx - R * .38, cy - R * .55, HI);
    for (const e of ex) {
      const big = this.bigEyes, left = e === ex[0];
      if (this.fury && m === 'angry') {                                                                      // furious: brows slam down toward the middle
        const o = big ? 3 : 2, inner = left ? e + o - 1 : e, outer = left ? e : e + o - 1, d = left ? 1 : -1;
        for (let i = 0; i < o + 1; i++) put(outer - d + i * d, ey - 2 + (i >= Math.ceil((o + 1) / 2) ? 1 : 0), INK);   // slanted brow
        for (let j = 0; j < o; j++) for (let i = 0; i < o; i++) if (i <= j + (o > 2 ? 1 : 0)) put(outer + i * d, ey + j, W);   // eye cut on the diagonal
        put(inner, ey + o - 1, INK);                                                                          // pupil glaring inward
        continue;
      }
      if (this.blink > 0 && m !== 'bored') { put(e, ey + 1, W); put(e + 1, ey + 1, W); if (big) put(e + 2, ey + 1, W); continue; }
      if (m === 'cheer') { put(e, ey + 1, W); put(e + 1, ey, W); put(e + 2, ey + 1, W); continue; }           // ^ ^
      if (m === 'shout' || m === 'angry') { put(e, ey - 1, W); put(e + 1, ey, W); put(e, ey + 1, W); put(e + 1, ey + 1, W); continue; }
      if (m === 'sad') {                                                                                     // droopy: brows up in the middle, eyes low
        put(e, ey + 1, W); put(e + 1, ey + 1, W); put(e, ey + 2, W); put(e + 1, ey + 2, W); put(e + (e === ex[0] ? 1 : 0), ey + 2, INK);
        if (e === ex[0]) { put(e - 1, ey - 1, W); put(e, ey - 2, W); } else { put(e + 2, ey - 1, W); put(e + 1, ey - 2, W); }
        if (e === ex[0]) { const ty = ey + 3 + Math.floor((this.t * 2.2 % 1) * 5); put(e, ty, BLUE); if ((this.t * 2.2 % 1) < .6) put(e, ty + 1, BLUE); }
        continue;
      }
      if (m === 'bored') {                                                                                   // half-lid, pupils sliding sideways
        put(e - 1, ey, EDGE); put(e, ey, EDGE); put(e + 1, ey, EDGE); put(e + 2, ey, EDGE);
        put(e, ey + 1, W); put(e + 1, ey + 1, W); put(e, ey + 2, W); put(e + 1, ey + 2, W);
        put(e + (Math.sin(this.t * 1.3) > 0 ? 1 : 0), ey + 2, INK); continue;
      }
      if (big) {                                                                                             // c4: 3x5 eyes, 2px-tall pupil
        const bh = (k >= 1.2 ? 4 : 3) + 1, py = this.lookY < 0 ? 0 : bh - 2;
        for (let j = -1; j < bh - 1; j++) for (let i = 0; i < 3; i++) put(e + i, ey + j, W);
        const px = e + (this.look > 0 ? 2 : this.look < 0 ? 0 : 1);
        put(px, ey + py - 1, INK); put(px, ey + py, INK);
        if (m === 'worry') put(e + (left ? 2 : 0), ey - 3, W);
        else if (this.worried && m !== 'cheer') { if (left) { put(e, ey - 3, W); put(e + 1, ey - 3, W); put(e + 2, ey - 4, W); } else { put(e, ey - 4, W); put(e + 1, ey - 3, W); put(e + 2, ey - 3, W); } }   // worried brows: up in the middle
        continue;
      }
      const eh = k >= 1.2 ? 4 : 3;
      for (let j = 0; j < eh; j++) { put(e, ey + j, W); put(e + 1, ey + j, W); }
      put(e + (this.look > 0 ? 1 : 0), ey + (this.lookY < 0 ? 0 : eh - 1), INK);
      if (m === 'worry') put(e + (e === ex[0] ? 1 : 0), ey - 2, W);
      else if (this.worried && m !== 'cheer') { if (left) { put(e - 1, ey - 1, W); put(e, ey - 2, W); put(e + 1, ey - 3, W); } else { put(e, ey - 3, W); put(e + 1, ey - 2, W); put(e + 2, ey - 1, W); } }   // worried brows: up in the middle
    }
    const my = Math.round(cy + R * .32 * sy), mx = Math.round(cx - .5 + lx * .5);
    if (m === 'happy' && this.worried) { put(mx - 1, my + 1, W); put(mx, my, W); put(mx + 1, my, W); put(mx + 2, my + 1, W); }   // a nervous little frown
    else if (m === 'think' && this.worried) { put(mx, my + 1, W); put(mx + 1, my + 1, W); put(mx + 2, my, W); }
    else if (m === 'happy' || m === 'cheer') { put(mx - 1, my, W); put(mx, my + 1, W); put(mx + 1, my + 1, W); put(mx + 2, my, W); put(ex[0] - 2, my - 1, CHEEK); put(ex[1] + 3, my - 1, CHEEK); if (m === 'cheer') { put(mx, my + 2, INK); put(mx + 1, my + 2, INK); } }
    else if (m === 'shout') { for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) put(mx + i - 1, my + j - 1, j === 0 ? W : INK); }
    else if (m === 'worry') { put(mx - 1, my + 1, W); put(mx, my, W); put(mx + 1, my + 1, W); put(mx + 2, my, W); const sx2 = cx + R * .9, sy2 = cy - R * .5; put(sx2, sy2, BLUE); put(sx2, sy2 + 1, BLUE); put(sx2 + 1, sy2 + 1, BLUE); }
    else if (m === 'sad') { put(mx - 1, my + 2, W); put(mx, my + 1, W); put(mx + 1, my + 1, W); put(mx + 2, my + 2, W); }
    else if (m === 'angry' && this.fury) {                                                                 // gritted teeth, dark flush, 💢 vein, steam
      for (let i = -2; i <= 3; i++) { put(mx + i, my, W); put(mx + i, my + 2, W); put(mx + i, my + 1, (i & 1) ? INK : W); }
      put(mx - 3, my + 1, INK); put(mx + 4, my + 1, INK);
      for (const fx of [ex[0] - 2, ex[0] - 1, ex[1] + 3, ex[1] + 4]) put(fx, my - 1, EDGE);
      const vx = Math.round(cx + R * .55), vy = Math.round(cy - R * .95 * sy), pop = (this.t * 3) % 1 < .5 ? 0 : 1;
      for (const [a, b] of [[1, 0], [3, 0], [0, 1], [1, 1], [3, 1], [4, 1], [0, 3], [1, 3], [3, 3], [4, 3], [1, 4], [3, 4]]) put(vx + a - pop, vy + b - pop, PAPER);
      for (let n = 0; n < 2; n++) {                                                                           // two steam puffs rising off his head
        const ph = (this.t * 1.6 + n * .5) % 1, sxp = Math.round(cx + (n ? -R * .55 : -R * .1) + Math.sin(ph * 6) * 1.2), syp = Math.round(cy - R * 1.25 * sy - ph * 9);
        const c = ph < .55 ? PAPER : [176, 170, 164];
        if (ph < .85) { put(sxp, syp, c); put(sxp + 1, syp, c); put(sxp, syp - 1, c); if (ph < .5) { put(sxp - 1, syp, c); put(sxp + 1, syp - 1, c); } }
      }
    }
    else if (m === 'angry') { put(mx - 1, my + 1, W); put(mx, my, W); put(mx + 1, my, W); put(mx + 2, my + 1, W); }
    else if (m === 'bored') { put(mx - 1, my + 1, W); put(mx, my + 1, W); put(mx + 1, my + 1, W); put(mx + 2, my + 1, W); }
    else if (m === 'think') { put(mx, my, W); put(mx + 1, my, W); put(mx + 2, my - 1, W); }
    else { put(mx, my, W); put(mx + 1, my, W); }
  }
  drawHanko(cx, top, put) {                        // a little wooden-handled seal held overhead: straight, no tilt
    const x0 = Math.round(cx - 3), y0 = Math.round(top - 8);
    for (let j = 0; j < 4; j++) for (let i = 1; i < 5; i++) put(x0 + i, y0 + j, j === 0 ? [140, 98, 66] : [104, 70, 46]);
    for (let j = 4; j < 8; j++) for (let i = -1; i < 7; i++) put(x0 + i, y0 + j, (i === -1 || i === 6 || j === 7) ? INK : PAPER);
    put(x0 + 2, y0 + 5, BODY); put(x0 + 3, y0 + 5, BODY); put(x0 + 2, y0 + 6, BODY); put(x0 + 3, y0 + 6, BODY);
    put(cx - this.R * .9, top + 4, EDGE); put(cx + this.R * .9, top + 4, EDGE);
  }
}
