// SAMPLE CONTENT: 12 placeholder haiku written for the prototype (not real user posts).
// Every one passes checkHaiku(); tests/seed.test.js asserts that.
const H = 3600e3;
const BASE = Date.UTC(2026, 9, 21, 18, 0);
export const SEED = [
  ["Ink drips from my brush", "a mountain grows on the page", "then the rain begins"],
  ["Little blue dragon", "curled up inside the teacup", "steam rising like breath"],
  ["The cat in the jar", "is not stuck, she is just there", "because it is round"],
  ["Morning fog lifting", "the ferry horn calls once more", "gulls answer in kind"],
  ["Cherry petals fall", "on the shoulders of strangers", "waiting for the train"],
  ["Cold ramen at two", "the city hums like a fridge", "I hum back at it"],
  ["Pixel cranes take flight", "across a sky made of squares", "soft as any cloud"],
  ["I don't want to sleep", "the fireflies are still out", "writing in the dark"],
  ["Rain on the tin roof", "a thousand tiny drummers", "none of them in time"],
  ["Bamboo bends, not breaks", "the wind writes its long poem", "I read it slowly"],
  ["Waves fold into foam", "the old fisherman's straw hat", "bobs like a lantern"],
  ["An old silent pond", "a frog jumps into the pond", "splash! silence again"],
].map((lines, i) => ({
  id: 'sample-' + String(i + 1).padStart(2, '0'),
  text: lines.join('\n'),
  author: i === 11 ? 'sample · after Bashō' : 'sample',
  sample: true,
  createdAt: BASE - (i + 1) * (i + 2) * 0.6 * H,   // fixed times so the sample scroll is deterministic
}));
