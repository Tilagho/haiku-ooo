// Round 14.5: the © line + the credits scroll.
//
// A small '© 2026 Tiago Ramirez all rights reserved' line sits under the noren curtains (above the Japanese name) in the pixel UI
// face, sumi grey, with a tappable 'credits' label (round 14.6: just the word, no icon). Tapping credits
// unrolls a SECOND copy of the write scroll (src/scroll-art.js: the same sprite, 6 px pixel grid, spring unroll) over a dimmed,
// locked board and lists EVERY credit (the CC BY type credit, formerly the page footer, lives ONLY here now). The list scrolls
// inside the paper if it is longer than the scroll; the last line reads 'tap anywhere to close'. A tap anywhere (not a drag of the
// list) rolls the scroll back up, which vanishes in a small grayscale pixel poof (the 14.3 egg poof look), and the board is exactly
// as it was (scroll position restored; nothing under the dim moves or is touched). Reduced motion: it simply appears / disappears.
import { ScrollArt, SP, RH } from './scroll-art.js';
import { clock } from './clock.js';

// ---- every credit found in the repo (index.html footer, src/style.css + src/brush-font.js headers, README 'Round 4 credits',
// src/cmu-data.js + src/kanji-glyphs.js headers, tools/fonts/misaki-LICENSE-ja.txt). Nothing here is invented. ----
import { sfx } from './sfx.js';   // round 15.0 sound events
export const CC_BY_LINE = 'type: ChiKareGo2 & FindersKeepers by Giles Booth (CC BY)';   // the old footer text, verbatim
export const COPYRIGHT = '© 2026 Tiago Ramirez All Rights Reserved'   // the board header line (round 14.7b: Title Case, one run with the 'Credits' label);
export const CREDIT_COPY = '© 2026 all rights reserved';   // round 14.7: the scroll says it once ('Made by Tiago Ramirez'); the name is not repeated in a second authorship line
export const CREDITS = [
  { h: 'haiku.ooo', p: ['Made by Tiago Ramirez', CREDIT_COPY] },
  { h: 'type (CC BY)', p: [
    CC_BY_LINE,
    'ChiKareGo2 (a Chicago homage) and FindersKeepers (a Geneva 9 homage), by Giles Booth, from the BitFontMaker2 gallery (pentacom.jp). Homages to Susan Kare\'s 1984 Macintosh Chicago and Geneva 9.',
    'Licence: Creative Commons Attribution (CC BY), attribution required: creativecommons.org/licenses/by/'] },
  { h: 'kanji numerals', p: [
    'Misaki Gothic 8x8 bitmap font by Num Kadoma (Copyright 2002-2021), littlelimit.net.'] },
  { h: 'Japanese title', p: ['DotGothic16, SIL Open Font License 1.1, via Google Fonts.'] },
  { h: 'syllable data', p: ['CMU Pronouncing Dictionary (cmusphinx/cmudict), BSD-style license.'] },
];
export const CLOSE_LINE = 'tap anywhere to close';

