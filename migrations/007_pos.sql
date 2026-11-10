CREATE UNIQUE INDEX pos_product_sku ON module_records(tenant_id,(data->>'sku')) WHERE module_id='pos' AND data->>'kind'='product';
CREATE UNIQUE INDEX pos_sale_request ON module_records(tenant_id,(data->>'requestId')) WHERE module_id='pos' AND data->>'kind'='sale';
CREATE INDEX pos_sale_history ON module_records(tenant_id,created_at DESC,id DESC) WHERE module_id='pos' AND data->>'kind'='sale';
ALTER TABLE module_records ADD CONSTRAINT pos_record_kind CHECK(module_id<>'pos' OR (data ? 'kind' AND data->>'kind' IN('product','sale')));
