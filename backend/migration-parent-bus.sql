-- Parent bus tracking storage. This is intentionally separate from driver
-- identification/RFID tables: a child scan represents a passenger event.
ALTER TABLE auth_users DROP CONSTRAINT IF EXISTS auth_users_role_check;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='auth_users'::regclass AND conname='auth_users_role_check'
  ) THEN
    ALTER TABLE auth_users ADD CONSTRAINT auth_users_role_check
      CHECK (role IN ('super_admin','company_admin','company_user','parent','school_admin'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS school_children (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  grade TEXT,
  class_name TEXT,
  rfid_identifier TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_children_company
  ON school_children(company_id, active, name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_school_children_company_rfid
  ON school_children(company_id, rfid_identifier)
  WHERE rfid_identifier IS NOT NULL AND rfid_identifier <> '';

CREATE TABLE IF NOT EXISTS school_child_parents (
  child_id BIGINT NOT NULL REFERENCES school_children(id) ON DELETE CASCADE,
  parent_user_id BIGINT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL DEFAULT 'Parent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (child_id, parent_user_id)
);
CREATE INDEX IF NOT EXISTS idx_school_child_parents_parent
  ON school_child_parents(parent_user_id, child_id);

CREATE TABLE IF NOT EXISTS school_bus_assignments (
  child_id BIGINT PRIMARY KEY REFERENCES school_children(id) ON DELETE CASCADE,
  vehicle_id BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  home_stop TEXT,
  school_name TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_bus_assignments_vehicle
  ON school_bus_assignments(vehicle_id, active);

CREATE TABLE IF NOT EXISTS school_scan_events (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  child_id BIGINT NOT NULL REFERENCES school_children(id) ON DELETE CASCADE,
  vehicle_id BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('boarded','alighted')),
  rfid_identifier TEXT NOT NULL,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'rfid',
  dedupe_key TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_school_scan_events_child_time
  ON school_scan_events(child_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_school_scan_events_company_time
  ON school_scan_events(company_id, scanned_at DESC);