// the egg's poof (src/noren.js drawPoof) at three spots along the closed scroll: chunky grayscale puffs, a flash, a few dark flecks
const PAL = { W: [250, 246, 236], g: [214, 208, 196], G: [150, 144, 150], D: [92, 88, 98], K: [26, 24, 28] };
export const POOF_T = .5;
// round 15.1: the credits fade. A mask image one Bayer period wide (4 cells) and as tall as the list: a cell is opaque (text shows) while the
// fade's visibility there beats its threshold in the 4x4 ordered-dither matrix. st / sb: 0..1 strength of the top / bottom fade.
export const FADE = 44, CELL = 2, BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export function ditherCells(h, st, sb) {   // -> rows (cell rows) of 4 booleans (true = text visible); pure, for tests
  const R = Math.ceil(h / CELL), out = [];
  for (let r = 0; r < R; r++) {
    const yc = r * CELL + CELL / 2, vt = 1 - st * (1 - Math.min(1, yc / FADE)), vb = 1 - sb * (1 - Math.min(1, (h - yc) / FADE)), v = Math.min(vt, vb);
    out.push([0, 1, 2, 3].map(c => v * 16 > BAYER4[(r % 4) * 4 + c] + 0.5));
  }
  return out;
}
function ditherMask(h, st, sb, dpr) {
  const rows = ditherCells(h, st, sb), cv = document.createElement('canvas'), k = CELL * dpr; cv.width = 4 * k; cv.height = Math.round(h * dpr);
  const g = cv.getContext('2d'); g.fillStyle = '#000';
  rows.forEach((row, r) => row.forEach((on, c) => { if (on) g.fillRect(c * k, r * k, k, k); }));
  return cv.toDataURL('image/png');
}
export function drawPoofInto(D, w, h, cx, cy, q) {
  const put = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= w || y >= h) return; const i = (y * w + x) * 4; D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; D[i + 3] = 255; };
  const r = 1.5 + 8 * (1 - (1 - q) ** 2), col = [PAL.W, PAL.g, PAL.G, PAL.D][Math.min(3, Math.floor(q * 4))], sz = q < .55 ? 2 : 1;
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4 + .2, px = Math.round(cx + Math.cos(a) * r), py = Math.round(cy - 4 + Math.sin(a) * r * .8);
    if (q > .7 && (k + Math.floor(q * 10)) % 2) continue;
    for (let j = 0; j < sz; j++) for (let i = 0; i < sz; i++) put(px + i, py + j, col);
  }
  if (q < .3) for (const [i, j] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) put(Math.round(cx) + i, Math.round(cy) - 4 + j, PAL.W);
  if (q > .15 && q < .6) { put(cx, cy - 4 - r * .5, PAL.K); put(cx - r * .6, cy - 3, PAL.D); put(cx + r * .6, cy - 3, PAL.D); }
}

