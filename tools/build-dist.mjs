// node tools/build-dist.mjs [outDir=/workspace/haiku-ooo-dist]
// Rebuilds the static site from index.html + src/ (only modules reachable from src/app.js) + the assets they use.
// Keeps CNAME and .nojekyll. Prints what was added / changed / removed, grouped by folder.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const ROOT = new URL('..', import.meta.url).pathname, OUT = process.argv[2] || '/workspace/haiku-ooo-dist';
const KEEP = new Set(['CNAME', '.nojekyll']);
const mods = new Set();
(function walk(f) {
  if (mods.has(f)) return; mods.add(f);
  const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of s.matchAll(/(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) walk(path.normalize(path.join(path.dirname(f), m[1] || m[2])));
})('src/app.js');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = [...html.matchAll(/href="(src\/[^"]+\.css)"/g)].map(m => m[1]);
const scripts = [...html.matchAll(/<script(?![^>]*type="module")[^>]*src="(src\/[^"?]+\.js)(?:\?[^"]*)?"/g)].map(m => m[1]);   // classic scripts (src/no-zoom.js)
const assets = new Set();
for (const f of [...mods, ...css, 'index.html']) {
  const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of s.matchAll(/(?:\.\.\/)?(assets\/[A-Za-z0-9_./-]+\.(?:png|ttf|svg|woff2?))/g)) assets.add(m[1]);
}
const files = ['index.html', 'favicon.svg', ...css, ...scripts, ...mods, ...assets].sort();
for (const f of files) if (!fs.existsSync(path.join(ROOT, f))) throw new Error('missing ' + f);
const list = d => { const out = []; (function rec(p) { for (const e of fs.readdirSync(path.join(d, p), { withFileTypes: true })) { const r = path.join(p, e.name); e.isDirectory() ? rec(r) : out.push(r); } })(''); return out; };
const sha = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
const before = fs.existsSync(OUT) ? list(OUT) : [];
const res = { added: [], changed: [], removed: [], same: [] };
for (const f of files) {
  const dst = path.join(OUT, f), had = fs.existsSync(dst);
  if (had && sha(dst) === sha(path.join(ROOT, f))) { res.same.push(f); continue; }
  fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), dst); res[had ? 'changed' : 'added'].push(f);
}
for (const f of before) if (!files.includes(f) && !KEEP.has(f)) { fs.rmSync(path.join(OUT, f)); res.removed.push(f); }
(function prune(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) { prune(path.join(d, e.name)); if (!fs.readdirSync(path.join(d, e.name)).length) fs.rmdirSync(path.join(d, e.name)); } })(OUT);
const byDir = a => a.reduce((m, f) => ((m[path.dirname(f)] ||= []).push(path.basename(f)), m), {});
for (const k of ['added', 'changed', 'removed']) { console.log(`\n${k.toUpperCase()} (${res[k].length})`); for (const [d, fs_] of Object.entries(byDir(res[k]))) console.log(`  ${d}/: ${fs_.join(', ')}`); }
console.log(`\nunchanged: ${res.same.length}; total shipped: ${files.length} + ${[...KEEP].join(', ')}`);
const tag = process.env.DIST_TAG || 'round13';             // -> shots/<tag>-dist-changes.json
const grouped = {}; for (const k of ['added', 'changed', 'removed']) for (const [d, f] of Object.entries(byDir(res[k]))) ((grouped[d] ||= { added: [], changed: [], removed: [] })[k]).push(...f.map(n => path.join(d, n)));
fs.writeFileSync(path.join(ROOT, `shots/${tag}-dist-changes.json`), JSON.stringify({ out: OUT, totals: { added: res.added.length, changed: res.changed.length, removed: res.removed.length, unchanged: res.same.length, shipped: files.length },
  byFolder: grouped, added: res.added, changed: res.changed, removed: res.removed, unchanged: res.same }, null, 1));
