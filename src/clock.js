// One clock for every scripted animation. Normally it follows requestAnimationFrame; for deterministic
// captures, HB.clock.manual = true and HB.clock.advance(ms) steps the world (Inky physics, waits, and every
// WAAPI / CSS animation on the page) frame by frame.
const waits = [], tickers = new Set();
export const clock = {
  manual: false, t: 0,
  now() { return this.manual ? this.t : performance.now(); },
  wait(ms) { return new Promise(res => waits.push({ at: this.now() + ms, res })); },
  onTick(fn) { tickers.add(fn); return () => tickers.delete(fn); },
  setManual(on) { this.t = performance.now(); this.manual = on; if (on) document.getAnimations().forEach(a => a.pause()); else document.getAnimations().forEach(a => a.playState === 'paused' && a.play()); },
  async advance(ms, fps = 30) {
    const step = 1000 / fps;
    for (let done = 0; done < ms - 1e-6; done += step) {
      this.t += step; flush(this.t); tickers.forEach(f => f(step / 1000, this.t));
      for (const a of document.getAnimations()) {
        if (a.playState === 'finished') continue;
        if (a.playState !== 'paused') a.pause();
        const end = a.effect?.getComputedTiming().endTime, ct = (a.currentTime || 0) + step;
        if (isFinite(end) && ct >= end) a.finish(); else a.currentTime = ct;
      }
      await Promise.resolve(); await Promise.resolve();   // let awaited sequences continue within the same frame
    }
  },
};
function flush(t) { for (let i = waits.length - 1; i >= 0; i--) if (waits[i].at <= t) { waits[i].res(); waits.splice(i, 1); } }
let last = performance.now();
function frame(now) {
  if (!clock.manual) { const dt = Math.min(0.05, (now - last) / 1000); flush(now); tickers.forEach(f => f(dt, now)); }
  last = now; requestAnimationFrame(frame);
}
if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(frame);   // (no-op when imported by Node tests)
