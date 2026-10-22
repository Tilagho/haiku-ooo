// Kanji numerals for the number seals: standard Japanese numbering (1 一, 10 十, 13 十三, 20 二十, 100 百,
// 123 百二十三, 1000 千, 10000 一万). A leading 一 is dropped before 十 / 百 / 千 but kept before 万.
const D = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
function below10k(n) {
  let s = '';
  for (const [v, ch] of [[1000, '千'], [100, '百'], [10, '十']]) {
    const d = Math.floor(n / v) % 10; if (d) s += (d === 1 ? '' : D[d]) + ch;
  }
  return s + D[n % 10];
}
export function toKanjiNumber(n) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n) || n <= 0) return '〇';
  let s = '';
  for (const [v, ch] of [[1e12, '兆'], [1e8, '億'], [1e4, '万']]) {
    const k = Math.floor(n / v) % 10000; if (k) s += below10k(k) + ch;
  }
  return s + below10k(n % 10000);
}

// ---------- the number seal on a tiny pixel grid (round 13: near-Minecraft blocky) ----------
// Each seal is built on a tiny art grid, ~14-18 art px across (more for long numbers), and drawn at SEAL_PX = 3 font
// px per art px (src/brush-text.js): 4-4.5 CSS px a block, always a whole number of device px at dpr 2 and 3.
// Hand-designed 5x5 chunky glyphs, one art px strokes, no fine detail.
export const SEAL_GLYPHS = Object.fromEntries(Object.entries({
  一: '.....|.....|#####|.....|.....',
  二: '.###.|.....|.....|.....|#####',
  三: '#####|.....|.###.|.....|#####',
  四: '#####|#.#.#|#.#.#|##.##|#####',
  五: '#####|..#..|####.|.#.#.|#####',
  六: '..#..|#####|.....|.#.#.|#...#',
  七: '.#...|.#.##|####.|.#...|..###',
  八: '.#.#.|.#.#.|.#.#.|#...#|#...#',
  九: '.#...|####.|.#.#.|.#.#.|#..##',
  十: '..#..|..#..|#####|..#..|..#..',
  百: '#####|..#..|####.|#..#.|####.',
  千: '...##|###..|#####|..#..|..#..',
  万: '#####|.#...|.####|.#..#|#..##',
  〇: '.###.|#...#|#...#|#...#|.###.',
}).map(([k, v]) => [k, v.split('|')]));
const GW = 5, GAP = 1, M = 3, MIN = 15;        // glyph size, gap, margin (1 red rim + 1 carved cream ring + 1 red), min width
// Layout: 1 char alone; 2 chars side by side in a rectangle, stacked in an upright oval; 3-4: 2x2; 5-6: 2 wide x 3
// tall; 7+: 3 wide. Rows read left to right, top to bottom; a short last row is centred.
// SHAPE ALTERNATES down the board by display order (n is the poem's place on the scroll, which is also its number):
//   odd n -> stair-stepped pixel oval;  even n -> rectangle, square-ish (n % 4 == 2) or slightly taller (n % 4 == 0).
// So no two neighbouring seals ever share a shape, it is stable across reloads, and a new post (n + 1) always takes
// the opposite shape of the one next to it.
export const sealShape = n => (Math.floor(n) % 2 === 1 ? 'oval' : 'square');
export function sealLayout(n) {
  const chars = [...toKanjiNumber(n)], k = chars.length, shape = sealShape(n), tall = shape === 'square' && Math.floor(n) % 4 === 0;
  const scale = 1, cols = k === 1 || (k === 2 && shape === 'oval') ? 1 : k <= 6 ? 2 : 3, rows = Math.ceil(k / cols);
  const cell = GW, gap = GAP;
  const gw = cols * cell + (cols - 1) * gap, gh = rows * cell + (rows - 1) * gap;
  const place = (W, H) => {
    const ox = Math.floor((W - gw) / 2), oy = Math.floor((H - gh) / 2);
    return chars.map((ch, i) => {
      const r = Math.floor(i / cols), inRow = Math.min(cols, k - r * cols), c = i % cols;
      const rowOff = Math.floor((cols - inRow) * (cell + gap) / 2);
      return { ch, x: ox + rowOff + c * (cell + gap), y: oy + r * (cell + gap) };
    });
  };
  let W, H, cells;
  if (shape === 'oval') {
    // the smallest stepped ellipse (upright when the grid is) whose carved ring clears every glyph pixel by 1
    const fits = (W, H, cells) => cells.every(c => { const g = SEAL_GLYPHS[c.ch]; if (!g) return true;
      for (let gy = 0; gy < GW; gy++) for (let gx = 0; gx < GW; gx++) if (g[gy][gx] === '#') {
        const X = c.x + gx + .5, Y = c.y + gy + .5;
        if (((X - W / 2) / (W / 2 - 3)) ** 2 + ((Y - H / 2) / (H / 2 - 3)) ** 2 > 1) return false;
      }
      return true; });
    let best = null;
    for (let ew = 0; ew <= 12; ew += 2) for (let eh = 0; eh <= 12; eh += 2) {         // odd sizes: glyphs dead centre
      const w = Math.max(MIN, gw + 2 * M + ew), h = gh + 2 * M + eh; if (gh >= gw && h < w + 2) continue;
      if (best && w * h >= best[0] * best[1]) continue; const c = place(w, h); if (fits(w, h, c)) best = [w, h, c];
    }
    if (!best) { const w = gw + 2 * M + 12, h = gh + 2 * M + 12; best = [w, h, place(w, h)]; }
    [W, H, cells] = best;
  } else {
    W = Math.max(MIN, gw + 2 * M); H = Math.max(tall ? MIN + 2 : MIN, gh + 2 * M + (tall ? 2 : 0)); cells = place(W, H);
  }
  return { chars, scale, cols, rows, shape, tall, W, H, cells, glyph: GW };
}
