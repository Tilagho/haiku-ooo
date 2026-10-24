// haiku.ooo SOUND ENGINE (round 15.0: moved here from lab/sound/sound-engine.js, which now re-exports this file for the lab page).
// The site wiring is src/sound-wire.js (events arrive through src/sfx.js).
// Everything is synthesized with the Web Audio API: no audio files, no ScriptProcessor / AudioWorklet.
// Cheap on iPhone: a few pre-generated noise AudioBuffers (white / pink / brown, 8 s, seamless loops) played from random offsets,
// BiquadFilters, gains, StereoPanners, a few slow OscillatorNode LFOs, scheduled automation, and one short generated reverb IR.
//
//   const snd = new SoundEngine();               // settings + mute come from localStorage
//   snd.unlock();                                // call inside the first touch / click handler (creates + resumes the AudioContext)
//   snd.startBed();                              // the universal reading bed: wind + waterfall, slowly crossfading / pan-drifting (~1 min cycle)
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
  wind: { volume: 0.42, tone: 0.45, gust: 0.5, width: 0.7 },
  waterfall: { volume: 0.42, tone: 0.35, intensity: 0.5, drops: 0.35 },
  inky: { volume: 0.7, tone: 0.5, wet: 0.35 },
  scroll: { volume: 0.6, tone: 0.5, crackle: 0.5 },
  poof: { volume: 0.5 },
  fx: { volume: 0.55, tone: 0.5 },          // the little moments: egg reveal, scurry, bird hit, sad notes, stamps
};
const KEY = 'hb-sound', MUTE_KEY = 'hb-sound-muted';
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const clone = o => JSON.parse(JSON.stringify(o));
const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

