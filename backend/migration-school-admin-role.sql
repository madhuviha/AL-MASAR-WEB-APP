-- Explicit schema-only fix for the School Bus administrator role constraint.
-- Run through the controlled migration process after backup/restore proof.
DO $$
DECLARE
  role_constraint RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth_users
    WHERE role NOT IN ('super_admin','company_admin','company_user','parent','school_admin')
  ) THEN
    RAISE EXCEPTION 'Unexpected auth_users.role value; review the read-only role inventory before changing the role constraint';
  END IF;

  FOR role_constraint IN
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid=to_regclass('public.auth_users')
      AND contype='c'
  LOOP
    IF role_constraint.definition ILIKE '%role%'
       AND role_constraint.definition ILIKE '%company_admin%'
       AND role_constraint.definition NOT ILIKE '%school_admin%' THEN
      EXECUTE FORMAT('ALTER TABLE public.auth_users DROP CONSTRAINT %I',role_constraint.conname);
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid=to_regclass('public.auth_users')
      AND contype='c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
      AND pg_get_constraintdef(oid) ILIKE '%school_admin%'
  ) THEN
    ALTER TABLE public.auth_users
      ADD CONSTRAINT auth_users_role_check
      CHECK (role IN ('super_admin','company_admin','company_user','parent','school_admin'));
  END IF;
END $$;
