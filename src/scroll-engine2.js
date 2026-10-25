// Haiku Board - background engine, round 6 (written from scratch); round 13: bigger sprites, no bamboo, more
// mountains and waterfalls (haboku, twinpeaks, spires, misthills, layers, ribbonfalls, cascade, cliffalls).
//
// ONE PIXEL GRID. The whole background lives in a single ink buffer at a fixed art resolution: AW = 130 art px
// across the 390-unit scroll, so 1 art px = 3 units (= 6 device px at DPR 2, 9 at DPR 3). Sprites are sumi-e
// paintings re-pixelated offline (tools/sprites6.py) at the exact sizes used here, then composited into the buffer
// at their native art-pixel size. Nothing is rescaled in the browser; the view paints the buffer into low-res
// canvases and the browser upscales them nearest-neighbour.
//
// DEPTH = OPACITY. Each region is built far -> near in layers. Far sprites are composited at low tone; after a
// layer, broad mist banks multiply the ink below them away, so whatever is further back sinks into cloud and the
// next, darker layer overlaps it. Mist is the glue between everything.
//
// APPEND STABILITY. The scroll grows upward (y up, art row 0 = oldest). Region k only writes rows >= its own start
// row, and every region's content is fixed by (seed, k). So rows below the newest region's start never change, and
// poems are only placed in rows that are already final.
import { measure, lineHeight, font, rng, hash, sealDims } from './brush-text.js';

export const SCROLL_W = 390, AW = 130, PX = SCROLL_W / AW;   // art grid: 130 px across, 3 units per art px
export const U = 1.5;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// the signature shows the reader's LOCAL date, but layout reserves the widest possible date, so geometry (and
// therefore placement) is identical on every client whatever its time zone
// an unsigned post (author '') has no author at all: the byline is just the date, and the seal hugs it
export const sigAuthor = post => post.sample ? 'sample, ' : post.author === '' ? '' : `${post.author || 'anon'}, `;
export function signatureFor(post) { const d = new Date(post.createdAt); return `${sigAuthor(post)}${MONTHS[d.getMonth()]} ${d.getDate()}`; }
let DATE_W = 0;
const dateW = Sm => DATE_W || (DATE_W = Math.max(...MONTHS.flatMap(m => [28, 30, 31].map(d => measure(`${m} ${d}`, Sm)))));

