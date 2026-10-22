import { countLine, checkHaiku, PATTERN, LIMITS } from './haiku.js';
import { createStore } from './store.js';
import { ScrollView } from './scroll-view.js';
import { loadLibrary } from './scroll-engine2.js';
import SPRITES from './sprites6.js';
import { sumiSVG } from './icons.js';
import { Inky } from './inky.js';
import { clock } from './clock.js';
import { springAnimate, SPRINGS, LiveSpring, SQUASH_LAND, JELLY, SHAKE, prefersReducedMotion } from './spring.js';

const $ = s => document.querySelector(s);
const store = createStore();
const sheet = $('#sheet'), scrim = $('#scrim'), rowsEl = $('#rows'), msg = $('#msg'), postBtn = $('#postBtn'), seal = $('#seal'), bubble = $('#bubble');
const reduced = prefersReducedMotion();
let total = 0, open = false, busy = false;

// ---------- helpers ----------
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function ago(t) {
  const s = Math.max(1, (Date.now() - t) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago';
}
const anim = (el, k, sp, o) => reduced ? null : springAnimate(el, k, sp, o);

// ---------- status bar ----------
function tick() { const d = new Date(); $('#clock').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
tick(); setInterval(tick, 15000);
function setCount(n) { total = n; $('#count').textContent = n; }

// ---------- the scroll: art + poems composed together ----------
const view = new ScrollView($('#scroll'), { seed: 31, lib: await loadLibrary(SPRITES) });   // decode the art once (async inflate)
// tapping a playful hanko in the scroll: Inky-style bubble with what it says
view.onTapStamp = el => say(`${el.dataset.jp} = ${el.dataset.en}`, 2600, false, el);
async function loadAll() {
  // the layout is a pure function of (seed, chronological post list), so build oldest -> newest
  const all = []; let before = Infinity;
  for (;;) { const { posts, nextBefore } = await store.list({ before, limit: 200 }); all.push(...posts); if (nextBefore === null) break; before = nextBefore; }
  all.sort((a, b) => a.createdAt - b.createdAt).forEach(p => view.add(p));
  setCount(all.length);
}

// ---------- compose sheet ----------
const rows = PATTERN.map((target, i) => {
  const row = document.createElement('div'); row.className = 'row';
  row.innerHTML = `
    <div class="row-main">
      <input type="text" inputmode="text" enterkeyhint="${i < 2 ? 'next' : 'send'}" maxlength="${LIMITS.maxLineChars}" autocapitalize="sentences" spellcheck="true"
        aria-label="line ${i + 1}, ${target} syllables" placeholder="${['five syllables here', 'then seven syllables here', 'and five to finish'][i]}">
      <div class="meter" data-state="under" aria-live="polite"><div class="segs">${'<i></i>'.repeat(target)}</div><b>0/${target}</b></div>
    </div>
    <div class="chips"></div>`;
  rowsEl.appendChild(row);
  return { row, target, input: row.querySelector('input'), meter: row.querySelector('.meter'), chips: row.querySelector('.chips'), last: { count: 0, state: 'under' } };
});

function setMascot(el, mood, px) { if (el && el.dataset.mood !== mood) { el.dataset.mood = mood; el.innerHTML = sumiSVG(mood, px); anim(el.firstChild, JELLY, SPRINGS.pop, { fill: 'none' }); } }

// ---------- Inky: the ink-drop mascot (canvas overlay) + his pixel speech bubble ----------
const inky = new Inky({ R: 7 });
inky.placeAt(innerWidth * 0.18, innerHeight - 78); inky.floor = inky.pageFloor(); inky.grounded = true;
let bubbleUntil = 0, bubbleBig = false, bubbleAnchor = null;
function say(text, ms = 1800, big = false, anchor = null) {
  bubbleAnchor = anchor;
  bubble.textContent = text; bubble.hidden = false; bubble.classList.toggle('big', big); bubbleBig = big;
  bubbleUntil = clock.now() + ms; anim(bubble, [{ transform: 'scale(.2)' }, { transform: 'scale(1.15,.9)', offset: .4 }, { transform: 'scale(1)' }], SPRINGS.pop, { fill: 'none' });
}
clock.onTick(() => {
  if (bubble.hidden) return;
  if (clock.now() > bubbleUntil || (!inky.visible && !bubbleAnchor)) { bubble.hidden = true; return; }
  let p = inky.pos;
  if (bubbleAnchor) { const r = bubbleAnchor.getBoundingClientRect(); p = { x: r.left + r.width * .7, top: r.top }; }
  const w = bubble.offsetWidth, h = bubble.offsetHeight;
  const left = Math.max(8, Math.min(innerWidth - w - 8, p.x - w + 26)), top = Math.max(8, p.top - h - 10);
  bubble.style.transform = ''; bubble.style.left = left + 'px'; bubble.style.top = top + 'px';
  bubble.style.setProperty('--tail', Math.max(14, Math.min(w - 20, p.x - left - 6)) + 'px');
});
const dockPos = () => { const r = $('#inkyDock').getBoundingClientRect(); return { x: r.left + r.width / 2, foot: r.bottom - 2 }; };

function updateRow(r) {
  const res = countLine(r.input.value, r.target);
  const n = r.input.value.trim() ? res.count : 0;
  const state = n === r.target && res.ok ? 'ok' : n > r.target ? 'over' : 'under';
  const segs = r.meter.querySelector('.segs');
  segs.innerHTML = Array.from({ length: Math.max(r.target, n) }, (_, k) => `<i class="${k < n ? 'on' : ''} ${k >= r.target ? 'x' : ''}"></i>`).join('');
  r.meter.dataset.state = state;
  r.meter.querySelector('b').textContent = `${n}/${r.target}`;
  r.chips.innerHTML = res.words.map(w => `<span class="${w.source === 'guess' ? 'guess' : ''}" title="${w.source === 'guess' ? 'not in dictionary, estimated' : ''}">${esc(w.word.toLowerCase())}<em>${w.counts.length > 1 ? w.counts.join('|') : w.counts[0]}</em></span>`).join('');
  if (n !== r.last.count) anim(r.meter, state === 'ok' && r.last.state !== 'ok' ? [{ transform: 'scale(1)' }, { transform: 'scale(1.5,.7)', offset: .2 }, { transform: 'scale(.85,1.2)', offset: .45 }, { transform: 'scale(1)' }] : JELLY, SPRINGS.pop, { fill: 'none' });
  r.last = { count: n, state };
  return state;
}

function updateAll() {
  const states = rows.map(updateRow);
  const ok = states.every(s => s === 'ok');
  const wasReady = postBtn.classList.contains('ready');
  postBtn.classList.toggle('ready', ok); postBtn.setAttribute('aria-disabled', String(!ok));
  if (ok && !wasReady) anim(postBtn, JELLY, SPRINGS.pop, { fill: 'none' });
  const any = rows.some(r => r.input.value.trim());
  msg.className = 'msg' + (ok ? ' good' : states.includes('over') ? ' bad' : '');
  const guessed = rows.flatMap(r => countLine(r.input.value, r.target).guessed);
  msg.textContent = ok ? 'five, seven, five. the brush is ready.'
    : !any ? 'count your syllables. the meter keeps time.'
    : states.includes('over') ? `line ${states.indexOf('over') + 1} has too many syllables. trim a word.`
    : guessed.length ? `estimating: ${[...new Set(guessed)].slice(0, 4).join(', ')} (not in the dictionary)` : 'keep going…';
  coach(states, ok, any);
}

// Inky reacts to each line: cheers the moment a line hits its target, worries when one goes over.
let lastStates = ['under', 'under', 'under'];
function coach(states, ok, any) {
  if (inky.mode !== 'coach' || busy) { lastStates = states; return; }
  const NAMES = ['five', 'seven', 'five'];
  const hit = states.findIndex((s, i) => s === 'ok' && lastStates[i] !== 'ok');
  const over = states.findIndex((s, i) => s === 'over' && lastStates[i] !== 'over');
  if (ok) { inky.setMood('cheer'); inky.jump(1.2); inky.sparkle(14); say('5-7-5! post it!', 2200); }
  else if (over >= 0) { inky.setMood('worry'); say(`line ${over + 1}: too many! trim a word`, 2200); }
  else if (hit >= 0) { inky.setMood('cheer'); inky.jump(.9); inky.sparkle(8); say(`line ${hit + 1}: ${NAMES[hit]}! nice`, 1500); clock.wait(900).then(() => inky.mode === 'coach' && !busy && inky.setMood('happy')); }
  else if (states.includes('over')) inky.setMood('worry');
  else inky.setMood(any ? 'think' : 'happy');
  lastStates = states;
}

rows.forEach((r, i) => {
  r.input.addEventListener('input', updateAll);
  r.input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); if (i < 2) rows[i + 1].input.focus(); else $('#compose').requestSubmit(); }
    if (e.key === 'Backspace' && !r.input.value && i > 0) { e.preventDefault(); rows[i - 1].input.focus(); }
  });
  r.input.addEventListener('paste', e => {                       // pasting a whole haiku fills all three lines
    const t = e.clipboardData.getData('text'); const parts = t.includes('\n') ? t.split(/\r?\n/).filter(s => s.trim()) : t.includes(' / ') ? t.split(' / ') : null;
    if (!parts || parts.length < 2) return;
    e.preventDefault(); parts.slice(0, 3 - i).forEach((p, k) => rows[i + k].input.value = p.trim()); updateAll();
  });
});


