// Round 15.12c: used reaction is grey (no tan square), Inky stays under the picker and report bubbles, open/dismiss cues.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dimUsedRGBA } from '../src/react-glyphs.js';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

ok('a used glyph is desaturated and darker, transparent pixels stay clear', () => {
  const px = new Uint8ClampedArray([230, 180, 40, 255, 255, 255, 255, 255, 20, 18, 22, 255, 0, 200, 0, 0]);
  dimUsedRGBA(px);
  assert.equal(px[0], px[1]); assert.equal(px[1], px[2]);
  const luma = 230 * 0.299 + 180 * 0.587 + 40 * 0.114;
  assert.ok(px[0] < luma * 0.6, 'gold fills go dark, not just grey');
  assert.equal(px[4], px[5]); assert.ok(px[4] > px[0], 'white eyes stay lighter than the fill');
  assert.ok(px[8] < 20, 'the ink outline stays near black');
  assert.equal(px[12], 0); assert.equal(px[15], 0, 'clear padding is not painted into a square');
});

ok('the picker no longer paints a tan selection square; the current face is marked used', () => {
  const js = src('src/reactions.js'), glyphs = src('src/react-glyphs.js');
  const css = js.slice(js.indexOf('const RX_CSS'));
  assert.ok(!/#f0e2c4/.test(css), 'the tan selection fill is gone');
  assert.ok(!/\.rx-btn\.on \{[^}]*background:\s*#/.test(css), 'the selected cell has no colour chip');
  assert.ok(/\.rx-btn\.on \{ background: transparent; \}/.test(js));
  assert.ok(/cv\.dataset\.used = '1'/.test(js), 'the face already on the poem is flagged');
  assert.ok(/dataset\?\.used === '1'/.test(glyphs) && /dimUsedRGBA/.test(glyphs));
  assert.ok(!/background:\s*#f0e2c4/.test(js));
});

ok('opening the picker chimes, dismissing goes back, choosing does not', () => {
  const js = src('src/reactions.js');
  const open = js.slice(js.indexOf('async function open'), js.indexOf('async function choose'));
  const choose = js.slice(js.indexOf('async function choose'), js.indexOf('function cancelHold'));
  const close = js.slice(js.indexOf('function close'), js.indexOf('async function open'));
  assert.ok(/sfx\('pickerChime'\)/.test(open));
  assert.ok(!/pickerBack/.test(open));
  assert.ok(/if \(shown && !placed\) sfx\('pickerBack'\)/.test(close));
  assert.ok(/close\(\{ light: true, placed: true \}\)/.test(choose));
  assert.ok(!/pickerBack|pickerChime/.test(choose));
  assert.ok(/sfx\('reactSay', \{ kind: res\.mine \}\)/.test(choose));
  assert.ok(/sfx\('poof'\)/.test(choose));
  const wire = src('src/sound-wire.js'), sound = src('src/sound.js');
  assert.ok(/pickerChime\(E, t\)/.test(sound) && /pickerBack\(E, t\)/.test(sound));
  assert.ok(/name === 'pickerChime' \|\| name === 'pickerBack'/.test(wire));
  assert.ok(/mallet\(E, t \+ 0\.18, d, 1174\.7/.test(sound), 'the open cue rises to D6 on a mallet');
  assert.ok(/bloop\(E, t \+ 0\.24, ink, 360, 200/.test(sound), 'the go-back cue falls, it does not buzz');
});

ok('Inky patrol is frozen while a picker or report bubble is his, and released when it closes', () => {
  const inky = src('src/inky.js'), app = src('src/app.js'), rx = src('src/reactions.js');
  assert.ok(/holdBubble\(reason, on\)/.test(inky) && /get bubbleHeld\(\)/.test(inky) && /plant\(\)/.test(inky));
  const roam = inky.slice(inky.indexOf('roam(dt)'), inky.indexOf('lookTarget()'));
  const hold = roam.indexOf('if (this.bubbleHeld)'), tick = roam.indexOf('this.roamT -= dt');
  assert.ok(hold > 0 && hold < tick, 'the hold returns before the patrol timer advances');
  assert.ok(/if \(this\.bubbleHeld\) return/.test(inky.slice(inky.indexOf('moveTo(e) {'), inky.indexOf('release(e, cancel'))));
  assert.ok(/this\.bubbleHeld\) return false/.test(inky.slice(inky.indexOf('celebrate()'), inky.indexOf('confetti('))));
  assert.ok(/if \(this\.entered && !this\.bubbleHeld\) this\.targetX/.test(inky));
  assert.ok(/holdBubble\?\.\('picker', !poemAnchor\)/.test(rx));
  assert.ok(/holdBubble\?\.\('picker', false\)/.test(rx));
  assert.ok(/inky\.holdBubble\('report', true\)/.test(app) && /inky\.holdBubble\('report', false\)/.test(app));
  assert.ok(/const unpin = anchor === null \? pinReport\(\)/.test(app));
  assert.ok(/!pickerOpen\(\) && !inky\.bubbleHeld && inky\.celebrate\(\)/.test(app));
});

ok('cache-bust is 15.12c on the board entry and the modules this round changes', () => {
  const html = src('index.html'), app = src('src/app.js'), wire = src('src/sound-wire.js'), rx = src('src/reactions.js');
  assert.ok(/src\/app\.js\?v=15\.12c"/.test(html));
  assert.ok(/inky\.js\?v=15\.12c/.test(app));
  assert.ok(/reactions\.js\?v=15\.12c/.test(app));
  assert.ok(/sound-wire\.js\?v=15\.12c/.test(app));
  assert.ok(/sound\.js\?v=15\.12c/.test(wire));
  assert.ok(/react-glyphs\.js\?v=15\.12c/.test(rx));
  assert.ok(/react-data\.js\?v=15\.12c/.test(rx));
  assert.ok(!/app\.js\?v=15\.12b/.test(html + app));
});

console.log(n + ' round 15.12c checks passed');
