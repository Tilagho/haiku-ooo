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

// Font px of air between the glyph run (faces and their counts) and the signature+date block.
// Spacing only — no middot, no bullet. The name and the date stay glued; glyphs stay outside that block.
// Round 15.12d: 6 → 16 (+10). At the poem's usual 1.5 scale that is about 15 CSS px more on a phone,
// so the faces are not sitting on the name and the date. TIGHT_GAPS still packs when the open gap would clip.
export const DATE_GAP = 16;
// Square picker cell, in art px: the largest resting face (the star). Every mobile cell is this
// size so the six glyphs share one grid; animation frames may overflow the cell.
export const PICKER_CELL = Math.max(...RX_ORDER.map(k => Math.max(GLYPH_BOX[k].ow, GLYPH_BOX[k].oh)));
export const GLYPH_PAD = 2;

// Where a picker canvas sits inside its square cell so the resting face is centered.
export function pickerGlyphOrigin(kind, cssPx) {
  const g = GLYPH_BOX[kind];
  const cell = PICKER_CELL * cssPx;
  return {
    cell,
    left: cell / 2 - (GLYPH_PAD + g.ox + g.ow / 2) * cssPx,
    top: cell / 2 - (GLYPH_PAD + g.oy + g.oh / 2) * cssPx,
  };
}

// Date-line cluster, in font px. `scale` is font px per reaction art px. Glyphs center on the
// small-font cap. A signature and its date are one block: glyphs never sit between them.
// `side: 'before'` puts glyphs to the left of that whole block (the date still ends the row);
// `side: 'after'` puts them to the right of it. Unsigned poems have no author, so the block is
// the date alone. No separator character either way — `gaps.date` is air.
// Returns items shifted so the row's top is 0. `dateX` is the date's x inside the row.
// `bleedL` / `bleedR` are how far the glyph canvases hang past the row (frame pad + shake room),
// so a fit check can keep the visible glyph inside the clip, not only the resting ink.
export function layoutByline({ counts, author = '', date, measure, scale, ascent = 11, cap = 7, descent = 2, side = 'before', gaps } = {}) {
  const gGap = gaps?.glyph ?? 2, kGap = gaps?.kind ?? 4, dGap = gaps?.date ?? DATE_GAP;
  const capCenter = ascent - cap / 2;
  const kinds = RX_ORDER.filter(k => (counts?.[k] | 0) > 0);
  const run = [];
  let rx = 0;
  kinds.forEach((k, i) => {
    const g = GLYPH_BOX[k];
    const w = Math.max(1, Math.round(g.ow * scale)), h = Math.max(1, Math.round(g.oh * scale));
    run.push({ type: 'glyph', kind: k, x: rx, y: Math.round(capCenter - h / 2), w, h });
    rx += w + gGap;
    const t = String(counts[k] | 0), tw = measure(t);
    run.push({ type: 'text', t, x: rx, y: 0, w: tw, count: true });
    rx += tw;
    if (i < kinds.length - 1) rx += kGap;
  });
  const items = [];
  let x = 0;
  const text = (t, extra) => { const w = measure(t); items.push({ type: 'text', t, x, y: 0, w, ...extra }); x += w; };
  const addRun = () => { for (const it of run) items.push({ ...it, x: it.x + x }); x += rx; };
  const signature = () => { if (author) text(author); text(date, { date: true }); };
  if (side === 'after') {
    signature();
    if (kinds.length) { x += dGap; addRun(); }
  } else {
    if (kinds.length) { addRun(); x += dGap; }
    signature();
  }
  let top = 0, bot = ascent + descent;
  for (const it of items) if (it.type === 'glyph') { top = Math.min(top, it.y); bot = Math.max(bot, it.y + it.h); }
  const shift = -top;
  if (shift) for (const it of items) it.y += shift;
  const dateItem = items.find(i => i.date);
  const rowW = Math.max(0, x);
  let bleedL = 0, bleedR = 0;
  for (const it of items) if (it.type === 'glyph') {
    const g = GLYPH_BOX[it.kind];
    const hangL = (GLYPH_PAD + g.ox) * scale, hangR = (GLYPH_PAD + g.w - g.ox - g.ow) * scale;
    bleedL = Math.max(bleedL, hangL - it.x);
    bleedR = Math.max(bleedR, it.x + it.w + hangR - rowW);
  }
  return {
    w: rowW, h: bot + shift, shift, items, kinds, side: side === 'after' ? 'after' : 'before',
    dateX: dateItem ? dateItem.x : 0, bleedL, bleedR, gaps: { glyph: gGap, kind: kGap, date: dGap },
  };
}

