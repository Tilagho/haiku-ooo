// Haiku Board - round 13 birds. Every so often a flight of sumi-e ink birds crosses the visible part of the scroll:
// sometimes 2-3, sometimes a skein of 15-30 that stretches, loosens into a V and reforms. Background layer: drawn
// on one small canvas inside the art layer, above the ink chunks and under the poems (and the paper grain).
//
// - Birds are pixel-crisp brush-stroke sprites on the poem font grid (1 px = 1.5 scroll units), rasterised once:
//   3 sizes for depth (far = small + pale), 2 hand variants each, 4 flap frames + a glide pose.
// - Motion is a light boids sim: every bird is spring-damped towards its slot in a breathing formation that follows
//   a leader along a lane, plus separation, gusty wind, altitude drift and its own flap rate / glides.
// - The lane comes from skyLanes() in scroll-engine2.js: emptiest paper, above the mountains, clear of poems.
//   Birds that still stray over a poem box are nudged out of it and drawn faint.
// - Round 14: a flight every 6-18 s (clock time while the board is visible), ~50/50 left / right, now and then two
//   groups at once crossing opposite ways on different lanes. Paused while the tab is hidden or compose is open; off
//   under prefers-reduced-motion.
// - Round 14.1: never more than 12 birds in a flight and at most 2 flights at once (<= 19 birds on screen: a second
//   flight beside an 8-12 skein is always a pair / trio or a small group). Kinds: few = a pair or trio (2-3, ~45% of
//   flights), small (4-7, ~30%), skein (8-12, ~25%, the same loose skein that loosens into a V and reforms).
//   'flock' is kept as another name for an 8-12 skein. Same frequency as round 14.
//   ?birds=few|small|skein|flock forces the kind (first flight after ~1 s); ?birds=off disables.
//   Captures: HB.view.birds.spawn(kind, { dir }) / spawnPair() with HB.clock in manual mode; .flocks = all in the air.
// The sim and sprite masks are pure (Node-testable); only mountBirds() touches the DOM.
import { SCROLL_W, skyLanes } from './scroll-engine2.js';
import { rng, hash } from './brush-text.js';

export const BPX = 1.5;                                   // scroll units per bird pixel (the poem font grid)
const INK = [26, 24, 29];
export const SIZES = [{ span: 7, alpha: .36 }, { span: 10, alpha: .58 }, { span: 14, alpha: .8 }];   // far, mid, near
export const FRAMES = 5;                                  // 0 up, 1 mid (down-going), 2 down, 3 mid (up-going), 4 glide

// ---- sprite masks: Uint8Array alpha (0..255) of w x h, bird faces RIGHT (+x), y down
export function birdMask(size, frame, variant = 0) {
  const span = SIZES[size].span, w = span + 3, h = Math.ceil(span * .8) + 3, m = new Float32Array(w * h);
  const R = rng(hash('bird', size, variant)), cx = w / 2, cy = h / 2;
  const plot = (x, y, a) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < w && y < h) m[y * w + x] = Math.max(m[y * w + x], a); };
  const stroke = (pts, t0, t1, dry = 0) => {          // a brush stroke along a polyline, thickness t0 -> t1 (px)
    const L = []; let tot = 0; for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); L.push(l); tot += l; }
    let acc = 0;
    for (let i = 1; i < pts.length; i++) for (let s = 0; s <= L[i - 1]; s += .25) {
      const u = (acc + s) / tot, x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * s / L[i - 1], y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * s / L[i - 1];
      const th = t0 + (t1 - t0) * u, a = u > .75 && dry && R() < dry ? .55 : 1;      // dry-brush breaks near the tip
      plot(x, y, a); if (th > 1.25) plot(x, y + 1, a); if (th > 2.1) plot(x + .6, y - .6, a);
      if (s + .25 > L[i - 1]) acc += L[i - 1];
    }
  };
  const big = size === 2, half = span / 2, j = (R() - .5) * .12 * span;
  // wing tip height by flap frame (negative = up); elbows lag behind the tips like a real wingbeat
  const tip = [-.46, -.05, .34, .02, -.16][frame] * span, elbow = [-.3, -.12, .12, -.02, -.05][frame] * span;
  const wingL = [[cx - .5, cy], [cx - half * .45, cy + elbow], [cx - half + j * .3, cy + tip]];
  const wingR = [[cx + .5, cy], [cx + half * .42, cy + elbow * .9], [cx + half * .9 + j * .2, cy + tip * .92 - (frame === 4 ? 1 : 0)]];
  const wt = [1, 1.5, 2.4][size], bt = [1.2, 1.7, 2.3][size];
  stroke(wingL, wt, 1, big ? .5 : .25); stroke(wingR, wt * .9, 1, big ? .5 : .25);
  // body: a short, slightly diagonal dash, head forward (+x), tail flick back
  stroke([[cx - span * .22, cy + span * .1], [cx + span * .04, cy + .2], [cx + span * .17, cy - span * .05]], bt, big ? 1.5 : 1);
  if (big) plot(cx + span * .24, cy - span * .09, 1);
  const out = new Uint8Array(w * h); for (let i = 0; i < m.length; i++) out[i] = Math.round(m[i] * 255);
  return { w, h, data: out };
}