// ---------- opening: ink floods up from the button, the sheet appears, the ink gathers into Inky ----------
async function openSheet() {
  if (open || busy) return; open = true; busy = true;
  const fab = $('#fab').getBoundingClientRect(), fx = fab.left + fab.width / 2;
  document.body.style.overflow = 'hidden'; bubble.hidden = true;
  updateAll();
  if (reduced) { sheet.hidden = false; scrim.hidden = false; inky.mode = 'coach'; inky.dock = dockPos; const d = dockPos(); inky.placeAt(d.x, d.foot); inky.grounded = true; busy = false; rows[0].input.focus({ preventScroll: true }); return; }
  // Inky dives into the button...
  inky.setMood('cheer'); await inky.hopTo(fx, fab.top + 6, .32, 14);
  inky.visible = false; anim($('#fab'), [{ transform: 'translateX(-50%) scale(1)' }, { transform: 'translateX(-50%) scale(1.25,.7)', offset: .3 }, { transform: 'translateX(-50%) translateY(140px) scale(.8,1.2)' }], { stiffness: 200, damping: 30 });
  // ...and the ink geysers up and floods the screen
  inky.startFlood(fx, innerHeight * 0.3);
  await clock.wait(280);
  sheet.hidden = false; scrim.hidden = false; sheet.classList.add('inked');
  anim(sheet, [{ transform: 'translateX(-50%) translateY(30%) scale(.96,1.08)' }, { transform: 'translateX(-50%) translateY(0) scale(1,1)' }], SPRINGS.sheet);
  await clock.wait(160);
  // the flood drains; the surface sheds droplets that fly up and gather into one blob in the corner dock
  const d = dockPos(); inky.R = 9;
  inky.gatherTo(d.x, d.foot - inky.R * 4 * 0.7, inky.R);
  sheet.classList.remove('inked');
  await clock.wait(1000);
  // the blob becomes Inky: body pops in at the gather point with a squash, the leftover balls merge in
  inky.mode = 'coach'; inky.dock = dockPos; inky.placeAt(d.x, d.foot - 18); inky.vy = -20; inky.grounded = false; inky.floor = d.foot / 4;
  inky.visible = true; inky.s = -.4; inky.wobble(1); inky.gather = null; inky.setMood('happy');
  await clock.wait(320);
  say('hi! give me 5-7-5', 2200);
  busy = false; lastStates = ['under', 'under', 'under']; updateAll();
  rows[0].input.focus({ preventScroll: true });
}
async function closeSheet({ quiet = false } = {}) {
  if (!open || busy) return; open = false; document.body.style.overflow = '';
  const a = anim(sheet, [{ transform: 'translateX(-50%) translateY(0) scale(1)' }, { transform: 'translateX(-50%) translateY(108%) scale(1.04,.9)' }], { stiffness: 260, damping: 26 });
  anim(scrim, [{ opacity: 1 }, { opacity: 0 }], { stiffness: 300, damping: 30 });
  anim($('#fab'), [{ transform: 'translateX(-50%) translateY(140px) scale(.8,1.2)' }, { transform: 'translateX(-50%) translateY(0) scale(1)' }], SPRINGS.drop);
  // Inky leaps back down to the page
  inky.mode = 'roam'; inky.dock = null; inky.R = 7; inky.setMood(quiet ? 'cheer' : 'happy');
  inky.hopTo(Math.min(innerWidth - 40, Math.max(40, inky.pos.x)), innerHeight - 78, .55, 30).then(() => { inky.floor = inky.pageFloor(); });
  if (a) await Promise.race([a.finished.catch(() => {}), clock.wait(700)]);
  sheet.hidden = true; scrim.hidden = true; seal.hidden = true;
}
$('#fab').addEventListener('click', openSheet);
$('#closeSheet').addEventListener('click', () => closeSheet());
scrim.addEventListener('click', () => closeSheet());
addEventListener('keydown', e => e.key === 'Escape' && closeSheet());

