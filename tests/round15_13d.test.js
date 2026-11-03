// Round 15.13d: a tap on Comment opens compose. pointerdown on the button is not a dismiss.
// Click-away, Escape, and scroll still roll Comment shut and reopen Write.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

ok('tapping Comment is not a picker dismiss', () => {
  const rx = src('src/reactions.js'), app = src('src/app.js');
  const down = rx.slice(rx.indexOf("document.addEventListener('pointerdown'"), rx.indexOf("document.addEventListener('pointermove'"));
  assert.ok(/!e\.target\.closest\?\.\('#rx-pop'\) && !e\.target\.closest\?\.\('#fab'\)/.test(down));
  assert.ok(/suppressFabReturn = true; closeReactions\(\)/.test(app));
  assert.ok(/await fabArt\?\.rollUp\(\)[\s\S]*haiku:write[\s\S]*\(window\.HB\?\.onWrite \|\| openCompose\)\(\)/.test(app));
  const open = app.slice(app.indexOf('const openCompose'), app.indexOf("$('#fab')"));
  assert.ok(/const parent = commentTarget/.test(open) && /compose\?\.open\(parent \? \{ parent \}/.test(open));
});

ok('a real dismiss still rolls back to Write, a placed reaction does not', () => {
  const rx = src('src/reactions.js'), app = src('src/app.js');
  const close = rx.slice(rx.indexOf('function close'), rx.indexOf('async function open'));
  assert.ok(/if \(!placed\) onDismissHold\(\)/.test(close));
  assert.ok(/if \(shown && !placed\) sfx\('pickerBack'\)/.test(close));
  assert.ok(/onDismissHold: dismissCommentHold/.test(app));
  assert.ok(/morphFab\(WRITE_LABEL\)/.test(app));
  const choose = rx.slice(rx.indexOf('async function choose'), rx.indexOf('function cancelHold'));
  assert.ok(/close\(\{ light: true, placed: true \}\)/.test(choose));
});

ok('cache-bust is 15.13d on the Comment tap only', () => {
  const html = src('index.html'), app = src('src/app.js');
  assert.ok(/src\/app\.js\?v=15\.15b"/.test(html));
  assert.ok(/reactions\.js\?v=15\.15/.test(app));
  assert.ok(/scroll-engine2\.js\?v=15\.13b/.test(app));
  assert.ok(/report\.js\?v=15\.13/.test(app) && !/report\.js\?v=15\.13d/.test(app));
  assert.ok(/sound-wire\.js\?v=15\.15/.test(app));
});

console.log(n + ' round 15.13d checks passed');
