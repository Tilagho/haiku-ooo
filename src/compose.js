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
import { TapMeter } from './inky-mind.js';   // round 15.1: red Inky gets fed up and splats, like board Inky
import { renderBubble, U as BU } from './pixel-bubble.js';
import { InkField } from './ink-field.js';
import { ScrollArt, SP, RH } from './scroll-art.js';
import { sfx } from './sfx.js';                        // round 15.0 sound events (src/sound-wire.js plays them)

const NAMES = ['five', 'seven', 'five'];
const PH = ['five syllables', 'then seven', 'and five to end'];
const NO_RUSH = ['no rush~', 'take your time.', 'no rush. the pond<br>can wait.', '…still here!<br>no rush', 'counting clouds.<br>no rush'];
const ROWS_OPEN = 72;
// round 14.5: red Inky's speech. Root cause of "cycles way too fast" on the phone: round 14.4's auto-flow added a 350 ms `const IDLE_MS`
// inside mountCompose that SHADOWED this module's 9000 ms one, so the idle "no rush" comment fired 0.35-0.56 s after every pause and
// was replaced again before it could be read. Now: idle comments are 12-20 s apart (IDLE_FIRST then IDLE_GAP, vs. 9 s / 14 s before and
// 0.35 s by the shadowing bug), every bubble HOLDS long enough to read (bubbleHold), and nothing replaces a bubble before its hold is over (chat()).
export const IDLE_FIRST = 12000, IDLE_GAP = [12000, 20000], HOLD_MIN = 2800, HOLD_PER_CHAR = 65, HOLD_EXTRA = 1000, TAP_MIN_UP = 1500, FADE_IN = 240, FADE_OUT = 360;
export const bubbleHold = text => Math.max(HOLD_MIN, HOLD_EXTRA + String(text).replace(/<br>/g, ' ').replace(/<[^>]*>/g, '').length * HOLD_PER_CHAR);   // fully visible ms: reading time + ~1 s
// ROUND 14.1 - ONE STABLE LAYOUT on touch devices (phones: an on-screen keyboard): the compact layout is sized for the
// keyboard-UP case once per session (the real keyboard height if it is up, else an estimate, KB_EST) and kept identical
// when the keyboard goes down (just more dark space below): no reflow, no font jump. Red Inky stands in his own band
// fully UNDER the lower roller (INKY_GAP below it), never over a stamp, the roller or the paper. When the visible height
// is short, the top roller tucks up under the screen edge (st down to ST_MIN) before the type steps down a size.
const ST_KB = 30, ST_MIN = -62, ST_TUCK = -66, INKY_GAP = 2;
// ROUND 14.11 - the compact write page sits BELOW the status bar: the stage used to be laid out from the very top of the visual viewport, so the
// top roller (st 30 -> tucked up to -66 css) ended up under iOS's status bar (fixed layers are clipped to the content area: the roller and the
// paper's first lines were cut off), while the plan - sized once for an ESTIMATED keyboard height and only ever re-planned when too TALL - left Inky
// 20-60 px above the real bottom. Now: the free height is [status bar + margin, visible bottom - a few px], tried in this order before the top may
// hide anything: (1) tight gaps (stamp row 60, little slack, Inky's band 2 px), (2) Inky stands in front of the lower roller (he may, like on the
// desktop layout, never over the paper) by up to ROLLER_OVER css px, (3) the type steps down one fine step at a time, never below TEXT_FLOOR (tier
// index), (4) only then the top roller tucks up again.
const STATUS_MIN = 20, TOP_M = 20, TOP_OK = 14, BOT_GAP = 6, ROLLER_OVER = 44, TEXT_FLOOR = 2, STAMP_ROW = 60, LINES_SLACK = 12, ST_CAP = 40;   // round 14.4: the top roller tucks 8 css px further (the 2 px crimson outline on Inky costs 8 px of height)
// the visible height with the keyboard up, before it is up: the screen height minus a keyboard + its ^ v ✓ bar + the
// status bar (iPhone 390x844: ~454 css px, the 375x667 SE: ~357, 430x932: ~503)
// round 14.11: the estimate is now ~51% of the screen height (iPhone 390x844: ~430, the measured 415-440 range; 14.10 guessed 454, which was too
// tall, so the first real keyboard re-planned and the page jumped), and the last REAL keyboard-up height of this screen is remembered (kbSeen) so the next sessions plan with it
const KB_KEY = () => 'hb-kbvis:' + innerWidth + 'x' + ((typeof screen !== 'undefined' && screen.height) || innerHeight);
const kbSeen = v => { try { v == null ? localStorage.getItem(KB_KEY()) : localStorage.setItem(KB_KEY(), String(Math.round(v))); } catch {} return v == null ? (+localStorage?.getItem?.(KB_KEY()) || 0) : v; };
const KB_VIS = () => { const sh = (typeof screen !== 'undefined' && screen.height) || innerHeight; return kbSeen() || Math.round(sh * .51); };
// keyboard timing: 'late' (default) = no keyboard during the animation, 'tap to write' after it; 'early' = round 14 (primer at the tap)
const KB_MODE = typeof location !== 'undefined' && new URLSearchParams(location.search).get('kb') === 'early' ? 'early' : 'late';
const DBG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('kbdbg'); let dbgEl = null;   // ?kbdbg=1: a tiny readout of the visible height / planned type size
const FOCUS_DELAY = 420;                                  // ms after the unroll has fully played before the caret lands on line 1
const DENY_STAMPS = [{ src: 'assets/compose/stamp-kyakka.png', alt: '却下 (rejected)' }, { src: 'assets/compose/stamp-fuka.png', alt: '不可 (not allowed)' }];
// at most 3 lines: anything past the 3rd joins the 3rd (a pasted 4-line poem does not vanish)
export const clampLines = (v, max = 3) => { const p = v.replace(/\r\n?/g, '\n').split('\n'); return p.length <= max ? p.join('\n') : [...p.slice(0, max - 1), p.slice(max - 1).join(' ').replace(/[ \t]+/g, ' ')].join('\n'); };
// Only for the REALLY stuck: from the 3rd rejection in a row (and then at most every 3rd), name the fix in a few words.
export const HINT_FROM = 3, HINT_EVERY = 3;
export function stuckHint(rejects, lastHintAt, lines) {
  if (rejects < HINT_FROM || (lastHintAt && rejects - lastHintAt < HINT_EVERY)) return null;
  const bad = lines.filter(l => !l.ok); if (!bad.length) return null;
  return bad[0].n > bad[0].target ? 'looks like too many<br>syllables' : 'missing a few<br>syllables';   // the first wrong line decides
}
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
      return { text: t, n: r.possible[0], k: r.possible[0], possible: r.possible, alt: alt ? r.possible.join('|') : null, guess, words: r.words };
    });
    numberSyllables(tokens.filter(t => !t.space), n);
    return { i, text, target, n, state, ok: state === 'ok', tokens, guessed: res.guessed };
  });
}
// choose each word's reading so the words add up to the line's count (a 'fire' read as 2 when the line needs it), then
// number the syllables 1, 2, 3 … across the line: those are the numerals drawn under the words
export function numberSyllables(words, total) {
  let sum = words.reduce((s, w) => s + w.k, 0);
  for (let pass = 0; pass < 4 && sum !== total; pass++) for (const w of words) {
    if (sum === total) break;
    const want = w.k + (total - sum), best = w.possible.reduce((b, c) => Math.abs(c - want) < Math.abs(b - want) ? c : b, w.k);
    sum += best - w.k; w.k = best;
  }
  let at = 1; for (const w of words) { w.from = at; at += w.k; }
  return words;
}
const numsHTML = (t, target) => Array.from({ length: t.k }, (_, j) => { const v = t.from + j; return `<b${v > target ? ' class="x"' : ''}>${v}</b>`; }).join('');
const mirrorHTML = a => a.tokens.map(t => t.space ? t.text : `<span class="w${t.guess ? ' guess' : ''}">${esc(t.text)}<span class="nums" aria-hidden="true">${numsHTML(t, a.target)}</span></span>`).join('');
let mctx = null;
// type sizes that land on whole device pixels of the 16px pixel font: 2x/1.5x/1x at DPR 2, 6/5/4/3 device px per font px at DPR 3
const DPR3 = typeof devicePixelRatio === 'number' && devicePixelRatio >= 2.5;
// every row starts at the biggest size (48px = 3x the pixel font) and shrinks on its own, only as far as its own text needs.
// (40px at DPR 3 is 7.5 device px per font px, so its blocks differ by 1 device px; worth it so a typical line gets > 37.33px)
const FS_OPEN = DPR3 ? [48, 128 / 3, 40, 112 / 3, 32, 80 / 3, 64 / 3, 16] : [48, 40, 32, 24, 20, 16];
// round 14.1, keyboard-up / touch type: about DOUBLE round 14's (32-40px), each row shrinking only if it would hit the edge
// round 14.4: +15-20% over 14.2's top size (37.33): 42.67 at DPR 3 (8 device px per font px; 48 at DPR 2), then the old sizes
// as the fallback tiers when the visible height is short
// round 14.4 (keyboard-up size): the keyboard-up layout used to drop a WHOLE tier (42.7 -> 32 -> 21.3) the moment the visible height was a
// few px short, so the type looked big until the keyboard came up. Now the top tier holds as long as compaction can find the room (the top
// roller tucks, ST_MIN), and below that the size steps down GRADUALLY: one fine step at a time (about 2.7px per step), only as far as the
// visible height needs. A row still shrinks on its own only if its text is too wide.
const FS_STEPS = DPR3 ? [128 / 3, 40, 112 / 3, 104 / 3, 32, 88 / 3, 80 / 3, 72 / 3, 64 / 3, 16] : [48, 44, 40, 36, 32, 28, 24, 20, 16];
export const FS_TIERS = FS_STEPS.slice(0, -1).map((_, i) => FS_STEPS.slice(i));
// round 14.1: with the big touch type the pixel font is set one font px tighter per letter (KERN, CSS letter-spacing
// -fs/16 on the drawn words and the textarea alike), so a typical line keeps the big size; tw() = the drawn width
let KERN = 0;
const tw = (t, sz) => mctx.measureText(t).width - t.length * KERN * sz / 16;
const OVERHANG = 0;                                  // px a long line may run past its ruled guide (0: the torn edge nicks would eat it)
function fitSize(texts, avail, sizes = FS_OPEN) {     // the biggest size every line fits at (32 = 2x the pixel font)
  mctx ||= document.createElement('canvas').getContext('2d');
  for (const s of sizes) { mctx.font = `${s}px ChiKareGo2`; if (texts.every(t => tw(t, s) <= avail)) return s; }
  return sizes[sizes.length - 1];
}