// ---------- submit: Inky stamps non-haiku DENIED; a real haiku gets a celebration and flows into the scroll ----------
$('#compose').addEventListener('submit', async e => {
  e.preventDefault();
  if (busy) return;
  const text = rows.map(r => r.input.value.trim()).join('\n');
  const check = checkHaiku(text);
  if (!check.ok) return deny(check);
  try {
    busy = true;
    const post = await store.create(text);
    inky.setMood('cheer'); inky.spin = .9; inky.jump(1.4); inky.sparkle(26); say('a real haiku!', 1400);
    msg.className = 'msg good'; msg.textContent = 'accepted. the brush lets go.';
    await clock.wait(1100);
    busy = false; rows.forEach(r => r.input.value = ''); updateAll();
    await closeSheet({ quiet: true });
    addNewPost(post);
  } catch (err) {
    busy = false; msg.className = 'msg bad'; msg.textContent = err.reason || 'could not post, try again';
    deny({ reason: err.reason || 'rejected', lines: [] });
  }
});

async function deny(check) {
  busy = true; bubble.hidden = true;
  msg.className = 'msg bad'; msg.textContent = `not a haiku: ${check.reason}. ${check.lines.length ? check.lines.map(l => l.count).join('-') + ', not 5-7-5' : ''}`;
  const area = $('#rows').getBoundingClientRect(), tx = area.left + area.width * .5, ty = area.top + area.height * .55;
  if (reduced) { showSeal(tx, ty); say('NOT A HAIKU!', 2400, true); busy = false; return; }
  // grab the hanko, hop over the poem, and SLAM
  inky.hanko = true; inky.setMood('angry'); inky.wobble(.6);
  await clock.wait(250);
  inky.mode = 'stamp'; inky.dock = null;
  await inky.hopTo(tx, ty - 70, .42, 40);
  inky.s = -.35; await clock.wait(160);                                     // wind-up hang in the air
  inky.floor = ty / 4; inky.grounded = false; inky.vy = 330; inky.vx = 0;
  await new Promise(res => { inky.onLand = () => { inky.onLand = null; res(); }; });
  showSeal(tx, ty);
  inky.splat(7, 1.1); inky.splat(6, 1, [217, 67, 47]);
  anim(sheet, [0, -9, 8, -6, 5, -3, 0].map((v, i) => ({ transform: `translateX(calc(-50% + ${v}px)) translateY(${i % 2 ? 3 : -2}px)` })), { stiffness: 300, damping: 14 }, { fill: 'none' });
  anim(document.querySelector('#page'), [0, 4, -4, 3, -2, 0].map(v => ({ transform: `translate(${v}px, ${-v}px)` })), { stiffness: 300, damping: 14 }, { fill: 'none' });
  inky.hanko = false; inky.setMood('shout');
  await clock.wait(140);
  // bounce off the seal so it can be read, and shout from beside it
  const side = tx > innerWidth / 2 ? -1 : 1;
  inky.hopTo(tx + side * 118, ty + 46, .36, 26);
  say('NOT A HAIKU!', 2100, true);
  await clock.wait(2000);
  inky.setMood('worry');
  const d = dockPos(); await inky.hopTo(d.x, d.foot, .5, 30);
  inky.mode = 'coach'; inky.dock = dockPos; busy = false;
  say('count again? I believe in you', 2000);
  clock.wait(1200).then(() => { if (!seal.hidden) anim(seal, [{ opacity: 1 }, { opacity: 0 }], { stiffness: 120, damping: 30 })?.finished.then(() => seal.hidden = true); });
}
function showSeal(x, y) {
  const sr = sheet.getBoundingClientRect();
  seal.hidden = false; seal.style.left = (x - sr.left) + 'px'; seal.style.top = (y - sr.top + sheet.scrollTop) + 'px';
  anim(seal, [{ transform: 'translate(-50%,-50%) scale(2.2)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(.82,1.12)', opacity: 1, offset: .3 }, { transform: 'translate(-50%,-50%) scale(1.08,.94)', offset: .6 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }], { stiffness: 420, damping: 18 });
}

