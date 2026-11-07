ALTER TABLE tenants ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK(status IN('active','suspended','archived'));
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_format CHECK(role ~ '^[a-z][a-z0-9_-]{0,62}$');
CREATE TABLE roles (
 tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 id text NOT NULL CHECK(id ~ '^[a-z][a-z0-9_-]{0,62}$' AND id NOT IN('admin','member','constructor','prototype')),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 80),
 permissions jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(permissions)='object'),
 PRIMARY KEY(tenant_id,id)
);
CREATE TABLE module_records (
 tenant_id text NOT NULL,
 module_id text NOT NULL,
 id uuid NOT NULL,
 owner_id uuid NOT NULL,
 data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,module_id,id),
 FOREIGN KEY(tenant_id,module_id) REFERENCES installed_modules(tenant_id,module_id),
 FOREIGN KEY(tenant_id,owner_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX module_records_owner ON module_records(tenant_id,module_id,owner_id,id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['roles','module_records'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(tenant_id=current_setting(''papbox.tenant_id'',true)) WITH CHECK(tenant_id=current_setting(''papbox.tenant_id'',true))',t);
 END LOOP;
END $$;
