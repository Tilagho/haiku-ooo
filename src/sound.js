// haiku.ooo SOUND ENGINE (round 15.0: moved here from lab/sound/sound-engine.js, which now re-exports this file for the lab page).
// The site wiring is src/sound-wire.js (events arrive through src/sfx.js).
// Everything is synthesized with the Web Audio API: no audio files, no ScriptProcessor / AudioWorklet.
// Cheap on iPhone: a few pre-generated noise AudioBuffers (white / pink / brown, 8 s, seamless loops) played from random offsets,
// BiquadFilters, gains, StereoPanners, a few slow OscillatorNode LFOs, scheduled automation, and one short generated reverb IR.
//
//   const snd = new SoundEngine();               // settings + mute come from localStorage
//   snd.unlock();                                // call inside the first touch / click handler (creates + resumes the AudioContext)
//   snd.startBed();                              // the universal reading bed: wind (+ waterfall unless new SoundEngine({ water: false })), slowly drifting, with breezes
//   snd.setWaterfallVisible(true|false);         // eases the near-water detail in over a few s, fades it out slowly (~10 s)
//   snd.startAmbient(['wind']); snd.stopAmbient(); snd.stopBed();
//   snd.play('poke', { anger: 0..1 });           // anger >~.5 blends in the old-computer error beep (double at >.85)
//   snd.play(name)                               // splat | reform | wetSlap {strength} | scrollOpen | scrollClose | poof | bubble
//                                                // hitmarker (bird hit) | sadNotes (backing out of quitting) | stampFail | stampSuccess
//                                                // inkWash (publish) | eggReveal | scurry   ('inky' param accepted and ignored: one set)
//   snd.startDrag(); snd.updateDrag(speed01); snd.dragImpact(strength01); snd.stopDrag();
//   snd.set('wind', { volume: .4 }); snd.setMuted(true); snd.settings -> JSON
//   snd.attach(offlineCtx); snd.pump(seconds)    // the same graph inside an OfflineAudioContext (tests / WAV renders)
//
// iOS: the context is created / resumed inside a user gesture (unlock); navigator.audioSession is deliberately NOT touched, so the
// ringer / silent switch keeps working (Web Audio is silenced by it, as it should be for ambience). Hidden page: ducked + suspended.

export const DEFAULTS = {
  master: { volume: 0.7 },
  wind: { volume: 0.42, tone: 0.45, gust: 0.5, width: 0.7, breeze: 0.5, bed: 1 },   // breeze: the passing gusts that come and go (15.1, 15.2); bed: the steady wind's own level (15.2)
  waterfall: { volume: 0.42, tone: 0.35, intensity: 0.5, drops: 0.35 },
  inky: { volume: 0.7, tone: 0.5, wet: 0.35 },
  scroll: { volume: 0.6, tone: 0.5, crackle: 0.5 },
  poof: { volume: 0.5 },
  fx: { volume: 0.55, tone: 0.5 },          // the little moments: egg reveal, scurry, bird hit, sad notes, stamps
};
const KEY = 'hb-sound', MUTE_KEY = 'hb-sound-muted';
// the SITE's levels (the lab DEFAULTS are for auditioning). Round 15.1: every ambient ~11 dB lower than 15.0 (wind .24 -> .068), one-shots unchanged.
// Round 15.2 (Tiago: 'even lower ... the wind softer with occasional passing gusts a little more pronounced'): the ambient buses another -6 dB
// (.068 -> .034), the steady wind bed a further -3 dB under that (bed .708), and the passing gusts pushed up (breeze 1.1) so they rise ~4-6 dB over it
// Round 15.4 (Tiago t175u: 'atmosphere a little quiet'): wind bus +3 dB (.034 -> .048); bed/gust ratios unchanged, waterfall still off
export const SITE_LEVELS = { master: { volume: 0.6 }, wind: { volume: 0.048, bed: 0.708, breeze: 1.0, gust: 0.3 }, waterfall: { volume: 0.034 }, inky: { volume: 0.6 }, scroll: { volume: 0.5 }, poof: { volume: 0.45 }, fx: { volume: 0.5 } };
export const BREEZE_EVERY = [15, 45], BREEZE_LEN = [5, 10];   // a gust starts every 15-45 s (random), each swells (2-4 s) and dies away over 5-10 s in all
export const FLOOD_FILL = 0.9;    // s from the write tap's flood start until the black has filled the screen (measured 0.83 s in tools/e2e-round15_1-sound.mjs)
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const clone = o => JSON.parse(JSON.stringify(o));
const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

export class SoundEngine {
  constructor({ settings, persist = true, water = true } = {}) {
    this.persist = persist; this.bedWater = water;   // water: false = the bed is the wind alone (round 15.1 site: the waterfall sound is parked)
    let saved = null; if (persist && !settings) { try { saved = JSON.parse(ls.get(KEY) || 'null'); } catch {} }
    this.settings = clone(DEFAULTS);
    for (const src of [saved, settings]) if (src) for (const g in src) if (this.settings[g]) Object.assign(this.settings[g], src[g]);
    this.muted = persist ? ls.get(MUTE_KEY) === '1' : false;
    this.ctx = null; this._pending = null; this._queue = []; this.ready = Promise.resolve(); this.amb = {}; this.drag = null; this.timer = null; this.until = 0;
    this._vis = () => this._visibility();
  }
  // ---------- context ----------
  unlock() {                                     // inside a touchend / pointerup / click handler
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext); if (!AC) return false;
    if (!this.ctx && !this._pending) {
      // only the context is made inside the tap (cheap); the noise buffers are built right after, a few ms per task (no jank on the tap)
      const c = this._pending = new AC({ latencyHint: 'playback' });
      this.ready = this._build(c).then(bufs => {
        this.attach(c, bufs); this._pending = null;
        if (!this._listening) { this._listening = true; document.addEventListener('visibilitychange', this._vis);
        // round 15.4 (Tiago t176u): coming back to the page must bring the sound back with no reload. Safari's bfcache / iOS background
        // don't always fire visibilitychange, so pageshow + focus wake it too; and the context's own statechange (iOS 'interrupted' -> back)
        addEventListener('pageshow', this._vis); addEventListener('focus', this._vis); }
        c.onstatechange = () => { if (c.state === 'running' && !this.muted && !document.hidden) this._restoreGain(); };
        this.timer = setInterval(() => { if (this.ctx.state === 'running') this.pump(); }, 1000);   // nothing scheduled while suspended (hidden / muted)
        if (this.muted) { this.master.gain.value = 0; c.suspend?.(); }
        for (const f of this._queue.splice(0)) f();
        setTimeout(() => this.prepareFlood(), 1200);
        setTimeout(() => this.prepareBabble(), 1700);   // round 15.3: the typing babble's syllable bank (~30 x 0.1 s, once)   // round 15.1: the write-page flood buffer (+ its reverse), a moment after the bed is going
      });
    }
    const c = this.ctx || this._pending;
    if (this.ctx && !this.muted) this._kick = false;   // round 15.5: a gesture after a hide: resume + level + (wire) bed, every time
    if (c.state !== 'running' && !(this.muted && this.ctx)) { const p = c.resume?.(); if (this.ctx) p?.then?.(() => this._wake()); p?.catch?.(() => {}); }
    if (this.ctx && !this.muted) this._watch();
    if (c.state === 'running' && this.ctx && !this.muted) this._restoreGain();   // running but faded out by an earlier hide whose resume never came back
    const b = c.createBuffer(1, 1, c.sampleRate), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start();   // iOS: a sound inside the gesture
    return true;
  }
  // run f now if the graph is built, else as soon as it is (the bed asked for in the first tap starts ~50-150 ms later)
  _defer(f) { if (this._pending && this._queue.length < 32) this._queue.push(f); }   // asked for while the graph is still being built (the first ~100 ms)
  whenReady(f) { if (this.ctx) f(); else if (this._pending) this._queue.push(f); }
  async _build(c) {
    const step = () => new Promise(r => setTimeout(r, 0)), out = { noise: {} };
    for (const k of ['white', 'pink', 'brown']) { await step(); out.noise[k] = makeNoise(c, k); }
    await step(); out.grain = makeNoise(c, 'white', 0.25);
    if (this.bedWater) { for (let i = 0; i < 4; i++) { await step(); out.patterPart = makePatter(c, 8, 110, out.patterPart, i, 4); }   // (15.1: only when the waterfall sound is on)
      out.noise.patter = out.patterPart.buf; delete out.patterPart; }
    await step(); out.ir = makeIR(c, 1.6);
    await step(); return out;
  }
  attach(ctx, bufs = null) {
    this.ctx = ctx; const c = ctx, sr = c.sampleRate;
    this.noise = bufs?.noise ?? { white: makeNoise(c, 'white'), pink: makeNoise(c, 'pink'), brown: makeNoise(c, 'brown') };
    this.grain = bufs?.grain ?? makeNoise(c, 'white', 0.25);
    if (!this.noise.patter && this.bedWater) this.noise.patter = makePatter(c).buf;           // the in-view waterfall's shower patter (one 8 s buffer, built once)
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : this.settings.master.volume;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.35;
    const out = c.createGain(); out.gain.value = 0.9;
    this.master.connect(comp).connect(out).connect(c.destination);
    this.verb = c.createConvolver(); this.verb.buffer = bufs?.ir ?? makeIR(c, 1.6); this.verbOut = c.createGain(); this.verbOut.gain.value = 0.5;
    this.verb.connect(this.verbOut).connect(this.master);
    this.bus = {};
    this.mix = {}; this.bpan = {};
    for (const [g, hp] of [['wind', 70], ['waterfall', 65], ['inky', 55], ['scroll', 110], ['poof', 90], ['fx', 80]]) {   // volume -> mix (the bed's slow crossfade) -> pan (its drift) -> low cut (phones can't play sub-bass: it only eats headroom)
      const n = c.createGain(); n.gain.value = this.settings[g].volume; const m = c.createGain(), p = c.createStereoPanner(), h = c.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = hp; h.Q.value = 0.6;
      n.connect(m).connect(p).connect(h).connect(this.master); this.bus[g] = n; this.mix[g] = m; this.bpan[g] = p;
    }
    this.send = {};
    for (const [g, v] of [['wind', 0.12], ['waterfall', 0.18], ['inky', this.settings.inky.wet * 0.8], ['scroll', 0.12], ['poof', 0.4], ['fx', 0.3]]) { const n = c.createGain(); n.gain.value = v; this.mix[g].connect(n).connect(this.verb); this.send[g] = n; }
    this.near = 0; this.bedOn = false; this.bedLfo = null;
    this.until = c.currentTime; void sr;
    return this;
  }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }
  // ---------- settings / mute ----------
  set(group, values) {
    Object.assign(this.settings[group], values); this._save();
    if (!this.ctx) return;
    const t = this.now;
    if (group === 'master') this.master.gain.setTargetAtTime(this.muted ? 0 : this.settings.master.volume, t, 0.08);
    else if (this.bus[group] && 'volume' in values) this.bus[group].gain.setTargetAtTime(values.volume, t, 0.08);
    if (group === 'inky' && 'wet' in values) this.send.inky.gain.setTargetAtTime(values.wet * 0.8, t, 0.1);
    this.amb[group]?.update?.();
  }
  // muted: fade out, then SUSPEND the context (no audio thread running = no battery); unmuted (inside the tap): resume and fade back in
  setMuted(m) {
    this.muted = !!m; if (this.persist) ls.set(MUTE_KEY, m ? '1' : '0'); if (!this.ctx) return;
    this.master.gain.setTargetAtTime(m ? 0 : this.settings.master.volume, this.now, 0.15);
    if (!this._live()) return;
    if (m) { clearTimeout(this._susT); this._susT = setTimeout(() => this.muted && this.ctx.suspend?.(), 600); }
    else if (!document.hidden) { clearTimeout(this._susT); this.ctx.resume?.().then(() => this.pump()); }
  }
  _live() { const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext); return !!AC && this.ctx instanceof AC; }
  _save() { if (this.persist) ls.set(KEY, JSON.stringify(this.settings)); }
  _visibility() {
    if (!this.ctx || !this._live()) return;
    if (document.hidden) { this.master.gain.setTargetAtTime(0, this.now, 0.08); clearTimeout(this._susT); this._susT = setTimeout(() => document.hidden && this.ctx.suspend(), 400); this._kick = true; }   // hidden: fade, then suspend
    else if (!this.muted) { clearTimeout(this._susT); this.ctx.resume().then(() => this._wake()).catch(() => {}); this._watch(); }   // (iOS may refuse until the next tap: unlock() resumes AND restores the level then)
  }
  // back on the page and running again: the level the hide faded to 0 comes back (before 15.4 a tap-resume left it at 0 = silent until reload)
  _restoreGain() { if (!this.master || this.muted || document.hidden) return; const g = this.master.gain; g.cancelScheduledValues(this.now); g.setValueAtTime(g.value, this.now); g.setTargetAtTime(this.settings.master.volume, this.now, 0.3); }
  // round 15.5 (Tiago t180u): iOS Safari can come back from the background with the context saying 'running' while its clock is frozen
  // (no output at all), or stuck 'interrupted'/'suspended' with resume() never settling. The 15.4 tap path saw 'running' + full level +
  // bed on and did NOTHING -> silent until reload. Now: on return we check the clock really moves; a dead context is replaced on the next tap.
  _watch() { const c = this.ctx; if (!c || !this._live()) return; const t0 = c.currentTime; clearTimeout(this._watchT);
    this._watchT = setTimeout(() => { if (document.hidden || this.muted || this.ctx !== c) return; if (c.state === 'running' && c.currentTime === t0) this._dead = true; if (c.state !== 'running') this._kick = true; }, 700); }
  get needsGesture() { return !!this.ctx && !this.muted && (this._dead || this._kick || this.ctx.state !== 'running' || (this.master?.gain.value ?? 1) < 0.01); }
  rebuild() {                                    // inside a tap: throw away the dead context and build a fresh one (the wire restarts the bed)
    const old = this.ctx; if (!old || !this._live()) return this.unlock();
    clearInterval(this.timer); clearTimeout(this._susT); clearTimeout(this._watchT); try { old.onstatechange = null; old.close?.(); } catch {}
    this.ctx = null; this.amb = {}; this.drag = null; this.bedOn = false; this.breezeOn = false; this._floodP = null; this._babbleP = null; this.flood = null; this.babbleBank = null; this._dead = false; this._kick = false;
    return this.unlock();
  }
  _wake() { if (this.ctx?.state !== 'running') return; this._restoreGain(); this.pump(); }
  // the scheduler: ambient voices schedule their slow changes / gusts / droplets ahead of time (realtime: every second, 4 s ahead; offline: pump(duration))
  pump(ahead = 4) {
    if (!this.ctx) return; const to = (this.ctx instanceof OfflineAudioContext ? 0 : this.now) + ahead;
    for (const v of Object.values(this.amb)) v.schedule(to);
    if (this.breezeOn && this.amb.wind) while (this.nextBreeze < to) {          // the breezes: scheduled like the gusts, a few nodes each, ~every 30 s
      const t0 = this.nextBreeze, len = rnd(...BREEZE_LEN); (this.breezeLog ||= []).push([+t0.toFixed(2), +len.toFixed(2)]); if (this.breezeLog.length > 20) this.breezeLog.shift();
      this.nextBreeze += rnd(...BREEZE_EVERY); breeze(this, t0, len);
    }
    this.until = to;
  }
  // ---------- ambient ----------
  startAmbient(names = ['wind', 'waterfall']) {
    if (!this.ctx) return this._defer(() => this.startAmbient(names));
    for (const n of names) if (!this.amb[n]) this.amb[n] = n === 'wind' ? windVoice(this) : waterVoice(this, { near: this.near });
    this.pump();
  }
  stopAmbient(names = Object.keys(this.amb)) {
    for (const n of names) { this.amb[n]?.stop(); delete this.amb[n]; }
    if (names.includes('wind') || names.includes('waterfall')) this._bedLfo(false);
  }
  // THE READING BED: wind + the distant waterfall together, slowly trading places (an equal-ish crossfade over ~56 s and an opposite pan drift over ~71 s)
  breezeNow(len = rnd(...BREEZE_LEN)) { if (!this.ctx) return this._defer(() => this.breezeNow(len)); if (this.amb.wind) breeze(this, this.now + 0.05, len); }   // lab: one breeze on demand
  startBed() {
    if (!this.ctx) return this._defer(() => this.startBed());
    this.bedOn = true; this.breezeOn = true; this.nextBreeze = this.now + rnd(5, 15);   // the first breeze comes 5-15 s in
    this.startAmbient(this.bedWater ? ['wind', 'waterfall'] : ['wind']); this._bedLfo(true);
  }
  stopBed() { this.bedOn = false; this.breezeOn = false; this.stopAmbient(this.near || !this.bedWater ? ['wind'] : ['wind', 'waterfall']); }
  _bedLfo(on) {
    const t = this.now;
    if (this.bedLfo) { for (const o of this.bedLfo) o.stop(t + 0.05); this.bedLfo = null; for (const g of ['wind', 'waterfall']) { this.mix[g].gain.setTargetAtTime(1, t, 2); this.bpan[g].pan.setTargetAtTime(0, t, 2); } }
    if (!on) return;
    const x = this.ctx.createOscillator(), pn = this.ctx.createOscillator(); x.frequency.value = 1 / 56; pn.frequency.value = 1 / 71;
    if (this.bedWater) {                                                       // wind + water trade places
      const xw = this.gain(0.3), xf = this.gain(-0.3), pw = this.gain(0.35), pf = this.gain(-0.35);
      x.connect(xw).connect(this.mix.wind.gain); x.connect(xf).connect(this.mix.waterfall.gain); pn.connect(pw).connect(this.bpan.wind.pan); pn.connect(pf).connect(this.bpan.waterfall.pan);
      this.mix.wind.gain.setValueAtTime(0.75, t); this.mix.waterfall.gain.setValueAtTime(0.75, t);
    } else {                                                                   // the wind alone: a slow breathing (+-1.5 dB) and a gentle drift across the stereo field
      x.connect(this.gain(0.16)).connect(this.mix.wind.gain); pn.connect(this.gain(0.25)).connect(this.bpan.wind.pan); this.mix.wind.gain.setValueAtTime(0.9, t);
    }
    x.start(t); pn.start(t); this.bedLfo = [x, pn];
  }

  // a waterfall ON SCREEN: its near detail (trickles, burbles, droplets, a little more body) eases in over several seconds and fades out even more slowly
  setWaterfallVisible(v, when) {
    if (!this.ctx) return this._defer(() => this.setWaterfallVisible(v)); const t = when ?? this.now; this.near = v ? 1 : 0;
    if (v && !this.amb.waterfall) { this.amb.waterfall = waterVoice(this, { near: 0, fade: 3 }); this.pump(); }
    this.amb.waterfall?.setNear(this.near, t);
    if (!v && !this.bedOn && this.amb.waterfall) { const w = this.amb.waterfall; w.fadeOut(t, 4.5); setTimeout(() => { if (!this.near && !this.bedOn && this.amb.waterfall === w) { w.stop(); delete this.amb.waterfall; } }, 25000); }
  }
  // ---------- one-shots ----------
  play(name, p = {}) {
    if (!this.ctx) return this._defer(() => this.play(name, { ...p, when: undefined })); const t = p.when ?? this.now + 0.01;
    const f = SHOTS[name]; if (f) f(this, t, p);
  }
  // round 15.1: the write-page ink flood: rendered ONCE offline (sharing this engine's noise buffers: no rebuild) into a forward + a reversed buffer
  prepareFlood() {
    if (this._floodP || !this.ctx) return this._floodP; const sr = this.ctx.sampleRate, L = FLOOD_FILL + 1.9;
    const oc = new OfflineAudioContext(2, Math.ceil(sr * L), sr), E = new SoundEngine({ settings: { ...this.settings, master: { volume: 1 }, inky: { ...this.settings.inky, volume: 1 } }, persist: false, water: false });
    E.muted = false; E.attach(oc, { noise: this.noise, grain: this.grain, ir: this.verb.buffer }); SHOTS.inkFlood(E, 0.01);
    return (this._floodP = oc.startRendering().then(b => { const rev = this.ctx.createBuffer(2, b.length, sr); for (let c = 0; c < 2; c++) { const a = b.getChannelData(c), o = rev.getChannelData(c); for (let i = 0, n = a.length; i < n; i++) o[i] = a[n - 1 - i]; } this.flood = { fwd: b, rev }; return this.flood; }).catch(e => { console.warn('sound: flood render failed', e); this._floodP = null; }));
  }
  // round 15.3: the typing babble's syllable bank: 30 tiny syllables rendered once offline (sharing this engine's noise), sliced into buffers
  prepareBabble() {
    if (this._babbleP || !this.ctx) return this._babbleP; const sr = this.ctx.sampleRate, S = BABBLE.slot, keys = [];
    for (const v of Object.keys(BABBLE_VOWELS)) for (const o of BABBLE_ONSETS) keys.push([o, v]);
    const t0 = performance.now(), oc = new OfflineAudioContext(1, Math.ceil(sr * S * keys.length), sr), E = new SoundEngine({ settings: { ...this.settings, master: { volume: 1 } }, persist: false, water: false });
    E.muted = false; E.attach(oc, { noise: this.noise, grain: this.grain, ir: this.verb.buffer }); keys.forEach(([o, v], k) => babbleVoice(E, k * S + 0.002, o, v));
    return (this._babbleP = oc.startRendering().then(b => { const all = b.getChannelData(0), n = Math.round(sr * S), bank = {};
      keys.forEach(([o, v], k) => { const buf = this.ctx.createBuffer(1, n, sr), d = buf.getChannelData(0); d.set(all.subarray(k * n, k * n + n)); let pk = 0; for (const x of d) pk = Math.max(pk, Math.abs(x)); const g = pk > 0 ? 0.5 / pk : 1; for (let i = 0; i < n; i++) d[i] *= g; bank[o + v] = buf; });
      this.babbleBank = bank; this._babbleBus(); this.babbleMs = Math.round(performance.now() - t0); return bank; }).catch(e => { console.warn('sound: babble render failed', e); this._babbleP = null; }));
  }
  // one typed character (p: { line, i, u: 0..1 position in the line }); returns what happened (for the log / tests)
  babble(p = {}, when) {
    if (!this.ctx) return 'off';
    const syl = babbleSyl(p.line, p.i); if (!syl) return 'silent';
    if (!this.babbleBank) { this.prepareBabble(); return 'warming'; }
    const t = when ?? this.now + 0.005, clk = when ?? performance.now() / 1000;                 // (the wall clock for the rate: the audio clock moves in coarse blocks)
    if (clk - (this._babT ?? -1) < 1 / BABBLE.maxRate - 0.004) return 'merged';               // faster than ~15 / s: every other letter
    this._babT = clk;
    this._babbleBus();
    const u = clamp(p.u ?? 0.5), contour = 1 + 0.05 * Math.sin(Math.PI * Math.min(1, u * 1.6)) - 0.07 * Math.max(0, u - 0.7) / 0.3;   // a gentle rise, then down at the line's end
    const src = this.ctx.createBufferSource(); src.buffer = this.babbleBank[syl.onset + syl.vowel]; src.playbackRate.value = contour * rnd(0.95, 1.06);
    const g = this.gain(rnd(0.8, 1)); src.connect(g).connect(this.babbleOut); src.start(t);
    const live = this._babLive; live.push(src); src.onended = () => { const k = live.indexOf(src); if (k >= 0) live.splice(k, 1); };
    while (live.length > BABBLE.poly) { const old = live.shift(); try { old.stop(t); } catch {} }
    return 'played';
  }
  _babbleBus() { if (this.babbleOut) return; const o = this.babbleOut = this.gain(1), lv = this.gain(BABBLE.level * this.settings.inky.volume), pn = this.pan(-0.1), s = this.gain(0.12);
    o.connect(lv).connect(pn).connect(this.master); pn.connect(s).connect(this.verb); this._babLive = []; }
  babbleDuck(t = this.now) { const g = this.babbleOut?.gain; if (!g) return; g.cancelScheduledValues(t); g.setTargetAtTime(0.25, t, 0.01); g.setTargetAtTime(1, t + 0.5, 0.25); }   // a stamp landing over the typing
  _playBuf(buf, t, offset = 0) { const s = this.ctx.createBufferSource(), g = this.gain(this.settings.inky.volume); s.buffer = buf; s.connect(g).connect(this.master); s.start(t, offset); return s; }
  // round 15.1: the credits list being scrolled: a soft old-paper rustle that follows the scroll speed and fades when it stops
  startRustle(when) { if (!this.ctx) return this._defer(() => this.startRustle()); this.stopRustle(when); this.rustle = rustleVoice(this, when ?? this.now); }
  updateRustle(speed, when) { this.rustle?.update(clamp(speed), when ?? this.now); }
  stopRustle(when) { this.rustle?.stop(when ?? this.now); this.rustle = null; }
  startDrag(inky = 'black', when) { if (!this.ctx) return this._defer(() => this.startDrag(inky)); this.stopDrag(when); this.drag = churnVoice(this, inky, when ?? this.now); }
  updateDrag(speed, when) { this.drag?.update(clamp(speed), when ?? this.now); }
  stopDrag(when) { this.drag?.stop(when ?? this.now); this.drag = null; }
  dragImpact(strength = 1, when) { if (!this.ctx) return this._defer(() => this.dragImpact(strength)); const t = when ?? this.now; this.drag?.duck(t, clamp(strength)); SHOTS.jelloBoing(this, t, { strength: clamp(strength) }); }   // round 15.5: a jiggly jello spring boing when he squishes into a wall / the ceiling / the floor
  // helpers used by the voices
  src(type, when, { loop = true, rate = 1 } = {}) {
    const s = this.ctx.createBufferSource(); s.buffer = type === 'grain' ? this.grain : this.noise[type]; s.loop = loop; s.playbackRate.value = rate;
    s.start(when, loop ? Math.random() * (s.buffer.duration - 0.5) : 0); return s;
  }
  filt(type, f, Q = 0.7, gain = 0) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; b.gain.value = gain; return b; }
  gain(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  pan(v = 0) { const p = this.ctx.createStereoPanner(); p.pan.value = v; return p; }
  lfo(freq, depth, target, type = 'sine') { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq; const g = this.gain(depth); o.connect(g).connect(target); o.start(this.now + Math.random() * 0.01); return { o, g }; }
}

