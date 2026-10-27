// Round 15.12d: date-line faces play about a second then idle, the spell starts on the tap,
// glyphs sit further from the signature, and the faces wash toward the sumi paper.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { font, measure } from '../src/brush-text.js';
import { DATE_GAP, layoutByline, fitByline } from '../src/react-data.js';
import { frameAt, GLYPH_PLAY_MS, STAMP_PAPER, STAMP_SAT, STAMP_WASH, inkStampRGBA, planPlays } from '../src/react-glyphs.js';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

const chroma = (r, g, b) => {
  const y = r * 0.299 + g * 0.587 + b * 0.114;
  return Math.hypot(r - y, g - y, b - y);
};
const paperDist = (r, g, b) => Math.hypot(r - STAMP_PAPER[0], g - STAMP_PAPER[1], b - STAMP_PAPER[2]);

ok('a placed face plays for a second from frame 0, then the idle cel, and a load stays idle', () => {
  assert.equal(GLYPH_PLAY_MS, 1000);
  assert.deepEqual(frameAt('star', 5000, true), { i: 0, dx: 0, dy: 0 });
  assert.deepEqual(frameAt('cry', 0, true), { i: 0, dx: 0, dy: 0 }, 'idle cry does not keep the shake');
  assert.notEqual(frameAt('cry', 0, false).dx, 0, 'the loop itself still shakes');
  assert.equal(frameAt('star', 0, false).i, 0);
  assert.ok(frameAt('star', 800, false).i > 0, 'a second of playback moves off the resting cel');

  const first = planPlays(null, ['star'], 1000);
  assert.equal(first.plays.size, 0, 'faces already on the board when it is measured stay idle');

  const placed = planPlays(first.seen, ['star'], 2000, { plays: new Map([['star', 2000 + GLYPH_PLAY_MS]]) });
  assert.equal(placed.plays.get('star'), 3000, 're-placing a kind that is already showing plays again');

  const mid = planPlays(placed.seen, ['star'], 2500, { plays: placed.plays });
  assert.equal(mid.plays.get('star'), 3000, 'a redraw during that second does not restart it');

  const done = planPlays(mid.seen, ['star'], 3000, { plays: mid.plays });
  assert.equal(done.plays.has('star'), false, 'once the second is over the face is idle');

  const appeared = planPlays(done.seen, ['star', 'cry'], 4000);
  assert.equal(appeared.plays.has('star'), false, 'the settled star does not replay');
  assert.equal(appeared.plays.get('cry'), 5000, 'a kind that appears for the viewer later plays once');

  const switched = planPlays(appeared.seen, ['heart'], 6000, { plays: new Map([['heart', 7000]]) });
  assert.equal(switched.plays.get('heart'), 7000);
  assert.equal(switched.plays.has('cry'), false, 'a kind that left the row does not keep playing');
});

ok('the date line asks for idle or one play; the picker still loops', () => {
  const js = src('src/reactions.js');
  const row = js.slice(js.indexOf('for (const it of layout.items) if (it.type === \'glyph\')'), js.indexOf('row.dataset.key = key'));
  assert.ok(/trackGlyph\(cv, it\.kind, phase, mode\)/.test(row), 'date-line faces take an explicit motion');
  assert.ok(/glyphMode\(id, it\.kind\)/.test(row));
  assert.ok(!/trackGlyph\(cv, it\.kind, \+cv\.dataset\.phase\)/.test(js), 'the old always-loop date-line call is gone');
  const pop = js.slice(js.indexOf('for (const k of RX_ORDER)'), js.indexOf('pop.hidden = false'));
  assert.ok(/trackGlyph\(cv, k, hash\(id, k\) % 800\)/.test(pop), 'picker faces keep looping');
  const io = js.slice(js.indexOf('new IntersectionObserver'), js.indexOf('function baseLabel'));
  assert.ok(/dataset\.motion === 'play'/.test(io) && /: 'idle'/.test(io), 'scrolling a settled face back on does not start it looping');
});

ok('the spell is one shot on choose and the clear still poofs after the store', () => {
  const js = src('src/reactions.js');
  const choose = js.slice(js.indexOf('async function choose'), js.indexOf('function cancelHold'));
  const say = choose.indexOf("sfx('reactSay', { kind: next })");
  const wait = choose.indexOf('await store.react');
  assert.ok(say >= 0 && say < wait);
  assert.equal(choose.split("sfx('reactSay'").length, 2, 'reactSay is called once');
  assert.ok(/if \(!res\.mine && !next\) sfx\('poof'\)/.test(choose));
  assert.ok(/m\.set\(next, performance\.now\(\) \+ GLYPH_PLAY_MS\)/.test(choose), 'choosing arms the one-second play');
  const store = src('src/firebase-store.js');
  assert.ok(/poemRx/.test(store) && /runTransaction/.test(store));
  assert.ok(!/15\.12d/.test(store), 'Firestore reaction rules and the transaction are untouched');
});

