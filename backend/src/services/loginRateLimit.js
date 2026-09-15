/** Rate-limit mémoire anti-bruteforce (email + IP). */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

/** @type {Map<string, { fails: number, lockedUntil: number, firstAt: number }>} */
const buckets = new Map();

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function keyOf(req, email, scope) {
  const e = String(email || '').trim().toLowerCase() || '_';
  const s = scope === 'admin' ? 'admin' : 'user';
  return `${s}|${clientIp(req)}|${e}`;
}

function prune(entry, now) {
  if (!entry) return null;
  if (entry.lockedUntil && entry.lockedUntil <= now) {
    return { fails: 0, lockedUntil: 0, firstAt: now };
  }
  if (now - entry.firstAt > WINDOW_MS && !entry.lockedUntil) {
    return { fails: 0, lockedUntil: 0, firstAt: now };
  }
  return entry;
}

function getStatus(req, email, scope) {
  const now = Date.now();
  const key = keyOf(req, email, scope);
  let entry = prune(buckets.get(key), now);
  if (entry) buckets.set(key, entry);
  else entry = { fails: 0, lockedUntil: 0, firstAt: now };

  if (entry.lockedUntil && entry.lockedUntil > now) {
    const retryAfterSec = Math.ceil((entry.lockedUntil - now) / 1000);
    return {
      allowed: false,
      retryAfterSec,
      fails: entry.fails,
      remaining: 0,
      message: `Trop de tentatives. Réessaie dans ${Math.ceil(retryAfterSec / 60)} min.`,
    };
  }
  return {
    allowed: true,
    retryAfterSec: 0,
    fails: entry.fails,
    remaining: Math.max(0, MAX_FAILS - entry.fails),
  };
}

function recordFail(req, email, scope) {
  const now = Date.now();
  const key = keyOf(req, email, scope);
  let entry = prune(buckets.get(key), now) || { fails: 0, lockedUntil: 0, firstAt: now };
  entry.fails += 1;
  if (entry.fails >= MAX_FAILS) {
    entry.lockedUntil = now + LOCK_MS;
  }
  buckets.set(key, entry);
  return getStatus(req, email, scope);
}

function recordOk(req, email, scope) {
  buckets.delete(keyOf(req, email, scope));
}

module.exports = {
  getStatus,
  recordFail,
  recordOk,
  MAX_FAILS,
  LOCK_MS,
};
