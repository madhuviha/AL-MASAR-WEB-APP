-- Separate School Bus API identity, sessions, and application state.
-- Fleet users, fleet sessions, and fleet company state are left intact.
-- Role constraints are managed by the explicit migration-school-admin-role.sql.

CREATE TABLE IF NOT EXISTS school_accounts (
  company_id BIGINT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  admin_user_id BIGINT UNIQUE REFERENCES auth_users(id) ON DELETE SET NULL,
  created_by BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS school_portal_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_portal_sessions_user
  ON school_portal_sessions(user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_school_portal_sessions_expiry
  ON school_portal_sessions(expires_at);

CREATE TABLE IF NOT EXISTS school_portal_state (
  company_id BIGINT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  version BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
