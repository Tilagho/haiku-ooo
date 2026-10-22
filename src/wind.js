// THE BOARD WIND (round 14): the noren's leaf-blower gust, for everything else on the board.
// Page scroll velocity -> the same signed gust as the noren (noren.js gustTarget / stepGust: + = scrolled down = blows
// RIGHT, - = up = blows LEFT, |g| <= 1.3, fast attack, slow release), simulated here on its own so it keeps blowing
// when the noren is scrolled out of sight. The gust travels DOWN the screen: things lower on the screen get it a few
// frames later (gustHist), like the noren's flags one after another.
//   the write-scroll button: mountScrollButton({ wind }) leans / lifts / ripples the WHOLE button (rolls + paper)
//   the poem scrolls: each visible poem sways downwind and lifts a hair, in WHOLE font pixels (CSS `translate`, which
//   composes with any running animation): text stays crisp and readable, no resampling blur, much subtler than the noren.
// Reduced motion: the gust is scaled to .15 (a mild lean at most). Hooks: HB.wind.gust(v) injects a scroll velocity.
// Round 14.1, SMOOTHER on fast up/down scrolling: the scroll velocity is low-passed (WIND_TAU, ~150 ms), and the gust
// follows its target on a slightly over-damped spring (WIND_OMEGA, WIND_DAMP > 1) whose rate is slew-limited
// (WIND_SLEW per second), so a reversal swings smoothly through centre instead of snapping, and never buzzes. Same
// target (noren.js gustTarget: same strength), so a steady scroll still blows just as hard. The noren keeps its own
// leaf-blower gust (stepGust) untouched.
import { clock } from './clock.js';
import { gustTarget } from './noren.js';

export const WIND_TAU = .15, WIND_OMEGA = 13, WIND_DAMP = 1.15, WIND_SLEW = 6.5;
// one 1/60 s step of the board wind (pure: tested): low-pass the scroll velocity, then a damped, slew-limited follow
export function stepWind(W, h) {
  W.vf = (W.vf || 0) + ((W.gustIn || 0) - (W.vf || 0)) * (1 - Math.exp(-h / WIND_TAU));
  W.gustIn = (W.gustIn || 0) * Math.exp(-h * 9);                                     // scroll input fades if no new scroll events
  const tgt = gustTarget(W.vf) * (W.gustScale ?? 1), g = W.gust || 0;
  let gv = (W.gv || 0) + (WIND_OMEGA * WIND_OMEGA * (tgt - g) - 2 * WIND_DAMP * WIND_OMEGA * (W.gv || 0)) * h;
  gv = Math.max(-WIND_SLEW, Math.min(WIND_SLEW, gv));
  W.gv = gv; W.gust = g + gv * h;
  if (!W.gustHist) W.gustHist = new Float32Array(64);
  W.gustHist.copyWithin(1, 0); W.gustHist[0] = W.gust;
}
export const POEM_SWAY = 1.8, POEM_LIFT = 1, POEM_FLUTTER = .9, LAG_FRAMES = 24;
// a poem's offset in font px for a gust g at time t (pure: tested). Integer steps only.
export function poemOffset(g, t, phase = 0) {
  const a = Math.abs(g), fl = a > .25 ? Math.sin(t * 8.5 + phase) * (a - .25) * POEM_FLUTTER : 0;
  return { x: Math.round(g * POEM_SWAY + fl), y: -Math.round(Math.min(1, a) * POEM_LIFT * (.6 + .4 * Math.sin(t * 5 + phase * 1.7))) };
}

export function mountWind({ view, reduced = false } = {}) {
  const W = { gustIn: 0, vf: 0, gust: 0, gv: 0, gustScale: reduced ? .15 : 1, gustHist: new Float32Array(64), acc: 0, t: 0 };
  {
    let sy = null, st = 0;
    addEventListener('scroll', () => {
      if (document.documentElement.classList.contains('scroll-lock')) { sy = null; return; }   // compose lock / restore is not a swipe
      const y = scrollY, t = performance.now();
      if (sy != null) { const dt = Math.max(8, t - st) / 1000, v = (y - sy) / dt; W.gustIn = Math.abs(v) > Math.abs(W.gustIn) * .6 ? v : W.gustIn * .6 + v * .4; }
      sy = y; st = t;
    }, { passive: true });
  }
  // the poems on screen (kept by an IntersectionObserver; new poems are picked up as they are added)
  const on = new Map();                                  // el -> { phase, last }
  const io = new IntersectionObserver(es => { for (const e of es) { if (e.isIntersecting) on.set(e.target, on.get(e.target) || { phase: (+e.target.dataset.n || 0) * 2.399, last: '' }); else { on.delete(e.target); e.target.style.translate = ''; } } }, { rootMargin: '80px 0px' });
  const seen = new WeakSet(), watch = () => { for (const el of view?.layer?.querySelectorAll('.poem') || []) if (!seen.has(el)) { seen.add(el); io.observe(el); } };
  watch(); if (view?.layer) new MutationObserver(watch).observe(view.layer, { childList: true });
  const api = { sim: W, get value() { return W.gust; }, gust: v => { W.gustIn = v; }, at: frac => W.gustHist[Math.max(0, Math.min(63, Math.round(frac * LAG_FRAMES)))], poems: on };
  clock.onTick(dt => {
    W.acc = Math.min(.1, W.acc + dt); const h = 1 / 60;
    while (W.acc >= h) { W.acc -= h; W.t += h; stepWind(W, h); }
    if (!on.size) return;
    const H = innerHeight || 1, quiet = Math.abs(W.gust) < .02 && W.gustHist.every(v => Math.abs(v) < .02), c = view?.fontScale?.() || 1;
    const next = [];
    for (const [el, s] of on) {                          // read every position first, then write (no layout thrash)
      let tr = '';
      if (!quiet) { const frac = Math.max(0, Math.min(1, el.getBoundingClientRect().top / H)), o = poemOffset(api.at(frac), W.t, s.phase); if (o.x || o.y) tr = `${o.x * c}px ${o.y * c}px`; }
      if (tr !== s.last) next.push([el, s, tr]);
    }
    for (const [el, s, tr] of next) { s.last = tr; el.style.translate = tr; }
  });
  return api;
}
