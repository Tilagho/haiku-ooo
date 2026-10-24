// round 15.0 SOUND BUS. Game code calls sfx(name, params) at the moment something happens; it never touches audio itself.
// src/sound-wire.js (mounted by app.js) sets the sink that plays it through src/sound.js. Until the first tap there is no
// AudioContext at all, so every event is just logged as 'locked' (nothing can play before an interaction).
// Debug / test hook: sfxLog (also HB.sound.log): the last 200 events, each { name, p, t, result: 'played' | 'muted' | 'locked' | 'off' }.
export const sfxLog = [];
let sink = null;
export function setSfxSink(f) { sink = f; }
export function sfx(name, p = {}) {
  let result = 'off';
  try { result = sink ? sink(name, p) : 'off'; } catch (e) { result = 'error'; console.warn('sfx', name, e); }
  sfxLog.push({ name, p, t: Math.round(performance.now()), result }); if (sfxLog.length > 200) sfxLog.shift();
  return result;
}
