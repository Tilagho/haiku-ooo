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
const ROWS_OPEN = 72, ROWS_KB = 40, ROWS_KB_MAX = 46, IDLE_MS = 9000;
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
const FS_OPEN = DPR3 ? [48, 128 / 3, 40, 112 / 3, 32, 80 / 3, 64 / 3, 16] : [48, 40, 32, 24, 20, 16], FS_KB = DPR3 ? [32, 80 / 3, 64 / 3, 16] : [32, 24, 20, 16], FS_KB_SHORT = DPR3 ? [80 / 3, 64 / 3, 16] : [24, 20, 16];
const OVERHANG = 0;                                  // px a long line may run past its ruled guide (0: the torn edge nicks would eat it)
function fitSize(texts, avail, sizes = FS_OPEN) {     // the biggest size every line fits at (32 = 2x the pixel font)
  mctx ||= document.createElement('canvas').getContext('2d');
  for (const s of sizes) { mctx.font = `${s}px ChiKareGo2`; if (texts.every(t => mctx.measureText(t).width <= avail)) return s; }
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
        <div class="sign" id="csign"><label id="csignlab">sign</label><span class="nm"><span class="nmm" aria-hidden="true"></span><span class="nph" aria-hidden="true">(optional)</span><i class="rl" aria-hidden="true"></i><input id="cname" type="text" maxlength="12" disabled tabindex="-1" autocomplete="off" autocorrect="off" autocapitalize="words" spellcheck="false" inputmode="text" enterkeyhint="done" data-1p-ignore data-lpignore="true" data-form-type="other" placeholder="(optional)" aria-label="sign with your name, up to 12 characters, optional"><button class="nmb" id="cnamebtn" type="button" aria-label="sign with your name (optional)"></button></span></div>
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
  const inky = new RedInky({ R: 9, z: 60, bigEyes: true, fury: true });
  const art = new ScrollArt($('#scv'), { maxRows: 92, seed: 8370, outline: 2 });   // 8370: the torn edges stay shallow beside the three writing rows (more room for big type)
  const bubble = document.createElement('div'); bubble.className = 'cbubble'; bubble.hidden = true; root.appendChild(bubble);
  const bcv = document.createElement('canvas'); bcv.className = 'bcv';
  const deny_ = $('#cdeny');
  // preload both stamps so the first slam never shows a blank
  DENY_STAMPS.forEach(s => { const i = new Image(); i.src = s.src; });
  // the two corner stamps are twins: the same red wax seal (scroll-art drawWax, doubled to 22 px) with a cream glyph
  // and a dark-red emboss shadow: a curved return arrow (back, lower left) and a checkmark (post, lower right)
  // core icons (cream), stair-stepped; a 1 px crimson outline (the seal's rim colour) is grown round them, all centred
  const GLYPH = {
    back: ['..#.......', '.##.......', '#########.', '##########', '.##.....##', '..#.....##', '........##', '.......##.', '..#######.', '..######..'],
    check: ['.......###', '......###.', '##...###..', '###.###...', '.#####....', '..###.....', '...#......'],
  };
  const RIM = '#60140e', CREAM = '#fff4e0';
  function drawSeal(cv, kind) {
    const w = document.createElement('canvas'); drawWax(w, { ready: true, n: 11, seed: 9 });
    cv.width = cv.height = 22; const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(w, 0, 0, 22, 22);
    const g = GLYPH[kind], gw = g[0].length, gh = g.length, ox = Math.round((22 - gw) / 2), oy = Math.round((22 - gh) / 2);
    const on = (x, y) => g[y - oy]?.[x - ox] === '#';
    for (let y = 0; y < 22; y++) for (let x = 0; x < 22; x++) {
      if (on(x, y)) { ctx.fillStyle = CREAM; ctx.fillRect(x, y, 1, 1); continue; }
      let near = false; for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (on(x + dx, y + dy)) { near = true; break; }
      if (near) { ctx.fillStyle = RIM; ctx.fillRect(x, y, 1, 1); }
    }
  }
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
  const VV = window.visualViewport;
  let vvh = innerHeight, vvt = 0, kbUp = false;
  function syncViewport() {
    vvh = Math.round(VV ? VV.height : innerHeight); vvt = Math.round(VV ? VV.offsetTop : 0);
    html.style.setProperty('--vvh', vvh + 'px'); html.style.setProperty('--vvt', vvt + 'px');
    const was = kbUp; kbUp = body.classList.contains('composing') && vvh < innerHeight * .8; body.classList.toggle('kb', kbUp);
    if (was !== kbUp) { fitPaper(); update(); }
  }
  if (VV) { VV.addEventListener('resize', syncViewport); VV.addEventListener('scroll', syncViewport); }
  addEventListener('resize', syncViewport);
  // keyboard up: as many rows as the visible height allows (rods + offsets ~150 px), never fewer than 40
  const kbRows = () => Math.max(ROWS_KB, Math.min(ROWS_KB_MAX, Math.floor((vvh - 150) / SP)));
  const rowsNow = () => kbUp ? kbRows() : ROWS_OPEN;
  let busyScroll = false;
  function fitPaper() {
    $('#cpaper').style.setProperty('--ph', rowsNow() * SP + 'px');
    if ((opened || unrolling) && !busyScroll) art.setTarget(rowsNow(), { k: 260, c: 24 });   // the keyboard rolls the scroll up a little
  }

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
    const on = document.activeElement === ta && ta.selectionStart === ta.selectionEnd, { li, col } = caretAt();
    if (ta.scrollTop) ta.scrollTop = 0;
    const sx = ta.scrollLeft; linesEl.style.setProperty('--sx', -sx + 'px');
    mctx ||= document.createElement('canvas').getContext('2d');
    rows.forEach((r, k) => {
      const show = on && k === li; r.caret.hidden = !show; r.el.classList.toggle('focus', document.activeElement === ta && k === li);
      if (show) { mctx.font = `${rowFs[k]}px ChiKareGo2`; r.caret.style.left = Math.round(mctx.measureText(texts()[k].slice(0, col)).width - sx) + 'px'; r.caret.style.animation = 'none'; void r.caret.offsetWidth; r.caret.style.animation = ''; }
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
    let col = t.length; for (let c = 0; c < t.length; c++) { const w0 = mctx.measureText(t.slice(0, c)).width, w1 = mctx.measureText(t.slice(0, c + 1)).width; if (x < (w0 + w1) / 2) { col = c; break; } }
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
      for (const sz of sizes) { mctx.font = `${sz}px ChiKareGo2`; if (mctx.measureText(t).width <= avail) return sz; }
      return sizes[sizes.length - 1];
    });
  }
  const safeWidth = () => rows[0].wr.clientWidth;
  function render(a, ok) {
    const sizes = kbUp ? (kbRows() >= 44 ? FS_KB : FS_KB_SHORT) : FS_OPEN;
    measureAsc();
    rowFs = pickSize(a.map((l, i) => l.text || PH[i]), sizes); fsMax = sizes[0]; fsNow = Math.min(...rowFs);
    linesEl.style.setProperty('--fsm', fsMax + 'px'); linesEl.style.setProperty('--fs', fsNow + 'px'); linesEl.style.setProperty('--asc', ASC);
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
    else if (over >= 0) { inky.setMood('worry'); inky.wobble(.6); }          // no words: the red numerals show the over-count
    else if (hit >= 0) { inky.setMood('cheer'); inky.jump(.95); inky.sparkle(10); say(`line ${hit + 1}: ${NAMES[hit]}! nice`, 1600); clock.wait(1000).then(() => !busy && inky.mood === 'cheer' && !allOk && inky.setMood('happy')); }
    else if (states.includes('over')) { if (inky.mood !== 'worry') inky.setMood('worry'); }
    else if (inky.mood === 'worry' || inky.mood === 'bored') inky.setMood('happy');
    lastStates = states;
  }
  // typing: Return = next line (never a 4th), paste splits into at most 3 lines, Backspace at a line start joins lines
  let kdEnter = false;
  function enter() {
    const { li } = caretAt();
    if (li < MAXL - 1) focusLine(li + 1); else submit();      // line 3: exactly like pressing the checkmark seal
  }
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); kdEnter = true; setTimeout(() => kdEnter = false, 0); enter(); } });
  ta.addEventListener('beforeinput', e => {
    if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') { e.preventDefault(); if (!kdEnter) enter(); }
  });
  ta.addEventListener('input', () => {
    const v = ta.value, c = clampLines(v);
    if (c !== v) { const pos = ta.selectionStart; ta.value = c; setCaret(Math.min(pos, c.length)); }
    if (denied) clearDenied(); poke(); update();
  });
  ta.addEventListener('paste', e => {
    const raw = e.clipboardData?.getData('text'); if (raw == null) return;
    e.preventDefault();
    let t = raw.replace(/\r\n?/g, '\n');
    t = t.includes('\n') ? t.split('\n').map(s => s.trim()).filter(Boolean).join('\n') : t.includes(' / ') ? t.split(' / ').map(s => s.trim()).join('\n') : t;
    const s0 = ta.selectionStart, s1 = ta.selectionEnd, v = clampLines(ta.value.slice(0, s0) + t + ta.value.slice(s1));
    ta.value = v; setCaret(Math.min(v.length, clampLines(ta.value.slice(0, s0) + t).length));
    if (denied) clearDenied(); poke(); update();
  });
  ta.addEventListener('focus', () => { syncCaret(); poke(); });
  ta.addEventListener('blur', () => { rows.forEach(r => { r.caret.hidden = true; r.el.classList.remove('focus'); }); });
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
  $('#csignlab').addEventListener('click', openName);
  nameIn.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== nameIn) closeName(); }, 0));
  nameIn.addEventListener('input', () => { const c = cleanName(nameIn.value); if (c !== nameIn.value) nameIn.value = c; fitName(); poke(); });
  function fitName() {                          // mirror the typed name in label ink; shrink (never below 16px: no iOS focus zoom) only if it must
    const nm = nameNm, mm = nm.querySelector('.nmm'), v = nameIn.value;
    mm.textContent = v; nm.classList.toggle('has', !!v); nm.style.removeProperty('--nfs');
    if (!v) return;
    const room = nm.clientWidth - 2; let fs = 20;
    while (fs > 16 && mm.scrollWidth > room) { fs -= 1; nm.style.setProperty('--nfs', fs + 'px'); }
  }
  addEventListener('resize', () => requestAnimationFrame(() => { fitName(); layoutField(); syncCaret(); }));
  document.fonts?.ready.then(() => { layoutField(); syncCaret(); });
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });

  // ---------- keyboard auto-open: iOS only raises it for focus() inside a tap, so the write tap focuses a 1px primer
  // field right away; when the scroll has unrolled, focus moves to line 1 (a focus hand-off keeps the keyboard up) ----------
  const coarse = matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
  let primer = null, primerT = 0;
  function prime() {
    if (!coarse || opened || busy || body.classList.contains('composing')) return;
    primer ||= Object.assign(document.createElement('input'), { type: 'text', tabIndex: -1, autocomplete: 'off', className: 'kb-primer' });
    for (const [k, v] of Object.entries({ 'aria-hidden': 'true', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', inputmode: 'text', enterkeyhint: 'next', 'data-1p-ignore': '', 'data-lpignore': 'true' })) primer.setAttribute(k, v);
    root.appendChild(primer); primer.focus({ preventScroll: true });
    clearTimeout(primerT); primerT = setTimeout(() => { if (!body.classList.contains('composing')) dropPrimer(); }, 2500);
  }
  function dropPrimer() { clearTimeout(primerT); if (primer?.isConnected) { if (document.activeElement === primer) primer.blur(); primer.remove(); } }
  deps.fab?.addEventListener('click', prime, true);   // capture: runs inside the same tap, before app.js starts the roll-up
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
  function blurAll() { dropPrimer(); document.activeElement?.blur?.(); }
  const fabAnim = (k, o) => { try { return deps.fab?.animate(k, o); } catch { return null; } };

  // ---------- OPEN: board Inky dives in -> black flood -> scroll unrolls -> red Inky swings in from the right ----------
  let homeInky = null;
  async function open() {
    if (opened || body.classList.contains('composing')) return;
    body.classList.add('composing'); html.classList.add('composing'); busy = true; rejects = hintAt = 0; denied = false; denyMsg = ''; body.classList.remove('is-denied');
    if (theme) theme.content = '#1a181c';
    syncViewport();
    ta.value = ''; ta.scrollLeft = 0; nameIn.value = ''; if (document.activeElement !== nameIn) closeName(); fitName(); $('#cpost').classList.remove('stamped');
    lastStates = ['empty', 'empty', 'empty']; idleN = 0; update(); fitPaper();
    const fab = deps.fab?.getBoundingClientRect() ?? { left: innerWidth / 2, width: 0, top: innerHeight - 60 }, fx = fab.left + fab.width / 2;
    const bi = deps.inky; homeInky = { x: bi.pos.x, foot: bi.floorCss?.() ?? bi.pos.foot };   // his float line, even if he was mid-throw bi.setMood('cheer'); bi.mode = 'still';
    deps.hideBoardBubble?.();
    await bi.hopTo(fx, fab.top + 8, .26, 12);
    bi.visible = false;
    const fl = field.flood(fx, { speed: 1.8 });
    fabAnim([{ transform: 'translateX(-50%) scale(1)' }, { transform: 'translateX(-50%) scale(1.25,.7)', offset: .3 }, { transform: 'translateX(-50%) translateY(140px) scale(.8,1.2)' }], { duration: 360, easing: 'ease-in', fill: 'forwards' });
    await fl;
    await unroll();
    busy = false; opened = true; body.classList.add('opened'); lastInput = clock.now(); syncViewport(); fitPaper(); update();
    focusLine(0, 0); dropPrimer();               // focus hand-off: primer (focused during the tap) -> line 1, the keyboard stays up
  }
  async function unroll() {
    const sc = $('#cscroll'); sc.hidden = false; art.jump(0);
    anim(sc, [{ transform: 'translateX(-50%) translateY(-140px) scale(.92,1.1)' }, { transform: 'translateX(-50%) translateY(0) scale(1)' }], { stiffness: 340, damping: 17 });
    await clock.wait(240);
    busyScroll = true; unrolling = true;
    const done = art.setTarget(rowsNow(), { k: 95, c: 11 });
    await clock.wait(380);
    const d = dock(); inky.visible = true; inky.setMood('cheer'); inky.look = -1;
    await inky.whip([[innerWidth + 90, vvt + vvh * .56], [innerWidth * .62, vvt + vvh * .74], [innerWidth * .36, vvt + vvh * .9], [innerWidth * .48, vvt + vvh * .8], [innerWidth * .26, vvt + vvh * .76], [d.x, d.foot]], .95, { splash: 10 });
    await done; busyScroll = false;
    fitPaper(); unrolling = false;                 // the keyboard may have risen mid-unroll: settle to the compact height
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
    busy = true; bubble.hidden = true; inky.tapping = false; denied = false; denyMsg = ''; rejects = hintAt = 0;
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
    inky.tapping = false; rejects = hintAt = 0;
    inky.setMood('cheer'); inky.jump(1.2); inky.sparkle(16); say(name ? `signed, ${esc(name)}!` : 'sealing it!', 1200);
    await clock.wait(550);
    // Inky travels right across the scroll and presses the wax seal
    const pr = $('#cpost .wax').getBoundingClientRect(), tx = pr.left + pr.width / 2, ty = pr.top + pr.height / 2;
    inky.hanko = false; inky.mode = 'stamp'; inky.dock = null;
    await inky.hopTo(tx, ty - 66, .46, 46); inky.s = -.35; await clock.wait(120);
    inky.floor = (ty + 10) / 4; inky.grounded = false; inky.vy = 330; inky.vx = 0;
    await new Promise(res => inky.onLand = () => { inky.onLand = null; res(); });
    $('#cpost').classList.add('stamped');
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
    shake(1.4);
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
    say(hint ? hint : reason ? 'hmm. change a word?' : 'try again!', hint ? 2600 : 1800);
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
    open, cancel, submit, update, inputs, poem: ta, nameIn, openName, focusLine, safeWidth: () => safeWidth(), inky, field, art, root,
    get opened() { return opened; }, get busy() { return busy; }, get denied() { return denied; }, get kbUp() { return kbUp; }, get ruleSpecs() { return ruleSpecs; },
    fill(lines, name) { if (denied) clearDenied(); ta.value = clampLines(lines.map(l => String(l).replace(/\n/g, ' ')).join('\n')); if (name != null) { nameIn.value = cleanName(name); fitName(); } update(); },
  };
}
