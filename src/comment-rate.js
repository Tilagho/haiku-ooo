// How the next commentPosters/{uid} write is shaped.
// The live 15.13 rules only allow n == old.n + 1 with the same windowStart, so a phone that
// already commented cannot open a new hour (that update is permission-denied and the reply
// never lands). `legacy` keeps the old window and bumps n, which those rules still accept,
// until the 15.16 paste is in the console. After that paste the hour reset is the legal write
// and the legacy bump is refused once the hour is over.

export const COMMENT_GAP_MS = 20_000;
export const COMMENT_HOUR_MS = 3600e3;
export const COMMENT_PER_HOUR = 12;

const SLOW = { ok: false, error: 'slow down', reason: 'let the ink dry a moment, then try again' };
const RATE = { ok: false, error: 'rate', reason: 'that is a lot of haiku. rest the brush a while' };

export function commentPosterPlan(prev, now = Date.now(), { legacy = false, gapMs = COMMENT_GAP_MS, hourMs = COMMENT_HOUR_MS, perHour = COMMENT_PER_HOUR } = {}) {
  const last = prev ? +prev.last || 0 : 0;
  const windowStart = prev ? +prev.windowStart || 0 : 0;
  const n0 = prev ? +prev.n || 0 : 0;
  if (prev && now - last < gapMs) return SLOW;
  const stale = !prev || now - windowStart >= hourMs;
  if (legacy) {
    if (!prev || n0 >= perHour) return RATE;
    return { ok: true, n: n0 + 1, freshWindow: false };
  }
  if (!stale && n0 >= perHour) return RATE;
  if (stale) return { ok: true, n: 1, freshWindow: true };
  return { ok: true, n: n0 + 1, freshWindow: false };
}
