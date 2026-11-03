// Round 15.16: a comment from a phone that already commented can post again after the hour,
// and the sign field does not invite the iOS autofill yellow wash.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commentPosterPlan, COMMENT_GAP_MS, COMMENT_HOUR_MS, COMMENT_PER_HOUR } from '../src/comment-rate.js';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

const prev = (over) => ({ last: over.last, windowStart: over.windowStart, n: over.n });

ok('a first comment opens a window at n = 1', () => {
  const plan = commentPosterPlan(null, 1_000_000);
  assert.deepEqual(plan, { ok: true, n: 1, freshWindow: true });
});

ok('a second comment in the same hour bumps n and keeps the window', () => {
  const now = 5_000_000;
  const plan = commentPosterPlan(prev({ last: now - COMMENT_GAP_MS, windowStart: now - 60_000, n: 1 }), now);
  assert.deepEqual(plan, { ok: true, n: 2, freshWindow: false });
});

ok('the twelfth comment in the hour is the last, and the next one waits', () => {
  const now = 5_000_000;
  const windowStart = now - 60_000;
  const last = now - COMMENT_GAP_MS;
  assert.equal(commentPosterPlan(prev({ last, windowStart, n: 11 }), now).n, 12);
  const blocked = commentPosterPlan(prev({ last, windowStart, n: COMMENT_PER_HOUR }), now);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'rate');
});

ok('after an hour the next comment starts a fresh window, still 20s after the last', () => {
  const now = 9_000_000;
  const stale = prev({ last: now - COMMENT_HOUR_MS, windowStart: now - COMMENT_HOUR_MS, n: 4 });
  assert.deepEqual(commentPosterPlan(stale, now), { ok: true, n: 1, freshWindow: true });
  const soon = commentPosterPlan(prev({ last: now - 1000, windowStart: now - COMMENT_HOUR_MS - 1000, n: 4 }), now);
  assert.equal(soon.ok, false);
  assert.equal(soon.error, 'slow down');
});

ok('the 15.13 rules cannot reset the hour, so the fallback keeps the window and bumps n', () => {
  const now = 9_000_000;
  const stale = prev({ last: now - COMMENT_HOUR_MS, windowStart: now - COMMENT_HOUR_MS, n: 1 });
  const honest = commentPosterPlan(stale, now);
  assert.equal(honest.freshWindow, true);
  assert.equal(honest.n < COMMENT_PER_HOUR, true);
  const legacy = commentPosterPlan(stale, now, { legacy: true });
  assert.deepEqual(legacy, { ok: true, n: 2, freshWindow: false });
  assert.equal(commentPosterPlan(prev({ last: now - COMMENT_HOUR_MS, windowStart: now - COMMENT_HOUR_MS, n: 12 }), now, { legacy: true }).ok, false);
});

ok('rules paste allows the hour reset and still caps the same hour at 12', () => {
  const rules = src('firestore.comments.rules');
  assert.ok(/request\.resource\.data\.n == 1/.test(rules));
  assert.ok(/duration\.value\(1, 'h'\)/.test(rules));
  assert.ok(/duration\.value\(20, 's'\)/.test(rules));
  assert.ok(/posterFresh\(\) \|\| posterBump\(\)/.test(rules));
  assert.ok(/15\.16/.test(rules) && /haiku-ooo/.test(rules));
  assert.ok(/removed ASC, parentId ASC/.test(rules));
  const fb = src('src/firebase-store.js');
  const fn = fb.slice(fb.indexOf('async _createComment'), fb.indexOf('async report'));
  assert.ok(/commentPosterPlan/.test(fn));
  assert.ok(/commit\(true\)/.test(fn));
  assert.ok(!/haikuMeta/.test(fn));
});

ok('the sign field does not ask iOS for a given name, and autofill cannot paint yellow', () => {
  const compose = src('src/compose.js'), css = src('src/compose.css');
  assert.ok(!/given-name/.test(compose));
  assert.ok(/name="haiku-sign" autocomplete="haiku-sign"/.test(compose));
  assert.ok(/animationName === 'hb-autofill'/.test(compose));
  assert.ok(/#compose \.sign input:-webkit-autofill/.test(css));
  assert.ok(/-webkit-text-fill-color: transparent/.test(css));
  assert.ok(/background-color 99999s/.test(css));
  assert.ok(/@keyframes hb-autofill/.test(css));
  const html = src('index.html'), app = src('src/app.js');
  assert.ok(/src\/app\.js\?v=15\.16"/.test(html));
  assert.ok(/src\/compose\.css\?v=15\.16"/.test(html));
  assert.ok(/compose\.js\?v=15\.16/.test(app));
  assert.ok(/store\.js\?v=15\.16/.test(app));
  assert.ok(/firebase-store\.js\?v=15\.16/.test(src('src/store.js')));
});

console.log(n + ' round 15.16 checks passed');
