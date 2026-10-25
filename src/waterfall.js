// WATERFALL SHIMMER (round 14.1). Only the waterfall art (falls, ribbonfalls, cascade, cliffalls and their _m sizes)
// gets a whisper of motion: sparse, low-contrast pixel streaks sliding DOWN inside the falling water, like dithered
// sparkle in a fall. Nothing else in the sprite moves.
//   mask   per waterfall, precomputed once its rows are final, from the FINAL ink field (after every later stamp and
//          mist bank): a pixel is water when the sprite covers it, it is pale (the white of the fall), it has darker
//          rock close on BOTH sides in the same row, and it belongs to a tall vertical run of such pixels. So the
//          shimmer never lands on rock, trees, sky or mist (a tree over the fall is dark; mist kills the flanks).
//   streaks per water column a few short streaks (2-3 px) slide down at 9-15 art px/s on a per-column period, so
//          the loop is seamless and only a few pixels change per frame. Light streaks are paper tone, an
//          occasional dark one is ink, both at low opacity, on the background art grid (130 art px, nearest).
// Drawn on one canvas window over the viewport (like the mist: zIndex 10, over the ink, under the mist, birds and
// poems), only for waterfalls in that window, at 30 Hz. Reduced motion: nothing is drawn (static art).
import { SCROLL_W, AW, PX } from './scroll-engine2.js';

export const WATER_RE = /^(falls|ribbonfalls|cascade|cliffalls)(_m)?$/;
export const SHIM_HZ = 30, SHIM_LIGHT = [248, 242, 228], SHIM_DARK = [26, 24, 29], SHIM_LIGHT_A = .42, SHIM_DARK_A = .16;
const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// HAND-MARKED streams per waterfall sprite (sprite px of the full-size sprite, top row = 0): the fall's path as
// [y, x0, x1] keys, linearly interpolated; the _m sizes are the same paths scaled. Inside a stream band, a pixel is
// water when it is pale (the white of the fall) and in a vertical run of pale pixels, so rock ledges crossing the
// band, and anything outside it, never shimmer.
export const STREAMS = {
  falls: [[[52, 69, 77], [90, 65, 75], [120, 62, 72], [142, 60, 70]]],
  ribbonfalls: [[[19, 36, 41], [60, 36, 41], [100, 36, 41]]],
  cascade: [[[14, 51, 62], [40, 52, 62], [62, 52, 61], [100, 50, 60]], [[70, 44, 49], [84, 44, 49]]],
  cliffalls: [[[42, 37, 44], [60, 41, 48], [82, 46, 52], [90, 50, 56], [112, 54, 61]]],
};
const FULL = { falls: [116, 219], ribbonfalls: [74, 139], cascade: [104, 147], cliffalls: [104, 156] };
const spriteCache = new Map();
export function spriteWater(s, name, { pale = .4, run = 4 } = {}) {
  const key = name; if (spriteCache.has(key)) return spriteCache.get(key);
  const base = name.replace(/_m$/, ''), paths = STREAMS[base] || [], [FW, FH] = FULL[base] || [s.w, s.h], kx = s.w / FW, ky = s.h / FH;
  const ink = (x, y) => s.a[y * s.w + x] * s.d[y * s.w + x], band = new Uint8Array(s.w * s.h), out = [];
  for (const P of paths) for (let k = 0; k + 1 < P.length; k++) {
    const [ya, a0, a1] = P[k], [yb, b0, b1] = P[k + 1];
    for (let y = Math.round(ya * ky); y <= Math.round(yb * ky) && y < s.h; y++) {
      const f = (y / ky - ya) / Math.max(1, yb - ya), x0 = Math.floor((a0 + (b0 - a0) * f) * kx), x1 = Math.ceil((a1 + (b1 - a1) * f) * kx);
      for (let x = Math.max(0, x0); x <= Math.min(s.w - 1, x1); x++) band[y * s.w + x] = 1;
    }
  }
  for (let x = 0; x < s.w; x++) for (let y = 0; y < s.h;) {
    const ok = yy => yy < s.h && band[yy * s.w + x] && s.a[yy * s.w + x] >= .6 && ink(x, yy) <= pale;
    if (!ok(y)) { y++; continue; } let e = y; while (ok(e + 1)) e++;
    if (e - y + 1 >= run) for (let yy = y; yy <= e; yy++) out.push([x, yy, ink(x, yy)]);
    y = e + 1;
  }
  spriteCache.set(key, out); return out;
}
// the water mask of waterfall item `it` in ArtField `field` (art px; r = rows from the bottom): the sprite's water,
// kept only where the FINAL field still shows it: not darkened by a later stamp (a tree over the fall), and still
// with darker ink beside it (a mist bank that washed the fall out removes it)
export function waterMask(field, it) {
  const s = field.lib[it.name], t = it.tone, xs = [], rs = [];
  for (const [sx, sy, c] of spriteWater(s, it.name)) {
    const x = it.x + (it.flip ? s.w - 1 - sx : sx), r = it.base + (s.h - 1 - sy); if (x < 1 || x >= AW - 1) continue;
    const v = field.ink(x, r); if (v > c * t + .08) continue;           // darkened by a later stamp (a tree)
    let L = false, R = false, need = .07 * t;                         // washed out by a mist bank: no rock beside it
    for (let k = 1; k <= 9 && !(L && R); k++) { if (!L && field.ink(x - k, r) > v + need) L = true; if (!R && field.ink(x + k, r) > v + need) R = true; }
    if (L && R) { xs.push(x); rs.push(r); }
  }
  return { x: Int16Array.from(xs), r: Int16Array.from(rs), n: xs.length };
}
// is the water pixel (x, r) lit at time t? 0 = no, 1 = a light streak, 2 = a dark one (pure: tested)
export function shimmerAt(x, r, t) {
  const per = 13 + Math.floor(hash(x, 7) * 9), sp = 9 + hash(x, 3) * 6, off = hash(x, 11) * per;
  const ph = ((r + t * sp + off) % per + per) % per, len = 2 + (hash(x, 5) < .5 ? 1 : 0);
  if (ph < len) return hash(x, Math.floor((r + t * sp + off) / per)) < .82 ? 1 : 2;
  return 0;
}

