// ROLLING SUMI MIST (round 14). Slow banks of fog drifting across the painted scroll, IN FRONT of the background ink
// (mountains, waterfalls, trees) and BEHIND the birds and the poems, on the background's own pixel grid (130 art px
// across, 3 scroll units per px) and dithered (4x4 Bayer) in paper colours, so it reads as mist veiling the ink.
// Three kinds, anchored to places on the scroll (they scroll with it) and drifting left or right on their own:
//   fog     wide soft dithered bands, their edge breaking up with noise
//   cumulus rolling billows: domain-warped (noise-advected) fbm that churns slowly, a faint grey ink-wash underside
//   streak  thin long wisps, 1-3 px tall
// Extremely subtle (at most ~half the pixels of a bank's core). Cost: the density is evaluated on a 2x2 px grid, only
// in rows near a bank, and redrawn at 30 Hz (the drift is a few px per second); reduced motion: drawn still (redrawn
// only when the window moves). Paused while compose is open or the tab is hidden. HB.view.mist = { banks, draws, ... }.
import { SCROLL_W, AW, PX } from './scroll-engine2.js';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + .5) / 16);
const FOG = [244, 236, 218], FOG_HI = [248, 243, 230], WASH = [226, 219, 205];
export const MIST_MAX = .55, MIST_EVERY = 360, MIST_HZ = 30;
const hash2 = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y, s) => vnoise(x, y, s) * .55 + vnoise(x * 2.03, y * 2.03, s + 7) * .3 + vnoise(x * 4.1, y * 4.1, s + 13) * .15;
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// the banks along the scroll (deterministic): y in scroll units from the bottom, half-height hh, drift vx (art px / s)
export function mistBanks(H, seed = 31) {
  const out = [];
  for (let k = 0; (k + .5) * MIST_EVERY < H + MIST_EVERY; k++) {
    const r = i => hash2(k, i, seed), kind = r(1) < .4 ? 'fog' : r(1) < .75 ? 'cumulus' : 'streak';
    const y = (k + .5) * MIST_EVERY + (r(2) - .5) * MIST_EVERY * .5;
    const hh = kind === 'fog' ? 45 + r(3) * 35 : kind === 'cumulus' ? 40 + r(3) * 30 : 5 + r(3) * 4;
    const vx = (r(4) < .5 ? -1 : 1) * (kind === 'streak' ? 2.2 + r(5) * 1.6 : 1 + r(5) * 1.4);
    out.push({ k, kind, y, hh, vx, s: (k * 97 + seed) % 1000 });
    if (kind === 'streak' && r(6) < .6) out.push({ k, kind, y: y + 14 + r(7) * 10, hh: 3 + r(8) * 3, vx: vx * 1.3, s: (k * 131 + seed) % 1000 });   // a second wisp
  }
  return out;
}
// density 0..MIST_MAX of bank B at art px (x, py-units y) and time t (s)
export function mistDensity(B, x, y, t) {
  const dy = (y - B.y) / B.hh, x0 = x - B.vx * t;
  if (Math.abs(dy) > 2.4) return 0;
  if (B.kind === 'fog') { const prof = Math.exp(-dy * dy), n = fbm(x0 * .045, y * .02 + t * .01, B.s); return prof * sstep(.38, .72, n) * MIST_MAX; }
  if (B.kind === 'streak') { const prof = Math.exp(-dy * dy * 1.4), n = fbm(x0 * .022, B.s * .1 + t * .02, B.s); return prof * sstep(.42, .7, n) * MIST_MAX * .9; }
  const w = (fbm(x * .03 + t * .04, y * .03, B.s + 3) - .5) * 14, n = fbm((x0 + w) * .05, y * .05 + t * .035, B.s);   // cumulus: billowing
  const prof = Math.exp(-dy * dy * 1.3); return Math.max(0, Math.min(1, (n * 1.3 * prof - .36) * 2.4)) * MIST_MAX;
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
  let win = null, img = null, acc = 1, t = 0, key = '';
  const viewWin = () => { const r = view.host.getBoundingClientRect(), s = view.host.clientWidth / SCROLL_W || 1, H = view.composer.height; return { lo: H - (innerHeight - r.top) / s, hi: H + r.top / s, H }; };
  const place = v => {
    const m = 180, lo = Math.floor((v.lo - m) / PX) * PX, hi = Math.ceil((v.hi + m) / PX) * PX;
    win = { lo, hi }; cv.height = Math.round((hi - lo) / PX); img = g.createImageData(AW, cv.height);
    Object.assign(cv.style, { bottom: lo + 'px', height: (hi - lo) + 'px' });
  };
  const draw = () => {
    const t0 = performance.now(), D = img.data, Hc = cv.height; D.fill(0);
    if (ctl.banks.length * MIST_EVERY < view.composer.height || !ctl.banks.length) ctl.banks = mistBanks(view.composer.height);
    for (const B of ctl.banks) {
      const top = B.y + B.hh * 2.4, bot = B.y - B.hh * 2.4; if (top < win.lo || bot > win.hi) continue;
      const r0 = Math.max(0, Math.floor((win.hi - top) / PX) & ~1), r1 = Math.min(Hc - 1, Math.ceil((win.hi - bot) / PX));
      for (let r = r0; r <= r1; r += 2) {
        const y = win.hi - (r + 1) * PX;
        for (let x = 0; x < AW; x += 2) {
          const d = mistDensity(B, x + 1, y, t); if (d < .03) continue;
          for (let j = 0; j < 2 && r + j < Hc; j++) for (let i = 0; i < 2; i++) {
            const px = x + i, py = r + j, th = BAYER[(py & 3) * 4 + (px & 3)], o = (py * AW + px) * 4;
            let c = null;
            if (d > th) c = (px + py) & 1 ? FOG : FOG_HI;
            else if (B.kind === 'cumulus' && d > th * .55 && y < B.y && th > .6) c = WASH;   // the faint grey underside of a billow
            if (c && D[o + 3] === 0) { D[o] = c[0]; D[o + 1] = c[1]; D[o + 2] = c[2]; D[o + 3] = 255; }
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
    if (!reduced) { t += dt; acc += dt; }
    const k = reduced ? (win.lo + ':' + win.hi + ':' + view.composer.height) : '';
    if (reduced ? k !== key : acc >= 1 / MIST_HZ || moved) { acc = 0; key = k; draw(); }
  });
  return ctl;
}
