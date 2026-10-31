// Round 15.12h: iOS long-press must not select the board, and scrolling plays a wind whoosh.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WHOOSH_DEAD, WHOOSH_FULL, whooshAmount, whooshLevel, stepWhooshSpeed, WHOOSH_RELEASE } from '../src/sound.js';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

ok('the board opts out of selection and callout; compose fields opt back in', () => {
  const css = src('src/style.css'), compose = src('src/compose.css'), html = src('index.html'), guard = src('src/no-select.js');
  assert.ok(/\*:not\(input\):not\(textarea\) \{[^}]*-webkit-user-select: none[^}]*user-select: none[^}]*-webkit-touch-callout: none/.test(css));
  assert.ok(/input, textarea, \[contenteditable="true"\] \{[^}]*-webkit-user-select: text[^}]*user-select: text[^}]*-webkit-touch-callout: default/.test(css));
  assert.ok(/#compose #cpoem \{[^}]*-webkit-user-select: text; user-select: text/.test(compose), 'the poem field stays selectable');
  assert.ok(/src\/no-select\.js\?v=15\.12h/.test(html) && /src\/style\.css\?v=15\.12h/.test(html));
  assert.ok(/selectstart/.test(guard) && /contextmenu/.test(guard) && /selectionchange/.test(guard) && /removeAllRanges/.test(guard));
  assert.ok(/input, textarea, \[contenteditable="true"\]/.test(guard), 'text fields are the exception');
  assert.ok(!/stopPropagation/.test(guard), 'picker and report still hear contextmenu');
  assert.ok(/e\.preventDefault\(\)/.test(guard));
});

ok('intentional copy is unchanged: poem tap, the address, and the execCommand textarea', () => {
  const app = src('src/app.js');
  assert.ok(/function copyPoem\(post, e\)/.test(app) && /writeClipboard\(text\)/.test(app));
  assert.ok(/document\.createElement\('textarea'\)/.test(app) && /execCommand\('copy'\)/.test(app));
  assert.ok(/writeClipboard\('contact@haiku\.ooo'\)/.test(app));
  assert.ok(/onTapPoem: \(rec, el, e\) => rec && copyPoem\(rec\.post, e\)/.test(app));
});

ok('whoosh amount follows speed, ignores a slow read, and soft-clips a fling', () => {
  assert.equal(WHOOSH_DEAD, 220);
  assert.equal(WHOOSH_FULL, 2400);
  assert.equal(whooshAmount(0), 0);
  assert.equal(whooshAmount(WHOOSH_DEAD), 0);
  assert.equal(whooshAmount(100), 0);
  assert.equal(whooshAmount(-180), 0);
  const gentle = whooshAmount(520);
  const mid = whooshAmount(1100);
  const fling = whooshAmount(2600);
  const absurd = whooshAmount(8000);
  assert.ok(gentle > 0.05 && gentle < 0.35, 'gentle ' + gentle);
  assert.ok(mid > gentle && mid < fling);
  assert.ok(fling > 0.7 && fling < 1, 'fling ' + fling);
  assert.ok(absurd > fling && absurd <= 1);
  assert.equal(whooshAmount(-2600), whooshAmount(2600));
});

ok('whoosh level stays in the breeze range: soft flick under a fling, never a blast', () => {
  assert.equal(whooshLevel(0), 0);
  assert.equal(whooshLevel(-1), 0);
  const soft = whooshLevel(whooshAmount(520));
  const hard = whooshLevel(whooshAmount(2600));
  assert.ok(soft > 0.7 && soft < hard, 'soft ' + soft);
  assert.ok(hard > soft + 0.6 && hard < 2.6, 'hard ' + hard);
  assert.ok(whooshLevel(1) < 2.5 && whooshLevel(2) === whooshLevel(1));
});

ok('whoosh speed settles after the scroll stops and does not stick', () => {
  assert.equal(WHOOSH_RELEASE, 0.14);
  assert.equal(stepWhooshSpeed(1800, 1 / 60, 0.01), 1800, 'samples still arriving: hold');
  assert.ok(stepWhooshSpeed(1800, 1 / 60, 0.2) < 1700);
  let s = 2400;
  for (let i = 0; i < 45; i++) s = stepWhooshSpeed(s, 1 / 60, 0.3);
  assert.ok(s < WHOOSH_DEAD, 'settled ' + s);
  const stuck = stepWhooshSpeed(s, 1 / 60, 1);
  assert.ok(stuck <= s && stuck >= 0);
});

ok('the whoosh is one wind-bus voice, mute and hide stop it, and a jump is not a flick', () => {
  const sound = src('src/sound.js'), wire = src('src/sound-wire.js'), html = src('index.html'), app = src('src/app.js');
  assert.ok(/out\.connect\(lp\)\.connect\(p\)\.connect\(E\.bus\.wind\)/.test(sound), 'layered on the wind bus');
  assert.ok(/function whooshVoice/.test(sound) && /startWhoosh\(when\)/.test(sound) && /stopWhoosh\(when\)/.test(sound));
  assert.ok(/if \(m\) \{ this\.stopWhoosh\(\)/.test(sound), 'mute stops it before suspend');
  assert.ok(/if \(document\.hidden\) \{ this\.stopWhoosh\(\)/.test(sound));
  assert.ok(/this\.whoosh = null/.test(sound), 'rebuild drops the voice with the old context');
  assert.ok(/whooshStart/.test(wire) && /whooshEnd/.test(wire) && /updateWhoosh/.test(wire));
  assert.ok(/scroll-lock/.test(wire) && /dt < GAP/.test(wire) && /const GAP = 0\.12/.test(wire));
  assert.ok(/stepWhooshSpeed/.test(wire) && /whooshAmount/.test(wire));
  assert.ok(/navigator\.audioSession\.type = "playback"/.test(sound), 'silent-switch path stays');
  assert.ok(/src\/app\.js\?v=15\.14d"/.test(html));
  assert.ok(/sound-wire\.js\?v=15\.14/.test(app));
  assert.ok(/sound\.js\?v=15\.14/.test(wire));
  assert.ok(/reactions\.js\?v=15\.14/.test(app), '15.13 retouches reactions for comments; the whoosh stays on the sound wire');
  assert.ok(/name === 'whooshStart'\) \{ snd\.startWhoosh\(\)/.test(wire));
  assert.ok(/name === 'whooshEnd'\) \{ snd\.stopWhoosh\(\)/.test(wire));
});

console.log(n + ' round 15.12h checks passed');
