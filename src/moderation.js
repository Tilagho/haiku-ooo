// Round 15.6 (Tiago, t181u): reports + takedown. No DOM here, so the store, the UI (src/report.js), the reference
// server (tools/api-server.mjs) and the tests all share one set of rules.
//
//   - Only user-submitted poems can be reported (the 12 seeded samples cannot).
//   - One report per poem per device: a random device id kept in localStorage (no accounts on haiku.ooo). The server
//     also de-duplicates by a salted hash of the reporter's IP, so clearing storage does not buy a second vote.
//   - TAKEDOWN_REPORTS unique reporters take a poem down: it is left off the board for everyone from then on.
//   - The reporter's device remembers what it flagged, and shows the little 通報 ('reported') mark by that poem.

export const TAKEDOWN_REPORTS = 3;          // unique reporters needed to take a poem down (keep in sync with the server: it imports this)
export const REPORT_MARK = '通報';           // 'reported' (tsūhō: what Japanese sites call reporting a post)
export const LONG_PRESS_MS = 480;            // hold this long on a poem and Inky asks whether to report it
export const LONG_PRESS_SLOP = 10;           // px a finger may drift before the hold counts as a scroll instead

const DEVICE_KEY = 'haiku-board:device:v1', REPORTED_KEY = 'haiku-board:reported:v1';
const ls = () => { try { return globalThis.localStorage || null; } catch { return null; } };

export function deviceId() {
  const s = ls(); let id = null;
  try { id = s?.getItem(DEVICE_KEY); } catch {}
  if (!id || !/^[a-z0-9]{16,40}$/.test(id)) {
    const b = new Uint8Array(12); (globalThis.crypto?.getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => b[i] = Math.random() * 256 | 0));
    id = 'd' + [...b].map(x => x.toString(36).padStart(2, '0')).join('').slice(0, 22);
    try { s?.setItem(DEVICE_KEY, id); } catch {}
  }
  return id;
}

export const isReportable = post => !!post && !post.sample && typeof post.id === 'string' && post.id.length > 0;

// what THIS device has reported: { [postId]: reportedAtMs }
export class ReportLedger {
  constructor() { this.map = {}; try { this.map = JSON.parse(ls()?.getItem(REPORTED_KEY)) || {}; } catch {} }
  has(id) { return Object.hasOwn(this.map, id); }
  add(id) { this.map[id] = Date.now(); const keys = Object.keys(this.map); if (keys.length > 2000) keys.sort((a, b) => this.map[a] - this.map[b]).slice(0, keys.length - 2000).forEach(k => delete this.map[k]); this._save(); }
  _save() { try { ls()?.setItem(REPORTED_KEY, JSON.stringify(this.map)); } catch {} }
  ids() { return Object.keys(this.map); }
}

// pure tally used by LocalStore and the reference server: reports = { [postId]: { by: [keys...] } }
// `keys` are every identity this reporter counts as (device id, ip hash); any overlap = already reported.
export function tally(reports, postId, keys, threshold = TAKEDOWN_REPORTS) {
  const r = reports[postId] || (reports[postId] = { by: [], n: 0 });
  keys = keys.filter(Boolean);
  const already = keys.some(k => r.by.includes(k));
  if (!already) { r.by.push(...keys); r.n = (r.n || 0) + 1; }
  return { count: r.n, already, removed: r.n >= threshold };
}
export const isRemoved = (reports, postId, threshold = TAKEDOWN_REPORTS) => (reports[postId]?.n || 0) >= threshold;
