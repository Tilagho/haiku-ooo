// Round 15.11: poem reactions. Pure layout / hit-testing (no DOM), shared by the picker, the date-line
// row, the report retarget (hold the number seal only) and the tests.
//
// The reaction glyphs, in picker and date-line order. Star replaced the earlier approval mark.
// Round 15.14 adds poop and fire in the same ink set. `heart` is the broken heart
// (Firestore field names stay bare words).
import { sealDims } from './brush-text.js';

export const RX_ORDER = ['cry', 'eyes', 'heart', 'star', 'flushed', 'relieved', 'poop', 'fire'];
export const RX_LABEL = {
  cry: 'cry', eyes: 'eyes', heart: 'broken heart', star: 'star', flushed: 'flushed', relieved: 'relieved',
  poop: 'poop', fire: 'fire',
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
  // Poop: a soft-serve swirl, left-leaning tip, big white eyes and a white smile bar.
  poop:     { w: 17, h: 17, ox: 0, oy: 0, ow: 17, oh: 17 },
  // Fire: a teardrop flame, side tongues, pale core inside gold inside red. No gradient.
  fire:     { w: 16, h: 17, ox: 0, oy: 0, ow: 16, oh: 17 },
};
export const RX_FILE = {
  cry: 'cry', eyes: 'eyes', heart: 'broken-heart', star: 'star', flushed: 'flushed', relieved: 'relieved',
  poop: 'poop', fire: 'fire',
};

