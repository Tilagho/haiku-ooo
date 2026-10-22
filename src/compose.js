// THE COMPOSE FLOW (ported from the c4 mockup, mockups/compose/c4-flow.html).
//   write button rolls up (app.js) -> board Inky dives in -> the black floods up and stays -> the worn scroll unrolls
//   -> red Inky swings in from the right and parks lower-left -> write (正 tallies, syllable dots, coaching; keyboard
//   aware through visualViewport) -> sign (optional, max 12) -> seal -> the scroll rolls up -> Inky runs off -> the black
//   drains into the board's Inky -> the poem types itself in and its kanji seal stamps on (saved through store.js).
//   Not 5-7-5: 却下 / 不可 hanko slam, angry Inky. Back (ink-blot arrow) or Esc: Inky stamps it, runs off sad, the black recedes.
import { countLine, checkHaiku, PATTERN } from './haiku.js';
import { clock } from './clock.js';
import { springAnimate, springEasing, SPRINGS, JELLY } from './spring.js';
import { RedInky } from './inky-red.js';
import { renderBubble, U as BU } from './pixel-bubble.js';
import { InkField } from './ink-field.js';
import { ScrollArt, drawWax, SP, RH } from './scroll-art.js';

const NAMES = ['five', 'seven', 'five'];
const PH = ['five syllables', 'then seven', 'and five to end'];
const NO_RUSH = ['no rush~', 'take your time.', 'no rush. the pond<br>can wait.', '…still here!<br>no rush', 'counting clouds.<br>no rush'];
const ROWS_OPEN = 70, ROWS_KB = 40, IDLE_MS = 9000;
const DENY_STAMPS = [{ src: 'assets/compose/stamp-kyakka.png', alt: '却下 (rejected)' }, { src: 'assets/compose/stamp-fuka.png', alt: '不可 (not allowed)' }];
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const anim = (el, k, sp = SPRINGS.pop, o = {}) => el && springAnimate(el, k, sp, { fill: 'none', ...o });
// the sign field: max 12, letters / numbers / spaces / basic punctuation the board font can draw; everything else is stripped
export const cleanName = s => s.normalize('NFC').replace(/[^A-Za-z0-9 .,'!?&_\-éèêëáàâäíîïóôöúûüñç]/g, '').replace(/\s+/g, ' ').replace(/^\s+/, '').slice(0, 12);

// Per line: count, state (empty/under/ok/over), and the raw text split into word / space tokens with their own counts.
export function analyze(texts) {
  return texts.map((text, i) => {
    const target = PATTERN[i], res = countLine(text, target), n = text.trim() ? res.count : 0;
    const state = !text.trim() ? 'empty' : n === target && res.ok ? 'ok' : n > target ? 'over' : 'under';
    const tokens = (text.match(/\S+|\s+/g) || []).map(t => {
      if (/^\s+$/.test(t)) return { space: true, text: t };
      const r = countLine(t, null), guess = r.words.some(w => w.source === 'guess'), alt = r.words.some(w => w.counts.length > 1);
      return { text: t, n: r.possible[0], alt: alt ? r.possible.join('|') : null, guess, words: r.words };
    });
    return { i, text, target, n, state, ok: state === 'ok', tokens, guessed: res.guessed };
  });
}
const mirrorHTML = a => a.tokens.map(t => t.space ? t.text : `<span class="w${t.guess ? ' guess' : ''}" data-n="${t.alt || t.n}${t.guess ? '?' : ''}" data-c="${t.n}">${esc(t.text)}</span>`).join('');
let mctx = null;
function fitSize(texts, avail, sizes = [24, 16]) {     // 24px if all lines fit, else 16px (both pixel-exact at DPR 2)
  mctx ||= document.createElement('canvas').getContext('2d');
  for (const s of sizes) { mctx.font = `${s}px ChiKareGo2`; if (texts.every(t => mctx.measureText(t).width <= avail)) return s; }
  return sizes[sizes.length - 1];
}
const STROKES = [[0, 0, 7, 1], [3, 0, 1, 7], [3, 3, 3, 1], [1, 3, 1, 4], [0, 6, 7, 1]];
export function tally(target, n) {                     // 正 tally marks: one stroke per syllable, red past the target
  const glyphs = Math.ceil(Math.max(target, n) / 5); let out = '';
  for (let g = 0; g < glyphs; g++) {
    const strokes = Math.min(5, Math.max(target, n) - g * 5);
    out += `<svg viewBox="0 0 7 7">${STROKES.slice(0, strokes).map((s, k) => { const idx = g * 5 + k; return `<rect x="${s[0]}" y="${s[1]}" width="${s[2]}" height="${s[3]}" class="${idx < n ? (idx >= target ? 'x' : 'on') : ''}"/>`; }).join('')}</svg>`;
  }
  return out;
}

const MARKUP = `
<div id="cveil"></div>
<div id="cstage">
  <section class="cscroll" id="cscroll" hidden role="dialog" aria-modal="true" aria-label="write a haiku">
    <canvas id="scv"></canvas>
    <div class="pw" id="pw">
      <div class="paper" id="cpaper">
        <div id="clines"></div>
        <p class="note" id="cnote" aria-live="polite"></p>
        <div class="sign" id="csign"><label for="cname">sign</label><span class="nm"><span class="nmm" aria-hidden="true"></span><input id="cname" type="text" maxlength="12" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="done" placeholder="(optional)" aria-label="sign with your name, up to 12 characters, optional"></span></div>
        <button class="back" id="cback" type="button" aria-label="back to the board, discard this haiku"><span class="blot"><canvas id="arw"></canvas></span></button>
        <button class="cpost" id="cpost" type="button" aria-label="seal and post"><span class="lbl" id="plbl">seal &amp; post</span><span class="wax"><canvas id="wax"></canvas><b id="waxch">印</b></span></button>
      </div>
    </div>
  </section>
</div>
<div class="deny" id="cdeny" hidden><img src="${DENY_STAMPS[0].src}" alt="${DENY_STAMPS[0].alt}"></div>`;

// deps: { inky (board Inky), view (ScrollView), store, fab, fabArt, hideBoardBubble() }
export function mountCompose(deps) {
  const root = document.createElement('div'); root.id = 'compose'; root.innerHTML = MARKUP; document.body.appendChild(root);
  const $ = s => root.querySelector(s), body = document.body, html = document.documentElement;
  const theme = document.querySelector('meta[name="theme-color"]'), theme0 = theme?.content;
  const field = new InkField({ z: 20 });
  const inky = new RedInky({ R: 9, z: 60, bigEyes: true, fury: true });
  const art = new ScrollArt($('#scv'), { maxRows: 92, seed: 1575, outline: 2 });
  const bubble = document.createElement('div'); bubble.className = 'cbubble'; bubble.hidden = true; root.appendChild(bubble);
  const bcv = document.createElement('canvas'); bcv.className = 'bcv';
  const deny_ = $('#cdeny');
  // preload both stamps so the first slam never shows a blank
  DENY_STAMPS.forEach(s => { const i = new Image(); i.src = s.src; });
  const waxReady = document.createElement('canvas'), waxIdle = document.createElement('canvas');
  drawWax(waxReady, { ready: true }); drawWax(waxIdle, { ready: false });
  (function drawArrow(cv, n = 13) {            // red ink-blot button with a chunky cream arrow, the wax seal's twin
    cv.width = n; cv.height = n; const ctx = cv.getContext('2d'), c = (n - 1) / 2;
    const bump = [0, .5, .1, .6, .2, .4, 0, .55];
    const A = ['...a...', '..aa...', '.aaaaaa', 'aaaaaaa', '.aaaaaa', '..aa...', '...a...'];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = x - c, dy = y - c, a = Math.atan2(dy, dx), r = Math.hypot(dx, dy), k = Math.floor(((a + Math.PI) / (2 * Math.PI)) * 8) % 8, lim = 6.3 - bump[k];
      if (r > lim) continue;
      let col = r > lim - 1 ? '#7a1a10' : (dx + dy < -4 ? '#f06a50' : '#d63a28');
      const ax = x - 3, ay = y - 3;
      if (ay >= 0 && ay < 7 && ax >= 0 && ax < 7 && A[ay][ax] === 'a') col = '#fff4e0';
      else if (ay - 1 >= 0 && ay - 1 < 7 && ax - 1 >= 0 && ax - 1 < 7 && A[ay - 1][ax - 1] === 'a' && col !== '#7a1a10') col = '#5e130b';
      ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1);
    }
  })($('#arw'));
  $('#cback').addEventListener('pointerdown', e => e.preventDefault());
  function paintWax(ready) { const c = $('#wax'); c.width = 11; c.height = 11; c.getContext('2d').drawImage(ready ? waxReady : waxIdle, 0, 0); }
  paintWax(false);
  $('#cscroll').style.width = art.cssWidth + 'px';
  addEventListener('resize', () => { $('#cscroll').style.width = art.cssWidth + 'px'; });
  clock.onTick(() => { $('#pw').style.height = Math.max(0, art.openCss - 6) + 'px'; });   // the DOM paper clip follows the canvas paper

  // ---------- the real keyboard: follow the visual viewport (its height AND its offset) ----------
  const VV = window.visualViewport;
  let vvh = innerHeight, vvt = 0, kbUp = false;
  function syncViewport() {
    vvh = Math.round(VV ? VV.height : innerHeight); vvt = Math.round(VV ? VV.offsetTop : 0);
    html.style.setProperty('--vvh', vvh + 'px'); html.style.setProperty('--vvt', vvt + 'px');
    const was = kbUp; kbUp = opened && vvh < innerHeight * .8; body.classList.toggle('kb', kbUp);
    if (was !== kbUp) fitPaper();
  }
  if (VV) { VV.addEventListener('resize', syncViewport); VV.addEventListener('scroll', syncViewport); }
  addEventListener('resize', syncViewport);
  const rowsNow = () => kbUp ? ROWS_KB : ROWS_OPEN;
  let busyScroll = false;
  function fitPaper() {
    $('#cpaper').style.setProperty('--ph', rowsNow() * SP + 'px');
    if (opened && !busyScroll) art.setTarget(rowsNow(), { k: 260, c: 24 });   // the keyboard rolls the scroll up a little
  }

  // ---------- the writing lines ----------
  const linesEl = $('#clines');
  const rows = [0, 1, 2].map(i => {
    const el = document.createElement('div'); el.className = 'ln'; el.dataset.state = 'empty';
    el.innerHTML = `<div class="tally"></div><div class="wr"><div class="field"><div class="mirror"></div><input type="text" maxlength="80" autocapitalize="off" autocomplete="off" spellcheck="false" enterkeyhint="${i < 2 ? 'next' : 'done'}" placeholder="${PH[i]}" aria-label="line ${i + 1}, ${[5, 7, 5][i]} syllables"></div><div class="crule"></div></div>`;
    linesEl.appendChild(el);
    return { el, input: el.querySelector('input'), mirror: el.querySelector('.mirror'), tally: el.querySelector('.tally'), last: -1 };
  });
  const inputs = rows.map(r => r.input), nameIn = $('#cname'), allInputs = [...inputs, nameIn], texts = () => inputs.map(i => i.value);
  let allOk = false, busy = false, opened = false, denied = false, denyMsg = '', lastStates = ['empty', 'empty', 'empty'], lastInput = 0, idleN = 0;

  function render(a, ok) {
    const fs = fitSize(a.map(l => l.text), rows[0].input.clientWidth || 200);
    linesEl.style.setProperty('--fs', fs + 'px');
    a.forEach((l, i) => {
      const r = rows[i]; r.el.dataset.state = l.state;
      r.mirror.innerHTML = mirrorHTML(l); r.mirror.querySelectorAll('.w').forEach(w => w.style.setProperty('--n', w.dataset.c));
      r.tally.innerHTML = tally(l.target, l.n) + `<span class="cap"><b>${l.n}</b>of<b>${l.target}</b></span>`;
      if (l.n > r.last && r.last >= 0) { const rect = r.tally.querySelectorAll('rect')[l.n - 1]; rect?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'steps(3)' }); anim(r.tally.querySelectorAll('svg')[Math.floor((l.n - 1) / 5)], JELLY); }
      r.last = l.n;
    });
    const was = body.classList.contains('ready'), rd = ok && !denied;
    body.classList.toggle('ready', rd);
    if (rd !== was) paintWax(rd);
    $('#plbl').textContent = rd ? 'seal it!' : 'seal & post';
    if (rd && !was) { anim($('#cpost'), JELLY); anim($('#csign'), [{ transform: 'translateY(-10px) scale(.9,1.2)', opacity: 0 }, { transform: 'none', opacity: 1 }]); }
    const n = $('#cnote'), over = a.find(l => l.state === 'over'), guess = [...new Set(a.flatMap(l => l.guessed))];
    n.className = 'note' + (denied || over ? ' bad' : '');
    n.textContent = denied ? (denyMsg || `${a.map(l => l.n).join('-')} is not 5-7-5. fix the red lines.`) : over ? `line ${over.i + 1} has ${over.n - over.target} stroke${over.n - over.target > 1 ? 's' : ''} too many.`
      : guess.length ? `grey dots + ? = my guess for "${guess[0]}".` : '';
  }
  function update() { const a = analyze(texts()), ok = a.every(l => l.ok); allOk = ok; render(a, ok); coach(a.map(l => l.state), ok); return a; }
  function coach(states, ok) {
    if (busy || !opened) { lastStates = states; return; }
    const hit = states.findIndex((s, i) => s === 'ok' && lastStates[i] !== 'ok');
    const over = states.findIndex((s, i) => s === 'over' && lastStates[i] !== 'over');
    const nowOk = ok && !lastStates.every(s => s === 'ok');
    if (nowOk) {
      inky.setMood('cheer'); inky.spin = .7; inky.jump(1.25); inky.sparkle(18); say('five-seven-five!', 1300);
      clock.wait(1350).then(() => { if (allOk && !busy && opened) { inky.setMood('think'); inky.look = 1; say('sign it?', 3600); } });
    }
    else if (over >= 0) { inky.setMood('worry'); inky.wobble(.6); say(`line ${over + 1}: too many!<br>trim a word`, 2400); }
    else if (hit >= 0) { inky.setMood('cheer'); inky.jump(.95); inky.sparkle(10); say(`line ${hit + 1}: ${NAMES[hit]}! nice`, 1600); clock.wait(1000).then(() => !busy && inky.mood === 'cheer' && !allOk && inky.setMood('happy')); }
    else if (states.includes('over')) { if (inky.mood !== 'worry') inky.setMood('worry'); }
    else if (inky.mood === 'worry' || inky.mood === 'bored') inky.setMood('happy');
    lastStates = states;
  }
  inputs.forEach((inp, i) => {
    inp.addEventListener('input', () => { if (denied) clearDenied(); poke(); update(); });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); if (i < 2) focusLine(i + 1); else if (allOk) nameIn.focus({ preventScroll: true }); else submit(); }
      if (e.key === 'Backspace' && !inp.value && i > 0) { e.preventDefault(); focusLine(i - 1); }
    });
    inp.addEventListener('paste', e => {                  // pasting a whole haiku fills all three lines
      const t = e.clipboardData?.getData('text') || ''; const parts = t.includes('\n') ? t.split(/\r?\n/).filter(s => s.trim()) : t.includes(' / ') ? t.split(' / ') : null;
      if (!parts || parts.length < 2) return;
      e.preventDefault(); parts.slice(0, 3 - i).forEach((p, k) => inputs[i + k].value = p.trim()); if (denied) clearDenied(); poke(); update();
    });
  });
  nameIn.addEventListener('input', () => { const c = cleanName(nameIn.value); if (c !== nameIn.value) nameIn.value = c; fitName(); poke(); });
  function fitName() {                          // mirror the typed name in label ink; shrink (never below 12px) only if it must
    const nm = nameIn.parentNode, mm = nm.querySelector('.nmm'), v = nameIn.value;
    mm.textContent = v; nm.classList.toggle('has', !!v); nm.style.removeProperty('--nfs');
    if (!v) return;
    const room = nm.clientWidth - 2; let fs = 20;
    while (fs > 12 && mm.scrollWidth > room) { fs -= 1; nm.style.setProperty('--nfs', fs + 'px'); }
  }
  addEventListener('resize', () => requestAnimationFrame(fitName));
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  allInputs.forEach((inp, i) => {
    inp.addEventListener('focus', () => { rows.forEach((r, k) => r.el.classList.toggle('focus', k === i)); poke(); });
    inp.addEventListener('blur', () => setTimeout(() => { if (!allInputs.includes(document.activeElement)) rows.forEach(r => r.el.classList.remove('focus')); }, 0));
  });
  function focusLine(i) { inputs[i].focus({ preventScroll: true }); }
  function poke() { lastInput = clock.now(); if (inky.mood === 'bored') { inky.setMood('happy'); inky.wobble(.5); bubble.hidden = true; } }

  // Inky parks LOWER-LEFT (room to travel right to the stamp and the seal); above the keyboard when it is up
  const dock = () => { const l = Math.max(0, innerWidth / 2 - 230); return kbUp ? { x: l + 50, foot: vvt + vvh - 10 } : { x: l + 62, foot: vvt + vvh - 36 }; };

  // ---------- bubble: drawn pixel by pixel, always points back at Inky ----------
  let bubbleUntil = 0;
  function say(text, ms = 1800, big = false) {
    bubble.innerHTML = `<span class="bt">${text}</span>`; bubble.prepend(bcv); bubble.hidden = false; bubble.classList.toggle('big', big);
    bubble.style.width = bubble.style.height = '';
    const t = bubble.querySelector('.bt').getBoundingClientRect();
    bubble._bw = Math.ceil(t.width / BU); bubble._bh = Math.ceil(t.height / BU); bubble._key = '';
    bubble.style.width = bubble._bw * BU + 'px'; bubble.style.height = bubble._bh * BU + 'px';
    bubbleUntil = clock.now() + ms; placeBubble();
    bubble.animate([{ transform: `translateY(${2 * BU}px)`, opacity: 0 }, { transform: `translateY(${-BU}px)`, opacity: 1, offset: .5 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 200, easing: 'steps(3, end)' });
  }
  clock.onTick(() => {
    if (opened && !busy && !denied && body.classList.contains('composing') && !allOk && clock.now() - lastInput > IDLE_MS * (idleN ? 1.6 : 1)) {
      inky.setMood('bored'); inky.tapping = true; say(NO_RUSH[idleN % NO_RUSH.length], 3200); idleN++; lastInput = clock.now();
    }
    if (bubble.hidden) return;
    if (clock.now() > bubbleUntil || !inky.visible) { bubble.hidden = true; return; }
    placeBubble();
  });
  function placeBubble() {
    const m = inky.mouth, bw = bubble._bw, bh = bubble._bh, W = bw * BU, H = bh * BU, TIPGAP = 20, TAIL = 4 * BU, GAP = TIPGAP + TAIL;
    const sp = inky.bodySpan() || { l: m.cx - m.r, r: m.cx + m.r }, er = Math.max(sp.r, m.cx + m.r), el = Math.min(sp.l, m.cx - m.r);
    let right = m.cx < innerWidth / 2;
    let left = right ? er + GAP : el - GAP - W;
    if (right && left + W > innerWidth - 4) { right = false; left = el - GAP - W; }
    if (!right && left < 4) { right = true; left = er + GAP; }
    const scrollBot = $('#cscroll').hidden ? -1 : $('#scv').getBoundingClientRect().top + (2 + RH * 2) * SP + art.openCss;
    const minTop = m.cy > scrollBot && scrollBot > 0 ? scrollBot + 6 : vvt + 6;
    let top = Math.max(minTop, Math.min(vvt + vvh - H - 6, m.y - H / 2 - BU * 2));
    left = right ? Math.ceil(left / BU) * BU : Math.floor(left / BU) * BU; top = Math.round(top / BU) * BU;
    bubble.style.left = left + 'px'; bubble.style.top = top + 'px';
    const bx = right ? left : left + W, by = Math.max(top + 3 * BU, Math.min(top + H - 3 * BU, m.y));
    let dx = bx - m.x, dy = by - m.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const ox = m.x - m.cx, oy = m.y - m.cy, b = ox * dx + oy * dy, c = ox * ox + oy * oy - m.r * m.r, tExit = Math.max(inky.rayExit(m.x, m.y, dx, dy), -b + Math.sqrt(Math.max(0, b * b - c)) * .8);
    const len = Math.max(2 * BU, Math.min(TAIL, L - tExit - TIPGAP)), tipX = bx - dx * len, tipY = by - dy * len;
    const tip = { x: Math.floor((tipX - left) / BU), y: Math.floor((tipY - top) / BU) };
    const key = [bw, bh, tip.x, tip.y, bubble.classList.contains('big')].join();
    if (key !== bubble._key) {
      bubble._key = key;
      const r = renderBubble(bcv, { bw, bh, tip, round: true, red: bubble.classList.contains('big') });
      Object.assign(bcv.style, { left: r.ox * BU + 'px', top: r.oy * BU + 'px', width: r.W * BU + 'px', height: r.H * BU + 'px' });
    }
  }

  const shake = (k = 1) => { for (const el of [$('#cstage'), inky.cv]) anim(el, [0, -10, 9, -7, 5, -3, 0].map((v, i) => ({ transform: `translate(${v * k}px, ${(i % 2 ? 4 : -3) * k}px)` })), { stiffness: 320, damping: 13 }); };
  function clearDenied() { denied = false; denyMsg = ''; body.classList.remove('is-denied'); update(); }
  function blurAll() { document.activeElement?.blur?.(); }
  const fabAnim = (k, o) => { try { return deps.fab?.animate(k, o); } catch { return null; } };

  // ---------- OPEN: board Inky dives in -> black flood -> scroll unrolls -> red Inky swings in from the right ----------
  let homeInky = null;
  async function open() {
    if (opened || body.classList.contains('composing')) return;
    body.classList.add('composing'); html.classList.add('composing'); busy = true; denied = false; denyMsg = ''; body.classList.remove('is-denied');
    if (theme) theme.content = '#1a181c';
    syncViewport();
    inputs.forEach(i => i.value = ''); nameIn.value = ''; fitName(); $('#waxch').textContent = '印'; $('#cpost').classList.remove('stamped');
    lastStates = ['empty', 'empty', 'empty']; idleN = 0; update(); fitPaper();
    const fab = deps.fab?.getBoundingClientRect() ?? { left: innerWidth / 2, width: 0, top: innerHeight - 60 }, fx = fab.left + fab.width / 2;
    const bi = deps.inky; homeInky = { x: bi.pos.x, foot: bi.pos.foot }; bi.setMood('cheer'); bi.mode = 'still';
    deps.hideBoardBubble?.();
    await bi.hopTo(fx, fab.top + 8, .26, 12);
    bi.visible = false;
    const fl = field.flood(fx, { speed: 1.8 });
    fabAnim([{ transform: 'translateX(-50%) scale(1)' }, { transform: 'translateX(-50%) scale(1.25,.7)', offset: .3 }, { transform: 'translateX(-50%) translateY(140px) scale(.8,1.2)' }], { duration: 360, easing: 'ease-in', fill: 'forwards' });
    await fl;
    await unroll();
    busy = false; opened = true; body.classList.add('opened'); lastInput = clock.now(); syncViewport(); update();
    focusLine(0);
  }
  async function unroll() {
    const sc = $('#cscroll'); sc.hidden = false; art.jump(0);
    anim(sc, [{ transform: 'translateX(-50%) translateY(-140px) scale(.92,1.1)' }, { transform: 'translateX(-50%) translateY(0) scale(1)' }], { stiffness: 340, damping: 17 });
    await clock.wait(240);
    busyScroll = true;
    const done = art.setTarget(rowsNow(), { k: 95, c: 11 });
    await clock.wait(380);
    const d = dock(); inky.visible = true; inky.setMood('cheer'); inky.look = -1;
    await inky.whip([[innerWidth + 90, innerHeight * .56], [innerWidth * .62, innerHeight * .74], [innerWidth * .36, innerHeight * .9], [innerWidth * .48, innerHeight * .8], [innerWidth * .26, innerHeight * .76], [d.x, d.foot]], .95, { splash: 10 });
    await done; busyScroll = false;
    inky.mode = 'coach'; inky.dock = dock; inky.setMood('happy'); inky.look = 1;
    say('hi! I\'m counting.<br>give me 5-7-5', 2400);
  }
  async function rollUp() {
    body.classList.remove('opened');
    const sc = $('#cscroll'); busyScroll = true;
    await art.setTarget(0, { mode: 'roll' });
    const b = sc.animate([{ transform: 'translateX(-50%)' }, { transform: 'translateX(-50%) translateY(10px) scale(1.06,.85)', offset: .3 }, { transform: 'translateX(-50%) translateY(-260px) scale(.9,1.15)' }], { duration: 420, easing: 'cubic-bezier(.5,0,.8,.5)', fill: 'forwards' });
    await clock.wait(420); sc.hidden = true; b.cancel(); busyScroll = false;
  }
  async function drainHome() {
    const bi = deps.inky; bi.mode = 'still'; bi.R = 7; bi.visible = false;
    const hx = homeInky?.x ?? innerWidth * .2, hf = homeInky?.foot ?? innerHeight - 78;
    bi.placeAt(hx, hf); bi.floor = bi.fy; bi.grounded = true; bi.setMood('happy');
    const bp = bi.pos, dur = 1.3;
    const s = field.suck(bp.x, bp.y, { dur, endR: 6 });
    body.classList.remove('composing', 'ready', 'is-denied', 'opened', 'kb'); html.classList.remove('composing');
    if (theme) theme.content = theme0;
    clock.wait(dur * 930).then(() => { bi.visible = true; bi.s = .5; bi.sv = 0; bi.wobble(1.4); });
    await s;
  }
  function restoreBoard() {
    const bi = deps.inky, je = springEasing(SPRINGS.drop);
    fabAnim([{ transform: 'translateX(-50%) translateY(140px) scale(.8,1.2)' }, { transform: 'translateX(-50%) translateY(0) scale(1)' }], { duration: je.duration, easing: je.easing, fill: 'forwards' });
    deps.fabArt?.unroll?.();
    clock.wait(1200).then(() => { bi.setMood('happy'); bi.mode = 'roam'; bi.floor = bi.pageFloor(); });
    opened = false; busy = false; field.off(); inky.visible = false; inky.mode = 'idle';
  }

  // ---------- BACK: Inky stamps the red arrow, roll up, Inky leaves sad, the black drains back ----------
  async function cancel() {
    if (!opened || busy) return;
    busy = true; bubble.hidden = true; inky.tapping = false; denied = false; denyMsg = '';
    const br = $('#cback .blot').getBoundingClientRect(), tx = br.left + br.width / 2, ty = br.top + br.height / 2;
    inky.hanko = false; inky.mode = 'stamp'; inky.dock = null; inky.setMood('worry');
    await inky.hopTo(tx, ty - 60, .4, 40); inky.s = -.35; await clock.wait(90);
    inky.floor = (ty + 8) / 4; inky.grounded = false; inky.vy = 330; inky.vx = 0;
    await new Promise(res => inky.onLand = () => { inky.onLand = null; res(); });
    anim($('#cback .blot'), [{ transform: 'scale(1.35,.62)' }, { transform: 'scale(1)' }], { stiffness: 520, damping: 14 }); shake(.45);
    inky.splat(7, 1.1); inky.setMood('sad');
    await clock.wait(160);
    const d0 = dock(); inky.hopTo(d0.x, d0.foot, .42, 22);
    await clock.wait(120);
    blurAll(); await rollUp();
    inky.mode = 'idle'; inky.setMood('sad'); say('…oh. okay.', 1000);
    await clock.wait(600);
    await inky.sadRunOff(-1, { pace: .7 });
    bubble.hidden = true;
    await drainHome();
    deps.inky.setMood('sad'); clock.wait(700).then(() => deps.inky.setMood('happy'));
    restoreBoard();
    window.dispatchEvent(new CustomEvent('haiku:composeclosed', { detail: { posted: false } }));
  }
  $('#cback').addEventListener('click', cancel);
  addEventListener('keydown', e => { if (e.key === 'Escape' && opened) cancel(); });

  // ---------- SUBMIT ----------
  async function submit() {
    if (busy || !opened) return;
    blurAll();
    const text = texts().map(t => t.trim()).join('\n');
    const check = checkHaiku(text);
    if (!check.ok) return deny();
    const name = cleanName(nameIn.value).trim();
    busy = true;
    let post;
    try { post = await deps.store.create(text, { author: name }); }       // the store re-checks; a duplicate is refused here
    catch (err) { busy = false; return deny(err.reason || 'could not post. try again?'); }
    inky.tapping = false;
    inky.setMood('cheer'); inky.jump(1.2); inky.sparkle(16); say(name ? `signed, ${esc(name)}!` : 'sealing it!', 1200);
    await clock.wait(550);
    // Inky travels right across the scroll and presses the wax seal
    const pr = $('#cpost .wax').getBoundingClientRect(), tx = pr.left + pr.width / 2, ty = pr.top + pr.height / 2;
    inky.hanko = false; inky.mode = 'stamp'; inky.dock = null;
    await inky.hopTo(tx, ty - 66, .46, 46); inky.s = -.35; await clock.wait(120);
    inky.floor = (ty + 10) / 4; inky.grounded = false; inky.vy = 330; inky.vx = 0;
    await new Promise(res => inky.onLand = () => { inky.onLand = null; res(); });
    $('#cpost').classList.add('stamped'); $('#waxch').textContent = '詠';
    anim($('#cpost .wax'), [{ transform: 'scale(1.3,.7)' }, { transform: 'scale(1)' }], { stiffness: 520, damping: 14 }); shake(.5);
    inky.splat(6, 1); inky.setMood('cheer');
    await clock.wait(140);
    const d = dock(); inky.hopTo(d.x, d.foot, .5, 34).then(() => { inky.mode = 'coach'; inky.dock = dock; });
    say('sealed!', 900);
    await clock.wait(700);
    await rollUp();
    say('off it goes!', 800); await clock.wait(450);
    await inky.runOff(1);
    inky.mode = 'idle'; bubble.hidden = true;
    await installPost(post);
  }
  let denyN = 0;
  async function deny(reason = '') {
    busy = true; denied = true; denyMsg = reason; bubble.hidden = true; inky.tapping = false; body.classList.add('is-denied');
    const a = update();
    const bad = Math.max(0, a.findIndex(l => !l.ok)), lr = rows[bad].el.getBoundingClientRect();
    const tx = innerWidth / 2 + 10, ty = Math.max(vvt + 200, Math.min(lr.top + 40, vvt + 380));
    inky.hanko = true; inky.setMood('angry'); inky.wobble(.6);
    await clock.wait(180);
    inky.mode = 'stamp'; inky.dock = null;
    await inky.hopTo(tx, ty - 90, .42, 44);
    inky.s = -.4; await clock.wait(130);
    inky.floor = ty / 4; inky.grounded = false; inky.vy = 360; inky.vx = 0;
    await new Promise(res => inky.onLand = () => { inky.onLand = null; res(); });
    // SLAM: big and tilted, with a shake; worn hanko ink pressed INTO the paper (multiply), then a stepped fade
    const stp = DENY_STAMPS[denyN++ % 2], dimg = deny_.querySelector('img'); dimg.src = stp.src; dimg.alt = stp.alt;
    deny_.hidden = false; Object.assign(deny_.style, { left: tx + 'px', top: ty - 110 + 'px', opacity: 1 });
    const rot = (denyN % 2 ? -1 : 1) * (4 + Math.random() * 8);                 // a fresh 4-12 degree tilt, leaning the other way each try
    anim(deny_, [{ transform: `rotate(${rot - 10}deg) scale(2.6)`, opacity: 0 }, { transform: `rotate(${rot}deg) scale(.86,1.12)`, opacity: 1, offset: .3 }, { transform: `rotate(${rot}deg) scale(1.06,.95)`, offset: .6 }, { transform: `rotate(${rot}deg) scale(1)`, opacity: 1 }], { stiffness: 460, damping: 17 }, { fill: 'forwards' });
    shake(1.4);
    inky.splat(8, 1.3); inky.splat(5, 1, [26, 24, 28]);
    inky.hanko = false; inky.setMood('angry');
    await clock.wait(120);
    const d = dock(); inky.hopTo(d.x, d.foot, .55, 40).then(async () => {        // back in his corner: two little stomps
      for (const k of [.42, .32]) { await clock.wait(60); if (inky.mood !== 'angry') return; inky.jump(k); await new Promise(r => { const t0 = clock.now(); const w = () => inky.grounded || clock.now() - t0 > 600 ? r() : clock.wait(16).then(w); w(); }); inky.splat(2, .4); shake(.25); }
    });
    await clock.wait(700);
    const f = deny_.animate([{ opacity: 1, transform: `rotate(${rot}deg) scale(1)` }, { opacity: 0, transform: `rotate(${rot}deg) scale(1.08)` }], { duration: 520, easing: 'steps(6)', fill: 'forwards' });
    await clock.wait(540); f.cancel(); deny_.hidden = true;
    inky.mode = 'coach'; inky.dock = dock; busy = false; lastInput = clock.now();
    say(reason ? 'hmm. change a word?' : 'try again!', 1800);
    clock.wait(1800).then(() => { if (inky.mood === 'angry' && !busy) inky.setMood('worry'); });
  }

  // ---------- the poem lands on the board: the black drains into Inky, the poem types in, its seal stamps on ----------
  async function installPost(post) {
    scrollTo(0, 0);                                         // newest is on top: be there before the black lifts
    homeInky = { x: innerWidth * .2, foot: innerHeight - 78 };
    const drained = drainHome();
    await clock.wait(700);
    let added = null;
    try { added = deps.view.add(post, { animate: true }); } catch (e) { console.warn('compose: could not add the poem', e); }
    if (added?.node) {
      added.node.setAttribute('aria-label', `haiku ${added.poem?.n ?? ''}: ${post.text.replace(/\n/g, ' / ')}${post.author ? ', by ' + post.author : ''}`);
      deps.view.scrollToPoem(added.node, 'auto');
    }
    await drained;
    restoreBoard();
    window.dispatchEvent(new CustomEvent('haiku:composeclosed', { detail: { posted: true, post } }));
    await Promise.race([added?.played ?? Promise.resolve(), clock.wait(14000)]);
    deps.inky.setMood('cheer'); deps.inky.jump?.(1); clock.wait(800).then(() => deps.inky.setMood('happy'));
    return added?.node;
  }

  $('#cpost').addEventListener('click', e => { e.preventDefault(); submit(); });
  $('#cpost').addEventListener('pointerdown', e => e.preventDefault());
  update();
  return {
    open, cancel, submit, update, inputs, nameIn, inky, field, art, root,
    get opened() { return opened; }, get busy() { return busy; }, get denied() { return denied; }, get kbUp() { return kbUp; },
    fill(lines, name) { if (denied) clearDenied(); lines.forEach((l, i) => inputs[i].value = l); if (name != null) { nameIn.value = cleanName(name); fitName(); } update(); },
  };
}
