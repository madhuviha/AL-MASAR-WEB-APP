-- Release 2 safeguard: company deletion must not cascade into tenant records.
-- This updates every existing foreign key that directly references companies
-- while preserving its columns, target, and ON UPDATE action. No data is
-- changed. Run only after the verified backup, restore drill, and R2 review.
DO $$
DECLARE
  company_fk RECORD;
  revised_definition TEXT;
BEGIN
  FOR company_fk IN
    SELECT conrelid::regclass AS referencing_table,
           conname,
           pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE contype='f'
      AND confrelid=to_regclass('public.companies')
      AND confdeltype IN ('c','n','d')
  LOOP
    revised_definition := regexp_replace(
      company_fk.definition,
      '\s+ON DELETE\s+(CASCADE|SET NULL|SET DEFAULT)',
      ' ON DELETE RESTRICT',
      'i'
    );
    IF revised_definition=company_fk.definition THEN
      RAISE EXCEPTION 'Could not safely rewrite company foreign key %.%', company_fk.referencing_table, company_fk.conname;
    END IF;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',company_fk.referencing_table,company_fk.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s',company_fk.referencing_table,company_fk.conname,revised_definition);
  END LOOP;
END $$;
