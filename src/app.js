import { checkHaiku } from './haiku.js';
import { createStore } from './store.js?v=15.11';
import { ScrollView } from './scroll-view.js?v=15.11';
import { loadLibrary } from './scroll-engine2.js';
import SPRITES from './sprites6.js';
import { Inky } from './inky.js?v=15.12c';
import { SpeechScheduler, readMs, CheerBag } from './inky-mind.js';
import { renderBubble, U as BU } from './pixel-bubble.js';
import { clock } from './clock.js';
import { copyText } from './share.js';
import { mountWind } from './wind.js?v=15.10j';
import { mountScrollButton } from './scroll-button.js';
import { sfx } from './sfx.js';
import { mountNoren } from './noren.js?v=15.10j';   // round 15.10j (t237u): period flag gets two chichi, same as the other eight
import { mountCompose } from './compose.js';
import { mountCredits } from './credits.js';
import { springAnimate, SPRINGS, prefersReducedMotion } from './spring.js';
import { mountReports } from './report.js?v=15.12e';     // round 15.12e: a successful ✔ plays reportYes; the ask itself stays in app.js
import { mountReactions } from './reactions.js?v=15.12g'; // round 15.12g: date-line counts paint from 2, clear of the face
import { Feed } from './feed.js';               // round 15.6b: the shared scroll, newest first, older blocks load as you swipe down
import { mountSound } from './sound-wire.js?v=15.12e';   // round 15.12e: reportOpen / reportYes / reportNo ride the same play() path as the other one-shots

const $ = s => document.querySelector(s);
// round 15.6b: one store handle for everything (compose, reports, the feed); `cur` swaps to this device's own board if the
// shared scroll cannot be reached (see `booted` below)
const store = { cur: createStore(), get shared() { return this.cur.shared; }, list(o) { return this.cur.list(o); }, create(t, o) { return this.cur.create(t, o); },
  report(id, o) { return this.cur.report(id, o); }, count() { return this.cur.count(); },
  react(id, kind) { return this.cur.react(id, kind); }, reactionCounts(ids) { return this.cur.reactionCounts(ids); }, myReaction(id) { return this.cur.myReaction(id); } };
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
const LIB = await loadLibrary(SPRITES);                                                       // decode the art once (async inflate)
window.HBBoot?.mark(.5);   // round 15.10h: a real milestone for the boot bar (art decoded); src/boot-inky.js
const view = new ScrollView($('#scroll'), { seed: 31, lib: LIB });
// round 15.6b: older blocks of the shared scroll stack below the newest one (src/feed.js), each its own painting
const archive = document.createElement('div'); archive.id = 'archive'; archive.className = 'archive';
const sentinel = document.createElement('div'); sentinel.className = 'feed-more'; sentinel.setAttribute('aria-hidden', 'true');
$('#scroll').after(archive, sentinel);
function makeSegment(b, seed) {
  const host = document.createElement('div'); host.className = 'scroll seg'; host.dataset.block = b; archive.appendChild(host);
  const v = new ScrollView(host, { seed, lib: LIB, onTapPoem: (rec, el, e) => rec && copyPoem(rec.post, e) });
  import('./mist.js').then(m => m.mountMist(v, { clock, reduced }));
  import('./waterfall.js').then(m => m.mountWaterfalls(v, { clock, reduced }));
  return v;
}
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
  if (ok) sfx('copyCharm');                          // round 15.3: a successful copy: a tiny glass charm
  if (!composing() && inky.visible && inky.mode === 'roam' && inky.mood !== 'splat') { inky.setMood(ok ? 'cheer' : 'worry'); inky.jump(.7); say(ok ? 'copied!' : 'could not copy', 1000); clock.wait(900).then(() => inky.mode === 'roam' && inky.setMood('happy')); }
  else floatNote(ok ? 'copied' : 'could not copy', e?.clientX ?? innerWidth / 2, e?.clientY ?? innerHeight / 2);
  return ok;
}
// small pixel word that rises and fades by the tap point (fallback when Inky is busy elsewhere)
function floatNote(text, x, y, cls = '') {
  const d = document.createElement('span'); d.className = 'float-note' + (cls ? ' ' + cls : ''); d.textContent = text; document.body.appendChild(d);
  Object.assign(d.style, { left: Math.round(x) + 'px', top: Math.round(y - 28) + 'px' });
  d.animate([{ transform: 'translate(-50%, 0)', opacity: 1 }, { transform: 'translate(-50%, -8px)', opacity: 1, offset: .6 }, { transform: 'translate(-50%, -14px)', opacity: 0 }], { duration: 1000, easing: 'steps(6)', fill: 'both' })
    .finished.then(() => d.remove(), () => d.remove());
}
// round 15.10g2 (t226u): the end-of-board address. The mailto href opens the mail app with a fresh message to us; the same
// tap also copies the address (so a desktop with no mail app still gets something) and says 'copied' by the finger.
document.getElementById('end-mail-a')?.addEventListener('click', e => {
  const x = e.clientX || innerWidth / 2, y = e.clientY || innerHeight / 2;
  writeClipboard('contact@haiku.ooo').then(ok => { if (ok) { sfx('copyCharm'); floatNote('copied', x, y, 'end-mail-note'); } });   // round 15.10g3: © row font + grey
});
// round 15.6b: someone else's poem arrived (polling). At the top of the scroll and free: it types in and is stamped like
// your own; otherwise it is added quietly and the page is held still so nothing jumps under the reader's finger.
function incoming(post) {
  if (!reduced && scrollY < innerHeight * .6 && !composing() && !rolling && !document.hidden) {
    const { played } = view.add(post, { animate: true });
    played.then(() => { if (inky.mode === 'roam' && inky.visible && bubble.hidden && !asking) { say('a new haiku!', 1400); } });
  } else { const h0 = document.documentElement.scrollHeight; view.add(post); const d = document.documentElement.scrollHeight - h0; if (d && scrollY > 0) scrollBy({ top: d, behavior: 'instant' }); }
  reports?.markAll(); reactions?.refresh();
}

