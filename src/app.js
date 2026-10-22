import { checkHaiku } from './haiku.js';
import { createStore } from './store.js';
import { ScrollView } from './scroll-view.js';
import { loadLibrary } from './scroll-engine2.js';
import SPRITES from './sprites6.js';
import { Inky } from './inky.js';
import { clock } from './clock.js';
import { copyText } from './share.js';
import { mountScrollButton } from './scroll-button.js';
import { mountNoren } from './noren.js';
import { mountCompose } from './compose.js';
import { springAnimate, SPRINGS, prefersReducedMotion } from './spring.js';

const $ = s => document.querySelector(s);
const store = createStore();
const bubble = $('#bubble');
const reduced = prefersReducedMotion();

// ---------- helpers ----------
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function ago(t) {
  const s = Math.max(1, (Date.now() - t) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago';
}
const anim = (el, k, sp, o) => reduced ? null : springAnimate(el, k, sp, o);


// ---------- the scroll: art + poems composed together ----------
const view = new ScrollView($('#scroll'), { seed: 31, lib: await loadLibrary(SPRITES) });   // decode the art once (async inflate)
// tap a poem: no highlight (the scroll stays one painting); it is copied, with the site URL, and Inky says so
view.onTapPoem = (rec, el, e) => rec && copyPoem(rec.post, e);
async function writeClipboard(text) {
  try {   // (a permission prompt that never answers must not swallow the tap: give up after 700 ms and use the fallback)
    if (navigator.clipboard?.writeText && await Promise.race([navigator.clipboard.writeText(text).then(() => true), new Promise(r => setTimeout(() => r(false), 700))])) return true;
  } catch {}
  const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
  Object.assign(ta.style, { position: 'fixed', top: '0', left: '0', opacity: '0', pointerEvents: 'none' });
  document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
  let ok = false; try { ok = document.execCommand('copy'); } catch {} ta.remove(); getSelection()?.removeAllRanges(); return ok;
}
let lastCopied = '';
async function copyPoem(post, e) {
  const text = copyText(post); lastCopied = text;
  const ok = await writeClipboard(text);
  if (!composing() && inky.visible && inky.mode === 'roam') { inky.setMood(ok ? 'cheer' : 'worry'); inky.jump(.7); say(ok ? 'copied!' : 'could not copy', 1000); clock.wait(900).then(() => inky.mode === 'roam' && inky.setMood('happy')); }
  else floatNote(ok ? 'copied' : 'could not copy', e?.clientX ?? innerWidth / 2, e?.clientY ?? innerHeight / 2);
  return ok;
}
// small pixel word that rises and fades by the tap point (fallback when Inky is busy elsewhere)
function floatNote(text, x, y) {
  const d = document.createElement('span'); d.className = 'float-note'; d.textContent = text; document.body.appendChild(d);
  Object.assign(d.style, { left: Math.round(x) + 'px', top: Math.round(y - 28) + 'px' });
  d.animate([{ transform: 'translate(-50%, 0)', opacity: 1 }, { transform: 'translate(-50%, -8px)', opacity: 1, offset: .6 }, { transform: 'translate(-50%, -14px)', opacity: 0 }], { duration: 1000, easing: 'steps(6)', fill: 'both' })
    .finished.then(() => d.remove(), () => d.remove());
}
async function loadAll() {
  // the layout is a pure function of (seed, chronological post list), so build oldest -> newest
  const all = []; let before = Infinity;
  for (;;) { const { posts, nextBefore } = await store.list({ before, limit: 200 }); all.push(...posts); if (nextBefore === null) break; before = nextBefore; }
  all.sort((a, b) => a.createdAt - b.createdAt).forEach(p => view.add(p));
}

// ---------- Inky: the ink-drop mascot (canvas overlay) + his pixel speech bubble ----------
const inky = new Inky({ R: 7 });
inky.placeAt(innerWidth * 0.18, innerHeight - 78); inky.floor = inky.pageFloor(); inky.grounded = true;
let bubbleUntil = 0, bubbleBig = false, bubbleAnchor = null;
function say(text, ms = 1800, big = false, anchor = null) {
  bubbleAnchor = anchor;
  bubble.textContent = text; bubble.hidden = false; bubble.classList.toggle('big', big); bubbleBig = big;
  bubbleUntil = clock.now() + ms; placeBubble(); anim(bubble, [{ transform: 'scale(.2)' }, { transform: 'scale(1.15,.9)', offset: .4 }, { transform: 'scale(1)' }], SPRINGS.pop, { fill: 'none' });
}
function placeBubble() {
  let p = inky.pos;
  if (bubbleAnchor) { const r = bubbleAnchor.getBoundingClientRect(); p = { x: r.left + r.width * .7, top: r.top }; }
  const w = bubble.offsetWidth, h = bubble.offsetHeight;
  const left = Math.max(8, Math.min(innerWidth - w - 8, p.x - w + 26)), top = Math.max(8, p.top - h - 10);
  bubble.style.transform = ''; bubble.style.left = left + 'px'; bubble.style.top = top + 'px';
  bubble.style.setProperty('--tail', Math.max(14, Math.min(w - 20, p.x - left - 6)) + 'px');
}
clock.onTick(() => {
  if (bubble.hidden) return;
  if (clock.now() > bubbleUntil || (!inky.visible && !bubbleAnchor)) { bubble.hidden = true; return; }
  placeBubble();
});
// ---------- the write button: tap -> both rolled ends wind in and meet in the middle -> then the compose flow ----------
// HB.onWrite (default: the compose flow, src/compose.js) runs after the roll-up; `haiku:write` fires on window at the same moment.
let rolling = false;
const composing = () => !!compose?.opened || !!compose?.busy || document.body.classList.contains('composing');
async function writeTapped() {
  if (composing() || rolling) return; rolling = true;
  try { await fabArt?.rollUp(); } finally { rolling = false; }
  window.dispatchEvent(new CustomEvent('haiku:write'));
  await (window.HB?.onWrite || openCompose)();
}
const openCompose = () => compose?.open();
$('#fab')?.addEventListener('click', writeTapped);

function addNewPost(post) {
  const { node, played } = view.add(post, { animate: true });      // the poem types in, then its kanji seal is stamped
  requestAnimationFrame(() => view.scrollToPoem(node, reduced ? 'auto' : 'smooth'));
  played.then(() => { inky.setMood('cheer'); inky.jump(1); clock.wait(800).then(() => inky.setMood('happy')); });
  return node;
}

// HB.stampDemo() replays the seal stamp on the newest poem ({ type: true }: type the poem in first, then stamp)
async function stampDemo({ type = false } = {}) {
  const el = view.newest(); if (!el) return;
  view.scrollToPoem(el, 'auto'); await clock.wait(400);
  if (type) await view.typePoem(el);
  else { view.paintPoem(view.recOf(el), { seal: false }); await clock.wait(500); }
  await view.stampSeal(el);
}

// ---------- boot ----------
inky.onTap = () => { if (inky.mode === 'roam') { inky.setMood('happy'); say(['hehe!', 'that tickles', 'write a haiku?', '5-7-5!'][Math.floor(Math.random() * 4)], 1300); } };
const fabEl = $('#fab'), fabArt = fabEl ? mountScrollButton(fabEl) : null;
const norenEl = $('#noren'), noren = norenEl ? mountNoren(norenEl) : null;
const compose = mountCompose({ inky, view, store, fab: fabEl, fabArt, hideBoardBubble: () => { bubble.hidden = true; } });
// springy press: squash on touch, spring back on release
const booted = loadAll();

// test hooks for screenshots / e2e
// Public hooks (see README, "Seal-stamp hook"): the compose flow calls HB.addPost(post) or the pieces directly.
window.HB = { view, inky, clock, booted, fabArt, noren, compose, writeTapped, onWrite: null,
  rollUpButton: ms => fabArt?.rollUp(ms) ?? Promise.resolve(), unrollButton: ms => fabArt?.unroll(ms) ?? Promise.resolve(), copyText, copyPoem, lastCopied: () => lastCopied, stampDemo,
  typePoem: (el, o) => view.typePoem(el, o), stampSeal: (el, o) => view.stampSeal(el, o), addPost: addNewPost,
  openSheet: openCompose, closeSheet: () => compose?.cancel(), openCompose, rows: compose.inputs.map(input => ({ input })), store, checkHaiku, say,
  isBusy: () => !!compose?.busy, fill: (lines, name) => compose.fill(lines, name), submit: () => compose.submit() };
