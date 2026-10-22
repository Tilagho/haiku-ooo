// Tiny spring physics helpers: Pebble-style elastic motion without a library.

// Simulate a damped spring 0 -> 1 and return { easing, duration } usable by WAAPI / CSS.
// Uses CSS linear() so the overshoot/wobble is real spring motion, not a bezier fake.
const cache = new Map();
export function springEasing({ stiffness = 260, damping = 16, mass = 1, velocity = 0 } = {}) {
  const key = [stiffness, damping, mass, velocity].join();
  if (cache.has(key)) return cache.get(key);
  const dt = 1 / 120; let x = 0, v = velocity, t = 0; const pts = [];
  while (t < 3) {
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a * dt; x += v * dt; t += dt; pts.push(x);
    if (t > 0.25 && Math.abs(x - 1) < 0.001 && Math.abs(v) < 0.01) break;
  }
  const step = Math.max(1, Math.floor(pts.length / 60));
  const sampled = [0]; for (let i = step; i < pts.length; i += step) sampled.push(+pts[i].toFixed(4)); sampled.push(1);
  const supported = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('transition-timing-function', 'linear(0, 1)');
  const out = { easing: supported ? `linear(${sampled.join(', ')})` : 'cubic-bezier(.34,1.56,.64,1)', duration: Math.round(t * 1000) };
  cache.set(key, out); return out;
}

export const SPRINGS = {
  pop:    { stiffness: 420, damping: 14 },   // buttons, meters
  sheet:  { stiffness: 230, damping: 18 },   // compose sheet
  drop:   { stiffness: 300, damping: 12 },   // new card landing
  soft:   { stiffness: 140, damping: 14 },
};

export function springAnimate(el, keyframes, spring = SPRINGS.pop, extra = {}) {
  const { easing, duration } = springEasing(spring);
  return el.animate(keyframes, { duration, easing, fill: 'both', ...extra });
}

// A live, frame-driven 1D spring for continuous effects (scroll jelly).
export class LiveSpring {
  constructor(stiffness = 180, damping = 12) { this.k = stiffness; this.c = damping; this.x = 0; this.v = 0; this.target = 0; }
  step(dt) { const a = -this.k * (this.x - this.target) - this.c * this.v; this.v += a * dt; this.x += this.v * dt; return this.x; }
  get resting() { return Math.abs(this.x - this.target) < 0.01 && Math.abs(this.v) < 0.01; }
}

// Classic squash & stretch keyframes (volume preserving-ish).
export const SQUASH_LAND = [
  { transform: 'translateY(-90px) scale(.7, 1.35)', opacity: 0 },
  { transform: 'translateY(6px) scale(1.18, .8)', opacity: 1, offset: .38 },
  { transform: 'translateY(-4px) scale(.94, 1.07)', offset: .58 },
  { transform: 'translateY(1px) scale(1.03, .97)', offset: .78 },
  { transform: 'translateY(0) scale(1, 1)', opacity: 1 },
];
export const JELLY = [
  { transform: 'scale(1,1)' }, { transform: 'scale(1.22,.8)', offset: .25 }, { transform: 'scale(.88,1.14)', offset: .5 },
  { transform: 'scale(1.06,.95)', offset: .72 }, { transform: 'scale(1,1)' },
];
export const SHAKE = [
  { transform: 'translateX(0)' }, { transform: 'translateX(-14px) rotate(-1.5deg)', offset: .15 }, { transform: 'translateX(12px) rotate(1.2deg)', offset: .32 },
  { transform: 'translateX(-8px) rotate(-.6deg)', offset: .5 }, { transform: 'translateX(5px)', offset: .68 }, { transform: 'translateX(-2px)', offset: .84 }, { transform: 'translateX(0)' },
];
export const prefersReducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
