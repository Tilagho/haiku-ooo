// Round 15.13: a hold on a top-level poem arms comment mode. A reply is a 5-7-5 under that
// poem, indented, with no kanji seal. Replies are flat. The parent's seq does not move.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkHaiku } from '../src/haiku.js';
import { createStore, LocalStore, DEMO_COMMENTS } from '../src/store.js';
import { withComments } from '../src/feed.js';
import { poemLayouts, poemStyle, sealOrder, tuckX, COMMENT_INDENT } from '../src/scroll-engine2.js';
import { drawScrollButton } from '../src/scroll-button.js';

const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let n = 0; const pending = [];
const ok = (name, fn) => pending.push([name, fn]);
const POEM = 'the number stays put\nsoft ink settles in beside\nand leaves the red seal';
const REPLY = 'a margin of breath\njust to the right of the brush\nstill five and seven';
const REPLY_2 = 'a smaller voice sits\njust under the quiet pond\nstill counting ripples';

ok('demo replies and a fresh reply are real 5-7-5', () => {
  for (const text of [POEM, REPLY, REPLY_2, ...DEMO_COMMENTS.map(c => c.text)]) {
    const r = checkHaiku(text);
    assert.equal(r.ok, true, r.reason || text);
  }
});

ok('a comment does not take a seal and cannot sit under another comment', async () => {
  const s = new LocalStore();
  const before = (await s.list()).posts.map(p => p.seq + ':' + p.id);
  const poem = await s.create(POEM, { author: 'a' });
  assert.ok(poem.seq > 0);
  const tops = (await s.list()).posts.map(p => p.seq + ':' + p.id);
  assert.notEqual(tops.join(), before.join());
  const c1 = await s.create(REPLY, { author: 'b', parentId: poem.id });
  assert.equal(c1.parentId, poem.id);
  assert.equal(c1.parentSeq, poem.seq);
  assert.equal(c1.comment, true);
  assert.ok(!c1.seq);
  const page = await s.list();
  assert.deepEqual(page.posts.map(p => p.seq + ':' + p.id), tops, 'publishing a reply does not renumber the board');
  assert.equal(page.posts.find(p => p.id === c1.id), undefined);
  assert.equal(page.comments.filter(c => c.parentId === poem.id).length, 1);
  await assert.rejects(() => s.create(REPLY_2, { parentId: c1.id }), e => /not on the scroll/.test(e.reason));
  await assert.rejects(() => s.create('not a haiku at all', { parentId: poem.id }), /syllable|line|needs|only/);
  await assert.rejects(() => s.create(REPLY, { parentId: poem.id }), /already/);
  const reported = await s.report(c1.id, { reporter: 'device-1' });
  assert.equal(reported.already, false);
  assert.equal(reported.count, 1);
});

ok('?api=local&demo=comments hangs two replies on the newest sample', async () => {
  const s = createStore({ search: '?api=local&demo=comments' });
  const page = await s.list();
  assert.equal(page.posts[0].id, 'sample-01');
  assert.equal(page.comments.length, 2);
  assert.ok(page.comments.every(c => c.parentId === 'sample-01' && c.parentSeq === page.posts[0].seq && !c.seq));
  assert.equal(page.posts.some(p => p.parentId), false);
});

ok('replies paint between their parent and the next-older poem, newest tucked closest', () => {
  const order = withComments(
    [{ id: 'old', seq: 1 }, { id: 'parent', seq: 2 }],
    [
      { id: 'new', parentId: 'parent', createdAt: 20 },
      { id: 'old-reply', parentId: 'parent', createdAt: 10 },
      { id: 'stray', parentId: 'missing', createdAt: 30 },
    ],
  );
  assert.deepEqual(order.map(p => p.id), ['old', 'old-reply', 'new', 'parent']);
});

ok('a comment uses the poem brush, no seal, and tucks right of the parent', () => {
  const text = 'an old silent pond\na frog jumps into the pond\nsplash silence again';
  const createdAt = Date.UTC(2026, 9, 26);
  const poem = { id: 'p', text, createdAt, author: '' };
  const comment = { id: 'c', parentId: 'p', parentSeq: 4, text, createdAt, author: '' };
  const style = poemStyle(31, 4, poem.id);
  style.sealOrder = sealOrder(4, poem.id, null);
  const Lp = poemLayouts(poem, 4, style)[0];
  const Lc = poemLayouts(comment, 0, { align: 'left', step: 12, dir: 1, noSeal: true })[0];
  assert.equal(Lc.u, Lp.u, 'same brush scale');
  assert.equal(Lc.seal, null);
  assert.equal(Lc.sealPos, null);
  assert.ok(Lc.tick && Lc.tick.h >= 8);
  assert.deepEqual(Lc.lines.map(l => l.t), Lp.lines.map(l => l.t));
  assert.equal(COMMENT_INDENT, 18);
  assert.equal(tuckX(30, 80), 48);
  assert.equal(tuckX(360, 80), 302, 'a wide reply stays on the scroll');
  assert.ok(tuckX(30, 80) > 30);
});