ok('the signature and the date stay glued, with more air before that block', () => {
  assert.equal(DATE_GAP, 16, 'was 6 in 15.11c; +10 font px');
  const Sm = font('small');
  const measureText = t => measure(t, Sm);
  const base = {
    counts: { cry: 0, eyes: 0, heart: 0, star: 1, flushed: 0, relieved: 0 },
    author: 'sample, ', date: 'Oct 24', measure: measureText, scale: 1.5, ascent: Sm.ascent, descent: Sm.descent,
  };
  for (const side of ['before', 'after']) {
    const row = layoutByline({ ...base, side });
    const author = row.items.find(i => i.t === 'sample, ');
    const date = row.items.find(i => i.date);
    const count = row.items.find(i => i.count);
    const glyph = row.items.find(i => i.type === 'glyph');
    assert.equal(date.x, author.x + author.w, 'no gap inside the signature block');
    assert.equal(row.gaps.date, DATE_GAP);
    if (side === 'before') assert.equal(author.x, count.x + count.w + DATE_GAP);
    else assert.equal(glyph.x, date.x + date.w + DATE_GAP);
    assert.ok(glyph.x + glyph.w <= author.x || glyph.x >= date.x + date.w);
  }
  const roomy = fitByline({ ...base, dateLeft: 200, dateRight: 240, leftLimit: 0, rightLimit: 500 });
  assert.equal(roomy.layout.gaps.date, 16);
  assert.equal(roomy.layout.side, 'before');
  const crowded = fitByline({
    ...base, counts: { cry: 12, eyes: 12, heart: 12, star: 12, flushed: 12, relieved: 12 },
    dateLeft: 240, dateRight: 272, leftLimit: 0, rightLimit: 300,
  });
  assert.equal(crowded.layout.gaps.date, 3, 'the pack-to-fit gap is unchanged, so a full row still stays on screen');
  assert.equal(crowded.ok, true);
  const data = src('src/react-data.js');
  assert.ok(/const TIGHT_GAPS = \{ glyph: 1, kind: 1, date: 3 \}/.test(data));
});

ok('ink wash desaturates toward the paper and leaves the used-grey path alone', () => {
  assert.deepEqual(STAMP_PAPER, [244, 236, 218]);
  assert.equal(STAMP_SAT, 0.82);
  assert.equal(STAMP_WASH, 0.28);
  const gold = new Uint8ClampedArray([240, 186, 52, 255]);
  const red = new Uint8ClampedArray([208, 76, 66, 255]);
  const blue = new Uint8ClampedArray([133, 174, 223, 255]);
  const ink = new Uint8ClampedArray([26, 24, 28, 255]);
  const eye = new Uint8ClampedArray([255, 250, 240, 255]);
  const clear = new Uint8ClampedArray([9, 9, 9, 0]);
  const goldC = chroma(240, 186, 52), goldD = paperDist(240, 186, 52);
  inkStampRGBA(gold); inkStampRGBA(red); inkStampRGBA(blue); inkStampRGBA(ink); inkStampRGBA(eye); inkStampRGBA(clear);
  assert.equal(clear[0], 9); assert.equal(clear[3], 0, 'clear pixels are not filled in');
  assert.ok(gold[0] > gold[1] && gold[1] > gold[2] && gold[0] > 190, 'the star stays gold');
  assert.ok(chroma(gold[0], gold[1], gold[2]) < goldC, 'gold loses a little chroma');
  assert.ok(paperDist(gold[0], gold[1], gold[2]) < goldD, 'gold steps toward the paper');
  assert.ok(red[0] > red[1] + 50 && red[0] > red[2] + 50, 'the heart stays red');
  assert.ok(blue[2] > blue[0] + 20 && blue[2] > blue[1], 'tears stay blue');
  assert.ok(ink[0] < 45 && ink[1] < 45 && ink[2] < 45, 'the outline stays ink');
  assert.ok(eye[0] > 240 && eye[2] < 245 && eye[2] < eye[0], 'eyes stay light and warm a step toward the sheet');
  const glyphs = src('src/react-glyphs.js');
  assert.ok(/if \(cv\.dataset\?\.used === '1'\) dimUsedRGBA/.test(glyphs));
  assert.ok(/else inkStampRGBA/.test(glyphs), 'picker and date-line share the wash, the used face does not');
});

ok('cache-bust is 15.12d on the board entry and the modules this round changes', () => {
  const html = src('index.html'), app = src('src/app.js'), rx = src('src/reactions.js');
  assert.ok(/src\/app\.js\?v=15\.12d"/.test(html));
  assert.ok(!/app\.js\?v=15\.12c/.test(html));
  assert.ok(/reactions\.js\?v=15\.12d/.test(app));
  assert.ok(/react-glyphs\.js\?v=15\.12d/.test(rx));
  assert.ok(/react-data\.js\?v=15\.12d/.test(rx));
  assert.ok(/inky\.js\?v=15\.12c/.test(app), 'Inky was not part of this round');
  assert.ok(/sound\.js\?v=15\.12c/.test(src('src/sound-wire.js')));
});

console.log(n + ' round 15.12d checks passed');
