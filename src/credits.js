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
export const CC_BY_LINE = 'type: ChiKareGo2 & FindersKeepers by Giles Booth (CC BY)';   // the old footer text, verbatim
export const COPYRIGHT = '© 2026 Tiago Ramirez all rights reserved';
export const CREDITS = [
  { h: 'made by', p: ['Made by Tiago Ramirez', 'haiku.ooo', COPYRIGHT] },
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
  ov.innerHTML = `<div class="cr-stage"><div class="cr-scroll"><canvas class="cr-art"></canvas><div class="cr-paper"><div class="cr-in"><h2 class="cr-title">credits</h2><div class="cr-list"></div><p class="cr-close"></p></div></div></div><canvas class="cr-poof"></canvas></div>`;
  document.body.appendChild(ov);
  const $ = s => ov.querySelector(s), stage = $('.cr-stage'), scr = $('.cr-scroll'), paper = $('.cr-paper'), inner = $('.cr-in'), list = $('.cr-list'), poof = $('.cr-poof');
  $('.cr-close').textContent = CLOSE_LINE;
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  list.innerHTML = CREDITS.map(s => `<section><h3>${esc(s.h)}</h3>${s.p.map(t => `<p>${esc(t)}</p>`).join('')}</section>`).join('');
  let art = null, state = 'closed', lockY = null, rows = 0, dim = 0, openedAt = 0;   // closed | opening | open | closing
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
    if (!art) art = new ScrollArt($('.cr-art'), { maxRows: rr, seed: 4410, outline: 2, ribbon: false }); else if (rr !== art.maxRows) { art.maxRows = rr; art.resize(); }
    rows = rr; const W = art.cssWidth, H = art.H * SP;
    Object.assign(scr.style, { width: W + 'px', height: (2 + RH * 2 + rr + 8) * SP + 'px' });
    stage.style.top = Math.max(8, Math.round((innerHeight - (2 + RH * 2 + rr + 8) * SP) / 2)) + 'px';
    Object.assign(paper.style, { left: (art.px0 + 6) * SP + 'px', width: (art.px1 - art.px0 - 11) * SP + 'px', top: (2 + RH) * SP + 'px' });
    inner.style.height = rr * SP - 12 + 'px';
  };
  const setDim = v => { dim = v; ov.style.setProperty('--dim', v.toFixed(2)); };
  const tween = (from, to, ms, fn) => new Promise(res => { let t = 0; const off = clk.onTick(dt => { t += dt * 1000; const q = Math.min(1, t / ms); fn(from + (to - from) * q); if (q >= 1) { off(); res(); } }); });
  clk.onTick(() => { if (state !== 'closed') paper.style.height = Math.max(0, art.openCss - 6) + 'px'; });   // the DOM paper clip follows the canvas paper (same as the write scroll)

  async function open() {
    if (state !== 'closed' || body.classList.contains('composing')) return false;
    state = 'opening'; lock(); layout(); ov.hidden = false; list.scrollTop = 0; poof.style.display = 'none'; $('.cr-art').style.visibility = '';
    openedAt = clk.now(); btn.setAttribute('aria-expanded', 'true');
    if (reduced) { setDim(1); art.jump(rows); paper.style.height = Math.max(0, art.openCss - 6) + 'px'; state = 'open'; return true; }
    art.jump(0); paper.style.height = '0px'; setDim(0);
    tween(0, 1, 220, setDim); await art.setTarget(rows, { k: 95, c: 11 });
    if (state === 'opening') state = 'open'; return true;
  }
  async function close() {
    if (state !== 'open' && !(state === 'opening' && clk.now() - openedAt > 400)) return false;
    state = 'closing'; btn.setAttribute('aria-expanded', 'false');
    if (reduced) { done(); return true; }
    await art.setTarget(0, { mode: 'roll' });
    if (state !== 'closing') return false;
    await puff(); done(); return true;
  }
  function puff() {   // the scroll vanishes in a grayscale pixel poof (art px = 3 css px, the board's grid)
    const W = Math.ceil(scr.clientWidth / 3), Hh = 40; poof.width = W; poof.height = Hh;
    const ctop = (2 + RH) * SP / 3 - 2; Object.assign(poof.style, { display: 'block', width: W * 3 + 'px', height: Hh * 3 + 'px', left: scr.offsetLeft + 'px', top: scr.offsetTop + (2 + RH) * SP - 4 * 3 - 18 + 'px' });
    $('.cr-art').style.visibility = 'hidden'; const g = poof.getContext('2d'), im = g.createImageData(W, Hh);
    return tween(0, 1, POOF_T * 1000, q => { im.data.fill(0); for (const f of [.2, .5, .8]) drawPoofInto(im.data, W, Hh, Math.round(W * f), 22, q); g.putImageData(im, 0, 0); setDim(1 - q); });
  }
  function done() { state = 'closed'; ov.hidden = true; poof.style.display = 'none'; setDim(0); unlock(); }

  btn.addEventListener('click', e => { e.preventDefault(); open(); });
  ov.addEventListener('click', e => { e.preventDefault(); close(); });   // a tap ANYWHERE; a drag of the list never makes a click
  addEventListener('keydown', e => { if (state !== 'closed' && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); close(); } });
  return api;
}
