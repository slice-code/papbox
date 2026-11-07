ALTER TABLE users ADD COLUMN security jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(security)='object');
CREATE TABLE approvals (
 tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 id uuid NOT NULL,
 requester_id uuid NOT NULL,
 auth_version integer NOT NULL CHECK(auth_version>0),
 service text NOT NULL,
 input jsonb NOT NULL CHECK(jsonb_typeof(input)='object'),
 status text NOT NULL CHECK(status IN('pending','approved','rejected','used')),
 expires_at timestamptz NOT NULL,
 approver_id uuid,
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,requester_id) REFERENCES users(tenant_id,id),
 FOREIGN KEY(tenant_id,approver_id) REFERENCES users(tenant_id,id)
);
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON approvals USING(tenant_id=current_setting('papbox.tenant_id',true)) WITH CHECK(tenant_id=current_setting('papbox.tenant_id',true));
CREATE INDEX approvals_expiry ON approvals(tenant_id,expires_at);
