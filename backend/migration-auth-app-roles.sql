-- A login identity may enter the fleet portal, the parent app, or both.
-- This startup migration creates schema only. Role grants and session roles
-- are assigned explicitly by account-management actions; existing rows remain.
CREATE TABLE IF NOT EXISTS auth_user_app_roles (
  user_id BIGINT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  app_role TEXT NOT NULL CHECK (app_role IN ('fleet','parent')),
  granted_by BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, app_role)
);

ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS active_app_role TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='auth_sessions'::regclass AND conname='auth_sessions_active_app_role_check'
  ) THEN
    ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_active_app_role_check
      CHECK (active_app_role IS NULL OR active_app_role IN ('fleet','parent'));
  END IF;
END $$;
