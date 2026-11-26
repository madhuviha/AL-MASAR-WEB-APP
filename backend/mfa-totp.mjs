import crypto from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

export function base32Encode(input) {
  const bytes = Buffer.from(input);
  let buffer = 0;
  let bits = 0;
  let output = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32[(buffer >> bits) & 31];
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits) output += BASE32[(buffer << (5 - bits)) & 31];
  return output;
}

export function base32Decode(value) {
  const text = String(value || '').toUpperCase().replace(/[\s=-]/g, '');
  if (!text || /[^A-Z2-7]/.test(text)) throw new TypeError('Invalid TOTP setup key');
  let buffer = 0;
  let bits = 0;
  const bytes = [];
  for (const char of text) {
    buffer = (buffer << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
      buffer &= (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes);
}

export function createTotpSetupKey() {
  return base32Encode(crypto.randomBytes(20));
}

export function totpCodeAtCounter(secret, counter) {
  const key = base32Decode(secret);
  if (!Number.isSafeInteger(counter) || counter < 0) throw new TypeError('Invalid TOTP counter');
  const data = Buffer.alloc(8);
  data.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', key).update(data).digest();
  const offset = digest[digest.length - 1] & 15;
  const value = ((digest[offset] & 127) << 24) |
    ((digest[offset + 1] & 255) << 16) |
    ((digest[offset + 2] & 255) << 8) |
    (digest[offset + 3] & 255);
  return String(value % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(secret, code, { now = Date.now(), window = 1, afterCounter = -1 } = {}) {
  const candidate = String(code || '').trim();
  const timestamp = Number(now);
  if (!/^\d{6}$/.test(candidate) || !Number.isFinite(timestamp)) return null;
  const current = Math.floor(timestamp / 1000 / STEP_SECONDS);
  const parsedLastUsed = afterCounter == null || afterCounter === '' ? -1 : Number(afterCounter);
  const lastUsed = Number.isSafeInteger(parsedLastUsed) ? parsedLastUsed : -1;
  const safeWindow = Math.max(0, Math.min(2, Math.floor(Number(window) || 0)));
  for (let delta = -safeWindow; delta <= safeWindow; delta++) {
    const counter = current + delta;
    if (counter <= lastUsed || counter < 0) continue;
    const expected = Buffer.from(totpCodeAtCounter(secret, counter));
    const supplied = Buffer.from(candidate);
    if (expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied)) return counter;
  }
  return null;
}

export function parseMfaEncryptionKey(value) {
  const text = String(value || '').trim();
  const key = /^[a-f\d]{64}$/i.test(text) ? Buffer.from(text, 'hex') : Buffer.from(text, 'base64');
  if (key.length !== 32) throw new Error('SUPER_ADMIN_MFA_ENCRYPTION_KEY must contain exactly 32 random bytes encoded as base64 or 64 hex characters');
  return key;
}

export function encryptTotpSecret(secret, keyValue) {
  const key = Buffer.isBuffer(keyValue) ? keyValue : parseMfaEncryptionKey(keyValue);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptTotpSecret(envelope, keyValue) {
  const key = Buffer.isBuffer(keyValue) ? keyValue : parseMfaEncryptionKey(keyValue);
  const [version, ivText, tagText, ciphertextText, ...extra] = String(envelope || '').split('.');
  if (version !== 'v1' || !ivText || !tagText || !ciphertextText || extra.length) throw new Error('Invalid encrypted TOTP secret');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
}

export function createRecoveryCodes(count = 10) {
  const safeCount = Math.max(1, Math.min(20, Math.floor(Number(count) || 10)));
  return Array.from({ length: safeCount }, () => {
    const raw = crypto.randomBytes(8).toString('hex').toUpperCase();
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`;
  });
}

export function recoveryCodeHash(value) {
  const normalized = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}
