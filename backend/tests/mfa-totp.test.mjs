import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecoveryCodes,
  createTotpSetupKey,
  decryptTotpSecret,
  encryptTotpSecret,
  parseMfaEncryptionKey,
  recoveryCodeHash,
  totpCodeAtCounter,
  verifyTotpCode
} from '../mfa-totp.mjs';

test('TOTP matches the RFC SHA-1 vector and rejects a reused time step', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(totpCodeAtCounter(secret, 1), '287082');
  assert.equal(verifyTotpCode(secret, '287082', { now: 59_000, window: 0 }), 1);
  assert.equal(verifyTotpCode(secret, '287082', { now: 59_000, window: 0, afterCounter: '1' }), null);
  assert.equal(verifyTotpCode(secret, '287082', { now: 59_000, window: 0, afterCounter: null }), 1);
  assert.equal(verifyTotpCode(secret, 'bad', { now: 59_000 }), null);
});

test('TOTP setup keys are encrypted at rest and authenticated on decryption', () => {
  const key = Buffer.alloc(32, 7);
  const setupKey = createTotpSetupKey();
  assert.match(setupKey, /^[A-Z2-7]+$/);
  assert.equal(parseMfaEncryptionKey(key.toString('base64')).length, 32);
  const encrypted = encryptTotpSecret(setupKey, key);
  assert.notEqual(encrypted, setupKey);
  assert.equal(decryptTotpSecret(encrypted, key), setupKey);
  assert.throws(() => decryptTotpSecret(encrypted, Buffer.alloc(32, 8)));
  assert.throws(() => parseMfaEncryptionKey('not-a-key'), /32 random bytes/);
});

test('recovery codes are high entropy and hash independent of formatting', () => {
  const codes = createRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  assert.match(codes[0], /^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/);
  assert.equal(recoveryCodeHash(codes[0]), recoveryCodeHash(codes[0].toLowerCase().replaceAll('-', '')));
});
