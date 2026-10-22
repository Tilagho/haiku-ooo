// Noren header: a row of small indigo pixel flags hung from one thin wooden rod by cloth loops, one big cream
// ChiKareGo2 glyph per flag, spelling H a i k u . o o o. All nine flags are the same size; every glyph is centred
// on its own pixels, and the period is a bold dot in the middle of its flag.
//
// Every flag is its own verlet cloth mesh: it breathes in an idle breeze, slightly out of phase with its
// neighbours; a swipe ripples across the row like a hand brushing through a noren; and you can press, hold and
// drag a flag near its hem to peel it up (that cloth point is pinned to the pointer, the rest follows, and the
// back of the dyed cloth shows where it folds over). On release it falls back with physics.
//
// EASTER EGG: on each page load ONE flag (random, any of the nine) hides ONE surprise on the paper behind it; the other flags hide
// nothing but their shadow. Lift the right flag and the thing gets startled, then settles back down when the flag
// drops. Override for captures: ?egg=<name>&eggflag=<1..9>.
//
// Drawn into a low-res canvas (1 art px = 3 CSS px, the background's grid), shown nearest-neighbour. Runs on the
// shared clock, pauses off-screen, and under reduced motion there is no idle breeze or brushing (lifting a flag
// still works, and the egg reacts without jumping).
import { drawLine, measure, font } from './brush-text.js';
import KANJI from './kanji-glyphs.js';
import { clock } from './clock.js';

export const NW = 130, NH = 36, SCALE = 3;
export const CHARS = ['H', 'a', 'i', 'k', 'u', '.', 'o', 'o', 'o'];
const ROD_Y = 3, TOP = 7, FH = 22, FW = 12, GAP = 2, BASE = 14;   // all nine flags are FW x FH; BASE: glyph baseline in a flag
const C = {
  ink: [26, 24, 28], cloth: [36, 42, 74], clothLo: [27, 31, 56], clothHi: [56, 64, 104], hem: [21, 23, 42],
  back: [62, 70, 108], backHi: [80, 88, 126], backGlyph: [98, 104, 138],
  text: [242, 233, 210], textLo: [214, 204, 182],
  wood: [158, 110, 70], woodHi: [198, 150, 102], woodLo: [118, 80, 50],
  shadow: [222, 212, 192],
};
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + .5) / 16);

