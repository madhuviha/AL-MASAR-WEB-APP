import crypto from 'node:crypto';

export const LOGIN_ATTEMPT_WINDOW_MS = 60_000;
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOGIN_ATTEMPT_LIMIT_MESSAGE = 'Too many login attempts. Please try again after 1 minute.';

export function loginIdentityHash(email) {
  const identity = String(email ?? '').normalize('NFKC').trim().toLowerCase().slice(0, 254);
  return crypto.createHash('sha256').update(identity).digest('hex');
}

export async function consumeLoginAttempt(db, email, now = Date.now()) {
  const timestamp = new Date(now);
  if (!Number.isFinite(timestamp.getTime())) throw new TypeError('Invalid login-attempt timestamp');
  const { rows } = await db.query(`
    INSERT INTO auth_login_attempt_windows(account_hash, window_started_at, attempt_count, updated_at)
    VALUES($1, $2, 1, $2)
    ON CONFLICT(account_hash) DO UPDATE SET
      attempt_count = CASE
        WHEN auth_login_attempt_windows.window_started_at <= $2::timestamptz - INTERVAL '60 seconds' THEN 1
        ELSE auth_login_attempt_windows.attempt_count + 1
      END,
      window_started_at = CASE
        WHEN auth_login_attempt_windows.window_started_at <= $2::timestamptz - INTERVAL '60 seconds' THEN $2::timestamptz
        ELSE auth_login_attempt_windows.window_started_at
      END,
      updated_at = $2::timestamptz
    RETURNING window_started_at, attempt_count
  `, [loginIdentityHash(email), timestamp]);
  const row = rows[0];
  if (!row) throw new Error('Login attempt counter did not return a row');
  const startedAt = new Date(row.window_started_at).getTime();
  const retryAfterSeconds = Math.max(1, Math.ceil((startedAt + LOGIN_ATTEMPT_WINDOW_MS - timestamp.getTime()) / 1000));
  const attempts = Number(row.attempt_count);
  return { allowed: attempts <= MAX_LOGIN_ATTEMPTS, attempts, retryAfterSeconds };
}

export async function pruneLoginAttemptWindows(db) {
  return db.query("DELETE FROM auth_login_attempt_windows WHERE updated_at < NOW() - INTERVAL '1 day'");
}

export function parseAllowedOrigins(value, fallback = '') {
  const raw = String(value ?? fallback).split(',').map(item => item.trim()).filter(Boolean);
  const allowed = new Set();
  for (const item of raw) {
    if (item === '*') continue;
    try {
      const url = new URL(item);
      const origin = `${url.protocol}//${url.host}`;
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) continue;
      if (item.replace(/\/$/, '') === origin) allowed.add(origin);
    } catch {}
  }
  return allowed;
}

export function createLoginLimiter({
  windowMs = 15 * 60 * 1000,
  maxPerAccountAndIp = 8,
  maxPerIp = 40,
  maxEntries = 20000,
  now = () => Date.now()
} = {}) {
  const entries = new Map();
  let lastPrunedAt = 0;
  const requestKeys = (req, email) => {
    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 128);
    const account = String(email || '').normalize('NFKC').trim().toLowerCase().slice(0, 254);
    return [`ip:${ip}`, `account:${ip}:${account}`];
  };
  const prune = timestamp => {
    if (timestamp - lastPrunedAt < 60000 && entries.size < maxEntries) return;
    lastPrunedAt = timestamp;
    for (const [key, item] of entries) if (item.resetAt <= timestamp) entries.delete(key);
    while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
  };
  const blocked = (req, email) => {
    const timestamp = now();
    prune(timestamp);
    const [ipKey, accountKey] = requestKeys(req, email);
    const ip = entries.get(ipKey), account = entries.get(accountKey);
    return Boolean((ip && ip.count >= maxPerIp && ip.resetAt > timestamp) ||
      (account && account.count >= maxPerAccountAndIp && account.resetAt > timestamp));
  };
  const recordFailure = (req, email) => {
    const timestamp = now();
    prune(timestamp);
    for (const key of requestKeys(req, email)) {
      let item = entries.get(key);
      if (!item || item.resetAt <= timestamp) item = { count: 0, resetAt: timestamp + windowMs };
      entries.delete(key);
      entries.set(key, { count: item.count + 1, resetAt: item.resetAt });
    }
    prune(timestamp);
  };
  const clearFailures = (req, email) => {
    const [, accountKey] = requestKeys(req, email);
    entries.delete(accountKey);
  };
  return { blocked, recordFailure, clearFailures };
}

export function logLoginFailure(req, email, reason) {
  const emailHash = crypto.createHash('sha256').update(String(email || '').normalize('NFKC').trim().toLowerCase()).digest('hex').slice(0, 16);
  console.warn(JSON.stringify({
    level: 'warning', event: 'auth.login.failed',
    ip: String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 128),
    emailHash, reason: String(reason || 'invalid_credentials').slice(0, 40),
    at: new Date().toISOString()
  }));
}

export function sessionDays(value, fallback = 7) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(30, Math.floor(parsed))) : fallback;
}

export function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.floor(parsed))) : fallback;
}

const sensitiveFieldName = /(?:password|passwd|passphrase|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|authorization|credential|ftp[_-]?user|username)/i;

export function redactSensitiveData(value) {
  if (Array.isArray(value)) return value.map(redactSensitiveData);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (!sensitiveFieldName.test(key)) output[key] = redactSensitiveData(item);
  }
  return output;
}

export function preserveSensitiveData(previous, incoming) {
  if (Array.isArray(incoming)) return incoming.map((item, index) => preserveSensitiveData(previous?.[index], item));
  if (!incoming || typeof incoming !== 'object') return incoming;
  const output = { ...incoming };
  if (previous && typeof previous === 'object' && !Array.isArray(previous)) {
    for (const [key, oldValue] of Object.entries(previous)) {
      const nextValue = output[key];
      if (sensitiveFieldName.test(key) && (nextValue == null || nextValue === '')) output[key] = oldValue;
      else if (nextValue && typeof nextValue === 'object') output[key] = preserveSensitiveData(oldValue, nextValue);
    }
  }
  return output;
}
