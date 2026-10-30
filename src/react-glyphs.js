// Round 15.11: the reaction glyphs, drawn nearest-neighbour from the approved 1× frame strips.
// The frame strips are the reaction pack (cry tears, eyes look + blink, heart break and roll, star
// twinkle, flushed eyes balloon, relieved drip). Round 15.14: poop squashes, blinks and lets off
// a wisp; fire leans, runs a highlight down its core and throws a spark. No GIFs: one shared rAF,
// paused off screen.
// Round 15.12d: a date-line face plays for about a second when it is placed, then sits on frame 0.
// The picker still loops, so the choices keep moving. Every face (picker and date line) is washed
// toward the sumi paper so it reads as ink on the sheet.
import { GLYPH_BOX, RX_ORDER, RX_FILE } from './react-data.js?v=15.14a';

// [ms, dx, dy] per frame. dx/dy is the approved whole-pixel shake.
const FRAMES = {
  cry: [[110, 1, 0], [110, -1, 0], [110, 1, 0], [110, -1, 0], [110, 1, 0], [110, -1, 0]],
  eyes: [[300, 0, 0], [90, 0, 0], [420, 0, 0], [90, 0, 0], [90, 0, 0], [420, 0, 0], [160, 0, 0], [60, 0, 0], [60, 0, 0], [60, 0, 0], [90, 0, 0], [50, 0, 0], [50, 0, 0], [50, 0, 0], [300, 0, 0]],
  heart: [[380, 0, 0], [60, 1, 0], [60, -1, 0], [70, 0, 0], [80, 0, 0], [100, 0, 0], [150, 0, 0], [300, 0, 0], [90, 0, 0], [70, 0, 0], [50, 0, 0], [50, 1, 0], [380, 0, 0]],
  star: [[700, 0, 0], [45, 0, 0], [45, 0, 0], [45, 0, 0], [45, 0, 0], [45, 0, 0], [45, 0, 0], [45, 0, 0], [45, 0, 0], [60, 0, 0], [120, 0, 0], [60, 0, 0], [520, 0, 0]],
  flushed: [[300, 0, 0], [70, 0, 0], [70, 0, 0], [70, 0, 0], [90, 1, 0], [70, -1, 0], [70, 1, 0], [380, 0, 0], [90, 0, 0], [90, 0, 0], [90, 0, 0], [200, 0, 0]],
  relieved: [[300, 0, 0], [110, 0, 0], [120, 0, 0], [160, 0, 0], [110, 0, 0], [110, 0, 0], [150, 0, 0], [70, 0, 0], [60, 0, 0], [60, 0, 0], [60, 0, 0], [120, 0, 0], [300, 0, 0]],
  // One second: rest, a stamp-squash, a blink, a wisp, then the resting cel again. The dy/dx is the cry's whole-pixel shake.
  poop: [[280, 0, 0], [90, 0, 1], [80, 1, 0], [70, 0, 0], [90, 0, 0], [110, 0, 0], [140, 0, 0], [140, 0, 0]],
  // One second: the tall spike flares, a left lick, a thinner right needle, a three-tongue fork, then the spark.
  fire: [[320, 0, 0], [70, 0, 0], [70, 0, 0], [80, 0, 0], [80, 0, 0], [90, 0, 0], [120, 0, 0], [170, 0, 0]],
};
const TOTAL = Object.fromEntries(RX_ORDER.map(k => [k, FRAMES[k].reduce((s, f) => s + f[0], 0)]));
const PAD = 2;   // room for the ±1 px shake without clipping

// How long a just-placed date-line face plays before it settles. The picker is not on this clock.
export const GLYPH_PLAY_MS = 1000;

// Sumi paper the scroll is painted on (style.css --paper, mist.js PAPER, brush-text dither backing).
// STAMP_SAT is the chroma kept (1 = the strip as drawn). STAMP_WASH is how far a white pixel walks
// toward that paper; the walk scales with luma, so the near-black outline stays ink.
export const STAMP_PAPER = [244, 236, 218];
export const STAMP_SAT = 0.82;
export const STAMP_WASH = 0.28;

// Literal paths so tools/build-dist.mjs ships the strips (a template string would not match).
const URLS = {
  cry: new URL('../assets/reactions/cry-frames-1x.png', import.meta.url).href,
  eyes: new URL('../assets/reactions/eyes-frames-1x.png', import.meta.url).href,
  heart: new URL('../assets/reactions/broken-heart-frames-1x.png', import.meta.url).href,
  star: new URL('../assets/reactions/star-frames-1x.png', import.meta.url).href,
  flushed: new URL('../assets/reactions/flushed-frames-1x.png', import.meta.url).href,
  relieved: new URL('../assets/reactions/relieved-frames-1x.png', import.meta.url).href,
  poop: new URL('../assets/reactions/poop-frames-1x.png?v=15.14a', import.meta.url).href,
  fire: new URL('../assets/reactions/fire-frames-1x.png?v=15.14a', import.meta.url).href,
};
void RX_FILE;

const imgs = new Map();
let loading = null;
function repaintLive() {
  const t = performance.now();
  for (const n of live) paintNode(n, t);
}
export function loadSprites() {
  return loading ||= Promise.all(RX_ORDER.map(k => new Promise(res => {
    const img = new Image();
    img.onload = () => { imgs.set(k, img); res(); };
    img.onerror = () => res();
    img.src = URLS[k];
  }))).then(() => { repaintLive(); });
}

