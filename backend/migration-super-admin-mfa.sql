-- Mandatory Super Admin TOTP, one-time challenges, and hashed recovery codes.
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS mfa_totp_secret_enc TEXT;
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS mfa_totp_enabled_at TIMESTAMPTZ;
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS mfa_totp_pending_secret_enc TEXT;
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS mfa_totp_pending_expires_at TIMESTAMPTZ;
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS mfa_totp_last_counter BIGINT;
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS mfa_recovery_codes JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS auth_mfa_challenges (
  challenge_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  challenge_type TEXT NOT NULL CHECK (challenge_type IN ('login', 'enroll')),
  attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  remember_me BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE auth_mfa_challenges ADD COLUMN IF NOT EXISTS remember_me BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_auth_mfa_challenges_user_expiry
  ON auth_mfa_challenges(user_id, expires_at DESC);
