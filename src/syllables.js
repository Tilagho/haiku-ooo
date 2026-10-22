// Heuristic English syllable counter (fallback for words not in the CMU dictionary).
// Also used at build time: CMU words the heuristic already gets right are NOT stored,
// so the shipped dictionary only contains the heuristic's exceptions.
// Pure function, no deps: runs in browser, Node, Workers, Deno.

const ONE = new Set(['the','he','she','we','be','me','ye','are','were','there','where','here','one','done','gone','none','come','some','give','live','have','love','move','prove','lose','whose','sure','eye','bye','rye','dye','aye','once','since','fire','hour','our','sour','flour','tired','fired','hired','wire','tire','prayer','squire','choir']);

function core(s) {
  // s: lowercase letters only
  if (s.length <= 2) return /[aeiouy]/.test(s) ? 1 : s.length;
  let w = s.replace(/^y/, 'j').replace(/^qu/, 'kw').replace(/([^aeiou])qu/, '$1kw').replace(/qu/g, 'kw').replace(/gu([aeiou])/g, 'gw$1');
  // silent trailing e / es / ed
  if (/[^aeiouyl]le$/.test(w) || /[^aeiouyl]les$/.test(w) || /[^aeiouyl]led$/.test(w)) {
    // "table", "tables", "tabled": the l-e is syllabic; drop nothing
  } else if (/[^aeiouy]ed$/.test(w)) {
    if (!/[td]ed$/.test(w)) w = w.slice(0, -2) + 'd';
  } else if (/[^aeiouy]es$/.test(w)) {
    if (!/(s|x|z|ch|sh|c|g)es$/.test(w)) w = w.slice(0, -2) + 's';
  } else if (/[^aeiouy]e$/.test(w) && w.length > 3) {
    w = w.slice(0, -1);
  } else if (/[aeiouy][^aeiouy]e$/.test(w)) {
    w = w.slice(0, -1);
  }
  let n = (w.match(/[aeiouy]+/g) || []).length;
  // hiatus: vowel pairs that are two syllables
  const H = [/ia(?!n$|l$|ns$|ls$)/g, /io(?!n|us)/g, /iu/g, /(?<!p)eo(?!u)/g, /ua(?!r)/g, /uo/g, /ii/g, /yo/g, /ya/g, /oi[^cdlnrstuxv]/g,
             /ie[rt](?!$)/g, /^(re|pre|de)(?=[iou])/g, /^(bi|tri|semi|anti)(?=[aeiou])/g, /^pro(?=[aeiu])/g, /(a|o|u)y(e(?!d$|s$|$|r?s?$)|i)/g, /(a|o|u)yers?$/g, /(?<!f)[^tc]ien|scien/g, /^crea[^mk]|^ide[ao]|^are[a]|^thea|nucle|^ocea/g, /eu[sm]$/g, /[aeiou]ing/g, /[aeiou]ism/g, /oe(?![sy]?$)/g,
             /^ideal/g, /iest$/g, /ier$/g, /iet/g, /uel/g, /uet/g, /uity/g, /[^aeiou]ya/g];
  for (const r of H) n += (w.match(r) || []).length;
  // -ian / -ial after c,t,s,g,x is one syllable (social, musician); otherwise two (trivial, median)
  n += (w.match(/[^ctsgx]ia(n|l)s?$/g) || []).length;
  n -= (w.match(/[^aeiou]ue$/g) || []).length && /(cue|due|hue|sue|blue|true|glue|clue|flue|rue)$/.test(w) ? 0 : 0;
  if (/(que|gue)$/.test(s)) n -= 0;
  if (/[^aeiou]ism$/.test(w)) n += 1;                // "prism" -> 2 (consonant + m)
  if (/[^aeiouy]ms?$/.test(w) && /(sm|thm)s?$/.test(w)) n += 0;
  if (/every/.test(w)) n -= 1;
  return Math.max(1, n);
}

const SUFFIX = /^(.{3,}?)(fully|ful|ments|ment|ness|less|ly|ship|hood|work|wise|times|time|lines|line|side|where|things|thing|one|body|self|stream|streams|light|lights|book|books|phone|phones|room|house|ball|board|wood|fall|day|days|night|nights|way|land|man|men|town|stone|fire|place|ware|craft|scape)$/;
const SUFSYL = { fully: 2 };
function compound(w) {
  const m = w.match(SUFFIX);
  if (m && /[aeiouy]/.test(m[1])) return (ONE.has(m[1]) ? 1 : compound(m[1])) + (SUFSYL[m[2]] || 1);
  return core(w);
}

export function heuristicSyllables(raw) {
  let w = String(raw).toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z']/g, '');
  if (!w) return 0;
  let extra = 0;
  if (/'s$/.test(w)) { const st = w.slice(0, -2); if (/(s|x|z|ch|sh|ce|ge|se|ze)$/.test(st)) extra++; w = st; }
  else if (/s'$/.test(w)) w = w.slice(0, -1);
  else if (/n't$/.test(w)) {
    const st = w.slice(0, -3);
    if (st === 'ca' || st === 'wo' || st === 'sha') return 1;
    if (/^(are|were|ai)$/.test(st)) return st === 'were' ? 1 : 1;
    return heuristicSyllables(st) + 1;
  } else w = w.replace(/'(ll|re|ve|d|m)$/, '');
  w = w.replace(/'/g, '');
  if (!w) return 1;
  if (ONE.has(w)) return 1 + extra;
  if (!/[aeiouy]/.test(w)) return w.length + extra;   // "hmm", "tv", "brr" ~ letters (rare)
  return compound(w) + extra;
}
