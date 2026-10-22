// Board Inky's little brain, kept DOM-free so it can be tested in Node:
//   TapMeter         taps -> squish / annoyed / mad / SPLAT (after a random 6-12 taps, rerolled each time)
//   SpeechScheduler  ambient one-liners every ~25-60 s, never while composing, one bubble at a time, with a cooldown
//   LINES            what he says (real quote openings that trail off)
//   readMs(text)     how long a bubble stays: 2.5 s + 60 ms per character

export const LINES = [
  { text: 'do you wanna write one?' },
  { text: 'just here to read?' },
  { text: 'psst. the button\nis right there.' },
  { text: "i'm reading\nthis one too." },
  { text: 'the supreme art\nof war is…', who: 'Sun Tzu, The Art of War' },
  { text: 'if you know the\nenemy and…', who: 'Sun Tzu, The Art of War' },
  { text: 'all warfare is\nbased on…', who: 'Sun Tzu, The Art of War' },
  { text: 'let your plans be\ndark and impenetrable as…', who: 'Sun Tzu, The Art of War (Giles)' },
  { text: 'think lightly of\nyourself and…', who: 'Miyamoto Musashi, Dokkōdō' },
  { text: 'accept everything\njust the way…', who: 'Miyamoto Musashi, Dokkōdō' },
  { text: 'from one thing,\nknow ten thousand…', who: 'Miyamoto Musashi, The Book of Five Rings' },
  { text: 'the months and days\nare travelers of…', who: 'Matsuo Bashō, Oku no Hosomichi' },
  { text: 'old pond…\na frog jumps in…', who: 'Matsuo Bashō' },
  { text: 'do not seek to follow\nin the footsteps of…', who: 'Matsuo Bashō (after Kūkai)' },
  { text: 'to study the self\nis to…', who: 'Dōgen, Genjōkōan' },
  { text: 'the way of the samurai\nis found in…', who: 'Yamamoto Tsunetomo, Hagakure' },
  { text: 'the flowing river\nnever stops, and yet…', who: 'Kamo no Chōmei, Hōjōki' },
  { text: 'the sound of the\nGion Shoja bells…', who: 'The Tale of the Heike' },
  { text: 'in this world we walk\non the roof of hell…', who: 'Kobayashi Issa' },
  { text: 'the thief\nleft it behind…', who: 'Ryōkan' },
  { text: 'to while away\nthe idle hours…', who: 'Yoshida Kenkō, Essays in Idleness (Sansom)' },
  { text: 'in spring\nit is the dawn…', who: 'Sei Shōnagon, The Pillow Book (Morris)' },
];
export const readMs = text => 2500 + 60 * text.replace(/\n/g, '').length;

// Tap logic. tap(now) -> { kind, taps } where kind is 'squish' | 'annoyed' | 'mad' | 'splat'.
// He gets annoyed from the 3rd tap, MAD from the 5th, and splats on tap #splatAt (random 6-12, rerolled after
// every splat). While splatted, taps do nothing. A pause of `calm` ms forgets the count (he calms down).
export class TapMeter {
  constructor({ rand = Math.random, min = 6, max = 12, calm = 7000 } = {}) {
    this.rand = rand; this.min = min; this.max = max; this.calm = calm; this.taps = 0; this.last = -Infinity; this.splatted = false; this.reroll();
  }
  reroll() { this.splatAt = this.min + Math.floor(this.rand() * (this.max - this.min + 1)); return this.splatAt; }
  tap(now) {
    if (this.splatted) return { kind: 'ignored', taps: this.taps };
    if (now - this.last > this.calm) this.taps = 0;
    this.last = now; this.taps++;
    if (this.taps >= this.splatAt) { this.splatted = true; return { kind: 'splat', taps: this.taps }; }
    return { kind: this.taps >= 5 ? 'mad' : this.taps >= 3 ? 'annoyed' : 'squish', taps: this.taps };
  }
  revive() { this.splatted = false; this.taps = 0; this.last = -Infinity; this.reroll(); }      // popped back up: count resets
  mood(now) { if (this.splatted) return 'splat'; if (now - this.last > this.calm) return 'calm'; return this.taps >= 5 ? 'mad' : this.taps >= 3 ? 'annoyed' : 'calm'; }
}

// Ambient speech. tick(now, ctx) -> a line to say now, or null. ctx: { composing, busy, hidden, bubbleUp }.
// Due every min..max ms (random); if he can't talk when due, it waits; after ANY bubble ends (including tap or
// copy chatter) there is a `cooldown` before the next ambient one. Lines don't repeat until the list is used up.
export class SpeechScheduler {
  constructor({ rand = Math.random, min = 25000, max = 60000, cooldown = 15000, first = null, lines = LINES } = {}) {
    this.rand = rand; this.min = min; this.max = max; this.cooldown = cooldown; this.lines = lines; this.bag = [];
    this.due = null; this.first = first; this.quietUntil = 0;
  }
  schedule(now, delay = this.min + this.rand() * (this.max - this.min)) { this.due = now + delay; return this.due; }
  bubbleEnded(now) { this.quietUntil = Math.max(this.quietUntil, now + this.cooldown); if (this.due < this.quietUntil) this.due = this.quietUntil; }
  pick() {
    if (!this.bag.length) { this.bag = this.lines.map((_, i) => i); for (let i = this.bag.length - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]]; } }
    return this.lines[this.bag.pop()];
  }
  tick(now, { composing = false, busy = false, hidden = false, bubbleUp = false } = {}) {
    if (this.due == null) this.schedule(now, this.first ?? undefined);
    if (now < this.due || now < this.quietUntil) return null;
    if (composing || busy || hidden || bubbleUp) return null;        // overdue: say it at the next good moment
    const line = this.pick(); this.schedule(now); return line;
  }
}