// ---------- the flags ----------
function flagBitmap(ch, w, h) {
  const d = new Uint8ClampedArray(w * h * 4), glyph = new Uint8Array(w * h);
  const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h) d.set([c[0], c[1], c[2], 255], (y * w + x) * 4); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x, y, (x * 7 + y * 13) % 23 === 0 ? C.clothLo : C.cloth);
  for (let y = 0; y < h; y++) { put(0, y, C.clothHi); put(w - 1, y, C.clothLo); }              // selvedges
  for (let x = 0; x < w; x++) { put(x, 0, C.clothHi); put(x, h - 1, C.hem); put(x, h - 2, C.clothLo); }   // top fold, hem
  if (ch === '.') {                                   // the period: a bold 4x4 dot, dead centre of the cloth (between top fold and hem)
    const s = 4, x0 = Math.floor((w - s) / 2), y0 = Math.round((1 + (h - 3)) / 2 - s / 2);
    for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) glyph[y * w + x] = 1;
  } else {
    const F = font('main'), buf = { w: w + 8, h, data: new Uint8ClampedArray((w + 8) * h * 4) }, W2 = w + 8;
    drawLine(buf, ch, 2, BASE - F.ascent, F, () => .99, { color: C.text });
    const m = new Uint8Array(W2 * h);                 // bold: 1 px wider strokes
    for (let i = 0; i < W2 * h; i++) if (buf.data[i * 4 + 3]) { m[i] = 1; if (i % W2 + 1 < W2) m[i + 1] = 1; }
    let l = W2, r = -1; for (let i = 0; i < W2 * h; i++) if (m[i]) { l = Math.min(l, i % W2); r = Math.max(r, i % W2); }
    const dx = Math.floor((w - (r - l + 1)) / 2) - l;   // centre the inked pixels themselves, whatever the glyph's advance
    for (let i = 0; i < W2 * h; i++) if (m[i]) { const x = i % W2 + dx, y = (i / W2) | 0; if (x >= 0 && x < w) glyph[y * w + x] = 1; }
  }
  for (let i = 0; i < w * h; i++) if (glyph[i]) { const x = i % w, y = (i / w) | 0; d.set([...((x + 2 * y) % 9 === 0 ? C.textLo : C.text), 255], i * 4); }
  return { w, h, d, glyph };
}
class Flag {
  constructor(k, ch, x0) {
    this.k = k; this.ch = ch; this.x0 = x0; this.dot = ch === '.';
    this.w = FW; this.h = FH; this.tex = flagBitmap(ch, this.w, this.h);
    this.nx = 3; this.ny = 6; const N = this.nx * this.ny;
    this.cw = (this.w - 1) / (this.nx - 1); this.chh = (this.h - 1) / (this.ny - 1);
    this.p = new Float32Array(N * 2); this.q = new Float32Array(N * 2); this.r = new Float32Array(N * 2);
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const n = j * this.nx + i, x = x0 + i * this.cw, y = TOP + j * this.chh;
      this.p[n * 2] = this.q[n * 2] = this.r[n * 2] = x; this.p[n * 2 + 1] = this.q[n * 2 + 1] = this.r[n * 2 + 1] = y;
    }
    const L = [], add = (a, b, st) => L.push([a, b, Math.hypot(this.r[a * 2] - this.r[b * 2], this.r[a * 2 + 1] - this.r[b * 2 + 1]), st]);
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const n = j * this.nx + i;
      if (i + 1 < this.nx) add(n, n + 1, 1); if (j + 1 < this.ny) add(n, n + this.nx, 1);
      if (i + 1 < this.nx && j + 1 < this.ny) { add(n, n + this.nx + 1, .12); add(n + 1, n + this.nx, .12); }
      if (j + 2 < this.ny) add(n, n + 2 * this.nx, .08);
    }
    this.links = L; this.grab = null;      // { n, x, y, vx, vy }
  }
  step(h, t, wind) {
    const { p, q, r, nx, ny } = this, G = this.grab;
    for (let n = nx; n < nx * ny; n++) {
      const j = (n / nx) | 0, i = n % nx, f = j / (ny - 1), x = p[n * 2], y = p[n * 2 + 1];
      const home = G ? 1.5 : 3 + 9 * (1 - f);                           // shape memory (relaxed while held)
      const ax = wind(t, this.k, i, j) * f - (x - r[n * 2]) * home, ay = 40 - (y - r[n * 2 + 1]) * home * .6;
      let vx = (x - q[n * 2]) * .975, vy = (y - q[n * 2 + 1]) * .975; const sp = Math.hypot(vx, vy);
      if (sp > 1.6) { vx *= 1.6 / sp; vy *= 1.6 / sp; }
      q[n * 2] = x; q[n * 2 + 1] = y; p[n * 2] = x + vx + ax * h * h; p[n * 2 + 1] = y + vy + ay * h * h;
    }
    if (G) this.pinGrab();
    for (let it = 0; it < 6; it++) {
      for (const [a, b, len, st] of this.links) {
        const dx = p[b * 2] - p[a * 2], dy = p[b * 2 + 1] - p[a * 2 + 1], d = Math.hypot(dx, dy) || 1e-6, k = (d - len) / d * st;
        const wa = a < nx || (G && a === G.n) ? 0 : 1, wb = b < nx || (G && b === G.n) ? 0 : 1, s = wa + wb; if (!s) continue;
        p[a * 2] += dx * k * wa / s; p[a * 2 + 1] += dy * k * wa / s; p[b * 2] -= dx * k * wb / s; p[b * 2 + 1] -= dy * k * wb / s;
      }
      this.limit();
    }
  }
  // keep it readable: inside the canvas, never far from home unless held, never crumpled upward unless held
  limit() {
    const { p, r, nx, ny } = this, G = this.grab;
    for (let n = nx; n < nx * ny; n++) {
      if (G && n === G.n) continue;
      if (!G) {
        const dx = p[n * 2] - r[n * 2], dy = p[n * 2 + 1] - r[n * 2 + 1], d = Math.hypot(dx, dy), M = 3 + 4 * ((n / nx | 0) / (ny - 1));
        if (d > M) { p[n * 2] = r[n * 2] + dx * M / d; p[n * 2 + 1] = r[n * 2 + 1] + dy * M / d; }
        const up = p[(n - nx) * 2 + 1] + this.chh * .55; if (p[n * 2 + 1] < up) p[n * 2 + 1] = up;     // rows never ride over each other
      }
      p[n * 2] = Math.min(NW - 2, Math.max(1, p[n * 2])); p[n * 2 + 1] = Math.min(NH - 1, Math.max(TOP + 1, p[n * 2 + 1]));
    }
  }
  pinGrab() {
    const { p, q, r, nx } = this, G = this.grab, n = G.n, i = n % nx;
    // the held point can't stretch the cloth: it stays within its rest distance of the loop it hangs from
    const ax = p[i * 2], ay = p[i * 2 + 1], L = Math.hypot(r[n * 2] - r[i * 2], r[n * 2 + 1] - r[i * 2 + 1]) * 1.02;
    let tx = Math.min(NW - 2, Math.max(1, G.x)), ty = Math.min(NH - 1, Math.max(ROD_Y, G.y));
    const dx = tx - ax, dy = ty - ay, d = Math.hypot(dx, dy); if (d > L) { tx = ax + dx * L / d; ty = ay + dy * L / d; }
    q[n * 2] = p[n * 2]; q[n * 2 + 1] = p[n * 2 + 1]; p[n * 2] = tx; p[n * 2 + 1] = ty;
  }
  push(px, py, vx, vy, h, R = 8, s = 1) {
    if (this.grab) return;
    const { p, q, nx, ny } = this;
    for (let n = nx; n < nx * ny; n++) {
      const dx = p[n * 2] - px, dy = p[n * 2 + 1] - py, d2 = dx * dx + dy * dy; if (d2 > R * R) continue;
      const f = (1 - Math.sqrt(d2) / R) * s * ((n / nx | 0) / (ny - 1)) ** .5;
      q[n * 2] -= vx * h * f; q[n * 2 + 1] -= vy * h * f * .35;
    }
  }
  hit(x, y) {   // which cloth node to hold, if (x, y) is on this flag near its hem
    const { p, nx, ny } = this; let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (let n = 0; n < nx * ny; n++) { minX = Math.min(minX, p[n * 2]); maxX = Math.max(maxX, p[n * 2]); minY = Math.min(minY, p[n * 2 + 1]); maxY = Math.max(maxY, p[n * 2 + 1]); }
    if (x < minX - 1.5 || x > maxX + 1.5 || y < minY || y > maxY + 2.5) return null;
    if (y < TOP + this.h * .4) return null;                                 // upper part: brush, don't grab
    let best = null, bd = 1e9;
    for (let n = nx * Math.floor(ny / 2); n < nx * ny; n++) { const d = Math.hypot(p[n * 2] - x, p[n * 2 + 1] - y); if (d < bd) { bd = d; best = n; } }
    return best;
  }
  lift() { const { p, r, nx, ny } = this; let m = 0; for (let n = nx * (ny - 1); n < nx * ny; n++) m = Math.max(m, r[n * 2 + 1] - p[n * 2 + 1]); return m; }
}

