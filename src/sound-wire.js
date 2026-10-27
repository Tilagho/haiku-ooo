// round 15.0: the site's SOUND, wired to the board (all synthesized, src/sound.js; events come in through src/sfx.js).
// - Nothing plays before an interaction: the AudioContext is created and resumed inside the first tap / key (browsers require it),
//   and the reading BED (wind + the distant waterfall, slowly crossfading and drifting in pan) starts then, quietly.
// - (parked in 15.1, WATERFALL_SOUND) A waterfall on screen eases its near water in over a few seconds; off screen it fades out slowly.
// - Credits list scrolling (15.1): a soft paper rustle following the scroll speed.
// - Breezes (15.1): every 15-45 s a small airy breeze swells and dies over 4-10 s, drifting across the stereo field.
// - The sound toggle (header, right of the 俳句の掲示板 line) mutes and SUSPENDS the context; the choice is kept in localStorage
//   ('hb-sound-muted'). Hidden page: faded and suspended (src/sound.js). round 15.10i (t236u): the first tap (and any later
//   unlock / rebuild) sets navigator.audioSession.type = "playback" so the iPhone silent switch does not mute the bed.
import { SoundEngine, SITE_LEVELS } from './sound.js?v=15.12';
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
    if (!live()) {
      if (name === 'reactSay') { snd.whenReady(() => { if (!snd.muted) snd.sayReaction(p.kind); }); return 'deferred'; }
      if (name === 'fabRoll' && snd._pending) { snd.play(name, p); return 'deferred'; }
      return 'locked';   // round 15.2: a write tap as the very first tap still gets its paper roll (~0.1 s late, once the graph is built)
    }
    if (name === 'reactSay') { snd.sayReaction(p.kind); return 'played'; }   // round 15.12: spell the reaction, then the stamp chime (clearing stays silent — no event)
    if (name === 'dragStart') snd.startDrag();
    else if (name === 'dragEnd') snd.stopDrag();
    else if (name === 'rustleStart') snd.startRustle();
    else if (name === 'rustleEnd') snd.stopRustle();
    else if (name === 'typeChar') return snd.babble(p);   // round 15.3: the typewriter's babble (one tiny syllable per letter; 'merged' / 'silent' / 'warming' otherwise)
    else if (name === 'impact') { const now = performance.now(); if (now - lastImpact < 140) return 'skipped'; lastImpact = now; snd.dragImpact(p.strength ?? 0.6); }
    else snd.play(name, p);
    return 'played';
  });
  const btn = mountToggle(root, snd, () => start());
  // first tap / key anywhere: unlock + the bed. Keeps listening (cheaply) so an iOS interruption (call, Siri) recovers on the next tap.
  function start() {
    if (snd.muted || document.hidden) return;
    if (snd._dead) snd.rebuild(); else snd.unlock();   // round 15.5: a frozen-after-background context is replaced inside the tap
    snd.whenReady(() => { if (!snd.bedOn && !snd.muted) snd.startBed(); });   // (the graph is built a moment after the tap)
  }
  const onGesture = e => { if (e.target?.closest?.('#snd')) return; if (!snd.muted && (!live() || !snd.bedOn || snd.needsGesture)) start(); };   // 15.5: any tap after a hide re-kicks   // 15.4: also a faded-out-by-hide level
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

// round 15.4: the toggle is ASCII in the header's own pixel font, inline right after 俳句の掲示板. It shows the REAL state:
// "<x" (off) until sound is actually running (the site always starts silent until the first tap), "<))" once it plays.
// round 15.5: a pixel speaker drawn on DotGothic16's own 16x16 dot grid at 1em, so each pixel = one stroke dot of 俳句の掲示板, same ink colour.
const SPK_ON = 'M6 2h1v1h-1zM5 3h1v1h-1zM6 3h1v1h-1zM4 4h1v1h-1zM6 4h1v1h-1zM12 4h1v1h-1zM0 5h1v1h-1zM1 5h1v1h-1zM2 5h1v1h-1zM3 5h1v1h-1zM6 5h1v1h-1zM13 5h1v1h-1zM0 6h1v1h-1zM6 6h1v1h-1zM9 6h1v1h-1zM13 6h1v1h-1zM0 7h1v1h-1zM6 7h1v1h-1zM10 7h1v1h-1zM14 7h1v1h-1zM0 8h1v1h-1zM6 8h1v1h-1zM10 8h1v1h-1zM14 8h1v1h-1zM0 9h1v1h-1zM6 9h1v1h-1zM9 9h1v1h-1zM13 9h1v1h-1zM0 10h1v1h-1zM1 10h1v1h-1zM2 10h1v1h-1zM3 10h1v1h-1zM6 10h1v1h-1zM13 10h1v1h-1zM4 11h1v1h-1zM6 11h1v1h-1zM12 11h1v1h-1zM5 12h1v1h-1zM6 12h1v1h-1zM6 13h1v1h-1z', SPK_OFF = 'M6 2h1v1h-1zM5 3h1v1h-1zM6 3h1v1h-1zM4 4h1v1h-1zM6 4h1v1h-1zM0 5h1v1h-1zM1 5h1v1h-1zM2 5h1v1h-1zM3 5h1v1h-1zM6 5h1v1h-1zM9 5h1v1h-1zM14 5h1v1h-1zM0 6h1v1h-1zM6 6h1v1h-1zM10 6h1v1h-1zM13 6h1v1h-1zM0 7h1v1h-1zM6 7h1v1h-1zM11 7h1v1h-1zM12 7h1v1h-1zM0 8h1v1h-1zM6 8h1v1h-1zM11 8h1v1h-1zM12 8h1v1h-1zM0 9h1v1h-1zM6 9h1v1h-1zM10 9h1v1h-1zM13 9h1v1h-1zM0 10h1v1h-1zM1 10h1v1h-1zM2 10h1v1h-1zM3 10h1v1h-1zM6 10h1v1h-1zM9 10h1v1h-1zM14 10h1v1h-1zM4 11h1v1h-1zM6 11h1v1h-1zM5 12h1v1h-1zM6 12h1v1h-1zM6 13h1v1h-1z';
const spkSvg = d => '<svg viewBox="0 0 16 16" width="1em" height="1em" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="' + d + '"/></svg>';
function mountToggle(root, snd, start) {
  const host = root.querySelector('#noren .jp') || root.querySelector('#noren') || root.body;
  const b = document.createElement('button'); b.id = 'snd'; b.type = 'button'; b.className = 'snd-btn';
  const t = document.createElement('span'); t.className = 'snd-art'; t.setAttribute('aria-hidden', 'true'); b.append(t);
  let shown = null;
  const draw = () => {
    const on = !snd.muted && !!snd.ctx && snd.ctx.state === 'running';
    if (on === shown) return; shown = on;
    t.innerHTML = spkSvg(on ? SPK_ON : SPK_OFF);
    b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.setAttribute('aria-label', on ? 'sound on (tap to mute)' : 'sound off (tap to turn on)'); b.title = on ? 'sound on' : 'sound off';
    b.classList.toggle('off', !on);
  };
  b.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    if (snd.muted || !snd.ctx || snd.ctx.state !== 'running') { snd.setMuted(false); snd.unlock(); start(); snd.whenReady(() => { snd.play('bubble', { f: 620 }); draw(); }); }   // on: inside this tap (iOS), a tiny blip to confirm
    else snd.setMuted(true);
    draw();
  });
  setInterval(draw, 250);   // cheap: follows unlock on the first tap, hide/suspend, iOS interruptions
  b._draw = draw; draw(); host.append(b);
  return b;
}