const MARKUP = `
<div id="cveil"></div>
<div id="cstage">
  <section class="cscroll" id="cscroll" hidden role="dialog" aria-modal="true" aria-label="write a haiku">
    <canvas id="scv"></canvas>
    <div class="pw" id="pw">
      <div class="paper" id="cpaper">
        <div id="clines"><textarea id="cpoem" rows="3" wrap="off" maxlength="240" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" inputmode="text" enterkeyhint="next" data-1p-ignore data-lpignore="true" data-form-type="other" aria-multiline="true" aria-label="your haiku: three lines of 5, 7 and 5 syllables. return goes to the next line"></textarea></div>
        <p class="sr" id="cnote" aria-live="polite"></p>
        <div class="sign" id="csign"><span class="nm"><span class="nmm" aria-hidden="true"></span><span class="nph" aria-hidden="true">Sign? (optional)</span><i class="rl" aria-hidden="true"></i><input id="cname" type="text" maxlength="12" disabled tabindex="-1" name="given-name" autocomplete="given-name" autocorrect="off" autocapitalize="words" spellcheck="false" inputmode="text" enterkeyhint="done" data-1p-ignore data-lpignore="true" data-form-type="other" placeholder="Sign? (optional)" aria-label="sign with your first name, up to 12 characters, optional"><button class="nmb" id="cnamebtn" type="button" aria-label="sign with your name (optional)"></button></span></div>
        <button class="back" id="cback" type="button" aria-label="back to the board, discard this haiku"><span class="blot"><canvas id="arw"></canvas></span></button>
        <button class="cpost" id="cpost" type="button" aria-label="seal and post"><span class="wax"><canvas id="wax"></canvas></span></button>
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
  const inky = new RedInky({ R: 5.6, z: 60, bigEyes: false, fury: true, chunky: true, worried: true });   // round 14.1: 80% of round 14 (R 7), chunkier, more worried
  inky.onSfx = (name, p) => sfx(name, p);   // round 15.10f: hop/whip watery swooshes
  const INKY_H = () => Math.ceil(inky.R * 2.6 * 4) + 2 + 8;          // css px from his foot to the top of his head (+ the 2 px (8 css) crimson outline, round 14.4)
  const art = new ScrollArt($('#scv'), { maxRows: 92, seed: 8370, outline: 2 });   // 8370: the torn edges stay shallow beside the three writing rows (more room for big type)
  const bubble = document.createElement('div'); bubble.className = 'cbubble'; bubble.hidden = true; root.appendChild(bubble);
  const bcv = document.createElement('canvas'); bcv.className = 'bcv';
  const deny_ = $('#cdeny');
  // preload both stamps so the first slam never shows a blank
  DENY_STAMPS.forEach(s => { const i = new Image(); i.src = s.src; });
  // the two corner stamps are twins: a round red wax seal with a cream glyph and a dark-red emboss shadow. They live ON the
  // scroll's own pixel grid: one stamp pixel = one parchment pixel (SP = 6 css px), placed on whole grid cells,
  // 11 x 11 cells open (66 px) and 9 x 9 with the keyboard up (54 px); the icons are drawn blocky at exactly that size
  const GLYPH = {
    11: { back: ['..#....', '.##....', '#######', '.##...#', '..#...#', '......#', '..####.'],
          check: ['......#', '.....##', '#...##.', '##.##..', '.###...', '..#....'] },
    9: { back: ['.#...', '#####', '.#..#', '....#', '..##.'], check: ['....#', '...##', '#.##.', '.##..'] },
  };
  const WAX = { o: [96, 20, 14], d: [146, 32, 22], b: [214, 58, 40], l: [240, 116, 94] }, SHADOW = [96, 20, 14], CREAM = [255, 244, 224];
  const KB_SEAL = 9, OPEN_SEAL = 11;
  function drawSeal(cv, kind, n = body.classList.contains('kb') ? KB_SEAL : OPEN_SEAL) {
    cv.width = cv.height = n; const ctx = cv.getContext('2d'), img = ctx.createImageData(n, n), D = img.data, c0 = (n - 1) / 2;
    const g = GLYPH[n][kind], gw = g[0].length, gh = g.length, ox = Math.floor((n - gw) / 2), oy = Math.floor((n - gh) / 2);
    const on = (x, y) => g[y - oy]?.[x - ox] === '#';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = x - c0, dy = y - c0, r = Math.hypot(dx, dy), lim = c0 + .45 - ((x * 7 + y * 3) % 11 === 0 ? .6 : 0);   // a round blob, 1-2 worn nicks
      if (r > lim) continue;
      let c = r > lim - 1 ? WAX.o : dx + dy < -c0 * .9 && r > lim - 2 ? WAX.l : dx + dy > c0 * .9 && r > lim - 2 ? WAX.d : WAX.b;
      if (on(x, y)) c = CREAM; else if (on(x - 1, y - 1) && r <= lim - 1) c = SHADOW;     // emboss shadow, one grid cell down-right
      const i = (y * n + x) * 4; D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; D[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0); cv.dataset.grid = n;
  }
  const drawSeals = () => { drawSeal($('#arw'), 'back'); drawSeal($('#wax'), 'check'); };
  drawSeal($('#arw'), 'back'); drawSeal($('#wax'), 'check');
  // the ruled writing guides (and the sign underline) are painted INTO the scroll canvas, on its own 6 px art grid:
  // a very soft tan just darker than the parchment's darker checker, 1 solid row + a worn, broken second row,
  // clipped to the torn edge mask (ending 2 px inside the edge line). ScrollArt.draw() is wrapped, so they survive redraws.
  const RULE = { idle: [[225, 208, 172], [228, 212, 178]], focus: [[221, 203, 165], [225, 208, 172]], ok: [[217, 198, 159], [222, 204, 167]] };   // just under the parchment's darker checker (233,218,186)
  let ruleSpecs = [];                                      // [{ row, x0, kind }] in paper rows / art columns
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const draw0 = art.draw.bind(art);
  art.draw = function () {
    draw0();
    if (!ruleSpecs.length || !art._put) return;
    const D = art.img.data, W = art.W, o = Math.round(art.open), py0 = 2 + RH;
    const put = (x, y, c) => { const i = (y * W + x) * 4; D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; D[i + 3] = 255; };
    for (const r of ruleSpecs) for (let k = 0; k < 2; k++) {
      const y = r.row + k; if (y < 1 || y >= o - 3) continue;
      const l = art.px0 + art.L[y] + 3, rt = art.px1 - art.Rt[y] - 3, pal = RULE[r.kind] || RULE.idle;
      for (let x = Math.max(l, r.x0); x <= Math.min(rt, r.x1 ?? rt); x++) {
        const n = hash(x, y + r.row * 7);
        if (k === 0 ? n < .06 : n > .38) continue;                         // a few breaks in the line, a ragged lower edge
        put(x, py0 + y, pal[n < .5 ? 0 : 1]);
      }
    }
    art.ctx.putImageData(art.img, 0, 0);
  };
  function placeRules() {                                  // map each DOM guide onto paper rows / art columns
    const cv = $('#scv'), cr = cv.getBoundingClientRect(); if (!cr.width) return;
    const k = cr.width / (art.W * SP), py0 = 2 + RH, specs = [];
    const grid = el => { const b = el.getBoundingClientRect(); return { row: Math.round((b.top - cr.top) / k / SP) - py0, x0: Math.ceil((b.left - cr.left) / k / SP), x1: Math.floor((b.right - cr.left) / k / SP) - 1 }; };
    rows.forEach(r => { const st = r.el.dataset.state;          // never red: a denial is the hanko + angry Inky, not red lines
      specs.push({ ...grid(r.el.querySelector('.crule')), kind: st === 'ok' ? 'ok' : r.el.classList.contains('focus') ? 'focus' : 'idle', x1: undefined }); });
    const sign = $('#csign'); if (getComputedStyle(sign).display !== 'none') { const g = grid(sign.querySelector('.nm .rl')); specs.push({ ...g, kind: nameNm.classList.contains('edit') ? 'focus' : 'idle' }); }
    const key = JSON.stringify(specs); if (key === placeRules.key) return; placeRules.key = key;
    ruleSpecs = specs; art.draw();
  }
  clock.onTick(() => { if (!$('#cscroll').hidden && !busyScroll) placeRules(); });
  $('#cback').addEventListener('pointerdown', e => e.preventDefault());
  $('#cscroll').style.width = art.cssWidth + 'px';
  addEventListener('resize', () => { $('#cscroll').style.width = art.cssWidth + 'px'; });
  clock.onTick(() => { $('#pw').style.height = Math.max(0, art.openCss - 6) + 'px'; });   // the DOM paper clip follows the canvas paper

  // ---------- the real keyboard: follow the visual viewport (its height AND its offset) ----------
  // While the scroll unrolls the layout is FROZEN (decided once when the unroll starts, from the viewport at that moment):
  // a keyboard that rises mid-animation (iOS raises it at the write tap, see prime()) is covered by the wash and only
  // re-lays the scroll after the unroll + FOCUS_DELAY, never mid-animation.
  const VV = window.visualViewport;
  const coarse = matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window, compact = coarse;   // touch: an on-screen keyboard
  let vvh = innerHeight, vvt = 0, kbUp = false, frozen = false, plan = null;
  function syncViewport() {
    vvt = Math.round(VV ? VV.offsetTop : 0); html.style.setProperty('--vvt', vvt + 'px');
    if (frozen) return;
    vvh = Math.round(VV ? VV.height : innerHeight); html.style.setProperty('--vvh', vvh + 'px');
    const wasKb = body.classList.contains('kb'), wasPlan = plan && plan.rows + ':' + plan.st + ':' + plan.sizes[0];
    const composing = body.classList.contains('composing');
    kbUp = composing && vvh < innerHeight * .8;                    // the real on-screen keyboard
    const kb = composing && (compact || kbUp); body.classList.toggle('kb', kb); KERN = kb ? 1 : 0;
    if (!kb) plan = null;
    else if (!plan) { plan = kbPlan(kbUp ? vvh : Math.min(vvh, KB_VIS())); plan.real = kbUp; }  // decided once: the keyboard-up layout, kept when it goes down
    else if (kbUp && (!plan.real || plan.h - vvh > 6)) { plan = kbPlan(vvh); plan.real = true; kbSeen(vvh); }   // round 14.11: the first REAL keyboard re-plans (the estimate was a guess, taller or shorter), later only a SHORTER visible height does (the layout stays put when a suggestion bar comes and goes)   // round 14.11: the real visible height differs from the estimate (taller OR shorter): re-plan once, to the real one
    $('#cscroll').style.setProperty('--st', (plan ? plan.st : 34) + 'px');
    if (DBG) { dbgEl ||= Object.assign(document.body.appendChild(document.createElement('div')), { id: 'kbdbg' }); Object.assign(dbgEl.style, { position: 'fixed', left: '2px', top: '2px', zIndex: 99999, font: '10px monospace', color: '#0f0', background: 'rgba(0,0,0,.7)', padding: '2px 4px', pointerEvents: 'none' });
      dbgEl.textContent = `vvh ${Math.round(vvh)} ih ${innerHeight} sh ${screen.height} kbUp ${kbUp} fs ${plan ? plan.sizes[0].toFixed(1) : '-'} st ${plan ? Math.round(plan.st) : '-'} body ${plan ? Math.round(plan.body) : '-'}`; }   // ?kbdbg=1: what the real phone reports
    if (wasKb !== kb) drawSeals();
    if (wasKb !== kb || (plan && plan.rows + ':' + plan.st + ':' + plan.sizes[0]) !== wasPlan) { fitPaper(); update(); }
  }
  if (VV) { VV.addEventListener('resize', syncViewport); VV.addEventListener('scroll', syncViewport); }
  addEventListener('resize', syncViewport);
  // keyboard-up layout: the biggest type tier whose three rows + the stamp row + the rollers + Inky's band under them fit
  // the height h (compact rows: 4 top, per row 4 + baseline + rule + numerals tucked close (34 + asc*fs), 2 between; then a
  // 68 px stamp row). The top roller may tuck up under the screen edge (st >= ST_MIN) before the type steps down a tier.
  const linesBottom = fs => LINES_SLACK + 3 * (34 + ASC * fs);         // (4 padding + 3 x 2 margins + the measured rows, + 2 px)
  const topSafe = () => Math.max(field?.topInset || 0, STATUS_MIN);       // the status bar / safe-area top, in stage px
  function kbPlan(h = vvh) {
    const T = topSafe(); let p = null;
    for (let ti = 0; ti < FS_TIERS.length; ti++) {
      const sizes = FS_TIERS[ti];
      const rows = Math.ceil((linesBottom(sizes[0]) + STAMP_ROW) / SP), body0 = (2 + RH * 2) * SP + rows * SP + INKY_H() + INKY_GAP + 2;
      const room = h - BOT_GAP - body0;                                                  // the top that puts Inky's feet BOT_GAP above the bottom
      const ovl = Math.max(0, Math.min(ROLLER_OVER, T + TOP_M - room));                   // he steps in front of the lower roller only as far as the comfortable top margin needs
      p = { rows, sizes, body: body0 - ovl, ovl, h, T, st: Math.min(T + ST_CAP, room + ovl) };
      if (p.st >= T + TOP_OK) return p;                                                   // the whole top roller is visible, with a margin
      if (ti >= TEXT_FLOOR) break;
    }
    p.st = Math.max(ST_TUCK, p.st); return p;                                             // last resort: the old tuck
  }
  const isKb = () => body.classList.contains('kb');
  const kbRows = () => (plan || kbPlan()).rows;
  const rowsNow = () => isKb() ? kbRows() : ROWS_OPEN;
  let busyScroll = false;
  function fitPaper() {
    $('#cpaper').style.setProperty('--ph', rowsNow() * SP + 'px');
    if ((opened || unrolling) && !busyScroll) art.setTarget(rowsNow(), { k: 260, c: 24 });   // the keyboard rolls the scroll up a little
  }
  // where the scroll's lower roller ends (css px, viewport coords) for the CURRENT layout target
  const scrollBottom = () => vvt + $('#cscroll').offsetTop + (2 + RH * 2) * SP + rowsNow() * SP;   // layout box (not the unroll's transform)
  const paperBottom = () => scrollBottom() - RH * SP;

  // ---------- FULL BLACKOUT + LOCKED BOARD while composing ----------
  // body position: fixed at -scrollY (iOS cannot scroll or rubber-band the board under the wash, the keyboard cannot push
  // it up), a solid wash far bigger than the screen (above / below the visual viewport, behind Safari's translucent bars,
  // the overscroll bounce and the safe areas) and the same dark on html/body. Closing restores the exact scroll position.
  let lockY = null;
  function lockScroll() {
    if (lockY != null) return;
    lockY = scrollY; html.classList.add('scroll-lock');
    Object.assign(body.style, { position: 'fixed', top: -lockY + 'px', left: '0', right: '0', width: '100%' });
  }
  function unlockScroll(to = lockY) {
    if (lockY == null) return;
    lockY = null; Object.assign(body.style, { position: '', top: '', left: '', right: '', width: '' });
    scrollTo({ top: to ?? 0, left: 0, behavior: 'instant' });
    setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => html.classList.remove('scroll-lock'))), 60);   // the restore's scroll event is not a swipe (no gust, no Inky hop)
  }
  // ---------- round 14.10: the page background behind iOS's bars follows the ink FRONT ----------
  // iOS 26 Safari paints its status-bar / floating-toolbar areas from the PAGE (html / body background), which no canvas can reach (fixed layers are clipped
  // to the content area). 14.8 left them cream under the black; 14.9 made them ink at the TAP, so a flat black bar sat at the bottom before the flood even began.
  // Now each edge goes ink only once the black has really covered it (>= 55% of that edge row; back to cream below 45%), straight from InkField.edgeCover():
  //   open:  the bottom bar turns ink as the front clears the bottom edge (the first frames of the flood), the top bar as the front reaches the top;
  //   exit:  each bar turns cream as the receding iris lets go of that edge; the page is plain cream again the moment the black is gone (no margin needed).
  // html.inkbg = the driven-background structure (body transparent, cream paper as an image-only fixed layer); .ink-t / .ink-b = which bar is ink.
  let bandT = false, bandB = false;
  const sy = () => html.style.setProperty('--sy', scrollY + 'px');
  const paperY = () => { html.style.setProperty('--paper-y', (lockY != null ? -lockY : -scrollY) + 'px'); sy(); };   // the texture stays where the body's own paper was
  function syncBands() {
    const c = field.cover || { top: 0, bottom: 0 };
    const t = bandT ? c.top > .45 : c.top >= .55, b = bandB ? c.bottom > .45 : c.bottom >= .55;
    if (t === bandT && b === bandB) return;
    bandT = t; bandB = b; paperY();
    html.classList.toggle('inkbg', t || b); html.classList.toggle('ink-t', t); html.classList.toggle('ink-b', b);
    if (!(t || b)) { html.style.removeProperty('--paper-y'); html.style.removeProperty('--sy'); }
    if (theme) theme.content = t ? '#1a181c' : theme0;
  }
  clock.onTick(syncBands);
  addEventListener('scroll', () => { if (html.classList.contains('inkbg')) paperY(); }, { passive: true });
  // nothing under the wash moves: a touchmove anywhere but inside the poem / sign fields is cancelled
  document.addEventListener('touchmove', e => {
    if (!body.classList.contains('composing')) return;
    if (e.target?.closest?.('#cpoem, #cname') && e.touches.length === 1) return;
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  // ---------- the writing lines: ONE seamless 3-line textarea over three drawn rows ----------
  // iOS Safari puts ^ / v "jump between fields" arrows above the keyboard when a page has several fields, so the poem is a
  // single transparent <textarea> whose line boxes sit exactly on the three ruled rows (line-height = row pitch). The
  // mirrors draw the words, dots, placeholders and a pixel caret; the textarea only owns the typing. Hard max 3 lines.
  const linesEl = $('#clines'), ta = $('#cpoem');
  const rows = [0, 1, 2].map(i => {
    const el = document.createElement('div'); el.className = 'ln'; el.dataset.state = 'empty';
    el.innerHTML = `<div class="wr"><div class="field"><div class="mirror"></div><i class="caret" hidden></i></div><div class="crule"></div></div>`;
    linesEl.insertBefore(el, ta);
    return { el, wr: el.querySelector('.wr'), field: el.querySelector('.field'), mirror: el.querySelector('.mirror'), caret: el.querySelector('.caret'), last: -1 };
  });
  const MAXL = 3, nameIn = $('#cname'), nameNm = nameIn.parentNode;
  const texts = () => { const p = ta.value.split('\n').slice(0, MAXL); while (p.length < MAXL) p.push(''); return p; };
  const lineStart = (v, i) => { let at = 0; for (let k = 0; k < i; k++) { const nl = v.indexOf('\n', at); if (nl < 0) return -1; at = nl + 1; } return at; };
  function caretAt() { const s = ta.selectionStart ?? 0, b = ta.value.slice(0, s), li = Math.min(MAXL - 1, b.split('\n').length - 1); return { li, col: s - (b.lastIndexOf('\n') + 1) }; }
  function setCaret(pos) { ta.setSelectionRange(pos, pos); syncCaret(); }
  function focusLine(i, col = Infinity) {          // caret to line i (creating the empty lines it needs), end of line by default
    let v = ta.value, at = lineStart(v, i);
    if (at < 0) { v = v + '\n'.repeat(i - (v.split('\n').length - 1)); ta.value = v; at = lineStart(v, i); }
    const end = v.indexOf('\n', at) < 0 ? v.length : v.indexOf('\n', at);
    if (ta.disabled) ta.disabled = false;
    if (document.activeElement !== ta) ta.focus({ preventScroll: true });
    setCaret(Math.min(end, at + col)); update();
  }
  let allOk = false, busy = false, opened = false, unrolling = false, denied = false, denyMsg = '', lastStates = ['empty', 'empty', 'empty'], lastInput = 0, idleN = 0, fsNow = 48, fsMax = 48, rowFs = [48, 48, 48], ASC = .78;
  const inputs = [0, 1, 2].map(i => ({                // per-line handles (HB.rows / tools): value + focus, backed by the one textarea
    get value() { return texts()[i]; },
    set value(t) { const p = texts(); p[i] = String(t).replace(/\n/g, ' '); ta.value = p.join('\n').replace(/\n+$/, ''); },
    focus() { focusLine(i); }, get el() { return ta; }, line: i,
  }));

  // the textarea's line boxes sit on the rows: measured, so it survives the keyboard-compact layout and the 24/16px fit
  function layoutField() {
    // every row shares one baseline (4px + fsMax * ASC into its field); the textarea runs at the smallest row size with its
    // baselines laid on that line, so nothing in it ever overflows sideways
    const top = r => r.wr.offsetTop + r.field.offsetTop;
    const t0 = top(rows[0]), pitch = (top(rows[2]) - t0) / 2, base = t0 + 4 + fsMax * ASC;
    if (!(pitch > 0)) return;
    Object.assign(ta.style, { left: rows[0].wr.offsetLeft + 'px', width: rows[0].wr.offsetWidth + OVERHANG + 'px', top: base - (pitch - fsNow) / 2 - fsNow * ASC + 'px',
      height: pitch * MAXL + 'px', lineHeight: pitch + 'px', fontSize: fsNow + 'px' });
    linesEl.style.setProperty('--pitch', pitch + 'px');
  }
  // the pixel caret (the native one would be as tall as the 81px line box on iOS)
  function syncCaret() {
    const waiting = body.classList.contains('await-tap') && document.activeElement !== ta;   // 'tap to write': a pulsing caret where typing resumes
    const on = (document.activeElement === ta || waiting) && ta.selectionStart === ta.selectionEnd, { li, col } = caretAt();
    if (ta.scrollTop) ta.scrollTop = 0;
    const sx = ta.scrollLeft; linesEl.style.setProperty('--sx', -sx + 'px');
    mctx ||= document.createElement('canvas').getContext('2d');
    rows.forEach((r, k) => {
      const show = on && k === li; r.caret.hidden = !show; r.el.classList.toggle('focus', document.activeElement === ta && k === li);
      if (show) { mctx.font = `${rowFs[k]}px ChiKareGo2`; r.caret.style.left = Math.round(tw(texts()[k].slice(0, col), rowFs[k]) - sx) + 'px'; r.caret.style.animation = 'none'; void r.caret.offsetWidth; r.caret.style.animation = ''; }
    });
    const hint = li < MAXL - 1 ? 'next' : 'done'; if (ta.getAttribute('enterkeyhint') !== hint) ta.setAttribute('enterkeyhint', hint);
  }
  document.addEventListener('selectionchange', () => { if (document.activeElement === ta) syncCaret(); });
  ta.addEventListener('scroll', syncCaret);

  // where the pixel font's baseline sits in its 1em line box (fraction of the size), measured once the font is in
  function measureAsc() {
    if (measureAsc.done || !document.fonts?.check?.('16px ChiKareGo2')) return;
    mctx ||= document.createElement('canvas').getContext('2d'); mctx.font = '48px ChiKareGo2';
    const m = mctx.measureText('Hg'); if (!m.fontBoundingBoxAscent) return;
    ASC = (m.fontBoundingBoxAscent + (48 - m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2) / 48; measureAsc.done = true;
  }
  // rows can run at different sizes, so a tap puts the caret by the DRAWN words of that row, not the textarea's own text
  ta.addEventListener('click', e => {
    if (ta.selectionStart !== ta.selectionEnd || rowFs.every(f => f === fsNow)) return;
    const tr = ta.getBoundingClientRect(), pitch = parseFloat(ta.style.lineHeight) || 1;
    const li = Math.max(0, Math.min(MAXL - 1, Math.floor((e.clientY - tr.top) / pitch))), t = texts()[li];
    const x = e.clientX - rows[li].mirror.getBoundingClientRect().left;
    mctx ||= document.createElement('canvas').getContext('2d'); mctx.font = `${rowFs[li]}px ChiKareGo2`;
    let col = t.length; for (let c = 0; c < t.length; c++) { const w0 = tw(t.slice(0, c), rowFs[li]), w1 = tw(t.slice(0, c + 1), rowFs[li]); if (x < (w0 + w1) / 2) { col = c; break; } }
    const at = lineStart(ta.value, li); if (at >= 0) setCaret(Math.min(at + col, ta.value.length)); update();
  });
  // pick the type size: the biggest step at which EVERY line fits its own row, from the text column to 2 art px inside the
  // torn right edge at the worst scroll row that line (and its numerals) would cover at that size (rows move as the type grows)
  function pickSize(texts, sizes) {
    const cr = $('#scv').getBoundingClientRect(), wr0 = rows[0].wr.clientWidth || 200;
    mctx ||= document.createElement('canvas').getContext('2d');
    if (!cr.width || !art.Rt) { return texts.map(t => fitSize([t], wr0 + OVERHANG, sizes)); }
    const k = cr.width / (art.W * SP), py0 = 2 + RH, f0 = rows[0].field.getBoundingClientRect(), f2 = rows[2].field.getBoundingClientRect();
    const top0 = (f0.top - cr.top) / k, pitchNow = (f2.top - f0.top) / k / 2, left = (f0.left - cr.left) / k;
    const pitch = pitchNow + (sizes[0] - fsMax) * ASC;          // rows are laid out for the biggest size
    return texts.map((t, i) => {                                // per row: the biggest size its own text fits at
      const y0 = Math.floor((top0 + i * pitch) / SP) - py0, y1 = Math.ceil((top0 + i * pitch + sizes[0] + 34) / SP) - py0;
      let rt = 0; for (let y = Math.max(0, y0); y <= y1; y++) rt = Math.max(rt, art.Rt[y] ?? 0);
      const avail = Math.min(wr0, (art.px1 - rt - 1) * SP - left) + OVERHANG;   // 1 art px clear of the torn edge
      for (const sz of sizes) { mctx.font = `${sz}px ChiKareGo2`; if (tw(t, sz) <= avail) return sz; }
      return sizes[sizes.length - 1];
    });
  }
  // the ghost size: the biggest open tier at which the widest ghost line fits the text column - from the column's width alone (not the torn edge, the
  // scroll's unroll or the keyboard), so it never changes between states; GHOST_FS is exported for the unit test
  // pure arithmetic from the art (never a DOM measurement: the scroll is hidden / clipped / mid-unroll for the first second): the text column is the sheet
  // (art.W px of SP css px) minus 62 px of paper margin, it starts 48 px in, and the worst torn edge anywhere on the sheet is art.Rt's maximum
  const GHOST_LEFT = 48, GHOST_INSET = 62;
  let ghostKey = '', ghostFs = FS_OPEN[0];
  function ghostSize() {
    const wr0 = art.W * SP - GHOST_INSET, rt = Math.max(...art.Rt), avail = Math.min(wr0, (art.px1 - rt - 1) * SP - GHOST_LEFT), key = avail + '|' + wr0;
    if (key !== ghostKey) { ghostKey = key; ghostFs = fitSize(PH, avail, FS_OPEN); }
    return ghostFs;
  }
  const safeWidth = () => rows[0].wr.clientWidth;
  function render(a, ok) {
    const sizes = isKb() ? (plan || kbPlan()).sizes : FS_OPEN;
    measureAsc();
    // round 14.9: the grey ghost lines are ONE fixed size on all three rows, in every state (they were fit one by one against the torn edge
    // that is measured while the scroll unrolls, so 'and five to end' came out smaller than 'five syllables' and the sizes moved). A typed line still fits itself.
    const ghost = ghostSize();
    rowFs = pickSize(a.map((l, i) => l.text || PH[i]), sizes).map((f, i) => a[i].text ? f : ghost); fsMax = sizes[0]; fsNow = Math.min(...rowFs);
    linesEl.style.setProperty('--fsm', fsMax + 'px'); linesEl.style.setProperty('--fs', fsNow + 'px'); linesEl.style.setProperty('--asc', ASC);
    $('#csign')?.style.setProperty('--fs', (rowFs[rowFs.length - 1] || fsNow) + 'px');   // signature matches poem line 3
    rows.forEach((r, i) => r.el.style.setProperty('--fsr', rowFs[i] + 'px'));
    layoutField();
    a.forEach((l, i) => {
      const r = rows[i]; r.el.dataset.state = l.state;
      r.mirror.innerHTML = l.text ? mirrorHTML(l) : `<span class="ph">${PH[i]}</span>`;
      if (l.n > r.last && r.last >= 0) anim([...r.mirror.querySelectorAll('.nums b')].at(-1), [{ transform: 'translateY(-5px) scale(1.4)', opacity: 0 }, { transform: 'none', opacity: 1 }]);
      r.last = l.n;
    });
    syncCaret();
    const was = body.classList.contains('ready'), rd = ok && !denied;
    body.classList.toggle('ready', rd);
    if (rd && !was) { anim($('#cpost'), JELLY); anim($('#csign'), [{ transform: 'translateY(-10px) scale(.9,1.2)', opacity: 0 }, { transform: 'none', opacity: 1 }]); }
    // no helper sentence on the scroll (red guides, counters, the stamp and Inky say it); screen readers still hear a status
    $('#cnote').textContent = denied ? (denyMsg || `${a.map(l => l.n).join('-')}: not 5-7-5 yet`) : '';
  }
  function update() { const a = analyze(texts()), ok = a.every(l => l.ok); allOk = ok; render(a, ok); fitName(); coach(a.map(l => l.state), ok); return a; }
  function coach(states, ok) {
    if (busy || !opened) { lastStates = states; return; }
    const hit = states.findIndex((s, i) => s === 'ok' && lastStates[i] !== 'ok');
    const over = states.findIndex((s, i) => s === 'over' && lastStates[i] !== 'over');
    const nowOk = ok && !lastStates.every(s => s === 'ok');
    if (nowOk) {
      inky.setMood('cheer'); inky.spin = .7; inky.jump(1.25); inky.sparkle(18); chat('event', () => 'five-seven-five!');
      clock.wait(1350).then(() => { if (allOk && !busy && opened) { inky.setMood('think'); inky.look = 1; chat('event', () => 'sign it?', 3600); } });
    }
    else if (over >= 0) { inky.setMood('worry'); inky.wobble(.6); }          // no words: the red numerals show the over-count
    else if (hit >= 0) { inky.setMood('cheer'); inky.jump(.95); inky.sparkle(10); chat('event', () => `line ${hit + 1}: ${NAMES[hit]}! nice`); clock.wait(1000).then(() => !busy && inky.mood === 'cheer' && !allOk && inky.setMood('happy')); }
    else if (states.includes('over')) { if (inky.mood !== 'worry') inky.setMood('worry'); }
    else if (inky.mood === 'worry' || inky.mood === 'bored') inky.setMood('happy');
    lastStates = states;
  }
  // typing: Return = next line (never a 4th), paste splits into at most 3 lines, Backspace at a line start joins lines
  let kdEnter = false, advanced = -1;
  function enter() {
    const { li, col } = caretAt();
    if (advanced === li && col === 0 && !texts()[li]) { advanced = -1; return; }   // a Return right after an auto-advance: already there
    advanced = -1;
    if (li < MAXL - 1) focusLine(li + 1); else submit();      // line 3: exactly like pressing the checkmark seal
  }
  // AUTO-FLOW (round 14.4): the writing flows by itself. With the caret at the end of line 1 or 2 and the line's last word
  // FINISHED (a space / punctuation was typed, or ~350 ms of idle, whichever comes first - IME / autocorrect / fast typing
  // safe: it runs off the input events and compositionend, never mid-composition):
  //   * the count is exactly the target (5 / 7)  -> the caret moves on to the next line (the trailing space is dropped);
  //     on an IDLE pause that needs the last word to be a real dictionary word (a half-typed "wat" can't have it)
  //   * the count has gone OVER (every reading > target) -> the words past the target spill onto the front of the next
  //     line and the caret follows them (the long line in Tiago's screenshot: "ah this is much" | "better but now ...")
  // Line 3 never flows (complete = ready to post: the sign row shows; Return or the seal posts). A paste of one long line is
  // re-flowed the same way across the three lines. Keeps the one textarea focused throughout (no blur, no keyboard flicker).
  const WORD_END = /[\s.,;:!?…—–-]$/, FLOW_IDLE_MS = 350, minSum = r => Math.min(...r.possible);
  // split a line at the word boundary that fits the target: { keep, spill } (spill '' = nothing to move)
  function fitLine(line, target) {
    const res = countLine(line, target); if (!res.words.length || minSum(res) <= target) return { keep: line, spill: '' };
    const starts = [...line.matchAll(/\S+/g)].map(m => m.index);          // where each space-separated word starts (countLine's own `from` is the word text, not an offset)
    let cut = -1;
    for (let k = 1; k < starts.length; k++) { const pre = countLine(line.slice(0, starts[k]), target); if (pre.ok) { cut = k; break; } if (minSum(pre) >= target) break; cut = k; }   // first exact hit, else the last prefix still under
    if (cut < 1) return { keep: line, spill: '' };                    // one huge word: never leave a line empty
    return { keep: line.slice(0, starts[cut]).replace(/\s+$/, ''), spill: line.slice(starts[cut]).trim() };
  }
  function autoFlow(e, idle = false) {
    if (e && (e.isComposing || !/^insert(Text|CompositionText|ReplacementText|FromComposition)?$/.test(e.inputType || 'insertText'))) return false;
    if (!opened || busy || ta.selectionStart !== ta.selectionEnd) return false;
    const v = ta.value, s0 = ta.selectionStart, { li } = caretAt(), at = lineStart(v, li), nl = v.indexOf('\n', at), end = nl < 0 ? v.length : nl;
    if (li >= MAXL - 1 || s0 !== end) return false;
    const line = v.slice(at, end); if (!line.trim()) return false;
    const done = idle || WORD_END.test(line); if (!done) return false;
    const res = countLine(line, PATTERN[li]), next = (texts()[li + 1] ?? '').trim();
    if (res.ok) {
      if (next) return false;
      const last = res.words[res.words.length - 1];
      if (idle && !WORD_END.test(line) && (!last || last.source === 'guess')) return false;
      ta.value = v.slice(0, at) + line.replace(/\s+$/, '') + v.slice(end);
      focusLine(li + 1, 0); advanced = li + 1; return true;
    }
    if (minSum(res) > PATTERN[li]) {
      const { keep, spill } = fitLine(line, PATTERN[li]); if (!spill) return false;
      const rest = v.slice(end + 1), tail = nl < 0 ? '' : rest;      // everything after this line
      const nxtEnd = tail.indexOf('\n'), nxt = nl < 0 ? '' : (nxtEnd < 0 ? tail : tail.slice(0, nxtEnd)), after = nl < 0 ? '' : (nxtEnd < 0 ? '' : tail.slice(nxtEnd));
      const lead = spill + ' ';
      ta.value = v.slice(0, at) + keep + '\n' + lead + nxt.replace(/^\s+/, '') + after;
      const pos = at + keep.length + 1 + (spill.length + 1);
      advanced = -1; if (ta.disabled) ta.disabled = false; setCaret(Math.min(pos, ta.value.length)); update(); return true;
    }
    return false;
  }
  // re-flow a whole value (a paste of one long line): every line over its target hands its overflow to the next
  function reflowAll(txt) {
    const L = txt.split('\n').map(x => x.trim()).filter(x => x !== ''); if (!L.length) return txt;
    for (let i = 0; i < MAXL - 1 && i < L.length; i++) { const { keep, spill } = fitLine(L[i], PATTERN[i]); if (spill) { L[i] = keep; if (L[i + 1] != null) L[i + 1] = spill + ' ' + L[i + 1]; else L.push(spill); } }
    return L.slice(0, MAXL - 1).concat(L.length > MAXL - 1 ? [L.slice(MAXL - 1).join(' ')] : []).join('\n');
  }
  let idleTok = 0;
  const scheduleIdle = () => { const tok = ++idleTok; clock.wait(FLOW_IDLE_MS).then(() => { if (tok === idleTok && opened && !busy && document.activeElement === ta && autoFlow(null, true)) { poke(); update(); } }); };
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); kdEnter = true; setTimeout(() => kdEnter = false, 0); enter(); } });
  ta.addEventListener('beforeinput', e => {
    if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') { e.preventDefault(); if (!kdEnter) enter(); return; }
    // "pond, " — the comma already finished the line and moved on; the space typed after it must not start the next line
    if (advanced >= 0 && e.inputType === 'insertText' && /^\s+$/.test(e.data || '')) {
      const { li, col } = caretAt(); if (advanced === li && col === 0 && !texts()[li]) e.preventDefault();
    }
  });
  ta.addEventListener('input', e => {
    const v = ta.value, c = clampLines(v);
    if (c !== v) { const pos = ta.selectionStart; ta.value = c; setCaret(Math.min(pos, c.length)); }
    if (!autoFlow(e) && !/^delete/.test(e.inputType || '')) { if (advanced >= 0 && caretAt().col > 0) advanced = -1; }
    if (/^delete/.test(e.inputType || '')) advanced = -1;
    if (!e.isComposing && !/^delete/.test(e.inputType || '')) scheduleIdle(); else idleTok++;
    if (denied) clearDenied(); poke(); update();
  });
  ta.addEventListener('compositionend', () => { setTimeout(() => { if (autoFlow(null)) { poke(); update(); } scheduleIdle(); }, 0); });   // IME / autocorrect finished a word
  ta.addEventListener('paste', e => {
    const raw = e.clipboardData?.getData('text'); if (raw == null) return;
    e.preventDefault();
    let t = raw.replace(/\r\n?/g, '\n');
    t = t.includes('\n') ? t.split('\n').map(s => s.trim()).filter(Boolean).join('\n') : t.includes(' / ') ? t.split(' / ').map(s => s.trim()).join('\n') : t;
    const s0 = ta.selectionStart, s1 = ta.selectionEnd; let v = clampLines(ta.value.slice(0, s0) + t + ta.value.slice(s1));
    if (!/\n/.test(raw.trim()) && !/ \/ /.test(raw) && !/\n/.test(ta.value.slice(0, s0) + ta.value.slice(s1))) { v = reflowAll(v); ta.value = v; setCaret(v.length); }   // round 14.4: one long line flows over the three
    else { ta.value = v; setCaret(Math.min(v.length, clampLines(ta.value.slice(0, s0) + t).length)); }
    if (denied) clearDenied(); poke(); update();
  });
  ta.addEventListener('focus', () => { if (gate !== 'open' && opened) { gate = 'open'; idleAt = 0; } if (body.classList.contains('await-tap')) { body.classList.remove('await-tap'); if (tapBubble) { tapBubble = false; bubble.hidden = true; } } syncCaret(); poke(); });
  ta.addEventListener('blur', () => {
    rows.forEach(r => { r.caret.hidden = true; r.el.classList.remove('focus'); });
    // round 14.1: iOS dismissed the keyboard (a page cannot stop that, and a focus() outside a tap cannot bring it back): no
    // fighting the user; the caret pulses where typing resumes and the next tap on the paper or a line refocuses inside that tap
    setTimeout(() => { if (opened && !busy && !denied && coarse && document.activeElement !== ta && document.activeElement !== nameIn && !nameNm.classList.contains('edit')) awaitTap(false); }, 0);
  });
  // ---------- keyboard back fast: any tap on the scroll paper or a line refocuses the current line INSIDE that tap ----------
  let tapBubble = false;
  function awaitTap(first) {
    body.classList.add('await-tap'); syncCaret();
    if (first) { tapBubble = true; say('tap to write', 600000); }
  }
  function refocus() {
    if (!opened || busy) return false;
    const s0 = ta.selectionStart ?? 0, s1 = ta.selectionEnd ?? s0;
    if (ta.disabled) ta.disabled = false;
    if (document.activeElement === ta) ta.blur();          // a focused-but-keyboardless field: blur + focus inside the tap reopens it
    ta.focus({ preventScroll: true }); try { ta.setSelectionRange(s0, s1); } catch {}
    syncCaret(); update(); return true;
  }
  $('#cscroll').addEventListener('click', e => {
    if (!opened || busy || e.target.closest?.('#cpoem, .back, .cpost, .sign, #cname')) return;
    if (document.activeElement === ta && !body.classList.contains('await-tap')) return;
    if (document.activeElement === nameIn) return;
    refocus();
  });
  // with the name being typed the textarea is disabled (one field = no iOS arrows); a tap on the lines brings it back at once
  linesEl.addEventListener('pointerdown', e => {
    if (!ta.disabled || !opened || busy) return;
    e.preventDefault();
    const y = e.clientY - linesEl.getBoundingClientRect().top, li = rows.findIndex(r => y < r.el.getBoundingClientRect().bottom - linesEl.getBoundingClientRect().top + 13);
    focusLine(li < 0 ? MAXL - 1 : li);
  });

  // ---------- sign: NOT a live form field until tapped (a second field would bring iOS's ^ v arrows back) ----------
  function openName() {
    if (!body.classList.contains('ready') || busy) return;
    nameNm.classList.add('edit'); nameIn.disabled = false;
    ta.disabled = true;                            // only one enabled field at a time
    nameIn.focus({ preventScroll: true });
    const n = nameIn.value.length; try { nameIn.setSelectionRange(n, n); } catch {}
  }
  function closeName() { nameNm.classList.remove('edit'); nameIn.disabled = true; ta.disabled = false; fitName(); }
  $('#cnamebtn').addEventListener('pointerdown', e => e.preventDefault());
  $('#cnamebtn').addEventListener('click', e => { e.preventDefault(); openName(); });
  nameIn.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== nameIn) closeName(); }, 0));
  nameIn.addEventListener('input', () => { const c = cleanName(nameIn.value); if (c !== nameIn.value) nameIn.value = c; fitName(); poke(); });
  function fitName() {                          // round 15.10f5c: typed name = poem line 3; placeholder ~75% so "Sign? (optional)" fits clear of stamps; never below 16px
    const nm = nameNm, mm = nm.querySelector('.nmm'), ph = nm.querySelector('.nph'), v = nameIn.value;
    mm.textContent = v; nm.classList.toggle('has', !!v); nm.style.removeProperty('--nfs');
    const mirrors = [...linesEl.querySelectorAll('.field .mirror')];
    const last = mirrors[mirrors.length - 1];
    let poemFs = last ? (parseFloat(getComputedStyle(last).fontSize) || 0) : 0;
    if (!poemFs) {
      const cs = getComputedStyle(linesEl);
      poemFs = parseFloat(cs.getPropertyValue('--fs')) || parseFloat(getComputedStyle($('#csign')).getPropertyValue('--fs')) || 32;
    }
    const base = Math.max(16, Math.round(poemFs));
    nm.style.setProperty('--nfs', base + 'px');
    // pretext: ~3/4 of typed size (a touch under the stamps), then shrink only if it won't fit
    let phFs = Math.max(16, Math.round(base * 0.75));
    nm.style.setProperty('--phfs', phFs + 'px');
    if (ph) {
      const room = nm.clientWidth - 2;
      ph.style.width = 'max-content';
      while (phFs > 16 && ph.scrollWidth > room) { phFs -= 1; nm.style.setProperty('--phfs', phFs + 'px'); }
      ph.style.width = '';
    }
    if (!v) return;
    const room = nm.clientWidth - 2; let fs = base;
    mm.style.width = 'max-content';   // scrollWidth must be the glyphs, not the stretched absolute box
    while (fs > 16 && mm.scrollWidth > room) { fs -= 1; nm.style.setProperty('--nfs', fs + 'px'); }
    mm.style.width = '';
  }
  addEventListener('resize', () => requestAnimationFrame(() => { fitName(); layoutField(); syncCaret(); }));
  document.fonts?.ready.then(() => { layoutField(); syncCaret(); });
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });

  // ---------- keyboard auto-open: iOS only raises it for focus() inside a tap, so the write tap focuses a 1px primer
  // field right away; when the scroll has unrolled, focus moves to line 1 (a focus hand-off keeps the keyboard up) ----------
    let primer = null, primerT = 0;
  function prime() {
    if (KB_MODE !== 'early' || !coarse || opened || busy || body.classList.contains('composing')) return;
    primer ||= Object.assign(document.createElement('input'), { type: 'text', tabIndex: -1, autocomplete: 'off', className: 'kb-primer' });
    for (const [k, v] of Object.entries({ 'aria-hidden': 'true', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', inputmode: 'text', enterkeyhint: 'next', 'data-1p-ignore': '', 'data-lpignore': 'true' })) primer.setAttribute(k, v);
    root.appendChild(primer); primer.focus({ preventScroll: true });
    clearTimeout(primerT); primerT = setTimeout(() => { if (!body.classList.contains('composing')) dropPrimer(); }, 2500);
  }
  function dropPrimer() { clearTimeout(primerT); if (primer?.isConnected) { if (document.activeElement === primer) primer.blur(); primer.remove(); } }
  deps.fab?.addEventListener('click', prime, true);   // capture: runs inside the same tap, before app.js starts the roll-up
  function poke() { lastInput = clock.now(); if (inky.mood === 'bored') { inky.setMood('happy'); inky.wobble(.5); bubbleUntil = Math.min(bubbleUntil, Math.max(clock.now(), bubbleFrom + TAP_MIN_UP)); } }   // the comment finishes its minimum, then fades: typing never snaps it away

  // Inky parks LOWER-LEFT, standing in front of the lower roller with his feet in the free band under it (kbPlan keeps
  // that band): his body may cover the wooden roller but never the paper, so never a stamp, a writing line or the sign
  const dock = () => {
    const l = Math.max(0, innerWidth / 2 - 230), vb = vvt + vvh, sb = scrollBottom(), pb = paperBottom();
    if (isKb()) { const pv = vvt + (plan ? plan.h : vvh); return { x: l + 46, foot: Math.min(pv - BOT_GAP, vb - BOT_GAP) }; }   // round 14.11: his feet sit BOT_GAP above the (planned) visible bottom, next to the keyboard; the plan left room above him
    const foot = Math.min(vb - 4, Math.max(pb + INKY_H(), vb - 36));
    return { x: l + 62, foot };
  };

  // ---------- round 14.1: bugging red Inky. A tap squishes him, he wobbles and pulls a face (worried, then flustered,
  // then annoyed after repeated taps) and pops a tiny short-lived bubble drawn from a pool with no repeats. The tap target
  // never takes focus (preventDefault on pointerdown + the compat mousedown), so the keyboard and the caret stay put. ----------
  const BUG_POOL = ['hmm…', 'what to write…', 'thinking…', 'five, then seven…', "shh, I'm counting", 'ok ok!'];
  let bugBag = [], bugLast = '', bugTaps = 0, bugAt = -1e9;
  const nextBug = () => { if (!bugBag.length) { bugBag = BUG_POOL.filter(t => t !== bugLast); for (let i = bugBag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bugBag[i], bugBag[j]] = [bugBag[j], bugBag[i]]; } } return (bugLast = bugBag.pop()); };
  const hit = document.createElement('div'); hit.className = 'rihit'; hit.setAttribute('aria-hidden', 'true'); root.appendChild(hit);
  for (const ev of ['pointerdown', 'mousedown', 'touchstart']) hit.addEventListener(ev, e => { if (e.cancelable) e.preventDefault(); if (ev === 'pointerdown') bugInky(); }, { passive: false });
  // round 15.1: the board's TapMeter decides when he has had enough (a random 6-12 taps): the same anger escalation, splat, dead time, reform +
  // revive chime. While he is flat, taps do nothing; posting / quitting / closing picks him straight up (RedInky.setMood).
  const bugMeter = new TapMeter();
  inky.onRevive = () => { bugMeter.revive(); bugTaps = 0; bugAt = -1e9; sfx('revive'); };
  function bugInky() {
    if (!opened || !inky.visible || inky.mode !== 'coach' || inky.splatT > 0) return;
    const now = clock.now(), r = bugMeter.tap(now); bugTaps = now - bugAt < 2200 ? bugTaps + 1 : 1; bugAt = now;
    if (r.kind === 'ignored') return;
    if (r.kind === 'splat') { sfx('splat'); inky.splatDown(); pending = null; bubble.hidden = true; bubbleUntil = 0; return; }   // he's had it: flat, X eyes, no words
    sfx('poke', { anger: Math.min(1, r.taps / (bugMeter.splatAt || 8)) });   // red Inky: the same poke, angrier toward the splat (as board Inky)
    inky.s = .55 + Math.min(.15, bugTaps * .04); inky.sv = 0; inky.wobble(.9 + Math.min(.8, bugTaps * .15));   // squish + wobble
    if (busy || denied) return;                    // mid-post / mid-denial: only the squish, no face or words over it
    inky.tapping = false;
    if (bugTaps >= 5) { inky.setMood('angry'); inky.shiver = .35; }
    else if (bugTaps >= 3) inky.setMood('shout');
    else inky.setMood(bugTaps === 2 ? 'worry' : 'think');
    if (tapBubble) { tapBubble = false; }
    chat('tap', () => bugTaps >= 5 && bugLast !== 'ok ok!' ? (bugBag = bugBag.filter(t => t !== 'ok ok!'), bugLast = 'ok ok!') : nextBug());   // gated: replaces a bubble only after >= 1.5 s up; the face and squish still react to every tap
    const mine = now; clock.wait(bugTaps >= 5 ? 1800 : 1300).then(() => { if (bugAt === mine && opened && !busy && !denied && ['angry', 'shout', 'worry', 'think'].includes(inky.mood)) { inky.setMood('happy'); inky.shiver = 0; } });
  }
  clock.onTick(() => {                             // the tap target follows him (only while he is coaching)
    const on = opened && inky.visible && inky.mode === 'coach', st = hit.style;
    if (!on) { if (st.display !== 'none') st.display = 'none'; return; }
    const p = inky.pos, w = Math.ceil(inky.R * 3.2 * 4), h = INKY_H(), l = Math.round(p.x - w / 2), t = Math.round(p.foot - h);
    if (st.display !== 'block') st.display = 'block';
    const key = l + ',' + t + ',' + w + ',' + h; if (key !== hit._k) { hit._k = key; Object.assign(st, { transform: `translate(${l}px, ${t}px)`, width: w + 'px', height: h + 'px' }); }
  });

  // ---------- bubble: drawn pixel by pixel, always points back at Inky ----------
  let bubbleUntil = 0, bubbleFrom = -1e9, pending = null, idleAt = 0, bubbleOpacity = '';
  // round 14.8: 'tap to write' is ALWAYS his first words on every compose open. `sess` ticks on each open (stale timers of an older session can't speak),
  // `gate` keeps idle / progress / tap comments out until 'tap to write' has been shown and the first tap landed (or its minimum hold passed).
  let sess = 0, gate = 'open', gateShown = -1e9;
  const gateOpen = () => gate === 'open' || (gate === 'shown' && clock.now() - gateShown >= HOLD_MIN);
  function resetSpeech() { bugMeter.revive(); if (inky.splatT > 0) { inky.splatT = 0; inky.slump = 0; inky.setMood('happy'); } body.classList.remove('await-tap'); sess++; pending = null; bubble.hidden = true; bubbleUntil = 0; bubbleFrom = -1e9; bubbleOpacity = ''; bubble.style.opacity = '0'; tapBubble = false; idleAt = 0; bugTaps = 0; bugAt = -1e9; inky.tapping = false; gate = KB_MODE === 'late' && coarse ? 'wait' : 'open'; gateShown = -1e9; }
  const bubbleLog = [];   // measured by the tests / captures: every bubble shown (when, text, hold ms)
  function say(text, ms = 1800, big = false) {   // raw: shows now (state changes: open / post / deny). Idle chatter and taps go through chat()
    if (text !== 'tap to write') tapBubble = false;
    bubble.innerHTML = `<span class="bt">${text}</span>`; bubble.prepend(bcv); bubble.hidden = false; bubble.classList.toggle('big', big);
    bubble.style.width = bubble.style.height = '';
    const t = bubble.querySelector('.bt').getBoundingClientRect();
    bubble._bw = Math.ceil(t.width / BU); bubble._bh = Math.ceil(t.height / BU); bubble._key = '';
    bubble.style.width = bubble._bw * BU + 'px'; bubble.style.height = bubble._bh * BU + 'px';
    bubbleFrom = clock.now(); bubbleUntil = bubbleFrom + ms; bubble.style.opacity = '0'; bubbleOpacity = '0'; placeBubble();
    if (text === 'tap to write') { gate = 'shown'; gateShown = bubbleFrom; }
    bubbleLog.push({ text: text.replace(/<br>/g, ' '), at: bubbleFrom, hold: ms });
  }
  // Gated speech. kind 'tap' = the user bugged him (immediate, but it may only replace a bubble that has been up >= TAP_MIN_UP, else it waits for
  // that moment; rapid taps keep ONE pending line, so they can never machine-gun); 'event' (line done, sign it?) waits for the current bubble's
  // whole hold; 'idle' is dropped if anything is up or pending. `make` returns the text only when it is actually shown (keeps the no-repeat order).
  function chat(kind, make0, hold) {
    if (!gateOpen()) return false;                                   // nothing is said (or queued) before 'tap to write' has had its say
    const s0 = sess, make = () => s0 === sess ? make0() : null;      // a callback from an older compose session says nothing
    const up = !bubble.hidden && clock.now() < bubbleUntil;
    if (!up && !pending) { const t = make(); if (t) say(t, hold ?? bubbleHold(t)); return true; }
    if (kind === 'idle') return false;
    pending = { kind, make, hold }; return false;
  }
  function pump() {
    if (!pending) return; const now = clock.now(), up = !bubble.hidden && now < bubbleUntil;
    if (up && !(pending.kind === 'tap' && now - bubbleFrom >= TAP_MIN_UP)) return;
    const p = pending; pending = null; const t = p.make(); if (t) say(t, p.hold ?? bubbleHold(t));
  }
  clock.onTick(() => {
    const now = clock.now();
    if (opened && !busy && !denied && !(inky.splatT > 0) && body.classList.contains('composing') && !allOk && !body.classList.contains('await-tap') && now - lastInput > IDLE_FIRST && now >= idleAt) {
      if (chat('idle', () => NO_RUSH[idleN++ % NO_RUSH.length])) { inky.setMood('bored'); inky.tapping = true; idleAt = now + IDLE_GAP[0] + Math.random() * (IDLE_GAP[1] - IDLE_GAP[0]); }
    }
    pump();
    if (bubble.hidden) return;
    if (now > bubbleUntil + FADE_OUT || !inky.visible) { bubble.hidden = true; return; }
    const o = Math.min(1, (now - bubbleFrom) / FADE_IN, 1 - Math.max(0, now - bubbleUntil) / FADE_OUT).toFixed(2);   // a gentle fade in, the hold, a gentle fade out
    if (o !== bubbleOpacity) { bubbleOpacity = o; bubble.style.opacity = o; }
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
    const minTop = m.cy > scrollBot && scrollBot > 0 ? scrollBot + 6 : vvt + (isKb() ? topSafe() : 0) + 6;   // round 14.11: never under the status bar
    const Hv = Math.max(H, bubble.getBoundingClientRect().height || 0);   // round 14.11: the bubble's real box (its frame is taller than the drawn H): it must end above the visible bottom, next to Inky near the keyboard
    let top = Math.min(vvt + vvh - Hv - 4, Math.max(minTop, m.y - H / 2 - BU * 2));   // (the visible bottom wins over 'below the scroll': he now stands close to it)
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
  function blurAll() { dropPrimer(); document.activeElement?.blur?.(); }
  const fabAnim = (k, o) => { try { return deps.fab?.animate(k, o); } catch { return null; } };

  // ---------- OPEN: board Inky dives in -> black flood -> scroll unrolls -> red Inky swings in from the right ----------
  let homeInky = null;
  async function open() {
    if (opened || body.classList.contains('composing')) return;
    resetSpeech();                                                   // 14.8: no bubble, queue or timer of an earlier session survives into this open
    lockScroll(); body.classList.add('composing'); html.classList.add('composing'); busy = true; rejects = hintAt = 0; denied = false; denyMsg = ''; body.classList.remove('is-denied');
    syncViewport();
    ta.value = ''; ta.scrollLeft = 0; nameIn.value = ''; if (document.activeElement !== nameIn) closeName(); fitName(); $('#cpost').classList.remove('stamped');
    lastStates = ['empty', 'empty', 'empty']; idleN = 0; update(); fitPaper();
    const fab = deps.fab?.getBoundingClientRect() ?? { left: innerWidth / 2, width: 0, top: innerHeight - 60 }, fx = fab.left + fab.width / 2;
    const bi = deps.inky; homeInky = { x: bi.pos.x, foot: bi.floorCss?.() ?? bi.pos.foot };   // his float line, even if he was mid-throw
    bi.setMood('cheer'); bi.mode = 'still';
    deps.hideBoardBubble?.();
    await bi.hopTo(fx, fab.top + 8, .26, 12);
    bi.visible = false;
    const fl = field.flood(fx, { speed: 1.8 }); sfx('inkFloodIn');   // round 15.1: the bucket of ink dumps over the screen
    fabAnim([{ transform: 'translateX(-50%) scale(1)' }, { transform: 'translateX(-50%) scale(1.25,.7)', offset: .3 }, { transform: 'translateX(-50%) translateY(140px) scale(.8,1.2)' }], { duration: 360, easing: 'ease-in', fill: 'forwards' });
    await fl;
    body.classList.add('washed'); html.classList.add('washed');   // the flood has filled the screen: now a solid wash far past every edge
    await unroll();
    await clock.wait(FOCUS_DELAY);              // the unroll has fully played; a short breath before the caret
    frozen = false; syncViewport(); fitPaper(); update();
    busy = false; opened = true; body.classList.add('opened'); lastInput = clock.now();
    if (KB_MODE === 'late' && coarse) awaitTap(true);   // round 14.1: no keyboard during the animation; the first tap on the paper brings it
    else { focusLine(0, 0); dropPrimer(); }        // focus hand-off: primer (focused during the tap) -> line 1, the keyboard stays up
  }
  async function unroll() {
    const sc = $('#cscroll'); syncViewport(); frozen = true; fitPaper();   // the layout is decided now and held until the unroll is over
    sc.hidden = false; art.jump(0);
    anim(sc, [{ transform: 'translateX(-50%) translateY(-140px) scale(.92,1.1)' }, { transform: 'translateX(-50%) translateY(0) scale(1)' }], { stiffness: 340, damping: 17 });
    await clock.wait(240);
    busyScroll = true; unrolling = true;
    sfx('scrollOpen');                              // the write scroll unrolls: old paper
    const done = art.setTarget(rowsNow(), { k: 95, c: 11 });
    await clock.wait(380);
    const d = dock(); inky.visible = true; inky.setMood('cheer'); inky.look = -1;
    sfx('swooshIn', { dur: .95 });                  // round 15.1: his swoop in: the drag churn, swelling with it
    await inky.whip([[innerWidth + 90, vvt + vvh * .56], [innerWidth * .62, vvt + vvh * .74], [innerWidth * .36, vvt + vvh * .9], [innerWidth * .48, vvt + vvh * .8], [innerWidth * .26, vvt + vvh * .76], [d.x, d.foot]], .95, { splash: 10, whoosh: false });   // swooshIn just above
    await done; busyScroll = false; unrolling = false;
    inky.mode = 'coach'; inky.dock = dock; inky.setMood('happy'); inky.look = 1;
    if (!(KB_MODE === 'late' && coarse)) say('hi! I\'m counting.<br>give me 5-7-5', bubbleHold('hi! I\'m counting. give me 5-7-5'));   // 14.8: in the tap-to-write flow his FIRST words are 'tap to write' (this greeting used to flash first)
  }
  async function rollUp() {
    body.classList.remove('opened');
    const sc = $('#cscroll'); busyScroll = true;
    sfx('scrollClose');
    await art.setTarget(0, { mode: 'roll' });
    const b = sc.animate([{ transform: 'translateX(-50%)' }, { transform: 'translateX(-50%) translateY(10px) scale(1.06,.85)', offset: .3 }, { transform: 'translateX(-50%) translateY(-260px) scale(.9,1.15)' }], { duration: 420, easing: 'cubic-bezier(.5,0,.8,.5)', fill: 'forwards' });
    await clock.wait(420); sc.hidden = true; b.cancel(); busyScroll = false;
  }
  let unlockTo;                                     // undefined: back to where the board was; a number: there instead (a new post: the top)
  async function drainHome() {
    const bi = deps.inky; bi.mode = 'still'; bi.R = 7; bi.visible = false;
    const hx = homeInky?.x ?? innerWidth * .2, hf = homeInky?.foot ?? innerHeight - 78;
    bi.placeAt(hx, hf); bi.floor = bi.fy; bi.grounded = true; bi.setMood('happy');
    const bp = bi.pos, dur = 1.3;
    const s = field.suck(bp.x, bp.y, { dur, endR: 6 });
    html.classList.add('draining');                    // html stays ink (and the theme colour) until the iris has gone
    inky.drops = []; inky.puddles = []; inky.sparks = [];   // no stray red bits left over on the black
    body.classList.remove('composing', 'ready', 'is-denied', 'opened', 'kb', 'washed', 'await-tap'); html.classList.remove('composing', 'washed'); frozen = false; plan = null; kbUp = false;
    unlockScroll(unlockTo); unlockTo = undefined; paperY(); drawSeals();
    clock.wait(dur * 930).then(() => { bi.visible = true; bi.s = .5; bi.sv = 0; bi.wobble(1.4); });
    await s;
    html.classList.remove('draining'); syncBands();   // 14.10: the bars follow the front (compose-field edgeCover), there is nothing to wait for
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
    busy = true; bubble.hidden = true; pending = null; tapBubble = false; inky.tapping = false; denied = false; denyMsg = ''; rejects = hintAt = 0;
    const br = $('#cback .blot').getBoundingClientRect(), tx = br.left + br.width / 2, ty = br.top + br.height / 2;
    inky.hanko = false; inky.mode = 'stamp'; inky.dock = null; inky.setMood('worry');
    await inky.hopTo(tx, ty - 60, .4, 40); inky.s = -.35; await clock.wait(90);
    inky.floor = (ty + 8) / 4; inky.grounded = false; inky.vy = 330; inky.vx = 0;
    await new Promise(res => inky.onLand = () => { inky.onLand = null; res(); });
    sfx('backStamp');                               // round 15.1: he hits the back stamp: a light wooden thunk (the sad notes follow after the roll-up)
    anim($('#cback .blot'), [{ transform: 'scale(1.35,.62)' }, { transform: 'scale(1)' }], { stiffness: 520, damping: 14 }); shake(.45);
    inky.splat(7, 1.1); inky.setMood('sad');
    await clock.wait(160);
    const d0 = dock(); inky.hopTo(d0.x, d0.foot, .42, 22);
    await clock.wait(120);
    blurAll(); await rollUp();
    inky.mode = 'idle'; inky.setMood('sad'); say('…oh. okay.', 1000); sfx('sadNotes');   // backed out of the haiku: the sad bones
    await clock.wait(600);
    await inky.sadRunOff(-1, { pace: .7 });
    bubble.hidden = true;
    sfx('inkFloodOut', { dur: 1.3 });                // round 15.1: the opening flood, REVERSED: it all sucks back into board Inky (drainHome's 1.3 s iris)
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
    inky.tapping = false; rejects = hintAt = 0;
    inky.setMood('cheer'); inky.jump(1.2); inky.sparkle(16); say(name ? `signed, ${esc(name)}!` : 'sealing it!', 1200);
    await clock.wait(550);
    // Inky travels right across the scroll and presses the wax seal
    const pr = $('#cpost .wax').getBoundingClientRect(), tx = pr.left + pr.width / 2, ty = pr.top + pr.height / 2;
    inky.hanko = false; inky.mode = 'stamp'; inky.dock = null;
    await inky.hopTo(tx, ty - 66, .46, 46); inky.s = -.35; await clock.wait(120);
    inky.floor = (ty + 10) / 4; inky.grounded = false; inky.vy = 330; inky.vx = 0;
    await new Promise(res => inky.onLand = () => { inky.onLand = null; res(); });
    $('#cpost').classList.add('stamped'); sfx('stampSuccess');   // accepted: the triumphant stamp
    anim($('#cpost .wax'), [{ transform: 'scale(1.3,.7)' }, { transform: 'scale(1)' }], { stiffness: 520, damping: 14 }); shake(.5);
    inky.splat(6, 1); inky.setMood('cheer');
    await clock.wait(140);
    const d = dock(); inky.hopTo(d.x, d.foot, .5, 34).then(() => { inky.mode = 'coach'; inky.dock = dock; });
    say('sealed!', 900);
    await clock.wait(700);
    await rollUp();
    say('off it goes!', 800); await clock.wait(450);
    sfx('inkyFlyaway');                             // round 15.3: he flies off the page in triumph: a sparkly inky whoosh (timed to runOff: the crouch, then the 0.95 s whip out right)
    await inky.runOff(1);
    inky.mode = 'idle'; bubble.hidden = true;
    await installPost(post);
  }
  let denyN = 0, rejects = 0, hintAt = 0;          // rejections in a row this session (reset on a post or on leaving)
  async function deny(reason = '') {
    busy = true; denied = true; denyMsg = reason; bubble.hidden = true; inky.tapping = false; body.classList.add('is-denied');
    const a = update(); if (!reason) rejects++;
    const hint = reason ? null : stuckHint(rejects, hintAt, a); if (hint) hintAt = rejects;
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
    shake(1.4); sfx('stampFail');                  // the submit failed: the heavy stamp
    sfx('baka', { delay: 0.25 });                   // round 15.2: ...and red Inky, an old man disappointed in you: a sigh, 'BAAH-kah' (the sigh starts as the slam settles)
    // (no ink splat here: its droplets settled along the wrong line and read as a red error line)
    inky.hanko = false; inky.setMood('angry');
    await clock.wait(120);
    const d = dock(); inky.hopTo(d.x, d.foot, .55, 40).then(async () => {        // back in his corner: two little stomps
      for (const k of [.42, .32]) { await clock.wait(60); if (inky.mood !== 'angry') return; inky.jump(k); await new Promise(r => { const t0 = clock.now(); const w = () => inky.grounded || clock.now() - t0 > 600 ? r() : clock.wait(16).then(w); w(); }); inky.splat(2, .4); shake(.25); }
    });
    await clock.wait(700);
    const f = deny_.animate([{ opacity: 1, transform: `rotate(${rot}deg) scale(1)` }, { opacity: 0, transform: `rotate(${rot}deg) scale(1.08)` }], { duration: 520, easing: 'steps(6)', fill: 'forwards' });
    await clock.wait(540); f.cancel(); deny_.hidden = true;
    inky.mode = 'coach'; inky.dock = dock; busy = false; lastInput = clock.now();
    { const m = hint ? hint : reason ? 'hmm. change a word?' : 'try again!'; say(m, bubbleHold(m)); }
    clock.wait(1800).then(() => { if (inky.mood === 'angry' && !busy) inky.setMood('worry'); });
  }

  // ---------- the poem lands on the board: the black drains into Inky, the poem types in, its seal stamps on ----------
  async function installPost(post) {
    unlockTo = 0;                                           // newest is on top: be there before the black lifts
    homeInky = { x: innerWidth * .2, foot: innerHeight - 78 };
    sfx('inkWash');                                         // published: the whole bucket of ink washes away
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
    // round 15.10: board Inky's celebration starts the moment the new poem's number seal SETTLES (haiku:sealed, ~0.4 s after the stamp's
    // impact, as its approval tone resolves) rather than at `played` (which waits another 0.8 s for the ink bleed to clear)
    const sealed = new Promise(res => { const on = e => { if (e.detail?.id === post.id) { removeEventListener('haiku:sealed', on); res(); } }; addEventListener('haiku:sealed', on); clock.wait(15000).then(() => { removeEventListener('haiku:sealed', on); res(); }); });
    await Promise.race([sealed, (added?.played ?? Promise.resolve()), clock.wait(14000)]);
    if (deps.celebrate) deps.celebrate(post);
    else { deps.inky.setMood('cheer'); deps.inky.jump?.(1); clock.wait(800).then(() => deps.inky.setMood('happy')); }
    return added?.node;
  }

  $('#cpost').addEventListener('click', e => { e.preventDefault(); submit(); });
  $('#cpost').addEventListener('pointerdown', e => e.preventDefault());
  update();
  return {
    bugMeter,   /* round 15.1: red Inky's TapMeter (tests can raise splatAt to measure his speech without a splat) */
    open, cancel, submit, say: (t, hold) => say(t, hold), get inkBg() { return html.classList.contains('inkbg'); }, update, inputs, bubbleLog, poem: ta, nameIn, openName, focusLine, safeWidth: () => safeWidth(), inky, field, art, root,
    get opened() { return opened; }, get busy() { return busy; }, get denied() { return denied; }, get kbUp() { return kbUp; }, get ruleSpecs() { return ruleSpecs; },
    fill(lines, name) { if (denied) clearDenied(); ta.value = clampLines(lines.map(l => String(l).replace(/\n/g, ' ')).join('\n')); if (name != null) { nameIn.value = cleanName(name); fitName(); } update(); },
  };
}