export function mountCredits({ clock: clk = clock, reduced = false, root = document } = {}) {
  const body = document.body, html = document.documentElement;
  const btn = root.querySelector('#credits-btn'); if (!btn) return null;
  const ov = document.createElement('div'); ov.id = 'credits'; ov.hidden = true; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'credits');
  ov.innerHTML = `<div class="cr-stage"><div class="cr-scroll"><canvas class="cr-art"></canvas><div class="cr-win"><canvas class="cr-deco"></canvas></div><div class="cr-paper"><div class="cr-in"><h2 class="cr-title">credits</h2><div class="cr-list"></div><p class="cr-close"></p></div></div></div><canvas class="cr-poof"></canvas></div>`;
  document.body.appendChild(ov);
  const $ = s => ov.querySelector(s), stage = $('.cr-stage'), scr = $('.cr-scroll'), win = $('.cr-win'), deco = $('.cr-deco'), paper = $('.cr-paper'), inner = $('.cr-in'), list = $('.cr-list'), poof = $('.cr-poof');
  $('.cr-close').textContent = CLOSE_LINE;
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  list.innerHTML = CREDITS.map(s => `<section><h3>${esc(s.h)}</h3>${s.p.map(t => `<p>${esc(t)}</p>`).join('')}</section>`).join('');
  let art = null, strip = null, state = 'closed', lockY = null, rows = 0, dim = 0, openedAt = 0;   // closed | opening | open | closing
  const api = { get state() { return state; }, get rows() { return rows; }, open, close, el: ov, btn, get art() { return art; } };

  const lock = () => { if (lockY != null) return; lockY = scrollY; html.classList.add('scroll-lock'); Object.assign(body.style, { position: 'fixed', top: -lockY + 'px', left: '0', right: '0', width: '100%' }); body.classList.add('credits-open'); };
  const unlock = () => {
    if (lockY == null) return; const y = lockY; lockY = null; Object.assign(body.style, { position: '', top: '', left: '', right: '', width: '' }); body.classList.remove('credits-open');
    scrollTo({ top: y, left: 0, behavior: 'instant' });
    setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => html.classList.remove('scroll-lock'))), 60);   // the restore is not a swipe (no gust, no Inky hop)
  };
  document.addEventListener('touchmove', e => { if (state === 'closed') return; if (e.target?.closest?.('.cr-list') && list.scrollHeight > list.clientHeight + 1) return; if (e.cancelable) e.preventDefault(); }, { passive: false });   // the board under the dim never moves

  const layout = () => {   // the scroll as tall as the screen allows (rows of paper), centred
    const avail = innerHeight - 28, rr = Math.max(34, Math.min(80, Math.floor((avail - (2 + RH * 2 + 8) * SP) / SP)));
    if (!art) art = new ScrollArt($('.cr-art'), { maxRows: rr, seed: 4410, outline: 2, ribbon: false, bare: true }); else if (rr !== art.maxRows) { art.maxRows = rr; art.resize(); }
    rows = rr; const W = art.cssWidth, H = art.H * SP;
    Object.assign(scr.style, { width: W + 'px', height: (2 + RH * 2 + rr + 8) * SP + 'px' });
    stage.style.top = Math.max(8, Math.round((innerHeight - (2 + RH * 2 + rr + 8) * SP) / 2)) + 'px';
    Object.assign(paper.style, { left: (art.px0 + 6) * SP + 'px', width: (art.px1 - art.px0 - 11) * SP + 'px', top: (2 + RH) * SP + 'px' });
    inner.style.height = rr * SP - 12 + 'px';
    // round 14.9: the paper's own texture, stains and torn side edges ride along with the text. A tall strip of paper (as long as the window plus the
    // list's scroll range, so it covers the whole travel at any list length: no tile, no seam, no repeat) sits in a clip window under the text; the list's
    // scroll moves it by exactly scrollTop. The two rolls and the two lines where the paper meets them stay pinned.
    Object.assign(win.style, { left: '0px', width: W + 'px', top: (3 + RH) * SP + 'px' });
    if (!ov.hidden) fitDeco();
  };
  const fitDeco = () => {            // (needs the list laid out: called once the overlay is shown)
    const range = Math.max(0, list.scrollHeight - list.clientHeight), N = Math.min(1200, Math.ceil((rows * SP - 12 + range) / SP) + 3);
    if (!strip || strip.maxRows !== N || strip.W !== art.W) { if (!strip) strip = new ScrollArt(deco, { maxRows: N, seed: 4410, outline: 2, ribbon: false, strip: true }); else { strip.maxRows = N; strip.resize(); } }
    deco.style.top = '0px'; syncDeco();
  };
  const syncDeco = () => { deco.style.transform = `translate3d(0, ${-list.scrollTop}px, 0)`; fade(); };
  list.addEventListener('scroll', syncDeco, { passive: true });
  // round 15.1: the text dissolves into the paper at the top (under 'credits') and the bottom (above 'tap anywhere to close') through an ordered
  // (Bayer 4x4) dither in chunky 2 px cells (the list font's own pixel) instead of a hard cut mid-line. It is a mask on the list box, so it stays put while the text scrolls
  // through it; each side eases in over the first FADE px of scroll and is absent where there is nothing more to scroll on that side.
  const masks = new Map(); let maskKey = '';
  const fade = () => {
    const h = list.offsetHeight, range = Math.max(0, list.scrollHeight - list.clientHeight);
    if (!h || range < 2) { if (maskKey) { list.style.webkitMaskImage = list.style.maskImage = ''; maskKey = ''; } return; }
    const lv = d => Math.round(4 * Math.min(1, Math.max(0, d) / FADE)), tl = lv(list.scrollTop), bl = lv(range - list.scrollTop), dpr = Math.min(3, Math.round(devicePixelRatio || 1) || 1), key = `${tl},${bl},${h},${dpr}`;
    if (key === maskKey) return; maskKey = key;
    let url = masks.get(key); if (!url) { if (masks.size > 40) masks.clear(); url = ditherMask(h, tl / 4, bl / 4, dpr); masks.set(key, url); }
    list.style.webkitMaskImage = list.style.maskImage = `url(${url})`;
    list.style.webkitMaskSize = list.style.maskSize = `${4 * CELL}px ${h}px`;
    list.style.webkitMaskRepeat = list.style.maskRepeat = 'repeat-x';
  };
  api.fadeState = () => ({ key: maskKey });
  const setDim = v => { dim = v; ov.style.setProperty('--dim', v.toFixed(2)); };
  const tween = (from, to, ms, fn) => new Promise(res => { let t = 0; const off = clk.onTick(dt => { t += dt * 1000; const q = Math.min(1, t / ms); fn(from + (to - from) * q); if (q >= 1) { off(); res(); } }); });
  clk.onTick(() => { if (state !== 'closed') { paper.style.height = Math.max(0, art.openCss - 6) + 'px'; win.style.height = Math.max(0, art.openCss - 12) + 'px'; } });   // the DOM paper clip follows the canvas paper (same as the write scroll)

  async function open() {
    if (state !== 'closed' || body.classList.contains('composing')) return false;
    state = 'opening'; lock(); layout(); ov.hidden = false; list.scrollTop = 0; fitDeco(); poof.style.display = 'none'; $('.cr-art').style.visibility = ''; win.style.visibility = '';
    openedAt = clk.now(); btn.setAttribute('aria-expanded', 'true');
    if (reduced) { sfx('scrollOpen'); setDim(1); art.jump(rows); paper.style.height = Math.max(0, art.openCss - 6) + 'px'; win.style.height = Math.max(0, art.openCss - 12) + 'px'; state = 'open'; return true; }
    art.jump(0); paper.style.height = '0px'; win.style.height = '0px'; setDim(0);
    tween(0, 1, 220, setDim); sfx('scrollOpen'); await art.setTarget(rows, { k: 95, c: 11 });
    if (state === 'opening') state = 'open'; return true;
  }
  async function close() {
    if (state !== 'open' && !(state === 'opening' && clk.now() - openedAt > 400)) return false;
    state = 'closing'; btn.setAttribute('aria-expanded', 'false');
    if (reduced) { sfx('poof'); done(); return true; }
    sfx('scrollClose'); await art.setTarget(0, { mode: 'roll' });
    if (state !== 'closing') return false;
    sfx('poof'); await puff(); done(); return true;   // the exit poof (the same one as the egg's)
  }
  function puff() {   // the scroll vanishes in a grayscale pixel poof (art px = 3 css px, the board's grid)
    const W = Math.ceil(scr.clientWidth / 3), Hh = 40; poof.width = W; poof.height = Hh;
    const ctop = (2 + RH) * SP / 3 - 2; Object.assign(poof.style, { display: 'block', width: W * 3 + 'px', height: Hh * 3 + 'px', left: scr.offsetLeft + 'px', top: scr.offsetTop + (2 + RH) * SP - 4 * 3 - 18 + 'px' });
    $('.cr-art').style.visibility = 'hidden'; win.style.visibility = 'hidden'; const g = poof.getContext('2d'), im = g.createImageData(W, Hh);
    return tween(0, 1, POOF_T * 1000, q => { im.data.fill(0); for (const f of [.2, .5, .8]) drawPoofInto(im.data, W, Hh, Math.round(W * f), 22, q); g.putImageData(im, 0, 0); setDim(1 - q); });
  }
  function done() { state = 'closed'; ov.hidden = true; poof.style.display = 'none'; setDim(0); unlock(); }

  btn.addEventListener('click', e => { e.preventDefault(); open(); });
  ov.addEventListener('click', e => { e.preventDefault(); close(); });   // a tap ANYWHERE; a drag of the list never makes a click
  addEventListener('keydown', e => { if (state !== 'closed' && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); close(); } });
  return api;
}
