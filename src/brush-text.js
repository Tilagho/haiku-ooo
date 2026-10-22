// Bitmap lettering: 1-bit glyphs rasterized from the Jersey pixel fonts (see tools/build-font.py),
// always horizontal, drawn pixel by pixel with a very mild seeded unevenness.
// Measuring is pure arithmetic on fixed advances, so layout is identical on every device.
import FONTS from './brush-font.js';

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

// Chunky chibi number seal: a straight, square red block (zero rotation) with the post number cut out in 2x pixel digits.
const DIG = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001010010', '111101111101111', '111101111001111'];
export function sealDims(n) { const k = String(n).length; return [Math.max(16, k * 8 + 4), 16]; }
export function sealSize(n) { return sealDims(n)[0]; }
export function drawSeal(buf, n, x, y, rand) {
  const s = String(n), [W, H] = sealDims(n), RED = [214, 52, 40], PAPER = [248, 240, 222], r = 1.5;   // square seal, corners only just softened
  const put = (px, py, c, a = 255) => { if (px < 0 || py < 0 || px >= buf.w || py >= buf.h) return; const i = (py * buf.w + px) * 4; buf.data[i] = c[0]; buf.data[i + 1] = c[1]; buf.data[i + 2] = c[2]; buf.data[i + 3] = a; };
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const cx = Math.min(Math.max(i, r - .5), W - r - .5), cy = Math.min(Math.max(j, r - .5), H - r - .5);
    if ((i - cx) ** 2 + (j - cy) ** 2 > r * r) continue;
    put(x + i, y + j, RED, rand() < 0.02 ? 170 : 255);
  }
  const tw = s.length * 8 - 2, ox = x + Math.floor((W - tw) / 2), oy = y + 3;
  [...s].forEach((d, k) => { const m = DIG[+d]; for (let q = 0; q < 15; q++) if (m[q] === '1') for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) put(ox + k * 8 + (q % 3) * 2 + a, oy + Math.floor(q / 3) * 2 + b, PAPER); });
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