// Keep the signature+date block where the painted byline had it, and put the glyphs on the side
// that fits. Coordinates are font px in the poem. Prefer the left of the whole block. If that row
// (including the glyph canvas hanging past the resting ink) would leave [leftLimit, rightLimit],
// use the right of the block. If neither side fits, take the roomier side of the block and slide
// the whole row so the visible glyphs and the byline stay inside the limits — the byline moves
// only then. `afterDateX` is the date's x in the after-layout, which is also the author width,
// so `dateLeft - afterDateX` is the start of the signature block (the date itself, when unsigned).
export function placeByline({
  beforeW, afterW, afterDateX, dateLeft, dateRight, leftLimit, rightLimit,
  beforeBleedL = 0, beforeBleedR = 0, afterBleedL = 0, afterBleedR = 0,
}) {
  const beforeLeft = dateRight - beforeW;
  const afterLeft = dateLeft - afterDateX;
  const fits = (left, w, bL, bR) => left - bL >= leftLimit - 0.5 && left + w + bR <= rightLimit + 0.5;
  if (fits(beforeLeft, beforeW, beforeBleedL, beforeBleedR)) return { side: 'before', left: beforeLeft };
  if (fits(afterLeft, afterW, afterBleedL, afterBleedR)) return { side: 'after', left: afterLeft };
  const roomL = dateLeft - afterDateX - leftLimit, roomR = rightLimit - dateRight;
  const side = roomL >= roomR ? 'before' : 'after';
  let left = side === 'before' ? beforeLeft : afterLeft;
  const w = side === 'before' ? beforeW : afterW;
  const bL = side === 'before' ? beforeBleedL : afterBleedL;
  const bR = side === 'before' ? beforeBleedR : afterBleedR;
  if (left - bL < leftLimit) left = leftLimit + bL;
  if (left + w + bR > rightLimit) left = Math.max(leftLimit + bL, rightLimit - bR - w);
  return { side, left };
}

const LOOSE_GAPS = { glyph: 2, kind: 4, date: DATE_GAP };
const TIGHT_GAPS = { glyph: 1, kind: 1, date: 3 };   // only when the airy row would leave the viewing area

// Pick a side and, when a full set of counts still cannot fit, pack the same glyphs a little tighter.
// `ok` means the visible row (text plus canvas bleed) sits inside the limits.
export function fitByline(opts) {
  const place = gaps => {
    const before = layoutByline({ ...opts, gaps, side: 'before' });
    const after = layoutByline({ ...opts, gaps, side: 'after' });
    const placed = placeByline({
      beforeW: before.w, afterW: after.w, afterDateX: after.dateX,
      dateLeft: opts.dateLeft, dateRight: opts.dateRight, leftLimit: opts.leftLimit, rightLimit: opts.rightLimit,
      beforeBleedL: before.bleedL, beforeBleedR: before.bleedR, afterBleedL: after.bleedL, afterBleedR: after.bleedR,
    });
    const layout = placed.side === 'after' ? after : before;
    const visualL = placed.left - layout.bleedL, visualR = placed.left + layout.w + layout.bleedR;
    const ok = visualL >= opts.leftLimit - 0.5 && visualR <= opts.rightLimit + 0.5;
    return { placed, layout, ok };
  };
  const loose = place(LOOSE_GAPS);
  if (loose.ok) return loose;
  return place(TIGHT_GAPS);
}

// When even the tight row is wider than the clip, scale the whole cluster (glyphs and the date together)
// so it lands inside. 1 means the natural pixel size still fits.
export function rowFitScale(visualW, leftLimit, rightLimit) {
  const span = rightLimit - leftLimit;
  if (!(visualW > span + 0.5) || span <= 0) return 1;
  return span / visualW;
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
