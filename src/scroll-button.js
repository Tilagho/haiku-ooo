// The "write a haiku" button: a chunky pixel-art parchment scroll (rolled ends left and right, a thick 2 px dark
// outline, a few nicks in the edge) drawn into a small canvas, shown nearest-neighbour at 2 CSS px per art px.
// Idle: WIND. The paper ripples like cloth in a breeze: every paper column is displaced up or down by a travelling
// wave (pixel-stepped, 0 at the rigid rolls, strongest mid-sheet) with dithered shading on the slopes, plus an
// occasional gust. On tap the scroll ROLLS UP: both rolls travel inward, winding the paper up symmetrically,
// and meet in the middle with a little springy bump. Everything runs on the shared clock so captures are deterministic.
import { drawLine, measure, font, rng } from './brush-text.js';
import { clock } from './clock.js';

const OUT = [26, 24, 28], PAPER = [246, 229, 196], PAPER_HI = [252, 241, 218], PAPER_LO = [226, 199, 160], PAPER_SH = [214, 186, 146],
  TAN = [214, 176, 136], TAN_LO = [176, 134, 98], TAN_HI = [240, 214, 178], RED = [214, 52, 40], CREAM = [248, 240, 222], INK = [36, 30, 34];
export const SCALE = 2;                 // CSS px per art px
export const OUTLINE = 2;               // outline thickness in art px (doubled in round 10)
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + .5) / 16);
const RW = 10;                          // roll width incl. its 2 px outline on each side
const OV = 3;                           // how far the paper tucks under each roll

const bmp = (w, h) => ({ w, h, d: new Uint8ClampedArray(w * h * 4) });
const putB = (b, x, y, c, a = 255) => { if (x < 0 || y < 0 || x >= b.w || y >= b.h) return; b.d.set([c[0], c[1], c[2], a], (y * b.w + x) * 4); };

