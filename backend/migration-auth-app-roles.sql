-- A login identity may enter the fleet portal, the parent app, or both.
-- Existing accounts retain their current behavior through a role backfill.
CREATE TABLE IF NOT EXISTS auth_user_app_roles (
  user_id BIGINT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  app_role TEXT NOT NULL CHECK (app_role IN ('fleet','parent')),
  granted_by BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, app_role)
);

INSERT INTO auth_user_app_roles(user_id, app_role)
SELECT id, CASE WHEN role='parent' THEN 'parent' ELSE 'fleet' END
FROM auth_users
WHERE role<>'school_admin'
  AND COALESCE(metadata->>'schoolParent','false')<>'true'
ON CONFLICT(user_id, app_role) DO NOTHING;

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

UPDATE auth_sessions s
SET active_app_role=CASE WHEN u.role='parent' THEN 'parent' ELSE 'fleet' END
FROM auth_users u
WHERE u.id=s.user_id AND s.active_app_role IS NULL;
