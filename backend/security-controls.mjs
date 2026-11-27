import crypto from 'node:crypto';

export const LOGIN_ATTEMPT_WINDOW_MS = 60_000;
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOGIN_ATTEMPT_LIMIT_MESSAGE = 'Too many login attempts. Please try again after 1 minute.';
export const LOGIN_IP_WINDOW_MS = 15 * 60_000;
export const MAX_LOGIN_ATTEMPTS_PER_IP = 120;
export const LOGIN_IP_LIMIT_MESSAGE = 'Too many sign-in requests from this network. Please wait 15 minutes.';
export const LOGIN_FAILURE_LIMIT_MESSAGE = 'Too many failed sign-in attempts. Please wait 15 minutes before trying again.';

export function loginIdentityHash(email) {
  const identity = String(email ?? '').normalize('NFKC').trim().toLowerCase().slice(0, 254);
  return crypto.createHash('sha256').update(identity).digest('hex');
}

export async function consumeLoginAttempt(db, email, now = Date.now(), { windowMs = LOGIN_ATTEMPT_WINDOW_MS, maxAttempts = MAX_LOGIN_ATTEMPTS } = {}) {
  const timestamp = new Date(now);
  if (!Number.isFinite(timestamp.getTime())) throw new TypeError('Invalid login-attempt timestamp');
  const safeWindowMs = Math.max(1000, Math.min(24 * 60 * 60_000, Math.floor(Number(windowMs) || LOGIN_ATTEMPT_WINDOW_MS)));
  const safeMaxAttempts = Math.max(1, Math.min(10000, Math.floor(Number(maxAttempts) || MAX_LOGIN_ATTEMPTS)));
  const { rows } = await db.query(`
    INSERT INTO auth_login_attempt_windows(account_hash, window_started_at, attempt_count, updated_at)
    VALUES($1, $2, 1, $2)
    ON CONFLICT(account_hash) DO UPDATE SET
      attempt_count = CASE
        WHEN auth_login_attempt_windows.window_started_at <= $2::timestamptz - ($3::bigint * INTERVAL '1 millisecond') THEN 1
        ELSE auth_login_attempt_windows.attempt_count + 1
      END,
      window_started_at = CASE
        WHEN auth_login_attempt_windows.window_started_at <= $2::timestamptz - ($3::bigint * INTERVAL '1 millisecond') THEN $2::timestamptz
        ELSE auth_login_attempt_windows.window_started_at
      END,
      updated_at = $2::timestamptz
    RETURNING window_started_at, attempt_count
  `, [loginIdentityHash(email), timestamp, safeWindowMs]);
  const row = rows[0];
  if (!row) throw new Error('Login attempt counter did not return a row');
  const startedAt = new Date(row.window_started_at).getTime();
  const retryAfterSeconds = Math.max(1, Math.ceil((startedAt + safeWindowMs - timestamp.getTime()) / 1000));
  const attempts = Number(row.attempt_count);
  return { allowed: attempts <= safeMaxAttempts, attempts, retryAfterSeconds };
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

export function validateProductionOrigins(value, parsedOrigins, name = 'ALLOWED_ORIGINS') {
  const configured = String(value || '').split(',').map(item => item.trim()).filter(Boolean);
  if (!configured.length) throw new Error(`${name} must contain explicit HTTPS origins in production.`);
  if (configured.some(origin => origin === '*')) throw new Error(`${name} cannot contain wildcard origins.`);
  for (const origin of configured) {
    let url;
    try { url = new URL(origin); } catch { throw new Error(`${name} contains an invalid origin.`); }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !parsedOrigins.has(url.origin)) {
      throw new Error(`${name} must contain exact HTTPS origins only.`);
    }
  }
  return true;
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

export const SESSION_COOKIE_NAMES = Object.freeze({
  fleet: 'masar_fleet_session',
  admin: 'masar_admin_session',
  school: 'masar_school_session',
  support: 'masar_support_session'
});

const WEB_CLIENTS = new Set(['web-company', 'web-admin', 'web-school', 'web-support']);
const cookieClientMap = Object.freeze({
  'web-company': 'fleet',
  'web-admin': 'admin',
  'web-school': 'school',
  'web-support': 'support'
});

export function requestClient(req) {
  const client = String(req?.headers?.['x-masar-client'] || '').trim().toLowerCase();
  return WEB_CLIENTS.has(client) ? client : '';
}

export function isWebClient(req) {
  return Boolean(requestClient(req));
}

export function usesCookieSession(req) {
  return isWebClient(req) && String(req?.headers?.['x-masar-auth-mode'] || '').trim().toLowerCase() === 'cookie-v1';
}

export function parseRequestCookies(header = '') {
  const cookies = Object.create(null);
  for (const part of String(header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const raw = part.slice(separator + 1).trim();
    if (!name || Object.hasOwn(cookies, name)) continue;
    try { cookies[name] = decodeURIComponent(raw); } catch { cookies[name] = raw; }
  }
  return cookies;
}

export function sessionCookieName(client = '') {
  const kind = cookieClientMap[String(client || '').trim().toLowerCase()] || 'fleet';
  return SESSION_COOKIE_NAMES[kind];
}

export function sessionTokenFromRequest(req, fallback = 'fleet') {
  const client = requestClient(req);
  const kind = cookieClientMap[client] || fallback;
  const cookieName = SESSION_COOKIE_NAMES[kind] || SESSION_COOKIE_NAMES.fleet;
  const cookieToken = parseRequestCookies(req?.headers?.cookie)[cookieName];
  const authorization = String(req?.headers?.authorization || '');
  const bearerToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
  if (usesCookieSession(req) && cookieToken) {
    req.authCookieName = cookieName;
    req.authToken = cookieToken;
    req.authSource = 'cookie';
    return cookieToken;
  }
  if (bearerToken) {
    req.authToken = bearerToken;
    req.authCookieName = cookieName;
    req.authSource = 'bearer';
    return bearerToken;
  }
  if (cookieToken) {
    req.authCookieName = cookieName;
    req.authToken = cookieToken;
    req.authSource = 'cookie';
    return cookieToken;
  }
  return '';
}

function appendSetCookie(res, value) {
  const previous = res.getHeader?.('Set-Cookie');
  const values = previous == null ? [] : Array.isArray(previous) ? previous : [previous];
  res.setHeader('Set-Cookie', [...values, value]);
}

export function setSessionCookie(req, res, token, { client, maxAgeSeconds } = {}) {
  const name = sessionCookieName(client || requestClient(req));
  const secure = process.env.NODE_ENV === 'production' || req?.secure === true ||
    String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https';
  const maxAge = Number.isFinite(Number(maxAgeSeconds)) ? `; Max-Age=${Math.max(0, Math.floor(Number(maxAgeSeconds)))}` : '';
  appendSetCookie(res, `${name}=${encodeURIComponent(String(token || ''))}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}${maxAge}`);
  return name;
}

export function clearSessionCookie(req, res, cookieName = req?.authCookieName || sessionCookieName(requestClient(req))) {
  if (!Object.values(SESSION_COOKIE_NAMES).includes(cookieName)) return;
  const secure = process.env.NODE_ENV === 'production' || req?.secure === true ||
    String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https';
  appendSetCookie(res, `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? '; Secure' : ''}`);
}

export function sessionLifetimeMs(req, rememberMe, { days = 7, hours = 12 } = {}) {
  if (!isWebClient(req)) return Math.max(1, Number(days) || 7) * 86400000;
  return (rememberMe ? Math.max(1, Number(days) || 7) * 86400000 : Math.max(1, Number(hours) || 12) * 3600000);
}

export function hasSessionCookie(req) {
  const cookies = parseRequestCookies(req?.headers?.cookie);
  return Object.values(SESSION_COOKIE_NAMES).some(name => Boolean(cookies[name]));
}

export function originAllowedForCookieRequest(req, allowedOrigins) {
  if (!hasSessionCookie(req)) return true;
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(req?.method || '').toUpperCase())) return true;
  const origin = String(req?.headers?.origin || '').trim();
  if (!origin || !allowedOrigins?.has(origin)) return false;
  const fetchSite = String(req?.headers?.['sec-fetch-site'] || '').toLowerCase();
  return fetchSite !== 'cross-site';
}

export function originAllowedForApiRequest(req, allowedOrigins) {
  const origin = String(req?.headers?.origin || '').trim();
  return !origin || allowedOrigins?.has(origin) === true;
}

export function redactSensitiveText(value) {
  return String(value ?? '')
    .replace(/(^|[^A-Za-z0-9_])(["']?)(password(?:[_-]?hash)?|passwd|passphrase|secret|token|api[_-]?key|access[_-]?(?:key|token)|private[_-]?key|authorization|credential)(["']?)\s*([=:]\s*["']?)(?:Bearer\s+)?([^\s"'`,;}]+)/ig, '$1$2$3$4$5[redacted]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]{12,}/ig, '$1[redacted]');
}

export function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.floor(parsed))) : fallback;
}

const sensitiveFieldName = /(?:password|passwd|passphrase|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|authorization|credential|ftp[_-]?user|username)/i;

export function redactSensitiveData(value) {
  if (Array.isArray(value)) return value.map(redactSensitiveData);
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (typeof value === 'string') return redactSensitiveText(value);
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
