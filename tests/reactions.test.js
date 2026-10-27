// Round 15.11: reaction set, one-per-person toggle, date-line layout, seal-vs-body hit target.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { measure, font, sealDims } from '../src/brush-text.js';
import {
  RX_ORDER, RX_LABEL, GLYPH_BOX, emptyCounts, nextKind, applyCounts, hasReactions, layoutByline, placeByline, fitByline, rowFitScale,
  reactionScale, pickerScale, pickerGlyphOrigin, PICKER_CELL, DATE_GAP, GLYPH_PAD, sealScreenRect, pointInRect,
} from '../src/react-data.js';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

ok('the six approved glyphs, star in, thumbs out', () => {
  assert.deepEqual(RX_ORDER, ['cry', 'eyes', 'heart', 'star', 'flushed', 'relieved']);
  assert.equal(RX_LABEL.heart, 'broken heart');
  assert.equal(RX_LABEL.star, 'star');
  const blob = src('src/react-data.js') + src('src/reactions.js') + src('src/react-glyphs.js');
  assert.ok(!/thumbs|fist|👍/.test(blob), 'thumbs and the fist stay retired');
  for (const k of RX_ORDER) assert.ok(GLYPH_BOX[k].ow > 8 && GLYPH_BOX[k].oh > 8);
});

ok('one reaction per person: tap replaces, tap again clears, counts stay honest', () => {
  let c = emptyCounts(), mine = null;
  const tap = kind => { const next = nextKind(mine, kind); c = applyCounts(c, mine, next); mine = next; };
  tap('star'); assert.equal(mine, 'star'); assert.equal(c.star, 1);
  tap('cry'); assert.equal(mine, 'cry'); assert.equal(c.star, 0); assert.equal(c.cry, 1);
  tap('cry'); assert.equal(mine, null); assert.equal(c.cry, 0);
  assert.equal(hasReactions(c), false);
  c = applyCounts({ star: 1 }, 'star', null); assert.equal(c.star, 0, 'does not go negative');
  tap('heart'); assert.equal(c.heart, 1); assert.ok(hasReactions(c));
});

ok('date line: bare glyphs with counts, no bullet, date kept at the right edge', () => {
  const Sm = font('small');
  const measureText = t => measure(t, Sm);
  const counts = { cry: 1, eyes: 0, heart: 0, star: 2, flushed: 0, relieved: 0 };
  const date = 'Oct 24', author = '';
  const row = layoutByline({ counts, author, date, measure: measureText, scale: 1.5, ascent: Sm.ascent, descent: Sm.descent });
  assert.equal(row.side, 'before');
  assert.deepEqual(row.kinds, ['cry', 'star']);
  const texts = row.items.filter(i => i.type === 'text').map(i => i.t);
  assert.deepEqual(texts, ['1', '2', 'Oct 24']);
  assert.ok(!row.items.some(i => String(i.t || '').includes('·')));
  assert.ok(!texts.some(t => t === '0'));
  const dateItem = row.items.find(i => i.date);
  const lastCount = [...row.items].reverse().find(i => i.count);
  assert.equal(dateItem.x, lastCount.x + lastCount.w + DATE_GAP, 'a gap, not a bullet, separates the count and the date');
  assert.equal(dateItem.x + dateItem.w, row.w, 'the date ends the cluster, so it can stay put against the old byline');
  assert.ok(row.items.some(i => i.type === 'glyph' && i.kind === 'star' && i.h > Sm.ascent));
});

ok('a signature and its date stay one block, glyphs outside it', () => {
  const Sm = font('small');
  const measureText = t => measure(t, Sm);
  const base = {
    counts: { cry: 0, eyes: 0, heart: 0, star: 1, flushed: 0, relieved: 0 },
    author: 'sample, ', date: 'Oct 24', measure: measureText, scale: 1.5, ascent: Sm.ascent, descent: Sm.descent,
  };
  const flush = layout => {
    const author = layout.items.find(i => i.t === 'sample, ');
    const date = layout.items.find(i => i.date);
    const glyph = layout.items.find(i => i.type === 'glyph');
    assert.ok(author && date && glyph);
    assert.equal(date.x, author.x + author.w, 'the date follows the name with no room for a glyph');
    assert.ok(glyph.x + glyph.w <= author.x || glyph.x >= date.x + date.w, 'the star is outside the signature block');
    assert.ok(!layout.items.some(i => String(i.t || '').includes('·')));
  };
  const before = layoutByline({ ...base, side: 'before' });
  const after = layoutByline({ ...base, side: 'after' });
  flush(before); flush(after);
  assert.ok(before.items.find(i => i.type === 'glyph').x < before.items.find(i => i.t === 'sample, ').x);
  assert.ok(after.items.find(i => i.type === 'glyph').x > after.items.find(i => i.date).x);
  const roomy = fitByline({ ...base, dateLeft: 160, dateRight: 192, leftLimit: 0, rightLimit: 400 });
  assert.equal(roomy.layout.side, 'before', 'with room, glyphs sit left of the whole name and date');
  flush(roomy.layout);
  const tight = fitByline({ ...base, dateLeft: 40, dateRight: 72, leftLimit: 0, rightLimit: 400 });
  assert.equal(tight.layout.side, 'after', 'a name already at the left edge keeps its date and puts glyphs on the right');
  flush(tight.layout);
  assert.equal(tight.ok, true);
});

