// Round 15.12g: a date-line count of 1 is not painted. From 2 up the numeral sits clear
// of the face, including the playing ink (flushed eyes, the heart's halves), and the
// text canvas paints above the glyph so a digit cannot land behind the art.
// The 15.12f seal clearance stays: a face still leaves the hanko.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { font, measure, sealDims } from '../src/brush-text.js';
import { poemLayouts, poemStyle, sealOrder } from '../src/scroll-engine2.js';
import {
  COUNT_AIR_ART, COUNT_CLEAR_ART, COUNT_FROM, DATE_GAP, GLYPH_BOX, GLYPH_INK_RIGHT, RX_ORDER,
  countClearance, fitByline, layoutByline, reactionHitsRect,
} from '../src/react-data.js';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

const Sm = font('small');
const measureText = t => measure(t, Sm);
const FROG = 'an old silent pond\na frog jumps into the pond\nsplash silence again';
const scale = 1.5;

function row(counts, extra = {}) {
  return layoutByline({
    counts, author: extra.author ?? '', date: extra.date ?? 'Oct 26',
    measure: measureText, scale, ascent: Sm.ascent, descent: Sm.descent, ...extra,
  });
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

ok('a count of 2 or more paints clear of the resting face and the playing ink', () => {
  for (const k of RX_ORDER) {
    for (const n of [2, 12]) {
      const counts = { cry: 0, eyes: 0, heart: 0, star: 0, flushed: 0, relieved: 0, [k]: n };
      const layout = row(counts, { author: 'kitty G, ' });
      const glyph = layout.items.find(i => i.type === 'glyph');
      const count = layout.items.find(i => i.count);
      const g = GLYPH_BOX[k];
      assert.equal(count.t, String(n), k + ' ' + n);
      const minX = glyph.x + g.ow * scale + countClearance(k, scale);
      assert.ok(count.x + 1e-6 >= minX, `${k} ${n} count at ${count.x}, ink needs ${minX}`);
      assert.ok(count.x >= glyph.x + glyph.w, k);
      const inkRight = glyph.x + g.ow * scale + GLYPH_INK_RIGHT[k] * scale;
      assert.ok(count.x >= inkRight + COUNT_AIR_ART * scale - 1e-6, `${k} paper past the playing ink`);
      assert.ok(count.x >= glyph.x + g.ow * scale + COUNT_CLEAR_ART * scale - 1e-6, `${k} paper past the outline`);
      const author = layout.items.find(i => i.t === 'kitty G, ');
      assert.equal(author.x, count.x + count.w + DATE_GAP, 'the name follows the numeral');
      assert.ok(glyph.x + glyph.w <= author.x);
    }
  }
});

ok('a mixed row hides the 1s and keeps every painted numeral off its face', () => {
  const counts = { cry: 1, eyes: 2, heart: 1, star: 4, flushed: 12, relieved: 1 };
  const layout = row(counts, { author: 'moth, ' });
  assert.deepEqual(layout.kinds, ['cry', 'eyes', 'heart', 'star', 'flushed', 'relieved']);
  const texts = layout.items.filter(i => i.type === 'text' && !i.date).map(i => i.t);
  assert.deepEqual(texts, ['2', '4', '12', 'moth, ']);
  for (const k of layout.kinds) {
    const glyph = layout.items.find(i => i.kind === k);
    const count = layout.items.find(i => i.count && layout.items.indexOf(i) > layout.items.indexOf(glyph)
      && !layout.items.slice(layout.items.indexOf(glyph) + 1, layout.items.indexOf(i)).some(x => x.type === 'glyph'));
    if ((counts[k] | 0) < 2) assert.equal(count, undefined, k);
    else {
      const minX = glyph.x + GLYPH_BOX[k].ow * scale + countClearance(k, scale);
      assert.ok(count.x + 1e-6 >= minX, k);
      assert.equal(count.t, String(counts[k]));
    }
  }
  const date = layout.items.find(i => i.date);
  const last = layout.items[layout.items.length - 1];
  assert.equal(last, date);
  assert.equal(date.x, layout.items.find(i => i.t === 'moth, ').x + layout.items.find(i => i.t === 'moth, ').w);
});

ok('the numeral stays clear when the row is packed tight', () => {
  const counts = { cry: 12, eyes: 12, heart: 12, star: 12, flushed: 12, relieved: 12 };
  const tight = row(counts, { gaps: { glyph: 1, kind: 1, date: 3 } });
  for (const k of RX_ORDER) {
    const glyph = tight.items.find(i => i.kind === k);
    const count = tight.items.find(i => i.count && i.t === '12' && i.x > glyph.x && i.x < glyph.x + 80);
    const minX = glyph.x + GLYPH_BOX[k].ow * scale + countClearance(k, scale);
    assert.ok(count.x + 1e-6 >= minX, k);
  }
});

ok('a phone star of count 1 still leaves a left-hand seal', () => {
  const post = { text: FROG, author: '', createdAt: Date.UTC(2026, 9, 24), id: 'frog88' };
  const style = poemStyle(31, 5, post.id);
  style.sealOrder = sealOrder(5, post.id, null);
  const [L] = poemLayouts(post, 5, style);
  const [sw, sh] = sealDims(5);
  const avoid = { x: L.seal.x, y: L.seal.y, w: sw, h: sh };
  assert.equal(L.sealPos, 'left-3');
  const SmDate = 'Oct 24';
  const sigW = measure(L.sig.t, Sm), dateW = measure(SmDate, Sm);
  const opts = {
    counts: { star: 1 }, author: '', date: SmDate, measure: measureText, scale: 4 / 3,
    ascent: Sm.ascent, descent: Sm.descent,
    dateLeft: L.sig.x + sigW - dateW, dateRight: L.sig.x + sigW,
    leftLimit: -8.67, rightLimit: 220, sigY: L.sig.y, avoid,
  };
  const fit = fitByline(opts);
  assert.equal(fit.layout.items.find(i => i.count), undefined);
  assert.equal(reactionHitsRect(fit.layout, fit.placed.left, L.sig.y, avoid, fit.scale), false);
  const author = fit.layout.items.find(i => i.type === 'text' && !i.date && !i.count);
  const date = fit.layout.items.find(i => i.date);
  assert.ok(date);
  assert.equal(author, undefined);
  for (const it of fit.layout.items) {
    if (it.type !== 'glyph') continue;
    assert.ok(it.x >= date.x + date.w || it.x + it.w <= date.x);
  }
});

ok('cache-bust is 15.12g on the date line only', () => {
  const html = src('index.html'), app = src('src/app.js'), rx = src('src/reactions.js');
  assert.ok(/src\/app\.js\?v=15\.12g"/.test(html));
  assert.ok(/reactions\.js\?v=15\.12g/.test(app));
  assert.ok(/react-data\.js\?v=15\.12g/.test(rx));
  assert.ok(/react-glyphs\.js\?v=15\.12d/.test(rx), 'playback was not part of this round');
  assert.ok(/report\.js\?v=15\.12e/.test(app));
  assert.ok(/sound-wire\.js\?v=15\.12e/.test(app));
  assert.ok(/sound\.js\?v=15\.12e/.test(src('src/sound-wire.js')));
  assert.ok(/inky\.js\?v=15\.12c/.test(app));
  assert.ok(/z-index: 1/.test(rx) && /z-index: 0/.test(rx), 'the numeral paints above the face');
  assert.ok(/COUNT_FROM/.test(src('src/react-data.js')));
  assert.ok(!/firestore\.rules/.test(app + rx + src('src/react-data.js')));
});

console.log(n + ' round 15.12g checks passed');
