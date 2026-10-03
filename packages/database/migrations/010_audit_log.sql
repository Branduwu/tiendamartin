BEGIN;
SET LOCAL ROLE smartretail_owner;

CREATE TABLE retail.audit_log (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES retail.tenants(tenant_id),
  actor_user_id uuid NOT NULL,
  action text NOT NULL CHECK (action = 'sales.return'),
  entity_type text NOT NULL CHECK (entity_type = 'sale_return'),
  entity_id uuid NOT NULL,
  correlation_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (octet_length(metadata::text) <= 4096),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, action, entity_type, entity_id)
);

ALTER TABLE retail.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE retail.audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_tenant ON retail.audit_log AS RESTRICTIVE
  USING (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND retail.is_active_member()
  )
  WITH CHECK (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND retail.is_active_member()
  );
CREATE POLICY audit_insert ON retail.audit_log FOR INSERT
  WITH CHECK (retail.has_permission('sales.return'));
CREATE TRIGGER audit_immutable
  BEFORE UPDATE OR DELETE ON retail.audit_log
  FOR EACH ROW EXECUTE FUNCTION retail.sale_immutable();

CREATE FUNCTION retail.record_sale_return_audit(
  p_audit_id uuid,
  p_original_sale_id uuid,
  p_return_id uuid,
  p_request_correlation_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, retail AS $$
DECLARE
  actual_total bigint;
  actual_methods text[];
BEGIN
  IF NOT retail.has_permission('sales.return') THEN
    RAISE EXCEPTION 'Return permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT r.total_minor_units,
    coalesce(array_agg(f.method ORDER BY f.method) FILTER (WHERE f.method IS NOT NULL), ARRAY[]::text[])
  INTO actual_total, actual_methods
  FROM retail.sale_returns r
  LEFT JOIN retail.sale_return_refunds f
    ON f.tenant_id = r.tenant_id AND f.return_id = r.id
  WHERE r.tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND r.id = p_return_id
    AND r.sale_id = p_original_sale_id
    AND r.created_by = nullif(current_setting('app.user_id', true), '')::uuid
  GROUP BY r.total_minor_units;
  IF actual_total IS NULL OR NOT EXISTS (
    SELECT 1
    FROM retail.sale_returns
    WHERE tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
      AND id = p_return_id
      AND sale_id = p_original_sale_id
      AND created_by = nullif(current_setting('app.user_id', true), '')::uuid
  ) THEN
    RAISE EXCEPTION 'Invalid return audit context' USING ERRCODE = '23514';
  END IF;
  INSERT INTO retail.audit_log(
    id, tenant_id, actor_user_id, action, entity_type, entity_id,
    correlation_id, metadata
  )
  VALUES (
    p_audit_id,
    nullif(current_setting('app.tenant_id', true), '')::uuid,
    nullif(current_setting('app.user_id', true), '')::uuid,
    'sales.return',
    'sale_return',
    p_return_id,
    p_request_correlation_id,
    jsonb_build_object(
      'sale_id', p_original_sale_id::text,
      'total_minor_units', actual_total::text,
      'refund_methods', to_jsonb(actual_methods)
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION retail.record_sale_return_audit(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retail.record_sale_return_audit(uuid,uuid,uuid,uuid) TO smartretail_app;
COMMIT;