// Instead each layout carries its own pixel scale `u` (scroll units per font px): the normal 1.5, or, when the
// longest line will not fit even with tighter step indents, 1.0, and only for extreme input 0.75 / 0.5. The
// renderer snaps u down to whole device pixels, so the text stays crisp at every scale.
export const SCALES = [1.5, 1.0, 0.75, 0.5];
export const MAX_BOX = SCROLL_W - 26;                          // widest poem box in scroll units
// Alignment is picked per poem from the seed: left, centered or right; lines flat or stepped (down-in or down-out).
export const ALIGNS = ['left', 'center', 'right'];
export function poemStyle(seed, n, id) {
  const h = hash(seed, 'align', n, id), align = ALIGNS[h % 3], r = (h >>> 4) % 8;
  const step = align === 'center' ? (r < 5 ? 0 : 8) : [0, 0, 12, 12, 18, 18, 24, 12][r];
  return { align, step, dir: (h >>> 9) & 1 ? 1 : -1 };
}
// SEAL PLACEMENT (round 13): like the red seal on a sumi-e painting, the number seal sits a decent distance from
// the calligraphy, and not always in the same place. Positions, relative to the poem block:
//   left-1 / left-3     to the left of line 1 / line 3        right-1 / right-3   to the right of line 1 / line 3
//   below-left / below-center / below-right   well below the byline (a generous gap)
//   upper-left / upper-right                  above line 1 (rarer)
// The choice is a stable per-post hash (sealOrder), the previous poem's position is never reused (style.avoidSeal),
// and a side position is only taken if the poem still fits the phone at its own text scale (otherwise the next
// position in the order is tried; "below" positions add no width, so one always fits). The seal box is part of
// the poem's layout box, so it can never overlap this poem's text or byline, nor (via the placer) another poem.
export const SEAL_POS = ['left-1', 'left-3', 'right-1', 'right-3', 'below-left', 'below-center', 'below-right', 'upper-left', 'upper-right'];
const SEAL_W8 = { 'left-1': 3, 'left-3': 3, 'right-1': 3, 'right-3': 3, 'below-left': 3, 'below-center': 3, 'below-right': 3, 'upper-left': 1.5, 'upper-right': 1.5 };
export function sealOrder(n, id, avoid = null) {      // a weighted shuffle of SEAL_POS from a stable hash of the post
  const R = rng(hash('seal-pos', n, id)), keyed = SEAL_POS.map(p => [p, -Math.log(1 - R()) / SEAL_W8[p]]).sort((a, b) => a[1] - b[1]).map(a => a[0]);
  const below = keyed.filter(p => p.startsWith('below') && p !== avoid);
  return [...keyed.filter(p => p !== avoid), below[0]];   // ends with a fitting fallback that isn't the neighbour's
}
const SEAL_GAP_X = 12, SEAL_GAP_Y = 11;                      // font px: well clear of the text
export function poemLayouts(post, n, style = { align: 'left', step: 12, dir: 1 }) {
  const F = font('main'), Sm = font('small'), lh = lineHeight(F) + 4, slh = lineHeight(Sm);
  const src = post.text.split('\n').slice(0, 3), sig = signatureFor(post), sigW = measure(sigAuthor(post), Sm) + dateW(Sm), sigT = measure(sig, Sm);
  const [sealW, sealH] = sealDims(n), widths = src.map(t => measure(t, F));
  const make = (step, u, pos) => {
    const { align, dir } = style, k = i => (dir > 0 ? i : src.length - 1 - i) * step;
    const block = Math.max(...widths.map((w, i) => w + k(i)));
    const L = src.map((t, i) => ({ t, y: i * lh, x: align === 'left' ? k(i) : align === 'right' ? block - widths[i] - k(i)
      : Math.round((block - widths[i]) / 2 + (dir > 0 ? 1 : -1) * (i - 1) * step / 2) }));
    const minX0 = Math.min(...L.map(l => l.x)), maxR0 = Math.max(...L.map((l, i) => l.x + widths[i])), last = L.length - 1;
    const sy = src.length * lh + 3;
    // the byline alone (the seal no longer hugs it)
    const sx = align === 'left' ? minX0 + 2 : align === 'right' ? maxR0 - sigW : Math.round((minX0 + maxR0 - sigW) / 2);
    const sigX0 = align === 'left' ? sx : sx + sigW - sigT;
    // the seal, in text coordinates (may be negative: everything is shifted so the box starts at 0, 0)
    const botY = sy + slh + SEAL_GAP_Y, lineY = i => L[Math.min(i, last)].y + Math.round((lh - 4 - sealH) / 2);
    const minX = Math.min(minX0, sx), maxR = Math.max(maxR0, sx + sigW);          // side seals clear the byline too
    // side seals only have to clear the lines (and byline) they sit beside, so they tuck in next to a short line
    const rows = [...L.map((l, i) => ({ y0: l.y, y1: l.y + lh - 4, l: l.x, r: l.x + widths[i] })), { y0: sy, y1: sy + slh, l: sx, r: sx + sigW }];
    const beside = y => rows.filter(b => b.y0 < y + sealH + SEAL_GAP_Y && b.y1 > y - SEAL_GAP_Y);
    const leftOf = y => Math.min(...beside(y).map(b => b.l)) - SEAL_GAP_X - sealW, rightOf = y => Math.max(...beside(y).map(b => b.r)) + SEAL_GAP_X;
    let x, y;
    switch (pos) {
      case 'left-1': y = lineY(0); x = leftOf(y); break;
      case 'left-3': y = lineY(2); x = leftOf(y); break;
      case 'right-1': y = lineY(0); x = rightOf(y); break;
      case 'right-3': y = Math.max(lineY(2), 0); x = rightOf(y); break;
      case 'below-left': x = minX + 2; y = botY; break;
      case 'below-center': x = Math.round((minX + maxR - sealW) / 2); y = botY; break;
      case 'below-right': x = maxR - sealW; y = botY; break;
      case 'upper-left': x = minX; y = -SEAL_GAP_Y - sealH; break;
      case 'upper-right': x = maxR - sealW; y = -SEAL_GAP_Y - sealH; break;
    }
    const ox = -Math.min(0, minX, x), oy = -Math.min(0, y);
    L.forEach(l => { l.x += ox; l.y += oy; });
    const w = Math.max(maxR, x + sealW) + ox + 1, h = Math.max(sy + slh, y + sealH) + oy + 1;
    return { kind: align, align, dir: style.dir, w, h, u, lines: L, step, sealPos: pos,
      sig: { t: sig, x: sigX0 + ox, y: sy + oy + 1 }, seal: { x: x + ox, y: y + oy } };
  };
  const order = style.sealOrder || ['below-right'], steps = [...new Set([style.step, Math.min(style.step, 8), 0])];
  // the text scale is decided by the poem alone (a seal beside it never shrinks the words)...
  let u0 = SCALES.at(-1), st0 = 0;
  find: for (const u of SCALES) for (const st of steps) { if (make(st, u, 'below-left').w * u <= MAX_BOX) { u0 = u; st0 = st; break find; } }
  // ...then the first seal position in this post's order that still fits the phone at that scale
  // (a side seal that can't fit drops to the same side below the poem, unless the neighbour already sits there)
  const fits = pos => { const L = make(st0, u0, pos); return L.w * u0 <= MAX_BOX ? L : null; };
  for (const pos of order) {
    const L = fits(pos); if (L) return [L];
    const fall = /^left/.test(pos) ? 'below-left' : /^right/.test(pos) ? 'below-right' : null;
    if (fall && fall !== style.sealAvoid) { const F = fits(fall); if (F) return [F]; }
  }
  return [make(st0, u0, 'below-left')];
}