// ---------- round 15.3: TYPING BABBLE (Tiago: 'when the poem is being typed onto the main page ... use the engine used for Baka to synthetically
// read out each letter as it's being typed, kind of like Animal Crossing') ----------
// The baka voice engine (a sawtooth glottis through bandpass formants, noise for the consonants), made small, soft and cute: a young Inky
// voice at ~300 Hz. Each typed letter is one tiny syllable (~45-70 ms): a vowel letter sings its own vowel; a consonant gives its onset class
// (plosive burst / soft hiss / nasal hum / liquid glide) into the NEXT vowel in its word (or a neutral schwa); spaces, digits and punctuation
// are silent; the typewriter's own line pause (260 ms) is the pause at a line break. Cheap on an iPhone: the 6 vowels x 5 onsets = 30
// syllables are rendered ONCE offline (a ~2.5 s OfflineAudioContext, after the audio unlock), and each letter only starts one buffer source
// (pitch varied by its playback rate: a little random per syllable + a gentle rise-and-fall over each line). Polyphony is capped at 3, and
// letters arriving faster than ~15 / s are merged (the typewriter's 24 / s voices every other letter, Animal Crossing style).
export const BABBLE = { maxRate: 15, poly: 3, level: 0.35, f0: 300, slot: 0.1 };
export const BABBLE_VOWELS = { a: [900, 1450, 3000], e: [580, 2300, 3100], i: [380, 2800, 3500], o: [620, 1050, 2900], u: [420, 1100, 2800], '@': [650, 1600, 2900] };
const ONSET_OF = {}; for (const [k, s] of [['plosive', 'pbtdkgcq'], ['fric', 'fvszhxj'], ['nasal', 'mn'], ['liquid', 'lrwy']]) for (const ch of s) ONSET_OF[ch] = k;
export const BABBLE_ONSETS = ['none', 'plosive', 'fric', 'nasal', 'liquid'];
// the syllable a typed character says: null = silent (space / punctuation / digit), else { onset, vowel }
export function babbleSyl(line, i) {
  const chars = [...String(line || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()], ch = chars[i];
  if (!ch || !/\p{L}/u.test(ch)) return null;
  if ('aeiou'.includes(ch)) return { onset: 'none', vowel: ch };
  if (!/[a-z]/.test(ch)) return { onset: 'none', vowel: '@' };                                 // a letter outside a-z (kana, etc.): a soft neutral 'uh'
  for (let j = i + 1; j < chars.length && /\p{L}/u.test(chars[j]); j++) if ('aeiou'.includes(chars[j])) return { onset: ONSET_OF[ch] || 'plosive', vowel: chars[j] };
  return { onset: ONSET_OF[ch] || 'plosive', vowel: ch === 'y' ? 'i' : '@' };
}
function babbleVoice(E, t, onset, vowel) {
  const c = E.ctx, F = BABBLE_VOWELS[vowel], f0 = BABBLE.f0, out = E.gain(1), soft = E.filt('lowpass', 3600, 0.5); soft.connect(E.master); out.connect(soft);
  const V = t + ({ none: 0, plosive: 0.012, fric: 0.026, nasal: 0.022, liquid: 0.006 })[onset], dur = 0.05;
  const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, V); o.frequency.linearRampToValueAtTime(f0 * 1.06, V + dur * 0.35); o.frequency.linearRampToValueAtTime(f0 * 0.97, V + dur);
  const vg = E.gain(0); o.connect(vg);
  vg.gain.setValueAtTime(0, V); vg.gain.linearRampToValueAtTime(0.5, V + 0.008); vg.gain.setValueAtTime(0.5, V + dur * 0.55); vg.gain.linearRampToValueAtTime(0, V + dur);
  const fb = F.map((f, k) => { const Q = [5, 8, 10][k], a = [1, 0.5, 0.18][k]; const b = E.filt('bandpass', f, Q), g = E.gain(a); vg.connect(b).connect(g).connect(out); return b; });
  if (onset === 'liquid') fb.forEach((b, k) => { b.frequency.setValueAtTime([330, 900, 2500][k], V); b.frequency.exponentialRampToValueAtTime(F[k], V + 0.03); });
  const hiss = (T, d, f, Q, a) => { const s = E.src('white', T, { loop: false }), b = E.filt('bandpass', f, Q), g = E.gain(0);
    g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(a, T + Math.min(0.004, d / 3)); g.gain.linearRampToValueAtTime(0, T + d); s.connect(b).connect(g).connect(out); s.stop(T + d + 0.02); };
  if (onset === 'plosive') hiss(t, 0.012, 2600, 1.4, 0.35);
  if (onset === 'fric') hiss(t, 0.03, 5200, 1.2, 0.12);
  if (onset === 'nasal') { const n = c.createOscillator(), ng = E.gain(0); n.frequency.value = f0; const nb = E.filt('lowpass', 400, 0.7); n.connect(nb).connect(ng).connect(out);
    ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.25, t + 0.008); ng.gain.linearRampToValueAtTime(0, V + 0.006); n.start(t); n.stop(V + 0.02); }
  o.start(Math.min(t, V)); o.stop(V + dur + 0.02);
}
// ---------- noise buffers (seamless loops: the tail is cross-faded into the head) ----------
function makeNoise(c, kind, seconds = 8) {
  const sr = c.sampleRate, X = Math.round(sr * 0.06), n = Math.round(sr * seconds) + X, d = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') d[i] = w;
    else if (kind === 'pink') { b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898; d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926; }
    else { br = (br + 0.02 * w) / 1.02; d[i] = br; }
  }
  let m = 0; for (let i = 0; i < n; i++) m += d[i]; m /= n; for (let i = 0; i < n; i++) d[i] -= m;   // no DC (brown drifts)
  const L = n - X, buf = c.createBuffer(1, L, sr), o = buf.getChannelData(0);
  for (let i = 0; i < L; i++) o[i] = d[i];
  for (let i = 0; i < X; i++) { const a = i / X; o[i] = d[i] * Math.sqrt(a) + d[L + i] * Math.sqrt(1 - a); }
  let pk = 0, ss = 0; for (let i = 0; i < L; i++) { pk = Math.max(pk, Math.abs(o[i])); ss += o[i] * o[i]; }
  const rms = Math.sqrt(ss / L), k = 0.25 / (rms || 1); for (let i = 0; i < L; i++) o[i] *= k;    // every noise at the same RMS (0.25)
  return buf;
}
// SHOWER PATTER: 8 s of tiny water ticks built once in plain JS (no per-drop nodes at run time: cheap on a phone). Each tick is a damped
// sine 'tik' (900-3600 Hz, 2-10 ms) with an exponential level spread; a few slower, rounder drips (pitch rising) among them. Grains wrap
// around the end, so the buffer loops seamlessly. RMS-normalised like the noises.
function makePatter(c, seconds = 8, rate = 110, st = null, part = 0, parts = 1) {   // (built in `parts` chunks of grains; returns { buf })
  const sr = c.sampleRate, L = Math.floor(sr * seconds);
  st = st || { d: new Float32Array(L) }; const d = st.d, N = Math.round(seconds * rate), M = Math.round(seconds * 6);
  const grain = (t0, f, f1, dec, a) => { const n = Math.floor(dec * 6 * sr), k0 = Math.floor(t0 * sr), q = Math.exp(-1 / (dec * sr)), df = (f1 - f) / Math.max(1, dec * 3 * sr); let ph = 0, env = a, fr = f;
    for (let i = 0; i < n; i++) { ph += 6.283185307 * fr / sr; if (i < dec * 3 * sr) fr += df; d[(k0 + i) % L] += env * Math.sin(ph) * (i < 12 ? i / 12 : 1); env *= q; } };
  const from = Math.floor(part * N / parts), to = Math.floor((part + 1) * N / parts);
  for (let i = from; i < to; i++) { const f = 900 + Math.random() ** 1.5 * 2700; grain(Math.random() * seconds, f, f * (1 + Math.random() * 0.25), 0.002 + Math.random() * 0.008, -Math.log(1 - Math.random() * 0.98) * 0.5); }
  for (let i = Math.floor(part * M / parts); i < Math.floor((part + 1) * M / parts); i++) { const f = 500 + Math.random() * 900; grain(Math.random() * seconds, f, f * 1.7, 0.012 + Math.random() * 0.012, 0.8 + Math.random() * 0.8); }
  if (part === parts - 1) { let ss = 0; for (let i = 0; i < L; i++) ss += d[i] * d[i]; const k = 0.25 / (Math.sqrt(ss / L) || 1); for (let i = 0; i < L; i++) d[i] *= k;
    st.buf = c.createBuffer(1, L, sr); st.buf.copyToChannel(d, 0); }
  return st;
}
// a soft room: 1.6 s of decaying, darkened stereo noise
function makeIR(c, sec) {
  const sr = c.sampleRate, n = Math.round(sr * sec), b = c.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); let lp = 0; for (let i = 0; i < n; i++) { const t = i / sr, w = Math.random() * 2 - 1; lp += (w - lp) * (0.18 + 0.5 * Math.exp(-t * 6)); d[i] = lp * Math.exp(-t * 3.2) * (i < sr * 0.004 ? i / (sr * 0.004) : 1); } }
  let ss = 0; for (let ch = 0; ch < 2; ch++) for (const v of b.getChannelData(ch)) ss += v * v;
  const k = 1 / Math.sqrt(ss / 2 + 1e-9) * 0.6; for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] *= k; }
  return b;
}

