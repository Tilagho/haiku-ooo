// INKY — the board's little black sumi-ink drop. A pixel soft body rendered as a metaball field on a chunky grid
// (1 ink px = 4 CSS px): a core ball plus a ring of rim balls on springs that lag behind every acceleration, so he
// squishes, wobbles, leans and stretches like a blob of wet ink, sheds droplets that merge back gooily, and leaves
// a faint dithered ink trail where he slides. Grayscale sumi ink; red only for the rare anger mark.
//
// On the board (mode 'roam') he floats just above the write-button scroll (never over its tap area):
//   ENTRANCE   starts off-screen left, slips in fast, skids, overshoots and wobbles to a stop
//   ROAMING    every so often slides over to the other end of the button (bottom-left <-> bottom-right) and back
//   READING    now and then looks UP, his eyes tracking the poem in view as you scroll
//   TAPS       squish -> annoyed -> MAD (puffs up, shakes, steams, red anger mark) -> after a random 6-12 taps he
//              SPLATS flat with X eyes, then pops back up (TapMeter, src/inky-mind.js)
//   DRAG       press + move past 8 px picks him up (a drag never counts as a tap): he slinks after the finger on a
//              spring, lagging and stretching; released, he falls with his throw velocity and plops onto his float line
//              with a squash and a little bounce, then goes back to roaming. Only his own hit box takes the gesture
//              (touch-action: none + preventDefault there), so the page still scrolls everywhere else.
//   DIZZY      drag him round in circles (about 1.5 turns around the path's moving centre, or a fast spin) and his eyes
//              turn into spinning pixel spirals, still wobbling 2-4 s after you let go
//   He floats well above the write button: at least 24 px of clear paper under his squashed bottom.
// Under prefers-reduced-motion he is calm: no entrance slide, no roaming, gentler squish. He pauses when the tab is
// hidden. The same field renders the compose "ink flood" helpers (startFlood / gatherTo) for older callers.
import { clock } from './clock.js';
import { TapMeter } from './inky-mind.js';

const P = 4;                                         // css px per ink pixel
const INK = [26, 24, 28], WASH = [74, 70, 82], TRAIL = [120, 116, 124], PAPER = [255, 250, 240], RED = [214, 52, 40], SOFT = [150, 146, 156], GOLD = [226, 167, 46], BLUE = [120, 170, 230];
const G = 260;                                       // gravity, ink px / s^2
// a 2-D squash: compress offset (x, y) by a along unit normal n, bulge it by .6a across n (a < 0: stretch along n)
export const aniso = (x, y, nx, ny, a) => { const dn = x * nx + y * ny, tx = x - nx * dn, ty = y - ny * dn; return [nx * dn * (1 - a) + tx * (1 + a * .6), ny * dn * (1 - a) + ty * (1 + a * .6)]; };
export const FLOAT_GAP = 34;                         // css px between his foot and the write button's top (>= 24 under any squash)
export const DRAG_START = 8;                         // css px of movement before a press becomes a drag
const NR = 10;                                       // rim balls
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + .5) / 16);
const reducedMQ = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const rnd = (a, b) => a + Math.random() * (b - a);