// ====================================================================== SPRITE LIBRARY
// Packed by tools/sprites6.py: per art px one byte, high nibble coverage, low nibble ink density. Decoded once.
function unpack(e, bytes) {
  const n = e.w * e.h, d = new Float32Array(n), a = new Float32Array(n);
  for (let i = 0; i < n; i++) { d[i] = (bytes[i] & 15) / 15; a[i] = (bytes[i] >> 4) / 15; }
  return finish({ w: e.w, h: e.h, kind: e.kind, d, a });
}
function finish(s) {          // per column: lowest solid row (the foot) and highest solid row (the ridge)
  const { w, h, a } = s; s.foot = new Int16Array(w).fill(-1); s.ridge = new Int16Array(w).fill(-1);
  for (let x = 0; x < w; x++) {
    for (let y = h - 1; y >= 0; y--) if (a[y * w + x] >= .4) { s.foot[x] = h - 1 - y; break; }
    for (let y = 0; y < h; y++) if (a[y * w + x] >= .4) { s.ridge[x] = h - 1 - y; break; }
  }
  return s;
}
const b64 = s => typeof atob === 'function' ? Uint8Array.from(atob(s), c => c.charCodeAt(0)) : new Uint8Array(Buffer.from(s, 'base64'));
export function decodeLibrary(raw, inflate) {          // inflate: (Uint8Array) => Uint8Array  (Node: zlib.inflateSync)
  const lib = {}; for (const [k, e] of Object.entries(raw)) lib[k] = unpack(e, inflate(b64(e.data)));
  addFuji(lib); return lib;
}
export async function loadLibrary(raw) {               // browser: native DecompressionStream, no dependencies
  const lib = {};
  await Promise.all(Object.entries(raw).map(async ([k, e]) => {
    const st = new Blob([b64(e.data)]).stream().pipeThrough(new DecompressionStream('deflate'));
    lib[k] = unpack(e, new Uint8Array(await new Response(st).arrayBuffer()));
  }));
  addFuji(lib); return lib;
}
// a faint Fuji drawn procedurally straight onto the art grid: concave flanks, snow cap, dissolving base
function addFuji(lib) {
  for (const [name, w] of [['fuji', 104], ['fuji_m', 76]]) {
    const h = Math.round(w * .34), d = new Float32Array(w * h), a = new Float32Array(w * h), R = rng(hash('fuji', w));
    const notch = Array.from({ length: w }, () => R());
    for (let x = 0; x < w; x++) {
      const t = Math.abs((x + .5) / w * 2 - 1), prof = Math.min(.92, Math.pow(1 - t, 1.7) * 1.05);   // flat crater top
      const top = h * (1 - prof);
      for (let y = 0; y < h; y++) {
        const inside = Math.min(1, Math.max(0, (y - top) + 1));
        if (!inside) continue;
        const depth = (y - top) / h, snowLine = .2 + .08 * Math.sin(x * .9) + .05 * notch[x];
        const fade = Math.pow(Math.min(1, (h - 1 - y) / (h * .55)), 1.2);                         // base sinks into mist
        const lit = (x + .5) / w < .5 ? .7 : 1;                                                     // light from the left
        const ink = depth < snowLine ? .06 : (.22 + .3 * Math.min(1, (depth - snowLine) * 3)) * lit;
        a[y * w + x] = inside * fade; d[y * w + x] = Math.min(a[y * w + x], ink * fade + (depth < snowLine + .02 && depth > snowLine - .02 ? .12 : 0) * fade);
      }
    }
    lib[name] = finish({ w, h, kind: 'fuji', d, a });
  }
}

