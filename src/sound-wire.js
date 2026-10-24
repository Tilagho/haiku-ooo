// round 15.0: the site's SOUND, wired to the board (all synthesized, src/sound.js; events come in through src/sfx.js).
// - Nothing plays before an interaction: the AudioContext is created and resumed inside the first tap / key (browsers require it),
//   and the reading BED (wind + the distant waterfall, slowly crossfading and drifting in pan) starts then, quietly.
// - (parked in 15.1, WATERFALL_SOUND) A waterfall on screen eases its near water in over a few seconds; off screen it fades out slowly.
// - Credits list scrolling (15.1): a soft paper rustle following the scroll speed.
// - Breezes (15.1): every 15-45 s a small airy breeze swells and dies over 4-10 s, drifting across the stereo field.
// - The sound toggle (header, right of the 俳句の掲示板 line) mutes and SUSPENDS the context; the choice is kept in localStorage
//   ('hb-sound-muted'). Hidden page: faded and suspended (src/sound.js). The iPhone silent switch is respected: no audio session
//   is set (navigator.audioSession is never touched), so Web Audio stays in the ambient category the switch silences.
import { SoundEngine, SITE_LEVELS } from './sound.js';
import { setSfxSink, sfxLog, sfx } from './sfx.js';
import { WATER_RE } from './waterfall.js';
import { PX, SCROLL_W } from './scroll-engine2.js';

// gentle site levels live in src/sound.js (SITE_LEVELS); round 15.1: the ambience ~11 dB lower
export { SITE_LEVELS };
// round 15.1: the waterfall sound is PARKED (Tiago: revisit later). false = the bed is the wind + breezes only, and nothing checks
// for waterfalls on screen. true brings back the 15.0 behaviour (wind + water bed, the near water easing in over a waterfall).
export const WATERFALL_SOUND = false;
const SPEAKER = ['....#......', '...##......', '#####......', '#####......', '#####......', '...##......', '....#......'];