ok('the write button can swap its word, and the screen reader matches', () => {
  const write = drawScrollButton('write a haiku'), comment = drawScrollButton('comment');
  assert.ok(comment.W < write.W && comment.W > 40);
  assert.ok(comment.text.reduce((s, v) => s + v, 0) > 40, 'the word comment is drawn');
  const js = src('src/scroll-button.js');
  assert.ok(/api\.setLabel = \(next\)/.test(js));
  assert.ok(/sr\.textContent = next/.test(js) && /button\.setAttribute\('aria-label', next\)/.test(js));
  assert.ok(/api\.rollUp = \(ms = 540\)/.test(js) && /api\.openReverse = \(ms = 540\)/.test(js) && /api\.unroll = \(ms = 700\)/.test(js));
});

ok('hold a poem arms comment mode; hold a reply does not; publish clears it', () => {
  const app = src('src/app.js'), rx = src('src/reactions.js'), compose = src('src/compose.js'), report = src('src/report.js');
  assert.ok(/onHoldPoem: holdForComment/.test(app));
  assert.ok(/if \(!rec\.post\?\.parentId\) onHoldPoem\(rec\.post\)/.test(rx));
  assert.ok(/if \(!z \|\| z\.stamp\) return/.test(rx));
  assert.ok(/if \(z\.comment\) return/.test(rx));
  assert.ok(/fabArt\.setLabel\(next\)/.test(app) && /COMMENT_LABEL = 'comment'/.test(app));
  assert.ok(/onFabRestore: leaveCommentMode/.test(app));
  assert.ok(/parentId: parent\.id, parentSeq: parent\.seq/.test(compose));
  assert.ok(/comment on this haiku/.test(compose) && /a reply\.<br>still 5-7-5/.test(compose));
  assert.ok(/if \(z\.comment \|\| z\.stamp\) return z\.el/.test(report), 'a reply can be reported');
  assert.ok(/rec\.post\?\.parentId\) \{ composeLabel/.test(rx) || /if \(rec\.post\?\.parentId\) \{ composeLabel\(el\); return; \}/.test(rx));
  const engine = src('src/scroll-engine2.js');
  assert.ok(/const n = comment \? 0 :/.test(engine));
  const fb = src('src/firebase-store.js');
  const fn = fb.slice(fb.indexOf('async _createComment'), fb.indexOf('async report'));
  assert.ok(/collection\(db, 'comments'\)/.test(fn));
  assert.ok(!/haikuMeta/.test(fn), 'a reply does not take the next seal');
});

ok('cache-bust for this round is 15.13; whoosh and Inky stay put', () => {
  const html = src('index.html'), app = src('src/app.js'), rx = src('src/reactions.js');
  assert.ok(/src\/app\.js\?v=15\.14"/.test(html));
  assert.ok(/store\.js\?v=15\.14/.test(app));
  assert.ok(/scroll-view\.js\?v=15\.13b/.test(app));
  assert.ok(/scroll-engine2\.js\?v=15\.13b/.test(app));
  assert.ok(/scroll-button\.js\?v=15\.13/.test(app));
  assert.ok(/compose\.js\?v=15\.13/.test(app));
  assert.ok(/feed\.js\?v=15\.13/.test(app));
  assert.ok(/report\.js\?v=15\.13/.test(app));
  assert.ok(/reactions\.js\?v=15\.14/.test(app));
  assert.ok(/react-data\.js\?v=15\.14/.test(rx));
  assert.ok(/inky\.js\?v=15\.12c/.test(app));
  assert.ok(/sound-wire\.js\?v=15\.14/.test(app));
  assert.ok(/sound\.js\?v=15\.14/.test(src('src/sound-wire.js')));
  assert.ok(/src\/style\.css\?v=15\.12h/.test(html));
  assert.ok(/src\/no-select\.js\?v=15\.12h/.test(html));
  const rules = src('firestore.comments.rules');
  assert.ok(/match \/comments\/\{id\}/.test(rules));
  assert.ok(/hasAny\(\['seq'\]\)/.test(rules));
  assert.ok(/haiku-ooo/.test(rules) && !/tiago\.ooo/.test(rules.replace('never tiago.ooo', '')));
  assert.ok(/parentId ASC/.test(rules));
});

for (const [name, fn] of pending) {
  await fn();
  n++;
  console.log('ok', name);
}
console.log(n + ' round 15.13 checks passed');