export function createNoren() {
  const flags = [], total = CHARS.length * FW + GAP * (CHARS.length - 1);
  let x = Math.round((NW - total) / 2);
  CHARS.forEach((ch, k) => { const f = new Flag(k, ch, x); flags.push(f); x += f.w + GAP; });
  return { flags, t: 0, acc: 0, egg: null };
}
// idle breeze: slow breathing, each flag a little out of phase, ripples travelling along the row, rare soft gusts
export function idleWind(t, k, i, j) {
  const g = Math.max(0, Math.sin(t * .31 + .7)) ** 8;
  return 2.6 * (22 * Math.sin(t * 1.2 - k * .55 + j * .3) + 8 * Math.sin(t * 2.6 - k * 1.3 + i * .8 + j * .5) + 30 * g * Math.sin(t * 2 - k * .8));
}
export const stillWind = () => 0;
export function stepNoren(N, dt, wind = idleWind) {
  N.acc = Math.min(.1, N.acc + dt); const h = 1 / 60;
  while (N.acc >= h) { N.acc -= h; N.t += h; for (const F of N.flags) F.step(h, N.t, wind); N.egg?.step(h); }
}

// ---------- the eggs ----------
// palette for egg sprites
const PAL = { K: [26, 24, 28], D: [72, 70, 78], G: [120, 116, 124], g: [176, 172, 176], W: [252, 250, 244], P: [236, 146, 166],
  R: [214, 52, 40], B: [140, 186, 232], C: [246, 238, 220], c: [214, 202, 178], Y: [236, 200, 90], F: [92, 132, 78], f: [168, 196, 120] };