// ---------- WIND: two band-passed pink-noise layers wide in stereo, a faint whistle, a brown-noise body; slow LFO drift + scheduled gusts ----------
// a passing GUST (round 15.1 'breeze', reshaped in 15.2): a soft airy whoosh that swells over 2-4 s, opens a little brighter at its peak, then fades
// away slower, len 5-10 s. Pink noise through a band sweeping up then back, a thin glassy whistle gliding a few semitones and a faint shimmer, all
// under a lowpass that opens at the peak and closes again (no hiss); carried across the stereo field as it passes. A smooth sine-squared swell
// and fade (setValueCurveAtTime): never abrupt. ~9 nodes, gone when it ends.
function breeze(E, t, len) {
  const S = E.settings.wind, k = S.breeze ?? 0.5, dir = Math.random() < 0.5 ? -1 : 1, rise = Math.min(len * 0.5, rnd(2, 4)), fall = len - rise;
  const out = E.gain(0), lp = E.filt('lowpass', 1300, 0.5), p = E.pan(-dir * 0.7); out.connect(lp).connect(p).connect(E.bus.wind);
  const N = 96, cv = new Float32Array(N); for (let i = 0; i < N; i++) { const x = i / (N - 1) * len; cv[i] = x < rise ? Math.sin(Math.PI / 2 * x / rise) ** 2 : Math.cos(Math.PI / 2 * (x - rise) / fall) ** 2; }
  out.gain.setValueAtTime(0, t); out.gain.setValueCurveAtTime(cv, t + 0.001, len);
  lp.frequency.setValueAtTime(1300, t); lp.frequency.exponentialRampToValueAtTime(2600, t + rise); lp.frequency.exponentialRampToValueAtTime(1200, t + len);   // brighter at the peak
  p.pan.setValueAtTime(-dir * 0.7, t); p.pan.linearRampToValueAtTime(dir * 0.7, t + len);
  const f0 = rnd(380, 620), whoosh = E.src('pink', t), wb = E.filt('bandpass', f0, 0.9), wg = E.gain(1.7 * k);
  wb.frequency.setValueAtTime(f0, t); wb.frequency.exponentialRampToValueAtTime(f0 * rnd(2.1, 2.7), t + rise); wb.frequency.exponentialRampToValueAtTime(f0 * 1.05, t + len);
  whoosh.connect(wb).connect(wg).connect(out);
  const fw = rnd(1100, 1600), wh = E.src('white', t), hb = E.filt('bandpass', fw, 22), hg = E.gain(0.7 * k);            // the whistle
  hb.frequency.setValueAtTime(fw, t); hb.frequency.linearRampToValueAtTime(fw * rnd(1.12, 1.3), t + rise); hb.frequency.linearRampToValueAtTime(fw * rnd(0.92, 1.02), t + len);
  wh.connect(hb).connect(hg).connect(out);
  const sh = E.src('pink', t), sb = E.filt('bandpass', rnd(2400, 3000), 3), sg = E.gain(0.12 * k);                       // the shimmer (kept soft: no hiss on phones)
  sh.connect(sb).connect(sg).connect(out);
  for (const n of [whoosh, wh, sh]) n.stop(t + len + 0.5);
}
function windVoice(E) {
  const c = E.ctx, S = E.settings.wind, t0 = E.now, nodes = [];
  const out = E.gain(0), lp = E.filt('lowpass', 1600, 0.5), env = E.gain(0.55);
  env.connect(lp).connect(out).connect(E.gain(S.bed ?? 1)).connect(E.bus.wind);   // round 15.2: bed = the steady wind's level under the gusts
  out.gain.setTargetAtTime(1, t0, 1.5);                                     // fade in over ~4 s
  const base = () => 320 + S.tone * 520;
  const lay = (type, f, Q, g, pan, rate) => { const s = E.src(type, t0, { rate }), b = E.filt('bandpass', f, Q), a = E.gain(g), p = E.pan(pan); s.connect(b).connect(a).connect(p).connect(env); nodes.push(s); return { s, b, a, p }; };
  const A = lay('pink', base(), 0.8, 1.6, -0.5 * S.width, 1), B = lay('pink', base() * 1.35, 1.0, 1.3, 0.5 * S.width, 0.97);
  const W = lay('white', base() * 2.2, 9, 0.09, 0, 1);                       // the faint whistle (a narrow band that wanders)
  const body = E.src('brown', t0), blp = E.filt('lowpass', 240, 0.6), bg = E.gain(0.35); body.connect(blp).connect(bg).connect(env); nodes.push(body);
  const lfos = [E.lfo(0.031, 110, A.b.frequency), E.lfo(0.047, 170, B.b.frequency), E.lfo(0.019, 260, W.b.frequency), E.lfo(0.023, 0.25 * S.width, A.p.pan), E.lfo(0.029, 0.25 * S.width, B.p.pan), E.lfo(0.041, 0.6, W.p.pan), E.lfo(0.013, 0.12, env.gain)];
  const apply = () => { lp.frequency.setTargetAtTime(1300 + S.tone * 1500, E.now, 0.5); };
  apply();
  let next = t0 + rnd(2, 5);
  return {
    update: apply,
    schedule(to) {                                                           // gusts: swell, brighten, ease off
      while (next < to) {
        const g = S.gust, amp = (0.35 + 0.65 * Math.random()) * (0.3 + 0.9 * g), rise = rnd(1.4, 3.8), hold = rnd(0.3, 1.8), fall = rnd(3, 7), t = next, b0 = base();
        env.gain.setTargetAtTime(0.55 + 0.7 * amp, t, rise / 3); env.gain.setTargetAtTime(0.55, t + rise + hold, fall / 3);
        for (const [P, k] of [[A.b.frequency, 1], [B.b.frequency, 1.35], [W.b.frequency, 2.2]]) { P.setTargetAtTime(b0 * k * (1 + 0.55 * amp), t, rise / 3); P.setTargetAtTime(b0 * k, t + rise + hold, fall / 3); }
        W.a.gain.setTargetAtTime(0.09 + 0.12 * amp, t, rise / 3); W.a.gain.setTargetAtTime(0.09, t + rise + hold, fall / 3);
        next = t + rise + hold + fall * 0.6 + lerp(16, 3, g) * rnd(0.6, 1.4);
      }
    },
    stop() { const t = E.now; out.gain.setTargetAtTime(0, t, 0.8); setTimeout(() => { for (const n of nodes) try { n.stop(); } catch {} for (const l of lfos) l.o.stop(); out.disconnect(); }, 4000); },
  };
}

// ---------- WATERFALL: the far foundation (brown rumble + pink mid rush, slowly breathing, highs shelved down) + the NEAR detail that makes it read
// as water: trickles (narrow noise bands amplitude-modulated at 5-13 Hz = running water), burbles (short resonant noise blips), droplet plips ----------
function waterVoice(E, { near = 1, fade = 1.5 } = {}) {
  const S = E.settings.waterfall, t0 = E.now, nodes = [];
  const out = E.gain(0), shelf = E.filt('highshelf', 2200, 0.7, -9), lp = E.filt('lowpass', 5200, 0.5);
  out.connect(shelf).connect(lp).connect(E.bus.waterfall); out.gain.setTargetAtTime(1, t0, fade);
  const roar = E.gain(1); roar.connect(out);                                   // the broadband rush; it steps back when the fall is in view so the patter leads
  const chain = (type, rate, pan, ...fs) => { const s = E.src(type, t0, { rate }); let n = s; for (const f of fs) n = n.connect(f); const p = E.pan(pan); n.connect(p).connect(fs.dest || out); nodes.push(s); return fs; };
  const chainR = (...a) => { const s = E.src(a[0], t0, { rate: a[1] }); let n = s; for (const f of a.slice(3)) n = n.connect(f); n.connect(E.pan(a[2])).connect(roar); nodes.push(s); };
  const rumble = [E.gain(1.1)], rumble2 = [E.gain(1.1)];
  chain('brown', 1, -0.6, E.filt('lowpass', 260, 0.6), rumble[0]); chain('brown', 0.93, 0.6, E.filt('lowpass', 260, 0.6), rumble2[0]);
  const bodyG = E.gain(0.5); chainR('pink', 0.97, 0, E.filt('lowpass', 1100, 0.5), bodyG);
  const rbL = E.filt('bandpass', 700, 0.45), rbR = E.filt('bandpass', 820, 0.45), rgL = E.gain(0.5), rgR = E.gain(0.5);
  chainR('pink', 1, -0.45, E.filt('lowpass', 2400, 0.5), rbL, rgL); chainR('pink', 1.04, 0.45, E.filt('lowpass', 2400, 0.5), rbR, rgR);
  const shG = E.gain(0.05); chainR('pink', 1, 0, E.filt('highpass', 1600, 0.5), E.filt('lowpass', 3400, 0.5), shG);
  const lfos = [E.lfo(0.05, 0.08, rgL.gain), E.lfo(0.061, 0.08, rgR.gain), E.lfo(0.023, 90, rbL.frequency), E.lfo(0.029, 110, rbR.frequency), E.lfo(0.011, 0.1, out.gain)];
  // NEAR detail bus (eased in / out by setNear)
  const nearG = E.gain(near), nearOut = E.gain(1); nearG.connect(nearOut).connect(E.bus.waterfall);
  const trickles = [[900, 7.3, -0.5], [1350, 9.7, 0.35], [620, 5.6, 0.1], [1800, 12.9, -0.2]].map(([f, r, pan]) => {   // running water: a narrow band that flutters
    const s = E.src('pink', t0, { rate: rnd(0.95, 1.05) }), b = E.filt('bandpass', f, 4), am = E.gain(0.0), g = E.gain(0.75), p = E.pan(pan);
    s.connect(b).connect(am).connect(g).connect(p).connect(nearG); nodes.push(s);
    lfos.push(E.lfo(r, 0.5, am.gain), E.lfo(r * 1.618, 0.3, am.gain), E.lfo(0.07 + Math.random() * 0.05, f * 0.18, b.frequency));
    am.gain.value = 0.45; return g;
  });
  const drops = E.gain(1); drops.connect(nearG);
  const patG = E.gain(1.1); patG.connect(nearG);                               // the shower patter: two copies of the patter buffer, wide, a little apart in speed
  for (const [rate, pan] of [[1, -0.55], [0.93, 0.55]]) { const s = E.src('patter', t0, { rate }), h = E.filt('highpass', 650, 0.6), l = E.filt('lowpass', 4200, 0.6), p = E.pan(pan); s.connect(h).connect(l).connect(p).connect(patG); nodes.push(s); }
  const rumG = rumble[0], rumG2 = rumble2[0];
  const apply = () => {
    const t = E.now, I = S.intensity;
    rgL.gain.setTargetAtTime(0.65 + 0.75 * I, t, 0.5); rgR.gain.setTargetAtTime(0.65 + 0.75 * I, t, 0.5); bodyG.gain.setTargetAtTime(0.35 + 0.4 * I, t, 0.5);
    rumble[0].gain.setTargetAtTime(0.35 + 0.35 * I, t, 0.5); rumble2[0].gain.setTargetAtTime(0.35 + 0.35 * I, t, 0.5); patG.gain.setTargetAtTime(0.45 + 0.5 * S.drops, t, 0.5);
    rbL.frequency.setTargetAtTime(430 + 330 * S.tone, t, 0.5); rbR.frequency.setTargetAtTime(500 + 380 * S.tone, t, 0.5);
    shG.gain.setTargetAtTime(0.08 + 0.14 * S.tone, t, 0.5); lp.frequency.setTargetAtTime(4500 + 3000 * S.tone, t, 0.5); shelf.gain.setTargetAtTime(-8 + 5 * S.tone, t, 0.5);
    for (const g of trickles) g.gain.setTargetAtTime(0.4 + 0.6 * S.drops, t, 0.5);
  };
  apply();
  let next = t0 + 0.3, nextB = t0 + 0.2, nextD = t0 + 0.5, nearV = near;
  roar.gain.value = near ? 0.42 : 1;
  return {
    update: apply,
    setNear(v, t) { nearV = v; nearG.gain.cancelScheduledValues(t); nearG.gain.setTargetAtTime(v, t, v ? 2.2 : 4.5); roar.gain.cancelScheduledValues(t); roar.gain.setTargetAtTime(v ? 0.42 : 1, t, v ? 2.2 : 4.5); },
    fadeOut(t, tau) { out.gain.setTargetAtTime(0, t, tau); nearG.gain.setTargetAtTime(0, t, tau); },
    schedule(to) {
      const rate = 1 + S.drops * 9 + (nearV ? 6 + 8 * S.drops : 0);   // droplets: a shower-like patter in view (Poisson, random pitch / pan / level, mostly short rising 'plips')
      while (next < to) { const up = Math.random() < 0.8; plip(E, next, drops, { f: up ? rnd(700, 2600) : rnd(380, 900), rise: up ? rnd(1.3, 1.9) : rnd(0.6, 0.8), amp: rnd(0.02, 0.09) * (0.6 + S.drops * 0.6), pan: rnd(-0.9, 0.9), dur: rnd(0.02, 0.06) }); next += -Math.log(1 - Math.random()) / rate; }
      while (nextD < to) {                                                   // and slow, clear drips falling into a pool: a louder round 'plink' with a little ring
        if (nearV) { const f = rnd(520, 1100); plip(E, nextD, drops, { f, rise: rnd(1.6, 2.2), amp: rnd(0.12, 0.2), pan: rnd(-0.6, 0.6), dur: rnd(0.07, 0.11) }); plip(E, nextD + 0.012, drops, { f: f * 2.01, rise: 1.4, amp: 0.035, pan: 0, dur: 0.05 }); }
        nextD += rnd(0.35, 1.1);
      }
      while (nextB < to) {                                                   // burbles: a short resonant noise blip, the water talking
        const T = nextB, s = E.src('pink', T, { loop: true }), f = rnd(350, 1300), b = E.filt('bandpass', f, rnd(8, 16)), g = E.gain(0), p = E.pan(rnd(-0.7, 0.7)), d = rnd(0.04, 0.14);
        b.frequency.setValueAtTime(f, T); b.frequency.linearRampToValueAtTime(f * rnd(1.1, 1.5), T + d);
        g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(rnd(0.9, 2.2), T + d * 0.3); g.gain.linearRampToValueAtTime(0, T + d);
        s.connect(b).connect(g).connect(p).connect(nearG); s.stop(T + d + 0.02);
        nextB += -Math.log(1 - Math.random()) / (4 + 10 * S.drops);
      }
    },
    stop() { const t = E.now; out.gain.setTargetAtTime(0, t, 0.8); nearG.gain.setTargetAtTime(0, t, 0.8); setTimeout(() => { for (const n of nodes) try { n.stop(); } catch {} for (const l of lfos) l.o.stop(); out.disconnect(); nearOut.disconnect(); }, 4000); },
  };
}
// one water droplet: a sine that rises (f -> 1.6 f) as it decays, very short
function plip(E, t, dest, { f, amp, pan = 0, dur = 0.06, rise = 1.6 }) {
  const o = E.ctx.createOscillator(), g = E.gain(0), p = E.pan(pan);
  o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * rise, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.6);
  o.connect(g).connect(p).connect(dest); o.start(t); o.stop(t + dur * 1.7);
}

