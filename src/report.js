// Round 15.6 (Tiago, t181u) + 15.6b (t183u): hold down on a user-submitted poem to report it. There is no report UI of
// its own: INKY asks ("report") in his speech bubble with a simple ✕ / ✔ inside it, so the whole flow is
// his (app.js `ask`). ✔ files the report; enough unique reporters (TAKEDOWN_REPORTS, src/moderation.js) take the poem
// down for everyone. Whoever reported it sees a plain 通報 ('reported') beside that poem's number seal, in the same
// face, size and grey as the 俳句の掲示板 at the top of the page, so they know they helped keep the scroll clean.
// Works across every block of the shared scroll (src/feed.js): `feed.recOf(el)` finds a poem in any of them.
// The long-press never fights the scroll: a finger that drifts LONG_PRESS_SLOP px, a pointercancel (the browser took
// the gesture for scrolling) or any scroll cancels it, and the tap-to-copy only happens when the hold did not fire.
import { TAKEDOWN_REPORTS, REPORT_MARK, LONG_PRESS_MS, LONG_PRESS_SLOP, deviceId, isReportable, ReportLedger } from './moderation.js';
import { sealDims } from './brush-text.js';
import { SCROLL_W } from './scroll-engine2.js';

// the header's 俳句の掲示板 (src/style.css .noren-head .jp): 18px DotGothic16, letter-spacing 6px, #4a4550
export const MARK_STYLE = { size: 18, spacing: 6, color: '#4a4550' };
const GAP = 6;                       // scroll units between the seal and the mark

// pure: where the mark goes, in the poem figure's own units. seal = {x, y, w, h}, mark = {w, h}, fig = {left, w} on the
// scroll (SCROLL_W wide). Beside the seal on the side AWAY from the words (a side seal already sits clear of them),
// else whichever side fits on the scroll, else just under the seal.
export function markSpot(sealPos, seal, mark, fig, W = SCROLL_W) {
  const y = seal.y + (seal.h - mark.h) / 2, right = seal.x + seal.w + GAP, left = seal.x - GAP - mark.w;
  const fits = x => fig.left + x >= 3 && fig.left + x + mark.w <= W - 3;
  const order = /^left/.test(sealPos) ? [left] : /^right/.test(sealPos) ? [right] : [right, left];
  for (const x of order) if (fits(x)) return { x, y, side: x === right ? 'right' : 'left' };
  return { x: Math.max(3 - fig.left, Math.min(W - 3 - fig.left - mark.w, seal.x + (seal.w - mark.w) / 2)), y: seal.y + seal.h + 4, side: 'below' };
}