export function mountSound({ view, inky, clock, root = document } = {}) {
  const snd = new SoundEngine({ settings: SITE_LEVELS, water: WATERFALL_SOUND });   // mute choice from localStorage; site levels (lab tweaks never leak in)
  const live = () => !!snd.ctx && snd.ctx.state === 'running';
  let lastImpact = -1e9, dragging = false, dragAcc = 0, near = false;
  setSfxSink((name, p) => {
    if (snd.muted) return 'muted';
    if (!live()) { if (name === 'fabRoll' && snd._pending) { snd.play(name, p); return 'deferred'; } return 'locked'; }   // round 15.2: a write tap as the very first tap still gets its paper roll (~0.1 s late, once the graph is built)
    if (name === 'dragStart') snd.startDrag();
    else if (name === 'dragEnd') snd.stopDrag();
    else if (name === 'rustleStart') snd.startRustle();
    else if (name === 'rustleEnd') snd.stopRustle();
    else if (name === 'impact') { const now = performance.now(); if (now - lastImpact < 140) return 'skipped'; lastImpact = now; snd.dragImpact(p.strength ?? 0.6); }
    else snd.play(name, p);
    return 'played';
  });
  const btn = mountToggle(root, snd, () => start());
  // first tap / key anywhere: unlock + the bed. Keeps listening (cheaply) so an iOS interruption (call, Siri) recovers on the next tap.
  function start() {
    if (snd.muted || document.hidden) return;
    snd.unlock();
    snd.whenReady(() => { if (!snd.bedOn && !snd.muted) snd.startBed(); });   // (the graph is built a moment after the tap)
  }
  const onGesture = e => { if (e.target?.closest?.('#snd')) return; if (!snd.muted && (!live() || !snd.bedOn)) start(); };
  for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) addEventListener(ev, onGesture, { capture: true, passive: true });
  // the waterfall in view (checked twice a second, only while sound runs; never while the write page covers the board)
  const fallsOnScreen = () => {
    const A = view?.art; if (!A?.items || !view.host) return false;
    if (document.body.classList.contains('composing')) return false;
    const r = view.host.getBoundingClientRect(), s = view.host.clientWidth / SCROLL_W || 1, H = view.composer.height, lo0 = H - (innerHeight - r.top) / s, hi0 = H + r.top / s, m = (hi0 - lo0) * .15, lo = lo0 + m, hi = hi0 - m;   // the middle 70% of the screen
    for (const it of A.items) {
      if (!WATER_RE.test(it.name) || it.base + it.h > A.top) continue;                 // as src/waterfall.js: only falls whose rows are final (drawn)
      const y0 = it.base * PX, y1 = (it.base + it.h) * PX;
      if (Math.min(y1, hi) - Math.max(y0, lo) > (y1 - y0) * .4) return true;          // most of a fall in the middle of the screen
    }
    return false;
  };
  if (WATERFALL_SOUND) setInterval(() => { if (!live() || snd.muted) return; const v = fallsOnScreen(); if (v !== near) { near = v; snd.setWaterfallVisible(v); } }, 500);
  // Inky (board): pokes with anger, splat on death, reform, wall / ceiling / floor squishes (src/inky.js onSfx) + the drag churn
  if (inky) {
    inky.onSfx = (name, p) => sfx(name, p);
    clock?.onTick?.(dt => {
      const d = inky.mode === 'drag' && !!inky.drag;
      if (d && !dragging) { dragging = true; sfx('dragStart'); }
      if (!d && dragging) { dragging = false; sfx('dragEnd'); }
      if (d && live() && (dragAcc += dt) >= 0.05) { dragAcc = 0; snd.updateDrag(Math.min(1, Math.hypot(inky.vx, inky.vy) / 260)); }   // 20 Hz, his speed in art px / s
    });
  }
  // round 15.1: scrolling the credits list rustles the paper (speed-driven, updates throttled to ~20 Hz, fades ~150 ms after the scroll stops)
  { let ly = null, lt = 0, lu = 0, on = false, idle = null;
    addEventListener('scroll', e => {
      const el = e.target; if (!el?.classList?.contains?.('cr-list')) return;
      const t = performance.now(), y = el.scrollTop;
      if (ly != null && t - lt < 250) { const v = Math.abs(y - ly) / Math.max(8, t - lt);   // css px / ms
        if (!on) { on = true; sfx('rustleStart'); }
        if (live() && !snd.muted && t - lu >= 50) { lu = t; snd.updateRustle(Math.min(1, v / 2.5)); } }
      ly = y; lt = t; clearTimeout(idle);
      idle = setTimeout(() => { ly = null; if (on) { on = false; snd.updateRustle(0); sfx('rustleEnd'); } }, 150);
    }, { capture: true, passive: true }); }
  const api = { waterfallSound: WATERFALL_SOUND, engine: snd, log: sfxLog, get state() { return snd.ctx?.state ?? 'none'; }, get muted() { return snd.muted; }, get bed() { return snd.bedOn; }, get near() { return near; }, button: btn, fallsOnScreen };
  return api;
}

// the toggle: a chunky pixel speaker (waves when on, a little x when off) in the board's ink grey, a >= 44 px hit area
function mountToggle(root, snd, start) {
  const host = root.querySelector('#noren .jp') || root.querySelector('#noren') || root.body;
  const b = document.createElement('button'); b.id = 'snd'; b.type = 'button'; b.className = 'snd-btn';
  const cv = document.createElement('canvas'); cv.width = 12; cv.height = 9; cv.className = 'snd-art'; cv.setAttribute('aria-hidden', 'true'); b.append(cv);
  const draw = () => {
    const g = cv.getContext('2d'); g.clearRect(0, 0, 12, 9); const on = !snd.muted;
    g.fillStyle = '#6b6670'; SPEAKER.forEach((r, y) => [...r].forEach((c, x) => c === '#' && g.fillRect(x, y + 1, 1, 1)));
    if (on) { g.fillRect(7, 3, 1, 3); g.fillRect(9, 1, 1, 1); g.fillRect(10, 2, 1, 5); g.fillRect(9, 7, 1, 1); }
    else { g.fillStyle = '#c8402f'; for (let i = 0; i < 4; i++) { g.fillRect(7 + i, 2 + i + 1, 1, 1); g.fillRect(10 - i, 2 + i + 1, 1, 1); } }
    b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.setAttribute('aria-label', on ? 'sound on (tap to mute)' : 'sound off (tap to turn on)'); b.title = on ? 'sound on' : 'sound off';
    b.classList.toggle('off', !on);
  };
  b.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    if (snd.muted) { snd.setMuted(false); snd.unlock(); start(); snd.whenReady(() => snd.play('bubble', { f: 620 })); }   // on: inside this tap (iOS), a tiny blip to confirm
    else snd.setMuted(true);
    draw();
  });
  draw(); host.append(b);
  return b;
}