// ====================================================================== ART FIELD
// round 13 trees: the only tree sprites (Tiago kept the 4 largest). Old tree slots (pines_m, pinecrag_s, ...) borrow
// a kept tree's size for their slot maths only; nothing is ever drawn at another size.
export const KEPT_TREES = ['pinecrag3', 'pinecrag', 'pinecrag2', 'pines'];
const TREE_P = .3, TREE_GAP = 290;              // a regular tree pick survives 30% of the time; trees >= 290 art rows apart (> a screen)
function treeLib(lib) { const L = Object.create(lib); for (const f of ['pines', 'pinecrag']) for (const z of ['_m', '_s']) if (!lib[f + z]) L[f + z] = lib[f]; return L; }
const LEVELS = ['lake', 'lowland', 'cliffs', 'peaks'];
const smooth = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
function vnoise(seed, x) { const i = Math.floor(x), f = x - i, h = k => (hash(seed, k) & 0xffff) / 0xffff; return h(i) + (h(i + 1) - h(i)) * smooth(f); }
const fbm = (seed, x) => .6 * vnoise(seed, x) + .3 * vnoise(seed + 1, x * 2.3) + .1 * vnoise(seed + 2, x * 5.1);
const WASH = .022;                                                 // the faint grey belly of a cloud bank
const TONE = [[.26, .34], [.46, .56], [.7, .82]];                // far -> near: depth is opacity (3 layers, no near-black)
export class ArtField {
  constructor(seed, lib) {
    if (!lib) throw new Error('ArtField needs the sprite library (decodeLibrary / loadLibrary)');
    this.seed = seed; this.lib = lib; this.rows = []; this.regions = []; this.items = []; this.banks = []; this.top = 0;
  }
  row(r) { while (this.rows.length <= r) this.rows.push(new Float32Array(AW)); return this.rows[r]; }
  ink(x, r) { return r < 0 || r >= this.rows.length || x < 0 || x >= AW ? 0 : this.rows[r][x]; }
  get height() { return this.rows.length; }
  ensure(r) { while (this.top <= r) this.genRegion(); }          // rows < this.top are final
  genRegion() {
    const k = this.regions.length, R = rng(hash(this.seed, 'region', k)), prev = this.regions[k - 1];
    let lv;
    // a gentle walk lake <-> lowland <-> cliffs <-> peaks, one step at a time, leaning towards the mountains
    if (!prev) lv = 2;
    else if (prev.lv === 0) lv = 1; else if (prev.lv === 3) lv = 2;
    else if (prev.lv === 1) lv = R() < .7 ? 2 : 0;
    else lv = R() < .5 ? 3 : 1;
    const len = Math.round([[200, 280], [230, 320], [300, 420], [380, 540]][lv].reduce((a, b) => a + (b - a) * R()));
    const reg = { k, lv, level: LEVELS[lv], y0: this.top, y1: this.top + len, items: [], banks: [] };
    this.regions.push(reg); this.top = reg.y1;
    this.plan(reg, R);
    for (let layer = 0; layer < TONE.length; layer++) {
      for (const it of reg.items) if (it.layer === layer) this.stamp(it, reg.y0);
      for (const b of reg.banks) if (b.layer === layer) this.mist(b, reg.y0);
    }
    this.items.push(...reg.items); this.banks.push(...reg.banks);
  }
  // ---- what goes in a region: long-lived landform, beats on alternating sides, children anchored to parents
  plan(reg, R) {
    const { lv, y0, y1 } = reg, len = y1 - y0, L = this.treeLib || (this.treeLib = treeLib(this.lib));
    const base = n => n.replace(/_[ms]$/, ''), recent = this.recent || (this.recent = []);
    const pick = a => a[Math.floor(R() * a.length)];
    const pickNew = a => {                        // big forms never repeat back to back (across regions too)
      const ok = a.filter(n => !recent.includes(base(n))), nm = pick(ok.length ? ok : a);
      recent.push(base(nm)); if (recent.length > 6) recent.shift(); return nm;
    };
    const tone = layer => TONE[layer][0] + (TONE[layer][1] - TONE[layer][0]) * R();
    // round 13 trees: only 4 painted trees exist (KEPT_TREES, full size). Every old tree pick ('pines', 'pinecrag' and
    // their _m/_s) is mapped onto them on the trees' OWN stream (TV) and re-centred on its slot, and most picks become
    // GHOSTS: they still draw from the main stream R exactly as before (so every mountain, waterfall and mist bank is
    // unchanged) but are never stamped, nor are their grass tufts. Trees are rare (TREE_P) and never two per screen.
    const TV = rng(hash(this.seed, 'treevar', reg.k)), spans = this.treeSpans || (this.treeSpans = []);
    const variant = name => { const m = /^(pines|pinecrag)(_[ms])?$/.exec(name); return !m ? name : m[1] === 'pines' ? 'pines' : ['pinecrag', 'pinecrag2', 'pinecrag3'][Math.floor(TV() * 3)]; };
    const treeOK = (b, h, p = TREE_P) => TV() < p && spans.every(([a, z]) => b > z + TREE_GAP || b + h < a - TREE_GAP);
    const put = (name, x, base, layer, extra = {}) => {
      const tree = !extra.exact && /^(pines|pinecrag)(_[ms])?$/.test(name);
      const vn = extra.exact ? name : variant(name); if (vn !== name) { x += (L[name].w - L[vn].w) / 2; name = vn; }
      delete extra.exact;
      const s = L[name]; base = Math.max(y0, Math.round(base));
      const it = { name, kind: s.kind, x: Math.round(x), base, w: s.w, h: s.h, layer, tone: extra.tone ?? tone(layer), flip: extra.flip ?? R() < .5, region: reg.k, ...extra };
      if (tree && !it.ghost) { if (treeOK(it.base, s.h)) spans.push([it.base, it.base + s.h]); else it.ghost = 1; }
      if (!it.ghost) reg.items.push(it); return it;
    };
    const bank = (yc, hh, s, layer, extra = {}) => reg.banks.push({ yc: Math.round(yc), hh, s, layer, key: hash(this.seed, 'bank', reg.k, reg.banks.length), region: reg.k, ...extra });
    const edgeX = (w, side, inset = .3) => side < 0 ? -w * inset * R() - w * .08 : AW - w + w * inset * R() + w * .08;
    const anyX = w => -w * .25 + R() * (AW - w * .5);
    // children: tufts of grass where a parent touches the ground; a hut on a rock; never floating
    const foot = (p, name, side) => {
      const s = L[p.name], cols = []; for (let x = 0; x < s.w; x++) if (s.foot[x] >= 0) cols.push(x);
      if (!cols.length) return;
      const c = side < 0 ? cols[Math.floor(cols.length * (.05 + .25 * R()))] : cols[Math.floor(cols.length * (.7 + .25 * R()))];
      const cx = p.flip ? s.w - 1 - c : c, g = L[name];
      const it = put(name, p.x + cx - g.w / 2, p.base + s.foot[c] - 1, p.layer, { tone: p.tone, parent: p.name, ...(p.ghost ? { ghost: 1 } : {}) });
      if (!it.ghost && (it.x + g.w < 0 || it.x > AW)) reg.items.pop();
    };
    // foothill trees (round 13): now and then a painted pine nestles at the foot of a mountain or waterfall, overlapping
    // its lower slope with its own base sunk in the parent's misty fade. Own RNG stream (FR): never touches R.
    const FR = rng(hash(this.seed, 'foothill', reg.k));
    const foothill = (p, chance) => {
      if (!(p.kind === 'peak' || p.kind === 'cliff') || FR() >= chance) return;
      const s = L[p.name]; if (s.w < 60) return;
      const cols = []; for (let x = 0; x < s.w; x++) if (s.foot[x] >= 0) cols.push(x);
      if (!cols.length) return;
      const fit = KEPT_TREES.filter(n => L[n].h <= s.h * .8 && L[n].w <= s.w * 1.1), k = FR();   // never taller than its hill
      if (!fit.length) return;
      const nm = fit[Math.floor(k * fit.length)], g = L[nm], left = FR() < .5;
      const c = cols[Math.floor(cols.length * (left ? .08 + .27 * FR() : .65 + .27 * FR()))], cx = p.flip ? s.w - 1 - c : c;
      const base = p.base + s.foot[c] - g.h * (.1 + .12 * FR());             // tree foot sinks into the slope's misty fade
      const tn = p.tone * (.86 + .1 * FR()), fl = FR() < .5, b0 = Math.max(y0, Math.round(base));
      if (!treeOK(b0, g.h, 1)) return;                                         // rarity is the caller's chance; here only spacing
      const it = put(nm, p.x + cx - g.w * (left ? .6 : .4), base, p.layer, { tone: tn, flip: fl, parent: p.name, foothill: 1, exact: 1 });
      if (it.x + g.w < 8 || it.x > AW - 8) reg.items.pop(); else spans.push([it.base, it.base + g.h]);
    };
    const grass = (p, n = 1 + (R() < .5)) => { for (let i = 0; i < n; i++) foot(p, pick(['grass1', 'grass2', 'grass1_m', 'grass2_m']), i ? -1 : 1); };
    // the poem pockets: broad open cloud banks where the poems settle
    const pockets = []; let longGap = R() < .5;      // gaps alternate short / long
    for (let y = y0 + 40 + R() * 50; y < y1 - 20; y += (longGap = !longGap) ? 150 + R() * 25 : 85 + R() * 15) pockets.push({ y, hh: 36 + R() * 8 });
    const far = () => {
      if (R() < (lv <= 1 ? .3 : .12)) put(pick(['fuji', 'fuji_m']), 10 + R() * (AW - 110), y0 + len * (.25 + .4 * R()), 0, { tone: .2 + .08 * R() });
      else { const nm = pick(['range', 'range_m', 'layers', 'layers_m']); put(nm, anyX(L[nm].w) * .6 - 10, y0 + len * (.15 + .5 * R()), 0); }
      if (lv >= 1 && R() < .75) { const nm = pickNew(['peaks_s', 'spire1_s', 'spire2_s', 'range_m', 'haboku_s', 'twinpeaks_s', 'spires_s', 'misthills_s']); put(nm, anyX(L[nm].w), y0 + len * (.5 + .4 * R()), 0); }
      for (let y = y0 + 25 + R() * 40; y < y1 - 20; y += 80 + R() * 60) bank(y, 14 + R() * 12, .45 + .2 * R(), 0);
    };
    let side = R() < .5 ? -1 : 1;
    far();
    if (lv >= 2) {                                   // mountains: overlapping ranks of peaks swimming in cloud
      const mids = lv === 3 ? ['spire1_m', 'spire2_m', 'peaks_m', 'haboku_m', 'twinpeaks_m', 'spires_m', 'misthills_m', 'spire1_s', 'spire2_s', 'spires_s']
        : ['spire1_s', 'spire2_s', 'peaks_s', 'haboku_s', 'twinpeaks_s', 'misthills_s', 'pagoda_m', 'falls_m', 'ribbonfalls_m', 'cascade_m', 'pinecrag_s'];
      const n1 = Math.max(3, Math.round(len / 100));             // round 13: bigger forms, fewer of them
      for (let i = 0; i < n1; i++) { const nm = pickNew(mids); foothill(put(nm, anyX(L[nm].w), y0 + (i + R() * .7) * len / n1, 1), .14); }
      for (let y = y0 + 20 + R() * 30; y < y1 - 10; y += 90 + R() * 50) bank(y, 16 + R() * 14, .5 + .2 * R(), 1);
      const n2 = Math.max(2, Math.round(len / (lv === 3 ? 150 : 135)));
      const nears = lv === 3 ? ['spire1', 'spire2', 'peaks', 'falls', 'haboku', 'twinpeaks', 'spires', 'ribbonfalls', 'cascade', 'spire1_m', 'spire2_m']
        : ['falls', 'ribbonfalls', 'cascade', 'cliffalls', 'pagoda', 'spire2', 'haboku_m', 'twinpeaks_m', 'pinecrag', 'falls_m', 'pagoda_m', 'cascade_m'];
      for (let i = 0; i < n2; i++, side = -side) {
        const nm = pickNew(nears), w = L[nm].w;
        const it = put(nm, w > 100 ? anyX(w) : edgeX(w, side, .35), y0 + 10 + (i + R() * .5) * len / n2, 2);
        if (it.kind === 'crag') grass(it, 1);
        foothill(it, .5);
      }
      for (let y = y0 + 10 + R() * 40; y < y1; y += 100 + R() * 60) bank(y, 16 + R() * 16, .5 + .15 * R(), 2);
      for (let i = 0, ns = 1 + (len > 420); i < ns; i++) bank(y0 + len * ((i + .3 + .4 * R()) / ns), 24 + R() * 12, .82 + .1 * R(), 2, { sea: 1 });
    } else if (lv === 1) {                            // lowland: groves, huts, steps, rocks, open paper
      const beats = Math.max(3, Math.round(len / 95));
      for (let i = 0; i < beats; i++, side = -side) {
        const base = y0 + 8 + (i + R() * .5) * len / beats, r = R();
        if (i === 0 || r < .5) { const nm = pickNew(['pines_s', 'pinecrag_s', 'misthills_s', 'rocks_s', 'spire2_s', 'cascade_m', 'haboku_s']); put(nm, edgeX(L[nm].w, -side, .2) * .9 + (side < 0 ? 20 : -20), base + 30, 1); }
        const nm = pickNew(['pines', 'pines_m', 'hut', 'rocks', 'pinecrag_m', 'cascade_m', 'ribbonfalls_m', 'pagoda_m']);
        const it = put(nm, edgeX(L[nm].w, side, .25), base, 2, { flip: side > 0 });
        if (it.kind !== 'cliff' && it.kind !== 'hut') grass(it); else if (it.kind === 'hut') grass(it, 1);
        if (it.kind === 'rock' && R() < .5) { const h = put('hut_m', it.x + (it.w - L.hut_m.w) / 2, it.base + 4, 2, { tone: it.tone, parent: it.name }); grass(h, 1); }
      }
      for (let y = y0 + 30 + R() * 30; y < y1 - 10; y += 80 + R() * 50) bank(y, 12 + R() * 12, .45 + .2 * R(), 1);
    } else {                                         // lake: wide calm water, a boat or two, a hut by the water
      { const nm = pickNew(['peaks_s', 'spire2_s', 'spire1_s', 'twinpeaks_s', 'misthills_s', 'haboku_s']); put(nm, anyX(L[nm].w), y0 + len * (.45 + .3 * R()), 1); }   // far shore peaks
      for (let i = 0, nb = 1 + (R() < .6); i < nb; i++) put(pick(i ? ['boat1_m', 'boat2_m'] : ['boat1', 'boat2']), 18 + R() * (AW - 60), y0 + len * (.2 + .6 * R()), i ? 1 : 2, { flip: R() < .5 });
      const nm = pickNew(['rocks', 'rocks_m', 'pinecrag_s', 'hut_m']), it = put(nm, edgeX(L[nm].w, side, .3), y0 + 6 + R() * 30, 2, { flip: side > 0 }); grass(it, 1);
      for (let y = y0 + 20 + R() * 30; y < y1 - 10; y += 55 + R() * 40) bank(y, 10 + R() * 10, .5 + .2 * R(), 1, { wide: 1 });
    }
    // pockets of open sky: the broad cloud banks where poems settle
    for (const p of pockets) bank(p.y, p.hh, .74 + .1 * R(), 2, { pocket: 1 });
  }
  stamp(it, y0) {
    const s = this.lib[it.name], t = it.tone, ca = Math.min(1, t * 1.35);
    for (let sy = 0; sy < s.h; sy++) {
      const r = it.base + (s.h - 1 - sy); if (r < y0) continue;
      const row = this.row(r);
      for (let sx = 0; sx < s.w; sx++) {
        const x = it.x + sx; if (x < 0 || x >= AW) continue;
        const i = sy * s.w + (it.flip ? s.w - 1 - sx : sx), a = s.a[i] * ca; if (a <= 0) continue;
        row[x] = row[x] * (1 - a) + s.d[i] * t;
      }
    }
  }
  // a mist bank: a broad horizontal swathe with billowing, noisy upper and lower edges that erases ink behind it
  mist(b, y0) {
    const { yc, hh, s, key } = b, tilt = b.tilt || 0, bow = b.bow || 0, taper = b.taper || 0;
    const C = new Float32Array(AW), T = new Float32Array(AW), B = new Float32Array(AW), S = new Float32Array(AW), Hx = new Float32Array(AW);
    const lat = b.pocket || b.sea || tilt ? 0 : (key >>> 3) % 3, var_ = b.pocket ? .08 : .25, ed = b.pocket ? .4 : .55;  // lat: 0 full width, 1/2 thinning to one side
    const lo = b.pocket ? .68 : .35, sp = b.pocket ? .32 : .6;   // pockets keep a guaranteed clear core
    let top = -1e9, bot = 1e9;
    for (let x = 0; x < AW; x++) {
      const u = x / AW, tp = taper > 0 ? u : taper < 0 ? 1 - u : 1;
      Hx[x] = hh * (taper ? .35 + .65 * smooth(tp * 1.4) : 1);
      C[x] = yc + tilt * (x - AW / 2) + bow * Math.sin(Math.PI * u);
      T[x] = C[x] + Hx[x] * (lo + sp * fbm(key, x / 14)); B[x] = C[x] - Hx[x] * (lo + sp * .85 * fbm(key + 7, x / 18));
      S[x] = s * (1 - var_ + var_ * fbm(key + 13, x / 30)) * (lat === 1 ? .55 + .45 * smooth(u * 1.6) : lat === 2 ? .55 + .45 * smooth((1 - u) * 1.6) : 1) * (taper ? smooth(tp * 2.2) : 1);
      top = Math.max(top, T[x]); bot = Math.min(bot, B[x]);
    }
    for (let r = Math.max(y0, Math.floor(bot)); r <= Math.ceil(top); r++) {
      const row = this.row(r);
      for (let x = 0; x < AW; x++) {
        const h = Hx[x], f = smooth((T[x] - r) / (h * ed)) * smooth((r - B[x]) / (h * ed)); if (f <= 0) continue;
        const v = row[x] * (1 - S[x] * f), w = WASH * S[x] * f * smooth((T[x] - r) / h) * (1 - smooth((r - B[x]) / (h * 1.2)) * .6);
        row[x] = v + w * (1 - v);
      }
    }
  }
}

