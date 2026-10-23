// ROLLING SUMI MIST (round 14). Slow banks of fog drifting across the painted scroll, IN FRONT of the background ink
// (mountains, waterfalls, trees) and BEHIND the birds and the poems, on the background's own pixel grid (130 art px
// across, 3 scroll units per px) and dithered (4x4 Bayer) in paper colours, so it reads as mist veiling the ink.
// Three kinds, anchored to places on the scroll (they scroll with it) and drifting left or right on their own:
//   fog     wide soft dithered bands, their edge breaking up with noise
//   cumulus rolling billows: domain-warped (noise-advected) fbm that churns slowly, a faint grey ink-wash underside
//   streak  thin long wisps, 1-3 px tall
// Extremely subtle (at most ~half the pixels of a bank's core).
// (Round 14.1, superseded by 14.2 below: the mist was a TINGE OFF THE PAPER, not white/cream highlights: one paper-toned colour (a hair off the
// paper's own average, assets/paper.png = 244,236,218) laid at LOW opacity, and the opacity follows the density
// (MIST_A0 at the faint fringe -> MIST_A1 in a bank's core), so every bank feathers out into the paper with no hard
// edge; over open paper it all but disappears, over the ink it softly veils it - a hint of movement, not a cloud
// drawn on top. The faint underside of a billow is the same tinge a shade darker, fainter still. Cost: the density is evaluated on a 2x2 px grid, only
// in rows near a bank, and redrawn at 30 Hz (the drift is a few px per second); reduced motion: drawn still (redrawn
// only when the window moves). Paused while compose is open or the tab is hidden. HB.view.mist = { banks, draws, ... }.
import { SCROLL_W, AW, PX } from './scroll-engine2.js';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + .5) / 16);
// Round 14.2: 14.1 was invisible (a paper-toned veil at <= .26 over bare paper shows nothing, and the ink under it barely
// changed). The COLOUR stays the paper's own (a hair under it: never lighter, never white, never darker/greyer); what is
// raised is the OPACITY (core ~.62, fringe ~.05, still feathering to ~0) so the ink art under a bank visibly fades into
// paper as it passes and reappears after it, and the DRIFT (MIST_SPEED x2: the banks, and their churn, move twice as fast).
export const PAPER = [244, 236, 218], MIST_TINT = [243, 235, 217], MIST_SHADE = [236, 228, 211];   // the paper's own tone, a hair under it
// Round 14.4: still not noticed on the phone: BIGGER banks (x1.5 taller, longer billows), MORE of them (one per 230 units, was 360),
// DENSER (core opacity .86, up to ~85% of a core's pixels lit) and FASTER (3.5x the 14.1 drift, was 2x): about 40% of the
// background is under a veil at any time, so the mountains and waterfalls visibly fade into the paper and back as banks pass.
// Round 14.4b: banks now PASS BY, in BOTH directions. Every bank is anchored to a row of the scroll but travels in SCREEN x only
// (so scrolling, either way, never changes the direction) and keeps ONE constant direction for its life (dir = +1 left to right /
// -1 right to left, ~50/50 by its seed): it enters off one edge, crosses the 130-art-px width in MIST_CROSS_S seconds (12-20 s
// per bank, each its own speed), leaves off the other, then there is a GAP of empty travel before its next pass.
// It fades in over the entry edge and out over the exit edge (MIST_EDGE art px) as well as feathering by its own soft sides.
export const MIST_SPEED = 1;      // clock seconds -> mist seconds (the drift is now set per bank by MIST_CROSS_S)
export const MIST_CROSS_S = [12, 20], MIST_EDGE = 12;
export const MIST_A0 = .08, MIST_A1 = .86, MIST_SHADE_A = .3;   // opacity at the fringe .. the core; the underside
// the opacity of a lit mist pixel at density d (0..MIST_MAX): eased so the fringe fades into the paper
export const mistAlpha = d => { const q = Math.max(0, Math.min(1, d / MIST_MAX)); return MIST_A0 + (MIST_A1 - MIST_A0) * q * q * (3 - 2 * q); };
export const MIST_MAX = .85, MIST_EVERY = 95, MIST_HZ = 16;
const hash2 = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y, s) => vnoise(x, y, s) * .55 + vnoise(x * 2.03, y * 2.03, s + 7) * .3 + vnoise(x * 4.1, y * 4.1, s + 13) * .15;
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// the banks along the scroll (deterministic): y in scroll units from the bottom, half-height hh, half-width wb (art px),
// speed v (art px / s, > 0) and direction dir (+1 / -1), the cycle P = AW + 2 wb + gap in art px, and a phase so banks aren't in step
export function mistBanks(H, seed = 31) {
  const out = [];
  for (let k = 0; (k + .5) * MIST_EVERY < H + MIST_EVERY; k++) {
    const r = i => hash2(k, i, seed), kind = r(1) < .4 ? 'fog' : r(1) < .75 ? 'cumulus' : 'streak';
    const y = (k + .5) * MIST_EVERY + (r(2) - .5) * MIST_EVERY * .5;
    const hh = kind === 'fog' ? 70 + r(3) * 50 : kind === 'cumulus' ? 62 + r(3) * 45 : 6 + r(3) * 5;
    out.push(bank(k, kind, y, hh, (k * 97 + seed) % 1000, r(4), r(5), r(6), r(7), kind === 'streak' ? 1.25 : 1, r(13) < .5 ? 1 : -1));
    if (kind === 'streak' && r(6) < .6) out.push(bank(k, kind, y + 14 + r(7) * 10, 3 + r(8) * 3, (k * 131 + seed) % 1000, r(9), r(10), r(11), r(12), 1.5, r(14) < .5 ? 1 : -1));   // a second wisp, a touch faster
  }
  return out;
}
function bank(k, kind, y, hh, s, ra, rb, rc, rd, fast, dir) {
  const wb = kind === 'fog' ? 120 + ra * 45 : kind === 'cumulus' ? 100 + ra * 40 : 50 + ra * 30;
  const cross = MIST_CROSS_S[0] + rb * (MIST_CROSS_S[1] - MIST_CROSS_S[0]), v = AW / cross * fast;       // crosses the width in `cross` s (a wisp a bit quicker)
  const gap = MIST_GAP[0] + rc * (MIST_GAP[1] - MIST_GAP[0]), P = AW + 2 * wb + gap;
  return { k, kind, y, hh, wb, v, dir, gap, P, ph: rd * P, s };
}
export const MIST_GAP = [0, 30];   // art px of empty travel between one pass and the next
// the bank's centre in art px at time t: from off one edge to off the other (-wb .. AW + wb, or back), then the gap, then round again; it
// moves in ONE direction (dir) always, and only jumps back to its entry edge after it has left and rested
export const mistBankX = (B, t) => { const q = ((B.ph + B.v * t) % B.P + B.P) % B.P; return B.dir > 0 ? q - B.wb : AW + B.wb - q; };
// A bank's SHAPE (its own texture, in its own frame, moving with it) is noise evaluated once per bank, lazily, on a coarse grid
// (GS art px x GSY units) and interpolated: the per-frame work is then a lookup + the bank's lobe, not fbm per cell (round 14.4b: this is what
// keeps 15+ overlapping banks at ~1 ms instead of ~10). Everything that is smooth (the vertical profile, the thresholded noise) is baked in.
const GS = 4, GSY = 12;
function baseDensity(B, x0, y) {            // 0..MIST_MAX: the bank's texture at offset x0 (art px from its centre), height y (units), without the pass-by lobe
  const dy = (y - B.y) / B.hh;
  if (B.kind === 'fog') { const prof = Math.exp(-dy * dy), n = fbm(x0 * .03, y * .014, B.s); return prof * sstep(.1, .5, n) * MIST_MAX; }
  if (B.kind === 'streak') { const prof = Math.exp(-dy * dy * 1.4), n = fbm(x0 * .016, B.s * .1, B.s); return prof * sstep(.28, .7, n) * MIST_MAX * .9; }
  const w = (fbm(x0 * .03, y * .03, B.s + 3) - .5) * 14, n = fbm((x0 + w) * .034, y * .036, B.s);   // cumulus: billowing
  const prof = Math.exp(-dy * dy * 1.3); return sstep(0, 1, (n * 1.8 * prof - .22) * 1.15) * MIST_MAX;
}
export function bankGrid(B) {
  if (B.g) return B.g;
  const gw = Math.ceil(2 * B.wb * 1.7 / GS) + 2, gh = Math.ceil(2 * B.hh * 2.4 / GSY) + 2, d = new Float32Array(gw * gh), gx0 = Math.floor(gw / 2), gy0 = Math.floor(gh / 2);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) d[j * gw + i] = baseDensity(B, (i - gx0) * GS, B.y + (j - gy0) * GSY);
  return (B.g = { gw, gh, d, gx0, gy0 });
}
const sampleGrid = (G, x0, y, B) => {      // bilinear
  const fx = x0 / GS + G.gx0, fy = (y - B.y) / GSY + G.gy0; if (fx < 0 || fy < 0 || fx >= G.gw - 1 || fy >= G.gh - 1) return 0;
  const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, o = j * G.gw + i, d = G.d;
  return d[o] * (1 - u) * (1 - v) + d[o + 1] * u * (1 - v) + d[o + G.gw] * (1 - u) * v + d[o + G.gw + 1] * u * v;
};
const passEnv = (B, x, cx) => { const u = (x - cx) / B.wb; return u > 1.7 || u < -1.7 ? 0 : Math.exp(-1.25 * u * u * u * u) * sstep(0, MIST_EDGE, x) * sstep(0, MIST_EDGE, AW - x); };   // flat core, soft sides; fades in over the entry edge, out over the exit edge
// density 0..MIST_MAX of bank B at art px (x, py-units y) and time t (s)
export function mistDensity(B, x, y, t) {
  const cx = mistBankX(B, t), e = passEnv(B, x, cx); if (e <= 0 || Math.abs(y - B.y) > B.hh * 2.4) return 0;
  return e * sampleGrid(bankGrid(B), x - cx, y, B);
}