const SPR = s => s.trim().split('\n').map(r => r.trim());
const SPRITES = {
  inkySleep: SPR(`
    ....K....
    ...KKK...
    ..KKKKK..
    .KKKKKKK.
    KKKKKKKKK
    KKggKggKK
    KPKKKKKPK
    .KKKKKKK.`),
  inkyAwake: SPR(`
    ....K....
    ...KKK...
    ..KKKKK..
    .KWKKKWK.
    KKWKKKWKK
    KKKKKKKKK
    KPKKgKKPK
    .KKKKKKK.`),
  inkyShock: SPR(`
    ....K....
    ...KKK...
    ..KKKKK..
    .WWKKKWW.
    KWKKKKKWK
    KKKKKKKKK
    KPKKWKKPK
    .KKKKKKK.`),
  frogSleep: SPR(`
    .FF...FF.
    FDDF.FDDF
    FFFFFFFFF
    FKKKKKKKF
    FFfffffFF
    FFF...FFF`),
  frogAwake: SPR(`
    .FF...FF.
    FWKF.FKWF
    FFFFFFFFF
    FKKKKKKKF
    FFfffffFF
    FFF...FFF`),
  frogLeap: SPR(`
    .FF...FF.
    FWWF.FWWF
    FFFFFFFFF
    FFFKKKFFF
    .FfffffF.
    .F.....F.
    F.......F`),
  catSleep: SPR(`
    .D...D.....
    DGD.DGD....
    DGGDGGD....
    DDGGGDDDDD.
    DGGPGGGGGGD
    DGGGGGGGGGD
    .DDDDDDDDD.`),
  catShock: SPR(`
    .D.....D..D
    DGD...DGD.D
    DGGDDDGGD.D
    DWKGGGKWD.D
    DGGGPGGGDD.
    .DGGGGGGD..
    D.DGGGGD.D.
    .D.D..D.D..`),
  catAwake: SPR(`
    .D.....D...
    DGD...DGD..
    DGGDDDGGD..
    DKGGGGGKD..
    DGGGPGGGDDD
    .DGGGGGGGGD
    .DDDDDDDDD.`),
  note: SPR(`
    KKKKKKK.
    KCCCCCKK
    KCDDDCCK
    KCCCCCCK
    KCDDDDCK
    KCCCCCCK
    KCDDCCCK
    KKKKKKKK`),
};
const MARK = { bang: SPR(`K\nK\nK\n.\nK`), sweat: SPR(`.B\nBB\nBB`), z: SPR(`ggg\n.g.\nggg`), spark: SPR(`.Y.\nYWY\n.Y.`) };
function blit(put, spr, x, y, { flipX = false } = {}) {
  spr.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== '.') put(x + (flipX ? row.length - 1 - i : i), y + j, PAL[ch]); }));
}
const card = (put, lines, cx, y, F) => {   // a little cream card with tiny ink text, drawn on top of everything
  const w = Math.max(...lines.map(l => measure(l, F))) + 5, lh = F.ascent + F.descent - 2, h = lines.length * lh + 3, x = Math.round(Math.min(NW - w - 1, Math.max(1, cx - w / 2)));
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, i === 0 || j === 0 || i === w - 1 || j === h - 1 ? PAL.K : PAL.C);
  const buf = { w: NW, h: NH, data: new Uint8ClampedArray(NW * NH * 4) };
  lines.forEach((l, k) => drawLine(buf, l, x + 3 + Math.floor((w - 5 - measure(l, F)) / 2), y + 1 + k * lh - 2, F, () => .99, { color: PAL.K }));
  for (let i = 0; i < NW * NH; i++) if (buf.data[i * 4 + 3]) put(i % NW, (i / NW) | 0, PAL.K);
};
// Each egg: sleep -> (uncovered) startle -> awake -> (covered again for a moment) settle -> sleep
export const EGGS = {
  inky:   { weight: 30, about: 'a tiny sleeping Inky', reaction: 'jolts awake: eyes pop wide, hops with a sweat drop and a "!", stares back blinking; yawns and dozes off (zzz) when the flag drops' },
  frog:   { weight: 24, about: 'a little green frog, asleep', reaction: 'leaps straight up with its legs out and a "!", lands goggle-eyed with its throat puffing; shuts its eyes when covered' },
  cat:    { weight: 24, about: 'a gray cat curled up in a loaf', reaction: 'puffs into an arched halloween-cat pose, fur on end, tail up, with a "!"; sits up wary, then curls back into a loaf when covered' },
  haiku:  { weight: 16, about: 'a folded note pinned to the wall', reaction: 'flutters up and unfolds in front of the curtains into a three-word haiku card: "psst / hello / you"; folds itself away when covered' },
  secret: { weight: 6, about: 'RARE: a red 秘 ("secret") seal', reaction: 'stamps itself twice with sparkles and pops a "secret!" card; settles back flat when covered' },
};
export function pickEgg(rand = Math.random, params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams()) {
  let name = params.get('egg'), flag = params.has('eggflag') ? parseInt(params.get('eggflag'), 10) - 1 : null;
  if (!EGGS[name]) { const tot = Object.values(EGGS).reduce((s, e) => s + e.weight, 0); let r = rand() * tot; name = Object.keys(EGGS).find(k => (r -= EGGS[k].weight) < 0) || 'inky'; }
  if (flag == null || !Number.isFinite(flag) || flag < 0 || flag >= CHARS.length) flag = Math.floor(rand() * CHARS.length);      // any of the nine flags (all the same size now, the '.' too)
  return { name, flag };
}
export class Egg {
  constructor(name, F, reduced) { this.name = name; this.F = F; this.state = 'sleep'; this.t = 0; this.cover = 0; this.reduced = reduced; this.exposed = 0; this.seen = 0; }
  step(h) {
    this.t += h; const ex = this.exposed;
    if (this.state === 'sleep' && ex > .38) { this.state = 'startle'; this.t = 0; this.seen++; }
    else if (this.state === 'startle' && this.t > .9) { this.state = 'awake'; this.t = 0; }
    else if ((this.state === 'awake' || this.state === 'startle') && ex < .12) { this.cover += h; if (this.cover > .6) { this.state = 'settle'; this.t = 0; } }
    else if (this.state === 'settle' && this.t > .7) { this.state = 'sleep'; this.t = 0; }
    if (ex >= .12) this.cover = 0;
  }
  get box() { const f = this.F; return { cx: Math.round(f.x0 + f.w / 2), bottom: TOP + f.h - 3 }; }
  // draw the egg itself (behind the cloth)
  drawBack(put) {
    const { cx, bottom } = this.box, s = this.state, t = this.t, R = this.reduced;
    const hop = (H, dur) => R || s !== 'startle' || t > dur ? 0 : Math.round(-H * Math.sin(Math.PI * t / dur));
    const blink = s === 'awake' && (t % 2.4) > 2.25;
    if (this.name === 'inky') {
      const spr = s === 'startle' && t < .6 ? SPRITES.inkyShock : (s === 'awake' && !blink) || (s === 'settle' && t < .35) ? SPRITES.inkyAwake : SPRITES.inkySleep;
      blit(put, spr, cx - 4, bottom - 8 + hop(4, .32));
    } else if (this.name === 'frog') {
      const air = s === 'startle' && t < .5 && !R, spr = air ? SPRITES.frogLeap : s === 'sleep' || (s === 'settle' && t > .35) || blink ? SPRITES.frogSleep : SPRITES.frogAwake;
      blit(put, spr, cx - 4, bottom - spr.length + (air ? Math.round(-8 * Math.sin(Math.PI * t / .5)) : 0));
      if (s === 'awake' && Math.floor(this.t * 3) % 2 && !R) put(cx, bottom - 1, PAL.W);                       // throat puff
    } else if (this.name === 'cat') {
      const spr = s === 'startle' || (s === 'awake' && t < .8) ? SPRITES.catShock : s === 'awake' || (s === 'settle' && t < .35) ? SPRITES.catAwake : SPRITES.catSleep;
      blit(put, spr, cx - 5, bottom - spr.length + hop(2, .2));
    } else if (this.name === 'haiku') {
      if (s === 'sleep' || (s === 'settle' && t > .3)) blit(put, SPRITES.note, cx - 4, bottom - 9);
      put(cx, bottom - 10, PAL.R);                                                                           // the pin
    } else if (this.name === 'secret') {
      const y = bottom - 9 + hop(3, .25) + (s === 'startle' && t > .3 && t < .55 && !R ? Math.round(-3 * Math.sin(Math.PI * (t - .3) / .25)) : 0);
      for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) {
        const edge = i === 0 || j === 0 || i === 8 || j === 8, g = KANJI['秘'];
        const inG = i >= 1 && j >= 1 && i <= 7 && j <= 7 && g[j - 1][i - 1] === '1';
        if ((i === 0 || i === 8) && (j === 0 || j === 8)) continue;
        put(cx - 4 + i, y + j, edge ? PAL.R : inG ? PAL.C : PAL.R);
      }
    }
  }
  // marks that pop out in front of the cloth ("!", sweat, zzz, cards)
  drawFront(put, covered) {
    const { cx, bottom } = this.box, s = this.state, t = this.t, R = this.reduced, F = font('small');
    if (s === 'startle' && t < .7 && this.name !== 'haiku') blit(put, MARK.bang, cx + 5, bottom - 15);
    if (this.name === 'inky' && (s === 'startle' || (s === 'awake' && t < 1.2))) blit(put, MARK.sweat, cx + 4, bottom - 10);
    if (this.name === 'inky' && s === 'sleep' && this.exposed > .2 && !R) blit(put, MARK.z, cx + 4, bottom - 12 - Math.floor((this.t * 3) % 3));
    if (this.name === 'haiku' && (s === 'startle' || s === 'awake' || (s === 'settle' && t < .3))) {
      const open = s === 'startle' ? Math.min(1, t / .35) : s === 'settle' ? 1 - t / .3 : 1;
      if (open > .66) card(put, ['psst', 'hello', 'you'], cx, Math.max(0, bottom - 25 - (R ? 0 : Math.round(2 * Math.sin(this.t * 2)))), F);
      else blit(put, SPRITES.note, cx - 4, bottom - 9 - Math.round(open * 8));
    }
    if (this.name === 'secret' && (s === 'startle' || s === 'awake')) {
      if (!R && Math.floor(this.t * 6) % 2) { blit(put, MARK.spark, cx - 8, bottom - 12); blit(put, MARK.spark, cx + 6, bottom - 6); }
      if (s === 'awake' || t > .5) card(put, ['secret!'], cx, Math.max(0, bottom - 19), F);
    }
  }
}

