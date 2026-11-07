CREATE TABLE tenants (
  id text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_-]{0,62}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tenant_settings (
  tenant_id text PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  locale text NOT NULL DEFAULT 'id-ID'
);
CREATE TABLE users (
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  email text NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 160),
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, email)
);
CREATE TABLE installed_modules (
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module_id text NOT NULL CHECK (module_id ~ '^[a-z][a-z0-9_-]{0,62}$'),
  version text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  installed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, module_id)
);
CREATE TABLE menu_overrides (
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  menu_id text NOT NULL CHECK (menu_id ~ '^[a-z][a-z0-9_-]{0,62}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  position integer NOT NULL CHECK (position BETWEEN 0 AND 100),
  hidden boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, menu_id)
);
CREATE TABLE audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  actor_id uuid NOT NULL,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 120),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES users(tenant_id, id)
);
CREATE INDEX audit_events_tenant_recent ON audit_events (tenant_id, occurred_at DESC, id DESC);

-- Tenant identity is set transaction-locally by the trusted server adapter.
-- FORCE applies even to table owners. Never run the app as superuser/BYPASSRLS.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON tenants USING (id = current_setting('papbox.tenant_id', true)) WITH CHECK (id = current_setting('papbox.tenant_id', true));
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['tenant_settings','users','installed_modules','menu_overrides','audit_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_scope ON %I USING (tenant_id = current_setting(''papbox.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''papbox.tenant_id'', true))', table_name);
  END LOOP;
END $$;
