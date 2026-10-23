import { checkHaiku } from './haiku.js';
import { createStore } from './store.js';
import { ScrollView } from './scroll-view.js';
import { loadLibrary } from './scroll-engine2.js';
import SPRITES from './sprites6.js';
import { Inky } from './inky.js';
import { SpeechScheduler, readMs } from './inky-mind.js';
import { renderBubble, U as BU } from './pixel-bubble.js';
import { clock } from './clock.js';
import { copyText } from './share.js';
import { mountWind } from './wind.js';
import { mountScrollButton } from './scroll-button.js';
import { mountNoren } from './noren.js';
import { mountCompose } from './compose.js';
import { mountCredits } from './credits.js';
import { springAnimate, SPRINGS, prefersReducedMotion } from './spring.js';

const $ = s => document.querySelector(s);
const store = createStore();
const bubble = $('#bubble'), bcv = document.createElement('canvas'); bcv.className = 'bcv';
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
import('./mist.js').then(m => m.mountMist(view, { clock, reduced }));     // round 14 rolling sumi mist (src/mist.js): over the ink, under the birds + poems
import('./waterfall.js').then(m => m.mountWaterfalls(view, { clock, reduced }));   // round 14.1 waterfall shimmer (src/waterfall.js): only the falling water
import('./birds.js').then(m => m.mountBirds(view, { clock, reduced }));   // round 13 background birds (src/birds.js, background worker)
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
  if (!composing() && inky.visible && inky.mode === 'roam' && inky.mood !== 'splat') { inky.setMood(ok ? 'cheer' : 'worry'); inky.jump(.7); say(ok ? 'copied!' : 'could not copy', 1000); clock.wait(900).then(() => inky.mode === 'roam' && inky.setMood('happy')); }
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
// The bubble is drawn pixel by pixel (src/pixel-bubble.js, the compose bubble's style: rounded, stubby tail, set a
// little away from him). One bubble at a time; it stays readMs(text) (2.5 s + 60 ms a character), then POPS.
const inky = new Inky({ R: 7 });
inky.placeAt(-80, innerHeight - 78); inky.entered = false; inky.floor = inky.pageFloor(); inky.fy = inky.floor; inky.grounded = true;
let bubbleUntil = 0, bubbleAnchor = null, popping = false;
const speech = new SpeechScheduler();
function say(text, ms = readMs(String(text)), big = false, anchor = null) {
  bubbleAnchor = anchor; popping = false; bubble.getAnimations?.().forEach(a => a.cancel());
  bubble.classList.add('px'); bubble.innerHTML = ''; const t = document.createElement('span'); t.className = 'bt';
  String(text).split('\n').forEach((l, i) => { if (i) t.appendChild(document.createElement('br')); t.appendChild(document.createTextNode(l)); });
  bubble.append(bcv, t); bubble.hidden = false; bubble.classList.toggle('big', big);
  bubble.style.width = bubble.style.height = '';
  const r = t.getBoundingClientRect(); bubble._bw = Math.ceil(r.width / BU); bubble._bh = Math.ceil(r.height / BU); bubble._key = '';
  bubble.style.width = bubble._bw * BU + 'px'; bubble.style.height = bubble._bh * BU + 'px';
  bubbleUntil = clock.now() + ms; placeBubble();
  if (!reduced) bubble.animate([{ transform: `translateY(${2 * BU}px) scale(.6)`, opacity: 0 }, { transform: `translateY(${-BU}px) scale(1.06)`, opacity: 1, offset: .5 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'steps(3, end)' });
}
// it POPS: a quick swell, gone, and a ring of ink specks where it was
function popBubble() {
  if (bubble.hidden || popping) return; popping = true;
  const r = bubble.getBoundingClientRect(), done = () => { bubble.hidden = true; popping = false; speech.bubbleEnded(clock.now()); };
  if (reduced) return done();
  inky.pop(r.left + r.width / 2, r.top + r.height / 2, r.width);
  const a = bubble.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(1.14)', opacity: 1, offset: .5 }, { transform: 'scale(1.3)', opacity: 0 }], { duration: 130, easing: 'steps(2, end)', fill: 'forwards' });
  clock.wait(130).then(() => { done(); a.cancel(); });
}
function placeBubble() {
  const bw = bubble._bw, bh = bubble._bh, W = bw * BU, H = bh * BU, p = inky.pos;
  let hx = p.x, hy = p.top + 6;
  if (bubbleAnchor) { const r = bubbleAnchor.getBoundingClientRect(); hx = r.left + r.width * .7; hy = r.top; }
  const right = hx < innerWidth / 2, GAP = 14;                                           // off to the roomier side, a little away
  let left = right ? hx + 10 : hx - 10 - W, top = hy - H - GAP - 2 * BU;
  left = Math.max(6, Math.min(innerWidth - W - 6, left)); top = Math.max(6, top);
  left = Math.round(left / BU) * BU; top = Math.round(top / BU) * BU;
  bubble.style.left = left + 'px'; bubble.style.top = top + 'px';
  // stubby tail from the bottom edge toward his head, stopping short of him
  const bx = Math.max(left + 4 * BU, Math.min(left + W - 4 * BU, right ? left + 5 * BU : left + W - 5 * BU)), by = top + H;
  let dx = hx - bx, dy = hy - by; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
  const len = Math.max(2 * BU, Math.min(4 * BU, L - GAP)), tip = { x: Math.floor((bx + dx * len - left) / BU), y: Math.max(bh, Math.floor((by + dy * len - top) / BU)) };
  const key = [bw, bh, tip.x, tip.y, bubble.classList.contains('big')].join();
  if (key !== bubble._key) {
    bubble._key = key; const r = renderBubble(bcv, { bw, bh, tip, round: true, red: bubble.classList.contains('big') });
    Object.assign(bcv.style, { left: r.ox * BU + 'px', top: r.oy * BU + 'px', width: r.W * BU + 'px', height: r.H * BU + 'px' });
  }
}
clock.onTick(() => {
  const now = clock.now();
  // ambient speech: every 25-60 s, never while composing, one bubble at a time, a cooldown after any bubble
  if (inky.entered && inky.mode === 'roam' && inky.visible && inky.mood !== 'splat') {
    const line = speech.tick(now, { composing: composing(), busy: rolling, hidden: document.hidden, bubbleUp: !bubble.hidden });
    if (line) say(line.text);
  }
  if (bubble.hidden || popping) return;
  if (now > bubbleUntil || composing() || (!inky.visible && !bubbleAnchor)) { popBubble(); return; }
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
// taps on Inky: squish -> annoyed -> MAD -> SPLAT (src/inky-mind.js TapMeter); he only talks back some of the time
const TAP_SAYS = { squish: ['hehe!', 'that tickles', null, null], annoyed: ['hey.', 'hm.', null], mad: ['STOP poking!', 'grr…', 'i am INK, not a button', null] };
inky.onTap = kind => {
  if (kind === 'splat') return popBubble();
  const opts = TAP_SAYS[kind]; if (!opts) return;
  const t = opts[Math.floor(Math.random() * opts.length)]; if (t && (bubble.hidden || kind === 'mad')) say(t, 1200);
};
inky.onPopUp = () => { if (bubble.hidden) say('…ow.', 1000); };
inky.onDragStart = () => popBubble();                 // picked up: whatever he was saying pops
const wind = mountWind({ view, reduced });            // the leaf-blower gust for the write button + the poem scrolls (src/wind.js)
const fabEl = $('#fab'), fabArt = fabEl ? mountScrollButton(fabEl, { wind: () => wind.at(.92) }) : null;
const norenEl = $('#noren'), noren = norenEl ? mountNoren(norenEl) : null;
const credits = mountCredits({ clock, reduced });   // round 14.5: the © line's 'credits' scroll (src/credits.js)
const compose = mountCompose({ inky, view, store, fab: fabEl, fabArt, hideBoardBubble: () => { bubble.hidden = true; } });
// springy press: squash on touch, spring back on release
const booted = loadAll();
// he slips in from off-screen once the board is up
booted.then(() => clock.wait(reduced ? 0 : 450)).then(() => { if (!composing()) inky.enter(); else inky.entered = true; });

// test hooks for screenshots / e2e
// Public hooks (see README, "Seal-stamp hook"): the compose flow calls HB.addPost(post) or the pieces directly.
window.HB = { credits, view, inky, clock, booted, fabArt, noren, compose, wind, writeTapped, onWrite: null,
  rollUpButton: ms => fabArt?.rollUp(ms) ?? Promise.resolve(), unrollButton: ms => fabArt?.unroll(ms) ?? Promise.resolve(), copyText, copyPoem, lastCopied: () => lastCopied, stampDemo,
  typePoem: (el, o) => view.typePoem(el, o), stampSeal: (el, o) => view.stampSeal(el, o), addPost: addNewPost,
  openSheet: openCompose, closeSheet: () => compose?.cancel(), openCompose, rows: compose.inputs.map(input => ({ input })), store, checkHaiku, say, speech, popBubble,
  isBusy: () => !!compose?.busy, fill: (lines, name) => compose.fill(lines, name), submit: () => compose.submit() };
