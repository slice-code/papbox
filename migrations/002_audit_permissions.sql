-- Local dev role is optional: external deployments may use a different role name.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'papbox_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM papbox_app;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON schema_migrations FROM papbox_app;
  END IF;
END $$;
