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

// How the characters sit inside the seal (font px). Glyphs are Misaki 7x7 ink in an 8x8 cell.
//   1 char: doubled (2x), in an upright oval        2 chars: doubled, side by side, square
//   3-4: 1x, 2x2 grid    5-6: 1x, 2 wide x 3 tall    7+: 1x, 3 wide, as many rows as needed
// Rows read left to right, top to bottom; a short last row is centred.
export function sealLayout(n) {
  const chars = [...toKanjiNumber(n)], k = chars.length;
  const scale = k <= 2 ? 2 : 1, cols = k === 1 ? 1 : k <= 6 ? 2 : 3, rows = Math.ceil(k / cols);
  const cell = 7 * scale, gap = scale, M = scale === 2 ? 5 : 4;   // M = 2 px red rim + carved cream ring + red (+1 for doubled glyphs)
  const gw = cols * cell + (cols - 1) * gap, gh = rows * cell + (rows - 1) * gap;
  const shape = k === 1 ? 'oval' : 'square';
  const W = shape === 'oval' ? gw + 2 * M + 4 : gw + 2 * M, H = shape === 'oval' ? gh + 2 * M + 6 : gh + 2 * M;
  const ox = Math.floor((W - gw) / 2), oy = Math.floor((H - gh) / 2);
  const cells = chars.map((ch, i) => {
    const r = Math.floor(i / cols), inRow = Math.min(cols, k - r * cols), c = i % cols;
    const rowOff = Math.floor((cols - inRow) * (cell + gap) / 2);
    return { ch, x: ox + rowOff + c * (cell + gap), y: oy + r * (cell + gap) };
  });
  return { chars, scale, cols, rows, shape, W, H, cells };
}