// ---- the flight
const smooth = x => x * x * (3 - 2 * x);
function vnoise(seed, x) { const i = Math.floor(x), f = x - i, h = k => (hash(seed, k) & 0xffff) / 0xffff - .5; return h(i) + (h(i + 1) - h(i)) * smooth(f); }
// round 14.2: a tap near a flying bird STARTLES its flight: it flaps ~2.5x faster and flies away ~2.6x faster, the boost held
// ~1.3 s then easing back down over ~1.2 s (SCARE_S in all); same direction, same pair / trio / skein grouping, same count.
// ROUND 14.4: twice as hard again: flies ~4.7x (was 2.6x) and flaps ~4.6x (was 2.5x) the calm rate, held ~1.7 s, then eased out over ~1.3 s.
// And each startling tap has a 1-in-5 (KO_P) chance to KNOCK OUT the one bird nearest the tap: it tumbles dazed (quarter turns, pixel
// style, wings held) and falls off the bottom of the screen in a small grey puff + a drifting feather, while the rest of its flight
// startles and flies off. ?birdko=1 forces it, ?birdko=0 turns it off (tests / captures). A knocked-out bird still counts in its
// flight, so the 12-bird cap and the spawn rhythm are untouched; it is only dropped from the sky once it has fallen out of view.
export const SCARE_S = 3.0, SCARE_HOLD = 1.7, SCARE_SPEED = 3.7, SCARE_FLAP = 3.6, SCARE_R = 72;   // r in screen px (forgiving for a finger)
export const KO_P = .2, KO_G = 560, KO_SPIN = 9;   // chance per startling tap; fall (units/s^2); quarter turns per second
export const rollKnock = (rand = Math.random, p = KO_P) => p >= 1 ? true : p <= 0 ? false : rand() < p;
export const koP = q => q === '1' ? 1 : q === '0' ? 0 : KO_P;   // r in screen px (forgiving for a finger)
export class Flock {
  // mode 'few' | 'flock'; dir +1 = left to right; lane {y, slope}; poems [{x,y,w,h}] in scroll units
  constructor({ mode = 'few', dir = 1, lane = { y: 400, slope: 0 }, seed = 1, poems = [], lean = 0 } = {}) {
    const R = this.R = rng(hash('flock', seed)); this.seed = seed; this.mode = mode; this.dir = dir; this.lane = lane; this.poems = poems; this.t = 0; this.scare = 0;
    const n = mode === 'few' ? 2 + (R() < .5) : mode === 'small' ? 4 + Math.floor(R() * 4) : 8 + Math.floor(R() * 5);   // round 14.1: <= 12 a flight
    if (mode === 'small') this.mode = mode = 'few';                    // a small group flies like 'few' (loose), just more of them
    this.sp = mode === 'few' ? 15 + R() * 6 : mode === 'skein' ? 10.5 + R() * 3 : 11 + R() * 4;   // slot spacing (units)
    this.speed = mode === 'few' ? 64 + R() * 8 : 56 + R() * 8;       // units / s
    this.form = R() < .5 ? 0 : 1;                                     // 0 skein first, 1 V first; they morph back and forth
    this.lean = lean || (R() < .5 ? -1 : 1);                          // which way the skein trails (up / down the screen)
    this.lead = -40 - 10;                                             // leader position along x (from its entry edge)
    this.birds = Array.from({ length: n }, (_, i) => {
      const size = mode === 'few' ? (R() < .6 ? 2 : 1) : mode === 'skein' ? (R() < .1 ? 2 : R() < .45 ? 1 : 0) : (R() < .2 ? 2 : R() < .55 ? 1 : 0);
      const b = { i, size, variant: R() < .5 ? 0 : 1, jx: (R() - .5) * 1.2, jy: (R() - .5) * 1.4, ph: R(), hz: 2.1 + R() * 1.1,
        glide: 0, nextGlide: .6 + R() * 2.5, drift: R() * 6.28, frame: 0, x: 0, y: 0, vx: 0, vy: 0, faint: false };
      const s = this.slot(b, 0); b.x = s.x; b.y = s.y; b.vx = this.speed * dir; b.vy = this.speed * lane.slope * dir;
      return b;
    });
    this.birds.sort((a, b) => a.size - b.size);                        // far first (drawn behind)
  }
  laneY(x) { return this.lane.y + this.lane.slope * (x - SCROLL_W / 2); }
  slot(b, t) {   // where bird b wants to be: formation offset behind the leader, breathing over time
    const i = b.i, sp = this.sp * (1 + .22 * Math.sin(t * .55 + i * .3)), mix = .5 + .5 * Math.sin(t * .23 + this.form * Math.PI);
    let back, side;
    if (this.mode === 'few') { back = i * sp * (i > 3 ? .7 : 1) + b.jx * sp * .5; side = b.jy * sp * .7 * (i > 3 ? 1.4 : 1); }
    else {
      const k = Math.ceil(i / 2), arm = i % 2 ? 1 : -1;
      const vB = k * sp * .9, vS = arm * k * sp * .62;                                  // V
      const sB = i * sp * .62, sS = this.lean * i * sp * .38 + b.jy * sp * .9;         // skein: a loose diagonal line
      back = vB + (sB - vB) * mix + b.jx * sp * .6; side = vS + (sS - vS) * mix;
    }
    const lx = this.lead * (this.dir > 0 ? 1 : -1) + (this.dir > 0 ? 0 : SCROLL_W), x = lx - this.dir * back;
    return { x, y: this.laneY(x) + side + 5 * Math.sin(t * .4 + b.drift) };
  }
  get length() { return this.birds.length ? Math.max(...this.birds.map(b => b.i)) * this.sp + 60 : 0; }
  get done() { const m = 30; return this.birds.every(b => b.ko || (this.dir > 0 ? b.x > SCROLL_W + m : b.x < -m)); }
  knock(b) {   // dazed: a little hop up and back, then it tumbles down (no flapping)
    if (!b || b.ko) return false;
    b.ko = { t: 0 }; b.frame = 4; b.glide = 0; b.vx = b.vx * .35; b.vy = 55 + (this.R() - .5) * 20; return true;
  }
  startle() { this.scare = SCARE_S; return this; }
  get boost() { return this.scare > 0 ? Math.min(1, this.scare / (SCARE_S - SCARE_HOLD)) : 0; }   // 1 while held, then easing to 0
  step(dt) {
    this.t += dt; const t = this.t, B = this.birds, k = 5.5, c = 3.2, f = this.boost, sm = 1 + SCARE_SPEED * f, fm = 1 + SCARE_FLAP * f;
    if (this.scare > 0) this.scare = Math.max(0, this.scare - dt);
    this.lead += this.speed * sm * dt;
    const gx = vnoise(this.seed + 3, t * .35) * 18, gy = vnoise(this.seed + 5, t * .3) * 14;   // gusts (units/s^2)
    for (const b of B) {
      if (b.ko) { b.ko.t += dt; b.vy -= KO_G * dt; b.vx *= Math.max(0, 1 - 1.4 * dt); b.x += b.vx * dt; b.y += b.vy * dt; b.frame = 4; continue; }
      const s = this.slot(b, t), lvx = this.speed * sm * this.dir, lvy = lvx * this.lane.slope;
      let ax = k * (s.x - b.x) - c * (b.vx - lvx) + gx, ay = k * (s.y - b.y) - c * (b.vy - lvy) + gy * (.6 + .4 * b.size / 2);
      for (const o of B) if (o !== b && !o.ko) {                                  // separation: soft personal space
        const dx = b.x - o.x, dy = b.y - o.y, d2 = dx * dx + dy * dy, r = 9;
        if (d2 < r * r && d2 > 1e-4) { const d = Math.sqrt(d2), f = (r - d) / r * 60; ax += dx / d * f; ay += dy / d * f; }
      }
      b.faint = false;
      for (const p of this.poems) {                                      // poem boxes: slip above or below, never through
        const m = 10; if (b.x > p.x - m && b.x < p.x + p.w + m && b.y > p.y - m && b.y < p.y + p.h + m) {
          const up = b.y > p.y + p.h / 2; ay += (up ? 1 : -1) * 140; b.faint = b.x > p.x && b.x < p.x + p.w && b.y > p.y && b.y < p.y + p.h;
        }
      }
      b.vx += ax * dt; b.vy += ay * dt; b.x += b.vx * dt; b.y += b.vy * dt;
      // wings: flap at its own rate, now and then a glide (wings held), longer glides for the big ones
      b.nextGlide -= dt;
      if (b.glide > 0 && f > 0) b.glide = 0;                              // startled birds don't glide
      if (b.glide > 0) { b.glide -= dt; b.frame = 4; }
      else { b.ph = (b.ph + b.hz * fm * dt) % 1; b.frame = Math.floor(b.ph * 4); if (b.nextGlide <= 0) { b.glide = .4 + this.R() * (b.size === 2 ? 1.2 : .7); b.nextGlide = 1.5 + this.R() * 3.5; } }
    }
    return this;
  }
}