// ====================================================================== PAINTING
// Ink buffer -> RGBA at art resolution: a dozen ink levels with a 4x4 Bayer dither on the same grid, ink colour
// with alpha (transparent where there is no ink, so the paper texture under the canvas shows through).
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + .5) / 16);
// The levels are spaced on a curve (fine steps in the pale end, coarser in the dark), so faint mist and cloud
// bellies dither as a smooth haze instead of a sparse lattice of grey dots.
export const INK_LEVELS = 12, INK_RGB = [26, 24, 29], RAMP = .62;
export function paintRows(field, r0, rows, data) {     // data: Uint8ClampedArray(AW*rows*4), top row = highest art row
  for (let py = 0; py < rows; py++) {
    const r = r0 + rows - 1 - py, src = r >= 0 && r < field.rows.length ? field.rows[r] : null;
    for (let x = 0; x < AW; x++) {
      const v = src ? src[x] : 0, o = (py * AW + x) * 4;
      const q = Math.min(INK_LEVELS, Math.floor(Math.pow(Math.min(1, v * 1.04), RAMP) * INK_LEVELS + BAYER[(r & 3) * 4 + (x & 3)]));
      data[o] = INK_RGB[0]; data[o + 1] = INK_RGB[1]; data[o + 2] = INK_RGB[2]; data[o + 3] = Math.round(Math.pow(q / INK_LEVELS, 1 / RAMP) * 238);
    }
  }
}

