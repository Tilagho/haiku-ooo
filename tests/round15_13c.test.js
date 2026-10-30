// Round 15.13c: dismissing the hold rolls the Comment button shut, then reopens Write.
// Placing a reaction and tapping Comment to compose do not take that path.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

ok('click-away, escape, and scroll dismiss the hold back to Write', () => {
  const app = src('src/app.js'), rx = src('src/reactions.js');
  const close = rx.slice(rx.indexOf('function close'), rx.indexOf('async function open'));
  assert.ok(/if \(shown && !placed\) sfx\('pickerBack'\)/.test(close));
  assert.ok(/if \(!placed\) onDismissHold\(\)/.test(close));
  assert.ok(/onDismissHold: dismissCommentHold/.test(app));
  const dismiss = app.slice(app.indexOf('function dismissCommentHold'), app.indexOf('function leaveCommentMode'));
  assert.ok(/suppressFabReturn \|\| composing\(\)/.test(dismiss));
  assert.ok(/commentTarget = null/.test(dismiss));
  assert.ok(/morphFab\(WRITE_LABEL\)/.test(dismiss));
  const morph = app.slice(app.indexOf('function morphFab'), app.indexOf('function holdForComment'));
  assert.ok(/sfx\('fabRoll'\)/.test(morph));
  assert.ok(/await fabArt\.rollUp\(\)/.test(morph));
  assert.ok(/fabArt\.setLabel\(next\)/.test(morph));
  assert.ok(/await fabArt\.unroll\(\)/.test(morph));
  assert.ok(/WRITE_LABEL = 'write a haiku'/.test(app) && /COMMENT_LABEL = 'comment'/.test(app));
});

ok('a placed reaction and the Comment tap do not roll back to Write', () => {
  const app = src('src/app.js'), rx = src('src/reactions.js');
  const choose = rx.slice(rx.indexOf('async function choose'), rx.indexOf('function cancelHold'));
  assert.ok(/close\(\{ light: true, placed: true \}\)/.test(choose));
  assert.ok(/suppressFabReturn = true; closeReactions\(\)/.test(app));
  const leave = app.slice(app.indexOf('function leaveCommentMode'), app.indexOf('function cheerComment'));
  assert.ok(/fabArt\.setLabel\(WRITE_LABEL\)/.test(leave));
  assert.ok(!/morphFab\(/.test(leave), 'compose already has the button rolled shut');
});

ok('cache-bust is 15.13c on the hold handoff only', () => {
  const html = src('index.html'), app = src('src/app.js');
  assert.ok(/src\/app\.js\?v=15\.14a"/.test(html));
  assert.ok(/reactions\.js\?v=15\.14/.test(app));
  assert.ok(/scroll-engine2\.js\?v=15\.13b/.test(app));
  assert.ok(/scroll-view\.js\?v=15\.13b/.test(app));
  assert.ok(/report\.js\?v=15\.13/.test(app) && !/report\.js\?v=15\.13c/.test(app));
  assert.ok(/sound-wire\.js\?v=15\.14/.test(app));
});

console.log(n + ' round 15.13c checks passed');