export function mountWaterfalls(view, { clock, reduced = false } = {}) {
  const ctl = { enabled: false, falls: [], draws: 0, ms: 0, lit: 0 };
  view.waterfalls = ctl;
  if (typeof document === 'undefined' || reduced) return ctl;               // reduced motion: the falls stay static
  ctl.enabled = true;
  const cv = document.createElement('canvas'); cv.className = 'shimmer'; cv.setAttribute('aria-hidden', 'true');
  Object.assign(cv.style, { position: 'absolute', left: '0', width: SCROLL_W + 'px', imageRendering: 'pixelated', pointerEvents: 'none', zIndex: '10' });   // over the ink (0), under the mist (20), birds (50), poems (100)
  view.layer.append(cv);
  const g = cv.getContext('2d'); cv.width = AW;
  let win = null, img = null, acc = 1, t = 0, blank = true;
  const seen = new Map();                                                    // item -> mask (once its rows are final)
  const viewWin = () => { const r = view.host.getBoundingClientRect(), s = view.host.clientWidth / SCROLL_W || 1, H = view.composer.height; return { lo: H - (innerHeight - r.top) / s, hi: H + r.top / s }; };
  const place = v => { const m = 120, lo = Math.floor((v.lo - m) / PX) * PX, hi = Math.ceil((v.hi + m) / PX) * PX; win = { lo, hi }; cv.height = Math.round((hi - lo) / PX); img = g.createImageData(AW, cv.height); Object.assign(cv.style, { bottom: lo + 'px', height: (hi - lo) + 'px' }); blank = true; };
  const inWin = it => { const y0 = it.base * PX, y1 = (it.base + it.h) * PX; return y1 > win.lo && y0 < win.hi; };
  const draw = () => {
    const t0 = performance.now(), A = view.art, rowTop = win.hi / PX, Hc = cv.height;
    const vis = [];
    for (const it of A.items) if (WATER_RE.test(it.name) && inWin(it)) {
      let m = seen.get(it); if (!m) { if (it.base + it.h > A.top) continue; m = waterMask(A, it); seen.set(it, m); }
      if (m.n) vis.push(m);
    }
    ctl.falls = vis;
    if (!vis.length) { if (!blank) { g.clearRect(0, 0, AW, Hc); blank = true; } return; }
    const D = img.data; D.fill(0); let lit = 0;
    const La = Math.round(SHIM_LIGHT_A * 255), Da = Math.round(SHIM_DARK_A * 255);
    for (const m of vis) for (let k = 0; k < m.n; k++) {
      const x = m.x[k], r = m.r[k], py = Math.round(rowTop - 1 - r); if (py < 0 || py >= Hc) continue;
      const s = shimmerAt(x, r, t); if (!s) continue;
      const o = (py * AW + x) * 4, c = s === 1 ? SHIM_LIGHT : SHIM_DARK; D[o] = c[0]; D[o + 1] = c[1]; D[o + 2] = c[2]; D[o + 3] = s === 1 ? La : Da; lit++;
    }
    g.putImageData(img, 0, 0); blank = false; ctl.draws++; ctl.lit = lit; ctl.ms = performance.now() - t0;
  };
  ctl.draw = () => { place(viewWin()); draw(); };
  ctl.time = () => t;
  clock.onTick(dt => {
    if (document.hidden || globalThis.HB?.compose?.opened) return;
    { const r = view.host.getBoundingClientRect(); if (r.bottom < -400 || r.top > innerHeight + 400) return; }   // round 15.6b: a block of the scroll far off screen (src/feed.js) rests
    const v = viewWin(), moved = !win || v.lo < win.lo + 30 || v.hi > win.hi - 30;
    if (moved) place(v);
    t += dt; acc += dt;
    if (acc >= 1 / SHIM_HZ || moved) { acc = 0; draw(); }
  });
  return ctl;
}
