// Round 15.13e: the reaction bubble was covering the Comment button, so a tap hit a face
// and never opened compose. The bubble stays above the button, and the button stays on top.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

ok('the picker is kept above the Comment button, which stays on top', () => {
  const rx = src('src/reactions.js'), app = src('src/app.js');
  const place = rx.slice(rx.indexOf('function placePop'), rx.indexOf('function close'));
  assert.ok(/getElementById\('fab'\)/.test(place));
  assert.ok(/fab\.top - 8 - H/.test(place));
  assert.ok(/\.fab\.is-comment \{ z-index: 90; \}/.test(rx));
  assert.ok(/classList\.add\('is-comment'\)/.test(app));
  assert.ok(/classList\.remove\('is-comment'\)/.test(app));
  const down = rx.slice(rx.indexOf("document.addEventListener('pointerdown'"), rx.indexOf("document.addEventListener('pointermove'"));
  assert.ok(/!e\.target\.closest\?\.\('#fab'\)/.test(down));
});

ok('cache-bust is 15.13e on the picker and the button', () => {
  const html = src('index.html'), app = src('src/app.js');
  assert.ok(/src\/app\.js\?v=15\.15"/.test(html));
  assert.ok(/reactions\.js\?v=15\.15/.test(app));
  assert.ok(/scroll-engine2\.js\?v=15\.13b/.test(app));
  assert.ok(/report\.js\?v=15\.13/.test(app) && !/report\.js\?v=15\.13e/.test(app));
});

console.log(n + ' round 15.13e checks passed');