// ---------- Inky: the ink-drop mascot (canvas overlay) + his pixel speech bubble ----------
// The bubble is drawn pixel by pixel (src/pixel-bubble.js, the compose bubble's style: rounded, stubby tail, set a
// little away from him). One bubble at a time; it stays readMs(text) (2.5 s + 60 ms a character), then POPS.
const inky = new Inky({ R: 7 });
inky.placeAt(-80, innerHeight - 78); inky.entered = false; inky.floor = inky.pageFloor(); inky.fy = inky.floor; inky.grounded = true;
let bubbleUntil = 0, bubbleAnchor = null, popping = false, popTok = 0;   // popTok: a new bubble voids a pop still in flight (round 15.6b)
const speech = new SpeechScheduler();
let asking = null;      // round 15.6b: Inky is asking whether to report a poem; nothing else talks over him
let pickerOpen = () => false;   // round 15.11: the reaction picker is up
function say(text, ms = readMs(String(text)), big = false, anchor = null, extra = null) {
  if ((asking && !extra) || pickerOpen()) return;
  bubbleAnchor = anchor; bubble.classList.remove('asking'); popTok++; popping = false; bubble.getAnimations?.().forEach(a => a.cancel());
  bubble.classList.add('px'); bubble.innerHTML = ''; const t = document.createElement('span'); t.className = 'bt';
  String(text).split('\n').forEach((l, i) => { if (i) t.appendChild(document.createElement('br')); t.appendChild(document.createTextNode(l)); });
  if (extra) t.appendChild(extra);
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
  const tok = ++popTok, r = bubble.getBoundingClientRect(), done = () => { if (tok !== popTok) return; bubble.hidden = true; popping = false; speech.bubbleEnded(clock.now()); };
  if (asking) asking.end(false);            // the ask bubble popped without an answer (timed out, Inky picked up, compose opened): no report
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
// ---------- round 15.6b (Tiago, t183u): Inky handles reports ----------
// Hold a user poem: Inky asks "report" in an extended bubble with a ✕ and a ✔ in it. ✕ (or ignoring him,
// or scrolling away) = nothing happens; ✔ = report it (src/report.js does the rest). If he is off screen, picked up
// or splatted, the same bubble hangs off the poem itself. Hidden UI we hope is rarely needed.
// round 15.6e (Tiago, t194u + his inspiration image): chunky solid-black 8-bit ✕ / ✔ from his reference.
// round 15.10c (t207u, "split the difference"): 9-row grids at IU = 3 css px (between 15.10's ~2.33 and bubble outline's 4),
// keeping brushy asymmetric strokes; ✕ 27×27 and ✔ 33×27, both solid ink, 44 px tap targets.
const IU = 3, IC_INK = '#1a181c';
const ICON = {
  no: ['.......##', '##....###', '###.####.', '.######..', '..####...', '..####...', '.######..', '.###.###.', '###...##.'],
  yes: ['.........##', '.......####', '......####.', '.#...####..', '###.####...', '#######....', '.#####.....', '..###......', '...##......'] };
function iconCanvas(rows, color) {
  const cv = document.createElement('canvas'); cv.width = rows[0].length; cv.height = rows.length; cv.className = 'ask-ic';
  const g = cv.getContext('2d'), fill = { '#': color };
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (fill[c]) { g.fillStyle = fill[c]; g.fillRect(x, y, 1, 1); } }));
  Object.assign(cv.style, { width: cv.width * IU + 'px', height: cv.height * IU + 'px' }); return cv;
}
let lastPointer = ''; addEventListener('pointerdown', e => { lastPointer = e.pointerType; }, { capture: true, passive: true });
const inkyFree = () => inky.entered && inky.visible && inky.mode === 'roam' && inky.mood !== 'splat';
// round 15.12c: each Inky-anchored report bubble holds its own token, so a short "you reported this" line
// cannot release the ask that replaced it (or the other way around).
const reportPins = new Set();
function pinReport() {
  const token = {}; reportPins.add(token); inky.holdBubble('report', true);
  return () => { if (!reportPins.delete(token)) return; if (!reportPins.size) inky.holdBubble('report', false); };
}
function ask(el, { already = false } = {}) {
  const anchor = inkyFree() ? null : el;
  const unpin = anchor === null ? pinReport() : () => {};
  if (already) { if (anchor === null) inky.setMood('happy'); say('you reported this one', 1800, false, anchor); clock.wait(1900).then(unpin); return Promise.resolve(false); }
  return new Promise(resolve => {
    const row = document.createElement('span'); row.className = 'ask-row';
    const btn = (k, label, color) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'ask-' + k; b.setAttribute('aria-label', label); b.appendChild(iconCanvas(ICON[k], color)); row.appendChild(b); return b; };
    const no = btn('no', 'no, do not report', IC_INK), yes = btn('yes', 'yes, report this haiku', IC_INK);   // both solid ink (t194u)
    const y0 = scrollY, onScroll = () => { if (Math.abs(scrollY - y0) > 80) end(false); };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); end(false); } };
    let opened = false;
    const end = ans => { if (asking !== st) return; asking = null; unpin(); removeEventListener('scroll', onScroll); removeEventListener('keydown', key, true); bubble.classList.remove('asking');
      if (!ans && anchor === null && inky.mode === 'roam') inky.setMood('happy');
      if (opened && !ans) sfx('reportNo');   // round 15.12e: ✕ / escape / scroll / a popped ask. The ✔ chime waits until the report lands (src/report.js).
      popBubble(); resolve(ans); };
    const st = { el, end }; asking = st;
    say('report?', 15000, false, anchor, row);   // round 15.10 (t205u): bigger report? + middle icons
    bubble.classList.add('asking'); bubble.setAttribute('role', 'dialog'); bubble.setAttribute('aria-label', 'report this haiku?');
    if (!bubble.hidden && row.isConnected) { opened = true; sfx('reportOpen'); }   // round 15.12e: neutral chime as the ask appears (not the picker's positive open)
    if (anchor === null) { inky.setMood('worry'); inky.jump(.35); }   // a small hop in place; the bubble follows. Patrol stays locked until end().
    no.addEventListener('click', e => { e.stopPropagation(); end(false); });
    yes.addEventListener('click', e => { e.stopPropagation(); end(true); });
    addEventListener('scroll', onScroll, { passive: true }); addEventListener('keydown', key, true);
    if (lastPointer !== 'touch' && lastPointer !== 'pen') no.focus({ preventScroll: true });   // keyboard / mouse: ✕ takes focus (Escape cancels); a finger: no focus ring
  });
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
let closeReactions = () => {};
async function writeTapped() {
  closeReactions();
  if (composing() || rolling) return; rolling = true;
  sfx('fabRoll');                                   // round 15.2: the button rolls itself up: the crunchy old-paper roll (the write scroll's roll-up sound), once, at the tap
  try { await fabArt?.rollUp(); } finally { rolling = false; }
  window.dispatchEvent(new CustomEvent('haiku:write'));
  await (window.HB?.onWrite || openCompose)();
}
const openCompose = () => { closeReactions(); return compose?.open(); };
$('#fab')?.addEventListener('click', writeTapped);

