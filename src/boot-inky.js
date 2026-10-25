// round 15.10h (t230u + t231u): the staged boot. A classic (non-module) script loaded right after #boot-inky in index.html,
// so it runs before the app module and its art decode. While loading, boot Inky bobs over a little pixel fill bar
// (12 x 4 px cells; it eases toward ~88 % on its own and jumps to any real milestone app.js reports with HBBoot.mark()).
// app.js calls HBBoot.done({ sfx }) once feed.boot() has settled: after a guaranteed minimum beat the bar tops up, the board
// appears under him (round 15.10h2 t235u: only the sumi background art fades in; html.hb-booting -> html.hb-reveal, see style.css), and he
// swooshes off like red Inky's whip (src/inky-red.js: catmull path, same ease, stretch along velocity, an ink shooting-star ribbon + drops,
// swooshIn), crisp pixels on a low-res canvas, stepped at 30 fps. When he is gone it fires `hb:bootgone` (app.js unrolls the write button).
// done() resolves once he is fully off-screen (gone) plus T.AFTER (500 ms, round 15.10h2 t232u), and only then the board's black Inky rolls in.
// Reduced motion: no minimum wait, no swoosh; a quick fade for both.
(() => {
  const root = document.documentElement, el = document.getElementById('boot-inky');
  const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  // all ms. MIN counts from navigation start (performance.now()), so HTML + module + art time all count toward it.
  const T = { MIN: reduced ? 0 : 1000, TOP: reduced ? 0 : 220, HOLD: reduced ? 0 : 120, CROUCH: 140, SWOOSH: 760, FADE: reduced ? 200 : 560, AFTER: reduced ? 0 : 500, SAFE: 15000 };
  // capture-only slow-motion (tools/shot-round15_10h-boot.mjs sets window.__hbBootSlow before load so 3x stills land on the right beat); 1 on the site
  const K = +window.__hbBootSlow || 1; if (K !== 1) for (const k of ['MIN', 'TOP', 'HOLD', 'CROUCH', 'SWOOSH', 'FADE', 'AFTER']) T[k] *= K;
  const STEPS = 12, PX = 4, FPS = 30;
  const fill = el?.querySelector('.bi-fill'), bar = el?.querySelector('.bi-bar'), blob = el?.querySelector('.bi-blob');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const frame = () => new Promise(r => requestAnimationFrame(r));
  let p = 0, mark = 0, phase = 'fill', doneP = null, revealed = false;
  const curve = t => .88 * (1 - Math.exp(-t / (420 * K)));                   // ~77 % at the 1 s beat, never full on its own
  const draw = q => { const n = Math.round(Math.min(1, q) * STEPS); if (fill) fill.style.transform = `scaleX(${n / STEPS})`; el?.setAttribute('data-p', String(n)); };
  (function tick() {
    if (phase !== 'fill') return;
    p = Math.max(p, curve(performance.now()), mark); draw(p); requestAnimationFrame(tick);
  })();

  function reveal() {
    if (revealed) return; revealed = true;
    root.style.setProperty('--hb-fade', T.FADE + 'ms');
    root.classList.add('hb-reveal'); root.classList.remove('hb-booting');
    setTimeout(() => root.classList.remove('hb-reveal'), T.FADE + 60);
  }

  // ---------- the swoosh: red Inky's whip (src/inky-red.js) ----------
  // round 15.10h2 (t233u): drawn on a low-res canvas (1 canvas px = 1 Inky pixel = 4 css px, image-rendering: pixelated), every pixel
  // nearest-neighbour sampled from his 13 x 14 sprite (read from the SVG's own rects), so stretch / lean never smooth an edge.
  // The ink trail is red Inky's ribbon (inky-red.js trail: gap-filled points that age out) drawn as fat pixel discs that taper and go
  // grey toward the tail, a shooting star of ink, plus drops flung off it that fall.
  const ease = u => u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  function catmull(pts, u) {
    const n = pts.length - 1, f = Math.min(n - 1e-6, Math.max(0, u * n)), i = Math.floor(f), t = f - i;
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
    const c = (a, b, c2, d) => .5 * ((2 * b) + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t * t + (-a + 3 * b - 3 * c2 + d) * t * t * t);
    return [c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])];
  }
  const INK = '#1a181c', INK2 = '#3a3640', SUMI = '#6b6670';
  function sprite() {                                     // the SVG's rects -> 14 rows x 13 cells of colour | null
    const g = Array.from({ length: 14 }, () => Array(13).fill(null));
    for (const path of blob.querySelectorAll('path')) { const col = path.getAttribute('fill');
      for (const m of path.getAttribute('d').matchAll(/M(\d+) (\d+)h(\d+)/g)) { const x = +m[1], y = +m[2], w = +m[3]; for (let k = 0; k < w; k++) if (g[y]) g[y][x + k] = col; } }
    return g;
  }
  const disc = (ctx, x, y, r) => { const R = Math.max(.5, r), x0 = Math.floor(x - R), x1 = Math.ceil(x + R), y0 = Math.floor(y - R), y1 = Math.ceil(y + R);
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) if ((i + .5 - x) ** 2 + (j + .5 - y) ** 2 <= R * R) ctx.fillRect(i, j, 1, 1); };
  async function swoosh(sfx) {
    const r = blob.getBoundingClientRect(), W = innerWidth, H = innerHeight, G = sprite();
    // the canvas grid lines up with the SVG's own 4 px pixels, so the hand-off from SVG to canvas does not jump
    const ox = (r.left % PX) - PX, oy = (r.top % PX) - PX, cw = Math.ceil(W / PX) + 2, ch = Math.ceil(H / PX) + 2;
    const cv = document.createElement('canvas'); cv.className = 'bi-cv'; cv.setAttribute('aria-hidden', 'true'); cv.width = cw; cv.height = ch;
    Object.assign(cv.style, { left: ox + 'px', top: oy + 'px', width: cw * PX + 'px', height: ch * PX + 'px' });
    document.body.appendChild(cv); const ctx = cv.getContext('2d');
    const c0x = (r.left - ox) / PX + 6.5, c0y = (r.top - oy) / PX + 7;            // his centre in canvas px
    const trail = [], drops = [];
    // draw him: dst pixel -> inverse(lean . rot(a) . scale(sx, sy) . rot(-a)) -> sprite cell; anchorY = 7 squashes about his feet
    const body = (cx, cy, sx, sy, a, lean, anchorY = 0) => {
      const ca = Math.cos(a), sa = Math.sin(a), cl = Math.cos(-lean), sl = Math.sin(-lean), Rr = Math.ceil(9 * Math.max(sx, sy, 1));
      for (let j = Math.floor(cy - Rr); j <= Math.ceil(cy + Rr); j++) for (let i = Math.floor(cx - Rr); i <= Math.ceil(cx + Rr); i++) {
        let dx = i + .5 - cx, dy = j + .5 - cy - anchorY;
        [dx, dy] = [dx * cl - dy * sl, dx * sl + dy * cl];                  // undo the lean
        let u = dx * ca + dy * sa, v = -dx * sa + dy * ca;                  // into the velocity frame
        u /= sx; v /= sy; [dx, dy] = [u * ca - v * sa, u * sa + v * ca];   // unstretch, back out
        const gx = Math.floor(dx + 6.5), gy = Math.floor(dy + anchorY + 7), col = G[gy]?.[gx];
        if (col) { ctx.fillStyle = col; ctx.fillRect(i, j, 1, 1); }
      } };
    const paint = (me) => {
      ctx.clearRect(0, 0, cw, ch);
      for (const t of trail) { const L = t.life, rr = .6 + 4.6 * Math.pow(L, 1.15) * t.w;   // fat at his back, a needle at the tail
        ctx.fillStyle = L > .55 ? INK : L > .3 ? INK2 : SUMI; disc(ctx, t.x, t.y, rr); }
      ctx.fillStyle = INK; for (const d of drops) ctx.fillRect(Math.floor(d.x), Math.floor(d.y), d.s, d.s);
      if (me) body(...me);
    };
    const age = dt => {
      for (let k = trail.length - 1; k >= 0; k--) if ((trail[k].life -= dt / .42) <= 0) trail.splice(k, 1);
      for (let k = drops.length - 1; k >= 0; k--) { const d = drops[k]; d.life -= dt; d.vy += 340 * dt; d.x += d.vx * dt; d.y += d.vy * dt; if (d.life <= 0 || d.y > ch + 4) drops.splice(k, 1); }
    };
    blob.style.visibility = 'hidden'; el.classList.add('swoosh');
    // anticipation: two squash beats into the bar, the way red Inky crouches before runOff
    paint([c0x, c0y, 1.18, .78, 0, 0, 7]); await wait(T.CROUCH / 2);
    paint([c0x, c0y, 1.27, .7, 0, 0, 7]); await wait(T.CROUCH / 2);
    bar?.classList.add('popped');
    for (let k = 0; k < 9; k++) { const a = -Math.PI * (.1 + Math.random() * .8); drops.push({ x: c0x + (Math.random() - .5) * 10, y: c0y + 9, vx: Math.cos(a) * (30 + Math.random() * 40), vy: Math.sin(a) * (45 + Math.random() * 50), s: k % 3 ? 1 : 2, life: .5 + Math.random() * .3 }); }
    sfx?.('swooshIn', { dur: T.SWOOSH / 1000 });
    reveal();
    // back-left dip, a loop up and over, then away off the top-right (the board's black Inky comes in later, from the bottom-left)
    const pts = [[0, 0], [-22, 14], [-46, -30], [-14, -120], [W * .2, -H * .3], [W * .62 + 90, -H * .5 - 60]].map(([x, y]) => [x / PX, y / PX]);
    const t0 = performance.now(); let lastBucket = -1, lx = 0, ly = 0;
    for (;;) {
      const now = await frame(), u = Math.min(1, (now - t0) / T.SWOOSH), bucket = Math.floor((now - t0) / (1000 / FPS));
      if (bucket === lastBucket && u < 1) continue;                     // pixel-stepped: he moves on 30 fps beats only
      const fdt = lastBucket < 0 ? 1 / FPS : (bucket - lastBucket) / FPS; lastBucket = bucket;
      const [x, y] = catmull(pts, ease(u)), vx = (x - lx) / fdt, vy = (y - ly) / fdt, v = Math.hypot(vx, vy) * PX;   // v in css px / s
      age(fdt);
      // the ribbon: fill the gap since the last beat so it is one continuous streak (inky-red.js does the same)
      const n = Math.min(40, Math.ceil(Math.hypot(x - lx, y - ly) / .7));
      for (let k = 1; k <= n; k++) { const f = k / n; trail.push({ x: c0x + lx + (x - lx) * f, y: c0y + ly + (y - ly) * f + 1.5, life: 1 - (1 - f) * fdt / .42, w: Math.min(1, v / 900 + .35) }); }
      if (v > 150) for (let k = 0; k < 2; k++) if (Math.random() < .7) drops.push({ x: c0x + x + (Math.random() - .5) * 6, y: c0y + y + 4, vx: -vx * .12 + (Math.random() - .5) * 14, vy: -vy * .12 + (Math.random() - .5) * 8, s: Math.random() < .3 ? 2 : 1, life: .55 + Math.random() * .35 });
      const s = Math.round((1 + Math.min(.95, v / 1500)) * 10) / 10, a = Math.atan2(vy, vx), lean = Math.max(-.3, Math.min(.3, vx * PX / 3400));
      paint(u < 1 ? [c0x + x, c0y + y, s, 1 / Math.sqrt(s), a, lean] : null);
      lx = x; ly = y;
      if (u >= 1) break;
    }
    el.remove(); root.setAttribute('data-boot', 'gone'); window.dispatchEvent(new Event('hb:bootgone'));
    (async () => { let last = performance.now(); while (trail.length || drops.length) { const now = await frame(); if (now - last < 1000 / FPS) continue; age((now - last) / 1000); last = now; paint(null); } cv.remove(); })();   // the tail fades on its own
  }

  function done({ sfx } = {}) {
    if (doneP) return doneP;
    return doneP = new Promise(async res => {
      if (!el || !blob) { reveal(); return res(); }
      const left = T.MIN - performance.now(); if (left > 0) await wait(left);
      phase = 'top'; const from = p, t0 = performance.now();
      while (T.TOP && p < 1) { const u = Math.min(1, (performance.now() - t0) / T.TOP); p = from + (1 - from) * (1 - (1 - u) * (1 - u)); draw(p); if (u >= 1) break; await frame(); }
      p = 1; draw(1); el.classList.add('full');
      if (T.HOLD) await wait(T.HOLD);
      phase = 'out';
      if (reduced) { reveal(); el.classList.add('gone'); setTimeout(() => el.remove(), 220); window.dispatchEvent(new Event('hb:bootgone')); return res(); }
      try { await swoosh(sfx); } catch (e) { console.warn('boot inky', e); reveal(); el.remove(); window.dispatchEvent(new Event('hb:bootgone')); }
      await wait(T.AFTER);   // round 15.10h2 (t232u): a beat of empty board after he is gone, before the mascot rolls in
      res();
    });
  }
  // failsafe: whatever happens to the app module, the board is never left hidden behind the loader
  setTimeout(() => { if (!revealed) { phase = 'out'; reveal(); el?.remove(); window.dispatchEvent(new Event('hb:bootgone')); } }, T.SAFE);
  window.HBBoot = { T, STEPS, done, mark: v => { mark = Math.max(mark, Math.min(.95, v)); }, get p() { return p; }, get phase() { return phase; }, get revealed() { return revealed; }, get gone() { return !document.getElementById('boot-inky'); } };
})();