export function mountMist(view, { clock, reduced = false } = {}) {
  const ctl = { enabled: false, banks: [], draws: 0, ms: 0 };
  view.mist = ctl;
  if (typeof document === 'undefined') return ctl;
  ctl.enabled = true;
  const cv = document.createElement('canvas'); cv.className = 'mist'; cv.setAttribute('aria-hidden', 'true');
  Object.assign(cv.style, { position: 'absolute', left: '0', width: SCROLL_W + 'px', imageRendering: 'pixelated', pointerEvents: 'none', zIndex: '20' });   // over the ink chunks (0), under birds (50) and poems (100)
  view.layer.append(cv);
  const g = cv.getContext('2d'); cv.width = AW;
  let win = null, img = null, acc = 1, t = 0, key = '', built = 0; const lobeBuf = new Float32Array(AW + 2);
  const viewWin = () => { const r = view.host.getBoundingClientRect(), s = view.host.clientWidth / SCROLL_W || 1, H = view.composer.height; return { lo: H - (innerHeight - r.top) / s, hi: H + r.top / s, H }; };
  const place = v => {
    const m = 180, lo = Math.floor((v.lo - m) / PX) * PX, hi = Math.ceil((v.hi + m) / PX) * PX;
    win = { lo, hi }; cv.height = Math.round((hi - lo) / PX); img = g.createImageData(AW, cv.height);
    Object.assign(cv.style, { bottom: lo + 'px', height: (hi - lo) + 'px' });
  };
  const draw = () => {
    const t0 = performance.now(), D = img.data, Hc = cv.height; D.fill(0); built = 0;
    if (ctl.banks.length * MIST_EVERY < view.composer.height || !ctl.banks.length) ctl.banks = mistBanks(view.composer.height);
    for (const B of ctl.banks) {
      const top = B.y + B.hh * 2.4, bot = B.y - B.hh * 2.4; if (top < win.lo || bot > win.hi) continue;
      const r0 = Math.max(0, Math.floor((win.hi - top) / PX) & ~1), r1 = Math.min(Hc - 1, Math.ceil((win.hi - bot) / PX));
      const cxb = mistBankX(B, t), xa = Math.max(0, Math.floor(cxb - B.wb * 1.7) & ~1), xb = Math.min(AW, Math.ceil(cxb + B.wb * 1.7)); if (xb <= 0 || xa >= AW) continue;   // off screen this pass: free
      if (!B.g && built >= 2) continue; const G = bankGrid(B); if (!G.fresh) { G.fresh = 1; built++; }   // build at most 2 grids a frame (a bank a frame late is invisible: it enters from off screen)
      const LE = lobeBuf; for (let x = xa; x < xb; x++) LE[x] = passEnv(B, x + .5, cxb);
      for (let r = r0; r <= r1; r += 2) {
        const y = win.hi - (r + 1) * PX;
        for (let x = xa; x < xb; x += 2) {
          const le = LE[x + 1]; if (le < .03) continue;
          const d = le * sampleGrid(G, x + 1 - cxb, y, B); if (d < .03) continue;
          for (let j = 0; j < 2 && r + j < Hc; j++) for (let i = 0; i < 2; i++) {
            const px = x + i, py = r + j, th = BAYER[(py & 3) * 4 + (px & 3)], o = (py * AW + px) * 4;
            let c = null, a = 0;
            if (d > th) { c = MIST_TINT; a = mistAlpha(d); }
            else if (B.kind === 'cumulus' && d > th * .55 && y < B.y && th > .6) { c = MIST_SHADE; a = MIST_SHADE_A * mistAlpha(d) / MIST_A1; }   // the faint underside of a billow
            if (c && D[o + 3] === 0) { D[o] = c[0]; D[o + 1] = c[1]; D[o + 2] = c[2]; D[o + 3] = Math.max(1, Math.round(a * 255)); }
          }
        }
      }
    }
    g.putImageData(img, 0, 0); ctl.draws++; ctl.ms = performance.now() - t0;
  };
  ctl.draw = () => { const v = viewWin(); if (!win || v.lo < win.lo + 30 || v.hi > win.hi - 30) place(v); draw(); };
  ctl.time = () => t;
  clock.onTick(dt => {
    if (document.hidden || globalThis.HB?.compose?.opened) return;
    const v = viewWin(), moved = !win || v.lo < win.lo + 30 || v.hi > win.hi - 30;
    if (moved) { place(v); key = ''; }
    if (!reduced) { t += dt * MIST_SPEED; acc += dt; }
    const k = reduced ? (win.lo + ':' + win.hi + ':' + view.composer.height) : '';
    if (reduced ? k !== key : acc >= 1 / MIST_HZ || moved) { acc = 0; key = k; draw(); }
  });
  return ctl;
}
