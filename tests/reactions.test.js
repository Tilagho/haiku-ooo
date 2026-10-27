// Round 15.11: reaction set, one-per-person toggle, date-line layout, seal-vs-body hit target.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { measure, font, sealDims } from '../src/brush-text.js';
import {
  RX_ORDER, RX_LABEL, GLYPH_BOX, emptyCounts, nextKind, applyCounts, hasReactions, layoutByline,
  reactionScale, pickerScale, sealScreenRect, pointInRect,
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

ok('date line: bare glyphs with counts, zeros hidden, date kept at the right edge', () => {
  const Sm = font('small');
  const measureText = t => measure(t, Sm);
  const counts = { cry: 1, eyes: 0, heart: 0, star: 2, flushed: 0, relieved: 0 };
  const date = 'Oct 24', author = '';
  const row = layoutByline({ counts, author, date, measure: measureText, scale: 1.5, ascent: Sm.ascent, descent: Sm.descent });
  assert.deepEqual(row.kinds, ['cry', 'star']);
  const texts = row.items.filter(i => i.type === 'text').map(i => i.t);
  assert.deepEqual(texts, ['1', '2', '· ', 'Oct 24']);
  assert.equal(texts.at(-1), 'Oct 24');
  assert.ok(!texts.some(t => t === '0'));
  const dateItem = row.items.find(i => i.date);
  assert.equal(dateItem.x + dateItem.w, row.w, 'the date ends the cluster, so it can stay put against the old byline');
  assert.ok(row.items.some(i => i.type === 'glyph' && i.kind === 'star' && i.h > Sm.ascent));
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
