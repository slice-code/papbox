ALTER TABLE users ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN auth_version integer NOT NULL DEFAULT 1 CHECK (auth_version > 0);
ALTER TABLE installed_modules ADD COLUMN package jsonb;
ALTER TABLE installed_modules ADD COLUMN history jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(history) = 'array');
CREATE TABLE sessions (
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL,
  auth_version integer NOT NULL CHECK (auth_version > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, token_hash),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX sessions_expiry ON sessions (tenant_id, expires_at);
CREATE TABLE password_resets (
  LIKE sessions INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id) ON DELETE CASCADE
);
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['sessions','password_resets'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING (tenant_id = current_setting(''papbox.tenant_id'',true)) WITH CHECK (tenant_id = current_setting(''papbox.tenant_id'',true))',table_name);
  END LOOP;
END $$;
ALTER TABLE audit_events ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb;
-- Global pseudonymous IP counters shared by all web instances; not tenant data.
CREATE TABLE auth_rate_limits (
  key_hash text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  bucket bigint NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  PRIMARY KEY (key_hash,bucket)
);
CREATE INDEX auth_rate_limits_bucket ON auth_rate_limits(bucket);
