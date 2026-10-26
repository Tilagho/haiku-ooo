// Round 9 board behaviour: tap-to-copy text, no poem highlight, no footer credits, pixel scroll button.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { copyText, authorOf, SITE_URL } from '../src/share.js';
import { drawScrollButton, renderScrollButton, windOffsets, gustAt, OUTLINE } from '../src/scroll-button.js';
import { createNoren, stepNoren, idleWind, stillWind, renderNoren, CHARS, NW, NH, EGGS, Egg, pickEgg, cryptoRand, eggMemory } from '../src/noren.js';
const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

ok('copy text: three lines, blank line, author, site URL', () => {
  assert.equal(SITE_URL, 'https://haiku.ooo');
  assert.equal(copyText({ text: 'the old pond is still\na frog leaps into the water\nsplash! silence again', author: 'tiago' }),
    'the old pond is still\na frog leaps into the water\nsplash! silence again\n\n— tiago\nhttps://haiku.ooo');
});
ok('copy text: unsigned poems skip the author line', () => {
  const t = 'a\nb\nc';
  for (const author of [undefined, '', '  ', 'anon', 'you']) assert.equal(copyText({ text: t, author }), 'a\nb\nc\n\nhttps://haiku.ooo');
  assert.equal(copyText({ text: t, author: 'sample', sample: true }), 'a\nb\nc\n\nhttps://haiku.ooo', 'sample placeholders are unsigned');
  assert.equal(authorOf({ author: ' Mia ' }), 'Mia');
});
ok('copy text: always exactly three lines', () => {
  const c = copyText({ text: ' one \ntwo\n\nthree\n', author: 'x' }); assert.deepEqual(c.split('\n\n')[0].split('\n'), ['one', 'two', 'three']);
});
ok('poems never highlight: no .lit, no focus ring, no tap highlight, no selection', () => {
  const css = src('src/style.css'), view = src('src/scroll-view.js');
  assert.ok(!/\.lit\b/.test(css + view), 'highlight class gone');
  assert.ok(!/highlight\(/.test(view), 'highlight() gone');
  const poem = css.split('\n').filter(l => /^\.poem[ {:]/.test(l.trim()) || l.includes('-webkit-tap-highlight-color') || l.includes('user-select')).join(' ');
  assert.ok(/\.poem \{[^}]*outline: none/.test(css) && /-webkit-tap-highlight-color: transparent/.test(poem) && /user-select: none/.test(poem));
  assert.ok(!/\.poem::before/.test(css), 'no highlight box pseudo-element');
  assert.ok(/\.poem:focus, \.poem:focus-visible, \.poem:active \{ outline: none; box-shadow: none; background: none; \}/.test(css));
});
ok('CC BY credit (round 14.5): the page footer is GONE; the credit lives in the credits scroll (see credits.test.js), reachable from the (c) line', () => {
  const html = src('index.html'), css = src('src/style.css');
  assert.ok(!/<footer/.test(html) && !/class="credit"/.test(html) && !/\.credit\b/.test(css), 'no footer credit');
  assert.ok(/id="credits-btn"/.test(html) && /Giles Booth/.test(src('src/credits.js')) && /\(CC BY\)/.test(src('src/credits.js')));
  assert.ok(/Giles Booth/.test(src('README.md')) && /CC BY/.test(src('README.md')));
});
ok('write-a-haiku button is pixel art: parchment, 2 px dark outline, rolled ends, ChiKareGo2 words', () => {
  const a = drawScrollButton(); assert.ok(a.W > 100 && a.W < 170 && a.H >= 28 && a.H <= 44, `${a.W}x${a.H}`);
  const out = { data: new Uint8ClampedArray(a.W * a.H * 4) }; renderScrollButton(a, out, { t: 0, gust: 0 });
  const at = (x, y) => [...out.data.slice((y * a.W + x) * 4, (y * a.W + x) * 4 + 3)];
  const mid = a.H >> 1;
  assert.deepEqual(at(0, mid), [26, 24, 28]); assert.deepEqual(at(1, mid), [26, 24, 28], 'roll outline is 2 px thick');
  const mx = (a.W >> 1) + 9; let top = 0; while (!out.data[(top * a.W + mx) * 4 + 3]) top++;
  assert.deepEqual(at(mx, top), [26, 24, 28]); assert.deepEqual(at(mx, top + 1), [26, 24, 28], 'paper outline is 2 px thick');
  assert.equal(OUTLINE, 2);
  assert.ok(a.text.reduce((s, v) => s + v, 0) > 150, 'words drawn');
  let cream = 0; for (let i = 0; i < a.PW * a.PH; i++) if (a.isPaper[i]) cream++; assert.ok(cream > a.PW * 15, 'parchment');
  assert.ok(!/gradient/.test(src('src/style.css').split('\n').filter(l => /\.fab/.test(l)).join(' ')), 'no smooth CSS gradients on the button');
});
ok('button idle is wind, not glint or bob: pixel-stepped ripples, rigid rolls, occasional gusts', () => {
  const js = src('src/scroll-button.js'), css = src('src/style.css');
  assert.ok(!/GLINT|glint\(/.test(js), 'enchant glint gone'); assert.ok(!/fabbob/.test(css), 'bob gone');
  const a = drawScrollButton(); let moved = 0, maxd = 0;
  for (let t = 0; t < 8; t += .1) { const o = windOffsets(a.PW, t, gustAt(t)); assert.equal(o[0], 0); assert.equal(o[a.PW - 1], 0, 'rolls rigid');
    for (const v of o) { assert.ok(Number.isInteger(v)); maxd = Math.max(maxd, Math.abs(v)); } if (o.some(v => v)) moved++; }
  assert.ok(moved > 60, 'the paper ripples most of the time'); assert.ok(maxd >= 1 && maxd <= 2, 'soft: at most 2 art px');
  assert.ok([...Array(130).keys()].some(k => gustAt(k / 10) > .5) && gustAt(3) === 0, 'gusts come and go');
});
ok('tap: no press box; the scroll rolls up, then compose starts', () => {
  const js = src('src/app.js');
  assert.ok(!/addEventListener\('pointer(down|up)'[^\n]*#fab|\$\('#fab'\)\.addEventListener\('pointer/.test(js), 'no squash/pop press handlers');
  assert.ok(/await fabArt\?\.rollUp\(\)[\s\S]*haiku:write[\s\S]*\(window\.HB\?\.onWrite \|\| openCompose\)\(\)/.test(js), 'roll-up, then the compose hook');
  const a = drawScrollButton(), out = { data: new Uint8ClampedArray(a.W * a.H * 4) };
  renderScrollButton(a, out, { p: 1 }); const solid = (x0, x1) => { let k = 0; for (let x = x0; x < x1; x++) for (let y = 0; y < a.H; y++) if (out.data[(y * a.W + x) * 4 + 3] === 255) k++; return k; };
  assert.equal(solid(0, Math.floor(a.W * .38)), 0, 'left side empty: the left roll travelled in');
  assert.equal(solid(Math.ceil(a.W * .62), a.W), 0, 'right side empty: the right roll travelled in');
  assert.ok(solid(Math.floor(a.W * .4), Math.ceil(a.W * .6)) > 200, 'the two rolls meet in the middle');
  const js2 = src('src/scroll-button.js'); assert.ok(/api\.rollUp = \(ms = 5[0-9]{2}\)/.test(js2), 'snappy: ~0.5 s');
});
ok('no status bar: no header strip, clock, post count or battery in the page, CSS or JS', () => {
  const html = src('index.html'), css = src('src/style.css'), js = src('src/app.js');
  assert.ok(!/statusbar|sb-time|id="clock"|id="count"|class="batt"/.test(html), 'markup gone');
  assert.ok(!/\.statusbar|\.sb-|\.batt|--statusbar/.test(css), 'styles gone');
  assert.ok(!/#clock|#count|setCount|toLocaleTimeString/.test(js), 'clock / count updaters gone');
  assert.ok(/<body>\s*<main id="page">\s*<header class="noren-head"/.test(html), 'the board starts right at the top, with the noren');
});
ok('header: one noren flag per character of Haiku.ooo on one rod, all nine the same size; 俳句の掲示板 below; old title and tagline gone', () => {
  const html = src('index.html');
  assert.equal(CHARS.join(''), 'Haiku.ooo');
  assert.ok(/<title>Haiku\.ooo/.test(html) && /<h1 class="sr">Haiku\.ooo<\/h1>/.test(html), 'Haiku.ooo in the title and the header');
  assert.ok(!/HAIKU<\/span>|only haiku may pass|One long public scroll/.test(html), 'old title, tagline and description gone');
  assert.ok(/<header class="noren-head" id="noren">[\s\S]*俳句の掲示板[\s\S]*<\/header>/.test(html));
  const N = createNoren(); assert.equal(N.flags.length, 9);
  for (let i = 1; i < 9; i++) assert.ok(N.flags[i].x0 >= N.flags[i - 1].x0 + N.flags[i - 1].w + 1, 'small gaps between flags');
  assert.ok(N.flags.every(F => F.x0 >= 2 && F.x0 + F.w <= NW - 2), 'all on the rod, inside the canvas');
  assert.ok(N.flags.every(F => F.w === N.flags[0].w && F.h === N.flags[0].h && F.nx === 3 && F.ny === 6), "all nine flags identical in size, the '.' too");
  for (const F of N.flags) {
    const g = F.tex.glyph, w = F.w; assert.ok(g.reduce((a, b) => a + b, 0) > (F.dot ? 15 : F.ch === 'i' ? 14 : 25), 'a big bold glyph on ' + F.ch);
    let l = w, r = -1, t = 99, b = -1; g.forEach((v, i) => { if (v) { l = Math.min(l, i % w); r = Math.max(r, i % w); t = Math.min(t, i / w | 0); b = Math.max(b, i / w | 0); } });
    assert.ok(Math.abs(l - (w - 1 - r)) <= 1, F.ch + ' centred across its flag (' + l + ' | ' + (w - 1 - r) + ')');
    if (F.dot) assert.ok(Math.abs(t - 1 - (F.h - 3 - b)) <= 1, 'the period sits in the middle of its flag');
  }
  // the capital H: two full-height stems and a crossbar, every pixel solid (crisp, no stray anti-aliasing)
  const H = N.flags[0].tex, cols = [...Array(H.w)].map((_, x) => [...Array(H.h)].reduce((a, _, y) => a + H.glyph[y * H.w + x], 0));
  assert.ok(cols.filter(c => c >= 9).length >= 4, 'H has two bold full-height stems ' + cols);
});
ok('cloth: each flag breathes out of phase; a swipe ripples along the row; hard flicks stay readable and inside the canvas', () => {
  const N = createNoren(), hem = F => { const n = F.nx * F.ny - 2; return F.p[n * 2] - F.r[n * 2]; };
  const series = N.flags.map(() => []);
  for (let k = 0; k < 600; k++) { stepNoren(N, 1 / 60); if (k % 10 === 0) N.flags.forEach((F, i) => series[i].push(hem(F))); }
  const amp = series.map(s => Math.max(...s.map(Math.abs))); assert.ok(amp.every(a => a > .4 && a < 7.5), 'idle sway ' + amp.map(a => a.toFixed(1)));
  const peak = s => s.indexOf(Math.max(...s.slice(20, 40))); assert.ok(new Set(series.slice(0, 4).map(peak)).size > 1, 'out of phase');
  // a brutal flick: far over the cap, for many frames
  const hits = []; for (let k = 0; k < 300; k++) stepNoren(N, 1 / 60, stillWind);
  for (let k = 0; k < 14; k++) { N.flags.forEach(F => F.push(4 + k * 9, 20, 3000, -900, 1 / 60, 8, 1)); stepNoren(N, 1 / 60, stillWind); hits.push(N.flags.map(F => Math.abs(hem(F)) > 1)); }
  const first = i => hits.findIndex(h => h[i]); assert.ok(first(0) >= 0 && first(0) < first(4) && first(4) < first(7), 'the ripple travels with the hand');
  for (let k = 0; k < 30; k++) { stepNoren(N, 1 / 60);
    for (const F of N.flags) { for (let n = 0; n < F.nx * F.ny; n++) { assert.ok(F.p[n * 2] >= 1 && F.p[n * 2] <= NW - 2 && F.p[n * 2 + 1] <= NH - 1, 'inside the canvas');
      if (n >= F.nx) assert.ok(F.p[n * 2 + 1] >= F.p[(n - F.nx) * 2 + 1] + F.chh * .5, 'never crumpled (rows stay in order)');
      assert.ok(Math.hypot(F.p[n * 2] - F.r[n * 2], F.p[n * 2 + 1] - F.r[n * 2 + 1]) <= 7.01, 'never flung far from home'); } } }
  for (let k = 0; k < 400; k++) stepNoren(N, 1 / 60, stillWind);
  for (const F of N.flags) { assert.ok(Math.abs(hem(F)) < .8, 'swings back'); for (let i = 0; i < F.nx; i++) assert.equal(F.p[i * 2], F.r[i * 2], 'loops pinned'); }
});
ok('grab a corner: the held point follows the pointer (without stretching), the flag folds to show its back, and falls back on release', () => {
  const N = createNoren(); for (let k = 0; k < 60; k++) stepNoren(N, 1 / 60);
  const F = N.flags[3], hx = F.x0 + F.w - 1, hy = 7 + F.h - 1;
  assert.equal(F.hit(F.x0 + 5, 9), null, 'the upper part brushes instead of grabbing');
  assert.equal(N.flags[0].hit(F.x0 + 5, hy), null);
  const n = F.hit(hx, hy - 1); assert.ok(n >= F.nx * 3, 'grabs a hem-side point'); F.grab = { n, x: hx, y: hy };
  for (let k = 0; k <= 40; k++) { const q = Math.min(1, k / 30); F.grab.x = hx + (F.x0 - 1 - hx) * q; F.grab.y = hy + (10 - hy) * q; stepNoren(N, 1 / 60); }
  assert.ok(Math.hypot(F.p[n * 2] - (F.x0 - 1), F.p[n * 2 + 1] - 10) < 2, 'pinned to the pointer');
  assert.ok(F.lift() > 8, 'lifted ' + F.lift().toFixed(1));
  const img = { data: new Uint8ClampedArray(NW * NH * 4) }; renderNoren(N, img);
  let back = 0; for (let i = 0; i < NW * NH; i++) if (img.data[i * 4] === 62 && img.data[i * 4 + 1] === 70) back++; assert.ok(back > 10, 'the back of the cloth shows where it folds');
  F.grab = null; for (let k = 0; k < 360; k++) stepNoren(N, 1 / 60, stillWind); assert.ok(F.lift() < .8, 'fell back');
});
ok('one egg per load under a random flag, startled when uncovered, settling back when covered; ?egg=&eggflag= override', () => {
  assert.deepEqual(Object.keys(EGGS).sort(), ['cat', 'daruma', 'frog', 'haiku', 'inky', 'maki', 'maneki', 'onigiri', 'sashimi', 'secret']);
  assert.ok(EGGS.secret.weight < Math.min(...Object.values(EGGS).filter(e => e !== EGGS.secret).map(e => e.weight)), 'the secret is rare');
  const P = q => new URLSearchParams(q);
  assert.deepEqual(pickEgg(Math.random, P('egg=frog&eggflag=4')), { name: 'frog', flag: 3 });
  assert.equal(pickEgg(Math.random, P('egg=cat&eggflag=6')).flag, 5, "the '.' flag can hide it too now");
  assert.equal(pickEgg(() => .5, P('egg=cat&eggflag=99')).flag, 4, 'out-of-range eggflag falls back to random');
  const seen = new Set(), flags = new Set(); let seq = 0; const r = () => ((seq = (seq * 9301 + 49297) % 233280) / 233280);
  for (let k = 0; k < 400; k++) { const e = pickEgg(r, P('')); seen.add(e.name); flags.add(e.flag); }
  assert.equal(seen.size, 10); assert.equal(flags.size, 9, 'any of the nine flags can hide it');
  for (const name of Object.keys(EGGS)) {
    const N = createNoren(), F = N.flags[2]; N.egg = new Egg(name, F, false); N.egg.hold = 1e9;   // (round 14.3: the egg runs off ~1 s after it is found; round14_3.test.js. Here: the round 13 reactions)
    const img = { data: new Uint8ClampedArray(NW * NH * 4) }; for (let k = 0; k < 60; k++) { stepNoren(N, 1 / 60); renderNoren(N, img); }
    assert.equal(N.egg.state, 'sleep'); assert.ok(N.egg.exposed < .1, name + ' hidden at rest (' + N.egg.exposed.toFixed(2) + ')');
    const hx = F.x0 + F.w - 1, hy = 7 + F.h - 1, n = F.hit(hx, hy - 1); F.grab = { n, x: hx, y: hy };
    const states = new Set();
    for (let k = 0; k <= 120; k++) { const q = Math.min(1, k / 30); F.grab.x = hx + (F.x0 - 1 - hx) * q; F.grab.y = hy + (10 - hy) * q; stepNoren(N, 1 / 60); renderNoren(N, img); states.add(N.egg.state); }
    assert.ok(states.has('startle') && N.egg.state === 'awake', name + ' startled: ' + [...states]);
    F.grab = null; for (let k = 0; k < 150; k++) { stepNoren(N, 1 / 60, stillWind); renderNoren(N, img); }
    assert.equal(N.egg.state, 'sleep', name + ' settles back down');
    assert.ok(EGGS[name].reaction.length > 20);
  }
  // the other flags hide nothing: lifting one shows only paper and shadow
  const N = createNoren(), F = N.flags[7]; N.egg = new Egg('inky', N.flags[1], false); const img = { data: new Uint8ClampedArray(NW * NH * 4) };
  const hx = F.x0 + F.w - 1, hy = 7 + F.h - 1; F.grab = { n: F.hit(hx, hy - 1), x: hx, y: hy };
  for (let k = 0; k <= 60; k++) { const q = Math.min(1, k / 30); F.grab.x = hx + (F.x0 - 1 - hx) * q; F.grab.y = hy + (10 - hy) * q; stepNoren(N, 1 / 60); renderNoren(N, img); }
  assert.equal(N.egg.state, 'sleep', 'an empty flag startles nobody');
});
ok('egg bug (round 13): 200 simulated page loads get every egg and most flags, from real randomness, never repeating the last egg or flag', () => {
  const P = new URLSearchParams(''), ls = new Map(), store = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, String(v)) };
  const loads = []; for (let k = 0; k < 200; k++) loads.push(pickEgg(cryptoRand, P, eggMemory(store)));       // each load: a fresh memory over the same localStorage
  const names = new Set(loads.map(e => e.name)), flags = new Set(loads.map(e => e.flag));
  assert.equal(names.size, Object.keys(EGGS).length, 'every egg type turns up: ' + [...names]);
  assert.ok(flags.size >= 8, 'many flag positions: ' + [...flags]);
  for (let k = 1; k < 200; k++) { assert.notEqual(loads[k].name, loads[k - 1].name, 'no repeat egg on reload'); assert.notEqual(loads[k].flag, loads[k - 1].flag, 'no repeat flag'); }
  assert.ok(loads.filter(e => e.name === 'secret').length < 20, 'the secret stays rare');
  assert.deepEqual(JSON.parse(ls.get('haiku.lastEgg')), loads[199]);
  // the default RNG is crypto / Math.random, never the board's seeded rng; overrides don't touch the memory
  const js = src('src/noren.js');
  assert.ok(/export function pickEgg\(rand = cryptoRand/.test(js) && /crypto\.getRandomValues/.test(js) && !/rng\(|hash\(/.test(js.slice(js.indexOf('export function pickEgg'), js.indexOf('export class Egg'))));
  ls.clear(); pickEgg(cryptoRand, new URLSearchParams('egg=maki&eggflag=2'), eggMemory(store)); assert.equal(ls.size, 0);
  assert.ok(/pageshow[\s\S]*persisted[\s\S]*pickEgg/.test(js), 'a back/forward-cache restore re-hides a new egg');
  // weights: the old five no longer dominate, the secret is the rarest
  const W = Object.fromEntries(Object.entries(EGGS).map(([k, e]) => [k, e.weight])), tot = Object.values(W).reduce((a, b) => a + b);
  assert.ok(W.inky / tot < .15 && W.secret / tot < .04 && Object.values(W).every(w => w >= W.secret));
});
ok('new eggs (maki, sashimi, onigiri, daruma, maneki-neko): grayscale ink with only rare red, and each one visibly moves when startled', () => {
  for (const name of ['maki', 'sashimi', 'onigiri', 'daruma', 'maneki']) {
    const frames = [], cols = new Map();
    for (const st of [['sleep', 0], ['startle', .05], ['startle', .2], ['startle', .35], ['startle', .5], ['awake', .3]]) {
      const N = createNoren(), F = N.flags[4]; N.egg = new Egg(name, F, false); N.egg.state = st[0]; N.egg.t = st[1];
      const px = []; N.egg.drawBack((x, y, c) => { px.push(`${Math.round(x)},${Math.round(y)}`); cols.set(c.join(), (cols.get(c.join()) || 0) + 1); });
      N.egg.drawFront((x, y, c) => px.push(`f${Math.round(x)},${Math.round(y)}`)); frames.push(px.sort().join(' '));
    }
    assert.ok(new Set(frames).size >= 4, name + ' animates through its startle (' + new Set(frames).size + ' distinct frames)');
    let grey = 0, colour = 0; for (const [k, v] of cols) { const [r, g, b] = k.split(',').map(Number); if (Math.max(r, g, b) - Math.min(r, g, b) < 30) grey += v; else colour += v; }
    assert.ok(name === 'daruma' ? colour < grey * 1.6 : colour < grey * .2, name + ' mostly grayscale ink (' + grey + ' grey, ' + colour + ' coloured)');
  }
});
ok('scroll gust: scrolling blows all the flags (direction follows the scroll, bigger for faster), rippling across with a lag; caps hold', () => {
  const hem = F => { const n = F.nx * F.ny - 2; return F.p[n * 2] - F.r[n * 2]; };
  const run = (v, frames = 24) => { const N = createNoren(); for (let k = 0; k < 120; k++) stepNoren(N, 1 / 60, stillWind);
    const tr = N.flags.map(() => []); for (let k = 0; k < frames; k++) { N.gustIn = v; stepNoren(N, 1 / 60, stillWind); N.flags.forEach((F, i) => tr[i].push(hem(F))); } return { N, tr }; };
  const slow = run(250), fast = run(4000), back = run(-4000), peak = tr => Math.max(...tr.map(s => Math.max(...s.map(Math.abs))));
  assert.ok(peak(slow.tr) > .2 && peak(slow.tr) < peak(fast.tr) * .6, 'slow = gentle sway (' + peak(slow.tr).toFixed(2) + ' vs ' + peak(fast.tr).toFixed(2) + ')');
  assert.ok(fast.tr.every(s => s[s.length - 1] > .5) && back.tr.every(s => s[s.length - 1] < -.5), 'all nine flags blow, in the direction of the scroll');
  const first = (tr, i) => tr[i].findIndex(v => Math.abs(v) > .5); assert.ok(first(fast.tr, 0) < first(fast.tr, 8), 'the billow ripples across: ' + first(fast.tr, 0) + ' -> ' + first(fast.tr, 8));
  // a huge flick held for a long time: the cloth stays in its caps (inside the canvas, never crumpled, never far from home)
  const { N } = run(60000, 200);
  for (const F of N.flags) for (let n = F.nx; n < F.nx * F.ny; n++) {
    assert.ok(F.p[n * 2] >= 1 && F.p[n * 2] <= NW - 2 && F.p[n * 2 + 1] <= NH - 1 && F.p[n * 2 + 1] >= F.p[(n - F.nx) * 2 + 1] + F.chh * .14, 'inside the canvas, rows never cross (no inversion)');
    assert.ok(Math.hypot(F.p[n * 2] - F.r[n * 2], F.p[n * 2 + 1] - F.r[n * 2 + 1]) <= 3 + 4 + 18 * 1.3 + .01, 'never torn away from home');
    if (n % F.nx === 0) assert.ok(F.p[(n + F.nx - 1) * 2] - F.p[n * 2] >= (F.w - 1) * .85, 'no crumpling, even against the canvas side');
  }
  for (let k = 0; k < 400; k++) stepNoren(N, 1 / 60, stillWind); assert.ok(N.flags.every(F => Math.abs(hem(F)) < .8), 'settles once scrolling stops');
  const js = src('src/noren.js'); assert.ok(/addEventListener\('scroll', onScroll, \{ passive: true/.test(js) && /N\.gustScale = reduced \? \.15 : 1/.test(js), 'passive listener; reduced motion = a mild sway');
});
ok('LEAF BLOWER: down blasts right, up blasts left (sign always consistent), proportional, near horizontal on a flick, springs back with overshoot; reduced = mild', () => {
  const hemPt = F => { const n = F.nx * F.ny - 2; return [F.p[n * 2] - F.r[n * 2], F.p[n * 2 + 1] - F.r[n * 2 + 1]]; };
  const blow = (v, { frames = 60, scale = 1 } = {}) => { const N = createNoren(); N.gustScale = scale; for (let k = 0; k < 120; k++) stepNoren(N, 1 / 60, stillWind);
    let mx = 0, lift = 0; for (let k = 0; k < frames; k++) { N.gustIn = v; stepNoren(N, 1 / 60, stillWind); const [dx, dy] = hemPt(N.flags[4]); if (Math.abs(dx) > Math.abs(mx)) mx = dx; lift = Math.max(lift, -dy); }
    return { N, mx, lift, mid: N.flags.slice(1, 8).map(F => hemPt(F)[0]) }; };
  const gentle = blow(250), flick = blow(4000), up = blow(-4000);
  assert.ok(gentle.mx > 4, 'a gentle scroll is already a strong breeze (' + gentle.mx.toFixed(1) + ' px)');
  assert.ok(flick.mx > 18 && flick.lift > 12, 'a flick blasts the hem up toward horizontal (' + flick.mx.toFixed(1) + ' px over, ' + flick.lift.toFixed(1) + ' px up)');
  assert.ok(gentle.mx < flick.mx * .75, 'proportional to the scroll speed');
  assert.ok(flick.mid.every(d => d > 8) && up.mid.every(d => d < -8), 'scroll DOWN -> every flag blows right (+x); scroll UP -> left (-x)');
  for (const v of [300, 900, 2500]) { assert.ok(blow(v).mx > 0 && blow(-v).mx < 0, 'sign consistent at ' + v); }
  // stops: springs back past rest (overshoot), then settles
  let over = 0; for (let k = 0; k < 120; k++) { stepNoren(flick.N, 1 / 60, stillWind); over = Math.min(over, hemPt(flick.N.flags[4])[0]); }
  assert.ok(over < -1.5, 'springs back with an overshoot (' + over.toFixed(1) + ')');
  for (let k = 0; k < 300; k++) stepNoren(flick.N, 1 / 60, stillWind); assert.ok(Math.abs(hemPt(flick.N.flags[4])[0]) < .8, 'then settles');
  const calm = blow(4000, { scale: .15 }); assert.ok(calm.mx > .3 && calm.mx < 6, 'reduced motion: only a mild sway (' + calm.mx.toFixed(1) + ')');
});
ok('noren: pauses off-screen, reduced motion, scroll-safe touch, pixel-crisp canvas', () => {
  const js = src('src/noren.js'), css = src('src/style.css');
  assert.ok(/IntersectionObserver/.test(js) && /if \(!visible\) return/.test(js));
  assert.ok(/prefers-reduced-motion/.test(js) && /reduced \? stillWind : idleWind/.test(js));
  assert.ok(/touchstart[\s\S]*tryGrab\(a\)\) \{ touchId = tch\.identifier; e\.preventDefault\(\)/.test(js), 'only a touch that starts on a flag hem is captured');
  assert.ok(/\.noren-cv \{[^}]*image-rendering: pixelated/.test(css) && /touch-action: pan-y/.test(css));
  assert.ok(typeof idleWind(1, 0, 0, 3) === 'number');
});
ok('round 15.10g: no 5-7-5 chips; the board ends with おわり / The End + inquiries, only once the feed is done', () => {
  const html = src('index.html'), css = src('src/style.css');
  assert.ok(!/class="chip|scroll-foot|class="rule"/.test(html) && !/\.chip\b|\.scroll-foot/.test(css), 'chips gone');
  assert.ok(html.indexOf('class="scroll-end"') > html.indexOf('id="scroll"'), 'after the scroll');
  assert.ok(/<p class="end-jp" lang="ja">おわり<\/p>[\s\S]{0,300}<p class="end-en">The End<\/p>[\s\S]*href="mailto:contact@haiku\.ooo"/.test(html), 'round 15.10g4: The End / おわり (periods dropped so both lines read centred)');
  assert.ok(!/おわり。|The End\./.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'round 15.10g4: no trailing periods in the end copy');
  assert.ok(!/（おわり）|\(the end\)/.test(html), 'no parenthesised end copy');
  assert.ok(/style\.css\?v=15\.10h2/.test(html) && /app\.js\?v=15\.10i/.test(html));   // 15.10i bumped app.js (sound); style stays 15.10h2
  assert.ok(/\.scroll-end \.end-jp \{[^}]*font: 400 var\(--crfs\)\/1 'FindersKeepers', 'DotGothic16'[^}]*letter-spacing: normal[^}]*color: #6b6670/.test(css), 'jp: FindersKeepers first, DotGothic16 kana fallback, © grey');
  assert.ok(/\.scroll-end \.end-en \{[^}]*font: 400 var\(--crfs\)\/1 var\(--small\)[^}]*color: #6b6670/.test(css), 'en: © row voice');
  assert.ok(/\.scroll-end \.end-mail \{[^}]*font: 400 var\(--crfs\)\/1 var\(--small\)[^}]*color: #6b6670/.test(css), 'mail: © row voice');
  assert.ok(!/\.scroll-end \.end-(jp|en) \{[^}]*var\(--(text|ui)\)/.test(css), 'no DotGothic16/ChiKareGo2 lead fonts');
  assert.ok(/\.float-note\.end-mail-note \{[^}]*var\(--small\)[^}]*color: #6b6670/.test(css) && /\.float-note \{[^}]*var\(--ui\)[^}]*var\(--ink\)/.test(css), 'end-mail copied note: © voice; other notes unchanged');
  assert.ok(/floatNote\('copied', x, y, 'end-mail-note'\)/.test(src('src/app.js')) && /function floatNote\(text, x, y, cls = ''\)/.test(src('src/app.js')));
  assert.ok(/<p class="end-mail">Inquiries\? Email us <a id="end-mail-a" class="end-mail-a" href="mailto:contact@haiku\.ooo">/.test(html), 'round 15.10g2: plain-text inquiries line, inline address link');
  assert.ok(!/\.end-mail a \{[^}]*box-shadow/.test(css) && /\.scroll-end \.end-mail \{[^}]*var\(--small\)[^}]*color: #6b6670/.test(css), 'no button box, © row voice');
  assert.ok(/getElementById\('end-mail-a'\)\?\.addEventListener\('click'[\s\S]{0,200}writeClipboard\('contact@haiku\.ooo'\)/.test(src('src/app.js')), 'tap also copies');
  assert.ok(/\.scroll-end \{ display: none;/.test(css) && /\.feed-more\.end ~ \.scroll-end \{ display: block; \}/.test(css), 'hidden until sentinel.end');
});
ok('round 15.10g/h: a tiny boot Inky shows while the feed loads; app.js hands off to the staged boot once booted settles', () => {
  const html = src('index.html'), css = src('src/style.css'), js = src('src/app.js');
  assert.ok(/<div id="boot-inky" class="boot-inky" role="status"[^>]*><svg class="bi-blob"[^>]*shape-rendering="crispEdges"/.test(html));
  assert.ok(/\.boot-inky \{[^}]*animation: bi-in \.16s steps\(2\) both/.test(css) && /\.boot-inky\.gone \{ animation: bi-out/.test(css), 'on from first paint (no .4 s delay)');
  assert.ok(/const bootDone = booted\.catch\(\(\) => \{\}\)\.then\(\(\) => window\.HBBoot \? window\.HBBoot\.done\(\{ sfx \}\) : dropBootInky\(\)\)/.test(js), 'boot hand-off on success or failure');
});
ok('round 15.10h: staged boot — fill bar, ~1 s minimum beat, board fades in, boot Inky whips off, then the board Inky enters', () => {
  const html = src('index.html'), css = src('src/style.css'), js = src('src/app.js'), boot = src('src/boot-inky.js');
  assert.ok(/<html lang="en" class="hb-booting">/.test(html), 'board starts hidden');
  assert.ok(/<span class="bi-bar" aria-hidden="true"><i class="bi-fill"><\/i><\/span><\/div>\s*<script src="src\/boot-inky\.js\?v=15\.10h2"><\/script>/.test(html), 'fill bar + classic boot script right after the loader');
  assert.ok(!/bi-puddle/.test(html + css), 'old puddle gone');
  assert.ok(/src\/style\.css\?v=15\.10h2"/.test(html) && /src\/app\.js\?v=15\.10i"/.test(html) && /src\/boot-inky\.js\?v=15\.10h2"/.test(html), 'cache-bust (15.10i app, 15.10h2 boot/style)');
  assert.ok(/html\.hb-booting body > :not\(#boot-inky\):not\(\.bi-cv\):not\(script\) \{ opacity: 0 !important;/.test(css), 'board hidden while booting');
  // round 15.10h2 (t235u): only the sumi background fades; everything else just appears
  assert.ok(/html\.hb-reveal \.art-layer \.bg6, html\.hb-reveal #ink-layer \{ animation: hb-bg-in var\(--hb-fade, 560ms\) steps\(7\) both/.test(css), 'background-only stepped fade');
  assert.ok(!/html\.hb-reveal body > [^{]*\{[^}]*(transition|animation)/.test(css), 'no whole-board fade');
  assert.ok(/\.boot-inky \.bi-fill \{[^}]*transform-origin: 0 50%; transform: scaleX\(0\)/.test(css) && /\.boot-inky \.bi-bar \{[^}]*width: 48px/.test(css), '48 px bar, 12 x 4 px cells');
  assert.ok(/MIN: reduced \? 0 : 1000/.test(boot) && /SWOOSH: 760/.test(boot) && /FADE: reduced \? 200 : 560/.test(boot) && /AFTER: reduced \? 0 : 500/.test(boot) && /SAFE: 15000/.test(boot), 'timings');
  assert.ok(/const STEPS = 12, PX = 4, FPS = 30/.test(boot), 'pixel-stepped');
  // round 15.10h2 (t233u): crisp pixels on a low-res canvas, no CSS rotate on the SVG; a ribbon trail like red Inky's
  assert.ok(/\.bi-cv \{[^}]*image-rendering: pixelated/.test(css) && /cv\.className = 'bi-cv'/.test(boot) && !/blob\.style\.transform/.test(boot), 'canvas pixels, no smoothed SVG transform');
  assert.ok(/const trail = \[\], drops = \[\]/.test(boot) && /disc\(ctx, t\.x, t\.y, rr\)/.test(boot) && /Math\.hypot\(x - lx, y - ly\) \/ \.7/.test(boot), 'gap-filled ink ribbon');
  // round 15.10h2 (t234u): the write button boots shut and opens as rollUp reversed, with the close's fabRoll sound
  const sb = src('src/scroll-button.js');
  assert.ok(/api\.rollUp = \(ms = 540\)[^\n]*tween\(1, ms, ROLL_EASE\)/.test(sb) && /api\.openReverse = \(ms = 540\)[^\n]*tween\(0, ms, k => 1 - ROLL_EASE\(1 - k\)\)/.test(sb), 'open = reverse(close)');
  assert.ok(/fabArt\.p = 1; fabArt\.paint\(0\);/.test(js) && /addEventListener\('hb:bootgone', \(\) => \{[^\n]*sfx\('fabRoll'\); fabArt\.openReverse\(\);/.test(js), 'boots shut; opens on hb:bootgone with fabRoll');
  assert.ok(/const ease = u => u < \.5 \? 4 \* u \* u \* u/.test(boot) && /function catmull\(pts, u\)/.test(boot), 'red Inky whip curve + ease');
  assert.ok(/sfx\?\.\('swooshIn', \{ dur: T\.SWOOSH \/ 1000 \}\)/.test(boot), 'watery swoosh');
  assert.ok(/u \/= sx; v \/= sy;/.test(boot) && /paint\(u < 1 \? \[c0x \+ x, c0y \+ y, s, 1 \/ Math\.sqrt\(s\), a, lean\]/.test(boot), 'stretch along velocity (nearest-neighbour inverse map)');
  assert.ok(/if \(reduced\) \{ reveal\(\); el\.classList\.add\('gone'\)/.test(boot), 'reduced motion: quick fade, no swoosh');
  assert.ok(/window\.HBBoot = \{ T, STEPS, done, mark:/.test(boot) && /window\.HBBoot\?\.mark\(\.5\)/.test(js), 'hooks');
  assert.ok(/booted\.then\(\(\) => bootDone\)\.then\(\(\) => \{ if \(!composing\(\)\) inky\.enter\(\)/.test(js), 'board Inky enters after the hand-off');
  // the bar's maths: eases toward 88 %, never full on its own, ~77 % at the 1 s beat
  const curve = t => .88 * (1 - Math.exp(-t / 420)); assert.ok(curve(1000) > .7 && curve(1000) < .8 && curve(60000) < .9);
});
ok('round 15.10i: playback audio session so the iPhone silent switch does not mute Web Audio', () => {
  const sound = src('src/sound.js'), wire = src('src/sound-wire.js'), app = src('src/app.js'), html = src('index.html');
  assert.ok(/navigator\.audioSession\.type = "playback"/.test(sound), 'playback session');
  const unlock = sound.slice(sound.indexOf('unlock() {'), sound.indexOf('unlock() {') + 900);
  assert.ok(unlock.includes('playbackSession()') && unlock.indexOf('playbackSession()') < unlock.indexOf('new AC('), 'session before new AudioContext');
  assert.ok(/playbackSession\(\); this\.ctx\.resume/.test(sound), 're-applied before resume');
  assert.ok(/rebuild\(\)[\s\S]{0,500}return this\.unlock\(\)/.test(sound), 'rebuild goes back through unlock');
  assert.ok(/from '\.\/sound\.js\?v=15\.10i'/.test(wire) && /from '\.\/sound-wire\.js\?v=15\.10i'/.test(app));
  assert.ok(/src\/app\.js\?v=15\.10i"/.test(html) && /src\/style\.css\?v=15\.10h2"/.test(html) && /src\/boot-inky\.js\?v=15\.10h2"/.test(html) && /compose\.css\?v=15\.10f5c"/.test(html));
  assert.ok(!/audioSession is never touched|deliberately NOT touched/.test(sound + wire));
  assert.ok(/projectId: 'haiku-ooo'/.test(src('src/config.js')));
});
console.log(`${n} board checks passed`);