// ---- DOM: one canvas window that follows the viewport inside the scaled art layer
export function mountBirds(view, { clock, reduced = false, search = typeof location !== 'undefined' ? location.search : '' } = {}) {
  const q = new URLSearchParams(search).get('birds'), forced = ['few', 'small', 'flock', 'skein'].includes(q) ? q : null;
  const ctl = { flock: null, spawn: () => null, stop() {}, forced, enabled: false, ko: koP(new URLSearchParams(search).get('birdko')), rand: Math.random, fx: [], knocked: 0 };
  view.birds = ctl;
  if (q === 'off' || reduced) return ctl;
  ctl.enabled = true;
  const cv = document.createElement('canvas'); cv.className = 'birds';
  Object.assign(cv.style, { position: 'absolute', left: '0', width: SCROLL_W + 'px', imageRendering: 'pixelated', pointerEvents: 'none', zIndex: '50' });
  view.layer.append(cv);
  const g = cv.getContext('2d'), W = Math.round(SCROLL_W / BPX); cv.width = W;
  // sprites: [size][variant][frame][dir] -> canvas
  const spr = SIZES.map((S, size) => [0, 1].map(v => Array.from({ length: FRAMES }, (_, f) => [1, -1].map(dir => {
    const m = birdMask(size, f, v), c = document.createElement('canvas'); c.width = m.w; c.height = m.h;
    const x = c.getContext('2d'), im = x.createImageData(m.w, m.h);
    for (let yy = 0; yy < m.h; yy++) for (let xx = 0; xx < m.w; xx++) {
      const s = yy * m.w + (dir > 0 ? xx : m.w - 1 - xx), o = (yy * m.w + xx) * 4; im.data[o] = INK[0]; im.data[o + 1] = INK[1]; im.data[o + 2] = INK[2]; im.data[o + 3] = m.data[s] * S.alpha;
    }
    x.putImageData(im, 0, 0); return c;
  }))));
  // ROUND 14: more birds. A new flight every ~6-18 s (not 15-45), they may overlap; half go each way; now and then two
  // groups cross at once in opposite directions on different lanes. Kinds: a few (2-3), a small group (4-8), a flock
  // (15-30), sometimes a big skein (30-50). Still behind the poems' text, in open sky lanes (skyLanes), over the mist.
  const NEXT = () => 6 + Math.random() * 12, MAX_FLIGHTS = 2, MAX_FLIGHT = 12;
  let win = null, wait = forced ? 1 : 3 + Math.random() * 5, seed = (Math.random() * 1e9) | 0, n = 0;
  ctl.flocks = [];
  Object.defineProperty(ctl, 'flock', { get: () => ctl.flocks[0] ?? null, set: v => { if (!v) ctl.flocks.length = 0; else if (!ctl.flocks.includes(v)) ctl.flocks.push(v); }, configurable: true });
  const pickMode = (small = false) => { const r = Math.random() * (small ? .75 : 1); return r < .45 ? 'few' : r < .75 ? 'small' : Math.random() < .5 ? 'skein' : 'flock'; };   // small: no skein (another flight is up)
  const inAir = () => ctl.flocks.reduce((s, F) => s + F.birds.length, 0);
  const viewWin = () => {   // visible window in scroll units (y up from the scroll bottom)
    const r = view.host.getBoundingClientRect(), s = view.host.clientWidth / SCROLL_W || 1, H = view.composer.height;
    return { lo: H - (innerHeight - r.top) / s, hi: H + r.top / s, H };
  };
  const place = v => {
    const m = 240, lo = Math.floor((v.lo - m) / 3) * 3, hi = Math.ceil((v.hi + m) / 3) * 3;
    win = { lo, hi }; cv.height = Math.round((hi - lo) / BPX);
    Object.assign(cv.style, { bottom: lo + 'px', height: (hi - lo) + 'px' });
  };
  const busy = () => document.hidden || !!(globalThis.HB?.compose?.opened);
  ctl.spawn = (mode = forced || pickMode(), { dir = Math.random() < .5 ? 1 : -1, avoid = null } = {}) => {
    const v = viewWin(), big = mode !== 'few' && mode !== 'small', m = big ? 150 : 80, top = Math.min(v.hi - m, v.H - 100);   // the whole skein stays on screen, clear of the header
    let lanes = skyLanes(view.art, view.composer.poems, Math.max(0, v.lo + m), top);
    const busyY = ctl.flocks.map(F => F.lane.y).concat(avoid ?? []);
    const free = lanes.filter(l => busyY.every(y => Math.abs(l.y - y) > 90)); if (free.length) lanes = free;   // a second flight takes another lane
    if (!lanes.length) return null;
    const pickFrom = lanes.slice(0, 4), lane = pickFrom[Math.floor(Math.random() * pickFrom.length)];
    lane.slope *= dir;                                                        // lanes are symmetric; rise into the flight
    const F = new Flock({ mode, dir, lane: { y: lane.y, slope: lane.slope }, seed: seed + n++, poems: view.composer.poems, lean: lane.y > (v.lo + v.hi) / 2 ? -1 : 1 });
    if (!win || !ctl.flocks.length) place(v);
    ctl.flocks.push(F); return F;
  };
  // two groups at once, opposite ways (captures / tests too)
  ctl.spawnPair = (a = pickMode(), b2 = Math.random() < .6 ? 'few' : 'small') => { const d = Math.random() < .5 ? 1 : -1, A = ctl.spawn(a, { dir: d }), B = ctl.spawn(b2, { dir: -d, avoid: A ? [A.lane.y] : null }); return [A, B].filter(Boolean); };
  const draw = () => {
    g.clearRect(0, 0, cv.width, cv.height);
    for (const F of ctl.flocks) for (const b of F.birds) {
      const c = spr[b.size][b.variant][b.frame][F.dir > 0 ? 0 : 1];
      g.globalAlpha = b.faint ? .35 : 1;
      const px = Math.round(b.x / BPX), py = Math.round((win.hi - b.y) / BPX);
      if (b.ko) { g.save(); g.translate(px, py); g.rotate(Math.floor(b.ko.t * KO_SPIN) % 4 * Math.PI / 2); g.drawImage(c, -Math.round(c.width / 2), -Math.round(c.height / 2)); g.restore(); }   // quarter turns only: crisp pixels
      else g.drawImage(c, px - Math.round(c.width / 2), py - Math.round(c.height / 2));
    }
    g.globalAlpha = 1;
    for (const f of ctl.fx) {   // the knock-out puff (chunky grey squares) and feather (a drifting 3-pixel diagonal)
      const px = Math.round(f.x / BPX), py = Math.round((win.hi - f.y) / BPX), u = f.t / f.life;
      if (f.k === 'puff') { const z = u < .35 ? 2 : 1; g.fillStyle = f.c; g.globalAlpha = 1 - u * .7; g.fillRect(px - z, py - z, z * 2, z * 2); }
      else { g.fillStyle = 'rgb(26,24,29)'; g.globalAlpha = 1 - u * .6; const d = Math.floor(f.t * 6) % 2 ? 1 : -1; g.fillRect(px, py, 2, 1); g.fillRect(px + 2, py + d, 2, 1); g.fillRect(px + 4, py + 2 * d, 1, 1); }
    }
    g.globalAlpha = 1;
  };
  const off = clock.onTick(dt => {
    if (busy()) return;
    if ((wait -= dt) <= 0) {
      wait = NEXT();
      if (ctl.flocks.length < MAX_FLIGHTS) { if (!forced && Math.random() < .2 && ctl.flocks.length === 0) ctl.spawnPair(); else ctl.spawn(forced || pickMode(inAir() > 7)); }
    }
    if (!ctl.flocks.length && !ctl.fx.length) return;
    const v = viewWin();
    for (const f of ctl.fx) { f.t += dt; f.x += f.vx * dt; f.y += f.vy * dt; if (f.k === 'puff') { f.vx *= .93; f.vy *= .93; } else { f.vy = Math.max(f.vy - 90 * dt, -26); f.vx = Math.sin(f.t * 5) * 14; } }
    ctl.fx = ctl.fx.filter(f => f.t < f.life);
    for (const F of ctl.flocks) F.birds = F.birds.filter(b => !(b.ko && b.y < v.lo - 80));   // a knocked-out bird that has fallen out of view leaves the sky
    for (let i = ctl.flocks.length - 1; i >= 0; i--) { const F = ctl.flocks[i]; if (!F.birds.length || F.birds.every(b => b.y < v.lo - 400 || b.y > v.hi + 400) || F.done) ctl.flocks.splice(i, 1); }   // gone, or scrolled far away
    if (!ctl.flocks.length) { draw(); return; }
    if (v.lo < win.lo + 40 || v.hi > win.hi - 40) place(v);
    for (const F of ctl.flocks) F.step(dt);
    draw();
  });
  // a tap near a flying bird startles its flight. Passive listeners only (they never cancel or block anything, never in the way of a tap on
  // the UI, the button, Inky or a poem, nor of scrolling): a pointerdown + a pointerup that barely moved = a tap.
  ctl.startleAt = (cx, cy, r = SCARE_R) => {
    if (busy() || !win) return 0;
    const hr = view.host.getBoundingClientRect(), s = view.host.clientWidth / SCROLL_W || 1, H = view.composer.height; let n = 0, near = null, nd = Infinity, nF = null;
    for (const F of ctl.flocks) {
      let hit = false;
      for (const b of F.birds) { if (b.ko) continue; const d = Math.hypot(hr.left + b.x * s - cx, hr.top + (H - b.y) * s - cy); if (d <= r) { hit = true; if (d < nd) { nd = d; near = b; nF = F; } } }
      if (hit) { F.startle(); n++; }
    }
    ctl.lastKO = false;
    if (near && rollKnock(ctl.rand, ctl.ko) && nF.knock(near)) {   // 1 in 5: the bird nearest the tap is knocked out of the sky
      ctl.lastKO = true; ctl.knocked++;
      const R = nF.R, gray = ['rgb(150,146,152)', 'rgb(196,192,196)', 'rgb(96,92,100)', 'rgb(224,220,222)'];
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + R(), v = 38 + R() * 30; ctl.fx.push({ k: 'puff', x: near.x, y: near.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: .45 + R() * .2, c: gray[i % 4] }); }
      for (let i = 0; i < 2; i++) ctl.fx.push({ k: 'feather', x: near.x + (R() - .5) * 6, y: near.y, vx: 0, vy: 10, t: 0, life: 1.5 + R() * .5 });
    }
    return n;
  };
  let down = null;
  const pd = e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; }, UI = 'button, a, input, textarea, select, label, summary, [role="button"], [tabindex], #fab, #compose, .noren-head',
    pu = e => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12 && performance.now() - down.t < 600 && !(e.target?.closest && e.target.closest(UI))) ctl.startleAt(e.clientX, e.clientY); down = null; };   // never on a tap that lands on the UI
  addEventListener('pointerdown', pd, { passive: true, capture: true }); addEventListener('pointerup', pu, { passive: true, capture: true });
  ctl.stop = () => { off(); cv.remove(); ctl.flocks.length = 0; removeEventListener('pointerdown', pd, true); removeEventListener('pointerup', pu, true); };
  return ctl;
}
