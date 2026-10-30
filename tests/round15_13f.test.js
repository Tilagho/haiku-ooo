// Round 15.13f: after a hold is dismissed, holding the next poem must roll the button
// to Comment again. The dismiss roll keeps the word "comment" until it shuts, so a new
// hold that skipped re-arming let that roll finish as Write under the new picker.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

ok('a new hold re-arms Comment even while the paper still says comment', () => {
  const app = src('src/app.js');
  const hold = app.slice(app.indexOf('function holdForComment'), app.indexOf('function dismissCommentHold'));
  assert.ok(/morphFab\(COMMENT_LABEL\)/.test(hold));
  assert.ok(!/label !== COMMENT_LABEL/.test(hold), 'do not skip the roll just because the current word is comment');
  assert.ok(/commentTarget = \{ id: post\.id/.test(hold));
  assert.ok(/classList\.add\('is-comment'\)/.test(hold));
  const dismiss = app.slice(app.indexOf('function dismissCommentHold'), app.indexOf('function leaveCommentMode'));
  assert.ok(/morphFab\(WRITE_LABEL\)/.test(dismiss));
  assert.ok(/commentTarget = null/.test(dismiss));
  const morph = app.slice(app.indexOf('function morphFab'), app.indexOf('function holdForComment'));
  assert.ok(/morphWant = label/.test(morph));
  assert.ok(/if \(morphRunning\) return morphRunning/.test(morph), 'a dismiss already rolling picks up the new want');
  assert.ok(/const next = \(!composing\(\) && morphWant\) \|\| want/.test(morph));
});

ok('cache-bust is 15.13f on the hold handoff', () => {
  const html = src('index.html'), app = src('src/app.js');
  assert.ok(/src\/app\.js\?v=15\.14a"/.test(html));
  assert.ok(/reactions\.js\?v=15\.14/.test(app));
  assert.ok(/scroll-engine2\.js\?v=15\.13b/.test(app));
  assert.ok(/report\.js\?v=15\.13/.test(app) && !/report\.js\?v=15\.13f/.test(app));
});

console.log(n + ' round 15.13f checks passed');
