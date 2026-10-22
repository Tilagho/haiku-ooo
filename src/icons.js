// Chunky Pebble-timeline-style pixel icons, drawn from tiny bitmaps.
// Legend: '#' ink, 'o' accent (per-icon color), 'w' paper/white, '.' transparent.
const B = {
  wave: ['............','....####....','..##wwww#...','.#ww##ww#...','.#w#..#w#...','#w#...##..#.','#w#......#o#','#ww#....#oo#','.#ww####oo#.','..#wwwwoo#..','...######...','............'],
  moon: ['............','....####....','..##ww#.....','.#www#......','.#ww#.......','#www#.......','#www#.......','#wwww#....#.','.#wwww####o.','.#wwwwwwww#.','..##wwww##..','....####....'],
  leaf: ['............','.......####.','.....##oo#..','....#ooo##..','...#oo#o#...','..#oo#oo#...','..#o#ooo#...','.#o#ooo#....','.#ooo##.....','#.###.......','#...........','............'],
  crane:['............','#...........','.#.....##...','..#...#ww#..','...#.#www#..','....#wwww#..','.##wwwww#...','#oo#www##...','.##.#ww#....','....#w#.....','....#.#.....','...#...#....'],
  mount:['............','............','.....##.....','....#ww#....','...#wwww#...','...#w##w#...','..#o#..#o#..','.#oo#..#oo#.','.#ooo##ooo#.','#oooooooooo#','############','............'],
  bloom:['............','....#..#....','...#o##o#...','.##oo##oo##.','#oo#oooo#oo#','.#oooww ooo#'.replace(' ','o'),'.#ooowwooo#.','#oo#oooo#oo#','.##oo##oo##.','...#o##o#...','....#..#....','............'],
  drop: ['............','.....##.....','....#ww#....','....#ww#....','...#wwww#...','..#wwwwww#..','..#wwwwoo#..','.#wwwwwooo#.','.#wwwwoooo#.','..#wwoooo#..','...######...','............'],
  cat:  ['............','.#.......#..','.##.....##..','.#w#####w#..','#wwwwwwwww#.','#w##www##w#.','#wwwwwwwww#.','#wwwo#owww#.','.#wwwwwww#..','..#######...','............','............'],
  sun:  ['............','.#...#...#..','..#.....#...','....###.....','...#ooo#....','##.#ooo#.##.','...#ooo#....','....###.....','..#.....#...','.#...#...#..','............','............'],
  lantern:['....##......','...####.....','..#oooo#....','.#oo##oo#...','.#oooooo#...','.#oo##oo#...','.#oooooo#...','.#oo##oo#...','..#oooo#....','...####.....','....##......','....#.......'],
};
export const ICON_COLORS = { wave: '#3f6fb5', moon: '#e2a72e', leaf: '#d9432f', crane: '#d9432f', mount: '#3f6fb5', bloom: '#e889a6', drop: '#3f6fb5', cat: '#e889a6', sun: '#e2a72e', lantern: '#d9432f' };
const KEYWORDS = [
  [/rain|drip|drop|puddle|tea|steam|water/i, 'drop'], [/moon|night|dark|star|firefl/i, 'moon'], [/wave|sea|ocean|surf|ferry|fish|gull/i, 'wave'],
  [/leaf|leaves|autumn|maple|bamboo|pine|tree/i, 'leaf'], [/crane|bird|gull|wing|flight|fly/i, 'crane'], [/fuji|mountain|hill|snow|peak/i, 'mount'],
  [/cherry|blossom|petal|flower|bloom|spring/i, 'bloom'], [/cat|kitten|dog|dragon|frog/i, 'cat'], [/sun|dawn|morning|noon|summer/i, 'sun'],
  [/lantern|candle|light|fire|lamp|city|phone/i, 'lantern'],
];
export function iconFor(text, id = '') {
  for (const [re, name] of KEYWORDS) if (re.test(text)) return name;
  const names = Object.keys(B); let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return names[h % names.length];
}
export function iconSVG(name, px = 3, accent = ICON_COLORS[name]) {
  const rows = B[name] || B.drop; let rects = '';
  rows.forEach((r, y) => [...r].forEach((c, x) => {
    const fill = c === '#' ? '#1a181c' : c === 'o' ? accent : c === 'w' ? '#fffaf0' : null;
    if (fill) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${fill}"/>`;
  }));
  const n = rows.length;
  return `<svg class="px-icon" viewBox="0 0 ${n} ${n}" width="${n * px}" height="${n * px}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

// Mascot "Sumi": a little ink drop with eyes. moods: happy | think | sad | sleep
const SUMI = {
  happy: ['......##......','.....#oo#.....','....#oooo#....','...#oooooo#...','..#oooooooo#..','.#oooooooooo#.','.#oowwoowwoo#.','#ooow#oow#ooo#','#oooooooooooo#','#ooppo##oppoo#','.#oooooooooo#.','..##oooooo##..','....######....'],
  think:['......##......','.....#oo#.....','....#oooo#....','...#oooooo#...','..#oooooooo#..','.#oooooooooo#.','.#oowwoowwoo#.','#ooo#woo#wooo#','#oooooooooooo#','#oopoo##oopoo#','.#oooooooooo#.','..##oooooo##..','....######....'],
  sad:  ['......##......','.....#oo#.....','....#oooo#....','...#oooooo#...','..#oooooooo#..','.#oooooooooo#.','.#owwooooowwo#','#oow#oooo#woo#','#oooooooooooo#','#ooooo##ooooo#','.#oooo#o#ooo#.','..##oooooo##..','....######....'],
  sleep:['......##......','.....#oo#.....','....#oooo#....','...#oooooo#...','..#oooooooo#..','.#oooooooooo#.','.#oooooooooo#.','#ooo##oo##ooo#','#oooooooooooo#','#ooppoooooppo#','.#oooo##oooo#.','..##oooooo##..','....######....'],
};
export function sumiSVG(mood = 'happy', px = 4) {
  const rows = SUMI[mood]; let rects = '';
  rows.forEach((r, y) => [...r].forEach((c, x) => {
    const fill = c === '#' ? '#0d0c0f' : c === 'o' ? '#2a2830' : c === 'w' ? '#fffaf0' : c === 'p' ? '#e889a6' : null;
    if (fill) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${fill}"/>`;
  }));
  return `<svg class="sumi" viewBox="0 0 14 13" width="${14 * px}" height="${13 * px}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}
