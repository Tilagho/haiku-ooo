// Round 15.12g: a date-line count of 1 is not painted. From 2 up the numeral is centered
// under its face (Teams-style), a short gap below the resting box. The text canvas paints
// above the glyph, so a falling drip cannot cover the digit.
// The 15.12f seal clearance stays: a face and its numeral still leave the hanko.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { font, measure, sealDims } from '../src/brush-text.js';
import { poemLayouts, poemStyle, sealOrder } from '../src/scroll-engine2.js';
import {
  COUNT_FROM, COUNT_UNDER_ART, DATE_GAP, RX_ORDER,
  fitByline, layoutByline, reactionHitsRect,
} from '../src/react-data.js';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

const Sm = font('small');
const measureText = t => measure(t, Sm);
const FROG = 'an old silent pond\na frog jumps into the pond\nsplash silence again';
const scale = 1.5;
const cap = 7;

function row(counts, extra = {}) {
  return layoutByline({
    counts, author: extra.author ?? '', date: extra.date ?? 'Oct 26',
    measure: measureText, scale, ascent: Sm.ascent, descent: Sm.descent, cap, ...extra,
  });
}
function pair(layout, kind) {
  const glyph = layout.items.find(i => i.kind === kind);
  const count = layout.items.find(i => i.count && i.x + i.w / 2 >= glyph.x && i.x + i.w / 2 <= glyph.x + glyph.w + 0.6
    && i.y >= glyph.y);
  return { glyph, count };
}

ok('a count of 1 paints the face and no numeral, for every kind', () => {
  assert.equal(COUNT_FROM, 2);
  for (const k of RX_ORDER) {
    const counts = { cry: 0, eyes: 0, heart: 0, star: 0, flushed: 0, relieved: 0, [k]: 1 };
    const layout = row(counts, { author: 'kitty G, ' });
    assert.deepEqual(layout.kinds, [k]);
    assert.equal(layout.items.some(i => i.count), false, k);
    assert.equal(layout.items.filter(i => i.type === 'glyph').length, 1, k);
    const glyph = layout.items.find(i => i.type === 'glyph');
    const author = layout.items.find(i => i.t === 'kitty G, ');
    assert.equal(author.x, glyph.x + glyph.w + DATE_GAP, k);
  }
});

ok('a count of 2 or more is centered under the face, the same short gap for every kind', () => {
  const inkTop = Sm.ascent - cap;
  for (const k of RX_ORDER) {
    for (const num of [2, 12]) {
      const counts = { cry: 0, eyes: 0, heart: 0, star: 0, flushed: 0, relieved: 0, [k]: num };
      const layout = row(counts, { author: 'kitty G, ' });
      const { glyph, count } = pair(layout, k);
      assert.equal(count.t, String(num), k + ' ' + num);
      const midG = glyph.x + glyph.w / 2, midC = count.x + count.w / 2;
      assert.ok(Math.abs(midG - midC) <= 0.51, `${k} centered ${midC} vs ${midG}`);
      assert.ok(count.x < glyph.x + glyph.w && count.x + count.w > glyph.x, `${k} sits under the face, not beside it`);
      const ink = count.y + inkTop;
      const paper = glyph.y + glyph.h + COUNT_UNDER_ART * scale;
      assert.ok(ink + 1e-6 >= paper, `${k} paper under the face`);
      assert.ok(ink <= paper + 1, `${k} the gap stays snug, including relieved`);
      assert.ok(ink >= glyph.y + glyph.h, `${k} the digit is below the resting face`);
      const author = layout.items.find(i => i.t === 'kitty G, ');
      const runRight = Math.max(...layout.items.filter(i => i.type === 'glyph' || i.count).map(i => i.x + i.w));
      assert.equal(author.x, runRight + DATE_GAP, 'the name follows the cluster, not a numeral beside the cheek');
      assert.ok(count.x + count.w <= author.x, k);
    }
  }
});

ok('a mixed row hides the 1s and stacks every numeral under its own face', () => {
  const counts = { cry: 1, eyes: 2, heart: 1, star: 4, flushed: 12, relieved: 1 };
  const layout = row(counts, { author: 'moth, ' });
  assert.deepEqual(layout.kinds, ['cry', 'eyes', 'heart', 'star', 'flushed', 'relieved']);
  const texts = layout.items.filter(i => i.type === 'text' && !i.date).map(i => i.t);
  assert.deepEqual(texts, ['2', '4', '12', 'moth, ']);
  for (const k of layout.kinds) {
    const { glyph, count } = pair(layout, k);
    if ((counts[k] | 0) < 2) assert.equal(count, undefined, k);
    else {
      assert.equal(count.t, String(counts[k]));
      assert.ok(Math.abs((glyph.x + glyph.w / 2) - (count.x + count.w / 2)) <= 0.51, k);
      assert.ok(count.y + (Sm.ascent - cap) >= glyph.y + glyph.h, k);
    }
  }
  const date = layout.items.find(i => i.date);
  assert.equal(date.x, layout.items.find(i => i.t === 'moth, ').x + layout.items.find(i => i.t === 'moth, ').w);
  assert.ok(layout.h > layout.textH, 'the row grows downward to hold the numerals');
});