export function drawScrollButton(label = 'write a haiku') {
  const F = font('main'), tw = measure(label, F), th = F.ascent + F.descent;
  const PADX = 10, ACC = 9;
  const PW = tw + PADX * 2 + ACC + OV * 2, PH = th + 11;          // the paper sheet (its ends tuck under the rolls)
  const paper = bmp(PW, PH), text = new Uint8Array(PW * PH), isPaper = new Uint8Array(PW * PH);
  const P = (x, y, c, a) => putB(paper, x, y, c, a), rect = (x, y, w, h, c) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) P(i, j, c); };
  const R = rng(575);
  rect(0, 0, PW, PH, OUT); rect(0, OUTLINE, PW, PH - 2 * OUTLINE, PAPER);
  for (let j = OUTLINE; j < PH - OUTLINE; j++) for (let i = 0; i < PW; i++) isPaper[j * PW + i] = 1;
  rect(0, PH - OUTLINE - 2, PW, 2, PAPER_LO); for (let i = 0; i < PW; i += 2) P(i, PH - OUTLINE - 3, PAPER_LO);   // worn lower band
  rect(2, OUTLINE, PW - 4, 1, PAPER_HI);
  for (let j = OUTLINE + 1; j < PH - OUTLINE - 2; j++) for (let k = 0; k < 4; k++) {                          // dithered tan by the rolls
    const p = (4 - k) / 6; if (R() < p) P(OV + k, j, PAPER_LO); if (R() < p) P(PW - 1 - OV - k, j, PAPER_LO);
  }
  for (let k = 0; k < 10; k++) P(OV + 6 + Math.floor(R() * (PW - 2 * OV - 12)), OUTLINE + 2 + Math.floor(R() * (PH - 8)), PAPER_LO);   // age specks
  // nicks: little bites out of the top and bottom edges (the thick outline steps in)
  const nick = (x, top) => {
    for (let k = 0; k < OUTLINE; k++) { const y = top ? k : PH - 1 - k; P(x, y, [0, 0, 0], 0); P(x + 1, y, [0, 0, 0], 0); }
    for (let k = 0; k < OUTLINE; k++) { const y = top ? OUTLINE + k : PH - 1 - OUTLINE - k; P(x, y, OUT); P(x + 1, y, OUT); isPaper[y * PW + x] = isPaper[y * PW + x + 1] = 0; }
  };
  nick(Math.round(PW * .72), true); nick(Math.round(PW * .46), false); nick(Math.round(PW * .2), false);
  // the words in ChiKareGo2
  const tb = { w: PW, h: PH, data: new Uint8ClampedArray(PW * PH * 4) }, tx = OV + PADX, ty = Math.floor((PH - th) / 2) - 1;
  drawLine(tb, label, tx, ty, F, () => .99, { color: INK });
  for (let i = 0; i < PW * PH; i++) if (tb.data[i * 4 + 3]) { text[i] = 1; paper.d.set([...INK, 255], i * 4); }
  // a small red hanko accent at the end of the words
  const ax = tx + tw + 3, ay = Math.floor((PH - 7) / 2);
  rect(ax, ay, 7, 7, RED); P(ax, ay, PAPER); P(ax + 6, ay, PAPER); P(ax, ay + 6, PAPER); P(ax + 6, ay + 6, PAPER);
  for (const [i, j] of [[2, 2], [3, 2], [4, 2], [3, 3], [2, 4], [4, 4], [3, 4]]) P(ax + i, ay + j, CREAM);
  P(ax + 5, ay + 1, [234, 120, 100]);

  // one rolled end: thick outline, rounded caps, shaded tan with a highlight stripe, spiral ends top and bottom
  const RH = PH + 8, roll = bmp(RW, RH);
  const cols = [OUT, OUT, TAN_HI, TAN_HI, TAN, TAN, TAN_LO, TAN_LO, OUT, OUT];
  for (let j = 0; j < RH; j++) for (let i = 0; i < RW; i++) {
    const cx = Math.min(i, RW - 1 - i), cy = Math.min(j, RH - 1 - j);
    if (cx + cy < 2) continue;                                                   // rounded corners
    putB(roll, i, j, cy < OUTLINE || cx < OUTLINE || (cx + cy < 3) ? OUT : cols[i]);
  }
  for (const [cy, dir] of [[OUTLINE, 1], [RH - 1 - OUTLINE, -1]]) {
    for (let i = OUTLINE; i < RW - OUTLINE; i++) putB(roll, i, cy, TAN_LO);
    for (let i = OUTLINE + 1; i < RW - OUTLINE - 1; i++) putB(roll, i, cy + dir, i === OUTLINE + 1 || i === RW - OUTLINE - 2 ? TAN_LO : TAN);
    putB(roll, RW >> 1, cy, OUT); putB(roll, (RW >> 1) - 1, cy + dir, TAN_LO);
  }
  for (let j = 6; j < RH - 6; j += 5) putB(roll, 5, j, TAN_LO);
  return { W: PW + 2 * (RW - OV) + 2, H: RH + 2, PW, PH, RH, paper, text, isPaper, roll, tx, tw, py: (RH - PH) >> 1 };
}

// wind: per paper column vertical offset (integer art px) at time t (s); gust in 0..1
export function windOffsets(PW, t, gust = 0, out = new Int8Array(PW), shade = null) {
  const A = .8 + gust * .9;
  for (let x = 0; x < PW; x++) {
    const e = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, (x - OV) / (PW - 2 * OV)))), .8);
    const w = Math.sin(x / 7.5 - t * 2.3) * .75 + Math.sin(x / 3.9 - t * 3.7 + 1.3) * .25 * (.4 + gust);
    out[x] = Math.round(A * e * w);
    if (shade) shade[x] = A * e * (Math.cos(x / 7.5 - t * 2.3) * .1 + Math.cos(x / 3.9 - t * 3.7 + 1.3) * .064 * (.4 + gust));   // d/dx: which way the ripple faces
  }
  return out;
}
// occasional gusts: smooth bumps, deterministic in t
export function gustAt(t) { const T = 6.5, k = ((t % T) + T) % T; return k < 1.8 ? Math.sin(Math.PI * k / 1.8) ** 2 * (.6 + .4 * Math.abs(Math.sin(Math.floor(t / T) * 12.9898))) : 0; }

