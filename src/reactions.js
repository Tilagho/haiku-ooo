// Round 15.11: hold the poem body for an Inky speech-bubble reaction picker; the chosen glyph
// toggles that person's one reaction and the totals sit bare on the date line (no chips).
// Hold the number seal to report — that stays in src/report.js. Counts live in haiku-ooo Firestore
// (poemRx/{poemId} + poemRx/{poemId}/by/{uid}); see firestore.reactions.rules.
import { drawLine, font, measure, rng, hash, sealDims } from './brush-text.js';
import { signatureFor, sigAuthor, SCROLL_W } from './scroll-engine2.js?v=15.13';
import { renderBubble, U as BU } from './pixel-bubble.js';
import { LONG_PRESS_MS, LONG_PRESS_SLOP } from './moderation.js';
import {
  RX_ORDER, RX_LABEL, GLYPH_BOX, emptyCounts, hasReactions, nextKind, applyCounts, normalizeCounts,
  fitByline, rowFitScale, reactionScale, pickerScale, pickerGlyphOrigin, PICKER_CELL, poemZone,
} from './react-data.js?v=15.13';
import { loadSprites, sizeGlyph, trackGlyph, untrackGlyph, setGlyphMotion, GLYPH_PAD, GLYPH_PLAY_MS, planPlays } from './react-glyphs.js?v=15.12d';
import { sfx } from './sfx.js';

const INK = [86, 80, 88];   // the signature's own grey (scroll-view paintPoem)
const dateOf = post => signatureFor(post).slice(sigAuthor(post).length);

