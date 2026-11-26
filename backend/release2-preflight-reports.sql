-- Read-only Release 2 inventory. Run only after a verified production backup.
-- Results contain record IDs and counts only; never selects names, emails,
-- passwords, password hashes, tokens, or API credentials.
BEGIN TRANSACTION READ ONLY;

-- Current delete actions for every direct foreign key into companies.
SELECT conrelid::regclass AS referencing_table,
       conname AS constraint_name,
       pg_get_constraintdef(oid) AS definition,
       CASE confdeltype WHEN 'c' THEN 'CASCADE'
                        WHEN 'n' THEN 'SET NULL'
                        WHEN 'd' THEN 'SET DEFAULT'
                        WHEN 'r' THEN 'RESTRICT'
                        ELSE 'NO ACTION' END AS delete_action
FROM pg_constraint
WHERE contype='f' AND confrelid=to_regclass('public.companies')
ORDER BY referencing_table::text, constraint_name;

-- Duplicate plates within the same company (case and whitespace normalized).
SELECT company_id,
       normalized_value AS normalized_plate_number,
       COUNT(*) AS vehicle_count,
       COUNT(*) FILTER (WHERE active IS TRUE) AS active_vehicle_count,
       ARRAY_AGG(id ORDER BY id) AS vehicle_ids
FROM (
  SELECT id, company_id, active,
         NULLIF(LOWER(REGEXP_REPLACE(BTRIM(plate_number), '\s+', ' ', 'g')), '') AS normalized_value
  FROM vehicles
) normalized_vehicles
WHERE normalized_value IS NOT NULL
GROUP BY company_id, normalized_value
HAVING COUNT(*) > 1
ORDER BY vehicle_count DESC, company_id, normalized_plate_number;

-- Duplicate registration numbers within the same company.
SELECT company_id,
       normalized_value AS normalized_registration,
       COUNT(*) AS vehicle_count,
       COUNT(*) FILTER (WHERE active IS TRUE) AS active_vehicle_count,
       ARRAY_AGG(id ORDER BY id) AS vehicle_ids
FROM (
  SELECT id, company_id, active,
         NULLIF(LOWER(REGEXP_REPLACE(BTRIM(registration), '\s+', ' ', 'g')), '') AS normalized_value
  FROM vehicles
) normalized_vehicles
WHERE normalized_value IS NOT NULL
GROUP BY company_id, normalized_value
HAVING COUNT(*) > 1
ORDER BY vehicle_count DESC, company_id, normalized_registration;

-- IMEI collisions (show only a short hash so the full identifier is not exposed).
SELECT LEFT(MD5(imei), 12) AS imei_fingerprint,
       COUNT(*) AS vehicle_count,
       ARRAY_AGG(id ORDER BY id) AS vehicle_ids
FROM vehicles
WHERE NULLIF(BTRIM(imei), '') IS NOT NULL
GROUP BY imei
HAVING COUNT(*) > 1
ORDER BY vehicle_count DESC, imei_fingerprint;

-- Existing grants with actor attribution. NULL granted_by is ambiguous: it may
-- be a legacy startup backfill or a system/bootstrap grant, not proof by itself.
SELECT app_role,
       CASE WHEN granted_by IS NULL THEN 'unattributed_legacy_or_system'
            ELSE 'actor_attributed' END AS grant_source,
       COUNT(*) AS grant_count,
       MIN(created_at) AS first_granted_at,
       MAX(created_at) AS last_granted_at
FROM auth_user_app_roles
GROUP BY app_role, grant_source
ORDER BY app_role, grant_source;

-- Active identities that currently have no explicit app-role row.
SELECT u.role AS account_role,
       CASE WHEN u.metadata->>'schoolAdmin'='true' THEN 'school_admin'
            WHEN u.metadata->>'schoolParent'='true' THEN 'school_parent'
            ELSE 'other' END AS account_kind,
       COUNT(*) AS active_accounts_without_app_role
FROM auth_users u
LEFT JOIN auth_user_app_roles r ON r.user_id=u.id
WHERE LOWER(u.status)='active'
GROUP BY u.role, account_kind
HAVING COUNT(r.app_role)=0
ORDER BY u.role, account_kind;

ROLLBACK;