export class Inky {
  constructor({ R = 7, reduced = reducedMQ(), rand = Math.random } = {}) {
    this.cv = document.createElement('canvas'); this.cv.className = 'inky-canvas'; this.cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.cv); this.ctx = this.cv.getContext('2d');
    this.R = R; this.baseR = R; this.reduced = reduced;
    this.x = -20; this.fy = 100; this.vx = 0; this.vy = 0; this.floor = null; this.grounded = false;
    this.s = 0; this.sv = 0; this.sRest = 0;          // squash spring (+ = squashed flat); sRest > 0 while splatted
    this.rim = Array.from({ length: NR }, (_, i) => ({ a: (i / NR) * Math.PI * 2, ox: 0, oy: 0, vx: 0, vy: 0 }));
    this.drops = []; this.puddles = []; this.sparks = []; this.trail = []; this.steam = [];
    this.mood = 'happy'; this.look = 0; this.lookY = 0; this.eye = { x: 0, y: 0 }; this.blink = 0; this.nextBlink = 2; this.t = 0; this.spin = 0; this.shiver = 0;
    this.visible = true; this.mode = 'roam'; this.dock = null; this.hanko = false; this.flood = null; this.gather = null;
    this.roamT = reduced ? Infinity : rnd(9, 16); this.readT = rnd(4, 9); this.reading = 0; this.targetX = null; this.bodyAlpha = 1;
    this.side = -1; this.puff = 0; this.splatT = 0; this.entered = false; this.perf = { n: 0, ms: 0, max: 0 };
    this.meter = new TapMeter({ rand });
    this.drag = null; this.dizzy = 0; this.dizzyT = 0; this.bounces = 0;
    this.imp = { nx: 0, ny: 1, s: 0, sv: 0 }; this.mom = 0; this.stick = 0; this.stickV = 0;   // round 14 fluid body: impact-normal squash, wall splat, velocity stretch
    // his own hit box: the only element that takes his gestures (the canvas itself never blocks the page)
    this.hit = document.createElement('div'); this.hit.className = 'inky-hit'; this.hit.setAttribute('aria-hidden', 'true');
    Object.assign(this.hit.style, { position: 'fixed', left: '0', top: '0', width: '0', height: '0', zIndex: '61', touchAction: 'none', display: 'none', webkitTapHighlightColor: 'transparent', userSelect: 'none', webkitUserSelect: 'none' });
    document.body.appendChild(this.hit);
    this.hit.addEventListener('pointerdown', e => this.press(e));
    this.hit.addEventListener('pointermove', e => this.moveTo(e));
    this.hit.addEventListener('pointerup', e => this.release(e));
    this.hit.addEventListener('pointercancel', e => this.release(e, true));
    this.hit.addEventListener('touchstart', e => e.preventDefault(), { passive: false });     // never a scroll / zoom start
    this.hit.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    this.hit.addEventListener('contextmenu', e => e.preventDefault());
    this.resize(); addEventListener('resize', () => this.resize());
    let lastY = scrollY; addEventListener('scroll', () => { const d = scrollY - lastY; lastY = scrollY; if (!document.documentElement.classList.contains('scroll-lock')) this.onScroll(d); }, { passive: true });
    clock.onTick(dt => { if (typeof document !== 'undefined' && document.hidden) return; const t0 = performance.now(); this.step(dt); this.track(performance.now() - t0); });
  }
  track(ms) { const p = this.perf; p.n++; p.ms += ms; p.max = Math.max(p.max, ms); }
  resize() {
    this.cw = Math.ceil(innerWidth / P); this.ch = Math.ceil(innerHeight / P);
    this.cv.width = this.cw; this.cv.height = this.ch; this.cv.style.width = this.cw * P + 'px'; this.cv.style.height = this.ch * P + 'px'; this.img = this.ctx.createImageData(this.cw, this.ch);
    if (this.mode === 'roam') { this.floor = this.pageFloor(); if (this.grounded) this.fy = this.floor; if (this.entered) this.targetX = this.homeX(this.side); }
  }
  // where he floats: a little above the write-button scroll, from its RESTING geometry (it animates during compose)
  fabRest() {
    const fab = typeof document !== 'undefined' && document.getElementById('fab');
    if (!fab) return null;
    const cs = getComputedStyle(fab), h = fab.offsetHeight || 60, w = fab.offsetWidth || 280, bottom = parseFloat(cs.bottom) || 14;
    return { top: innerHeight - bottom - h, left: innerWidth / 2 - w / 2, right: innerWidth / 2 + w / 2, w, h };
  }
  pageFloor() { const f = this.fabRest(); return ((f ? f.top : innerHeight - 64) - FLOAT_GAP) / P; }
  floorCss() { return this.pageFloor() * P; }
  // the two ends of the button (ink px): bottom-left and bottom-right, inside the screen
  homeX(side) {
    const f = this.fabRest(), l = f ? f.left + 34 : innerWidth * .18, r = f ? f.right - 34 : innerWidth * .82;
    return Math.max(this.R + 3, Math.min(this.cw - this.R - 3, (side < 0 ? l : r) / P));
  }
  // ---------- public API (css px) ----------
  get pos() { return { x: this.x * P, y: (this.fy - this.R * 1.1) * P, top: (this.fy - this.R * 2.6 * this.sy) * P, foot: this.fy * P }; }
  get sy() { return this._sy ?? 1; } set sy(v) { this._sy = v; }
  setMood(m) { if (this.mood !== m) { this.mood = m; if (m === 'cheer') this.jump(1.1); if (m === 'worry') this.shiver = .6; if (m === 'happy') this.wobble(.25); } }
  placeAt(xcss, footCss) { this.x = xcss / P; this.fy = footCss / P; this.vx = this.vy = 0; this.targetX = null; this.entered = true; }
  wobble(k = .4) { if (this.reduced) k *= .4; this.sv += 9 * k; this.rim.forEach(r => { r.vx += Math.cos(r.a * 2 + this.t) * 18 * k; r.vy += Math.sin(r.a * 3) * 18 * k; }); }
  jump(k = 1, vx = 0) { if (!this.grounded && this.floor != null) return; if (this.reduced) k *= .5; this.vy = -95 * k; this.vx = vx; this.grounded = false; this.s = -.25; this.sv = -4; }
  hopTo(xcss, footCss, T = .5, height = 22) {   // ballistic hop that lands at a css point after ~T s
    const x1 = xcss / P, y1 = footCss / P; this.vx = (x1 - this.x) / T; this.targetX = null;
    this.vy = ((y1 - this.fy) - .5 * G * T * T) / T; if (this.fy + this.vy * T * .5 + .125 * G * T * T > Math.min(this.fy, y1) - height) this.vy = Math.min(this.vy, -Math.sqrt(2 * G * height));
    this.grounded = false; this.floor = y1; this.landX = x1; this.s = -.2;
    return clock.wait(T * 1000);
  }
  // slide along the float line to x (css px); resolves when he has (about) come to rest
  slideTo(xcss) { this.targetX = xcss / P; return new Promise(res => { this._slid = res; }); }
  // the entrance: from off-screen left, fast, skidding, overshooting, wobbling to a stop at the bottom-left end
  enter() {
    this.mode = 'roam'; this.floor = this.pageFloor(); this.fy = this.floor; this.grounded = true; this.side = -1; this.entered = true;
    if (this.reduced) { this.x = this.homeX(-1); this.vx = 0; this.targetX = null; return Promise.resolve(); }
    this.x = -this.R * 2.5; this.vx = 150; this.s = -.2;
    return this.slideTo(this.homeX(-1) * P);
  }
  splat(n = 10, power = 1, color = INK, x = this.x, y = this.fy - this.R) {
    for (let k = 0; k < n; k++) {
      const a = -Math.PI * (0.05 + Math.random() * 0.9), sp = (40 + Math.random() * 70) * power;
      this.drops.push({ x, y, vx: Math.cos(a) * sp * (Math.random() < .5 ? -1 : 1), vy: Math.sin(a) * sp, r: 1 + Math.random() * 1.6, life: 2.5, color, floor: this.floor ?? this.ch - 2 });
    }
  }
  sparkle(n = 12, x = this.x, y = this.fy - this.R * 1.5, colors = [GOLD, RED, SOFT, BLUE]) {
    for (let k = 0; k < n; k++) { const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 60; this.sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, life: .9 + Math.random() * .5, color: colors[k % colors.length] }); }
  }
  // a bubble popping at (css) x, y: a ring of ink specks flying out
  pop(xcss, ycss, w = 60) {
    const x = xcss / P, y = ycss / P;
    for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2, sp = 50 + Math.random() * 30; this.sparks.push({ x: x + Math.cos(a) * w / P / 3, y: y + Math.sin(a) * 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * .6 - 10, life: .32 + Math.random() * .15, color: k % 2 ? INK : SOFT, small: true }); }
  }
  onScroll(d) {
    if (this.mode !== 'roam' || !this.visible) return;
    const k = Math.max(-1, Math.min(1, d / 60));
    this.rim.forEach(r => r.vy += -k * (this.reduced ? 12 : 40) * (Math.sin(r.a) < 0 ? 1.4 : .6));     // the ink sloshes
    if (!this.reading && !this.reduced && Math.abs(d) > 30 && Math.random() < .3) this.reading = rnd(1.5, 2.5);   // what was that? he looks up
  }
  // is this point (css) on his body? (a tight test, so a tap on the button or the noren never counts as a poke)
  hits(xc, yc) {
    const cx = this.x, cy = this.fy - this.R * .95 * this.sy, dx = (xc / P - cx) / (this.R * 1.25 * (this.sx || 1)), dy = (yc / P - cy) / (this.R * 1.35 * this.sy + 1);
    return dx * dx + dy * dy < 1;
  }
  onPointer(e) {                                     // (older callers) a direct tap at a point
    if (!this.visible || this.mode !== 'roam') return;
    if (e.target?.closest?.('#fab, .noren-cv, #compose, a, button, input, textarea')) return;
    if (!this.hits(e.clientX, e.clientY)) return;
    this.poke();
  }
  canGrab() { return this.visible && this.entered && (this.mode === 'roam' || this.mode === 'drag') && this.splatT <= 0; }
  press(e) {
    if (!this.canGrab() || this.drag || this.press0) return;
    e.preventDefault(); try { this.hit.setPointerCapture(e.pointerId); } catch {}
    this.press0 = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }
  moveTo(e) {
    const p0 = this.press0; if (!p0 || e.pointerId !== p0.id) return;
    e.preventDefault();
    const now = clock.now() / 1000, x = e.clientX, y = e.clientY;
    if (!this.drag) {
      if (Math.hypot(x - p0.x, y - p0.y) < DRAG_START) return;
      // picked up: grab offset from his foot, the spin tracker starts on the finger
      this.drag = { ox: x / P - this.x, oy: y / P - this.fy, tx: this.x, ty: this.fy, cx: x, cy: y, a: null, turn: 0, last: now, w: 0, fast: 0, px: x, py: y };
      this.mode = 'drag'; this.grounded = false; this.targetX = null; this.reading = 0; this._slid = null; this.bounces = 0;
      this.s = -.25; this.sv = -5; this.wobble(.9); this.giggle = 0; this.onDragStart?.();
    }
    const d = this.drag, dt = Math.max(1e-3, now - d.last); d.last = now;
    d.tx = x / P - d.ox; d.ty = y / P - d.oy;
    // dizzy: how far the finger's path has wound around its (moving) centre = the summed turning of its heading,
    // unwrapped; sharp reversals (a back-and-forth shake) don't count as winding
    const sx = x - (d.px ?? x), sy = y - (d.py ?? y);
    if (Math.hypot(sx, sy) >= 6) {
      const a = Math.atan2(sy, sx); d.px = x; d.py = y;
      if (d.a != null) { let da = a - d.a; da -= Math.round(da / (2 * Math.PI)) * 2 * Math.PI;
        if (Math.abs(da) < 2.2) { d.turn += da; d.w += (da / dt - d.w) * Math.min(1, dt * 6); } else d.w *= .5;
        if (Math.abs(d.w) > 4 * Math.PI) d.fast += dt; else d.fast = Math.max(0, d.fast - dt); }
      d.a = a;
    } else if (d.px == null) { d.px = x; d.py = y; }
    if (Math.abs(d.turn) >= 3 * Math.PI || d.fast > .35) { if (!this.dizzy) this.wobble(1.2); this.dizzy = 1; }
  }
  release(e, cancel = false) {
    const p0 = this.press0; if (!p0 || (e && e.pointerId !== p0.id)) return;
    this.press0 = null; try { this.hit.releasePointerCapture(p0.id); } catch {}
    if (!this.drag) { if (!cancel && this.mode === 'roam') this.poke(); return; }      // a plain tap: counts toward the splat
    this.drag = null; if (this.mode === 'drag') this.throw();
  }
  // let go: keep the throw velocity, fall with gravity, plop onto the float line
  throw() {
    this.mode = 'roam'; this.grounded = false; this.floor = this.pageFloor(); this.bounces = 0;
    const V = this.reduced ? 120 : 420; this.vx = Math.max(-V, Math.min(V, this.vx)); this.vy = Math.max(-V, Math.min(V, this.vy));
    if (this.fy > this.floor) this.vy = Math.min(this.vy, -Math.sqrt(2 * G * (this.fy - this.floor + 4)));   // dropped below the line: hop up onto it
    if (this.dizzy) { this.dizzyT = this.reduced ? 2 : rnd(2, 4); this.dizzy = 0; }
    this.roamT = rnd(3, 6); this.side = this.x * P < innerWidth / 2 ? -1 : 1;
  }
  // one tap on Inky: TapMeter decides how he takes it
  poke(now = clock.now()) {
    const r = this.meter.tap(now); this.lastPoke = now;
    if (r.kind === 'ignored') return r;
    const R = this.reduced;
    if (r.kind === 'splat') this.splatDown();
    else {
      this.s = R ? .25 : .5; this.sv = 0; this.wobble(r.kind === 'squish' ? .8 : 1.1); this.splat(r.kind === 'mad' ? 7 : 4, .7);
      if (r.kind === 'squish') { this.giggle = 1; this.setMood('happy'); }
      if (r.kind === 'annoyed') { this.giggle = 0; this.setMood('annoyed'); this.shiver = R ? 0 : .25; }
      if (r.kind === 'mad') { this.giggle = 0; this.setMood('mad'); this.shiver = R ? 0 : .5; this.puff = Math.min(1, this.puff + .35); if (!R) for (let k = 0; k < 3; k++) this.steam.push({ x: this.x + (k - 1) * 3, y: this.fy - this.R * 2.1, vy: -rnd(14, 22), life: rnd(.5, .8), side: k - 1 }); }
    }
    this.onTap?.(r.kind, r.taps); return r;
  }
  // an impact: squash along the normal (nx, ny points INTO the surface), how hard = 0..~.6
  squashOn(nx, ny, a) { const I = this.imp; if (a < I.s - .05) return; I.nx = nx; I.ny = ny; I.s = Math.max(I.s, a * (this.reduced ? .5 : 1)); I.sv = 0; }
  hitWall(side, v, flying) {
    if (v < 35) return;
    this.squashOn(side, 0, Math.min(.6, v / 480));
    if (v > 70 && this.visible) this.splat(Math.min(6, Math.round(v / 70)), v / 320, INK, this.x + side * this.R * .9, this.fy - this.R);
    if (flying && v > 130 && !this.reduced) { this.stick = .07 + Math.min(.11, v / 3600); this.stickV = this.vx; this.vx = 0; }   // stuck flat for a beat
  }
  splatDown() {
    this.splatT = this.reduced ? 1.1 : 1.7; this.sRest = .8; this.s = .9; this.sv = 0; this.puff = 0; this.targetX = null; this.vx = 0;
    this.setMood('splat'); this.splat(this.reduced ? 5 : 14, 1.3); this.wobble(1.6);
    this.puddles.push({ x: this.x, y: this.fy, w: Math.round(this.R * 1.5), life: 1.2, color: WASH });
  }
  popUp() {
    this.splatT = 0; this.sRest = 0; this.meter.revive();
    this.s = this.reduced ? 0 : -.55; this.sv = this.reduced ? 0 : -6; this.wobble(1.3); this.setMood('happy'); this.giggle = .8;
    if (!this.reduced) { this.grounded = true; this.jump(.8); }
    this.onPopUp?.();
  }
  // ---------- ink flood (older compose path): rises, sloshes, then gathers into a ball at (gx,gy) css ----------
  startFlood(xcss, levelCss) {
    const n = this.cw + 1, h = new Float32Array(n).fill(this.ch + 4), v = new Float32Array(n);
    const ix = Math.round(xcss / P);
    for (let i = 0; i < n; i++) v[i] = -260 * Math.exp(-(((i - ix) / 7) ** 2));
    this.flood = { h, v, level: this.ch + 4, target: levelCss / P, rate: 0, t: 0, drain: false };
    this.splat(26, 2.1, INK, ix, this.ch - 4); this.drops.forEach(d => d.floor = this.ch + 20);
  }
  gatherTo(xcss, ycss, R) { this.gather = { x: xcss / P, y: ycss / P, r: 3, R, balls: [], t: 0 }; if (this.flood) this.flood.drain = true; }
  // ---------- behaviour on the board ----------
  roam(dt) {
    if (this.splatT > 0) { this.splatT -= dt; if (this.splatT <= 0) this.popUp(); return; }
    // drift back up to the float line above the write button (e.g. after the compose drain set him down lower)
    if (this.grounded && this.visible) { const pf = this.pageFloor(); if (Math.abs(this.fy - pf) > .05) { this.floor = pf; this.fy += (pf - this.fy) * Math.min(1, dt * 5); } }
    const now = clock.now();
    if (this.meter.mood(now) === 'calm' && (this.mood === 'mad' || this.mood === 'annoyed')) { this.setMood('happy'); this.puff = 0; }
    this.puff = Math.max(0, this.puff - dt * (this.mood === 'mad' ? .05 : .6));
    if (this.mood === 'mad' && !this.reduced && Math.random() < dt * 2.5) { this.shiver = .25; this.steam.push({ x: this.x + rnd(-3, 3), y: this.fy - this.R * 2.1, vy: -rnd(14, 22), life: rnd(.5, .8), side: Math.sign(rnd(-1, 1)) }); }
    if (!this.entered || this.reduced) return;
    // slide over to the other end of the button now and then
    this.roamT -= dt;
    if (this.roamT <= 0 && this.grounded && this.targetX == null && this.mood !== 'mad') {
      this.roamT = rnd(9, 22); this.side = -this.side; this.targetX = this.homeX(this.side); this.reading = 0;
    }
    // reading: eyes up, tracking the poem in view
    this.readT -= dt;
    if (this.readT <= 0 && !this.reading) { this.reading = rnd(2.5, 5); this.readT = rnd(6, 14); }
    if (this.reading > 0) this.reading = Math.max(0, this.reading - dt);
  }
  // where he looks (-1..1 each way): up at the poem nearest the screen middle while reading, along his slide otherwise
  lookTarget() {
    if (this.reading > 0 && typeof document !== 'undefined') {
      let best = null, bd = 1e9;
      for (const el of document.querySelectorAll('.poem')) { const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) continue; const d = Math.abs(r.top + r.height / 2 - innerHeight * .45); if (d < bd) { bd = d; best = r; } }
      const tx = best ? best.left + best.width / 2 : innerWidth / 2;
      return { x: Math.max(-1, Math.min(1, (tx - this.x * P) / 90)), y: -1 };
    }
    if (this.mood === 'splat') return { x: 0, y: 0 };
    return { x: Math.abs(this.vx) > 8 ? Math.sign(this.vx) : this.look, y: this.lookY };
  }
  // ---------- simulation ----------
  step(dt) {
    dt = Math.min(dt, 1 / 20); this.t += dt; const R = this.R;
    if (this.mode === 'roam') this.roam(dt);
    if (this.mode === 'coach' && this.dock) {                    // follow the dock (older compose path)
      const d = this.dock(); if (d) { this.floor = d.foot / P; if (this.grounded) { this.x += (d.x / P - this.x) * Math.min(1, dt * 8); this.fy = this.floor; } }
      if (this.grounded && this.mood === 'cheer' && Math.random() < dt * 1.5) this.jump(.8);
    }
    const ax0 = this.vx, ay0 = this.vy;
    // SLIDING on the float line: an under-damped spring to the target, so he overshoots and wobbles in
    if (this.grounded && this.targetX != null) {
      const d = this.targetX - this.x, a = d * 22 - this.vx * 4.4;
      const before = this.vx; this.vx += a * dt; this.vx = Math.max(-170, Math.min(170, this.vx)); this.x += this.vx * dt;
      if (Math.sign(before) !== Math.sign(this.vx) && Math.abs(before) > 12) this.wobble(.5);          // the turn at each overshoot
      if (Math.abs(this.vx) > 25 && Math.sign(a) !== Math.sign(this.vx) && !this.reduced && Math.random() < dt * 30)   // skidding: ink scuffs off his bottom
        this.drops.push({ x: this.x - Math.sign(this.vx) * R * .8, y: this.fy - 1, vx: -this.vx * rnd(.1, .3), vy: -rnd(10, 40), r: rnd(.8, 1.3), life: 1, color: INK, floor: this.floor });
      if (Math.abs(d) < .35 && Math.abs(this.vx) < 3) { this.x = this.targetX; this.vx = 0; this.targetX = null; this.wobble(.35); const f = this._slid; this._slid = null; f?.(); }
    } else if (this.mode === 'drag' && this.drag) {                 // held: a springy slink after the finger
      const d = this.drag, k = this.reduced ? 420 : 150, c = this.reduced ? 40 : 13;
      this.vx += ((d.tx - this.x) * k - this.vx * c) * dt; this.vy += ((d.ty - this.fy) * k - this.vy * c) * dt;
      this.x += this.vx * dt; this.fy += this.vy * dt;
      if (this.x < R || this.x > this.cw - R) { const side = this.x < R ? -1 : 1; this.hitWall(side, Math.abs(this.vx), false); this.vx = 0; }   // dragged into the screen edge: he squashes on it
      { const pen = d.tx < R ? R - d.tx : d.tx > this.cw - R ? d.tx - (this.cw - R) : 0; if (pen > .5) this.squashOn(d.tx < R ? -1 : 1, 0, Math.min(.55, pen / R * .9)); }   // pressed into it: stays flat
      this.x = Math.max(R, Math.min(this.cw - R, this.x)); this.fy = Math.max(R * 2.4, Math.min(this.ch - 1, this.fy));
    } else if (!this.grounded && this.floor != null) {             // body ballistics (hops, throws)
      if (this.stick > 0) {                                        // SPLATTED flat on the wall: hangs there a beat, sliding a little
        this.stick -= dt; this.imp.sv = 0; this.vy = Math.min(this.vy, 40); this.vx = 0;
        if (this.stick <= 0) { this.vx = this.stickV; this.imp.sv = -9; this.wobble(1.1); }   // ...then springs off, jiggling
      }
      this.vy += G * dt; this.x += this.vx * dt; this.fy += this.vy * dt;
      if (this.x < R || this.x > this.cw - R) { const side = this.x < R ? -1 : 1, v = Math.abs(this.vx); this.x = Math.max(R, Math.min(this.cw - R, this.x)); this.vx *= -.45; this.wobble(.5); this.hitWall(side, v, true); }   // off the screen sides
      if (this.fy < R * 2.4 && this.vy < 0) { this.fy = R * 2.4; this.vy *= -.3; }
      if (this.fy >= this.floor && this.vy > 0) {
        const impact = this.vy; this.fy = this.floor;
        this.s = Math.min(.45, impact / 300); this.sv = 0; if (impact > 70) this.splat(Math.round(impact / 25), impact / 160);
        this.squashOn(0, 1, Math.min(.42, impact / 420));                          // flattens along the floor normal too
        if (impact > 70 && this.bounces < 1 && !this.reduced) { this.bounces++; this.vy = -impact * .28; this.vx *= .5; this.wobble(.8); }   // plop + one small bounce
        else { this.vy = 0; this.vx = 0; this.grounded = true; this.bounces = 0; }
        this.onLand?.(impact);
      }
    }
    // faint ink trail where he slides
    if (this.grounded && Math.abs(this.vx) > 6 && !this.reduced && this.visible) {
      const last = this.trail[this.trail.length - 1];
      if (!last || Math.abs(last.x - this.x) >= 1) this.trail.push({ x: Math.round(this.x), y: Math.round(this.fy), w: Math.min(R * .8, 1.5 + Math.abs(this.vx) / 45), life: 1 });
    }
    const axc = (this.vx - ax0) / Math.max(dt, 1e-3), ayc = (this.vy - ay0) / Math.max(dt, 1e-3);
    // squash spring (+ splat rest) + breathing + stretch along the motion
    this.sv += (-320 * (this.s - this.sRest) - 11 * this.sv) * dt; this.s += this.sv * dt;
    const breathe = this.grounded && this.splatT <= 0 ? Math.sin(this.t * 3.1) * (this.reduced ? .02 : .04) : 0;
    const stretch = 0;                                          // (round 14: the stretch now runs along his velocity, below)
    // MOMENTUM: while dragged / flying, the stretch builds up with speed (not instantly) and points along his velocity
    const spd = Math.hypot(this.vx, this.vy), moving = this.mode === 'drag' || (!this.grounded && this.stick <= 0);
    this.mom += ((moving ? Math.min(1, spd / 300) : 0) - this.mom) * Math.min(1, dt * (this.mode === 'drag' ? 3.2 : 7));
    if (spd > 4) { this.ux = this.vx / spd; this.uy = this.vy / spd; }
    // the impact squash: a spring along the hit's normal (under-damped: it overshoots into a stretch = the jiggle)
    { const I = this.imp; if (this.stick > 0) I.sv = 0; else { I.sv += (-300 * I.s - 7.5 * I.sv) * dt; I.s = Math.max(-.35, Math.min(.62, I.s + I.sv * dt)); } }   // held flat while stuck
    const run = this.grounded ? Math.min(.32, Math.abs(this.vx) / 260) : 0;            // long and low when sliding fast
    const puff = this.puff * .14;
    this.sx = 1 + this.s + breathe - stretch * .6 + run + puff; this.sy = Math.max(.18, 1 - this.s - breathe + stretch - run * .55 + puff);
    if (this.shiver > 0) this.shiver -= dt;
    if (this.dizzyT > 0) this.dizzyT = Math.max(0, this.dizzyT - dt);
    if (this.mood === 'cheer' || this.spin > 0) this.spin = Math.max(0, this.spin - dt);
    // rim balls lag behind the body (the gooey wobble)
    const sx = this.sx, sy = this.sy, held = this.mode === 'drag', lag = this.reduced ? .012 : held ? .055 : .03, damp = held && !this.reduced ? 6.5 : 9;
    const k = this.mom * (this.reduced ? .12 : .62), I = this.imp, ia = this.reduced ? I.s * .4 : I.s;
    for (const r of this.rim) {
      let tx = Math.cos(r.a) * R * .55 * sx, ty = Math.sin(r.a) * R * .55 * sy;
      [tx, ty] = aniso(tx, ty, this.ux ?? 0, this.uy ?? 1, -k);          // stretched along his velocity
      [tx, ty] = aniso(tx, ty, I.nx, I.ny, ia);                          // squashed along the impact normal
      r.vx += ((tx - r.ox) * 220 - r.vx * damp - axc * lag) * dt; r.vy += ((ty - r.oy) * 220 - r.vy * damp - ayc * lag) * dt;
      r.ox += r.vx * dt; r.oy += r.vy * dt;
    }
    // eyes
    const lt = this.lookTarget(); this.eye.x += (lt.x - this.eye.x) * Math.min(1, dt * 7); this.eye.y += (lt.y - this.eye.y) * Math.min(1, dt * 7);
    this.nextBlink -= dt; if (this.nextBlink < 0) { this.blink = .14; this.nextBlink = 1.8 + Math.random() * 3.5; }
    if (this.blink > 0) this.blink -= dt;
    if (this.giggle > 0) this.giggle -= dt;
    // drops, puddles, trail, steam, sparks
    for (const d of this.drops) {
      const gx = this.x - d.x, gy = this.fy - R - d.y, gd = Math.hypot(gx, gy);
      if (d.life < 1.9 && gd < R * 2.2 && this.visible) { d.vx += gx * 12 * dt; d.vy += gy * 12 * dt; if (gd < R * .7) d.life = 0; }   // gooey: close drops get pulled back in
      d.vy += G * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.life -= dt;
      if (d.y > d.floor && d.vy > 0) { d.life = 0; if (d.floor < this.ch) this.puddles.push({ x: d.x, y: d.floor, w: Math.round(d.r * .8), life: 1.1, color: TRAIL }); }
    }
    this.drops = this.drops.filter(d => d.life > 0 && d.y < this.ch + 30);
    this.puddles.forEach(p => p.life -= dt); this.puddles = this.puddles.filter(p => p.life > 0);
    this.trail.forEach(p => p.life -= dt); this.trail = this.trail.filter(p => p.life > 0);
    this.steam.forEach(s => { s.y += s.vy * dt; s.x += s.side * 6 * dt; s.life -= dt; }); this.steam = this.steam.filter(s => s.life > 0);
    this.sparks.forEach(s => { s.vy += G * .4 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; }); this.sparks = this.sparks.filter(s => s.life > 0);
    const F = this.flood;
    if (F) {
      F.t += dt; const n = F.h.length;
      if (!F.drain) F.level += (F.target - F.level) * Math.min(1, dt * 9); else F.level += 150 * dt;
      for (let sub = 0, h2 = dt / 3; sub < 3; sub++) {
        for (let i = 0; i < n; i++) { const l = F.h[i - 1] ?? F.h[i], rr = F.h[i + 1] ?? F.h[i]; F.v[i] += ((l + rr - 2 * F.h[i]) * 900 + (F.level - F.h[i]) * 70 - F.v[i] * 2.6) * h2; }
        for (let i = 0; i < n; i++) F.h[i] += F.v[i] * h2;
      }
      if (F.drain && this.gather) for (let k = 0; k < 3; k++) { const i = Math.floor(Math.random() * n); if (F.h[i] < this.ch) this.gather.balls.push({ x: i, y: F.h[i] + 2, vx: (Math.random() - .5) * 30, vy: -60 - Math.random() * 60, r: 2 + Math.random() * 2.5 }); }
      if (F.drain && F.level > this.ch + 40) this.flood = null;
    }
    const Gt = this.gather;
    if (Gt) {
      Gt.t += dt;
      for (const b of Gt.balls) { b.vx += ((Gt.x - b.x) * 60 - b.vx * 7) * dt; b.vy += ((Gt.y - b.y) * 60 - b.vy * 7) * dt; b.x += b.vx * dt; b.y += b.vy * dt; const d = Math.hypot(Gt.x - b.x, Gt.y - b.y); if (d < Gt.r * .6) { b.dead = true; Gt.r = Math.min(Gt.R * 1.05, Gt.r + .3); } }
      Gt.balls = Gt.balls.filter(b => !b.dead);
    }
    this.placeHit();
    this.render();
  }
  placeHit() {
    const on = this.canGrab() || !!this.drag, st = this.hit.style;
    if (!on) { if (st.display !== 'none') st.display = 'none'; return; }
    const R = this.R, w = R * 2.8 * P, h = R * 2.7 * P, l = Math.round(this.x * P - w / 2), t = Math.round(this.fy * P - h + 4);
    if (st.display !== 'block') st.display = 'block';
    const key = l + ',' + t; if (key !== this._hitKey) { this._hitKey = key; st.transform = `translate(${l}px, ${t}px)`; st.width = w + 'px'; st.height = h + 'px'; }
  }
  // ---------- rendering on the pixel grid ----------
  render() {
    const { cw, ch, img } = this, D = img.data;
    const idle = !(this.visible && this.bodyAlpha > 0) && !this.drops.length && !this.puddles.length && !this.sparks.length && !this.trail.length && !this.flood && !this.gather;
    if (idle && this._blank) return;                               // nothing to draw: leave the cleared canvas alone
    D.fill(0); this._blank = idle;
    const put = (x, y, c, a = 255) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= cw || y >= ch) return; const i = (y * cw + x) * 4; D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; D[i + 3] = a; };
    // the faint trail first (under everything): a thin dithered smear along the float line, fading out
    for (const p of this.trail) { const k = p.life; for (let i = -Math.round(p.w); i <= Math.round(p.w); i++) if (BAYER[((p.y & 3) * 4 + ((p.x + i) & 3))] < k * k * .5) put(p.x + i, p.y, TRAIL); }
    const balls = [], R = this.R;
    const bob = this.mode === 'roam' && this.grounded && !this.reduced && this.splatT <= 0 ? Math.round(Math.sin(this.t * 2.2) * .6) : 0;
    const cx = this.x + (this.shiver > 0 ? Math.sin(this.t * 70) * .8 : 0), cy = this.fy - R * .92 * this.sy + bob;
    const showBody = this.visible && this.bodyAlpha > 0;
    if (showBody) {
      // squashed on a wall / the floor: the core shrinks and slides toward the contact, the rim balls are held at the
      // contact line, so he goes FLAT against it (a splat) and springs back round as the squash spring releases
      const I = this.imp, sq = Math.max(0, I.s), ccx = cx + I.nx * sq * R * .38, ccy = cy + I.ny * sq * R * .22;
      const wl = R * .82, flat = sq > .04;
      balls.push([ccx, ccy, R * .62 * (1 - sq * .3)]);
      if (flat) { const tx = -I.ny, ty = I.nx; balls.push([ccx + tx * R * .42 * sq, ccy + ty * R * .42 * sq, R * .4], [ccx - tx * R * .42 * sq, ccy - ty * R * .42 * sq, R * .4]); }
      const sp = this.spin > 0 ? this.spin * 14 : 0;
      for (const r of this.rim) { const c = Math.cos(sp), s = Math.sin(sp); let bx = cx + r.ox * c - r.oy * s, by = cy + r.ox * s + r.oy * c;
        if (flat) { if (I.nx < -.5) bx = Math.max(bx, wl * .5); if (I.nx > .5) bx = Math.min(bx, cw - wl * .5); if (I.ny > .5) by = Math.min(by, this.fy - R * .3); }
        balls.push([bx, by, R * .42]); }
      // the pointed top of the drop, trailing behind his motion like wet ink
      if (this.splatT <= 0) { const lean = Math.max(-2.2, Math.min(2.2, -this.vx / 34)); balls.push([cx + lean * .5, cy - R * .7 * this.sy, R * .4], [cx + lean, cy - R * 1.12 * this.sy, R * .24], [cx + lean * 1.5, cy - R * 1.42 * this.sy, R * .12]); }
    }
    for (const d of this.drops) balls.push([d.x, d.y, d.r, d.color]);
    if (this.gather) { balls.push([this.gather.x, this.gather.y, this.gather.r]); for (const b of this.gather.balls) balls.push([b.x, b.y, b.r]); }
    const F = this.flood;
    let x0 = cw, y0 = ch, x1 = 0, y1 = 0;
    for (const [x, y, r] of balls) { x0 = Math.min(x0, x - r * 2.6); y0 = Math.min(y0, y - r * 2.6); x1 = Math.max(x1, x + r * 2.6); y1 = Math.max(y1, y + r * 2.6); }
    if (F) { let mn = ch; for (const v of F.h) mn = Math.min(mn, v); x0 = 0; x1 = cw; y0 = Math.min(y0, mn - 6); y1 = ch; }
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(cw - 1, Math.ceil(x1)); y1 = Math.min(ch - 1, Math.ceil(y1));
    const nb = balls.length, BX = new Float32Array(nb), BY = new Float32Array(nb), BR = new Float32Array(nb);
    balls.forEach((b, i) => { BX[i] = b[0]; BY[i] = b[1]; BR[i] = b[2] * b[2]; });
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      let f = 0;
      for (let i = 0; i < nb; i++) { const dx = x + .5 - BX[i], dy = y + .5 - BY[i], d2 = dx * dx + dy * dy, r2 = BR[i]; if (d2 < r2 * 7) f += r2 / (d2 + .01); }
      if (F) { const t = y + .5 - F.h[x]; f += t >= 0 ? 2 : 1 / (1 + (t / 2.2) ** 2) * .9; }
      if (f >= 1) put(x, y, INK);
      else if (f >= .82 && BAYER[(y & 3) * 4 + (x & 3)] < .5) put(x, y, WASH);    // a dithered wet edge: soft sumi bleed
    }
    for (const p of this.puddles) for (let k = -p.w; k <= p.w; k++) if (p.life > .5 || (k + Math.round(p.x)) % 2 === 0) put(p.x + k, p.y, p.color);
    if (showBody) this.face(cx, cy, put);
    if (showBody && this.hanko) this.drawHanko(cx, cy - R * 1.3 * this.sy, put);
    if (showBody && this.mood === 'mad') this.drawAnger(cx, cy, put);
    for (const s of this.steam) { const k = s.life; put(s.x, s.y, SOFT); if (k > .35) put(s.x + s.side, s.y - 1, SOFT); }
    for (const s of this.sparks) { put(s.x, s.y, s.color); if (s.life > .5 && !s.small) { put(s.x + 1, s.y, s.color); put(s.x - 1, s.y, s.color); put(s.x, s.y + 1, s.color); put(s.x, s.y - 1, s.color); } }
    this.ctx.putImageData(img, 0, 0);
  }
  face(cx, cy, put) {
    const R = this.R, m = this.mood, sx = this.sx, sy = this.sy, k = R / 7, W = PAPER;
    const lx = Math.round(this.eye.x * k), ly = this.eye.y;
    const ey = Math.round(cy - R * .12 * sy), ex = [Math.round(cx - 2.6 * k * sx), Math.round(cx + 1.6 * k * sx)];
    put(cx - R * .5 * sx, cy - R * .45 * sy, WASH); put(cx - R * .5 * sx, cy - R * .3 * sy, WASH);          // highlight
    if (m === 'splat') {                                                                                    // X X, flat
      const y = Math.round(cy - R * .05 * sy);
      for (const e of [Math.round(cx - 3.2 * k * sx), Math.round(cx + 1.8 * k * sx)]) { put(e, y - 1, W); put(e + 2, y - 1, W); put(e + 1, y, W); put(e, y + 1, W); put(e + 2, y + 1, W); }
      put(cx - 1, y + 2, W); put(cx, y + 2, W); put(cx + 1, y + 2, W);
      return;
    }
    if (this.dizzy || this.dizzyT > 0) {                                                                 // spinning pixel spirals
      const f = this.reduced ? 0 : Math.floor(this.t * 12) & 3, wob = this.reduced ? 0 : Math.round(Math.sin(this.t * 9) * .7);
      const SP = [[[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1], [1, 1]]];
      for (let i = 0; i < 2; i++) {
        const e = ex[i] - (i ? 0 : 1), y0 = ey - 1 + (i ? wob : -wob);
        SP[0].forEach(([a, b], j) => { if (j === 8 || (j + f * 2) % 8 < 6) { const r = (f + i * 2) & 3, xx = r === 0 ? a : r === 1 ? 2 - b : r === 2 ? 2 - a : b, yy = r === 0 ? b : r === 1 ? a : r === 2 ? 2 - b : 2 - a; put(e + xx, y0 + yy, W); } });
        put(e + 1, y0 + 1, INK);
      }
      const my = Math.round(cy + R * .36 * sy), mx = Math.round(cx - .5);
      put(mx - 1, my, W); put(mx, my + 1, W); put(mx + 1, my, W); put(mx + 2, my + 1, W);                  // a woozy wavy mouth
      if (!this.reduced) for (let k2 = 0; k2 < 3; k2++) { const a = this.t * 5 + k2 * 2.1; put(cx + Math.cos(a) * R * 1.1, cy - R * 1.25 * sy + Math.sin(a) * 1.5, k2 === 0 ? GOLD : SOFT); }   // a little orbit of stars
      return;
    }
    for (const e of ex) {
      if (this.blink > 0 || m === 'sleep') { put(e, ey + 1, W); put(e + 1, ey + 1, W); continue; }
      if (m === 'cheer' || this.giggle > 0) { put(e, ey + 1, W); put(e + 1, ey, W); put(e + 2, ey + 1, W); continue; }   // ^ ^
      const eh = k >= 1.2 ? 4 : 3;
      if (m === 'mad' || m === 'angry' || m === 'shout') {                                                  // narrow, slanted in
        const inner = e === ex[0] ? 1 : 0;
        put(e + inner, ey, W); put(e + 1 - inner, ey + 1, W); put(e, ey + 1, W); put(e + 1, ey + 2, W); put(e, ey + 2, W);
        put(e + (lx > 0 ? 1 : 0), ey + 2, INK); continue;
      }
      for (let j = 0; j < eh; j++) { put(e, ey + j, W); put(e + 1, ey + j, W); }
      const py = ly < -.4 ? ey : ly > .4 ? ey + eh - 1 : ey + eh - 2;                                     // pupils: up when reading
      put(e + (lx > 0 ? 1 : 0), py, INK); if (ly < -.4) put(e + (lx > 0 ? 1 : 0), py + 1, INK);
      if (m === 'annoyed') put(e + (e === ex[0] ? 1 : 0), ey - 1, W);                                       // a cross little brow
      if (m === 'worry' || m === 'sad') put(e - (e === ex[0] ? 0 : -1), ey - 2, W);
    }
    const my = Math.round(cy + R * .32 * sy), mx = Math.round(cx - .5 + lx * .5);
    if (this.reading > 0 && m === 'happy') { put(mx, my, W); put(mx + 1, my, W); }                         // concentrating
    else if (m === 'happy' || m === 'cheer' || this.giggle > 0) { put(mx - 1, my, W); put(mx, my + 1, W); put(mx + 1, my + 1, W); put(mx + 2, my, W); put(ex[0] - 2, my - 1, SOFT); put(ex[1] + 3, my - 1, SOFT); }
    else if (m === 'mad') { for (let i = -1; i <= 2; i++) put(mx + i, my + (i === -1 || i === 2 ? 1 : 0), W); put(mx, my + 1, W); put(mx + 1, my + 1, W); }   // gritted
    else if (m === 'annoyed') { put(mx - 1, my + 1, W); put(mx, my + 1, W); put(mx + 1, my + 1, W); }
    else if (m === 'shout') { for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) put(mx + i - 1, my + j - 1, j === 0 ? W : RED); }
    else if (m === 'worry') { put(mx - 1, my + 1, W); put(mx, my, W); put(mx + 1, my + 1, W); put(mx + 2, my, W); put(cx + R * .9, cy - R * .5, BLUE); put(cx + R * .9, cy - R * .5 + 1, BLUE); }
    else if (m === 'sad' || m === 'angry') { put(mx - 1, my + 1, W); put(mx, my, W); put(mx + 1, my, W); put(mx + 2, my + 1, W); }
    else if (m === 'think') { put(mx, my, W); put(mx + 1, my, W); put(mx + 2, my - 1, W); }
    else { put(mx, my, W); put(mx + 1, my, W); }
  }
  // the one splash of red: a little anger mark (manga "vein" cross) by his head
  drawAnger(cx, cy, put) {
    const x = Math.round(cx + this.R * .95 * this.sx), y = Math.round(cy - this.R * 1.25 * this.sy), b = Math.floor(this.t * 8) % 2 && !this.reduced ? 1 : 0;
    for (const [i, j] of [[0, 1], [1, 0], [1, 2], [2, 1], [0, 0], [2, 2], [2, 0], [0, 2]].slice(0, 4 + b * 4)) put(x + i - 1, y + j - 1, RED);
    put(x, y, PAPER);
  }
  drawHanko(cx, top, put) {
    const x0 = Math.round(cx - 3), y0 = Math.round(top - 8);
    for (let j = 0; j < 4; j++) for (let i = 1; i < 5; i++) put(x0 + i, y0 + j, [92, 60, 40]);
    for (let j = 4; j < 8; j++) for (let i = -1; i < 7; i++) put(x0 + i, y0 + j, j === 7 ? [150, 30, 24] : RED);
    put(cx - this.R * .9, top + 4, INK); put(cx + this.R * .9, top + 4, INK);
  }
}