export function mountReactions({ feed, store, inky, inkyFree = () => false, reduced = false, busy = () => false, hush = () => {}, onFail = () => {}, onHoldPoem = () => {}, onDismissHold = () => {} } = {}) {
  if (!document.getElementById('rx-css')) { const st = document.createElement('style'); st.id = 'rx-css'; st.textContent = RX_CSS; document.head.appendChild(st); }
  setGlyphMotion(reduced);
  loadSprites();
  const counts = new Map(), mine = new Map(), pending = new Set();
  // Date-line motion. `settled` is the kinds already shown (null until the first measure: those stay idle).
  // `plays` is kind -> performance.now() deadline for the one-second place animation.
  const settled = new Map(), plays = new Map();
  function syncPlays(id, kinds) {
    const plan = planPlays(settled.has(id) ? settled.get(id) : null, kinds, performance.now(), { plays: plays.get(id) });
    settled.set(id, plan.seen);
    plays.set(id, plan.plays);
  }
  function glyphMode(id, kind) {
    const until = plays.get(id)?.get(kind) || 0;
    return until > performance.now() ? { loop: false, until } : 'idle';
  }
  function stampMotion(cv, mode) {
    if (mode === 'idle') { cv.dataset.motion = 'idle'; delete cv.dataset.until; }
    else { cv.dataset.motion = 'play'; cv.dataset.until = String(mode.until); }
  }
  const pop = document.createElement('div');
  pop.id = 'rx-pop'; pop.className = 'rx-pop'; pop.hidden = true;
  pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'react to this haiku');
  const bcv = document.createElement('canvas'); bcv.className = 'rx-bcv';
  const grid = document.createElement('div'); grid.className = 'rx-grid';
  pop.append(bcv, grid); document.body.appendChild(pop);

  const S = { picking: null, swallowUntil: 0, hold: null, armed: 0 };
  let popGen = 0;
  const io = new IntersectionObserver(es => {
    for (const e of es) e.target.querySelectorAll('.rx-g').forEach(cv => {
      if (e.isIntersecting) {
        if (!cv._rx && cv.dataset.kind) {
          const mode = cv.dataset.motion === 'play' ? { loop: false, until: +cv.dataset.until || 0 } : 'idle';
          trackGlyph(cv, cv.dataset.kind, +cv.dataset.phase || 0, mode);
        }
      } else untrackGlyph(cv);
    });
  }, { rootMargin: '240px 0px' });

  function baseLabel(el) {
    if (!el.dataset.label) el.dataset.label = (el.getAttribute('aria-label') || '').split(', hold')[0].split(', reactions:')[0];
    return el.dataset.label;
  }
  function composeLabel(el, c) {
    if (el.dataset.comment) {
      el.setAttribute('aria-label', baseLabel(el) + (el.dataset.reportable ? ', hold to report' : ''));
      return;
    }
    const bits = RX_ORDER.filter(k => (c?.[k] | 0) > 0).map(k => `${RX_LABEL[k]} ${c[k]}`).join(', ');
    let s = baseLabel(el);
    if (bits) s += `, reactions: ${bits}`;
    s += ', hold to react';
    if (el.dataset.reportable) s += ', hold the stamp to report';
    el.setAttribute('aria-label', s);
  }

  function renderRow(el) {
    const rec = feed.recOf(el), view = feed.viewOf(el);
    if (!rec || !view || !view.host.clientWidth) return;
    if (rec.post?.parentId) { composeLabel(el); return; }   // v1: no reaction glyphs on comments
    const id = rec.post.id, c = counts.get(id) || emptyCounts();
    composeLabel(el, c);
    const active = RX_ORDER.filter(k => (c[k] | 0) > 0);
    syncPlays(id, active);
    let row = el.querySelector(':scope > .rx-row');
    if (!hasReactions(c)) {
      if (row) { io.unobserve(row); row.querySelectorAll('.rx-g').forEach(untrackGlyph); row.remove(); }
      if (rec.sigText != null) { rec.sigText = null; view.paintPoem(rec); }
      return;
    }
    const L = rec.poem.layout, Sm = font('small');
    const sc = reactionScale(view.host.clientWidth, devicePixelRatio || 1);
    const fontPx = view.fontScale(L.u);
    const measureSm = t => measure(t, Sm);
    const sigRight = L.sig.x + measure(signatureFor(rec.post), Sm);
    const date = dateOf(rec.post), dateW = measure(date, Sm);
    const s = view.host.clientWidth / SCROLL_W || 1;
    const pr = el.getBoundingClientRect();
    // The poem bitmap does not clip. The scroll layer and the viewport do — measure those.
    // Glyphs sit left of the whole signature+date block, or right of it when the left side
    // would leave the screen or land on this poem's number seal. They never sit between the name and the date.
    const clip = el.closest('.art-layer')?.getBoundingClientRect();
    const viewL = Math.max(2, clip ? clip.left : 0);
    const viewR = Math.min(innerWidth - 2, clip ? clip.right : innerWidth);
    const toFont = screen => (screen - pr.left) / (fontPx * s) - rec.pad;
    // The number seal's layout rect is off-limits for faces and counts. fitByline still
    // prefers the left of the glued signature+date block, and still flips or scales to
    // stay on screen — a side that would paint on the seal is not a fit.
    const [sealW, sealH] = sealDims(rec.poem.n);
    const fit = fitByline({
      counts: c, author: sigAuthor(rec.post), date, scale: sc.fontPerArt,
      measure: measureSm, ascent: Sm.ascent, descent: Sm.descent,
      dateLeft: sigRight - dateW, dateRight: sigRight,
      leftLimit: toFont(viewL), rightLimit: toFont(viewR),
      sigY: L.sig.y,
      avoid: { x: L.seal.x, y: L.seal.y, w: sealW, h: sealH },
    });
    const { placed, layout } = fit;
    const key = [layout.side, layout.gaps.glyph, layout.gaps.kind, layout.gaps.date, layout.kinds.join('.'), layout.kinds.map(k => c[k]).join('.'), sc.rk, fontPx.toFixed(4)].join('|');
    if (!row) { row = document.createElement('div'); row.className = 'rx-row'; el.appendChild(row); io.observe(row); }
    if (row.dataset.key !== key) {
      row.querySelectorAll('.rx-g').forEach(untrackGlyph);
      row.replaceChildren();
      const tx = document.createElement('canvas'); tx.className = 'rx-tx';
      tx.width = Math.max(1, layout.w); tx.height = Math.max(1, layout.h);
      tx.style.width = layout.w * fontPx + 'px'; tx.style.height = layout.h * fontPx + 'px';
      const ctx = tx.getContext('2d'), img = ctx.createImageData(tx.width, tx.height);
      const buf = { w: tx.width, h: tx.height, data: img.data }, R = rng(hash(id, 'rx'));
      for (const it of layout.items) if (it.type === 'text') drawLine(buf, it.t, it.x, it.y, Sm, R, { color: INK });
      ctx.putImageData(img, 0, 0); row.appendChild(tx);
      for (const it of layout.items) if (it.type === 'glyph') {
        const g = GLYPH_BOX[it.kind], cv = document.createElement('canvas');
        cv.className = 'rx-g'; cv.dataset.kind = it.kind;
        const mode = glyphMode(id, it.kind);
        // Phase cancels `now` so a play starts at frame 0 and a redraw mid-second does not jump back.
        const phase = mode === 'idle' ? 0 : -(mode.until - GLYPH_PLAY_MS);
        cv.dataset.phase = String(phase);
        stampMotion(cv, mode);
        sizeGlyph(cv, it.kind, sc.layer);
        cv.style.left = (it.x - (GLYPH_PAD + g.ox) * sc.fontPerArt) * fontPx + 'px';
        cv.style.top = (it.y - (GLYPH_PAD + g.oy) * sc.fontPerArt) * fontPx + 'px';
        row.appendChild(cv); trackGlyph(cv, it.kind, phase, mode);
      }
      row.dataset.key = key;
    }
    const span = toFont(viewR) - toFont(viewL);
    const visualW = layout.w + layout.bleedL + layout.bleedR;
    const rowScale = fit.scale != null ? fit.scale : rowFitScale(visualW, 0, span);
    const left = fit.scale != null ? placed.left : (rowScale === 1 ? placed.left : toFont(viewL) + layout.bleedL * rowScale);
    row.style.left = (left + rec.pad) * fontPx + 'px';
    row.style.top = (L.sig.y - layout.shift + rec.pad) * fontPx + 'px';
    row.style.transformOrigin = '0 0';
    row.style.transform = rowScale === 1 ? '' : `scale(${rowScale})`;
    if (rec.sigText !== '') { rec.sigText = ''; view.paintPoem(rec); }
  }

  function labelAll() {
    document.querySelectorAll('.poem').forEach(el => { if (feed.recOf(el)) composeLabel(el, counts.get(el.dataset.id)); });
  }
  let refreshP = null;
  function refresh() {
    labelAll();
    if (refreshP) return refreshP;
    refreshP = (async () => {
      const ids = [...document.querySelectorAll('.poem')].map(el => el.dataset.id).filter(Boolean);
      try {
        if (ids.length && store.reactionCounts) {
          const got = await store.reactionCounts(ids);
          for (const id of ids) if (!pending.has(id)) counts.set(id, normalizeCounts(got?.[id]));
        }
      } catch {}
      document.querySelectorAll('.poem').forEach(renderRow);
    })().finally(() => { refreshP = null; });
    return refreshP;
  }

  function placePop() {
    if (pop.hidden) return;
    const W = pop.offsetWidth, H = pop.offsetHeight, bw = Math.max(4, Math.round(W / BU)), bh = Math.max(4, Math.round(H / BU));
    const el = S.picking?.el;
    let hx, hy;
    if (S.picking?.poemAnchor && el) { const r = el.getBoundingClientRect(); hx = r.left + r.width * .45; hy = r.top + 6; }
    else { const p = inky.pos; hx = p.x; hy = p.top + 6; }
    let left = hx - W / 2, top = hy - H - 18, down = true;
    if (top < 8) { top = Math.min(hy + 22, innerHeight - H - 8); down = false; }
    left = Math.max(6, Math.min(innerWidth - W - 6, left));
    top = Math.max(6, Math.min(innerHeight - H - 8, top));
    left = Math.round(left / BU) * BU; top = Math.round(top / BU) * BU;
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
    const tipx = Math.max(4, Math.min(bw - 4, Math.round((hx - left) / BU)));
    const drawn = renderBubble(bcv, { bw, bh, tip: { x: tipx, y: down ? bh + 3 : -3 }, round: true });
    Object.assign(bcv.style, { left: drawn.ox * BU + 'px', top: drawn.oy * BU + 'px', width: drawn.W * BU + 'px', height: drawn.H * BU + 'px' });
  }

  function close({ light = true, placed = false } = {}) {
    if (!S.picking && pop.hidden) return;
    if (!S.picking) return;   // the fade from the first close is already running
    const shown = !pop.hidden;
    const gen = ++popGen;
    S.picking = null;
    inky?.holdBubble?.('picker', false);   // the bubble is leaving: he may patrol again
    if (shown && !placed) sfx('pickerBack');   // tap-out / escape / scroll. A placed (or cleared) kind keeps reactSay / poof only.
    if (!placed) onDismissHold();   // click-away / escape / scroll leaves comment mode; a placed face does not
    pop.classList.remove('show');
    const done = () => { if (gen !== popGen) return; pop.hidden = true; grid.querySelectorAll('.rx-g').forEach(untrackGlyph); grid.replaceChildren(); };
    if (light && !reduced && shown) pop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'steps(3, end)', fill: 'forwards' }).finished.then(done, done);
    else done();
  }

  async function open(el) {
    if (!el || busy() || !feed.recOf(el)) return;
    const gen = ++popGen;
    const rec = feed.recOf(el), id = rec.post.id;
    hush();
    const poemAnchor = !inkyFree();
    S.picking = { el, id, poemAnchor }; S.armed = performance.now() + 420; S.swallowUntil = performance.now() + 700;
    // His bubble, not the poem's: stop the roam slide before the picker is measured, and keep him there until close.
    inky?.holdBubble?.('picker', !poemAnchor);
    if (!poemAnchor) { try { inky.setMood('happy'); } catch {} }
    if (!rec.post?.parentId) onHoldPoem(rec.post);   // hold a top-level poem: the write button becomes "comment"
    try { await loadSprites(); } catch {}
    if (!mine.has(id) && store.myReaction) {
      try { mine.set(id, await Promise.race([store.myReaction(id), new Promise(r => setTimeout(() => r(mine.get(id) ?? null), 500))])); } catch {}
    }
    if (gen !== popGen || S.picking?.id !== id) return;
    const sc = pickerScale((feed.viewOf(el) || feed.main).host.clientWidth, devicePixelRatio || 1);
    const wide = innerWidth >= 840;
    grid.className = 'rx-grid' + (wide ? ' is-row' : '');
    if (wide) grid.style.removeProperty('--rx-cell');
    else grid.style.setProperty('--rx-cell', (PICKER_CELL * sc.css) + 'px');
    grid.querySelectorAll('.rx-g').forEach(untrackGlyph);
    grid.replaceChildren();
    const cur = mine.get(id) || null;
    for (const k of RX_ORDER) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'rx-btn' + (cur === k ? ' on' : '');
      b.dataset.kind = k; b.setAttribute('aria-label', RX_LABEL[k]); b.setAttribute('aria-pressed', cur === k ? 'true' : 'false');
      const cv = document.createElement('canvas'); cv.className = 'rx-g'; if (cur === k) cv.dataset.used = '1'; sizeGlyph(cv, k, sc.css);
      if (!wide) { const o = pickerGlyphOrigin(k, sc.css); cv.style.left = o.left + 'px'; cv.style.top = o.top + 'px'; }
      b.appendChild(cv); grid.appendChild(b); trackGlyph(cv, k, hash(id, k) % 800);
      b.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); if (performance.now() < S.armed) return; choose(id, el, k); });
    }
    pop.hidden = false; pop.style.width = pop.style.height = '';
    const bw = Math.max(4, Math.ceil(grid.offsetWidth / BU)), bh = Math.max(4, Math.ceil(grid.offsetHeight / BU));
    pop.style.width = bw * BU + 'px'; pop.style.height = bh * BU + 'px';
    pop.getAnimations?.().forEach(a => a.cancel()); pop.style.opacity = '1';
    placePop();
    sfx('pickerChime');   // the selection bubble is up. Choosing still plays reactSay / poof, not this.
    if (!reduced) pop.animate([{ transform: 'translateY(4px) scale(.92)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 160, easing: 'steps(3, end)' });
  }

  async function choose(id, el, kind) {
    const prev = mine.has(id) ? mine.get(id) : null;
    const next = nextKind(prev, kind);
    const before = { ...(counts.get(id) || emptyCounts()) };
    // Round 15.12d: the spell used to wait on store.react (a Firestore transaction), so the stamp spoke late.
    // Start it on the tap. The write stays async. A success does not spell again. Clearing still poofs only
    // after the delete lands — that path has no word to say, and a failed clear should stay silent.
    if (next) {
      const m = plays.get(id) || new Map();
      m.set(next, performance.now() + GLYPH_PLAY_MS);
      plays.set(id, m);
      sfx('reactSay', { kind: next });
    } else plays.get(id)?.delete(kind);
    pending.add(id); mine.set(id, next); counts.set(id, applyCounts(before, prev, next));
    renderRow(el); close({ light: true, placed: true });
    try {
      const res = await store.react(id, kind);
      mine.set(id, res.mine ?? null); counts.set(id, normalizeCounts(res.counts));
      if (!res.mine && !next) sfx('poof');
    } catch (err) {
      mine.set(id, prev); counts.set(id, before);
      if (next) plays.get(id)?.delete(next);
      // The optimistic row already marked `next` as seen. Put the previous kinds back so the
      // rollback does not treat them as newly placed and play them.
      settled.set(id, new Set(RX_ORDER.filter(k => (before[k] | 0) > 0)));
      onFail(err?.reason || 'could not react, try again');
    } finally { pending.delete(id); const node = document.querySelector(`.poem[data-id="${CSS.escape(id)}"]`); if (node) renderRow(node); }
  }

  function cancelHold() { if (!S.hold) return; clearTimeout(S.hold.t); S.hold.el.classList.remove('rx-holding'); S.hold = null; }
  document.addEventListener('pointerdown', e => {
    if (e.button > 0 || busy()) return;
    // A tap on the Comment button is not a dismiss. pointerdown fires before the button's click,
    // and that click is what opens compose (src/app.js writeTapped).
    if (S.picking && !e.target.closest?.('#rx-pop') && !e.target.closest?.('#fab')) { close({ light: true }); }
    const z = poemZone(e, feed); if (!z || z.stamp) return;
    if (z.comment) return;   // a reply is reported, not reacted to, and does not enter comment mode
    cancelHold();
    const x = e.clientX, y = e.clientY;
    S.hold = { el: z.el, x, y, pid: e.pointerId, t: setTimeout(() => {
      const h = S.hold; cancelHold(); if (!h) return;
      S.swallowUntil = performance.now() + 900; try { navigator.vibrate?.(10); } catch {}
      open(z.el);
    }, LONG_PRESS_MS) };
    z.el.classList.add('rx-holding');
  }, { passive: true });
  document.addEventListener('pointermove', e => { const h = S.hold; if (h && e.pointerId === h.pid && Math.hypot(e.clientX - h.x, e.clientY - h.y) > LONG_PRESS_SLOP) cancelHold(); }, { passive: true });
  for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, cancelHold, { passive: true });
  addEventListener('scroll', () => { cancelHold(); if (S.picking) close({ light: true }); }, { passive: true });
  document.addEventListener('click', e => { if (performance.now() < S.swallowUntil && e.target.closest?.('.poem')) { e.stopPropagation(); e.preventDefault(); S.swallowUntil = 0; } }, true);
  document.addEventListener('contextmenu', e => {
    const z = poemZone(e, feed); if (!z) return;
    e.preventDefault();
    if (z.stamp || z.comment || busy() || S.picking) return;
    cancelHold(); S.swallowUntil = performance.now() + 900; open(z.el);
  });
  addEventListener('keydown', e => { if (e.key === 'Escape' && S.picking) { e.preventDefault(); close({ light: true }); } }, true);
  addEventListener('resize', () => { if (S.picking) placePop(); document.querySelectorAll('.poem').forEach(renderRow); });

  return {
    refresh, renderRow, close, open: el => open(typeof el === 'string' ? document.querySelector(`.poem[data-id="${CSS.escape(el)}"]`) : el),
    get picking() { return S.picking; }, counts, mine,
  };
}