export function frameAt(kind, t, idle = false) {
  // The settled stamp is the strip's first cel with the shake taken off, so a cry face does not sit 1px off center.
  if (idle) return { i: 0, dx: 0, dy: 0 };
  const frames = FRAMES[kind], total = TOTAL[kind];
  let x = ((t % total) + total) % total;
  for (let i = 0; i < frames.length; i++) {
    if (x < frames[i][0]) return { i, dx: frames[i][1], dy: frames[i][2] };
    x -= frames[i][0];
  }
  return { i: 0, dx: 0, dy: 0 };
}

// Pull opaque pixels a little toward the paper and drop a little chroma. Clear pixels stay clear.
// Gold stays gold, the heart stays red, tears stay blue; they just sit quieter on the sheet.
export function inkStampRGBA(data, paper = STAMP_PAPER) {
  const [pr, pg, pb] = paper;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const r0 = data[i], g0 = data[i + 1], b0 = data[i + 2];
    const y = r0 * 0.299 + g0 * 0.587 + b0 * 0.114;
    const r = y + (r0 - y) * STAMP_SAT, g = y + (g0 - y) * STAMP_SAT, b = y + (b0 - y) * STAMP_SAT;
    const t = STAMP_WASH * (y / 255);
    data[i] = Math.round(r + (pr - r) * t);
    data[i + 1] = Math.round(g + (pg - g) * t);
    data[i + 2] = Math.round(b + (pb - b) * t);
  }
  return data;
}

// Which date-line kinds are still inside their one-second play.
// `seen` is null the first time a poem is measured: those faces are already on the board, so they stay idle.
// A kind that shows up later (someone placed it) gets one play. A `plays` entry already in the future is a
// re-place or a switch and is kept, so the same second is not restarted by a redraw.
export function planPlays(seen, kinds, now, { playMs = GLYPH_PLAY_MS, plays = null } = {}) {
  const have = new Set(kinds);
  const next = new Map();
  if (plays) for (const [k, until] of plays) if (until > now && have.has(k)) next.set(k, until);
  if (seen) for (const k of have) if (!seen.has(k) && !(next.get(k) > now)) next.set(k, now + playMs);
  return { seen: have, plays: next };
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
// cv.dataset.used === '1' (the picker face already on this poem) is greyed every frame, and skips the ink wash
// so the 15.12c used-grey stays neutral. Every other face is the ink stamp. `idle` is frame 0 with no shake.
export function paintGlyph(cv, kind, t, reduced = false, idle = false) {
  const img = imgs.get(kind), g = GLYPH_BOX[kind];
  if (!img || !g) return false;
  const W = g.w + PAD * 2, H = g.h + PAD * 2;
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const fr = frameAt(kind, reduced ? 0 : t, idle);
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(img, fr.i * g.w, 0, g.w, g.h, PAD + fr.dx, PAD + fr.dy, g.w, g.h);
  const imgd = ctx.getImageData(0, 0, W, H);
  if (cv.dataset?.used === '1') dimUsedRGBA(imgd.data);
  else inkStampRGBA(imgd.data);
  ctx.putImageData(imgd, 0, 0);
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

// `loop` keeps the picker cycling. A date-line node plays while `until` is ahead of now, then one idle frame.
function playing(node, now) { return !reduced && (node.loop || now < node.until); }
function paintNode(node, now) {
  const go = playing(node, now);
  paintGlyph(node.cv, node.kind, go ? now + node.phase : 0, reduced, !go);
}
function needsFrame(now) {
  if (reduced) return false;
  for (const n of live) if (n.loop || now < n.until) return true;
  return false;
}
function kick() {
  if (raf || !needsFrame(performance.now())) return;
  raf = requestAnimationFrame(tick);
}
function tick(now) {
  raf = 0;
  for (const node of live) paintNode(node, now);
  if (needsFrame(now)) raf = requestAnimationFrame(tick);
}
export function setGlyphMotion(off) {
  reduced = !!off;
  const now = performance.now();
  for (const n of live) paintNode(n, now);
  if (reduced) { if (raf) cancelAnimationFrame(raf); raf = 0; }
  else kick();
}

// mode: 'loop' (picker, the default) | 'idle' | 'play' (one GLYPH_PLAY_MS from now) | { loop, until }.
function motionOf(mode, now) {
  if (mode === 'idle') return { loop: false, until: 0 };
  if (mode === 'play') return { loop: false, until: now + GLYPH_PLAY_MS };
  if (mode && typeof mode === 'object') return { loop: !!mode.loop, until: mode.until || 0 };
  return { loop: true, until: 0 };
}
export function trackGlyph(cv, kind, phase = 0, mode = 'loop') {
  if (cv._rx) live.delete(cv._rx);
  const now = performance.now();
  const motion = reduced ? { loop: false, until: 0 } : motionOf(mode, now);
  const node = { cv, kind, phase, ...motion };
  live.add(node); cv._rx = node;
  paintNode(node, now);
  kick();
  return node;
}
export function untrackGlyph(cv) { if (cv?._rx) { live.delete(cv._rx); cv._rx = null; } }