ok('date line flips to the right of the date when the left side would leave the poem', () => {
  const Sm = font('small');
  const measureText = t => measure(t, Sm);
  const counts = { cry: 0, eyes: 0, heart: 0, star: 1, flushed: 0, relieved: 0 };
  const common = { counts, author: '', date: 'Oct 24', measure: measureText, scale: 1.5, ascent: Sm.ascent, descent: Sm.descent };
  const before = layoutByline({ ...common, side: 'before' });
  const after = layoutByline({ ...common, side: 'after' });
  assert.ok(after.dateX < after.items.find(i => i.type === 'glyph').x);
  assert.ok(!after.items.some(i => String(i.t || '').includes('·')));
  const roomy = placeByline({
    beforeW: before.w, afterW: after.w, afterDateX: after.dateX,
    dateLeft: 80, dateRight: 112, leftLimit: 0, rightLimit: 300,
  });
  assert.equal(roomy.side, 'before');
  assert.equal(roomy.left, 112 - before.w);
  const tight = placeByline({
    beforeW: before.w, afterW: after.w, afterDateX: after.dateX,
    dateLeft: 10, dateRight: 42, leftLimit: 0, rightLimit: 300,
  });
  assert.equal(tight.side, 'after', 'glyphs move to the right of a date that is already at the left edge');
  assert.equal(tight.left, 10 - after.dateX);
  const slide = placeByline({
    beforeW: 100, afterW: 180, afterDateX: 0,
    dateLeft: 40, dateRight: 60, leftLimit: 0, rightLimit: 200,
  });
  assert.equal(slide.side, 'after');
  assert.equal(slide.left, 20, 'the roomier side slides until the row ends at the right limit');
  assert.ok(slide.left >= 0 && slide.left + 180 <= 200);
  // The resting ink would fit, but the frame canvas hangs off the left. That still counts as leaving.
  const hung = placeByline({
    beforeW: 50, afterW: 50, afterDateX: 20,
    dateLeft: 50, dateRight: 80, leftLimit: 0, rightLimit: 200,
    beforeBleedL: 40, beforeBleedR: 0, afterBleedL: 0, afterBleedR: 0,
  });
  assert.equal(hung.side, 'after', 'a glyph canvas past the left edge moves the glyphs to the right of the date');
  assert.equal(hung.left, 30);
});

ok('a full set of counts stays inside the viewing area, packed tighter only when it has to', () => {
  const Sm = font('small');
  const measureText = t => measure(t, Sm);
  const base = { measure: measureText, scale: 1.5, ascent: Sm.ascent, descent: Sm.descent };
  const edge = fitByline({
    ...base, counts: { cry: 0, eyes: 0, heart: 0, star: 1, flushed: 0, relieved: 0 },
    author: '', date: 'Oct 24', dateLeft: 8, dateRight: 40, leftLimit: 0, rightLimit: 300,
  });
  assert.equal(edge.ok, true);
  assert.equal(edge.layout.side, 'after');
  assert.equal(edge.layout.gaps.date, DATE_GAP, 'one glyph still gets the open gap');
  assert.ok(!edge.layout.items.some(i => String(i.t || '').includes('·')));
  const glyph = edge.layout.items.find(i => i.type === 'glyph'), date = edge.layout.items.find(i => i.date);
  assert.ok(glyph.x > date.x + date.w, 'the star sits to the right of a date that is already at the left edge');
  const visualL = edge.placed.left - edge.layout.bleedL, visualR = edge.placed.left + edge.layout.w + edge.layout.bleedR;
  assert.ok(visualL >= -0.5 && visualR <= 300.5);
  const crowded = fitByline({
    ...base, counts: { cry: 12, eyes: 12, heart: 12, star: 12, flushed: 12, relieved: 12 },
    author: 'sample, ', date: 'Oct 24', dateLeft: 240, dateRight: 272, leftLimit: 0, rightLimit: 300,
  });
  assert.equal(crowded.ok, true);
  assert.equal(crowded.layout.gaps.date, 3, 'gaps tighten only so the whole set still fits');
  const cL = crowded.placed.left - crowded.layout.bleedL, cR = crowded.placed.left + crowded.layout.w + crowded.layout.bleedR;
  assert.ok(cL >= -0.5 && cR <= 300.5, `visible row ${cL}..${cR} stays inside 0..300`);
  const stillWide = fitByline({
    ...base, counts: { cry: 12, eyes: 12, heart: 12, star: 12, flushed: 12, relieved: 12 },
    author: 'sample, ', date: 'Oct 24', dateLeft: 200, dateRight: 232, leftLimit: 0, rightLimit: 260,
  });
  assert.equal(stillWide.ok, false);
  const wideW = stillWide.layout.w + stillWide.layout.bleedL + stillWide.layout.bleedR;
  const shrink = rowFitScale(wideW, 0, 260);
  assert.ok(shrink < 1 && wideW * shrink <= 260.5, 'a row wider than the phone scales down instead of clipping');
  const roomy = fitByline({
    ...base, counts: { cry: 1, eyes: 1, heart: 1, star: 1, flushed: 1, relieved: 1 },
    author: '', date: 'Oct 24', dateLeft: 200, dateRight: 232, leftLimit: 0, rightLimit: 400,
  });
  assert.equal(roomy.layout.side, 'before');
  assert.equal(roomy.layout.gaps.kind, 4, 'a row with room keeps the open spacing');
});

