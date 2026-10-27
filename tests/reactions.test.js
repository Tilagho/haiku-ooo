// Round 15.11: reaction set, one-per-person toggle, date-line layout, seal-vs-body hit target.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { measure, font, sealDims } from '../src/brush-text.js';
import {
  RX_ORDER, RX_LABEL, GLYPH_BOX, emptyCounts, nextKind, applyCounts, hasReactions, layoutByline, placeByline, fitByline, rowFitScale,
  reactionScale, pickerScale, pickerGlyphOrigin, PICKER_CELL, DATE_GAP, GLYPH_PAD, glyphHang, sealScreenRect, pointInRect,
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
  assert.deepEqual(texts, ['2', 'Oct 24'], 'a count of 1 is the glyph alone');
  assert.ok(!row.items.some(i => String(i.t || '').includes('·')));
  assert.ok(!texts.some(t => t === '0' || t === '1'));
  const star = row.items.find(i => i.kind === 'star'), starCount = row.items.find(i => i.count);
  const starBoxR = star.x + star.w + glyphHang('star', 1.5).R;
  assert.ok(starCount.x >= starBoxR + row.gaps.glyph - 0.01, 'the 2 starts clear of the star frame');
  const dateItem = row.items.find(i => i.date);
  const lastCount = [...row.items].reverse().find(i => i.count);
  assert.equal(dateItem.x, lastCount.x + lastCount.w + DATE_GAP, 'a gap, not a bullet, separates the count and the date');
  assert.equal(dateItem.x + dateItem.w, row.w, 'the date ends the cluster, so it can stay put against the old byline');
  assert.ok(row.items.some(i => i.type === 'glyph' && i.kind === 'star' && i.h > Sm.ascent));
});

ok('a count of 1 is not painted, and 2+ stays clear of every glyph canvas', () => {
  const Sm = font('small');
  const measureText = t => measure(t, Sm);
  const scale = 1.5;
  const layout = (counts, gaps) => layoutByline({
    counts, author: '', date: 'Oct 24', measure: measureText, scale,
    ascent: Sm.ascent, descent: Sm.descent, gaps,
  });
  const box = (it) => { const h = glyphHang(it.kind, scale); return { L: it.x - h.L, R: it.x + it.w + h.R }; };
  const eyes = layout({ cry: 0, eyes: 1, heart: 0, star: 0, flushed: 0, relieved: 0 });
  assert.deepEqual(eyes.items.filter(i => i.type === 'text').map(i => i.t), ['Oct 24']);
  assert.equal(eyes.items.filter(i => i.count).length, 0, 'one eyes reaction shows the glyph only');
  const row = layout({ cry: 1, eyes: 2, heart: 4, star: 12, flushed: 1, relieved: 9 });
  assert.deepEqual(row.items.filter(i => i.count).map(i => i.t), ['2', '4', '12', '9']);
  const glyphs = row.items.filter(i => i.type === 'glyph');
  const date = row.items.find(i => i.date);
  for (const c of row.items.filter(i => i.count)) {
    for (const g of glyphs) {
      const b = box(g);
      const clear = c.x >= b.R + row.gaps.glyph - 0.05 || c.x + c.w <= b.L - row.gaps.glyph + 0.05;
      assert.ok(clear, `count ${c.t} overlaps the ${g.kind} canvas`);
    }
  }
  for (let i = 0; i < glyphs.length; i++) for (let j = i + 1; j < glyphs.length; j++) {
    const a = box(glyphs[i]), b = box(glyphs[j]);
    assert.ok(a.R <= b.L + 0.05 || b.R <= a.L + 0.05, `${glyphs[i].kind} canvas overlaps ${glyphs[j].kind}`);
  }
  for (const g of glyphs) {
    const b = box(g);
    assert.ok(date.x >= b.R + row.gaps.date - 0.05 || date.x + date.w <= b.L + 0.05, `the date overlaps ${g.kind}`);
  }
  const tight = layout({ cry: 12, eyes: 12, heart: 12, star: 12, flushed: 12, relieved: 12 }, { glyph: 1, kind: 1, date: 3 });
  const tg = tight.items.filter(i => i.type === 'glyph');
  for (const c of tight.items.filter(i => i.count)) for (const g of tg) {
    const b = box(g);
    assert.ok(c.x >= b.R + tight.gaps.glyph - 0.05 || c.x + c.w <= b.L - tight.gaps.glyph + 0.05, `tight count overlaps ${g.kind}`);
  }
  const js = src('src/reactions.js');
  const start = js.indexOf('row.replaceChildren()');
  const paint = js.slice(start, js.indexOf('row.dataset.key = key', start));
  assert.ok(paint.indexOf('row.appendChild(tx)') < paint.indexOf('row.appendChild(cv)'));
  assert.ok(paint.indexOf('row.appendChild(cv)') < paint.indexOf('row.appendChild(ct)'), 'the count canvas is painted above the glyphs');
  assert.ok(/if \(it\.count\) drawLine\(cbuf/.test(paint) && /halo: 1/.test(paint));
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
  // Six faces with two-digit counts clear of their frames run ~391 font px loose and ~377 packed.
  // This window sits between those, so only the tight gaps fit.
  const crowded = fitByline({
    ...base, counts: { cry: 12, eyes: 12, heart: 12, star: 12, flushed: 12, relieved: 12 },
    author: 'sample, ', date: 'Oct 24', dateLeft: 240, dateRight: 272, leftLimit: 0, rightLimit: 385,
  });
  assert.equal(crowded.ok, true);
  assert.equal(crowded.layout.gaps.date, 3, 'gaps tighten only so the whole set still fits');
  const cL = crowded.placed.left - crowded.layout.bleedL, cR = crowded.placed.left + crowded.layout.w + crowded.layout.bleedR;
  assert.ok(cL >= -0.5 && cR <= 385.5, `visible row ${cL}..${cR} stays inside 0..385`);
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