// round 15.10 (Tiago t204u, t208u): YOUR poem has landed and its number seal just settled: board Inky celebrates (src/inky.js celebrate:
// excited hops, ^ ^ grin, confetti, music notes; no arms), the triumphant chime plays (src/sound.js inkyCelebrate) and he cheers a line from a
// shuffle bag (src/inky-mind.js CHEERS). Busy elsewhere (held, splatted, asking about a report, compose open again): just the old little cheer hop.
const cheers = new CheerBag();
function celebratePost() {
  if (!composing() && inkyFree() && !asking && !pickerOpen() && !inky.bubbleHeld && inky.celebrate()) {
    sfx('inkyCelebrate');
    const line = cheers.next(); say(line, Math.max(2200, readMs(line) - 300));
    return line;
  }
  if (inky.mode === 'roam' && inky.splatT <= 0) { inky.setMood('cheer'); inky.jump(1); clock.wait(800).then(() => inky.mood === 'cheer' && inky.setMood('happy')); }
  return null;
}
function addNewPost(post) {
  const { node, played } = view.add(post, { animate: true });      // the poem types in, then its kanji seal is stamped
  requestAnimationFrame(() => view.scrollToPoem(node, reduced ? 'auto' : 'smooth'));
  played.then(() => celebratePost());
  reports?.markAll(); reactions?.refresh();                        // a poem you just wrote can be reported (the seal) and reacted to
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
// round 15.10h2 (t234u): the write button boots rolled shut and, once boot Inky has swooshed off, opens as its own roll-up played
// backwards (scroll-button.js openReverse) with the same old-paper roll sound as the close (fabRoll)
if (fabArt && window.HBBoot && !window.HBBoot.gone) { fabArt.p = 1; fabArt.paint(0);
  addEventListener('hb:bootgone', () => { if (rolling || composing() || fabArt.p < 1) return; sfx('fabRoll'); fabArt.openReverse(); }, { once: true }); }
const norenEl = $('#noren'), noren = norenEl ? mountNoren(norenEl) : null;
const credits = mountCredits({ clock, reduced });   // round 14.5: the © line's 'credits' scroll (src/credits.js)
const compose = mountCompose({ inky, view, store, fab: fabEl, fabArt, hideBoardBubble: () => { bubble.hidden = true; }, celebrate: celebratePost });
const sound = mountSound({ view, inky, clock });
// round 15.6: reports. Inky thanks whoever reported (or a small float note if he is busy elsewhere)
// round 15.6b: the shared scroll (src/feed.js) and reports (src/report.js: Inky asks, then thanks whoever reported)
let reports = null, reactions = null;
const feed = new Feed({ main: view, store, seed: 31, makeSegment, sentinel, busy: () => composing() || rolling,
  onIncoming: incoming, onPainted: () => { reports?.markAll(); reactions?.refresh(); } });
reports = mountReports({ feed, store, ask, reduced, busy: () => composing() || !!asking || !!reactions?.picking, onReported: ({ removed, el, error }) => {
  const r = el?.getBoundingClientRect?.(), text = error ? 'hm, that did not go through.\ntry again?' : removed ? 'poof! it is gone' : 'thank you!\nreported';
  if (!composing() && inkyFree()) { inky.setMood(error ? 'worry' : 'cheer'); if (!error) inky.jump(.6); say(text, 1600); clock.wait(1200).then(() => inky.mode === 'roam' && inky.setMood('happy')); }
  else floatNote(error ? 'could not report' : removed ? 'removed' : 'reported', r ? r.left + r.width / 2 : innerWidth / 2, r ? r.top : innerHeight / 2);
} });
// round 15.11: hold the poem body → Inky's bubble of six glyphs. Hold the seal → report (above).
reactions = mountReactions({ feed, store, inky, inkyFree, reduced, busy: () => composing() || !!asking || !!reports?.asking,
  hush: () => { if (!asking) popBubble(); },
  onFail: msg => { const x = innerWidth / 2, y = innerHeight / 2; if (!composing() && inkyFree()) { inky.setMood('worry'); say(msg, 1600); } else floatNote(msg, x, y); } });
pickerOpen = () => !!reactions?.picking;
closeReactions = () => reactions?.close();
// the shared scroll unreachable (offline, server down): fall back to this device's own board so the page still works
const booted = feed.boot().catch(async e => {
  console.warn('feed: shared scroll unreachable, using this device only', e);
  const { LocalStore } = await import('./store.js'); store.cur = new LocalStore();
  feed.segments.length = 0; feed.done = false; feed.low = Infinity; feed.pending = []; feed.painted.clear();
  return feed.boot();
}).then(() => { reports.markAll(); reactions?.refresh(); feed.startPolling(); store.cur.warm?.(); });   // 15.6c: Firestore signs this phone in anonymously in the background
// round 15.10g: the boot Inky (index.html) steps aside as soon as the feed has painted (or given up), just before the real one slips in
// round 15.10h (t230u/t231u): the staged boot (src/boot-inky.js): after a ~1 s minimum beat his bar tops up, the board fades in and he swooshes
// off to the top-right; bootDone resolves once he is gone + a 500 ms beat (15.10h2, t232u), then the board's black Inky rolls in from the bottom-left
const bootInky = $('#boot-inky'), dropBootInky = () => { document.documentElement.classList.remove('hb-booting'); bootInky?.classList.add('gone'); setTimeout(() => bootInky?.remove(), 220); };
const bootDone = booted.catch(() => {}).then(() => window.HBBoot ? window.HBBoot.done({ sfx }) : dropBootInky());
// he slips in from off-screen once the board is up and boot Inky is on his way out
booted.then(() => bootDone).then(() => { if (!composing()) inky.enter(); else inky.entered = true; });

// test hooks for screenshots / e2e
// Public hooks (see README, "Seal-stamp hook"): the compose flow calls HB.addPost(post) or the pieces directly.
window.HB = { feed, ask, asking: () => asking, sound, reports, reactions, credits, view, inky, clock, booted, bootDone, fabArt, noren, compose, wind, writeTapped, onWrite: null,
  rollUpButton: ms => fabArt?.rollUp(ms) ?? Promise.resolve(), unrollButton: ms => fabArt?.unroll(ms) ?? Promise.resolve(), copyText, copyPoem, lastCopied: () => lastCopied, stampDemo,
  typePoem: (el, o) => view.typePoem(el, o), stampSeal: (el, o) => view.stampSeal(el, o), addPost: addNewPost,
  openSheet: openCompose, closeSheet: () => compose?.cancel(), openCompose, rows: compose.inputs.map(input => ({ input })), store, checkHaiku, say, speech, popBubble,
  celebratePost, cheers,
  isBusy: () => !!compose?.busy, fill: (lines, name) => compose.fill(lines, name), submit: () => compose.submit() };
