ALTER TABLE tenants ADD COLUMN mail_worker_seen_at timestamptz;
CREATE TABLE mail_outbox (
 tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 id uuid NOT NULL,
 user_id uuid NOT NULL,
 auth_version integer NOT NULL CHECK(auth_version>0),
 reset_hash text NOT NULL CHECK(reset_hash ~ '^[0-9a-f]{64}$'),
 payload jsonb CHECK(payload IS NULL OR jsonb_typeof(payload)='object'),
 status text NOT NULL CHECK(status IN('pending','processing','sent','cancelled','dead')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 created_at timestamptz NOT NULL,
 next_attempt_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 lease uuid,
 lease_until timestamptz,
 last_error text CHECK(last_error IN('RESET_REVOKED','RESET_EXPIRED_OR_REVOKED','ATTEMPTS_EXHAUSTED','ENCRYPTION_KEY_UNAVAILABLE','PROVIDER_UNAVAILABLE')),
 PRIMARY KEY(tenant_id,id),
 FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id),
 CHECK(status<>'processing' OR (lease IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK(status NOT IN('sent','cancelled') OR payload IS NULL)
);
CREATE INDEX mail_outbox_due ON mail_outbox(tenant_id,status,next_attempt_at);
ALTER TABLE mail_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON mail_outbox USING(tenant_id=current_setting('papbox.tenant_id',true)) WITH CHECK(tenant_id=current_setting('papbox.tenant_id',true));