export function mountReports({ feed, store, ask, reduced = false, onReported = () => {}, busy = () => false } = {}) {
  const ledger = new ReportLedger(), me = deviceId();
  if (!document.getElementById('rpt-css')) { const st = document.createElement('style'); st.id = 'rpt-css'; st.textContent = REPORT_CSS; document.head.appendChild(st); }
  const recOf = el => feed.recOf(el);
  const S = { asking: null, swallowUntil: 0, hold: null };
  const poemAt = e => { const el = e.target.closest?.('.poem'); return el && recOf(el) ? el : null; };

  // ---------- long-press (anywhere on the shared scroll: the newest block and every older one) ----------
  function cancelHold() { if (!S.hold) return; clearTimeout(S.hold.t); S.hold.el.classList.remove('rpt-holding'); S.hold = null; }
  document.addEventListener('pointerdown', e => {
    if (e.button > 0 || S.asking || busy()) return;
    const el = poemAt(e); if (!el || !isReportable(recOf(el)?.post)) return;
    cancelHold();
    const x = e.clientX, y = e.clientY;
    S.hold = { el, x, y, pid: e.pointerId, t: setTimeout(() => {
      const h = S.hold; cancelHold(); if (!h) return;
      S.swallowUntil = performance.now() + 900; try { navigator.vibrate?.(12); } catch {}
      open(el);
    }, LONG_PRESS_MS) };
    el.classList.add('rpt-holding');
  }, { passive: true });
  document.addEventListener('pointermove', e => { const h = S.hold; if (h && e.pointerId === h.pid && Math.hypot(e.clientX - h.x, e.clientY - h.y) > LONG_PRESS_SLOP) cancelHold(); }, { passive: true });
  for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, cancelHold, { passive: true });
  addEventListener('scroll', cancelHold, { passive: true });
  // the click that ends a long-press must not also copy the poem (capture: runs before the ScrollView's click)
  document.addEventListener('click', e => { if (performance.now() < S.swallowUntil && e.target.closest?.('.poem')) { e.stopPropagation(); e.preventDefault(); S.swallowUntil = 0; } }, true);
  // right-click / the keyboard's context-menu key / Android's own long-press event: Inky asks too (never the browser menu)
  document.addEventListener('contextmenu', e => {
    const el = poemAt(e); if (!el) return; e.preventDefault();
    if (S.asking || busy() || !isReportable(recOf(el)?.post)) return;
    cancelHold(); S.swallowUntil = performance.now() + 900; open(el);
  });

  // ---------- Inky asks ----------
  async function open(el) {
    const rec = recOf(el); if (!rec || S.asking) return null;
    const id = rec.post.id, already = ledger.has(id);
    const st = { el, id }; S.asking = st;
    el.classList.add('rpt-target');
    let yes = false;
    try { yes = await ask(el, { already, threshold: TAKEDOWN_REPORTS }); } finally { el.classList.remove('rpt-target'); }
    if (!yes || already) { S.asking = null; return { id, reported: false, already }; }
    let res;
    try { res = await store.report(id, { reporter: me }); }
    catch (err) { S.asking = null; onReported({ id, el, error: err?.reason || 'could not report, try again' }); return { id, reported: false, error: err }; }
    ledger.add(id); S.asking = null;
    if (res?.removed) await takeDown(el); else stampMark(el, { animate: true });
    onReported({ id, el, ...res });
    return { id, reported: true, ...res };
  }

  // ---------- the plain 通報 beside the number seal of a poem this device reported ----------
  function stampMark(el, { animate = false } = {}) {
    const rec = recOf(el); if (!rec) return null;
    let m = el.querySelector('.rpt-mark');
    if (!m) { m = document.createElement('span'); m.className = 'rpt-mark'; m.lang = 'ja'; m.textContent = REPORT_MARK; m.setAttribute('aria-hidden', 'true'); m.title = 'you reported this haiku (通報)'; el.appendChild(m); }
    placeMark(el, m, rec);
    el.dataset.reported = '1'; el.setAttribute('aria-label', (el.getAttribute('aria-label') || '').replace(/( · reported by you)?$/, ' · reported by you'));
    if (animate && !reduced) m.animate([{ transform: 'scale(2.2)', opacity: 0 }, { transform: 'scale(.9, 1.1)', opacity: 1, offset: .45 }, { transform: 'scale(1.06, .94)', offset: .7 }, { transform: 'none', opacity: 1 }], { duration: 360, easing: 'steps(6, end)' });
    return m;
  }
  function placeMark(el, m, rec = recOf(el)) {
    const view = feed.viewOf(el) || feed.main; if (!rec || !view) return;
    const L = rec.poem.layout, pad = rec.pad, c = view.fontScale(L.u), s = view.host.clientWidth / SCROLL_W || 1;
    // the layer is scaled by s, so 18 css px on screen = 18 / s units here (exactly the header's size on the phone)
    Object.assign(m.style, { fontSize: MARK_STYLE.size / s + 'px', letterSpacing: MARK_STYLE.spacing / s + 'px', marginRight: -MARK_STYLE.spacing / s + 'px' });
    const [sw, sh] = sealDims(rec.poem.n), seal = { x: (L.seal.x + pad) * c, y: (L.seal.y + pad) * c, w: sw * c, h: sh * c };
    const mark = { w: m.offsetWidth - MARK_STYLE.spacing / s, h: m.offsetHeight };
    const p = markSpot(L.sealPos, seal, mark, { left: el.offsetLeft, w: rec.W * c });
    Object.assign(m.style, { left: p.x + 'px', top: p.y + 'px' }); m.dataset.side = p.side;
  }
  const replaceAll = () => document.querySelectorAll('.poem .rpt-mark').forEach(m => placeMark(m.parentElement, m));
  addEventListener('resize', replaceAll); document.fonts?.ready?.then(replaceAll);

  // ---------- takedown: the poem soaks back into the paper and leaves the board ----------
  async function takeDown(el) {
    el.classList.add('rpt-gone'); el.style.pointerEvents = 'none';
    if (!reduced) await el.animate([{ opacity: 1, clipPath: 'inset(0 0 0 0)', filter: 'none' }, { opacity: .7, filter: 'grayscale(1) contrast(.6)', offset: .35 }, { opacity: 0, clipPath: 'inset(0 0 100% 0)', filter: 'grayscale(1) contrast(.4)' }],
      { duration: 900, easing: 'steps(9, end)', fill: 'forwards' }).finished.catch(() => {});
    removePoem(el);
  }
  function removePoem(el) { const view = feed.viewOf(el); if (view) { view.pix = view.pix.filter(a => a[0] !== el); view.byEl.delete(el); } el.remove(); }

  // marks for everything this device already reported (call after each block is painted)
  function markAll() {
    document.querySelectorAll('.poem').forEach(el => {
      const post = recOf(el)?.post; if (!isReportable(post)) return;
      if (!/hold to report/.test(el.getAttribute('aria-label') || '')) el.setAttribute('aria-label', el.getAttribute('aria-label') + ', hold to report');
      if (ledger.has(post.id) && !el.querySelector('.rpt-mark')) stampMark(el);
    });
  }
  const byId = id => document.querySelector(`.poem[data-id="${CSS.escape(id)}"]`);
  return { open: el => open(typeof el === 'string' ? byId(el) : el), get asking() { return S.asking; },
    markAll, stampMark, takeDown, ledger, deviceId: me, threshold: TAKEDOWN_REPORTS };
}

// injected by mountReports (tools/build-dist.mjs only ships stylesheets linked from index.html; no new root index.html)
const REPORT_CSS = `
/* round 15.6b: hold a user poem (Inky asks), the plain 通報 by the seal, the takedown (src/report.js) */
.poem .pc { transition: transform .48s steps(4, end); }
.poem.rpt-holding .pc { transform: scale(.965); }                      /* the hold squashes the paper a touch: something is coming */
.poem.rpt-target .pc { transform: scale(1.02); transition-duration: .12s; }
.poem .rpt-mark { position: absolute; z-index: 3; pointer-events: none; white-space: nowrap; transform-origin: 50% 50%;
  font-family: var(--text); font-weight: 400; line-height: 1; color: ${MARK_STYLE.color}; }
body.capture-clean .rpt-mark { visibility: visible; }
@media (prefers-reduced-motion: reduce) { .poem .pc { transition: none; } }
`;