// ====================================================================== POEMS ON THE SCROLL
// Poems are placed in rows that are already final, onto mist or open paper, judged on the very ink buffer that is
// painted (so what the reader sees is what placement saw). Units: scroll units; art rows are PX units tall.
const RECT_PAD = 10;
export class ScrollComposer {
  constructor({ seed = 575, lib } = {}) {
    this.seed = seed; this.art = new ArtField(seed, lib); this.poems = []; this.rects = []; this.prevTop = 30; this.n = 0;
  }
  get height() { return Math.ceil(((this.poems.length ? this.prevTop : 120) + 240) / PX) * PX; }
  clear(x, y, w, h, pad, own) { return !this.rects.some(r => r !== own && x < r.x + r.w + pad && x + w > r.x - pad && y < r.y + r.h + pad && y + h > r.y - pad); }
  addPost(post) {
    const n = post.seq > 0 ? (this.n = Math.max(this.n, post.seq), post.seq) : ++this.n, R = rng(hash(this.seed, 'poem', n, post.id)), style = poemStyle(this.seed, n, post.id), A = this.art;
    if (this.lastAlign) style.align = ALIGNS[(ALIGNS.indexOf(this.lastAlign) + 1 + (hash(this.seed, 'realign', n, post.id) % 2)) % 3];   // never the same twice running
    this.lastAlign = style.align; style.sealOrder = sealOrder(n, post.id, this.lastSealPos); style.sealAvoid = this.lastSealPos;
    const layouts = poemLayouts(post, n, style); this.lastSealPos = layouts[0].sealPos;
    const gap = 120 + R() * 130, jx = R();          // about two poems to a phone screen, irregular rhythm
    let best = null;
    for (let span = 500; !best && span <= 500 * 16; span *= 2) {
      const r0 = Math.ceil((this.prevTop + gap) / PX), r1 = r0 + Math.ceil(span / PX), PAD = 10;
      A.ensure(r1 + 80);
      const base = r0 - PAD, H = r1 - r0 + 2 * PAD + 60, W = AW, sat = () => new Float64Array((H + 1) * (W + 1));
      const S1 = sat(), S2 = sat(), SD = sat(), SR = sat();   // ink>.3, ink>.6, sum ink, ring ink>.18
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const d = A.ink(i, base + j), p = (j + 1) * (W + 1) + i + 1;
        const add = (T, v) => { T[p] = v + T[p - 1] + T[p - W - 1] - T[p - W - 2]; };
        add(S1, d > .3 ? 1 : 0); add(S2, d > .6 ? 1 : 0); add(SD, d); add(SR, d > .18 ? 1 : 0);
      }
      const sum = (T, i0, j0, i1, j1) => { i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(W, i1); j1 = Math.min(H, j1); if (i1 <= i0 || j1 <= j0) return 0; return T[j1 * (W + 1) + i1] - T[j0 * (W + 1) + i1] - T[j1 * (W + 1) + i0] + T[j0 * (W + 1) + i0]; };
      for (const L of layouts) {
        const bw = Math.ceil(L.w * L.u / PX), bh = Math.ceil(L.h * L.u / PX), area = bw * bh, BW = bw * PX;
        const tx = L.align === 'left' ? 12 + jx * 50 : L.align === 'right' ? SCROLL_W - 12 - BW - jx * 50 : (SCROLL_W - BW) / 2 + (jx - .5) * 36;
        for (let r = r0; r <= r1; r++) {
          const j = r - base, y = r * PX;
          if (!this.clear(0, y, SCROLL_W, bh * PX, RECT_PAD + 30)) continue;
          for (let c = 2; c + bw <= AW - 2; c++) {
            if (sum(S2, c, j, c + bw, j + bh)) continue;                          // never over strong ink
            const d1 = sum(S1, c, j, c + bw, j + bh); if (d1 > area * .06) continue;     // a whisper of overlap is fine
            const mean = sum(SD, c, j, c + bw, j + bh) / area; if (mean > .14) continue;
            const RG = 6, ringA = (bw + 2 * RG) * (bh + 2 * RG) - area, host = sum(SR, c - RG, j - RG, c + bw + RG, j + bh + RG) / ringA;
            const x = c * PX;
            const s = -6 * mean - 8 * d1 / area + 1.5 * Math.min(host, .25) - (y - this.prevTop - gap) / 700 - Math.abs(x - tx) / 110 + R() * .04;
            if (!best || s > best.s) best = { s, L, x, y, bw, bh, d1 };
          }
        }
      }
    }
    if (!best) { const L = layouts[0]; best = { L, x: 6, y: Math.ceil((this.prevTop + gap) / PX) * PX, bw: Math.ceil(L.w * L.u / PX), bh: Math.ceil(L.h * L.u / PX), d1: 99, fallback: true }; }
    const { L, x, y, bw, bh } = best, W = bw * PX, Hh = bh * PX;
    const poem = { n, post, x, y, w: W, h: Hh, layout: L, overlap: best.d1, score: best.s, fallback: !!best.fallback };
    this.rects.push(poem); this.prevTop = y + Hh;
    this.poems.push(poem);
    A.ensure(Math.ceil((this.height + 900) / PX));
    return { poem };
  }
}

