// Bitmap lettering: 1-bit glyphs rasterized from the Jersey pixel fonts (see tools/build-font.py),
// always horizontal, drawn pixel by pixel with a very mild seeded unevenness.
// Measuring is pure arithmetic on fixed advances, so layout is identical on every device.
import FONTS from './brush-font.js';
import KANJI from './kanji-glyphs.js';
import { sealLayout } from './kanji.js';

const decoded = new Map();
function glyph(font, ch) {
  const key = font.name + ch;
  if (decoded.has(key)) return decoded.get(key);
  const g = font.glyphs[ch] || font.glyphs['?'];
  const bits = new Uint8Array(g.w * g.h);
  for (let i = 0; i < bits.length; i++) bits[i] = (parseInt(g.b[i >> 2], 16) >> (3 - (i & 3))) & 1;
  const out = { ...g, bits }; decoded.set(key, out); return out;
}
const clean = s => s.replace(/[^\x20-\x7e‘’“”—–…éèêëáàâäíîïóôöúûüñçōūā·]/g, '');
export const font = name => FONTS[name];
export function measure(text, f = FONTS.main) { let w = 0; for (const ch of clean(text)) w += (f.glyphs[ch] || f.glyphs['?']).a; return w; }
export const lineHeight = f => f.ascent + f.descent;

export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function hash(...parts) { let h = 2166136261; for (const c of parts.join('|')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// Paint one horizontal line into a pixel buffer {w,h,data}. Ink is near-black with a very mild,
// seeded unevenness (per-glyph ink load, rare lighter pixels) so it reads as printed-by-brush but stays crisp.
// halo>0 first lays a soft paper-coloured knockout (glyph shapes dilated by `halo` px) under the ink,
// so the text keeps full contrast even where a pale wash drifts nearby.
export function drawLine(buf, text, x, y, f, rand, { color = [24, 22, 26], alpha = 1, halo = 0, paper = [244, 236, 218] } = {}) {
  const glyphs = []; let pen = 0;
  for (const ch of clean(text)) { const g = glyph(f, ch); glyphs.push([g, pen]); pen += g.a; }
  if (halo) for (const [g, p0] of glyphs) for (let gy = -halo; gy < g.h + halo; gy++) for (let gx = -halo; gx < g.w + halo; gx++) {
    let near = false;
    for (let dy = -halo; dy <= halo && !near; dy++) for (let dx = -halo; dx <= halo && !near; dx++) {
      const sx = gx + dx, sy = gy + dy; if (sx >= 0 && sy >= 0 && sx < g.w && sy < g.h && g.bits[sy * g.w + sx] && dx * dx + dy * dy <= halo * halo + 1) near = true;
    }
    if (near) { const px = x + p0 + g.x + gx, py = y + f.ascent + g.y + gy; if (px >= 0 && py >= 0 && px < buf.w && py < buf.h) { const i = (py * buf.w + px) * 4; if (!buf.data[i + 3]) { buf.data[i] = paper[0]; buf.data[i + 1] = paper[1]; buf.data[i + 2] = paper[2]; buf.data[i + 3] = 200; } } }
  }
  for (const [g, p0] of glyphs) {
    const ink = alpha * (0.93 + rand() * 0.07);
    for (let gy = 0; gy < g.h; gy++) for (let gx = 0; gx < g.w; gx++) {
      if (!g.bits[gy * g.w + gx]) continue;
      const a = rand() < 0.03 ? ink * 0.78 : ink;                 // faint dry-brush flecks, kept very mild
      const px = x + p0 + g.x + gx, py = y + f.ascent + g.y + gy;
      if (px < 0 || py < 0 || px >= buf.w || py >= buf.h) continue;
      const i = (py * buf.w + px) * 4;
      buf.data[i] = color[0]; buf.data[i + 1] = color[1]; buf.data[i + 2] = color[2]; buf.data[i + 3] = Math.round(a * 255);
    }
  }
}

// Number seal: a real red hanko, perfectly straight (zero rotation), upright oval or square, with the post number
// in KANJI numerals (src/kanji.js) carved out in cream: Misaki Gothic 8x8 glyphs, doubled for 1-2 characters.
// A thin carved ring follows the rim, a few pixels are worn pale, and the edge has a couple of nicks.
const SEAL_RED = [214, 52, 40], SEAL_PAPER = [248, 240, 222];
export function sealDims(n) { const L = sealLayout(n); return [L.W, L.H]; }
export function sealSize(n) { return sealDims(n)[0]; }
export function drawSeal(buf, n, x, y, rand, { red = SEAL_RED, paper = SEAL_PAPER } = {}) {
  const L = sealLayout(n), { W, H } = L;
  const put = (px, py, c, a = 255) => { if (px < 0 || py < 0 || px >= buf.w || py >= buf.h) return; const i = (py * buf.w + px) * 4; buf.data[i] = c[0]; buf.data[i + 1] = c[1]; buf.data[i + 2] = c[2]; buf.data[i + 3] = a; };
  // inside(i, j, k): pixel centre inside the shape shrunk by k px
  const inside = L.shape === 'oval'
    ? (i, j, k = 0) => (((i + .5) - W / 2) / (W / 2 - k)) ** 2 + (((j + .5) - H / 2) / (H / 2 - k)) ** 2 <= 1
    : (i, j, k = 0) => { const r = 1.5, a = k, b = W - 1 - k, c = H - 1 - k; if (i < a || j < a || i > b || j > c) return false;
        const cx = Math.min(Math.max(i, a + r - .5), b - r + .5), cy = Math.min(Math.max(j, a + r - .5), c - r + .5); return (i - cx) ** 2 + (j - cy) ** 2 <= r * r; };
  const cut = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (inside(i, j, 2) && !inside(i, j, 3)) cut[j * W + i] = 1;   // carved ring inside a 2 px rim
  for (const c of L.cells) {
    const g = KANJI[c.ch]; if (!g) continue;
    for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 7; gx++) if (g[gy][gx] === '1')
      for (let a = 0; a < L.scale; a++) for (let b = 0; b < L.scale; b++) { const X = c.x + gx * L.scale + a, Y = c.y + gy * L.scale + b; if (X >= 0 && Y >= 0 && X < W && Y < H) cut[Y * W + X] = 1; }
  }
  const nicks = new Set([Math.floor(rand() * W), Math.floor(rand() * H) + 1000]);          // two tiny chips in the rim
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!inside(i, j)) continue;
    const edge = !inside(i, j, 1);   // nicks only bite the outermost pixel row
    if (edge && ((j === 0 || j === H - 1) && nicks.has(i) || (i === 0 || i === W - 1) && nicks.has(j + 1000))) continue;
    if (cut[j * W + i]) put(x + i, y + j, paper);
    else put(x + i, y + j, red, rand() < 0.025 ? 175 : 255);
  }
}