// ---------- drawing ----------
function drawRod(put) {
  const y0 = ROD_Y, x0 = 2, x1 = NW - 3;
  for (let x = x0; x <= x1; x++) { put(x, y0, C.ink); put(x, y0 + 1, C.woodHi); put(x, y0 + 2, x % 11 === 4 ? C.woodLo : C.wood); put(x, y0 + 3, C.ink); }
  for (const xe of [x0 - 1, x1 - 1]) for (let y = y0 - 1; y <= y0 + 4; y++) for (let x = xe; x < xe + 3; x++) put(x, y, y === y0 - 1 || y === y0 + 4 || x === xe || x === xe + 2 ? C.ink : C.woodLo);
}
function drawLoops(put, F) {     // two cloth loops (chichi) per flag wrap the rod
  const { p } = F, xs = F.dot ? [p[0] + 1] : [p[0] + 1, p[(F.nx - 1) * 2] - 3];
  for (const x of xs) for (let y = ROD_Y - 1; y < TOP + 1; y++) for (let i = 0; i < 3; i++) put(Math.round(x) + i, y, y === ROD_Y - 1 ? C.clothHi : i === 0 ? C.clothHi : C.cloth);
}
export function renderNoren(N, img) {
  const d = img.data; d.fill(0);
  const cover = new Uint8Array(NW * NH);
  const put = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= NW || y >= NH) return; d.set([c[0], c[1], c[2], 255], (y * NW + x) * 4); };
  // the paper behind: each flag's faint dithered shadow on the wall, and (under one flag) the egg
  for (const F of N.flags) for (let y = TOP + 1; y < TOP + F.h + 1; y++) for (let x = F.x0 + 1; x < F.x0 + F.w + 1; x++) if (BAYER[(y & 3) * 4 + (x & 3)] < .3) put(x, y, C.shadow);
  const eggPx = [];
  if (N.egg) N.egg.drawBack((x, y, c) => { put(x, y, c); eggPx.push(Math.round(y) * NW + Math.round(x)); });
  drawRod(put);
  const order = N.flags.filter(F => !F.grab).concat(N.flags.filter(F => F.grab));        // a held flag is drawn on top
  for (const F of order) {
    const { p, nx, ny, tex, w, h, cw, chh } = F;
    for (let v = 0; v < h; v += .5) for (let u = 0; u < w; u += .5) {
      const fi = Math.min(nx - 1.001, u / cw), fj = Math.min(ny - 1.001, v / chh), i = fi | 0, j = fj | 0, a = fi - i, b = fj - j;
      const n00 = j * nx + i, n10 = n00 + 1, n01 = n00 + nx, n11 = n01 + 1;
      const X = (p[n00 * 2] * (1 - a) + p[n10 * 2] * a) * (1 - b) + (p[n01 * 2] * (1 - a) + p[n11 * 2] * a) * b;
      const Y = (p[n00 * 2 + 1] * (1 - a) + p[n10 * 2 + 1] * a) * (1 - b) + (p[n01 * 2 + 1] * (1 - a) + p[n11 * 2 + 1] * a) * b;
      const dux = (p[n10 * 2] - p[n00 * 2] + p[n11 * 2] - p[n01 * 2]) / 2, duy = (p[n10 * 2 + 1] - p[n00 * 2 + 1] + p[n11 * 2 + 1] - p[n01 * 2 + 1]) / 2;
      const dvx = (p[n01 * 2] - p[n00 * 2] + p[n11 * 2] - p[n10 * 2]) / 2, dvy = (p[n01 * 2 + 1] - p[n00 * 2 + 1] + p[n11 * 2 + 1] - p[n10 * 2 + 1]) / 2;
      const cross = dux * dvy - duy * dvx, X0 = Math.round(X), Y0 = Math.round(Y), bt = BAYER[(Y0 & 3) * 4 + (X0 & 3)];
      const ti = (v | 0) * w + (u | 0), o = ti * 4;
      let c;
      if (cross < 0) c = F.tex.glyph[(v | 0) * w + (w - 1 - (u | 0))] ? C.backGlyph : (bt < .2 ? C.backHi : C.back);    // the back: lining + the dye showing through, mirrored
      else {
        c = [tex.d[o], tex.d[o + 1], tex.d[o + 2]];
        const lean = dvx / chh, s = lean * .7 - Math.max(0, 1 - dux / cw) * 1.2;
        if (!tex.glyph[ti]) { if (s > .1 && bt < Math.min(.5, s)) c = C.clothHi; else if (s < -.1 && bt < Math.min(.55, -s)) c = C.clothLo; }
      }
      put(X0, Y0, c); if (X0 >= 0 && Y0 >= 0 && X0 < NW && Y0 < NH) cover[Y0 * NW + X0] = 1;
    }
  }
  for (const F of N.flags) drawLoops(put, F);
  if (N.egg) {
    let vis = 0; for (const i of eggPx) if (!cover[i]) vis++; N.egg.exposed = eggPx.length ? vis / eggPx.length : 0;
    N.egg.drawFront(put);
  }
  return img;
}