// the board's leaf-blower wind (noren.js sim.gust: + = page scrolled down = blows right, - = blows left, |b| <= ~1.3) moves
// the WHOLE button like the noren: it leans downwind (top rows more than the base, whole art px), the upwind roll lifts,
// the paper between them tilts with the rolls and its ripple grows and runs downwind. Room for that around the art:
export const WIND_PAD_X = 6, WIND_PAD_Y = 3;
export function blowShape(b, H) {                               // per output row: the lean (art px); per roll: the lift
  const lean = new Int8Array(H + WIND_PAD_Y);
  for (let y = 0; y < lean.length; y++) lean[y] = Math.round(b * (1 + 2.6 * (1 - y / (lean.length - 1))));
  const up = Math.min(2, Math.round(Math.abs(b) * 1.8));
  return { lean, liftL: b > 0 ? -up : 0, liftR: b < 0 ? -up : 0 };
}
// compose one frame: wind offsets for the paper columns, roll-up progress p (0 = open, 1 = rolled shut), blow (see above)
export function renderScrollButton(art, out, { t = 0, p = 0, gust = gustAt(t), blow = 0 } = {}) {
  const { W, H, PW, PH, RH, paper, isPaper, roll, py } = art, d = out.data; d.fill(0);
  const OW = out.width ?? W, OH = out.height ?? H, PX = (OW - W) >> 1, PY = OH - H;   // a padded buffer leaves room for the wind
  const b = PX || PY ? blow * (1 - p) : 0, ab = Math.min(1.3, Math.abs(b)), sh0 = blowShape(b, H);
  const shade = new Float32Array(PW), off = windOffsets(PW, t * (1 + ab * .9), (gust + ab * .9) * (1 - p), new Int8Array(PW), shade);
  if (b < 0) { off.reverse(); shade.reverse(); for (let x = 0; x < PW; x++) shade[x] = -shade[x]; }   // the ripple runs downwind
  for (let x = 0; x < PW; x++) off[x] = Math.round(off[x] * (1 - p) + sh0.liftL + (sh0.liftR - sh0.liftL) * x / (PW - 1));
  const rx0 = RW - OV + PW - OV, gMax = 2;                           // right roll's resting x; how much each roll fattens
  const pc = Math.min(1, Math.max(0, p)), grow = Math.round(pc * gMax);
  const travel = Math.round(pc * (rx0 - RW - 2 * gMax) / 2);          // both rolls travel inward the same distance
  const lx = travel, rx = rx0 - travel - grow;                        // left roll x / right roll x (it fattens leftward)
  const lean = sh0.lean;
  const put = (x, y, c, a = 255) => { y += PY; if (y < 0 || y >= OH) return; x += PX + (b ? lean[y] : 0); if (x < 0 || x >= OW) return; const o = (y * OW + x) * 4;
    if (a < 255 && d[o + 3]) return; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = a; };
  const px0 = RW - OV;                                                // paper x on the canvas
  const drawPaper = shadow => {
    for (let x = 0; x < PW; x++) {
      const CX = px0 + x; if (CX < lx + 2 || CX > rx + RW + grow - 3) continue;   // already wound into a roll
      const dy = off[x], sh = shade[x] * (1 - p);
      for (let y = 0; y < PH; y++) {
        const o = (y * PW + x) * 4; if (!paper.d[o + 3]) continue;
        const X = px0 + x + (shadow ? 2 : 0), Y = py + y + dy + (shadow ? 2 : 0);
        if (shadow) { put(X, Y, OUT, 80); continue; }
        let c = [paper.d[o], paper.d[o + 1], paper.d[o + 2]];
        if (isPaper[y * PW + x] && !art.text[y * PW + x]) {                                            // ripple shading, dithered
          const b = BAYER[(y & 3) * 4 + (x & 3)];
          if (sh > .03 && b < Math.min(.5, (sh - .03) * 6)) c = PAPER_SH; else if (sh < -.05 && b < Math.min(.35, (-sh - .05) * 5)) c = PAPER_HI;
        }
        put(X, Y, c);
      }
    }
  };
  const drawRoll = (x0, extra, shadow, lift = 0) => {
    for (let j = 0; j < RH; j++) for (let i = 0; i < RW + extra; i++) {
      const si = i < 5 ? i : i >= 5 + extra ? i - extra : 5, o = (j * RW + si) * 4; if (!roll.d[o + 3]) continue;
      if (shadow) put(x0 + i + 2, j + 2 - lift * .5 | 0, OUT, 80); else put(x0 + i, j + lift, [roll.d[o], roll.d[o + 1], roll.d[o + 2]]);
    }
  };
  const L = sh0.liftL, R = sh0.liftR;                                 // the upwind roll lifts (and its shadow stays down)
  drawRoll(rx, 0, false, R); drawRoll(lx, grow, false, L); drawPaper(false);
  drawRoll(lx, grow, false, L); drawRoll(rx, 0, false, R);            // rolls sit over the paper ends
  drawPaper(true); drawRoll(lx, grow, true, L); drawRoll(rx, 0, true, R);   // shadows only fill empty pixels
  return out;
}

