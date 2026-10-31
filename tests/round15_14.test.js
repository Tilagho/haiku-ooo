// Round 15.14: poop and fire join the ink reaction set. Same poemRx doc, two more int fields.
// Place plays about a second (squash/blink/wisp, and the fire's highlight plus spark), then frame 0.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RX_ORDER, RX_LABEL, GLYPH_BOX, emptyCounts, applyCounts, isKind, PICKER_CELL, layoutByline } from '../src/react-data.js';
import { frameAt, GLYPH_PLAY_MS } from '../src/react-glyphs.js';
import { RX_SAY } from '../src/sound.js';
import { font, measure } from '../src/brush-text.js';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const pngSize = f => {
  const b = readFileSync(new URL('../' + f, import.meta.url));
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

ok('poop and fire sit after the six, with the same count and label shape', () => {
  assert.deepEqual(RX_ORDER, ['cry', 'eyes', 'heart', 'star', 'flushed', 'relieved', 'poop', 'fire']);
  assert.equal(RX_LABEL.poop, 'poop');
  assert.equal(RX_LABEL.fire, 'fire');
  assert.equal(RX_SAY.poop, 'Poop');
  assert.equal(RX_SAY.fire, 'Fire');
  assert.deepEqual(Object.keys(RX_SAY), RX_ORDER);
  const z = emptyCounts();
  assert.equal(z.poop, 0);
  assert.equal(z.fire, 0);
  const c = applyCounts(z, null, 'poop');
  assert.equal(c.poop, 1);
  assert.equal(isKind('fire'), true);
  assert.equal(isKind('thumb'), false);
  assert.equal(PICKER_CELL, 17, 'the new resting boxes do not grow the phone cell past the star');
  for (const k of ['poop', 'fire']) assert.ok(GLYPH_BOX[k].ow <= 17 && GLYPH_BOX[k].oh <= 17, k);
});

ok('each new strip matches its box, and the first second leaves frame 0', () => {
  const glyphs = src('src/react-glyphs.js');
  for (const [k, file, frames] of [['poop', 'poop', 8], ['fire', 'fire', 8]]) {
    const g = GLYPH_BOX[k];
    const dim = pngSize(`assets/reactions/${file}-frames-1x.png`);
    assert.equal(dim.w, g.w * frames, k + ' strip width');
    assert.equal(dim.h, g.h, k + ' strip height');
    assert.ok(glyphs.includes(`assets/reactions/${file}-frames-1x.png`), k);
    assert.equal(frameAt(k, 0).i, 0);
    assert.notEqual(frameAt(k, GLYPH_PLAY_MS - 1).i, 0, k + ' is still moving at the end of the place');
    assert.equal(frameAt(k, 0, true).i, 0);
    assert.equal(frameAt(k, 0, true).dx, 0);
  }
});

ok('a count of 1 is the face alone; from 2 the numeral sits under poop and under fire', () => {
  const Sm = font('small');
  const measureText = t => measure(t, Sm);
  for (const k of ['poop', 'fire']) {
    const one = layoutByline({ counts: { [k]: 1 }, author: '', date: 'Oct 24', measure: measureText, scale: 1.5, ascent: Sm.ascent, descent: Sm.descent });
    assert.equal(one.items.some(i => i.count), false, k);
    assert.ok(one.items.some(i => i.kind === k));
    const two = layoutByline({ counts: { [k]: 2 }, author: '', date: 'Oct 24', measure: measureText, scale: 1.5, ascent: Sm.ascent, descent: Sm.descent });
    const glyph = two.items.find(i => i.kind === k);
    const count = two.items.find(i => i.count);
    assert.equal(count.t, '2');
    assert.ok(count.y > glyph.y, k);
    assert.ok(Math.abs((glyph.x + glyph.w / 2) - (count.x + count.w / 2)) <= 0.51, k);
  }
});

ok('rules paste grows the same poemRx doc; comment and the seal hold are untouched', () => {
  const rules = src('firestore.reactions.rules');
  assert.ok(/poop', 'fire'/.test(rules));
  assert.ok(/hasOnly\(\['cry', 'eyes', 'heart', 'star', 'flushed', 'relieved', 'poop', 'fire'\]\)/.test(rules));
  assert.ok(/rxDelta\(poemId, 'poop'\)/.test(rules) && /rxDelta\(poemId, 'fire'\)/.test(rules));
  assert.ok(/haiku-ooo/.test(rules) && /Do NOT deploy this file by itself/.test(rules));
  const rx = src('src/reactions.js'), app = src('src/app.js');
  assert.ok(/if \(!z \|\| z\.stamp\) return/.test(rx), 'hold on the seal still does not open the picker');
  assert.ok(/!e\.target\.closest\?\.\('#fab'\)/.test(rx), 'a Comment tap is still not a dismiss');
  assert.ok(/\.fab\.is-comment \{ z-index: 90; \}/.test(rx));
  assert.ok(/report\.js\?v=15\.13/.test(app), 'report was not part of this round');
  const html = src('index.html');
  assert.ok(/src\/app\.js\?v=15\.14c"/.test(html));
  assert.ok(/reactions\.js\?v=15\.14/.test(app));
  assert.ok(/react-glyphs\.js\?v=15\.14/.test(rx));
  assert.ok(/store\.js\?v=15\.14/.test(app));
  assert.ok(/sound\.js\?v=15\.14/.test(src('src/sound-wire.js')));
});

console.log(n + ' round 15.14 checks passed');
