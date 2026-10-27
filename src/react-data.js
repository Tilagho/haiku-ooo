// Round 15.11: poem reactions. Pure layout / hit-testing (no DOM), shared by the picker, the date-line
// row, the report retarget (hold the number seal only) and the tests.
//
// The six approved glyphs, in picker and date-line order. Star replaced the earlier approval mark.
// `heart` is the broken heart (Firestore field names stay bare words).
import { sealDims } from './brush-text.js';

export const RX_ORDER = ['cry', 'eyes', 'heart', 'star', 'flushed', 'relieved'];
export const RX_LABEL = {
  cry: 'cry', eyes: 'eyes', heart: 'broken heart', star: 'star', flushed: 'flushed', relieved: 'relieved',
};
// Resting opaque box inside each animation frame (art px). ox/oy is the box's top-left in the frame.
// Measured off the approved 1x strips (assets/reactions/*-frames-1x.png).
export const GLYPH_BOX = {
  cry:      { w: 16, h: 16, ox: 0, oy: 0, ow: 16, oh: 16 },
  eyes:     { w: 16, h: 15, ox: 0, oy: 0, ow: 16, oh: 15 },
  heart:    { w: 30, h: 14, ox: 6, oy: 0, ow: 17, oh: 13 },
  star:     { w: 24, h: 21, ox: 2, oy: 3, ow: 17, oh: 17 },
  flushed:  { w: 24, h: 22, ox: 4, oy: 4, ow: 16, oh: 16 },
  relieved: { w: 24, h: 31, ox: 4, oy: 1, ow: 16, oh: 16 },
};
export const RX_FILE = {
  cry: 'cry', eyes: 'eyes', heart: 'broken-heart', star: 'star', flushed: 'flushed', relieved: 'relieved',
};

export const emptyCounts = () => ({ cry: 0, eyes: 0, heart: 0, star: 0, flushed: 0, relieved: 0 });
export const isKind = k => RX_ORDER.includes(k);
export const hasReactions = counts => RX_ORDER.some(k => (counts?.[k] | 0) > 0);
export const nextKind = (prev, tapped) => (prev === tapped ? null : tapped);

// One reaction per person: leaving `prev` and taking `next` (null clears). Counts never go negative.
export function applyCounts(counts, prev, next) {
  const c = { ...emptyCounts(), ...counts };
  for (const k of RX_ORDER) c[k] = Math.max(0, c[k] | 0);
  if (prev && isKind(prev) && c[prev] > 0) c[prev]--;
  if (next && isKind(next)) c[next]++;
  return c;
}
export function normalizeCounts(data) {
  const c = emptyCounts();
  if (data) for (const k of RX_ORDER) c[k] = Math.max(0, data[k] | 0);
  return c;
}

// Date-line cluster, in font px. `scale` is font px per reaction art px (the view snaps this so every
// art px is a whole device px). Glyphs center on the small-font cap; text stays on the signature line
// (y 0 before the shift). Only kinds with a count above zero are included, in RX_ORDER.
// Returns items shifted so the row's top is 0. `shift` is how far above L.sig.y the row starts.
export function layoutByline({ counts, author = '', date, measure, scale, ascent = 11, cap = 7, descent = 2 }) {
  const capCenter = ascent - cap / 2;
  const items = [];
  let x = 0;
  const text = (t, extra) => { const w = measure(t); items.push({ type: 'text', t, x, y: 0, w, ...extra }); x += w; };
  if (author) text(author);
  const kinds = RX_ORDER.filter(k => (counts?.[k] | 0) > 0);
  for (const k of kinds) {
    const g = GLYPH_BOX[k];
    const w = Math.max(1, Math.round(g.ow * scale)), h = Math.max(1, Math.round(g.oh * scale));
    items.push({ type: 'glyph', kind: k, x, y: Math.round(capCenter - h / 2), w, h });
    x += w + 2;
    text(String(counts[k] | 0), { count: true });
    x += 4;
  }
  if (kinds.length) text('· ');
  text(date, { date: true });
  let top = 0, bot = ascent + descent;
  for (const it of items) if (it.type === 'glyph') { top = Math.min(top, it.y); bot = Math.max(bot, it.y + it.h); }
  const shift = -top;
  if (shift) for (const it of items) it.y += shift;
  return { w: Math.max(0, x), h: bot + shift, shift, items, kinds };
}

// Pixel size. The approved inline mock (a 3× phone shot) draws reaction art px at 2 viewport CSS px,
// a little finer than a seal block so the six faces sit on the date line. Seal / picker blocks are the
// sumi pixel: 3 scroll units. Both snap to a whole device px (same idea as ScrollView.fontScale).
export function fontDevicePx(hostWidth, dpr = 1, u = 1.5, scrollW = 390) {
  const dev = dpr * ((hostWidth / scrollW) || 1);
  let k = Math.max(1, Math.round(u * dev));
  while (k > 1 && k / dev > u + 1e-6) k--;
  return k;
}
export function reactionScale(hostWidth, dpr = 1, scrollW = 390) {
  const s = (hostWidth / scrollW) || 1, dev = dpr * s;
  const rk = Math.max(2, Math.round(2 * dev));
  const kFont = fontDevicePx(hostWidth, dpr, 1.5, scrollW);
  return { rk, dev, css: rk / dpr, layer: dev ? rk / dev : 2, fontPerArt: kFont ? rk / kFont : 1.5, kFont };
}
// Picker glyphs use the seal's own pixel (3 scroll units) so they match the stamps and the 2×3 bubble mock.
export function pickerScale(hostWidth, dpr = 1, scrollW = 390) {
  const s = (hostWidth / scrollW) || 1, dev = dpr * s;
  const rk = Math.max(2, Math.round(3 * dev));
  return { rk, dev, css: rk / dpr, layer: dev ? rk / dev : 3 };
}

// The number seal in viewport CSS px. `view.fontScale` and the poem's border box do the scaling.
export function sealScreenRect(rec, view, scrollW = 390) {
  const L = rec.poem.layout, c = view.fontScale(L.u), s = (view.host.clientWidth / scrollW) || 1;
  const pr = rec.el.getBoundingClientRect(), [sw, sh] = sealDims(rec.poem.n);
  const x = (L.seal.x + rec.pad) * c * s, y = (L.seal.y + rec.pad) * c * s, w = sw * c * s, h = sh * c * s;
  return { left: pr.left + x, top: pr.top + y, right: pr.left + x + w, bottom: pr.top + y + h, width: w, height: h };
}
export function pointInRect(p, r, slop = 0) {
  return !!r && p.x >= r.left - slop && p.x <= r.right + slop && p.y >= r.top - slop && p.y <= r.bottom + slop;
}

// Hold target. The number seal (and the 通報 mark beside it) is the report target; the rest of the
// poem — the lines, the date, the reaction row — is the reaction target. Slop stays inside the seal gap.
export function poemZone(e, feed, slop = 8) {
  const el = e.target?.closest?.('.poem');
  if (!el) return null;
  const rec = feed.recOf(el);
  if (!rec) return null;
  const p = { x: e.clientX, y: e.clientY };
  const view = feed.viewOf(el);
  let stamp = !!(view && pointInRect(p, sealScreenRect(rec, view), slop));
  const mark = el.querySelector?.('.rpt-mark');
  if (mark) stamp = stamp || pointInRect(p, mark.getBoundingClientRect(), slop);
  return { el, rec, stamp };
}
