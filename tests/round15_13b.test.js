// Round 15.13b: the board brush is one size. A long line used to drop the whole poem
// from 1.5 to 1.0 scroll-units per font px, so a desktop-length 7-syllable line painted
// thinner than a phone-length one on the same screen.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { measure, font } from '../src/brush-text.js';
import { poemLayouts, poemStyle, sealOrder, U, MAX_BOX } from '../src/scroll-engine2.js';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

const DESKTOP = 'Today I feel the\nwind blowing through my cold heart\neaseful I am';
const PHONE = 'ima kitty kat\nthat lives with noelle fishy\nthat goes pur pur pur';

function layout(text, id = 'p') {
  const post = { id, text, createdAt: Date.UTC(2026, 9, 27), author: '' };
  const style = poemStyle(31, 8, id);
  style.sealOrder = sealOrder(8, id, null);
  return poemLayouts(post, 8, style)[0];
}

ok('the two live poems share the canonical brush, including the line that used to miss the margin', () => {
  const F = font('main');
  const wide = Math.max(...DESKTOP.split('\n').map(t => measure(t, F)));
  assert.ok(wide * 1.5 > MAX_BOX, 'the long line is the old shrink case');
  assert.equal(U, 1.5);
  const a = layout(DESKTOP, 'desk'), b = layout(PHONE, 'phone');
  assert.equal(a.u, U);
  assert.equal(b.u, U);
  assert.equal(a.lines[0].y, b.lines[0].y);
  assert.equal(a.lines[1].y - a.lines[0].y, b.lines[1].y - b.lines[0].y, 'same line pitch');
});

ok('a reply keeps that same brush', () => {
  const post = { id: 'c', parentId: 'p', text: DESKTOP, createdAt: Date.UTC(2026, 9, 27), author: '' };
  const L = poemLayouts(post, 0, { align: 'left', step: 12, dir: 1, noSeal: true })[0];
  assert.equal(L.u, U);
  assert.equal(L.seal, null);
});

ok('cache-bust is 15.13b on the brush only', () => {
  const html = src('index.html'), app = src('src/app.js'), view = src('src/scroll-view.js');
  assert.ok(/src\/app\.js\?v=15\.14a"/.test(html));
  assert.ok(/scroll-view\.js\?v=15\.13b/.test(app));
  assert.ok(/scroll-engine2\.js\?v=15\.13b/.test(app));
  assert.ok(/scroll-engine2\.js\?v=15\.13b/.test(view));
  assert.ok(/reactions\.js\?v=15\.14/.test(app) && !/reactions\.js\?v=15\.13b/.test(app));
  assert.ok(/report\.js\?v=15\.13/.test(app) && !/report\.js\?v=15\.13b/.test(app));
  assert.ok(/sound-wire\.js\?v=15\.14/.test(app));
});

console.log(n + ' round 15.13b checks passed');
