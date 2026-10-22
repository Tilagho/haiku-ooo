// Haiku checker: CMU-dictionary-backed syllable counting with heuristic fallback.
// Isomorphic ES module (browser, Node >=18, Cloudflare Workers, Deno). No deps.
//
//   import { checkHaiku, countLine, syllablesOf } from './haiku.js'
//   checkHaiku("an old silent pond\na frog jumps into the pond\nsplash! silence again")
//   -> { ok: true, lines: [{ text, count: 5, target: 5, ok: true, words: [...] }, ...], reason: null }
//
// Counting is deliberately a little lenient: words with more than one valid CMU
// pronunciation ("fire" 1|2, "every" 2|3, "poem" 1|2) can be counted either way, and a
// line passes if ANY combination hits the target.

import DATA, { BLOOM } from './cmu-data.js';
import { heuristicSyllables } from './syllables.js';

const DICT = new Map();
for (const line of DATA.split('\n')) {
  const i = line.indexOf(':');
  const counts = line.slice(0, i).split(',').map(Number);
  for (const w of line.slice(i + 1).split(' ')) DICT.set(w, counts);
}

const BITS = (() => { const bin = typeof atob === 'function' ? atob(BLOOM) : Buffer.from(BLOOM, 'base64').toString('binary'); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; })();
const fnv = (w, seed) => { let h = seed >>> 0; for (let i = 0; i < w.length; i++) { h ^= w.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
export function inDictionary(w) {
  w = w.toLowerCase(); if (DICT.has(w)) return true;
  const M = BITS.length * 8, a = fnv(w, 2166136261), b = (fnv(w, 0x9747b28c) | 1) >>> 0;
  for (let i = 0; i < 3; i++) { const x = (a + i * b) % M; if (!(BITS[x >> 3] & (1 << (x & 7)))) return false; }
  return true;
}

export const PATTERN = [5, 7, 5];

// ---------- numbers -> words ----------
const ONES = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const TENS = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
function under1000(n) {
  const out = [];
  if (n >= 100) { out.push(ONES[Math.floor(n / 100)], 'hundred'); n %= 100; }
  if (n >= 20) { out.push(TENS[Math.floor(n / 10)]); n %= 10; if (n) out.push(ONES[n]); }
  else if (n > 0 || !out.length) out.push(ONES[n]);
  return out;
}
export function numberToWords(str) {
  const clean = str.replace(/,/g, '');
  if (/^\d+(st|nd|rd|th)$/i.test(clean)) {                   // 1st, 22nd, 3rd, 4th
    const w = numberToWords(clean.replace(/\D/g, ''));
    const last = w.pop();
    const ORD = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
    w.push(ORD[last] || last.replace(/y$/, 'ie') + 'th'); return w;
  }
  if (/^\d+\.\d+$/.test(clean)) {                             // 3.14 -> three point one four
    const [a, b] = clean.split('.');
    return [...numberToWords(a), 'point', ...b.split('').map(d => ONES[+d])];
  }
  if (!/^\d+$/.test(clean)) return [clean];
  if (clean.length > 1 && clean[0] === '0') return clean.split('').map(d => d === '0' ? 'oh' : ONES[+d]);
  let n = Number(clean);
  if (n >= 1100 && n <= 2099 && n % 100 !== 0 && clean.length === 4 && n !== 2000 && !(n > 2000 && n < 2010)) {
    // years: 1999 -> nineteen ninety nine, 1905 -> nineteen oh five
    const hi = Math.floor(n / 100), lo = n % 100;
    return [...under1000(hi), ...(lo < 10 ? ['oh', ONES[lo]] : under1000(lo))];
  }
  if (n >= 1e12) return clean.split('').map(d => ONES[+d]);
  const out = [];
  for (const [v, name] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) {
    if (n >= v) { out.push(...under1000(Math.floor(n / v)), name); n %= v; }
  }
  if (n || !out.length) out.push(...under1000(n));
  return out;
}

// ---------- tokenizing ----------
const SYMBOLS = { '&': 'and', '+': 'plus', '@': 'at', '%': 'percent', '=': 'equals', '#': 'number', '$': 'dollars' };
const LETTER_SYL = { w: 3 };   // spelled-out letters: "w" = dub-ble-you, all others 1

export function tokenize(line) {
  const s = line
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')       // café -> cafe
    .replace(/[\u2018\u2019\u02bc`´]/g, "'")                  // curly apostrophes
    .replace(/[\u2013\u2014]/g, ' ')                          // en/em dashes separate words
    .replace(/\$(\d[\d,.]*)/g, '$1 dollars ')
    .replace(/(\d)%/g, '$1 percent ')
    .replace(/[&+@=#%]/g, m => ' ' + SYMBOLS[m] + ' ');
  const raw = s.match(/[A-Za-z0-9][A-Za-z0-9'.,]*[A-Za-z0-9']|[A-Za-z0-9]/g) || [];
  const words = [];
  for (let tok of raw) {
    tok = tok.replace(/[.,']+$/, m => (m.includes("'") && /s'$/i.test(tok) ? "'" : ''));
    if (/\d/.test(tok) && /^[\d,.]+(st|nd|rd|th)?$/i.test(tok)) { for (const w of numberToWords(tok)) words.push({ text: w, from: tok }); continue; }
    for (const part of tok.split(/[.,]/)) if (part) words.push({ text: part, from: tok });
  }
  return words;
}

// ---------- per-word counts ----------
export function syllablesOf(word) {
  const raw = word;
  let w = word.toLowerCase();
  if (DICT.has(w)) return { counts: DICT.get(w), source: 'cmu' };
  // all-caps acronyms not in dict (FBI, NYC): spell letters
  if (/^[A-Z]{2,5}$/.test(raw) && !/[AEIOU]/.test(raw.slice(1, -1))) {
    const n = [...w].reduce((a, c) => a + (LETTER_SYL[c] || 1), 0);
    return { counts: [n], source: 'acronym' };
  }
  // hyphenless compounds / possessives of dictionary words: dog's, cats', poet's
  const poss = w.match(/^(.+?)'s$/) || w.match(/^(.+s)'$/);
  if (poss && DICT.has(poss[1])) {
    const add = /'s$/.test(w) && /(s|x|z|ch|sh|ce|ge|se|ze)$/.test(poss[1]) ? 1 : 0;
    return { counts: DICT.get(poss[1]).map(n => n + add), source: 'cmu+' };
  }
  return { counts: [heuristicSyllables(w)], source: inDictionary(w) ? 'cmu' : 'guess' };
}

function sums(wordCounts) {
  let set = new Set([0]);
  for (const counts of wordCounts) {
    const next = new Set();
    for (const a of set) for (const c of counts) next.add(a + c);
    set = next;
  }
  return [...set].sort((a, b) => a - b);
}

export function countLine(text, target) {
  const words = [];
  for (const tok of tokenize(text)) {
    for (const part of tok.text.split('-').filter(Boolean)) {
      const r = syllablesOf(part);
      words.push({ word: part, from: tok.from, counts: r.counts, source: r.source });
    }
  }
  const possible = sums(words.map(w => w.counts));
  let count = possible[0];
  if (target != null) {
    if (possible.includes(target)) count = target;
    else count = possible.reduce((best, n) => Math.abs(n - target) < Math.abs(best - target) ? n : best, possible[0]);
  }
  return { text, words, possible, count, target, ok: target != null && possible.includes(target), guessed: words.filter(w => w.source === 'guess').map(w => w.word) };
}

// Split raw input into lines. Accepts real newlines, or " / " as a line separator.
export function splitLines(input) {
  let lines = String(input).replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 1 && lines[0].includes(' / ')) lines = lines[0].split(' / ').map(l => l.trim()).filter(Boolean);
  return lines;
}

export const LIMITS = { maxLineChars: 80, maxTotalChars: 220 };

export function checkHaiku(input, pattern = PATTERN) {
  const lines = splitLines(input);
  const res = lines.map((l, i) => countLine(l, pattern[i]));
  let reason = null;
  if (String(input).length > LIMITS.maxTotalChars || lines.some(l => l.length > LIMITS.maxLineChars)) reason = 'too long';
  else if (lines.length < pattern.length) reason = `needs ${pattern.length} lines (has ${lines.length})`;
  else if (lines.length > pattern.length) reason = `only ${pattern.length} lines allowed (has ${lines.length})`;
  else {
    const bad = res.findIndex(r => !r.ok);
    if (bad >= 0) reason = `line ${bad + 1} has ${res[bad].count} syllables, needs ${pattern[bad]}`;
  }
  return { ok: reason === null, reason, lines: res, normalized: lines.join('\n') };
}