ok('pixel snap: inline art px is ~2 CSS px, the picker uses the seal pixel (~3 CSS px), both whole device px', () => {
  const inline = reactionScale(390, 3);
  assert.equal(inline.rk, 6); assert.equal(inline.css, 2); assert.equal(inline.fontPerArt, 1.5);
  const picker = pickerScale(390, 3);
  assert.equal(picker.rk, 9); assert.equal(picker.css, 3);
  const d2 = reactionScale(390, 2);
  assert.equal(d2.rk % 1, 0); assert.equal(d2.rk, 4, 'dpr 2 snaps off the half pixel');
  assert.equal(pickerScale(390, 2).css, 3, 'seal block stays 3 CSS px at dpr 2');
});

ok('phone picker cells are one square and every face is centered in it', () => {
  assert.equal(PICKER_CELL, 17);
  const css = 3;
  for (const k of RX_ORDER) {
    const o = pickerGlyphOrigin(k, css), g = GLYPH_BOX[k];
    assert.equal(o.cell, PICKER_CELL * css);
    assert.equal(o.left + (GLYPH_PAD + g.ox + g.ow / 2) * css, o.cell / 2);
    assert.equal(o.top + (GLYPH_PAD + g.oy + g.oh / 2) * css, o.cell / 2);
  }
  const star = pickerGlyphOrigin('star', css);
  assert.equal(star.left + (GLYPH_PAD + GLYPH_BOX.star.ox) * css, 0, 'the star fills the cell');
  const js = src('src/reactions.js');
  assert.ok(js.includes('gap: 2px; padding: 4px'), 'the phone grid gutters are tighter than the row');
  assert.ok(js.includes(".rx-grid.is-row { grid-template-columns: repeat(6, auto); }"), 'the wide row stays on its own track');
});

ok('seal hit box is the stamp, not the whole poem', () => {
  const n = 13, [sw, sh] = sealDims(n);
  const rect = sealScreenRect({
    poem: { layout: { seal: { x: 40, y: 80 }, u: 1.5 }, n }, pad: 6,
    el: { getBoundingClientRect: () => ({ left: 10, top: 20 }) },
  }, { fontScale: () => 1.5, host: { clientWidth: 390 } });
  assert.equal(rect.left, 10 + (40 + 6) * 1.5);
  assert.equal(rect.width, sw * 1.5);
  assert.equal(rect.height, sh * 1.5);
  assert.equal(pointInRect({ x: rect.left + 2, y: rect.top + 2 }, rect), true);
  assert.equal(pointInRect({ x: rect.left - 40, y: rect.top }, rect, 8), false, 'the poem text is not the stamp');
  const report = src('src/report.js'), reactions = src('src/reactions.js');
  assert.ok(/stampAt/.test(report) && /poemZone/.test(report), 'report long-press is gated on the seal');
  assert.ok(!/anywhere on the shared scroll: the newest block and every older one/.test(report));
  assert.ok(/if \(!z \|\| z\.stamp\) return/.test(reactions), 'the reaction hold skips the seal');
});

ok('shipped strips are the six faces, linked so the dist build keeps them', () => {
  const js = src('src/react-glyphs.js');
  for (const f of ['cry', 'eyes', 'broken-heart', 'star', 'flushed', 'relieved']) {
    assert.ok(js.includes(`assets/reactions/${f}-frames-1x.png`), f);
    assert.ok(readFileSync(new URL(`../assets/reactions/${f}-frames-1x.png`, import.meta.url)).length > 50);
  }
});

console.log(n + ' reaction checks passed');