// ---------- INKY: ONE set for both Inkys (black and red sound the same; the 'inky' param is accepted and ignored) ----------
const K = () => 0.78;                                                   // the deep, liked 'black' voicing
const WAVE = () => 'triangle';                                          // a few soft harmonics: the bloop still reads on a phone speaker
function bloop(E, t, dest, f0, f1, dur, amp, type = 'sine') {          // a pitch drop
  const o = E.ctx.createOscillator(), g = E.gain(0); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.25);
  o.connect(g).connect(dest); o.start(t); o.stop(t + dur * 1.3);
}
function gurgle(E, t, dest, dur, f0, f1, Q, amp, attack = 0.02, type = 'brown') {      // a resonant filter sweep over noise
  const s = E.src(type, t), b = E.filt('bandpass', f0, Q), g = E.gain(0);
  b.frequency.setValueAtTime(f0, t); b.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + attack); g.gain.setTargetAtTime(0, t + dur * 0.6, dur * 0.18);
  s.connect(b).connect(g).connect(dest); s.stop(t + dur + 0.4);
}
// a liquid noise burst: noise through a lowpass that closes from f0 to f1 (the wet 'shhh' of water hitting something)
function wash(E, t, dest, { dur, f0, f1, amp, attack = 0.005, type = 'white', Q = 0.7, pan = 0 }) {
  const s = E.src(type, t), lp = E.filt('lowpass', f0, Q), g = E.gain(0), p = E.pan(pan);
  lp.frequency.setValueAtTime(f0, t); lp.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + attack); g.gain.setTargetAtTime(0, t + attack + dur * 0.25, dur * 0.3);
  s.connect(lp).connect(g).connect(p).connect(dest); s.stop(t + dur * 2 + 0.3);
}
// 'glug glug': band-limited noise whose level is chopped by a fast LFO (a liquid running out of a container)
function glug(E, t, dest, { dur, f, rate, amp, rise = 1 }) {
  const s = E.src('pink', t), b = E.filt('bandpass', f, 3), am = E.gain(0), g = E.gain(0), o = E.ctx.createOscillator(), og = E.gain(0.5);
  b.frequency.setValueAtTime(f, t); b.frequency.exponentialRampToValueAtTime(f * rise, t + dur);
  o.frequency.setValueAtTime(rate, t); o.frequency.linearRampToValueAtTime(rate * 0.7, t + dur); o.connect(og).connect(am.gain); am.gain.value = 0.5;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + 0.06); g.gain.setTargetAtTime(0, t + dur * 0.7, dur * 0.15);
  s.connect(b).connect(am).connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.6); s.stop(t + dur + 0.6);
}
function inkyOut(E) { const lp = E.filt('lowpass', (1400 + E.settings.inky.tone * 3000) * 0.95, 0.6); lp.connect(E.bus.inky); return lp; }
const SHOTS = {
  bubble(E, t, p) { plip(E, t, inkyOut(E), { f: (p.f ?? 500) * K(), amp: 0.2, dur: 0.07 }); },
  // the liked poke; anger 0..1 tightens + raises it and, from ~0.5, blends in an old-computer 'invalid input' style error beep (original: a nasal square-wave 'bwap')
  poke(E, t, p) {
    const A = clamp(p.anger ?? 0), k = K() * rnd(0.93, 1.07) * (1 + 0.25 * A), d = inkyOut(E);
    bloop(E, t, d, 430 * k, 150 * k, 0.22 * (1 - 0.3 * A), 0.45, WAVE());
    gurgle(E, t, d, 0.28 * (1 - 0.3 * A), 260 * k, 950 * k, 7 + 6 * A, 0.9);
    plip(E, t + rnd(0.06, 0.1), d, { f: 520 * k, amp: 0.16, dur: 0.06 });
    plip(E, t + rnd(0.13, 0.19), d, { f: 780 * k, amp: 0.09, dur: 0.05, pan: rnd(-0.3, 0.3) });
    if (A > 0.45) { const m = clamp((A - 0.45) / 0.4); errBeep(E, t + 0.03, d, m, A > 0.85 ? 2 : 1); }
  },
  splat(E, t) { pour(E, t, inkyOut(E), 1); },
  // the watery GATHER: drops run back together (plips speeding up, rising), a glug that fills upward, and a round rising bloop as he pops back into shape
  reform(E, t) {
    const d = inkyOut(E);
    for (let i = 0; i < 14; i++) { const u = i / 13; plip(E, t + 0.75 * Math.pow(u, 0.7), d, { f: lerp(300, 820, u) * rnd(0.9, 1.1), amp: 0.04 + 0.07 * u, dur: 0.05, rise: 1.5, pan: rnd(-0.5, 0.5) * (1 - u) }); }
    glug(E, t + 0.05, d, { dur: 0.7, f: 260, rate: 9, amp: 0.7, rise: 2.4 });
    gurgle(E, t, d, 0.8, 160, 700, 6, 0.55, 0.3);
    bloop(E, t + 0.78, d, 210, 420, 0.2, 0.42, 'triangle');                            // the 'blup!' (rising: filling, not falling)
    plip(E, t + 0.86, d, { f: 900, amp: 0.1, dur: 0.06 });
  },
  // round 15.1: back alive and HAPPY: the watery gather, then right as he pops back into shape a short bright 'ding-ding!' (a little up-skip
  // and a sweet two-note bell chord, a pinch of glitter): pleased to be back. reform stays on its own; revive = reform + the chime.
  revive(E, t) { SHOTS.reform(E, t); SHOTS.reviveChime(E, t + 0.84); },
  reviveChime(E, t) {
    const d = E.gain(1.5); d.connect(E.bus.inky);                                    // past Inky's dull lowpass: the bell stays bright
    chime(E, t, d, 1174.7, 0.12, 0.5, -0.2);                                          // D6
    chime(E, t + 0.085, d, 1568, 0.13, 1.0, 0.15); chime(E, t + 0.09, d, 1975.5, 0.08, 1.0, 0.3);   // G6 + B6 together: the happy landing
    for (let i = 0; i < 5; i++) chime(E, t + 0.16 + i * 0.06 + Math.random() * 0.03, d, 3136 * Math.pow(2, [0, 4, 7, 12, 7][i] / 12), 0.016, 0.35, rnd(-0.6, 0.6));   // glitter
  },
  wetSlap(E, t, p) {                                                                   // the squish into a wall: a short wet slap, scaled by strength (body 180-700 Hz so phones play it)
    const S = clamp(p.strength ?? 1), d = inkyOut(E), a = 0.25 + 0.75 * S;
    wash(E, t, d, { dur: 0.16 + 0.1 * S, f0: 2600, f1: 380, amp: 0.55 * a, type: 'white', Q: 1.2 });
    gurgle(E, t, d, 0.18, 700, 220, 3, 0.9 * a, 0.004);
    bloop(E, t, d, 320, 170, 0.12, 0.35 * a, 'triangle');
    for (let i = 0; i < Math.round(2 + 4 * S); i++) plip(E, t + rnd(0.03, 0.22), d, { f: rnd(350, 1000), amp: rnd(0.03, 0.08) * a, dur: rnd(0.04, 0.07), pan: rnd(-0.6, 0.6) });
  },
  // round 15.5 (Tiago: 'jiggly jello spring boing'): a soft rubbery 'bwup', then a springy pitched boing whose pitch wobbles
  // and decays (a decaying vibrato + tremolo = the jiggle), and a tiny higher secondary jiggle. Pitch varies a little per hit.
  jelloBoing(E, t, p) {
    const S = clamp(p.strength ?? 1), d = inkyOut(E), a = 0.3 + 0.7 * S, f = (330 + 90 * S) * rnd(0.94, 1.06);
    bloop(E, t, d, 300, 150, 0.07, 0.22 * a, 'sine');                                 // soft rubbery contact
    const boing = (t0, f0, amp, dur, rate, depth) => {
      const o = E.ctx.createOscillator(), o2 = E.ctx.createOscillator(), g = E.gain(0), g2 = E.gain(0);
      o.type = 'triangle'; o2.type = 'sine';
      o.frequency.setValueAtTime(f0 * 0.62, t0); o.frequency.exponentialRampToValueAtTime(f0, t0 + 0.035);   // the spring stretching up
      const lfo = E.ctx.createOscillator(), lg = E.gain(f0 * depth); lfo.frequency.setValueAtTime(rate, t0); lfo.frequency.linearRampToValueAtTime(rate * 1.35, t0 + dur);
      lg.gain.setValueAtTime(f0 * depth, t0 + 0.03); lg.gain.exponentialRampToValueAtTime(f0 * 0.004, t0 + dur);   // wobble settles
      lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
      o2.frequency.setValueAtTime(f0 * 1.24, t0); o2.frequency.exponentialRampToValueAtTime(f0 * 2, t0 + 0.035);
      const trem = E.gain(1), tl = E.ctx.createOscillator(), tg = E.gain(0.35); tl.frequency.value = rate; tl.connect(tg).connect(trem.gain);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(amp, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
      g2.gain.setValueAtTime(0, t0); g2.gain.linearRampToValueAtTime(amp * 0.25, t0 + 0.012); g2.gain.exponentialRampToValueAtTime(0.0008, t0 + dur * 0.6);
      o.connect(g).connect(trem); o2.connect(g2).connect(trem); trem.connect(d);
      for (const x of [o, o2, lfo, tl]) { x.start(t0); x.stop(t0 + dur + 0.05); }
    };
    boing(t + 0.008, f, 0.42 * a, 0.42 + 0.12 * S, 13, 0.09);                           // the main boing
    boing(t + 0.13, f * 1.5, 0.12 * a, 0.22, 17, 0.06);                                 // the little after-jiggle
    wash(E, t, d, { dur: 0.06, f0: 1800, f1: 500, amp: 0.12 * a, type: 'white', Q: 1 });   // a hint of wet
  },
  scrollOpen(E, t) { mapPaper(E, t, { dur: 1.3, open: true }); },
  scrollClose(E, t) { mapPaper(E, t, { dur: 0.95, open: false }); },
  fabRoll(E, t) { SHOTS.scrollClose(E, t); },                           // round 15.2: the write button rolling itself up on the tap: the same old-paper roll
  // a cartoon 'pop!' then the puff of smoke: a bubble pops (a sine whose pitch jumps up as the film snaps, a tiny wet click), a soft breathy 'pff'
  // swells out of it, and the round-2 tail (the closing noise sweep + the three falling blips) is kept as it was, 35 ms later
  poof(E, t0) {
    const d = E.gain(2.4); d.connect(E.bus.poof);
    { const o = E.ctx.createOscillator(), g = E.gain(0); o.type = 'sine';                                 // the bubble: 'blup' rising fast...
      o.frequency.setValueAtTime(420, t0); o.frequency.exponentialRampToValueAtTime(1500, t0 + 0.03);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.32, t0 + 0.004); g.gain.setValueAtTime(0.32, t0 + 0.026); g.gain.linearRampToValueAtTime(0, t0 + 0.032);   // ...and snapping off
      o.connect(g).connect(d); o.start(t0); o.stop(t0 + 0.04);
      const n = E.src('white', t0 + 0.028, { loop: false }), nb = E.filt('bandpass', 2400, 1.4), ng = E.gain(0);   // the film snapping
      ng.gain.setValueAtTime(0, t0 + 0.028); ng.gain.linearRampToValueAtTime(0.6, t0 + 0.0288); ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.04); n.connect(nb).connect(ng).connect(d); n.stop(t0 + 0.05); }
    { const s = E.src('pink', t0 + 0.02), b = E.filt('bandpass', 1100, 0.9), g = E.gain(0);                // the 'pff' of smoke
      b.frequency.setValueAtTime(1600, t0 + 0.02); b.frequency.exponentialRampToValueAtTime(700, t0 + 0.2);
      g.gain.setValueAtTime(0, t0 + 0.02); g.gain.linearRampToValueAtTime(0.35, t0 + 0.05); g.gain.setTargetAtTime(0, t0 + 0.07, 0.05); s.connect(b).connect(g).connect(d); s.stop(t0 + 0.5); }
    const t = t0 + 0.035;                                                                                  // the kept tail
    const s = E.src('white', t), lp = E.filt('lowpass', 3200, 1.2), g = E.gain(0);
    lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(260, t + 0.38);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.4, t + 0.012); g.gain.setTargetAtTime(0, t + 0.04, 0.12);
    s.connect(lp).connect(g).connect(d); s.stop(t + 0.9);
    const o = E.ctx.createOscillator(), og = E.gain(0), olp = E.filt('lowpass', 2200, 0.7); o.type = 'triangle';
    og.gain.setValueAtTime(0, t0);
    [880, 660, 494].forEach((f, i) => { o.frequency.setValueAtTime(f, t + 0.02 + i * 0.045); og.gain.setValueAtTime(0.07 - i * 0.015, t + 0.02 + i * 0.045); og.gain.setValueAtTime(0, t + 0.055 + i * 0.045); });
    o.connect(og).connect(olp).connect(d); o.start(t0); o.stop(t + 0.3);
  },
};
// the old-computer error beep (original): a nasal pulse wave 'bwap' - a short pitch dip through a formant that closes (the 'quack'), slightly gritty
function errBeep(E, t, dest, m, n = 1) {
  for (let i = 0; i < n; i++) {
    const T = t + i * 0.14, o = E.ctx.createOscillator(), o2 = E.ctx.createOscillator(), g = E.gain(0), b = E.filt('bandpass', 1500, 3.5), lo = E.filt('lowpass', 3200, 0.7);
    o.type = 'square'; o2.type = 'sawtooth'; o.frequency.setValueAtTime(370, T); o.frequency.exponentialRampToValueAtTime(300, T + 0.13); o2.frequency.setValueAtTime(372 * 1.5, T); o2.frequency.exponentialRampToValueAtTime(301 * 1.5, T + 0.13);
    b.frequency.setValueAtTime(1700, T); b.frequency.exponentialRampToValueAtTime(700, T + 0.13);
    const o2g = E.gain(0.35); g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(0.22 * m, T + 0.006); g.gain.setValueAtTime(0.22 * m, T + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, T + 0.16);
    o.connect(g); o2.connect(o2g).connect(g); const dry = E.gain(0.35); g.connect(b).connect(lo).connect(dest); g.connect(dry).connect(lo);
    o.start(T); o2.start(T); o.stop(T + 0.18); o2.stop(T + 0.18);
  }
}
// a bucket poured out: a wet slap, then a stream (a glugging band + a dense, thinning rain of plips + a hissy splash bed), running out over ~1.6 s; big = 1 (splat) .. 2.4 (the publish wave)
function pour(E, t, d, big = 1) {
  const L = 1.5 * Math.sqrt(big);
  wash(E, t, d, { dur: 0.35 * big, f0: 3000, f1: 300, amp: 0.4 * Math.min(1.6, big), type: 'white', Q: 0.9 });
  bloop(E, t, d, 260, 120, 0.25, 0.4, 'triangle');                                     // the first heavy 'splosh' (220-260 Hz: audible on a phone)
  gurgle(E, t + 0.02, d, 0.5, 900, 230, 3, 0.8, 0.01);
  glug(E, t + 0.12, d, { dur: L, f: 330, rate: 7.5, amp: 0.75, rise: 0.75 });
  glug(E, t + 0.2, d, { dur: L * 0.9, f: 620, rate: 11, amp: 0.4, rise: 0.8 });
  wash(E, t + 0.08, d, { dur: L, f0: 1800, f1: 500, amp: 0.18, type: 'pink', attack: 0.12 });
  const n = Math.round(40 * big);
  for (let i = 0; i < n; i++) { const u = Math.pow(Math.random(), 1.6); plip(E, t + 0.06 + u * L, d, { f: rnd(300, 1300), amp: rnd(0.03, 0.09) * (1 - 0.6 * u), dur: rnd(0.03, 0.08), rise: Math.random() < 0.7 ? rnd(1.3, 1.8) : 0.7, pan: rnd(-0.8, 0.8) }); }
}
// a tiny voice: a buzzy pulse through two vowel formants (a small creature's 'a'), with a breathy 'h' on the later syllables
function voiceSyl(E, t, d, { f0, f1, dur, amp, h = false, F = [1150, 2100] }) {
  const o = E.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const vib = E.ctx.createOscillator(), vg = E.gain(f0 * 0.025); vib.frequency.value = 23; vib.connect(vg).connect(o.frequency);
  const g = E.gain(0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + 0.012); g.gain.setValueAtTime(amp, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const mix = E.gain(1); for (const [f, q, a] of [[F[0], 5, 1], [F[1], 7, 0.55]]) { const b = E.filt('bandpass', f, q), ga = E.gain(a); g.connect(b).connect(ga).connect(mix); }
  o.connect(g); mix.connect(d); o.start(t); vib.start(t); o.stop(t + dur + 0.02); vib.stop(t + dur + 0.02);
  if (h) { const n = E.src('white', t - 0.03, { loop: false }), nb = E.filt('bandpass', F[1], 1.5), ng = E.gain(0); ng.gain.setValueAtTime(0, t - 0.03); ng.gain.linearRampToValueAtTime(amp * 0.5, t - 0.01); ng.gain.linearRampToValueAtTime(0, t + 0.015); n.connect(nb).connect(ng).connect(d); n.stop(t + 0.03); }
}
// a bell partial set (inharmonic, like a small glass chime)
function chime(E, t, d, f, amp, dec = 0.9, pan = 0) {
  const p = E.pan(pan); p.connect(d);
  for (const [m, a, dk] of [[1, 1, 1], [2.76, 0.4, 0.6], [5.4, 0.16, 0.35], [8.9, 0.06, 0.2]]) {
    const o = E.ctx.createOscillator(), g = E.gain(0); o.frequency.value = f * m;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp * a, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + dec * dk);
    o.connect(g).connect(p); o.start(t); o.stop(t + dec * dk + 0.02);
  }
}
const fxOut = E => { const lp = E.filt('lowpass', 5200 + 3000 * E.settings.fx.tone, 0.5); lp.connect(E.bus.fx); return lp; };
const fxShots = {
  // the Easter-egg 'surprise': a squeaky three-syllable 'ya-ha-ha!' blip (rising, giggly), then a bright sparkle: a quick upward chime arpeggio + a pop + glitter
  eggReveal(E, t) {
    const d0 = fxOut(E), d = E.gain(1.6), v = E.gain(0.9); d.connect(d0); v.connect(d);
    voiceSyl(E, t, v, { f0: 620, f1: 900, dur: 0.12, amp: 0.22 });
    voiceSyl(E, t + 0.15, v, { f0: 980, f1: 1080, dur: 0.085, amp: 0.2, h: true });
    voiceSyl(E, t + 0.255, v, { f0: 1120, f1: 1320, dur: 0.15, amp: 0.21, h: true });
    const T = t + 0.42, pop = E.src('white', T, { loop: false }), pb = E.filt('bandpass', 1800, 1.2), pg = E.gain(0);
    pg.gain.setValueAtTime(0, T); pg.gain.linearRampToValueAtTime(0.25, T + 0.002); pg.gain.exponentialRampToValueAtTime(0.0001, T + 0.03); pop.connect(pb).connect(pg).connect(d); pop.stop(T + 0.05);
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => chime(E, T + i * 0.055, d, f, 0.11 - i * 0.012, 1.1, -0.4 + i * 0.27));   // C6 E6 G6 C7
    for (let i = 0; i < 10; i++) chime(E, T + 0.2 + Math.random() * 0.6, d, 2093 * Math.pow(2, Math.floor(Math.random() * 5) / 12 * 2.4), 0.018 + Math.random() * 0.02, 0.4, rnd(-0.8, 0.8));   // glitter
  },
  // a creature scurrying off: quick tiny patter (soft taps, accelerating, moving off to one side and down in pitch) + a little squeak at the start
  scurry(E, t, p) {
    const d0 = fxOut(E), d = E.gain(4.5); d.connect(d0); const side = p.side ?? (Math.random() < 0.5 ? -1 : 1);
    voiceSyl(E, t, d, { f0: 1500, f1: 1900, dur: 0.06, amp: 0.12, F: [1700, 3000] });
    let x = 0.05; for (let i = 0; i < 16; i++) { const u = i / 15, T = t + x; x += lerp(0.07, 0.035, u);
      const s = E.src('white', T, { loop: false }), b = E.filt('bandpass', lerp(2400, 1500, u) * rnd(0.9, 1.1), 2.5), g = E.gain(0), pn = E.pan(side * u * 0.9);
      g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(0.5 * (1 - 0.6 * u), T + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, T + 0.02);
      s.connect(b).connect(g).connect(pn).connect(d); s.stop(T + 0.03);
      const o = E.ctx.createOscillator(), og = E.gain(0); o.type = 'triangle'; o.frequency.value = lerp(520, 340, u) * (i % 2 ? 1 : 1.12);
      og.gain.setValueAtTime(0, T); og.gain.linearRampToValueAtTime(0.09 * (1 - 0.6 * u), T + 0.002); og.gain.exponentialRampToValueAtTime(0.0001, T + 0.03); o.connect(og).connect(pn); o.start(T); o.stop(T + 0.04);
    }
  },
  // bird hit: a punchy 'hit landed' tick (original): a hard metallic transient (inharmonic partials 1.9/3.1/4.7 kHz, 25 ms) + a dry noise crack + a short low thump for weight
  hitmarker(E, t) {
    const d = fxOut(E), m = E.gain(1.5); m.connect(d);                          // round 15.2: the tick / bone layer +3.5 dB (Tiago: louder)
    for (const [f, a] of [[1900, 0.32], [3100, 0.2], [4700, 0.09]]) { const o = E.ctx.createOscillator(), g = E.gain(0); o.type = 'triangle'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.92, t + 0.03);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.0007); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045); o.connect(g).connect(m); o.start(t); o.stop(t + 0.05); }
    const n = E.src('white', t, { loop: false }), nb = E.filt('bandpass', 2600, 1.3), ng = E.gain(0); ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.75, t + 0.0005); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.018); n.connect(nb).connect(ng).connect(m); n.stop(t + 0.03);
    bloop(E, t, m, 240, 140, 0.06, 0.55, 'sine');
    // round 15.1: the comedy - a burst of feathers (quick papery wing flaps, slowing and scattering, over a soft feathery whoosh) and a little
    // cartoon puff: the poof's family, but quicker and lighter (no bubble, no falling notes) so it never reads as the egg / credits poof
    const f = E.gain(1.5); f.connect(d); const side = Math.random() < 0.5 ? -1 : 1;
    for (let i = 0, x = 0.035; i < 9; i++) { const u = i / 8, T = t + x; x += lerp(0.028, 0.07, u) * rnd(0.85, 1.15);
      const s = E.src('white', T, { loop: false }), b = E.filt('bandpass', rnd(1300, 2600) * (1 - 0.3 * u), 1.1), g = E.gain(0), pn = E.pan(side * (u - 0.3) * 0.9 + rnd(-0.2, 0.2));
      g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(0.42 * (1 - 0.65 * u), T + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, T + rnd(0.03, 0.05));   // a flap: papery 'fft'
      s.connect(b).connect(g).connect(pn).connect(f); s.stop(T + 0.07); }
    { const s = E.src('pink', t + 0.03), b = E.filt('bandpass', 900, 0.8), g = E.gain(0), T = t + 0.03;         // the feathery whoosh under it
      b.frequency.setValueAtTime(700, T); b.frequency.exponentialRampToValueAtTime(1500, T + 0.12); b.frequency.exponentialRampToValueAtTime(800, T + 0.45);
      g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(0.22, T + 0.06); g.gain.setTargetAtTime(0, T + 0.1, 0.06); s.connect(b).connect(g).connect(f); s.stop(T + 0.5); }
    { const T = t + 0.05, s = E.src('white', T), lp = E.filt('lowpass', 2600, 1), g = E.gain(0);               // the puff: a short, light 'pf'
      lp.frequency.setValueAtTime(2600, T); lp.frequency.exponentialRampToValueAtTime(420, T + 0.16);
      g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(0.3, T + 0.008); g.gain.setTargetAtTime(0, T + 0.02, 0.045); s.connect(lp).connect(g).connect(f); s.stop(T + 0.35); }
    caw(E, t + 0.06, d, side);                                                                  // round 15.2: and the bird squawks ONE startled 'caw' (after the tick, so the hitmarker stays clear)
  },
  // backing out of quitting: the falling 'aww' played on BONES (original): hollow, clacky xylophone / woodblock strikes that walk the old wobbly slide
  // down an octave (slowing as they go), a hollow low 'bonk', then a little rattle of bones settling
  sadNotes(E, t) {
    const d = fxOut(E), out = E.gain(1.5); out.connect(d);
    const f0 = 466, steps = [0, 0.1, 0.2, 0.31, 0.43, 0.57, 0.73];                                // Bb4 ... Bb3, each strike a little later
    steps.forEach((dt, i) => { const u = i / (steps.length - 1), f = f0 * Math.pow(0.5, u) * (1 + 0.012 * Math.sin(i * 2.1)); bone(E, t + dt, out, f, 0.34 - 0.1 * u, rnd(-0.25, 0.25)); });
    bone(E, t + 0.95, out, 196, 0.42, 0, 0.16, true);                                                // the bonk: a hollow low knock (G3)
    for (let i = 0, x = 1.07; i < 7; i++) { x += rnd(0.025, 0.07) * (1 + i * 0.2); bone(E, t + x, out, rnd(700, 1300), 0.07 * (1 - i / 9), rnd(-0.5, 0.5), 0.03); }   // rattle
  },
  // STAMP FAIL: a big heavy rubber stamp on a desk: a thick body thump (180 -> 70 Hz with a 300 Hz knock), a wooden 'tok', a paper slap, a dull rattle
  stampFail(E, t) { stampHit(E, t, stampRoom(E, t, { wet: 0.8, echo: 0.8, ring: 0.8, drive: 1.6, level: 0.9, duck: 0.3 }), 1.25); },   // round 15.2: the same heavy stamp, now in the big stamp room (its tail ducks under red Inky's 'baka')
  baka(E, t, p = {}) { redBaka(E, t + (p.delay ?? 0), p.v); },               // round 15.2: red Inky, disgusted: 'tch... baaaka.' (p.delay: after the stamp lands)   // round 15.2: the same heavy stamp, now in the big stamp room
  // round 15.1: red Inky lands on the BACK stamp himself: a lighter, woodier thunk than stamp-fail (a small rubber stamp on a wooden block: a light
  // stamp hit + a hollow wooden knock and its little after-knock). The sad notes follow ~1 s later (after the roll-up), so it rings out short.
  backStamp(E, t) { bigStamp(E, t); },                                   // round 15.2: a GIANT wooden stamp slamming onto a solid wooden table (see bigStamp)
  // STAMP SUCCESS: a firm, bright stamp, then the same rising arpeggio (C E G C) as a little brass fanfare (bright saw voices through an opening filter,
  // a bell on each note), a quick V chord pickup that RESOLVES on a held C major chord with a swell, and a sparkly shimmer falling over it
  stampSuccess(E, t) {
    const d = stampRoom(E, t, { wet: 0.7, echo: 0.6, ring: 0.6, drive: 1.3, level: 0.9 }); stampHit(E, t, d, 0.9);   // round 15.2: in the big stamp room (the notes too)
    const bus = E.gain(0.9); bus.connect(d);
    [523.3, 659.3, 784, 1046.5].forEach((f, i) => { const T = t + 0.1 + i * 0.075; brass(E, T, bus, f, 0.1, 0.085, -0.45 + i * 0.3); chime(E, T, bus, f * 2, 0.035, 0.6, -0.45 + i * 0.3); });
    const P = t + 0.43; [587.3, 784, 987.8].forEach(f => brass(E, P, bus, f, 0.11, 0.05));            // V (D G B), a short pickup...
    const C = P + 0.13; [523.3, 659.3, 784, 1046.5].forEach((f, i) => brass(E, C, bus, f, 0.75, 0.065, -0.3 + i * 0.2, true));   // ...resolving to I (C E G C), held with a swell
    chime(E, C, bus, 2093, 0.05, 1.4, 0); chime(E, C + 0.01, bus, 1568, 0.04, 1.2, 0.3);
    for (let i = 0; i < 14; i++) { const u = i / 13; chime(E, C + 0.05 + u * 0.9 + rnd(0, 0.05), bus, lerp(4200, 2100, u) * rnd(0.95, 1.05), 0.022 * (1 - 0.5 * u), 0.35, rnd(-0.8, 0.8)); }   // shimmer cascading down
  },
  // the INK WASH on publish: a whole bucket of ink dumped: a rising surge (a lowpass opening over pink + brown), a big splash crest, the pour running out, spray falling back
  // round 15.1: OPENING THE WRITE PAGE: a huge bucket of ink and water dumped over the whole screen, timed to the flood (src/ink-field.js flood: the
  // geyser from the button, the black climbing the screen ~FLOOD_FILL s, then settling): the tip-over 'glunk', a roaring gush that swells as it
  // climbs (two surges + glugging + a thousand droplets), sloshing, the crest as the screen fills, and a short settle so the unroll is heard.
  // The site plays it from a buffer rendered once (engine.prepareFlood), so BACKING OUT can play the very same buffer REVERSED: it all sucks back in.
  inkFlood(E, t) {
    const d = E.gain(0.55); d.connect(E.bus.inky); const F = FLOOD_FILL;
    bloop(E, t, d, 210, 140, 0.18, 0.5, 'triangle'); bone(E, t, d, 180, 0.2, 0, 0.2, true);                       // the bucket tips: a hollow glunk
    const surge = (type, f0, f1, amp, pan, at) => { const T = t + at, s = E.src(type, T), lp = E.filt('lowpass', f0, 0.7), g = E.gain(0), p = E.pan(pan);
      lp.frequency.setValueAtTime(f0, T); lp.frequency.exponentialRampToValueAtTime(f1, T + F * 0.7); lp.frequency.exponentialRampToValueAtTime(700, T + F + 0.9);
      g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(amp * 0.6, T + 0.12); g.gain.linearRampToValueAtTime(amp, T + F * 0.85); g.gain.setTargetAtTime(0, T + F, 0.32);
      s.connect(lp).connect(g).connect(p).connect(d); s.stop(T + F + 2.2); };
    surge('pink', 500, 3000, 0.5, -0.45, 0.05); surge('pink', 560, 2600, 0.45, 0.45, 0.07); surge('brown', 300, 1100, 0.3, 0, 0.05);
    glug(E, t + 0.08, d, { dur: F, f: 300, rate: 6, amp: 0.7, rise: 1.6 }); glug(E, t + 0.15, d, { dur: F * 0.9, f: 640, rate: 9.5, amp: 0.45, rise: 1.4 });
    glug(E, t + 0.25, d, { dur: F, f: 230, rate: 3.2, amp: 0.45, rise: 1.3 });                                     // the slosh of the climbing surface
    for (let i = 0; i < 70; i++) { const u = Math.random(); plip(E, t + 0.05 + u * (F + 0.3), d, { f: rnd(300, 1400), amp: rnd(0.03, 0.08) * (0.5 + 0.5 * u), dur: rnd(0.03, 0.08), rise: Math.random() < 0.7 ? rnd(1.3, 1.8) : 0.7, pan: rnd(-0.9, 0.9) }); }
    wash(E, t + F - 0.1, d, { dur: 0.7, f0: 3600, f1: 500, amp: 0.4, type: 'white', Q: 0.8 }); bloop(E, t + F - 0.05, d, 230, 100, 0.35, 0.45, 'triangle');   // the crest: full
    gurgle(E, t + F + 0.1, d, 0.6, 700, 220, 4, 0.5, 0.05);                                                         // settling
  },
  inkFloodIn(E, t) { if (E.flood) E._playBuf(E.flood.fwd, t); else SHOTS.inkFlood(E, t); },
  inkFloodOut(E, t, p) { if (!E.flood) return; const L = E.flood.rev.duration; E._playBuf(E.flood.rev, t, Math.max(0, L - ((p.dur ?? 1.3) + 0.35))); },   // its peak (the tip-over, reversed) lands as the black closes into Inky
  // round 15.1: red Inky swooshing in (compose): board Inky's drag churn, swelled in and out along the swoop (fast in the middle of the whip)
  swooshIn(E, t, p) { const T = p.dur ?? 0.95, v = churnVoice(E, 'red', t); for (let x = 0; x <= T; x += 0.04) v.update(Math.pow(Math.sin(Math.PI * x / T), 0.7) * 0.95, t + x); v.stop(t + T); },
  inkWash(E, t) {
    const d = E.gain(0.62); d.connect(E.bus.inky);
    const surge = (type, f0, f1, amp, pan) => { const s = E.src(type, t), lp = E.filt('lowpass', f0, 0.8), g = E.gain(0), p = E.pan(pan);
      lp.frequency.setValueAtTime(f0, t); lp.frequency.exponentialRampToValueAtTime(f1, t + 0.55); lp.frequency.exponentialRampToValueAtTime(380, t + 2.6);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + 0.55); g.gain.setTargetAtTime(0, t + 0.9, 0.7); s.connect(lp).connect(g).connect(p).connect(d); s.stop(t + 4.5); };
    surge('pink', 300, 3200, 0.55, -0.35); surge('pink', 340, 2800, 0.5, 0.35); surge('brown', 250, 900, 0.35, 0);
    wash(E, t + 0.5, d, { dur: 0.6, f0: 4200, f1: 600, amp: 0.45, type: 'white', Q: 0.8 });          // the crest
    bloop(E, t + 0.5, d, 230, 95, 0.4, 0.5, 'triangle');
    pour(E, t + 0.55, d, 2.4);
  },
  // round 15.3 (Tiago: 'when text is copied there needs to be a little tiny charm sound'): a successful copy: three tiny glass tinks
  // rising (B6, E7, G#7: an E-major sparkle), soft and close, with a faint high shimmer; ~0.35 s. Quiet: well under the other one-shots.
  copyCharm(E, t) {
    const d = fxOut(E), g = E.gain(7.8); g.connect(d);   // round 15.4 (Tiago t175u: 'too loud, lower it a bit'): -7 dB from 15.3's 17.5 (15.2 was 2.2)
    [[1975.5, 0, 0.05, -0.25], [2637, 0.065, 0.042, 0.05], [3322.4, 0.13, 0.036, 0.3]].forEach(([f, at, a, pan]) => chime(E, t + at, g, f, a, 0.24, pan));
    for (let i = 0; i < 5; i++) chime(E, t + 0.09 + i * 0.035 + rnd(0, 0.01), g, rnd(5200, 6400), 0.006, 0.12, rnd(-0.6, 0.6));
  },
  // round 15.3 (Tiago: 'after something you worked on has been accepted, and user hits post, he needs to switch away with a sparkly inky sound
  // effect like he's flying away from the page in a triumphant success'): red Inky's runOff (src/inky-red.js: a 0.26 s crouch, then a 0.95 s
  // whip up-left, looping over and out past the RIGHT edge). His inky swoosh (the drag churn's watery band, rising) + an airy whoosh that
  // opens and climbs with his speed, panning with the path (left, then out right), a sparkle trail (a quick rising C-major arpeggio of glass
  // chimes + glitter thrown behind him) and a last bright twinkle as he leaves the screen. ~1.3 s + tail. Played at the crouch.
  inkyFlyaway(E, t) {
    const W = t + 0.26, T = 0.95, X = W + T;                         // the whip starts after the crouch; X = off screen
    const pan = E.pan(0); pan.pan.setValueAtTime(0, t); pan.pan.linearRampToValueAtTime(-0.35, W + T * 0.35); pan.pan.linearRampToValueAtTime(0.85, X);   // with his path
    const sw = E.gain(0.9); sw.connect(pan).connect(E.bus.inky);
    // the crouch: a little rising inky 'bloop' (he winds up)
    bloop(E, t + 0.02, sw, 280, 520, 0.18, 0.28, 'triangle');
    // his inky swoosh: the churn's watery band (brown noise ~260 Hz -> 900 Hz) + bubbly plips, swelling with the whip
    { const s = E.src('brown', W), b = E.filt('bandpass', 260, 4), g = E.gain(0); b.frequency.setValueAtTime(260, W); b.frequency.exponentialRampToValueAtTime(900, X);
      g.gain.setValueAtTime(0, W); g.gain.linearRampToValueAtTime(0.9, W + T * 0.45); g.gain.setTargetAtTime(0, X - 0.1, 0.09); s.connect(b).connect(g).connect(sw); s.stop(X + 0.6); }
    for (let i = 0; i < 9; i++) { const u = i / 8; plip(E, W + 0.05 + u * (T - 0.15), sw, { f: lerp(380, 1100, u) * rnd(0.9, 1.1), amp: 0.07, dur: 0.05, rise: 1.7, pan: rnd(-0.3, 0.3) }); }
    // the air: a whoosh opening and climbing with his speed (pink noise, bandpass 600 -> 3200 Hz)
    { const s = E.src('pink', W), b = E.filt('bandpass', 600, 1.6), g = E.gain(0);
      b.frequency.setValueAtTime(600, W); b.frequency.exponentialRampToValueAtTime(3200, X);
      g.gain.setValueAtTime(0, W); g.gain.linearRampToValueAtTime(0.32, W + T * 0.6); g.gain.linearRampToValueAtTime(0.45, X - 0.05); g.gain.setTargetAtTime(0, X, 0.08); s.connect(b).connect(g).connect(pan); s.stop(X + 0.6); }
    // the sparkle trail: a quick rising C-major arpeggio of glass chimes along the path, glitter thrown behind him, a last twinkle out
    const sp = fxOut(E), sg = E.gain(1); sg.connect(sp);
    [1046.5, 1318.5, 1568, 2093, 2637, 3136, 4186].forEach((f, i) => { const u = i / 6, T2 = W + 0.12 + u * (T - 0.22); chime(E, T2, sg, f, 0.05 - 0.015 * u, 0.5, lerp(-0.35, 0.8, u)); });
    for (let i = 0; i < 14; i++) { const u = Math.random(); chime(E, W + 0.2 + u * (T + 0.15), sg, rnd(3800, 6200), rnd(0.008, 0.016), rnd(0.15, 0.3), lerp(-0.3, 0.9, u)); }
    chime(E, X - 0.02, sg, 2093, 0.04, 0.55, 0.85); chime(E, X, sg, 3136, 0.03, 0.5, 0.9);
  },
  // round 15.3 (Tiago: 'after the poem gets posted on the main page we do that number stamp, that needs to have a satisfying stamp sound too,
  // like a seal of approval'): the red kanji number seal pressing onto the new poem (src/scroll-view.js stampSeal, at its impact frame).
  // A firm, confident press: a solid dry thunk (sine 170 -> 70 Hz + its octave, soft-clipped, up front) with a soft wet rubber/ink squish
  // (a short bandpassed noise sliding down), a tiny wooden settle ~0.12 s later, and approval: a warm resolving tone (C5 + E5 -> G5 swelling
  // in under a single bright bell 'ding'), all in the shared stamp room - lighter and shorter than the back stamp. Also ducks the typing babble.
  numberStamp(E, t) {
    const c = E.ctx; E.babbleDuck?.(t);
    const d = stampRoom(E, t, { wet: 0.75, echo: 0.6, ring: 0.3, drive: 1.8, duck: 0.9, level: 0.95, bed: 0.55 });
    const tone = (type, f0, f1, dur, amp, dec, dest, att = 0.003, at = t) => { const o = c.createOscillator(), g = E.gain(0); o.type = type;
      o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur);
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(amp, at + att); g.gain.setTargetAtTime(0, at + att, dec); o.connect(g).connect(dest); o.start(at); o.stop(at + dec * 8 + 0.05); };
    // the press: dry and up front
    const th = E.gain(1), sh = c.createWaveShaper(), tl = E.filt('lowpass', 3200, 0.5), dry = E.gain(1.3), wet = E.gain(0.55);
    sh.curve = satCurve(2.5); sh.oversample = '2x'; th.connect(sh).connect(tl); tl.connect(dry).connect(d.lim); tl.connect(wet).connect(d);
    tone('sine', 190, 90, 0.06, 0.6, 0.03, th, 0.002);
    tone('triangle', 360, 160, 0.06, 0.9, 0.026, th, 0.002);
    tone('sine', 300, 270, 0.02, 0.35, 0.02, th, 0.0015);                                                   // the wooden block of the stamp
    { const s = E.src('pink', t, { loop: false }), b = E.filt('bandpass', 1300, 1.2), g = E.gain(0);           // the 'tok' (definition)
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.45, t + 0.0015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.025); s.connect(b).connect(g).connect(th); s.stop(t + 0.05); }
    // the rubber + ink squish: a short wet noise sliding down, just after the contact
    { const T = t + 0.012, s = E.src('pink', T, { loop: false }), b = E.filt('bandpass', 1400, 3), g = E.gain(0);
      b.frequency.setValueAtTime(1400, T); b.frequency.exponentialRampToValueAtTime(420, T + 0.09);
      g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(0.5, T + 0.012); g.gain.setTargetAtTime(0, T + 0.03, 0.03); s.connect(b).connect(g).connect(d); s.stop(T + 0.3); }
    bloop(E, t + 0.02, d, 420, 210, 0.07, 0.12, 'sine');                                                      // the little suck as it lifts
    // a tiny wooden settle
    bone(E, t + 0.12, d, 620, 0.09, 0.15, 0.06, true);
    // approval: a warm, resolving tone under one bright ding
    const ap = E.gain(1); ap.connect(d);
    const warm = (f, at, dur, amp, pan) => { const o = c.createOscillator(), o2 = c.createOscillator(), g = E.gain(0), p = E.pan(pan); o.type = 'triangle'; o.frequency.value = f; o2.frequency.value = f * 2.001;
      const g2 = E.gain(0.18); o2.connect(g2).connect(g); o.connect(g); g.connect(p).connect(ap);
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(amp, at + 0.06); g.gain.setTargetAtTime(amp * 0.7, at + 0.1, 0.2); g.gain.setTargetAtTime(0, at + dur, 0.18);
      for (const x of [o, o2]) { x.start(at); x.stop(at + dur + 1.2); } };
    warm(523.3, t + 0.05, 0.25, 0.05, -0.2); warm(659.3, t + 0.05, 0.25, 0.04, 0.2);                           // C5 + E5...
    warm(784, t + 0.2, 0.45, 0.055, 0); warm(1046.5, t + 0.2, 0.45, 0.03, 0.1);                               // ...settling on G5 + C6
    chime(E, t + 0.04, ap, 2093, 0.045, 1.1, 0.1);                                                            // the 'ding' of approval
  },
};
Object.assign(SHOTS, fxShots);
// a little brass voice: two detuned saws through a lowpass that opens with the note (the 'blat' of a horn), optional swell + vibrato for held notes
function brass(E, T, dest, f, dur, amp, pan = 0, held = false) {
  const g = E.gain(0), lp = E.filt('lowpass', f * 1.5, 1.2), p = E.pan(pan); g.connect(lp).connect(p).connect(dest);
  for (const det of [-6, 7]) { const o = E.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det; o.connect(g); o.start(T); o.stop(T + dur + 0.25);
    if (held) { const v = E.ctx.createOscillator(), vg = E.gain(9); v.frequency.value = 5.5; v.connect(vg).connect(o.detune); v.start(T + 0.2); v.stop(T + dur + 0.25); } }
  lp.frequency.setValueAtTime(f * 1.2, T); lp.frequency.linearRampToValueAtTime(Math.min(6000, f * 5), T + 0.04); lp.frequency.setTargetAtTime(f * 2.6, T + 0.05, 0.08);
  g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(amp, T + 0.015); g.gain.setTargetAtTime(amp * 0.7, T + 0.03, 0.05);
  if (held) { g.gain.setTargetAtTime(amp * 1.05, T + 0.15, 0.2); lp.frequency.setTargetAtTime(f * 3.4, T + 0.15, 0.2); }
  g.gain.setTargetAtTime(0, T + dur, held ? 0.12 : 0.03);
}
// round 15.2: a crow-ish 'CAW' (original): a sawtooth voice that pops up then bends down (~600 -> 360 Hz), roughened by a fast sub-rate wobble (the rasp)
// and a little breathy noise, through two nasal formant bands (~1.1 kHz, ~1.9 kHz) with the low end thinned out; ~0.3 s, once
function caw(E, T, dest, side = 1) {
  const c = E.ctx, dur = 0.3, out = E.gain(0), hp = E.filt('highpass', 420, 0.7), p = E.pan(-side * 0.25); out.connect(hp).connect(p);
  const dry = E.gain(E.settings.fx.volume), wet = E.gain(0.1); p.connect(dry).connect(E.bpan.fx); p.connect(wet).connect(dest);                   // mostly dry: a long room tail would drag the gag out
  const f1 = E.filt('bandpass', 1150, 4), f2 = E.filt('bandpass', 1900, 5), g1 = E.gain(1), g2 = E.gain(0.35), mix = E.gain(1);   // (15.2: the upper formant softer: it sits behind)
  mix.connect(f1).connect(g1).connect(out); mix.connect(f2).connect(g2).connect(out);
  f1.frequency.setValueAtTime(1000, T); f1.frequency.linearRampToValueAtTime(1250, T + 0.06); f1.frequency.exponentialRampToValueAtTime(950, T + dur);   // the beak opens, then closes
  const o = c.createOscillator(), rasp = E.gain(1); o.type = 'sawtooth';
  o.frequency.setValueAtTime(520, T); o.frequency.linearRampToValueAtTime(610, T + 0.04); o.frequency.exponentialRampToValueAtTime(360, T + dur);
  const w = c.createOscillator(), wg = E.gain(0.55); w.type = 'square'; w.frequency.setValueAtTime(95, T); w.frequency.linearRampToValueAtTime(70, T + dur);   // the rasp: a gritty amplitude flutter
  w.connect(wg).connect(rasp.gain); const j = c.createOscillator(), jg = E.gain(14); j.frequency.value = 33; j.connect(jg).connect(o.frequency);     // and a little pitch jitter
  o.connect(rasp).connect(mix);
  const n = E.src('white', T, { loop: false }), ng = E.gain(0.35); n.connect(ng).connect(mix);                                                      // breath in the throat
  out.gain.setValueAtTime(0, T); out.gain.linearRampToValueAtTime(0.18, T + 0.025); out.gain.setTargetAtTime(0.13, T + 0.05, 0.08);   // round 15.2: -9 dB, subdued behind the hit out.gain.setTargetAtTime(0, T + dur - 0.06, 0.03);
  for (const x of [o, w, j]) { x.start(T); x.stop(T + dur + 0.2); } n.stop(T + dur + 0.2);
}
// round 15.2: RED INKY SAYS 'BAKA' - reworked (Tiago: 'darker, gritty, like an old man is saying it. Bahkah. The sound of disappointment baked in').
// Pure formant synthesis (original; no recordings, no TTS). An OLD MAN's voice: a sawtooth 'glottis' at ~85-120 Hz (falling), roughened with
// pulse jitter (noise on its pitch), a creaky sub-harmonic flutter (vocal fry), breathy rasp mixed into the source and a slow tremble of age,
// through adult-male 'ah' formants (700 / 1100 / 2450 Hz), darkened by a lowpass. Delivery: a soft low 'tsk' and a weary sigh out of the nose,
// a heavy drawn 'BAAH' that sags, a firm 'k' (a burst + breath through the vowel's formants), and a tired, dropping 'kah' that trails off into
// breath and creak. ~1.6 s. vo: lab overrides (variants were auditioned against a speech recognizer).
function redBaka(E, t0, vo = {}) {
  const P = { f0: 1, fm: 1, sigh: 0.5, tsk: 1, creak: 0.55, breath: 0.22, jit: 5, len: 0.46, gap: 0.085, kAmp: 1.3, kf: 1400, kQ: 3, aspF: 0.2, dbl: 0.6, bar: 0.12, rel: 0.3, f1b: 300, f2b: 700, kaLen: 0.34, dark: 2800, vot: 0.05, ...vo }, q = P.f0, m = P.fm;
  const c = E.ctx, d0 = fxOut(E), dark = E.filt('lowpass', P.dark, 0.6), out = E.gain(1.5), p = E.pan(0.15); out.connect(dark).connect(p).connect(d0);
  const noise = (T, dur, f, Q, a, type = 'white', dec = dur / 3, dest = out) => { const s = E.src(type, T, { loop: false }), b = E.filt('bandpass', f, Q), g = E.gain(0);
    g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(a, T + 0.002); g.gain.setTargetAtTime(0, T + 0.004, dec); s.connect(b).connect(g).connect(dest); s.stop(T + dur + 0.1); };
  // the weary lead-in: a soft low 'tsk', then a long sigh out through the nose (falling)
  if (P.tsk) noise(t0, 0.02, 2000, 2, 0.18, 'white', 0.005);
  const S0 = t0 + (P.tsk ? 0.06 : 0);
  if (P.sigh) { const s = E.src('pink', S0, { loop: false }), b = E.filt('bandpass', 750, 1.4), g = E.gain(0);
    b.frequency.setValueAtTime(900, S0); b.frequency.exponentialRampToValueAtTime(420, S0 + P.sigh);
    g.gain.setValueAtTime(0, S0); g.gain.linearRampToValueAtTime(0.14, S0 + P.sigh * 0.3); g.gain.linearRampToValueAtTime(0, S0 + P.sigh); s.connect(b).connect(g).connect(out); s.stop(S0 + P.sigh + 0.1); }
  const T = S0 + P.sigh * 0.85, A = T + 0.05, Aend = A + P.len, K = Aend + P.gap, KA = K + P.vot, END = KA + P.kaLen;
  // the source: an old, rough glottis
  const o = c.createOscillator(); o.type = 'sawtooth'; const voice = E.gain(0), fry = E.gain(1), src = E.gain(1);
  o.connect(fry).connect(src);
  const br = E.src('pink', T), brg = E.gain(P.breath); br.connect(brg).connect(src); br.stop(END + 0.4);                     // breathy rasp in the source
  src.connect(voice);
  const fr = o.frequency;
  fr.setValueAtTime(100 * q, T); fr.linearRampToValueAtTime(118 * q, A + 0.04); fr.linearRampToValueAtTime(108 * q, A + 0.18); fr.exponentialRampToValueAtTime(86 * q, Aend);   // 'BAAH': up a little, then sagging
  fr.setValueAtTime(102 * q, KA); fr.exponentialRampToValueAtTime(72 * q, END);                                                       // 'kah': tired, dropping
  const jn = E.src('white', T), jl = E.filt('lowpass', 60, 0.7), jg = E.gain(P.jit * q); jn.connect(jl).connect(jg).connect(fr); jn.stop(END + 0.2);   // pulse jitter
  const trem = c.createOscillator(), tg = E.gain(2.2 * q); trem.frequency.value = 5.2; trem.connect(tg).connect(fr);                // the tremble of age (pitch)
  const ta = E.gain(0.12); trem.connect(ta).connect(fry.gain);                                                                        // ...and level (before the voicing gate: silent gaps stay silent)
  const cr = c.createOscillator(), cg = E.gain(0); cr.type = 'square'; cr.frequency.setValueAtTime(50 * q, T); cr.frequency.linearRampToValueAtTime(38 * q, END);   // the creak (sub-harmonic fry)
  cr.connect(cg).connect(fry.gain); cg.gain.setValueAtTime(P.creak * 0.35, T); cg.gain.setValueAtTime(P.creak * 0.35, Aend - 0.2); cg.gain.linearRampToValueAtTime(P.creak, Aend - 0.04);
  cg.gain.setValueAtTime(P.creak * 0.4, KA); cg.gain.setValueAtTime(P.creak * 0.4, END - P.kaLen * 0.55); cg.gain.linearRampToValueAtTime(P.creak * 1.1, END);
  // the formants (adult male 'ah') + a 'b' voice bar
  const F = [[700 * m, 6, 1], [1100 * m, 9, 0.6], [2450 * m, 12, 0.2]].map(([f, Q, a]) => { const b = E.filt('bandpass', f, Q), g = E.gain(a * 3.4); voice.connect(b).connect(g).connect(out); return b; });
  if (P.bar) { const bo = c.createOscillator(), bl = E.filt('lowpass', 300, 0.7), bg = E.gain(0); bo.frequency.value = 100 * q; bg.gain.setValueAtTime(0, T); bg.gain.linearRampToValueAtTime(P.bar, T + 0.012); bg.gain.setValueAtTime(P.bar, A - 0.003); bg.gain.linearRampToValueAtTime(0, A + 0.004); bo.connect(bl).connect(bg).connect(out); bo.start(T); bo.stop(A + 0.02); }
  const v = voice.gain;
  v.setValueAtTime(0, T); v.setValueAtTime(0, A - 0.002);
  v.linearRampToValueAtTime(0.36, A + 0.035); v.setTargetAtTime(0.3, A + 0.08, 0.15); v.setTargetAtTime(0, Aend - 0.03, 0.014);           // 'BAAH' (then the k closure)
  v.setValueAtTime(0, KA); v.linearRampToValueAtTime(0.3, KA + 0.02); v.setTargetAtTime(0.16, KA + 0.06, 0.08); v.setTargetAtTime(0, END - P.kaLen * 0.35, P.kaLen * 0.2);   // 'kah', trailing off
  const [f1, f2, f3] = F;
  f1.frequency.setValueAtTime(P.f1b * m, A); f1.frequency.exponentialRampToValueAtTime(700 * m, A + 0.035);                              // the lips open into 'ah'
  f2.frequency.setValueAtTime(P.f2b * m, A); f2.frequency.exponentialRampToValueAtTime(1100 * m, A + 0.045);
  f1.frequency.setValueAtTime(700 * m, Aend - 0.06); f1.frequency.linearRampToValueAtTime(480 * m, Aend);                               // the velar pinch into 'k'
  f2.frequency.setValueAtTime(1100 * m, Aend - 0.06); f2.frequency.linearRampToValueAtTime(1500 * m, Aend);
  f3.frequency.setValueAtTime(2450 * m, Aend - 0.06); f3.frequency.linearRampToValueAtTime(2000 * m, Aend);
  f1.frequency.setValueAtTime(480 * m, KA); f1.frequency.exponentialRampToValueAtTime(700 * m, KA + 0.04);                              // out of 'k' into 'ah'
  f2.frequency.setValueAtTime(1500 * m, KA); f2.frequency.exponentialRampToValueAtTime(1100 * m, KA + 0.05);
  f3.frequency.setValueAtTime(2000 * m, KA); f3.frequency.exponentialRampToValueAtTime(2450 * m, KA + 0.05);
  noise(A - 0.003, 0.012, 600, 1, P.rel, 'pink', 0.004);                                                                               // the 'b' release
  noise(K, 0.02, P.kf, P.kQ, P.kAmp, 'white', 0.006);                                                                                  // the 'k' burst
  if (P.dbl) noise(K + 0.011, 0.015, P.kf * 1.1, P.kQ, P.kAmp * P.dbl, 'white', 0.005);
  if (P.aspF) { const s = E.src('white', K, { loop: false }), g = E.gain(0); g.gain.setValueAtTime(0, K + 0.008); g.gain.linearRampToValueAtTime(P.aspF, K + 0.016); g.gain.setTargetAtTime(0, KA - 0.004, 0.009);
    s.connect(g); g.connect(F[1]); g.connect(F[2]); s.stop(KA + 0.08); }
  { const s = E.src('pink', END - P.kaLen * 0.4, { loop: false }), b = E.filt('bandpass', 800, 1.2), g = E.gain(0), T2 = END - P.kaLen * 0.4;    // trailing off into breath
    g.gain.setValueAtTime(0, T2); g.gain.linearRampToValueAtTime(0.06, T2 + 0.08); g.gain.linearRampToValueAtTime(0, END + 0.25); s.connect(b).connect(g).connect(out); s.stop(END + 0.3); }
  for (const x of [o, trem, cr]) { x.start(T); x.stop(END + 0.15); }
}
// a bone / woodblock strike: a hollow sine body with a high inharmonic 'clack' partial (3.9x) that dies at once, plus a dry noise tick
function bone(E, T, dest, f, amp, pan = 0, dec = 0.11, hollow = false) {
  const p = E.pan(pan); p.connect(dest);
  for (const [m, a, dk] of hollow ? [[1, 1, 1], [2.3, 0.5, 0.35], [5.1, 0.18, 0.12]] : [[1, 1, 1], [3.9, 0.45, 0.25], [9.2, 0.15, 0.1]]) {
    const o = E.ctx.createOscillator(), g = E.gain(0); o.type = 'sine'; o.frequency.setValueAtTime(f * m * 1.015, T); o.frequency.exponentialRampToValueAtTime(f * m, T + 0.02);
    g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(amp * a, T + 0.0015); g.gain.exponentialRampToValueAtTime(0.0001, T + dec * dk + 0.01); o.connect(g).connect(p); o.start(T); o.stop(T + dec * dk + 0.03);
  }
  const n = E.src('white', T, { loop: false }), b = E.filt('bandpass', Math.min(5000, f * 4.5), 2), g = E.gain(0);
  g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(amp * 0.8, T + 0.0005); g.gain.exponentialRampToValueAtTime(0.0001, T + 0.012); n.connect(b).connect(g).connect(p); n.stop(T + 0.02);
}
function pulseWave(c, duty) { const n = 32, re = new Float32Array(n), im = new Float32Array(n); for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty); return c.createPeriodicWave(re, im); }
// round 15.2 (v3, Tiago: 'loud, thunderous, deep, bellowing reverb ... shakes the Earth'; 'all the stamp sounds big and heavy with a lot of
// reverb and echo and resonance'): THE STAMP ROOM, shared by every stamp. Input -> gentle tanh saturation (size) -> a big dark hall (a generated
// 2.8 s stereo IR, 30 ms pre-delay, darkening as it decays) + low-passed feedback echoes that rumble away + low tuned resonances (the floor
// shaking, blooming after the hit) + the dry hit -> a limiter -> the fx level, straight to the master (past the fx bus's 80 Hz low cut, so
// the sub boom survives on headphones / speakers; phones get the 80-250 Hz weight). Returns the input node. o: wet, echo, ring, duck (s).
function stampIR(c) {
  const sr = c.sampleRate, pre = Math.round(sr * 0.03), n = Math.round(sr * 2.8), b = c.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); let lp = 0;
    for (let i = pre; i < n; i++) { const t = (i - pre) / sr, a = 0.5 * Math.exp(-t * 2.6) + 0.04; lp += (Math.random() * 2 - 1 - lp) * a;   // the one-pole closes as it decays: a dark tail
      d[i] = lp * Math.exp(-t * 2.6) * Math.min(1, t / 0.012) * Math.min(1, (n - i) / (sr * 0.25)); } }                    // ~-60 dB at 2.7 s, smooth to silence
  let ss = 0; for (let ch = 0; ch < 2; ch++) for (const v of b.getChannelData(ch)) ss += v * v;
  const k = 0.7 / Math.sqrt(ss / 2 + 1e-9); for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] *= k; }
  return b;
}
function satCurve(k) { const n = 1024, cv = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; cv[i] = Math.tanh(k * x) / Math.tanh(k); } return cv; }
function stampRoom(E, t, { wet = 1, echo = 1, ring = 1, drive = 2.2, duck = 0, level = 1, bed = 1 } = {}) {
  const c = E.ctx; if (E._stampIRc !== c) { E._stampIR = stampIR(c); E._stampIRc = c; }
  const inp = E.gain(1), sh = c.createWaveShaper(); sh.curve = satCurve(drive); sh.oversample = '2x';
  const tone = E.filt('lowpass', 6500, 0.5), sum = E.gain(bed), lim = c.createDynamicsCompressor(), out = E.gain(0);
  lim.threshold.value = -9; lim.knee.value = 4; lim.ratio.value = 14; lim.attack.value = 0.002; lim.release.value = 0.3;
  inp.connect(sh).connect(tone); tone.connect(sum);                                                            // the dry hit
  const cv = c.createConvolver(); cv.buffer = E._stampIR; const cvg = E.gain(1.1 * wet); tone.connect(cv).connect(cvg).connect(sum);   // the hall
  if (echo > 0) { const dl = c.createDelay(1), fb = E.gain(0.34), elp = E.filt('lowpass', 900, 0.6), eg = E.gain(0.38 * echo);         // the echoes (rumbling away, darker each time)
    dl.delayTime.value = 0.26; tone.connect(dl); dl.connect(elp).connect(fb).connect(dl); elp.connect(eg).connect(sum); eg.connect(cv); }
  if (ring > 0) for (const [f, a, Q] of [[58, 1, 18], [87, 0.7, 16], [116, 0.45, 14]]) { const bp = E.filt('bandpass', f, Q), g = E.gain(0);   // the floor resonances bloom just after the hit
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.7 * a * ring, t + 0.12); g.gain.setTargetAtTime(0, t + 0.5, 0.5); inp.connect(bp).connect(g).connect(sum); }
  sum.connect(lim).connect(out).connect(E.master);
  const L = E.settings.fx.volume * level; out.gain.setValueAtTime(L, t);
  if (duck) out.gain.setTargetAtTime(L * 0.6, t + duck, 0.25);                                                   // the tail steps ~4 dB back for what follows (the sad notes)
  inp.lim = lim;                                                                                                 // (straight into the limiter: for a dry, up-front layer, e.g. the back stamp's thunk)
  return inp;
}
// round 15.2 (v3): the back stamp: an earth-shaking slam of a giant stamp. v3.1 (Tiago: 'the beginning needs a deep loud thunk'): it opens on a
// dense, DRY, up-front THUNK (a heavy solid block on thick wood): a fast pitch-dropping body (sine 150 -> 60 Hz, ~90 ms) + its octave (triangle
// 300 -> 120 Hz: the phone hears it), a tight dull wooden knock (bandpassed brown noise ~280 Hz + two short wood tones 230 / 340 Hz) and a
// click-free 'tok' (pink noise ~1.1 kHz, 1.5 ms rise) for definition, all soft-clipped (tanh) for punch and fed mostly straight into the room's
// limiter (only a little into the hall). THEN the boom he liked swells in under it (sine 90 -> 30 Hz, ~1.5 s, + a 175 -> 88 Hz body), the floor
// rattle, and the stamp room (hall, echoes, floor resonances); its tail ducks ~4 dB as the sad notes arrive (~1.3 s).
function bigStamp(E, t) {
  const c = E.ctx, d = stampRoom(E, t, { wet: 1, echo: 1, ring: 0.6, drive: 2.4, duck: 1.15, level: 2.7, bed: 0.3 });   // bed: the rumble sits ~7 dB under the limiter so the thunk stands out
  const tone = (type, f0, f1, dur, amp, dec, dest = d, att = 0.004) => { const o = c.createOscillator(), g = E.gain(0); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(amp, t + att); g.gain.setTargetAtTime(0, t + Math.max(0.02, att), dec); o.connect(g).connect(dest); o.start(t); o.stop(t + dec * 8 + 0.05); };
  // THE THUNK: dry and first
  const th = E.gain(1), sh = c.createWaveShaper(), tl = E.filt('lowpass', 3000, 0.5), dry = E.gain(1.8), wet = E.gain(0.5);
  sh.curve = satCurve(3); sh.oversample = '2x'; th.connect(sh).connect(tl); tl.connect(dry).connect(d.lim); tl.connect(wet).connect(d);
  tone('sine', 150, 60, 0.07, 1.0, 0.03, th, 0.002);                                                       // the body: fast pitch drop, ~90 ms
  tone('triangle', 300, 120, 0.07, 1.1, 0.028, th, 0.002);                                                // its octave (energy at 120-300 Hz for phones)
  for (const [f, a, dec] of [[230, 0.6, 0.024], [340, 0.4, 0.017]]) tone('sine', f * 1.05, f, 0.02, a, dec, th, 0.0015);   // the wood's two short tones
  { const s = E.src('brown', t, { loop: false }), b = E.filt('bandpass', 280, 1.4), g = E.gain(0);                        // the dull wooden knock
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(3.2, t + 0.0015); g.gain.setTargetAtTime(0, t + 0.004, 0.022); s.connect(b).connect(g).connect(th); s.stop(t + 0.2); }
  { const s = E.src('pink', t, { loop: false }), b = E.filt('bandpass', 1100, 1.2), g = E.gain(0);                         // the 'tok': definition, no click
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.0015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03); s.connect(b).connect(g).connect(th); s.stop(t + 0.05); }
  // ...THEN the earth-shaking rumble he liked, swelling in under the thunk
  tone('sine', 90, 30, 0.9, 0.4, 0.34, d, 0.03);                                                           // the sub boom
  tone('sine', 175, 88, 0.5, 0.6, 0.22, d, 0.025);                                                         // its body
  wash(E, t + 0.03, d, { dur: 0.35, f0: 500, f1: 120, amp: 0.35, type: 'brown' });                          // the table and floor rattle under it
}
function stampHit(E, t, d, w) {
  bloop(E, t, d, 190 * (2 - w * 0.7), 70, 0.22 * w, 0.75, 'triangle');                                 // the body
  bloop(E, t, d, 310, 260, 0.06, 0.4 * w, 'sine');                                                     // the knock
  const s = E.src('white', t, { loop: false }), b = E.filt('bandpass', 900, 1.1), g = E.gain(0);       // the wooden 'tok' + paper slap
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.9 * w, t + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05); s.connect(b).connect(g).connect(d); s.stop(t + 0.07);
  wash(E, t, d, { dur: 0.08, f0: 3800, f1: 900, amp: 0.25 * w, type: 'white' });
  wash(E, t + 0.04, d, { dur: 0.18, f0: 700, f1: 250, amp: 0.35 * w, type: 'brown' });                  // a dull rattle of the desk
}
// OLD PAPER / A MAP UNFOLDING: crunchy crinkle bursts (clusters of 1-5 ms broadband ticks), a crisp rustle bed, a few creases (longer crackles); open rises, close falls
function mapPaper(E, t, { dur, open }) {
  const S = E.settings.scroll, cr = 0.4 + S.crackle * 1.3, d0 = E.filt('lowpass', 4800 + 2200 * S.tone, 0.5), d = E.gain(open ? 4 : 1.8); d.connect(d0).connect(E.bus.scroll);
  const bed = E.src('white', t), bb = E.filt('bandpass', open ? 1500 : 2600, 0.7), bg = E.gain(0), am = E.gain(0.6);
  bb.frequency.setValueAtTime(open ? 1500 : 2600, t); bb.frequency.exponentialRampToValueAtTime(open ? 2100 : 1300, t + dur);
  lfoOn(E, 13, 0.4, am.gain); lfoOn(E, 21, 0.25, am.gain);                              // the rustle flutters
  bg.gain.setValueAtTime(0, t); bg.gain.linearRampToValueAtTime(open ? 0.16 : 0.13, t + dur * (open ? 0.6 : 0.2)); bg.gain.setTargetAtTime(0, t + dur * (open ? 0.85 : 0.6), 0.08);
  bed.connect(bb).connect(am).connect(bg).connect(d); bed.stop(t + dur + 0.5);
  const tick = (T, a, f, len, pan) => { const s = E.src('grain', T, { loop: false, rate: rnd(0.8, 1.4) }), b = E.filt('bandpass', f, 0.9), h = E.filt('highpass', 700, 0.7), g = E.gain(0), p = E.pan(pan);
    g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(a, T + 0.0004); g.gain.exponentialRampToValueAtTime(0.0001, T + len); s.connect(b).connect(h).connect(g).connect(p).connect(d); s.stop(T + len + 0.01); };
  const bursts = Math.round((open ? 9 : 6) * cr);
  for (let i = 0; i < bursts; i++) {                                                  // crunch: a cluster of ticks
    const u = open ? Math.pow(Math.random(), 0.8) : Math.pow(Math.random(), 1.6), T = t + u * dur * 0.9, n = Math.round(rnd(5, 14) * (open ? 0.5 + u : 1.4 - u)), pan = rnd(-0.6, 0.6), a = rnd(0.25, 0.6) * (open ? 0.6 + 0.5 * u : 1 - 0.5 * u);
    for (let j = 0; j < n; j++) tick(T + Math.random() * rnd(0.015, 0.05), a * rnd(0.4, 1), rnd(1200, 4200), rnd(0.001, 0.005), pan + rnd(-0.15, 0.15));
  }
  for (let x = 0; x < dur * 0.95;) { x += -Math.log(1 - Math.random()) / (22 * cr); tick(t + x, rnd(0.05, 0.16), rnd(1500, 4500), rnd(0.001, 0.003), rnd(-0.7, 0.7)); }   // the fine crackle in between
  for (let i = 0; i < 3; i++) { const T = t + rnd(0.1, 0.85) * dur; wash(E, T, d, { dur: 0.05, f0: 5000, f1: 1500, amp: 0.16, type: 'white', attack: 0.002 }); }   // creases
  if (open) { wash(E, t + dur * 0.15, d, { dur: 0.25, f0: 1400, f1: 350, amp: 0.3, type: 'pink', attack: 0.03 }); wash(E, t + dur * 0.82, d, { dur: 0.16, f0: 1100, f1: 300, amp: 0.35, type: 'brown', attack: 0.01 }); }   // the sheet swinging open, then laid flat
  if (!open) { const T = t + dur * 0.9; wash(E, T, d, { dur: 0.12, f0: 900, f1: 250, amp: 0.5, type: 'brown', attack: 0.003 }); }   // the roll settles: a soft paper 'flup'
}
function lfoOn(E, f, depth, param) { const o = E.ctx.createOscillator(), g = E.gain(depth); o.frequency.value = f; o.connect(g).connect(param); o.start(E.now); o.stop(E.now + 30); }
// ---------- round 15.1: the credits-scroll rustle (the scroll open / close family, quieter): a fluttering paper band + crisp ticks, both
// following the scroll speed; ticks are scheduled only ~80 ms ahead from each update (no timers of its own), so it stops when the updates do ----------
function rustleVoice(E, t0) {
  const S = E.settings.scroll, d0 = E.filt('lowpass', 3400 + 1400 * S.tone, 0.5), out = E.gain(0), tk = E.gain(3.3); out.connect(d0).connect(E.bus.scroll); tk.connect(d0);
  const bed = E.src('white', t0), bb = E.filt('bandpass', 1600, 0.8), am = E.gain(0.6), lf = [[11, 0.35], [17, 0.25]].map(([f, dp]) => { const o = E.ctx.createOscillator(), g = E.gain(dp); o.frequency.value = f; o.connect(g).connect(am.gain); o.start(t0); return o; });
  bed.connect(bb).connect(am).connect(out);
  const tick = (T, a, f, len, pan) => { const s = E.src('grain', T, { loop: false, rate: rnd(0.8, 1.4) }), b = E.filt('bandpass', f, 0.9), h = E.filt('highpass', 700, 0.7), g = E.gain(0), p = E.pan(pan);
    g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(a, T + 0.0004); g.gain.exponentialRampToValueAtTime(0.0001, T + len); s.connect(b).connect(h).connect(g).connect(p).connect(tk); s.stop(T + len + 0.01); };
  let next = t0, sp = 0;
  return {
    update(v, t) {
      sp = v; out.gain.setTargetAtTime(1.65 * Math.pow(v, 0.8), t, 0.06); bb.frequency.setTargetAtTime(1400 + 1000 * v, t, 0.1);
      if (next < t) next = t; const until = t + 0.08;
      while (v > 0.04 && next < until) { tick(next, rnd(0.12, 0.3) * (0.4 + 0.6 * v), rnd(1200, 3000), rnd(0.001, 0.004), rnd(-0.5, 0.5)); next += rnd(0.015, 0.06) / (0.3 + v); }
    },
    stop(t) { out.gain.setTargetAtTime(0, t, 0.09); bed.stop(t + 0.8); for (const o of lf) o.stop(t + 0.8); },
  };
}
// ---------- the drag churn: two resonant noise bands wobbling faster / louder with the finger speed, bubbles popping at a speed-driven rate ----------
function churnVoice(E, inky, t0) {
  const k = K(), d = inkyOut(E), out = E.gain(0), dk = E.gain(1); out.connect(dk).connect(d);
  const s1 = E.src('brown', t0), b1 = E.filt('bandpass', 260 * k, 4.5), g1 = E.gain(1.1); s1.connect(b1).connect(g1).connect(out);
  const s2 = E.src('pink', t0), b2 = E.filt('bandpass', 700 * k, 8), g2 = E.gain(0); s2.connect(b2).connect(g2).connect(out);
  const l1 = E.lfo(4.5, 110 * k, b1.frequency), l2 = E.lfo(6.3, 260 * k, b2.frequency);
  let last = t0, sp = 0;
  return {
    update(speed, t) {
      sp = speed;
      out.gain.setTargetAtTime(0.05 + 0.6 * Math.pow(speed, 0.8), t, 0.06); g2.gain.setTargetAtTime(0.5 * Math.pow(speed, 1.5), t, 0.08);
      l1.o.frequency.setTargetAtTime(3 + 6 * speed, t, 0.1); l2.o.frequency.setTargetAtTime(4 + 9 * speed, t, 0.1);
      b1.frequency.setTargetAtTime((220 + 160 * speed) * k, t, 0.1);
      const dt = Math.max(0, t - last); last = t; const lam = 14 * speed * dt, n = Math.floor(lam) + (Math.random() < lam % 1 ? 1 : 0);
      for (let i = 0; i < n; i++) plip(E, t + Math.random() * dt, d, { f: rnd(300, 900) * k, amp: rnd(0.04, 0.12), dur: rnd(0.04, 0.08), pan: rnd(-0.4, 0.4) });
    },
    duck(t, s) { dk.gain.cancelScheduledValues(t); dk.gain.setTargetAtTime(1 - 0.7 * clamp(s), t, 0.01); dk.gain.setTargetAtTime(1, t + 0.09, 0.08); },   // get out of the way of the wall slap
    stop(t) { out.gain.setTargetAtTime(0, t, 0.12); for (const n of [s1, s2, l1.o, l2.o]) n.stop(t + 0.8); if (sp > 0.3) plip(E, t, d, { f: 420 * k, amp: 0.12, dur: 0.07 }); },
  };
}