ok('relieved shares the other faces\' gap, and a packed row still centers the digits', () => {
  const relieved = row({ relieved: 2 });
  const flushed = row({ flushed: 2 });
  const gap = layout => {
    const { glyph, count } = pair(layout, layout.kinds[0]);
    return count.y + (Sm.ascent - cap) - (glyph.y + glyph.h);
  };
  assert.ok(Math.abs(gap(relieved) - gap(flushed)) <= 1, 'the drip does not drop the relieved count');
  const counts = { cry: 12, eyes: 12, heart: 12, star: 12, flushed: 12, relieved: 12, poop: 12, fire: 12 };
  const tight = row(counts, { gaps: { glyph: 1, kind: 1, date: 3 } });
  for (const k of RX_ORDER) {
    const p = pair(tight, k);
    assert.equal(p.count.t, '12');
    assert.ok(Math.abs((p.glyph.x + p.glyph.w / 2) - (p.count.x + p.count.w / 2)) <= 0.51, k);
  }
});

ok('a phone star of count 1 still leaves a left-hand seal, and a numeral under a face does too', () => {
  const post = { text: FROG, author: '', createdAt: Date.UTC(2026, 9, 24), id: 'frog88' };
  const style = poemStyle(31, 5, post.id);
  style.sealOrder = sealOrder(5, post.id, null);
  const [L] = poemLayouts(post, 5, style);
  const [sw, sh] = sealDims(5);
  const avoid = { x: L.seal.x, y: L.seal.y, w: sw, h: sh };
  assert.equal(L.sealPos, 'left-3');
  const SmDate = 'Oct 24';
  const sigW = measure(L.sig.t, Sm), dateW = measure(SmDate, Sm);
  const base = {
    author: '', date: SmDate, measure: measureText, scale: 4 / 3,
    ascent: Sm.ascent, descent: Sm.descent,
    dateLeft: L.sig.x + sigW - dateW, dateRight: L.sig.x + sigW,
    leftLimit: -8.67, rightLimit: 220, sigY: L.sig.y, avoid,
  };
  const one = fitByline({ ...base, counts: { star: 1 } });
  assert.equal(one.layout.items.find(i => i.count), undefined);
  assert.equal(reactionHitsRect(one.layout, one.placed.left, L.sig.y, avoid, one.scale), false);
  const two = fitByline({ ...base, counts: { star: 2 } });
  assert.equal(two.layout.items.find(i => i.count).t, '2');
  assert.equal(reactionHitsRect(two.layout, two.placed.left, L.sig.y, avoid, two.scale), false);
  const glyph = two.layout.items.find(i => i.kind === 'star');
  const count = two.layout.items.find(i => i.count);
  assert.ok(count.y > glyph.y);
  const date = two.layout.items.find(i => i.date);
  assert.ok(glyph.x >= date.x + date.w || glyph.x + glyph.w <= date.x);
});

ok('cache-bust is 15.12g on the date line only', () => {
  const html = src('index.html'), app = src('src/app.js'), rx = src('src/reactions.js');
  assert.ok(/src\/app\.js\?v=15\.14d"/.test(html));
  assert.ok(/reactions\.js\?v=15\.14/.test(app));
  assert.ok(/react-data\.js\?v=15\.14/.test(rx));
  assert.ok(/react-glyphs\.js\?v=15\.14/.test(rx));
  assert.ok(/report\.js\?v=15\.13/.test(app));
  assert.ok(/sound-wire\.js\?v=15\.14/.test(app));
  assert.ok(/sound\.js\?v=15\.14/.test(src('src/sound-wire.js')));
  assert.ok(/inky\.js\?v=15\.12c/.test(app));
  assert.ok(/z-index: 1/.test(rx) && /z-index: 0/.test(rx), 'the numeral paints above the face');
  assert.ok(/COUNT_FROM/.test(src('src/react-data.js')));
  assert.ok(/COUNT_UNDER_ART/.test(src('src/react-data.js')));
  assert.ok(!/firestore\.rules/.test(app + rx + src('src/react-data.js')));
});

console.log(n + ' round 15.12g checks passed');
