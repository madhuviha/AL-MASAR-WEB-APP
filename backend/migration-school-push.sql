-- Push token and outbox storage shared by the fleet and School Bus push worker.
-- app_role and session_hash keep parent tokens scoped to the school portal.
CREATE TABLE IF NOT EXISTS mobile_push_tokens (
  token_hash TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  user_id BIGINT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL,
  app_role TEXT NOT NULL DEFAULT 'fleet' CHECK (app_role IN ('fleet','parent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE mobile_push_tokens ADD COLUMN IF NOT EXISTS app_role TEXT;
UPDATE mobile_push_tokens t
SET app_role=COALESCE(s.active_app_role,CASE WHEN u.role='parent' THEN 'parent' ELSE 'fleet' END,'fleet')
FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id
WHERE s.token_hash=t.session_hash AND t.app_role IS NULL;
UPDATE mobile_push_tokens SET app_role='fleet' WHERE app_role IS NULL;
ALTER TABLE mobile_push_tokens ALTER COLUMN app_role SET DEFAULT 'fleet';
ALTER TABLE mobile_push_tokens ALTER COLUMN app_role SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='mobile_push_tokens'::regclass AND conname='mobile_push_tokens_app_role_check'
  ) THEN
    ALTER TABLE mobile_push_tokens ADD CONSTRAINT mobile_push_tokens_app_role_check
      CHECK (app_role IN ('fleet','parent'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS mobile_push_outbox (
  id BIGSERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL,
  alert_id TEXT NOT NULL,
  semantic_key TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_attempt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ,
  UNIQUE (token_hash, alert_id)
);

ALTER TABLE mobile_push_outbox ADD COLUMN IF NOT EXISTS semantic_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS mobile_push_outbox_token_semantic_key
  ON mobile_push_outbox(token_hash, semantic_key)
  WHERE semantic_key IS NOT NULL;