export class SoundEngine {
  constructor({ settings, persist = true } = {}) {
    this.persist = persist;
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
        document.addEventListener('visibilitychange', this._vis);
        this.timer = setInterval(() => { if (this.ctx.state === 'running') this.pump(); }, 1000);   // nothing scheduled while suspended (hidden / muted)
        if (this.muted) { this.master.gain.value = 0; c.suspend?.(); }
        for (const f of this._queue.splice(0)) f();
      });
    }
    const c = this.ctx || this._pending;
    if (c.state !== 'running' && !(this.muted && this.ctx)) c.resume?.().catch?.(() => {});
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
    for (let i = 0; i < 4; i++) { await step(); out.patterPart = makePatter(c, 8, 110, out.patterPart, i, 4); }
    out.noise.patter = out.patterPart.buf; delete out.patterPart;
    await step(); out.ir = makeIR(c, 1.6);
    await step(); return out;
  }
  attach(ctx, bufs = null) {
    this.ctx = ctx; const c = ctx, sr = c.sampleRate;
    this.noise = bufs?.noise ?? { white: makeNoise(c, 'white'), pink: makeNoise(c, 'pink'), brown: makeNoise(c, 'brown') };
    this.grain = bufs?.grain ?? makeNoise(c, 'white', 0.25);
    if (!this.noise.patter) this.noise.patter = makePatter(c).buf;           // the in-view waterfall's shower patter (one 8 s buffer, built once)
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
    if (document.hidden) { this.master.gain.setTargetAtTime(0, this.now, 0.08); clearTimeout(this._susT); this._susT = setTimeout(() => document.hidden && this.ctx.suspend(), 400); }   // hidden: fade, then suspend
    else if (!this.muted) { clearTimeout(this._susT); this.ctx.resume().then(() => { this.master.gain.setTargetAtTime(this.settings.master.volume, this.now, 0.3); this.pump(); }).catch(() => {}); }   // (iOS may refuse until the next tap: the wiring re-unlocks then)
  }
  // the scheduler: ambient voices schedule their slow changes / gusts / droplets ahead of time (realtime: every second, 4 s ahead; offline: pump(duration))
  pump(ahead = 4) {
    if (!this.ctx) return; const to = (this.ctx instanceof OfflineAudioContext ? 0 : this.now) + ahead;
    for (const v of Object.values(this.amb)) v.schedule(to);
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
  startBed() { if (!this.ctx) return this._defer(() => this.startBed()); this.bedOn = true; this.startAmbient(['wind', 'waterfall']); this._bedLfo(true); }
  stopBed() { this.bedOn = false; this.stopAmbient(this.near ? ['wind'] : ['wind', 'waterfall']); }
  _bedLfo(on) {
    const t = this.now;
    if (this.bedLfo) { for (const o of this.bedLfo) o.stop(t + 0.05); this.bedLfo = null; for (const g of ['wind', 'waterfall']) { this.mix[g].gain.setTargetAtTime(1, t, 2); this.bpan[g].pan.setTargetAtTime(0, t, 2); } }
    if (!on) return;
    const x = this.ctx.createOscillator(), pn = this.ctx.createOscillator(); x.frequency.value = 1 / 56; pn.frequency.value = 1 / 71;
    const xw = this.gain(0.3), xf = this.gain(-0.3), pw = this.gain(0.35), pf = this.gain(-0.35);
    x.connect(xw).connect(this.mix.wind.gain); x.connect(xf).connect(this.mix.waterfall.gain); pn.connect(pw).connect(this.bpan.wind.pan); pn.connect(pf).connect(this.bpan.waterfall.pan);
    this.mix.wind.gain.setValueAtTime(0.75, t); this.mix.waterfall.gain.setValueAtTime(0.75, t);
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
  startDrag(inky = 'black', when) { if (!this.ctx) return this._defer(() => this.startDrag(inky)); this.stopDrag(when); this.drag = churnVoice(this, inky, when ?? this.now); }
  updateDrag(speed, when) { this.drag?.update(clamp(speed), when ?? this.now); }
  stopDrag(when) { this.drag?.stop(when ?? this.now); this.drag = null; }
  dragImpact(strength = 1, when) { if (!this.ctx) return this._defer(() => this.dragImpact(strength)); const t = when ?? this.now; this.drag?.duck(t, clamp(strength)); SHOTS.wetSlap(this, t, { strength: clamp(strength) }); }   // he squishes into a wall / the ceiling / the floor
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
function windVoice(E) {
  const c = E.ctx, S = E.settings.wind, t0 = E.now, nodes = [];
  const out = E.gain(0), lp = E.filt('lowpass', 1600, 0.5), env = E.gain(0.55);
  env.connect(lp).connect(out).connect(E.bus.wind);
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
  wetSlap(E, t, p) {                                                                   // the squish into a wall: a short wet slap, scaled by strength (body 180-700 Hz so phones play it)
    const S = clamp(p.strength ?? 1), d = inkyOut(E), a = 0.25 + 0.75 * S;
    wash(E, t, d, { dur: 0.16 + 0.1 * S, f0: 2600, f1: 380, amp: 0.55 * a, type: 'white', Q: 1.2 });
    gurgle(E, t, d, 0.18, 700, 220, 3, 0.9 * a, 0.004);
    bloop(E, t, d, 320, 170, 0.12, 0.35 * a, 'triangle');
    for (let i = 0; i < Math.round(2 + 4 * S); i++) plip(E, t + rnd(0.03, 0.22), d, { f: rnd(350, 1000), amp: rnd(0.03, 0.08) * a, dur: rnd(0.04, 0.07), pan: rnd(-0.6, 0.6) });
  },
  scrollOpen(E, t) { mapPaper(E, t, { dur: 1.3, open: true }); },
  scrollClose(E, t) { mapPaper(E, t, { dur: 0.95, open: false }); },
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
    const d = fxOut(E), m = E.gain(1); m.connect(d);
    for (const [f, a] of [[1900, 0.32], [3100, 0.2], [4700, 0.09]]) { const o = E.ctx.createOscillator(), g = E.gain(0); o.type = 'triangle'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.92, t + 0.03);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.0007); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045); o.connect(g).connect(m); o.start(t); o.stop(t + 0.05); }
    const n = E.src('white', t, { loop: false }), nb = E.filt('bandpass', 2600, 1.3), ng = E.gain(0); ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.75, t + 0.0005); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.018); n.connect(nb).connect(ng).connect(m); n.stop(t + 0.03);
    bloop(E, t, m, 240, 140, 0.06, 0.55, 'sine');
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
  stampFail(E, t) { stampHit(E, t, fxOut(E), 1.25); },
  // STAMP SUCCESS: a firm, bright stamp, then the same rising arpeggio (C E G C) as a little brass fanfare (bright saw voices through an opening filter,
  // a bell on each note), a quick V chord pickup that RESOLVES on a held C major chord with a swell, and a sparkly shimmer falling over it
  stampSuccess(E, t) {
    const d = fxOut(E); stampHit(E, t, d, 0.9);
    const bus = E.gain(0.9); bus.connect(d);
    [523.3, 659.3, 784, 1046.5].forEach((f, i) => { const T = t + 0.1 + i * 0.075; brass(E, T, bus, f, 0.1, 0.085, -0.45 + i * 0.3); chime(E, T, bus, f * 2, 0.035, 0.6, -0.45 + i * 0.3); });
    const P = t + 0.43; [587.3, 784, 987.8].forEach(f => brass(E, P, bus, f, 0.11, 0.05));            // V (D G B), a short pickup...
    const C = P + 0.13; [523.3, 659.3, 784, 1046.5].forEach((f, i) => brass(E, C, bus, f, 0.75, 0.065, -0.3 + i * 0.2, true));   // ...resolving to I (C E G C), held with a swell
    chime(E, C, bus, 2093, 0.05, 1.4, 0); chime(E, C + 0.01, bus, 1568, 0.04, 1.2, 0.3);
    for (let i = 0; i < 14; i++) { const u = i / 13; chime(E, C + 0.05 + u * 0.9 + rnd(0, 0.05), bus, lerp(4200, 2100, u) * rnd(0.95, 1.05), 0.022 * (1 - 0.5 * u), 0.35, rnd(-0.8, 0.8)); }   // shimmer cascading down
  },
  // the INK WASH on publish: a whole bucket of ink dumped: a rising surge (a lowpass opening over pink + brown), a big splash crest, the pour running out, spray falling back
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
