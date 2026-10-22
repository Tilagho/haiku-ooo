// Pixel-crisp speech bubble for c4: the whole bubble (stepped rounded or notched-square body, 1-px ink outline,
// stair-stepped tail) is rasterised at art resolution (U css px per pixel, Inky's 4-px grid) and drawn with
// image-rendering: pixelated. No border-radius, no CSS triangles, no smoothing.
export const U = 4;
const PAPER = [255, 250, 240], RED = [214, 58, 40], INK = [26, 24, 28];
// bw, bh: body size in pixels; tip: {x, y} in pixels relative to the body's top-left (outside the body) or null.
export function renderBubble(cv, { bw, bh, tip = null, round = true, red = false }) {
  const tx = tip ? Math.floor(tip.x) : 0, ty = tip ? Math.floor(tip.y) : 0;
  const x0 = Math.min(0, tx) - 2, y0 = Math.min(0, ty) - 2, x1 = Math.max(bw, tx + 1) + 3, y1 = Math.max(bh, ty + 1) + 3;
  const W = x1 - x0, H = y1 - y0;
  const corner = (x, y) => {                       // stepped round corner: 3 px knocked out per corner
    const dx = Math.min(x, bw - 1 - x), dy = Math.min(y, bh - 1 - y);
    return round && ((dy === 0 && dx < 2) || (dy === 1 && dx < 1));
  };
  const inBody = (x, y) => x >= 0 && y >= 0 && x < bw && y < bh && !corner(x, y);
  // tail: a stubby triangle from a 6-px base on the nearest body edge to the tip, tested at pixel centres
  let tri = null;
  if (tip) {
    const cl = (v, a, b) => Math.max(a, Math.min(b, v));
    let A, B;
    if (tx < 0 || tx >= bw) { const ex = tx < 0 ? 1 : bw - 1, by = cl(ty + .5, 4, bh - 4); A = [ex, by - 3]; B = [ex, by + 3]; }
    else { const ey = ty < 0 ? 1 : bh - 1, bx = cl(tx + .5, 4, bw - 4); A = [bx - 3, ey]; B = [bx + 3, ey]; }
    tri = [A, B, [tx + .5, ty + .5]];
  }
  const sgn = (p, a, b) => (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
  const inTri = (x, y) => { if (!tri) return false; const p = [x + .5, y + .5], d1 = sgn(p, tri[0], tri[1]), d2 = sgn(p, tri[1], tri[2]), d3 = sgn(p, tri[2], tri[0]);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); };
  const M = new Uint8Array(W * H);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (inBody(x, y) || inTri(x, y)) M[(y - y0) * W + (x - x0)] = 1;
  if (tip) M[(ty - y0) * W + (tx - x0)] = 1;
  const m = (x, y) => x >= 0 && y >= 0 && x < W && y < H && M[y * W + x];
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), D = img.data;
  const set = (i, c, a = 255) => { D[i * 4] = c[0]; D[i * 4 + 1] = c[1]; D[i * 4 + 2] = c[2]; D[i * 4 + 3] = a; };
  const fill = red ? RED : PAPER;
  const O = new Uint8Array(W * H);                       // 1 = fill, 2 = ink outline
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; O[i] = M[i] ? 1 : (m(x - 1, y) || m(x + 1, y) || m(x, y - 1) || m(x, y + 1)) ? 2 : 0; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (O[i] === 1) set(i, fill); else if (O[i] === 2) set(i, INK);
    else if (x > 0 && y > 0 && O[i - W - 1]) set(i, INK, red ? 255 : 90);       // hard 1-px drop shadow, down-right
  }
  ctx.putImageData(img, 0, 0);
  return { ox: x0, oy: y0, W, H };
}
