// Round 15.12f: a date-line face and its count must not paint on that poem's number seal.
// The signature and the date stay one block. Round 15.12g hides a count of 1; the face still moves.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { font, measure, sealDims } from '../src/brush-text.js';
import { poemLayouts, poemStyle, sealOrder } from '../src/scroll-engine2.js';
import { fitByline, reactionHitsRect, DATE_GAP } from '../src/react-data.js';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

const Sm = font('small');
const measureText = t => measure(t, Sm);
const FROG = 'an old silent pond\na frog jumps into the pond\nsplash silence again';

function layoutOf(post, poemN, style) {
  const [L] = poemLayouts(post, poemN, style);
  const [w, h] = sealDims(poemN);
  return { L, avoid: { x: L.seal.x, y: L.seal.y, w, h } };
}
function byline(L, post, extra) {
  const date = 'Oct 24';
  const sigW = measure(L.sig.t, Sm), dateW = measure(date, Sm);
  return {
    author: post.author ? `${post.author}, ` : '',
    date, measure: measureText, scale: extra.scale ?? 1.5,
    ascent: Sm.ascent, descent: Sm.descent,
    dateLeft: L.sig.x + sigW - dateW, dateRight: L.sig.x + sigW,
    sigY: L.sig.y, ...extra,
  };
}
function glued(layout) {
  const author = layout.items.find(i => i.type === 'text' && !i.date && !i.count);
  const date = layout.items.find(i => i.date);
  assert.ok(date);
  if (author) assert.equal(date.x, author.x + author.w, 'the date follows the name with nothing between');
  for (const it of layout.items) {
    if (it.type !== 'glyph' && !it.count) continue;
    const end = it.x + it.w;
    assert.ok(end <= date.x && (!author || end <= author.x) || it.x >= date.x + date.w, 'the reaction stays outside the signature block');
  }
}

ok('a phone star on a left-hand seal moves to the right of the date, count and all', () => {
  const post = { text: FROG, author: '', createdAt: Date.UTC(2026, 9, 24), id: 'frog88' };
  const style = poemStyle(31, 5, post.id);
  style.sealOrder = sealOrder(5, post.id, null);
  const { L, avoid } = layoutOf(post, 5, style);
  assert.equal(L.sealPos, 'left-3');
  // dpr 2 on a 390-wide board: the left pack fits the viewport and used to sit on the hanko.
  const opts = byline(L, post, { counts: { star: 1 }, scale: 4 / 3, leftLimit: -8.67, rightLimit: 220, avoid });
  const before = fitByline({ ...opts, avoid: undefined, sigY: undefined });
  assert.equal(before.placed.side, 'before');
  assert.equal(reactionHitsRect(before.layout, before.placed.left, L.sig.y, avoid), true, 'the old left pack paints on the seal');
  const fit = fitByline(opts);
  assert.equal(fit.placed.side, 'after');
  assert.equal(fit.scale, 1);
  assert.equal(fit.placed.left, L.sig.x, 'the signature stays where the poem painted it');
  assert.equal(fit.layout.gaps.date, DATE_GAP, 'one star still gets the open gap');
  assert.equal(fit.layout.items.find(i => i.count), undefined, 'a count of 1 is not painted');
  assert.ok(fit.layout.items.some(i => i.type === 'glyph' && i.kind === 'star'));
  assert.equal(reactionHitsRect(fit.layout, fit.placed.left, L.sig.y, avoid, fit.scale), false);
  glued(fit.layout);
  // The same collision at the dpr 3 art size.
  const dpr3 = fitByline({ ...opts, scale: 1.5, leftLimit: -9.75 });
  assert.equal(dpr3.placed.side, 'after');
  assert.equal(reactionHitsRect(dpr3.layout, dpr3.placed.left, L.sig.y, avoid, dpr3.scale), false);
  assert.equal(dpr3.layout.items.find(i => i.count), undefined);
});