// ---------- DOM ----------
export function mountNoren(host, { reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches, egg = pickEgg() } = {}) {
  const cv = document.createElement('canvas'); cv.width = NW; cv.height = NH; cv.className = 'noren-cv';
  cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Haiku.ooo, written on a row of noren flags');
  host.prepend(cv);
  const ctx = cv.getContext('2d'), img = ctx.createImageData(NW, NH), N = createNoren();
  N.egg = new Egg(egg.name, N.flags[egg.flag], reduced); N.eggFlag = egg.flag;
  const wind = reduced ? stillWind : idleWind;
  let visible = true, last = null, held = null, quiet = 0;
  for (let k = 0; k < 90; k++) stepNoren(N, 1 / 60, wind);
  const paint = () => { renderNoren(N, img); ctx.putImageData(img, 0, 0); };
  const toArt = (cx, cy) => { const r = cv.getBoundingClientRect(); return { x: (cx - r.left) / r.width * NW, y: (cy - r.top) / r.height * NH, t: clock.now() }; };
  const brush = (a, strong) => {
    if (reduced || !last) return;
    const dt = Math.max(8, a.t - last.t) / 1000; let vx = (a.x - last.x) / dt, vy = (a.y - last.y) / dt;
    const sp = Math.hypot(vx, vy); if (sp > 520) { vx *= 520 / sp; vy *= 520 / sp; }          // hard flicks are capped
    N.flags.forEach(F => F.push(a.x, a.y, vx, vy, 1 / 60, 8, strong ? 1 : .4));
  };
  // grabbing: pin the nearest hem-side cloth point to the pointer; release flings it with the pointer's velocity
  const tryGrab = a => { for (const F of [...N.flags].reverse()) { const n = F.hit(a.x, a.y); if (n != null) { F.grab = { n, x: a.x, y: a.y, vx: 0, vy: 0 }; held = F; return true; } } return false; };
  const drag = a => { if (!held) return; const g = held.grab, dt = Math.max(8, a.t - (g.t || a.t - 16)) / 1000; g.vx = (a.x - g.x) / dt; g.vy = (a.y - g.y) / dt; g.x = a.x; g.y = a.y; g.t = a.t; };
  const release = () => {
    if (!held) return; const F = held, g = F.grab, n = g.n, h = 1 / 60, cap = v => Math.max(-300, Math.min(300, v));
    F.q[n * 2] = F.p[n * 2] - cap(g.vx) * h * .6; F.q[n * 2 + 1] = F.p[n * 2 + 1] - cap(g.vy) * h * .6; F.grab = null; held = null;
  };
  // touch: a touch that starts near a flag's hem holds it (and doesn't scroll); any other touch scrolls as usual
  let touchId = null;
  cv.addEventListener('touchstart', e => {
    const tch = e.changedTouches[0], a = toArt(tch.clientX, tch.clientY);
    if (touchId == null && tryGrab(a)) { touchId = tch.identifier; e.preventDefault(); }
    last = a;
  }, { passive: false });
  cv.addEventListener('touchmove', e => {
    for (const tch of e.changedTouches) {
      const a = toArt(tch.clientX, tch.clientY);
      if (tch.identifier === touchId) { e.preventDefault(); drag(a); } else { brush(a, true); }
      last = a;
    }
  }, { passive: false });
  const endTouch = e => { for (const tch of e.changedTouches) if (tch.identifier === touchId) { touchId = null; release(); } last = null; };
  cv.addEventListener('touchend', endTouch); cv.addEventListener('touchcancel', endTouch);
  // mouse / pen
  cv.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') return; const a = toArt(e.clientX, e.clientY); if (tryGrab(a)) { cv.setPointerCapture(e.pointerId); e.preventDefault(); cv.style.cursor = 'grabbing'; } last = a; });
  cv.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return; const a = toArt(e.clientX, e.clientY);
    if (held) drag(a); else { brush(a, e.buttons > 0); cv.style.cursor = N.flags.some(F => F.hit(a.x, a.y) != null) ? 'grab' : 'default'; }
    last = a;
  });
  const up = e => { if (e.pointerType === 'touch') return; release(); cv.style.cursor = ''; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('pointerleave', e => { if (!held) last = null; });
  new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(cv);
  clock.onTick(dt => {
    if (!visible) return;
    if (reduced && !held && N.egg.state === 'sleep' && N.flags.every(F => F.lift() < .3)) { if ((quiet += dt) > 2) return; } else quiet = 0;   // reduced: only simulate while something moves
    stepNoren(N, dt, wind); paint();
  });
  paint();
  // hooks for captures / tests (art-px coordinates)
  const api = { canvas: cv, sim: N, paint, egg: { name: egg.name, flag: egg.flag + 1, get state() { return N.egg.state; }, get exposed() { return N.egg.exposed; } },
    flagCenter: k => { const F = N.flags[k], r = cv.getBoundingClientRect(); return { x: r.left + (F.x0 + F.w / 2) / NW * r.width, hem: r.top + (TOP + F.h - 2) / NH * r.height, top: r.top + TOP / NH * r.height, w: F.w / NW * r.width }; },
    grab: (x, y) => tryGrab({ x, y, t: clock.now() }), drag: (x, y) => drag({ x, y, t: clock.now() }), release };
  return api;
}