const RX_CSS = `
.rx-row { position: absolute; z-index: 4; pointer-events: none; }
/* The numeral shares the text canvas and paints above the face (round 15.12g). It sits
   under the glyph; this only keeps a falling drip from covering the digit. Clear pixels
   still show the glyph. */
.rx-row .rx-tx { display: block; image-rendering: pixelated; position: relative; z-index: 1; }
.rx-row .rx-g { position: absolute; z-index: 0; image-rendering: pixelated; pointer-events: none; }
.poem.rx-holding .pc, .poem.rpt-holding .pc { transform: scale(.965); }
.rx-pop { position: fixed; z-index: 80; display: grid; place-items: center; pointer-events: auto; touch-action: manipulation; }
.rx-pop[hidden] { display: none !important; }
.rx-pop .rx-bcv { position: absolute; z-index: 0; image-rendering: pixelated; pointer-events: none; }
.rx-grid { position: relative; z-index: 1; display: grid; gap: 4px; padding: 2px; grid-template-columns: repeat(3, auto); }
.rx-grid.is-row { grid-template-columns: repeat(6, auto); }
/* phone 2×3: one cell per face (the star's 17 art px), 2px gutters, 4px inset from the bubble ink */
.rx-grid:not(.is-row) { gap: 2px; padding: 4px; grid-template-columns: repeat(3, var(--rx-cell, 51px)); grid-template-rows: repeat(2, var(--rx-cell, 51px)); }
.rx-btn { display: grid; place-items: center; margin: 0; padding: 4px; border: 0; background: transparent; cursor: pointer;
  touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.rx-grid:not(.is-row) .rx-btn { position: relative; padding: 0; width: var(--rx-cell, 51px); height: var(--rx-cell, 51px); overflow: visible; }
.rx-grid:not(.is-row) .rx-btn .rx-g { position: absolute; }
/* round 15.12c: no tan selection square. The face already on the poem is greyed in paintGlyph (dataset.used). */
.rx-btn.on { background: transparent; }
.rx-btn:active { transform: translateY(2px); }
.rx-btn:focus-visible { outline: 3px solid #6b6670; outline-offset: -2px; }
.rx-btn .rx-g { image-rendering: pixelated; pointer-events: none; display: block; }
@media (prefers-reduced-motion: reduce) { .poem.rx-holding .pc { transform: none; } }
`;