ok('a seal that does not meet the date line keeps the old side', () => {
  const post = { text: FROG, author: '', createdAt: Date.UTC(2026, 9, 24), id: 'x' };
  const base = { align: 'center', step: 0, dir: 1 };
  for (const pos of ['right-3', 'upper-left', 'below-center', 'left-1']) {
    const { L, avoid } = layoutOf(post, 1, { ...base, sealOrder: [pos] });
    assert.equal(L.sealPos, pos);
    const opts = byline(L, post, { counts: { star: 1 }, leftLimit: -30, rightLimit: 400, avoid });
    const open = fitByline({ ...opts, avoid: undefined, sigY: undefined });
    const fit = fitByline(opts);
    assert.equal(reactionHitsRect(open.layout, open.placed.left, L.sig.y, avoid), false, pos);
    assert.equal(fit.placed.side, open.placed.side, pos);
    assert.equal(fit.scale, 1, pos);
    assert.equal(fit.placed.left, open.placed.left, pos);
    assert.equal(reactionHitsRect(fit.layout, fit.placed.left, L.sig.y, avoid, fit.scale), false);
  }
});

ok('a count that is the only overlap still leaves the seal, and a name stays glued to its date', () => {
  const post = { text: FROG, author: 'moth', createdAt: Date.UTC(2026, 9, 24), id: 'named' };
  const { L, avoid } = layoutOf(post, 1, { align: 'center', step: 0, dir: 1, sealOrder: ['left-3'] });
  assert.equal(L.sealPos, 'left-3');
  // A numeral exists only from 2 up (15.12g). It still has to leave the seal.
  const opts = byline(L, post, { counts: { star: 2 }, leftLimit: -40, rightLimit: 500, avoid });
  const before = fitByline({ ...opts, avoid: undefined, sigY: undefined });
  assert.equal(before.placed.side, 'before');
  const rowTop = L.sig.y - before.layout.shift;
  const count = before.layout.items.find(i => i.count);
  const countOnly = { x: before.placed.left + count.x, y: rowTop + count.y, w: count.w, h: before.layout.textH };
  assert.equal(reactionHitsRect(before.layout, before.placed.left, L.sig.y, countOnly), true);
  const fit = fitByline({ ...opts, avoid: countOnly });
  assert.equal(reactionHitsRect(fit.layout, fit.placed.left, L.sig.y, countOnly, fit.scale), false);
  assert.equal(fit.layout.items.find(i => i.count).t, '2');
  glued(fit.layout);
  const author = fit.layout.items.find(i => i.t === 'moth, ');
  const date = fit.layout.items.find(i => i.date);
  assert.equal(date.x, author.x + author.w);
  assert.equal(fit.placed.left, L.sig.x, 'flipping sides does not drag the signature');
});

ok('a full set that cannot sit on the seal scales clear instead of covering it', () => {
  const post = { text: FROG, author: '', createdAt: Date.UTC(2026, 9, 24), id: 'frog88' };
  const style = poemStyle(31, 5, post.id);
  style.sealOrder = sealOrder(5, post.id, null);
  const { L, avoid } = layoutOf(post, 5, style);
  const counts = { cry: 12, eyes: 12, heart: 12, star: 12, flushed: 12, relieved: 12 };
  const fit = fitByline(byline(L, post, { counts, leftLimit: 0, rightLimit: 120, avoid }));
  assert.equal(reactionHitsRect(fit.layout, fit.placed.left, L.sig.y, avoid, fit.scale), false);
  assert.ok(fit.scale < 1, 'the row scales once the clear side is wider than the clip');
  glued(fit.layout);
  for (const it of fit.layout.items) if (it.count) assert.ok(Number(it.t) >= 2);
});

ok('cache-bust moved to 15.12g; the seal is still passed into the packer', () => {
  const html = src('index.html'), app = src('src/app.js'), rx = src('src/reactions.js');
  assert.ok(/src\/app\.js\?v=15\.12g"/.test(html));
  assert.ok(/reactions\.js\?v=15\.12g/.test(app));
  assert.ok(/react-data\.js\?v=15\.12g/.test(rx));
  assert.ok(/react-glyphs\.js\?v=15\.12d/.test(rx));
  assert.ok(/report\.js\?v=15\.12e/.test(app));
  assert.ok(/sound-wire\.js\?v=15\.12e/.test(app));
  assert.ok(/sound\.js\?v=15\.12e/.test(src('src/sound-wire.js')));
  assert.ok(/sigY: L\.sig\.y/.test(rx) && /avoid: \{ x: L\.seal\.x/.test(rx), 'the row passes the seal rect into the packer');
  assert.ok(!/firestore\.rules/.test(app + rx + src('src/react-data.js')));
});

console.log(n + ' round 15.12f checks passed');
