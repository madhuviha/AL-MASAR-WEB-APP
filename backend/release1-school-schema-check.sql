-- Read-only School Bus schema/migration-state check. Contains no account
-- names, emails, password values, hashes, sessions, or tokens.
BEGIN TRANSACTION READ ONLY;

SELECT to_regclass('public.school_accounts') AS school_accounts_table,
       to_regclass('public.school_portal_sessions') AS school_sessions_table,
       to_regclass('public.school_portal_state') AS school_state_table,
       to_regclass('public.school_children') AS school_children_table;

-- A migration ledger is not currently created by this project. This reports
-- whether an operator has introduced one without assuming it exists.
SELECT to_regclass('public.schema_migrations') AS schema_migrations_table,
       to_regclass('public.knex_migrations') AS knex_migrations_table,
       to_regclass('public.sequelize_meta') AS sequelize_migrations_table;

-- Show the effective CHECK definition, including whether school_admin is
-- accepted by the auth_users role constraint.
SELECT conname,
       pg_get_constraintdef(oid) AS constraint_definition,
       pg_get_constraintdef(oid) ILIKE '%school_admin%' AS accepts_school_admin
FROM pg_constraint
WHERE conrelid=to_regclass('public.auth_users')
  AND contype='c'
  AND pg_get_constraintdef(oid) ILIKE '%role%'
ORDER BY conname;

-- Role counts only; confirms which supported values currently exist before
-- applying the explicit School Bus constraint fix.
SELECT role, COUNT(*) AS account_count
FROM auth_users
GROUP BY role
ORDER BY role;

ROLLBACK;
