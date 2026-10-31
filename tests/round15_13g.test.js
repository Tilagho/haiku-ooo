// Round 15.13g: deselect rolls the Comment button back to Write, both ways.
// 15.13f always re-armed Comment. A hold while the paper already said "comment" and no
// roll was in flight started a runner that finished before it was stored, so morphRunning
// stayed a settled promise. The next dismiss set the want to Write and returned. The
// button never rolled shut.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

ok('an idle same-word arm does not stick the runner, and a dismiss still rolls to Write', () => {
  const app = src('src/app.js');
  const morph = app.slice(app.indexOf('function morphFab'), app.indexOf('function holdForComment'));
  const running = morph.indexOf('if (morphRunning) return morphRunning');
  const idle = morph.indexOf('fabArt.label === label && (fabArt.p || 0) < 0.02');
  assert.ok(running > 0 && idle > running, 'skip a same-word arm only when nothing is rolling');
  assert.ok(/await Promise\.resolve\(\)/.test(morph), 'the runner yields before it can settle inside the assignment');
  assert.ok(/const next = \(!composing\(\) && morphWant\) \|\| want/.test(morph));
  assert.ok(/while \(morphWant === next\)/.test(morph), 'a dismiss during unroll starts the shut immediately');
  const hold = app.slice(app.indexOf('function holdForComment'), app.indexOf('function dismissCommentHold'));
  assert.ok(/morphFab\(COMMENT_LABEL\)/.test(hold));
  assert.ok(!/label !== COMMENT_LABEL/.test(hold), 'a hold during a dismiss roll still re-arms');
  const dismiss = app.slice(app.indexOf('function dismissCommentHold'), app.indexOf('function leaveCommentMode'));
  assert.ok(/morphFab\(WRITE_LABEL\)/.test(dismiss));
  assert.ok(/classList\.remove\('is-comment'\)/.test(dismiss));
});

ok('click-away and Escape still leave comment mode when the picker is already gone', () => {
  const app = src('src/app.js'), rx = src('src/reactions.js');
  const away = app.slice(app.indexOf('round 15.13g: click-away'), app.indexOf('const booted'));
  assert.ok(/closest\?\.\('#fab, #rx-pop, #compose'\)/.test(away));
  assert.ok(/reactions\?\.picking\) return/.test(away));
  assert.ok(/dismissCommentHold\(\)/.test(away));
  assert.ok(/e\.key !== 'Escape'/.test(away) && /reactions\?\.picking\) return/.test(away));
  const down = rx.slice(rx.indexOf("document.addEventListener('pointerdown'"), rx.indexOf("document.addEventListener('pointermove'"));
  assert.ok(/!e\.target\.closest\?\.\('#fab'\)/.test(down), 'a Comment tap is still not a picker dismiss');
  assert.ok(/if \(!placed\) onDismissHold\(\)/.test(rx));
});

ok('cache-bust is 15.13g on the comment toggle', () => {
  const html = src('index.html'), app = src('src/app.js');
  assert.ok(/src\/app\.js\?v=15\.14c"/.test(html));
  assert.ok(/reactions\.js\?v=15\.14c/.test(app));
  assert.ok(/scroll-engine2\.js\?v=15\.13b/.test(app));
  assert.ok(/report\.js\?v=15\.13/.test(app) && !/report\.js\?v=15\.13g/.test(app));
});

console.log(n + ' round 15.13g checks passed');
