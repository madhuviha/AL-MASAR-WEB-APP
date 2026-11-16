CREATE TABLE IF NOT EXISTS auth_login_attempt_windows (
  account_hash char(64) PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL CHECK (attempt_count >= 1),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_login_attempt_windows_updated_at_idx
  ON auth_login_attempt_windows(updated_at);