// ====================================================================== SKY LANES (round 13 birds)
// Where a flight of birds should cross the visible part of the scroll: a gently sloped lane through the emptiest
// paper (judged on the very ink buffer that is painted), preferring open sky with ink BELOW it (above the mountains)
// and keeping clear of poem boxes. Pure function (Node-testable). Units: scroll units, y up from the scroll bottom.
// rects: [{x, y, w, h}] (the composer's poems). Returns lanes sorted best first: {y, slope, cost, ink, poem}.
export function skyLanes(field, rects, yLo, yHi, { band = 54, slopes = [-.22, -.12, 0, .12, .22] } = {}) {
  const out = [], inkAt = (x, y) => field.ink(Math.floor(x / PX), Math.floor(y / PX));
  for (let yc = yLo + band; yc <= yHi - band; yc += 9) for (const slope of slopes) {
    let ink = 0, below = 0, poem = 0, n = 0;
    for (let x = 6; x < SCROLL_W; x += 12) {
      const y = yc + slope * (x - SCROLL_W / 2); n++;
      for (let d = -band / 2; d <= band / 2; d += 6) ink += inkAt(x, y + d) / 10;
      for (let d = band / 2 + 6; d <= band * 2; d += 12) below += inkAt(x, y - d) / 8;
      for (const p of rects) if (x > p.x - 14 && x < p.x + p.w + 14 && y + band / 2 > p.y - 10 && y - band / 2 < p.y + p.h + 10) { poem++; break; }
    }
    ink /= n; below /= n; poem /= n;
    out.push({ y: yc, slope, cost: ink * 3 + poem * 1.6 - Math.min(below, .3) * .5 + Math.abs(slope) * .05, ink, poem });
  }
  return out.sort((a, b) => a.cost - b.cost);
}