// Pixel DITHERED paper backing: every transparent pixel near ink gets paper colour with a probability that falls
// off with (chessboard) distance from the nearest ink pixel, thresholded by a 4x4 Bayer matrix: solid right
// around the letters, then an ordered-dither fade. Lets text sit over faint art and still read crisply.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + .5) / 16);
export function ditherBacking(buf, { solid = 1, fade = 4.5, paper = [244, 236, 218], strength = 1 } = {}) {
  const { w, h, data } = buf, INF = 99, d = new Uint8Array(w * h).fill(INF), q = [];
  for (let i = 0; i < w * h; i++) if (data[i * 4 + 3] > 0) { d[i] = 0; q.push(i); }
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % w, y = (i / w) | 0, nd = d[i] + 1; if (nd > solid + fade) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const j = Y * w + X; if (d[j] > nd) { d[j] = nd; q.push(j); }
    }
  }
  for (let i = 0; i < w * h; i++) {
    const dv = d[i]; if (dv === 0 || dv === INF) continue;
    const p = (dv <= solid ? 1 : 1 - (dv - solid) / fade) * strength, x = i % w, y = (i / w) | 0;
    if (p > BAYER[(y & 3) * 4 + (x & 3)]) { const o = i * 4; data[o] = paper[0]; data[o + 1] = paper[1]; data[o + 2] = paper[2]; data[o + 3] = 255; }
  }
}
