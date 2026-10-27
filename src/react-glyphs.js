// Round 15.11: the six reaction glyphs, drawn nearest-neighbour from the approved 1× frame strips.
// Idle loops are the frames ported from the reaction pack (cry tears, eyes look + blink, heart break
// and roll, star twinkle, flushed eyes balloon, relieved drip). No GIFs: one shared rAF, paused off screen.
import { GLYPH_BOX, RX_ORDER, RX_FILE } from './react-data.js';

// [ms, dx, dy] per frame. dx/dy is the approved whole-pixel shake.
const FRAMES = {
  cry: [[110, 1, 0], [110, -1, 0], [110, 1, 0], [110, -1, 0], [110, 1, 0], [110, -1, 0]],
  eyes: [[300, 0, 0], [90, 0, 0], [420, 0, 0], [90, 0, 0], [90, 0, 0], [420, 0, 0], [160, 0, 0], [60, 0, 0], [60, 0, 0], [60, 0, 0], [90, 0, 0], [50, 0, 0], [50, 0, 0], [50, 0, 0], [300, 0, 0]],
  heart: [[380, 0, 0], [60, 1, 0], [60, -1, 0], [70, 0, 0], [80, 0, 0], [100, 0, 0], [150, 0, 0], [300, 0, 0], [90, 0, 0], [70, 0, 0], [50, 0, 0], [50, 1, 0], [380, 0, 0]],
  star: [[700, 0, 0], [45, 0, 0], [45, 0, 0], [45, 0, 0], [45, 0, 0], [45, 0, 0], [45, 0, 0], [45, 0, 0], [45, 0, 0], [60, 0, 0], [120, 0, 0], [60, 0, 0], [520, 0, 0]],
  flushed: [[300, 0, 0], [70, 0, 0], [70, 0, 0], [70, 0, 0], [90, 1, 0], [70, -1, 0], [70, 1, 0], [380, 0, 0], [90, 0, 0], [90, 0, 0], [90, 0, 0], [200, 0, 0]],
  relieved: [[300, 0, 0], [110, 0, 0], [120, 0, 0], [160, 0, 0], [110, 0, 0], [110, 0, 0], [150, 0, 0], [70, 0, 0], [60, 0, 0], [60, 0, 0], [60, 0, 0], [120, 0, 0], [300, 0, 0]],
};
const TOTAL = Object.fromEntries(RX_ORDER.map(k => [k, FRAMES[k].reduce((s, f) => s + f[0], 0)]));
const PAD = 2;   // room for the ±1 px shake without clipping

// Literal paths so tools/build-dist.mjs ships the strips (a template string would not match).
const URLS = {
  cry: new URL('../assets/reactions/cry-frames-1x.png', import.meta.url).href,
  eyes: new URL('../assets/reactions/eyes-frames-1x.png', import.meta.url).href,
  heart: new URL('../assets/reactions/broken-heart-frames-1x.png', import.meta.url).href,
  star: new URL('../assets/reactions/star-frames-1x.png', import.meta.url).href,
  flushed: new URL('../assets/reactions/flushed-frames-1x.png', import.meta.url).href,
  relieved: new URL('../assets/reactions/relieved-frames-1x.png', import.meta.url).href,
};
void RX_FILE;

const imgs = new Map();
let loading = null;
function repaintLive() {
  const t = performance.now();
  for (const n of live) paintGlyph(n.cv, n.kind, t + n.phase, reduced);
}
export function loadSprites() {
  return loading ||= Promise.all(RX_ORDER.map(k => new Promise(res => {
    const img = new Image();
    img.onload = () => { imgs.set(k, img); res(); };
    img.onerror = () => res();
    img.src = URLS[k];
  }))).then(() => { repaintLive(); });
}

export function frameAt(kind, t) {
  const frames = FRAMES[kind], total = TOTAL[kind];
  let x = ((t % total) + total) % total;
  for (let i = 0; i < frames.length; i++) {
    if (x < frames[i][0]) return { i, dx: frames[i][1], dy: frames[i][2] };
    x -= frames[i][0];
  }
  return { i: 0, dx: 0, dy: 0 };
}

// The face this person already left on the poem: fully desaturated and pulled darker so it reads as
// used, with no selection chip behind it. Opaque pixels only; the shake padding stays clear.
// A bright gold (~luma 180) lands near 75, white eyes near 107, so the face still reads.
export function dimUsedRGBA(data) {
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const y = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    const v = Math.round(y * 0.42);
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  return data;
}

// Paint one frame into an art-px canvas. Returns false if the strip has not loaded yet.
// cv.dataset.used === '1' (the picker face already on this poem) is greyed every frame.
export function paintGlyph(cv, kind, t, reduced = false) {
  const img = imgs.get(kind), g = GLYPH_BOX[kind];
  if (!img || !g) return false;
  const W = g.w + PAD * 2, H = g.h + PAD * 2;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const fr = frameAt(kind, reduced ? 0 : t);
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(img, fr.i * g.w, 0, g.w, g.h, PAD + fr.dx, PAD + fr.dy, g.w, g.h);
  if (cv.dataset?.used === '1') { const imgd = ctx.getImageData(0, 0, W, H); dimUsedRGBA(imgd.data); ctx.putImageData(imgd, 0, 0); }
  return true;
}

// cssPx: viewport (or layer) CSS px per art px. The canvas's layout box is the full frame plus shake pad;
// callers position it so the resting opaque box lands on the slot.
export function sizeGlyph(cv, kind, cssPx) {
  const g = GLYPH_BOX[kind];
  cv.style.width = (g.w + PAD * 2) * cssPx + 'px';
  cv.style.height = (g.h + PAD * 2) * cssPx + 'px';
}
export const GLYPH_PAD = PAD;

const live = new Set();
let raf = 0, reduced = false;
function tick(now) {
  raf = 0;
  for (const node of live) paintGlyph(node.cv, node.kind, now + node.phase, reduced);
  if (live.size && !reduced) raf = requestAnimationFrame(tick);
}
export function setGlyphMotion(off) { reduced = !!off; if (reduced) for (const n of live) paintGlyph(n.cv, n.kind, 0, true); }
export function trackGlyph(cv, kind, phase = 0) {
  if (cv._rx) live.delete(cv._rx);
  const node = { cv, kind, phase };
  live.add(node); cv._rx = node;
  if (!raf && !reduced) raf = requestAnimationFrame(tick);
  else paintGlyph(cv, kind, performance.now() + phase, reduced);
  return node;
}
export function untrackGlyph(cv) { if (cv?._rx) { live.delete(cv._rx); cv._rx = null; } }