export function mountScrollButton(button, { label = 'write a haiku', wind = () => 0 } = {}) {
  let art = drawScrollButton(label), cv = document.createElement('canvas');
  const sizeCanvas = () => {
    const CW = art.W + 2 * WIND_PAD_X, CH = art.H + WIND_PAD_Y;        // padded for the wind; negative margins keep the button's box
    cv.width = CW; cv.height = CH;
    Object.assign(cv.style, { width: CW * SCALE + 'px', height: CH * SCALE + 'px', margin: `${-WIND_PAD_Y * SCALE}px ${-WIND_PAD_X * SCALE}px 0` });
    img = ctx.createImageData(CW, CH);
  };
  cv.className = 'fab-art';
  const ctx = cv.getContext('2d');
  let img; sizeCanvas();
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const api = { canvas: cv, art, label, p: 0, t0: clock.now(), rolling: null, still: reduced, blow: 0 };
  let key = '';
  api.paint = (t = (clock.now() - api.t0) / 1000) => {
    const g = wind() || 0; api.blow = reduced ? g * .15 : g;          // reduced motion: only a mild lean, no ripple animation
    const tt = api.still ? 0 : t, bq = Math.round(api.blow * 20) / 20, k = (api.still ? 's' : (Math.round(tt * 30))) + ':' + api.p.toFixed(3) + ':' + bq;
    if (k === key) return; key = k;
    renderScrollButton(art, img, { t: tt, p: api.p, gust: api.still ? 0 : undefined, blow: bq }); ctx.putImageData(img, 0, 0);
  };
  // roll the paper up into the right roll (resolves when shut) / unroll it again (springy)
  const tween = (to, ms, ease) => new Promise(res => {
    const from = api.p, t0 = clock.now(); api.rolling?.(); let off = null;
    const step = () => { const k = Math.min(1, (clock.now() - t0) / ms); api.p = from + (to - from) * ease(k); api.paint(); if (k >= 1) { off(); api.rolling = null; res(); } };
    off = clock.onTick(step); api.rolling = () => { off(); res(); }; step();
  });
  const ROLL_EASE = k => k < .62 ? (k / .62) ** 2 : 1 - .025 * Math.sin((k - .62) / .38 * Math.PI * 2) * (1 - (k - .62) / .38) ** 1.5;
  // accelerate inward, meet at k = .62, then a springy bump: the rolls knock apart a hair and settle together
  api.rollUp = (ms = 540) => reduced ? (api.p = 1, api.paint(), Promise.resolve()) : tween(1, ms, ROLL_EASE);
  // round 15.10h2 (t234u): the boot open is the close run backwards: p(k) = 1 - rollUpEase(1 - k) at rollUp's own 540 ms (the knock first, then decelerating apart)
  api.openReverse = (ms = 540) => reduced ? (api.p = 0, api.paint(), Promise.resolve()) : tween(0, ms, k => 1 - ROLL_EASE(1 - k));
  api.unroll = (ms = 700) => reduced ? (api.p = 0, api.paint(), Promise.resolve()) : tween(0, ms, k => { const s = 1 - k; return 1 - s * s * s + Math.sin(k * Math.PI) * .06 * (1 - k); });   // progress 0 -> 1 (ends fully open, p = 0)
  // Swap the words while the paper is rolled shut (p = 1), then unroll. Wind lean uses the new art on the next paint.
  api.setLabel = (next) => {
    if (!next || next === api.label) return api;
    api.label = next;
    art = drawScrollButton(next); api.art = art;
    sizeCanvas(); key = '';
    sr.textContent = next;
    button.setAttribute('aria-label', next);
    api.paint();
    return api;
  };
  button.replaceChildren(cv); const sr = document.createElement('span'); sr.className = 'sr'; sr.textContent = label; button.append(sr);
  button.setAttribute('aria-label', label);
  api.paint(0);
  clock.onTick(() => api.paint());                                    // (reduced: repaints only when the lean changes, see key)
  return api;
}