export const emptyCounts = () => ({ cry: 0, eyes: 0, heart: 0, star: 0, flushed: 0, relieved: 0, poop: 0, fire: 0 });
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
// A count of 1 is the face by itself. The numeral is painted from 2 up (round 15.12g),
// centered under the face, the way a Teams reaction stacks its count.
export const COUNT_FROM = 2;
// Paper between the resting box and the digit, in art px. Eyes and the heart's halves
// leave the box sideways or upward, so this gap keeps the numeral clear of them.
// The relieved drip does fall (13 art px on the 1× strip) but it paints behind the
// numeral — reserving that reach would drop one count off the line the other faces share.
export const COUNT_UNDER_ART = 2;
// Square picker cell, in art px: the largest resting face (the star, tied with the poop). Every
// mobile cell is this size so the glyphs share one grid; animation frames may overflow the cell.
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
// A count of 1 draws no numeral. From 2 up the numeral is centered under its face, a short
// gap below the resting box. The row grows downward to hold it; the signature stays on the
// date line. A drip that falls past the box paints behind the numeral.
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
  // Cap-height digits start this far below the em top (small font: ascent 11, digit y -7).
  const inkTop = ascent - cap;
  kinds.forEach((k, i) => {
    const g = GLYPH_BOX[k];
    const w = Math.max(1, Math.round(g.ow * scale)), h = Math.max(1, Math.round(g.oh * scale));
    const n = counts[k] | 0;
    const show = n >= COUNT_FROM;
    const t = show ? String(n) : '';
    const tw = show ? measure(t) : 0;
    // The wider of the face and its numeral. Both are centered in that cluster.
    const cluster = Math.max(w, tw);
    const gy = Math.round(capCenter - h / 2);
    run.push({ type: 'glyph', kind: k, x: rx + Math.round((cluster - w) / 2), y: gy, w, h });
    if (show) {
      const cy = Math.ceil(gy + h + COUNT_UNDER_ART * scale - inkTop);
      run.push({ type: 'text', t, x: rx + Math.round((cluster - tw) / 2), y: cy, w: tw, count: true });
    }
    rx += cluster;
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
  for (const it of items) {
    const ih = it.type === 'glyph' ? it.h : it.count ? ascent + descent : 0;
    if (!ih) continue;
    top = Math.min(top, it.y);
    bot = Math.max(bot, it.y + ih);
  }
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
    scale, textH: ascent + descent,
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

// Whole-pixel shake the strip actually plays (±1 art px). The star, the eyes and the relieved face sit still.
const GLYPH_SHAKE = { cry: 1, eyes: 0, heart: 1, star: 0, flushed: 1, relieved: 0, poop: 1, fire: 0 };

// Opaque frame of one date-line face, in row font px. This is the animation cel, not the transparent
// canvas pad around it. `shake` is the cel sliding inside that pad while the face plays.
function glyphFrameBox(it, scale) {
  const g = GLYPH_BOX[it.kind];
  const shake = (GLYPH_SHAKE[it.kind] || 0) * scale;
  return {
    x: it.x - g.ox * scale - shake,
    y: it.y - g.oy * scale - shake,
    w: it.w + (g.w - g.ow) * scale + shake * 2,
    h: it.h + (g.h - g.oh) * scale + shake * 2,
  };
}
export function rectsOverlap(a, b) {
  return !!a && !!b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// True when a reaction face or its count numeral would paint on `rect`. Coordinates match the byline:
// `left` is the row's left in font px, `sigY` is the painted signature's y, and `scale` is the extra
// CSS scale the row uses when the cluster is wider than the clip (1 on a normal date line).
// The signature block is not included — the poem layout already keeps it off the seal.
export function reactionHitsRect(layout, left, sigY, rect, scale = 1) {
  if (!rect || sigY == null || !(scale > 0)) return false;
  const rowTop = sigY - layout.shift, textH = layout.textH ?? 13;
  for (const it of layout.items) {
    const b = it.type === 'glyph' ? glyphFrameBox(it, layout.scale)
      : it.count ? { x: it.x, y: it.y, w: it.w, h: textH } : null;
    if (!b) continue;
    const box = { x: left + b.x * scale, y: rowTop + b.y * scale, w: b.w * scale, h: b.h * scale };
    if (rectsOverlap(box, rect)) return true;
  }
  return false;
}
function signatureHitsRect(layout, left, sigY, rect, scale = 1) {
  if (!rect || sigY == null) return false;
  const rowTop = sigY - layout.shift, textH = layout.textH ?? 13;
  for (const it of layout.items) {
    if (it.type !== 'text' || it.count) continue;
    const box = { x: left + it.x * scale, y: rowTop + it.y * scale, w: it.w * scale, h: textH * scale };
    if (rectsOverlap(box, rect)) return true;
  }
  return false;
}

// Pick a side and, when a full set of counts still cannot fit, pack the same glyphs a little tighter.
// `ok` means the visible row (text plus canvas bleed) sits inside the limits.
// `avoid`, when passed with `sigY`, is a font-px rect the faces and their counts must not paint on
// (the number seal). The seal wins over the left-side preference: a side that would land on it is
// skipped, then the other side, then the tighter gaps, then a scale-down of that clear side.
// With no `avoid`, the placement is the viewport pack from 15.11c.
function fitBylineOpen(opts) {
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
function gluedLeft(side, layout, opts) {
  return side === 'before' ? opts.dateRight - layout.w : opts.dateLeft - layout.dateX;
}
function inView(left, layout, opts, scale = 1) {
  const visualL = left - layout.bleedL * scale, visualR = left + (layout.w + layout.bleedR) * scale;
  return visualL >= opts.leftLimit - 0.5 && visualR <= opts.rightLimit + 0.5;
}
function slidLeft(left, layout, opts) {
  let x = left;
  if (x - layout.bleedL < opts.leftLimit) x = opts.leftLimit + layout.bleedL;
  if (x + layout.w + layout.bleedR > opts.rightLimit) x = Math.max(opts.leftLimit + layout.bleedL, opts.rightLimit - layout.bleedR - layout.w);
  return x;
}
// The same pin renderRow used to apply when the cluster was wider than the phone.
function pinScale(layout, opts) {
  const span = opts.rightLimit - opts.leftLimit;
  const visualW = layout.w + layout.bleedL + layout.bleedR;
  const scale = rowFitScale(visualW, 0, span);
  return { scale, left: scale === 1 ? null : opts.leftLimit + layout.bleedL * scale };
}
function pack(side, layout, left, scale) {
  return { placed: { side, left }, layout, ok: true, scale };
}
function clearOf(layout, left, opts, scale, natural) {
  if (reactionHitsRect(layout, left, opts.sigY, opts.avoid, scale)) return false;
  if (Math.abs(left - natural) > 0.5 && signatureHitsRect(layout, left, opts.sigY, opts.avoid, scale)) return false;
  return true;
}

// Viewport pack, then a hard exclusion for `opts.avoid` (the seal). Prefer the left of the
// signature block, then the right, at the open gaps and then the tight ones. A clear side that
// still overflows the clip scales down in place so the signature stays put. Only if that cannot
// clear the seal does the row slide, and the slide is not allowed to put the signature on the seal.
function fitBylineClear(opts) {
  const open = fitBylineOpen(opts);
  if (open.ok && !reactionHitsRect(open.layout, open.placed.left, opts.sigY, opts.avoid)) return { ...open, scale: 1 };
  if (!reactionHitsRect(open.layout, open.placed.left, opts.sigY, opts.avoid)) {
    const pinned = pinScale(open.layout, opts);
    const left = pinned.left == null ? open.placed.left : pinned.left;
    if (!reactionHitsRect(open.layout, left, opts.sigY, opts.avoid, pinned.scale)
        && !signatureHitsRect(open.layout, left, opts.sigY, opts.avoid, pinned.scale)) {
      return { placed: { side: open.placed.side, left }, layout: open.layout, ok: true, scale: pinned.scale };
    }
  }
  const gapSets = [LOOSE_GAPS, TIGHT_GAPS];
  const layouts = gapSets.map(gaps => ({
    gaps,
    before: layoutByline({ ...opts, gaps, side: 'before' }),
    after: layoutByline({ ...opts, gaps, side: 'after' }),
  }));
  for (const { before, after } of layouts) {
    for (const [side, layout] of [['before', before], ['after', after]]) {
      const left = gluedLeft(side, layout, opts);
      if (inView(left, layout, opts) && clearOf(layout, left, opts, 1, left)) return pack(side, layout, left, 1);
    }
  }
  for (const { before, after } of layouts) {
    for (const [side, layout] of [['before', before], ['after', after]]) {
      const natural = gluedLeft(side, layout, opts);
      const left = slidLeft(natural, layout, opts);
      if (Math.abs(left - natural) <= 0.5) continue;
      if (inView(left, layout, opts) && clearOf(layout, left, opts, 1, natural)) return pack(side, layout, left, 1);
    }
  }
  let best = null;
  const offer = (cand, natural) => {
    if (!best || cand.scale > best.scale + 1e-6) { best = { ...cand, natural }; return; }
    if (cand.scale < best.scale - 1e-6) return;
    const preferBefore = cand.side === 'before' && best.side !== 'before';
    const closer = Math.abs(cand.left - natural) + 0.5 < Math.abs(best.left - best.natural);
    if (preferBefore || closer) best = { ...cand, natural };
  };
  for (const { before, after } of layouts) {
    for (const [side, layout] of [['before', before], ['after', after]]) {
      const natural = gluedLeft(side, layout, opts);
      for (let i = 40; i >= 1; i--) {
        const scale = i / 40;
        if (inView(natural, layout, opts, scale) && clearOf(layout, natural, opts, scale, natural)) {
          offer({ side, layout, left: natural, scale }, natural);
          break;
        }
      }
    }
  }
  if (best && best.scale > 0.99) return pack(best.side, best.layout, best.left, 1);
  if (!best) {
    for (const { before, after } of layouts) {
      for (const [side, layout] of [['before', before], ['after', after]]) {
        const natural = gluedLeft(side, layout, opts);
        let x0 = Infinity, x1 = -Infinity;
        for (const it of layout.items) {
          if (it.type !== 'glyph' && !it.count) continue;
          const b = it.type === 'glyph' ? glyphFrameBox(it, layout.scale) : { x: it.x, w: it.w };
          x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x + b.w);
        }
        for (let i = 40; i >= 1; i--) {
          const scale = i / 40;
          const minL = opts.leftLimit + layout.bleedL * scale;
          const maxL = opts.rightLimit - (layout.w + layout.bleedR) * scale;
          if (maxL < minL - 0.5) continue;
          const clamp = v => Math.min(maxL, Math.max(minL, v));
          const lefts = [clamp(natural)];
          if (opts.avoid && x1 > x0) {
            lefts.push(clamp(opts.avoid.x + opts.avoid.w - x0 * scale));
            lefts.push(clamp(opts.avoid.x - x1 * scale));
          }
          let placed = false;
          for (const left of lefts) {
            if (!inView(left, layout, opts, scale) || !clearOf(layout, left, opts, scale, natural)) continue;
            offer({ side, layout, left, scale }, natural);
            placed = true;
            break;
          }
          if (placed) break;
        }
      }
    }
  }
  if (best) return pack(best.side, best.layout, best.left, best.scale > 0.99 ? 1 : best.scale);
  // Nothing stays inside the clip and off the seal. Keep the faces off the seal anyway.
  for (const { before, after } of layouts) {
    for (const [side, layout] of [['before', before], ['after', after]]) {
      const left = gluedLeft(side, layout, opts);
      if (clearOf(layout, left, opts, 1, left)) return { placed: { side, left }, layout, ok: false, scale: 1 };
    }
  }
  return { ...open, scale: 1, ok: false };
}
export function fitByline(opts) {
  if (!opts.avoid || opts.sigY == null) return fitBylineOpen(opts);
  return fitBylineClear(opts);
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
  // A reply has no seal. Hold reports it; it does not open the reaction picker or comment mode.
  if (rec.post?.parentId) return { el, rec, stamp: false, comment: true };
  const p = { x: e.clientX, y: e.clientY };
  const view = feed.viewOf(el);
  let stamp = !!(view && pointInRect(p, sealScreenRect(rec, view), slop));
  const mark = el.querySelector?.('.rpt-mark');
  if (mark) stamp = stamp || pointInRect(p, mark.getBoundingClientRect(), slop);
  return { el, rec, stamp };
}