function inkSplash(x, y, n = 16) {
  if (reduced) return;
  for (let k = 0; k < n; k++) {
    const d = document.createElement('i'); d.className = 'splat'; const s = 4 * (1 + Math.floor(Math.random() * 3));
    Object.assign(d.style, { left: x + 'px', top: y + 'px', width: s + 'px', height: s + 'px' }); document.body.appendChild(d);
    const ang = Math.random() * Math.PI * 2, dist = 30 + Math.random() * 70;
    const dx = Math.round(Math.cos(ang) * dist / 4) * 4, dy = Math.round(Math.sin(ang) * dist / 4) * 4;
    d.animate([{ transform: 'translate(0,0)', opacity: 1 }, { transform: `translate(${dx}px, ${dy - 20}px)`, opacity: 1, offset: .5 }, { transform: `translate(${dx * 1.2}px, ${dy + 40}px)`, opacity: 0 }],
      { duration: 700 + Math.random() * 300, easing: 'steps(9)' }).finished.then(() => d.remove());
  }
}

function addNewPost(post) {
  setCount(total + 1);
  const { node } = view.add(post, { animate: true });
  requestAnimationFrame(() => view.scrollToPoem(node, reduced ? 'auto' : 'smooth'));
  clock.wait(2000).then(() => { const r = node.getBoundingClientRect(); inkSplash(r.right - 10 + scrollX, r.bottom - 10 + scrollY, 10); inky.setMood('happy'); inky.jump(1); });
}

// ---------- boot ----------
setMascot($('#endMascot'), 'sleep', 4);
inky.onTap = () => { if (inky.mode === 'roam') { inky.setMood('happy'); say(['hehe!', 'that tickles', 'write a haiku?', '5-7-5!'][Math.floor(Math.random() * 4)], 1300); } };
loadAll();

// test hooks for screenshots / e2e
window.HB = { view, inky, clock, openSheet, closeSheet, rows, store, checkHaiku, say, isBusy: () => busy, fill: lines => { lines.forEach((l, i) => rows[i].input.value = l); updateAll(); }, submit: () => $('#compose').requestSubmit() };
